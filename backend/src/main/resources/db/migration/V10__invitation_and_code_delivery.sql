ALTER TABLE notification_outbox MODIFY user_id BIGINT NULL;
CREATE TABLE assignment_code_deliveries (
 organization_id BIGINT NOT NULL, assignment_id BIGINT NOT NULL, generation INT NOT NULL,
 student_id BIGINT NOT NULL, channel VARCHAR(10) NOT NULL, created_at DATETIME(6) NOT NULL,
 PRIMARY KEY(organization_id,assignment_id,generation,student_id,channel),
 FOREIGN KEY(organization_id,assignment_id,student_id) REFERENCES assignment_recipients(organization_id,assignment_id,student_id)
);
