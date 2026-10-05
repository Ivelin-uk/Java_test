CREATE TABLE users (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(255),
    email_verified_at DATETIME(6),
    created_at DATETIME(6),
    updated_at DATETIME(6),
    CONSTRAINT uk_users_email UNIQUE (email),
    CONSTRAINT ck_users_role CHECK (role IN ('USER', 'ADMIN'))
);

CREATE TABLE auth_token (
    token VARCHAR(255) NOT NULL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at DATETIME(6),
    CONSTRAINT fk_auth_token_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE tests (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description VARCHAR(4000),
    language VARCHAR(255),
    status VARCHAR(255),
    access_type VARCHAR(255),
    access_code VARCHAR(255),
    public_code VARCHAR(255),
    duration_minutes INT,
    question_order_random BOOLEAN NOT NULL,
    answer_order_random BOOLEAN NOT NULL,
    show_result BOOLEAN NOT NULL,
    show_answers BOOLEAN NOT NULL,
    published_at DATETIME(6),
    created_at DATETIME(6),
    updated_at DATETIME(6),
    CONSTRAINT fk_tests_owner FOREIGN KEY (owner_id) REFERENCES users (id),
    CONSTRAINT ck_tests_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT ck_tests_access_type CHECK (access_type IN ('PUBLIC', 'ACCESS_CODE', 'REGISTERED_ONLY', 'ASSIGNED'))
);

CREATE INDEX idx_tests_public_code ON tests (public_code);

CREATE TABLE question (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    test_id BIGINT NOT NULL,
    type VARCHAR(255),
    question VARCHAR(4000) NOT NULL,
    difficulty VARCHAR(255),
    points INT NOT NULL,
    explanation VARCHAR(4000),
    position INT NOT NULL,
    CONSTRAINT fk_question_test FOREIGN KEY (test_id) REFERENCES tests (id),
    CONSTRAINT ck_question_type CHECK (type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'OPEN_ANSWER')),
    CONSTRAINT ck_question_difficulty CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD', 'MIXED'))
);

CREATE TABLE answer (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    question_id BIGINT NOT NULL,
    answer VARCHAR(2000) NOT NULL,
    correct BOOLEAN NOT NULL,
    position INT NOT NULL,
    CONSTRAINT fk_answer_question FOREIGN KEY (question_id) REFERENCES question (id)
);

CREATE TABLE attempt (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    test_id BIGINT NOT NULL,
    user_id BIGINT,
    participant_name VARCHAR(255),
    participant_email VARCHAR(255),
    started_at DATETIME(6),
    submitted_at DATETIME(6),
    score INT NOT NULL,
    max_score INT NOT NULL,
    percentage DOUBLE NOT NULL,
    grade VARCHAR(255),
    CONSTRAINT fk_attempt_test FOREIGN KEY (test_id) REFERENCES tests (id),
    CONSTRAINT fk_attempt_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE attempt_answer (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attempt_id BIGINT NOT NULL,
    question_id BIGINT NOT NULL,
    selected_answer_ids VARCHAR(255),
    text_answer VARCHAR(4000),
    correct BOOLEAN NOT NULL,
    points_awarded INT NOT NULL,
    CONSTRAINT fk_attempt_answer_attempt FOREIGN KEY (attempt_id) REFERENCES attempt (id),
    CONSTRAINT fk_attempt_answer_question FOREIGN KEY (question_id) REFERENCES question (id)
);

CREATE TABLE ai_usage (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    operation VARCHAR(255),
    model VARCHAR(255),
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    estimated_cost DECIMAL(38, 2),
    created_at DATETIME(6),
    CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users (id)
);
