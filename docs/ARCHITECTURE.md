# QuickTest Architecture

## Product Decision

The MVP is a test management platform first, with AI as a helper engine. The fastest valuable path is:

Creator registers -> creates or generates draft -> edits questions -> publishes -> shares link -> participant submits -> creator sees results.

## Backend Modules

- `auth`: users, password hashing, bearer token sessions.
- `tests`: tests, questions, answers, publishing, owned-test deletion, public attempts, scoring, result views.
- `ai`: provider abstraction, OpenAI Responses API with structured JSON validation, usage tracking, an explicitly selected mock for automated tests.
- `dashboard`: creator metrics.
- `demo`: local seed data.

Controllers only handle HTTP mapping and validation. Business rules live in services. Repositories are Spring Data JPA interfaces.

## Database Schema

Development uses the MySQL `test_ai` database at `localhost:8889` (MAMP or the Compose service). Flyway applies versioned SQL migrations from `backend/src/main/resources/db/migration` before JPA validates the schema with `ddl-auto=validate`. Tests run the same migrations against an in-memory H2 database in MySQL compatibility mode.

When `DEMO_SEED=true` (the default), the transactional demo runner creates only four verified local accounts: one administrator, one teacher and two students. It records completion in `demo_seed_history` without creating sessions, tests, groups, assignments, attempts, results or messages. Existing accounts are not overwritten, and repeated starts preserve user edits, content and deletions. The workspace bootstrap ensures required system plans independently of demo accounts. Set `DEMO_SEED=false` for environments that should not receive demo identities; startup never deletes existing data to enforce the demo baseline.

Owned-test deletion removes attempts and submitted answers before cascading to questions and answer choices, within one transaction. Ownership is checked before any deletion; another user's test returns 404.

Normal AI generation calls `POST https://api.openai.com/v1/responses` with `gpt-4.1-mini` by default, `store=false`, and a strict JSON schema. The API key is read only by the backend from `OPENAI_API_KEY`. Validation checks distinct questions and correct answer choices before recording actual token usage. OpenAI API usage is separately billed; ChatGPT subscriptions are not API credit. Missing credentials, quota, refusals and incomplete responses fail visibly without publishing a test or falling back to fake generation. The Ollama implementation has been removed.

Core tables represented by entities:

- `users`: id, name, email, password_hash, role, email_verified_at, created_at, updated_at.
- `auth_token`: token, user_id, created_at.
- `tests`: id, owner_id, title, description, language, status, access_type, access_code, public_code, duration_minutes, randomization flags, result visibility flags, published_at, timestamps.
- `question`: id, test_id, type, question, difficulty, points, explanation, position.
- `answer`: id, question_id, answer, correct, position.
- `attempt`: id, test_id, user_id, participant_name, participant_email, started_at, submitted_at, score, max_score, percentage, grade.
- `attempt_answer`: id, attempt_id, question_id, selected_answer_ids, text_answer, correct, points_awarded.
- `ai_usage`: id, user_id, operation, model, input_tokens, output_tokens, estimated_cost, created_at.

## API Contracts

Authenticated creator endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/tests`
- `POST /api/tests`
- `GET /api/tests/{id}`
- `PUT /api/tests/{id}`
- `DELETE /api/tests/{id}`
- `POST /api/tests/{id}/publish`
- `GET /api/tests/results`
- `GET /api/tests/{id}/results`
- `POST /api/ai/generate-test`

Public participant endpoints:

- `GET /api/public/tests/{code}`
- `POST /api/public/tests/{code}/attempts`

## Frontend Pages

- Auth screen.
- Creator dashboard.
- Manual test builder.
- AI generation panel.
- Recent tests and result dashboard.
- Public participant quiz page at `/quiz/{code}`.
- Result screen after submit.

## Roadmap

1. Stabilize MVP: expand tests, improve validation errors, add token expiry.
2. Production auth: email verification, reset password, remember me, OAuth preparation.
3. Creator features: autosave debounce, drag/drop question ordering, QR code, export results.
4. Domain expansion: groups, participants, assignments, CSV import, question bank.
5. Paid product: Free/Pro limits, Stripe subscriptions, AI credit enforcement.
6. Operations: managed MySQL, Redis queue, transactional email provider, audit logs, rate limiting.
