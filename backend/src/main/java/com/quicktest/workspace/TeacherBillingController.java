package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/v1/billing")
@EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE)
public class TeacherBillingController {
    private final OrgAccess access;
    private final TeacherBillingService billing;
    private final TeacherEntitlementService entitlements;
    private final BillingService legacy;
    public TeacherBillingController(OrgAccess access,TeacherBillingService billing,TeacherEntitlementService entitlements,BillingService legacy) {this.access=access;this.billing=billing;this.entitlements=entitlements;this.legacy=legacy;}
    @GetMapping @PreAuthorize("isAuthenticated()")
    public Object get() {var result=new LinkedHashMap<>(billing.describe(access.user()));result.putAll(entitlements.describe(access.teacher()));return result;}
    @PostMapping("/checkout") @PreAuthorize("isAuthenticated()")
    public Object checkout(@Valid @RequestBody TeacherBillingService.Checkout request) {return billing.checkout(access.user(),request);}
    @PostMapping("/portal") @PreAuthorize("isAuthenticated()")
    public Object portal() {return billing.portal(access.user());}
    @PostMapping("/webhook") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public void webhook(@RequestBody String body,@RequestHeader("Stripe-Signature") String signature) {if(!billing.webhook(body,signature)) legacy.webhook(body,signature);}
}
