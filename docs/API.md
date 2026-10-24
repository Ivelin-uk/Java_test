# API Contract

Backend errors use `application/problem+json` with `status`, `title`, `type`, `detail` and a stable `code`. Invalid request fields may additionally produce `errors:[{field,message}]`; rejected values and internal database details are never returned. Existing routes and success-response fields are unchanged by the controller/service/repository refactor. See [Backend Structure](BACKEND_STRUCTURE.md).

Current account workflow: registration accepts optional `role: STUDENT|TEACHER`. Omitting it requires a one-time role choice before workspace access; ADMIN cannot be self-selected. `/api/v1` requests require a Bearer token, not an organization selector or invitation. Existing resource namespaces are resolved internally, while ownership, sharing and assignment recipients continue to govern access. `/members` and `/directory` are teacher-only lists of active registered teachers and students. Organization, invitation, settings, support-grant, organizational billing and platform-organization routes have been removed. Historical contracts below that describe those routes do not apply to the current product.

The implementation uses the existing Spring MVC JSON API, not the illustrative Laravel paths in the brief. Academic operations use `/api/v1`. UTF-8 JSON field names are camelCase on command DTOs; JDBC read projections use database snake_case. Dates returned by the store are UTC ISO-8601. Domain services, not controller visibility, enforce ownership and transitions.

## Authentication And Roles

Send `Authorization: Bearer <token>` on authenticated requests. No organization header or membership invitation is required. Global roles are `ADMIN`, `TEACHER`, `STUDENT`; registration permits teacher or student only. Sessions expire after 24 hours and are invalidated on recovery/logout-all/deactivation. Ownership, explicit sharing and recipient checks enforce access to academic content.

| Method / path | Command / authorization |
|---|---|
| POST `/api/auth/register` | `{name,email,password,role?:STUDENT|TEACHER}`; creates personal profile, confirmation notification |
| POST `/api/auth/login` | `{email,password}`; returns `{token,user}` |
| GET `/api/auth/me` | Current active identity |
| POST `/api/auth/role` | `{role:STUDENT\|TEACHER}`; authenticated, one-time choice for accounts with `user.roleSelectionRequired=true`; returns updated user, 409 once already selected |
| POST `/api/auth/logout`, `/logout-all` | Revoke current / all bearer sessions |
| POST `/api/auth/password` | `{currentPassword,newPassword}` |
| POST `/api/auth/recover`, `/reset` | `{email}` / `{token,password}`; single-use reset, all old sessions revoked |
| GET `/api/auth/google/config`, `/redirect` | Provider availability / standard OIDC redirect; optional `role=STUDENT\|TEACHER` for new accounts, otherwise new accounts require role selection; optional single-use `link` ticket |
| GET `/login/oauth2/code/google` | Framework callback with state/nonce/issuer validation |
| POST `/api/auth/google/exchange` | `{token}`; short-lived one-use frontend handoff |
| POST `/api/v1/profile/google/link` | `{password}`; authenticated reauthorization, returns redirect URL |
| GET `/api/v1/profile/identities` | Connected provider names, no provider secrets |
| GET/POST `/api/v1/profile/notification-email` | Current verified address / `{email,password}` confirmation request |
| POST `/api/v1/profile/notification-email/verify` | `{token}`; new address becomes active only after verification |
| GET `/api/v1/profile/mailbox` | Own private **local-adapter-only** test mail |

Login, registration, recovery and reset are rate-limited per identity and remote IP. Google matching-email identities are not silently merged.

New password registrations and first Google sign-ins without an explicit role return `user.roleSelectionRequired=true`. Until selection, bearer sessions permit only `/api/auth/me`, `/api/auth/role`, `/api/auth/logout` and `/api/auth/logout-all`; workspace access returns 403. The role choice persists across reloads and sessions. Existing accounts keep their roles and do not re-enter selection. The UI labels TEACHER as "Учител / асистент" and STUDENT as "Ученик / студент".

## Groups And Content

Paths below are relative to `/api/v1`. Teacher access means the explicit owner/shared teacher where applicable, not just a global role.

Groups receive a unique eight-character `join_code` at creation; migration V21 also generates codes for existing groups. Only authorized teacher views include it. Student joins create/reactivate only their group membership, preserve assigned recipient snapshots and record an audit event without the code. Repeated/concurrent joins are idempotent. Invalid codes and deleted groups share a generic error; five failed guesses block further attempts for five minutes per user/IP. A code does not grant teacher rights, access to classmates' results or automatic access to previously assigned tests.

