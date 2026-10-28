package com.quicktest;

import com.quicktest.auth.*;
import com.quicktest.workspace.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static com.quicktest.workspace.WorkspaceValues.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:teacher_billing;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","app.workspace.workers=false","app.stripe.pro-month-price-id=price_month","app.stripe.pro-year-price-id=price_year"})
class TeacherBillingTests {
    @Autowired TeacherBillingService service;
    @Autowired TeacherBillingAdminService adminBilling;
    @Autowired WorkspaceStore db;
    @Autowired WorkspaceJson json;
    @Autowired AppUserRepository users;
    @Autowired IdentityWorkflow identity;
    @Autowired PersonalWorkspace personal;
    @Autowired TeacherEntitlementService entitlements;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    @MockitoBean PaymentGateway gateway;
    private static final String REQUEST="request_teacher_123";
    private Map<String,Object> session;
    private Map<String,Object> subscription;
    private Map<String,Object> invoice;
    private Map<String,Object> metadata;
    private AppUser teacher;
    private String subId,customer,sessionId;
    private long paidEnd;

    @BeforeEach void configure() {
        when(gateway.configured()).thenReturn(true);when(gateway.mode()).thenReturn("test");
        when(gateway.currentPrice(anyString())).thenAnswer(call->{String id=call.getArgument(0);boolean month=id.equals("price_month");return Map.of("id",id,"active",true,"livemode",false,"type","recurring","billing_scheme","per_unit","unit_amount",month?800:5000,"currency","eur","recurring",Map.of("interval",month?"month":"year","interval_count",1));});
        when(gateway.verifyWebhook(anyString(),anyString())).thenAnswer(call->json.object(call.getArgument(0)));
    }
    private AppUser user(Role role) {
        var user=new AppUser();user.setEmail(UUID.randomUUID()+"@billing.test");user.setName("Billing fixture");user.setPasswordHash("unused-password-hash");user.setRole(role);user.setEmailVerifiedAt(Instant.now());users.saveAndFlush(user);identity.initialize(user);return user;
    }
    private void start() {
        teacher=user(Role.TEACHER);long id=teacher.getId();subId="sub_teacher"+id;customer="cus_teacher"+id;sessionId="cs_teacher"+id;
        long workspace=personal.workspace(teacher);
        metadata=Map.of("billing_owner","teacher","teacher_id",Long.toString(id),"workspace_id",Long.toString(workspace),"request_key",REQUEST);
        session=new LinkedHashMap<>(Map.of("id",sessionId,"url","https://checkout.stripe.com/c/pay/fixture"+id,"livemode",false,"status","open","subscription",subId,"customer",customer,"metadata",metadata));
        when(gateway.teacherCheckout(eq(id),eq(workspace),eq("price_month"),eq(REQUEST),anyString(),anyString())).thenReturn(session);
        when(gateway.currentCheckout(sessionId)).thenAnswer(call->session);
        assertTrue(service.checkout(teacher,new TeacherBillingService.Checkout("month",REQUEST)).containsKey("url"));
        paidEnd=Instant.now().plus(Duration.ofDays(30)).getEpochSecond();
        var item=Map.of("price",Map.of("id","price_month"),"quantity",1,"current_period_start",Instant.now().getEpochSecond(),"current_period_end",paidEnd);
        subscription=new LinkedHashMap<>(Map.of("id",subId,"customer",customer,"livemode",false,"collection_method","charge_automatically","status","active","cancel_at_period_end",false,"metadata",metadata,"items",Map.of("data",List.of(item)),"latest_invoice","in_teacher"+id));
        invoice=new LinkedHashMap<>(Map.of("id","in_teacher"+id,"customer",customer,"livemode",false,"status","open","amount_due",800,"amount_paid",0,"currency","eur","parent",Map.of("subscription_details",Map.of("subscription",subId)),"lines",Map.of("data",List.of(Map.of("pricing",Map.of("price_details",Map.of("price","price_month")),"period",Map.of("start",Instant.now().getEpochSecond(),"end",paidEnd))))));
        when(gateway.currentSubscription(subId)).thenAnswer(call->subscription);
        when(gateway.currentInvoice("in_teacher"+id)).thenAnswer(call->invoice);
    }
    private void event(String id,String type,Map<String,Object> object) {assertTrue(service.webhook(json.write(Map.of("id",id,"type",type,"created",Instant.now().getEpochSecond(),"livemode",false,"data",Map.of("object",object))),"fixture-signature"));}
    @Test void activeSubscriptionAndFailedInvoicesNeverGrantUnpaidTime() {
        start();event("evt_created"+teacher.getId(),"customer.subscription.created",subscription);assertFalse(service.isPro(teacher.getId()));
        event("evt_failed"+teacher.getId(),"invoice.payment_failed",invoice);assertFalse(service.isPro(teacher.getId()));
        var failed=service.paymentHistory(teacher,YearMonth.now(ZoneOffset.UTC).toString());assertEquals("failed",failed.getFirst().status());
        invoice.put("status","paid");invoice.put("amount_paid",800);event("evt_paid"+teacher.getId(),"invoice.paid",invoice);assertTrue(service.isPro(teacher.getId()));
        assertEquals(Instant.ofEpochSecond(paidEnd),time(service.subscription(teacher.getId()).orElseThrow(),"paid_through"));
        assertEquals("month",string(service.subscription(teacher.getId()).orElseThrow(),"billing_period"));
        var history=service.paymentHistory(teacher,YearMonth.now(ZoneOffset.UTC).toString());
        assertEquals(1,history.size());assertEquals("paid",history.getFirst().status());assertEquals(800,history.getFirst().amountPaid());
        assertEquals(1,adminBilling.payments(YearMonth.now(ZoneOffset.UTC).toString()).stream().filter(row->row.userId()==teacher.getId()).count());
        assertTrue(service.paymentHistory(user(Role.TEACHER),"").isEmpty());
        var adminPlan=adminBilling.plans().stream().filter(plan->plan.userId()==teacher.getId()).findFirst().orElseThrow();
        assertEquals("pro",adminPlan.plan());assertEquals("month",adminPlan.period());assertEquals(800L,adminPlan.amountMinor());
    }
    @Test void freePlanAllowsTenTrialAiOperationsAndRejectsTheEleventh() {
        var account=user(Role.TEACHER);
        var scope=new OrgAccess.Scope(personal.workspace(account),account.getId(),Set.of("TEACHER"));
        var description=entitlements.describe(scope);
        assertEquals(10,((TeacherEntitlementService.Limits)description.get("limits")).aiCredits());
        var plans=(Map<?,?>)description.get("plans");
        assertEquals(10,((TeacherEntitlementService.Limits)plans.get("free")).aiCredits());
        assertEquals(100,((TeacherEntitlementService.Limits)plans.get("pro")).aiCredits());
        assertThrows(WorkspaceError.class,()->entitlements.requireAutomaticGrading(scope));
        for(int index=0;index<10;index++) {
            long job=account.getId()*100+index;
            String kind=index<5?"generation":"grading";
            transactions.executeWithoutResult(status->{
                entitlements.reserveAi(scope,kind,job);
                assertTrue(entitlements.settleAi(kind,job,true));
            });
        }
        var exhausted=assertThrows(WorkspaceError.class,()->transactions.executeWithoutResult(status->entitlements.reserveAi(scope,"generation",account.getId()*100+10)));
        assertTrue(exhausted.getReason().contains("„Профил“"));
        assertEquals(10L,((Map<?,?>)entitlements.describe(scope).get("usage")).get("aiCredits"));
        assertFalse(service.isPro(account.getId()));
    }
    @Test void administratorCanOverrideAndRestoreStripePlanWithoutChangingBilling() {
        start();invoice.put("status","paid");invoice.put("amount_paid",800);event("evt_admin_paid"+teacher.getId(),"invoice.paid",invoice);
        var actor=user(Role.ADMIN);
        var original=service.subscription(teacher.getId()).orElseThrow();
        var free=adminBilling.changePlan(actor,teacher.getId(),new TeacherBillingAdminService.PlanEdit("free","override_free_123"));
        assertEquals("free",free.plan());assertEquals("free",free.manualPlan());assertEquals(10,free.limits().aiCredits());
        assertFalse(service.isPro(teacher.getId()));assertEquals("free",service.describe(teacher).get("plan"));
        assertEquals(original,service.subscription(teacher.getId()).orElseThrow());
        event("evt_admin_updated"+teacher.getId(),"customer.subscription.updated",subscription);
        assertFalse(service.isPro(teacher.getId()));
        var automatic=adminBilling.changePlan(actor,teacher.getId(),new TeacherBillingAdminService.PlanEdit("auto","override_auto_123"));
        assertEquals("pro",automatic.plan());assertNull(automatic.manualPlan());assertTrue(service.isPro(teacher.getId()));
        var unpaid=user(Role.TEACHER);
        var granted=adminBilling.changePlan(actor,unpaid.getId(),new TeacherBillingAdminService.PlanEdit("pro","override_grant_123"));
        assertEquals("pro",granted.plan());assertNull(granted.paidThrough());assertEquals(100,granted.limits().aiCredits());
        assertEquals("pro",service.describe(unpaid).get("manualPlan"));assertEquals(false,service.describe(unpaid).get("checkoutAvailable"));
        assertTrue(service.subscription(unpaid.getId()).isEmpty());
        var scope=new OrgAccess.Scope(personal.workspace(unpaid),unpaid.getId(),Set.of("TEACHER"));
        assertDoesNotThrow(()->entitlements.requireAutomaticGrading(scope));
        assertEquals(100,((TeacherEntitlementService.Limits)entitlements.describe(scope).get("limits")).aiCredits());
        adminBilling.changePlan(actor,unpaid.getId(),new TeacherBillingAdminService.PlanEdit("auto","override_restore_123"));
        assertFalse(service.isPro(unpaid.getId()));
        assertThrows(WorkspaceError.class,()->entitlements.requireAutomaticGrading(scope));
        assertThrows(WorkspaceError.class,()->adminBilling.changePlan(actor,unpaid.getId(),new TeacherBillingAdminService.PlanEdit("free","override_grant_123")));
        verify(gateway,never()).cancelAtPeriodEnd(anyString());
        verify(gateway,times(1)).teacherCheckout(anyLong(),anyLong(),anyString(),anyString(),anyString(),anyString());
    }

