CREATE TABLE retention_runs (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, request_key VARCHAR(80) NOT NULL,
 actor_id BIGINT NOT NULL, cutoff DATETIME(6) NOT NULL, reason VARCHAR(1000) NOT NULL,
 redacted_attempts INT NOT NULL, created_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,request_key), FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
