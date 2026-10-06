CREATE TABLE assignment_teachers (
 organization_id BIGINT NOT NULL, assignment_id BIGINT NOT NULL, teacher_id BIGINT NOT NULL,
 PRIMARY KEY(organization_id,assignment_id,teacher_id),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES exam_assignments(organization_id,id),
 FOREIGN KEY(organization_id,teacher_id) REFERENCES memberships(organization_id,user_id)
);
