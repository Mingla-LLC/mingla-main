# Forensic Checklist

## Case framing

- Name the feature slice, target actor, trigger, success state, and environment.
- State the expected happy path in one sentence.
- List prerequisites: auth state, seeded data, permissions, feature flags, migrations, env vars, admin setup.

## User journey checks

- Can the user discover the feature?
- Does the first tap or action respond immediately?
- Are prerequisites explained before failure?
- Are loading, empty, success, rollback, and error states visible and believable?
- Does the final outcome match the user promise in copy, timing, and persisted state?

## Client and UI checks

- Entry component or screen is reachable.
- Hook and service chain is coherent and owned in one place.
- Query keys and invalidations match the repo contract.
- Optimistic updates roll forward and back correctly.
- Errors surface to the user and logs.
- No fabricated fallback data masks a broken pipeline.

## Server and data checks

- Request payload matches the server contract.
- Validation occurs at the right time using the right input.
- Edge function, RPC, or query path reaches the expected table or side effect.
- RLS, auth, role checks, and service-role assumptions match the real actor.
- Migrations, triggers, views, and derived fields support the feature as implemented.
- Realtime, queues, webhooks, or notifications are wired through when promised.

## Production-readiness checks

- Failure is observable through logs, analytics, or metrics.
- Missing tests, missing rollback, or missing monitoring are called out.
- Dependencies on admin-only tooling or manual intervention are explicit.
- Rate limits, retries, idempotency, and stale-cache behavior are understood.
- Mobile, admin, and backend surfaces agree on naming and business rules.

## Finding classification

- `confirmed bug`: verified mismatch between intent and implementation
- `likely bug`: strong evidence, but blocked from final proof by environment or missing access
- `UX gap`: technically works, but the user journey is misleading, brittle, or confusing
- `production-hardening gap`: happy path may work, but release safety is weak
- `open question`: missing artifact, environment, or data blocks a conclusion
