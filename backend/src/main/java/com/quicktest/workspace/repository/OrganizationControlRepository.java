package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Repository
public class OrganizationControlRepository {
    private final WorkspaceStore store;

    public OrganizationControlRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> requireOrganization(long organizationId) {
        return store.one("SELECT * FROM organizations WHERE id=?", organizationId);
    }

    public int updateSettings(String name, String organizationType, String contactEmail, String timezone, String studentLabel, String jsonValue, long organizationId) {
        return store.update("UPDATE organizations SET name=?,organization_type=?,contact_email=?,timezone=?,student_label=?,settings_json=? WHERE id=?", name, organizationType, contactEmail, timezone, studentLabel, jsonValue, organizationId);
    }

    public Map<String, Object> requireAdministrator(long administratorId) {
        return store.one("SELECT id FROM users WHERE id=? AND role='ADMIN' AND active=TRUE", administratorId);
    }

    public long insertSupportGrant(long organizationId, long administratorId, long userId, String reason, Instant value, Instant timestamp) {
        return store.insert("INSERT INTO support_grants(organization_id,administrator_id,approved_by,reason,expires_at,created_at) VALUES(?,?,?,?,?,?)", organizationId, administratorId, userId, reason, value, timestamp);
    }

    public Map<String, Object> requireSupportGrant(long id) {
        return store.one("SELECT * FROM support_grants WHERE id=?", id);
    }

    public Map<String, Object> requireScopedSupportGrant(long organizationId, long id) {
        return store.one("SELECT id FROM support_grants WHERE organization_id=? AND id=?", organizationId, id);
    }

    public int revokeSupportGrant(Instant timestamp, long organizationId, long id) {
        return store.update("UPDATE support_grants SET revoked_at=? WHERE organization_id=? AND id=?", timestamp, organizationId, id);
    }

    public Map<String, Object> requireOrganizationId(long org) {
        return store.one("SELECT id FROM organizations WHERE id=?", org);
    }

    public Map<String, Object> requireActiveSupportGrant(long org, long administrator, Instant timestamp) {
        return store.one("SELECT id FROM support_grants WHERE organization_id=? AND administrator_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY id DESC LIMIT 1", org, administrator, timestamp);
    }

    public long countActiveMembers(long org) {
        return store.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active'", org);
    }

    public long countAssignments(long org) {
        return store.count("SELECT COUNT(*) FROM exam_assignments WHERE organization_id=?", org);
    }

    public long countActiveAttempts(long org) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status='in_progress'", org);
    }

    public long countPendingReviews(long org) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status='pending_review'", org);
    }

    public long countMailFailures(long org) {
        return store.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=? AND status IN ('failed','uncertain')", org);
    }

    public long countQueuedMail(long org) {
        return store.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=? AND status='queued'", org);
    }

    public List<Map<String, Object>> findAiMetrics(long org) {
        return store.rows("SELECT status,COUNT(*) total,MIN(created_at) oldest FROM workspace_ai_jobs WHERE organization_id=? GROUP BY status", org);
    }

    public long countOverdueQuestions(long org, Instant timestamp) {
        return store.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND status='open' AND deadline_at<?", org, timestamp);
    }

    public Map<String, Object> findExportRows(long organizationId) {
        Map<String, Object> result = new LinkedHashMap<>();
        // Table identifiers are fixed here and never accepted from a request.
        for (String table : List.of("memberships", "learning_groups", "group_teachers", "group_members", "workspace_assessments", "assessment_versions", "question_bank_items", "assignment_recipients", "attempt_questions", "result_revisions", "exam_events", "workspace_audit")) {
            result.put(table, store.rows("SELECT * FROM " + table + " WHERE organization_id=?", organizationId));
        }
        return result;
    }

    public List<Map<String, Object>> exportAssignments(long organizationId) {
        return store.rows("SELECT id,version_id,teacher_id,starts_at,ends_at,max_attempts,shuffle_questions,shuffle_options,answers_after_deadline,created_at FROM exam_assignments WHERE organization_id=?", organizationId);
    }

    public List<Map<String, Object>> exportAttempts(long organizationId) {
        return store.rows("SELECT id,assignment_id,student_id,attempt_number,status,started_at,submitted_at,expired,void_reason FROM exam_attempts WHERE organization_id=?", organizationId);
    }

    public long insertPlan(String name, BigDecimal monthlyEur, BigDecimal yearlyEur, int teacherLimit, int studentLimit, int aiLimit, long storageBytes, boolean demonstration) {
        return store.insert("INSERT INTO organization_plans(name,monthly_eur,yearly_eur,teacher_limit,student_limit,ai_limit,storage_bytes,demonstration) VALUES(?,?,?,?,?,?,?,?)", name, monthlyEur, yearlyEur, teacherLimit, studentLimit, aiLimit, storageBytes, demonstration);
    }

    public Map<String, Object> requirePlan(Long id) {
        return store.one("SELECT id FROM organization_plans WHERE id=?", id);
    }

    public int updatePlan(String name, BigDecimal monthlyEur, BigDecimal yearlyEur, int teacherLimit, int studentLimit, int aiLimit, long storageBytes, boolean demonstration, Long id) {
        return store.update("UPDATE organization_plans SET name=?,monthly_eur=?,yearly_eur=?,teacher_limit=?,student_limit=?,ai_limit=?,storage_bytes=?,demonstration=? WHERE id=?", name, monthlyEur, yearlyEur, teacherLimit, studentLimit, aiLimit, storageBytes, demonstration, id);
    }

    public int deletePlanPrice(Long id, String getKey) {
        return store.update("DELETE FROM organization_plan_prices WHERE plan_id=? AND billing_period=?", id, getKey);
    }

    public int upsertPlanPrice(Long id, String getKey, String getValue) {
        return store.update("INSERT INTO organization_plan_prices(plan_id,billing_period,stripe_price_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stripe_price_id=VALUES(stripe_price_id)", id, getKey, getValue);
    }
}
