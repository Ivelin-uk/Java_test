package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class TenantPermissionsRepository {
    private final WorkspaceStore store;

    public TenantPermissionsRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Optional<Map<String, Object>> findGrant(long organizationId, String key, String role) {
        return store.optional("SELECT allowed FROM tenant_endpoint_permissions WHERE organization_id=? AND endpoint_key=? AND role=?", organizationId, key, role);
    }

    public int upsertGrant(long organizationId, String key, String role, boolean allowed) {
        return store.update("INSERT INTO tenant_endpoint_permissions(organization_id,endpoint_key,role,allowed) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE allowed=VALUES(allowed)", organizationId, key, role, allowed);
    }
}
