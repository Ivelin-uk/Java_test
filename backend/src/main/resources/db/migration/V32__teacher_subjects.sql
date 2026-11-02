CREATE TABLE teacher_subjects (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    name VARCHAR(190) NOT NULL,
    normalized_name VARCHAR(190) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE (owner_id, normalized_name),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
