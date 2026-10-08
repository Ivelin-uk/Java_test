package com.quicktest;

import com.quicktest.access.*;
import com.quicktest.auth.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class StudentSubscriptionTests {
    @Test
    void storedPaidRequirementDoesNotRestrictStudents() {
        var catalog = mock(EndpointCatalog.class);
        var repository = mock(EndpointPermissionRepository.class);
        var subscriptions = mock(SubscriptionService.class);
        var access = new PermissionAccess(catalog, repository, subscriptions);
        var endpoint = new EndpointCatalog.Endpoint("StudentController.catalog", "StudentController", "catalog",
                List.of("GET"), List.of("/api/student/tests"), EndpointPolicy.Mode.MANAGED, false, true, true);
        var grant = new EndpointPermission();
        grant.setEndpointKey(endpoint.key());
        grant.setRole(Role.STUDENT);
        grant.setAllowed(true);
        grant.setSubscriptionRequired(true);
        var student = new AppUser();
        student.setRole(Role.STUDENT);
        student.setActive(true);
        when(catalog.get(endpoint.key())).thenReturn(endpoint);
        when(catalog.all()).thenReturn(List.of(endpoint));
        when(repository.findByEndpointKeyAndRole(endpoint.key(), Role.STUDENT)).thenReturn(Optional.of(grant));
        when(repository.findByRole(Role.STUDENT)).thenReturn(List.of(grant));
        var authentication = new UsernamePasswordAuthenticationToken(student, null, List.of());

        assertTrue(access.check(authentication, endpoint.key()));
        assertEquals(List.of(endpoint.key()), access.allowedMethods(student));
        assertTrue(access.subscriptionMethods(student).isEmpty());
        verifyNoInteractions(subscriptions);

        grant.setAllowed(false);
        assertFalse(access.check(authentication, endpoint.key()));
        when(repository.findByEndpointKeyAndRole(endpoint.key(), Role.STUDENT)).thenReturn(Optional.empty());
        when(repository.findByRole(Role.STUDENT)).thenReturn(List.of());
        assertTrue(access.check(authentication, endpoint.key()));
        assertTrue(access.subscriptionMethods(student).isEmpty());
        assertTrue(access.permission(endpoint, Role.TEACHER).subscriptionRequired());
    }
}
