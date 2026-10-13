package com.quicktest.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.Map;
import java.util.Objects;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ProblemDetail application(ApiException error) {
        return ApiProblems.create(error.getStatusCode(), error.code(), Objects.toString(error.getReason(), "Неуспешна заявка."));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail status(ResponseStatusException error) {
        return ApiProblems.create(error.getStatusCode(), ApiProblems.code(error.getStatusCode().value()), Objects.toString(error.getReason(), "Неуспешна заявка."));
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException error, HttpHeaders headers,
                                                                  HttpStatusCode status, WebRequest request) {
        var problem = ApiProblems.create(status, "validation", "Невалидни данни в заявката.");
        problem.setProperty("errors", error.getBindingResult().getFieldErrors().stream()
                .map(field -> Map.of("field", field.getField(), "message", Objects.toString(field.getDefaultMessage(), "Невалидна стойност."))).toList());
        return handleExceptionInternal(error, problem, headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException error, HttpHeaders headers,
                                                                 HttpStatusCode status, WebRequest request) {
        return handleExceptionInternal(error, ApiProblems.create(status, "validation", "Невалиден JSON или тип на поле в заявката."), headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception error, Object body, HttpHeaders headers,
                                                              HttpStatusCode status, WebRequest request) {
        if (body instanceof ProblemDetail problem) {
            if (problem.getProperties() == null || !problem.getProperties().containsKey("code")) problem.setProperty("code", ApiProblems.code(status.value()));
        } else {
            body = ApiProblems.create(status, ApiProblems.code(status.value()), "Заявката не може да бъде обработена.");
        }
        return super.handleExceptionInternal(error, body, headers, status, request);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail denied(AccessDeniedException error) {
        return ApiProblems.create(HttpStatus.FORBIDDEN, "forbidden", "Нямате право за това действие.");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail conflict(DataIntegrityViolationException error) {
        return ApiProblems.create(HttpStatus.CONFLICT, "conflict", "Промяната противоречи на съществуващи данни. Обновете страницата и опитайте отново.");
    }

    @ExceptionHandler({DataAccessException.class, Exception.class})
    public ProblemDetail unexpected(Exception error) {
        log.error("Unhandled API exception", error);
        return ApiProblems.create(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "Възникна вътрешна грешка. Опитайте отново.");
    }
}
