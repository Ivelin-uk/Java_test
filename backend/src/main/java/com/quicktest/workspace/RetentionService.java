package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.*;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class RetentionService {
    private final WorkspaceStore db;private final Clock clock;private final WorkspaceAudit audit;private final PasswordEncoder passwords;
    public RetentionService(WorkspaceStore db,Clock clock,WorkspaceAudit audit,PasswordEncoder passwords) {this.db=db;this.clock=clock;this.audit=audit;this.passwords=passwords;}
    private Instant cutoff(long org) {
        var policy=db.object(db.one("SELECT settings_json FROM organizations WHERE id=?",org).get("settings_json"));
        if(!Boolean.TRUE.equals(policy.get("retentionApproved")) || !(policy.get("retentionDays") instanceof Number days) || days.intValue()<30) throw WorkspaceError.conflict("Първо одобрете политиката за съхранение.");
        return clock.instant().minusSeconds(days.longValue()*86400);
    }
    public Object preview(OrgAccess.Scope scope) {Instant cutoff=cutoff(scope.organizationId());return Map.of("cutoff",cutoff,"attempts",db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status IN ('finalized','voided') AND submitted_at<?",scope.organizationId(),cutoff));}
    @Transactional public Object run(OrgAccess.Scope scope,Request request) {
        if(request.requestKey()==null || !request.requestKey().matches("[A-Za-z0-9_-]{8,80}") || request.reason()==null || request.reason().isBlank() || request.reason().length()>1000 || request.password()==null) throw WorkspaceError.validation("Нужни са ключ, причина и текуща парола.");
        if(!passwords.matches(request.password(),string(db.one("SELECT password_hash FROM users WHERE id=? AND active=TRUE",scope.userId()),"password_hash"))) throw WorkspaceError.forbidden();
        // Serialize retention without locking the parent of grading and outbox records.
        db.update("INSERT INTO organization_retention_locks(organization_id) VALUES(?) ON DUPLICATE KEY UPDATE organization_id=organization_id",scope.organizationId());
        db.one("SELECT organization_id FROM organization_retention_locks WHERE organization_id=? FOR UPDATE",scope.organizationId());
        var previous=db.optional("SELECT * FROM retention_runs WHERE organization_id=? AND request_key=?",scope.organizationId(),request.requestKey());if(previous.isPresent()) return previous.get();
        Instant cutoff=cutoff(scope.organizationId());int count=0;
        var attempts=db.rows("SELECT id FROM exam_attempts WHERE organization_id=? AND status IN ('finalized','voided') AND submitted_at<? ORDER BY id FOR UPDATE",scope.organizationId(),cutoff);
        for(var attempt:attempts) {
            long id=number(attempt,"id");
            var deliveries=db.rows("SELECT n.id,n.status FROM notification_outbox n JOIN result_revisions r ON r.organization_id=n.organization_id AND r.id=n.revision_id WHERE r.organization_id=? AND r.attempt_id=? FOR UPDATE",scope.organizationId(),id);
            if(deliveries.stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на известие.");
            for(var revision:db.rows("SELECT id FROM result_revisions WHERE organization_id=? AND attempt_id=?",scope.organizationId(),id)) db.update("DELETE FROM notification_outbox WHERE organization_id=? AND revision_id=?",scope.organizationId(),number(revision,"id"));
            db.update("DELETE FROM exam_events WHERE organization_id=? AND attempt_id=?",scope.organizationId(),id);
            db.update("DELETE FROM result_revisions WHERE organization_id=? AND attempt_id=?",scope.organizationId(),id);
            db.update("DELETE FROM attempt_questions WHERE organization_id=? AND attempt_id=?",scope.organizationId(),id);
            // Keep a minimal attempt tombstone so retention cannot reset attempt limits or numbers.
            db.update("UPDATE exam_attempts SET status='redacted',active_key=NULL,session_hash=?,auth_session_hash=?,browser_id='redacted',void_reason=NULL WHERE organization_id=? AND id=?","0".repeat(64),"0".repeat(64),scope.organizationId(),id);count++;
        }
        long run=db.insert("INSERT INTO retention_runs(organization_id,request_key,actor_id,cutoff,reason,redacted_attempts,created_at) VALUES(?,?,?,?,?,?,?)",scope.organizationId(),request.requestKey(),scope.userId(),cutoff,request.reason(),count,clock.instant());
        audit.write(scope.organizationId(),scope.userId(),"retention.executed",run,Map.of("attempts",count,"cutoff",cutoff.toString(),"reason",request.reason()));return db.one("SELECT * FROM retention_runs WHERE id=?",run);
    }
    public record Request(String requestKey,String password,String reason) {}
}
