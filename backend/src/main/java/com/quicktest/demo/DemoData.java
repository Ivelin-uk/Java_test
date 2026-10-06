package com.quicktest.demo;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.AuthToken;
import com.quicktest.auth.AuthTokenRepository;
import com.quicktest.auth.Role;
import com.quicktest.ai.AiProvider;
import com.quicktest.ai.AiUsage;
import com.quicktest.ai.AiUsageRepository;
import com.quicktest.ai.MockAiProvider;
import com.quicktest.tests.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.math.BigDecimal;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Component
@org.springframework.core.annotation.Order(100)
public class DemoData implements CommandLineRunner {
    private static final String SEED_KEY = "default-demo-v1";
    private final boolean seed;
    private final AppUserRepository users;
    private final QuizTestRepository tests;
    private final AttemptRepository attempts;
    private final AuthTokenRepository tokens;
    private final QuizService quizService;
    private final AiUsageRepository aiUsage;
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;

    public DemoData(@Value("${app.demo-seed}") boolean seed, AppUserRepository users, QuizTestRepository tests,
                    AttemptRepository attempts, AuthTokenRepository tokens, QuizService quizService,
                    AiUsageRepository aiUsage, JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.seed = seed;
        this.users = users;
        this.tests = tests;
        this.attempts = attempts;
        this.tokens = tokens;
        this.quizService = quizService;
        this.aiUsage = aiUsage;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (!seed) return;
        if (jdbc.queryForObject("SELECT COUNT(*) FROM demo_seed_history WHERE seed_key = ?", Long.class, "admin-roles-demo-v1") == 0) {
            if (users.findByEmailIgnoreCase("admin@quicktest.local").isEmpty()) {
                seedSession(seedUser("admin@quicktest.local", "Demo Administrator", Role.ADMIN));
            }
            for (String email : List.of("demo@quicktest.local", "teacher@quicktest.local", "student@quicktest.local")) {
                AppUser user = users.findByEmailIgnoreCase(email).orElse(null);
                if (user != null) markDemoSubscription(user);
            }
            jdbc.update("INSERT INTO demo_seed_history (seed_key, created_at) VALUES (?, CURRENT_TIMESTAMP)", "admin-roles-demo-v1");
        }
        if (jdbc.queryForObject("SELECT COUNT(*) FROM demo_seed_history WHERE seed_key = ?", Long.class, SEED_KEY) > 0) {
            return;
        }
        AppUser creator = seedUser("demo@quicktest.local", "Demo Creator", Role.TEACHER);
        AppUser teacher = seedUser("teacher@quicktest.local", "Demo Teacher", Role.TEACHER);
        AppUser student = seedUser("student@quicktest.local", "Demo Student", Role.STUDENT);

        QuizTest javaTest = seedTest(creator, "Java OOP Basics", "demojava", true, List.of(
                question(QuestionType.SINGLE_CHOICE, "Кой принцип скрива вътрешното състояние на обект?", 2,
                        "Encapsulation ограничава директния достъп до вътрешното състояние.",
                        answer("Encapsulation", true), answer("Compilation", false), answer("Recursion", false)),
                question(QuestionType.MULTIPLE_CHOICE, "Кои са модификатори за достъп в Java?", 2,
                        "public и private определят достъпа до членове на класа.",
                        answer("public", true), answer("private", true), answer("static", false), answer("final", false)),
                question(QuestionType.TRUE_FALSE, "Един Java клас може да наследява два класа едновременно.", 1,
                        "Java поддържа наследяване само от един клас.",
                        answer("Вярно", false), answer("Грешно", true)),
                question(QuestionType.SHORT_ANSWER, "С коя ключова дума се декларира интерфейс?", 1,
                        "Интерфейс се декларира с interface.", answer("interface", true)),
                question(QuestionType.OPEN_ANSWER, "Обяснете с пример какво е полиморфизъм.", 2,
                        "Отвореният отговор изисква ръчна проверка.",
                        answer("Един интерфейс може да има различни реализации.", false))
        ));

        QuizTest sqlTest = seedTest(creator, "MySQL Basics", "demosql", true, List.of(
                question(QuestionType.SINGLE_CHOICE, "Коя SQL команда извлича записи от таблица?", 2,
                        "SELECT извлича данни от таблици.",
                        answer("SELECT", true), answer("DELETE", false), answer("INSERT", false)),
                question(QuestionType.TRUE_FALSE, "Първичният ключ идентифицира еднозначно всеки запис.", 1,
                        "PRIMARY KEY не допуска дублирани стойности.",
                        answer("Вярно", true), answer("Грешно", false)),
                question(QuestionType.SHORT_ANSWER, "Коя SQL клауза филтрира редовете?", 1,
                        "WHERE задава условието за филтриране.", answer("WHERE", true))
        ));

        seedAiTest(creator, "Java Collections Practice", "demodraft", false);
        QuizTest teacherTest = seedAiTest(teacher, "Java Fundamentals", "democollections", true);

        seedAttempt(javaTest, student, "Demo Student", student.getEmail(), 5, 3);
        seedAttempt(javaTest, null, "Maria Petrova", "maria@example.test", 3, 2);
        seedAttempt(javaTest, null, "Ivan Ivanov", "ivan@example.test", 1, 1);
        seedAttempt(sqlTest, student, "Demo Student", student.getEmail(), 3, 2);
        seedAttempt(sqlTest, null, "Georgi Dimitrov", "georgi@example.test", 1, 1);
        seedAttempt(teacherTest, student, "Demo Student", student.getEmail(), 3, 1);

        seedSession(creator);
        seedSession(teacher);
        seedSession(student);
        jdbc.update("INSERT INTO demo_seed_history (seed_key, created_at) VALUES (?, CURRENT_TIMESTAMP)", SEED_KEY);
    }

