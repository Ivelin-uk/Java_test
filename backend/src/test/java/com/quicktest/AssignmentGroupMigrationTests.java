package com.quicktest;

import db.migration.V22__assignment_groups;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AssignmentGroupMigrationTests {
    @Test void backfillsDistinctHistoricalAndCrossWorkspaceTargetsWithoutChangingRecipientAccess() throws Exception {
        try(var connection=DriverManager.getConnection("jdbc:h2:mem:assignment_group_migration;MODE=MySQL;DATABASE_TO_LOWER=TRUE","sa","");var sql=connection.createStatement()) {
            sql.execute("CREATE TABLE learning_groups(id BIGINT PRIMARY KEY,organization_id BIGINT NOT NULL,UNIQUE(organization_id,id))");
            sql.execute("CREATE TABLE exam_assignments(id BIGINT PRIMARY KEY,organization_id BIGINT NOT NULL,UNIQUE(organization_id,id))");
            sql.execute("CREATE TABLE assignment_recipients(organization_id BIGINT,assignment_id BIGINT,student_id BIGINT,source_groups_json TEXT,canceled BOOLEAN)");
            sql.execute("INSERT INTO learning_groups VALUES(11,1),(12,1),(21,2)");
            sql.execute("INSERT INTO exam_assignments VALUES(101,1),(102,2)");
            sql.execute("INSERT INTO assignment_recipients VALUES(1,101,201,'[11,12,21]',FALSE),(1,101,202,'[11,12]',TRUE),(2,102,203,'[]',FALSE)");
            var context=mock(Context.class);when(context.getConnection()).thenReturn(connection);
            new V22__assignment_groups().migrate(context);
            var targets=new ArrayList<String>();
            try(var rows=sql.executeQuery("SELECT organization_id,assignment_id,group_organization_id,group_id FROM assignment_groups ORDER BY group_id")) {
                while(rows.next()) targets.add(rows.getLong(1)+":"+rows.getLong(2)+":"+rows.getLong(3)+":"+rows.getLong(4));
            }
            assertEquals(List.of("1:101:1:11","1:101:1:12","1:101:2:21"),targets);
            try(var rows=sql.executeQuery("SELECT canceled,source_groups_json FROM assignment_recipients WHERE student_id=202")) {
                assertTrue(rows.next());assertTrue(rows.getBoolean(1));assertEquals("[11,12]",rows.getString(2));
            }
            sql.execute("DELETE FROM exam_assignments WHERE id=101");
            try(var rows=sql.executeQuery("SELECT COUNT(*) FROM assignment_groups")) {assertTrue(rows.next());assertEquals(0,rows.getInt(1));}
        }
    }
}
