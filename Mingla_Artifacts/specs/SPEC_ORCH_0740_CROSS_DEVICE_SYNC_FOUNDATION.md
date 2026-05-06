# SPEC — ORCH-0740 — Cross-device sync Cycle 1 (Foundation)

**Authored:** 2026-05-06 by mingla-forensics
**Dispatch:** [`prompts/SPEC_ORCH_0740_CROSS_DEVICE_SYNC_FOUNDATION.md`](../prompts/SPEC_ORCH_0740_CROSS_DEVICE_SYNC_FOUNDATION.md)
**Investigations:** [`reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md`](../reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md) + [`reports/INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md`](../reports/INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md)
**Closes (after IMPL + tester PASS):**
- ORCH-0738 RC-B (zero AppState→focusManager wiring)
- ORCH-0738 HF-1 (React Query cache not cleared on signOut)
- ORCH-0738 CF-2 (hardcoded `["brand-role", brandId]` query key — narrower than dispatched; see §3.3)
- ORCH-0738 CF-1 (useCurrentBrandRole 5min staleTime) — partial: tightened to 30s; full Tier-0 push deferred to Cycle 3
**Status:** BINDING (implementor follows verbatim; deviations require new SPEC version)

---

## 1. Layman summary

Four mechanical changes (~12-15 lines total) that benefit ALL React Query consumers in mingla-business simultaneously, on both React Native AND Expo Web:

1. Wire AppState → React Query's `focusManager` so backgrounded apps refetch when foregrounded
2. Add `queryClient.clear()` to signOut so React Query cache is wiped (Zustand was already cleared via `clearAllStores()`)
3. Export the existing `brandRoleKeys` factory + add a sibling `allForBrand(brandId)` member, refactor the ONE hardcoded site
4. Tighten `useCurrentBrandRole` staleTime from 5 minutes to 30 seconds (defense-in-depth on permission-bearing cache)

Pre-flight verification corrected dispatch A-5: a query-key factory `brandRoleKeys` already exists in `useCurrentBrandRole.ts`, used correctly by the query itself. Only the `useSoftDeleteBrand.onSuccess` removeQueries call hardcodes a 2-element prefix. Net result: smaller change than dispatched (~12 lines instead of 15).

Cross-platform parity: all 4 changes use single code paths that work identically on RN + web via react-native-web shims. No `Platform.OS === 'web'` branching needed.

---

## 2. Scope, Non-goals, Assumptions

### 2.1 Scope

- **mingla-business code only** (zero DB, zero migrations, zero edge functions)
- 5 files modified:
  1. `mingla-business/app/_layout.tsx` (NEW useEffect for focusManager — RootLayoutInner)
  2. `mingla-business/src/context/AuthContext.tsx` (queryClient.clear() in signOut path)
  3. `mingla-business/src/hooks/useCurrentBrandRole.ts` (export brandRoleKeys + add `allForBrand` member + tighten staleTime to 30s)
  4. `mingla-business/src/hooks/useBrands.ts` (refactor useSoftDeleteBrand.onSuccess to import + use the factory)
  5. (NEW report) `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0740_REPORT.md`
- Cross-platform single code path (RN + Expo Web)

### 2.2 Non-goals

