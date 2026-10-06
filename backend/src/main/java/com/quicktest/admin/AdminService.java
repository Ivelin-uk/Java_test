package com.quicktest.admin;

import com.quicktest.access.*;
import com.quicktest.auth.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class AdminService {
    private final AppUserRepository users;
    private final AuthTokenRepository tokens;
    private final AuthService auth;
    private final PasswordEncoder encoder;
    private final EndpointCatalog catalog;
    private final EndpointPermissionRepository permissions;
    private final PermissionAccess access;
    private final AdminAuditRepository audits;
    private final SecureRandom random = new SecureRandom();

    public AdminService(AppUserRepository users, AuthTokenRepository tokens, AuthService auth, PasswordEncoder encoder,
                        EndpointCatalog catalog, EndpointPermissionRepository permissions, PermissionAccess access,
                        AdminAuditRepository audits) {
        this.users = users;
        this.tokens = tokens;
        this.auth = auth;
        this.encoder = encoder;
        this.catalog = catalog;
        this.permissions = permissions;
        this.access = access;
        this.audits = audits;
    }

    @Transactional(readOnly = true)
    public List<AuthService.UserResponse> users() {
        return users.findAllByOrderByCreatedAtDesc().stream().map(auth::toResponse).toList();
    }

    @Transactional
    public PasswordResponse create(AppUser actor, UserEdit request) {
        checkSubscription(request);
        String email = normalizeEmail(request.email());
        if (users.existsByEmailIgnoreCase(email)) throw new ResponseStatusException(CONFLICT, "Имейлът вече се използва.");
        AppUser user = new AppUser();
        apply(user, request);
        String password = temporaryPassword();
        user.setPasswordHash(encoder.encode(password));
        user.setPasswordChangeRequired(true);
        users.saveAndFlush(user);
        audit(actor, user, "USER_CREATED", "Роля: " + user.getRole() + "; имейл: " + user.getEmail());
        return new PasswordResponse(auth.toResponse(user), password);
    }

    @Transactional
    public AuthService.UserResponse update(AppUser actor, Long id, UserEdit request) {
        checkSubscription(request);
        // Serialize administrator changes so concurrent requests cannot remove the last active administrator.
        List<AppUser> administrators = users.lockAdministrators();
        AppUser user = requireUser(id);
        if (user.getRole() == Role.ADMIN && user.isActive() && (!request.active() || request.role() != Role.ADMIN)
                && administrators.stream().filter(AppUser::isActive).count() <= 1) {
            throw new ResponseStatusException(CONFLICT, "Трябва да остане поне един активен администратор.");
        }
        String email = normalizeEmail(request.email());
        users.findByEmailIgnoreCase(email).filter(other -> !other.getId().equals(id)).ifPresent(other -> {
            throw new ResponseStatusException(CONFLICT, "Имейлът вече се използва.");
        });
        boolean revoke = !user.getEmail().equals(email) || user.getRole() != request.role() || user.isActive() != request.active();
        String previous = "Преди: " + user.getRole() + ", " + user.getEmail() + ", active=" + user.isActive();
        if (!user.getEmail().equals(email)) user.setEmailVerifiedAt(null);
        apply(user, request);
        if (revoke) tokens.deleteByUserId(id);
        audit(actor, user, "USER_UPDATED", previous + "; след: " + user.getRole() + ", " + user.getEmail()
                + ", active=" + user.isActive() + "; платен=" + user.isSubscriptionPaid() + "; до=" + user.getSubscriptionPaidUntil());
        return auth.toResponse(user);
    }

    @Transactional
    public PasswordResponse resetPassword(AppUser actor, Long id) {
        if (actor.getId().equals(id))
            throw new ResponseStatusException(BAD_REQUEST, "Сменете собствената си парола от Моят профил.");
        AppUser user = requireUser(id);
        String password = temporaryPassword();
        user.setPasswordHash(encoder.encode(password));
        user.setPasswordChangeRequired(true);
        tokens.deleteByUserId(id);
        audit(actor, user, "PASSWORD_RESET", "Издадена временна парола; активните сесии са прекратени.");
        return new PasswordResponse(auth.toResponse(user), password);
    }

    @Transactional(readOnly = true)
    public List<PermissionRow> matrix() {
        return catalog.all().stream().map(endpoint -> new PermissionRow(endpoint.key(), endpoint.controller(), endpoint.method(),
                endpoint.httpMethods(), endpoint.paths(), endpoint.mode(), access.permission(endpoint, Role.TEACHER),
                access.permission(endpoint, Role.STUDENT))).toList();
    }

    @Transactional
    public List<PermissionRow> updatePermissions(AppUser actor, PermissionEdit request) {
        Set<String> seen = new HashSet<>();
        for (PermissionChange change : request.changes()) {
            var endpoint = catalog.get(change.key());
            if (endpoint == null || endpoint.mode() != EndpointPolicy.Mode.MANAGED || change.role() == Role.ADMIN)
                throw new ResponseStatusException(BAD_REQUEST, "Тези права не могат да се променят: " + change.key());
            if (!seen.add(change.key() + ":" + change.role()))
                throw new ResponseStatusException(BAD_REQUEST, "Повторено право в заявката.");
        }
        for (PermissionChange change : request.changes()) {
            EndpointPermission item = permissions.findByEndpointKeyAndRole(change.key(), change.role()).orElseGet(() -> {
                EndpointPermission value = new EndpointPermission();
                value.setEndpointKey(change.key());
                value.setRole(change.role());
                return value;
            });
            item.setAllowed(change.allowed());
            item.setSubscriptionRequired(change.subscriptionRequired());
            permissions.save(item);
            audit(actor, null, "PERMISSION_UPDATED", change.key() + "; роля=" + change.role() + "; достъп="
                    + change.allowed() + "; абонамент=" + change.subscriptionRequired());
        }
        return matrix();
    }

    @Transactional(readOnly = true)
    public List<AuditResponse> auditLog() {
        return audits.findTop200ByOrderByCreatedAtDescIdDesc().stream().map(item -> new AuditResponse(item.getId(),
                item.getActor().getEmail(), item.getTargetUser() == null ? null : item.getTargetUser().getEmail(),
                item.getAction(), item.getDetails(), item.getCreatedAt())).toList();
    }

    private void apply(AppUser user, UserEdit request) {
        user.setName(request.name().trim());
        user.setEmail(normalizeEmail(request.email()));
        user.setRole(request.role());
        user.setActive(request.active());
        if (request.subscriptionPaid() && (!user.isSubscriptionPaid() || !Objects.equals(user.getSubscriptionPaidUntil(), request.subscriptionPaidUntil())))
            user.setSubscriptionPaidAt(Instant.now());
        if (!request.subscriptionPaid()) user.setSubscriptionPaidAt(null);
        user.setSubscriptionPaid(request.subscriptionPaid());
        user.setSubscriptionPaidUntil(request.subscriptionPaidUntil());
    }

    private void checkSubscription(UserEdit request) {
        if (request.subscriptionPaid() && request.subscriptionPaidUntil() == null)
            throw new ResponseStatusException(BAD_REQUEST, "Посочете дата за платения абонамент.");
    }

    private AppUser requireUser(Long id) {
        return users.findById(id).orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Потребителят не съществува."));
    }

    private String normalizeEmail(String email) { return email.trim().toLowerCase(Locale.ROOT); }

    private String temporaryPassword() {
        byte[] bytes = new byte[18];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private void audit(AppUser actor, AppUser target, String action, String details) {
        AdminAudit item = new AdminAudit();
        item.setActor(actor);
        item.setTargetUser(target);
        item.setAction(action);
        item.setDetails(details);
        audits.save(item);
    }

    public record UserEdit(@NotBlank @Size(max = 120) String name, @Email @NotBlank @Size(max = 190) String email,
                           @NotNull Role role, boolean active, boolean subscriptionPaid, LocalDate subscriptionPaidUntil) {}
    public record PasswordResponse(AuthService.UserResponse user, String temporaryPassword) {}
    public record PermissionChange(@NotBlank String key, @NotNull Role role, boolean allowed, boolean subscriptionRequired) {}
    public record PermissionEdit(@NotEmpty @Size(max = 200) List<@Valid PermissionChange> changes) {}
    public record PermissionRow(String key, String controller, String method, List<String> httpMethods, List<String> paths,
                                EndpointPolicy.Mode mode, PermissionAccess.Grant teacher, PermissionAccess.Grant student) {}
    public record AuditResponse(Long id, String actorEmail, String targetEmail, String action, String details, Instant createdAt) {}
}
