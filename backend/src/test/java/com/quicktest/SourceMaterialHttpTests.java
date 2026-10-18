package com.quicktest;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.AuthService;
import com.quicktest.auth.Role;
import com.quicktest.workspace.IdentityWorkflow;
import com.quicktest.workspace.SourceMaterialService;
import com.quicktest.workspace.WorkspaceJson;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"app.legacy-api.enabled=false", "app.workspace.workers=false", "app.workspace.demo-seed=false",
        "spring.datasource.url=jdbc:h2:mem:source_material_http_tests;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa", "spring.datasource.password="})
@AutoConfigureMockMvc
class SourceMaterialHttpTests {
    private static final String ENDPOINT = "/api/v1/ai/test-generations/source-material";
    @Autowired MockMvc mvc;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder passwords;
    @Autowired AuthService auth;
    @Autowired IdentityWorkflow identities;
    @Autowired WorkspaceJson json;

    @Test void teacherCanUploadLectureUsingPersonalWorkspace() throws Exception {
        String lecture = "Класът описва състояние и поведение.";
        mvc.perform(post(ENDPOINT).header("Authorization", authorization(Role.TEACHER))
                        .contentType(MediaType.APPLICATION_JSON).content(upload(lecture)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.fileName").value("lecture.txt"))
                .andExpect(jsonPath("$.sourceText").value(lecture)).andExpect(jsonPath("$.characterCount").value(lecture.length()));
    }

    @Test void anonymousAndStudentUploadsAreRejectedBeforeExtraction() throws Exception {
        // Invalid content must still produce an access error, not reveal parser behavior to students.
        String body = json.write(new SourceMaterialService.Upload("lecture.pdf", "%%%"));
        mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        mvc.perform(post(ENDPOINT).header("Authorization", authorization(Role.STUDENT))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("forbidden"));
    }

    @Test void teacherGetsSafeValidationErrorsForUnreadableFiles() throws Exception {
        mvc.perform(post(ENDPOINT).header("Authorization", authorization(Role.TEACHER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.write(new SourceMaterialService.Upload("lecture.pdf", Base64.getEncoder().encodeToString("not a pdf".getBytes(StandardCharsets.UTF_8))))))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("validation"))
                .andExpect(jsonPath("$.stackTrace").doesNotExist()).andExpect(jsonPath("$.exception").doesNotExist());
    }

    private String upload(String lecture) {
        return json.write(new SourceMaterialService.Upload("lecture.txt", Base64.getEncoder().encodeToString(lecture.getBytes(StandardCharsets.UTF_8))));
    }

    private String authorization(Role role) {
        var user = new AppUser();
        user.setName("Lecture upload fixture");
        user.setEmail(UUID.randomUUID() + "@example.test");
        user.setRole(role);
        user.setEmailVerifiedAt(Instant.now());
        user.setPasswordHash(passwords.encode("password123"));
        users.saveAndFlush(user);
        identities.initialize(user);
        return "Bearer " + auth.login(new AuthService.LoginRequest(user.getEmail(), "password123")).token();
    }
}
