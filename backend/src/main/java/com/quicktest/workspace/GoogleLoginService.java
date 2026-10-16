package com.quicktest.workspace;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AuthService;
import com.quicktest.auth.Role;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class GoogleLoginService {
    private final GoogleIdentityService identity;
    private final boolean enabled;
    private final String backend;

    public GoogleLoginService(GoogleIdentityService identity, @Value("${app.google.enabled:false}") boolean enabled,
                              @Value("${app.backend-url:http://localhost:8080}") String backend) {
        this.identity = identity;
        this.enabled = enabled;
        this.backend = backend.strip().replaceAll("/+$", "");
    }

    public Map<String, Object> config() {
        return Map.of("enabled", enabled, "redirect", backend + "/api/auth/google/redirect", "callback", backend + "/login/oauth2/code/google");
    }

    public void validateRedirect(Role role) {
        if (!enabled) throw WorkspaceError.conflict("Google входът не е конфигуриран.");
        if (role != null && role != Role.STUDENT && role != Role.TEACHER) throw WorkspaceError.validation("Изберете ученик или учител.");
    }

    public Map<String, Object> consumeLink(String link) {
        return identity.consumeLink(link);
    }

    public AuthService.AuthResponse exchange(String token) {
        if (!enabled) throw WorkspaceError.forbidden();
        return identity.exchange(token);
    }

    public Map<String, String> link(AppUser user, String password, String authorization) {
        if (!enabled) throw WorkspaceError.conflict("Google свързването не е конфигурирано.");
        return Map.of("url", backend + "/api/auth/google/redirect?link=" + identity.linkingTicket(user, password, authorization));
    }
}
