package com.quicktest;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.AuthService;
import com.quicktest.auth.Role;
import com.quicktest.workspace.AssessmentService;
import com.quicktest.workspace.SubjectCatalogAdminService;
import com.quicktest.workspace.WorkspaceError;
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

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:subject_catalog;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
@AutoConfigureMockMvc
@Transactional
class SubjectCatalogAdminTests {
    private static final AtomicInteger nextClient = new AtomicInteger();
    private final String address = "192.0.2." + (90 + nextClient.incrementAndGet());
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;
    @Autowired SubjectCatalogAdminService catalog;

    @Test
    void catalogAdministrationRequiresAnActiveAdministratorForEveryRouteAndService() throws Exception {
        Session teacher = session(Role.TEACHER), student = session(Role.STUDENT);
        for (String token : new String[] { null, teacher.token, student.token }) {
            int denied = token == null ? 401 : 403;
            call(get("/api/admin/subjects"), token, null, denied);
            call(post("/api/admin/subjects"), token, Map.of("name", "Нова дисциплина"), denied);
            call(put("/api/admin/subjects/1"), token, Map.of("name", "Ново име"), denied);
            call(delete("/api/admin/subjects/1"), token, null, denied);
            call(get("/api/admin/subjects/1/topics"), token, null, denied);
            call(post("/api/admin/subjects/1/topics"), token, Map.of("name", "Нова тема", "level", "7"), denied);
            call(put("/api/admin/subjects/1/topics/1"), token, Map.of("name", "Ново име", "level", ""), denied);
            call(delete("/api/admin/subjects/1/topics/1"), token, null, denied);
        }
        assertThrows(WorkspaceError.class, () -> catalog.subjects(teacher.user));
        assertThrows(WorkspaceError.class, () -> catalog.createSubject(teacher.user, "Опит за запис"));
        Session admin = session(Role.ADMIN);
        admin.user.setActive(false); users.saveAndFlush(admin.user);
        assertThrows(WorkspaceError.class, () -> catalog.subjects(admin.user));
    }

    @Test
    void sharedSubjectsAndGradeTopicsArePersistedDeduplicatedAndReadByAllTeachers() throws Exception {
        Session admin = session(Role.ADMIN), teacher = session(Role.TEACHER), other = session(Role.TEACHER);
        JsonNode created = call(post("/api/admin/subjects"), admin.token, Map.of("name", "  Космическа\u00a0 техника  "), 200);
        long subject = created.path("id").asLong();
        assertEquals("Космическа техника", created.path("name").asText());
        assertEquals(0, created.path("topicCount").asInt());
        assertEquals(created, call(post("/api/admin/subjects"), admin.token, Map.of("name", "КОСМИЧЕСКА ТЕХНИКА"), 200));
        for (Session actor : List.of(teacher, other)) {
            JsonNode entry = named(call(get("/api/v1/subjects"), actor.token, null, 200), "Космическа техника");
            assertNotNull(entry); assertTrue(entry.path("preset").asBoolean());
        }
        JsonNode general = call(post(topics(subject)), admin.token, Map.of("name", "Обща тема"), 200);
        JsonNode seventh = call(post(topics(subject)), admin.token, Map.of("name", " Орбитална  механика ", "level", "7"), 200);
        JsonNode eighth = call(post(topics(subject)), admin.token, Map.of("name", "Орбитална механика", "level", "8"), 200);
        assertEquals(seventh, call(post(topics(subject)), admin.token, Map.of("name", "ОРБИТАЛНА\u00a0МЕХАНИКА", "level", "7"), 200));
        assertEquals(subject, seventh.path("subjectId").asLong());
        assertEquals("", general.path("level").asText());
        assertEquals(3, named(call(get("/api/admin/subjects"), admin.token, null, 200), "Космическа техника").path("topicCount").asInt());
        assertEquals(3, call(get(topics(subject)), admin.token, null, 200).size());
        JsonNode grade7 = teacherTopics(other, " КОСМИЧЕСКА ТЕХНИКА ", "7");
        assertEquals(2, grade7.size()); assertTrue(contains(grade7, "Обща тема")); assertTrue(contains(grade7, "Орбитална механика"));
        assertEquals(1, teacherTopics(teacher, "Космическа техника", "9").size());
        assertEquals(2, teacherTopics(teacher, "Космическа техника", "").size(), "Same topic name in different grades is suggested once");

        call(put(topics(subject) + "/" + seventh.path("id").asLong()), admin.token, Map.of("name", "Спътници", "level", "9"), 200);
        assertFalse(contains(teacherTopics(other, "Космическа техника", "7"), "Орбитална механика"));
        assertTrue(contains(teacherTopics(other, "Космическа техника", "9"), "Спътници"));
        call(delete(topics(subject) + "/" + eighth.path("id").asLong()), admin.token, null, 204);
        assertFalse(contains(teacherTopics(other, "Космическа техника", "8"), "Орбитална механика"));
        call(put("/api/admin/subjects/" + subject), admin.token, Map.of("name", "Космически науки"), 200);
        assertNull(named(call(get("/api/v1/subjects"), teacher.token, null, 200), "Космическа техника"));
        assertTrue(contains(teacherTopics(other, "Космически науки", "9"), "Спътници"));
        assertEquals(1, count("SELECT COUNT(*) FROM admin_audit WHERE actor_id=? AND action='SUBJECT_CREATED'", admin.user.getId()));
        assertEquals(3, count("SELECT COUNT(*) FROM admin_audit WHERE actor_id=? AND action='TOPIC_CREATED'", admin.user.getId()));
        assertEquals(1, count("SELECT COUNT(*) FROM admin_audit WHERE actor_id=? AND action='SUBJECT_UPDATED'", admin.user.getId()));
        assertEquals(1, count("SELECT COUNT(*) FROM admin_audit WHERE actor_id=? AND action='TOPIC_UPDATED'", admin.user.getId()));
        assertEquals(1, count("SELECT COUNT(*) FROM admin_audit WHERE actor_id=? AND action='TOPIC_DELETED'", admin.user.getId()));
    }

