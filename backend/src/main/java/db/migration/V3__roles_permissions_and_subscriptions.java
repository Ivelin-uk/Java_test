package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Statement;
import java.util.List;

public class V3__roles_permissions_and_subscriptions extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection = context.getConnection();
        try (Statement sql = connection.createStatement()) {
            // MySQL 5.7 parses but does not store CHECK constraints; H2 and MySQL 8 enforce them.
            if (connection.getMetaData().getDatabaseProductName().equals("H2")) {
                sql.execute("ALTER TABLE users DROP CONSTRAINT ck_users_role");
            } else if (connection.getMetaData().getDatabaseMajorVersion() >= 8) {
                try (var check = connection.prepareStatement("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'ck_users_role' AND constraint_type = 'CHECK'");
                     var result = check.executeQuery()) {
                    result.next();
                    if (result.getInt(1) > 0) sql.execute("ALTER TABLE users DROP CHECK ck_users_role");
                }
            }
            for (String statement : List.of(
                    "UPDATE users SET role = 'TEACHER' WHERE role = 'USER' OR (role = 'ADMIN' AND email = 'teacher@quicktest.local')",
                    "UPDATE users SET role = 'STUDENT' WHERE email = 'student@quicktest.local'",
                    "ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('ADMIN', 'TEACHER', 'STUDENT'))",
                    "ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE",
                    "ALTER TABLE users ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT FALSE",
                    "ALTER TABLE users ADD COLUMN subscription_paid BOOLEAN NOT NULL DEFAULT FALSE",
                    "ALTER TABLE users ADD COLUMN subscription_paid_until DATE",
                    "ALTER TABLE users ADD COLUMN subscription_paid_at DATETIME(6)",
                    "CREATE TABLE endpoint_permission (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, endpoint_key VARCHAR(160) NOT NULL, role VARCHAR(20) NOT NULL, allowed BOOLEAN NOT NULL, subscription_required BOOLEAN NOT NULL, CONSTRAINT uk_endpoint_role UNIQUE (endpoint_key, role))",
                    "CREATE TABLE admin_audit (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, actor_id BIGINT NOT NULL, target_user_id BIGINT, action VARCHAR(100) NOT NULL, details VARCHAR(1000) NOT NULL, created_at DATETIME(6) NOT NULL, CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id), CONSTRAINT fk_audit_target FOREIGN KEY (target_user_id) REFERENCES users(id))"
            )) sql.execute(statement);
        }
    }
}
