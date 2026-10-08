package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.math.BigDecimal;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class OrganizationControls {
    private final WorkspaceStore db;private final WorkspaceAudit audit;private final Clock clock;
    public OrganizationControls(WorkspaceStore db,WorkspaceAudit audit,Clock clock) {this.db=db;this.audit=audit;this.clock=clock;}
    public Object settings(OrgAccess.Scope scope) {return db.one("SELECT * FROM organizations WHERE id=?",scope.organizationId());}
    @Transactional public void settings(OrgAccess.Scope scope,Settings settings) {
        var profile=settings.profile();if(profile==null || profile.name()==null || profile.name().isBlank() || profile.name().length()>190 || profile.organizationType()==null || !Set.of("school","university","training").contains(profile.organizationType()) || profile.contactEmail()==null || !profile.contactEmail().matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") || profile.contactEmail().length()>190 || profile.studentLabel()==null || profile.studentLabel().isBlank() || profile.studentLabel().length()>40) throw WorkspaceError.validation("Невалиден профил на организация.");
        try {ZoneId.of(profile.timezone());}catch(Exception e) {throw WorkspaceError.validation("Невалидна часова зона.");}
        if(settings.retentionDays()<30 || settings.retentionDays()>36500 || !Set.of("bulgarian","percentage","pass_fail").contains(settings.gradingScale()) || settings.passThreshold()==null || settings.passThreshold().signum()<0 || settings.passThreshold().compareTo(new BigDecimal("100"))>0) throw WorkspaceError.validation("Невалидна скала или срок за съхранение.");
        db.update("UPDATE organizations SET name=?,organization_type=?,contact_email=?,timezone=?,student_label=?,settings_json=? WHERE id=?",profile.name(),profile.organizationType(),profile.contactEmail(),profile.timezone(),profile.studentLabel(),db.json(Map.of("retentionDays",settings.retentionDays(),"gradingScale",settings.gradingScale(),"passThreshold",settings.passThreshold(),"retentionApproved",settings.retentionApproved())),scope.organizationId());
        audit.write(scope.organizationId(),scope.userId(),"organization.settings_changed",scope.organizationId(),Map.of("retentionDays",settings.retentionDays(),"retentionApproved",settings.retentionApproved()));
    }
    @Transactional public Object support(OrgAccess.Scope scope,Support request) {
        if(request.reason()==null || request.reason().isBlank() || request.reason().length()>1000 || request.hours()<1 || request.hours()>24) throw WorkspaceError.validation("Поддръжка: причина и срок 1–24 часа.");
        db.one("SELECT id FROM users WHERE id=? AND role='ADMIN' AND active=TRUE",request.administratorId());
        long id=db.insert("INSERT INTO support_grants(organization_id,administrator_id,approved_by,reason,expires_at,created_at) VALUES(?,?,?,?,?,?)",scope.organizationId(),request.administratorId(),scope.userId(),request.reason(),clock.instant().plusSeconds(request.hours()*3600L),clock.instant());
        audit.write(scope.organizationId(),scope.userId(),"support.approved",id,Map.of("administrator",request.administratorId(),"reason",request.reason(),"hours",request.hours()));return db.one("SELECT * FROM support_grants WHERE id=?",id);
    }
    @Transactional public void revokeSupport(OrgAccess.Scope scope,long id) {db.one("SELECT id FROM support_grants WHERE organization_id=? AND id=?",scope.organizationId(),id);db.update("UPDATE support_grants SET revoked_at=? WHERE organization_id=? AND id=?",clock.instant(),scope.organizationId(),id);audit.write(scope.organizationId(),scope.userId(),"support.revoked",id,Map.of());}
    public void supportAccess(long administrator,long org) {
        db.one("SELECT id FROM organizations WHERE id=?",org);
        var grant=db.one("SELECT id FROM support_grants WHERE organization_id=? AND administrator_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY id DESC LIMIT 1",org,administrator,clock.instant());
        audit.write(org,administrator,"support.read",number(grant,"id"),Map.of());
    }
    public Object metrics(long org) {
        Map<String,Object> metrics=new LinkedHashMap<>();
        metrics.put("members",db.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active'",org));
        metrics.put("assignments",db.count("SELECT COUNT(*) FROM exam_assignments WHERE organization_id=?",org));
        metrics.put("activeAttempts",db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status='in_progress'",org));
        metrics.put("pendingReviews",db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status='pending_review'",org));
        metrics.put("mailFailures",db.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=? AND status IN ('failed','uncertain')",org));
        metrics.put("queuedMail",db.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=? AND status='queued'",org));
        metrics.put("aiJobs",db.rows("SELECT status,COUNT(*) total,MIN(created_at) oldest FROM workspace_ai_jobs WHERE organization_id=? GROUP BY status",org));
        metrics.put("overdueQuestions",db.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND status='open' AND deadline_at<?",org,clock.instant()));return metrics;
    }
    public Object export(OrgAccess.Scope scope) {
        Map<String,Object> result=new LinkedHashMap<>();result.put("schema","examai-export-v1");result.put("exportedAt",clock.instant());result.put("organization",settings(scope));
        // Only fixed, server-owned table names; bearer tokens, access codes and challenges are excluded.
        for(String table:List.of("memberships","learning_groups","group_teachers","group_members","workspace_assessments","assessment_versions","question_bank_items","assignment_recipients","attempt_questions","result_revisions","exam_events","workspace_audit")) result.put(table,db.rows("SELECT * FROM "+table+" WHERE organization_id=?",scope.organizationId()));
        result.put("assignments",db.rows("SELECT id,version_id,teacher_id,starts_at,ends_at,max_attempts,shuffle_questions,shuffle_options,answers_after_deadline,created_at FROM exam_assignments WHERE organization_id=?",scope.organizationId()));
        result.put("attempts",db.rows("SELECT id,assignment_id,student_id,attempt_number,status,started_at,submitted_at,expired,void_reason FROM exam_attempts WHERE organization_id=?",scope.organizationId()));
        audit.write(scope.organizationId(),scope.userId(),"organization.exported",scope.organizationId(),Map.of());return result;
    }
    @Transactional public void plan(Long id,Plan request) {
        if(request.name()==null || request.name().isBlank() || request.name().length()>80 || request.monthlyEur()==null || request.yearlyEur()==null || request.monthlyEur().signum()<0 || request.yearlyEur().signum()<0 || request.teacherLimit()<1 || request.studentLimit()<1 || request.aiLimit()<0 || request.storageBytes()<0) throw WorkspaceError.validation("Невалиден план.");
        if(id==null) id=db.insert("INSERT INTO organization_plans(name,monthly_eur,yearly_eur,teacher_limit,student_limit,ai_limit,storage_bytes,demonstration) VALUES(?,?,?,?,?,?,?,?)",request.name(),request.monthlyEur(),request.yearlyEur(),request.teacherLimit(),request.studentLimit(),request.aiLimit(),request.storageBytes(),request.demonstration());
        else {db.one("SELECT id FROM organization_plans WHERE id=?",id);db.update("UPDATE organization_plans SET name=?,monthly_eur=?,yearly_eur=?,teacher_limit=?,student_limit=?,ai_limit=?,storage_bytes=?,demonstration=? WHERE id=?",request.name(),request.monthlyEur(),request.yearlyEur(),request.teacherLimit(),request.studentLimit(),request.aiLimit(),request.storageBytes(),request.demonstration(),id);}
        for(var entry:Map.of("month",Objects.toString(request.monthPriceId(),""),"year",Objects.toString(request.yearPriceId(),"")).entrySet()) {
            if(entry.getValue().isBlank()) {db.update("DELETE FROM organization_plan_prices WHERE plan_id=? AND billing_period=?",id,entry.getKey());continue;}
            if(!entry.getValue().matches("price_[A-Za-z0-9]{1,180}")) throw WorkspaceError.validation("Невалиден Stripe price ID.");
            db.update("INSERT INTO organization_plan_prices(plan_id,billing_period,stripe_price_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stripe_price_id=VALUES(stripe_price_id)",id,entry.getKey(),entry.getValue());
        }
    }
    public record Settings(OrganizationService.OrganizationRequest profile,int retentionDays,boolean retentionApproved,String gradingScale,BigDecimal passThreshold) {}
    public record Support(long administratorId,String reason,int hours) {}
    public record Plan(String name,BigDecimal monthlyEur,BigDecimal yearlyEur,int teacherLimit,int studentLimit,int aiLimit,long storageBytes,boolean demonstration,String monthPriceId,String yearPriceId) {}
}
