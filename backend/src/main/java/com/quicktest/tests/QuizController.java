package com.quicktest.tests;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AuthService;
import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class QuizController {
    private final AuthService authService;
    private final QuizService quizService;

    public QuizController(AuthService authService, QuizService quizService) {
        this.authService = authService;
        this.quizService = quizService;
    }

    @GetMapping("/tests")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.list')")
    public List<QuizDtos.TestSummary> list(@RequestHeader("Authorization") String authorization) {
        return quizService.list(authService.requireUser(authorization));
    }

    @PostMapping("/tests")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.create')")
    public QuizDtos.TestDetail create(@RequestHeader("Authorization") String authorization, @Valid @RequestBody QuizDtos.TestRequest request) {
        return quizService.create(authService.requireUser(authorization), request);
    }

    @GetMapping("/tests/{id}")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.get')")
    public QuizDtos.TestDetail get(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        return quizService.get(authService.requireUser(authorization), id);
    }

    @PutMapping("/tests/{id}")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.update')")
    public QuizDtos.TestDetail update(@RequestHeader("Authorization") String authorization, @PathVariable Long id, @Valid @RequestBody QuizDtos.TestRequest request) {
        return quizService.update(authService.requireUser(authorization), id, request);
    }

    @DeleteMapping("/tests/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.delete')")
    public void delete(@RequestHeader(value = "Authorization", required = false) String authorization, @PathVariable Long id) {
        quizService.delete(authService.requireUser(authorization), id);
    }

    @PostMapping("/tests/{id}/publish")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.publish')")
    public QuizDtos.PublishResponse publish(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        AppUser owner = authService.requireUser(authorization);
        return quizService.publish(owner, id);
    }

    @GetMapping("/tests/results")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.allResults')")
    public List<QuizDtos.CreatorResult> allResults(@RequestHeader("Authorization") String authorization) {
        return quizService.results(authService.requireUser(authorization), null);
    }

    @GetMapping("/tests/{id}/results")
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'QuizController.testResults')")
    public List<QuizDtos.CreatorResult> testResults(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        return quizService.results(authService.requireUser(authorization), id);
    }

    @GetMapping("/public/tests/{code}")
    @EndpointPolicy(student = true)
    @PreAuthorize("@permissions.check(authentication, 'QuizController.publicTest')")
    public QuizDtos.PublicTest publicTest(@PathVariable String code) {
        return quizService.publicTest(code);
    }

    @PostMapping("/public/tests/{code}/attempts")
    @EndpointPolicy(student = true)
    @PreAuthorize("@permissions.check(authentication, 'QuizController.submit')")
    public QuizDtos.AttemptResult submit(@RequestHeader("Authorization") String authorization, @PathVariable String code,
                                         @Valid @RequestBody QuizDtos.SubmitAttemptRequest request) {
        return quizService.submit(code, request, authService.requireUser(authorization));
    }
}
