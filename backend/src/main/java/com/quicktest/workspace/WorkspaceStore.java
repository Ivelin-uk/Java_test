package com.quicktest.workspace;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class WorkspaceStore {
    private final JdbcTemplate jdbc;
    private final WorkspaceJson json;

    public WorkspaceStore(JdbcTemplate jdbc, WorkspaceJson json) { this.jdbc = jdbc; this.json = json; }

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

    public byte[] bytes(String sql, Object... args) { return jdbc.queryForObject(sql, byte[].class, arguments(args)); }

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

    // Retained for existing verification fixtures; application services use the mapping helpers directly.
    public String json(Object value) { return json.write(value); }
    public <T> T parse(Object value, Class<T> type) { return json.parse(value,type); }
    public Map<String, Object> object(Object value) { return json.object(value); }
    public static long number(Map<String, Object> row, String key) { return WorkspaceValues.number(row,key); }
    public static String string(Map<String, Object> row, String key) { return WorkspaceValues.string(row,key); }
    public static boolean flag(Map<String, Object> row, String key) { return WorkspaceValues.flag(row,key); }
    public static Instant time(Map<String, Object> row, String key) { return WorkspaceValues.time(row,key); }
    public static BigDecimal decimal(Map<String, Object> row, String key) { return WorkspaceValues.decimal(row,key); }
}
