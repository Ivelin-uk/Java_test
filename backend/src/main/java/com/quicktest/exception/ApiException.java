package com.quicktest.exception;

import org.springframework.http.HttpStatusCode;
import org.springframework.web.server.ResponseStatusException;

public class ApiException extends ResponseStatusException {
    private final String code;

    public ApiException(HttpStatusCode status, String detail) {
        this(status, ApiProblems.code(status.value()), detail);
    }

    public ApiException(HttpStatusCode status, String code, String detail) {
        super(status, detail);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
