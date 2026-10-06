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

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public AuthService.AuthResponse register(@Valid @RequestBody AuthService.RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public AuthService.AuthResponse login(@Valid @RequestBody AuthService.LoginRequest request) {
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

    @PostMapping("/password")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public AuthService.AuthResponse password(@RequestHeader("Authorization") String authorization,
                                             @Valid @RequestBody AuthService.ChangePasswordRequest request) {
        return authService.changePassword(authService.requireUser(authorization), request);
    }
}
