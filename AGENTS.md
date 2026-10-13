# Backend Architecture

All future backend changes must follow the existing Spring MVC layering:

- Controllers handle HTTP routing, validated DTOs and authenticated context, and delegate to services.
- Services own business rules, authorization, orchestration and transaction boundaries.
- Repositories own SQL/JPA persistence, scoped queries and database locks. Reuse the existing feature-specific repositories.
- Application errors use `ApiException` or `WorkspaceError` and the centralized `GlobalExceptionHandler`. Do not expose SQL, credentials or stack traces.
- Do not inject repositories, JDBC or `WorkspaceStore` into controllers, and do not put SQL in services.
- Preserve access controls, lock ordering, session revocation, audit and idempotency guarantees when changing workflows.
- Add focused behavior/security tests and run `BackendArchitectureTests` for backend changes.

See `docs/BACKEND_STRUCTURE.md` for the complete structure and examples. React is the view layer; keep existing API contracts compatible.
