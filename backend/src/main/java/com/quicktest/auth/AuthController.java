package com.quicktest.auth;

import jakarta.validation.Valid;
import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final com.quicktest.workspace.IdentityWorkflow identity;
    private final com.quicktest.workspace.IdentityRateLimiter limiter;
    private final jakarta.servlet.http.HttpServletRequest http;

    public AuthController(AuthService authService, com.quicktest.workspace.IdentityWorkflow identity, com.quicktest.workspace.IdentityRateLimiter limiter,jakarta.servlet.http.HttpServletRequest http) {
        this.authService = authService;
        this.identity = identity;
        this.limiter=limiter;this.http=http;
    }

    @PostMapping("/register")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public AuthService.AuthResponse register(@Valid @RequestBody AuthService.RegisterRequest request) {
        limiter.check("register",request.email(),http.getRemoteAddr());
        var response = authService.register(request);
        identity.registration(authService.requireUser("Bearer " + response.token()));
        return response;
    }

    @PostMapping("/login")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public AuthService.AuthResponse login(@Valid @RequestBody AuthService.LoginRequest request) {
        limiter.check("login",request.email(),http.getRemoteAddr());
        return authService.login(request);
    }

    @GetMapping("/me")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public AuthService.UserResponse me(@RequestHeader("Authorization") String authorization) {
        AppUser user = authService.requireUser(authorization);
        return authService.toResponse(user);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public void logout(@RequestHeader("Authorization") String authorization) {
        authService.logout(authorization);
    }
    @PostMapping("/logout-all") @ResponseStatus(HttpStatus.NO_CONTENT) @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public void logoutAll(@RequestHeader("Authorization") String authorization) {authService.logoutAll(authorization);}

    @PostMapping("/password")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public AuthService.AuthResponse password(@RequestHeader("Authorization") String authorization,
                                             @Valid @RequestBody AuthService.ChangePasswordRequest request) {
        return authService.changePassword(authService.requireUser(authorization), request);
    }

    @PostMapping("/recover")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public void recover(@Valid @RequestBody RecoverRequest request) {
        limiter.check("recover",request.email(),http.getRemoteAddr());
        identity.recover(request.email());
    }

    @PostMapping("/reset")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public void reset(@RequestBody ResetRequest request) { limiter.check("reset",request.token(),http.getRemoteAddr());identity.reset(request.token(), request.password()); }
    public record ResetRequest(String token, String password) {}
    public record RecoverRequest(@jakarta.validation.constraints.Email @jakarta.validation.constraints.NotBlank String email) {}
}
