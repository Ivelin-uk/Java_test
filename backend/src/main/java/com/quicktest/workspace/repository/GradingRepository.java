package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Repository
public class GradingRepository {
    private final WorkspaceStore store;

    public GradingRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> findAttempt(long organizationId, long id, boolean lock) {
        return store.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=?"+(lock?" FOR UPDATE":""), organizationId, id);
    }

    public List<Map<String, Object>> findTeacherQueue(long organizationId, boolean platform, long userId, long userId2) {
        return store.rows("SELECT a.id,a.assignment_id,a.attempt_number,a.status,a.expired,a.submitted_at,u.name student_name,v.title,j.status ai_status,j.attempts ai_attempts,j.error_message ai_error FROM exam_attempts a JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=s.organization_id AND v.id=s.version_id JOIN users u ON u.id=a.student_id LEFT JOIN workspace_ai_grading_jobs j ON j.organization_id=a.organization_id AND j.attempt_id=a.id WHERE (a.organization_id=? OR ?) AND (s.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=s.organization_id AND t.assignment_id=s.id AND t.teacher_id=?)) AND a.status IN ('pending_review','finalized','voided') ORDER BY a.id DESC", organizationId, platform, userId, userId2);
    }

    public Map<String, Object> requireStudent(long studentId) {
        return store.one("SELECT id,name,email FROM users WHERE id=?", studentId);
    }

    public List<Map<String, Object>> findQuestions(long organizationId, long id) {
        return store.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? ORDER BY position_index", organizationId, id);
    }

    public List<Map<String, Object>> findEvents(long organizationId, long id) {
        return store.rows("SELECT question_id,open_instance,event_type,telemetry_json,received_at FROM exam_events WHERE organization_id=? AND attempt_id=? ORDER BY id", organizationId, id);
    }

    public List<Map<String, Object>> findRevisions(long organizationId, long id) {
        return store.rows("SELECT id,revision_number,points,maximum_points,percentage,grade,outcome,reason,published_at,author_id FROM result_revisions WHERE organization_id=? AND attempt_id=? ORDER BY revision_number", organizationId, id);
    }

    public Map<String, Object> requireQuestion(long organizationId, long id, long questionId) {
        return store.one("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND id=?", organizationId, id, questionId);
    }

    public int saveGrade(BigDecimal points, String comment, String reason, long organizationId, long questionId) {
        return store.update("UPDATE attempt_questions SET final_points=?,reviewed=TRUE,teacher_comment=?,override_reason=? WHERE organization_id=? AND id=?", points, comment, reason, organizationId, questionId);
    }

    public Optional<Map<String, Object>> findPublication(long organizationId, long id, String idempotencyKey) {
        return store.optional("SELECT * FROM result_revisions WHERE organization_id=? AND attempt_id=? AND publication_key=?", organizationId, id, idempotencyKey);
    }

    public Map<String, Object> requireLatestRevision(long organizationId, long id) {
        return store.one("SELECT * FROM result_revisions WHERE organization_id=? AND attempt_id=? ORDER BY revision_number DESC LIMIT 1", organizationId, id);
    }

    public long nextRevisionNumber(long organizationId, long id) {
        return store.count("SELECT COALESCE(MAX(revision_number),0)+1 FROM result_revisions WHERE organization_id=? AND attempt_id=?", organizationId, id);
    }

    public long insertRevision(long organizationId, long id, int next, String idempotencyKey, long userId, BigDecimal points, BigDecimal maximum, BigDecimal percent, String grade, String outcome, String value, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO result_revisions(organization_id,attempt_id,revision_number,publication_key,author_id,points,maximum_points,percentage,grade,outcome,reason,snapshot_json,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", organizationId, id, next, idempotencyKey, userId, points, maximum, percent, grade, outcome, value, jsonValue, timestamp);
    }

    public int markFinalized(long organizationId, long id) {
        return store.update("UPDATE exam_attempts SET status='finalized' WHERE organization_id=? AND id=?", organizationId, id);
    }

    public Map<String, Object> requireOrganizationName(long organizationId) {
        return store.one("SELECT name FROM organizations WHERE id=?", organizationId);
    }

    public Map<String, Object> requireStudentName(long student) {
        return store.one("SELECT name FROM users WHERE id=?", student);
    }

    public Map<String, Object> requireRevision(long organizationId, long revision) {
        return store.one("SELECT * FROM result_revisions WHERE organization_id=? AND id=?", organizationId, revision);
    }

    public List<Map<String, Object>> findStudentResults(long organizationId, boolean platform, long userId) {
        return store.rows("SELECT r.id,r.attempt_id,r.revision_number,r.points,r.maximum_points,r.percentage,r.grade,r.outcome,r.published_at,a.assignment_id,a.attempt_number,v.title FROM result_revisions r JOIN exam_attempts a ON a.organization_id=r.organization_id AND a.id=r.attempt_id JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=s.organization_id AND v.id=s.version_id WHERE (r.organization_id=? OR ?) AND a.student_id=? AND a.status='finalized' AND r.revision_number=(SELECT MAX(rr.revision_number) FROM result_revisions rr WHERE rr.organization_id=r.organization_id AND rr.attempt_id=r.attempt_id) ORDER BY a.attempt_number DESC,r.published_at DESC", organizationId, platform, userId);
    }

    public Map<String, Object> requireFinalizedStudentAttempt(long organizationId, long id, long userId) {
        return store.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=? AND student_id=? AND status='finalized'", organizationId, id, userId);
    }

    public Map<String, Object> requireReleasePolicy(long organizationId, long assignmentId) {
        return store.one("SELECT ends_at,answers_after_deadline FROM exam_assignments WHERE organization_id=? AND id=?", organizationId, assignmentId);
    }

    public int voidAttempt(String reason, long organizationId, long id) {
        return store.update("UPDATE exam_attempts SET status='voided',active_key=NULL,void_reason=? WHERE organization_id=? AND id=?", reason, organizationId, id);
    }
}
