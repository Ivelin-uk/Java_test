package com.quicktest;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.AuthService;
import com.quicktest.auth.Role;
import com.quicktest.workspace.AssessmentService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:subjects;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
@AutoConfigureMockMvc
@Transactional
class SubjectTests {
    private static final AtomicInteger nextClient = new AtomicInteger();
    private final String address = "192.0.2." + nextClient.incrementAndGet();
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;

    @Test
    void catalogAndCreationRequireAnAuthenticatedTeacher() throws Exception {
        Session teacher = session(Role.TEACHER), student = session(Role.STUDENT);
        call(get("/api/v1/subjects"), null, null, 401);
        call(post("/api/v1/subjects"), null, Map.of("name", "Чужда дисциплина"), 401);
        call(get("/api/v1/subjects"), student.token, null, 403);
        call(post("/api/v1/subjects"), student.token, Map.of("name", "Чужда дисциплина"), 403);
        JsonNode catalog = call(get("/api/v1/subjects"), teacher.token, null, 200);
        assertTrue(has(catalog, "Математика"));
        assertTrue(has(catalog, "Български език и литература"));
        assertTrue(has(catalog, "Информатика"));
        assertTrue(catalog.get(0).path("preset").isBoolean());
    }

    @Test
    void personalSubjectsPersistAndRepeatedNormalizedNamesAreIdempotentAndIsolated() throws Exception {
        Session teacher = session(Role.TEACHER), other = session(Role.TEACHER);
        JsonNode created = call(post("/api/v1/subjects"), teacher.token,
                Map.of("name", "  Авиационна\u00a0  техника  ", "owner_id", other.id), 200);
        assertEquals("Авиационна техника", created.path("name").asText());
        assertFalse(created.path("preset").asBoolean());
        JsonNode retried = call(post("/api/v1/subjects"), teacher.token, Map.of("name", "АВИАЦИОННА ТЕХНИКА"), 200);
        assertEquals(created, retried);
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM teacher_subjects WHERE owner_id=?", Long.class, teacher.id));
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM workspace_audit WHERE actor_id=? AND action='subject.created'", Long.class, teacher.id));
        assertTrue(has(call(get("/api/v1/subjects"), teacher.token, null, 200), "Авиационна техника"));
        assertFalse(has(call(get("/api/v1/subjects"), other.token, null, 200), "Авиационна техника"));
        call(post("/api/v1/subjects"), other.token, Map.of("name", "Авиационна техника"), 200);
        assertEquals(2L, jdbc.queryForObject("SELECT COUNT(*) FROM teacher_subjects", Long.class));
        JsonNode preset = call(post("/api/v1/subjects"), teacher.token, Map.of("name", " МАТЕМАТИКА "), 200);
        assertEquals("Математика", preset.path("name").asText());
        assertTrue(preset.path("preset").asBoolean());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM teacher_subjects WHERE owner_id=?", Long.class, teacher.id));
    }

    @Test
    void invalidNamesAreRejectedAndExistingTestSubjectsRemainAvailableWithoutAnswerLeakage() throws Exception {
        Session teacher = session(Role.TEACHER), other = session(Role.TEACHER);
        for (String invalid : List.of("", "   ", "x".repeat(191), "İ".repeat(190), "bad\u0000name"))
            call(post("/api/v1/subjects"), teacher.token, Map.of("name", invalid), 400);
        call(post("/api/v1/subjects"), teacher.token, Map.of(), 400);
        var question = new AssessmentService.Question("SINGLE_CHOICE", "Въпрос", "EASY", BigDecimal.ONE, 60,
                List.of(new AssessmentService.Option("Secret correct answer", true), new AssessmentService.Option("Other", false)), List.of(), true, true, "", "");
        call(post("/api/v1/tests"), teacher.token, new AssessmentService.Definition("Стар тест", "", "Специална география", "", "", "bg", "percentage", new BigDecimal("50"), List.of(question)), 200);
        call(post("/api/v1/tests"), teacher.token, new AssessmentService.Definition("Без предмет", "", "", "", "", "bg", "percentage", new BigDecimal("50"), List.of(question)), 200);
        JsonNode catalog = call(get("/api/v1/subjects"), teacher.token, null, 200);
        assertTrue(has(catalog, "Специална география"));
        assertFalse(has(call(get("/api/v1/subjects"), other.token, null, 200), "Специална география"));
        JsonNode tests = call(get("/api/v1/tests"), teacher.token, null, 200);
        assertEquals(2, tests.size());
        assertTrue(tests.toString().contains("Специална география"));
        assertFalse(tests.toString().contains("Secret correct answer"));
        assertFalse(tests.toString().contains("definition_json"));
        assertFalse(catalog.toString().contains("Secret correct answer"));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM teacher_subjects", Long.class));
    }

    private boolean has(JsonNode catalog, String name) {
        for (JsonNode entry : catalog) if (entry.path("name").asText().equals(name)) return true;
        return false;
    }

    private Session session(Role role) throws Exception {
        AppUser user = new AppUser();
        user.setName(role.name()); user.setEmail(UUID.randomUUID() + "@example.test");
        user.setRole(role); user.setPasswordHash(encoder.encode("password123")); users.saveAndFlush(user);
        String token = call(post("/api/auth/login"), null, new AuthService.LoginRequest(user.getEmail(), "password123"), 200).path("token").asText();
        return new Session(user.getId(), token);
    }

    private JsonNode call(MockHttpServletRequestBuilder request, String token, Object body, int expected) throws Exception {
        request.with(value -> { value.setRemoteAddr(address); return value; });
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body));
        String response = mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return response.isBlank() ? mapper.nullNode() : mapper.readTree(response);
    }

    private record Session(long id, String token) {}
}
