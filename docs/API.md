# API Contract

Current account workflow: registration accepts `role: STUDENT|TEACHER` (default STUDENT; ADMIN cannot be self-selected). `/api/v1` requests require a Bearer token, not an organization selector or invitation. Existing resource namespaces are resolved internally, while ownership, sharing and assignment recipients continue to govern access. `/members` and `/directory` are teacher-only lists of active registered teachers and students. Organization, invitation, settings, support-grant, organizational billing and platform-organization routes have been removed. Historical contracts below that describe those routes do not apply to the current product.

The implementation uses the existing Spring MVC JSON API, not the illustrative Laravel paths in the brief. Academic operations use `/api/v1`. UTF-8 JSON field names are camelCase on command DTOs; JDBC read projections use database snake_case. Dates returned by the store are UTC ISO-8601. Domain services, not controller visibility, enforce ownership and transitions.

## Authentication And Roles

Send `Authorization: Bearer <token>` on authenticated requests. No organization header or membership invitation is required. Global roles are `ADMIN`, `TEACHER`, `STUDENT`; registration permits teacher or student only. Sessions expire after 24 hours and are invalidated on recovery/logout-all/deactivation. Ownership, explicit sharing and recipient checks enforce access to academic content.

| Method / path | Command / authorization |
|---|---|
| POST `/api/auth/register` | `{name,email,password,role?:STUDENT|TEACHER}`; creates personal profile, confirmation notification |
| POST `/api/auth/login` | `{email,password}`; returns `{token,user}` |
| GET `/api/auth/me` | Current active identity |
| POST `/api/auth/logout`, `/logout-all` | Revoke current / all bearer sessions |
| POST `/api/auth/password` | `{currentPassword,newPassword}` |
| POST `/api/auth/recover`, `/reset` | `{email}` / `{token,password}`; single-use reset, all old sessions revoked |
| GET `/api/auth/google/config`, `/redirect` | Provider availability / standard OIDC redirect |
| GET `/login/oauth2/code/google` | Framework callback with state/nonce/issuer validation |
| POST `/api/auth/google/exchange` | `{token}`; short-lived one-use frontend handoff |
| POST `/api/v1/profile/google/link` | `{password}`; authenticated reauthorization, returns redirect URL |
| GET `/api/v1/profile/identities` | Connected provider names, no provider secrets |
| GET/POST `/api/v1/profile/notification-email` | Current verified address / `{email,password}` confirmation request |
| POST `/api/v1/profile/notification-email/verify` | `{token}`; new address becomes active only after verification |
| GET `/api/v1/profile/mailbox` | Own private **local-adapter-only** test mail |

Login, registration, recovery and reset are rate-limited per identity and remote IP. Google matching-email identities are not silently merged.

## Groups And Content

Paths below are relative to `/api/v1`. Teacher access means the explicit owner/shared teacher where applicable, not just a global role.

| Method / path | Contract |
|---|---|
| GET `/members`, `/directory` | Active registered teachers and students; teacher access only |
| GET/POST `/groups` | Scoped groups / `{name,description,subject}` |
| PUT `/groups/{id}` | `{name,description,subject}` |
| DELETE `/groups/{id}` | Assigned teacher only; removes the group from lists and future assignments, preserving historical assignments, recipients, attempts and results. Deleted group routes return 404. |
| GET/POST `/groups/{id}/members` | Authorized teacher listing / `{userId}`; never creates a password |
| DELETE `/groups/{id}/members/{user}` | Remove current access, preserve historical attempts |
| GET/POST `/groups/{id}/teachers` | Explicit teachers / `{userId}` |
| DELETE `/groups/{id}/teachers/{user}` | Revoke; cannot remove the last teacher |
| POST `/groups/{id}/csv/preview` | `{csv}` with email header; valid/duplicate/invalid/registered/unregistered report |
| GET `/groups/{id}/summary` | Group assignments, attempts and published results; students only own rows |
| GET/POST `/tests`, GET/PUT `/tests/{id}` | Own/shared editable assessment definition |
| POST `/tests/{id}/publish` | Validate and copy immutable version |
| GET `/tests/{id}/versions` | Authorized version IDs and publication timestamps |
| POST `/tests/{id}/duplicate` | Independent editable copy |
| PUT `/tests/{id}/sharing` | Owner: `{shared:boolean}` |
| DELETE `/tests/{id}` | Remove any visible test from the caller's library. Own unpublished drafts are deleted; own published tests are archived and excluded from the library while versions/assignments/results remain. Shared tests are removed only for the caller; the owner's test and other teachers' libraries are unchanged. |
| GET/POST `/question-bank` | Own/shared bank / `{subject,shared,question}` |
| DELETE `/question-bank/{id}` | Owner/admin scoped deletion |
| POST `/files` | `{purpose:question|logo,base64}`; PNG/JPEG <=2 MiB, normalized image <=2048 px / 4 MP; logo requires org admin |
| GET `/files/{id}?attempt={id}` | Private binary, Bearer+tenant check; student exam additionally requires exam binding; no-store, nosniff |

