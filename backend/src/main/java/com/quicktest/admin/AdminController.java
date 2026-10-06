package com.quicktest.admin;

import com.quicktest.access.EndpointPolicy;
import com.quicktest.auth.AuthService;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/admin")
@EndpointPolicy(mode = EndpointPolicy.Mode.ADMIN)
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {
    private final AdminService admin;
    private final AuthService auth;

    public AdminController(AdminService admin, AuthService auth) { this.admin = admin; this.auth = auth; }

    @GetMapping("/users")
    public List<AuthService.UserResponse> users() { return admin.users(); }

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

    @PostMapping("/users/{id}/reset-password")
    public AdminService.PasswordResponse resetPassword(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        return admin.resetPassword(auth.requireUser(authorization), id);
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
