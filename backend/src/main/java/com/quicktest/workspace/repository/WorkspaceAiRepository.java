package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class WorkspaceAiRepository {
    private final WorkspaceStore store;

    public WorkspaceAiRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Optional<Map<String, Object>> findPreviousJob(long organizationId, long userId, String requestKey) {
        return store.optional("SELECT * FROM workspace_ai_jobs WHERE organization_id=? AND user_id=? AND request_key=?", organizationId, userId, requestKey);
    }

    public long insertJob(long organizationId, long userId, String requestKey, String jsonValue, Instant timestamp, Instant timestamp2) {
        return store.insert("INSERT INTO workspace_ai_jobs(organization_id,user_id,request_key,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?)", organizationId, userId, requestKey, jsonValue, timestamp, timestamp2);
    }

    public int reserveQuota(long org) {
        return store.update("UPDATE organization_subscriptions SET ai_reserved=ai_reserved+1 WHERE organization_id=?", org);
    }

    public Map<String, Object> requireOwnedJob(long organizationId, long userId, long id) {
        return store.one("SELECT * FROM workspace_ai_jobs WHERE organization_id=? AND user_id=? AND id=?", organizationId, userId, id);
    }

    public int requeueJob(Instant timestamp, long organizationId, long id) {
        return store.update("UPDATE workspace_ai_jobs SET status='queued',error_message=NULL,updated_at=? WHERE organization_id=? AND id=?", timestamp, organizationId, id);
    }

    public List<Map<String, Object>> findStaleJobs(Instant value) {
        return store.rows("SELECT id,organization_id,attempts FROM workspace_ai_jobs WHERE status='running' AND updated_at<?", value);
    }

    public Optional<Map<String, Object>> findNextJobForUpdate() {
        return store.optional("SELECT * FROM workspace_ai_jobs WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE");
    }

    public int markRunning(Instant timestamp, long id) {
        return store.update("UPDATE workspace_ai_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=?", timestamp, id);
    }

    public int heartbeat(Instant timestamp, long org, long id, long lease) {
        return store.update("UPDATE workspace_ai_jobs SET updated_at=? WHERE organization_id=? AND id=? AND status='running' AND attempts=?", timestamp, org, id, lease);
    }

    public Map<String, Object> lockJob(long org, long id) {
        return store.one("SELECT * FROM workspace_ai_jobs WHERE organization_id=? AND id=? FOR UPDATE", org, id);
    }

    public int completeJob(Object value, String result, String error, Instant timestamp, long org, long id) {
        return store.update("UPDATE workspace_ai_jobs SET status=?,result_json=?,error_message=?,updated_at=? WHERE organization_id=? AND id=?", value, result, error, timestamp, org, id);
    }

    public int settleQuota(int value, long org) {
        return store.update("UPDATE organization_subscriptions SET ai_reserved=ai_reserved-1,ai_used=ai_used+? WHERE organization_id=?", value, org);
    }
}
