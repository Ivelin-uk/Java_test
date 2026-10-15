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
    public GradedAnswers gradeAnswers(GradeAnswersRequest request) {
        return new GradedAnswers(request.questions().stream().map(q -> new AnswerGrade(q.id(),
                q.acceptedAnswers().stream().anyMatch(answer -> answer.equalsIgnoreCase(q.answer().strip()))
                        ? q.maximumPoints() : java.math.BigDecimal.ZERO,
                "Тестова AI проверка (mock)." )).toList(), "mock-ai-provider", 0, 0);
    }

    @Override
    public GeneratedTest generateTest(GenerateTestRequest request) {
        List<QuizDtos.QuestionRequest> questions = new ArrayList<>();
        int count = Math.max(1, Math.min(30, request.questionCount()));
        for (int i = 1; i <= count; i++) {
            QuestionType type = i % 3 == 0 ? QuestionType.TRUE_FALSE : i % 2 == 0 ? QuestionType.MULTIPLE_CHOICE : QuestionType.SINGLE_CHOICE;
            if(request.questionTypes()!=null && !request.questionTypes().isEmpty()) type=QuestionType.valueOf(request.questionTypes().get((i-1)%request.questionTypes().size()));
            List<String> difficulties=new ArrayList<>();
            if(request.difficultyCounts()!=null) request.difficultyCounts().forEach((key,value)->{for(int n=0;n<value;n++) difficulties.add(key);});
            String difficulty=difficulties.size()==count?difficulties.get(i-1):request.difficulty().equals("MIXED")?List.of("EASY","MEDIUM","HARD").get((i-1)%3):request.difficulty();
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
                    Difficulty.valueOf(difficulty.toUpperCase()),
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
        var prompts = questions.stream().limit(request.imageCount()).map(q -> "Educational diagram for " + request.topic() + ": " + q.question()).toList();
        return new GeneratedTest(test, "mock-ai-provider", 250 + count * 20, 500 + count * 80, prompts);
    }

    @Override
    public GeneratedImage generateImage(GenerateImageRequest request) {
        var image = new java.awt.image.BufferedImage(640, 400, java.awt.image.BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        try {
            graphics.setColor(java.awt.Color.WHITE); graphics.fillRect(0, 0, 640, 400);
            graphics.setColor(new java.awt.Color(35, 131, 107)); graphics.setStroke(new java.awt.BasicStroke(5));
            graphics.drawPolygon(new int[]{130, 510, 320}, new int[]{310, 310, 70}, 3);
            graphics.setFont(new java.awt.Font("SansSerif", java.awt.Font.BOLD, 24));
            graphics.drawString("A", 105, 340); graphics.drawString("B", 515, 340); graphics.drawString("C", 315, 55);
        } finally { graphics.dispose(); }
        try {
            var output = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(image, "png", output);
            return new GeneratedImage(java.util.Base64.getEncoder().encodeToString(output.toByteArray()), "mock-image-provider", 10, 20);
        } catch (java.io.IOException error) { throw new IllegalStateException("Cannot create mock image", error); }
    }
}
