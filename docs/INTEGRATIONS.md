# Integration Runbook

## Safety Defaults

Stripe defaults to test mode; live mode requires explicit separate configuration and matching live keys, prices and webhook endpoint. The initial rollout is test-only, with prices still to be chosen. Demo seeds never send external student mail. The SMTP adapter permits only explicitly configured recipient domains; the defaults are `example.test`, `quicktest.local`, `examai.local`. Provider credentials stay in server environment variables or ignored local configuration, never `VITE_*` values. Local fixtures and fake AI are not evidence of external-provider verification.

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

For Railway, the Google credentials alone are not enough. In the backend service, set `BACKEND_URL` to its public HTTPS URL, `FRONTEND_URL` to the public HTTPS frontend origin, and `SECURE_COOKIES=true`. In the frontend service, set `VITE_API_URL` to the same backend URL **before building**; this value is embedded in the built JavaScript. Apply the variable changes with a deployment.

Open `<BACKEND_URL>/api/auth/google/config` to inspect the public `enabled`, `redirect` and `callback` values; this endpoint never exposes credentials. Copy its exact `callback` value into the Web application's **Authorized redirect URIs** in Google Cloud. The OAuth request uses this configured public callback even if Railway forwards the request to an internal HTTP address. Google requires an exact redirect URI match, including scheme, host, port and path; see [Google's web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

If sign-in still fails, use the actual error to distinguish a Google Cloud `redirect_uri_mismatch`, a disabled provider/config fetch failure, rejected client credentials, or an expired OAuth session. A frontend return to localhost indicates a missing or incorrect `FRONTEND_URL`. An existing password account must sign in with its password and link Google from Profile. Avoid a redeploy during sign-in; OAuth state lives in the backend instance's session, so multiple replicas need shared sessions or session affinity.

