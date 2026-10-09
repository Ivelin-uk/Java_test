package com.quicktest;

import com.quicktest.ai.AiProvider;
import com.quicktest.ai.OpenAiProvider;
import com.sun.net.httpserver.HttpServer;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.net.InetSocketAddress;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class OpenAiProviderTests {
    private final ObjectMapper mapper = new ObjectMapper();
    private ValidatorFactory validators;
    private HttpServer server;
    private String responseBody;
    private int responseStatus;
    private volatile JsonNode received;
    private volatile String authorization;

    @BeforeEach
    void startServer() throws Exception {
        validators = Validation.buildDefaultValidatorFactory();
        responseStatus = 200;
        responseBody = response(draft());
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/responses", exchange -> {
            authorization = exchange.getRequestHeaders().getFirst("Authorization");
            received = mapper.readTree(exchange.getRequestBody().readAllBytes());
            byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
        validators.close();
    }

    @Test
    void sendsRealHttpRequestWithSchemaAndReadsModelTokens() {
        AiProvider.GeneratedTest generated = provider().generateTest(request());

        assertEquals("gpt-4.1-mini", generated.model());
        assertEquals(123, generated.inputTokens());
        assertEquals(456, generated.outputTokens());
        assertEquals(2, generated.test().questions().size());
        assertEquals("Bulgarian", generated.test().language());
        assertTrue(generated.test().questions().getFirst().answers().getFirst().correct());
        assertEquals("gpt-4.1-mini", received.path("model").asString());
        assertFalse(received.path("stream").asBoolean());
        assertFalse(received.path("store").asBoolean());
        assertEquals("Bearer test-key", authorization);
        assertTrue(received.path("text").path("format").path("strict").asBoolean());
        assertEquals(2, received.path("text").path("format").path("schema").path("properties").path("questions").path("minItems").asInt());
        assertEquals(2, received.path("text").path("format").path("schema").path("properties").path("questions").path("maxItems").asInt());
        assertTrue(received.path("input").get(1).path("content").asString().contains("Mathematics grade 3"));
        assertTrue(received.path("input").get(1).path("content").asString().contains("Bulgarian"));
    }

    @Test
    void gradesSubmittedTextWithStrictSchemaAndBoundedPoints() {
        responseBody = response(gradingDraft());
        var graded = provider().gradeAnswers(gradingRequest());
        assertEquals("gpt-4.1-mini", graded.model());
        assertEquals(123, graded.inputTokens()); assertEquals(456, graded.outputTokens());
        assertEquals(2, graded.grades().size());
        assertEquals(new BigDecimal("1.25"), graded.grades().getFirst().points());
        assertFalse(received.path("store").asBoolean());
        assertEquals("exam_grading", received.path("text").path("format").path("name").asString());
        assertTrue(received.path("text").path("format").path("strict").asBoolean());
        assertEquals(mapper.valueToTree(List.of(11, 12)), received.path("text").path("format").path("schema")
                .path("properties").path("grades").path("items").path("properties").path("questionId").path("enum"));
        String input = received.path("input").get(1).path("content").asString();
        assertTrue(input.contains("Student explanation")); assertTrue(input.contains("Use the rubric"));
        assertTrue(received.path("input").get(0).path("content").asString().contains("untrusted data"));
        assertEquals("Bearer test-key", authorization);
    }

    @Test
    void rejectsInvalidGradingInsteadOfPublishingOrClampingIt() {
        for (String points : List.of("22", "-0.1", "1.12345")) {
            var draft = gradingDraft();
            ((ObjectNode) draft.path("grades").get(0)).put("points", new BigDecimal(points));
            responseBody = response(draft); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        }
        var draft = gradingDraft(); ((ObjectNode) draft.path("grades").get(1)).put("questionId", 11);
        responseBody = response(draft); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        draft = gradingDraft(); ((ObjectNode) draft.path("grades").get(1)).put("questionId", 999);
        responseBody = response(draft); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        draft = gradingDraft(); ((ObjectNode) draft.path("grades").get(0)).remove("points");
        responseBody = response(draft); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        draft = gradingDraft(); ((ObjectNode) draft.path("grades").get(0)).put("comment", "");
        responseBody = response(draft); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        draft = gradingDraft(); ((tools.jackson.databind.node.ArrayNode) draft.path("grades")).remove(1);
        responseBody = response(draft); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        responseBody = response(mapper.createObjectNode()); assertGradingFailure(HttpStatus.BAD_GATEWAY);
        responseBody = "invalid-json"; assertGradingFailure(HttpStatus.BAD_GATEWAY);
        var incomplete = (ObjectNode) mapper.readTree(response(gradingDraft())); incomplete.put("status", "incomplete");
        responseBody = mapper.writeValueAsString(incomplete); assertGradingFailure(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void gradingReportsProviderFailuresWithoutLeakingResponses() {
        for (int code : List.of(401, 403, 404, 500)) {
            responseStatus = code; responseBody = "private upstream error";
            assertGradingFailure(HttpStatus.SERVICE_UNAVAILABLE);
        }
        responseStatus = 429; responseBody = "{\"error\":{\"code\":\"insufficient_quota\"}}";
        assertTrue(assertGradingFailure(HttpStatus.SERVICE_UNAVAILABLE).getReason().contains("API кредит"));
        responseStatus = 200;
        responseBody = mapper.writeValueAsString(Map.of("status", "completed", "output", List.of(Map.of("type", "message", "content", List.of(Map.of("type", "refusal", "refusal", "private upstream error"))))));
        assertGradingFailure(HttpStatus.BAD_GATEWAY);
    }

    private ResponseStatusException assertGradingFailure(HttpStatus status) {
        var error = assertThrows(ResponseStatusException.class, () -> provider().gradeAnswers(gradingRequest()));
        assertEquals(status, error.getStatusCode()); assertFalse(error.getReason().contains("private upstream error"));
        return error;
    }

    private AiProvider.GradeAnswersRequest gradingRequest() {
        return new AiProvider.GradeAnswersRequest("Bulgarian", List.of(
                new AiProvider.GradingQuestion(11, "OPEN_ANSWER", "Explain encapsulation", new BigDecimal("2.5"), "Use the rubric", List.of(), "Reference explanation", "Student explanation"),
                new AiProvider.GradingQuestion(12, "SHORT_ANSWER", "Name the keyword", new BigDecimal("5"), "Accepted answer", List.of("class"), "", "class")));
    }

    private ObjectNode gradingDraft() {
        return (ObjectNode) mapper.valueToTree(Map.of("grades", List.of(
                Map.of("questionId", 11, "points", new BigDecimal("1.25"), "comment", "Частично верен отговор."),
                Map.of("questionId", 12, "points", 5, "comment", "Верен отговор."))));
    }

    @Test
    void constrainsRequestedQuestionTypesAndDifficultyInSchema() {
        provider().generateTest(new AiProvider.GenerateTestRequest("Java", "", "bg", 2, "EASY",
                List.of("SINGLE_CHOICE"), Map.of("EASY", 2)));
        JsonNode properties = received.path("text").path("format").path("schema").path("properties").path("questions").path("items").path("properties");
        assertEquals(mapper.valueToTree(List.of("SINGLE_CHOICE")), properties.path("type").path("enum"));
        assertEquals(mapper.valueToTree(List.of("EASY")), properties.path("difficulty").path("enum"));
    }

    @Test
    void missingKeyDoesNotSendARequest() {
        OpenAiProvider provider = new OpenAiProvider(mapper, validators.getValidator(),
                "http://127.0.0.1:" + server.getAddress().getPort(), "gpt-4.1-mini", "", 2);
        var error = assertThrows(ResponseStatusException.class, () -> provider.generateTest(request()));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.getStatusCode());
        assertTrue(error.getReason().contains("OPENAI_API_KEY"));
        assertNull(received);
    }

    @Test
    void reportsCredentialsQuotaRateLimitsAndRefusalsWithoutLeakingResponse() {
        responseStatus = 401;
        responseBody = "secret upstream error";
        assertFailure(HttpStatus.SERVICE_UNAVAILABLE);
        responseStatus = 429;
        responseBody = "{\"error\":{\"code\":\"insufficient_quota\"}}";
        var error = assertThrows(ResponseStatusException.class, () -> provider().generateTest(request()));
        assertTrue(error.getReason().contains("API кредит"));
        responseBody = "{\"error\":{\"code\":\"rate_limit_exceeded\"}}";
        assertFailure(HttpStatus.SERVICE_UNAVAILABLE);
        responseStatus = 200;
        responseBody = mapper.writeValueAsString(Map.of("status", "completed", "output", List.of(Map.of("type", "message", "content", List.of(Map.of("type", "refusal", "refusal", "secret upstream error"))))));
        error = assertThrows(ResponseStatusException.class, () -> provider().generateTest(request()));
        assertTrue(error.getReason().contains("отказа"));
        assertFalse(error.getReason().contains("secret"));
    }

    @Test
    void rejectsDraftWithWrongQuestionCount() {
        ObjectNode draft = draft();
        ((tools.jackson.databind.node.ArrayNode) draft.path("questions")).remove(1);
        responseBody = response(draft);
        assertFailure(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void rejectsQuestionWithoutCorrectAnswer() {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("questions").get(0).path("answers").get(0)).put("correct", false);
        responseBody = response(draft);
        assertFailure(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void rejectsRepeatedQuestions() {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("questions").get(1)).put("question", draft.path("questions").get(0).path("question").asString());
        responseBody = response(draft);
        assertFailure(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void rejectsMalformedJsonAndIncompleteGeneration() {
        responseBody = "not-json";
        assertFailure(HttpStatus.BAD_GATEWAY);
        responseBody = mapper.writeValueAsString(Map.of("status", "completed", "output", List.of(Map.of("type", "message", "content", List.of(Map.of("type", "output_text", "text", "null"))))));
        assertFailure(HttpStatus.BAD_GATEWAY);
        ObjectNode result = (ObjectNode) mapper.readTree(response(draft()));
        result.put("status", "incomplete");
        responseBody = mapper.writeValueAsString(result);
        assertFailure(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void allocatesEnoughOutputForLargerTests() {
        ObjectNode draft = draft();
        var questions = mapper.createArrayNode();
        for (int i = 0; i < 20; i++) {
            questions.add(mapper.valueToTree(question("Question " + i, "Correct", "Wrong")));
        }
        draft.set("questions", questions);
        responseBody = response(draft);
        AiProvider.GeneratedTest generated = provider().generateTest(
                new AiProvider.GenerateTestRequest("Arithmetic", "", "Bulgarian", 20, "EASY"));
        assertEquals(20, generated.test().questions().size());
        assertEquals(16384, received.path("max_output_tokens").asInt());
    }

    @Test
    void reportsMissingModelAndUnavailableService() {
        responseStatus = 404;
        responseBody = "{\"error\":\"model not found\"}";
        assertFailure(HttpStatus.SERVICE_UNAVAILABLE);
        responseStatus = 500;
        assertFailure(HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void reportsConnectionFailure() {
        OpenAiProvider provider = provider();
        server.stop(0);
        ResponseStatusException exception = assertThrows(ResponseStatusException.class, () -> provider.generateTest(request()));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatusCode());
    }

    private void assertFailure(HttpStatus status) {
        ResponseStatusException exception = assertThrows(ResponseStatusException.class, () -> provider().generateTest(request()));
        assertEquals(status, exception.getStatusCode());
    }

    private OpenAiProvider provider() {
        return new OpenAiProvider(mapper, validators.getValidator(),
                "http://127.0.0.1:" + server.getAddress().getPort(), "gpt-4.1-mini", "test-key", 2);
    }

    private AiProvider.GenerateTestRequest request() {
        return new AiProvider.GenerateTestRequest("Mathematics grade 3", "Simple arithmetic", "Bulgarian", 2, "EASY");
    }

    private ObjectNode draft() {
        return (ObjectNode) mapper.valueToTree(Map.of(
                "title", "Mathematics", "description", "Simple arithmetic",
                "questions", List.of(question("What is 2 + 2?", "4", "5"), question("What is 3 + 3?", "6", "7"))
        ));
    }

    private Map<String, Object> question(String text, String correct, String wrong) {
        return Map.of("type", "SINGLE_CHOICE", "question", text, "difficulty", "EASY", "points", 1,
                "explanation", "Add the two numbers.", "answers", List.of(
                        Map.of("answer", correct, "correct", true), Map.of("answer", wrong, "correct", false)
                ));
    }

    private String response(ObjectNode draft) {
        return mapper.writeValueAsString(Map.of("model", "gpt-4.1-mini", "status", "completed",
                "usage", Map.of("input_tokens", 123, "output_tokens", 456),
                "output", List.of(Map.of("type", "message", "content", List.of(Map.of("type", "output_text", "text", mapper.writeValueAsString(draft)))))));
    }
}
