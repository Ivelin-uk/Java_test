package com.quicktest.exception;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.util.LinkedHashMap;

public final class ApiProblems {
    private ApiProblems() {}

    public static String code(int status) {
        return switch (status) {
            case 400 -> "validation";
            case 401 -> "unauthorized";
            case 403 -> "forbidden";
            case 404 -> "not_found";
            case 405 -> "method_not_allowed";
            case 409 -> "conflict";
            case 410 -> "expired";
            case 415 -> "unsupported_media_type";
            case 429 -> "rate_limit";
            case 503 -> "service_unavailable";
            case 504 -> "timeout";
            default -> status >= 500 ? "internal_error" : "request_error";
        };
    }

    public static ProblemDetail create(HttpStatusCode status, String code, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(URI.create("about:blank"));
        problem.setProperty("code", code);
        return problem;
    }

    public static void write(HttpServletResponse response, ObjectMapper mapper, int status, String detail) throws IOException {
        write(response, mapper, status, code(status), detail);
    }

    public static void write(HttpServletResponse response, ObjectMapper mapper, int status, String code, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json;charset=UTF-8");
        var problem = create(HttpStatusCode.valueOf(status), code, detail);
        var body = new LinkedHashMap<String, Object>();
        body.put("type", problem.getType().toString());
        body.put("title", problem.getTitle());
        body.put("status", problem.getStatus());
        body.put("detail", problem.getDetail());
        body.putAll(problem.getProperties());
        mapper.writeValue(response.getOutputStream(), body);
    }
}
