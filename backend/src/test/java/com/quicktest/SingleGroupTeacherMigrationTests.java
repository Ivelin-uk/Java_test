package com.quicktest;

import db.migration.V14__single_group_teacher;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.sql.SQLException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SingleGroupTeacherMigrationTests {
    @Test void retainsCreatorAndEnforcesSingleTeacher() throws Exception {
        try (var connection = DriverManager.getConnection("jdbc:h2:mem:single_teacher_migration;MODE=MySQL", "sa", ""); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE group_teachers (organization_id BIGINT, group_id BIGINT, user_id BIGINT, PRIMARY KEY(organization_id,group_id,user_id))");
            sql.execute("CREATE TABLE workspace_audit (organization_id BIGINT, resource_id BIGINT, action VARCHAR(100), actor_id BIGINT)");
            sql.execute("INSERT INTO group_teachers VALUES (1,10,1),(1,10,2),(1,10,3),(1,20,5),(1,20,6)");
            sql.execute("INSERT INTO workspace_audit VALUES (1,10,'group.created',3)");
            Context context = mock(Context.class);
            when(context.getConnection()).thenReturn(connection);
            new V14__single_group_teacher().migrate(context);
            try (var rows = sql.executeQuery("SELECT user_id FROM group_teachers ORDER BY group_id")) {
                assertTrue(rows.next()); assertEquals(3, rows.getLong(1));
                assertTrue(rows.next()); assertEquals(5, rows.getLong(1));
                assertFalse(rows.next());
            }
            assertThrows(SQLException.class, () -> sql.execute("INSERT INTO group_teachers VALUES (1,10,9)"));
        }
    }
}
