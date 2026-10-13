package com.quicktest;

import com.quicktest.auth.AuthController;
import com.quicktest.auth.AuthService;
import com.quicktest.auth.AuthWorkflowService;
import com.quicktest.auth.BearerTokenFilter;
import com.quicktest.exception.ApiException;
import com.quicktest.exception.GlobalExceptionHandler;
import com.quicktest.workspace.WorkspaceError;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiExceptionTests {
    private AuthWorkflowService service;
    private MockMvc mvc;
    private static final String LOGIN = "{\"email\":\"teacher@example.test\",\"password\":\"password123\"}";

    @BeforeEach void setup() {
        service = mock(AuthWorkflowService.class);
        mvc = MockMvcBuilders.standaloneSetup(new AuthController(service, new MockHttpServletRequest()))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test void applicationErrorsKeepStatusDetailAndCode() throws Exception {
        doThrow(WorkspaceError.notFound()).when(service).login(any(), anyString());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(LOGIN))
                .andExpect(status().isNotFound()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("not_found")).andExpect(jsonPath("$.detail").value("Ресурсът не е намерен."));
        doThrow(new ApiException(HttpStatus.CONFLICT, "test_conflict", "Conflict fixture")).when(service).login(any(), anyString());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(LOGIN))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("test_conflict")).andExpect(jsonPath("$.detail").value("Conflict fixture"));
    }

    @Test void legacyStatusExceptionsUseTheSameContract() throws Exception {
        when(service.login(any(), anyString())).thenThrow(new ResponseStatusException(HttpStatus.GONE, "Expired fixture"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(LOGIN))
                .andExpect(status().isGone()).andExpect(jsonPath("$.code").value("expired")).andExpect(jsonPath("$.detail").value("Expired fixture"));
    }

    @Test void validationAndMalformedJsonNeverInvokeTheService() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"invalid\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("validation")).andExpect(jsonPath("$.errors").isNotEmpty());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("validation"));
        verifyNoInteractions(service);
    }

    @Test void frameworkErrorsPreserveHttpHeaders() throws Exception {
        mvc.perform(get("/api/auth/login")).andExpect(status().isMethodNotAllowed())
                .andExpect(header().string("Allow", "POST")).andExpect(jsonPath("$.code").value("method_not_allowed"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.TEXT_PLAIN).content(LOGIN))
                .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.code").value("unsupported_media_type"));
    }

    @Test void databaseAndUnexpectedErrorsDoNotExposeInternalDetails() throws Exception {
        for (RuntimeException error : new RuntimeException[]{new DuplicateKeyException("SELECT secret FROM private_table"),
                new DataAccessResourceFailureException("jdbc:mysql://secret-host/private"), new IllegalStateException("private-fixture-value")}) {
            doThrow(error).when(service).login(any(), anyString());
            var result = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(LOGIN))
                    .andExpect(status().is(error instanceof DuplicateKeyException ? 409 : 500))
                    .andExpect(jsonPath("$.code").value(error instanceof DuplicateKeyException ? "conflict" : "internal_error"))
                    .andReturn().getResponse().getContentAsString();
            assertFalse(result.contains(error.getMessage()));
            assertFalse(result.contains(error.getClass().getName()));
        }
    }

    @Test void authenticationFilterUsesTheSameFlatProblemFormat() throws Exception {
        var auth = mock(AuthService.class);
        when(auth.requireUser(anyString())).thenThrow(new ApiException(HttpStatus.UNAUTHORIZED, "Invalid fixture"));
        var request = new MockHttpServletRequest("GET", "/api/v1/tests");
        request.addHeader("Authorization", "Bearer fixture");
        var response = new MockHttpServletResponse();
        new BearerTokenFilter(auth, new ObjectMapper()).doFilter(request, response, (ignoredRequest, ignoredResponse) -> fail("Invalid session reached the controller"));
        assertEquals(401, response.getStatus());
        var body = new ObjectMapper().readTree(response.getContentAsString());
        assertEquals("unauthorized", body.path("code").asText());
        assertEquals(401, body.path("status").asInt());
        assertFalse(body.has("properties"));
    }
}
