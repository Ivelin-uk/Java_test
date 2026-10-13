package com.quicktest.workspace;

import org.springframework.http.HttpStatus;
import com.quicktest.exception.ApiException;

public class WorkspaceError extends ApiException {
    public WorkspaceError(HttpStatus status, String code, String detail) {
        super(status, code, detail);
    }
    public static WorkspaceError validation(String detail) { return new WorkspaceError(HttpStatus.BAD_REQUEST, "validation", detail); }
    public static WorkspaceError forbidden() { return new WorkspaceError(HttpStatus.FORBIDDEN, "forbidden", "Нямате достъп до този ресурс."); }
    public static WorkspaceError notFound() { return new WorkspaceError(HttpStatus.NOT_FOUND, "not_found", "Ресурсът не е намерен."); }
    public static WorkspaceError conflict(String detail) { return new WorkspaceError(HttpStatus.CONFLICT, "conflict", detail); }
    public static WorkspaceError expired(String detail) { return new WorkspaceError(HttpStatus.GONE, "expired", detail); }
}
