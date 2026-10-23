package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Repository
public class ExamAttemptRepository {
    private final WorkspaceStore store;

    public ExamAttemptRepository(WorkspaceStore store) {
        this.store = store;
    }

    public long countStarts(long organizationId, long assignment, long userId, String idempotencyKey) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND start_key=?", organizationId, assignment, userId, idempotencyKey);
    }

    public Map<String, Object> requireActiveRecipient(long organizationId, long assignment, long userId) {
        return store.one("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? AND canceled=FALSE", organizationId, assignment, userId);
    }

    public Map<String, Object> requireCode(long organizationId, long assignment) {
        return store.one("SELECT code_hash FROM exam_assignments WHERE organization_id=? AND id=?", organizationId, assignment);
    }

    public Map<String, Object> lockRecipient(long organizationId, long assignment, long userId) {
        return store.one("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? FOR UPDATE", organizationId, assignment, userId);
    }

    public Optional<Map<String, Object>> findPreviousStartForUpdate(long organizationId, long assignment, long userId, String idempotencyKey) {
        return store.optional("SELECT * FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND start_key=? FOR UPDATE", organizationId, assignment, userId, idempotencyKey);
    }

    public Map<String, Object> lockAssignmentDefinition(long organizationId, long assignment) {
        return store.one("SELECT a.*,v.definition_json FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE a.organization_id=? AND a.id=? FOR UPDATE", organizationId, assignment);
    }

    public long countActiveStudentAttempts(long userId) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE student_id=? AND status='in_progress'", userId);
    }

    public long countStudentAttempts(long organizationId, long assignment, long userId) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=?", organizationId, assignment, userId);
    }

    public long insertAttempt(long organizationId, long assignment, long userId, long value, String idempotencyKey, String value2, String value3, String browserId, String userId2, boolean mobileMode, Instant timestamp) {
        return store.insert("INSERT INTO exam_attempts(organization_id,assignment_id,student_id,attempt_number,start_key,session_hash,auth_session_hash,browser_id,active_key,mobile_mode,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", organizationId, assignment, userId, value, idempotencyKey, value2, value3, browserId, userId2, mobileMode, timestamp);
    }

    public long insertQuestion(long organizationId, long id, int i, String jsonValue, BigDecimal points, int value) {
        return store.insert("INSERT INTO attempt_questions(organization_id,attempt_id,position_index,definition_json,maximum_points,time_seconds) VALUES(?,?,?,?,?,?)", organizationId, id, i, jsonValue, points, value);
    }

    public Map<String, Object> requireRecipientFlags(long organizationId, long assignment, long userId) {
        return store.one("SELECT fullscreen_exempt FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=?", organizationId, assignment, userId);
    }

    public Map<String, Object> lockAttempt(long org, long id) {
        return store.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=? FOR UPDATE", org, id);
    }

    public Map<String, Object> requireAssignmentDeadline(long organizationId, long assignmentId) {
        return store.one("SELECT ends_at FROM exam_assignments WHERE organization_id=? AND id=?", organizationId, assignmentId);
    }

    public int openQuestion(String toString, Instant timestamp, Instant deadline, long organizationId, long id) {
        return store.update("UPDATE attempt_questions SET status='open',open_instance=?,opened_at=?,deadline_at=? WHERE organization_id=? AND id=?", toString, timestamp, deadline, organizationId, id);
    }

    public Map<String, Object> requireCurrentQuestion(long organizationId, long id, long currentPosition) {
        return store.one("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND position_index=?", organizationId, id, currentPosition);
    }

    public int saveDraft(String jsonValue, long organizationId, long question) {
        return store.update("UPDATE attempt_questions SET draft_json=? WHERE organization_id=? AND id=?", jsonValue, organizationId, question);
    }

    public int saveAnswer(Instant timestamp, String jsonValue, String idempotencyKey, BigDecimal points, BigDecimal points2, boolean value, long organizationId, long question) {
        return store.update("UPDATE attempt_questions SET status='answered',closed_at=?,answer_json=?,answer_key=?,automatic_points=?,final_points=?,reviewed=? WHERE organization_id=? AND id=?", timestamp, jsonValue, idempotencyKey, points, points2, value, organizationId, question);
    }

    public int closeQuestion(String status, Instant timestamp, long organizationId, long id) {
        return store.update("UPDATE attempt_questions SET status=?,closed_at=?,automatic_points=0,final_points=0,reviewed=TRUE WHERE organization_id=? AND id=? AND status IN ('pending','open')", status, timestamp, organizationId, id);
    }

    public int advancePosition(long next, long organizationId, long id) {
        return store.update("UPDATE exam_attempts SET current_position=? WHERE organization_id=? AND id=?", next, organizationId, id);
    }

    public long countQuestions(long organizationId, long id) {
        return store.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND attempt_id=?", organizationId, id);
    }

    public int markPendingReview(Instant timestamp, boolean expired, long organizationId, long id) {
        return store.update("UPDATE exam_attempts SET status='pending_review',active_key=NULL,submitted_at=?,expired=? WHERE organization_id=? AND id=? AND status='in_progress'", timestamp, expired, organizationId, id);
    }

    public List<Map<String, Object>> findUnfinishedQuestions(long organizationId, long id) {
        return store.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND status IN ('pending','open')", organizationId, id);
    }

    public long countEvents(long organizationId, long id, String eventKey) {
        return store.count("SELECT COUNT(*) FROM exam_events WHERE organization_id=? AND attempt_id=? AND event_key=?", organizationId, id, eventKey);
    }

    public long countBoundQuestions(long organizationId, long id, Long questionId) {
        return store.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND id=?", organizationId, id, questionId);
    }

    public long insertEvent(long organizationId, long id, Long questionId, String openInstance, String eventKey, String type, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO exam_events(organization_id,attempt_id,question_id,open_instance,event_key,event_type,telemetry_json,received_at) VALUES(?,?,?,?,?,?,?,?)", organizationId, id, questionId, openInstance, eventKey, type, jsonValue, timestamp);
    }

    public Map<String, Object> requirePassword(long userId) {
        return store.one("SELECT password_hash FROM users WHERE id=?", userId);
    }

    public int transferSession(String value, String value2, String browserId, long organizationId, long id) {
        return store.update("UPDATE exam_attempts SET session_hash=?,auth_session_hash=?,browser_id=? WHERE organization_id=? AND id=?", value, value2, browserId, organizationId, id);
    }

    public List<Map<String, Object>> findStudentAttempts(long organizationId, boolean platform, long userId) {
        return store.rows("SELECT a.id,a.assignment_id,a.attempt_number,a.status,a.started_at,a.submitted_at,a.expired,a.mobile_mode,v.title FROM exam_attempts a JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=s.organization_id AND v.id=s.version_id WHERE (a.organization_id=? OR ?) AND a.student_id=? ORDER BY a.id DESC", organizationId, platform, userId);
    }

    public List<Map<String, Object>> findDueAttempts(Instant timestamp, Instant timestamp2) {
        return store.rows("SELECT DISTINCT a.organization_id,a.id FROM exam_attempts a JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id LEFT JOIN attempt_questions q ON q.organization_id=a.organization_id AND q.attempt_id=a.id AND q.status='open' WHERE a.status='in_progress' AND (s.ends_at<=? OR q.deadline_at<=?) LIMIT 500", timestamp, timestamp2);
    }
}
