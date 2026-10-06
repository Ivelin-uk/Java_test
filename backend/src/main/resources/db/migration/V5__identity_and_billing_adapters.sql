CREATE TABLE external_identities (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, provider VARCHAR(30) NOT NULL,
 subject VARCHAR(190) NOT NULL, linked_at DATETIME(6) NOT NULL,
 UNIQUE(provider,subject), UNIQUE(user_id,provider), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE organization_plan_prices (
 plan_id BIGINT NOT NULL, billing_period VARCHAR(10) NOT NULL, stripe_price_id VARCHAR(190) NOT NULL UNIQUE,
 PRIMARY KEY(plan_id,billing_period), FOREIGN KEY(plan_id) REFERENCES organization_plans(id)
);
CREATE TABLE stripe_checkout_requests (
 request_key VARCHAR(80) PRIMARY KEY, organization_id BIGINT NOT NULL, plan_id BIGINT NOT NULL,
 billing_period VARCHAR(10) NOT NULL, session_id VARCHAR(190), created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(plan_id) REFERENCES organization_plans(id)
);
CREATE TABLE stripe_subscription_bindings (
 organization_id BIGINT PRIMARY KEY, subscription_id VARCHAR(190) NOT NULL UNIQUE,
 customer_id VARCHAR(190) NOT NULL, latest_event_created BIGINT NOT NULL DEFAULT 0,
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
ALTER TABLE identity_challenges ADD COLUMN auth_session_hash VARCHAR(64);
ALTER TABLE notification_outbox ADD COLUMN provider_message_id VARCHAR(190);
ALTER TABLE workspace_messages ADD UNIQUE(organization_id,id);
CREATE TABLE message_blocks (
 organization_id BIGINT NOT NULL, user_id BIGINT NOT NULL, blocked_user_id BIGINT NOT NULL,
 PRIMARY KEY(organization_id,user_id,blocked_user_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,blocked_user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE message_reports (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT NOT NULL, message_id BIGINT NOT NULL,
 reporter_id BIGINT NOT NULL, reason TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'open', created_at DATETIME(6) NOT NULL,
 FOREIGN KEY(organization_id,message_id) REFERENCES workspace_messages(organization_id,id),
 FOREIGN KEY(organization_id,reporter_id) REFERENCES memberships(organization_id,user_id)
);
