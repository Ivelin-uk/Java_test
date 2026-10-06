package com.quicktest.tests;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.Role;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

import static org.springframework.http.HttpStatus.*;

@Service
public class QuizService {
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    private final QuizTestRepository tests;
    private final AttemptRepository attempts;
    private final SecureRandom random = new SecureRandom();
    private final String frontendUrl;

    public QuizService(QuizTestRepository tests, AttemptRepository attempts, @Value("${app.frontend-url}") String frontendUrl) {
        this.tests = tests;
        this.attempts = attempts;
        this.frontendUrl = frontendUrl;
    }

    @Transactional
    public QuizDtos.TestDetail create(AppUser owner, QuizDtos.TestRequest request) {
        QuizTest test = new QuizTest();
        test.setOwner(owner);
        apply(test, request);
        return toDetail(tests.save(test));
    }

    @Transactional(readOnly = true)
    public List<QuizDtos.TestSummary> list(AppUser owner) {
        return (owner.getRole() == Role.ADMIN ? tests.findAllByOrderByUpdatedAtDesc() : tests.findByOwnerOrderByUpdatedAtDesc(owner))
                .stream().map(this::toSummary).toList();
    }

    @Transactional(readOnly = true)
    public QuizDtos.TestDetail get(AppUser owner, Long id) {
        return toDetail(requireOwned(owner, id));
    }

    @Transactional
    public QuizDtos.TestDetail update(AppUser owner, Long id, QuizDtos.TestRequest request) {
        QuizTest test = requireOwned(owner, id);
        boolean submitted = attempts.existsByTestId(id);
        if (submitted && !questionRequests(test).equals(request.questions()))
            throw new ResponseStatusException(CONFLICT, "Тестът има предадени опити. Въпросите не могат да се променят; създайте нов тест.");
        apply(test, request, !submitted);
        tests.flush();
        return toDetail(test);
    }

    @Transactional
    public void delete(AppUser owner, Long id) {
        QuizTest test = requireOwned(owner, id);
        attempts.deleteAll(attempts.findByTestIdAndTestOwnerIdOrderBySubmittedAtDesc(id, test.getOwner().getId()));
        // Submitted answers reference questions, so remove attempts before the question cascade.
        attempts.flush();
        tests.delete(test);
    }

    @Transactional
    public QuizDtos.PublishResponse publish(AppUser owner, Long id) {
        QuizTest test = requireOwned(owner, id);
        validatePublishable(test);
        if (test.getPublicCode() == null) {
            test.setPublicCode(generatePublicCode());
        }
        test.setStatus(TestStatus.PUBLISHED);
        test.setPublishedAt(Instant.now());
        return new QuizDtos.PublishResponse(test.getPublicCode(), frontendUrl + "/quiz/" + test.getPublicCode());
    }

    @Transactional(readOnly = true)
    public QuizDtos.PublicTest publicTest(String code) {
        QuizTest test = tests.findByPublicCodeAndStatus(code, TestStatus.PUBLISHED)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Published test not found"));
        return toPublic(test);
    }

    @Transactional
    public QuizDtos.AttemptResult submit(String code, QuizDtos.SubmitAttemptRequest request) {
        return submit(code, request, null);
    }

    @Transactional
    public QuizDtos.AttemptResult submit(String code, QuizDtos.SubmitAttemptRequest request, AppUser participant) {
        QuizTest test = tests.findByPublicCodeAndStatus(code, TestStatus.PUBLISHED)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Published test not found"));

        Map<Long, QuizDtos.SubmittedAnswer> submitted = request.answers().stream()
                .collect(Collectors.toMap(QuizDtos.SubmittedAnswer::questionId, item -> item, (a, b) -> b));

        Attempt attempt = new Attempt();
        attempt.setTest(test);
        attempt.setUser(participant);
        attempt.setParticipantName(participant == null ? request.participantName() : participant.getName());
        attempt.setParticipantEmail(participant == null ? request.participantEmail() : participant.getEmail());

        int score = 0;
        int maxScore = 0;
        for (Question question : test.getQuestions()) {
            maxScore += question.getPoints();
            QuizDtos.SubmittedAnswer answer = submitted.get(question.getId());
            AttemptAnswer attemptAnswer = scoreQuestion(attempt, question, answer);
            score += attemptAnswer.getPointsAwarded();
            attempt.getAnswers().add(attemptAnswer);
        }
        attempt.setScore(score);
        attempt.setMaxScore(maxScore);
        attempt.setPercentage(maxScore == 0 ? 0 : Math.round((score * 10000.0 / maxScore)) / 100.0);
        attempt.setGrade(grade(attempt.getPercentage()));
        attempt.setSubmittedAt(Instant.now());
        attempts.save(attempt);
        return toAttemptResult(attempt, test.isShowAnswers());
    }

