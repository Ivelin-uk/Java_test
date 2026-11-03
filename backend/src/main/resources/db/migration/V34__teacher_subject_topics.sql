CREATE TABLE teacher_subject_topics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    subject_name VARCHAR(190) NOT NULL,
    normalized_subject VARCHAR(190) NOT NULL,
    name VARCHAR(190) NOT NULL,
    normalized_name VARCHAR(190) NOT NULL,
    level VARCHAR(2) NOT NULL DEFAULT '',
    created_at DATETIME(6) NOT NULL,
    UNIQUE (owner_id, normalized_subject, normalized_name, level),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
