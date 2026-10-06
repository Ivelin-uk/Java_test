package com.quicktest.workspace;

import com.quicktest.access.*;
import jakarta.servlet.http.*;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.*;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Component
public class TenantPermissions implements HandlerInterceptor {
    private final EndpointCatalog catalog; private final OrgAccess access; private final WorkspaceStore db; private final WorkspaceAudit audit;
    public TenantPermissions(EndpointCatalog catalog,OrgAccess access,WorkspaceStore db,WorkspaceAudit audit) {this.catalog=catalog;this.access=access;this.db=db;this.audit=audit;}
    public boolean allowed(OrgAccess.Scope scope,EndpointCatalog.Endpoint endpoint,String role) {
        boolean baseline=role.equals("TEACHER")?endpoint.teacher():endpoint.student();
        return baseline && db.optional("SELECT allowed FROM tenant_endpoint_permissions WHERE organization_id=? AND endpoint_key=? AND role=?",scope.organizationId(),endpoint.key(),role).map(row->flag(row,"allowed")).orElse(true);
    }
    @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler) {
        if(!(handler instanceof HandlerMethod method) || request.getMethod().equals("OPTIONS")) return true;
        var endpoint=catalog.get(method.getBeanType().getSimpleName()+"."+method.getMethod().getName());
        if(endpoint==null || endpoint.mode()!=EndpointPolicy.Mode.TENANT) return true;
        var scope=access.scope();
        if(scope.roles().contains("ORG_ADMIN")) return true;
        if(scope.roles().stream().noneMatch(role->allowed(scope,endpoint,role))) throw WorkspaceError.forbidden();
        return true;
    }
    public Object matrix(OrgAccess.Scope scope) {
        return catalog.all().stream().filter(e->e.mode()==EndpointPolicy.Mode.TENANT).map(e->Map.of("key",e.key(),"controller",e.controller(),"method",e.method(),"paths",e.paths(),"httpMethods",e.httpMethods(),"teacher",allowed(scope,e,"TEACHER"),"student",allowed(scope,e,"STUDENT"),"teacherAvailable",e.teacher(),"studentAvailable",e.student())).toList();
    }
    @Transactional public void update(OrgAccess.Scope scope,Change change) {
        var endpoint=catalog.get(change.key());
        if(endpoint==null || endpoint.mode()!=EndpointPolicy.Mode.TENANT || !Set.of("TEACHER","STUDENT").contains(change.role())) throw WorkspaceError.validation("Невалиден метод или роля.");
        if(change.allowed() && !(change.role().equals("TEACHER")?endpoint.teacher():endpoint.student())) throw WorkspaceError.forbidden();
        db.update("INSERT INTO tenant_endpoint_permissions(organization_id,endpoint_key,role,allowed) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE allowed=VALUES(allowed)",scope.organizationId(),change.key(),change.role(),change.allowed());
        audit.write(scope.organizationId(),scope.userId(),"permission.changed",null,Map.of("key",change.key(),"role",change.role(),"allowed",change.allowed()));
    }
    public record Change(String key,String role,boolean allowed) {}
    @Configuration static class Registration implements WebMvcConfigurer {
        private final TenantPermissions permissions;
        Registration(TenantPermissions permissions) {this.permissions=permissions;}
        @Override public void addInterceptors(InterceptorRegistry registry) {registry.addInterceptor(permissions).addPathPatterns("/api/v1/**");}
    }
}
