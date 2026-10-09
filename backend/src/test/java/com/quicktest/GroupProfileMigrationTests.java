package com.quicktest;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import java.sql.DriverManager;
import java.util.HashSet;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class GroupProfileMigrationTests {
    @Test void removesUnusedColumnsAndPreservesGroupsMembersAndDeletionMarkers() throws Exception {
        try (var connection = DriverManager.getConnection("jdbc:h2:mem:group_profile_migration;MODE=MySQL;DATABASE_TO_LOWER=TRUE", "sa", ""); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE learning_groups (id BIGINT PRIMARY KEY, name VARCHAR(190), description TEXT, subject VARCHAR(190), school_year VARCHAR(40), class_label VARCHAR(80), status VARCHAR(20), created_at DATETIME(6))");
            sql.execute("CREATE TABLE group_members (group_id BIGINT PRIMARY KEY, user_id BIGINT, FOREIGN KEY(group_id) REFERENCES learning_groups(id))");
            sql.execute("INSERT INTO learning_groups VALUES (1,'Active group','Description','Java','2026/2027','12','active','2026-10-01 12:00:00'),(2,'Archived group','Description','Math','2025/2026','11','archived','2026-10-01 12:00:00'),(3,'Deleted group','Description','English','2024/2025','10','deleted','2026-10-01 12:00:00')");
            sql.execute("INSERT INTO group_members VALUES (1,10),(2,20),(3,30)");
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V16__simplify_group_profiles.sql"));
            try (var rows = sql.executeQuery("SELECT * FROM learning_groups ORDER BY id")) {
                var metadata = rows.getMetaData();
                Set<String> columns = new HashSet<>();
                for (int i = 1; i <= metadata.getColumnCount(); i++) columns.add(metadata.getColumnName(i));
                assertFalse(columns.contains("school_year"));
                assertFalse(columns.contains("class_label"));
                assertFalse(columns.contains("status"));
                assertTrue(columns.contains("deleted_at"));
                assertTrue(rows.next()); assertEquals("Active group", rows.getString("name")); assertEquals("Java", rows.getString("subject")); assertNull(rows.getTimestamp("deleted_at"));
                assertTrue(rows.next()); assertEquals("Archived group", rows.getString("name")); assertNull(rows.getTimestamp("deleted_at"));
                assertTrue(rows.next()); assertEquals("Deleted group", rows.getString("name")); assertNotNull(rows.getTimestamp("deleted_at"));
                assertFalse(rows.next());
            }
            try (var rows = sql.executeQuery("SELECT COUNT(*) FROM group_members")) {
                assertTrue(rows.next()); assertEquals(3, rows.getInt(1));
            }
            sql.execute("INSERT INTO learning_groups (id,name,description,subject,created_at) VALUES (4,'New group','New description','Physics',CURRENT_TIMESTAMP)");
        }
    }
}
