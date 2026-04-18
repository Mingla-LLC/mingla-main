# Implementation Report: ORCH-0489 — Admin-UI "Refresh Stats" button

**Status:** implemented and build-verified (device-runtime manual test deferred to tester)
**Date:** 2026-04-18
**Files changed:** 1 file modified, 0 created
**Spec:** `Mingla_Artifacts/prompts/IMPL_ORCH-0489_ADMIN_REFRESH_BUTTON.md`

---

## Layman Summary

- **New button in the admin Place Pool page header** — reads "Refresh stats" with a rotate-counterclockwise icon. Clicking it calls the existing `admin_refresh_place_pool_mv()` RPC, which refreshes the materialized view admin stats read from. Expected runtime: 30s–2min.
- **Replaces the silently-failing pg_cron** — the cron that was supposed to refresh every 10 min has not fired once in 4+ hours (ORCH-0481 cycle 2). Admin now has explicit, visible control over freshness.
- **No cron changes, no migration, no mobile** — admin web change only. Supabase RPC already live.

---

## Files Changed

### `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

**What it did before:** `OverviewTab` component rendered scope header (`"Showing {scopeLabel}"`) in a plain `<p>` tag with no action affordance. Admin users had no way to force a refresh of the materialized view; stats shown could be hours or days stale since pg_cron auto-refresh is broken (ORCH-0481 cycle 2 FAIL).

**What it does now:** Adds:
- `refreshing` state flag (new `useState`).
- `handleRefreshStats` useCallback that calls `supabase.rpc("admin_refresh_place_pool_mv")`, shows a success or error toast based on RPC result + auth error detection, and on success re-fires the tab's `fetchData()` so the admin sees updated numbers immediately.
- A `<Button size="sm" variant="secondary" icon={RotateCcw}>` placed in a new flex header row next to the scope label, right-aligned. Button shows "Refreshing…" text + built-in spinner when loading, "Refresh stats" when idle.

**Why:** ORCH-0489 SC-1 through SC-8.

**Lines changed:** ~35 lines added (state decl + useCallback handler + toast branches + JSX block), 0 removed (header `<p>` wrapped inside new flex row, no existing behavior modified).

---

## Spec Traceability

| SC | Criterion | How I implemented it | Verdict |
|----|-----------|---------------------|---------|
| SC-1 | Button renders in idle state on page load | `<Button ...>Refresh stats</Button>` rendered in OverviewTab header; no conditional gating on load | **PASS by construction** (verified via build; visible render deferred to tester) |
| SC-2 | Click fires `supabase.rpc('admin_refresh_place_pool_mv')` | Exact call in `handleRefreshStats` line 263 | **PASS** |
| SC-3 | During RPC: button disabled, spinner + "Refreshing…", no double-click | `setRefreshing(true)` → `loading={refreshing}` → Button component's built-in `isDisabled = disabled || loading` handles disable + spinner; button text switches to "Refreshing…" via ternary | **PASS** |
| SC-4 | On success: success toast with row_count + duration, idle state, auto `fetchData()` | Reads `result.row_count` + `result.duration_ms`, formats row count with `toLocaleString()`, formats duration as `(ms/1000).toFixed(1) + 's'`, calls `fetchData()` in success path | **PASS** |
| SC-5 | On error: error toast, idle state, no page reload | `rpcError` check returns early after dispatching error toast; `setRefreshing(false)` runs in `finally` | **PASS** |
| SC-6 | On "Not authorized" specifically: "Admin access required" not raw RPC error | Regex `/not authorized/i.test(rpcError.message)` gates a dedicated auth-error toast title + description | **PASS** |
| SC-7 | Button only renders if user is logged in | Page itself is already auth-gated by the admin dashboard's outer routing; button inherits this | **PASS by inheritance** |
| SC-8 | Meaningful aria-label | `aria-label="Refresh admin stats now"` on the Button | **PASS** |

---

## Key Decisions

### 1. Placed in `OverviewTab` only, not page-wide

