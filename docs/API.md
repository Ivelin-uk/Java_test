# API Contract

The implementation uses the existing Spring MVC JSON API, not the illustrative Laravel paths in the brief. Academic operations use `/api/v1`. UTF-8 JSON field names are camelCase on command DTOs; JDBC read projections use database snake_case. Dates returned by the store are UTC ISO-8601. Domain services, not controller visibility, enforce ownership and transitions.

## Authentication And Organization

Send `Authorization: Bearer <token>` on authenticated requests. Tenant requests additionally require `X-Organization-Id: <id>`. The header selects an active membership; it never grants access. Sessions expire after 24 hours and are invalidated on recovery/logout-all/deactivation. `ORG_ADMIN`, `TEACHER`, `STUDENT` are membership roles; global `ADMIN` is separate. Public registration cannot choose roles.

Business authorization always applies after the organization method matrix. Restricting a method takes effect on the next request and realtime delivery. Enabling it cannot grant another tenant, another owner's content or prohibited student operations. Platform support requires a current, organization-approved, expiring grant and is audited on every read.

| Method / path | Command / authorization |
|---|---|
| POST `/api/auth/register` | `{name,email,password}`; creates ordinary profile, confirmation notification |
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
| GET/POST `/api/v1/organizations` | Own organizations / `{name,organizationType,contactEmail,timezone,studentLabel}` |
| POST `/api/v1/invitations/accept` | `{token}`; verified matching recipient, one use, bounded role |

Login, registration, recovery and reset are rate-limited per identity and remote IP. Google matching-email identities are not silently merged.

## Groups And Content

Paths below are relative to `/api/v1`. Teacher access means the explicit owner/shared teacher where applicable, not just a global role.

| Method / path | Contract |
|---|---|
| GET `/members`, `/directory` | Teacher/admin member directory / restricted same-organization chat directory |
| PUT `/members/{user}` | Org admin: `{roles:[...],active:boolean}`; quota, last-admin protection, audit |
| POST `/invitations` | `{email,roles,groupId}`; org admin or group teacher inviting only students; returns token once and queues invitation |
| GET/POST `/groups` | Scoped groups / `{name,description,subject,schoolYear,classLabel}` |
| PUT `/groups/{id}` | `{profile:<group fields>,status:active|archived}` |
| GET/POST `/groups/{id}/members` | Authorized teacher listing / `{userId}`; never creates a password |
| DELETE `/groups/{id}/members/{user}` | Remove current access, preserve historical attempts |
| GET/POST `/groups/{id}/teachers` | Explicit teachers / `{userId}` |
| DELETE `/groups/{id}/teachers/{user}` | Revoke; cannot remove the last teacher |
| POST `/groups/{id}/csv/preview` | `{csv}` with email header; valid/duplicate/invalid/member/invitation report |
| GET `/groups/{id}/summary` | Group assignments, attempts and published results; students only own rows |
| GET/POST `/tests`, GET/PUT `/tests/{id}` | Own/shared editable assessment definition |
| POST `/tests/{id}/publish` | Validate and copy immutable version |
| GET `/tests/{id}/versions` | Authorized version IDs and publication timestamps |
| POST `/tests/{id}/duplicate` | Independent editable copy |
| PUT `/tests/{id}/sharing` | Owner: `{shared:boolean}` |
| DELETE `/tests/{id}` | Delete unused unpublished draft; archive content with published versions |
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
| POST `/assignments/{id}/code/send` | `{code,channel:email|chat}`; current code must match hash; once per generation/recipient/channel |
| GET `/assignments/{id}/monitoring` | Authorized teacher sees recipients, attempt states and accommodations |
| GET `/assignments/{id}/teachers` | Explicit shared assignment teachers |
| PUT `/assignments/{id}/teachers/{teacher}` | Assignment owner only: `{shared:boolean}` |
| PUT `/assignments/{id}/recipients/{student}/accommodation` | `{fullscreenExempt,timeMultiplier,maxAttempts,reason}`; no changes to active attempt |

AI is asynchronous and never publishes or assigns a test. Success consumes one reservation once; failure releases it. A late response cannot complete a newer retry lease. New assignments/recipients and AI need a valid organization subscription. Quotas are serialized by a dedicated organization mutex, not an exclusive parent-row lock.

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

## Chat, Settings And Billing

| Method / path | Contract |
|---|---|
| GET/POST `/conversations` | Current authorized conversations / `{userId,groupId}` |
| GET `/conversations/{id}/messages?after={id}` | Up to 100 authorized visible messages ascending; advances read cursor |
| POST `/conversations/{id}/messages` | `{body}` text <=4000 chars |
| POST `/conversations/{id}/ticket` | One-use 30-second WebSocket ticket bound to organization, conversation, user and bearer session |
| PUT `/conversations/blocks/{user}` | `{blocked:boolean}` |
| POST `/conversations/messages/{id}/report` | `{reason}` |
| GET/PUT `/conversations/reports/{id}` | Org admin moderation; list at `/reports`, update `{resolution,hide}` |
| GET/PUT `/settings`, `/permissions` | Org admin policy / endpoint role matrix; restrictions cannot override domain permissions |
| GET `/metrics`, `/audit`, `/export` | Org admin operational metrics, audit and scoped export without session/code hashes |
| GET/POST `/support-grants`, DELETE `/support-grants/{id}` | Org admin: `{administratorId,reason,hours}`; 1-24h audited support grant |
| GET `/retention/preview`, POST `/retention/run` | Approved policy; `{requestKey,password,reason}`, content deletion with attempt tombstone |
| GET `/billing`, `/plans` | Current organization subscription/quota and labeled demonstration plans |
| GET `/billing/config`, `/billing/history` | Provider availability / org-admin billing event history |
| POST `/billing/checkout` | Org admin: `{requestKey,planId,period:month|year}`; trusted test price mapping, returns URL |
| POST `/billing/portal` | Org admin provider portal for organization's known test customer |
| POST `/billing/webhook` | Public raw body, required valid `Stripe-Signature`; never trusts redirect/page success |
| GET `/notifications`, POST `/notifications/{id}/retry` | Org admin delivery metadata; retry only confirmed failed, not uncertain |

WebSocket URL `/ws/chat`; first text frame is `{"ticket":"..."}`, not a bearer URL parameter. Fresh authorization is checked before each delivery. Unauthorized, removed, deactivated, expired-session or active-exam channels close with policy violation. New chat read/send is blocked across all sessions during an active exam.

Global-admin-only `/api/v1/platform/organizations`, `/plans`, organization status controls, approved `/support/{org}/...` read paths and optional disabled-by-default `/organizations/{org}/billing-fixtures` are separate from tenant academic access. Legacy `/api/admin` remains technical account management; legacy individual subscriptions do not grant organization access. See controller records for administrative field schemas.

## Errors And Idempotency

Domain errors use RFC-style ProblemDetail JSON `{type,title,status,detail,code}`. Codes: `validation` (400), `forbidden` (403), `not_found` (404), `conflict` (409), `expired` (410), `rate_limit` (429). Authentication failures are 401/403. Exceptions never expose stack traces in API responses. JSON/bean validation failures use Spring ProblemDetail.

Idempotency keys are 8-80 ASCII letters/digits/underscore/hyphen. Persist them across network retries. Start/publication/AI keys are scoped and uniqueness constrained; events bind key and question instance. New attempt or intentional correction needs a new key. No API can silently restart a deadline. Notification enqueue is in the same transaction as a result revision, with a unique revision/recipient/type key; delivery failure cannot roll back published grading.
