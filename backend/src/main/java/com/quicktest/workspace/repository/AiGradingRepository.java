package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class AiGradingRepository {
    private final WorkspaceStore store;

    public AiGradingRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Optional<Map<String, Object>> findJobByAttemptForUpdate(long organizationId, long attemptId) {
        return store.optional("SELECT * FROM workspace_ai_grading_jobs WHERE organization_id=? AND attempt_id=? FOR UPDATE", organizationId, attemptId);
    }

    public int reserveQuota(long organizationId) {
        return store.update("UPDATE organization_subscriptions SET ai_reserved=ai_reserved+1 WHERE organization_id=?", organizationId);
    }

    public int requeueJob(long userId, boolean platform, String requestKey, String value, boolean reserved, Instant timestamp, long organizationId, long id) {
        return store.update("UPDATE workspace_ai_grading_jobs SET user_id=?,platform_scope=?,request_key=?,snapshot_hash=?,status='queued',quota_reserved=?,error_message=NULL,updated_at=? WHERE organization_id=? AND id=?", userId, platform, requestKey, value, reserved, timestamp, organizationId, id);
    }

    public long insertJob(long organizationId, long attemptId, long userId, boolean platform, String requestKey, String value, boolean reserved, Instant timestamp, Instant timestamp2) {
        return store.insert("INSERT INTO workspace_ai_grading_jobs(organization_id,attempt_id,user_id,platform_scope,request_key,snapshot_hash,quota_reserved,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", organizationId, attemptId, userId, platform, requestKey, value, reserved, timestamp, timestamp2);
    }

    public Map<String, Object> requireJob(long id) {
        return store.one("SELECT * FROM workspace_ai_grading_jobs WHERE id=?", id);
    }

    public Map<String, Object> requireActiveTeacher(long userId) {
        return store.one("SELECT id FROM users WHERE id=? AND active=TRUE AND role='TEACHER'", userId);
    }

    public Map<String, Object> requireActiveOrganization(long organizationId) {
        return store.one("SELECT id FROM organizations WHERE id=? AND status='active'", organizationId);
    }

    public Map<String, Object> findAttempt(long organizationId, long id, boolean lock) {
        return store.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=?" + (lock ? " FOR UPDATE" : ""), organizationId, id);
    }

    public List<Map<String, Object>> findQuestions(long org, long attempt) {
        return store.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? ORDER BY position_index", org, attempt);
    }

    public List<Map<String, Object>> findStaleJobs(Instant value) {
        return store.rows("SELECT id,organization_id,attempts FROM workspace_ai_grading_jobs WHERE status='running' AND updated_at<?", value);
    }

    public Optional<Map<String, Object>> findNextJobForUpdate() {
        return store.optional("SELECT * FROM workspace_ai_grading_jobs WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE");
    }

    public int markRunning(Instant timestamp, long id) {
        return store.update("UPDATE workspace_ai_grading_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=?", timestamp, id);
    }

    public Map<String, Object> requireJobForUpdate(long org, long id) {
        return store.one("SELECT * FROM workspace_ai_grading_jobs WHERE organization_id=? AND id=? FOR UPDATE", org, id);
    }

    public int markCompleted(String model, int inputTokens, int outputTokens, long id, Instant timestamp, long org, long id2) {
        return store.update("UPDATE workspace_ai_grading_jobs SET status='completed',quota_reserved=FALSE,model=?,input_tokens=?,output_tokens=?,revision_id=?,updated_at=? WHERE organization_id=? AND id=?", model, inputTokens, outputTokens, id, timestamp, org, id2);
    }

    public Optional<Map<String, Object>> findJobForUpdate(long org, long id) {
        return store.optional("SELECT * FROM workspace_ai_grading_jobs WHERE organization_id=? AND id=? FOR UPDATE", org, id);
    }

    public int markFailed(String value, Instant timestamp, long org, long id) {
        return store.update("UPDATE workspace_ai_grading_jobs SET status='failed',quota_reserved=FALSE,error_message=?,updated_at=? WHERE organization_id=? AND id=?", value, timestamp, org, id);
    }

    public int settleQuota(int value, long organizationId) {
        return store.update("UPDATE organization_subscriptions SET ai_reserved=ai_reserved-1,ai_used=ai_used+? WHERE organization_id=?", value, organizationId);
    }
}
