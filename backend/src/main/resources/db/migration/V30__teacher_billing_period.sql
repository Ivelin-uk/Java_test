ALTER TABLE teacher_billing_accounts
 ADD COLUMN billing_period VARCHAR(10);

UPDATE teacher_billing_accounts a
 SET billing_period=(
  SELECT r.billing_period FROM teacher_checkout_requests r
  WHERE r.user_id=a.user_id AND r.status='complete'
  ORDER BY r.created_at DESC LIMIT 1
 )
 WHERE a.paid_through IS NOT NULL
 AND EXISTS(SELECT 1 FROM teacher_checkout_requests r WHERE r.user_id=a.user_id AND r.status='complete');