    @Transactional(readOnly = true)
    public List<QuizDtos.CreatorResult> results(AppUser owner, Long testId) {
        List<Attempt> data = owner.getRole() == Role.ADMIN
                ? (testId == null ? attempts.findAllByOrderBySubmittedAtDesc() : attempts.findByTestIdOrderBySubmittedAtDesc(testId))
                : testId == null
                ? attempts.findByTestOwnerIdOrderBySubmittedAtDesc(owner.getId())
                : attempts.findByTestIdAndTestOwnerIdOrderBySubmittedAtDesc(testId, owner.getId());
        return data.stream().map(this::toCreatorResult).toList();
    }

    @Transactional(readOnly = true)
    public List<QuizDtos.TestSummary> catalog() {
        return tests.findByStatusOrderByUpdatedAtDesc(TestStatus.PUBLISHED).stream().map(this::toSummary).toList();
    }

    @Transactional(readOnly = true)
    public List<QuizDtos.CreatorResult> myResults(AppUser user) {
        return attempts.findByUserIdOrderBySubmittedAtDesc(user.getId()).stream().map(this::toCreatorResult).toList();
    }

    private AttemptAnswer scoreQuestion(Attempt attempt, Question question, QuizDtos.SubmittedAnswer submitted) {
        AttemptAnswer result = new AttemptAnswer();
        result.setAttempt(attempt);
        result.setQuestion(question);
        if (submitted == null) {
            result.setCorrect(false);
            return result;
        }
        List<Long> selected = submitted.answerIds() == null ? List.of() : submitted.answerIds();
        result.setSelectedAnswerIds(selected.stream().map(String::valueOf).collect(Collectors.joining(",")));
        result.setTextAnswer(submitted.textAnswer());

        boolean correct;
        if (question.getType() == QuestionType.SHORT_ANSWER) {
            Set<String> accepted = question.getAnswers().stream()
                    .filter(Answer::isCorrect)
                    .map(answer -> normalize(answer.getAnswer()))
                    .collect(Collectors.toSet());
            correct = accepted.contains(normalize(submitted.textAnswer()));
        } else if (question.getType() == QuestionType.OPEN_ANSWER) {
            correct = false;
        } else {
            Set<Long> correctIds = question.getAnswers().stream().filter(Answer::isCorrect).map(Answer::getId).collect(Collectors.toSet());
            correct = correctIds.equals(new HashSet<>(selected));
        }
        result.setCorrect(correct);
        result.setPointsAwarded(correct ? question.getPoints() : 0);
        return result;
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private String grade(double percentage) {
        if (percentage >= 90) return "6";
        if (percentage >= 75) return "5";
        if (percentage >= 60) return "4";
        if (percentage >= 50) return "3";
        return "2";
    }

    private void apply(QuizTest test, QuizDtos.TestRequest request) {
        apply(test, request, true);
    }

    private void apply(QuizTest test, QuizDtos.TestRequest request, boolean replaceQuestions) {
        test.setTitle(request.title());
        test.setDescription(Optional.ofNullable(request.description()).orElse(""));
        test.setLanguage(Optional.ofNullable(request.language()).orElse("Bulgarian"));
        test.setDurationMinutes(request.durationMinutes());
        test.setQuestionOrderRandom(request.questionOrderRandom());
        test.setAnswerOrderRandom(request.answerOrderRandom());
        test.setShowResult(request.showResult());
        test.setShowAnswers(request.showAnswers());
        if (!replaceQuestions) return;
        test.getQuestions().clear();
        int questionPosition = 0;
        for (QuizDtos.QuestionRequest questionRequest : request.questions()) {
            Question question = new Question();
            question.setTest(test);
            question.setType(questionRequest.type());
            question.setQuestion(questionRequest.question());
            question.setDifficulty(Optional.ofNullable(questionRequest.difficulty()).orElse(Difficulty.MEDIUM));
            question.setPoints(Math.max(1, questionRequest.points()));
            question.setExplanation(Optional.ofNullable(questionRequest.explanation()).orElse(""));
            question.setPosition(questionPosition++);
            int answerPosition = 0;
            for (QuizDtos.AnswerRequest answerRequest : questionRequest.answers()) {
                Answer answer = new Answer();
                answer.setQuestion(question);
                answer.setAnswer(answerRequest.answer());
                answer.setCorrect(answerRequest.correct());
                answer.setPosition(answerPosition++);
                question.getAnswers().add(answer);
            }
            test.getQuestions().add(question);
        }
    }

    private List<QuizDtos.QuestionRequest> questionRequests(QuizTest test) {
        return test.getQuestions().stream().map(question -> new QuizDtos.QuestionRequest(question.getType(),
                question.getQuestion(), question.getDifficulty(), question.getPoints(), question.getExplanation(),
                question.getAnswers().stream().map(answer -> new QuizDtos.AnswerRequest(answer.getAnswer(), answer.isCorrect())).toList())).toList();
    }

    private void validatePublishable(QuizTest test) {
        if (test.getQuestions().isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "A test needs at least one question");
        }
        for (Question question : test.getQuestions()) {
            if (question.getType() != QuestionType.OPEN_ANSWER && question.getAnswers().stream().noneMatch(Answer::isCorrect)) {
                throw new ResponseStatusException(BAD_REQUEST, "Every auto-scored question needs a correct answer");
            }
        }
    }

