package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
public class BillingController {
    private final OrgAccess access;private final BillingService billing;private final WorkspaceStore db;
    public BillingController(OrgAccess access,BillingService billing,WorkspaceStore db) {this.access=access;this.billing=billing;this.db=db;}
    @PostMapping("/api/v1/billing/checkout") @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public Object checkout(@RequestBody BillingService.Checkout request) {return billing.checkout(access.admin(),request);}
    @PostMapping("/api/v1/billing/portal") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,teacher=false,student=false) @PreAuthorize("isAuthenticated()")
    public Object portal() {return billing.portal(access.admin());}
    @GetMapping("/api/v1/billing/config") @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public Object config() {access.scope();return billing.configuration();}
    @PostMapping("/api/v1/billing/webhook") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public void webhook(@RequestBody String body,@RequestHeader("Stripe-Signature") String signature) {billing.webhook(body,signature);}
    @GetMapping("/api/v1/billing/history") @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public Object history() {return db.rows("SELECT event_id,provider,provider_timestamp,status,created_at FROM workspace_billing_events WHERE organization_id=? ORDER BY created_at DESC",access.admin().organizationId());}
    @PostMapping("/api/v1/platform/organizations/{org}/billing-fixtures") @EndpointPolicy(mode=EndpointPolicy.Mode.ADMIN) @PreAuthorize("hasRole('ADMIN')")
    public void fixture(@PathVariable long org,@RequestBody BillingService.Fixture request) {billing.fixture(access.user().getId(),org,request);}
}