| Method / path | Contract |
|---|---|
| GET `/members`, `/directory` | Active registered teachers and students; teacher access only |
| GET/POST `/groups` | Scoped groups including `teacher_name` and active student `participant_count` / `{name,description,subject}` |
| POST `/groups/join` | Authenticated student only: `{code}`; returns `{id,name,alreadyMember}`. Case-insensitive, trimmed code; joins the caller, never a supplied user ID. |
| POST `/groups/{id}/code/rotate` | Assigned teacher only: `{currentCode}`; returns `{code}`. Replaces the displayed code, immediately invalidating it for new joins; repeating the same request returns the current code without another rotation. Existing memberships, assigned recipients and results are unchanged. Codes are omitted from audit details. |
| PUT `/groups/{id}` | `{name,description,subject}` |
| DELETE `/groups/{id}` | Assigned teacher only; removes the group from lists and future assignments, preserving historical assignments, recipients, attempts and results. Deleted group routes return 404. |
| GET/POST `/groups/{id}/members` | Authorized teacher listing / `{userId}`; never creates a password |
| DELETE `/groups/{id}/members/{user}` | Remove current access, preserve historical attempts |
| GET/POST `/groups/{id}/teachers` | Explicit teachers / `{userId}` |
| DELETE `/groups/{id}/teachers/{user}` | Revoke; cannot remove the last teacher |
| POST `/groups/{id}/csv/preview` | `{csv}` with email header; valid/duplicate/invalid/registered/unregistered report |
| GET `/groups/{id}/summary` | Group assignments, attempts and published results; students only own rows |
| GET `/groups/{id}/assignments` | Active student members only; own non-canceled recipient assignments whose source snapshot includes this group, using the student `/assignments` projection. Joining does not enroll a student in older assignments. Omits source snapshots, access codes and other recipients' details. |
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

Question `text` remains a string (maximum 12,000 characters, including markup). Plain strings remain literal text. The editor prefixes formatted HTML with `<!--examai-rich-text:v1-->`; inline equations use `<span data-type="inline-math" data-latex="…"></span>`. Consumers must sanitize formatted content before rendering and render equations with untrusted KaTeX commands disabled. The frontend uses an explicit tag/attribute allowlist and restricts styles to paragraph alignment. Existing version/attempt snapshots preserve this string without changing the API shape.

AI-generated images use the existing private-file contract, storage limits and owner/attempt authorization. Files and the completed job are committed atomically only while the worker still owns its lease. A failed image rolls back the whole image batch and releases the AI reservation; no partial image files remain. Heartbeats between image calls keep long batches active. Completed job metadata includes image model names and image token usage. Generation is opt-in and uses the configured OpenAI Image API model; no remote image URL is fetched. Teachers review the illustrated draft before publication.

## AI And Assignment

| Method / path | Contract |
|---|---|
| POST `/ai/test-generations` | `{requestKey,topic,subject,level,language,questionCount,difficulty,sourceText?,questionTypes?,difficultyCounts?,additionalInformation?,imageCount?}`; returns persisted job. Optional `additionalInformation` (up to 20,000 characters) supplies teacher context and requirements for generation; it is stored with the job, checked for idempotency and reused on retry. `imageCount` defaults to 0 and must be between 0 and `questionCount`. The first `imageCount` questions are created as visual tasks with matching AI-generated illustrations. Legacy `sourceText` remains untrusted reference data. The AI creation form uses `language:"bg"` and an empty `level` without exposing those controls. |
| GET `/ai/test-generations/{id}` | Own job: queued/running/completed/failed, structured result or safe error |
| POST `/ai/test-generations/{id}/retry` | Failed job only, max 3 processing attempts; reserves quota again |
| GET/POST `/assignments` | Own teacher/recipient projections / `{versionId,groupIds,startsAt,endsAt,maxAttempts,shuffleQuestions,shuffleOptions,answersAfterDeadline}`. New assignments require nonempty groups with active students; individual or mixed requests are rejected with 400. Teacher lists include `recipient_groups:[{id,name}]`, historical `individual_recipients:[{id,name}]`, the active `recipients` count, and `access_code` (null for revoked or legacy hash-only codes). Codes remain visible after reload to the owner and explicitly shared teachers. Group names remain even when all recipients are removed. Student lists include `teacher_name` for the teacher who assigned that version (which may differ from the assessment author); they omit removed assignments and do not expose teacher emails, audience details or access codes. |
| DELETE `/assignments/{id}` | Assignment owner only. Permanently removes recipients, shared-teacher access, code-delivery records, active/completed attempts, answer/event snapshots, result revisions and their notifications. The source assessment and published version remain. Removed resources return 404. A result notification currently being delivered returns 409; retry after delivery completes. |
| PUT `/assignments/{id}/settings` | Authorized active teacher only; all four booleans are required: `{shuffleQuestions,shuffleOptions,answersAfterDeadline,autoAiGrading}`. Teacher lists expose the corresponding `shuffle_questions`, `shuffle_options`, `answers_after_deadline`, `auto_ai_grading` fields. Changes are audited. Shuffle settings apply to future attempt snapshots. Existing attempt snapshots, codes, recipients and results remain intact. |
| GET `/assignments/{id}/members` | Authorized teacher only; active current members of the assignment's source groups, deduplicated, as `[{student_id,name,email}]`. Includes later group members but never unrelated directory students. Deleted groups contribute no eligible members. |
| POST `/assignments/{id}/recipients` | `{userId}`; assign/reassign one active member of a source group. Restore access and raise that student's attempt limit to at least `usedAttempts + 1` when exhausted; preserve history, results, accommodations and assignment/code. Repeated requests with no intervening attempt do not add further attempts. An unfinished attempt returns 409; nonmembers return 403; an expired window returns 410. New group members receive a group-source snapshot, not an individual assignment. |
| DELETE `/assignments/{id}/recipients/{student}` | Authorized teacher only; remove this student's access, hide the assignment from their list, and void only unfinished attempts. Keep recipient/group snapshots, answers, completed attempts and published results. Repeated removals have no extra effect. The group membership itself is unchanged. |
| GET `/assignments/{id}/preflight` | Recipient-only instructions/count/time/window, no scoring keys |
| POST `/assignments/{id}/code/rotate` | New random code returned and saved for the teacher list; old code invalidated |
| DELETE `/assignments/{id}/code` | Revoke code and clear its display value |
| POST `/assignments/{id}/code/send` | `{code,channel:email}`; current code must match hash; once per generation/recipient/channel |
| GET `/assignments/{id}/monitoring` | Authorized teacher sees recipients, attempt states and accommodations |
| GET `/assignments/{id}/teachers` | Explicit shared assignment teachers |
| PUT `/assignments/{id}/teachers/{teacher}` | Assignment owner only: `{shared:boolean}` |
| PUT `/assignments/{id}/recipients/{student}/accommodation` | `{fullscreenExempt,timeMultiplier,maxAttempts,reason}`; no changes to active attempt |

