# QuickTest MVP

Java Spring Boot backend + React TypeScript frontend for an AI-assisted test management platform.

## Architecture

- `backend/`: Spring Boot 4 REST API, Spring Security password hashing, JPA/MySQL database, layered controllers/services/repositories.
- Flyway applies versioned schema migrations automatically before the backend starts.
- `frontend/`: Vite React SPA with creator dashboard, manual builder, mock AI generation, publish flow, public quiz flow and results.
- AI is behind `AiProvider`; the current implementation is `MockAiProvider` so local development works without API keys.
- Credentials and external provider keys belong in environment variables. Do not commit real secrets.

## MVP Scope

Implemented now:

- Register/login with bcrypt passwords and bearer tokens.
- Dashboard stats.
- Manual test builder for single choice, multiple choice, true/false, short answer and open answer.
- AI generate test draft through an abstraction layer.
- Publish with unique `/quiz/{code}` URL.
- Public participant test taking.
- Automatic scoring and Bulgarian 2-6 grade scale.
- Creator results table.
- AI usage tracking.

Next production steps:

- Configure production database credentials and disable demo seeding.
- Add refresh/expiry to auth tokens or use signed JWT/session cookies.
- Add rate limiting, CSRF strategy for cookie auth, email verification and password reset.
- Add Groups, Assignments, Question Bank, Stripe and real AI provider.

## Local Development

Backend:

```bash
docker compose up -d mysql
cd backend
./gradlew bootRun
```

The default local connection is `jdbc:mysql://localhost:3306/test_ai` with username and password `quicktest`. Override it through `DATABASE_URL`, `DATABASE_USERNAME`, and `DATABASE_PASSWORD`.

On startup, the backend creates `test_ai` if the MySQL user has permission, applies migrations from `backend/src/main/resources/db/migration`, and validates the JPA mappings. Flyway records applied migrations in `flyway_schema_history`; subsequent starts only apply new migrations.

If using the locally installed MySQL on this Mac instead of Docker, start it with `brew services start mysql`. Grant the application user access once as a MySQL administrator:

```sql
GRANT ALL PRIVILEGES ON test_ai.* TO 'quicktest'@'localhost';
```

The Compose database name is also `test_ai`. An existing Docker volume keeps its original databases and grants; for an older volume, create `test_ai` and grant `quicktest` access as the MySQL administrator before starting the backend.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Demo credentials are prefilled in the UI. Demo seeding is enabled by default and fills every application table:

- Three accounts: `demo@quicktest.local`, `teacher@quicktest.local`, and `student@quicktest.local`, all with password `password123`.
- Four tests: three published tests and one draft, covering all five question types.
- Six submitted attempts with scored answers and grades, two AI usage records, and a randomly generated session for each demo account.
- Public quizzes: `/quiz/demojava`, `/quiz/demosql`, and `/quiz/democollections`.

Repeated starts reuse demo accounts and stable test codes, preserving edited names, passwords, titles, and existing results without duplicating them. Open answers are seeded as awaiting manual grading, matching the normal scoring workflow. Set `DEMO_SEED=false` in the backend's environment to disable demo data:

```bash
DEMO_SEED=false ./gradlew bootRun
```

## API Contracts

Core endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/dashboard`
- `GET /api/tests`
- `POST /api/tests`
- `PUT /api/tests/{id}`
- `POST /api/tests/{id}/publish`
- `POST /api/ai/generate-test`
- `GET /api/public/tests/{code}`
- `POST /api/public/tests/{code}/attempts`
- `GET /api/tests/results`

Authenticated creator endpoints require:

```http
Authorization: Bearer <token>
```
# Java_test
