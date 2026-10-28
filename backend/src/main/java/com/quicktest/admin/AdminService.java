package com.quicktest.admin;

import com.quicktest.exception.ApiException;
import com.quicktest.access.*;
import com.quicktest.auth.*;
import com.quicktest.workspace.IdentityWorkflow;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final UserDeletionRepository deletion;
    private final IdentityWorkflow identities;
    private final SecureRandom random = new SecureRandom();

    public AdminService(AppUserRepository users, AuthTokenRepository tokens, AuthService auth, PasswordEncoder encoder,
                        EndpointCatalog catalog, EndpointPermissionRepository permissions, PermissionAccess access,
                        AdminAuditRepository audits, UserDeletionRepository deletion, IdentityWorkflow identities) {
        this.users = users;
        this.tokens = tokens;
        this.auth = auth;
        this.encoder = encoder;
        this.catalog = catalog;
        this.permissions = permissions;
        this.access = access;
        this.audits = audits;
        this.deletion = deletion;
        this.identities = identities;
    }

    @Transactional(readOnly = true)
    public List<AdminUserResponse> users() {
        var addresses = identities.notificationAddresses();
        return users.findAllByOrderByCreatedAtDesc().stream()
                .map(user -> adminResponse(user, addresses.getOrDefault(user.getId(), IdentityWorkflow.fallback(user)))).toList();
    }

    @Transactional
    public PasswordResponse create(AppUser actor, UserEdit request) {
        checkSubscription(request);
        String email = normalizeEmail(request.email());
        if (users.existsByEmailIgnoreCase(email)) throw new ApiException(CONFLICT, "Имейлът вече се използва.");
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
    public AdminUserResponse update(AppUser actor, Long id, UserEdit request) {
        checkSubscription(request);
        AppUser user = lockForUpdate(id, request.role(), request.active());
        String email = normalizeEmail(request.email());
        users.findByEmailIgnoreCase(email).filter(other -> !other.getId().equals(id)).ifPresent(other -> {
            throw new ApiException(CONFLICT, "Имейлът вече се използва.");
        });
        boolean revoke = !user.getEmail().equals(email) || user.getRole() != request.role() || user.isActive() != request.active()
                || user.isRoleSelectionRequired();
        String previous = "Преди: " + user.getRole() + ", " + user.getEmail() + ", active=" + user.isActive();
        if (!user.getEmail().equals(email)) user.setEmailVerifiedAt(null);
        apply(user, request);
        if (revoke) tokens.deleteByUserId(id);
        audit(actor, user, "USER_UPDATED", previous + "; след: " + user.getRole() + ", " + user.getEmail()
                + ", active=" + user.isActive() + "; платен=" + user.isSubscriptionPaid() + "; до=" + user.getSubscriptionPaidUntil());
        return adminResponse(user);
    }

    @Transactional
    public AdminUserResponse changeRole(AppUser actor, Long id, RoleEdit request) {
        AppUser user = lockForUpdate(id, request.role(), true);
        Role previous = user.getRole();
        if (previous == request.role() && !user.isRoleSelectionRequired()) return adminResponse(user);
        user.setRole(request.role());
        user.setRoleSelectionRequired(false);
        users.saveAndFlush(user);
        tokens.deleteByUserId(id);
        audit(actor, user, "USER_ROLE_CHANGED", "Роля: " + previous + " -> " + user.getRole()
                + "; активните сесии са прекратени.");
        return adminResponse(user);
    }

    @Transactional
    public AdminUserResponse sendVerificationEmail(AppUser actor, Long id) {
        AppUser user = users.lockById(id).orElseThrow(() -> new ApiException(NOT_FOUND, "Потребителят не съществува."));
        if (!user.isActive()) throw new ApiException(CONFLICT, "Потребителят е неактивен.");
        String email = identities.sendVerification(user);
        audit(actor, user, "EMAIL_VERIFICATION_SENT", "Линк за потвърждение на имейл за известия до " + email);
        return adminResponse(user);
    }

    @Transactional
    public PasswordResponse resetPassword(AppUser actor, Long id) {
        if (actor.getId().equals(id))
            throw new ApiException(BAD_REQUEST, "Сменете собствената си парола от Моят профил.");
        AppUser user = requireUser(id);
        String password = temporaryPassword();
        user.setPasswordHash(encoder.encode(password));
        user.setPasswordChangeRequired(true);
        tokens.deleteByUserId(id);
        audit(actor, user, "PASSWORD_RESET", "Издадена временна парола; активните сесии са прекратени.");
        return new PasswordResponse(auth.toResponse(user), password);
    }

    @Transactional
    public void delete(AppUser actor, Long id, String password) {
        // Follow the same administrator -> target lock order as role/status edits.
        List<AppUser> administrators = users.lockAdministrators();
        AppUser administrator = administrators.stream()
                .filter(user -> user.getId().equals(actor.getId()) && user.isActive())
                .findFirst().orElseThrow(() -> new ApiException(FORBIDDEN, "Изтриването е достъпно само за активен администратор."));
        if (administrator.getId().equals(id))
            throw new ApiException(BAD_REQUEST, "Не можете да изтриете собствения си администраторски профил.");
        if (password == null || password.isBlank() || !encoder.matches(password, administrator.getPasswordHash()))
            throw new ApiException(FORBIDDEN, "Паролата за потвърждение е неправилна.");
        AppUser target = users.lockById(id)
                .orElseThrow(() -> new ApiException(NOT_FOUND, "Потребителят не съществува."));
        if (target.getRole() == Role.ADMIN && target.isActive()
                && administrators.stream().filter(AppUser::isActive).count() <= 1)
            throw new ApiException(CONFLICT, "Трябва да остане поне един активен администратор.");
        var plan = deletion.lockDependencies(id);
        if (!plan.blockers().isEmpty()) throw new ApiException(CONFLICT, plan.blockers().getFirst());
        tokens.deleteByUserId(id);
        tokens.flush();
        deletion.purge(plan);
        users.deletePermanentlyById(id);
        audit(administrator, null, "USER_DELETED", "Изтрит профил №" + id + "; свързани данни: " + plan.counts());
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
                throw new ApiException(BAD_REQUEST, "Тези права не могат да се променят: " + change.key());
            if (!seen.add(change.key() + ":" + change.role()))
                throw new ApiException(BAD_REQUEST, "Повторено право в заявката.");
        }
        for (PermissionChange change : request.changes()) {
            EndpointPermission item = permissions.findByEndpointKeyAndRole(change.key(), change.role()).orElseGet(() -> {
                EndpointPermission value = new EndpointPermission();
                value.setEndpointKey(change.key());
                value.setRole(change.role());
                return value;
            });
            item.setAllowed(change.allowed());
            item.setSubscriptionRequired(change.role() != Role.STUDENT && change.subscriptionRequired());
            permissions.save(item);
            audit(actor, null, "PERMISSION_UPDATED", change.key() + "; роля=" + change.role() + "; достъп="
                    + change.allowed() + "; абонамент=" + item.isSubscriptionRequired());
        }
        return matrix();
    }

    @Transactional(readOnly = true)
    public List<AuditResponse> auditLog() {
        return audits.findTop200ByOrderByCreatedAtDescIdDesc().stream().map(item -> new AuditResponse(item.getId(),
                item.getActor() == null ? "Изтрит потребител" : item.getActor().getEmail(), item.getTargetUser() == null ? null : item.getTargetUser().getEmail(),
                item.getAction(), item.getDetails(), item.getCreatedAt())).toList();
    }

    private AdminUserResponse adminResponse(AppUser user) {
        return adminResponse(user, identities.notificationAddress(user));
    }

    private AdminUserResponse adminResponse(AppUser user, IdentityWorkflow.NotificationAddress address) {
        var base = auth.toResponse(user);
        return new AdminUserResponse(base.id(), base.name(), base.email(), base.role(), base.active(), base.passwordChangeRequired(),
                base.roleSelectionRequired(), base.subscription(), base.allowedMethods(), base.subscriptionMethods(),
                user.getEmailVerifiedAt(), address.email(), address.verifiedAt());
    }

    private void apply(AppUser user, UserEdit request) {
        user.setName(request.name().trim());
        user.setEmail(normalizeEmail(request.email()));
        user.setRole(request.role());
        user.setRoleSelectionRequired(false);
        user.setActive(request.active());
        if (request.subscriptionPaid() && (!user.isSubscriptionPaid() || !Objects.equals(user.getSubscriptionPaidUntil(), request.subscriptionPaidUntil())))
            user.setSubscriptionPaidAt(Instant.now());
        if (!request.subscriptionPaid()) user.setSubscriptionPaidAt(null);
        user.setSubscriptionPaid(request.subscriptionPaid());
        user.setSubscriptionPaidUntil(request.subscriptionPaidUntil());
    }

    private void checkSubscription(UserEdit request) {
        if (request.subscriptionPaid() && request.subscriptionPaidUntil() == null)
            throw new ApiException(BAD_REQUEST, "Посочете дата за платения абонамент.");
    }

    private AppUser requireUser(Long id) {
        return users.findById(id).orElseThrow(() -> new ApiException(NOT_FOUND, "Потребителят не съществува."));
    }

    private AppUser lockForUpdate(Long id, Role role, boolean active) {
        // All role/status edits lock administrators first, then the target, in the same order.
        List<AppUser> administrators = users.lockAdministrators();
        AppUser user = users.lockById(id)
                .orElseThrow(() -> new ApiException(NOT_FOUND, "Потребителят не съществува."));
        if (user.getRole() == Role.ADMIN && user.isActive() && (!active || role != Role.ADMIN)
                && administrators.stream().filter(AppUser::isActive).count() <= 1) {
            throw new ApiException(CONFLICT, "Трябва да остане поне един активен администратор.");
        }
        return user;
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
    /** The regular user response plus login and notification email verification state, visible only to administrators. */
    public record AdminUserResponse(Long id, String name, String email, String role, boolean active,
                                    boolean passwordChangeRequired, boolean roleSelectionRequired, SubscriptionService.Status subscription,
                                    List<String> allowedMethods, List<String> subscriptionMethods,
                                    Instant emailVerifiedAt, String notificationEmail, Instant notificationEmailVerifiedAt) {}
    public record RoleEdit(@NotNull Role role) {}
    public record DeleteUserRequest(@NotBlank @Size(max = 72) String password) {}
    public record PasswordResponse(AuthService.UserResponse user, String temporaryPassword) {}
    public record PermissionChange(@NotBlank String key, @NotNull Role role, boolean allowed, boolean subscriptionRequired) {}
    public record PermissionEdit(@NotEmpty @Size(max = 200) List<@Valid PermissionChange> changes) {}
    public record PermissionRow(String key, String controller, String method, List<String> httpMethods, List<String> paths,
                                EndpointPolicy.Mode mode, PermissionAccess.Grant teacher, PermissionAccess.Grant student) {}
    public record AuditResponse(Long id, String actorEmail, String targetEmail, String action, String details, Instant createdAt) {}
}
