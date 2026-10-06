package com.quicktest.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import com.quicktest.access.PermissionAccess;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.List;
import java.util.Locale;
import java.nio.charset.StandardCharsets;

import static org.springframework.http.HttpStatus.*;

@Service
public class AuthService {
    private final AppUserRepository users;
    private final AuthTokenRepository tokens;
    private final PasswordEncoder passwordEncoder;
    private final PermissionAccess permissions;
    private final SubscriptionService subscriptions;

    public AuthService(AppUserRepository users, AuthTokenRepository tokens, PasswordEncoder passwordEncoder,
                       PermissionAccess permissions, SubscriptionService subscriptions) {
        this.users = users;
        this.tokens = tokens;
        this.passwordEncoder = passwordEncoder;
        this.permissions = permissions;
        this.subscriptions = subscriptions;
    }

    @Transactional
    public AuthResponse register(@Valid RegisterRequest request) {
        validatePassword(request.password());
        if (users.existsByEmailIgnoreCase(request.email())) {
            throw new ResponseStatusException(CONFLICT, "Email is already registered");
        }
        AppUser user = new AppUser();
        user.setName(request.name().trim());
        user.setEmail(request.email().trim().toLowerCase(Locale.ROOT));
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        users.save(user);
        return issueToken(user);
    }

    @Transactional
    public AuthResponse login(@Valid LoginRequest request) {
        AppUser user = users.findByEmailIgnoreCase(request.email())
                .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Invalid credentials"));
        if (!user.isActive() || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
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
                .filter(session -> session.getCreatedAt() != null && session.getCreatedAt().plus(java.time.Duration.ofHours(24)).isAfter(java.time.Instant.now()))
                .map(AuthToken::getUser)
                .filter(AppUser::isActive)
                .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Invalid token"));
    }

    @Transactional
    public void logout(String authorization) {
        requireUser(authorization);
        tokens.deleteById(authorization.substring("Bearer ".length()));
    }
    @Transactional public void logoutAll(String authorization) {tokens.deleteByUserId(requireUser(authorization).getId());}

    @Transactional
    public AuthResponse changePassword(AppUser user, ChangePasswordRequest request) {
        validatePassword(request.newPassword());
        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw new ResponseStatusException(BAD_REQUEST, "Текущата парола е неправилна.");
        }
        if (passwordEncoder.matches(request.newPassword(), user.getPasswordHash())) {
            throw new ResponseStatusException(BAD_REQUEST, "Новата парола трябва да е различна.");
        }
        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        user.setPasswordChangeRequired(false);
        users.save(user);
        tokens.deleteByUserId(user.getId());
        return issueToken(user);
    }

    private void validatePassword(String password) {
        if (password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ResponseStatusException(BAD_REQUEST, "Паролата е твърде дълга (до 72 UTF-8 байта).");
    }

    public UserResponse toResponse(AppUser user) {
        return new UserResponse(user.getId(), user.getName(), user.getEmail(), user.getRole().name(),
                user.isActive(), user.isPasswordChangeRequired(), subscriptions.status(user),
                permissions.allowedMethods(user), permissions.subscriptionMethods(user));
    }

    private AuthResponse issueToken(AppUser user) {
        AuthToken token = new AuthToken();
        token.setToken(UUID.randomUUID().toString());
        token.setUser(user);
        tokens.save(token);
        return new AuthResponse(token.getToken(), toResponse(user));
    }

    @Transactional
    public AuthResponse externalLogin(long userId) {
        AppUser user = users.findById(userId).filter(AppUser::isActive)
                .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Неактивен профил."));
        return issueToken(user);
    }

    public record RegisterRequest(@NotBlank @Size(max = 120) String name, @Email @NotBlank @Size(max = 190) String email,
                                  @NotBlank @Size(min = 8, max = 72) String password) {}
    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}
    public record ChangePasswordRequest(@NotBlank String currentPassword, @NotBlank @Size(min = 8, max = 72) String newPassword) {}
    public record UserResponse(Long id, String name, String email, String role, boolean active,
                               boolean passwordChangeRequired, SubscriptionService.Status subscription,
                               List<String> allowedMethods, List<String> subscriptionMethods) {}
    public record AuthResponse(String token, UserResponse user) {}
}
