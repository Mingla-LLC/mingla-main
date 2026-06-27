# IMPLEMENTATION — META-ORCH-1232 follow-up: fresh-signup brand-create gap

## Problem

The prior fix (commit `104d0a133`, on main + deployed) gated the three brand
mutation hooks on the `isAuthReady` flag via
`awaitAuthReady({ isReady: isAuthReadyGetter })`. That closed brand-create for
EXISTING accounts but NOT for brand-new signups.

PROVEN root cause (live postgres logs + code): on a brand-new signup
(`rambleawaypod@gmail.com`) the DB threw `permission denied for table brands` +
`new row violates row-level security policy for table "creator_accounts"` — the
insert ran as the **anon role with no JWT attached**. On a fresh signup
`isAuthReady` flips true a beat BEFORE the Supabase client attaches the access
token to outgoing PostgREST requests, so an insert fired on the flag still goes
out as anon. The READ path (`brandsService.getBrands`, H3) already verifies a
real session via `supabase.auth.getSession()` before proceeding; the WRITE path
trusted only the flag. That asymmetry was the bug.

## The fix — write gate now verifies the REAL session token (not just the flag)

### `mingla-business/src/utils/authReadyGate.ts`

1. **`awaitAuthReady` now accepts an ASYNC `isReady`** (`() => boolean | Promise<boolean>`).
   The readiness check is always `await`ed (`if (await isReady()) return;` and
   inside the poll loop). Existing flag-based (sync) callers keep working
   unchanged — a sync boolean is a resolved promise under `await`.

2. **New sibling `awaitSessionAttached(getSession, options?)`.** It builds an
   async readiness check `hasToken()` that calls `getSession()` and returns true
   only when `session !== null` AND `session.access_token` is a NON-EMPTY string,
   then delegates to the same bounded-poll `awaitAuthReady` (≤`AUTH_READY_WAIT_CAP_MS`
   = 5s cap, `AUTH_READY_POLL_INTERVAL_MS` = 100ms poll). Cap-elapse throws
   `AuthNotReadyError` (visible, retryable; never a silent anon drop).
   `getSession()` is a LOCAL read (no network round-trip).

### `mingla-business/src/hooks/useBrands.ts`

- Import line ~36: added `awaitSessionAttached` to the existing
  `authReadyGate` import.
- `useCreateBrand` mutationFn (~L305-L312): after the existing
  `await awaitAuthReady({ isReady: isAuthReadyGetter })`, added
  `await awaitSessionAttached(() => supabase.auth.getSession());` before
  `createBrand(input, "owner")`.
- `useUpdateBrand` mutationFn (~L399-L404): same `awaitSessionAttached` call
  added before `updateBrand(...)`.
- `useCreateVenueBrand` mutationFn (~L646-L652): same `awaitSessionAttached`
  call added before `createVenueBrandPendingReview(...)`.

All three use the SAME `supabase` client singleton (`../services/supabase`,
already imported) that the service layer issues the insert with, so the readiness
check reflects the exact client that will perform the write.

## How it differs from the flag-only gate

| | Flag-only gate (prior 104d0a133) | This fix |
|---|---|---|
| Signal | `isAuthReady` boolean from `useAuth()` | `supabase.auth.getSession()` → non-empty `access_token` |
| Sync/async | sync | async (`getSession` is a promise) |
| Fresh signup | flag true before JWT attaches → insert goes out as **anon** → `permission denied for table brands` | poll blocks until the REAL token is attached on the SAME client → insert always carries the JWT |
| On timeout | n/a (passed instantly) | throws `AuthNotReadyError` (H1 surfaces visible, retryable) |

The flag check is retained (belt-and-suspenders, cheap) but is necessary-NOT-
sufficient. The authoritative gate that must pass before any brand insert is the
SESSION-TOKEN presence: it is now impossible for a brand insert to be issued
without an attached access token.

## Gate update — `i-proposed-1232-b-brand-mutations-auth-gated.mjs`

Added `AWAIT_SESSION_ATTACHED_RE` =
`/await\s+awaitSessionAttached\s*\(\s*\(\s*\)\s*=>\s*supabase\.auth\.getSession\s*\(\s*\)\s*\)/`.
The per-hook loop now asserts BOTH `awaitAuthReady` (flag) AND
`awaitSessionAttached(() => supabase.auth.getSession())` (real session) for each
of the 3 mutation hooks (`hook-session-attached` check). Self-test extended with
a `flagOnly` fixture (keeps the flag gate, drops the real-session gate) that must
NOT match the new detector.

### Fails-on-revert proof (real source)

Temporarily removed only the `awaitSessionAttached` line from `useCreateBrand`
(flag gate left intact, simulating the EXACT pre-follow-up state) and ran the gate:

```
OK   [hook-auth-gated]      useCreateBrand awaits auth readiness before the service write
FAIL [hook-session-attached] useCreateBrand does NOT await awaitSessionAttached(() => supabase.auth.getSession()) ...
...
I-PROPOSED-1232-B: 1 violation(s)   exit=1
```

The flag check still passed while the real-session check failed → the gate
catches the precise fresh-signup regression. File restored; gate returns exit=0.

Self-test: `--self-test` → exit 0.

## Verification

- `i-proposed-1232-b` (real source): PASS · violations=0
- `i-proposed-1232-f` (PUBLIC-SAFETY, CLOSE-blocking): PASS · violations=0
  (public buyer routes, connect routes, `usePublicEvents`, `publicEventsService`,
  single-by-id `useBrand` all untouched and ungated)
- Typecheck of changed files (`authReadyGate.ts`, `useBrands.ts`): zero errors
  (pre-existing unrelated `packages/phone-input` module-resolution errors only).
- jest: `authReadyGate.metaOrch1232.test.ts` + `authReadiness.test.ts` →
  14/14 pass (4 new tests appended under `[TEST-MOD-APPROVED META-ORCH-1232]`
  covering async `isReady`, attached-token resolve, empty-token rejection,
  cap-elapse throw, mid-flight token attach).
- regression suites: `metaOrch1232AdversarialGuardChain.tester.test.ts`,
  `useSoftDeleteBrand.orch1062.test.ts`, `orch1004AuthScopedQueryGate.test.ts`
  → 24/24 pass.

## Guards respected

- No public/anon path touched (`i-proposed-1232-f` green).
- No app-mobile / account-deletion / Ari changes.
- Append-only test gate honored: existing test file modified under
  `[TEST-MOD-APPROVED META-ORCH-1232]`.
