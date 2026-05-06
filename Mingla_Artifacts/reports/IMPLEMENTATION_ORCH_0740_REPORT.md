# IMPL REPORT — ORCH-0740 — Cross-device sync Cycle 1 (Foundation)

**Mode:** IMPLEMENT (binding spec — paste verbatim where indicated)
**Dispatch:** [`prompts/IMPL_ORCH_0740_CROSS_DEVICE_SYNC_FOUNDATION.md`](../prompts/IMPL_ORCH_0740_CROSS_DEVICE_SYNC_FOUNDATION.md)
**SPEC (BINDING):** [`specs/SPEC_ORCH_0740_CROSS_DEVICE_SYNC_FOUNDATION.md`](../specs/SPEC_ORCH_0740_CROSS_DEVICE_SYNC_FOUNDATION.md)
**Investigations:** [`reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md`](INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md) + [`reports/INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md`](INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md)
**Closes (after operator UI smoke + tester PASS):** RC-B (zero focusManager) + HF-1 (RQ cache not cleared on signOut) + CF-2 (hardcoded role-cache key) + partial CF-1 (5min role staleTime → 30s)
**Authored:** 2026-05-06 by mingla-implementor
**Status:** `implemented, partially verified` — all 4 code edits made; tsc=0; web build PASSES; 4 CI gates PASS; UI smoke (background→foreground refetch + signOut RQ-clear) awaiting operator force-reload + Metro test.

---

## 1. Layman summary

- Wired AppState → React Query's focusManager so backgrounded apps refetch when foregrounded — single 9-line useEffect at app root, works on iOS + Android + Expo Web with the same code.
- Added `queryClient.clear()` to BOTH signOut paths (button + onAuthStateChange SIGNED_OUT) so the React Query cache is wiped alongside the existing Zustand reset.
- Added `brandRoleKeys.allForBrand(brandId)` factory member and refactored the one hardcoded `["brand-role", brandId]` site to use it. Constitutional #4 honored.
- Tightened `useCurrentBrandRole` staleTime from 5 minutes to 30 seconds — defense-in-depth on permission-bearing cache until Cycle 3 wires Realtime push.

Status: implemented, partially verified · Verification: tsc=0 + web bundle exports cleanly + all 4 CI gates PASS · UI smoke awaiting operator.

---

## 2. Sites patched

