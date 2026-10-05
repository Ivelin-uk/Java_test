package com.quicktest;

import com.quicktest.ai.AiProvider;
import com.quicktest.ai.OllamaAiProvider;
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
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class OllamaAiProviderTests {
    private final ObjectMapper mapper = new ObjectMapper();
    private ValidatorFactory validators;
    private HttpServer server;
    private String responseBody;
    private int responseStatus;
    private volatile JsonNode received;

    @BeforeEach
    void startServer() throws Exception {
        validators = Validation.buildDefaultValidatorFactory();
        responseStatus = 200;
        responseBody = response(draft());
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/chat", exchange -> {
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

        assertEquals("qwen3:4b", generated.model());
        assertEquals(123, generated.inputTokens());
        assertEquals(456, generated.outputTokens());
        assertEquals(2, generated.test().questions().size());
        assertEquals("Bulgarian", generated.test().language());
        assertTrue(generated.test().questions().getFirst().answers().getFirst().correct());
        assertEquals("qwen3:4b", received.path("model").asString());
        assertFalse(received.path("stream").asBoolean());
        assertFalse(received.path("think").asBoolean());
        assertEquals(2, received.path("format").path("properties").path("questions").path("minItems").asInt());
        assertEquals(2, received.path("format").path("properties").path("questions").path("maxItems").asInt());
        assertTrue(received.path("messages").get(1).path("content").asString().contains("Mathematics grade 3"));
        assertTrue(received.path("messages").get(1).path("content").asString().contains("Bulgarian"));
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
        responseBody = mapper.writeValueAsString(Map.of("done", true, "message", Map.of("content", "null")));
        assertFailure(HttpStatus.BAD_GATEWAY);
        ObjectNode result = (ObjectNode) mapper.readTree(response(draft()));
        result.put("done_reason", "length");
        responseBody = mapper.writeValueAsString(result);
        assertFailure(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void allocatesEnoughContextForLargerTests() {
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
        assertEquals(8192, received.path("options").path("num_predict").asInt());
        assertEquals(16384, received.path("options").path("num_ctx").asInt());
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
        OllamaAiProvider provider = provider();
        server.stop(0);
        ResponseStatusException exception = assertThrows(ResponseStatusException.class, () -> provider.generateTest(request()));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatusCode());
    }

    private void assertFailure(HttpStatus status) {
        ResponseStatusException exception = assertThrows(ResponseStatusException.class, () -> provider().generateTest(request()));
        assertEquals(status, exception.getStatusCode());
    }

    private OllamaAiProvider provider() {
        return new OllamaAiProvider(mapper, validators.getValidator(),
                "http://127.0.0.1:" + server.getAddress().getPort(), "qwen3:4b", 2);
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
        return mapper.writeValueAsString(Map.of("model", "qwen3:4b", "done", true, "done_reason", "stop",
                "prompt_eval_count", 123, "eval_count", 456,
                "message", Map.of("content", mapper.writeValueAsString(draft))));
    }
}
