package com.quicktest.ai;

import com.quicktest.tests.QuestionType;
import com.quicktest.tests.QuizDtos;
import jakarta.validation.Validator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import static org.springframework.http.HttpStatus.*;

@Component
@ConditionalOnProperty(name = "app.ai.provider", havingValue = "ollama", matchIfMissing = true)
public class OllamaAiProvider implements AiProvider {
    private static final String SCHEMA = """
            {
              "type": "object", "additionalProperties": false,
              "required": ["title", "description", "questions"],
              "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": 255},
                "description": {"type": "string", "maxLength": 4000},
                "questions": {
                  "type": "array",
                  "items": {
                    "type": "object", "additionalProperties": false,
                    "required": ["type", "question", "difficulty", "points", "explanation", "answers"],
                    "properties": {
                      "type": {"type": "string", "enum": ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "OPEN_ANSWER"]},
                      "question": {"type": "string", "minLength": 1, "maxLength": 4000},
                      "difficulty": {"type": "string", "enum": ["EASY", "MEDIUM", "HARD", "VERY_HARD"]},
                      "criteria": {"type": "string", "maxLength": 4000},
                      "timeSeconds": {"type": "integer", "minimum": 10, "maximum": 3600},
                      "points": {"type": "integer", "minimum": 1, "maximum": 5},
                      "explanation": {"type": "string", "minLength": 1, "maxLength": 4000},
                      "answers": {
                        "type": "array", "minItems": 1, "maxItems": 6,
                        "items": {
                          "type": "object", "additionalProperties": false,
                          "required": ["answer", "correct"],
                          "properties": {
                            "answer": {"type": "string", "minLength": 1, "maxLength": 2000},
                            "correct": {"type": "boolean"}
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            """;

