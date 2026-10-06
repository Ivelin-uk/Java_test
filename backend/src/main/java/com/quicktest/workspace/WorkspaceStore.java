package com.quicktest.workspace;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Component
public class WorkspaceStore {
    public final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public WorkspaceStore(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    public List<Map<String, Object>> rows(String sql, Object... args) {
        return jdbc.query(sql, (rs, n) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= rs.getMetaData().getColumnCount(); i++) {
                Object value = rs.getObject(i);
                if (value instanceof Timestamp stamp) value = stamp.toLocalDateTime().toInstant(java.time.ZoneOffset.UTC).toString();
                if (value instanceof java.time.LocalDateTime date) value = date.toInstant(java.time.ZoneOffset.UTC).toString();
                row.put(rs.getMetaData().getColumnLabel(i).toLowerCase(Locale.ROOT), value);
            }
            return row;
        }, arguments(args));
    }

    public Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> rows = rows(sql, args);
        if (rows.isEmpty()) throw WorkspaceError.notFound();
        return rows.getFirst();
    }

    public Optional<Map<String, Object>> optional(String sql, Object... args) {
        return rows(sql, args).stream().findFirst();
    }

    public long count(String sql, Object... args) {
        return Objects.requireNonNull(jdbc.queryForObject(sql, Long.class, arguments(args)));
    }

    public int update(String sql, Object... args) { return jdbc.update(sql, arguments(args)); }

    public long insert(String sql, Object... args) {
        GeneratedKeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            Object[] converted = arguments(args);
            for (int i = 0; i < converted.length; i++) statement.setObject(i + 1, converted[i]);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    private Object[] arguments(Object[] args) {
        return Arrays.stream(args).map(value -> value instanceof Instant time ? java.time.LocalDateTime.ofInstant(time, java.time.ZoneOffset.UTC) : value).toArray();
    }

    public String json(Object value) { return json.writeValueAsString(value); }
    public <T> T parse(Object value, Class<T> type) { return json.readValue(String.valueOf(value), type); }
    @SuppressWarnings("unchecked")
    public Map<String, Object> object(Object value) { return parse(value, Map.class); }
    public static long number(Map<String, Object> row, String key) { return ((Number) row.get(key)).longValue(); }
    public static String string(Map<String, Object> row, String key) { return Objects.toString(row.get(key), ""); }
    public static boolean flag(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return Boolean.TRUE.equals(value) || value instanceof Number n && n.intValue() != 0;
    }
    public static Instant time(Map<String, Object> row, String key) { return Instant.parse(string(row, key)); }
    public static BigDecimal decimal(Map<String, Object> row, String key) {
        return new BigDecimal(string(row, key));
    }
}
