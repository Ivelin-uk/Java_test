package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class BillingRepository {
    private final WorkspaceStore store;

    public BillingRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Optional<Map<String, Object>> findSubscriptionBinding(long organizationId) {
        return store.optional("SELECT subscription_id FROM stripe_subscription_bindings WHERE organization_id=?", organizationId);
    }

    public Map<String, Object> requirePlanPrice(long planId, String period) {
        return store.one("SELECT stripe_price_id FROM organization_plan_prices WHERE plan_id=? AND billing_period=?", planId, period);
    }

    public Optional<Map<String, Object>> findCheckoutForUpdate(String requestKey) {
        return store.optional("SELECT * FROM stripe_checkout_requests WHERE request_key=? FOR UPDATE", requestKey);
    }

    public int insertCheckout(String requestKey, long organizationId, long planId, String period, Instant timestamp) {
        return store.update("INSERT INTO stripe_checkout_requests(request_key,organization_id,plan_id,billing_period,created_at) VALUES(?,?,?,?,?)", requestKey, organizationId, planId, period, timestamp);
    }

    public int saveCheckoutSession(String id, String requestKey) {
        return store.update("UPDATE stripe_checkout_requests SET session_id=? WHERE request_key=?", id, requestKey);
    }

    public Map<String, Object> requireCheckout(String requestKey) {
        return store.one("SELECT * FROM stripe_checkout_requests WHERE request_key=?", requestKey);
    }

    public long countEvents(String id) {
        return store.count("SELECT COUNT(*) FROM workspace_billing_events WHERE event_id=?", id);
    }

    public Optional<Map<String, Object>> findBinding(long org) {
        return store.optional("SELECT * FROM stripe_subscription_bindings WHERE organization_id=?", org);
    }

    public Map<String, Object> requirePlanForPrice(String id) {
        return store.one("SELECT plan_id FROM organization_plan_prices WHERE stripe_price_id=?", id);
    }

    public int insertBinding(long org, String id, String customer, long created) {
        return store.update("INSERT INTO stripe_subscription_bindings(organization_id,subscription_id,customer_id,latest_event_created) VALUES(?,?,?,?)", org, id, customer, created);
    }

    public int updateBindingTimestamp(long value, long org) {
        return store.update("UPDATE stripe_subscription_bindings SET latest_event_created=? WHERE organization_id=?", value, org);
    }

    public long latestAppliedTimestamp(long org, String provider) {
        return store.count("SELECT COALESCE(MAX(provider_timestamp),0) FROM workspace_billing_events WHERE organization_id=? AND provider=? AND status='applied'", org, provider);
    }

    public int insertEvent(String eventId, long org, String provider, long timestamp, Object value, Instant timestamp2) {
        return store.update("INSERT INTO workspace_billing_events(event_id,organization_id,provider,provider_timestamp,status,created_at) VALUES(?,?,?,?,?,?)", eventId, org, provider, timestamp, value, timestamp2);
    }

    public Map<String, Object> requireSubscription(long org) {
        return store.one("SELECT * FROM organization_subscriptions WHERE organization_id=?", org);
    }

    public int updateSubscription(long planId, String status, Instant periodStart, Instant through, boolean cancelAtPeriodEnd, long value, long org) {
        return store.update("UPDATE organization_subscriptions SET plan_id=?,status=?,period_start=?,paid_through=?,cancel_at_period_end=?,ai_used=? WHERE organization_id=?", planId, status, periodStart, through, cancelAtPeriodEnd, value, org);
    }

    public Map<String, Object> requireCustomer(long organizationId) {
        return store.one("SELECT customer_id FROM stripe_subscription_bindings WHERE organization_id=?", organizationId);
    }
}
