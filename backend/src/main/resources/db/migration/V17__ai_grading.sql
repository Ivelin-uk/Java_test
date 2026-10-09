-- Jobs outlive a deleted attempt so workers can release its reserved AI quota.
-- No student answers or model response text are retained in this table.
CREATE TABLE workspace_ai_grading_jobs (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, attempt_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL, platform_scope BOOLEAN NOT NULL DEFAULT FALSE,
 request_key VARCHAR(80) NOT NULL, snapshot_hash VARCHAR(64) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'queued', attempts INT NOT NULL DEFAULT 0,
 quota_reserved BOOLEAN NOT NULL DEFAULT FALSE, error_message VARCHAR(500),
 model VARCHAR(190), input_tokens INT, output_tokens INT, revision_id BIGINT,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,attempt_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX ix_ai_grading_queue ON workspace_ai_grading_jobs(status,updated_at);
