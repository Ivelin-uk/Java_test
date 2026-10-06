CREATE TABLE organization_retention_locks (
    organization_id BIGINT NOT NULL PRIMARY KEY,
    CONSTRAINT fk_retention_lock_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
