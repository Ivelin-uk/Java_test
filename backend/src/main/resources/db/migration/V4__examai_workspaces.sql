CREATE TABLE organizations (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) NOT NULL,
 organization_type VARCHAR(40) NOT NULL, contact_email VARCHAR(190) NOT NULL,
 timezone VARCHAR(80) NOT NULL DEFAULT 'Europe/Sofia', student_label VARCHAR(40) NOT NULL DEFAULT 'Ученик',
 status VARCHAR(20) NOT NULL DEFAULT 'active', settings_json TEXT NOT NULL,
 created_at DATETIME(6) NOT NULL
);
CREATE TABLE memberships (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
 roles_json VARCHAR(150) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', created_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,user_id), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE organization_plans (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE,
 monthly_eur DECIMAL(10,2) NOT NULL, yearly_eur DECIMAL(10,2) NOT NULL,
 teacher_limit INT NOT NULL, student_limit INT NOT NULL, ai_limit INT NOT NULL,
 storage_bytes BIGINT NOT NULL, demonstration BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE organization_subscriptions (
 organization_id BIGINT PRIMARY KEY, plan_id BIGINT NOT NULL, status VARCHAR(20) NOT NULL,
 paid_through DATETIME(6) NOT NULL, period_start DATETIME(6) NOT NULL,
 cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE, ai_used INT NOT NULL DEFAULT 0, ai_reserved INT NOT NULL DEFAULT 0,
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(plan_id) REFERENCES organization_plans(id)
);
CREATE TABLE learning_groups (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, name VARCHAR(190) NOT NULL,
 description TEXT NOT NULL, subject VARCHAR(190) NOT NULL, school_year VARCHAR(40) NOT NULL,
 class_label VARCHAR(80) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', created_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE group_teachers (
 organization_id BIGINT NOT NULL, group_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
 PRIMARY KEY(organization_id,group_id,user_id),
 FOREIGN KEY(organization_id,group_id) REFERENCES learning_groups(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE group_members (
 organization_id BIGINT NOT NULL, group_id BIGINT NOT NULL, user_id BIGINT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(organization_id,group_id,user_id),
 FOREIGN KEY(organization_id,group_id) REFERENCES learning_groups(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE organization_invitations (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, email VARCHAR(190) NOT NULL,
 roles_json VARCHAR(150) NOT NULL, group_id BIGINT, token_hash VARCHAR(64) NOT NULL UNIQUE,
 expires_at DATETIME(6) NOT NULL, consumed_at DATETIME(6), created_by BIGINT NOT NULL,
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(organization_id,group_id) REFERENCES learning_groups(organization_id,id),
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE notification_addresses (
 user_id BIGINT PRIMARY KEY, email VARCHAR(190) NOT NULL, verified_at DATETIME(6),
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE identity_challenges (
 token_hash VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL, purpose VARCHAR(30) NOT NULL,
 pending_email VARCHAR(190), expires_at DATETIME(6) NOT NULL, consumed_at DATETIME(6),
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE workspace_assessments (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, owner_id BIGINT NOT NULL,
 title VARCHAR(190) NOT NULL, definition_json LONGTEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft',
 shared BOOLEAN NOT NULL DEFAULT FALSE, updated_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE assessment_versions (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, assessment_id BIGINT NOT NULL,
 version_number INT NOT NULL, title VARCHAR(190) NOT NULL, definition_json LONGTEXT NOT NULL, published_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,id), UNIQUE(organization_id,assessment_id,version_number),
 FOREIGN KEY(organization_id,assessment_id) REFERENCES workspace_assessments(organization_id,id)
);
CREATE TABLE exam_assignments (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, version_id BIGINT NOT NULL,
 teacher_id BIGINT NOT NULL, starts_at DATETIME(6) NOT NULL, ends_at DATETIME(6) NOT NULL,
 max_attempts INT NOT NULL DEFAULT 1, shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
 shuffle_options BOOLEAN NOT NULL DEFAULT FALSE, answers_after_deadline BOOLEAN NOT NULL DEFAULT TRUE,
 code_hash VARCHAR(64), code_generation INT NOT NULL DEFAULT 1, created_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,version_id) REFERENCES assessment_versions(organization_id,id),
 FOREIGN KEY(organization_id,teacher_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE assignment_recipients (
 organization_id BIGINT NOT NULL, assignment_id BIGINT NOT NULL, student_id BIGINT NOT NULL,
 source_groups_json TEXT NOT NULL, individually_assigned BOOLEAN NOT NULL, canceled BOOLEAN NOT NULL DEFAULT FALSE,
 max_attempts INT NOT NULL, fullscreen_exempt BOOLEAN NOT NULL DEFAULT FALSE,
 time_multiplier DECIMAL(6,2) NOT NULL DEFAULT 1, accommodation_reason TEXT,
 PRIMARY KEY(organization_id,assignment_id,student_id),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES exam_assignments(organization_id,id),
 FOREIGN KEY(organization_id,student_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE exam_attempts (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, assignment_id BIGINT NOT NULL,
 student_id BIGINT NOT NULL, attempt_number INT NOT NULL, start_key VARCHAR(80) NOT NULL,
 session_hash VARCHAR(64) NOT NULL, auth_session_hash VARCHAR(64) NOT NULL, browser_id VARCHAR(80) NOT NULL,
 active_key VARCHAR(120) UNIQUE, status VARCHAR(30) NOT NULL DEFAULT 'in_progress',
 current_position INT NOT NULL DEFAULT 0, started_at DATETIME(6) NOT NULL, submitted_at DATETIME(6),
 expired BOOLEAN NOT NULL DEFAULT FALSE, void_reason TEXT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,assignment_id,student_id,attempt_number),
 UNIQUE(organization_id,assignment_id,student_id,start_key),
 FOREIGN KEY(organization_id,assignment_id,student_id) REFERENCES assignment_recipients(organization_id,assignment_id,student_id)
);
CREATE INDEX ix_attempt_student_status ON exam_attempts(student_id,status);
CREATE TABLE attempt_questions (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, attempt_id BIGINT NOT NULL,
 position_index INT NOT NULL, definition_json LONGTEXT NOT NULL, maximum_points DECIMAL(12,4) NOT NULL,
 time_seconds INT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
 open_instance VARCHAR(36), opened_at DATETIME(6), deadline_at DATETIME(6), closed_at DATETIME(6),
 draft_json TEXT, answer_json TEXT, answer_key VARCHAR(80),
 automatic_points DECIMAL(12,4), final_points DECIMAL(12,4), reviewed BOOLEAN NOT NULL DEFAULT FALSE,
 teacher_comment TEXT, override_reason TEXT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,attempt_id,position_index),
 FOREIGN KEY(organization_id,attempt_id) REFERENCES exam_attempts(organization_id,id)
);
CREATE INDEX ix_question_deadline ON attempt_questions(status,deadline_at);
CREATE TABLE exam_events (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, attempt_id BIGINT NOT NULL,
 question_id BIGINT, open_instance VARCHAR(36), event_key VARCHAR(80) NOT NULL,
 event_type VARCHAR(50) NOT NULL, telemetry_json TEXT NOT NULL, received_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,attempt_id,event_key),
 FOREIGN KEY(organization_id,attempt_id) REFERENCES exam_attempts(organization_id,id),
 FOREIGN KEY(organization_id,question_id) REFERENCES attempt_questions(organization_id,id)
);
CREATE TABLE result_revisions (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, attempt_id BIGINT NOT NULL,
 revision_number INT NOT NULL, publication_key VARCHAR(80) NOT NULL, author_id BIGINT NOT NULL,
 points DECIMAL(12,4) NOT NULL, maximum_points DECIMAL(12,4) NOT NULL,
 percentage DECIMAL(16,8) NOT NULL, grade VARCHAR(40) NOT NULL, outcome VARCHAR(20) NOT NULL,
 reason TEXT NOT NULL, snapshot_json LONGTEXT NOT NULL, published_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,id), UNIQUE(organization_id,attempt_id,revision_number),
 UNIQUE(organization_id,attempt_id,publication_key),
 FOREIGN KEY(organization_id,attempt_id) REFERENCES exam_attempts(organization_id,id),
 FOREIGN KEY(organization_id,author_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE notification_outbox (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT, revision_id BIGINT,
 user_id BIGINT NOT NULL, notification_type VARCHAR(40) NOT NULL,
 recipient_email VARCHAR(190) NOT NULL, payload_json LONGTEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'queued', attempts INT NOT NULL DEFAULT 0,
 available_at DATETIME(6) NOT NULL, created_at DATETIME(6) NOT NULL, sent_at DATETIME(6), last_error VARCHAR(500),
 UNIQUE(revision_id,user_id,notification_type),
 FOREIGN KEY(organization_id,revision_id) REFERENCES result_revisions(organization_id,id),
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX ix_outbox_queue ON notification_outbox(status,available_at);
CREATE TABLE workspace_audit (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT, actor_id BIGINT NOT NULL,
 action VARCHAR(80) NOT NULL, resource_id BIGINT, detail_json TEXT NOT NULL, created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(actor_id) REFERENCES users(id)
);
CREATE TABLE workspace_conversations (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, group_id BIGINT,
 title VARCHAR(190) NOT NULL, UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(organization_id,group_id) REFERENCES learning_groups(organization_id,id)
);
CREATE TABLE conversation_members (
 organization_id BIGINT NOT NULL, conversation_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
 read_through BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(organization_id,conversation_id,user_id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES workspace_conversations(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE workspace_messages (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, conversation_id BIGINT NOT NULL,
 sender_id BIGINT NOT NULL, body TEXT NOT NULL, created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(organization_id,conversation_id,sender_id) REFERENCES conversation_members(organization_id,conversation_id,user_id)
);
CREATE INDEX ix_message_conversation ON workspace_messages(organization_id,conversation_id,id);
CREATE TABLE workspace_ai_jobs (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
 request_key VARCHAR(80) NOT NULL, request_json TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'queued',
 result_json LONGTEXT, error_message VARCHAR(500), attempts INT NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 UNIQUE(organization_id,user_id,request_key),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE workspace_rate_limits (
 bucket_key VARCHAR(190) PRIMARY KEY, failures INT NOT NULL, expires_at DATETIME(6) NOT NULL
);
CREATE TABLE workspace_billing_events (
 event_id VARCHAR(190) PRIMARY KEY, organization_id BIGINT NOT NULL, provider VARCHAR(30) NOT NULL,
 provider_timestamp BIGINT NOT NULL, status VARCHAR(30) NOT NULL, created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
