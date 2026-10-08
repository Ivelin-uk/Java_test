package com.quicktest.workspace;

import com.quicktest.auth.AppUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class OrgAccess {
    private final WorkspaceStore db;
    private final HttpServletRequest request;
    private final PersonalWorkspace personal;
    public OrgAccess(WorkspaceStore db, HttpServletRequest request, PersonalWorkspace personal) { this.db = db; this.request = request; this.personal = personal; }
    public AppUser user() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AppUser user)) throw WorkspaceError.forbidden();
        return user;
    }
    public Scope scope() {
        String selected = request.getHeader("X-Organization-Id");
        if (selected == null) {
            var resource=java.util.regex.Pattern.compile("^/api/v1/(tests|assignments|attempts|results|grading|groups|question-bank|files|ai/test-generations)/([1-9][0-9]{0,17})(?:/.*)?$").matcher(request.getRequestURI());
            long id=personal.workspace(user());
            if(resource.matches()) {
                String table=switch(resource.group(1)) {
                    case "tests" -> "workspace_assessments";
                    case "assignments" -> "exam_assignments";
                    case "groups" -> "learning_groups";
                    case "question-bank" -> "question_bank_items";
                    case "files" -> "private_images";
                    case "ai/test-generations" -> "workspace_ai_jobs";
                    default -> "exam_attempts";
                };
                id=WorkspaceStore.number(db.one("SELECT organization_id FROM "+table+" WHERE id=?",Long.parseLong(resource.group(2))),"organization_id");
            }
            return new Scope(id,user().getId(),Set.of(user().getRole().name()),true);
        }
        if (!selected.matches("[1-9][0-9]{0,17}")) throw WorkspaceError.forbidden();
        long id = Long.parseLong(selected);
        var membership = db.optional("SELECT m.*,o.name,o.status organization_status FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND o.status='active'", id, user().getId()).orElseThrow(WorkspaceError::forbidden);
        String[] roles = db.parse(membership.get("roles_json"), String[].class);
        return new Scope(id, user().getId(), Set.copyOf(Arrays.asList(roles)));
    }
    public Scope teacher() {
        Scope scope = scope();
        if (!scope.roles.contains("TEACHER")) throw WorkspaceError.forbidden();
        return scope;
    }
    public Scope admin() {
        Scope scope = scope();
        if (!scope.roles.contains("ORG_ADMIN")) throw WorkspaceError.forbidden();
        return scope;
    }
    public Scope student() {
        Scope scope = scope();
        if (!scope.roles.contains("STUDENT")) throw WorkspaceError.forbidden();
        return scope;
    }
    public String authSession() { return request.getHeader("Authorization"); }
    public String remoteAddress() { return request.getRemoteAddr(); }
    public Scope version(long version) {
        Scope scope=teacher();
        if(!scope.platform()) return scope;
        long workspace=WorkspaceStore.number(db.one("SELECT organization_id FROM assessment_versions WHERE id=?",version),"organization_id");
        return new Scope(workspace,scope.userId(),scope.roles(),true);
    }
    public record Scope(long organizationId, long userId, Set<String> roles, boolean platform) {
        public Scope(long organizationId,long userId,Set<String> roles) {this(organizationId,userId,roles,false);}
    }
}
