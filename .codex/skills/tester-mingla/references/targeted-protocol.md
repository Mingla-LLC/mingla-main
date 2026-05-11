# Targeted And Spec-Compliance Protocol

## Targeted QA

Use for a specific change, implementation report, bug fix, migration, edge function, or screen.

### 1. Blast Radius

Trace changed file types:

| Changed file | Trace to |
|---|---|
| SQL migration/RLS | Edge/RPC, services, hooks, admin/business, tests, seed/data assumptions |
| Edge function/RPC/webhook | callers, services, hooks, UI, auth/RLS, env vars, deploy |
| Service/client | hooks, components, business/admin equivalents |
| Hook/query key | consuming components, invalidations, persisted cache, sibling hooks |
| Component/screen | parents, routes, states, interactions, accessibility |
| Zustand/AsyncStorage | readers, writers, hydration, logout cleanup |
| Type/constant | all importers, DB constraints, response shapes |
| Payment/order/ticket logic | Stripe/RevenueCat, webhooks, finance, QR, reports, admin/business |

### 2. Claim Verification

For important implementation claims:

`Claim | Source | Evidence checked | Status | Notes`

Status: `verified`, `refuted`, `partial`, `unverified`.

### 3. Layer Reading

Database/RLS:

- Latest migration/schema definition checked.
- RLS enabled where user data exists.
- Policies reject wrong actor.
- Constraints match app assumptions.
- Indexes support key queries.
- Live-data migration/backfill risk addressed.

Edge/RPC/webhook:

- Auth at entry.
- Input validation.
- Structured success/error responses.
- Timeouts and idempotency where needed.
- No secret/PII logging.
- Response shape matches clients.

Services:

- Errors not swallowed.
- `.maybeSingle()` where optional.
- Filters/columns match schema.
- Return type matches hooks.
- No overbroad sensitive selects without reason.

Hooks/state/cache:

- Canonical query keys.
- All result-affecting params included.
- `enabled`, `staleTime`, retry/offline behavior intentional.
- Mutations have `onError`, rollback, and correct invalidation.
- No duplicate truth owners.

Components/screens:

- Loading, error, empty, populated, submitting, offline/permission states.
- No dead taps.
- Async handlers surface errors.
- Copy is truthful.
- Accessibility labels and touch target sanity.
- No fabricated data.

Business/admin/public parity:

- Field names, statuses, permissions, money/order/ticket states agree.
- Admin cannot create states clients cannot render.
- Business/public paths reflect backend contract.

### 4. Constitution Check

Check the 14 `README.md` principles relevant to changed files. Any user-facing critical violation is P0.

### 5. Behavioral Contract Check

If touched, verify exact contract:

- Preferences -> deck.
- Save.
- Schedule validation.
- Session load.
- Auth.
- AI quality gate.
- Exclusion.
- Card display.
- Business payment/order/ticket/QR/finance flows.

### 6. Focused Verification

Use the smallest meaningful evidence:

- Existing tests targeting the change.
- New tests only when risk warrants and user asked for QA depth.
- Lint/typecheck/build where useful.
- SQL/RLS reasoning or read-only queries if configured.
- Manual test recipe when device/secrets/runtime block automation.

### 7. Parity

Consider:

- Solo and collab.
- Mobile and business.
- Admin and public web.
- iOS and Android.
- Cold start and warm cache.
- Authenticated, logged-out, wrong actor, admin, service role.

### 8. Verdict

- `PASS`: all relevant criteria verified.
- `CONDITIONAL PASS`: no blockers, named conditions remain.
- `FAIL`: blocker or failed core criterion.
- `BLOCKED/UNVERIFIED`: insufficient environment/evidence.

## Spec-Compliance Mode

1. Extract every spec criterion.
2. Find exact implementation evidence for each.
3. Verify behavior and failure path where feasible.
4. Identify code that exceeds or contradicts scope.
5. Produce matrix:

`Criterion | Evidence | Status | Test/verification | Finding`

Statuses: `implemented`, `partial`, `not implemented`, `incorrect`, `unverified`.

Core criteria that are `partial`, `not implemented`, or `incorrect` usually mean `FAIL`.

## Retest Mode

1. Read prior QA report and failed findings.
2. Read rework implementation/report.
3. Verify each previous finding is fixed in code and behavior.
4. Check the fix did not mask the bug or regress adjacent paths.
5. Re-run or restate the previously failing check.
6. If retest cycle is 3+, flag as stuck for orchestrator.
