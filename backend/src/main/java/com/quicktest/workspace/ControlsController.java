package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/api/v1") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,teacher=false,student=false) @PreAuthorize("isAuthenticated()")
public class ControlsController {
    private final OrgAccess access;private final OrganizationControls controls;private final TenantPermissions permissions;private final WorkspaceStore db;private final RetentionService retention;
    public ControlsController(OrgAccess access,OrganizationControls controls,TenantPermissions permissions,WorkspaceStore db,RetentionService retention) {this.access=access;this.controls=controls;this.permissions=permissions;this.db=db;this.retention=retention;}
    @GetMapping("/retention/preview") public Object retentionPreview() {return retention.preview(access.admin());}
    @PostMapping("/retention/run") public Object retentionRun(@RequestBody RetentionService.Request request) {return retention.run(access.admin(),request);}
    @GetMapping("/settings") public Object settings() {return controls.settings(access.admin());}
    @PutMapping("/settings") public void settingsSave(@RequestBody OrganizationControls.Settings request) {controls.settings(access.admin(),request);}
    @GetMapping("/permissions") public Object permissions() {return permissions.matrix(access.admin());}
    @PutMapping("/permissions") public void permission(@RequestBody TenantPermissions.Change request) {permissions.update(access.admin(),request);}
    @GetMapping("/metrics") public Object metrics() {return controls.metrics(access.admin().organizationId());}
    @GetMapping("/export") public Object export() {return controls.export(access.admin());}
    @GetMapping("/support-grants") public Object support() {return db.rows("SELECT g.*,u.name administrator FROM support_grants g JOIN users u ON u.id=g.administrator_id WHERE g.organization_id=? ORDER BY g.id DESC",access.admin().organizationId());}
    @GetMapping("/support-administrators") public Object administrators() {access.admin();return db.rows("SELECT id,name FROM users WHERE role='ADMIN' AND active=TRUE ORDER BY name");}
    @PostMapping("/support-grants") public Object grant(@RequestBody OrganizationControls.Support request) {return controls.support(access.admin(),request);}
    @DeleteMapping("/support-grants/{id}") public void revoke(@PathVariable long id) {controls.revokeSupport(access.admin(),id);}
}
