package com.quicktest;

import com.quicktest.auth.AuthService;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.Role;
import com.quicktest.workspace.GoogleIdentityService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:role_selection;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
@AutoConfigureMockMvc
@Transactional
class RoleSelectionTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AuthService auth;
    @Autowired AppUserRepository users;
    @Autowired GoogleIdentityService google;

    @Test void newPasswordAccountsChooseEitherRoleBeforeWorkspaceAndNeverAgain() throws Exception {
        for (Role role : List.of(Role.TEACHER, Role.STUDENT)) {
            String email = UUID.randomUUID() + "@example.test";
            JsonNode registration = mapper.readTree(mvc.perform(post("/api/auth/register")
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                            "name", "New account", "email", email, "password", "password123"))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.user.roleSelectionRequired").value(true))
                    .andReturn().getResponse().getContentAsString());
            String bearer = "Bearer " + registration.path("token").asText();
            mvc.perform(get("/api/auth/me").header("Authorization", bearer)).andExpect(status().isOk())
                    .andExpect(jsonPath("$.roleSelectionRequired").value(true));
            mvc.perform(get("/api/v1/assignments").header("Authorization", bearer)).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.detail").value("Първо изберете роля за профила си."));
            select(bearer, role.name(), 200).andExpect(jsonPath("$.role").value(role.name()))
                    .andExpect(jsonPath("$.roleSelectionRequired").value(false));
            mvc.perform(get("/api/v1/assignments").header("Authorization", bearer)).andExpect(status().isOk());
            select(bearer, role == Role.TEACHER ? "STUDENT" : "TEACHER", 409);
            var returning = auth.login(new AuthService.LoginRequest(email, "password123"));
            assertEquals(role.name(), returning.user().role());
            assertFalse(returning.user().roleSelectionRequired());
        }
    }

    @Test void firstGoogleLoginResumesPendingSelectionAndPreservesChosenRole() throws Exception {
        for (Role role : List.of(Role.TEACHER, Role.STUDENT)) {
            Instant now = Instant.now();
            var principal = new DefaultOidcUser(List.of(), new OidcIdToken("framework-fixture", now, now.plusSeconds(120),
                    Map.of("iss", "https://accounts.google.com", "sub", UUID.randomUUID().toString(),
                            "email", UUID.randomUUID() + "@example.test", "email_verified", true)));
            var initial = google.exchange(google.complete(principal, null, null, null));
            assertTrue(initial.user().roleSelectionRequired());
            var resumed = google.exchange(google.complete(principal, null, null, Role.TEACHER));
            assertEquals(initial.user().id(), resumed.user().id());
            assertTrue(resumed.user().roleSelectionRequired());
            select("Bearer " + resumed.token(), role.name(), 200);
            var returning = google.exchange(google.complete(principal, null, null,
                    role == Role.TEACHER ? Role.STUDENT : Role.TEACHER));
            assertEquals(role.name(), returning.user().role());
            assertFalse(returning.user().roleSelectionRequired());
        }
    }

    @Test void existingProfilesAndExplicitRegistrationRolesCannotBeChanged() throws Exception {
        for (Role role : List.of(Role.TEACHER, Role.STUDENT)) {
            var existing = auth.register(new AuthService.RegisterRequest("Existing", UUID.randomUUID() + "@example.test", "password123", role));
            assertFalse(existing.user().roleSelectionRequired());
            select("Bearer " + existing.token(), role == Role.TEACHER ? "STUDENT" : "TEACHER", 409);
            assertEquals(role, users.findById(existing.user().id()).orElseThrow().getRole());
        }
    }

    @Test void pendingAccountsRejectInvalidRolesAndCanStillLogOut() throws Exception {
        var pending = auth.register(new AuthService.RegisterRequest("Pending", UUID.randomUUID() + "@example.test", "password123", null));
        String bearer = "Bearer " + pending.token();
        for (String role : List.of("ADMIN", "OWNER", "invalid")) select(bearer, role, 400);
        mvc.perform(post("/api/auth/role").header("Authorization", bearer).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        assertTrue(users.findById(pending.user().id()).orElseThrow().isRoleSelectionRequired());
        mvc.perform(post("/api/auth/role").contentType(MediaType.APPLICATION_JSON).content("{\"role\":\"TEACHER\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout").header("Authorization", bearer)).andExpect(status().isNoContent());
        select(bearer, "TEACHER", 401);
    }

    private org.springframework.test.web.servlet.ResultActions select(String bearer, String role, int status) throws Exception {
        return mvc.perform(post("/api/auth/role").header("Authorization", bearer).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("role", role)))).andExpect(status().is(status));
    }
}
