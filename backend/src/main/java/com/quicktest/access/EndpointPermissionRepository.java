package com.quicktest.access;

import com.quicktest.auth.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface EndpointPermissionRepository extends JpaRepository<EndpointPermission, Long> {
    Optional<EndpointPermission> findByEndpointKeyAndRole(String key, Role role);
    List<EndpointPermission> findByRole(Role role);
}
