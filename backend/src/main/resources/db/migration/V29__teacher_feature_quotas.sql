CREATE TABLE teacher_feature_locks (
 user_id BIGINT PRIMARY KEY,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE teacher_ai_credits (
 job_kind VARCHAR(20) NOT NULL,
 job_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 quota_period VARCHAR(20) NOT NULL,
 status VARCHAR(20) NOT NULL,
 updated_at DATETIME(6) NOT NULL,
 PRIMARY KEY(job_kind,job_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX ix_teacher_ai_quota ON teacher_ai_credits(user_id,quota_period,status);
