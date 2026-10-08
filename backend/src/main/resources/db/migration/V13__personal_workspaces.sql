CREATE TABLE personal_workspaces (
 user_id BIGINT PRIMARY KEY,
 organization_id BIGINT NOT NULL UNIQUE,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
);

UPDATE users SET role='TEACHER'
WHERE role='STUDENT' AND EXISTS (
 SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.status='active'
 AND (m.roles_json LIKE '%TEACHER%' OR m.roles_json LIKE '%ORG_ADMIN%')
);
