# QuickTest MVP

Java Spring Boot backend + React TypeScript frontend for an AI-assisted test management platform.

## Architecture

- `backend/`: Spring Boot 4 REST API, Spring Security password hashing, JPA/MySQL database, layered controllers/services/repositories.
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

- Replace JPA `ddl-auto` with Flyway migrations.
- Add production-ready Flyway migrations and database credentials.
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

The default local connection is `jdbc:mysql://localhost:3306/quicktest` with username and password `quicktest`. Override it through `DATABASE_URL`, `DATABASE_USERNAME`, and `DATABASE_PASSWORD`.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Demo credentials are prefilled in the UI. If demo seed is enabled, the backend also creates:

- Email: `demo@quicktest.local`
- Password: `password123`

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
