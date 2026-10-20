package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/groups") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true) @PreAuthorize("isAuthenticated()")
public class GroupReportController {
    private final OrgAccess access;private final GroupReportService reports;private final AssignmentService assignments;
    public GroupReportController(OrgAccess access,GroupReportService reports,AssignmentService assignments) {this.access=access;this.reports=reports;this.assignments=assignments;}
    @GetMapping("/{group}/summary") public Object summary(@PathVariable long group) {return reports.report(access.scope(),group);}
    @GetMapping("/{group}/assignments") public Object assignments(@PathVariable long group) {return assignments.listStudentGroup(access.student(),group);}
}
