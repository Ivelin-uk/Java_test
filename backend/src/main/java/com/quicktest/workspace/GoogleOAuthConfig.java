package com.quicktest.workspace;

import com.quicktest.auth.Role;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthorizationException;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.NullSecurityContextRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@Configuration
@ConditionalOnProperty(name="app.google.enabled",havingValue="true")
public class GoogleOAuthConfig {
    private static final Logger log=LoggerFactory.getLogger(GoogleOAuthConfig.class);
    @Bean ClientRegistrationRepository googleRegistration(@Value("${app.google.client-id}") String id,@Value("${app.google.client-secret}") String secret,
                                                        @Value("${app.backend-url:http://localhost:8080}") String backend) {
        if(id.isBlank() || secret.isBlank()) throw new IllegalStateException("Google credentials are required when GOOGLE_ENABLED=true");
        // The callback must match the public URL advertised by /api/auth/google/config,
        // even when a hosting proxy forwards HTTPS traffic to an internal HTTP port.
        return new InMemoryClientRegistrationRepository(CommonOAuth2Provider.GOOGLE.getBuilder("google").clientId(id.strip()).clientSecret(secret.strip()).scope("openid","profile","email").redirectUri(baseUrl(backend)+"/login/oauth2/code/google").build());
    }
    @Bean @Order(0)
    SecurityFilterChain googleChain(HttpSecurity http,GoogleIdentityService identity,@Value("${app.frontend-url}") String frontend,@Value("${app.backend-url:http://localhost:8080}") String backend) throws Exception {
        String frontendUrl=baseUrl(frontend),backendUrl=baseUrl(backend);
        return http.securityMatcher("/oauth2/**","/login/oauth2/**","/api/auth/google/redirect")
                .authorizeHttpRequests(auth->auth.anyRequest().permitAll())
                .securityContext(context->context.securityContextRepository(new NullSecurityContextRepository()))
                .oauth2Login(oauth->oauth.successHandler((request,response,authentication)-> {
                    var session=request.getSession(false);
                    Long linked=session==null?null:(Long)session.getAttribute("examai.google.linkUser");
                    String source=session==null?null:(String)session.getAttribute("examai.google.sourceSessionHash");
                    Role role=session==null?null:(Role)session.getAttribute("examai.google.registrationRole");
                    String target;
                    try {target=frontendUrl+"/#google_handoff="+identity.complete((OidcUser)authentication.getPrincipal(),linked,source,role);}
                    catch(WorkspaceError error) {target=frontendUrl+"/#google_error="+URLEncoder.encode(error.getReason(),StandardCharsets.UTF_8);}
                    if(session!=null) session.invalidate();response.setHeader("Referrer-Policy","no-referrer");response.sendRedirect(target);
                }).failureHandler((request,response,error)-> {
                    String code=oauthErrorCode(error);log.warn("Google OAuth login failed: code={}, exception={}",code,error.getClass().getSimpleName());
                    var session=request.getSession(false);if(session!=null) session.invalidate();response.setHeader("Referrer-Policy","no-referrer");response.sendRedirect(frontendUrl+"/#google_error="+URLEncoder.encode(oauthFailureMessage(code,backendUrl),StandardCharsets.UTF_8));
                })).build();
    }
    private static String baseUrl(String value) {
        return value.strip().replaceAll("/+$","");
    }
    private static String oauthErrorCode(Throwable error) {
        for(Throwable current=error;current!=null;current=current.getCause()) {
            if(current instanceof OAuth2AuthenticationException oauth && oauth.getError()!=null) return clean(oauth.getError().getErrorCode());
            if(current instanceof OAuth2AuthorizationException oauth && oauth.getError()!=null) return clean(oauth.getError().getErrorCode());
        }
        return "oauth_failed";
    }
    private static String clean(String code) {
        return code==null || code.isBlank()?"oauth_failed":code.replaceAll("[^A-Za-z0-9_.-]","_");
    }
    private static String oauthFailureMessage(String code,String backend) {
        return switch(code) {
            case "access_denied" -> "Google входът беше отказан.";
            case "authorization_request_not_found","invalid_state_parameter" -> "Сесията за Google входа е изтекла. Опитайте отново.";
            case "invalid_client","invalid_client_credentials","invalid_token_response" -> "Google OAuth настройките не са приети. Проверете Client ID, Client Secret и Authorized redirect URI: "+backend+"/login/oauth2/code/google";
            case "invalid_request","invalid_grant" -> "Google върна невалидна OAuth заявка. Проверете Authorized redirect URI: "+backend+"/login/oauth2/code/google";
            default -> "Неуспешен вход с Google. Опитайте отново.";
        };
    }
}
