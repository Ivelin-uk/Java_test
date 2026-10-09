# Data Model And Architecture

Current model (2026-10-08): accounts register directly as teachers or students. `personal_workspaces` automatically maps each account to an internal namespace. The organization and membership tables remain for composite foreign keys and historical data; users never create/select schools or join institutional memberships. Account-wide lists filter by ownership/sharing or assigned student, while resource IDs resolve the original namespace. Teacher-to-student assignment is allowed between any active registered profiles. V13 preserves historical content and promotes existing teaching memberships to the global TEACHER role.

V15 adds `assessment_library_removals` for persistent per-user removal of shared tests from the library. Removing a shared test does not change its ownership or sharing. Archived owned tests are excluded from library lists; their published versions, assignments and results remain available to authorized participants.

V16 removes `school_year`, `class_label` and `status` from `learning_groups`. Group profiles contain only name, subject and description. Internal IDs, ownership/membership references and creation timestamps remain. A nullable `deleted_at` replaces the deletion marker without restoring previously deleted groups or removing historical assignments and results; former archived groups become ordinary groups.

The application retains Spring Boot 4 / Java 21 / MySQL and React/TypeScript. Existing identity and legacy records remain; new tenant modules use JDBC with parameterized queries, explicit transactions and structured Jackson JSON definitions. Controllers delegate mutations to module services. Flyway runs before JPA schema validation.

## ER Relationships

| Parent | Child | Relation / constraint |
|---|---|---|
| users | auth_token, external_identities, notification_addresses, identity_challenges | Global identity; unique provider+subject and user+provider |
| organizations + users | memberships | Unique organization+user; multiple membership roles |
| organization_plans | organization_subscriptions, organization_plan_prices | One current subscription per organization; unique period/price mapping |
| organizations | learning_groups, organization_invitations | Scoped group and role-bound expiring invitations |
| memberships + learning_groups | group_members, group_teachers | Composite organization-scoped foreign keys |
| memberships | workspace_assessments, question_bank_items, private_images | Scoped owner; personal/shared content |
| workspace_assessments | assessment_versions | Immutable numbered versions; unique organization+assessment+number |
| assessment_versions | exam_assignments | Version selected once; explicit teacher and time window |
| exam_assignments + memberships | assignment_recipients, assignment_teachers | Deduplicated recipient snapshot; explicit shared teacher access |
| assignment_recipients | exam_attempts | Unique numbered attempt and start key per assignment/student; unique active key |
| exam_attempts | attempt_questions, exam_events, result_revisions | Ordered private question snapshots, instance-bound telemetry, immutable revisions |
| result_revisions | notification_outbox | Unique revision+recipient+type; committed independently from delivery |
| learning_groups | workspace_conversations | Group conversation; direct conversations have null group |
| memberships + workspace_conversations | conversation_members | Scoped participants and read cursor |
| conversation_members | workspace_messages | Author must belong to the same scoped conversation |
| workspace_messages + memberships | message_reports, message_blocks | Scoped reporting, blocking and audited moderation |
| conversation_members | realtime_tickets | Hashed, single-use, short-lived ticket bound to a Bearer session |
| memberships | workspace_ai_jobs | Unique user/org request key; persistent request, result, state and processing generation |
| organizations | workspace_audit, workspace_billing_events, support_grants, tenant_endpoint_permissions, retention_runs | Scoped controls, provider idempotency and audit |
| users | profile_exam_locks | Dedicated per-profile mutex serializes exam starts |
| organizations | organization_quota_locks, organization_retention_locks | Dedicated mutex rows serialize quotas/retention without blocking foreign-key parent records |

Chat-related tables listed above are retained as historical schema only. Chat services, endpoints and group provisioning have been removed; no new chat data is created.

Tenant-owned references include `organization_id` in foreign keys. The selected `X-Organization-Id` is never authorization by itself. The server resolves current active membership, domain role and ownership/shared access for each HTTP request. A global ADMIN has no implicit academic membership.

Definitions are JSON, not executable student code. Every attached image reference is checked against scoped private storage at save/publication. Images and organization logos are stored in the database for this local implementation and therefore included in backups. Organization storage usage is checked under an organization lock.

## Attempt State Machine

`in_progress -> pending_review -> finalized`; explicit teacher invalidation uses `voided`; approved retention uses a minimal `redacted` tombstone.

Question: `pending -> open -> answered | timed_out | invalidated | unanswered`.

Opening records a server UUID, opened_at and deadline_at. Final submission is accepted only at `now < deadline`; drafts never score by themselves. A terminal question cannot reopen. Advancing makes the next question pending, without sending its text/options or starting its clock until explicit readiness. An assignment deadline closes remaining work even without a browser. All answer/event retries are instance-bound and idempotent.

A profile mutex prevents concurrent global exam starts. An attempt row lock serializes state changes; a recipient lock and unique constraints enforce attempt limits. A session hash, authenticated-session hash and browser ID bind the exam to one browser session; password reauthentication transfers it without resetting deadlines.

## Results And Delivery

Automatic and teacher points are separate. Exact-set multiple choice and normalized accepted short answers are the only automated checks beyond single/true-false. Manual questions must be reviewed. Teacher save is not publication. Publication snapshots the grade, points, scale, threshold, question evidence and override metadata in a revision. Corrections append revisions and outbox entries. Assignment summaries must use the latest finalized non-voided attempt, never an unpublished working score.

Percentage calculation uses BigDecimal; Bulgarian grade boundaries compare exact ratios before display rounding. Students can read only their own published revision, with answer details held until its assignment policy allows release.

The outbox tracks queued/processing/sent/failed/uncertain, attempts and a provider receipt. It does not assert delivered/bounced without a provider integration. AI similarly separates reservation, provider execution, schema/business validation and completion; its generation guard rejects a response from an obsolete lease.

## Migration Policy

V1-V3 preserve the previous schema and global technical administration. V4 adds tenant/exam/result/outbox/chat/AI data. V5 adds identity and billing adapters and moderation records. V6 adds permissions, support, question bank, profile mutex and realtime tickets. V7 adds private images. V8 adds controlled retention. V9 adds assignment teacher sharing. V10 adds invitation/code delivery.

V11 isolates the retention mutex; V12 isolates organization quota serialization from the foreign-key parent. Applied migration files are immutable. Add a new migration instead of rewriting or deleting history. Demo markers prevent restart from overwriting content, renewing subscriptions or recreating deleted tests. The actual current MySQL data is preserved.
