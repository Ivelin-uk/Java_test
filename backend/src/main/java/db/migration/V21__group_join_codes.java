package db.migration;

import com.quicktest.workspace.WorkspaceCrypto;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.util.ArrayList;
import java.util.HashSet;

public class V21__group_join_codes extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection=context.getConnection();
        try(var sql=connection.createStatement()) {
            sql.execute("ALTER TABLE learning_groups ADD COLUMN join_code VARCHAR(8)");
            sql.execute("ALTER TABLE learning_groups ADD CONSTRAINT uk_group_join_code UNIQUE (join_code)");
        }
        var ids=new ArrayList<Long>();
        try(var query=connection.createStatement();var rows=query.executeQuery("SELECT id FROM learning_groups ORDER BY id")) {
            while(rows.next()) ids.add(rows.getLong("id"));
        }
        var crypto=new WorkspaceCrypto();var used=new HashSet<String>();
        try(var update=connection.prepareStatement("UPDATE learning_groups SET join_code=? WHERE id=?")) {
            for(long id:ids) {
                String code;do {code=crypto.code();} while(!used.add(code));
                update.setString(1,code);update.setLong(2,id);update.executeUpdate();
            }
        }
    }
}
