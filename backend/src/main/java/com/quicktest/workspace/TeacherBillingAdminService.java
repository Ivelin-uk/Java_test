package com.quicktest.workspace;

import com.quicktest.admin.AdminAudit;
import com.quicktest.admin.AdminAuditRepository;
import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.Role;
import com.quicktest.workspace.repository.TeacherBillingRepository;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.NotBlank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class TeacherBillingAdminService {
    private final TeacherBillingRepository repository;
    private final TeacherEntitlementService entitlements;
    private final AppUserRepository users;
    private final AdminAuditRepository audit;
    private final PaymentGateway gateway;
    private final Clock clock;

    public TeacherBillingAdminService(TeacherBillingRepository repository,TeacherEntitlementService entitlements,
            AppUserRepository users,AdminAuditRepository audit,PaymentGateway gateway,Clock clock) {
        this.repository=repository;this.entitlements=entitlements;this.users=users;this.audit=audit;this.gateway=gateway;this.clock=clock;
    }

    @Transactional(readOnly=true)
    public List<TeacherPlan> plans() {return repository.findTeacherPlansForAdmin().stream().map(this::describe).toList();}
    @Transactional(readOnly=true)
    public List<TeacherBillingService.PaymentRecord> payments(String month) {return TeacherBillingService.paymentHistory(repository,month);}

    private TeacherPlan describe(Map<String,Object> row) {
        long user=number(row,"user_id");
        boolean sameMode=string(row,"stripe_mode").equals(gateway.mode());
        String period=sameMode?string(row,"billing_period"):"";
        boolean paid=sameMode && row.get("paid_through")!=null && time(row,"paid_through").isAfter(clock.instant());
        String manual=string(row,"manual_plan");
        boolean pro=manual.isBlank()?paid:manual.equals("pro");
        var quota=entitlements.snapshot(user,pro);
        Long amount=period.equals("month")?Long.valueOf(TeacherBillingService.MONTHLY_AMOUNT_MINOR):period.equals("year")?Long.valueOf(5000):null;
        return new TeacherPlan(user,pro?"pro":"free",string(row,"provider_status").isBlank()?"free":string(row,"provider_status"),
                period.isBlank()?null:period,amount,amount==null?null:"EUR",
                sameMode && row.get("paid_through")!=null?time(row,"paid_through"):null,sameMode && flag(row,"cancel_at_period_end"),
                manual.isBlank()?null:manual,quota.limits(),quota.usage(),quota.reservedAiCredits());
    }

    @Transactional
    public TeacherPlan changePlan(AppUser actor,long user,PlanEdit request) {
        validate(request==null?null:request.requestKey());
        if(request.plan()==null || !List.of("auto","free","pro").contains(request.plan())) throw WorkspaceError.validation("Избери Free, Pro или автоматичен план от Stripe.");
        var target=lockTarget(actor,user);
        if(!replayed(actor,user,request.requestKey(),"plan",request.plan())) {
            String previous=repository.planOverride(user).orElse("auto");
            repository.setPlanOverride(user,request.plan(),actor.getId(),clock.instant());
            repository.recordAdminRequest(actor.getId(),request.requestKey(),user,"plan",request.plan(),clock.instant());
            writeAudit(actor,target,"TEACHER_PLAN_CHANGED","План: "+previous+" → "+request.plan()+". Плащанията в Stripe не са променени.");
        }
        return plan(user);
    }

    @Transactional
    public TeacherPlan resetAi(AppUser actor,long user,ResetAi request) {
        validate(request==null?null:request.requestKey());
        var target=lockTarget(actor,user);
        String period=request.period();
        if(period==null || !period.matches("(trial|\\d{4}-(0[1-9]|1[0-2]))")) throw WorkspaceError.validation("Избери пробния период или месец във формат ГГГГ-ММ.");
        if(!replayed(actor,user,request.requestKey(),"reset_ai",period)) {
            int reset=entitlements.resetAi(user,period);
            repository.recordAdminRequest(actor.getId(),request.requestKey(),user,"reset_ai",period,clock.instant());
            writeAudit(actor,target,"TEACHER_AI_RESET","Период: "+period+"; нулирани използвани AI кредити: "+reset+". Текущите AI задачи са запазени.");
        }
        return plan(user);
    }

    private AppUser lockTarget(AppUser actor,long user) {
        var current=actor==null?null:users.findById(actor.getId()).orElse(null);
        if(current==null || !current.isActive() || current.getRole()!=Role.ADMIN) throw WorkspaceError.forbidden();
        // User precedes teacher quota, as in account deletion. Never acquire job locks here.
        var target=users.lockById(user).orElseThrow(WorkspaceError::notFound);
        if(target.getRole()!=Role.TEACHER) throw WorkspaceError.validation("Това действие е достъпно само за учителски профил.");
        entitlements.lockTeacher(user);
        return target;
    }
    private void validate(String key) {
        if(key==null || !key.matches("[A-Za-z0-9_-]{8,80}")) throw WorkspaceError.validation("Невалиден ключ на заявката.");
    }
    private boolean replayed(AppUser actor,long user,String key,String action,String plan) {
        var previous=repository.adminRequest(actor.getId(),key);
        if(previous.isEmpty()) return false;
        var row=previous.get();
        if(number(row,"user_id")!=user || !string(row,"action").equals(action) || !string(row,"requested_plan").equals(plan)) throw WorkspaceError.conflict("Ключът на заявката вече е използван за друго действие.");
        return true;
    }
    private TeacherPlan plan(long user) {return repository.findTeacherPlansForAdmin().stream().filter(row->number(row,"user_id")==user).findFirst().map(this::describe).orElseThrow(WorkspaceError::notFound);}
    private void writeAudit(AppUser actor,AppUser target,String action,String details) {
        var entry=new AdminAudit();entry.setActor(actor);entry.setTargetUser(target);entry.setAction(action);entry.setDetails(details);entry.setCreatedAt(clock.instant());audit.save(entry);
    }

    public record PlanEdit(@NotBlank @Pattern(regexp="auto|free|pro") String plan,
                           @NotBlank @Pattern(regexp="[A-Za-z0-9_-]{8,80}") String requestKey) {}
    public record ResetAi(@NotBlank @Pattern(regexp="trial|\\d{4}-(0[1-9]|1[0-2])") String period,
                          @NotBlank @Pattern(regexp="[A-Za-z0-9_-]{8,80}") String requestKey) {}
    public record TeacherPlan(long userId,String plan,String status,String period,Long amountMinor,
                              String currency,Instant paidThrough,boolean cancelAtPeriodEnd,String manualPlan,
                              TeacherEntitlementService.Limits limits,TeacherEntitlementService.Usage usage,long reservedAiCredits) {}
}
