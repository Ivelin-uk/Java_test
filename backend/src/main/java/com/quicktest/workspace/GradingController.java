package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT)
@PreAuthorize("isAuthenticated()")
public class GradingController {
    private final OrgAccess access;private final GradingService service;
    public GradingController(OrgAccess access,GradingService service) {this.access=access;this.service=service;}
    @GetMapping("/grading") public Object queue() {return service.queue(access.teacher());}
    @GetMapping("/attempts/{id}/review") public Object review(@PathVariable long id) {return service.review(access.teacher(),id);}
    @PatchMapping("/attempts/{id}/grading") public void grade(@PathVariable long id,@RequestBody GradingService.GradeRequest request) {service.grade(access.teacher(),id,request);}
    @PostMapping("/attempts/{id}/finalize") public Object publish(@PathVariable long id,@RequestBody GradingService.Finalize request) {return service.finalizeResult(access.teacher(),id,request,false);}
    @PostMapping("/attempts/{id}/result-revisions") public Object correct(@PathVariable long id,@RequestBody GradingService.Finalize request) {return service.finalizeResult(access.teacher(),id,request,true);}
    @PostMapping("/attempts/{id}/void") public void voidAttempt(@PathVariable long id,@RequestBody Reason request) {service.voidAttempt(access.teacher(),id,request.reason());}
    @GetMapping("/results") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,teacher=false,student=true) public Object results() {return service.results(access.student());}
    @GetMapping("/assignment-results") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,teacher=false,student=true) public Object assignmentResults() {return service.assignmentResults(access.student());}
    @GetMapping("/results/{id}") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,teacher=false,student=true) public Object result(@PathVariable long id) {return service.studentResult(access.student(),id);}
    public record Reason(String reason) {}
}
