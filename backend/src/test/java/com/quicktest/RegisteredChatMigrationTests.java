package com.quicktest;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.*;

class RegisteredChatMigrationTests {
    @Test
    void upgradePreservesHistoryAndAllowsChatParticipantsWithoutWorkspaceMembership() throws Exception {
        try (var source = new SingleConnectionDataSource(
                "jdbc:h2:mem:registered_chat_upgrade;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "", true)) {
            Flyway.configure().dataSource(source).locations("classpath:db/migration").target("36").load().migrate();
            try (var connection = source.getConnection(); var sql = connection.createStatement()) {
                sql.execute("INSERT INTO users(id,name,email,password_hash,role) VALUES "
                        + "(9001,'First','first@chat.example.test','hash','TEACHER'),"
                        + "(9002,'Second','second@chat.example.test','hash','STUDENT'),"
                        + "(9003,'Third','third@chat.example.test','hash','STUDENT')");
                sql.execute("INSERT INTO organizations(id,name,organization_type,contact_email,settings_json,created_at) "
                        + "VALUES(9001,'Chat namespace','personal','first@chat.example.test','{}',CURRENT_TIMESTAMP)");
                sql.execute("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) "
                        + "VALUES(9001,9001,'[\"TEACHER\"]',CURRENT_TIMESTAMP),(9001,9002,'[\"STUDENT\"]',CURRENT_TIMESTAMP)");
                sql.execute("INSERT INTO workspace_conversations(id,organization_id,title) VALUES(9001,9001,'Existing conversation')");
                sql.execute("INSERT INTO conversation_members(organization_id,conversation_id,user_id,read_through) "
                        + "VALUES(9001,9001,9001,9001),(9001,9001,9002,0)");
                sql.execute("INSERT INTO workspace_messages(id,organization_id,conversation_id,sender_id,body,created_at) "
                        + "VALUES(9001,9001,9001,9001,'Preserved message',CURRENT_TIMESTAMP)");
                assertThrows(SQLException.class, () -> sql.execute(
                        "INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(9001,9001,9003)"));
            }
            assertEquals(1, Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate().migrationsExecuted);
            try (var connection = source.getConnection(); var sql = connection.createStatement()) {
                try (var row = sql.executeQuery("SELECT body FROM workspace_messages WHERE id=9001")) {
                    assertTrue(row.next());
                    assertEquals("Preserved message", row.getString(1));
                }
                try (var row = sql.executeQuery("SELECT read_through FROM conversation_members WHERE conversation_id=9001 AND user_id=9001")) {
                    assertTrue(row.next());
                    assertEquals(9001, row.getLong(1));
                }
                sql.execute("INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(9001,9001,9003)");
                try (var row = sql.executeQuery("SELECT COUNT(*) FROM memberships WHERE user_id=9003")) {
                    assertTrue(row.next());
                    assertEquals(0, row.getInt(1));
                }
                assertThrows(SQLException.class, () -> sql.execute(
                        "INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(9001,9001,9999)"));
                assertThrows(SQLException.class, () -> sql.execute(
                        "INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(9999,9001,9003)"));
            }
        }
    }
}
