package com.quicktest.admin;

import com.quicktest.access.EndpointPolicy;
import com.quicktest.auth.AuthService;
import com.quicktest.workspace.TeacherBillingAdminService;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import java.util.List;

@RestController
@RequestMapping("/api/admin")
@EndpointPolicy(mode = EndpointPolicy.Mode.ADMIN)
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {
    private final AdminService admin;
    private final AuthService auth;
    private final TeacherBillingAdminService billing;

    public AdminController(AdminService admin, AuthService auth,TeacherBillingAdminService billing) { this.admin = admin; this.auth = auth;this.billing=billing; }

    @GetMapping("/users")
    public List<AuthService.UserResponse> users() { return admin.users(); }

    @GetMapping("/teacher-billing")
    public List<TeacherBillingAdminService.TeacherPlan> teacherBilling() { return billing.plans(); }

    @PutMapping("/teacher-billing/{id}/plan")
    public TeacherBillingAdminService.TeacherPlan teacherPlan(@RequestHeader("Authorization") String authorization,
            @PathVariable long id,@Valid @RequestBody TeacherBillingAdminService.PlanEdit request) {
        return billing.changePlan(auth.requireUser(authorization),id,request);
    }

    @PostMapping("/teacher-billing/{id}/reset-ai")
    public TeacherBillingAdminService.TeacherPlan resetTeacherAi(@RequestHeader("Authorization") String authorization,
            @PathVariable long id,@Valid @RequestBody TeacherBillingAdminService.ResetAi request) {
        return billing.resetAi(auth.requireUser(authorization),id,request);
    }

    @GetMapping("/teacher-billing/payments")
    public List<com.quicktest.workspace.TeacherBillingService.PaymentRecord> teacherPayments(@RequestParam(required=false) String month) {
        return billing.payments(month);
    }

    @PostMapping("/users")
    public AdminService.PasswordResponse createUser(@RequestHeader("Authorization") String authorization,
                                                    @Valid @RequestBody AdminService.UserEdit request) {
        return admin.create(auth.requireUser(authorization), request);
    }

    @PutMapping("/users/{id}")
    public AuthService.UserResponse updateUser(@RequestHeader("Authorization") String authorization, @PathVariable Long id,
                                               @Valid @RequestBody AdminService.UserEdit request) {
        return admin.update(auth.requireUser(authorization), id, request);
    }

    @PutMapping("/users/{id}/role")
    public AuthService.UserResponse changeRole(@RequestHeader("Authorization") String authorization, @PathVariable Long id,
                                               @Valid @RequestBody AdminService.RoleEdit request) {
        return admin.changeRole(auth.requireUser(authorization), id, request);
    }

    @PostMapping("/users/{id}/reset-password")
    public AdminService.PasswordResponse resetPassword(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        return admin.resetPassword(auth.requireUser(authorization), id);
    }

    @DeleteMapping("/users/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteUser(@RequestHeader("Authorization") String authorization, @PathVariable Long id,
                           @Valid @RequestBody AdminService.DeleteUserRequest request) {
        admin.delete(auth.requireUser(authorization), id, request.password());
    }

    @GetMapping("/permissions")
    public List<AdminService.PermissionRow> permissions() { return admin.matrix(); }

    @PutMapping("/permissions")
    public List<AdminService.PermissionRow> updatePermissions(@RequestHeader("Authorization") String authorization,
                                                             @Valid @RequestBody AdminService.PermissionEdit request) {
        return admin.updatePermissions(auth.requireUser(authorization), request);
    }

    @GetMapping("/audit")
    public List<AdminService.AuditResponse> audit() { return admin.auditLog(); }
}
