package com.quicktest.tests;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.time.Instant;
import java.util.List;

public class QuizDtos {
    public record TestRequest(
            @NotBlank String title,
            String description,
            String language,
            Integer durationMinutes,
            boolean questionOrderRandom,
            boolean answerOrderRandom,
            boolean showResult,
            boolean showAnswers,
            @NotEmpty List<@Valid QuestionRequest> questions
    ) {}

    public record QuestionRequest(
            @NotNull QuestionType type,
            @NotBlank String question,
            Difficulty difficulty,
            @Positive int points,
            String explanation,
            @NotEmpty List<@Valid AnswerRequest> answers,
            String criteria,
            Integer timeSeconds
    ) {
        public QuestionRequest(QuestionType type,String question,Difficulty difficulty,int points,String explanation,List<AnswerRequest> answers) {this(type,question,difficulty,points,explanation,answers,null,null);}
    }

    public record AnswerRequest(@NotBlank String answer, boolean correct) {}

    public record TestSummary(
            Long id,
            String title,
            String description,
            String language,
            TestStatus status,
            String publicCode,
            int questionCount,
            Instant updatedAt
    ) {}

    public record TestDetail(
            Long id,
            String title,
            String description,
            String language,
            TestStatus status,
            String publicCode,
            Integer durationMinutes,
            boolean questionOrderRandom,
            boolean answerOrderRandom,
            boolean showResult,
            boolean showAnswers,
            List<QuestionResponse> questions
    ) {}

    public record QuestionResponse(
            Long id,
            QuestionType type,
            String question,
            Difficulty difficulty,
            int points,
            String explanation,
            List<AnswerResponse> answers
    ) {}

    public record AnswerResponse(Long id, String answer, boolean correct) {}

    public record PublicTest(
            String title,
            String description,
            Integer durationMinutes,
            boolean showResult,
            boolean showAnswers,
            List<PublicQuestion> questions
    ) {}

    public record PublicQuestion(
            Long id,
            QuestionType type,
            String question,
            int points,
            List<PublicAnswer> answers
    ) {}

    public record PublicAnswer(Long id, String answer) {}

    public record SubmitAttemptRequest(
            @NotBlank String participantName,
            String participantEmail,
            @NotEmpty List<SubmittedAnswer> answers
    ) {}

    public record SubmittedAnswer(
            @NotNull Long questionId,
            List<Long> answerIds,
            String textAnswer
    ) {}

    public record AttemptResult(
            Long attemptId,
            String participantName,
            int score,
            int maxScore,
            double percentage,
            String grade,
            Instant submittedAt,
            List<AttemptAnswerResult> answers
    ) {}

    public record AttemptAnswerResult(
            Long questionId,
            boolean correct,
            int pointsAwarded,
            List<Long> correctAnswerIds,
            String explanation
    ) {}

    public record CreatorResult(
            Long attemptId,
            Long testId,
            String testTitle,
            String participantName,
            String participantEmail,
            int score,
            int maxScore,
            double percentage,
            String grade,
            Instant submittedAt
    ) {}

    public record PublishResponse(String publicCode, String publicUrl) {}
}
