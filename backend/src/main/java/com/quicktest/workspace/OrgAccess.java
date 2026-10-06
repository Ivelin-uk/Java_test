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
    public OrgAccess(WorkspaceStore db, HttpServletRequest request) { this.db = db; this.request = request; }
    public AppUser user() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AppUser user)) throw WorkspaceError.forbidden();
        return user;
    }
    public Scope scope() {
        String selected = request.getHeader("X-Organization-Id");
        if (selected == null || !selected.matches("[1-9][0-9]{0,17}"))
            throw WorkspaceError.conflict("Изберете активна организация.");
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
    public record Scope(long organizationId, long userId, Set<String> roles) {}
}
