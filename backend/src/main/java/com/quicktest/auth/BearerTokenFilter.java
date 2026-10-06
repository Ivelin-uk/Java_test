package com.quicktest.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class BearerTokenFilter extends OncePerRequestFilter {
    private static final Set<String> RECOVERY_PATHS = Set.of("/api/auth/me", "/api/auth/password", "/api/auth/logout", "/api/auth/logout-all");
    private final AuthService auth;
    private final ObjectMapper mapper;

    public BearerTokenFilter(AuthService auth, ObjectMapper mapper) {
        this.auth = auth;
        this.mapper = mapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && !request.getMethod().equals("OPTIONS")) {
            AppUser user;
            try {
                user = auth.requireUser(header);
            } catch (ResponseStatusException exception) {
                error(response, 401, "Сесията е невалидна или потребителят е деактивиран.");
                return;
            }
            String path = request.getRequestURI().substring(request.getContextPath().length());
            if (user.isPasswordChangeRequired() && !RECOVERY_PATHS.contains(path)) {
                error(response, 403, "Първо сменете временната си парола.");
                return;
            }
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(user, null,
                            List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()))));
        }
        chain.doFilter(request, response);
    }

    private void error(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        mapper.writeValue(response.getOutputStream(), Map.of("status", status, "detail", message));
    }
}