The spec was single-file scope but didn't specify which tab or header. I chose `OverviewTab` because:
- It's the default landing tab when admin opens the Place Pool page.
- It displays the stats that go most stale (scope-aware RPC outputs).
- Other tabs (Browse Pool, Map View, Seeding, Photo Management, Stale Review) either don't depend on the MV directly or have their own refresh affordances (Photo Management has a built-in refresh button at line 1447).
- Per the spec: "Exact placement is implementor's judgment."

### 2. Handler placed AFTER `fetchData` declaration

Initial edit placed `handleRefreshStats` before `fetchData` which would have been a use-before-declare error in strict React-linting environments. Reordered so `handleRefreshStats` uses `fetchData` through a proper dep array: `useCallback(..., [addToast, fetchData])`.

### 3. Mounted-ref guard for `setRefreshing` in finally

`setRefreshing(false)` runs in `finally`, guarded by `if (mountedRef.current)` so a refresh completing after the tab is unmounted doesn't trigger a React "setState on unmounted component" warning. Same pattern the existing `fetchData` uses.

### 4. Distinct wording for auth error vs generic error

`/not authorized/i` regex test on the error message surfaces a friendly "Admin access required" title instead of leaking the raw RPC exception. The `admin_refresh_place_pool_mv()` function raises exactly `"Not authorized"` when `auth.email()` isn't in `admin_users`, so the regex hits that path reliably.

### 5. Did NOT add a timeout-specific branch

The spec mentioned a possible "timeout" toast variant ("Refresh is taking longer than expected..."). I didn't implement it because:
- The RPC itself has `statement_timeout=15min` from its proconfig (set by ORCH-0481 cycle 2).
- PostgREST's default timeout (~60s) might kill the HTTP connection before the RPC finishes, but the RPC itself would still complete in the background.
- No easy way to distinguish "timeout" from generic error at the client layer without custom HTTP handling.
- If this becomes a real UX issue (admin reports "I clicked refresh and nothing happened"), we can add the distinction via HTTP status code inspection in a follow-up.

Current generic-error message covers this scenario adequately: "The refresh didn't complete. It may still be running in the background."

### 6. `RotateCcw` icon, not `RefreshCw`

Both are imported. `RefreshCw` is already used in the Photo Management tab (line 1447) for a different refresh action. Using `RotateCcw` here gives a different visual cue — "go back to fresh state" vs "regenerate/reload" — and avoids UI duplication between tabs.

---

## Invariant Preservation Check

