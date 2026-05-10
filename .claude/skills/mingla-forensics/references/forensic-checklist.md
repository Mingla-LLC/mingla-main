> Parity note: ported from `.codex/skills/forensic-mingla/references/forensic-checklist.md` during META-ORCH-0755-B so Claude forensics can load the Codex investigation workflow checklist when useful.

# Forensic Checklist

## Case framing

- Name the feature slice, target actor, trigger, success state, and environment.
- State the expected happy path in one sentence.
- List prerequisites: auth state, seeded data, permissions, feature flags, migrations, env vars, admin setup.
- Search prior artifacts, specs, prompts, handoffs, and ORCH IDs before declaring anything new.
- Build an investigation manifest in trace order before deep reading.

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
- Static analysis flags checked for every relevant file.

## Server and data checks

- Request payload matches the server contract.
- Validation occurs at the right time using the right input.
- Edge function, RPC, or query path reaches the expected table or side effect.
- RLS, auth, role checks, and service-role assumptions match the real actor.
- Migrations, triggers, views, and derived fields support the feature as implemented.
- Realtime, queues, webhooks, or notifications are wired through when promised.
- Full migration chain checked; latest relevant definition is treated as authority.
- Security inspection done for auth, input validation, data exposure, storage paths, and third-party API access.

## Production-readiness checks

- Failure is observable through logs, analytics, or metrics.
- Missing tests, missing rollback, or missing monitoring are called out.
- Dependencies on admin-only tooling or manual intervention are explicit.
- Rate limits, retries, idempotency, and stale-cache behavior are understood.
- Mobile, admin, and backend surfaces agree on naming and business rules.
- Business app and public/web surfaces agree on organiser, money, ticket, order, QR, and permission rules when relevant.
- Deploy path is known: migration, edge function, mobile OTA/native build, business/admin web deploy, env var.

## Finding classification

- `confirmed bug`: verified mismatch between intent and implementation
- `likely bug`: strong evidence, but blocked from final proof by environment or missing access
- `UX gap`: technically works, but the user journey is misleading, brittle, or confusing
- `production-hardening gap`: happy path may work, but release safety is weak
- `security gap`: auth, RLS, input validation, secret, exposure, or wrong-actor risk
- `invariant violation`: breaks a durable Mingla architecture/product rule
- `open question`: missing artifact, environment, or data blocks a conclusion

## Spec readiness checks

- Root cause is proven or assumptions are explicitly labeled.
- Every success criterion is observable and testable.
- Every affected layer is specified or explicitly marked unaffected.
- RLS/auth, cache/state, failure handling, deploy order, rollback, and tests are covered.
- Non-goals prevent scope creep.
