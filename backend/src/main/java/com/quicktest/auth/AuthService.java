package com.quicktest.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.springframework.http.HttpStatus.*;

@Service
public class AuthService {
    private final AppUserRepository users;
    private final AuthTokenRepository tokens;
    private final PasswordEncoder passwordEncoder;

    public AuthService(AppUserRepository users, AuthTokenRepository tokens, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.tokens = tokens;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AuthResponse register(@Valid RegisterRequest request) {
        if (users.existsByEmailIgnoreCase(request.email())) {
            throw new ResponseStatusException(CONFLICT, "Email is already registered");
        }
        AppUser user = new AppUser();
        user.setName(request.name());
        user.setEmail(request.email().toLowerCase());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        users.save(user);
        return issueToken(user);
    }

    @Transactional
    public AuthResponse login(@Valid LoginRequest request) {
        AppUser user = users.findByEmailIgnoreCase(request.email())
                .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Invalid credentials"));
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ResponseStatusException(UNAUTHORIZED, "Invalid credentials");
        }
        return issueToken(user);
    }

    public AppUser requireUser(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
            throw new ResponseStatusException(UNAUTHORIZED, "Missing Bearer token");
        }
        String token = authorizationHeader.substring("Bearer ".length());
        return tokens.findById(token)
                .map(AuthToken::getUser)
                .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Invalid token"));
    }

    private AuthResponse issueToken(AppUser user) {
        AuthToken token = new AuthToken();
        token.setToken(UUID.randomUUID().toString());
        token.setUser(user);
        tokens.save(token);
        return new AuthResponse(token.getToken(), new UserResponse(user.getId(), user.getName(), user.getEmail(), user.getRole().name()));
    }

    public record RegisterRequest(@NotBlank String name, @Email @NotBlank String email, @NotBlank String password) {}
    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}
    public record UserResponse(Long id, String name, String email, String role) {}
    public record AuthResponse(String token, UserResponse user) {}
}
