package db.migration;

import com.quicktest.workspace.WorkspaceCrypto;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.util.ArrayList;
import java.util.HashSet;

public class V24__assessment_numbers_and_imports extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection=context.getConnection();
        try(var sql=connection.createStatement()) {
            sql.execute("ALTER TABLE workspace_assessments ADD COLUMN public_number CHAR(12)");
            sql.execute("ALTER TABLE workspace_assessments ADD CONSTRAINT uk_assessment_number UNIQUE(public_number)");
        }
        var ids=new ArrayList<Long>();
        try(var query=connection.createStatement();var rows=query.executeQuery("SELECT id FROM workspace_assessments ORDER BY id")) {
            while(rows.next()) ids.add(rows.getLong("id"));
        }
        var crypto=new WorkspaceCrypto();var used=new HashSet<String>();
        try(var update=connection.prepareStatement("UPDATE workspace_assessments SET public_number=? WHERE id=?")) {
            for(long id:ids) {
                String number;do {number=crypto.assessmentNumber();} while(!used.add(number));
                update.setString(1,number);update.setLong(2,id);update.executeUpdate();
            }
        }
        try(var sql=connection.createStatement()) {
            sql.execute("ALTER TABLE workspace_assessments MODIFY COLUMN public_number CHAR(12) NOT NULL");
            sql.execute("CREATE TABLE assessment_imports(organization_id BIGINT NOT NULL,user_id BIGINT NOT NULL,source_id BIGINT NOT NULL,assessment_id BIGINT NOT NULL,PRIMARY KEY(organization_id,user_id,source_id),FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id),FOREIGN KEY(organization_id,assessment_id) REFERENCES workspace_assessments(organization_id,id) ON DELETE CASCADE,FOREIGN KEY(source_id) REFERENCES workspace_assessments(id) ON DELETE CASCADE)");
        }
    }
}
