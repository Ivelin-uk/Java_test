package com.quicktest;

import com.quicktest.admin.AdminService;
import com.quicktest.admin.AdminAuditRepository;
import com.quicktest.auth.*;
import com.quicktest.tests.*;
import com.quicktest.workspace.PersonalWorkspace;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDate;
import java.time.ZoneId;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:admin_security;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
@AutoConfigureMockMvc
@Transactional
class AdminSecurityTests {
    // Rate-limit counters commit independently; give each test its own client address.
    private static final AtomicInteger nextClient = new AtomicInteger();
    private final String remoteAddress = "192.0.2." + nextClient.incrementAndGet();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AppUserRepository users;
    @Autowired AuthTokenRepository tokens;
    @Autowired AuthService auth;
    @Autowired PasswordEncoder encoder;
    @Autowired QuizTestRepository tests;
    @Autowired AttemptRepository attempts;
    @Autowired AdminAuditRepository audits;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager entities;
    @Autowired PersonalWorkspace personal;

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
            call(get("/api/admin/teacher-billing"), actor.token, null, 403);
            call(post("/api/admin/users"), actor.token, edit(actor.user), 403);
            call(put("/api/admin/users/" + actor.user.getId()), actor.token, edit(actor.user), 403);
            call(put("/api/admin/users/" + actor.user.getId() + "/role"), actor.token, new AdminService.RoleEdit(Role.ADMIN), 403);
            call(post("/api/admin/users/" + actor.user.getId() + "/reset-password"), actor.token, null, 403);
            call(delete("/api/admin/users/" + actor.user.getId()), actor.token, Map.of("password", "password123"), 403);
            call(get("/api/admin/permissions"), actor.token, null, 403);
            call(put("/api/admin/permissions"), actor.token, permission("QuizController.list", Role.STUDENT, true, false), 403);
            call(get("/api/admin/audit"), actor.token, null, 403);
        }
        call(get("/api/admin/users"), null, null, 401);
        call(get("/api/admin/teacher-billing"), null, null, 401);
        call(put("/api/admin/users/" + teacher.user.getId() + "/role"), null, new AdminService.RoleEdit(Role.ADMIN), 401);
        call(delete("/api/admin/users/" + teacher.user.getId()), null, Map.of("password", "password123"), 401);
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
        for (String key : List.of("AdminController.users", "AdminController.changeRole", "AdminController.deleteUser", "AuthController.me", "AuthController.login", "Missing.method"))
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
    void roleChangesRevokeEveryTargetSessionAndApplyNewPermissions() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.STUDENT);
        String first = target.token;
        for (Role role : List.of(Role.TEACHER, Role.ADMIN, Role.STUDENT)) {
            String second = call(post("/api/auth/login"), null,
                    new AuthService.LoginRequest(target.user.getEmail(), "password123"), 200).path("token").asText();
            JsonNode changed = call(put("/api/admin/users/" + target.user.getId() + "/role"), admin.token,
                    new AdminService.RoleEdit(role), 200);
            assertEquals(role.name(), changed.path("role").asText());
            assertFalse(changed.path("roleSelectionRequired").asBoolean());
            call(get("/api/auth/me"), first, null, 401);
            call(get("/api/auth/me"), second, null, 401);
            call(get("/api/admin/users"), admin.token, null, 200);
            JsonNode login = call(post("/api/auth/login"), null,
                    new AuthService.LoginRequest(target.user.getEmail(), "password123"), 200);
            assertEquals(role.name(), login.path("user").path("role").asText());
            first = login.path("token").asText();
            call(get("/api/admin/users"), first, null, role == Role.ADMIN ? 200 : 403);
            call(get("/api/tests"), first, null, role == Role.STUDENT ? 403 : 200);
        }
        JsonNode log = call(get("/api/admin/audit"), admin.token, null, 200);
        assertEquals(3, log.size());
        for (JsonNode entry : log) {
            assertEquals("USER_ROLE_CHANGED", entry.path("action").asText());
            assertEquals(admin.user.getEmail(), entry.path("actorEmail").asText());
            assertEquals(target.user.getEmail(), entry.path("targetEmail").asText());
            assertTrue(entry.path("details").asText().contains(" -> "));
        }
    }

    @Test
    void roleOnlyChangePreservesAccountSubscriptionAndAcademicRecords() throws Exception {
        Session admin = session(Role.ADMIN);
        Session teacher = session(Role.TEACHER);
        JsonNode created = call(post("/api/tests"), teacher.token, quiz(), 200);
        teacher.user.setSubscriptionPaid(true);
        teacher.user.setSubscriptionPaidUntil(LocalDate.now().plusDays(30));
        teacher.user.setSubscriptionPaidAt(java.time.Instant.now());
        teacher.user.setEmailVerifiedAt(java.time.Instant.now());
        users.saveAndFlush(teacher.user);
        String hash = teacher.user.getPasswordHash();
        var paidAt = teacher.user.getSubscriptionPaidAt();
        var verifiedAt = teacher.user.getEmailVerifiedAt();
        JsonNode changed = call(put("/api/admin/users/" + teacher.user.getId() + "/role"), admin.token,
                Map.of("role", "STUDENT", "name", "Ignored", "email", "ignored@example.test", "active", false, "subscriptionPaid", false), 200);
        assertEquals(teacher.user.getName(), changed.path("name").asText());
        assertEquals(teacher.user.getEmail(), changed.path("email").asText());
        assertTrue(changed.path("active").asBoolean());
        assertTrue(changed.path("subscription").path("paid").asBoolean());
        assertEquals(hash, teacher.user.getPasswordHash());
        assertEquals(paidAt, teacher.user.getSubscriptionPaidAt());
        assertEquals(verifiedAt, teacher.user.getEmailVerifiedAt());
        assertEquals(teacher.user.getId(), tests.findById(created.path("id").asLong()).orElseThrow().getOwner().getId());
        call(put("/api/admin/users/" + teacher.user.getId() + "/role"), admin.token, new AdminService.RoleEdit(Role.TEACHER), 200);
        String login = call(post("/api/auth/login"), null,
                new AuthService.LoginRequest(teacher.user.getEmail(), "password123"), 200).path("token").asText();
        call(get("/api/tests/" + created.path("id").asLong()), login, null, 200);
    }

    @Test
    void roleChangeProtectsLastActiveAdminButAllowsSelfDemotionWhenAnotherExists() throws Exception {
        Session admin = session(Role.ADMIN);
        Session inactive = session(Role.ADMIN);
        inactive.user.setActive(false);
        users.saveAndFlush(inactive.user);
        for (Role role : List.of(Role.TEACHER, Role.STUDENT)) {
            JsonNode problem = call(put("/api/admin/users/" + admin.user.getId() + "/role"), admin.token,
                    new AdminService.RoleEdit(role), 409);
            assertEquals("conflict", problem.path("code").asText());
        }
        assertEquals(Role.ADMIN, admin.user.getRole());
        assertEquals(0, audits.count());
        call(get("/api/admin/users"), admin.token, null, 200);
        Session second = session(Role.ADMIN);
        call(put("/api/admin/users/" + admin.user.getId() + "/role"), admin.token, new AdminService.RoleEdit(Role.TEACHER), 200);
        call(get("/api/admin/users"), admin.token, null, 401);
        call(get("/api/admin/users"), second.token, null, 200);
    }

    @Test
    void invalidOrMissingRoleAndUnknownTargetCannotChangeAccounts() throws Exception {
        Session admin = session(Role.ADMIN);
        Session student = session(Role.STUDENT);
        String path = "/api/admin/users/" + student.user.getId() + "/role";
        for (Map<String, Object> invalid : List.of(Map.<String, Object>of(), Map.<String, Object>of("role", "OWNER"))) {
            JsonNode problem = call(put(path), admin.token, invalid, 400);
            assertEquals("validation", problem.path("code").asText());
        }
        call(put(path), admin.token, mapper.createObjectNode().putNull("role"), 400);
        call(put("/api/admin/users/9223372036854775807/role"), admin.token, new AdminService.RoleEdit(Role.ADMIN), 404);
        assertEquals(Role.STUDENT, student.user.getRole());
        assertEquals(0, audits.count());
        call(get("/api/auth/me"), student.token, null, 200);
    }

    @Test
    void sameRoleIsIdempotentWithoutRevokingSettledSessions() throws Exception {
        Session admin = session(Role.ADMIN);
        Session student = session(Role.STUDENT);
        call(put("/api/admin/users/" + student.user.getId() + "/role"), admin.token, new AdminService.RoleEdit(Role.STUDENT), 200);
        assertEquals(0, audits.count());
        call(get("/api/auth/me"), student.token, null, 200);
    }

    @Test
    void administratorAssignedRoleCompletesOnboardingForPasswordAndGoogleSessions() throws Exception {
        Session admin = session(Role.ADMIN);
        for (boolean google : List.of(false, true)) {
            Session pending = session(Role.STUDENT);
            pending.user.setRoleSelectionRequired(true);
            users.saveAndFlush(pending.user);
            String token = google ? auth.externalLogin(pending.user.getId()).token() : pending.token;
            Role role = google ? Role.TEACHER : Role.STUDENT;
            call(put("/api/admin/users/" + pending.user.getId() + "/role"), admin.token, new AdminService.RoleEdit(role), 200);
            call(get("/api/auth/me"), token, null, 401);
            JsonNode login = call(post("/api/auth/login"), null,
                    new AuthService.LoginRequest(pending.user.getEmail(), "password123"), 200);
            assertFalse(login.path("user").path("roleSelectionRequired").asBoolean());
            call(post("/api/auth/role"), login.path("token").asText(), new AuthService.SelectRoleRequest(Role.STUDENT), 409);
            assertEquals(role, pending.user.getRole());
        }
    }

    @Test
    void generalAdminEditAlsoResolvesPendingRoleSelectionAndDoesNotReactivateAccounts() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.STUDENT);
        target.user.setRoleSelectionRequired(true);
        users.saveAndFlush(target.user);
        call(put("/api/admin/users/" + target.user.getId()), admin.token, edit(target.user), 200);
        assertFalse(target.user.isRoleSelectionRequired());
        call(get("/api/auth/me"), target.token, null, 401);
        target.user.setActive(false);
        users.saveAndFlush(target.user);
        JsonNode changed = call(put("/api/admin/users/" + target.user.getId() + "/role"), admin.token, new AdminService.RoleEdit(Role.TEACHER), 200);
        assertFalse(changed.path("active").asBoolean());
        call(post("/api/auth/login"), null, new AuthService.LoginRequest(target.user.getEmail(), "password123"), 401);
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

    @Test
    void deleteRequiresValidAdministratorPasswordAndDoesNotMutateOnFailure() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.STUDENT);
        target.user.setPasswordHash(encoder.encode("target-password123"));
        users.saveAndFlush(target.user);
        String path = "/api/admin/users/" + target.user.getId();
        for (Object invalid : List.of(Map.of(), Map.of("password", ""), Map.of("password", "   "),
                mapper.createObjectNode().putNull("password"))) {
            call(delete(path), admin.token, invalid, 400);
        }
        call(delete(path), admin.token, null, 400);
        call(delete(path), admin.token, Map.of("password", "incorrect-password"), 403);
        call(delete(path), admin.token, Map.of("password", "target-password123"), 403);
        assertEquals(1, count("SELECT COUNT(*) FROM users WHERE id=?", target.user.getId()));
        assertEquals(0, audits.count());
        call(get("/api/auth/me"), target.token, null, 200);
        call(get("/api/admin/users"), admin.token, null, 200);
        call(delete("/api/admin/users/9223372036854775807"), admin.token, Map.of("password", "password123"), 404);
    }

    @Test
    void administratorCannotDeleteOwnAccountEvenWhenAnotherAdministratorExists() throws Exception {
        Session admin = session(Role.ADMIN);
        call(delete("/api/admin/users/" + admin.user.getId()), admin.token, Map.of("password", "password123"), 400);
        Session second = session(Role.ADMIN);
        call(delete("/api/admin/users/" + admin.user.getId()), admin.token, Map.of("password", "password123"), 400);
        assertEquals(2, count("SELECT COUNT(*) FROM users WHERE role='ADMIN' AND active=TRUE"));
        assertEquals(0, audits.count());
        call(get("/api/admin/users"), admin.token, null, 200);
        call(get("/api/admin/users"), second.token, null, 200);
    }

    @Test
    void administratorCanDeleteAnotherAdminAndAuditHistorySurvivesDetachedReferences() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.ADMIN);
        call(put("/api/admin/permissions"), target.token, permission("QuizController.list", Role.TEACHER, true, false), 200);
        call(put("/api/admin/users/" + target.user.getId()), admin.token, edit(target.user), 200);
        long targetId = target.user.getId();
        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 204);
        entities.clear();
        assertTrue(users.findById(targetId).isEmpty());
        call(get("/api/admin/users"), target.token, null, 401);
        JsonNode log = call(get("/api/admin/audit"), admin.token, null, 200);
        assertEquals(3, log.size());
        JsonNode deletion = null;
        for (JsonNode entry : log) {
            if (entry.path("action").asText().equals("USER_DELETED")) deletion = entry;
            if (entry.path("action").asText().equals("PERMISSION_UPDATED")) assertEquals("Изтрит потребител", entry.path("actorEmail").asText());
            if (entry.path("action").asText().equals("USER_UPDATED")) assertTrue(entry.path("targetEmail").isNull());
        }
        assertNotNull(deletion);
        assertEquals(admin.user.getEmail(), deletion.path("actorEmail").asText());
        assertTrue(deletion.path("targetEmail").isNull());
        assertTrue(deletion.path("details").asText().contains(Long.toString(targetId)));
        assertFalse(log.toString().contains("password123"));
        assertFalse(log.toString().contains(target.user.getPasswordHash()));
    }

    @Test
    void deletePhysicallyRemovesAccountCredentialsAndLegacyQuizGraphWithoutTouchingUnrelatedData() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.TEACHER);
        Session survivor = session(Role.TEACHER);
        long targetId = target.user.getId();
        String deletedEmail = target.user.getEmail();
        String secondToken = call(post("/api/auth/login"), null,
                new AuthService.LoginRequest(deletedEmail, "password123"), 200).path("token").asText();
        JsonNode owned = call(post("/api/tests"), target.token, quiz(), 200);
        JsonNode retained = call(post("/api/tests"), survivor.token, quiz(), 200);
        long ownedId = owned.path("id").asLong();
        long retainedId = retained.path("id").asLong();
        String ownedCode = call(post("/api/tests/" + ownedId + "/publish"), target.token, null, 200).path("publicCode").asText();
        String retainedCode = call(post("/api/tests/" + retainedId + "/publish"), survivor.token, null, 200).path("publicCode").asText();
        long otherStudentOnDeletedQuiz = submitQuiz(ownedCode, survivor).path("attemptId").asLong();
        long deletedStudentOnRetainedQuiz = submitQuiz(retainedCode, target).path("attemptId").asLong();
        long retainedAttempt = submitQuiz(retainedCode, survivor).path("attemptId").asLong();
        jdbc.update("INSERT INTO external_identities(user_id,provider,subject,linked_at) VALUES(?,'google',?,CURRENT_TIMESTAMP)",
                targetId, "fixture-google-" + targetId);
        jdbc.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,expires_at) VALUES(?,?,'password_recovery',DATEADD('DAY',1,CURRENT_TIMESTAMP))",
                "fixture-recovery-" + targetId, targetId);
        jdbc.update("INSERT INTO notification_addresses(user_id,email,verified_at) VALUES(?,?,CURRENT_TIMESTAMP)", targetId, deletedEmail);
        jdbc.update("INSERT INTO profile_exam_locks(user_id) VALUES(?)", targetId);
        jdbc.update("INSERT INTO ai_usage(user_id,operation,model,input_tokens,output_tokens,created_at) VALUES(?,'generate','fixture',1,1,CURRENT_TIMESTAMP)", targetId);
        assertEquals(2, count("SELECT COUNT(*) FROM auth_token WHERE user_id=?", targetId));

        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 204);
        entities.clear();
        assertTrue(users.findById(targetId).isEmpty());
        assertTrue(tests.findById(ownedId).isEmpty());
        assertTrue(attempts.findById(otherStudentOnDeletedQuiz).isEmpty());
        assertTrue(attempts.findById(deletedStudentOnRetainedQuiz).isEmpty());
        for (String table : List.of("auth_token", "external_identities", "identity_challenges", "notification_addresses", "profile_exam_locks", "ai_usage")) {
            assertEquals(0, count("SELECT COUNT(*) FROM " + table + " WHERE user_id=?", targetId), table);
        }
        assertEquals(0, count("SELECT COUNT(*) FROM question WHERE test_id=?", ownedId));
        assertEquals(2, count("SELECT COUNT(*) FROM answer"));
        assertEquals(1, count("SELECT COUNT(*) FROM attempt_answer"));
        assertTrue(users.findById(survivor.user.getId()).isPresent());
        assertTrue(tests.findById(retainedId).isPresent());
        assertTrue(attempts.findById(retainedAttempt).isPresent());
        call(get("/api/auth/me"), target.token, null, 401);
        call(get("/api/auth/me"), secondToken, null, 401);
        call(get("/api/tests/" + retainedId), survivor.token, null, 200);
        call(post("/api/auth/login"), null, new AuthService.LoginRequest(deletedEmail, "password123"), 401);
        JsonNode recreated = call(post("/api/auth/register"), null,
                new AuthService.RegisterRequest("New account", deletedEmail, "new-password123"), 200);
        assertNotEquals(targetId, recreated.path("user").path("id").asLong());
        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 404);
    }

    @Test
    void deletePurgesPersonalWorkspaceGraphAndRetainsUnrelatedWorkspaceAndAuditHistory() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.TEACHER);
        Session survivor = session(Role.TEACHER);
        long targetId = target.user.getId();
        long organization = personal.workspace(target.user);
        long retainedOrganization = personal.workspace(survivor.user);
        personal.member(retainedOrganization, targetId, "TEACHER");
        long assessment = workspaceAssessment(organization, targetId);
        long version = workspaceVersion(organization, assessment);
        long assignment = workspaceAssignment(organization, version, targetId);
        long attempt = workspaceAttempt(organization, assignment, targetId);
        long question = insert("INSERT INTO attempt_questions(organization_id,attempt_id,position_index,definition_json,maximum_points,time_seconds) VALUES(?,?,0,'{}',1,30)", organization, attempt);
        insert("INSERT INTO exam_events(organization_id,attempt_id,question_id,event_key,event_type,telemetry_json,received_at) VALUES(?,?,?,'fixture','answer','{}',CURRENT_TIMESTAMP)", organization, attempt, question);
        long revision = workspaceResult(organization, attempt, targetId);
        insert("INSERT INTO notification_outbox(organization_id,revision_id,user_id,notification_type,recipient_email,payload_json,status,available_at,created_at) VALUES(?,?,?,'final_result',?,'{}','sent',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", organization, revision, targetId, target.user.getEmail());
        insert("INSERT INTO workspace_ai_jobs(organization_id,user_id,request_key,request_json,status,created_at,updated_at) VALUES(?,?,'fixture','{}','completed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", organization, targetId);
        insert("INSERT INTO workspace_ai_grading_jobs(organization_id,attempt_id,user_id,request_key,snapshot_hash,status,created_at,updated_at) VALUES(?,?,?,'fixture','fixture','completed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", organization, attempt, targetId);
        insert("INSERT INTO question_bank_items(organization_id,owner_id,subject,definition_json,created_at) VALUES(?,?,'Math','{}',CURRENT_TIMESTAMP)", organization, targetId);
        long image = insert("INSERT INTO private_images(organization_id,owner_id,purpose,mime_type,byte_size,width,height,content,created_at) VALUES(?,?,'logo','image/png',1,1,1,?,CURRENT_TIMESTAMP)", organization, targetId, new byte[]{0});
        jdbc.update("UPDATE organizations SET logo_id=? WHERE id=?", image, organization);
        long group = insert("INSERT INTO learning_groups(organization_id,name,description,subject,created_at) VALUES(?,'Fixture','','Math',CURRENT_TIMESTAMP)", organization);
        jdbc.update("INSERT INTO group_teachers(organization_id,group_id,user_id) VALUES(?,?,?)", organization, group, targetId);
        jdbc.update("INSERT INTO group_members(organization_id,group_id,user_id) VALUES(?,?,?)", organization, group, targetId);
        long conversation = insert("INSERT INTO workspace_conversations(organization_id,group_id,title) VALUES(?,?,'Fixture')", organization, group);
        jdbc.update("INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(?,?,?)", organization, conversation, targetId);
        long message = insert("INSERT INTO workspace_messages(organization_id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,'Fixture',CURRENT_TIMESTAMP)", organization, conversation, targetId);
        insert("INSERT INTO message_reports(organization_id,message_id,reporter_id,reason,created_at) VALUES(?,?,?,'Fixture',CURRENT_TIMESTAMP)", organization, message, targetId);
        jdbc.update("INSERT INTO realtime_tickets(token_hash,organization_id,conversation_id,user_id,auth_session_hash,expires_at) VALUES('fixture-ticket',?,?,?,'fixture',DATEADD('DAY',1,CURRENT_TIMESTAMP))", organization, conversation, targetId);
        jdbc.update("INSERT INTO assignment_teachers(organization_id,assignment_id,teacher_id) VALUES(?,?,?)", organization, assignment, targetId);
        jdbc.update("INSERT INTO assignment_code_deliveries(organization_id,assignment_id,generation,student_id,channel,created_at) VALUES(?,?,1,?,'email',CURRENT_TIMESTAMP)", organization, assignment, targetId);
        jdbc.update("INSERT INTO organization_quota_locks(organization_id) VALUES(?)", organization);
        jdbc.update("INSERT INTO organization_retention_locks(organization_id) VALUES(?)", organization);
        long retainedAudit = insert("INSERT INTO workspace_audit(organization_id,actor_id,action,detail_json,created_at) VALUES(?,?,'fixture','{}',CURRENT_TIMESTAMP)", retainedOrganization, targetId);
        long retainedRetention = insert("INSERT INTO retention_runs(organization_id,request_key,actor_id,cutoff,reason,redacted_attempts,created_at) VALUES(?,'fixture',?,CURRENT_TIMESTAMP,'Fixture',0,CURRENT_TIMESTAMP)", retainedOrganization, targetId);

        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 204);
        entities.clear();
        for (String table : List.of("personal_workspaces", "memberships", "organization_subscriptions", "learning_groups",
                "group_teachers", "group_members", "workspace_assessments", "assessment_versions", "exam_assignments",
                "assignment_teachers", "assignment_recipients", "assignment_code_deliveries", "exam_attempts", "attempt_questions",
                "exam_events", "result_revisions", "notification_outbox", "workspace_conversations", "conversation_members",
                "workspace_messages", "message_reports", "realtime_tickets", "workspace_ai_jobs", "workspace_ai_grading_jobs",
                "question_bank_items", "private_images", "organization_quota_locks", "organization_retention_locks")) {
            assertEquals(0, count("SELECT COUNT(*) FROM " + table + " WHERE organization_id=?", organization), table);
        }
        assertEquals(0, count("SELECT COUNT(*) FROM organizations WHERE id=?", organization));
        assertEquals(1, count("SELECT COUNT(*) FROM organizations WHERE id=?", retainedOrganization));
        assertEquals(1, count("SELECT COUNT(*) FROM organization_subscriptions WHERE organization_id=?", retainedOrganization));
        assertEquals(1, count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND user_id=?", retainedOrganization, survivor.user.getId()));
        assertEquals(0, count("SELECT COUNT(*) FROM memberships WHERE user_id=?", targetId));
        assertEquals(1, count("SELECT COUNT(*) FROM workspace_audit WHERE id=? AND actor_id IS NULL", retainedAudit));
        assertEquals(1, count("SELECT COUNT(*) FROM retention_runs WHERE id=? AND actor_id IS NULL", retainedRetention));
        call(get("/api/auth/me"), survivor.token, null, 200);
    }

    @Test
    void runningAiAndProcessingMailBlockDeletionWithoutPartialCleanup() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.TEACHER);
        long targetId = target.user.getId();
        long organization = personal.workspace(target.user);
        long job = insert("INSERT INTO workspace_ai_jobs(organization_id,user_id,request_key,request_json,status,created_at,updated_at) VALUES(?,?,'fixture','{}','running',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", organization, targetId);
        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 409);
        assertEquals(1, count("SELECT COUNT(*) FROM workspace_ai_jobs WHERE id=? AND status='running'", job));
        assertEquals(1, count("SELECT COUNT(*) FROM users WHERE id=?", targetId));
        assertEquals(0, audits.count());
        call(get("/api/auth/me"), target.token, null, 200);
        jdbc.update("UPDATE workspace_ai_jobs SET status='failed' WHERE id=?", job);
        long delivery = insert("INSERT INTO notification_outbox(user_id,notification_type,recipient_email,payload_json,status,available_at,created_at) VALUES(?,'password_recovery',?,'{}','processing',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", targetId, target.user.getEmail());
        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 409);
        assertEquals(1, count("SELECT COUNT(*) FROM notification_outbox WHERE id=? AND status='processing'", delivery));
        assertEquals(1, count("SELECT COUNT(*) FROM users WHERE id=?", targetId));
        assertEquals(1, count("SELECT COUNT(*) FROM personal_workspaces WHERE user_id=?", targetId));
        assertEquals(0, audits.count());
        call(get("/api/auth/me"), target.token, null, 200);
        jdbc.update("UPDATE notification_outbox SET status='sent' WHERE id=?", delivery);
        call(delete("/api/admin/users/" + targetId), admin.token, Map.of("password", "password123"), 204);
    }

    @Test
    void deletingStudentRemovesOnlyTheirWorkspaceAttemptsAndRefundsQueuedAiQuota() throws Exception {
        Session admin = session(Role.ADMIN);
        Session teacher = session(Role.TEACHER);
        Session target = session(Role.STUDENT);
        Session survivor = session(Role.STUDENT);
        long organization = personal.workspace(teacher.user);
        personal.member(organization, target.user.getId(), "STUDENT");
        personal.member(organization, survivor.user.getId(), "STUDENT");
        long assessment = workspaceAssessment(organization, teacher.user.getId());
        long version = workspaceVersion(organization, assessment);
        long assignment = workspaceAssignment(organization, version, teacher.user.getId());
        long deletedAttempt = workspaceAttempt(organization, assignment, target.user.getId());
        long retainedAttempt = workspaceAttempt(organization, assignment, survivor.user.getId());
        long retainedResult = workspaceResult(organization, retainedAttempt, target.user.getId());
        insert("INSERT INTO workspace_ai_grading_jobs(organization_id,attempt_id,user_id,request_key,snapshot_hash,status,quota_reserved,created_at,updated_at) VALUES(?,?,?,'fixture','fixture','queued',TRUE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", organization, deletedAttempt, teacher.user.getId());
        insert("INSERT INTO workspace_ai_jobs(organization_id,user_id,request_key,request_json,status,created_at,updated_at) VALUES(?,?,'fixture','{}','queued',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", organization, target.user.getId());
        jdbc.update("UPDATE organization_subscriptions SET ai_reserved=2 WHERE organization_id=?", organization);

        call(delete("/api/admin/users/" + target.user.getId()), admin.token, Map.of("password", "password123"), 204);
        entities.clear();
        assertEquals(0, count("SELECT COUNT(*) FROM exam_attempts WHERE id=?", deletedAttempt));
        assertEquals(0, count("SELECT COUNT(*) FROM assignment_recipients WHERE student_id=?", target.user.getId()));
        assertEquals(0, count("SELECT COUNT(*) FROM workspace_ai_grading_jobs WHERE attempt_id=?", deletedAttempt));
        assertEquals(0, count("SELECT COUNT(*) FROM workspace_ai_jobs WHERE user_id=?", target.user.getId()));
        assertEquals(0, count("SELECT ai_reserved FROM organization_subscriptions WHERE organization_id=?", organization));
        assertEquals(1, count("SELECT COUNT(*) FROM exam_attempts WHERE id=?", retainedAttempt));
        assertEquals(1, count("SELECT COUNT(*) FROM result_revisions WHERE id=? AND author_id IS NULL", retainedResult));
        assertEquals(1, count("SELECT COUNT(*) FROM workspace_assessments WHERE id=?", assessment));
        assertEquals(1, count("SELECT COUNT(*) FROM exam_assignments WHERE id=?", assignment));
        assertEquals(1, count("SELECT COUNT(*) FROM organizations WHERE id=?", organization));
        call(get("/api/auth/me"), teacher.token, null, 200);
        call(get("/api/auth/me"), survivor.token, null, 200);
    }

    @Test
    void deletionBlocksSharedAssessmentAssignmentsAndActiveBilling() throws Exception {
        Session admin = session(Role.ADMIN);
        Session target = session(Role.TEACHER);
        Session otherTeacher = session(Role.TEACHER);
        long organization = personal.workspace(otherTeacher.user);
        personal.member(organization, target.user.getId(), "TEACHER");
        long assessment = workspaceAssessment(organization, target.user.getId());
        long version = workspaceVersion(organization, assessment);
        long assignment = workspaceAssignment(organization, version, otherTeacher.user.getId());
        call(delete("/api/admin/users/" + target.user.getId()), admin.token, Map.of("password", "password123"), 409);
        assertEquals(1, count("SELECT COUNT(*) FROM workspace_assessments WHERE id=?", assessment));
        assertEquals(1, count("SELECT COUNT(*) FROM exam_assignments WHERE id=?", assignment));
        assertEquals(0, audits.count());
        call(get("/api/auth/me"), target.token, null, 200);

        long personalOrganization = personal.workspace(target.user);
        jdbc.update("INSERT INTO stripe_subscription_bindings(organization_id,subscription_id,customer_id) VALUES(?,'fixture-subscription','fixture-customer')", personalOrganization);
        // Remove the shared-assessment blocker, leaving the external billing obligation as the only blocker.
        jdbc.update("DELETE FROM exam_assignments WHERE id=?", assignment);
        call(delete("/api/admin/users/" + target.user.getId()), admin.token, Map.of("password", "password123"), 409);
        assertEquals(1, count("SELECT COUNT(*) FROM stripe_subscription_bindings WHERE organization_id=?", personalOrganization));
        assertEquals(1, count("SELECT COUNT(*) FROM users WHERE id=?", target.user.getId()));
        assertEquals(0, audits.count());
    }

    private long workspaceAssessment(long organization, long owner) {
        return insert("INSERT INTO workspace_assessments(organization_id,owner_id,title,definition_json,public_number,updated_at) VALUES(?,?,'Fixture','{}',?,CURRENT_TIMESTAMP)", organization, owner,new com.quicktest.workspace.WorkspaceCrypto().assessmentNumber());
    }

    private long workspaceVersion(long organization, long assessment) {
        return insert("INSERT INTO assessment_versions(organization_id,assessment_id,version_number,title,definition_json,published_at) VALUES(?,?,1,'Fixture','{}',CURRENT_TIMESTAMP)", organization, assessment);
    }

    private long workspaceAssignment(long organization, long version, long teacher) {
        return insert("INSERT INTO exam_assignments(organization_id,version_id,teacher_id,starts_at,ends_at,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP,DATEADD('DAY',1,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP)", organization, version, teacher);
    }

    private long workspaceAttempt(long organization, long assignment, long student) {
        jdbc.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,'[]',TRUE,1)", organization, assignment, student);
        return insert("INSERT INTO exam_attempts(organization_id,assignment_id,student_id,attempt_number,start_key,session_hash,auth_session_hash,browser_id,status,started_at) VALUES(?,?,?,1,'fixture','fixture','fixture','fixture','submitted',CURRENT_TIMESTAMP)", organization, assignment, student);
    }

    private long workspaceResult(long organization, long attempt, long author) {
        return insert("INSERT INTO result_revisions(organization_id,attempt_id,revision_number,publication_key,author_id,points,maximum_points,percentage,grade,outcome,reason,snapshot_json,published_at) VALUES(?,?,1,'fixture',?,1,1,100,'6','passed','','{}',CURRENT_TIMESTAMP)", organization, attempt, author);
    }

    private long insert(String sql, Object... parameters) {
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < parameters.length; i++) statement.setObject(i + 1, parameters[i]);
            return statement;
        }, keys);
        return keys.getKey().longValue();
    }

    private JsonNode submitQuiz(String code, Session participant) throws Exception {
        JsonNode publicTest = call(get("/api/public/tests/" + code), participant.token, null, 200);
        JsonNode question = publicTest.path("questions").get(0);
        return call(post("/api/public/tests/" + code + "/attempts"), participant.token,
                new QuizDtos.SubmitAttemptRequest(participant.user.getName(), participant.user.getEmail(),
                        List.of(new QuizDtos.SubmittedAnswer(question.path("id").asLong(),
                                List.of(question.path("answers").get(0).path("id").asLong()), null))), 200);
    }

    private long count(String sql, Object... parameters) {
        return jdbc.queryForObject(sql, Long.class, parameters);
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
        request.with(servletRequest -> { servletRequest.setRemoteAddr(remoteAddress); return servletRequest; });
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body));
        String response = mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
        return response.isBlank() ? mapper.nullNode() : mapper.readTree(response);
    }
    private record Session(AppUser user, String token) {}
}
