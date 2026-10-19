package com.quicktest;

import db.migration.V21__group_join_codes;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.util.HashSet;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GroupJoinCodeMigrationTests {
    @Test void existingGroupsReceiveUniqueCodesWithoutChangingMembersOrDeletionMarkers() throws Exception {
        try(var connection=DriverManager.getConnection("jdbc:h2:mem:group_join_migration;MODE=MySQL;DATABASE_TO_LOWER=TRUE","sa","");var sql=connection.createStatement()) {
            sql.execute("CREATE TABLE learning_groups(id BIGINT PRIMARY KEY,name VARCHAR(190),deleted_at DATETIME(6))");
            sql.execute("CREATE TABLE group_members(group_id BIGINT,user_id BIGINT,FOREIGN KEY(group_id) REFERENCES learning_groups(id))");
            sql.execute("INSERT INTO learning_groups VALUES(1,'Active',NULL),(2,'Deleted','2026-10-01 12:00:00')");
            sql.execute("INSERT INTO group_members VALUES(1,100),(2,200)");
            var context=mock(Context.class);when(context.getConnection()).thenReturn(connection);
            new V21__group_join_codes().migrate(context);
            var codes=new HashSet<String>();
            try(var rows=sql.executeQuery("SELECT id,name,deleted_at,join_code FROM learning_groups ORDER BY id")) {
                assertTrue(rows.next());assertEquals("Active",rows.getString("name"));assertNull(rows.getTimestamp("deleted_at"));
                String first=rows.getString("join_code");assertTrue(first.matches("[A-HJ-NP-Z2-9]{8}"));assertTrue(codes.add(first));
                assertTrue(rows.next());assertEquals("Deleted",rows.getString("name"));assertNotNull(rows.getTimestamp("deleted_at"));
                assertTrue(rows.getString("join_code").matches("[A-HJ-NP-Z2-9]{8}"));assertTrue(codes.add(rows.getString("join_code")));assertFalse(rows.next());
                assertThrows(java.sql.SQLException.class,()->sql.execute("INSERT INTO learning_groups(id,name,join_code) VALUES(3,'Duplicate','"+first+"')"));
            }
            try(var rows=sql.executeQuery("SELECT COUNT(*) FROM group_members")) {assertTrue(rows.next());assertEquals(2,rows.getInt(1));}
        }
    }
}
