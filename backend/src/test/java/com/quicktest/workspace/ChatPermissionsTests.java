package com.quicktest.workspace;

import com.quicktest.access.EndpointCatalog;
import com.quicktest.access.EndpointPolicy;
import com.quicktest.workspace.repository.TenantPermissionsRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChatPermissionsTests {
    private final TenantPermissions permissions = new TenantPermissions(mock(EndpointCatalog.class),
            mock(OrgAccess.class), mock(TenantPermissionsRepository.class), mock(WorkspaceAudit.class));

    @Test
    void administratorCanUseChatWithoutGainingOtherWorkspacePermissions() {
        var administrator = new OrgAccess.Scope(12, 31, Set.of("ADMIN"), true);
        assertTrue(permissions.allowed(administrator, endpoint("ChatController"), "ADMIN"));
        assertFalse(permissions.allowed(administrator, endpoint("AssessmentController"), "ADMIN"));
    }

    @Test
    void existingPlatformChatPermissionsStayAvailableToTeachersAndStudents() {
        for (String role : List.of("TEACHER", "STUDENT")) {
            assertTrue(permissions.allowed(new OrgAccess.Scope(12, 31, Set.of(role), true),
                    endpoint("ChatController"), role));
        }
    }

    private EndpointCatalog.Endpoint endpoint(String controller) {
        return new EndpointCatalog.Endpoint(controller + ".threads", controller, "threads", List.of("GET"),
                List.of("/api/v1/chat/threads"), EndpointPolicy.Mode.TENANT, true, true, false);
    }
}
