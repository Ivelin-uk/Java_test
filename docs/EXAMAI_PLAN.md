# ExamAI Implementation Contract

The existing Spring Boot 4 / Java 21 / React / MySQL stack is retained. Applied
Flyway migrations and existing user data are not rewritten. New tenant-scoped
modules use `/api/v1`; the unscoped legacy assessment API is disabled by default.

## Order of Work

1. Organizations, memberships, expiring invitations, groups and verified email.
2. Immutable assessment versions, recipient snapshots and server-timed attempts.
3. Manual review, immutable result revisions and transactional notification outbox.
4. Tenant chat, persistent AI jobs, organization plans and integration adapters.
5. Transaction/concurrency tests, browser checks, load measurements and runbooks.

## Data Model

`users` and bearer sessions remain global identity records. `organizations` owns
`memberships`, invitations, groups, assessments, versions, assignments, attempts,
results, messages and audit records. Composite foreign keys include the organization
ID when connecting tenant-owned records. An organization header is a selector,
not authorization: every request resolves an active membership on the server.

An assessment holds an editable definition; publishing copies it to an immutable
version. An assignment references that version and snapshots its recipients.
An attempt copies question/option order and the private scoring keys, and owns
one question state machine at a time. A server-generated open-instance ID binds
answers and telemetry to that question. No private question definition is returned
from the student state endpoint. Grading creates a versioned result and an outbox
record in one transaction, independently of email delivery.

The platform administrator is not automatically a teacher or an academic-content
reader. Organization administration and teaching are separate membership roles.
Subscription expiration blocks new assignments and starts, not completion or review.

## Acceptance Checklist

The authoritative specification is the user's ExamAI v1.0, 6 October 2026.
The final verification report must mark each item checked, pending or external.

1. Cross-organization access denied, including forged IDs and realtime channels.
2. Students cannot teach or read another student's attempt.
3. Invitations are expiring, role-bound and single-use.
4. Google identity linking and notification-email verification resist takeover.
5. Assignment group/individual recipients are deduplicated.
6. Codes require recipient access and guessing is rate-limited.
7. Concurrent starts cannot duplicate an attempt or exceed its limit.
8. Answers are accepted strictly before the server deadline, never at it.
9. Correct drafts do not score when a question times out.
10. Hiding an active question invalidates it; the next waits for readiness.
11. Duplicate/stale fullscreen and visibility events do not affect another question.
12. Blur alone and events after submission do not invalidate answers.
13. A worker enforces deadlines even without an open browser.
14. A second exam session is rejected; authorized transfer revokes the old session.
15. Later edits cannot change assigned versions or attempt snapshots.
16. Student payloads contain no premature answers, explanations or criteria.
17. Unreviewed manual answers block publication; overrides require reasons.
18. Duplicate publication creates one revision/outbox; mail failure keeps the result.
19. Corrections retain history and create another notification.
20. Invalid/failed/retried AI jobs never publish or double-charge quota.
21. Quotas and subscription expiration preserve existing history.
22. Duplicate/out-of-order payment events cannot grant an incorrect subscription.
23. An active exam blocks new chat content across the account's sessions.
24. Failed fullscreen consumes no attempt; accommodations are explicit and audited.
25. Exact grade boundaries are 50, 60, 75 and 90 percent.

## External Verification

No live payments, public deployment or real student mail are authorized. Missing
Google, Stripe and SMTP credentials must be reported as unconfigured. Local mail
and billing fixtures are not evidence of real-provider verification. Fullscreen
requires a documented headed-browser check; headless simulation is insufficient.
Production retention periods need institutional approval before deployment.
