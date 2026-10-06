package com.quicktest.tests;

import com.quicktest.access.EndpointPolicy;
import com.quicktest.auth.AuthService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/student")
public class StudentController {
    private final QuizService quizzes;
    private final AuthService auth;

    public StudentController(QuizService quizzes, AuthService auth) {
        this.quizzes = quizzes;
        this.auth = auth;
    }

    @GetMapping("/tests")
    @EndpointPolicy(student = true)
    @PreAuthorize("@permissions.check(authentication, 'StudentController.catalog')")
    public List<QuizDtos.TestSummary> catalog() { return quizzes.catalog(); }

    @GetMapping("/results")
    @EndpointPolicy(student = true)
    @PreAuthorize("@permissions.check(authentication, 'StudentController.results')")
    public List<QuizDtos.CreatorResult> results(@RequestHeader("Authorization") String authorization) {
        return quizzes.myResults(auth.requireUser(authorization));
    }
}
