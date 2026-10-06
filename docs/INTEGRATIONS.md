# Integration Runbook

## Safety Defaults

No live Stripe keys are accepted. Demo seeds never send external student mail. The SMTP adapter permits only explicitly configured recipient domains; the defaults are `example.test`, `quicktest.local`, `examai.local`. Provider credentials are server-only environment variables, never `VITE_*` values. Local fixtures and fake AI are not evidence of external-provider verification.

## Google OIDC

Create a Web Application OAuth client, configure a consent screen and test users, and set:

```dotenv
GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BACKEND_URL=http://localhost:8080
FRONTEND_URL=http://localhost:5173
```

Authorized redirect URI: `http://localhost:8080/login/oauth2/code/google` (Compose: port `8082`). Frontend origin: port `5173` (Compose `5174`). The application uses Spring Security's standard OIDC authorization-code flow, session-bound state and nonce. OAuth state cookies are HttpOnly, SameSite=Lax; set `SECURE_COOKIES=true` with HTTPS. The ordinary API still requires Bearer authentication.

Google identity is keyed by `(provider, subject)`. Matching a local email never merges an account. Linking starts from an authenticated profile, requires the local password again, a short-lived single-use link ticket bound to the original session, and Google authentication. A short-lived handoff in the URL fragment is exchanged once for an application session; Google tokens are not stored. Account deactivation and session revocation remain effective at callback time. A linked Google user can establish a local password through verified-email recovery.

The Google email and notification email are separate. Changing the notification address preserves the existing verified address until the new one is verified. Google client configuration and a real consent/callback test are still required. Reference: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Stripe Test

Use only test-mode products/prices and keys:

```dotenv
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
BILLING_FIXTURES=false
```

Map test `price_*` IDs to each plan's month/year prices in the platform plan editor. Enable the test customer portal with approved test plans and invoices. The organization administrator initiates Checkout; an existing Stripe subscription is managed through its server-authorized customer portal, including cancellation and payment documents. No card data is stored by ExamAI.

Forward webhooks locally using the Stripe CLI:

```bash
stripe listen --forward-to http://localhost:8080/api/v1/billing/webhook
```

Configure the returned `whsec_*` in the backend environment and restart it. Supported events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. The adapter verifies the signature against the unmodified body, rejects live events, deduplicates event IDs, checks the checkout's server-owned organization metadata, locks the organization and retrieves current provider state rather than trusting event order. Only known test price mappings and one automatic-charge organizational subscription are accepted. A success-page redirect has no activation endpoint.

Exercise creation, duplicate delivery, same-second events, delayed older updates, past_due, downgrade and cancellation. Verify that cancellation preserves paid access through the stored interval, downgrade never deletes data, and expiration does not prevent completing/reviewing an existing attempt. [Webhooks](https://docs.stripe.com/webhooks), [subscription object](https://docs.stripe.com/api/subscriptions/object), [customer portal](https://docs.stripe.com/api/customer_portal/sessions/create).

Without keys, `BILLING_FIXTURES=true` enables an explicitly labeled **local test fixture** endpoint for the platform administrator only. It is disabled when Stripe is configured and refused by the production guard. Example body for `/api/v1/platform/organizations/{id}/billing-fixtures`:

```json
{"eventId":"local-fixture-unique-id","providerTimestamp":1,"snapshot":{"planId":1,"status":"active","periodStart":"2026-10-06T00:00:00Z","paidThrough":"2026-11-06T00:00:00Z","cancelAtPeriodEnd":false}}
```

Use actual IDs from your own demo database. Fixture ordering/signature-unit tests are checked, but do not prove real Stripe delivery. Live payment support is deliberately unavailable.

## SMTP And Mail Catcher

`MAIL_ADAPTER=local` uses an authenticated application mailbox and never connects to SMTP. For a real local SMTP test, run the Compose Mailpit service and use:

```dotenv
MAIL_ADAPTER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_AUTH=false
SMTP_TLS=false
MAIL_FROM=examai@example.test
MAIL_ALLOWED_DOMAINS=example.test,quicktest.local,examai.local
```

Compose already addresses Mailpit by its internal service name. Its web UI is exposed only on localhost port `8025`, and SMTP only on localhost `1025` (`COMPOSE_SMTP_PORT` can change it). Keep the recipient allowlist restricted during testing. For a production provider, configure host, port, authentication, TLS and an approved real-recipient allowlist separately.

Result revisions and unique outbox records commit together. The worker claims committed entries, sends outside its database transaction and saves the receipt. Verified pre-delivery failures receive controlled retries; timeout/unknown outcome becomes `uncertain`, never a blind automatic resend. Manual retry is limited to `failed`. A provider callback for delivered/bounced is not implemented, so the app does not claim those statuses without evidence. A mail failure never rolls back the grade.

Verification, recovery and invitation links are single-use and expiring. Invites and access codes are hashed in their authoritative access tables; delivery payloads necessarily contain mail/chat secrets and must be treated as private data, including backups. Do not enable local mailbox mode in production.

## Workers And AI

`WORKSPACE_WORKERS=true` runs deadline (1 second), AI (1 second), realtime chat (1 second) and outbox (2 seconds) workers in a four-thread scheduler. Work is persisted in MySQL; there is no external Redis dependency. Question deadlines and assignment windows are authoritative UTC times. No browser heartbeat grants extra time.

AI and SMTP calls run outside the claim transaction. AI completion is bound to its processing generation, so a stale provider response cannot complete a retried job. Abandoned AI work becomes failed and releases its reservation; the teacher chooses whether to retry. A completed job is only a validated draft. Model/type/difficulty failures cannot publish it. See README for Ollama and the explicitly fake `mock` adapter.

This setup is tested as one local application instance, not a multi-region scheduler or a distributed delivery guarantee. Before scaling, verify worker ownership, leases, idempotency, queue age and database locking under the deployed topology.
