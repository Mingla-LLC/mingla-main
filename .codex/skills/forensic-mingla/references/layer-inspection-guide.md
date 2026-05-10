# Layer Inspection Guide

Read actual code. Do not infer behavior from filenames, comments, or old reports.

## Components And Screens

Check:

- Props and types are explicit.
- Loading, error, empty, populated, submitting, offline, and permission-denied states are represented when applicable.
- Conditional rendering cannot hide legitimate empty arrays, zero values, or errors.
- Async event handlers catch and surface failures.
- Buttons and tap targets respond visibly.
- Stale closures in `useCallback`, `useEffect`, and async handlers.
- Navigation follows repo convention, especially custom mobile navigation.
- Mobile uses `StyleSheet.create`; admin/business follow their local styling conventions.
- Text cannot overflow, disappear, or fabricate data.
- Accessibility labels exist for interactive controls.

Red flags:

- `data && <Component />` with no empty/error path.
- `onPress={() => asyncThing()}` with no error handling.
- Disabled controls with no explanation.
- Default ratings, prices, travel times, names, or statuses that look real.

## Hooks And State

Check:

- Query keys use the local factory or canonical registry.
- Keys contain all parameters that affect results.
- Arrays/objects/coordinates in keys are stable and intentional.
- `enabled` gates required dependencies.
- Mutations have `onError`, rollback when optimistic, and invalidate/update the correct keys.
- No inline invalidation race after mutation calls.
- `useEffect` dependencies are complete.
- React Query owns server state; Zustand owns client-only or documented offline state.
- Persisted state has hydration/version/migration behavior.

Red flags:

- Hardcoded query key strings.
- Same entity fetched with multiple keys.
- Mutation succeeds but no invalidation or cache update follows.
- Zustand, Context, and React Query all holding the same server truth.

## Services And Clients

Check:

- Function signatures and return types are explicit.
- Supabase queries use correct filters, selected fields, and actor assumptions.
- Errors are thrown or returned in a documented contract; no fake success.
- `.maybeSingle()` is used when no row is valid.
- Null responses are handled by callers.
- Env vars are present, named consistently, and not logged.

Red flags:

- `catch { return [] }`, `catch { return null }`, or `catch { return true }`.
- Supabase `error` ignored.
- Missing `.eq('user_id', userId)` or equivalent actor filter.
- `select('*')` on sensitive or large tables without reason.

## Edge Functions And RPCs

Check:

- Auth is validated at entry before protected work.
- Role and service-role use are justified.
- Input validation rejects malformed, missing, or wrong-actor requests.
- Response shape and status codes are consistent.
- External calls have timeout/rate-limit/error behavior.
- Idempotency and retries are safe for money, orders, tickets, notifications, and writes.
- Logs do not expose secrets or sensitive payloads.

Red flags:

- No auth check.
- `await req.json()` trusted without validation.
- Service role used for user-scoped reads/writes without explicit guard.
- External API call has no timeout or structured failure.
- Returns HTTP 200 with an error payload for failed mutations.

## Database, RLS, Migrations

Check:

- Grep the full migration chain for every touched table, function, policy, trigger, enum, view, and constraint.
- Latest migration or schema dump is treated as current truth.
- RLS enabled on user data tables.
- Policies cover required SELECT/INSERT/UPDATE/DELETE and reject wrong actors.
- Constraints enforce required data and valid status/enums.
- Foreign keys and cascade/restrict behavior match product intent.
- Indexes cover common filters, joins, and ordering.
- Triggers/RPCs are current and not superseded.

Red flags:

- Citing an early migration without checking later replacements.
- `USING (true)` on user data.
- Missing policy for the operation the app performs.
- Missing foreign key creates orphan risk.
- Status enum or check constraint contradicts code.

## Business, Admin, And Cross-Surface Parity

Check:

- Business app, admin, public web, mobile, edge, and DB agree on field names, statuses, permissions, money states, and visibility rules.
- Operational/admin dependency exists if the user flow needs it.
- Public pages and checkout/order/QR/finance paths match business app assumptions.
- Admin direct Supabase calls respect RLS or use intended privileged clients.

Red flags:

- Mobile fix leaves business/admin stale.
- Admin can create states mobile cannot render.
- Business app writes a status edge functions do not understand.

## Tests And Verification

Check:

- Existing tests cover the touched layer.
- Test names still match behavior.
- Missing tests are called out as production-readiness gaps.
- Verification command is the smallest meaningful one.

Red flags:

- Critical path with no test, no manual reproduction, and no telemetry.
- Snapshot/test only covers happy path while failure path is the bug.
