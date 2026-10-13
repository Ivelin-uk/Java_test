# Backend Structure

## Request Flow

The backend uses Spring MVC with application, persistence and exception layers:

```text
HTTP request
  -> Controller: route, validated input, authenticated context
  -> Service: authorization, business rules, orchestration, transaction
  -> Repository: queries, persistence projections, database locks
  -> Database

Service/repository exception
  -> GlobalExceptionHandler
  -> application/problem+json
```

React renders the view. The backend's model consists of existing JPA entities, immutable request/response records and workspace row projections. The refactor does not add server-rendered templates or change the frontend's API field names.

## Modules

| Responsibility | Location |
|---|---|
| Authentication HTTP routes | `auth/AuthController` |
| Registration/login/recovery orchestration | `auth/AuthWorkflowService` |
| User/token rules and JPA persistence | `auth/AuthService`, `AppUserRepository`, `AuthTokenRepository` |
| Workspace HTTP routes | `workspace/*Controller` |
| Assessments, assignments, attempts, grading, groups, profiles, notifications, quotas | Existing workspace services |
| Workspace SQL | `workspace/repository/*Repository` |
| Internal JDBC execution and UTC timestamp mapping | `workspace/WorkspaceStore` |
| JSON serialization and row-value conversion, without database access | `workspace/WorkspaceJson`, `WorkspaceValues` |
| Legacy dashboard aggregation | `dashboard/DashboardService` |
| Shared application exceptions and HTTP mapping | `exception/ApiException`, `ApiProblems`, `GlobalExceptionHandler` |

Packages stay grouped by feature. Creating a new top-level `controllers` or `services` package is not required by MVC; the dependency direction is what enforces the separation. Existing Spring Data JPA repositories remain in their original features. Workspace JDBC repositories retain the SQL required for MySQL 5.7 and the historical schema instead of introducing an unrelated ORM migration.

## Example

`AssessmentController.create` passes the authenticated teacher scope and definition to `AssessmentService.save`. The service validates the definition, verifies image access, applies workspace membership rules and calls `AssessmentRepository.insertTest` or `updateDraft`. The repository owns the actual SQL. The service writes an audit entry and returns the same assessment projection as before.

`OrganizationController.identities` delegates to `IdentityWorkflow.identities`, which calls `IdentityRepository.findExternalIdentities`. Controllers do not inject JDBC, `WorkspaceStore` or repository objects.

## Transactions And Access

- Services own `@Transactional` and `TransactionTemplate` boundaries. Repositories participate in the caller's transaction; they do not independently commit multi-step operations.
- `FOR UPDATE`, lock order, composite organization/resource keys, idempotency keys and latest-result revision selection are preserved.
- Ownership, explicit teacher sharing and assigned-student checks remain in services. Repositories still apply scoped predicates; moving queries does not make a global role sufficient for access.
- Dynamic resource-table resolution and export table lists are fixed inside repositories. Group-ID placeholders are constructed in the assignment repository, not supplied as SQL by a controller or service.
- Rate-limit accounting retains its separate `REQUIRES_NEW` transactions. Notification and AI worker claims, retries and settlement retain their existing transaction boundaries.
- `WorkspaceStore` mapping helpers remain as compatibility delegates for existing verification fixtures. Application services use `WorkspaceJson` and `WorkspaceValues` directly.

## Exceptions

`ApiException` carries the HTTP status, stable application code and safe detail. `WorkspaceError` retains its existing factories and extends that common exception, preserving callers and tests that use its statuses. Existing `ResponseStatusException` remains supported for framework/integration compatibility.

`GlobalExceptionHandler` maps application exceptions, invalid request bodies, bean validation errors, access denials, data integrity conflicts and unexpected failures. Responses retain `detail` and add consistent `status`, `title`, `type` and `code`. Validation responses also contain field names and messages, never rejected values. Database/internal failures return generic public messages instead of SQL, connection details or stack traces. Security and retired-API filters execute before MVC and use the same `ApiProblems` response formatter.

## Verification

```bash
cd backend
./gradlew test
```

`BackendArchitectureTests` parses production Java source with the JDK compiler API. It rejects SQL/JDBC outside repositories, controller-to-repository dependencies, business exceptions thrown by controllers and repository dependencies on services/controllers. `ApiExceptionTests` checks status/code/detail compatibility, malformed JSON, field validation, framework headers, safe internal errors and filter responses. Existing workflow, security, concurrency, AI, Google and migration tests verify behavior after extraction.

For future changes, add a repository method for persistence and call it from a service. Do not pass arbitrary SQL through a service or move business/authorization decisions into a controller.