    private final ObjectMapper mapper;
    private final Validator validator;
    private final URI endpoint;
    private final String model;
    private final Duration timeout;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public OllamaAiProvider(ObjectMapper mapper, Validator validator,
                            @Value("${app.ai.ollama.base-url:http://localhost:11434}") String baseUrl,
                            @Value("${app.ai.ollama.model:qwen3:4b}") String model,
                            @Value("${app.ai.ollama.timeout-seconds:180}") int timeoutSeconds) {
        this.mapper = mapper;
        this.validator = validator;
        this.endpoint = URI.create(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").resolve("api/chat");
        this.model = model;
        this.timeout = Duration.ofSeconds(timeoutSeconds);
    }

    @Override
    public GeneratedTest generateTest(GenerateTestRequest request) {
        try {
            ObjectNode schema = (ObjectNode) mapper.readTree(SCHEMA);
            ObjectNode questions = (ObjectNode) schema.path("properties").path("questions");
            questions.put("minItems", request.questionCount());
            questions.put("maxItems", request.questionCount());
            String settings = mapper.writeValueAsString(Map.of(
                    "topic", request.topic(), "language", request.language(),
                    "questionCount", request.questionCount(), "difficulty", request.difficulty(),
                    "instructions", request.instructions() == null ? "" : request.instructions(),
                    "questionTypes", request.questionTypes() == null ? List.of("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER") : request.questionTypes(),
                    "difficultyCounts", request.difficultyCounts() == null ? Map.of() : request.difficultyCounts()
            ));
            int outputLimit = Math.max(3072, 512 + request.questionCount() * 384);
            int contextLimit = outputLimit <= 3072 ? 4096 : outputLimit <= 6144 ? 8192 : 16384;
            Map<String, Object> payload = Map.of(
                    "model", model, "stream", false, "think", false, "format", schema,
                    "keep_alive", "5m",
                    "options", Map.of("temperature", 0.2, "num_ctx", contextLimit, "num_predict", outputLimit),
                    "messages", List.of(
                            Map.of("role", "system", "content", """
                                    You are a careful school teacher. Create original, factual quiz questions.
                                    Return only JSON matching the given schema. Write the title, description,
                                    questions, answers and explanations entirely in the requested language.
                                    Use Cyrillic when the language is Bulgarian. Respect the subject, school grade,
                                    age and difficulty in the settings. Each question must test the actual topic,
                                    not refer vaguely to it. Questions must be distinct and self-contained.
                                    Verify arithmetic and correct answers before responding. Use clear wording.
                                    Prefer SINGLE_CHOICE with four distinct answers and exactly one correct answer.
                                    MULTIPLE_CHOICE needs at least two correct answers and one incorrect answer.
                                    TRUE_FALSE needs exactly two answers and one correct answer.
                                    SHORT_ANSWER needs at least one accepted correct answer.
                                    OPEN_ANSWER needs a criteria rubric and one model answer marked correct.
                                    Respect questionTypes and difficultyCounts exactly when supplied.
                                    Provide a short explanation and 1-5 points for every question.
                                    """),
                            Map.of("role", "user", "content", "Create exactly the requested number of questions. Settings:\n"
                                    + settings + "\nJSON schema:\n" + mapper.writeValueAsString(schema))
                    )
            );
            HttpRequest httpRequest = HttpRequest.newBuilder(endpoint)
                    .timeout(timeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
                    .build();
            HttpResponse<String> response = client.send(httpRequest, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 404) {
                throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Моделът за AI генериране не е зареден.");
            }
            if (response.statusCode() != 200) {
                throw new ResponseStatusException(SERVICE_UNAVAILABLE, "AI услугата не е достъпна в момента.");
            }
            JsonNode result = mapper.readTree(response.body());
            JsonNode content = result.path("message").path("content");
            if (!result.path("done").asBoolean() || !content.isString() || content.asString().isBlank()
                    || "length".equals(result.path("done_reason").asString())) {
                throw invalidResponse();
            }
            Draft draft = mapper.readValue(content.asString(), Draft.class);
            if (draft == null) throw invalidResponse();
            QuizDtos.TestRequest test = new QuizDtos.TestRequest(
                    draft.title(), draft.description(), request.language(), null,
                    false, false, true, true, draft.questions()
            );
            validate(test, request.questionCount());
            return new GeneratedTest(test, result.path("model").asString(model),
                    result.path("prompt_eval_count").asInt(0), result.path("eval_count").asInt(0));
        } catch (HttpTimeoutException exception) {
            throw new ResponseStatusException(GATEWAY_TIMEOUT, "AI генерирането отне твърде дълго. Опитай отново.");
        } catch (IOException exception) {
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "AI услугата не е достъпна в момента.");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "AI генерирането беше прекъснато.");
        } catch (JacksonException | IllegalArgumentException exception) {
            throw invalidResponse();
        }
    }

    private void validate(QuizDtos.TestRequest test, int count) {
        if (!validator.validate(test).isEmpty() || test.questions().size() != count
                || test.questions().stream().anyMatch(Objects::isNull)) {
            throw invalidResponse();
        }
        Set<String> seenQuestions = new HashSet<>();
        for (QuizDtos.QuestionRequest question : test.questions()) {
            if (question.answers().stream().anyMatch(Objects::isNull)) throw invalidResponse();
            long correct = question.answers().stream().filter(QuizDtos.AnswerRequest::correct).count();
            Set<String> answers = new HashSet<>();
            boolean distinctAnswers = question.answers().stream()
                    .allMatch(answer -> answers.add(answer.answer().trim().toLowerCase(Locale.ROOT)));
            if (!seenQuestions.add(question.question().trim().toLowerCase(Locale.ROOT)) || !distinctAnswers
                    || question.difficulty() == null || question.points() > 5 || correct == 0
                    || question.type() == QuestionType.SINGLE_CHOICE && (correct != 1 || question.answers().size() < 2)
                    || question.type() == QuestionType.TRUE_FALSE && (correct != 1 || question.answers().size() != 2)
                    || question.type() == QuestionType.MULTIPLE_CHOICE && (correct < 2 || correct == question.answers().size())) {
                throw invalidResponse();
            }
        }
    }

    private ResponseStatusException invalidResponse() {
        return new ResponseStatusException(BAD_GATEWAY, "AI върна невалидни въпроси. Опитай отново.");
    }

    private record Draft(String title, String description, List<QuizDtos.QuestionRequest> questions) {}
}
