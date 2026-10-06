package com.quicktest.workspace;

import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class WorkspaceErrors {
    @ExceptionHandler(WorkspaceError.class)
    ProblemDetail domain(WorkspaceError error) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(error.getStatusCode(), error.getReason());
        problem.setProperty("code", error.code());
        return problem;
    }
}
