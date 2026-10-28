CREATE TABLE teacher_plan_overrides (
    user_id BIGINT PRIMARY KEY,
    plan VARCHAR(10) NOT NULL,
    updated_by BIGINT NULL,
    updated_at DATETIME(6) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE teacher_admin_billing_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id BIGINT NULL,
    request_key VARCHAR(80) NOT NULL,
    user_id BIGINT NOT NULL,
    action VARCHAR(20) NOT NULL,
    requested_plan VARCHAR(10) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE (actor_id, request_key),
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE teacher_payment_history (
    invoice_id VARCHAR(190) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    event_id VARCHAR(190) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    payment_status VARCHAR(20) NOT NULL,
    billing_period VARCHAR(10) NOT NULL,
    amount_due BIGINT NOT NULL,
    amount_paid BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL,
    payment_at DATETIME(6) NOT NULL,
    period_start DATETIME(6),
    period_end DATETIME(6),
    provider_event_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX ix_teacher_payment_history_user_date ON teacher_payment_history(user_id, payment_at);
