package com.quicktest;

import com.quicktest.ai.AiService;
import com.quicktest.auth.AuthService;
import com.quicktest.tests.QuestionType;
import com.quicktest.tests.QuizDtos;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.demo-seed=false")
class QuickTestWorkflowTests {
    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void creatorCanPublishAndAuthenticatedParticipantCanSubmit() throws Exception {
        String token = register("owner@example.com");

        QuizDtos.TestRequest request = new QuizDtos.TestRequest(
                "Java basics",
                "MVP workflow",
                "Bulgarian",
                null,
                false,
                false,
                true,
                true,
                List.of(new QuizDtos.QuestionRequest(
                        QuestionType.SINGLE_CHOICE,
                        "What hides object state?",
                        null,
                        1,
                        "Encapsulation hides state.",
                        List.of(
                                new QuizDtos.AnswerRequest("Encapsulation", true),
                                new QuizDtos.AnswerRequest("Compilation", false)
                        )
                ))
        );

        JsonNode created = postJson("/api/tests", request, token);
        long testId = created.get("id").asLong();
        long answerId = created.get("questions").get(0).get("answers").get(0).get("id").asLong();

        JsonNode published = postJson("/api/tests/" + testId + "/publish", "", token);
        String code = published.get("publicCode").asText();

        mvc.perform(get("/api/public/tests/" + code).header("Authorization", "Bearer " + token)).andExpect(status().isOk());

        JsonNode result = postJson("/api/public/tests/" + code + "/attempts", new QuizDtos.SubmitAttemptRequest(
                "Guest Student",
                "student@example.com",
                List.of(new QuizDtos.SubmittedAnswer(created.get("questions").get(0).get("id").asLong(), List.of(answerId), null))
        ), token);

        assertEquals(1, result.get("score").asInt());
        assertEquals(100.0, result.get("percentage").asDouble());
    }

    @Test
    void aiGenerationReturnsDraftAndTracksUsage() throws Exception {
        String token = register("ai-owner@example.com");
        JsonNode generated = postJson("/api/ai/generate-test", new AiService.AiGenerateTestRequest(
                "Java OOP",
                "Short test",
                "Bulgarian",
                3,
                "MEDIUM"
        ), token);

        assertEquals(3, generated.get("test").get("questions").size());

        JsonNode dashboard = getJson("/api/dashboard", token);
        assertEquals(1, dashboard.get("aiGenerations").asLong());
        assertEquals(0, jdbc.queryForObject("SELECT estimated_cost FROM ai_usage WHERE user_id = (SELECT id FROM users WHERE email = ?)",
                java.math.BigDecimal.class, "ai-owner@example.com").signum());
    }

    @Test
    void onlyOwnerCanDeleteTestIncludingSubmittedAnswersAndResults() throws Exception {
        String owner = register("delete-owner@example.com");
        String other = register("delete-other@example.com");
        JsonNode created = postJson("/api/tests", deletionTest(), owner);
        long id = created.get("id").asLong();
        long questionId = created.get("questions").get(0).get("id").asLong();
        long answerId = created.get("questions").get(0).get("answers").get(0).get("id").asLong();
        String code = postJson("/api/tests/" + id + "/publish", "", owner).get("publicCode").asText();
        JsonNode result = postJson("/api/public/tests/" + code + "/attempts", new QuizDtos.SubmitAttemptRequest(
                "Guest", "guest@example.com", List.of(new QuizDtos.SubmittedAnswer(questionId, List.of(answerId), null))
        ), owner);
        long attemptId = result.get("attemptId").asLong();

        mvc.perform(delete("/api/tests/" + id)).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/tests/" + id).header("Authorization", "Bearer " + other)).andExpect(status().isNotFound());
        mvc.perform(get("/api/public/tests/" + code).header("Authorization", "Bearer " + owner)).andExpect(status().isOk());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM attempt WHERE id = ?", Long.class, attemptId));

        mvc.perform(delete("/api/tests/" + id).header("Authorization", "Bearer " + owner)).andExpect(status().isNoContent());
        mvc.perform(get("/api/tests/" + id).header("Authorization", "Bearer " + owner)).andExpect(status().isNotFound());
        mvc.perform(get("/api/public/tests/" + code).header("Authorization", "Bearer " + owner)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/tests/" + id).header("Authorization", "Bearer " + owner)).andExpect(status().isNotFound());
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM question WHERE id = ?", Long.class, questionId));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM answer WHERE question_id = ?", Long.class, questionId));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM attempt WHERE id = ?", Long.class, attemptId));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM attempt_answer WHERE attempt_id = ?", Long.class, attemptId));
        assertEquals(0, getJson("/api/tests/results", owner).size());
    }

    @Test
    void ownerCanDeleteDraftWithoutAttempts() throws Exception {
        String token = register("delete-draft@example.com");
        long id = postJson("/api/tests", deletionTest(), token).get("id").asLong();
        mvc.perform(delete("/api/tests/" + id).header("Authorization", "Bearer " + token)).andExpect(status().isNoContent());
        assertEquals(0, getJson("/api/tests", token).size());
    }

    @Test
    void aiRejectsInvalidQuestionCount() throws Exception {
        String token = register("invalid-ai-count@example.com");
        mvc.perform(post("/api/ai/generate-test").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new AiService.AiGenerateTestRequest("Math", "", "Bulgarian", 21, "EASY"))))
                .andExpect(status().isBadRequest());
        assertEquals(0, getJson("/api/dashboard", token).get("aiGenerations").asInt());
    }

    private QuizDtos.TestRequest deletionTest() {
        return new QuizDtos.TestRequest("Delete workflow", "", "Bulgarian", null, false, false, true, true,
                List.of(new QuizDtos.QuestionRequest(QuestionType.SINGLE_CHOICE, "What is 2 + 2?", null, 1, "2 + 2 = 4.",
                        List.of(new QuizDtos.AnswerRequest("4", true), new QuizDtos.AnswerRequest("5", false)))));
    }

    private String register(String email) throws Exception {
        JsonNode auth = postJson("/api/auth/register", new AuthService.RegisterRequest("Owner", email, "password123"), null);
        jdbc.update("UPDATE users SET role = 'TEACHER', subscription_paid = TRUE, subscription_paid_until = ? WHERE email = ?",
                java.sql.Date.valueOf(java.time.LocalDate.now().plusDays(30)), email);
        return auth.get("token").asText();
    }

    private JsonNode getJson(String path, String token) throws Exception {
        return objectMapper.readTree(mvc.perform(get(path).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    }

    private JsonNode postJson(String path, Object body, String token) throws Exception {
        var builder = post(path)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body instanceof String text ? text : objectMapper.writeValueAsString(body));
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        return objectMapper.readTree(mvc.perform(builder)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    }
}
