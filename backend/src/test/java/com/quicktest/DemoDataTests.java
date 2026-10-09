package com.quicktest;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.Role;
import com.quicktest.demo.DemoData;
import com.quicktest.tests.Difficulty;
import com.quicktest.tests.QuestionType;
import com.quicktest.tests.QuizDtos;
import com.quicktest.tests.QuizService;
import com.quicktest.tests.QuizTestRepository;
import com.quicktest.workspace.WorkspaceDemo;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = {
        "app.demo-seed=true",
        "app.workspace.demo-seed=true",
        "spring.datasource.url=jdbc:h2:mem:demo_seed;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE"
})
@Transactional
class DemoDataTests {
    private static final List<String> EMPTY_TABLES = List.of(
            "tests", "question", "answer", "attempt", "attempt_answer", "ai_usage", "auth_token",
            "organizations", "memberships", "personal_workspaces", "organization_subscriptions",
            "learning_groups", "group_teachers", "group_members", "organization_invitations",
            "workspace_assessments", "assessment_versions", "assessment_library_removals",
            "exam_assignments", "assignment_recipients", "assignment_teachers", "assignment_code_deliveries",
            "exam_attempts", "attempt_questions", "exam_events", "result_revisions",
            "notification_addresses", "identity_challenges", "notification_outbox", "external_identities",
            "workspace_audit", "admin_audit", "workspace_conversations", "conversation_members",
            "workspace_messages", "message_blocks", "message_reports", "realtime_tickets",
            "workspace_ai_jobs", "workspace_rate_limits", "workspace_billing_events",
            "private_images", "question_bank_items", "profile_exam_locks", "retention_runs",
            "organization_quota_locks", "organization_retention_locks", "tenant_endpoint_permissions",
            "stripe_checkout_requests", "stripe_subscription_bindings", "support_grants"
    );
    private static final Map<String, Role> ACCOUNTS = Map.of(
            "admin@quicktest.local", Role.ADMIN,
            "teacher@quicktest.local", Role.TEACHER,
            "student@quicktest.local", Role.STUDENT,
            "student2@quicktest.local", Role.STUDENT
    );

    @Autowired DemoData demoData;
    @Autowired WorkspaceDemo workspaceDemo;
    @Autowired AppUserRepository users;
    @Autowired QuizTestRepository tests;
    @Autowired QuizService quizService;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;

    @Test
    void startupCreatesOnlyFourEmptyAccounts() {
        assertEquals(ACCOUNTS, users.findAll().stream()
                .collect(Collectors.toMap(AppUser::getEmail, AppUser::getRole)));
        assertEquals(4L, count("users"));
        for (String table : EMPTY_TABLES) assertEquals(0L, count(table), table);
        for (AppUser user : users.findAll()) {
            assertTrue(user.isActive());
            assertNotNull(user.getEmailVerifiedAt());
            assertTrue(passwordEncoder.matches("password123", user.getPasswordHash()));
            if (user.getRole() == Role.STUDENT) assertFalse(user.isSubscriptionPaid());
        }
        assertEquals(16, flyway.info().applied().length);
        assertEquals("16", flyway.info().current().getVersion().toString());
        assertEquals(1L, count("demo_seed_history"));
        assertEquals(3L, count("organization_plans"));
        assertTrue(count("endpoint_permission") > 0);
        assertEquals(0, flyway.migrate().migrationsExecuted);
    }

    @Test
    void repeatedStartupPreservesProfilesAndUserCreatedContent() {
        AppUser teacher = users.findByEmailIgnoreCase("teacher@quicktest.local").orElseThrow();
        teacher.setName("Renamed Teacher");
        teacher.setPasswordHash(passwordEncoder.encode("changed-password"));
        AppUser additional = new AppUser();
        additional.setName("Registered later");
        additional.setEmail("registered@example.test");
        additional.setPasswordHash(passwordEncoder.encode("password123"));
        users.saveAndFlush(additional);
        var test = quizService.create(teacher, new QuizDtos.TestRequest(
                "User-created test", "", "Bulgarian", 10, false, false, true, true,
                List.of(new QuizDtos.QuestionRequest(QuestionType.SINGLE_CHOICE, "2 + 2?",
                        Difficulty.EASY, 1, "", List.of(
                        new QuizDtos.AnswerRequest("4", true), new QuizDtos.AnswerRequest("5", false)))))
        );
        tests.flush();
        Map<String, Long> before = rowCounts();

        restartSeed();
        restartSeed();

        assertEquals(before, rowCounts());
        assertEquals("Renamed Teacher", users.findById(teacher.getId()).orElseThrow().getName());
        assertTrue(passwordEncoder.matches("changed-password", teacher.getPasswordHash()));
        assertEquals("User-created test", tests.findById(test.id()).orElseThrow().getTitle());
        assertTrue(users.findByEmailIgnoreCase(additional.getEmail()).isPresent());
    }

    @Test
    void deletedDemoAccountIsNotRecreatedOnRestart() {
        AppUser student = users.findByEmailIgnoreCase("student2@quicktest.local").orElseThrow();
        users.delete(student);
        users.flush();

        restartSeed();

        assertTrue(users.findByEmailIgnoreCase("student2@quicktest.local").isEmpty());
        assertEquals(3L, count("users"));
        for (String table : EMPTY_TABLES) assertEquals(0L, count(table), table);
    }

    @Test
    void upgradingLegacySeedDoesNotOverwriteExistingAccounts() {
        jdbc.update("DELETE FROM demo_seed_history");
        for (String key : List.of("default-demo-v1", "admin-roles-demo-v1", "examai-workspaces-v1")) {
            jdbc.update("INSERT INTO demo_seed_history(seed_key,created_at) VALUES(?,CURRENT_TIMESTAMP)", key);
        }
        AppUser teacher = users.findByEmailIgnoreCase("teacher@quicktest.local").orElseThrow();
        teacher.setName("Existing Teacher");
        teacher.setPasswordHash(passwordEncoder.encode("existing-password"));
        users.flush();

        restartSeed();
        restartSeed();

        assertEquals(4L, count("users"));
        assertEquals(4L, count("demo_seed_history"));
        assertEquals("Existing Teacher", teacher.getName());
        assertTrue(passwordEncoder.matches("existing-password", teacher.getPasswordHash()));
        for (String table : EMPTY_TABLES) assertEquals(0L, count(table), table);
    }

    private void restartSeed() {
        demoData.run();
        workspaceDemo.run();
    }

    private long count(String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
    }

    private Map<String, Long> rowCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String table : EMPTY_TABLES) counts.put(table, count(table));
        for (String table : List.of("users", "organization_plans", "demo_seed_history")) {
            counts.put(table, count(table));
        }
        return counts;
    }
}
