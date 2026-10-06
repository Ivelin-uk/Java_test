CREATE TABLE organization_quota_locks (
    organization_id BIGINT NOT NULL PRIMARY KEY,
    CONSTRAINT fk_quota_lock_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
