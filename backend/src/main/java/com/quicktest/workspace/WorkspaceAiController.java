package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/ai/test-generations")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT)
@PreAuthorize("isAuthenticated()")
public class WorkspaceAiController {
    private final OrgAccess access;private final WorkspaceAiService service;
    public WorkspaceAiController(OrgAccess access,WorkspaceAiService service) {this.access=access;this.service=service;}
    @PostMapping public Object generate(@RequestBody WorkspaceAiService.Generate request) {return service.enqueue(access.teacher(),request);}
    @GetMapping("/{id}") public Object job(@PathVariable long id) {return service.get(access.teacher(),id);}
    @PostMapping("/{id}/retry") public Object retry(@PathVariable long id) {return service.retry(access.teacher(),id);}
}
