# Integration Runbook

## Safety Defaults

No live Stripe keys are accepted. Demo seeds never send external student mail. The SMTP adapter permits only explicitly configured recipient domains; the defaults are `example.test`, `quicktest.local`, `examai.local`. Provider credentials stay in server environment variables or ignored local configuration, never `VITE_*` values. Local fixtures and fake AI are not evidence of external-provider verification.

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

For local development, run `bash scripts/configure-google.sh` after creating the Web application OAuth client. It prompts for Client ID and a hidden Client Secret, validates them, and atomically saves `.local/google.properties` with mode `600`. The backend imports the ignored file from either working directory; environment variables take precedence. Restart the backend after setup. A Gmail App Password is for SMTP only, not Google sign-in. The registration button uses the official [Google G asset and localized button text](https://developers.google.com/identity/branding-guidelines).

Both login and registration offer Google. The UI starts `/api/auth/google/redirect` without assigning a default role. A new account uses Google's verified email/name and returns `roleSelectionRequired=true`; a shared first-registration screen asks for teacher/assistant or pupil/student before workspace access. `/api/auth/role` saves the choice once and rejects changes for already configured profiles. Pending selection survives reloads and later sign-ins. The redirect still accepts an explicit `role=STUDENT` or `role=TEACHER` for API compatibility and validates it in the OAuth session. Existing identities keep their current role, including when linked from a local profile. Public Google registration cannot create an administrator. Local name/password fields are not submitted to Google. A single frontend handler exchanges the one-use handoff, including under React StrictMode, and removes it from the address bar before the exchange.

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

For Gmail / Google Workspace, enable [2-Step Verification and create an App Password](https://support.google.com/accounts/answer/185833), then run `bash scripts/configure-gmail.sh` from the repository root. It prompts for the sender, hidden App Password and allowed recipient domains, writes `.local/mail.properties` atomically with mode `600`, and preserves the separate AI configuration. The backend imports this ignored file from either the repository or backend directory; environment variables take precedence. The setup uses [smtp.gmail.com on port 587 with STARTTLS](https://support.google.com/a/answer/176600), requires TLS, verifies the server identity and checks SMTP authentication at startup. Restart after configuration. `SMTP_TEST_CONNECTION=false` disables the startup connection check when explicitly needed.

Use real, verified recipient addresses. `@quicktest.local` demo addresses cannot receive internet email. The generated email uses `FRONTEND_URL`; recipients on other devices need an address that resolves to this application from their network. Existing `sent`/`uncertain` records are not replayed when switching adapters. Local unit/integration tests disable local credential imports and real SMTP connections; a real Gmail delivery still needs the account credentials and an actual recipient.

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

Verification, recovery and invitation links are single-use and expiring. Invites and access-code checks use hashes. Assignments also store the current access code for display to authorized teachers; revocation clears both values. Display codes and delivery payloads must be treated as private data, including backups. Do not enable local mailbox mode in production.

## Workers And AI

`WORKSPACE_WORKERS=true` runs deadline (1 second), AI (1 second), outbox (2 seconds) workers in a four-thread scheduler. Work is persisted in MySQL; there is no external Redis dependency. Question deadlines and assignment windows are authoritative UTC times. No browser heartbeat grants extra time.

AI and SMTP calls run outside the claim transaction. AI completion is bound to its processing generation, so a stale provider response cannot complete a retried job. Abandoned AI work becomes failed and releases its reservation; the teacher chooses whether to retry. A completed job is only a validated draft. Model/type/difficulty failures cannot publish it. See README for the OpenAI Responses API and the explicitly fake `mock` adapter. Credentials stay on the backend; never send them from the browser or include them in job JSON. Upstream error bodies and refusal text are not exposed to the browser.

This setup is tested as one local application instance, not a multi-region scheduler or a distributed delivery guarantee. Before scaling, verify worker ownership, leases, idempotency, queue age and database locking under the deployed topology.
