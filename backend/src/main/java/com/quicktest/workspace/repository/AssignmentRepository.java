package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Repository
public class AssignmentRepository {
    private final WorkspaceStore store;

    public AssignmentRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> findAssignment(long organizationId, long id, boolean lock) {
        return store.one("SELECT a.*,v.title,v.definition_json FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE a.organization_id=? AND a.id=?"+(lock?" FOR UPDATE":""), organizationId, id);
    }

    public long countSharedTeacher(long organizationId, long id, long userId) {
        return store.count("SELECT COUNT(*) FROM assignment_teachers WHERE organization_id=? AND assignment_id=? AND teacher_id=?", organizationId, id, userId);
    }

    public List<Map<String, Object>> findStudentAssignments(long organizationId, boolean platform, long userId) {
        return store.rows("SELECT a.id,a.starts_at,a.ends_at,r.max_attempts,r.canceled,r.fullscreen_exempt,r.time_multiplier,v.title FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN assignment_recipients r ON r.organization_id=a.organization_id AND r.assignment_id=a.id WHERE (a.organization_id=? OR ?) AND r.student_id=? AND r.canceled=FALSE ORDER BY a.ends_at DESC", organizationId, platform, userId);
    }

    public List<Map<String, Object>> findTeacherAssignments(long organizationId, boolean platform, long userId, long userId2) {
        return store.rows("SELECT a.id,a.version_id,a.teacher_id,a.starts_at,a.ends_at,a.max_attempts,a.access_code,v.title,(SELECT COUNT(*) FROM assignment_recipients r WHERE r.organization_id=a.organization_id AND r.assignment_id=a.id AND r.canceled=FALSE) recipients FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE (a.organization_id=? OR ?) AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=a.organization_id AND t.assignment_id=a.id AND t.teacher_id=?)) ORDER BY a.id DESC", organizationId, platform, userId, userId2);
    }

    public List<Map<String, Object>> findRecipientSources(List<Long> assignmentIds) {
        String placeholders = String.join(",", Collections.nCopies(assignmentIds.size(), "?"));
        return store.rows("SELECT r.assignment_id,r.student_id,r.source_groups_json,r.individually_assigned,u.name FROM assignment_recipients r JOIN users u ON u.id=r.student_id WHERE r.assignment_id IN ("+placeholders+") ORDER BY u.name,r.student_id", assignmentIds.toArray());
    }

    public List<Map<String, Object>> findGroupNames(List<Long> groupIds) {
        String groupPlaceholders = String.join(",", Collections.nCopies(groupIds.size(), "?"));
        return store.rows("SELECT id,name FROM learning_groups WHERE id IN ("+groupPlaceholders+")", groupIds.toArray());
    }

    public Map<String, Object> requireAssignableVersion(long organizationId, long versionId) {
        return store.one("SELECT v.*,t.owner_id,t.shared,t.status FROM assessment_versions v JOIN workspace_assessments t ON t.organization_id=v.organization_id AND t.id=v.assessment_id WHERE v.organization_id=? AND v.id=?", organizationId, versionId);
    }

    public List<Map<String, Object>> findActiveGroupStudents(long groupWorkspace, Long group) {
        return store.rows("SELECT g.user_id FROM group_members g JOIN memberships m ON m.organization_id=g.organization_id AND m.user_id=g.user_id JOIN users u ON u.id=g.user_id WHERE g.organization_id=? AND g.group_id=? AND g.active=TRUE AND m.status='active' AND m.roles_json LIKE '%STUDENT%' AND u.active=TRUE AND u.role='STUDENT'", groupWorkspace, group);
    }

    public long insertAssignment(long organizationId, long versionId, long userId, Instant startsAt, Instant endsAt, int maxAttempts, boolean shuffleQuestions, boolean shuffleOptions, boolean answersAfterDeadline, Instant timestamp) {
        return store.insert("INSERT INTO exam_assignments(organization_id,version_id,teacher_id,starts_at,ends_at,max_attempts,shuffle_questions,shuffle_options,answers_after_deadline,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", organizationId, versionId, userId, startsAt, endsAt, maxAttempts, shuffleQuestions, shuffleOptions, answersAfterDeadline, timestamp);
    }

