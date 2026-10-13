package com.quicktest;

import com.quicktest.auth.Role;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.util.UriComponentsBuilder;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={
        "spring.datasource.url=jdbc:h2:mem:google_oauth;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "app.google.enabled=true", "app.google.client-id=fixture.apps.googleusercontent.com", "app.google.client-secret=fixture-secret"
})
@AutoConfigureMockMvc
class GoogleOAuthTests {
    @Autowired MockMvc mvc;

    @Test void configExposesAvailabilityButNeverCredentials() throws Exception {
        mvc.perform(get("/api/auth/google/config")).andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.redirect").value("http://localhost:8080/api/auth/google/redirect"))
                .andExpect(jsonPath("$.callback").value("http://localhost:8080/login/oauth2/code/google"))
                .andExpect(jsonPath("$.clientSecret").doesNotExist());
    }
    @Test void selectedRoleSurvivesStandardAuthorizationRedirectWithStateAndNonce() throws Exception {
        var session=new MockHttpSession();
        session.setAttribute("examai.google.linkUser",123L);session.setAttribute("examai.google.sourceSessionHash","old");
        mvc.perform(get("/api/auth/google/redirect").param("role","TEACHER").session(session))
                .andExpect(status().isFound()).andExpect(redirectedUrl("/oauth2/authorization/google"))
                .andExpect(header().string("Referrer-Policy","no-referrer"));
        assertEquals(Role.TEACHER,session.getAttribute("examai.google.registrationRole"));
        assertNull(session.getAttribute("examai.google.linkUser"));assertNull(session.getAttribute("examai.google.sourceSessionHash"));
        String target=mvc.perform(get("/oauth2/authorization/google").session(session))
                .andExpect(status().isFound()).andReturn().getResponse().getRedirectedUrl();
        var uri=UriComponentsBuilder.fromUriString(target).build();var params=uri.getQueryParams();
        assertEquals("accounts.google.com",uri.getHost());assertEquals("code",params.getFirst("response_type"));
        assertEquals("fixture.apps.googleusercontent.com",params.getFirst("client_id"));
        assertEquals("http://localhost/login/oauth2/code/google",params.getFirst("redirect_uri"));
        assertNotNull(params.getFirst("state"));assertNotNull(params.getFirst("nonce"));
        assertEquals(Role.TEACHER,session.getAttribute("examai.google.registrationRole"));
    }
    @Test void signInWithoutRoleDefersSelectionAndPrivilegedOrUnknownRolesAreRejected() throws Exception {
        var session=new MockHttpSession();
        session.setAttribute("examai.google.registrationRole",Role.TEACHER);
        mvc.perform(get("/api/auth/google/redirect").session(session)).andExpect(status().isFound());
        assertNull(session.getAttribute("examai.google.registrationRole"));
        for(String role:new String[]{"ADMIN","OWNER","invalid"})
            mvc.perform(get("/api/auth/google/redirect").param("role",role)).andExpect(status().isBadRequest());
    }
    @Test void callbackWithoutAuthorizationStateFailsClosedAndInvalidatesSession() throws Exception {
        var session=new MockHttpSession();session.setAttribute("examai.google.registrationRole",Role.TEACHER);
        String target=mvc.perform(get("/login/oauth2/code/google").param("code","not-a-real-code").param("state","not-issued").session(session))
                .andExpect(status().isFound()).andExpect(header().string("Referrer-Policy","no-referrer"))
                .andExpect(redirectedUrlPattern("http://localhost:5173/#google_error=*"))
                .andReturn().getResponse().getRedirectedUrl();
        assertNotNull(target);
        assertTrue(URLDecoder.decode(target,StandardCharsets.UTF_8).contains("Сесията за Google входа е изтекла."));
        assertTrue(session.isInvalid());
    }
}