| # | File | Change | Lines |
|---|---|---|---|
| 1 | `mingla-business/src/hooks/useCurrentBrandRole.ts` | Tightened `STALE_TIME_MS` from 5min to 30s + added 4-line comment block; added `allForBrand(brandId)` factory member to `brandRoleKeys` (4 lines code + 3 comment) | +11 / -1 |
| 2 | `mingla-business/src/hooks/useBrands.ts` | Added import `import { brandRoleKeys } from "./useCurrentBrandRole";` + 3-line comment block; replaced hardcoded `["brand-role", brandId]` at line 304 with `brandRoleKeys.allForBrand(brandId)` (1-line replacement + 1 line comment update) | +5 / -1 |
| 3 | `mingla-business/src/context/AuthContext.tsx` | Added `import { queryClient } from "../config/queryClient";` + 6-line comment block; added `queryClient.clear()` calls in BOTH signOut paths (line 158 region after `clearAllStores()` + line 456 region after `clearAllStores()`) with 3-line comments at each site | +13 / -0 |
| 4 | `mingla-business/app/_layout.tsx` | Added imports: `AppState`, `AppStateStatus` from `react-native`; `focusManager` from `@tanstack/react-query`; added 11-line `useEffect` block in `RootLayoutInner` placed AFTER splash-hide useEffect and BEFORE eviction useEffect | +13 / -2 |
| 5 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0740_REPORT.md` | NEW — this report | (this file) |

**Code change total: ~42 lines added, 4 lines removed, net +38 across 4 source files.** (Higher than the SPEC's "12 functional lines" estimate because comments contribute substantially — every change documents Cycle 1 reasoning + Constitutional impact for future readers.)

---

## 3. Old → New Receipts

### `mingla-business/src/hooks/useCurrentBrandRole.ts` (lines 59-65 region)

**What it did before:**
- `STALE_TIME_MS = 5 * 60 * 1000` (5 min) for role-cache freshness
- `brandRoleKeys` factory had 2 members: `all` and `byBrand(brandId, userId)` — used internally by the hook's query
- No factory member for prefix-match removeQueries (consumers had to hardcode `["brand-role", brandId]` literal)

**What it does now:**
- `STALE_TIME_MS = 30 * 1000` (30 sec) per ORCH-0740 SPEC §3.4 — defense-in-depth tightening on permission-bearing cache
- `brandRoleKeys` factory has 3 members: `all` + `byBrand(brandId, userId)` + new `allForBrand(brandId)` — the new member returns `["brand-role", brandId]` for prefix-match invalidation across all user variants of the role cache for a brand
- 4-line comment block on the staleTime change citing ORCH-0738 CF-1 + Cycle 3 Realtime path; 3-line comment on the new `allForBrand` factory member explaining the prefix-match use case

**Why:** SPEC §3.3 + §3.4 verbatim. Constitutional #4 (one query key per entity) — single factory + single source of truth for brand-role cache keys.

**Lines changed:** +11 / -1.

### `mingla-business/src/hooks/useBrands.ts` (lines 39-50 region + line 304 region)

**What it did before:**
- Imports block (lines 28-39) included supabase + brandsService imports; no factory imports from sibling hook files
- Line 304 (in `useSoftDeleteBrand.onSuccess`): `queryClient.removeQueries({ queryKey: ["brand-role", brandId] })` — hardcoded 2-element literal that incidentally worked via React Query's prefix-match against the actual 3-element key `["brand-role", brandId, userId]`
- Constitutional #4 (one query key per entity) — narrowly violated in this one site

**What it does now:**
- Imports block adds `import { brandRoleKeys } from "./useCurrentBrandRole";` + 3-line comment block citing Constitutional #4
- Line 304 region: `queryClient.removeQueries({ queryKey: brandRoleKeys.allForBrand(brandId) })` — uses the factory; comment line above updated to mention the ORCH-0740 refactor
- Behaviorally IDENTICAL — the new factory call returns the same 2-element prefix key shape, so prefix-match against the 3-element actual key still removes all variants. No semantic change.

**Why:** SPEC §3.3 verbatim. Constitutional #4 closed; CF-2 from ORCH-0738 honored.

**Lines changed:** +5 / -1.

### `mingla-business/src/context/AuthContext.tsx` (lines 17-26 region + line 154-159 region + line 453-457 region)

**What it did before:**
- Imports included `clearAllStores` (line 20) but no `queryClient` import
- Line 158 (onAuthStateChange SIGNED_OUT branch): only `clearAllStores()` fired — Zustand cleared, React Query cache survived
- Line 456 (signOut callback): only `clearAllStores()` fired — same pattern
- Constitutional #6 (logout clears everything) honored at Zustand layer but NOT at React Query layer (HF-1 from ORCH-0738)

**What it does now:**
- Imports adds `import { queryClient } from "../config/queryClient";` + 6-line comment block explaining the HF-1 closure
- Line 158 region: `clearAllStores()` is followed by `queryClient.clear();` (with 2-line ORCH-0740 comment)
- Line 456 region: `clearAllStores()` is followed by `queryClient.clear();` (with 3-line ORCH-0740 comment)
- BOTH signOut paths now reset Zustand AND React Query cache. Constitutional #6 fully honored.

**Why:** SPEC §3.2 verbatim. HF-1 from ORCH-0738 closed.

**Lines changed:** +13 / -0.

### `mingla-business/app/_layout.tsx` (lines 19-29 region imports + new useEffect at lines 76-91 region)

**What it did before:**
- Imports: Stack, Gesture/Safe wrappers, QueryClientProvider, Sentry, SplashScreen, AuthProvider/useAuth, queryClient, ErrorBoundary
- `RootLayoutInner` component had 3 useEffects: splash-hide gating on auth+timer, ended-event TTL eviction, orphan-key reaper
- AppState was NOT imported anywhere in the file — React Query foregrounding was a no-op on RN

**What it does now:**
- Imports add: `AppState`, `AppStateStatus` from `react-native`; `focusManager` from `@tanstack/react-query` (joined the existing `QueryClientProvider` import line into a destructure of both)
- `RootLayoutInner` has 4 useEffects — the NEW focusManager-AppState wiring is placed as the FIRST useEffect AFTER the splash-hide useEffect AND BEFORE the eviction useEffect, mirroring SPEC §3.1 placement requirement
- The new useEffect: subscribes to `AppState.addEventListener('change', ...)`, maps `'active'` to `focusManager.setFocused(true)` (other states map to `false`), unsubscribes on unmount

**Why:** SPEC §3.1 verbatim. Closes RC-B from ORCH-0738. Cross-platform via react-native-web 0.21.0 shim (AppState 'change' events map to `document.visibilitychange` + `window.focus`/`blur` on web).

**Lines changed:** +13 / -2.

---

## 4. Verification

### TypeScript

```
$ cd mingla-business && npx tsc --noEmit
[exit 0, no output]
EXIT=0
```

✅ PASS — all 4 modified files compile cleanly.

### Web bundle (`expo export -p web`)

```
$ cd mingla-business && npx expo export -p web 2>&1 | tail -20
... [32+ routes bundled, sizes shown]
Exported: dist
```

✅ PASS — full SPA bundle generated successfully. SC-7 verified.

### CI gate `I-PROPOSED-A` (brands queries filter deleted_at)

```
$ node .github/scripts/strict-grep/i-proposed-a-brands-deleted-filter.mjs
I-PROPOSED-A gate: scanned 12 .ts/.tsx files · 0 violations · 0 parse failures
```

✅ PASS

### CI gate `I-PROPOSED-C` (no setBrands callers)

```
$ node .github/scripts/strict-grep/i-proposed-c-brand-crud-via-react-query.mjs
I-PROPOSED-C gate: scanned 186 .ts/.tsx files · 0 violations · 0 read failures
```

✅ PASS

### CI gate `I-PROPOSED-H` (RLS-RETURNING-OWNER-GAP-PREVENTED)

```
$ node .github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs
[I-PROPOSED-H] Auditing C:\Users\user\Desktop\mingla-main\supabase\migrations ...
[I-PROPOSED-H] Scanned 1 table(s) with mutation policies; found 1 direct-predicate owner-SELECT policy/policies across all tables.
[I-PROPOSED-H] PASS — no RLS-RETURNING-OWNER-GAP violations found.
```

✅ PASS

### CI gate `I-PROPOSED-I` (MUTATION-ROWCOUNT-VERIFIED)

```
$ node .github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs
[I-PROPOSED-I] Auditing C:\Users\user\Desktop\mingla-main\mingla-business\src\services ...
[I-PROPOSED-I] Scanned 4 mutation site(s); 4 compliant; 0 violation(s).
[I-PROPOSED-I] PASS — no MUTATION-ROWCOUNT-VERIFIED violations found.
```

✅ PASS

---

## 5. Spec Traceability — SC-1..SC-10

| SC | Statement | Verification | Evidence |
|---|---|---|---|
| SC-1 | App backgrounds + foregrounds → React Query refetches | UNVERIFIED — operator UI smoke required | focusManager.setFocused(true) wiring in app root verified via static-trace; runtime behavior depends on Metro reload + manual test |
| SC-2 | signOut clears RQ cache + Zustand stores | STATIC-TRACE verified | Both `clearAllStores()` + `queryClient.clear()` calls present in BOTH signOut paths (button callback + onAuthStateChange SIGNED_OUT branch) |
| SC-3 | useSoftDeleteBrand.onSuccess uses factory | STATIC-TRACE verified | `useBrands.ts` line 304 region now imports + uses `brandRoleKeys.allForBrand(brandId)` |
| SC-4 | useCurrentBrandRole staleTime is 30s | STATIC-TRACE verified | `useCurrentBrandRole.ts` line 63 region: `STALE_TIME_MS = 30 * 1000` |
| SC-5 | Cross-device permission cache refresh within 60s | UNVERIFIED — operator multi-device test | Combination of new 30s staleTime + new focusManager wiring delivers this; runtime cross-device verification needed |
| SC-6 | tsc=0 | VERIFIED | See §4 TypeScript check |
| SC-7 | Web bundle still builds | VERIFIED | See §4 expo export -p web |
| SC-8 | All existing CI gates pass | VERIFIED | See §4 — all 4 gates exit 0 |
| SC-9 | Zero new Platform.OS branches | VERIFIED via diff inspection | No `Platform.OS === 'web'` branches added by this fix; the existing 5 in mingla-business code (auth/payment/keyboard UI) remain unchanged |
| SC-10 | Diagnostic marker count unchanged | VERIFIED via diff inspection | No `[ORCH-XXXX-DIAG]` markers added or removed by this fix |

---

## 6. Invariant Preservation Check

| Invariant | Status |
|---|---|
| Constitutional #2 One owner per truth | ✅ unchanged |
| **Constitutional #4** One query key per entity | ✅ **IMPROVED** — CF-2 closed; brandRoleKeys is single source of truth for brand-role cache keys |
| Constitutional #5 Server state stays server-side | ✅ unchanged (Cycle 2 will tighten currentBrand) |
| **Constitutional #6** Logout clears everything | ✅ **IMPROVED** — HF-1 closed; queryClient.clear() now fires alongside clearAllStores() in both signOut paths |
| Constitutional #14 Persisted-state startup | ✅ unchanged |
| I-PROPOSED-A BRAND-LIST-FILTERS-DELETED | ✅ unchanged (CI gate confirms) |
| I-PROPOSED-C BRAND-CRUD-VIA-REACT-QUERY | ✅ unchanged (CI gate confirms) |
| I-PROPOSED-D MB-ERROR-COVERAGE | ✅ unchanged |
| I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED | ✅ unchanged (CI gate confirms) |
| I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED | ✅ unchanged (CI gate confirms) |
| I-37 / I-38 / I-39 (TopBar / IconChrome / Pressable) | ✅ unchanged (no UI changes in this cycle) |

---

## 7. Parity Check

N/A — mingla-business is single-mode (no solo/collab distinction). Cross-platform parity (RN + web) verified by §4 expo export PASS.

---

## 8. Cache Safety

### Query keys changed

- **`["brand-role", brandId]`** (literal, hardcoded in useSoftDeleteBrand.onSuccess) → **`brandRoleKeys.allForBrand(brandId)`** (factory call)
  - **Functional behavior:** IDENTICAL. Both produce the same 2-element array `["brand-role", brandId]`. React Query's prefix-match against the 3-element actual key `["brand-role", brandId, userId]` works the same way.
  - **Risk:** Zero. Pure cosmetic/architectural cleanup.

### Mutation cache invalidation

- `useSoftDeleteBrand.onSuccess` cache invalidation behavior is BIT-IDENTICAL. The migration just routes the same key shape through the factory.
- `queryClient.clear()` in signOut paths is NEW — but it fires AFTER signOut completes (or after server-side SIGNED_OUT detected), so no race condition with active mutations.
- focusManager useEffect doesn't invalidate any specific keys; it just signals React Query that refetch-on-focus should fire for stale queries with `refetchOnWindowFocus: true` (default).

### Persisted AsyncStorage shape

- Zero changes to AsyncStorage keys or shapes. `clearAllStores()` reset behavior unchanged. Persist version numbers unchanged.

---

## 9. Regression Surface

3-5 adjacent features the tester should verify:

1. **Brand-create / brand-delete (post-ORCH-0734-RW)** — the `useSoftDeleteBrand.onSuccess` cache cleanup now uses the factory. Functionally identical to before. Verify Create + Delete still work.
2. **Sign in / sign out cycle** — verify both signOut paths (button + token-revoke) clear Zustand AND React Query cache. After sign-out, sign-in as same user should fetch fresh data; sign-in as different user should not see prior user's cached data.
3. **App background/foreground refetch** — open app, navigate to brand list (any React Query consumer), background app for >30s, foreground → confirm Metro shows refetch network requests.
4. **Permission-gated UI** — anywhere the role-cache governs button enable/disable. After 30s, role data may refetch; verify UI doesn't flicker incorrectly.
5. **Web build runtime** — open `dist/` static SPA in a browser locally, sign in, navigate, confirm no console errors related to AppState/focusManager.

---

## 10. Constitutional Compliance

| Rule | Status |
|---|---|
| #1 No dead taps | unchanged |
| #2 One owner per truth | unchanged |
| #3 No silent failures | unchanged |
| **#4 One query key per entity** | ✅ **IMPROVED** (CF-2 closed) |
| #5 Server state stays server-side | unchanged (Cycle 2 will further tighten currentBrand) |
| **#6 Logout clears everything** | ✅ **IMPROVED** (HF-1 closed; both Zustand AND React Query cleared on signOut) |
| #7 Label temporary fixes | ✅ — comments inline cite ORCH-0740 + Cycle 3 exit conditions |
| #8 Subtract before adding | ✅ — replaced hardcoded literal with factory call (no new abstraction added) |
| #9 No fabricated data | unchanged |
| #10 Currency-aware UI | unchanged |
| #11 One auth instance | unchanged |
| #12 Validate at right time | unchanged |
| #13 Exclusion consistency | unchanged |
| #14 Persisted-state startup | unchanged |

No constitutional principles violated. Two improvements (#4, #6).

---

## 11. Discoveries for Orchestrator

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| **D-IMPL-0740-1** | **SPEC line-number drift confirmed.** The hardcoded `["brand-role", brandId]` was at line 304 in `useBrands.ts` (not line 292 as SPEC §3.3 referenced). Same `useSoftDeleteBrand.onSuccess` block — substantively unchanged; just a regional reference. Implementor identified + handled correctly. Forensics SPEC §3.3 already noted "line 292 region" as approximate. | S4 (process note) | None — confirm at REVIEW. SPEC has already been delivered + reviewed. |
| D-IMPL-0740-2 | The dispatch noted `clearAllStores()` already fires in BOTH signOut paths (line 158 + line 456). Implementor mirrored that pattern exactly: `queryClient.clear()` now fires immediately after `clearAllStores()` in BOTH paths. Symmetric implementation per SPEC §3.2. | S4 (process note) | None |
| D-IMPL-0740-3 | The web build bundles successfully with the new focusManager wiring. ✅ confirmed via `npx expo export -p web` exit 0. SC-7 verified. The runtime behavior of focusManager on web (responding to `document.visibilitychange`) is library-confirmed but not runtime-tested in this dispatch — operator can verify by opening dist locally + testing tab-switch. | S4 (verification note) | Optional: operator runs local web build for one final sanity check |
| D-IMPL-0740-4 | The 11 in-flight `[ORCH-XXXX-DIAG]` markers in mingla-business code remain untouched (cleanup tracked separately). | S2 (already tracked) | Schedule diagnostic-marker cleanup post-CLOSE for Cycle 1 |
| D-IMPL-0740-5 | The new `brandRoleKeys.allForBrand` factory member returns `["brand-role", brandId]` — bit-identical to the previous hardcoded literal. Zero behavioral change at the cache layer. The refactor is purely architectural cleanup (Constitutional #4). | S4 (cache safety confirmation) | None |

---

## 12. Transition items

- The 11 in-flight `[ORCH-XXXX-DIAG]` markers (10 from prior cycles + 0 added by Cycle 1; total 11) remain in the codebase for separate post-CLOSE cleanup.
- The 30s staleTime on `useCurrentBrandRole` is TRANSITIONAL until Cycle 3 wires Realtime push for `brand_team_members` changes — at which point staleTime can relax back to 5min. Comment block in `useCurrentBrandRole.ts:59-63` documents this exit condition.

No `[TRANSITIONAL]` code comments added by Cycle 1 (the staleTime comment cites Cycle 3 inline but doesn't use the formal `[TRANSITIONAL]` marker since the value itself is correct for production posture; only the rationale changes when Cycle 3 lands).

---

## 13. Operator post-IMPL workflow

1. **Review this report** + diff each artifact (~38 net lines across 4 source files).
2. **No `supabase db push` needed** — pure code-side fix.
3. **Force-reload Metro** (shake device → Reload, or Cmd+D in simulator).
4. **Run the SC-1 + SC-2 + SC-3 + SC-4 quick-smoke:**
   - Open app, navigate to any brand-related surface
   - Background the app for ≥30 seconds (lock screen, switch to another app, or minimize browser tab)
   - Bring the app back to foreground → confirm Metro shows refetch network requests for any active queries (SC-1)
   - Sign out → confirm React DevTools queryClient is empty (SC-2)
   - Tap delete on a brand (if any exist) → confirm role cache cleared (SC-3 — implicit)
   - Open useCurrentBrandRole DevTools → confirm 30s staleTime applied (SC-4 — implicit)
5. **Optional: web build sanity check.** `cd mingla-business && npx expo start --web` → load in browser → background tab for 30s → return → confirm refetch.
6. **Paste Metro output** for orchestrator REVIEW.
7. **Orchestrator dispatches mingla-tester** for full PASS verification.
8. **On PASS:** orchestrator runs CLOSE protocol → Cycle 2 SPEC dispatch.

---

## 14. Status summary

**Status:** `implemented, partially verified` — 4 source files modified + 1 NEW report; tsc=0; web bundle exports cleanly; all 4 CI gates PASS; SC-2..SC-4 + SC-6..SC-10 verified statically/locally; SC-1 + SC-5 require operator UI smoke + multi-device test.

**Confidence:** HIGH that this implementation faithfully realizes SPEC §3.1-§3.4 verbatim. All 4 changes are mechanical drop-ins matching the SPEC's verbatim before/after blocks. Cross-platform parity confirmed by `expo export -p web` PASS.

**Risks:**
- focusManager runtime behavior on web is library-confirmed but not runtime-tested in this dispatch. Operator can verify by tab-switching in `expo start --web` or browsing the static `dist/` build.
- The new `queryClient.clear()` in signOut paths is correct per SPEC but a regression surface adjacent feature should re-verify (no in-flight mutations should be killed mid-flight by signOut, but a fast tap-then-signOut sequence could in theory race; operator UX testing covers).

---

## 15. Failure honesty label

`implemented, partially verified` — 4 files modified per SPEC verbatim; tsc=0; web build PASSES; all 4 CI gates PASS; SC-2/3/4/6/7/8/9/10 verified locally via static-trace + tooling; SC-1 (background→foreground refetch) + SC-5 (cross-device permission refresh) require operator runtime verification.

---

**End of report.**

**Awaiting:** orchestrator REVIEW → operator force-reload Metro + UI smoke → tester dispatch → PASS → CLOSE protocol → Cycle 2 SPEC dispatch.
