package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT)
@PreAuthorize("isAuthenticated()")
public class AssessmentController {
    private final OrgAccess access;private final AssessmentService assessments;private final AssignmentService assignments;
    public AssessmentController(OrgAccess access,AssessmentService assessments,AssignmentService assignments) {this.access=access;this.assessments=assessments;this.assignments=assignments;}
    @GetMapping("/tests") public Object list() {return assessments.list(access.teacher());}
    @PostMapping("/tests") public Object create(@RequestBody AssessmentService.Definition request) {return assessments.save(access.teacher(),null,request);}
    @GetMapping("/tests/{id}") public Object get(@PathVariable long id) {return assessments.get(access.teacher(),id,false);}
    @PutMapping("/tests/{id}") public Object update(@PathVariable long id,@RequestBody AssessmentService.Definition request) {return assessments.save(access.teacher(),id,request);}
    @DeleteMapping("/tests/{id}") public void remove(@PathVariable long id) {assessments.archive(access.teacher(),id);}
    @PostMapping("/tests/{id}/publish") public Object publish(@PathVariable long id) {return assessments.publish(access.teacher(),id);}
    @GetMapping("/tests/{id}/versions") public Object versions(@PathVariable long id) {return assessments.versions(access.teacher(),id);}
    @PostMapping("/tests/{id}/duplicate") public Object duplicate(@PathVariable long id) {return assessments.duplicate(access.teacher(),id);}
    @PutMapping("/tests/{id}/sharing") public void sharing(@PathVariable long id,@RequestBody Sharing request) {assessments.share(access.teacher(),id,request.shared());}
    @GetMapping("/assignments") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true) public Object assignments() {return assignments.list(access.scope());}
    @PostMapping("/assignments") public Object assign(@RequestBody AssignmentService.AssignmentRequest request) {return assignments.create(access.version(request.versionId()),request);}
    @DeleteMapping("/assignments/{id}") public void removeAssignment(@PathVariable long id) {assignments.remove(access.teacher(),id);}
    @PostMapping("/assignments/{id}/recipients") public void addRecipient(@PathVariable long id,@RequestBody OrganizationController.UserId request) {assignments.addRecipient(access.teacher(),id,request.userId());}
    @GetMapping("/assignments/{id}/members") public Object assignmentMembers(@PathVariable long id) {return assignments.groupMembers(access.teacher(),id);}
    @DeleteMapping("/assignments/{id}/recipients/{user}") public void removeRecipient(@PathVariable long id,@PathVariable long user) {assignments.removeRecipient(access.teacher(),id,user);}
    @GetMapping("/assignments/{id}/preflight") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true) public Object preflight(@PathVariable long id) {return assignments.preflight(access.student(),id);}
    @PostMapping("/assignments/{id}/code/rotate") public Object rotate(@PathVariable long id) {return assignments.rotate(access.teacher(),id);}
    @DeleteMapping("/assignments/{id}/code") public void revoke(@PathVariable long id) {assignments.revoke(access.teacher(),id);}
    @GetMapping("/assignments/{id}/monitoring") public Object monitor(@PathVariable long id) {return assignments.monitoring(access.teacher(),id);}
    @PutMapping("/assignments/{id}/recipients/{user}/accommodation") public void accommodation(@PathVariable long id,@PathVariable long user,@RequestBody AssignmentService.Accommodation request) {assignments.accommodate(access.teacher(),id,user,request);}
    public record Sharing(boolean shared) {}
    @PostMapping("/assignments/{id}/code/send") public Object sendCode(@PathVariable long id,@RequestBody AssignmentService.CodeDelivery request) {return assignments.dispatchCode(access.teacher(),id,request);}
    @PutMapping("/assignments/{id}/teachers/{teacher}") public void shareTeacher(@PathVariable long id,@PathVariable long teacher,@RequestBody Sharing request) {assignments.shareTeacher(access.teacher(),id,teacher,request.shared());}
    @GetMapping("/assignments/{id}/teachers") public Object sharedTeachers(@PathVariable long id) {return assignments.sharedTeachers(access.teacher(),id);}
}