    @Test void resetPreservesReservationsResourcesOtherUsersAndHistoryAndReplaysOnlyOnce() throws Exception {
        var actor=user(Role.ADMIN);var owner=user(Role.TEACHER);var other=user(Role.TEACHER);
        long workspace=personal.workspace(owner),id=owner.getId();
        var scope=new OrgAccess.Scope(workspace,id,Set.of("TEACHER"));
        long group=db.insert("INSERT INTO learning_groups(organization_id,name,description,subject,created_at) VALUES(?,'Fixture','','',?)",workspace,Instant.now());
        db.update("INSERT INTO group_teachers(organization_id,group_id,user_id) VALUES(?,?,?)",workspace,group,id);
        long test=db.insert("INSERT INTO workspace_assessments(organization_id,owner_id,title,definition_json,public_number,updated_at) VALUES(?,?,'Fixture','{}',?,?)",workspace,id,Long.toString(id+10000),Instant.now());
        long version=db.insert("INSERT INTO assessment_versions(organization_id,assessment_id,version_number,title,definition_json,published_at) VALUES(?,?,1,'Fixture','{}',?)",workspace,test,Instant.now());
        db.update("INSERT INTO exam_assignments(organization_id,version_id,teacher_id,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?)",workspace,version,id,Instant.now().minusSeconds(60),Instant.now().plusSeconds(3600),Instant.now());
        for(long job=1;job<=3;job++) db.update("INSERT INTO teacher_ai_credits(job_kind,job_id,user_id,quota_period,status,updated_at) VALUES('generation',?,?,'trial',?,?)",id*100+job,id,job==3?"reserved":"used",Instant.now());
        db.update("INSERT INTO teacher_ai_credits(job_kind,job_id,user_id,quota_period,status,updated_at) VALUES('generation',?,?,'trial','used',?)",other.getId()*100,other.getId(),Instant.now());
        String month=YearMonth.now(ZoneOffset.UTC).toString();
        db.update("INSERT INTO teacher_ai_credits(job_kind,job_id,user_id,quota_period,status,updated_at) VALUES('generation',?,?,?,'used',?)",id*100+4,id,month,Instant.now());
        var before=adminBilling.plans().stream().filter(plan->plan.userId()==id).findFirst().orElseThrow();
        assertEquals(1,before.usage().groups());assertEquals(1,before.usage().activeAssignments());assertEquals(3,before.usage().aiCredits());assertEquals(1,before.reservedAiCredits());
        var request=new TeacherBillingAdminService.ResetAi("trial","reset_credits_123");
        try(var pool=Executors.newFixedThreadPool(2)) {
            for(var result:pool.invokeAll(List.<Callable<TeacherBillingAdminService.TeacherPlan>>of(()->adminBilling.resetAi(actor,id,request),()->adminBilling.resetAi(actor,id,request)))) assertEquals(1,result.get().usage().aiCredits());
        }
        assertEquals(2,db.count("SELECT COUNT(*) FROM teacher_ai_credits WHERE user_id=? AND status='reset'",id));
        assertEquals(1,db.count("SELECT COUNT(*) FROM admin_audit WHERE target_user_id=? AND action='TEACHER_AI_RESET'",id));
        assertEquals(1,db.count("SELECT COUNT(*) FROM teacher_ai_credits WHERE user_id=? AND quota_period=? AND status='used'",id,month));
        var monthReset=new TeacherBillingAdminService.ResetAi(month,"reset_month_123");
        adminBilling.resetAi(actor,id,monthReset);
        assertEquals(0,db.count("SELECT COUNT(*) FROM teacher_ai_credits WHERE user_id=? AND quota_period=? AND status='used'",id,month));
        assertEquals(1,db.count("SELECT COUNT(*) FROM teacher_ai_credits WHERE user_id=? AND quota_period=? AND status='reset'",id,month));
        transactions.executeWithoutResult(status->{entitlements.lockAi("generation",id*100+3);entitlements.settleAi("generation",id*100+3,true);});
        // A retry of the old request must not erase newly completed work.
        assertEquals(1,adminBilling.resetAi(actor,id,request).usage().aiCredits());
        assertEquals(1L,((Map<?,?>)entitlements.describe(scope).get("usage")).get("groups"));
        assertEquals(1,db.count("SELECT COUNT(*) FROM exam_assignments WHERE teacher_id=?",id));
        assertEquals(1,db.count("SELECT COUNT(*) FROM teacher_ai_credits WHERE user_id=? AND status='used'",other.getId()));
        assertThrows(WorkspaceError.class,()->adminBilling.resetAi(actor,id,new TeacherBillingAdminService.ResetAi(month,request.requestKey())));
    }

