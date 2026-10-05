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

    @Test
    void creatorCanPublishAndGuestCanSubmit() throws Exception {
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

        mvc.perform(get("/api/public/tests/" + code)).andExpect(status().isOk());

        JsonNode result = postJson("/api/public/tests/" + code + "/attempts", new QuizDtos.SubmitAttemptRequest(
                "Guest Student",
                "student@example.com",
                List.of(new QuizDtos.SubmittedAnswer(created.get("questions").get(0).get("id").asLong(), List.of(answerId), null))
        ), null);

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
    }

    private String register(String email) throws Exception {
        JsonNode auth = postJson("/api/auth/register", new AuthService.RegisterRequest("Owner", email, "password123"), null);
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
