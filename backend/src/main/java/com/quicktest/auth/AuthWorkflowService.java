package com.quicktest.auth;

import com.quicktest.workspace.IdentityRateLimiter;
import com.quicktest.workspace.IdentityWorkflow;
import org.springframework.stereotype.Service;

@Service
public class AuthWorkflowService {
    private final AuthService auth;
    private final IdentityWorkflow identity;
    private final IdentityRateLimiter limiter;

    public AuthWorkflowService(AuthService auth, IdentityWorkflow identity, IdentityRateLimiter limiter) {
        this.auth = auth;
        this.identity = identity;
        this.limiter = limiter;
    }

    public AuthService.AuthResponse register(AuthService.RegisterRequest request, String remoteAddress) {
        limiter.check("register", request.email(), remoteAddress);
        var response = auth.register(request);
        identity.registration(auth.requireUser("Bearer " + response.token()));
        return response;
    }

    public AuthService.AuthResponse login(AuthService.LoginRequest request, String remoteAddress) {
        limiter.check("login", request.email(), remoteAddress);
        return auth.login(request);
    }

    public AuthService.UserResponse me(String authorization) {
        return auth.toResponse(auth.requireUser(authorization));
    }

    public AuthService.UserResponse selectRole(String authorization, AuthService.SelectRoleRequest request) {
        return auth.selectRole(auth.requireUser(authorization).getId(), request);
    }

    public void logout(String authorization) {
        auth.logout(authorization);
    }

    public void logoutAll(String authorization) {
        auth.logoutAll(authorization);
    }

    public AuthService.AuthResponse changePassword(String authorization, AuthService.ChangePasswordRequest request) {
        return auth.changePassword(auth.requireUser(authorization), request);
    }

    public void recover(String email, String remoteAddress) {
        limiter.check("recover", email, remoteAddress);
        identity.recover(email);
    }

    public void reset(String token, String password, String remoteAddress) {
        limiter.check("reset", token, remoteAddress);
        identity.reset(token, password);
    }
}
