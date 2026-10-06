package com.quicktest.workspace;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.List;

@Component
public class LegacyAssessmentFilter extends OncePerRequestFilter {
    private final boolean enabled;
    public LegacyAssessmentFilter(@Value("${app.legacy-api.enabled:false}") boolean enabled) { this.enabled = enabled; }
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI();
        if (!enabled && List.of("/api/tests", "/api/public/tests", "/api/student", "/api/dashboard", "/api/ai/generate-test").stream().anyMatch(prefix -> path.equals(prefix) || path.startsWith(prefix + "/"))) {
            response.setStatus(410); response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"legacy_api_retired\",\"detail\":\"Използвайте организационния API /api/v1.\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