For local development, run `bash scripts/configure-google.sh` after creating the Web application OAuth client. It prompts for Client ID and a hidden Client Secret, validates them, and atomically saves `.local/google.properties` with mode `600`. The backend imports the ignored file from either working directory; environment variables take precedence. Restart the backend after setup. A Gmail App Password is for SMTP only, not Google sign-in. The registration button uses the official [Google G asset and localized button text](https://developers.google.com/identity/branding-guidelines).

Both login and registration offer Google. The UI starts `/api/auth/google/redirect` without assigning a default role. A new account uses Google's verified email/name and returns `roleSelectionRequired=true`; a shared first-registration screen asks for teacher/assistant or pupil/student before workspace access. `/api/auth/role` saves the choice once and rejects changes for already configured profiles. Pending selection survives reloads and later sign-ins. The redirect still accepts an explicit `role=STUDENT` or `role=TEACHER` for API compatibility and validates it in the OAuth session. Existing identities keep their current role, including when linked from a local profile. Public Google registration cannot create an administrator. Local name/password fields are not submitted to Google. A single frontend handler exchanges the one-use handoff, including under React StrictMode, and removes it from the address bar before the exchange.

Google identity is keyed by `(provider, subject)`. Matching a local email never merges an account. Linking starts from an authenticated profile, requires the local password again, a short-lived single-use link ticket bound to the original session, and Google authentication. A short-lived handoff in the URL fragment is exchanged once for an application session; Google tokens are not stored. Account deactivation and session revocation remain effective at callback time. A linked Google user can establish a local password through verified-email recovery.

The Google email and notification email are separate. Changing the notification address preserves the existing verified address until the new one is verified. Google client configuration and a real consent/callback test are still required. Reference: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Stripe Teacher Subscriptions

Free and Pro belong to an individual teacher. Students do not pay and are not billable seats. Team/school billing is outside the current integration. The complete setup, local verification and future live rollout are in [Stripe and Railway](STRIPE_RAILWAY.md).

Set only on the backend:

```dotenv
STRIPE_MODE=test
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_MONTH_PRICE_ID=
STRIPE_PRO_YEAR_PRICE_ID=
BILLING_FIXTURES=false
```

Create one Pro product with fixed monthly and yearly recurring prices in the same Stripe test environment, then set the two `price_*` IDs above. Configure Customer Portal for payment methods, invoices and cancellation at period end. No amount or currency is hard-coded. With missing keys/prices, Checkout stays unavailable. Card data is entered on Stripe's hosted page, not stored by ExamAI. [Stripe Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal).

Authenticated teachers use `GET /api/v1/billing`, `POST /api/v1/billing/checkout` and `POST /api/v1/billing/portal`. The backend chooses the customer and permits only its configured month/year prices; the browser cannot select someone else's subscription. `/billing?checkout=success` does not grant Pro. Entitlements are based on the stored, verified paid interval.

Register a public HTTPS **snapshot** endpoint at `/api/v1/billing/webhook`, API version `2026-08-26.dahlia` for the currently pinned `stripe-java:33.4.1`. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. It uses the unmodified request body and `Stripe-Signature`, without Bearer authentication. The signing secret belongs to that exact endpoint and mode. [Stripe webhooks](https://docs.stripe.com/webhooks).

Locally, run `stripe listen --forward-to http://localhost:8080/api/v1/billing/webhook`, put its returned `whsec_*` in the backend environment and restart. Compose uses port `8082`. Create the Checkout through ExamAI so its metadata and request binding exist. Repeated event IDs are deduplicated; current provider state is retrieved under an account lock so delayed and same-second events do not depend on delivery order. Paid invoice data must match the teacher's bound subscription and allowed price before extending access. A failed payment or a subscription status change alone never grants an unpaid renewal. [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).

Exercise duplicate/delayed delivery, incomplete Checkout, failed renewal, cancellation and paid-through expiry. Existing data, attempts and results survive a return to Free; create/AI limits are enforced by services. Pro has a monthly UTC AI quota even with yearly billing. Switching to live later requires `STRIPE_MODE=live` and separate matching keys/prices/webhook plus a separate database; do not mix test and live bindings. The legacy organization billing adapter and fixtures remain for compatibility/tests and are not the personal teacher checkout flow. `BILLING_FIXTURES` stays false and the production guard refuses it. Local tests do not prove real provider delivery or live charging.

## SMTP And Mail Catcher

For Gmail / Google Workspace, enable [2-Step Verification and create an App Password](https://support.google.com/accounts/answer/185833), then run `bash scripts/configure-gmail.sh` from the repository root. It prompts for the sender, hidden App Password and allowed recipient domains, writes `.local/mail.properties` atomically with mode `600`, and preserves the separate AI configuration. The backend imports this ignored file from either the repository or backend directory; environment variables take precedence. The setup uses [smtp.gmail.com on port 587 with STARTTLS](https://support.google.com/a/answer/176600), requires TLS, verifies the server identity and checks SMTP authentication at startup. Restart after configuration. `SMTP_TEST_CONNECTION=false` disables the startup connection check when explicitly needed.

Use real, verified recipient addresses. `@quicktest.local` demo addresses cannot receive internet email. The generated email uses `FRONTEND_URL`; recipients on other devices need an address that resolves to this application from their network. Switching adapters never automatically replays `sent`/`uncertain` records. An explicit teacher request can send an old local-only result notification through the configured real provider; actual provider receipts and uncertain deliveries are never replayed. Local unit/integration tests disable local credential imports and real SMTP connections; a real Gmail delivery still needs the account credentials and an actual recipient.

For Railway, use the HTTPS `resend` adapter and follow [Railway email setup](RAILWAY_EMAIL.md). `RESEND_API_KEY`, `MAIL_FROM`, `FRONTEND_URL` and recipient domain permissions belong on the backend. `MAIL_ALLOWED_DOMAINS=*` explicitly allows all recipient domains; otherwise a comma-separated allowlist is enforced. SMTP and Resend share escaped HTML/plain-text templates, the persistent outbox, verified notification recipients and protected result links.

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
