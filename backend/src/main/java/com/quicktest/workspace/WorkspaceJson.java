package com.quicktest.workspace;

import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

@Component
public class WorkspaceJson {
    private final ObjectMapper mapper;

    public WorkspaceJson(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String write(Object value) {
        return mapper.writeValueAsString(value);
    }

    public <T> T parse(Object value, Class<T> type) {
        return mapper.readValue(String.valueOf(value), type);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> object(Object value) {
        return parse(value, Map.class);
    }
}
