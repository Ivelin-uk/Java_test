package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import tools.jackson.databind.json.JsonMapper;
import java.util.LinkedHashSet;

public class V22__assignment_groups extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection=context.getConnection();
        try(var sql=connection.createStatement()) {
            sql.execute("CREATE TABLE assignment_groups (organization_id BIGINT NOT NULL,assignment_id BIGINT NOT NULL,group_organization_id BIGINT NOT NULL,group_id BIGINT NOT NULL,PRIMARY KEY(organization_id,assignment_id,group_id),FOREIGN KEY(organization_id,assignment_id) REFERENCES exam_assignments(organization_id,id) ON DELETE CASCADE,FOREIGN KEY(group_organization_id,group_id) REFERENCES learning_groups(organization_id,id) ON DELETE CASCADE)");
            sql.execute("CREATE INDEX ix_assignment_group ON assignment_groups(group_organization_id,group_id,assignment_id)");
        }
        // Preserve the group targets of existing assignments, including canceled recipients.
        record Target(long organization,long assignment,long group) {}
        var targets=new LinkedHashSet<Target>();var mapper=JsonMapper.builder().build();
        try(var query=connection.createStatement();var rows=query.executeQuery("SELECT organization_id,assignment_id,source_groups_json FROM assignment_recipients")) {
            while(rows.next()) for(long group:mapper.readValue(rows.getString("source_groups_json"),Long[].class))
                targets.add(new Target(rows.getLong("organization_id"),rows.getLong("assignment_id"),group));
        }
        try(var insert=connection.prepareStatement("INSERT INTO assignment_groups(organization_id,assignment_id,group_organization_id,group_id) SELECT ?,?,organization_id,id FROM learning_groups WHERE id=?")) {
            for(var target:targets) {
                insert.setLong(1,target.organization());insert.setLong(2,target.assignment());insert.setLong(3,target.group());insert.executeUpdate();
            }
        }
    }
}
