package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.util.ArrayList;
import java.util.HashSet;

public class V14__single_group_teacher extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection = context.getConnection();
        var seen = new HashSet<Long>();
        var extra = new ArrayList<long[]>();
        // Prefer the original creator recorded in the audit; legacy groups use the lowest user ID.
        try (var query = connection.createStatement(); var rows = query.executeQuery("SELECT t.organization_id,t.group_id,t.user_id FROM group_teachers t ORDER BY t.group_id,CASE WHEN EXISTS (SELECT 1 FROM workspace_audit a WHERE a.organization_id=t.organization_id AND a.resource_id=t.group_id AND a.action='group.created' AND a.actor_id=t.user_id) THEN 0 ELSE 1 END,t.user_id")) {
            while (rows.next()) {
                if (!seen.add(rows.getLong("group_id"))) extra.add(new long[]{rows.getLong("organization_id"), rows.getLong("group_id"), rows.getLong("user_id")});
            }
        }
        try (var delete = connection.prepareStatement("DELETE FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?")) {
            for (var row : extra) {
                delete.setLong(1, row[0]); delete.setLong(2, row[1]); delete.setLong(3, row[2]); delete.executeUpdate();
            }
        }
        try (var sql = connection.createStatement()) {
            sql.execute("ALTER TABLE group_teachers ADD CONSTRAINT uk_group_single_teacher UNIQUE (organization_id,group_id)");
        }
    }
}
