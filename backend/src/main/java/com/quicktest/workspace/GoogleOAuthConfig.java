package com.quicktest.workspace;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.NullSecurityContextRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@Configuration
@ConditionalOnProperty(name="app.google.enabled",havingValue="true")
public class GoogleOAuthConfig {
    @Bean ClientRegistrationRepository googleRegistration(@Value("${app.google.client-id}") String id,@Value("${app.google.client-secret}") String secret) {
        if(id.isBlank() || secret.isBlank()) throw new IllegalStateException("Google credentials are required when GOOGLE_ENABLED=true");
        return new InMemoryClientRegistrationRepository(CommonOAuth2Provider.GOOGLE.getBuilder("google").clientId(id).clientSecret(secret).scope("openid","profile","email").redirectUri("{baseUrl}/login/oauth2/code/{registrationId}").build());
    }
    @Bean @Order(0)
    SecurityFilterChain googleChain(HttpSecurity http,GoogleIdentityService identity,@Value("${app.frontend-url}") String frontend) throws Exception {
        return http.securityMatcher("/oauth2/**","/login/oauth2/**","/api/auth/google/redirect")
                .authorizeHttpRequests(auth->auth.anyRequest().permitAll())
                .securityContext(context->context.securityContextRepository(new NullSecurityContextRepository()))
                .oauth2Login(oauth->oauth.successHandler((request,response,authentication)-> {
                    var session=request.getSession(false);
                    Long linked=session==null?null:(Long)session.getAttribute("examai.google.linkUser");
                    String source=session==null?null:(String)session.getAttribute("examai.google.sourceSessionHash");
                    String target;
                    try {target=frontend+"/#google_handoff="+identity.complete((OidcUser)authentication.getPrincipal(),linked,source);}
                    catch(WorkspaceError error) {target=frontend+"/#google_error="+URLEncoder.encode(error.getReason(),StandardCharsets.UTF_8);}
                    if(session!=null) session.invalidate();response.setHeader("Referrer-Policy","no-referrer");response.sendRedirect(target);
                }).failureHandler((request,response,error)-> {
                    var session=request.getSession(false);if(session!=null) session.invalidate();response.sendRedirect(frontend+"/#google_error=Google%20authentication%20failed");
                })).build();
    }
}
