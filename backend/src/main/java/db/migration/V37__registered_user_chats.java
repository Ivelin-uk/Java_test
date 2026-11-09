package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.util.LinkedHashSet;

public class V37__registered_user_chats extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection = context.getConnection();
        boolean h2 = "H2".equals(connection.getMetaData().getDatabaseProductName());
        var membershipConstraints = new LinkedHashSet<String>();
        try (var keys = connection.getMetaData().getImportedKeys(connection.getCatalog(), h2 ? connection.getSchema() : null,
                "conversation_members")) {
            while (keys.next()) {
                if ("memberships".equalsIgnoreCase(keys.getString("PKTABLE_NAME"))) {
                    membershipConstraints.add(keys.getString("FK_NAME"));
                }
            }
        }
        if (membershipConstraints.isEmpty()) throw new IllegalStateException("Chat membership foreign key was not found");
        try (var sql = connection.createStatement()) {
            // Registered chats use their own explicit participant list. They never grant access
            // to the namespace's groups, tests or other resources by adding memberships.
            sql.execute("ALTER TABLE workspace_conversations ADD COLUMN chat_kind VARCHAR(24) NOT NULL DEFAULT 'legacy'");
            sql.execute("ALTER TABLE workspace_conversations ADD COLUMN registered_direct_key VARCHAR(40)");
            sql.execute("CREATE UNIQUE INDEX uq_registered_direct_pair ON workspace_conversations(registered_direct_key)");
            sql.execute("ALTER TABLE conversation_members ADD CONSTRAINT fk_conversation_registered_user FOREIGN KEY(user_id) REFERENCES users(id)");
            String quote = connection.getMetaData().getIdentifierQuoteString().trim();
            for (String name : membershipConstraints) {
                String identifier = quote + name.replace(quote, quote + quote) + quote;
                sql.execute("ALTER TABLE conversation_members DROP " + (h2 ? "CONSTRAINT " : "FOREIGN KEY ") + identifier);
            }
        }
    }
}