    @Test void adminMutationsRejectNonAdministratorsNonTeachersAndInvalidInputs() {
        var actor=user(Role.ADMIN);var owner=user(Role.TEACHER);var student=user(Role.STUDENT);
        var request=new TeacherBillingAdminService.ResetAi("trial","reset_secure_123");
        assertEquals(403,assertThrows(WorkspaceError.class,()->adminBilling.resetAi(owner,owner.getId(),request)).getStatusCode().value());
        assertEquals(403,assertThrows(WorkspaceError.class,()->adminBilling.changePlan(student,owner.getId(),new TeacherBillingAdminService.PlanEdit("pro","plan_secure_123"))).getStatusCode().value());
        actor.setActive(false);users.saveAndFlush(actor);
        assertThrows(WorkspaceError.class,()->adminBilling.resetAi(actor,owner.getId(),request));
        actor.setActive(true);users.saveAndFlush(actor);
        assertThrows(WorkspaceError.class,()->adminBilling.resetAi(actor,student.getId(),request));
        assertThrows(WorkspaceError.class,()->adminBilling.resetAi(actor,owner.getId(),new TeacherBillingAdminService.ResetAi("2026-13","reset_invalid_123")));
        assertThrows(WorkspaceError.class,()->adminBilling.resetAi(actor,owner.getId(),new TeacherBillingAdminService.ResetAi("trial","short")));
        assertFalse(service.isPro(owner.getId()));
    }
    @Test void checkoutRejectsPricesThatDoNotMatchPublishedEurPlans() {
        AppUser account=user(Role.TEACHER);
        when(gateway.currentPrice("price_month")).thenReturn(Map.of("id","price_month","active",true,"livemode",false,"type","recurring","billing_scheme","per_unit","unit_amount",700,"currency","eur","recurring",Map.of("interval","month","interval_count",1)));
        assertThrows(WorkspaceError.class,()->service.checkout(account,new TeacherBillingService.Checkout("month",REQUEST)));
        verify(gateway,never()).teacherCheckout(anyLong(),anyLong(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void publishesEightEuroMonthlyPriceAndDoesNotSellAnnualSubscriptions() {
        var account=user(Role.TEACHER);var state=service.describe(account);
        var prices=(Map<?,?>)state.get("prices");
        assertEquals(800L,((Map<?,?>)prices.get("month")).get("amountMinor"));
        assertEquals(false,((Map<?,?>)prices.get("year")).get("available"));
        assertThrows(WorkspaceError.class,()->service.checkout(account,new TeacherBillingService.Checkout("year",REQUEST)));
        verify(gateway,never()).currentPrice("price_year");
        verify(gateway,never()).teacherCheckout(anyLong(),anyLong(),anyString(),anyString(),anyString(),anyString());
        when(gateway.configured()).thenReturn(false);
        var unconfigured=(Map<?,?>)((Map<?,?>)service.describe(account).get("prices")).get("month");
        assertEquals(800L,unconfigured.get("amountMinor"));assertEquals(false,unconfigured.get("available"));
    }
    @Test void cancellationStopsRenewalPreservesPaidAccessAndRepeatsSafely() throws Exception {
        start();invoice.put("status","paid");event("evt_cancelpaid"+teacher.getId(),"invoice.paid",invoice);
        when(gateway.cancelAtPeriodEnd(subId)).thenAnswer(call->{subscription.put("cancel_at_period_end",true);return subscription;});
        try(var pool=Executors.newFixedThreadPool(2)) {
            var results=pool.invokeAll(List.<Callable<TeacherBillingService.Cancellation>>of(()->service.cancel(teacher),()->service.cancel(teacher)));
            for(var result:results) {assertTrue(result.get().cancelAtPeriodEnd());assertEquals(Instant.ofEpochSecond(paidEnd),result.get().paidThrough());}
        }
        verify(gateway,times(1)).cancelAtPeriodEnd(subId);
        assertTrue(service.isPro(teacher.getId()));
        assertTrue(flag(service.subscription(teacher.getId()).orElseThrow(),"cancel_at_period_end"));
        assertEquals(false,service.describe(teacher).get("cancellationAvailable"));
        db.update("UPDATE teacher_billing_accounts SET paid_through=? WHERE user_id=?",Instant.now().minusSeconds(1),teacher.getId());
        assertFalse(service.isPro(teacher.getId()));
    }
    @Test void cancellationRejectsAnotherCustomerOwnerAndStripeMode() {
        start();event("evt_cancelbound"+teacher.getId(),"customer.subscription.created",subscription);
        subscription.put("customer","cus_other");assertThrows(WorkspaceError.class,()->service.cancel(teacher));
        subscription.put("customer",customer);subscription.put("metadata",Map.of("billing_owner","teacher","teacher_id","999999","workspace_id",metadata.get("workspace_id"),"request_key",REQUEST));
        assertThrows(WorkspaceError.class,()->service.cancel(teacher));
        subscription.put("metadata",metadata);subscription.put("livemode",true);assertThrows(WorkspaceError.class,()->service.cancel(teacher));
        assertThrows(WorkspaceError.class,()->service.cancel(user(Role.STUDENT)));
        assertThrows(WorkspaceError.class,()->service.cancel(user(Role.ADMIN)));
        assertThrows(WorkspaceError.class,()->service.cancel(user(Role.TEACHER)));
        verify(gateway,never()).cancelAtPeriodEnd(anyString());
        assertFalse(flag(service.subscription(teacher.getId()).orElseThrow(),"cancel_at_period_end"));
    }
    @Test void cancellationFailureOrUnverifiedReplyNeverChangesLocalSubscription() {
        start();event("evt_cancelfailure"+teacher.getId(),"customer.subscription.created",subscription);
        when(gateway.cancelAtPeriodEnd(subId)).thenThrow(new PaymentGateway.Unavailable());
        assertThrows(PaymentGateway.Unavailable.class,()->service.cancel(teacher));
        assertFalse(flag(service.subscription(teacher.getId()).orElseThrow(),"cancel_at_period_end"));
        doReturn(subscription).when(gateway).cancelAtPeriodEnd(subId);
        assertThrows(WorkspaceError.class,()->service.cancel(teacher));
        var foreign=new LinkedHashMap<>(subscription);foreign.put("cancel_at_period_end",true);foreign.put("customer","cus_other");
        when(gateway.cancelAtPeriodEnd(subId)).thenReturn(foreign);
        assertThrows(WorkspaceError.class,()->service.cancel(teacher));
        assertFalse(flag(service.subscription(teacher.getId()).orElseThrow(),"cancel_at_period_end"));
    }
    @Test void duplicateAndReorderedEventsUseCurrentStateAndCancellationPreservesOnlyPaidInterval() {
        start();invoice.put("status","paid");String id="evt_paid"+teacher.getId();event(id,"invoice.paid",invoice);event(id,"invoice.paid",invoice);
        assertEquals(1,db.count("SELECT COUNT(*) FROM teacher_billing_events WHERE event_id=?",id));
        subscription.put("status","canceled");subscription.put("cancel_at_period_end",true);invoice.put("status","open");
        var items=Map.of("data",List.of(Map.of("price",Map.of("id","price_month"),"quantity",1,"current_period_end",paidEnd+30*86400L)));
        subscription.put("items",items);event("evt_late"+teacher.getId(),"customer.subscription.created",subscription);
        var account=service.subscription(teacher.getId()).orElseThrow();assertEquals("canceled",string(account,"provider_status"));assertEquals(Instant.ofEpochSecond(paidEnd),time(account,"paid_through"));assertTrue(service.isPro(teacher.getId()));
        db.update("UPDATE teacher_billing_accounts SET paid_through=? WHERE user_id=?",Instant.now().minusSeconds(1),teacher.getId());assertFalse(service.isPro(teacher.getId()));
    }
    @Test void incorrectWorkspacePriceCustomerAndModeCannotActivateSubscription() {
        start();invoice.put("status","paid");var original=metadata;
        subscription.put("metadata",Map.of("billing_owner","teacher","teacher_id",teacher.getId().toString(),"workspace_id","999999","request_key",REQUEST));
        assertThrows(WorkspaceError.class,()->event("evt_badworkspace"+teacher.getId(),"customer.subscription.updated",subscription));assertFalse(service.isPro(teacher.getId()));
        subscription.put("metadata",original);subscription.put("items",Map.of("data",List.of(Map.of("price",Map.of("id","price_other"),"quantity",1))));
        assertThrows(WorkspaceError.class,()->event("evt_badprice"+teacher.getId(),"customer.subscription.updated",subscription));assertFalse(service.isPro(teacher.getId()));
        subscription.put("items",Map.of("data",List.of(Map.of("price",Map.of("id","price_month"),"quantity",1))));subscription.put("livemode",true);
        assertThrows(WorkspaceError.class,()->event("evt_badmode"+teacher.getId(),"customer.subscription.updated",subscription));assertFalse(service.isPro(teacher.getId()));
        subscription.put("livemode",false);invoice.put("customer","cus_other");assertThrows(WorkspaceError.class,()->event("evt_badcustomer"+teacher.getId(),"invoice.paid",invoice));assertFalse(service.isPro(teacher.getId()));
    }
    @Test void duplicateAndParallelCheckoutRequestsCreateOneProviderSession() throws Exception {
        start();try(var pool=Executors.newFixedThreadPool(2)) {
            var results=pool.invokeAll(List.<Callable<Map<String,Object>>>of(()->service.checkout(teacher,new TeacherBillingService.Checkout("month",REQUEST)),()->service.checkout(teacher,new TeacherBillingService.Checkout("month",REQUEST))));
            for(var result:results) assertEquals(session.get("url"),result.get().get("url"));
        }
        verify(gateway,times(1)).teacherCheckout(eq(teacher.getId()),anyLong(),eq("price_month"),eq(REQUEST),anyString(),anyString());
        assertThrows(WorkspaceError.class,()->service.checkout(teacher,new TeacherBillingService.Checkout("year","another_request")));
    }
    @Test void providerTimeoutCanBeRecoveredWithTheOriginalStripeIdempotencyKey() {
        start();db.update("UPDATE teacher_checkout_requests SET session_id=NULL,checkout_url=NULL WHERE user_id=?",teacher.getId());
        when(gateway.teacherCheckout(eq(teacher.getId()),anyLong(),anyString(),eq(REQUEST),anyString(),anyString())).thenThrow(new PaymentGateway.Unavailable());
        assertThrows(PaymentGateway.Unavailable.class,()->service.checkout(teacher,new TeacherBillingService.Checkout("month",REQUEST)));
        assertEquals(1,db.count("SELECT COUNT(*) FROM teacher_checkout_requests WHERE user_id=? AND status='pending'",teacher.getId()));
        when(gateway.teacherCheckout(eq(teacher.getId()),anyLong(),eq("price_month"),eq(REQUEST),anyString(),anyString())).thenReturn(session);
        assertEquals(session.get("url"),service.checkout(teacher,new TeacherBillingService.Checkout("month","different_request")).get("url"));
        assertEquals(1,db.count("SELECT COUNT(*) FROM teacher_checkout_requests WHERE user_id=? AND status='pending'",teacher.getId()));
        assertEquals(0,db.count("SELECT COUNT(*) FROM teacher_checkout_requests WHERE user_id=? AND request_key='different_request'",teacher.getId()));
        verify(gateway,times(3)).teacherCheckout(eq(teacher.getId()),anyLong(),eq("price_month"),eq(REQUEST),anyString(),anyString());
    }
    @Test void studentsCannotCheckoutOrUsePortalAndCustomerIsServerOwned() {
        var student=user(Role.STUDENT);assertThrows(WorkspaceError.class,()->service.describe(student));assertThrows(WorkspaceError.class,()->service.checkout(student,new TeacherBillingService.Checkout("month",REQUEST)));assertThrows(WorkspaceError.class,()->service.portal(student));
        start();invoice.put("status","paid");event("evt_paidportal"+teacher.getId(),"invoice.paid",invoice);
        when(gateway.portal(eq(customer),eq("http://localhost:5173/billing"))).thenReturn(Map.of("url","https://billing.stripe.com/p/session/fixture"));
        assertEquals("https://billing.stripe.com/p/session/fixture",service.portal(teacher).get("url"));
        when(gateway.portal(anyString(),anyString())).thenReturn(Map.of("url","https://attacker.example/payment"));assertThrows(WorkspaceError.class,()->service.portal(teacher));
    }
    @Test void missingConfigurationAndInvalidPriceKeepCheckoutUnavailable() {
        var user=user(Role.TEACHER);when(gateway.configured()).thenReturn(false);var state=service.describe(user);assertEquals("unconfigured",state.get("mode"));assertEquals(false,state.get("checkoutAvailable"));assertEquals("free",state.get("plan"));
        assertThrows(WorkspaceError.class,()->service.checkout(user,new TeacherBillingService.Checkout("month",REQUEST)));verify(gateway,never()).teacherCheckout(anyLong(),anyLong(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void stripeModeMustMatchKeyAndSignedEvent() throws Exception {
        assertThrows(IllegalStateException.class,()->new StripeTestGateway(json,"sk_live_fixture","whsec_fixture","test"));
        String timestamp=Long.toString(Instant.now().getEpochSecond()),secret="whsec_mode_fixture";
        String body="{\"id\":\"evt_fixture\",\"object\":\"event\",\"created\":"+timestamp+",\"livemode\":true,\"type\":\"invoice.paid\",\"data\":{\"object\":{\"id\":\"in_fixture\",\"object\":\"invoice\"}}}";
        var mac=javax.crypto.Mac.getInstance("HmacSHA256");mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8),"HmacSHA256"));
        String signature="t="+timestamp+",v1="+HexFormat.of().formatHex(mac.doFinal((timestamp+"."+body).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        assertThrows(WorkspaceError.class,()->new StripeTestGateway(json,"sk_test_fixture",secret,"test").verifyWebhook(body,signature));
        assertEquals("evt_fixture",string(new StripeTestGateway(json,"sk_live_fixture",secret,"live").verifyWebhook(body,signature),"id"));
    }
}