    public int insertRecipient(long organizationId, long id, Long getKey, String jsonValue, int maxAttempts) {
        return store.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,?,FALSE,?)", organizationId, id, getKey, jsonValue, maxAttempts);
    }

    public int saveCode(String value, String code, long id, long organizationId) {
        return store.update("UPDATE exam_assignments SET code_hash=?,access_code=? WHERE id=? AND organization_id=?", value, code, id, organizationId);
    }

    public int rotateCode(String value, String code, long organizationId, long id) {
        return store.update("UPDATE exam_assignments SET code_hash=?,access_code=?,code_generation=code_generation+1 WHERE organization_id=? AND id=?", value, code, organizationId, id);
    }

    public int revokeCode(long organizationId, long id) {
        return store.update("UPDATE exam_assignments SET code_hash=NULL,access_code=NULL WHERE organization_id=? AND id=?", organizationId, id);
    }

    public List<Map<String, Object>> lockRecipientIds(long organizationId, long id) {
        return store.rows("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE", organizationId, id);
    }

    public List<Map<String, Object>> lockAttemptIds(long organizationId, long id) {
        return store.rows("SELECT id FROM exam_attempts WHERE organization_id=? AND assignment_id=? ORDER BY id FOR UPDATE", organizationId, id);
    }

    public List<Map<String, Object>> lockResultDeliveries(long organizationId, long attemptId) {
        return store.rows("SELECT n.id,n.status FROM notification_outbox n JOIN result_revisions r ON r.organization_id=n.organization_id AND r.id=n.revision_id WHERE r.organization_id=? AND r.attempt_id=? FOR UPDATE", organizationId, attemptId);
    }

    public int deleteResultDeliveries(long organizationId, long organizationId2, long attemptId) {
        return store.update("DELETE FROM notification_outbox WHERE organization_id=? AND revision_id IN (SELECT id FROM result_revisions WHERE organization_id=? AND attempt_id=?)", organizationId, organizationId2, attemptId);
    }

    public int deleteEvents(long organizationId, long attemptId) {
        return store.update("DELETE FROM exam_events WHERE organization_id=? AND attempt_id=?", organizationId, attemptId);
    }

    public int deleteResults(long organizationId, long attemptId) {
        return store.update("DELETE FROM result_revisions WHERE organization_id=? AND attempt_id=?", organizationId, attemptId);
    }

    public int deleteQuestions(long organizationId, long attemptId) {
        return store.update("DELETE FROM attempt_questions WHERE organization_id=? AND attempt_id=?", organizationId, attemptId);
    }

    public int deleteAttempt(long organizationId, long attemptId) {
        return store.update("DELETE FROM exam_attempts WHERE organization_id=? AND id=?", organizationId, attemptId);
    }

    public int deleteCodeDeliveries(long organizationId, long id) {
        return store.update("DELETE FROM assignment_code_deliveries WHERE organization_id=? AND assignment_id=?", organizationId, id);
    }

    public int deleteSharedTeachers(long organizationId, long id) {
        return store.update("DELETE FROM assignment_teachers WHERE organization_id=? AND assignment_id=?", organizationId, id);
    }

    public int deleteRecipients(long organizationId, long id) {
        return store.update("DELETE FROM assignment_recipients WHERE organization_id=? AND assignment_id=?", organizationId, id);
    }

    public int deleteAssignment(long organizationId, long id) {
        return store.update("DELETE FROM exam_assignments WHERE organization_id=? AND id=?", organizationId, id);
    }

    public Map<String, Object> lockRecipient(long organizationId, long id, long user) {
        return store.one("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? FOR UPDATE", organizationId, id, user);
    }

    public long countActiveAttempts(long organizationId, long id, long user) {
        return store.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND status='in_progress'", organizationId, id, user);
    }

    public int updateAccommodation(boolean fullscreenExempt, BigDecimal timeMultiplier, int maxAttempts, String reason, long organizationId, long id, long user) {
        return store.update("UPDATE assignment_recipients SET fullscreen_exempt=?,time_multiplier=?,max_attempts=?,accommodation_reason=? WHERE organization_id=? AND assignment_id=? AND student_id=?", fullscreenExempt, timeMultiplier, maxAttempts, reason, organizationId, id, user);
    }

    public List<Map<String, Object>> findMonitoringRows(long organizationId, long id) {
        return store.rows("SELECT r.student_id,u.name,u.email,r.canceled,r.max_attempts,r.fullscreen_exempt,r.time_multiplier,r.accommodation_reason,a.id attempt_id,a.attempt_number,a.status,a.current_position,a.started_at,a.submitted_at FROM assignment_recipients r JOIN users u ON u.id=r.student_id LEFT JOIN exam_attempts a ON a.organization_id=r.organization_id AND a.assignment_id=r.assignment_id AND a.student_id=r.student_id WHERE r.organization_id=? AND r.assignment_id=? ORDER BY u.name,a.attempt_number DESC", organizationId, id);
    }

    public Map<String, Object> findPreflight(long organizationId, long id, long userId) {
        return store.one("SELECT a.id,a.starts_at,a.ends_at,v.title,v.definition_json,r.max_attempts,r.fullscreen_exempt,r.time_multiplier,r.canceled FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN assignment_recipients r ON r.organization_id=a.organization_id AND r.assignment_id=a.id WHERE a.organization_id=? AND a.id=? AND r.student_id=?", organizationId, id, userId);
    }

    public int shareTeacher(long organizationId, long id, long teacher) {
        return store.update("INSERT INTO assignment_teachers(organization_id,assignment_id,teacher_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE teacher_id=teacher_id", organizationId, id, teacher);
    }

    public int unshareTeacher(long organizationId, long id, long teacher) {
        return store.update("DELETE FROM assignment_teachers WHERE organization_id=? AND assignment_id=? AND teacher_id=?", organizationId, id, teacher);
    }

    public List<Map<String, Object>> findSharedTeachers(long organizationId, long id) {
        return store.rows("SELECT t.teacher_id,u.name FROM assignment_teachers t JOIN users u ON u.id=t.teacher_id WHERE t.organization_id=? AND t.assignment_id=? ORDER BY u.name", organizationId, id);
    }

    public List<Map<String, Object>> findSourceGroups(long organizationId, long id) {
        return store.rows("SELECT source_groups_json FROM assignment_recipients WHERE organization_id=? AND assignment_id=?", organizationId, id);
    }

    public List<Map<String, Object>> lockRecipients(long organizationId, long id) {
        return store.rows("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE", organizationId, id);
    }

    public List<Map<String, Object>> lockStudentAttempts(long organizationId, long id, long student) {
        return store.rows("SELECT id,status FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? ORDER BY id FOR UPDATE", organizationId, id, student);
    }

    public int restoreRecipient(long maxAttempts, long organizationId, long id, long student) {
        return store.update("UPDATE assignment_recipients SET canceled=FALSE,max_attempts=? WHERE organization_id=? AND assignment_id=? AND student_id=?", maxAttempts, organizationId, id, student);
    }

    public int insertRecipient(long organizationId, long id, long student, String jsonValue, long maxAttempts) {
        return store.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,?,FALSE,?)", organizationId, id, student, jsonValue, maxAttempts);
    }

    public List<Map<String, Object>> findRecipientAccess(long organizationId, long id) {
        return store.rows("SELECT student_id,source_groups_json,canceled FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE", organizationId, id);
    }

    public List<Map<String, Object>> lockActiveStudentAttempts(long organizationId, long id, long student) {
        return store.rows("SELECT id FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND status='in_progress' FOR UPDATE", organizationId, id, student);
    }

    public int voidAttempt(Instant timestamp, String reason, long organizationId, long attemptId) {
        return store.update("UPDATE exam_attempts SET status='voided',active_key=NULL,submitted_at=?,void_reason=? WHERE organization_id=? AND id=?", timestamp, reason, organizationId, attemptId);
    }

    public int cancelRecipient(long organizationId, long id, long student) {
        return store.update("UPDATE assignment_recipients SET canceled=TRUE WHERE organization_id=? AND assignment_id=? AND student_id=?", organizationId, id, student);
    }

    public List<Map<String, Object>> findEligibleMembers(Set<Long> groups, Long student) {
        if (groups.isEmpty()) return List.of();
        String placeholders = String.join(",", Collections.nCopies(groups.size(), "?"));
        List<Object> args = new ArrayList<>(groups);
        if (student != null) args.add(student);
        return store.rows("SELECT DISTINCT g.id group_id,u.id student_id,u.name,u.email FROM learning_groups g JOIN group_members gm ON gm.organization_id=g.organization_id AND gm.group_id=g.id JOIN memberships m ON m.organization_id=gm.organization_id AND m.user_id=gm.user_id JOIN users u ON u.id=gm.user_id WHERE g.id IN ("+placeholders+") AND g.deleted_at IS NULL AND gm.active=TRUE AND m.status='active' AND m.roles_json LIKE '%STUDENT%' AND u.active=TRUE AND u.role='STUDENT'"+(student==null?"":" AND u.id=?")+" ORDER BY u.name,u.id,g.id", args.toArray());
    }

    public Map<String, Object> requireOrganizationName(long organizationId) {
        return store.one("SELECT name FROM organizations WHERE id=?", organizationId);
    }

    public List<Map<String, Object>> findActiveRecipientIds(long organizationId, long id) {
        return store.rows("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND canceled=FALSE", organizationId, id);
    }

    public long countCodeDeliveries(long organizationId, long id, long codeGeneration, long student, String channel) {
        return store.count("SELECT COUNT(*) FROM assignment_code_deliveries WHERE organization_id=? AND assignment_id=? AND generation=? AND student_id=? AND channel=?", organizationId, id, codeGeneration, student, channel);
    }

    public int recordCodeDelivery(long organizationId, long id, long codeGeneration, long student, String channel, Instant timestamp) {
        return store.update("INSERT INTO assignment_code_deliveries(organization_id,assignment_id,generation,student_id,channel,created_at) VALUES(?,?,?,?,?,?)", organizationId, id, codeGeneration, student, channel, timestamp);
    }
}
