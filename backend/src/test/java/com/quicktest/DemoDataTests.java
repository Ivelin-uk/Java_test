package com.quicktest;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.demo.DemoData;
import com.quicktest.tests.QuestionType;
import com.quicktest.tests.QuizService;
import com.quicktest.tests.QuizTest;
import com.quicktest.tests.QuizTestRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = {
        "app.demo-seed=true",
        "spring.datasource.url=jdbc:h2:mem:demo_seed;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE"
})
@Transactional
class DemoDataTests {
    private static final List<String> TABLES = List.of(
            "users", "tests", "question", "answer", "attempt", "attempt_answer", "ai_usage", "auth_token"
    );

    @Autowired
    DemoData demoData;

    @Autowired
    AppUserRepository users;

    @Autowired
    QuizTestRepository tests;

    @Autowired
    QuizService quizService;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    Flyway flyway;

    @Test
    void startupMigratesAndPopulatesEveryTable() {
        assertEquals(Map.of(
                "users", 4L, "tests", 4L, "question", 14L, "answer", 37L,
                "attempt", 6L, "attempt_answer", 24L, "ai_usage", 2L, "auth_token", 4L
        ), rowCounts());
        assertEquals(3, flyway.info().applied().length);
        assertEquals("3", flyway.info().current().getVersion().toString());
        assertEquals(2L, jdbc.queryForObject("SELECT COUNT(*) FROM demo_seed_history", Long.class));
        assertTrue(jdbc.queryForObject("SELECT COUNT(*) FROM endpoint_permission", Long.class) > 0);
        assertEquals("ADMIN", users.findByEmailIgnoreCase("admin@quicktest.local").orElseThrow().getRole().name());
        assertEquals("TEACHER", users.findByEmailIgnoreCase("teacher@quicktest.local").orElseThrow().getRole().name());
        assertEquals("STUDENT", users.findByEmailIgnoreCase("student@quicktest.local").orElseThrow().getRole().name());
        assertEquals(0, flyway.migrate().migrationsExecuted);

        for (String email : List.of("demo@quicktest.local", "teacher@quicktest.local", "student@quicktest.local")) {
            AppUser user = users.findByEmailIgnoreCase(email).orElseThrow();
            assertTrue(passwordEncoder.matches("password123", user.getPasswordHash()));
        }
        Set<String> types = Set.copyOf(jdbc.queryForList("SELECT DISTINCT type FROM question", String.class));
        assertEquals(Arrays.stream(QuestionType.values()).map(Enum::name).collect(Collectors.toSet()), types);
        assertEquals(5, quizService.publicTest("demojava").questions().size());
        assertEquals(3, quizService.publicTest("demosql").questions().size());
        assertEquals(3, quizService.publicTest("democollections").questions().size());
        ResponseStatusException error = assertThrows(ResponseStatusException.class,
                () -> quizService.publicTest("demodraft"));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
    }

    @Test
    void repeatedStartupKeepsExistingDataAndDoesNotDuplicateRows() {
        Map<String, Long> before = rowCounts();
        AppUser creator = users.findByEmailIgnoreCase("demo@quicktest.local").orElseThrow();
        creator.setName("Renamed Creator");
        creator.setPasswordHash(passwordEncoder.encode("changed-password"));
        QuizTest published = tests.findByPublicCode("demojava").orElseThrow();
        published.setTitle("Edited published test");
        QuizTest draft = tests.findByPublicCode("demodraft").orElseThrow();
        draft.setTitle("Edited draft");

        demoData.run();
        demoData.run();

        assertEquals(before, rowCounts());
        assertEquals("Renamed Creator", creator.getName());
        assertTrue(passwordEncoder.matches("changed-password", creator.getPasswordHash()));
        assertEquals("Edited published test", published.getTitle());
        assertEquals("Edited draft", draft.getTitle());
    }

    @Test
    void deletingDemoTestDoesNotRecreateItOnNextStartup() {
        AppUser creator = users.findByEmailIgnoreCase("demo@quicktest.local").orElseThrow();
        QuizTest test = tests.findByPublicCode("demojava").orElseThrow();
        quizService.delete(creator, test.getId());
        tests.flush();

        demoData.run();

        assertTrue(tests.findByPublicCode("demojava").isEmpty());
        assertEquals(3L, jdbc.queryForObject("SELECT COUNT(*) FROM tests", Long.class));
        assertEquals(3L, jdbc.queryForObject("SELECT COUNT(*) FROM attempt", Long.class));
    }

    @Test
    void seededAttemptsHaveConsistentScoresAndLinkedAnswers() {
        assertEquals(0L, jdbc.queryForObject("""
                SELECT COUNT(*) FROM attempt a
                WHERE a.score <> (SELECT SUM(aa.points_awarded) FROM attempt_answer aa WHERE aa.attempt_id = a.id)
                   OR a.max_score <> (SELECT SUM(q.points) FROM question q WHERE q.test_id = a.test_id)
                   OR a.started_at >= a.submitted_at
                """, Long.class));
        assertEquals(0L, jdbc.queryForObject("""
                SELECT COUNT(*) FROM attempt_answer aa
                JOIN attempt a ON a.id = aa.attempt_id
                JOIN question q ON q.id = aa.question_id
                WHERE a.test_id <> q.test_id
                """, Long.class));
        assertTrue(jdbc.queryForObject("SELECT COUNT(*) FROM attempt WHERE percentage = 100", Long.class) > 0);
        assertTrue(jdbc.queryForObject("SELECT COUNT(*) FROM attempt WHERE percentage < 50", Long.class) > 0);
    }

    private Map<String, Long> rowCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String table : TABLES) {
            counts.put(table, jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class));
        }
        return counts;
    }
}
