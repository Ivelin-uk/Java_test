package com.quicktest;

import com.quicktest.admin.AdminService;
import com.quicktest.auth.*;
import com.quicktest.tests.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:admin_security;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
@AutoConfigureMockMvc
@Transactional
class AdminSecurityTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AppUserRepository users;
    @Autowired AuthTokenRepository tokens;
    @Autowired PasswordEncoder encoder;
    @Autowired QuizTestRepository tests;
    @Autowired AttemptRepository attempts;

    @Test
    void registrationCannotChoosePrivilegedRoleOrSubscription() throws Exception {
        JsonNode response = call(post("/api/auth/register"), null, Map.of("name", "Student", "email", "injection@example.test",
                "password", "password123", "role", "ADMIN", "active", true, "subscriptionPaid", true), 200);
        assertEquals("STUDENT", response.path("user").path("role").asText());
        assertFalse(response.path("user").path("subscription").path("paid").asBoolean());
        call(post("/api/auth/register"), null, new AuthService.RegisterRequest("Student", "long-password@example.test", "я".repeat(40)), 400);
        call(get("/api/admin/users"), response.path("token").asText(), null, 403);
        call(get("/api/tests"), response.path("token").asText(), null, 403);
        call(get("/api/student/tests"), response.path("token").asText(), null, 200);
    }

    @Test
    void administratorRoutesRejectAnonymousTeachersAndStudents() throws Exception {
        Session teacher = session(Role.TEACHER);
        Session student = session(Role.STUDENT);
        for (Session actor : List.of(teacher, student)) {
            call(get("/api/admin/users"), actor.token, null, 403);
            call(post("/api/admin/users"), actor.token, edit(actor.user), 403);
            call(put("/api/admin/users/" + actor.user.getId()), actor.token, edit(actor.user), 403);
            call(post("/api/admin/users/" + actor.user.getId() + "/reset-password"), actor.token, null, 403);
            call(get("/api/admin/permissions"), actor.token, null, 403);
            call(put("/api/admin/permissions"), actor.token, permission("QuizController.list", Role.STUDENT, true, false), 403);
            call(get("/api/admin/audit"), actor.token, null, 403);
        }
        call(get("/api/admin/users"), null, null, 401);
        call(get("/api/public/tests/unknown"), null, null, 401);
    }

    @Test
    void permissionsAreMethodSpecificAndImmediatelyAffectExistingTokens() throws Exception {
        Session admin = session(Role.ADMIN);
        Session teacher = session(Role.TEACHER);
        call(get("/api/tests"), teacher.token, null, 200);
        call(put("/api/admin/permissions"), admin.token, permission("QuizController.list", Role.TEACHER, false, false), 200);
        call(get("/api/tests"), teacher.token, null, 403);
        call(get("/api/dashboard"), teacher.token, null, 200);
        JsonNode me = call(get("/api/auth/me"), teacher.token, null, 200);
        assertFalse(me.path("allowedMethods").toString().contains("QuizController.list"));
        call(put("/api/admin/permissions"), admin.token, permission("QuizController.list", Role.TEACHER, true, false), 200);
        call(get("/api/tests"), teacher.token, null, 200);
        Session student = session(Role.STUDENT);
        call(put("/api/admin/permissions"), admin.token, permission("QuizController.create", Role.STUDENT, true, false), 200);
        call(post("/api/tests"), student.token, quiz(), 200);
        call(get("/api/tests"), student.token, null, 403);
    }

    @Test
    void fixedAndUnknownPermissionsCannotBeDelegatedAndBatchesAreAtomic() throws Exception {
        Session admin = session(Role.ADMIN);
        Session teacher = session(Role.TEACHER);
        for (String key : List.of("AdminController.users", "AuthController.me", "AuthController.login", "Missing.method"))
            call(put("/api/admin/permissions"), admin.token, permission(key, Role.STUDENT, true, false), 400);
        call(put("/api/admin/permissions"), admin.token, permission("QuizController.list", Role.ADMIN, false, true), 400);
        var change = new AdminService.PermissionChange("QuizController.list", Role.TEACHER, false, false);
        call(put("/api/admin/permissions"), admin.token, new AdminService.PermissionEdit(List.of(change, change)), 400);
        call(put("/api/admin/permissions"), admin.token, new AdminService.PermissionEdit(List.of(change,
                new AdminService.PermissionChange("AdminController.users", Role.STUDENT, true, false))), 400);
        call(get("/api/tests"), teacher.token, null, 200);
    }

    @Test
    void deactivateRevokesSessionsAndReactivationAllowsLogin() throws Exception {
        Session admin = session(Role.ADMIN);
        Session student = session(Role.STUDENT);
        call(put("/api/admin/users/" + student.user.getId()), admin.token, withActive(student.user, false), 200);
        call(get("/api/auth/me"), student.token, null, 401);
        call(post("/api/auth/login"), null, new AuthService.LoginRequest(student.user.getEmail(), "password123"), 401);
        call(put("/api/admin/users/" + student.user.getId()), admin.token, withActive(student.user, true), 200);
        assertFalse(call(post("/api/auth/login"), null, new AuthService.LoginRequest(student.user.getEmail(), "password123"), 200).path("token").asText().isBlank());
    }

    @Test
    void resetRequiresPasswordChangeAndNeverLeaksHash() throws Exception {
        Session admin = session(Role.ADMIN);
        call(post("/api/admin/users/" + admin.user.getId() + "/reset-password"), admin.token, null, 400);
        Session student = session(Role.STUDENT);
        JsonNode reset = call(post("/api/admin/users/" + student.user.getId() + "/reset-password"), admin.token, null, 200);
        String temporary = reset.path("temporaryPassword").asText();
        assertTrue(temporary.length() >= 20);
        assertTrue(encoder.matches(temporary, student.user.getPasswordHash()));
        call(get("/api/auth/me"), student.token, null, 401);
        call(post("/api/auth/login"), null, new AuthService.LoginRequest(student.user.getEmail(), "password123"), 401);
        JsonNode login = call(post("/api/auth/login"), null, new AuthService.LoginRequest(student.user.getEmail(), temporary), 200);
        String token = login.path("token").asText();
        assertTrue(login.path("user").path("passwordChangeRequired").asBoolean());
        call(get("/api/student/tests"), token, null, 403);
        call(get("/api/auth/me"), token, null, 200);
        call(post("/api/auth/password"), token, new AuthService.ChangePasswordRequest("wrong", "new-password123"), 400);
        JsonNode changed = call(post("/api/auth/password"), token, new AuthService.ChangePasswordRequest(temporary, "new-password123"), 200);
        assertFalse(changed.path("user").path("passwordChangeRequired").asBoolean());
        call(get("/api/auth/me"), token, null, 401);
        call(get("/api/student/tests"), changed.path("token").asText(), null, 200);
        call(post("/api/auth/login"), null, new AuthService.LoginRequest(student.user.getEmail(), temporary), 401);
        String list = call(get("/api/admin/users"), admin.token, null, 200).toString();
        String log = call(get("/api/admin/audit"), admin.token, null, 200).toString();
        assertFalse(list.contains("passwordHash")); assertFalse(list.contains(temporary)); assertFalse(log.contains(temporary));
    }

    @Test
    void logoutRevokesOnlyCurrentSession() throws Exception {
        Session student = session(Role.STUDENT);
        String second = call(post("/api/auth/login"), null, new AuthService.LoginRequest(student.user.getEmail(), "password123"), 200).path("token").asText();
        call(post("/api/auth/logout"), student.token, null, 204);
        call(get("/api/auth/me"), student.token, null, 401);
        call(get("/api/auth/me"), second, null, 200);
    }

    @Test
    void emailRecoveryIsUniqueCaseInsensitiveAndRevokesOldSessions() throws Exception {
        Session admin = session(Role.ADMIN);
        Session student = session(Role.STUDENT);
        String oldEmail = student.user.getEmail();
        call(put("/api/admin/users/" + student.user.getId()), admin.token,
                new AdminService.UserEdit("Student", admin.user.getEmail().toUpperCase(), Role.STUDENT, true, false, null), 409);
        call(put("/api/admin/users/" + student.user.getId()), admin.token,
                new AdminService.UserEdit("Student", "RECOVERED@example.test", Role.STUDENT, true, false, null), 200);
        call(get("/api/auth/me"), student.token, null, 401);
        call(post("/api/auth/login"), null, new AuthService.LoginRequest(oldEmail, "password123"), 401);
        assertEquals("recovered@example.test", call(post("/api/auth/login"), null,
                new AuthService.LoginRequest("recovered@example.test", "password123"), 200).path("user").path("email").asText());
    }

    @Test
    void subscriptionIsPaidAndDateSensitiveIncludingLastDay() throws Exception {
        Session admin = session(Role.ADMIN);
        Session teacher = session(Role.TEACHER);
        LocalDate today = LocalDate.now(ZoneId.of("Europe/Sofia"));
        call(put("/api/admin/permissions"), admin.token, permission("QuizController.list", Role.TEACHER, true, true), 200);
        call(get("/api/tests"), teacher.token, null, 403);
        for (LocalDate expiry : List.of(today.minusDays(1), today, today.plusDays(30))) {
            call(put("/api/admin/users/" + teacher.user.getId()), admin.token,
                    new AdminService.UserEdit(teacher.user.getName(), teacher.user.getEmail(), Role.TEACHER, true, true, expiry), 200);
            call(get("/api/tests"), teacher.token, null, expiry.isBefore(today) ? 403 : 200);
            assertEquals(!expiry.isBefore(today), call(get("/api/auth/me"), teacher.token, null, 200).path("subscription").path("active").asBoolean());
        }
        call(put("/api/admin/users/" + teacher.user.getId()), admin.token,
                new AdminService.UserEdit(teacher.user.getName(), teacher.user.getEmail(), Role.TEACHER, true, true, null), 400);
        call(put("/api/admin/users/" + teacher.user.getId()), admin.token,
                new AdminService.UserEdit(teacher.user.getName(), teacher.user.getEmail(), Role.TEACHER, true, false, today.plusDays(30)), 200);
        call(get("/api/tests"), teacher.token, null, 403);
        call(get("/api/tests"), admin.token, null, 200);
    }

    @Test
    void lastActiveAdministratorCannotBeRemoved() throws Exception {
        Session admin = session(Role.ADMIN);
        call(put("/api/admin/users/" + admin.user.getId()), admin.token, withActive(admin.user, false), 409);
        call(put("/api/admin/users/" + admin.user.getId()), admin.token,
                new AdminService.UserEdit(admin.user.getName(), admin.user.getEmail(), Role.TEACHER, true, false, null), 409);
        Session second = session(Role.ADMIN);
        call(put("/api/admin/users/" + admin.user.getId()), second.token, withActive(admin.user, false), 200);
        call(get("/api/admin/users"), admin.token, null, 401);
    }

    @Test
    void adminCanManageOtherOwnersAndStudentsOnlyReceivePublicQuestions() throws Exception {
        Session admin = session(Role.ADMIN);
        Session teacher = session(Role.TEACHER);
        Session student = session(Role.STUDENT);
        JsonNode created = call(post("/api/tests"), teacher.token, quiz(), 200);
        long id = created.path("id").asLong();
        call(get("/api/tests/" + id), student.token, null, 403);
        call(put("/api/tests/" + id), admin.token, quiz(), 200);
        String code = call(post("/api/tests/" + id + "/publish"), admin.token, null, 200).path("publicCode").asText();
        assertEquals(1, call(get("/api/tests"), admin.token, null, 200).size());
        JsonNode publicTest = call(get("/api/public/tests/" + code), student.token, null, 200);
        assertFalse(publicTest.toString().contains("correct"));
        call(post("/api/public/tests/" + code + "/attempts"), null,
                new QuizDtos.SubmitAttemptRequest("fake", "fake@example.test", List.of()), 401);
        JsonNode submitted = call(post("/api/public/tests/" + code + "/attempts"), student.token,
                new QuizDtos.SubmitAttemptRequest("fake", "fake@example.test", List.of(new QuizDtos.SubmittedAnswer(
                        publicTest.path("questions").get(0).path("id").asLong(),
                        List.of(publicTest.path("questions").get(0).path("answers").get(0).path("id").asLong()), null))), 200);
        assertEquals(student.user.getName(), submitted.path("participantName").asText());
        assertEquals(student.user.getId(), attempts.findById(submitted.path("attemptId").asLong()).orElseThrow().getUser().getId());
        assertEquals(1, call(get("/api/student/results"), student.token, null, 200).size());
        QuizDtos.TestRequest metadataEdit = new QuizDtos.TestRequest("Updated title", "", "Bulgarian", 15, false, false, true, true, quiz().questions());
        assertEquals("Updated title", call(put("/api/tests/" + id), admin.token, metadataEdit, 200).path("title").asText());
        QuizDtos.TestRequest changedQuestions = new QuizDtos.TestRequest("Changed", "", "Bulgarian", 15, false, false, true, true,
                List.of(new QuizDtos.QuestionRequest(QuestionType.SINGLE_CHOICE, "3 + 3?", Difficulty.EASY, 1, "6",
                        List.of(new QuizDtos.AnswerRequest("6", true), new QuizDtos.AnswerRequest("5", false)))));
        call(put("/api/tests/" + id), admin.token, changedQuestions, 409);
        call(get("/api/tests/results"), student.token, null, 403);
        assertEquals(1, call(get("/api/tests/results"), admin.token, null, 200).size());
        call(delete("/api/tests/" + id), admin.token, null, 204);
        assertEquals(0, tests.count()); assertEquals(0, attempts.count());
    }

    @Test
    void administratorCreatesUsersWithOneTimeTemporaryPasswords() throws Exception {
        Session admin = session(Role.ADMIN);
        JsonNode created = call(post("/api/admin/users"), admin.token,
                new AdminService.UserEdit("New Teacher", "new-teacher@example.test", Role.TEACHER, true, true, LocalDate.now().plusDays(30)), 200);
        JsonNode login = call(post("/api/auth/login"), null,
                new AuthService.LoginRequest("new-teacher@example.test", created.path("temporaryPassword").asText()), 200);
        assertEquals("TEACHER", login.path("user").path("role").asText());
        assertTrue(login.path("user").path("passwordChangeRequired").asBoolean());
        assertTrue(login.path("user").path("subscription").path("active").asBoolean());
    }

    private Session session(Role role) throws Exception {
        AppUser user = new AppUser(); user.setName(role.name()); user.setEmail(UUID.randomUUID() + "@example.test");
        user.setRole(role); user.setPasswordHash(encoder.encode("password123")); users.saveAndFlush(user);
        String token = call(post("/api/auth/login"), null, new AuthService.LoginRequest(user.getEmail(), "password123"), 200).path("token").asText();
        return new Session(user, token);
    }
    private AdminService.UserEdit edit(AppUser user) { return withActive(user, user.isActive()); }
    private AdminService.UserEdit withActive(AppUser user, boolean active) {
        return new AdminService.UserEdit(user.getName(), user.getEmail(), user.getRole(), active, user.isSubscriptionPaid(), user.getSubscriptionPaidUntil());
    }
    private AdminService.PermissionEdit permission(String key, Role role, boolean allowed, boolean paid) {
        return new AdminService.PermissionEdit(List.of(new AdminService.PermissionChange(key, role, allowed, paid)));
    }
    private QuizDtos.TestRequest quiz() {
        return new QuizDtos.TestRequest("Security test", "", "Bulgarian", null, false, false, true, true,
                List.of(new QuizDtos.QuestionRequest(QuestionType.SINGLE_CHOICE, "2 + 2?", Difficulty.EASY, 1, "4",
                        List.of(new QuizDtos.AnswerRequest("4", true), new QuizDtos.AnswerRequest("5", false)))));
    }
    private JsonNode call(MockHttpServletRequestBuilder request, String token, Object body, int expected) throws Exception {
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body));
        String response = mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
        return response.isBlank() ? mapper.nullNode() : mapper.readTree(response);
    }
    private record Session(AppUser user, String token) {}
}
