CREATE TABLE private_images (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, owner_id BIGINT NOT NULL,
 purpose VARCHAR(20) NOT NULL, mime_type VARCHAR(40) NOT NULL, byte_size INT NOT NULL,
 width INT NOT NULL, height INT NOT NULL, content LONGBLOB NOT NULL, created_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id)
);
ALTER TABLE organizations ADD COLUMN logo_id BIGINT;
ALTER TABLE organizations ADD FOREIGN KEY(id,logo_id) REFERENCES private_images(organization_id,id);
