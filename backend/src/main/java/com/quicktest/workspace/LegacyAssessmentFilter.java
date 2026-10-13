package com.quicktest.workspace;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import com.quicktest.exception.ApiProblems;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;

@Component
public class LegacyAssessmentFilter extends OncePerRequestFilter {
    private final boolean enabled;
    private final ObjectMapper mapper;
    public LegacyAssessmentFilter(@Value("${app.legacy-api.enabled:false}") boolean enabled, ObjectMapper mapper) { this.enabled = enabled; this.mapper=mapper; }
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI();
        if (!enabled && List.of("/api/tests", "/api/public/tests", "/api/student", "/api/dashboard", "/api/ai/generate-test").stream().anyMatch(prefix -> path.equals(prefix) || path.startsWith(prefix + "/"))) {
            ApiProblems.write(response,mapper,410,"legacy_api_retired","Използвайте организационния API /api/v1.");
            return;
        }
        chain.doFilter(request, response);
    }
}
