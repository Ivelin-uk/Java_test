package com.quicktest.auth;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    AuthService.AuthResponse register(@Valid @RequestBody AuthService.RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    AuthService.AuthResponse login(@Valid @RequestBody AuthService.LoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/me")
    AuthService.UserResponse me(@RequestHeader("Authorization") String authorization) {
        AppUser user = authService.requireUser(authorization);
        return new AuthService.UserResponse(user.getId(), user.getName(), user.getEmail(), user.getRole().name());
    }
}
