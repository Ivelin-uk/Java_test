CREATE TABLE assessment_library_removals (
 organization_id BIGINT NOT NULL,
 assessment_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 removed_at DATETIME(6) NOT NULL,
 PRIMARY KEY(user_id,assessment_id),
 FOREIGN KEY(organization_id,assessment_id) REFERENCES workspace_assessments(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