| Invariant | Preserved? | Notes |
|-----------|-----------|-------|
| No silent failures (Constitutional #3) | **YES — ESTABLISHED** | This is the primary improvement. Pre-ORCH-0489: pg_cron fails silently every 10 min with no admin visibility. Post-ORCH-0489: user-initiated refresh surfaces success or failure via toast every time. |
| No dead taps (Constitutional #1) | YES | Button disabled during RPC; no click-through |
| Error messages explain what + action | YES | Success toast states exact row count + duration; error toast explains what happened + what to do (or that it's still running) |
| Accessibility | YES | aria-label on button |
| React Query discipline | N/A — not using React Query in this admin page (direct supabase.rpc pattern consistent with the rest of the file) |
| Zustand boundaries | N/A — admin uses React Context, not Zustand |
| One owner per truth | YES — the button calls the single authoritative MV refresh function |

---

## Parity Check

**Not applicable.** Backend-only RPC call + admin web UI. No solo/collab distinction, no mobile pairing.

---

## Cache Safety Check

- No React Query keys involved (admin uses direct `supabase.rpc` calls, not React Query cache).
- The MV itself is the cache. Successful refresh puts it fresh. Failed refresh leaves it stale — same state as before the click.
- `fetchData()` is re-called on success so the page re-reads the fresh MV without a page reload.

---

## Regression Surface (tester should check)

1. **OverviewTab layout doesn't break** — the new flex header row should render without pushing StatCards or other components off-grid. Build succeeded (no JSX errors) but visual regression requires browser check.
2. **Button disable state** — double-click during loading should not fire two RPCs. Loading state guards this.
3. **Toast display** — success / error / auth-error toasts should display correctly per the existing ToastProvider. No custom toast variant introduced.
4. **Page remount behavior** — if admin navigates away mid-refresh, `mountedRef.current` guard prevents setState on unmounted component.
5. **Other tabs of PlacePoolManagementPage.jsx** — Browse Pool, Map View, Seeding, Photo Management, Stale Review — none are modified. Should behave identically to pre-change.
6. **Other admin pages** — zero impact. Change fenced to `OverviewTab` component.

---

## Constitutional Compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | PASS — button responds, disabled during loading prevents dead-tap feel |
| 2 | One owner per truth | PASS |
| 3 | No silent failures | **RESTORED** — user-initiated refresh replaces silent pg_cron failure |
| 4 | One query key per entity | N/A (admin doesn't use React Query) |
| 5 | Server state server-side | PASS |
| 6 | Logout clears everything | N/A (refresh action doesn't persist state) |
| 7 | Label temporary fixes | N/A — no `[TRANSITIONAL]` markers |
| 8 | Subtract before adding | N/A — purely additive |
| 9 | No fabricated data | PASS — success toast shows actual row_count + duration from RPC |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | PASS — supabase client from `../lib/supabase` as used elsewhere in the file |
| 12 | Validate at right time | PASS — RPC auth check runs server-side; client presents results |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A |

---

## Verification Performed

1. **Grep:** `admin_refresh_place_pool_mv` appears in exactly 1 new call site (line 263 in OverviewTab). No duplicates elsewhere.
2. **Build:** `cd mingla-admin && npm run build` succeeded. 2918 modules transformed, 11.93s, zero errors. Only pre-existing warnings (chunk size, Leaflet dynamic import — not related to this change).
3. **Structural:** `refreshing` state + `handleRefreshStats` useCallback + Button JSX all present in OverviewTab, scoped correctly, no lint violations in the diff.

---

## Verification Deferred to Tester (cannot run from this environment)

1. **Visual render** — button appears in header row, layout doesn't break (requires browser).
2. **Click flow** — clicking the button fires RPC, toast displays correctly, page refreshes stats (requires browser + admin login + network tab to verify RPC call).
3. **Auth error path** — test with a non-admin user session to verify "Admin access required" toast displays instead of raw error.
4. **Long-running refresh** — RPC can take up to 2 min on Mingla-dev's MV size. Verify button stays disabled the entire time and success toast eventually appears.
5. **Regression in other tabs** — no behavior changes expected but tester should click through Browse Pool, Map View, Seeding, Photo Management, Stale Review to confirm no layout or interaction breaks.
6. **MV actually refreshes** — before click, note `SELECT COUNT(*) FROM admin_place_pool_mv` and `SELECT COUNT(*) FROM place_pool`. Click button. After success toast, re-query both. MV count should now equal place_pool count (or at least be no older than the click time).

---

## Discoveries for Orchestrator

**None.** Clean implementation, no surprises. The existing `admin_refresh_place_pool_mv()` RPC works as designed (created in ORCH-0481 cycle 0, unchanged since).

One ambient observation (not a new ORCH, just confirmation):
- The broken pg_cron jobid=13 is untouched by this ORCH. It continues to not fire silently, which is now harmless since the refresh button bypasses it entirely. A cleanup ORCH could unschedule the dead cron job, but it's not urgent.

---

## Deploy Path

Admin web dashboard deploys via the normal build pipeline (not covered by this ORCH). Deploy sequence:

1. User reviews this report + the diff.
2. User dispatches tester if further verification is needed.
3. User commits + pushes to trigger the admin dashboard CI/CD (Vercel / Netlify / whatever hosts mingla-admin).
4. Admin users see the new button on their next page load.

No migration, no EAS OTA, no mobile build.

---

## Rollback

Single-commit revert restores the pre-change state. The RPC + MV remain live regardless — only the UI affordance changes.

---

## Summary

- 1 file modified: `mingla-admin/src/pages/PlacePoolManagementPage.jsx`
- 0 files created
- ~35 lines added, 0 removed
- Build passed (2918 modules, 0 errors)
- All 8 spec SCs verified by construction or build; runtime SCs (visual render, click flow, auth error path) need tester confirmation

**Implemented, build-verified. Ready for tester dispatch.** Closes the ORCH-0481 D→A gap on tester PASS.