- **Cycle 2** (`currentBrand` ID-only persistence) — separate cycle
- **Cycle 3** (Realtime push) — separate cycle (will add web-specific reconnect handler then)
- **Cycle 4** (per-store Zustand classification for the 10 remaining persisted stores) — separate cycle
- **Events backend integration** (B-cycle backend) — entirely future
- **New CI gates** — none added in Cycle 1; existing 8 gates (I-PROPOSED-A through I) cover the patterns this cycle touches
- **Cleanup of in-flight diagnostic markers** — separate post-PASS dispatch (10+1 markers tracked)
- **`Platform.OS === 'web'` branching** — explicitly REJECTED unless absolutely required (see §3.5 for verification this isn't needed)

### 2.3 Assumptions (verified during pre-flight)

- **A-1 ✅ verified:** react-native-web 0.21.0 shims `AppState.addEventListener('change', ...)` to `document.visibilitychange` + `window.focus`/`blur` events. State values map: 'active' on visibility-visible/window-focused, 'background' otherwise. Tested via library documentation; runtime verification recommended in T-1.
- **A-2 ✅ verified:** React Query's `focusManager.setFocused(boolean)` is the canonical API. Calling with `true` triggers refetch on stale queries with `refetchOnWindowFocus: true` (default).
- **A-3 ✅ verified:** `queryClient.clear()` removes all cached query data without re-fetching. Idempotent.
- **A-4 ✅ verified:** `clearAllStores()` (`mingla-business/src/utils/clearAllStores.ts:30-42`) covers all 11 persisted Zustand stores. Already wired in AuthContext at line 158 (onAuthStateChange SIGNED_OUT) + line 456 (signOut callback).
- **A-5 ❌ DISPATCH ASSUMPTION CORRECTED:** `useCurrentBrandRole.ts` already exports a factory `brandRoleKeys` (lines 61-65) used correctly by the hook's query. The hardcoded key violation is narrower than dispatched — only the removeQueries call at `useBrands.ts:292` is hardcoded. Pre-flight discovery; SPEC §3.3 reflects corrected prescription.
- **A-6 ✅ verified:** `RootLayoutInner` at `mingla-business/app/_layout.tsx:56` is the canonical app-root inside QueryClientProvider AND inside AuthProvider. Already has 3 useEffects gated on `loading` from AuthContext. focusManager useEffect sits alongside them naturally.
- **A-7 ✅ verified:** queryClient is a shared singleton at `mingla-business/src/config/queryClient.ts` (imported by `_layout.tsx:27`). AuthContext.signOut can import + use the same singleton directly without `useQueryClient` hook.

---

## 3. Layer-by-layer specification

### 3.1 — App root: focusManager wiring

**File:** `mingla-business/app/_layout.tsx`

**Component:** `RootLayoutInner` (lines 56-...)

**Changes:**

1. Add imports at the top of the file (after existing imports, around line 28):

```ts
import { focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";
```

2. Add the following useEffect inside `RootLayoutInner`, AFTER the existing splash-hide useEffect and BEFORE the eviction useEffect (anywhere among the other root-level effects is fine; before the splash effect is also acceptable). Implementor: place it as the FIRST useEffect after `mountedAt`/`splashHidden` state declarations, with a comment marking it as Cycle 1 cross-device sync foundation.

```ts
// ORCH-0740 Cycle 1: AppState → React Query focusManager wiring.
// When the app comes back to foreground, tell React Query to refetch
// stale queries that have refetchOnWindowFocus enabled (the default).
// Cross-platform: react-native-web 0.21.0 shims AppState 'change' events
// to document.visibilitychange + window.focus/blur, so this single code
// path works identically on iOS, Android, and Expo Web.
useEffect(() => {
  const handleAppStateChange = (status: AppStateStatus): void => {
    focusManager.setFocused(status === "active");
  };
  const subscription = AppState.addEventListener("change", handleAppStateChange);
  return (): void => {
    subscription.remove();
  };
}, []);
```

**Lines added:** ~10 (3 import lines + 1 blank + 1 comment line + ~7-line useEffect block).

**Why this works on web:** react-native-web's `AppState` polyfill listens to `document.visibilitychange` and `window.focus`/`blur` events on the global `window` object. When the user switches tabs / brings the browser window back, `'change'` fires with status `'active'`. No platform branching required.

**Why explicit AppState (not relying on RQ's default `refetchOnWindowFocus`):** React Query's default `refetchOnWindowFocus: true` is wired to browser `window.focus`/`blur` events directly. On native React Native, no `window` events fire — so the default is a no-op. The `focusManager.setFocused()` call is the canonical RN integration that bridges AppState → React Query's internal focus tracking. (On web, this bridge is also useful because react-native-web's AppState polyfill is the single source of truth — keeps both platforms on the same code path.)

### 3.2 — AuthContext: queryClient.clear() on signOut

**File:** `mingla-business/src/context/AuthContext.tsx`

**Changes:**

1. Add import near top (with existing imports, around line 21 region):

```ts
import { queryClient } from "../config/queryClient";
```

2. In the `signOut` callback (line 441-457 region), AFTER the existing `clearAllStores()` call at line 456 AND BEFORE the closing brace, add:

```ts
// ORCH-0740 Cycle 1: clear React Query cache on signOut.
// Companion to clearAllStores() — Zustand was previously the only layer
// reset on signOut, leaving React Query cache as a Constitutional #6
// leak (HF-1 from ORCH-0738). queryClient.clear() removes all cached
// query data without triggering refetches; the next mount on the
// post-signOut welcome screen creates a fresh queryClient consumer.
queryClient.clear();
```

3. Same addition in the `onAuthStateChange` SIGNED_OUT branch at line 158 region (mirror the existing `clearAllStores()` placement to keep both signOut paths symmetric):

```ts
// ORCH-0740 Cycle 1: companion to clearAllStores() — also clear RQ cache
// when signOut happens server-side (token revoked, session expired)
// without going through our signOut() button.
queryClient.clear();
```

**Lines added:** ~6 (1 import + 2 useful comments + 2 calls + 1 blank).

**Why direct singleton import (not useQueryClient hook):** AuthProvider exposes signOut as a callback referenced via `useCallback`. Avoiding the hook call inside the callback simplifies dependency tracking AND signOut being callable from contexts where hook rules don't apply. The shared singleton at `src/config/queryClient.ts` is the same instance used by `<QueryClientProvider client={queryClient}>` in `_layout.tsx`.

### 3.3 — `brandRoleKeys` factory: export + add `allForBrand` + refactor consumer

**Pre-flight discovery:** `useCurrentBrandRole.ts` already declares + uses `brandRoleKeys` (lines 61-65). The Constitutional #4 violation is narrower than dispatched — only `useBrands.ts:292` (`useSoftDeleteBrand.onSuccess` removeQueries call) hardcodes the literal `["brand-role", brandId]` 2-element prefix.

**File 1:** `mingla-business/src/hooks/useCurrentBrandRole.ts`

**Change at lines 61-65:** Add `export` keyword (already missing) + new factory member `allForBrand`:

Before:
```ts
export const brandRoleKeys = {
  all: ["brand-role"] as const,
  byBrand: (brandId: string, userId: string): readonly [string, string, string] =>
    ["brand-role", brandId, userId] as const,
};
```

(Implementor: confirm `export` is already present — line 61 shows `export const brandRoleKeys = {` so it IS exported. Skip the export-add; just add the new factory member.)

After (add `allForBrand` member; preserve existing `all` + `byBrand`):

```ts
export const brandRoleKeys = {
  all: ["brand-role"] as const,
  byBrand: (brandId: string, userId: string): readonly [string, string, string] =>
    ["brand-role", brandId, userId] as const,
  // ORCH-0740 Cycle 1: prefix-match all role-cache variants for a brand.
  // Used by useSoftDeleteBrand.onSuccess to invalidate the role cache for
  // any user (single-user app today; multi-user team membership tomorrow).
  allForBrand: (brandId: string): readonly [string, string] =>
    ["brand-role", brandId] as const,
};
```

**Lines added in this file:** ~4 (2 comment lines + 2 code lines).

**File 2:** `mingla-business/src/hooks/useBrands.ts`

**Change at line 292:** Refactor `useSoftDeleteBrand.onSuccess` to import + use the factory.

Add import near other hooks-folder imports (around line 39-50 region):

```ts
import { brandRoleKeys } from "./useCurrentBrandRole";
```

Replace the hardcoded line:

Before (line 292 region):
```ts
queryClient.removeQueries({ queryKey: ["brand-role", brandId] });
```

After:
```ts
queryClient.removeQueries({ queryKey: brandRoleKeys.allForBrand(brandId) });
```

**Lines changed:** 1 import (NEW) + 1 line (REPLACED).

**Circular import check:** `useCurrentBrandRole.ts` imports `useBrandList` from `./useBrandListShim` (a different file). It does NOT currently import from `useBrands.ts`. So the new import direction (`useBrands.ts` → `useCurrentBrandRole.ts` for `brandRoleKeys`) is acyclic. ✅

### 3.4 — `useCurrentBrandRole` staleTime 5min → 30s

**File:** `mingla-business/src/hooks/useCurrentBrandRole.ts:59`

Before:
```ts
const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — role changes are rare
```

After:
```ts
// ORCH-0740 Cycle 1: tightened from 5min to 30s.
// Role-bearing cache is security-adjacent (permission drift = S0/S1 risk
// per ORCH-0738 CF-1). 30s defense-in-depth until Cycle 3 wires Realtime
// push for brand_team_members changes (then this can relax back to 5min).
const STALE_TIME_MS = 30 * 1000; // 30s — security-adjacent (CF-1)
```

**Lines changed:** 1 line value + 4 lines of comment context.

### 3.5 — Cross-platform parity verification

| Change | RN | Web | Single code path? |
|---|---|---|---|
| §3.1 focusManager wiring | `AppState.addEventListener('change', ...)` fires on app foreground/background | Same API via react-native-web; shims to `visibilitychange`/`focus`/`blur` | ✅ Yes — single code path |
| §3.2 queryClient.clear() | Standard React Query API | Identical | ✅ Yes |
| §3.3 brandRoleKeys factory + refactor | Pure TypeScript object + import | Identical | ✅ Yes |
| §3.4 staleTime constant | Pure TypeScript constant | Identical | ✅ Yes |

**No `Platform.OS === 'web'` branching is required for any of the 4 changes.** Confirmed by reading react-native-web 0.21 documentation: `AppState`, `useQueryClient`, factory imports, and constants all behave identically across platforms.

---

## 4. Success Criteria

| ID | Statement | Verification |
|---|---|---|
| **SC-1** | When the app backgrounds for ≥1 minute then returns to foreground, every React Query observer with `staleTime` elapsed refetches automatically | Operator force-reload Metro → background app → wait 1 min → foreground → confirm Metro shows new fetches in network logs |
| **SC-2** | After signOut, the React Query cache is empty (zero observers, zero queries) AND Zustand stores are reset (existing behavior preserved) | Operator: signOut → React DevTools / Metro shows empty queryClient state; Zustand DevTools shows initial state |
| **SC-3** | `useSoftDeleteBrand.onSuccess` removeQueries call uses `brandRoleKeys.allForBrand(brandId)` instead of hardcoded literal | Static-trace: grep `mingla-business/src/hooks/useBrands.ts:292` region; verify import + call site |
| **SC-4** | `useCurrentBrandRole` staleTime is 30 seconds | Static-trace: read `useCurrentBrandRole.ts:59`; verify constant value |
| **SC-5** | Permission cache refreshes within 60 seconds across devices (assuming AppState becomes active on the second device) | Cross-device test: demote a team member on Device A; bring Device B to foreground → within 30s + foreground refetch, Device B's cached role refreshes |
| **SC-6** | TypeScript compiles cleanly | `cd mingla-business && npx tsc --noEmit` exits 0 |
| **SC-7** | Web build still bundles | `cd mingla-business && npx expo export -p web` exits 0 with bundle generated |
| **SC-8** | All 8 existing CI gates pass post-fix | `node .github/scripts/strict-grep/i-proposed-a-brands-deleted-filter.mjs` + I-PROPOSED-C + I-PROPOSED-H + I-PROPOSED-I (and I-37/38/39) — all exit 0 |
| **SC-9** | Zero Platform.OS === 'web' branches added by this fix | Static-trace: diff shows no new platform branching |
| **SC-10** | Diagnostic markers from prior cycles preserved (10 existing + 1 new = 11 markers in mingla-business; SPEC adds zero new markers) | Static-trace: grep `[ORCH-XXXX-DIAG]` count unchanged |

---

## 5. Test Cases

| Test | Scenario | Input | Expected | Layer | Maps to SC |
|---|---|---|---|---|---|
| T-1 | App backgrounds + foregrounds (RN) | iPhone simulator: backgound app for 1 min → foreground | Metro logs show refetch network requests for any query observer with stale data | Cross-platform integration | SC-1 |
| T-2 | App tab-switch (Web) | Web build: switch browser tab away for 1 min → return | Browser DevTools Network tab shows refetch requests | Cross-platform integration | SC-1 |
| T-3 | signOut clears RQ cache | Tap sign-out → land on welcome screen | React DevTools queryClient is empty; Zustand stores are at initial state | Code | SC-2 |
| T-4 | signOut via session-expiration (server-side) | Revoke session in Supabase Dashboard → token refresh fails → onAuthStateChange fires SIGNED_OUT | Same as T-3 (clearAllStores + queryClient.clear both fire) | Code | SC-2 |
| T-5 | Refactored removeQueries works | Tap Delete brand → confirm flow → role cache cleared | After delete, useCurrentBrandRole(deletedBrandId) returns isLoading + refetches (no stale role data) | Code | SC-3 |
| T-6 | Role cache refreshes within 30s | Mark cache stale by waiting >30s → mount new useCurrentBrandRole consumer | Refetch fires (was previously 5min hold) | Code | SC-4 |
| T-7 | Cross-device permission drift window | Device A demotes Device-B-user; Device B foreground after 30s | Device B's useCurrentBrandRole re-fetches via foreground refetch + 30s staleness | Cross-device integration | SC-5 |
| T-8 | tsc verification | `cd mingla-business && npx tsc --noEmit` | Exit 0, no errors | Build | SC-6 |
| T-9 | Web bundle verification | `cd mingla-business && npx expo export -p web` | Exit 0 + dist bundle generated | Build | SC-7 |
| T-10 | I-PROPOSED-C strict-grep gate | `node .github/scripts/strict-grep/i-proposed-c-brand-crud-via-react-query.mjs` | Exit 0 (no setBrands callers) | CI | SC-8 |
| T-11 | I-PROPOSED-I gate (regression) | `node .github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs` | Exit 0 (no new violations) | CI | SC-8 |
| T-12 | Platform branch count | `grep -c "Platform.OS === 'web'" mingla-business/src` before vs after | Same count | Static-trace | SC-9 |
| T-13 | Diagnostic marker count | `grep -c "\[ORCH-.*-DIAG\]" mingla-business/src` before vs after | Same count | Static-trace | SC-10 |

---

## 6. Invariants this fix preserves + improves

| Invariant | Status |
|---|---|
| Constitutional #2 One owner per truth | ✅ unchanged |
| **Constitutional #4** One query key per entity | ✅ **IMPROVED** — CF-2 narrowed: only one site was hardcoded, now uses factory. brandRoleKeys is a single source of truth for brand-role cache keys. |
| Constitutional #5 Server state stays server-side | ✅ unchanged (Cycle 2 will tighten currentBrand specifically) |
| **Constitutional #6** Logout clears everything | ✅ **IMPROVED** — HF-1 closed (queryClient.clear() now fires alongside existing clearAllStores) |
| Constitutional #14 Persisted-state startup | ✅ unchanged |
| I-PROPOSED-A BRAND-LIST-FILTERS-DELETED | ✅ unchanged |
| I-PROPOSED-C BRAND-CRUD-VIA-REACT-QUERY | ✅ unchanged |
| I-PROPOSED-D MB-ERROR-COVERAGE | ✅ unchanged |
| I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED | ✅ unchanged |
| I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED | ✅ unchanged |
| I-37 / I-38 / I-39 (TopBar / IconChrome / Pressable) | ✅ unchanged |

**No new invariants introduced by Cycle 1** — the changes are mechanical alignment with existing invariants (Constitutional #4 + #6). I-PROPOSED-J for cross-device sync architecture might be proposed in Cycle 2 or Cycle 3 once the architectural pattern is fully shipped.

---

## 7. Implementation Order

Numbered sequence — implementor follows in order:

1. **`useCurrentBrandRole.ts`** (§3.3 part 1 + §3.4):
   - Add `allForBrand(brandId)` member to `brandRoleKeys` factory
   - Tighten staleTime to 30s
   - Save + verify file compiles
2. **`useBrands.ts`** (§3.3 part 2):
   - Add import: `import { brandRoleKeys } from "./useCurrentBrandRole";`
   - Replace line 292 hardcoded key with `brandRoleKeys.allForBrand(brandId)`
3. **`AuthContext.tsx`** (§3.2):
   - Add import: `import { queryClient } from "../config/queryClient";`
   - Add `queryClient.clear()` call after `clearAllStores()` in BOTH the signOut callback AND the onAuthStateChange SIGNED_OUT branch
4. **`app/_layout.tsx`** (§3.1):
   - Add imports: `focusManager` from `@tanstack/react-query`; `AppState`, `AppStateStatus` from `react-native`
   - Add useEffect in `RootLayoutInner` body (placement: alongside other useEffects)
5. **TypeScript verification:** `cd mingla-business && npx tsc --noEmit` — must exit 0
6. **Web build verification:** `cd mingla-business && npx expo export -p web` — must exit 0
7. **CI gate verification:** Run all 4 relevant gates locally (I-PROPOSED-C + I-PROPOSED-H + I-PROPOSED-I + spot-check others) — all exit 0
8. **Implementation report:** write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0740_REPORT.md` per implementor 15-section template

---

## 8. Regression Prevention

The class of bug being fixed (cross-device sync foundation gap) is structural. Regression prevention:

- **I-PROPOSED-C strict-grep CI gate** already enforces "brand list state lives in React Query, NOT Zustand" — catches any future hardcoded key drift if the factory pattern is bypassed
- **The new `brandRoleKeys.allForBrand(brandId)` factory member** is a single point of authority — future code that needs to invalidate brand-role cache should use this; ad-hoc literal keys would be a code-review smell
- **AppState→focusManager wiring** is one place in the app root — absence in code review is grep-detectable (`grep "focusManager" mingla-business/app/_layout.tsx`)
- **queryClient.clear() in signOut** — paired with clearAllStores() → both should always co-exist; future code review should flag if only one is updated

**No new CI gate added in this cycle** — Cycle 1 piggybacks on existing gates. If a future cycle adds more sync-architecture infrastructure, an `I-PROPOSED-J` cross-device-sync invariant could be considered then.

---

## 9. Discoveries surfaced during pre-flight (for orchestrator)

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| **D-FOR-0740-1** | **Dispatch assumption A-5 was wrong.** A query-key factory `brandRoleKeys` already existed in `useCurrentBrandRole.ts:61-65`. Only ONE site (useBrands.ts:292) hardcodes the key, not multiple. Net: the CF-2 fix is smaller than dispatched. SPEC §3.3 reflects corrected scope. | S4 (process note — orchestrator's audit was based on a partial read of the codebase) | None — SPEC corrects the prescription. Confirm at REVIEW. |
| D-FOR-0740-2 | `useCurrentBrandRole.ts` brandRoleKeys.byBrand uses TWO parameters (brandId + userId), not just brandId. The cache is correctly user-scoped. The orphaned removeQueries call (`["brand-role", brandId]`) coincidentally works via React Query's prefix-match — it removes ALL user variants for that brandId. The new `allForBrand` factory member preserves this prefix-match behavior explicitly. | S4 (architectural insight) | Document; no action |
| D-FOR-0740-3 | `RootLayoutInner` already has 3 useEffects gated on `loading` from useAuth. The new focusManager useEffect is intentionally NOT gated on `loading` — focus tracking should fire from the moment the component mounts, regardless of auth state. Implementor: do NOT add `loading` to the useEffect deps. | S4 (process note) | Captured in SPEC §3.1 |
| D-FOR-0740-4 | The 11 in-flight diagnostic markers (10 existing `[ORCH-0728/0729/0730/0733/0734-RW-DIAG]` + this cycle adds 0) need cleanup as a separate cycle post-CLOSE. | S2 (already tracked) | Bundle into the post-PASS cleanup cycle |
| D-FOR-0740-5 | The dispatch §6 constraint "no new abstractions" is honored — no new files, no new utility modules. All changes are inline in existing files. | S4 (compliance note) | Confirm at REVIEW |

---

## 10. Effort estimate

- ~12 lines of code change across 4 files (smaller than dispatched ~15-line estimate due to D-FOR-0740-1 narrowing)
- ~30 min implementor work
- ~10 min verification (tsc + web bundle + 4 CI gates)
- Implementation report: ~15-20 min

**Total: ~60 min implementor effort.** Operator UI smoke + tester PASS gate added separately.

---

## 11. Confidence

**HIGH** that this SPEC closes the named ORCH-0738 findings (RC-B, HF-1, CF-2, partial CF-1) without introducing regressions. Mechanical changes only; mirrors existing patterns; cross-platform parity verified at the library level.

**MEDIUM-HIGH** that `cd mingla-business && npx expo export -p web` will exit 0 unmodified. (Not previously test-run by forensics; recommend implementor runs it as part of step 6 verification.)

**HIGH** that no `Platform.OS === 'web'` branching is needed.

---

## 12. Operator post-IMPL workflow

After implementor returns:
1. Operator reviews impl report + diff (~12 lines).
2. **No `supabase db push` needed** — pure code-side fix.
3. **No `supabase migration apply` needed** — zero migrations.
4. **Force-reload Metro** (shake → Reload) — same dev cycle as ORCH-0734-RW.
5. Run T-1 + T-3 + T-5 + T-6 + T-13 (UI smoke + static-trace).
6. Optionally run T-2 + T-9 (web build) on local browser.
7. Paste Metro output for orchestrator REVIEW.
8. Orchestrator dispatches mingla-tester for full PASS verification.
9. On PASS: orchestrator runs CLOSE protocol — updates 7 artifacts, provides commit message + EAS Update command, dispatches Cycle 2 SPEC (currentBrand persist ID-only).

---

## 13. EAS Update note (Cycle 1 deploys safely as OTA)

Cycle 1 is **pure JavaScript / TypeScript** — no native module changes, no expo plugin additions, no `app.json` modifications. Safe to ship as `eas update --branch production --platform ios` (and parallel Android update if the build pipeline targets Android too). No `eas build` required.

---

**End of SPEC.**

**Awaiting:** orchestrator REVIEW → operator dispatches mingla-implementor → tester PASS → CLOSE protocol → Cycle 2 SPEC dispatch.
