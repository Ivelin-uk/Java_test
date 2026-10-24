ALTER TABLE exam_assignments ADD COLUMN auto_ai_grading BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE exam_assignments ADD COLUMN auto_ai_grading_user_id BIGINT NULL;
ALTER TABLE exam_assignments ADD COLUMN auto_ai_grading_platform_scope BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX ix_attempt_grading_queue ON exam_attempts(status,id);
