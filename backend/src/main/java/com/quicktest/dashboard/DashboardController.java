package com.quicktest.dashboard;

import com.quicktest.ai.AiUsageRepository;
import com.quicktest.auth.AppUser;
import com.quicktest.auth.AuthService;
import com.quicktest.tests.AttemptRepository;
import com.quicktest.tests.QuizTestRepository;
import com.quicktest.tests.TestStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final AuthService authService;
    private final QuizTestRepository tests;
    private final AttemptRepository attempts;
    private final AiUsageRepository aiUsage;

    public DashboardController(AuthService authService, QuizTestRepository tests, AttemptRepository attempts, AiUsageRepository aiUsage) {
        this.authService = authService;
        this.tests = tests;
        this.attempts = attempts;
        this.aiUsage = aiUsage;
    }

    @GetMapping
    DashboardResponse dashboard(@RequestHeader("Authorization") String authorization) {
        AppUser user = authService.requireUser(authorization);
        return new DashboardResponse(
                tests.countByOwner(user),
                tests.countByOwnerAndStatus(user, TestStatus.PUBLISHED),
                tests.countByOwnerAndStatus(user, TestStatus.DRAFT),
                attempts.countByTestOwnerId(user.getId()),
                aiUsage.countByUser(user)
        );
    }

    public record DashboardResponse(long totalTests, long activeTests, long draftTests, long attempts, long aiGenerations) {}
}
