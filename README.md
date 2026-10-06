# QuickTest MVP

Java Spring Boot backend + React TypeScript frontend for an AI-assisted test management platform.

## Architecture

- `backend/`: Spring Boot 4 REST API, Spring Security bearer authentication and method authorization, JPA/MySQL database, layered controllers/services/repositories.
- Flyway applies versioned schema migrations automatically before the backend starts.
- `frontend/`: Vite React SPA with administrator, teacher and student views, manual builder, local AI generation, deletion with confirmation, authenticated quiz flow and results.
- AI is behind `AiProvider`; the default `OllamaAiProvider` makes HTTP requests to a local Qwen3 model, with no API key or per-request charge.
- Credentials and external provider keys belong in environment variables. Do not commit real secrets.

## MVP Scope

Implemented now:

- Register/login with bcrypt passwords and bearer tokens.
- Dashboard stats.
- Manual test builder for single choice, multiple choice, true/false, short answer and open answer.
- AI generate test draft through an abstraction layer.
- Delete owned draft or published tests, including their questions, submitted answers, and results.
- Publish with unique `/quiz/{code}` URL.
- Signed-in participant test taking with attempts linked to the account.
- Automatic scoring and Bulgarian 2-6 grade scale.
- Creator results table.
- AI usage tracking.
- Three roles: `ADMIN`, `TEACHER`, `STUDENT`. New registrations are always students.
- Administrator table of all controllers and mapped methods, with independent teacher/student access and subscription requirements.
- Administrator user creation, role/email changes, activation/deactivation and temporary password resets; own password changes.
- Paid subscription status, payment-record timestamp and expiry date, managed by administrators.
- Administrator audit log and protection of the last active administrator.

Next production steps:

- Configure production database credentials and disable demo seeding.
- Add refresh/expiry to auth tokens or use signed JWT/session cookies.
- Add rate limiting, CSRF strategy for cookie auth, email verification and self-service recovery through verified email.
- Add Groups, Assignments, Question Bank and Stripe.

## Local Development

AI model (one-time setup on this Mac):

```bash
brew install ollama
brew services start ollama
ollama pull qwen3:4b
```

The model download is approximately 2.5 GB. Ollama runs at `http://localhost:11434`; `brew services start ollama` keeps it running in the background. Model requests run locally on the computer. Configuration can be overridden with `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and `OLLAMA_TIMEOUT_SECONDS` (default 180 seconds).

The generation endpoint accepts 1-20 questions, a topic, language, instructions, and difficulty. It requests a structured JSON response, validates the answer choices, and stores the model's actual token counts with zero API cost. A stopped Ollama server or missing model produces an error that is shown in the application. Automated tests select `AI_PROVIDER=mock` and verify the real HTTP adapter with a stub server.

Backend:

Start MySQL in MAMP on port `8889`, then run:

```bash
cd backend
./gradlew bootRun
```

The default local connection is `jdbc:mysql://localhost:8889/test_ai` with username and password `quicktest`. Override it through `DATABASE_URL`, `DATABASE_USERNAME`, and `DATABASE_PASSWORD`.

On startup, the backend creates `test_ai` if the MySQL user has permission, applies migrations from `backend/src/main/resources/db/migration`, and validates the JPA mappings. Flyway records applied migrations in `flyway_schema_history`; subsequent starts only apply new migrations.

Create the application user and grant access once as a MySQL administrator on port `8889`:

```sql
CREATE USER IF NOT EXISTS 'quicktest'@'localhost' IDENTIFIED BY 'quicktest';
GRANT ALL PRIVILEGES ON test_ai.* TO 'quicktest'@'localhost';
```

Alternatively, run `docker compose up -d mysql` from the project root to provision MySQL and the application user. Compose also exposes MySQL on host port `8889`, so stop MAMP MySQL before using that service. The Compose database name is `test_ai`. An existing Docker volume keeps its original databases and grants; for an older volume, create `test_ai` and grant `quicktest` access as the MySQL administrator before starting the backend.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Demo credentials are prefilled in the UI. Demo seeding is enabled by default:

