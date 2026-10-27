package com.quicktest.workspace;

import com.quicktest.workspace.repository.TeacherEntitlementRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

/** Teacher-owned quotas are independent of the resource's workspace and Stripe billing cadence. */
@Service
public class TeacherEntitlementService {
    private final TeacherEntitlementRepository repository;
    private final TeacherBillingService billing;
    private final Clock clock;
    private final Limits free,pro;
    public TeacherEntitlementService(TeacherEntitlementRepository repository,TeacherBillingService billing,Clock clock,
            @Value("${app.billing.free-group-limit:1}") int freeGroups,
            @Value("${app.billing.free-active-assignment-limit:5}") int freeAssignments,
            @Value("${app.billing.free-ai-credits:10}") int freeAi,
            @Value("${app.billing.pro-group-limit:20}") int proGroups,
            @Value("${app.billing.pro-active-assignment-limit:100}") int proAssignments,
            @Value("${app.billing.pro-ai-credits:100}") int proAi) {
        this.repository=repository;this.billing=billing;this.clock=clock;
        free=new Limits(freeGroups,freeAssignments,freeAi);pro=new Limits(proGroups,proAssignments,proAi);
    }
    public boolean applies(OrgAccess.Scope scope) {
        return scope.platform() || repository.personalWorkspace(scope.organizationId());
    }
    public void lock(OrgAccess.Scope scope) {if(applies(scope)) repository.lock(scope.userId());}
    public void requireGroupCapacity(OrgAccess.Scope scope) {
        if(!applies(scope)) return;
        repository.lock(scope.userId());
        if(repository.groups(scope.userId())>=limits(scope.userId()).groups())
            throw WorkspaceError.conflict("Достигнат е лимитът за групи. Управлявайте абонамента си от „Абонамент“.");
    }
    public void requireAssignmentCapacity(OrgAccess.Scope scope,long excluding) {
        if(!applies(scope)) return;
        repository.lock(scope.userId());
        if(repository.activeAssignments(scope.userId(),clock.instant(),excluding)>=limits(scope.userId()).activeAssignments())
            throw WorkspaceError.conflict("Достигнат е лимитът за активни възлагания. Управлявайте абонамента си от „Абонамент“.");
    }
    public void requireAutomaticGrading(OrgAccess.Scope scope) {
        if(applies(scope) && !billing.isPro(scope.userId()))
            throw WorkspaceError.conflict("Автоматичната AI проверка изисква Pro. Ръчната проверка остава достъпна.");
    }
    public void reserveAi(OrgAccess.Scope scope,String kind,long job) {
        repository.lock(scope.userId());
        boolean paid=billing.isPro(scope.userId());String period=period(paid);
        if(repository.lockedCredits(scope.userId(),period)>=(paid?pro:free).aiCredits())
            throw WorkspaceError.conflict("Изчерпани AI кредити. Вижте лимита и абонамента си в „Абонамент“. Ръчната проверка остава достъпна.");
        repository.reserve(kind,job,scope.userId(),period,clock.instant());
    }
    // All AI paths acquire organization quota -> teacher quota -> attempt/job locks.
    public void lockAi(String kind,long job) {
        repository.credit(kind,job).ifPresent(row->repository.lock(number(row,"user_id")));
    }
    public boolean settleAi(String kind,long job,boolean success) {
        var credit=repository.credit(kind,job);
        if(credit.isEmpty()) return false;
        repository.settle(kind,job,success,clock.instant());return true;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> describe(OrgAccess.Scope scope) {
        boolean paid=billing.isPro(scope.userId());
        return Map.of("limits",(paid?pro:free),"plans",Map.of("free",free,"pro",pro),"usage",Map.of(
                "groups",repository.groups(scope.userId()),
                "activeAssignments",repository.activeAssignments(scope.userId(),clock.instant(),-1),
                "aiCredits",repository.credits(scope.userId(),period(paid))));
    }
    private Limits limits(long user) {return billing.isPro(user)?pro:free;}
    private String period(boolean paid) {return paid?YearMonth.from(clock.instant().atZone(ZoneOffset.UTC)).toString():"trial";}
    public record Limits(int groups,int activeAssignments,int aiCredits) {
        public Limits {if(groups<1 || activeAssignments<1 || aiCredits<0) throw new IllegalArgumentException("Invalid billing limits");}
    }
}
