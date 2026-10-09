# Operations

## Environments

Development: MAMP on 8889, schema `test_ai`, localhost 8080/5173, seeded demo identities, local mail, OpenAI API configured with backend-only `OPENAI_API_KEY`. Manual test creation works without AI credentials.

The local demo baseline is exactly four accounts (`admin@quicktest.local`, `teacher@quicktest.local`, `student@quicktest.local`, `student2@quicktest.local`), with no learning content or assignments. Seeding is one-time and non-destructive: it does not purge existing accounts or user-created content on startup. Resetting an existing local database is a separate, explicit operation requiring a private backup and stopped application writes; never apply a demo cleanup to a production or restored production database. System plans, permissions and Flyway history are required infrastructure, not demo content.

Verification: separate `examai_verification` schema, disposable `example.test` identities, disabled demo seed, fake/stub providers, no external student mail. HTTP load tests refuse the application schema. E2E tests create their own marked organizations on the explicitly configured local server; use a separate backend/database for repeatable CI isolation.

Production preparation: separate database and application credentials, HTTPS reverse proxy, secure OAuth state cookies, disabled demos/legacy/local fixtures/local mailbox, configured real email and AI, protected secrets/backups and institution-approved retention. `SPRING_PROFILES_ACTIVE=production` activates fail-closed demo/configuration checks. Stripe remains test-only; this project has no approved live payment mode. No public deployment was performed.

## Backup And Restore

Before schema upgrades or retention, stop writes or use a consistent InnoDB dump. Backup files contain identities, answer evidence, session credentials and delivery tokens. Keep them private and encrypted, outside git; do not share them as test fixtures.

```bash
DATABASE_PASSWORD=quicktest DATABASE_USERNAME=quicktest \
MYSQLDUMP_BIN=/Applications/MAMP/Library/bin/mysql57/bin/mysqldump \
./scripts/backup-db.sh
```

Defaults: 127.0.0.1:8889, schema `test_ai`, private `.local/backups/` destination with umask 077. Override MYSQL_HOST/PORT/DATABASE for another environment. The script refuses to overwrite a backup.

Restore rehearsal should use a NEW empty schema and an account authorized for that schema, never the active application database. Stop the backend before an actual restore and create a fresh backup first. The script requires a typed database confirmation and rejects dumps containing CREATE DATABASE/USE commands so the target cannot silently change:

```bash
MYSQL_DATABASE=examai_restore_check CONFIRM_DATABASE_RESTORE=examai_restore_check \
DATABASE_USERNAME=root DATABASE_PASSWORD=root \
MYSQL_BIN=/Applications/MAMP/Library/bin/mysql57/bin/mysql \
./scripts/restore-db.sh .local/backups/your-backup.sql
```

Create the empty target beforehand. After restore, validate Flyway checksums, row counts, organization isolation, result revision/outbox counts and private files. Do not run seed against a restored production copy; keep external delivery disabled. Never use `flyway clean`, history deletion or a database-volume deletion as a repair procedure.

## Retention

The organization administrator configures and explicitly approves a duration of 30-36500 days. Preview reports the cutoff and eligible finalized/voided attempts. Execution requires current password, reason, confirmation and idempotency key. Unreviewed/active attempts are not eligible; processing email deliveries block the operation.

The transaction removes old answer/event/revision/result-mail content and retains a minimal attempt tombstone, preserving attempt numbers and consumed limits. Every run is audited. This is controlled content deletion, not irreversible global-identity anonymization, nor an assertion of institutional compliance. The organization must approve separate retention for profiles, messages, security audit and backups before real use. No scheduled automatic deletion is enabled.

## Monitoring

Organization admins can inspect `/api/v1/metrics`, audit records, AI job status and notification deliveries. Metrics include active attempts, overdue open questions, pending reviews, queued/failed/uncertain mail and job counts/oldest creation time. Investigate overdue work, growing queue age, failed schema validation and unknown mail delivery before retrying.

Deadlines, AI, realtime and outbox run in the embedded scheduler (`WORKSPACE_WORKERS=true`, pool 4). Restart preserves persisted work; abandoned AI jobs fail without silent repeated inference, and unknown mail delivery is never blindly resent. The local topology is one application instance. Production process health checks, metrics collection/alerting, distributed worker topology and restore drills need deployment verification.

Do not log OAuth codes/tokens, passwords, access/invitation codes, private answer content or complete webhook/request bodies. Keep debug/request-body logging disabled. Browser Bearer tokens are in localStorage; a restrictive production CSP and security review are needed before handling real institutional data. User input is rendered as text; uploaded SVG/HTML are rejected and student code is never executed.