- Four accounts, all with password `password123`: `admin@quicktest.local` (`ADMIN`), `demo@quicktest.local` and `teacher@quicktest.local` (`TEACHER`), `student@quicktest.local` (`STUDENT`).
- Demo subscriptions are paid for 30 days from initial seeding. Restarting does not extend them.
- Four tests: three published tests and one draft, covering all five question types.
- Six submitted attempts with scored answers and grades, two AI usage records, and a randomly generated session for each demo account.
- Published quizzes: `/quiz/demojava`, `/quiz/demosql`, and `/quiz/democollections`; login is required.

Demo fixtures are generated offline and recorded once in `demo_seed_history`. Repeated starts preserve edits and do not recreate deleted demo tests. Demo AI history is marked as `mock-ai-provider`; user-triggered generation uses the real configured model. Open answers are seeded as awaiting manual grading, matching the normal scoring workflow. Set `DEMO_SEED=false` in the backend's environment to disable demo data:

```bash
DEMO_SEED=false ./gradlew bootRun
```

## API Contracts

### Administration and Access

Open the app and sign in as `admin@quicktest.local` / `password123`. The administration view contains Users, Permissions and Audit tabs. Administrators have access to all tests and results, including tests owned by other users. Teachers can manage their own tests; students see published tests and their own results. Granting a student creator methods permits creating their own tests, but never grants access to another user's private tests.

The Permissions table is generated from the actual Spring controller mappings. Each managed method has separate Access and Subscription checkboxes for teachers and students. Changes take effect on the next API request. The backend rejects methods without a declared authorization policy during startup. Administrator endpoints cannot be delegated, and login/profile/password endpoints cannot be disabled through this table.

AI generation requires an active paid subscription for teachers by default. Other methods do not require one unless configured. Administrators bypass subscription requirements. A subscription is active only when marked paid and its expiry is today or later in `Europe/Sofia` (`SUBSCRIPTION_ZONE` override); the expiry date is inclusive. This records administrator-confirmed payments, not payment-provider verification or automatic billing.

Changing a user's email/role/active status, resetting a password or changing one's own password revokes that user's existing tokens. Temporary passwords are securely random and shown only in the reset/create response. Users with a temporary password must change it before accessing any other protected feature. Existing passwords cannot be recovered; email recovery means an administrator assigns a replacement email. No emails are sent by this application.

Migration V3 preserves existing tests/results and maps legacy `USER` accounts to teachers, the demo student to `STUDENT`, and the demo teacher to `TEACHER`. It adds the subscription fields, endpoint permissions and audit tables. Demo administrator creation has its own one-time seed marker. With `DEMO_SEED=false`, provision the first administrator through a trusted database administrator after registering a regular account; production must not use demo credentials.

After a test has submitted attempts, metadata can still be edited, but question changes return 409 to preserve historical answers/results. Create a new test for changed questions.

Administrator endpoints:

- `GET /api/admin/users`
- `POST /api/admin/users` (returns a temporary password)
- `PUT /api/admin/users/{id}`
- `POST /api/admin/users/{id}/reset-password`
- `GET /api/admin/permissions`
- `PUT /api/admin/permissions` (`changes`: array of `key`, `role`, `allowed`, `subscriptionRequired`)
- `GET /api/admin/audit` (most recent 200 events)
- `GET /api/student/tests`
- `GET /api/student/results`
- `GET /api/auth/me` (role, account/subscription status and allowed methods)
- `POST /api/auth/password` (`currentPassword`, `newPassword`)
- `POST /api/auth/logout`

Core endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/dashboard`
- `GET /api/tests`
- `POST /api/tests`
- `PUT /api/tests/{id}`
- `DELETE /api/tests/{id}` (204 on success, 404 for missing or another user's test)
- `POST /api/tests/{id}/publish`
- `POST /api/ai/generate-test`
- `GET /api/public/tests/{code}`
- `POST /api/public/tests/{code}/attempts`
- `GET /api/tests/results`

All API endpoints except login and registration require:

```http
Authorization: Bearer <token>
```

## Verification

```bash
cd backend
./gradlew test
```

```bash
cd frontend
npm run build
npm run lint
```

Backend tests cover role injection, method permissions, immutable admin policies, session revocation, forced password changes, email recovery, paid/expired subscriptions, last-administrator protection, cross-owner administration and student data isolation. Tests use an H2 database and mock AI; they do not change the local MySQL data or call the model.
