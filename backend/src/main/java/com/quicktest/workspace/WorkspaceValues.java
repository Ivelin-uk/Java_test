package com.quicktest.workspace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;

public final class WorkspaceValues {
    private WorkspaceValues() {}

    public static long number(Map<String, Object> row, String key) {
        return ((Number) row.get(key)).longValue();
    }

    public static String string(Map<String, Object> row, String key) {
        return Objects.toString(row.get(key), "");
    }

    public static boolean flag(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return Boolean.TRUE.equals(value) || value instanceof Number number && number.intValue() != 0;
    }

    public static Instant time(Map<String, Object> row, String key) {
        return Instant.parse(string(row, key));
    }

    public static BigDecimal decimal(Map<String, Object> row, String key) {
        return new BigDecimal(string(row, key));
    }
}
