package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class AuditRepository {
    private final WorkspaceStore store;

    public AuditRepository(WorkspaceStore store) {
        this.store = store;
    }

    public long insertEntry(Long organization, long actor, String action, Long resource, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO workspace_audit(organization_id,actor_id,action,resource_id,detail_json,created_at) VALUES(?,?,?,?,?,?)", organization, actor, action, resource, jsonValue, timestamp);
    }
}