AI is asynchronous and never publishes or assigns a test. Success consumes one reservation once; failure releases it. A late response cannot complete a newer retry lease. Assignments do not require school subscriptions. AI and storage quotas are maintained in the account's automatically created internal workspace.

Assignment creation also accepts optional `autoAiGrading` (default `false`, including legacy requests). When enabled, the grading worker durably discovers committed `pending_review` attempts without an existing grading job, including deadline completion and submissions made while workers were stopped. It queues the existing AI grading/publishing workflow under the teacher and access scope that enabled the setting. Enabling it also includes pending submissions; disabling it stops new automatic jobs, while queued/running jobs finish. Quota checks, active teacher/shared-assignment authorization, snapshot/lease checks and one job per attempt apply as for manual AI requests. Queue failures are recorded as failed jobs without losing the submission or consuming AI quota; retries remain explicit. Students cannot set or read these teacher settings. Full solutions still follow the assignment release policy and per-attempt review permission.

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

`PUT /api/admin/users/{id}/role` accepts `{role: "ADMIN"|"TEACHER"|"STUDENT"}` and returns the updated user. Only platform administrators can call it. A role change resolves any pending first-login role selection, revokes all target-user sessions and records `USER_ROLE_CHANGED` in the admin audit log. Other account fields, subscriptions and academic records are unchanged. Repeating an already settled role is a no-op. The last active administrator cannot be demoted (409). Invalid/missing roles return 400; unknown users return 404. The general user-edit route applies the same last-administrator protection and resolves pending role selection.

## Errors And Idempotency

Domain errors use RFC-style ProblemDetail JSON `{type,title,status,detail,code}`. Codes: `validation` (400), `forbidden` (403), `not_found` (404), `conflict` (409), `expired` (410), `rate_limit` (429). Authentication failures are 401/403. Exceptions never expose stack traces in API responses. JSON/bean validation failures use Spring ProblemDetail.

Idempotency keys are 8-80 ASCII letters/digits/underscore/hyphen. Persist them across network retries. Start/publication/AI keys are scoped and uniqueness constrained; events bind key and question instance. New attempt or intentional correction needs a new key. No API can silently restart a deadline. Notification enqueue is in the same transaction as a result revision, with a unique revision/recipient/type key; delivery failure cannot roll back published grading.

### Grading actions

`GET /grading` remains teacher-only and adds `student_id`, `access_code` (null when revoked), `assignment_ends_at`, recipient `max_attempts`, `attempts_used`, `active_attempts`, `recipient_canceled`, `group_assignment`, `result_email_status` and `result_outcome` (`passed`/`failed` from the latest published revision, null before publication). No code hash or exam session secret is returned. The UI filters `submitted_at` by inclusive local calendar dates and retains the filter during refresh. Published results use green only when passed and red when failed; unknown outcomes remain neutral.

`POST /assignments/{id}/recipients/{user}/extra-attempt` returns `{maxAttempts,remainingAttempts,granted}`. It requires the assignment's owner/shared teacher, an active assigned student still in a source group, a future deadline and no active attempt. It leaves at least one unused attempt; duplicate/concurrent requests cannot accumulate additional unused attempts. It changes only that recipient's allowance, records an audit entry and preserves all old attempts/results and the current access code.

`POST /attempts/{id}/result-email` returns `{id,status,adapter}` for the latest published revision. It requires owner/shared-teacher access and a finalized attempt, and only uses the student's verified notification address. It reuses the revision's existing unique outbox record, requeues known failures, and rejects uncertain outcomes or a changed recipient address. A known local-only receipt can be queued to a real adapter on explicit request. Existing real-provider receipts are not replayed. Result links still require the same student and obey the answer release deadline.
