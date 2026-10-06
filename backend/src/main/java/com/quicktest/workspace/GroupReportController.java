package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/groups") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true) @PreAuthorize("isAuthenticated()")
public class GroupReportController {
    private final OrgAccess access;private final GroupReportService reports;
    public GroupReportController(OrgAccess access,GroupReportService reports) {this.access=access;this.reports=reports;}
    @GetMapping("/{group}/summary") public Object summary(@PathVariable long group) {return reports.report(access.scope(),group);}
}
