package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class GroupReportRepository {
    private final WorkspaceStore store;

    public GroupReportRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> requireGroup(long organizationId, long group) {
        return store.one("SELECT * FROM learning_groups WHERE organization_id=? AND id=? AND deleted_at IS NULL", organizationId, group);
    }

    public long countGroupTeachers(long organizationId, long group, long userId) {
        return store.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?", organizationId, group, userId);
    }

    public long countActiveGroupMembers(long organizationId, long group, long userId) {
        return store.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=? AND active=TRUE", organizationId, group, userId);
    }

    public List<Map<String, Object>> findVisibleRecipients(long organizationId, boolean platform, long userId, boolean teacher) {
        return store.rows("SELECT r.organization_id,r.student_id,r.source_groups_json,r.canceled,a.id assignment_id,v.title,a.starts_at,a.ends_at,u.name student_name FROM assignment_recipients r JOIN exam_assignments a ON a.organization_id=r.organization_id AND a.id=r.assignment_id JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN users u ON u.id=r.student_id WHERE (r.organization_id=? OR ?)"+(teacher?" AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=a.organization_id AND t.assignment_id=a.id AND t.teacher_id=?))":" AND r.student_id=?"), teacher ? new Object[]{organizationId, platform, userId, userId} : new Object[]{organizationId, platform, userId});
    }

    public List<Map<String, Object>> findStudentAttempts(long organizationId, long assignmentId, long studentId) {
        return store.rows("SELECT a.id,a.attempt_number,a.status,a.started_at,a.submitted_at,r.grade,r.outcome,r.percentage,r.published_at FROM exam_attempts a LEFT JOIN result_revisions r ON r.organization_id=a.organization_id AND r.attempt_id=a.id AND a.status='finalized' AND r.revision_number=(SELECT MAX(x.revision_number) FROM result_revisions x WHERE x.organization_id=r.organization_id AND x.attempt_id=r.attempt_id) WHERE a.organization_id=? AND a.assignment_id=? AND a.student_id=? ORDER BY a.attempt_number DESC", organizationId, assignmentId, studentId);
    }

    public List<Map<String, Object>> findTeachers(long organizationId, long group) {
        return store.rows("SELECT u.name FROM group_teachers t JOIN users u ON u.id=t.user_id WHERE t.organization_id=? AND t.group_id=?", organizationId, group);
    }
}
