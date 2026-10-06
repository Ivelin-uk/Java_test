package com.quicktest.access;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.Role;
import com.quicktest.auth.SubscriptionService;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.springframework.http.HttpStatus.FORBIDDEN;

@Service("permissions")
public class PermissionAccess {
    private final EndpointCatalog catalog;
    private final EndpointPermissionRepository repository;
    private final SubscriptionService subscriptions;

    public PermissionAccess(EndpointCatalog catalog, EndpointPermissionRepository repository, SubscriptionService subscriptions) {
        this.catalog = catalog;
        this.repository = repository;
        this.subscriptions = subscriptions;
    }

    public boolean check(Authentication authentication, String key) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AppUser user) || !user.isActive()) return false;
        var endpoint = catalog.get(key);
        if (endpoint == null) return false;
        if (user.getRole() == Role.ADMIN) return true;
        var permission = permission(endpoint, user.getRole());
        if (!permission.allowed()) return false;
        if (permission.subscriptionRequired() && !subscriptions.status(user).active())
            throw new ResponseStatusException(FORBIDDEN, "Необходим е активен платен абонамент.");
        return true;
    }

    public Grant permission(EndpointCatalog.Endpoint endpoint, Role role) {
        if (role == Role.ADMIN) return new Grant(true, false);
        if (endpoint.mode() != EndpointPolicy.Mode.MANAGED)
            return new Grant(endpoint.mode() != EndpointPolicy.Mode.ADMIN, false);
        return repository.findByEndpointKeyAndRole(endpoint.key(), role)
                .map(item -> new Grant(item.isAllowed(), item.isSubscriptionRequired()))
                .orElseGet(() -> new Grant(role == Role.TEACHER ? endpoint.teacher() : endpoint.student(), endpoint.paid()));
    }

    public List<String> allowedMethods(AppUser user) {
        Map<String, EndpointPermission> grants = grants(user.getRole());
        return catalog.all().stream().filter(endpoint -> permission(endpoint, user.getRole(), grants).allowed())
                .map(EndpointCatalog.Endpoint::key).toList();
    }

    public List<String> subscriptionMethods(AppUser user) {
        Map<String, EndpointPermission> grants = grants(user.getRole());
        return catalog.all().stream().filter(endpoint -> permission(endpoint, user.getRole(), grants).subscriptionRequired())
                .map(EndpointCatalog.Endpoint::key).toList();
    }

    private Map<String, EndpointPermission> grants(Role role) {
        return role == Role.ADMIN ? Map.of() : repository.findByRole(role).stream()
                .collect(Collectors.toMap(EndpointPermission::getEndpointKey, item -> item));
    }

    private Grant permission(EndpointCatalog.Endpoint endpoint, Role role, Map<String, EndpointPermission> grants) {
        if (role == Role.ADMIN) return new Grant(true, false);
        if (endpoint.mode() != EndpointPolicy.Mode.MANAGED) return new Grant(endpoint.mode() != EndpointPolicy.Mode.ADMIN, false);
        EndpointPermission item = grants.get(endpoint.key());
        return item == null ? new Grant(role == Role.TEACHER ? endpoint.teacher() : endpoint.student(), endpoint.paid())
                : new Grant(item.isAllowed(), item.isSubscriptionRequired());
    }

    public record Grant(boolean allowed, boolean subscriptionRequired) {}
}
