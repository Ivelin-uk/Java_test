package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class GroupReportService {
    private final WorkspaceStore db;private final OrganizationService organizations;
    public GroupReportService(WorkspaceStore db,OrganizationService organizations) {this.db=db;this.organizations=organizations;}
    public Object report(OrgAccess.Scope scope,long group) {
        var profile=db.one("SELECT * FROM learning_groups WHERE organization_id=? AND id=? AND status<>'deleted'",scope.organizationId(),group);
        boolean teacher=scope.roles().contains("ORG_ADMIN") || scope.roles().contains("TEACHER") && db.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?",scope.organizationId(),group,scope.userId())>0;
        if(!teacher && db.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=? AND active=TRUE",scope.organizationId(),group,scope.userId())==0) throw WorkspaceError.forbidden();
        var recipients=db.rows("SELECT r.organization_id,r.student_id,r.source_groups_json,r.canceled,a.id assignment_id,v.title,a.starts_at,a.ends_at,u.name student_name FROM assignment_recipients r JOIN exam_assignments a ON a.organization_id=r.organization_id AND a.id=r.assignment_id JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN users u ON u.id=r.student_id WHERE (r.organization_id=? OR ?)"+(teacher?" AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=a.organization_id AND t.assignment_id=a.id AND t.teacher_id=?))":" AND r.student_id=?"),teacher?new Object[]{scope.organizationId(),scope.platform(),scope.userId(),scope.userId()}:new Object[]{scope.organizationId(),scope.platform(),scope.userId()});
        recipients=recipients.stream().filter(row->db.parse(row.get("source_groups_json"),List.class).stream().anyMatch(id->id.toString().equals(Long.toString(group)))).toList();
        for(var row:recipients) {
            row.remove("source_groups_json");row.put("attempts",db.rows("SELECT a.id,a.attempt_number,a.status,a.started_at,a.submitted_at,r.grade,r.outcome,r.percentage,r.published_at FROM exam_attempts a LEFT JOIN result_revisions r ON r.organization_id=a.organization_id AND r.attempt_id=a.id AND a.status='finalized' AND r.revision_number=(SELECT MAX(x.revision_number) FROM result_revisions x WHERE x.organization_id=r.organization_id AND x.attempt_id=r.attempt_id) WHERE a.organization_id=? AND a.assignment_id=? AND a.student_id=? ORDER BY a.attempt_number DESC",number(row,"organization_id"),number(row,"assignment_id"),number(row,"student_id")));
        }
        Map<String,Object> result=new LinkedHashMap<>();result.put("group",profile);result.put("assignments",recipients);result.put("teachers",db.rows("SELECT u.name FROM group_teachers t JOIN users u ON u.id=t.user_id WHERE t.organization_id=? AND t.group_id=?",scope.organizationId(),group));
        return result;
    }
}
