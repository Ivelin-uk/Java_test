# QuickTest MVP

Java Spring Boot backend + React TypeScript frontend for an AI-assisted test management platform.

## Architecture

- `backend/`: Spring Boot 4 REST API, Spring Security password hashing, JPA/MySQL database, layered controllers/services/repositories.
- Flyway applies versioned schema migrations automatically before the backend starts.
- `frontend/`: Vite React SPA with creator dashboard, manual builder, local AI generation, deletion with confirmation, publish flow, public quiz flow and results.
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
- Public participant test taking.
- Automatic scoring and Bulgarian 2-6 grade scale.
- Creator results table.
- AI usage tracking.

Next production steps:

- Configure production database credentials and disable demo seeding.
- Add refresh/expiry to auth tokens or use signed JWT/session cookies.
- Add rate limiting, CSRF strategy for cookie auth, email verification and password reset.
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

Demo credentials are prefilled in the UI. Demo seeding is enabled by default and fills every application table:

- Three accounts: `demo@quicktest.local`, `teacher@quicktest.local`, and `student@quicktest.local`, all with password `password123`.
- Four tests: three published tests and one draft, covering all five question types.
- Six submitted attempts with scored answers and grades, two AI usage records, and a randomly generated session for each demo account.
- Public quizzes: `/quiz/demojava`, `/quiz/demosql`, and `/quiz/democollections`.

Demo fixtures are generated offline and recorded once in `demo_seed_history`. Repeated starts preserve edits and do not recreate deleted demo tests. Demo AI history is marked as `mock-ai-provider`; user-triggered generation uses the real configured model. Open answers are seeded as awaiting manual grading, matching the normal scoring workflow. Set `DEMO_SEED=false` in the backend's environment to disable demo data:

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
- `DELETE /api/tests/{id}` (204 on success, 404 for missing or another user's test)
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
