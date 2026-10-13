package com.quicktest.workspace;

import com.quicktest.workspace.repository.WorkspaceAccessRepository;

import com.quicktest.auth.AppUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class OrgAccess {
    private final WorkspaceJson json;
    private final WorkspaceAccessRepository repository;
    private final HttpServletRequest request;
    private final PersonalWorkspace personal;
    public OrgAccess(WorkspaceAccessRepository repository,WorkspaceJson json, HttpServletRequest request, PersonalWorkspace personal) { this.repository = repository;this.json=json; this.request = request; this.personal = personal; }
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
                id=WorkspaceValues.number(repository.requireResourceWorkspace(resource.group(1), Long.parseLong(resource.group(2))),"organization_id");
            }
            return new Scope(id,user().getId(),Set.of(user().getRole().name()),true);
        }
        if (!selected.matches("[1-9][0-9]{0,17}")) throw WorkspaceError.forbidden();
        long id = Long.parseLong(selected);
        var membership = repository.findActiveMembership(id, user().getId()).orElseThrow(WorkspaceError::forbidden);
        String[] roles = json.parse(membership.get("roles_json"), String[].class);
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
        long workspace=WorkspaceValues.number(repository.requireVersionWorkspace(version),"organization_id");
        return new Scope(workspace,scope.userId(),scope.roles(),true);
    }
    public record Scope(long organizationId, long userId, Set<String> roles, boolean platform) {
        public Scope(long organizationId,long userId,Set<String> roles) {this(organizationId,userId,roles,false);}
    }
}
