ALTER TABLE workspace_messages ADD COLUMN client_message_id VARCHAR(36);
ALTER TABLE workspace_messages ADD COLUMN request_hash VARCHAR(64);
CREATE UNIQUE INDEX uq_chat_message_client
 ON workspace_messages (organization_id,conversation_id,sender_id,client_message_id);

CREATE TABLE chat_account_tickets (
 token_hash VARCHAR(64) PRIMARY KEY, organization_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
 auth_session_hash VARCHAR(64) NOT NULL, expires_at DATETIME(6) NOT NULL, consumed_at DATETIME(6),
 FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX ix_chat_account_ticket_expiry ON chat_account_tickets(expires_at);
