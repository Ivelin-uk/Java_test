package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;

@RestController @RequestMapping("/api/v1/platform") @EndpointPolicy(mode=EndpointPolicy.Mode.ADMIN) @PreAuthorize("hasRole('ADMIN')")
public class PlatformController {
    private final WorkspaceStore db;private final OrgAccess access;private final OrganizationControls controls;private final WorkspaceAudit audit;
    public PlatformController(WorkspaceStore db,OrgAccess access,OrganizationControls controls,WorkspaceAudit audit) {this.db=db;this.access=access;this.controls=controls;this.audit=audit;}
    @GetMapping("/organizations") public Object organizations() {return db.rows("SELECT o.id,o.name,o.organization_type,o.status,o.contact_email,o.created_at,s.status subscription_status,s.paid_through,s.ai_used,s.ai_reserved,p.name plan_name FROM organizations o JOIN organization_subscriptions s ON s.organization_id=o.id JOIN organization_plans p ON p.id=s.plan_id ORDER BY o.id");}
    @PutMapping("/organizations/{id}/status") @Transactional public void status(@PathVariable long id,@RequestBody Status request) {if(!Set.of("active","inactive").contains(request.status()) || request.reason()==null || request.reason().isBlank()) throw WorkspaceError.validation("Нужни са статус и причина.");db.one("SELECT id FROM organizations WHERE id=?",id);db.update("UPDATE organizations SET status=? WHERE id=?",request.status(),id);audit.write(id,access.user().getId(),"organization.status_changed",id,Map.of("status",request.status(),"reason",request.reason()));}
    @GetMapping("/plans") public Object plans() {return db.rows("SELECT p.*,(SELECT stripe_price_id FROM organization_plan_prices x WHERE x.plan_id=p.id AND x.billing_period='month') month_price_id,(SELECT stripe_price_id FROM organization_plan_prices x WHERE x.plan_id=p.id AND x.billing_period='year') year_price_id FROM organization_plans p ORDER BY p.id");}
    @PostMapping("/plans") @Transactional public void createPlan(@RequestBody OrganizationControls.Plan request) {controls.plan(null,request);audit.write(null,access.user().getId(),"plan.created",null,Map.of("name",request.name()));}
    @PutMapping("/plans/{id}") @Transactional public void plan(@PathVariable long id,@RequestBody OrganizationControls.Plan request) {controls.plan(id,request);audit.write(null,access.user().getId(),"plan.updated",id,Map.of("name",request.name()));}
    @GetMapping("/support/{org}") public Object support(@PathVariable long org) {controls.supportAccess(access.user().getId(),org);return db.rows("SELECT a.id,a.status,a.attempt_number,a.student_id,v.title,a.started_at,a.submitted_at FROM exam_attempts a JOIN exam_assignments x ON x.organization_id=a.organization_id AND x.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=x.organization_id AND v.id=x.version_id WHERE a.organization_id=? ORDER BY a.id DESC LIMIT 100",org);}
    @GetMapping("/support/{org}/attempts/{id}") public Object supportAttempt(@PathVariable long org,@PathVariable long id) {controls.supportAccess(access.user().getId(),org);db.one("SELECT id FROM exam_attempts WHERE organization_id=? AND id=?",org,id);return Map.of("questions",db.rows("SELECT id,status,definition_json,draft_json,answer_json,final_points,teacher_comment FROM attempt_questions WHERE organization_id=? AND attempt_id=? ORDER BY position_index",org,id),"events",db.rows("SELECT event_type,question_id,received_at FROM exam_events WHERE organization_id=? AND attempt_id=? ORDER BY id",org,id));}
    public record Status(String status,String reason) {}
}
