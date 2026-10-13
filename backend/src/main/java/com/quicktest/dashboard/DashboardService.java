package com.quicktest.dashboard;

import com.quicktest.ai.AiUsageRepository;
import com.quicktest.auth.AppUser;
import com.quicktest.auth.Role;
import com.quicktest.tests.AttemptRepository;
import com.quicktest.tests.QuizTestRepository;
import com.quicktest.tests.TestStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {
    private final QuizTestRepository tests;
    private final AttemptRepository attempts;
    private final AiUsageRepository aiUsage;

    public DashboardService(QuizTestRepository tests, AttemptRepository attempts, AiUsageRepository aiUsage) {
        this.tests = tests;
        this.attempts = attempts;
        this.aiUsage = aiUsage;
    }

    @Transactional(readOnly = true)
    public DashboardResponse dashboard(AppUser user) {
        if (user.getRole() == Role.ADMIN) {
            return new DashboardResponse(tests.count(), tests.countByStatus(TestStatus.PUBLISHED),
                    tests.countByStatus(TestStatus.DRAFT), attempts.count(), aiUsage.count());
        }
        return new DashboardResponse(tests.countByOwner(user), tests.countByOwnerAndStatus(user, TestStatus.PUBLISHED),
                tests.countByOwnerAndStatus(user, TestStatus.DRAFT), attempts.countByTestOwnerId(user.getId()), aiUsage.countByUser(user));
    }
}
