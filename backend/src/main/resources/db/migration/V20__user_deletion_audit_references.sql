-- Preserve journals when an administrator permanently removes an account and its data.
ALTER TABLE admin_audit MODIFY COLUMN actor_id BIGINT NULL;
ALTER TABLE workspace_audit MODIFY COLUMN actor_id BIGINT NULL;
ALTER TABLE retention_runs MODIFY COLUMN actor_id BIGINT NULL;
ALTER TABLE retention_runs MODIFY COLUMN organization_id BIGINT NULL;
-- Published results in other teachers' workspaces keep their points when the reviewer is removed.
ALTER TABLE result_revisions MODIFY COLUMN author_id BIGINT NULL;
