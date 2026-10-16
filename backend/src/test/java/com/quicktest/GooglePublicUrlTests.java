package com.quicktest;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={
        "spring.datasource.url=jdbc:h2:mem:google_public_urls;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "app.google.enabled=true",
        "app.backend-url=https://api.example.test/",
        "app.frontend-url=https://app.example.test/"
})
@AutoConfigureMockMvc
class GooglePublicUrlTests {
    @Autowired MockMvc mvc;
    @Autowired ClientRegistrationRepository registrations;

    @DynamicPropertySource
    static void copiedCredentials(DynamicPropertyRegistry properties) {
        properties.add("app.google.client-id",()->" \tfixture.apps.googleusercontent.com \n");
        properties.add("app.google.client-secret",()->" \tfixture-secret \n");
    }

    @Test void configExposesCanonicalPublicUrlsButNeverCredentials() throws Exception {
        String body=mvc.perform(get("/api/auth/google/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.redirect").value("https://api.example.test/api/auth/google/redirect"))
                .andExpect(jsonPath("$.callback").value("https://api.example.test/login/oauth2/code/google"))
                .andExpect(jsonPath("$.clientId").doesNotExist())
                .andExpect(jsonPath("$.clientSecret").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("fixture.apps.googleusercontent.com"));
        assertFalse(body.contains("fixture-secret"));
    }

    @Test void publicCallbackDoesNotDependOnInternalHttpOrUntrustedForwardedHeaders() throws Exception {
        var session=new MockHttpSession();
        String target=mvc.perform(get("/oauth2/authorization/google")
                        .session(session)
                        .with(request->{
                            request.setScheme("http");
                            request.setServerName("backend.railway.internal");
                            request.setServerPort(8080);
                            return request;
                        })
                        .header("Forwarded","for=192.0.2.1;proto=http;host=attacker.example.test")
                        .header("X-Forwarded-Proto","http")
                        .header("X-Forwarded-Host","attacker.example.test")
                        .header("X-Forwarded-Port","80"))
                .andExpect(status().isFound()).andReturn().getResponse().getRedirectedUrl();
        assertNotNull(target);
        var uri=UriComponentsBuilder.fromUriString(target).build();
        var params=uri.getQueryParams();
        assertEquals("accounts.google.com",uri.getHost());
        assertEquals("code",params.getFirst("response_type"));
        assertEquals("fixture.apps.googleusercontent.com",params.getFirst("client_id"));
        assertEquals("https://api.example.test/login/oauth2/code/google",params.getFirst("redirect_uri"));
        assertNotNull(params.getFirst("state"));
        assertFalse(params.getFirst("state").isBlank());
        assertNotNull(params.getFirst("nonce"));
        assertFalse(params.getFirst("nonce").isBlank());
        assertFalse(target.contains("attacker.example.test"));
        assertFalse(target.contains("fixture-secret"));
    }

    @Test void invalidStateReturnsToCanonicalFrontendAndInvalidatesSession() throws Exception {
        var session=new MockHttpSession();
        mvc.perform(get("/oauth2/authorization/google").session(session))
                .andExpect(status().isFound());
        String target=mvc.perform(get("/login/oauth2/code/google")
                        .param("code","not-a-real-code").param("state","tampered-state").session(session))
                .andExpect(status().isFound())
                .andExpect(header().string("Referrer-Policy","no-referrer"))
                .andExpect(redirectedUrlPattern("https://app.example.test/#google_error=*"))
                .andReturn().getResponse().getRedirectedUrl();
        assertNotNull(target);
        assertTrue(URLDecoder.decode(target,StandardCharsets.UTF_8).contains("Сесията за Google входа е изтекла."));
        assertTrue(session.isInvalid());
    }

    @Test void copiedCredentialWhitespaceIsRemovedBeforeOAuthRegistration() {
        var registration=registrations.findByRegistrationId("google");
        assertEquals("fixture.apps.googleusercontent.com",registration.getClientId());
        assertEquals("fixture-secret",registration.getClientSecret());
    }

    @Test void handoffExchangeAllowsCanonicalFrontendOrigin() throws Exception {
        mvc.perform(options("/api/auth/google/exchange")
                        .header("Origin","https://app.example.test")
                        .header("Access-Control-Request-Method","POST")
                        .header("Access-Control-Request-Headers","content-type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin","https://app.example.test"));
    }
}