    private AppUser seedUser(String email, String name, Role role) {
        return users.findByEmailIgnoreCase(email).orElseGet(() -> {
            AppUser user = new AppUser();
            user.setName(name);
            user.setEmail(email);
            user.setRole(role);
            user.setEmailVerifiedAt(Instant.now());
            user.setPasswordHash(passwordEncoder.encode("password123"));
            markDemoSubscription(user);
            return users.save(user);
        });
    }

    private void markDemoSubscription(AppUser user) {
        user.setSubscriptionPaid(true);
        user.setSubscriptionPaidAt(Instant.now());
        user.setSubscriptionPaidUntil(LocalDate.now(ZoneId.of("Europe/Sofia")).plusDays(30));
    }

    private QuizTest seedTest(AppUser owner, String title, String code, boolean published,
                              List<QuizDtos.QuestionRequest> questions) {
        return tests.findByPublicCode(code).orElseGet(() -> {
            QuizDtos.TestDetail detail = quizService.create(owner, new QuizDtos.TestRequest(
                    title, "Тестови данни за локална разработка.", "Bulgarian", 20,
                    false, false, true, true, questions
            ));
            QuizTest test = tests.findById(detail.id()).orElseThrow();
            // Stable codes also identify the draft after its title has been edited.
            test.setPublicCode(code);
            if (published) {
                test.setStatus(TestStatus.PUBLISHED);
                test.setPublishedAt(Instant.now().minus(7, ChronoUnit.DAYS));
            }
            return tests.save(test);
        });
    }

    private QuizTest seedAiTest(AppUser owner, String title, String code, boolean published) {
        return tests.findByPublicCode(code).orElseGet(() -> {
            // Demo fixtures must not depend on a running model or make external AI requests.
            AiProvider.GeneratedTest generated = new MockAiProvider().generateTest(
                    new AiProvider.GenerateTestRequest(title, "Demo AI generated test", "Bulgarian", 3, "MEDIUM"));
            AiUsage usage = new AiUsage();
            usage.setUser(owner);
            usage.setOperation("generate_test");
            usage.setModel(generated.model());
            usage.setInputTokens(generated.inputTokens());
            usage.setOutputTokens(generated.outputTokens());
            usage.setEstimatedCost(BigDecimal.ZERO);
            aiUsage.save(usage);
            return seedTest(owner, title, code, published, generated.test().questions());
        });
    }

    private void seedAttempt(QuizTest test, AppUser student, String name, String email,
                             int correctQuestions, int daysAgo) {
        if (test.getStatus() != TestStatus.PUBLISHED || attempts.existsByTestIdAndParticipantEmail(test.getId(), email)) {
            return;
        }
        List<QuizDtos.SubmittedAnswer> submitted = new ArrayList<>();
        for (int i = 0; i < test.getQuestions().size(); i++) {
            Question question = test.getQuestions().get(i);
            boolean correct = i < correctQuestions;
            if (question.getType() == QuestionType.SHORT_ANSWER) {
                String text = correct
                        ? question.getAnswers().stream().filter(Answer::isCorrect).findFirst().orElseThrow().getAnswer()
                        : "incorrect answer";
                submitted.add(new QuizDtos.SubmittedAnswer(question.getId(), List.of(), text));
            } else if (question.getType() == QuestionType.OPEN_ANSWER) {
                submitted.add(new QuizDtos.SubmittedAnswer(question.getId(), List.of(),
                        "Различни класове могат да реализират един интерфейс по различен начин."));
            } else {
                List<Long> answerIds = correct
                        ? question.getAnswers().stream().filter(Answer::isCorrect).map(Answer::getId).toList()
                        : question.getAnswers().stream().filter(answer -> !answer.isCorrect()).limit(1).map(Answer::getId).toList();
                submitted.add(new QuizDtos.SubmittedAnswer(question.getId(), answerIds, null));
            }
        }
        QuizDtos.AttemptResult result = quizService.submit(test.getPublicCode(),
                new QuizDtos.SubmitAttemptRequest(name, email, submitted));
        Attempt attempt = attempts.findById(result.attemptId()).orElseThrow();
        Instant submittedAt = Instant.now().minus(daysAgo, ChronoUnit.DAYS);
        attempt.setUser(student);
        attempt.setStartedAt(submittedAt.minus(10, ChronoUnit.MINUTES));
        attempt.setSubmittedAt(submittedAt);
    }

    private void seedSession(AppUser user) {
        if (!tokens.existsByUser(user)) {
            AuthToken token = new AuthToken();
            token.setToken(UUID.randomUUID().toString());
            token.setUser(user);
            tokens.save(token);
        }
    }

    private QuizDtos.QuestionRequest question(QuestionType type, String text, int points, String explanation,
                                             QuizDtos.AnswerRequest... answers) {
        return new QuizDtos.QuestionRequest(type, text, Difficulty.MEDIUM, points, explanation, List.of(answers));
    }

    private QuizDtos.AnswerRequest answer(String text, boolean correct) {
        return new QuizDtos.AnswerRequest(text, correct);
    }
}
