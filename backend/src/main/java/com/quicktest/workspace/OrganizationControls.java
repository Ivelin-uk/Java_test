package com.quicktest.workspace;

import com.quicktest.workspace.repository.OrganizationControlRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.math.BigDecimal;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class OrganizationControls {
    private final WorkspaceJson json;
    private final OrganizationControlRepository repository;private final WorkspaceAudit audit;private final Clock clock;
    public OrganizationControls(OrganizationControlRepository repository,WorkspaceJson json,WorkspaceAudit audit,Clock clock) {this.repository=repository;this.json=json;this.audit=audit;this.clock=clock;}
    public Object settings(OrgAccess.Scope scope) {return repository.requireOrganization(scope.organizationId());}
    @Transactional public void settings(OrgAccess.Scope scope,Settings settings) {
        var profile=settings.profile();if(profile==null || profile.name()==null || profile.name().isBlank() || profile.name().length()>190 || profile.organizationType()==null || !Set.of("school","university","training").contains(profile.organizationType()) || profile.contactEmail()==null || !profile.contactEmail().matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") || profile.contactEmail().length()>190 || profile.studentLabel()==null || profile.studentLabel().isBlank() || profile.studentLabel().length()>40) throw WorkspaceError.validation("Невалиден профил на организация.");
        try {ZoneId.of(profile.timezone());}catch(Exception e) {throw WorkspaceError.validation("Невалидна часова зона.");}
        if(settings.retentionDays()<30 || settings.retentionDays()>36500 || !Set.of("bulgarian","percentage","pass_fail").contains(settings.gradingScale()) || settings.passThreshold()==null || settings.passThreshold().signum()<0 || settings.passThreshold().compareTo(new BigDecimal("100"))>0) throw WorkspaceError.validation("Невалидна скала или срок за съхранение.");
        repository.updateSettings(profile.name(), profile.organizationType(), profile.contactEmail(), profile.timezone(), profile.studentLabel(), json.write(Map.of("retentionDays",settings.retentionDays(),"gradingScale",settings.gradingScale(),"passThreshold",settings.passThreshold(),"retentionApproved",settings.retentionApproved())), scope.organizationId());
        audit.write(scope.organizationId(),scope.userId(),"organization.settings_changed",scope.organizationId(),Map.of("retentionDays",settings.retentionDays(),"retentionApproved",settings.retentionApproved()));
    }
    @Transactional public Object support(OrgAccess.Scope scope,Support request) {
        if(request.reason()==null || request.reason().isBlank() || request.reason().length()>1000 || request.hours()<1 || request.hours()>24) throw WorkspaceError.validation("Поддръжка: причина и срок 1–24 часа.");
        repository.requireAdministrator(request.administratorId());
        long id=repository.insertSupportGrant(scope.organizationId(), request.administratorId(), scope.userId(), request.reason(), clock.instant().plusSeconds(request.hours()*3600L), clock.instant());
        audit.write(scope.organizationId(),scope.userId(),"support.approved",id,Map.of("administrator",request.administratorId(),"reason",request.reason(),"hours",request.hours()));return repository.requireSupportGrant(id);
    }
    @Transactional public void revokeSupport(OrgAccess.Scope scope,long id) {repository.requireScopedSupportGrant(scope.organizationId(), id);repository.revokeSupportGrant(clock.instant(), scope.organizationId(), id);audit.write(scope.organizationId(),scope.userId(),"support.revoked",id,Map.of());}
    public void supportAccess(long administrator,long org) {
        repository.requireOrganizationId(org);
        var grant=repository.requireActiveSupportGrant(org, administrator, clock.instant());
        audit.write(org,administrator,"support.read",number(grant,"id"),Map.of());
    }
    public Object metrics(long org) {
        Map<String,Object> metrics=new LinkedHashMap<>();
        metrics.put("members",repository.countActiveMembers(org));
        metrics.put("assignments",repository.countAssignments(org));
        metrics.put("activeAttempts",repository.countActiveAttempts(org));
        metrics.put("pendingReviews",repository.countPendingReviews(org));
        metrics.put("mailFailures",repository.countMailFailures(org));
        metrics.put("queuedMail",repository.countQueuedMail(org));
        metrics.put("aiJobs",repository.findAiMetrics(org));
        metrics.put("overdueQuestions",repository.countOverdueQuestions(org, clock.instant()));return metrics;
    }
    public Object export(OrgAccess.Scope scope) {
        Map<String,Object> result=new LinkedHashMap<>();result.put("schema","examai-export-v1");result.put("exportedAt",clock.instant());result.put("organization",settings(scope));
        result.putAll(repository.findExportRows(scope.organizationId()));
        result.put("assignments",repository.exportAssignments(scope.organizationId()));
        result.put("attempts",repository.exportAttempts(scope.organizationId()));
        audit.write(scope.organizationId(),scope.userId(),"organization.exported",scope.organizationId(),Map.of());return result;
    }
    @Transactional public void plan(Long id,Plan request) {
        if(request.name()==null || request.name().isBlank() || request.name().length()>80 || request.monthlyEur()==null || request.yearlyEur()==null || request.monthlyEur().signum()<0 || request.yearlyEur().signum()<0 || request.teacherLimit()<1 || request.studentLimit()<1 || request.aiLimit()<0 || request.storageBytes()<0) throw WorkspaceError.validation("Невалиден план.");
        if(id==null) id=repository.insertPlan(request.name(), request.monthlyEur(), request.yearlyEur(), request.teacherLimit(), request.studentLimit(), request.aiLimit(), request.storageBytes(), request.demonstration());
        else {repository.requirePlan(id);repository.updatePlan(request.name(), request.monthlyEur(), request.yearlyEur(), request.teacherLimit(), request.studentLimit(), request.aiLimit(), request.storageBytes(), request.demonstration(), id);}
        for(var entry:Map.of("month",Objects.toString(request.monthPriceId(),""),"year",Objects.toString(request.yearPriceId(),"")).entrySet()) {
            if(entry.getValue().isBlank()) {repository.deletePlanPrice(id, entry.getKey());continue;}
            if(!entry.getValue().matches("price_[A-Za-z0-9]{1,180}")) throw WorkspaceError.validation("Невалиден Stripe price ID.");
            repository.upsertPlanPrice(id, entry.getKey(), entry.getValue());
        }
    }
    public record Settings(OrganizationService.OrganizationRequest profile,int retentionDays,boolean retentionApproved,String gradingScale,BigDecimal passThreshold) {}
    public record Support(long administratorId,String reason,int hours) {}
    public record Plan(String name,BigDecimal monthlyEur,BigDecimal yearlyEur,int teacherLimit,int studentLimit,int aiLimit,long storageBytes,boolean demonstration,String monthPriceId,String yearPriceId) {}
}