    @Test
    void validationConflictsAndNestedTopicIsolationProtectCatalog() throws Exception {
        Session admin = session(Role.ADMIN);
        long first = call(post("/api/admin/subjects"), admin.token, Map.of("name", "Предмет едно"), 200).path("id").asLong();
        long second = call(post("/api/admin/subjects"), admin.token, Map.of("name", "Предмет две"), 200).path("id").asLong();
        for (String invalid : List.of("", "  ", "x".repeat(191), "İ".repeat(190), "bad\u0000name")) {
            call(post("/api/admin/subjects"), admin.token, Map.of("name", invalid), 400);
            call(post(topics(first)), admin.token, Map.of("name", invalid), 400);
        }
        call(post("/api/admin/subjects"), admin.token, Map.of(), 400);
        for (String level : List.of("0", "13", "7 клас", "x".repeat(191)))
            call(post(topics(first)), admin.token, Map.of("name", "Клас", "level", level), 400);
        call(put("/api/admin/subjects/" + first), admin.token, Map.of("name", "ПРЕДМЕТ ДВЕ"), 409);
        long topic = call(post(topics(first)), admin.token, Map.of("name", "Тема едно", "level", "7"), 200).path("id").asLong();
        long duplicate = call(post(topics(first)), admin.token, Map.of("name", "Тема две", "level", "7"), 200).path("id").asLong();
        call(put(topics(first) + "/" + duplicate), admin.token, Map.of("name", "ТЕМА ЕДНО", "level", "7"), 409);
        call(put(topics(second) + "/" + topic), admin.token, Map.of("name", "Опит за преместване", "level", "8"), 404);
        call(delete(topics(second) + "/" + topic), admin.token, null, 404);
        assertEquals(2, call(get(topics(first)), admin.token, null, 200).size());
        call(get(topics(Long.MAX_VALUE)), admin.token, null, 404);
        call(post(topics(Long.MAX_VALUE)), admin.token, Map.of("name", "Тема"), 404);
        call(put("/api/admin/subjects/" + Long.MAX_VALUE), admin.token, Map.of("name", "Тема"), 404);
        call(delete("/api/admin/subjects/" + Long.MAX_VALUE), admin.token, null, 404);
    }

