package com.quicktest.workspace;

import com.quicktest.workspace.repository.GroupReportRepository;

import org.springframework.stereotype.Service;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class GroupReportService {
    private final WorkspaceJson json;
    private final GroupReportRepository repository;private final OrganizationService organizations;
    public GroupReportService(GroupReportRepository repository,WorkspaceJson json,OrganizationService organizations) {this.repository=repository;this.json=json;this.organizations=organizations;}
    public Object report(OrgAccess.Scope scope,long group) {
        var profile=repository.requireGroup(scope.organizationId(), group);
        boolean teacher=scope.roles().contains("ORG_ADMIN") || scope.roles().contains("TEACHER") && repository.countGroupTeachers(scope.organizationId(), group, scope.userId())>0;
        if(!teacher && repository.countActiveGroupMembers(scope.organizationId(), group, scope.userId())==0) throw WorkspaceError.forbidden();
        var recipients=repository.findVisibleRecipients(scope.organizationId(), scope.platform(), scope.userId(), teacher);
        recipients=recipients.stream().filter(row->json.parse(row.get("source_groups_json"),List.class).stream().anyMatch(id->id.toString().equals(Long.toString(group)))).toList();
        for(var row:recipients) {
            row.remove("source_groups_json");row.put("attempts",repository.findStudentAttempts(number(row,"organization_id"), number(row,"assignment_id"), number(row,"student_id")));
        }
        Map<String,Object> result=new LinkedHashMap<>();result.put("group",profile);result.put("assignments",recipients);result.put("teachers",repository.findTeachers(scope.organizationId(), group));
        return result;
    }
}
