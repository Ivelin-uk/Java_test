package com.quicktest.workspace;

import com.quicktest.workspace.repository.RetentionRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.*;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class RetentionService {
    private final WorkspaceJson json;
    private final RetentionRepository repository;private final Clock clock;private final WorkspaceAudit audit;private final PasswordEncoder passwords;
    public RetentionService(RetentionRepository repository,WorkspaceJson json,Clock clock,WorkspaceAudit audit,PasswordEncoder passwords) {this.repository=repository;this.json=json;this.clock=clock;this.audit=audit;this.passwords=passwords;}
    private Instant cutoff(long org) {
        var policy=json.object(repository.requirePolicy(org).get("settings_json"));
        if(!Boolean.TRUE.equals(policy.get("retentionApproved")) || !(policy.get("retentionDays") instanceof Number days) || days.intValue()<30) throw WorkspaceError.conflict("Първо одобрете политиката за съхранение.");
        return clock.instant().minusSeconds(days.longValue()*86400);
    }
    public Object preview(OrgAccess.Scope scope) {Instant cutoff=cutoff(scope.organizationId());return Map.of("cutoff",cutoff,"attempts",repository.countExpiredAttempts(scope.organizationId(), cutoff));}
    @Transactional public Object run(OrgAccess.Scope scope,Request request) {
        if(request.requestKey()==null || !request.requestKey().matches("[A-Za-z0-9_-]{8,80}") || request.reason()==null || request.reason().isBlank() || request.reason().length()>1000 || request.password()==null) throw WorkspaceError.validation("Нужни са ключ, причина и текуща парола.");
        if(!passwords.matches(request.password(),string(repository.requireActivePassword(scope.userId()),"password_hash"))) throw WorkspaceError.forbidden();
        // Serialize retention without locking the parent of grading and outbox records.
        repository.ensureRetentionLock(scope.organizationId());
        repository.lockRetention(scope.organizationId());
        var previous=repository.findPreviousRun(scope.organizationId(), request.requestKey());if(previous.isPresent()) return previous.get();
        Instant cutoff=cutoff(scope.organizationId());int count=0;
        var attempts=repository.lockExpiredAttempts(scope.organizationId(), cutoff);
        for(var attempt:attempts) {
            long id=number(attempt,"id");
            var deliveries=repository.lockDeliveries(scope.organizationId(), id);
            if(deliveries.stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на известие.");
            for(var revision:repository.findRevisions(scope.organizationId(), id)) repository.deleteNotifications(scope.organizationId(), number(revision,"id"));
            repository.deleteEvents(scope.organizationId(), id);
            repository.deleteResults(scope.organizationId(), id);
            repository.deleteQuestions(scope.organizationId(), id);
            // Keep a minimal attempt tombstone so retention cannot reset attempt limits or numbers.
            repository.redactAttempt("0".repeat(64), "0".repeat(64), scope.organizationId(), id);count++;
        }
        long run=repository.insertRun(scope.organizationId(), request.requestKey(), scope.userId(), cutoff, request.reason(), count, clock.instant());
        audit.write(scope.organizationId(),scope.userId(),"retention.executed",run,Map.of("attempts",count,"cutoff",cutoff.toString(),"reason",request.reason()));return repository.requireRun(run);
    }
    public record Request(String requestKey,String password,String reason) {}
}
