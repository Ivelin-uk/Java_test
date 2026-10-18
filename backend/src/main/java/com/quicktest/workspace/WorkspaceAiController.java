package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/ai/test-generations")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT)
@PreAuthorize("isAuthenticated()")
public class WorkspaceAiController {
    private final OrgAccess access;private final WorkspaceAiService service;private final SourceMaterialService materials;
    public WorkspaceAiController(OrgAccess access,WorkspaceAiService service,SourceMaterialService materials) {this.access=access;this.service=service;this.materials=materials;}
    @PostMapping("/source-material") public ResponseEntity<SourceMaterialService.Material> sourceMaterial(@Valid @RequestBody SourceMaterialService.Upload request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(materials.extract(access.teacher(),request));
    }
    @PostMapping public Object generate(@RequestBody WorkspaceAiService.Generate request) {return service.enqueue(access.teacher(),request);}
    @GetMapping("/{id}") public Object job(@PathVariable long id) {return service.get(access.teacher(),id);}
    @PostMapping("/{id}/retry") public Object retry(@PathVariable long id) {return service.retry(access.teacher(),id);}
}
