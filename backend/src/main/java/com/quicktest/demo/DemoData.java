package com.quicktest.demo;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.tests.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class DemoData implements CommandLineRunner {
    private final boolean seed;
    private final AppUserRepository users;
    private final QuizTestRepository tests;
    private final PasswordEncoder passwordEncoder;

    public DemoData(@Value("${app.demo-seed}") boolean seed, AppUserRepository users, QuizTestRepository tests, PasswordEncoder passwordEncoder) {
        this.seed = seed;
        this.users = users;
        this.tests = tests;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (!seed || users.existsByEmailIgnoreCase("demo@quicktest.local")) {
            return;
        }
        AppUser user = new AppUser();
        user.setName("Demo Creator");
        user.setEmail("demo@quicktest.local");
        user.setPasswordHash(passwordEncoder.encode("password123"));
        users.save(user);

        QuizTest test = new QuizTest();
        test.setOwner(user);
        test.setTitle("Java OOP Basics");
        test.setDescription("Demo published test.");
        test.setStatus(TestStatus.PUBLISHED);
        test.setPublicCode("demojava");

        Question question = new Question();
        question.setTest(test);
        question.setType(QuestionType.SINGLE_CHOICE);
        question.setQuestion("Кой принцип скрива вътрешното състояние на обект?");
        question.setDifficulty(Difficulty.MEDIUM);
        question.setPoints(1);
        question.setPosition(0);
        question.setExplanation("Encapsulation ограничава директния достъп до вътрешното състояние.");

        Answer correct = new Answer();
        correct.setQuestion(question);
        correct.setAnswer("Encapsulation");
        correct.setCorrect(true);
        correct.setPosition(0);

        Answer wrong = new Answer();
        wrong.setQuestion(question);
        wrong.setAnswer("Compilation");
        wrong.setCorrect(false);
        wrong.setPosition(1);

        question.getAnswers().add(correct);
        question.getAnswers().add(wrong);
        test.getQuestions().add(question);
        tests.save(test);
    }
}