Assessment definition: `{title,description,subject,level,instructions,language,gradingScale,passThreshold,questions}`. Scales: `bulgarian`, `percentage`, `pass_fail`. Each question: `{type,text,difficulty,points,timeSeconds,options:[{text,correct}],acceptedAnswers,caseInsensitive,collapseWhitespace,criteria,explanation,imageId?}`. Types: `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `TRUE_FALSE`, `SHORT_ANSWER`, `OPEN_ANSWER`. Difficulties: `EASY`, `MEDIUM`, `HARD`, `VERY_HARD`. Publish requires 1-100 valid questions, positive points and 10-3600 seconds each. Manual criteria are required where answers cannot be checked automatically. Student text/code is never executed.

## AI And Assignment

| Method / path | Contract |
|---|---|
| POST `/ai/test-generations` | `{requestKey,topic,subject,level,language,questionCount,difficulty,sourceText,questionTypes?,difficultyCounts?}`; returns persisted job |
| GET `/ai/test-generations/{id}` | Own job: queued/running/completed/failed, structured result or safe error |
| POST `/ai/test-generations/{id}/retry` | Failed job only, max 3 processing attempts; reserves quota again |
| GET/POST `/assignments` | Own teacher/recipient projections / `{versionId,groupIds,studentIds,startsAt,endsAt,maxAttempts,shuffleQuestions,shuffleOptions,answersAfterDeadline}` |
| POST `/assignments/{id}/recipients` | `{userId}`; explicitly add a later active student, deduplicated |
| GET `/assignments/{id}/preflight` | Recipient-only instructions/count/time/window, no scoring keys |
| POST `/assignments/{id}/code/rotate` | New random code returned once; old code invalidated |
| DELETE `/assignments/{id}/code` | Revoke code |
| POST `/assignments/{id}/code/send` | `{code,channel:email}`; current code must match hash; once per generation/recipient/channel |
| GET `/assignments/{id}/monitoring` | Authorized teacher sees recipients, attempt states and accommodations |
| GET `/assignments/{id}/teachers` | Explicit shared assignment teachers |
| PUT `/assignments/{id}/teachers/{teacher}` | Assignment owner only: `{shared:boolean}` |
| PUT `/assignments/{id}/recipients/{student}/accommodation` | `{fullscreenExempt,timeMultiplier,maxAttempts,reason}`; no changes to active attempt |

AI is asynchronous and never publishes or assigns a test. Success consumes one reservation once; failure releases it. A late response cannot complete a newer retry lease. Assignments do not require school subscriptions. AI and storage quotas are maintained in the account's automatically created internal workspace.

## Attempts And Results

After a successful user-gesture fullscreen request, start with `{code,idempotencyKey,browserId,sessionToken,fullscreenSupported,fullscreenActive,visible}` at POST `/assignments/{id}/attempts`. `sessionToken` is 256-bit random base64url, `browserId` is stable for that tab. The response is authoritative state. Failed strict/mobile preflight consumes no attempt. Only one global active exam per profile is allowed.

All subsequent student exam commands require `X-Exam-Session: <sessionToken>` and `X-Exam-Browser: <browserId>`, bound also to the authenticated bearer session. A transfer requires the current password and revokes the old binding without resetting timestamps. Codes are not required to restore an existing bound attempt.

| Method / path | Body / effect |
|---|---|
| GET `/attempts` | Own history, no private question definitions |
| GET `/attempts/{id}/state` | Server time, status, position, current safe question or pending placeholder |
| POST `/attempts/{id}/questions/open` | `{fullscreenActive,visible}`; server opens only next pending question |
| PUT `/attempts/{id}/questions/{question}/draft` | `{idempotencyKey,openInstance,answer:{optionIds,text}}`; not a submission |
| POST `/attempts/{id}/questions/{question}/answer` | Same body; at/after deadline zero, terminal answer cannot be overwritten |
| POST `/attempts/{id}/events` | `{eventKey,questionId,openInstance,type,visible,fullscreen}`; instance-bound deduplication |
| POST `/attempts/{id}/submit` | Remaining unanswered questions zero, closes attempt, pending review |
| POST `/attempts/{id}/session/transfer` | `{password,session:<start binding fields>}` |
| GET `/grading`, `/attempts/{id}/review` | Authorized teacher queue / snapshot, submitted answer, draft, points, events, revisions |
| PATCH `/attempts/{id}/grading` | `{questionId,points,comment,reason}`; reason required for automatic/finalized overrides |
| POST `/attempts/{id}/finalize` | `{idempotencyKey,reason,gradeOverride,outcomeOverride}`; requires every manual answer reviewed |
| POST `/attempts/{id}/result-revisions` | Same body, reason mandatory; immutable correction + new notification |
| POST `/attempts/{id}/void` | `{reason}`; excluded from final summary |
| GET `/results`, `/results/{attempt}` | Own latest published revisions; details only when assignment policy allows |
| GET `/assignment-results` | Last finalized, nonvoid attempt by attempt number for each assignment |

The `question` student projection has IDs, text/type/options only when open, points, allowed time, open-instance/server timestamps and draft. It never has `correct`, `acceptedAnswers`, criteria, explanation or `definition_json`. Pending questions do not expose unseen text. Exact deadline uses server UTC, never client time. Duplicate/late events return current state; old-instance events cannot penalize the next question. `blur` alone has no penalty. Deadlines also run in the persistent worker.

## Settings And Billing

| Method / path | Contract |
|---|---|

The chat feature and its HTTP/WebSocket endpoints have been removed. Existing chat tables are retained for migration compatibility, but are no longer used by the application.

Global-admin `/api/admin` manages accounts, roles, permissions and audit. Organization administration routes have been removed.

## Errors And Idempotency

Domain errors use RFC-style ProblemDetail JSON `{type,title,status,detail,code}`. Codes: `validation` (400), `forbidden` (403), `not_found` (404), `conflict` (409), `expired` (410), `rate_limit` (429). Authentication failures are 401/403. Exceptions never expose stack traces in API responses. JSON/bean validation failures use Spring ProblemDetail.

Idempotency keys are 8-80 ASCII letters/digits/underscore/hyphen. Persist them across network retries. Start/publication/AI keys are scoped and uniqueness constrained; events bind key and question instance. New attempt or intentional correction needs a new key. No API can silently restart a deadline. Notification enqueue is in the same transaction as a result revision, with a unique revision/recipient/type key; delivery failure cannot roll back published grading.
