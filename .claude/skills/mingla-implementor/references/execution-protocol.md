> Parity note: ported from `.codex/skills/implementor-mingla/references/execution-protocol.md` during META-ORCH-0755-B so Claude implementor can load Codex’s consolidated pre-flight, execution, rework, verification, and reporting protocol.

# Execution Protocol

## Pre-Flight

1. Identify the source:
   - User-dispatched spec execution.
   - User-dispatched ORCH implementation prompt.
   - User-dispatched test failure rework prompt.
   - User-dispatched review finding.
   If none exists, stop before editing and request an orchestrator/forensic/spec prompt.

2. Extract the contract:
   - Required behavior.
   - Non-goals.
   - Success criteria.
   - Affected surfaces.
   - Verification expected.

3. Read before editing:
   - Files to modify.
   - Imports/dependents.
   - Sibling files for local pattern.
   - Relevant docs/contracts: `README.md`, `docs/IMPLEMENTATION_GATES.md`, `docs/MUTATION_CONTRACT.md`, `docs/QUERY_KEY_REGISTRY.md`, `docs/DOMAIN_ADRS.md`.
   - Relevant specs/investigations/test reports.
   - Query key factories, Zustand stores, edge functions, migrations/RLS, tests.

4. Migration authority:
   - For any DB/RLS/RPC/trigger/view/policy change, grep the full migration chain.
   - Latest relevant migration or schema definition is current truth.
   - Do not cite or build from an early migration without checking supersession.

5. Blast-radius note:
   - Direct files.
   - Cascade files.
   - Parity surfaces.
   - Query keys/cache.
   - State ownership.
   - Auth/RLS/security.
   - Integrations/env vars.
   - Deploy path.

## Implementation Order

Follow the spec order if it exists. Otherwise:

1. Database and migrations.
2. Edge functions, RPCs, webhooks.
3. Services and clients.
4. Hooks, query keys, state, persisted cache.
5. Components, screens, copy, accessibility, haptics.
6. `mingla-business/`, `mingla-admin/`, public/web parity.
7. Realtime, notifications, analytics.
8. Tests, fixtures, docs, artifacts.

Do not apply or deploy migrations/edge functions unless the user explicitly asks and the environment is safe. Writing migration files is normal implementation work.

## Spec Execution

- Implement every success criterion or mark it blocked.
- If live code makes the spec unsafe or impossible, stop on that part and explain.
- Record deviations and surprises.
- Do not redesign beyond the spec.

## Missing Spec Or Proof

- Do not implement product/code changes from an uninvestigated symptom.
- Do not treat a casual chat request as permission to bypass the Mingla pipeline when the user expects orchestrator-controlled dispatch.
- If root cause is unknown, return `blocked before implementation` and request a forensic investigation/spec prompt.
- If the spec is ambiguous, implement only explicitly proven and bounded requirements; otherwise stop on the risky part and document the needed clarification.
- If the scope expands materially, document the expansion for orchestrator instead of absorbing it silently.

## Rework From Test Failure

1. Read the test report and failed criteria.
2. Read previous implementation report if present.
3. Reproduce or reason through failure.
4. Fix only failed criteria and direct blockers.
5. Verify the failing checks.
6. Report as v2 or summarize rework clearly.

## Verification

Pick the smallest meaningful evidence:

- Mobile: focused test, `npm run lint`, `tsc` if configured, or targeted package script.
- Business/admin: focused test, lint, build.
- Supabase functions: type/lint/test if available; inspect auth/input/error paths.
- SQL: migration syntax/reasoning, latest-chain check, policy coverage.
- UI: state-machine review and available render tests; manual check instructions when device/browser is required.

Never claim a command ran if it did not. If network/device/secrets block verification, label it `UNVERIFIED` and name the manual test.

## Reporting

Final chat always includes:

- What changed.
- Verification status.
- Unverified/manual checks.
- Files or report path when useful.
- Clear statement that testing/closure still require user-dispatched `$tester-mingla` and `$orchestrator-mingla` steps when this is ORCH/spec work.

Write a durable report when:

- ORCH ID or spec dispatch.
- Launch-critical/payment/auth/RLS/migration work.
- More than a small localized change.
- User asks for a report.
- Verification is partial and future tester needs details.
