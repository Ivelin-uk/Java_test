package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import com.quicktest.auth.Role;
import jakarta.servlet.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;

@RestController
public class GoogleController {
    private final GoogleLoginService service;private final OrgAccess access;
    public GoogleController(GoogleLoginService service,OrgAccess access) {this.service=service;this.access=access;}
    @GetMapping("/api/auth/google/config") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public Object config() {return service.config();}
    @GetMapping("/api/auth/google/redirect") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public void redirect(@RequestParam(required=false) String link,@RequestParam(required=false) Role role,HttpServletRequest request,HttpServletResponse response) throws IOException {
        service.validateRedirect(role);
        var session=request.getSession();session.removeAttribute("examai.google.linkUser");session.removeAttribute("examai.google.sourceSessionHash");
        session.setAttribute("examai.google.registrationRole",role);
        if(link!=null) {var ticket=service.consumeLink(link);session.setAttribute("examai.google.linkUser",ticket.get("user"));session.setAttribute("examai.google.sourceSessionHash",ticket.get("sessionHash"));}
        response.setHeader("Referrer-Policy","no-referrer");response.sendRedirect("/oauth2/authorization/google");
    }
    @PostMapping("/api/auth/google/exchange") @EndpointPolicy(mode=EndpointPolicy.Mode.PUBLIC)
    public Object exchange(@RequestBody OrganizationController.Token request) {return service.exchange(request.token());}
    @PostMapping("/api/v1/profile/google/link") @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public Object link(@RequestBody Password request) {
        return service.link(access.user(),request.password(),access.authSession());
    }
    public record Password(String password) {}
}
