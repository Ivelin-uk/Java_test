ALTER TABLE workspace_conversations ADD COLUMN direct_key VARCHAR(40);
CREATE UNIQUE INDEX uq_workspace_conversation_direct
 ON workspace_conversations (organization_id,direct_key);

ALTER TABLE workspace_messages ADD COLUMN attachment_name VARCHAR(180);
ALTER TABLE workspace_messages ADD COLUMN attachment_type VARCHAR(100);
ALTER TABLE workspace_messages ADD COLUMN attachment_size INT;
ALTER TABLE workspace_messages ADD COLUMN attachment_content MEDIUMBLOB;
