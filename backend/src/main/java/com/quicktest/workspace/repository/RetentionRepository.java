package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class RetentionRepository {
    private final WorkspaceStore store;

    public RetentionRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> requirePolicy(long org) {
        return store.one("SELECT settings_json FROM organizations WHERE id=?", org);
    }

    public long countExpiredAttempts(long organizationId, Instant cutoff) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status IN ('finalized','voided') AND submitted_at<?", organizationId, cutoff);
    }

    public Map<String, Object> requireActivePassword(long userId) {
        return store.one("SELECT password_hash FROM users WHERE id=? AND active=TRUE", userId);
    }

    public int ensureRetentionLock(long organizationId) {
        return store.update("INSERT INTO organization_retention_locks(organization_id) VALUES(?) ON DUPLICATE KEY UPDATE organization_id=organization_id", organizationId);
    }

    public Map<String, Object> lockRetention(long organizationId) {
        return store.one("SELECT organization_id FROM organization_retention_locks WHERE organization_id=? FOR UPDATE", organizationId);
    }

    public Optional<Map<String, Object>> findPreviousRun(long organizationId, String requestKey) {
        return store.optional("SELECT * FROM retention_runs WHERE organization_id=? AND request_key=?", organizationId, requestKey);
    }

    public List<Map<String, Object>> lockExpiredAttempts(long organizationId, Instant cutoff) {
        return store.rows("SELECT id FROM exam_attempts WHERE organization_id=? AND status IN ('finalized','voided') AND submitted_at<? ORDER BY id FOR UPDATE", organizationId, cutoff);
    }

    public List<Map<String, Object>> lockDeliveries(long organizationId, long id) {
        return store.rows("SELECT n.id,n.status FROM notification_outbox n JOIN result_revisions r ON r.organization_id=n.organization_id AND r.id=n.revision_id WHERE r.organization_id=? AND r.attempt_id=? FOR UPDATE", organizationId, id);
    }

    public List<Map<String, Object>> findRevisions(long organizationId, long id) {
        return store.rows("SELECT id FROM result_revisions WHERE organization_id=? AND attempt_id=?", organizationId, id);
    }

    public int deleteNotifications(long organizationId, long id) {
        return store.update("DELETE FROM notification_outbox WHERE organization_id=? AND revision_id=?", organizationId, id);
    }

    public int deleteEvents(long organizationId, long id) {
        return store.update("DELETE FROM exam_events WHERE organization_id=? AND attempt_id=?", organizationId, id);
    }

    public int deleteResults(long organizationId, long id) {
        return store.update("DELETE FROM result_revisions WHERE organization_id=? AND attempt_id=?", organizationId, id);
    }

    public int deleteQuestions(long organizationId, long id) {
        return store.update("DELETE FROM attempt_questions WHERE organization_id=? AND attempt_id=?", organizationId, id);
    }

    public int redactAttempt(String value, String value2, long organizationId, long id) {
        return store.update("UPDATE exam_attempts SET status='redacted',active_key=NULL,session_hash=?,auth_session_hash=?,browser_id='redacted',void_reason=NULL WHERE organization_id=? AND id=?", value, value2, organizationId, id);
    }

    public long insertRun(long organizationId, String requestKey, long userId, Instant cutoff, String reason, int count, Instant timestamp) {
        return store.insert("INSERT INTO retention_runs(organization_id,request_key,actor_id,cutoff,reason,redacted_attempts,created_at) VALUES(?,?,?,?,?,?,?)", organizationId, requestKey, userId, cutoff, reason, count, timestamp);
    }

    public Map<String, Object> requireRun(long run) {
        return store.one("SELECT * FROM retention_runs WHERE id=?", run);
    }
}
