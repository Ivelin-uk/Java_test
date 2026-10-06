CREATE TABLE profile_exam_locks (
 user_id BIGINT PRIMARY KEY, FOREIGN KEY(user_id) REFERENCES users(id)
);
INSERT INTO profile_exam_locks(user_id) SELECT id FROM users;
CREATE TABLE question_bank_items (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, owner_id BIGINT NOT NULL,
 subject VARCHAR(190) NOT NULL, shared BOOLEAN NOT NULL DEFAULT FALSE, definition_json LONGTEXT NOT NULL,
 created_at DATETIME(6) NOT NULL, UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE tenant_endpoint_permissions (
 organization_id BIGINT NOT NULL, endpoint_key VARCHAR(150) NOT NULL, role VARCHAR(20) NOT NULL, allowed BOOLEAN NOT NULL,
 PRIMARY KEY(organization_id,endpoint_key,role), FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE support_grants (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, administrator_id BIGINT NOT NULL,
 approved_by BIGINT NOT NULL, reason VARCHAR(1000) NOT NULL, expires_at DATETIME(6) NOT NULL,
 revoked_at DATETIME(6), created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(organization_id,approved_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(administrator_id) REFERENCES users(id)
);
CREATE TABLE realtime_tickets (
 token_hash VARCHAR(64) PRIMARY KEY, organization_id BIGINT NOT NULL, conversation_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL, auth_session_hash VARCHAR(64) NOT NULL, expires_at DATETIME(6) NOT NULL, consumed_at DATETIME(6),
 FOREIGN KEY(organization_id,conversation_id,user_id) REFERENCES conversation_members(organization_id,conversation_id,user_id)
);
ALTER TABLE message_reports ADD COLUMN resolution VARCHAR(1000);
ALTER TABLE message_reports ADD COLUMN resolved_by BIGINT;
ALTER TABLE message_reports ADD COLUMN resolved_at DATETIME(6);
ALTER TABLE workspace_messages ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE;
