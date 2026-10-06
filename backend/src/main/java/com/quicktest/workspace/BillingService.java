package com.quicktest.workspace;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class BillingService {
    private final WorkspaceStore db;private final PaymentGateway gateway;private final WorkspaceAudit audit;
    private final OrganizationService organizations;private final Clock clock;private final String frontend;private final boolean fixtures;
    public BillingService(WorkspaceStore db,PaymentGateway gateway,WorkspaceAudit audit,Clock clock,OrganizationService organizations,@Value("${app.frontend-url}") String frontend,@Value("${app.billing.fixtures:false}") boolean fixtures) {this.organizations=organizations;this.db=db;this.gateway=gateway;this.audit=audit;this.clock=clock;this.frontend=frontend;this.fixtures=fixtures;}
    @Transactional
    public Map<String,Object> checkout(OrgAccess.Scope scope,Checkout request) {
        if(request.requestKey()==null || !request.requestKey().matches("[A-Za-z0-9_-]{8,80}") || !Set.of("month","year").contains(request.period())) throw WorkspaceError.validation("Невалидна checkout заявка.");
        organizations.lockQuota(scope.organizationId());
        var binding=db.optional("SELECT subscription_id FROM stripe_subscription_bindings WHERE organization_id=?",scope.organizationId());
        if(binding.isPresent()) throw WorkspaceError.conflict("Организацията вече има Stripe абонамент; промяната на план се управлява през доставчика.");
        String price=string(db.one("SELECT stripe_price_id FROM organization_plan_prices WHERE plan_id=? AND billing_period=?",request.planId(),request.period()),"stripe_price_id");
        var previous=db.optional("SELECT * FROM stripe_checkout_requests WHERE request_key=? FOR UPDATE",request.requestKey());
        if(previous.isPresent() && (number(previous.get(),"organization_id")!=scope.organizationId() || number(previous.get(),"plan_id")!=request.planId() || !string(previous.get(),"billing_period").equals(request.period()))) throw WorkspaceError.conflict("Ключът вече е използван за друго плащане.");
        if(previous.isEmpty()) db.update("INSERT INTO stripe_checkout_requests(request_key,organization_id,plan_id,billing_period,created_at) VALUES(?,?,?,?,?)",request.requestKey(),scope.organizationId(),request.planId(),request.period(),clock.instant());
        var session=gateway.checkout(scope.organizationId(),price,request.requestKey(),frontend);
        if(flag(session,"livemode")) throw WorkspaceError.forbidden();
        db.update("UPDATE stripe_checkout_requests SET session_id=? WHERE request_key=?",string(session,"id"),request.requestKey());
        audit.write(scope.organizationId(),scope.userId(),"billing.checkout_created",null,Map.of("plan",request.planId(),"period",request.period()));
        return Map.of("url",string(session,"url"),"mode","stripe_test");
    }
    @Transactional
    public void webhook(String body,String signature) {
        if(body.length()>1_000_000) throw WorkspaceError.validation("Събитието е твърде голямо.");
        var event=gateway.verifyWebhook(body,signature);String type=string(event,"type");
        if(!Set.of("customer.subscription.created","customer.subscription.updated","customer.subscription.deleted").contains(type)) return;
        var object=db.object(db.json(db.object(db.json(event.get("data"))).get("object")));
        var metadata=db.object(db.json(object.get("metadata")));String requestKey=string(metadata,"request_key");
        var request=db.one("SELECT * FROM stripe_checkout_requests WHERE request_key=?",requestKey);long org=number(request,"organization_id");
        if(!string(metadata,"organization_id").equals(Long.toString(org))) throw WorkspaceError.forbidden();
        organizations.lockQuota(org);
        if(db.count("SELECT COUNT(*) FROM workspace_billing_events WHERE event_id=?",string(event,"id"))>0) return;
        var binding=db.optional("SELECT * FROM stripe_subscription_bindings WHERE organization_id=?",org);
        if(binding.isPresent() && !string(binding.get(),"subscription_id").equals(string(object,"id"))) throw WorkspaceError.forbidden();
        // Fetch inside the organization lock: event ordering cannot overwrite a newer
        // provider state with an older payload, including events created in the same second.
        var current=gateway.currentSubscription(string(object,"id"));
        if(flag(current,"livemode") || !string(current,"collection_method").equals("charge_automatically")) throw WorkspaceError.forbidden();
        var item=subscriptionItem(current);var price=db.object(db.json(item.get("price")));
        var plan=db.one("SELECT plan_id FROM organization_plan_prices WHERE stripe_price_id=?",string(price,"id"));
        String providerStatus=string(current,"status");String status=switch(providerStatus) {case "active"->"active";case "trialing"->"trialing";case "canceled"->"canceled";case "incomplete_expired"->"expired";default->"past_due";};
        var snapshot=new Snapshot(number(plan,"plan_id"),status,Instant.ofEpochSecond(number(item,"current_period_start")),Instant.ofEpochSecond(number(item,"current_period_end")),flag(current,"cancel_at_period_end"));
        apply(org,string(event,"id"),number(event,"created"),"stripe_test",snapshot,false);
        if(binding.isEmpty()) db.update("INSERT INTO stripe_subscription_bindings(organization_id,subscription_id,customer_id,latest_event_created) VALUES(?,?,?,?)",org,string(current,"id"),string(current,"customer"),number(event,"created"));
        else db.update("UPDATE stripe_subscription_bindings SET latest_event_created=? WHERE organization_id=?",Math.max(number(event,"created"),number(binding.get(),"latest_event_created")),org);
    }
    @SuppressWarnings("unchecked") private Map<String,Object> subscriptionItem(Map<String,Object> subscription) {
        var items=db.object(db.json(subscription.get("items")));var data=(List<Map<String,Object>>)items.get("data");
        if(data==null || data.size()!=1) throw WorkspaceError.validation("Очаква се един организационен план.");return data.getFirst();
    }
    private void apply(long org,String eventId,long timestamp,String provider,Snapshot snapshot,boolean orderedFixtures) {
        if(db.count("SELECT COUNT(*) FROM workspace_billing_events WHERE event_id=?",eventId)>0) return;
        long previous=db.count("SELECT COALESCE(MAX(provider_timestamp),0) FROM workspace_billing_events WHERE organization_id=? AND provider=? AND status='applied'",org,provider);
        boolean stale=orderedFixtures && timestamp<previous;
        db.update("INSERT INTO workspace_billing_events(event_id,organization_id,provider,provider_timestamp,status,created_at) VALUES(?,?,?,?,?,?)",eventId,org,provider,timestamp,stale?"ignored_stale":"applied",clock.instant());
        if(stale) return;
        var old=db.one("SELECT * FROM organization_subscriptions WHERE organization_id=?",org);
        boolean newPeriod=snapshot.periodStart().isAfter(time(old,"period_start"));
        // Cancellation retains the previously paid interval; delinquency does not grant one.
        Instant through=snapshot.status().equals("canceled") && time(old,"paid_through").isAfter(snapshot.paidThrough())?time(old,"paid_through"):snapshot.paidThrough();
        db.update("UPDATE organization_subscriptions SET plan_id=?,status=?,period_start=?,paid_through=?,cancel_at_period_end=?,ai_used=? WHERE organization_id=?",snapshot.planId(),snapshot.status(),snapshot.periodStart(),through,snapshot.cancelAtPeriodEnd(),newPeriod?0:number(old,"ai_used"),org);
    }
    @Transactional
    public void fixture(long actor,long org,Fixture fixture) {
        if(!fixtures || gateway.configured()) throw WorkspaceError.forbidden();
        if(fixture.eventId()==null || fixture.eventId().length()>190 || fixture.snapshot()==null || !Set.of("active","trialing","past_due","canceled","expired").contains(fixture.snapshot().status()) || fixture.snapshot().periodStart()==null || fixture.snapshot().paidThrough()==null) throw WorkspaceError.validation("Невалидна тестова доставка.");
        organizations.lockQuota(org);
        apply(org,fixture.eventId(),fixture.providerTimestamp(),"local_fixture",fixture.snapshot(),true);
        audit.write(org,actor,"billing.local_fixture",null,Map.of("event",fixture.eventId(),"status",fixture.snapshot().status()));
    }
    public Map<String,Object> configuration() {return Map.of("mode",gateway.configured()?"stripe_test":"unconfigured","fixtures",fixtures && !gateway.configured());}
    public Map<String,Object> portal(OrgAccess.Scope scope) {var binding=db.one("SELECT customer_id FROM stripe_subscription_bindings WHERE organization_id=?",scope.organizationId());var session=gateway.portal(string(binding,"customer_id"),frontend);if(flag(session,"livemode")) throw WorkspaceError.forbidden();audit.write(scope.organizationId(),scope.userId(),"billing.portal_opened",null,Map.of());return Map.of("url",string(session,"url"),"mode","stripe_test");}
    public record Checkout(long planId,String period,String requestKey) {}
    public record Snapshot(long planId,String status,Instant periodStart,Instant paidThrough,boolean cancelAtPeriodEnd) {}
    public record Fixture(String eventId,long providerTimestamp,Snapshot snapshot) {}
}
