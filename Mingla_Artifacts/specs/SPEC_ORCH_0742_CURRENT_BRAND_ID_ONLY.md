# SPEC — ORCH-0742 — currentBrandStore ID-only architectural fix + S0 bundle hotfix

**Mode:** INVESTIGATE-THEN-SPEC (IA) — single SPEC file covers Part A (mechanical hotfix) + Part B (Cycle 2 architectural).
**Authored by:** mingla-forensics, 2026-05-06
**Dispatch:** [`prompts/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`](../prompts/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md)
**Predecessor evidence:**
- [`reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md`](../reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md) — RC-C
- [`reports/INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md`](../reports/INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md)
- [`reports/IMPLEMENTATION_ORCH_0740_REPORT.md`](../reports/IMPLEMENTATION_ORCH_0740_REPORT.md) — Cycle 1 Foundation

---

## 0. Layman summary

Two things, in order:

**Part A — Bundle hotfix (~10 min):** the iOS Metro and Expo Web bundles currently fail to compile because the same React hook line was accidentally duplicated in two files (a merge artefact). Mechanical fix: delete the duplicate. After this, the app boots again and we can smoke-test the rest.

**Part B — Architectural fix (~2-3 hr):** today, when an organiser picks a brand on Device A, we save the entire brand record (name, slug, stats, balances, etc.) into the local persisted store on that device. If they delete or rename that brand from Device B, Device A keeps showing the *old* snapshot until the next focus refresh — and on cold start it replays the stale snapshot too. Fix: persist only the brand's ID and always read the live brand record via React Query (which Cycle 1 already wired to refresh on app foreground). Stale snapshots can no longer survive in local storage.

**User-visible impact after Part B:**
- Brand renamed on Phone → Tablet shows new name on next foreground (no stale snapshot)
- Brand deleted on Phone → Tablet auto-clears its selection (no phantom brand)
- Cold-starting the app with a deleted brand selected → clean null (no flash of stale data, no crash)
- Same code path on iOS, Android, and Expo Web (no platform branching)

---

## 1. Pre-flight investigation summary

### 1.1 — Part A (Hotfix) findings — confidence HIGH

**Symptom:** `SyntaxError: Identifier 'currentRank' has already been declared` blocks bundle compile on iOS Metro and Expo Web.

**Files affected (verified by direct read):**

| File | Duplicate location |
|------|-------------------|
| `mingla-business/app/event/[id]/door/index.tsx` | Lines 156-164 (first block, gating `canViewReconciliation`) and lines 166-173 (EXACT duplicate — same comment + same `useCurrentBrandRole` call + same `canViewReconciliation` derivation) |
| `mingla-business/app/event/[id]/scanners/index.tsx` | Lines 133-136 (first block, gating `canManageScanners`) and lines 138-141 (EXACT duplicate — same comment + same hook + same derivation) |

**🔴 RC-HOTFIX-1 (Root Cause — Hotfix):**
- **File + line:** `door/index.tsx:166-173` and `scanners/index.tsx:138-141`
- **Exact code:** identical 4-line block immediately following its sibling — comment + `const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);` + `const canX = canPerformAction(currentRank, "X");`
- **What it does:** declares `currentRank` (and `canViewReconciliation` / `canManageScanners`) twice in the same function scope — JavaScript spec violation (ES2015+ `const`/`let` redeclaration error).
- **What it should do:** declare each binding exactly once.
- **Causal chain:** `git pull --rebase origin Seth` merge picked up parallel cycle-13 additions of the same gate from two branches and produced a duplicated block instead of a true merge resolution → Babel/SWC throws SyntaxError → bundle never executes.
- **Verification:** `cd mingla-business && npx tsc --noEmit` reports the duplicate; `npx expo export -p web` aborts with the same SyntaxError. Forensic Grep confirmed exact-line equality.

**Five-layer cross-check:** N/A — pure code-side syntax error.

**Note on the Part A description in the dispatch:** the dispatch said line 160 was used by `canDoorSell`. Forensics correction: there is **no** `canDoorSell` declaration in `door/index.tsx` — both blocks gate `canViewReconciliation`. Both files are 100% identical-block duplicates. Fix unchanged: delete the SECOND block in each file.

### 1.2 — Part B (Cycle 2) findings — confidence HIGH

The architectural root cause is already proven by ORCH-0738 RC-C. This SPEC re-confirms the consumer cascade by direct read.

**Consumer manifest (verified by Grep + Read of every site):**

