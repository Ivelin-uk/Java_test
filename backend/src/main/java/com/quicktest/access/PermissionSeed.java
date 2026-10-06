package com.quicktest.access;

import com.quicktest.auth.Role;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
public class PermissionSeed implements CommandLineRunner {
    private final EndpointCatalog catalog;
    private final EndpointPermissionRepository repository;

    public PermissionSeed(EndpointCatalog catalog, EndpointPermissionRepository repository) {
        this.catalog = catalog;
        this.repository = repository;
    }

    @Override @Transactional
    public void run(String... args) {
        for (var endpoint : catalog.all()) {
            if (endpoint.mode() != EndpointPolicy.Mode.MANAGED) continue;
            for (Role role : List.of(Role.TEACHER, Role.STUDENT)) {
                if (repository.findByEndpointKeyAndRole(endpoint.key(), role).isPresent()) continue;
                var permission = new EndpointPermission();
                permission.setEndpointKey(endpoint.key());
                permission.setRole(role);
                permission.setAllowed(role == Role.TEACHER ? endpoint.teacher() : endpoint.student());
                permission.setSubscriptionRequired(endpoint.paid());
                repository.save(permission);
            }
        }
    }
}
