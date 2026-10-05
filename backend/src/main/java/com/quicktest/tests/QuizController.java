package com.quicktest.tests;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AuthService;
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
    List<QuizDtos.TestSummary> list(@RequestHeader("Authorization") String authorization) {
        return quizService.list(authService.requireUser(authorization));
    }

    @PostMapping("/tests")
    QuizDtos.TestDetail create(@RequestHeader("Authorization") String authorization, @Valid @RequestBody QuizDtos.TestRequest request) {
        return quizService.create(authService.requireUser(authorization), request);
    }

    @GetMapping("/tests/{id}")
    QuizDtos.TestDetail get(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        return quizService.get(authService.requireUser(authorization), id);
    }

    @PutMapping("/tests/{id}")
    QuizDtos.TestDetail update(@RequestHeader("Authorization") String authorization, @PathVariable Long id, @Valid @RequestBody QuizDtos.TestRequest request) {
        return quizService.update(authService.requireUser(authorization), id, request);
    }

    @DeleteMapping("/tests/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@RequestHeader(value = "Authorization", required = false) String authorization, @PathVariable Long id) {
        quizService.delete(authService.requireUser(authorization), id);
    }

    @PostMapping("/tests/{id}/publish")
    QuizDtos.PublishResponse publish(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        AppUser owner = authService.requireUser(authorization);
        return quizService.publish(owner, id);
    }

    @GetMapping("/tests/results")
    List<QuizDtos.CreatorResult> allResults(@RequestHeader("Authorization") String authorization) {
        return quizService.results(authService.requireUser(authorization), null);
    }

    @GetMapping("/tests/{id}/results")
    List<QuizDtos.CreatorResult> testResults(@RequestHeader("Authorization") String authorization, @PathVariable Long id) {
        return quizService.results(authService.requireUser(authorization), id);
    }

    @GetMapping("/public/tests/{code}")
    QuizDtos.PublicTest publicTest(@PathVariable String code) {
        return quizService.publicTest(code);
    }

    @PostMapping("/public/tests/{code}/attempts")
    QuizDtos.AttemptResult submit(@PathVariable String code, @Valid @RequestBody QuizDtos.SubmitAttemptRequest request) {
        return quizService.submit(code, request);
    }
}