| # | File | Line(s) | Pattern | Cycle-2 action |
|---|------|---------|---------|----------------|
| 1 | `src/components/ui/TopBar.tsx` | 144 | `useCurrentBrand()` (display) | **No-op** — wrapper returns fresh `Brand \| null` transparently |
| 2 | `app/(tabs)/home.tsx` | 103, 142 | `useCurrentBrand()` + imperative `getState().currentBrand?.id` for auto-clear | **Migrate** imperative read to `getState().currentBrandId` |
| 3 | `app/(tabs)/events.tsx` | 111, 281 | same pattern | same migration |
| 4 | `app/(tabs)/account.tsx` | 145 | imperative `getState().currentBrand?.id` for auto-clear | same migration |
| 5 | `app/brand/[id]/index.tsx` | 53 | imperative `getState().currentBrand?.id` for auto-clear | same migration |
| 6 | `app/brand/[id]/edit.tsx` | 46, 77, 97 | selector `useCurrentBrandStore((s) => s.currentBrand)` + imperative `getState().currentBrand?.id` | **Migrate** selector to `currentBrandId`; migrate imperative read |
| 7 | `app/brand/[id]/payments/onboard.tsx` | 38, 71 | selector `useCurrentBrandStore((s) => s.currentBrand)` | **Migrate** selector to `currentBrandId` |
| 8 | `app/event/create.tsx` | 39 | `useCurrentBrand()` (display) | **No-op** |
| 9 | `app/event/[id]/orders/[oid]/index.tsx` | 220 | imperative `getState().currentBrand` for `displayName` lookup | **Migrate** to centralised helper `getBrandFromCache(brandId)` |
| 10 | `src/utils/liveEventConverter.ts` | 46 | imperative `getState().currentBrand` for full Brand (slug) | **Migrate** — delete first branch; existing list-cache iteration becomes the only path |
| 11 | `src/store/liveEventStore.ts` | 473 | imperative `getState().currentBrand` for `displayName` | **Migrate** to `getBrandFromCache` |
| 12 | `src/components/orders/RefundSheet.tsx` | 216 | imperative `getState().currentBrand` for `displayName` | **Migrate** to `getBrandFromCache` |
| 13 | `src/components/orders/CancelOrderDialog.tsx` | 102 | imperative `getState().currentBrand` for `displayName` | **Migrate** to `getBrandFromCache` |
| 14 | `src/components/brand/BrandSwitcherSheet.tsx` | 87, 117, 313 | selector `useCurrentBrandStore((s) => s.currentBrand)` for active-row indicator + 2× `setCurrentBrand(brand)` writes | **Migrate** selector to `currentBrandId`; **setter writes preserved** under Option A |
| 15 | `src/utils/clearAllStores.ts` | 31 | `useCurrentBrandStore.getState().reset()` | **No-op** — `reset()` still resets to `currentBrandId: null` |