    @Test
    void seedCatalogCanBeEditedOrRemovedWithoutHardcodedFallbackOrChangedTests() throws Exception {
        Session admin = session(Role.ADMIN), teacher = session(Role.TEACHER), other = session(Role.TEACHER);
        JsonNode math = named(call(get("/api/admin/subjects"), admin.token, null, 200), "Математика");
        assertNotNull(math);
        long subject = math.path("id").asLong();
        assertTrue(contains(teacherTopics(teacher, "Математика", "7"), "Уравнения"));
        JsonNode topic = named(call(get(topics(subject)), admin.token, null, 200), "Уравнения");
        call(put(topics(subject) + "/" + topic.path("id").asLong()), admin.token, Map.of("name", "Уравнения от първа степен", "level", "7"), 200);
        assertFalse(contains(teacherTopics(teacher, "Математика", "7"), "Уравнения"));
        assertTrue(contains(teacherTopics(teacher, "Математика", "7"), "Уравнения от първа степен"));
        assertFalse(contains(teacherTopics(teacher, "Математика", "8"), "Уравнения от първа степен"));
        var definition = new AssessmentService.Definition("Лична тема", "", "Математика", "7", "", "bg", "percentage", new BigDecimal("50"), List.of());
        JsonNode saved = call(post("/api/v1/tests"), teacher.token, definition, 200);
        long test = saved.path("id").asLong();
        String snapshot = saved.path("definition_json").asText();
        call(delete("/api/admin/subjects/" + subject), admin.token, null, 204);
        assertEquals(0, count("SELECT COUNT(*) FROM subject_topics WHERE subject_id=?", subject));
        assertEquals(snapshot, call(get("/api/v1/tests/" + test), teacher.token, null, 200).path("definition_json").asText());
        assertNotNull(named(call(get("/api/v1/subjects"), teacher.token, null, 200), "Математика"), "Existing test metadata remains selectable");
        assertNull(named(call(get("/api/v1/subjects"), other.token, null, 200), "Математика"), "Removed DB subject must not return from Java defaults");
        JsonNode own = teacherTopics(teacher, "Математика", "7");
        assertEquals(1, own.size()); assertTrue(contains(own, "Лична тема"));
        assertEquals(0, teacherTopics(other, "Математика", "7").size());
        assertEquals(1, count("SELECT COUNT(*) FROM admin_audit WHERE actor_id=? AND action='SUBJECT_DELETED'", admin.user.getId()));
    }

    private String topics(long subject) { return "/api/admin/subjects/" + subject + "/topics"; }
    private JsonNode teacherTopics(Session actor, String subject, String level) throws Exception {
        return call(get("/api/v1/subjects/topics").param("subject", subject).param("level", level), actor.token, null, 200);
    }
    private JsonNode named(JsonNode rows, String name) {
        for (JsonNode row : rows) if (row.path("name").asText().equals(name)) return row;
        return null;
    }
    private boolean contains(JsonNode rows, String name) {
        for (JsonNode row : rows) if (row.asText().equals(name)) return true;
        return false;
    }
    private long count(String query, Object... args) { return jdbc.queryForObject(query, Long.class, args); }
    private Session session(Role role) throws Exception {
        AppUser user = new AppUser(); user.setName(role.name()); user.setEmail(UUID.randomUUID() + "@example.test");
        user.setRole(role); user.setPasswordHash(encoder.encode("password123")); users.saveAndFlush(user);
        String token = call(post("/api/auth/login"), null, new AuthService.LoginRequest(user.getEmail(), "password123"), 200).path("token").asText();
        return new Session(user, token);
    }
    private JsonNode call(MockHttpServletRequestBuilder request, String token, Object body, int expected) throws Exception {
        request.with(value -> { value.setRemoteAddr(address); return value; });
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body));
        String response = mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return response.isBlank() ? mapper.nullNode() : mapper.readTree(response);
    }
    private record Session(AppUser user, String token) {}
}
