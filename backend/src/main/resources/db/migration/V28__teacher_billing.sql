CREATE TABLE teacher_billing_accounts (
 user_id BIGINT PRIMARY KEY, workspace_id BIGINT NOT NULL UNIQUE,
 stripe_customer_id VARCHAR(190) UNIQUE, stripe_subscription_id VARCHAR(190) UNIQUE,
 provider_status VARCHAR(30) NOT NULL DEFAULT 'free', stripe_mode VARCHAR(10) NOT NULL,
 paid_through DATETIME(6), cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at DATETIME(6) NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE TABLE teacher_checkout_requests (
 user_id BIGINT NOT NULL, request_key VARCHAR(80) NOT NULL, billing_period VARCHAR(10) NOT NULL,
 price_id VARCHAR(190) NOT NULL, session_id VARCHAR(190) UNIQUE, checkout_url TEXT,
 status VARCHAR(20) NOT NULL DEFAULT 'pending', created_at DATETIME(6) NOT NULL,
 PRIMARY KEY(user_id,request_key), FOREIGN KEY(user_id) REFERENCES teacher_billing_accounts(user_id) ON DELETE CASCADE
);
CREATE TABLE teacher_billing_events (
 event_id VARCHAR(190) PRIMARY KEY, user_id BIGINT NOT NULL, event_type VARCHAR(80) NOT NULL,
 provider_timestamp BIGINT NOT NULL, created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(user_id) REFERENCES teacher_billing_accounts(user_id) ON DELETE CASCADE
);
