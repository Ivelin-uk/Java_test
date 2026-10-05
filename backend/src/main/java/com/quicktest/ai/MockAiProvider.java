package com.quicktest.ai;

import com.quicktest.tests.Difficulty;
import com.quicktest.tests.QuestionType;
import com.quicktest.tests.QuizDtos;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
@ConditionalOnProperty(name = "app.ai.provider", havingValue = "mock")
public class MockAiProvider implements AiProvider {
    @Override
    public GeneratedTest generateTest(GenerateTestRequest request) {
        List<QuizDtos.QuestionRequest> questions = new ArrayList<>();
        int count = Math.max(1, Math.min(30, request.questionCount()));
        for (int i = 1; i <= count; i++) {
            QuestionType type = i % 3 == 0 ? QuestionType.TRUE_FALSE : i % 2 == 0 ? QuestionType.MULTIPLE_CHOICE : QuestionType.SINGLE_CHOICE;
            List<QuizDtos.AnswerRequest> answers = switch (type) {
                case TRUE_FALSE -> List.of(
                        new QuizDtos.AnswerRequest("Вярно", true),
                        new QuizDtos.AnswerRequest("Грешно", false)
                );
                case MULTIPLE_CHOICE -> List.of(
                        new QuizDtos.AnswerRequest("Капсулация", true),
                        new QuizDtos.AnswerRequest("Наследяване", true),
                        new QuizDtos.AnswerRequest("HTML таг", false),
                        new QuizDtos.AnswerRequest("SQL индекс", false)
                );
                default -> List.of(
                        new QuizDtos.AnswerRequest("Един ясен правилен отговор", true),
                        new QuizDtos.AnswerRequest("Подвеждащ отговор", false),
                        new QuizDtos.AnswerRequest("Частично свързан отговор", false),
                        new QuizDtos.AnswerRequest("Несвързан отговор", false)
                );
            };
            questions.add(new QuizDtos.QuestionRequest(
                    type,
                    "Въпрос " + i + " по тема: " + request.topic(),
                    Difficulty.valueOf(request.difficulty().toUpperCase()),
                    1,
                    "Кратко обяснение за правилния отговор по темата " + request.topic() + ".",
                    answers
            ));
        }
        QuizDtos.TestRequest test = new QuizDtos.TestRequest(
                request.topic(),
                request.instructions() == null ? "AI generated draft" : request.instructions(),
                request.language(),
                null,
                false,
                false,
                true,
                true,
                questions
        );
        return new GeneratedTest(test, "mock-ai-provider", 250 + count * 20, 500 + count * 80);
    }
}
