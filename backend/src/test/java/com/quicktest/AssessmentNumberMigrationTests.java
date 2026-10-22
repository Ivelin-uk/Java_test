package com.quicktest;

import db.migration.V24__assessment_numbers_and_imports;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.util.HashSet;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AssessmentNumberMigrationTests {
    @Test void existingTestsReceiveUniqueNumbersWithoutChangingDefinitionsOrStatus() throws Exception {
        try(var connection=DriverManager.getConnection("jdbc:h2:mem:assessment_numbers;MODE=MySQL;DATABASE_TO_LOWER=TRUE","sa","");var sql=connection.createStatement()) {
            sql.execute("CREATE TABLE memberships(organization_id BIGINT,user_id BIGINT,PRIMARY KEY(organization_id,user_id))");
            sql.execute("CREATE TABLE workspace_assessments(id BIGINT PRIMARY KEY,organization_id BIGINT,definition_json TEXT,status VARCHAR(20),UNIQUE(organization_id,id))");
            sql.execute("INSERT INTO memberships VALUES(1,11),(2,22)");
            sql.execute("INSERT INTO workspace_assessments VALUES(101,1,'original definition','published'),(102,2,'private draft','draft'),(103,2,'historical test','archived')");
            var context=mock(Context.class);when(context.getConnection()).thenReturn(connection);
            new V24__assessment_numbers_and_imports().migrate(context);
            var numbers=new HashSet<String>();
            try(var rows=sql.executeQuery("SELECT public_number,definition_json,status FROM workspace_assessments ORDER BY id")) {
                for(var expected:new String[][]{{"original definition","published"},{"private draft","draft"},{"historical test","archived"}}) {
                    assertTrue(rows.next());String number=rows.getString("public_number");assertTrue(number.matches("[1-9][0-9]{11}"));assertTrue(numbers.add(number));assertEquals(expected[0],rows.getString("definition_json"));assertEquals(expected[1],rows.getString("status"));
                }
            }
            assertThrows(java.sql.SQLException.class,()->sql.execute("INSERT INTO workspace_assessments(id,organization_id,public_number) VALUES(104,1,'"+numbers.iterator().next()+"')"));
            assertThrows(java.sql.SQLException.class,()->sql.execute("INSERT INTO workspace_assessments(id,organization_id) VALUES(105,1)"));
            sql.execute("INSERT INTO assessment_imports VALUES(2,22,101,102)");sql.execute("DELETE FROM workspace_assessments WHERE id=101");
            try(var rows=sql.executeQuery("SELECT COUNT(*) FROM workspace_assessments WHERE id=102")) {assertTrue(rows.next());assertEquals(1,rows.getInt(1));}
        }
    }
}
