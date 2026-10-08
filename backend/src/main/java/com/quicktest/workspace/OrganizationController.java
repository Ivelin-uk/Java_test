package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
@EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE)
@PreAuthorize("isAuthenticated()")
public class OrganizationController {
    private final OrgAccess access;
    private final OrganizationService service;
    private final WorkspaceStore db;
    private final IdentityWorkflow identity;
    private final NotificationService notifications;
    public OrganizationController(OrgAccess access,OrganizationService service,WorkspaceStore db,IdentityWorkflow identity,NotificationService notifications) {this.access=access;this.service=service;this.db=db;this.identity=identity;this.notifications=notifications;}
    @GetMapping("/members") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object members() {return service.members(access.scope());}
    @GetMapping("/directory") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object directory() {return service.members(access.teacher());}
    @GetMapping("/groups") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true) public Object groups() {return service.groups(access.scope());}
    @PostMapping("/groups") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object createGroup(@Valid @RequestBody OrganizationService.GroupRequest request) {return service.createGroup(access.teacher(),request);}
    @GetMapping("/groups/{group}/members") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object groupMembers(@PathVariable long group) {return service.groupMembers(access.scope(),group);}
    @PostMapping("/groups/{group}/members") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public void add(@PathVariable long group,@RequestBody UserId request) {service.addStudent(access.teacher(),group,request.userId());}
    @DeleteMapping("/groups/{group}/members/{user}") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public void remove(@PathVariable long group,@PathVariable long user) {service.removeStudent(access.teacher(),group,user);}
    @PostMapping("/groups/{group}/teachers") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public void teacher(@PathVariable long group,@RequestBody UserId request) {service.addTeacher(access.teacher(),group,request.userId());}
    @PostMapping("/groups/{group}/csv/preview") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object csv(@PathVariable long group,@RequestBody Csv request) {return service.csvPreview(access.teacher(),group,request.csv());}
    @GetMapping("/profile/notification-email") public Object profile() {return identity.profile(access.user());}
    @PostMapping("/profile/notification-email") public void email(@Valid @RequestBody EmailChange request) {identity.requestEmail(access.user(),request.email(),request.password());}
    @PostMapping("/profile/notification-email/verify") public void verify(@Valid @RequestBody Token request) {identity.verify(request.token());}
    @GetMapping("/profile/mailbox") public Object mailbox() {return notifications.localInbox(access.user().getId());}
    @GetMapping("/groups/{group}/teachers") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object teachers(@PathVariable long group) {return service.groupTeachers(access.scope(),group);}
    @PutMapping("/groups/{group}") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public void groupUpdate(@PathVariable long group,@RequestBody OrganizationService.GroupChange request) {service.updateGroup(access.scope(),group,request);}
    @DeleteMapping("/groups/{group}") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public void groupDelete(@PathVariable long group) {service.deleteGroup(access.teacher(),group);}
    @DeleteMapping("/groups/{group}/teachers/{user}") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public void teacherRemove(@PathVariable long group,@PathVariable long user) {service.removeTeacher(access.scope(),group,user);}
    @GetMapping("/profile/identities") public Object identities() {return db.rows("SELECT provider,linked_at FROM external_identities WHERE user_id=?",access.user().getId());}
    public record Token(@NotBlank @Size(max=100) String token) {}
    public record UserId(long userId) {}
    public record Csv(String csv) {}
    public record EmailChange(@Email @NotBlank @Size(max=190) String email,@NotBlank String password) {}
}
