package com.quicktest.workspace;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class ProductionGuard implements SmartInitializingSingleton {
    private final Environment environment;
    public ProductionGuard(Environment environment) {this.environment=environment;}
    @Override public void afterSingletonsInstantiated() {
        if(!Arrays.asList(environment.getActiveProfiles()).contains("production")) return;
        if(environment.getProperty("app.demo-seed",Boolean.class,true) || environment.getProperty("app.legacy-api.enabled",Boolean.class,false) || environment.getProperty("app.billing.fixtures",Boolean.class,false) || environment.getProperty("app.mail.adapter","local").equals("local") || environment.getProperty("app.ai.provider","mock").equals("mock")) throw new IllegalStateException("Production requires disabled demo/legacy/fixtures and configured real mail/AI adapters");
        if(!environment.getProperty("app.frontend-url","").startsWith("https://")) throw new IllegalStateException("Production requires HTTPS frontend");
        if(!environment.getProperty("app.workspace.workers",Boolean.class,true) || !environment.getProperty("server.servlet.session.cookie.secure",Boolean.class,false)) throw new IllegalStateException("Production requires active workers and secure cookies");
        if(environment.getProperty("spring.datasource.password","").isBlank() || Set.of("quicktest","root","password123").contains(environment.getProperty("spring.datasource.password",""))) throw new IllegalStateException("Production requires non-demo database credentials");
    }
}
