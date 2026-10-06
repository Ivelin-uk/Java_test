package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.Map;

@RestController
public class GoogleController {
    private final GoogleIdentityService identity;private final OrgAccess access;private final boolean enabled;private final String backend;
    public GoogleController(GoogleIdentityService identity,OrgAccess access,@Value("${app.google.enabled:false}") boolean enabled,@Value("${app.backend-url:http://localhost:8080}") String backend) {this.identity=identity;this.access=access;this.enabled=enabled;this.backend=backend;}
    @GetMapping("/api/auth/google/config") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public Object config() {return Map.of("enabled",enabled,"redirect",backend+"/api/auth/google/redirect");}
    @GetMapping("/api/auth/google/redirect") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public void redirect(@RequestParam(required=false) String link,HttpServletRequest request,HttpServletResponse response) throws IOException {
        if(!enabled) throw WorkspaceError.conflict("Google входът не е конфигуриран.");
        var session=request.getSession();session.removeAttribute("examai.google.linkUser");session.removeAttribute("examai.google.sourceSessionHash");
        if(link!=null) {var ticket=identity.consumeLink(link);session.setAttribute("examai.google.linkUser",ticket.get("user"));session.setAttribute("examai.google.sourceSessionHash",ticket.get("sessionHash"));}
        response.setHeader("Referrer-Policy","no-referrer");response.sendRedirect("/oauth2/authorization/google");
    }
    @PostMapping("/api/auth/google/exchange") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public Object exchange(@RequestBody OrganizationController.Token request) {if(!enabled) throw WorkspaceError.forbidden();return identity.exchange(request.token());}
    @PostMapping("/api/v1/profile/google/link") @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public Object link(@RequestBody Password request) {
        if(!enabled) throw WorkspaceError.conflict("Google свързването не е конфигурирано.");
        return Map.of("url",backend+"/api/auth/google/redirect?link="+identity.linkingTicket(access.user(),request.password(),access.authSession()));
    }
    public record Password(String password) {}
}
