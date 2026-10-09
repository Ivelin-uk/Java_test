package com.quicktest;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.junit.jupiter.api.Assertions.*;

class RoleMigrationTests {
    @Test
    void upgradingExistingDatabasePreservesAccountsSessionsAndTests() throws Exception {
        String url = "jdbc:h2:mem:role_upgrade;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
        try (var source = new SingleConnectionDataSource(url, "sa", "", true)) {
        Flyway.configure().dataSource(source).locations("classpath:db/migration").target("2").load().migrate();
        try (var connection = source.getConnection(); var sql = connection.createStatement()) {
            sql.execute("INSERT INTO users (id, name, email, password_hash, role) VALUES "
                    + "(1, 'Creator', 'owner@example.test', 'original-hash', 'USER'), "
                    + "(2, 'Teacher', 'teacher@quicktest.local', 'teacher-hash', 'ADMIN'), "
                    + "(3, 'Student', 'student@quicktest.local', 'student-hash', 'USER'), "
                    + "(4, 'Administrator', 'actual-admin@example.test', 'admin-hash', 'ADMIN')");
            sql.execute("INSERT INTO tests (id, owner_id, title, question_order_random, answer_order_random, show_result, show_answers) VALUES (1, 1, 'Preserved test', FALSE, FALSE, TRUE, TRUE)");
            sql.execute("INSERT INTO auth_token (token, user_id) VALUES ('existing-session', 1)");
        }
        var migration = Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        assertEquals(14, migration.migrationsExecuted);
        try (var connection = source.getConnection(); var sql = connection.createStatement()) {
            try (var rows = sql.executeQuery("SELECT role, password_hash, active, subscription_paid FROM users ORDER BY id")) {
                for (String role : new String[]{"TEACHER", "TEACHER", "STUDENT", "ADMIN"}) {
                    assertTrue(rows.next()); assertEquals(role, rows.getString("role")); assertTrue(rows.getBoolean("active"));
                    assertFalse(rows.getBoolean("subscription_paid")); assertTrue(rows.getString("password_hash").endsWith("hash"));
                }
            }
            try (var rows = sql.executeQuery("SELECT title FROM tests WHERE id = 1")) {
                assertTrue(rows.next()); assertEquals("Preserved test", rows.getString(1));
            }
            try (var rows = sql.executeQuery("SELECT user_id FROM auth_token WHERE token = 'existing-session'")) {
                assertTrue(rows.next()); assertEquals(1, rows.getLong(1));
            }
        }
        }
    }
}
