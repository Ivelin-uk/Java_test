package com.quicktest.access;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.*;

@Component
public class EndpointCatalog implements SmartInitializingSingleton {
    private final ObjectProvider<RequestMappingHandlerMapping> mappings;
    private Map<String, Endpoint> endpoints = Map.of();

    public EndpointCatalog(@Qualifier("requestMappingHandlerMapping") ObjectProvider<RequestMappingHandlerMapping> mappings) {
        this.mappings = mappings;
    }

    @Override
    public void afterSingletonsInstantiated() {
        Map<String, Endpoint> found = new TreeMap<>();
        mappings.getObject().getHandlerMethods().forEach((mapping, handler) -> {
            if (!handler.getBeanType().getPackageName().startsWith("com.quicktest")) return;
            EndpointPolicy policy = AnnotatedElementUtils.findMergedAnnotation(handler.getMethod(), EndpointPolicy.class);
            if (policy == null) policy = AnnotatedElementUtils.findMergedAnnotation(handler.getBeanType(), EndpointPolicy.class);
            if (policy == null) throw new IllegalStateException("Endpoint has no access policy: " + handler);
            String key = handler.getBeanType().getSimpleName() + "." + handler.getMethod().getName();
            PreAuthorize security = AnnotatedElementUtils.findMergedAnnotation(handler.getMethod(), PreAuthorize.class);
            if (security == null) security = AnnotatedElementUtils.findMergedAnnotation(handler.getBeanType(), PreAuthorize.class);
            if (policy.mode() != EndpointPolicy.Mode.PUBLIC && security == null)
                throw new IllegalStateException("Endpoint has no method authorization: " + key);
            if (policy.mode() == EndpointPolicy.Mode.MANAGED && !security.value().contains("'" + key + "'"))
                throw new IllegalStateException("Endpoint permission key does not match method: " + key);
            Endpoint endpoint = new Endpoint(key, handler.getBeanType().getSimpleName(), handler.getMethod().getName(),
                    mapping.getMethodsCondition().getMethods().stream().map(Enum::name).sorted().toList(),
                    mapping.getPatternValues().stream().sorted().toList(), policy.mode(), policy.teacher(), policy.student(), policy.paid());
            if (found.putIfAbsent(key, endpoint) != null) throw new IllegalStateException("Duplicate endpoint key: " + key);
        });
        endpoints = Collections.unmodifiableMap(found);
    }

    public Collection<Endpoint> all() { return endpoints.values(); }
    public Endpoint get(String key) { return endpoints.get(key); }

    public record Endpoint(String key, String controller, String method, List<String> httpMethods, List<String> paths,
                           EndpointPolicy.Mode mode, boolean teacher, boolean student, boolean paid) {}
}
