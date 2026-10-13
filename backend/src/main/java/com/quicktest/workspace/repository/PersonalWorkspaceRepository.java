package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class PersonalWorkspaceRepository {
    private final WorkspaceStore store;

    public PersonalWorkspaceRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> lockUser(Long userId) {
        return store.one("SELECT id FROM users WHERE id=? FOR UPDATE", userId);
    }

    public Optional<Map<String, Object>> findPersonalWorkspace(Long userId) {
        return store.optional("SELECT organization_id FROM personal_workspaces WHERE user_id=?", userId);
    }

    public long insertWorkspace(String getName, String getEmail, String value, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO organizations(name,organization_type,contact_email,timezone,student_label,settings_json,created_at) VALUES(?,'personal',?,'Europe/Sofia',?,?,?)", getName, getEmail, value, jsonValue, timestamp);
    }

    public int bindWorkspace(Long userId, long id) {
        return store.update("INSERT INTO personal_workspaces(user_id,organization_id) VALUES(?,?)", userId, id);
    }

    public Map<String, Object> requireStarterPlan() {
        return store.one("SELECT id FROM organization_plans WHERE name='Starter'");
    }

    public int insertSubscription(long id, long plan, Instant value, Instant timestamp) {
        return store.update("INSERT INTO organization_subscriptions(organization_id,plan_id,status,paid_through,period_start) VALUES(?,?,'active',?,?)", id, plan, value, timestamp);
    }

    public int upsertMembership(long workspace, long user, String jsonValue, Instant timestamp) {
        return store.update("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE roles_json=VALUES(roles_json),status='active'", workspace, user, jsonValue, timestamp);
    }
}