**🟡 HF-HOTFIX-2 (Hidden Flaw — discovered during pre-flight):**
- **File:** `src/store/currentBrandStore.ts:372`
- **Exact code:** `const upgradeV11BrandToV12 = (b: V11Brand): Brand => { ... }`
- **What it does:** declares an orphaned migration helper that references type `V11Brand`, which is **not defined anywhere** in the workspace (Grep confirmed: only one mention, the declaration site itself). The `migrate` function never calls this helper.
- **Why bundle hasn't broken:** Metro/Expo Web bundlers transpile TS without typechecking; only `tsc --noEmit` would error.
- **Why this matters now:** SPEC's success criterion SC-7 demands `tsc --noEmit` exit 0. Once Part A unblocks the bundle, tsc will fail on the missing `V11Brand` type.
- **Fix:** delete lines 367-375 (the docblock + the orphaned function) in Part B Step 1 (we're rewriting the migrate function chain anyway).
- **Classification:** 🟡 (was latent before today; becomes 🟠 contributing factor for SC-7 failure if not addressed).

**🔵 OBS-HOTFIX-3 (Observation):**
Two parallel cycles touched the same routes (`door/index.tsx`, `scanners/index.tsx`) and a rebase merge produced silent duplicate-block residue. Out of Cycle 2 scope. Recommend orchestrator review process for "two-cycles-same-file" merge handoffs in a future cycle.

---

## 2. Scope, Non-goals, Assumptions

### 2.1 — Scope

**Part A — Hotfix:**
- Delete duplicate-block residue in `door/index.tsx` and `scanners/index.tsx` (~8 lines per file).
- Delete dead `upgradeV11BrandToV12` helper in `currentBrandStore.ts` (~5 lines).
- Verify `tsc --noEmit` exits 0 and `expo export -p web` exits 0.

**Part B — Cycle 2 architectural:**
- Persist version migration v13 → v14: drop `currentBrand: Brand | null`, replace with `currentBrandId: string | null`.
- Rewrite `useCurrentBrand()` selector hook as a wrapper around `useBrand(currentBrandId)`.
- Add `useCurrentBrandId()` selector for ID-only consumers.
- Preserve `setCurrentBrand(brand: Brand | null)` API signature (Option A); internally extract `brand?.id ?? null`.
- Migrate selector reads of `(s) => s.currentBrand` to `(s) => s.currentBrandId` at 3 sites (BrandSwitcherSheet, brand/edit, payments/onboard).
- Migrate imperative `getState().currentBrand` reads at 10 sites.
- Add cache-lookup helper `getBrandFromCache(brandId): Brand | null` exported from `useBrands.ts`, used by 5 sites that need full Brand fields outside hook context.
- Add wrapper-hook auto-clear: when `useBrand(currentBrandId)` returns null (deleted/missing brand), clear `currentBrandId` via a `useEffect` so cold-start doesn't replay phantom selection.

### 2.2 — Non-goals

- Events / draftEvent / liveEvent / doorSales / scannerInvitations stores — **OUT OF SCOPE per ORCH-0739**. They are TRANSITIONAL with documented exit at events backend integration cycle.
- Realtime push (Cycle 3) — out of this SPEC.
- Per-store Zustand classification (Cycle 4) — out of this SPEC.
- DB migrations — pure code-side change.
- New abstractions / service layers — mechanical refactor only.
- Don't touch Cycle 1 work (focusManager, queryClient.clear in signOut, brandRoleKeys factory, 30s role TTL — all stay).

### 2.3 — Assumptions

- A-1: `useBrand(brandId)` exists and returns `UseQueryResult<Brand | null>` — **VERIFIED** at `useBrands.ts:89`.
- A-2: `brandKeys.detail(brandId)` factory member exists — **VERIFIED** at `useBrands.ts:58`.
- A-3: `queryClient` singleton exported from `src/config/queryClient.ts` — **VERIFIED**.
- A-4: Cycle 1's `focusManager` wiring is in place and working — **VERIFIED in IMPLEMENTATION_ORCH_0740_REPORT.md**.
- A-5: `getBrandFromCache(brandId)` helper does not yet exist — **VERIFIED** (no Grep hit).

---

## 3. Part A — Hotfix SPEC (mechanical)

### 3.1 — `mingla-business/app/event/[id]/door/index.tsx`

**Before** (current state, lines 156-173):

```tsx
  // Cycle 13 — permission gate for the "View full reconciliation" polish CTA
  // (D-CYCLE13-RECON-FOR-4). Same VIEW_RECONCILIATION rank used by the
  // dedicated reconciliation route + Event Detail action grid tile.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canViewReconciliation = canPerformAction(
    currentRank,
    "VIEW_RECONCILIATION",
  );

  // Cycle 13 — permission gate for the "View full reconciliation" polish CTA
  // (D-CYCLE13-RECON-FOR-4). Same VIEW_RECONCILIATION rank used by the
  // dedicated reconciliation route + Event Detail action grid tile.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canViewReconciliation = canPerformAction(
    currentRank,
    "VIEW_RECONCILIATION",
  );
```

**After** (delete lines 166-173 — the second identical block):

```tsx
  // Cycle 13 — permission gate for the "View full reconciliation" polish CTA
  // (D-CYCLE13-RECON-FOR-4). Same VIEW_RECONCILIATION rank used by the
  // dedicated reconciliation route + Event Detail action grid tile.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canViewReconciliation = canPerformAction(
    currentRank,
    "VIEW_RECONCILIATION",
  );
```

### 3.2 — `mingla-business/app/event/[id]/scanners/index.tsx`

**Before** (current state, lines 133-141):

```tsx
  // Cycle 13a J-T6 G6: scanner invite + revoke gated on MANAGE_SCANNERS
  // (event_manager+). Hooks run on every render before any early-return shell.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canManageScanners = canPerformAction(currentRank, "MANAGE_SCANNERS");

  // Cycle 13a J-T6 G6: scanner invite + revoke gated on MANAGE_SCANNERS
  // (event_manager+). Hooks run on every render before any early-return shell.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canManageScanners = canPerformAction(currentRank, "MANAGE_SCANNERS");
```

**After** (delete lines 138-141 — the second identical block):

```tsx
  // Cycle 13a J-T6 G6: scanner invite + revoke gated on MANAGE_SCANNERS
  // (event_manager+). Hooks run on every render before any early-return shell.
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canManageScanners = canPerformAction(currentRank, "MANAGE_SCANNERS");
```

### 3.3 — `mingla-business/src/store/currentBrandStore.ts` — delete dead `upgradeV11BrandToV12`

**Before** (current state, lines 367-375):

```ts
/**
 * v11 → v12 migration (Cycle 13a / DEC-092): silently strip the dropped
 * J-A9 fields `members` + `pendingInvitations` from the cached brand.
 * Brand-team state moves to `brandTeamStore` per Cycle 13a SPEC §4.7.
 */
const upgradeV11BrandToV12 = (b: V11Brand): Brand => {
  const { members: _m, pendingInvitations: _p, ...rest } = b;
  return rest;
};
```

**After:** delete entirely (function is dead — never called; `V11Brand` type is undefined; the migrate function does not reference it).

The v11 → v12 collapse already happened in Cycle 17d Stage 1 §E. This orphan was missed in that cleanup.

### 3.4 — Hotfix verification

Order of execution after edits:

1. `cd mingla-business && npx tsc --noEmit` → must exit 0 (currently fails on duplicate identifier AND missing V11Brand)
2. `cd mingla-business && npx expo export -p web` → must exit 0 (currently aborts on duplicate identifier)
3. Operator force-reloads iOS Metro bundle → no SyntaxError in dev console
4. Manual smoke: navigate to `/event/{id}/door` and `/event/{id}/scanners` → both routes render without crash; permission gates resolve identically (same `currentRank` derivation, just declared once now)
5. No semantic change to permission gating — `canViewReconciliation` and `canManageScanners` resolve from the surviving declaration

### 3.5 — Hotfix invariant preservation

- Constitutional #1 (no dead taps) — preserved (no UI change)
- Constitutional #4 (one query key per entity) — preserved
- Constitutional #8 (subtract before adding) — STRENGTHENED (we're subtracting duplicates)
- I-PROPOSED-J (proposed in §6 below) — does not apply yet; flips ACTIVE on Part B CLOSE

---

## 4. Part B — Cycle 2 Architectural SPEC

### 4.1 — Persist version migration v13 → v14

**Target file:** `mingla-business/src/store/currentBrandStore.ts`

**4.1.1 — Type changes:**

```ts
// New
export type CurrentBrandState = {
  currentBrandId: string | null;
  setCurrentBrand: (brand: Brand | null) => void;       // Option A — preserved API
  setCurrentBrandId: (id: string | null) => void;       // New — for callers that want explicit ID API
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrandId">;
```

The `Brand` type itself is **unchanged** — still exported, still used by all consumers.

**4.1.2 — Persist options:**

```ts
const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v14",        // Bump key name
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrandId: state.currentBrandId,           // ID only — no Brand snapshot
  }),
  version: 14,
  migrate: (persistedState, version) => {
    // v13 → v14 (Cycle 2 / ORCH-0742) — drops the `currentBrand: Brand | null`
    // server snapshot. Keeps only `currentBrandId: string | null`. Server data
    // refreshes on next mount via React Query useBrand(currentBrandId).
    if (version < 14) {
      const old = persistedState as Partial<{
        currentBrand: { id?: string } | null;
        currentBrandId: string | null;
      }> | null;
      const id =
        old?.currentBrandId !== undefined
          ? old.currentBrandId
          : (old?.currentBrand?.id ?? null);
      return { currentBrandId: id ?? null };
    }
    return persistedState as PersistedState;
  },
};
```

**Note on key-name bump (`v13` → `v14` in the storage key):** AsyncStorage will read either the old `mingla-business.currentBrand.v13` blob or, after first migration, the new `v14` blob. Persisting under a new key name is the established Cycle pattern (see comment block at `currentBrandStore.ts:18-69` documenting v1-v13 evolution). The migrate function still receives the v13 blob via Zustand's standard cross-version migration path.

**4.1.3 — Store body:**

```ts
export const useCurrentBrandStore = create<CurrentBrandState>()(
  persist(
    (set) => ({
      currentBrandId: null,
      setCurrentBrand: (brand) => set({ currentBrandId: brand?.id ?? null }),  // Option A: preserved API
      setCurrentBrandId: (id) => set({ currentBrandId: id }),
      reset: () => set({ currentBrandId: null }),
    }),
    persistOptions,
  ),
);
```

### 4.2 — `useCurrentBrand()` rewrite (server-fresh wrapper)

**Target file:** `mingla-business/src/store/currentBrandStore.ts` (or relocated — see note below).

**Important relocation note:** Today `useCurrentBrand()` lives in `currentBrandStore.ts` at line 410-411. The Cycle-2 wrapper depends on `useBrand` from `useBrands.ts`, which depends on `Brand` from `currentBrandStore.ts` — **circular import risk**.

**Required relocation:** move `useCurrentBrand()` to a new file `mingla-business/src/hooks/useCurrentBrand.ts` (analogous to `useBrandListShim.ts`). Keep `currentBrandStore.ts` as the pure Zustand store + `Brand` type. Re-export `useCurrentBrand` from `currentBrandStore.ts` (mirroring the existing `useBrandList` re-export at line 425) so existing import sites don't change:

```ts
// At end of currentBrandStore.ts, mirroring the useBrandList re-export pattern:
export { useCurrentBrand } from "../hooks/useCurrentBrand";
```

**4.2.1 — `mingla-business/src/hooks/useCurrentBrand.ts` (new file):**

```ts
/**
 * useCurrentBrand — server-fresh wrapper for the active organiser brand (Cycle 2 / ORCH-0742).
 *
 * Replaces the v13-and-earlier "persisted Brand snapshot" pattern. Now reads
 * `currentBrandId` from Zustand and fetches fresh Brand data via React Query
 * (`useBrand(currentBrandId)`). Cycle 1's focusManager refetches on app foreground;
 * 30s role TTL governs role-cache freshness.
 *
 * Lives in src/hooks/ (not src/store/) to avoid circular imports between
 * currentBrandStore.ts and useBrands.ts. Re-exported from currentBrandStore.ts
 * for backward-compatible imports (mirroring the useBrandList shim pattern).
 *
 * Const #5 satisfied: server state lives in React Query; Zustand holds only the
 * client-state pointer (currentBrandId).
 *
 * Auto-clear: when useBrand(currentBrandId) returns null (brand was deleted /
 * access revoked / cold-start phantom), the wrapper clears currentBrandId so
 * subsequent renders see clean null and cold-start doesn't replay the bug.
 */

import { useEffect } from "react";
import { useBrand } from "./useBrands";
import {
  useCurrentBrandStore,
  type Brand,
} from "../store/currentBrandStore";

export const useCurrentBrand = (): Brand | null => {
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  const { data: brand, isFetched } = useBrand(currentBrandId);

  // Auto-clear phantom selection: when we have an ID but the server says the
  // brand is gone (deleted / access revoked / never existed), clear the local
  // pointer so cold-start doesn't replay this state. Only fire after an actual
  // server roundtrip (isFetched), never during the initial loading window.
  useEffect(() => {
    if (currentBrandId !== null && isFetched && brand === null) {
      setCurrentBrandId(null);
    }
  }, [currentBrandId, isFetched, brand, setCurrentBrandId]);

  return brand ?? null;
};
```

### 4.3 — `useCurrentBrandId()` direct selector

**Target file:** `mingla-business/src/store/currentBrandStore.ts`

Add (right above the existing `useCurrentBrand` re-export):

```ts
/**
 * useCurrentBrandId — direct ID selector (no React Query roundtrip). Use when
 * the consumer only needs the active brand's identifier (e.g., comparing against
 * a target brand for permission gating, conditional rendering by ID).
 *
 * Cycle 2 / ORCH-0742.
 */
export const useCurrentBrandId = (): string | null =>
  useCurrentBrandStore((s) => s.currentBrandId);
```

### 4.4 — Cache-lookup helper `getBrandFromCache`

**Target file:** `mingla-business/src/hooks/useBrands.ts`

Add (after the `brandKeys` factory, before the hook definitions):

```ts
/**
 * getBrandFromCache — synchronous, hook-free lookup for outside-component
 * contexts (Zustand actions, store converters, fire-and-forget submit handlers).
 *
 * Reads the React Query cache by ID. Tries the detail cache first; falls back
 * to iterating the list caches. Returns null on miss.
 *
 * Replaces the Cycle-17e-A "useCurrentBrandStore.getState().currentBrand"
 * imperative pattern in 5 call sites (RefundSheet, CancelOrderDialog, order
 * detail resend, liveEventConverter, liveEventStore.recordEdit notification).
 *
 * Cycle 2 / ORCH-0742.
 */
export const getBrandFromCache = (brandId: string | null): Brand | null => {
  if (brandId === null) return null;
  // Detail cache — populated when useBrand(brandId) has mounted
  const detail = queryClient.getQueryData<Brand | null>(
    brandKeys.detail(brandId),
  );
  if (detail !== undefined && detail !== null) return detail;
  // List cache fallback — populated by useBrands(accountId) on every mount
  const lists = queryClient.getQueriesData<Brand[]>({
    queryKey: brandKeys.lists(),
  });
  for (const [, brands] of lists) {
    if (brands === undefined) continue;
    const found = brands.find((b) => b.id === brandId);
    if (found !== undefined) return found;
  }
  return null;
};
```

Required import addition at top of `useBrands.ts`:

```ts
import { queryClient } from "../config/queryClient";
```

### 4.5 — Selector-read migrations (3 sites)

**4.5.1 — `app/brand/[id]/edit.tsx:46`**

Before:
```ts
const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
```
After:
```ts
const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
```

Then update line 77 from `currentBrand !== null && currentBrand.id === updated.id` to `currentBrandId === updated.id`. The `setCurrentBrand(updated)` call at line 78 becomes a no-op for fields (Option A extracts the ID, which doesn't change) but is harmless to keep — alternative is to delete the entire `if` block since React Query's `useUpdateBrand.onSuccess` already updates the cache (the wrapper's next render gets fresh data automatically). **Recommended: delete lines 75-79** (`Mirror to currentBrand selection` block) entirely as dead code post-Cycle-2.

**4.5.2 — `app/brand/[id]/payments/onboard.tsx:38`**

Identical pattern. Before:
```ts
const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
```
After:
```ts
const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
```
Update line 71 comparison to `currentBrandId === updated.id`. **Recommended: delete lines 71-73** as dead code post-Cycle-2 (same reasoning as 4.5.1).

**4.5.3 — `src/components/brand/BrandSwitcherSheet.tsx:87`**

Before:
```ts
const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
```
After:
```ts
const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
```

Update consumer of this binding — search for `currentBrand.id` in the file and replace with `currentBrandId`. Replace any `currentBrand === null` with `currentBrandId === null`. The setter calls `setCurrentBrand(brand)` at line 117 and `setCurrentBrand(newBrand)` at line 313 are **PRESERVED** (Option A signature; internally extracts ID).

### 4.6 — Imperative `getState().currentBrand` migrations (10 sites)

**Group A — Auto-clear-by-ID-comparison (5 sites). Pattern transformation:**

Before:
```ts
const current = useCurrentBrandStore.getState().currentBrand;
if (current !== null && current.id === deletedBrandId) {
  setCurrentBrand(null);
}
```

After:
```ts
const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
if (currentBrandId === deletedBrandId) {
  setCurrentBrand(null);
}
```

Apply at:
- `app/(tabs)/home.tsx:142-145`
- `app/(tabs)/events.tsx:281-284`
- `app/(tabs)/account.tsx:145-148`
- `app/brand/[id]/index.tsx:53-56`
- `app/brand/[id]/edit.tsx:97-100`

The `setCurrentBrand(null)` call is preserved (Option A — null is treated as `currentBrandId: null`).

**Group B — Full-Brand lookup via cache helper (5 sites). Pattern transformation:**

Before (RefundSheet.tsx:216-220 example):
```ts
const currentBrand = useCurrentBrandStore.getState().currentBrand;
const brandName =
  currentBrand !== null && currentBrand.id === result.brandId
    ? currentBrand.displayName
    : "";
```

After:
```ts
const cachedBrand = getBrandFromCache(result.brandId);
const brandName = cachedBrand?.displayName ?? "";
```

Required import:
```ts
import { getBrandFromCache } from "../../hooks/useBrands";   // path relative to file
```

Apply (with file-appropriate import path) at:
- `src/components/orders/RefundSheet.tsx:216-220`
- `src/components/orders/CancelOrderDialog.tsx:102-106`
- `app/event/[id]/orders/[oid]/index.tsx:220-224`
- `src/store/liveEventStore.ts:472-478` (the `brandName` IIFE block)

**Special case — `src/utils/liveEventConverter.ts:46-61`**

This file already has list-cache-iteration fallback logic. Cycle 2 simplifies it: the "current brand" first-branch optimisation can be deleted, since the list-cache iteration handles every brand uniformly.

Before (lines 45-61):
```ts
const brand = (() => {
  const current = useCurrentBrandStore.getState().currentBrand;
  if (current !== null && current.id === draft.brandId) {
    return current;
  }
  // Cache lookup via queryClient (without accountId we can't pinpoint the
  // list key, so iterate over cached lists and merge).
  const queries = queryClient.getQueriesData<Brand[]>({
    queryKey: brandKeys.lists(),
  });
  for (const [, brands] of queries) {
    if (brands === undefined) continue;
    const found = brands.find((b) => b.id === draft.brandId);
    if (found !== undefined) return found;
  }
  return undefined;
})();
```

After:
```ts
const brand = getBrandFromCache(draft.brandId) ?? undefined;
```

Required import:
```ts
import { getBrandFromCache } from "../hooks/useBrands";
```

Remove now-unused imports: `useCurrentBrandStore` (was used only for the deleted first branch), `queryClient`, `brandKeys` (now used only inside `getBrandFromCache`). Keep the `Brand` type import.

### 4.7 — Hydration-time freshness (cold-start contract)

- On cold-start: persist hydrates `currentBrandId` (from AsyncStorage `mingla-business.currentBrand.v14` blob, or migrated from v13).
- First mount of `useCurrentBrand()` triggers `useBrand(currentBrandId)` query (5min staleTime — same as before).
- Splash gate (existing) covers the first-fetch window. No flash of stale data — wrapper returns null until first server response.
- If first-fetch returns null (deleted brand) → auto-clear `useEffect` clears `currentBrandId` → subsequent renders see clean null state.
- Cycle 1's `focusManager` refetches on app foreground; 30s role TTL governs role cache.
- No Platform.OS branching — single code path on iOS / Android / Web.

### 4.8 — Deleted-brand-self-clear behaviour (formal contract)

When the wrapper hook's underlying query resolves and `brand === null` while `currentBrandId !== null` AND `isFetched === true`:
- `setCurrentBrandId(null)` fires inside a `useEffect`
- Persisted state updates (`currentBrandId: null` flushed to AsyncStorage)
- Subsequent renders return null from `useCurrentBrand()`
- No infinite loop: after clear, `currentBrandId === null` → `useEffect` no-op

The `isFetched` guard prevents firing during the initial loading window (when `brand === undefined` but the query hasn't completed yet — the wrapper would otherwise spuriously clear on first mount before the query resolves).

### 4.9 — Cross-platform parity

- Single code path. No Platform.OS branching anywhere in this SPEC.
- AsyncStorage is the persist driver on RN and shimmed on Web by the same `@react-native-async-storage/async-storage` package.
- React Query, focusManager, useEffect — identical on RN and Web.
- Verified by SC-8 (`expo export -p web` exit 0) + SC-7 (tsc=0).

---

## 5. Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-1 | `currentBrandStore` persisted state contains only `currentBrandId: string \| null` | Inspect `partialize` output via `await AsyncStorage.getItem('mingla-business.currentBrand.v14')` — JSON has only `state.currentBrandId` |
| SC-2 | Persist v13 → v14 migration extracts `currentBrand.id` and discards rest | Manually plant a v13 blob, force-reload app, inspect AsyncStorage v14 blob — only `currentBrandId` present, value matches old `currentBrand.id` |
| SC-3 | `useCurrentBrand()` returns server-fresh `Brand \| null` via React Query | Edit a brand on Device A, foreground Device B → `useCurrentBrand()` reflects new fields within 30s + foreground |
| SC-4 | Cross-device delete propagation: brand-delete on Device A → Device B `useCurrentBrand` returns null within 30s + foreground (Cycle 1 wiring) | Manual smoke: delete on Phone, foreground Tablet, observe Tablet TopBar updates and currentBrand-gated CTAs disappear |
| SC-5 | Cross-device rename propagation: brand-rename on Device A → Device B `useCurrentBrand` shows new name on next foreground refetch | Manual smoke: rename on Phone, foreground Tablet, observe new name in TopBar |
| SC-6 | Cold-start with persisted `currentBrandId` of a deleted brand → `useCurrentBrand` returns null cleanly (no flash, no crash, auto-clear fires) | Plant `currentBrandId` of a known-deleted brand in AsyncStorage, cold-start app, observe: splash → null state → no errors → AsyncStorage `currentBrandId` flushed to null |
| SC-7 | `cd mingla-business && npx tsc --noEmit` exits 0 | Run command, observe exit code 0 |
| SC-8 | `cd mingla-business && npx expo export -p web` exits 0 | Run command, observe exit code 0 |
| SC-9 | All 4 existing CI gates pass post-fix (strict-grep mingla-business workflow + I-PROPOSED-C + I-32 + I-PROPOSED-H/I/A/B) | Run `.github/workflows/strict-grep-mingla-business.yml` locally or push branch and observe CI |
| SC-10 | No regression in any of the 15 consumers cataloged in §1.2 | Smoke-test each surface: TopBar display, brand switcher, brand edit save, payments onboard, refund/cancel notifications, event create, door/scanners gate, etc. |
| SC-11 | (Hotfix) `door/index.tsx` and `scanners/index.tsx` declare `currentRank` exactly once each | Grep `^\s*const \{ rank: currentRank \}` in each file → exactly 1 hit per file |
| SC-12 | (Hotfix) `currentBrandStore.ts` does not reference `V11Brand` | Grep `V11Brand` in `mingla-business/` → 0 hits |

---

## 6. Invariants

### 6.1 — Preserved (no change)

- **Constitutional #1** (no dead taps) — UI behaviour unchanged
- **Constitutional #2** (one owner per truth) — STRENGTHENED: server data has exactly one owner (React Query); Zustand holds only the client-state pointer
- **Constitutional #3** (no silent failures) — error contracts in `useBrand()` mutations preserved; auto-clear on null is a deliberate, documented behaviour, not a silent failure
- **Constitutional #4** (one query key per entity) — preserved (no new keys, no factory drift)
- **Constitutional #5** (server state stays server-side) — STRENGTHENED: full Brand snapshot leaves Zustand entirely
- **Constitutional #6** (logout clears everything) — preserved (`reset()` still clears `currentBrandId`; `clearAllStores` still calls `reset()`; signOut still calls `queryClient.clear()` per Cycle 1)
- **Constitutional #7** (label temporary) — `[TRANSITIONAL]` markers in the new wrapper file documented with exit conditions
- **Constitutional #8** (subtract before adding) — STRENGTHENED: dead `upgradeV11BrandToV12` removed; persisted `currentBrand` snapshot removed
- **Constitutional #14** (persisted-state startup) — STRENGTHENED: cold-start no longer replays stale Brand snapshot
- **I-PROPOSED-C** (server state via React Query) — STRENGTHENED for the brand surface
- **I-PROPOSED-H/I** (RLS-RETURNING-OWNER-GAP-PREVENTED + MUTATION-ROWCOUNT-VERIFIED) — preserved (orthogonal)
- **I-32** (BrandRole rank parity) — preserved (orthogonal)

### 6.2 — Proposed NEW invariant

**I-PROPOSED-J — ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS**

> Persisted Zustand stores MUST NOT hold full server-derived objects (records returned from Supabase, edge functions, or external APIs). They MAY hold:
> (a) IDs / pointers to server records (the canonical pattern: persist the ID, fetch via React Query)
> (b) Pure client UI state (modal open flags, drawer width, current page, ephemeral inputs)
> (c) User preferences (locale, theme, notification settings)
>
> Forbidden: persisting `currentBrand: Brand`, `currentEvent: LiveEvent`, `currentOrder: Order`, etc. — anything whose canonical authority is server-side.
>
> Why: persisted server snapshots become stale across devices, across cold-starts, and across server-side mutations. They are the structural cause of "deleted brand still appears selected on other device" and similar bug classes.
>
> CI gate enforcement: TBD as a follow-up cycle. Candidate: a strict-grep over `partialize:` blocks in any file matching `**/store/*Store.ts` to flag persisted Brand / Event / Order / Account types. Tracked as deferred work.
>
> Status: DRAFT — flips ACTIVE on ORCH-0742 CLOSE.
>
> Established: 2026-05-06 by ORCH-0742 SPEC. Predecessor evidence: ORCH-0738 RC-C.

(The CI-gate authoring is **deferred** — not part of this SPEC's implementation. The invariant text codifies the rule; the gate ships in a future cycle when broad enough surface-area exists to make it worthwhile.)

---

## 7. Test Cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | Cold-start — no persist | First-ever app launch | `currentBrandId: null` → `useCurrentBrand()` returns null → splash → brand-empty state | Persist + hook |
| T-02 | Cold-start — valid persist | v14 blob with valid currentBrandId | `useBrand(id)` fetches → wrapper returns fresh Brand → TopBar renders displayName | Persist + hook + RQ |
| T-03 | Cold-start — v13 → v14 migrate | Pre-v14 v13 blob with `currentBrand.id = "X"` | Migration runs → AsyncStorage v14 blob has `currentBrandId: "X"` → app boots normal | Migration |
| T-04 | Cold-start — phantom brand | v14 blob with `currentBrandId` of a deleted brand | Fetch returns null → `isFetched=true, brand=null` → auto-clear `useEffect` fires → `currentBrandId: null` flushed | Wrapper auto-clear |
| T-05 | Brand picker — pick existing | Operator taps brand X in BrandSwitcherSheet | `setCurrentBrand(X)` extracts X.id → state.currentBrandId = X.id → wrapper fetches X → TopBar updates | Setter + hook |
| T-06 | Brand picker — create new | Operator creates brand Y | `useCreateBrand` succeeds → `setCurrentBrand(Y)` extracts Y.id → state.currentBrandId = Y.id → wrapper fetches Y | Setter + hook + mutation |
| T-07 | Brand edit — same-brand update | Operator renames brand A → A' | `useUpdateBrand` succeeds → React Query cache has fresh A' → wrapper returns A' on next render → TopBar updates | Mutation cache hit |
| T-08 | Cross-device rename | Phone renames brand → Tablet foregrounds | focusManager refetch → useBrand refetches → returns updated Brand → TopBar updates within ~1s | Cycle 1 + Cycle 2 |
| T-09 | Cross-device delete | Phone deletes brand → Tablet foregrounds | focusManager refetch → useBrand returns null → auto-clear fires → Tablet currentBrandId becomes null → all currentBrand-gated CTAs vanish | Cycle 1 + Cycle 2 + auto-clear |
| T-10 | signOut | Operator signs out from any tab | clearAllStores reset() → currentBrandId: null → queryClient.clear() (Cycle 1) → on next sign-in, fresh brand list fetch | Reset + Cycle 1 |
| T-11 | Imperative cache lookup hit | RefundSheet submits with current brand cached | `getBrandFromCache(brandId)` returns Brand from list cache → notification copy contains `displayName` | Helper |
| T-12 | Imperative cache lookup miss | RefundSheet submits with brand evicted from cache | `getBrandFromCache(brandId)` returns null → `brandName` falls back to "" → notification fires with empty brand name (matches Cycle-17e-A semantic) | Helper |
| T-13 | door route compile | tsc + Metro + Web | Each route declares `currentRank` once → no SyntaxError → routes render | Hotfix |
| T-14 | scanners route compile | tsc + Metro + Web | same as T-13 for scanners | Hotfix |
| T-15 | Permission gating parity | Open `/event/{id}/door` and `/event/{id}/scanners` | `canViewReconciliation` and `canManageScanners` evaluate identically pre/post hotfix (same currentRank value) | Hotfix |

---

## 8. Implementation Order

**Step 0 — HOTFIX FIRST (BLOCKING — bundle is currently broken; nothing else can be smoke-tested until this passes):**
0.1 — Edit `mingla-business/app/event/[id]/door/index.tsx`: delete lines 166-173 (duplicate block).
0.2 — Edit `mingla-business/app/event/[id]/scanners/index.tsx`: delete lines 138-141 (duplicate block).
0.3 — Edit `mingla-business/src/store/currentBrandStore.ts`: delete lines 367-375 (dead `upgradeV11BrandToV12` + its docblock).
0.4 — `cd mingla-business && npx tsc --noEmit` → exit 0.
0.5 — `cd mingla-business && npx expo export -p web` → exit 0.
0.6 — Operator force-reload iOS Metro → no SyntaxError, app boots.
0.7 — Operator confirms ✅ Step 0 complete before proceeding to Step 1.

**Step 1 — Store shape + persist v13 → v14:**
1.1 — Edit `currentBrandStore.ts`: change `CurrentBrandState` type per §4.1.1.
1.2 — Update `persistOptions.name` to `"mingla-business.currentBrand.v14"`, `version: 14`, `partialize` to ID-only, `migrate` per §4.1.2.
1.3 — Update store body per §4.1.3 (setCurrentBrand extracts ID; add setCurrentBrandId; reset to null).
1.4 — Add `useCurrentBrandId` selector per §4.3.

**Step 2 — Create wrapper hook file:**
2.1 — Create `mingla-business/src/hooks/useCurrentBrand.ts` with the wrapper from §4.2.1.
2.2 — In `currentBrandStore.ts`: REMOVE the existing `useCurrentBrand` definition (lines 410-411). ADD re-export `export { useCurrentBrand } from "../hooks/useCurrentBrand";` at the end (mirroring the existing `useBrandList` re-export pattern).

**Step 3 — Add `getBrandFromCache` helper:**
3.1 — Edit `mingla-business/src/hooks/useBrands.ts`: add `import { queryClient } from "../config/queryClient";` and the `getBrandFromCache` export per §4.4.

**Step 4 — Selector-read migrations (3 sites) per §4.5:**
4.1 — `app/brand/[id]/edit.tsx` line 46 + lines 75-79 (delete dead-code block).
4.2 — `app/brand/[id]/payments/onboard.tsx` line 38 + lines 71-73 (delete dead-code block).
4.3 — `src/components/brand/BrandSwitcherSheet.tsx` line 87 + downstream `currentBrand.id` references.

**Step 5 — Imperative auto-clear migrations (5 sites) per §4.6 Group A:**
5.1 — `app/(tabs)/home.tsx`
5.2 — `app/(tabs)/events.tsx`
5.3 — `app/(tabs)/account.tsx`
5.4 — `app/brand/[id]/index.tsx`
5.5 — `app/brand/[id]/edit.tsx` line 97 (separate from 4.1's selector edit)

**Step 6 — Imperative cache-helper migrations (5 sites) per §4.6 Group B:**
6.1 — `src/components/orders/RefundSheet.tsx`
6.2 — `src/components/orders/CancelOrderDialog.tsx`
6.3 — `app/event/[id]/orders/[oid]/index.tsx`
6.4 — `src/store/liveEventStore.ts`
6.5 — `src/utils/liveEventConverter.ts` (delete first branch entirely; simplify to single helper call)

**Step 7 — Verification:**
7.1 — `cd mingla-business && npx tsc --noEmit` → exit 0
7.2 — `cd mingla-business && npx expo export -p web` → exit 0
7.3 — `cd mingla-business && npx expo start --clear` → boot iOS Metro; app boots; TopBar renders current brand from React Query
7.4 — All 15 consumers in §1.2 manifest exhibit no regression — operator smoke-test each (or implementor produces a sub-checklist in implementation report)

**Step 8 — CI gates:**
8.1 — Push branch; CI runs strict-grep workflow.
8.2 — `i-proposed-c` gate (no `setBrands(`) — preserved (no new write paths).
8.3 — All 4 existing strict-grep gates green.

**Step 9 — Implementation report:**
Implementor writes `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0742_REPORT.md` per implementor template, including the 15-consumer cascade verification table.

---

## 9. Regression Prevention

**Structural safeguards (delivered by this SPEC):**

- The wrapper hook architecture **prevents** the persisted-snapshot-stale class of bugs — there's no Brand object to go stale; the only persisted item is the ID, and React Query owns freshness.
- The `getBrandFromCache` helper centralises imperative-context Brand lookup — future imperative consumers reuse the helper instead of re-introducing `getState().currentBrand` patterns.
- The auto-clear `useEffect` ensures cold-start can never replay phantom selection (the bug class observed in ORCH-0738 RC-C).

**Forward safeguards:**

- I-PROPOSED-J codifies the rule. Future PRs adding persisted server-derived objects are flagged at review time (and eventually by a strict-grep gate).
- The wrapper file's docblock documents the EXIT condition for I-PROPOSED-C and the relationship to Cycle 1's focusManager — future maintainers won't accidentally regress the architecture.

**Protective comments to include in the implementation:**

- Top of `useCurrentBrand.ts`: full file header per §4.2.1 (SPEC ref, Cycle 1 dependency, auto-clear rationale)
- Top of `getBrandFromCache`: docblock per §4.4 (replacement for `getState().currentBrand`, list/detail cache fallback chain)
- Top of `currentBrandStore.ts` schema-version comment block: append v13 → v14 entry following the existing v1-v13 evolution pattern
- Inline comment at the `useEffect` auto-clear in the wrapper: explain the `isFetched` guard (prevents spurious clear during initial loading window)

---

## 10. Discoveries for Orchestrator

| ID | Type | Description | Action |
|----|------|-------------|--------|
| D-0742-1 | 🟡 | Dead `upgradeV11BrandToV12` helper in `currentBrandStore.ts:372` references undefined `V11Brand` type; would block tsc=0 once Part A unblocks bundle | Folded into Part A Step 0.3 — delete with the hotfix |
| D-0742-2 | 🔵 | Two parallel cycles touched `door/index.tsx` and `scanners/index.tsx` and a rebase merge produced silent duplicate-block residue. Recommend orchestrator review process for "two-cycles-same-file" merge handoffs | Out of Cycle 2 scope; orchestrator decides if a process change is warranted |
| D-0742-3 | 🔵 | The dead-code blocks at `app/brand/[id]/edit.tsx:75-79` and `app/brand/[id]/payments/onboard.tsx:71-73` (the `setCurrentBrand(updated)` mirror-write after `useUpdateBrand` succeeds) become dead code post-Cycle-2 because React Query's onSuccess already updates the cache → wrapper returns fresh data automatically. Recommended deletion is in Step 4 of implementation order. | Implementor deletes per §4.5; tester confirms no regression |
| D-0742-4 | 🔵 | Ten pre-existing `[ORCH-XXXX-DIAG]` console.error markers in `useBrands.ts` and `BrandSwitcherSheet.tsx` are still in flight. Out of Cycle 2 scope (separate post-CLOSE cycle per orchestrator's tracking). | Tracked separately |
| D-0742-5 | 🔵 | The dispatch said `door/index.tsx` line 160 was used by `canDoorSell`. Forensics correction: there is no `canDoorSell` declaration in this file — both blocks gate `canViewReconciliation`. Both files are 100% identical-block duplicates. Fix unchanged: delete the second block in each file. | Documented in §1.1 |

---

## 11. Confidence

**HIGH** for both Part A and Part B.

- Part A is grep-confirmed; pure mechanical syntax fix.
- Part B is grep-confirmed across 15 consumers; every consumer pattern was read end-to-end and explicitly mapped to a §4.5 / §4.6 transformation. The `useBrand` hook + `brandKeys.detail` factory + `queryClient` singleton are all verified pre-existing infrastructure (no new abstractions). The wrapper architecture is the textbook "ID-only persist + RQ for fresh data" pattern.

No layer of the SPEC is "probable" or "suspected" — every line traces back to a verified read.

---

**Awaiting:** orchestrator REVIEW → operator dispatches mingla-implementor → tester PASS → CLOSE protocol.