    private QuizTest requireOwned(AppUser owner, Long id) {
        return (owner.getRole() == Role.ADMIN ? tests.findById(id) : tests.findByIdAndOwner(id, owner))
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Test not found"));
    }

    private String generatePublicCode() {
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 8; i++) {
            code.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
        }
        return code.toString();
    }

    private QuizDtos.TestSummary toSummary(QuizTest test) {
        return new QuizDtos.TestSummary(test.getId(), test.getTitle(), test.getDescription(), test.getLanguage(), test.getStatus(), test.getPublicCode(), test.getQuestions().size(), test.getUpdatedAt());
    }

    private QuizDtos.TestDetail toDetail(QuizTest test) {
        return new QuizDtos.TestDetail(test.getId(), test.getTitle(), test.getDescription(), test.getLanguage(), test.getStatus(), test.getPublicCode(), test.getDurationMinutes(), test.isQuestionOrderRandom(), test.isAnswerOrderRandom(), test.isShowResult(), test.isShowAnswers(), test.getQuestions().stream().map(this::toQuestion).toList());
    }

    private QuizDtos.QuestionResponse toQuestion(Question question) {
        return new QuizDtos.QuestionResponse(question.getId(), question.getType(), question.getQuestion(), question.getDifficulty(), question.getPoints(), question.getExplanation(), question.getAnswers().stream().map(answer -> new QuizDtos.AnswerResponse(answer.getId(), answer.getAnswer(), answer.isCorrect())).toList());
    }

    private QuizDtos.PublicTest toPublic(QuizTest test) {
        return new QuizDtos.PublicTest(test.getTitle(), test.getDescription(), test.getDurationMinutes(), test.isShowResult(), test.isShowAnswers(), test.getQuestions().stream().map(question -> new QuizDtos.PublicQuestion(question.getId(), question.getType(), question.getQuestion(), question.getPoints(), question.getAnswers().stream().map(answer -> new QuizDtos.PublicAnswer(answer.getId(), answer.getAnswer())).toList())).toList());
    }

    private QuizDtos.AttemptResult toAttemptResult(Attempt attempt, boolean includeAnswers) {
        List<QuizDtos.AttemptAnswerResult> answerResults = includeAnswers ? attempt.getAnswers().stream().map(answer -> new QuizDtos.AttemptAnswerResult(answer.getQuestion().getId(), answer.isCorrect(), answer.getPointsAwarded(), answer.getQuestion().getAnswers().stream().filter(Answer::isCorrect).map(Answer::getId).toList(), answer.getQuestion().getExplanation())).toList() : List.of();
        return new QuizDtos.AttemptResult(attempt.getId(), attempt.getParticipantName(), attempt.getScore(), attempt.getMaxScore(), attempt.getPercentage(), attempt.getGrade(), attempt.getSubmittedAt(), answerResults);
    }

    private QuizDtos.CreatorResult toCreatorResult(Attempt attempt) {
        return new QuizDtos.CreatorResult(attempt.getId(), attempt.getTest().getId(), attempt.getTest().getTitle(), attempt.getParticipantName(), attempt.getParticipantEmail(), attempt.getScore(), attempt.getMaxScore(), attempt.getPercentage(), attempt.getGrade(), attempt.getSubmittedAt());
    }
}
