# Implementation Report — ORCH-0742 Phase 2 (currentBrand ID-only)

**Date:** 2026-05-06
**Branch:** `Seth`
**Pre-implementation HEAD:** `8693b309`
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`](../specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md)
**Dispatch:** [`Mingla_Artifacts/prompts/IMPL_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`](../prompts/IMPL_ORCH_0742_CURRENT_BRAND_ID_ONLY.md)
**Status:** **implemented and verified** — Phase 2 complete; ready for orchestrator REVIEW → tester dispatch.

---

## 1. Layman summary

`mingla-business`'s active-brand store no longer keeps a copy of the entire brand record on the device — it keeps only the brand's ID. The full brand record (name, slug, logo, balances, stats) is read fresh through React Query whenever a screen needs it. Practical effect: a brand renamed on Phone shows the new name on Tablet's next foreground refresh, a deleted brand instantly clears the local pointer (so the app can never replay a phantom selection on cold-start), and there is one code path on iOS / Android / Web. No DB changes, no visible UI changes.

---

## 2. Files changed (Old → New receipts)

### 2.1 — `mingla-business/src/store/currentBrandStore.ts`

**Before:** persisted `currentBrand: Brand | null` (full Brand snapshot) under storage key `mingla-business.currentBrand.v13`. `useCurrentBrand()` was a Zustand selector returning the persisted Brand. No `useCurrentBrandId` hook existed.
**Now:** persists only `currentBrandId: string | null` under `mingla-business.currentBrand.v14`. `setCurrentBrand(brand)` extracts `brand?.id ?? null` (Option A — preserved API). New `setCurrentBrandId(id)` action and `useCurrentBrandId()` selector. v13→v14 migrate function reads `old.currentBrandId` first, falls back to `old.currentBrand?.id`. `useCurrentBrand` is now re-exported from `src/hooks/useCurrentBrand.ts`.
**Why:** SPEC §4.1 + §4.3 — drop the persisted server snapshot; satisfy I-PROPOSED-J.
**Lines changed:** ~+30 / −20.

### 2.2 — `mingla-business/src/hooks/useCurrentBrand.ts` (NEW)

**Before:** did not exist.
**Now:** new wrapper that reads `currentBrandId` from Zustand and returns `Brand | null` from `useBrand(currentBrandId)`. Auto-clears `currentBrandId` via `useEffect` when `isFetched && brand === null`.
**Why:** SPEC §4.2. Living in `src/hooks/` (not `src/store/`) avoids the circular import between `currentBrandStore.ts` and `useBrands.ts`.
**Lines changed:** +47 (new file).

### 2.3 — `mingla-business/src/hooks/useBrands.ts`

**Before:** no synchronous lookup helper for non-hook callers.
**Now:** added `getBrandFromCache(brandId)` exported helper. Detail-cache-first, list-cache-fallback, returns `Brand | null`. Imports `queryClient` from `../config/queryClient`.
**Why:** SPEC §4.4 — gives Zustand actions / converters / fire-and-forget handlers a hook-free way to read fresh Brand data.
**Lines changed:** +29 / −0.

### 2.4 — `mingla-business/app/brand/[id]/edit.tsx`

**Before:** read `s.currentBrand` to mirror updates back into Zustand after a successful brand-edit save (`Mirror to currentBrand selection` block, lines 75-79). Read `getState().currentBrand` for delete-handler comparison.
**Now:** `currentBrand` selector deleted. Mirror-write block deleted (now dead code: `useUpdateBrand.onSuccess` writes the fresh Brand back into the React Query detail + list caches and the wrapper hook re-renders automatically). Delete handler reads `getState().currentBrandId` instead.
**Why:** SPEC §4.5.1 + §4.6 Group A + D-0742-3.
**Lines changed:** ~−7.

### 2.5 — `mingla-business/app/brand/[id]/payments/onboard.tsx`

**Before:** declared `const currentBrand = useCurrentBrandStore((s) => s.currentBrand)` at line 33. The downstream consumer was already removed by the B2a Stripe Connect refactor (per the file's own line 50-53 comment: "fictional state advance is DELETED").
**Now:** unused selector deleted entirely; `useCurrentBrandStore` import removed.
**Why:** SPEC §4.5.2 + Const #8 (subtract before adding) — the SPEC-quoted dead-code mirror block at lines 71-73 was already gone, leaving the line-33 selector as orphaned. See §6 Discoveries.
**Lines changed:** −5.

### 2.6 — `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**Before:** `const currentBrand = useCurrentBrandStore((s) => s.currentBrand);` (line 87). Active-row marker used `currentBrand !== null && currentBrand.id === brand.id`. Two `setCurrentBrand(brand)` calls on row-tap and create-success (lines 117 + 313).
**Now:** selector reads `s.currentBrandId` instead. Active marker uses `currentBrandId === brand.id`. Both `setCurrentBrand(...)` write paths preserved (Option A — internal ID extraction).
**Why:** SPEC §4.5.3.
**Lines changed:** ~−2.

### 2.7 — `mingla-business/app/(tabs)/home.tsx`, `events.tsx`, `account.tsx`, `brand/[id]/index.tsx`, `brand/[id]/edit.tsx` (Group A — auto-clear pattern)

**Before:** `const current = useCurrentBrandStore.getState().currentBrand; if (current !== null && current.id === deletedBrandId) { setCurrentBrand(null); }`
**Now:** `const currentBrandId = useCurrentBrandStore.getState().currentBrandId; if (currentBrandId === deletedBrandId) { setCurrentBrand(null); }`
**Why:** SPEC §4.6 Group A — 5 sites × identical transformation. `setCurrentBrand(null)` preserved (extracts to `currentBrandId: null` internally).
**Lines changed:** ~−10 across 5 files.

### 2.8 — `mingla-business/src/components/orders/RefundSheet.tsx`, `CancelOrderDialog.tsx`, `app/event/[id]/orders/[oid]/index.tsx`, `src/store/liveEventStore.ts` (Group B — full-Brand lookup)

**Before:** each declared `const currentBrand = useCurrentBrandStore.getState().currentBrand;` then derived `brandName = currentBrand !== null && currentBrand.id === <id> ? currentBrand.displayName : "";` for notification copy. Imported `useCurrentBrandStore`.
**Now:** each calls `getBrandFromCache(<brandId>)` and uses `cachedBrand?.displayName ?? ""`. Imports switched to `getBrandFromCache` from `../hooks/useBrands` (path-relative per file).
**Why:** SPEC §4.6 Group B — centralised cache lookup; same fall-back semantic.
**Lines changed:** ~−20 across 4 files.

### 2.9 — `mingla-business/src/utils/liveEventConverter.ts` (Group B — special simplification)

**Before:** 17-line IIFE that first checked `useCurrentBrandStore.getState().currentBrand`, then iterated `queryClient.getQueriesData<Brand[]>({ queryKey: brandKeys.lists() })` as fallback. Imported `useCurrentBrandStore`, `Brand` type, `queryClient`, `brandKeys`.
**Now:** single line `const brand = getBrandFromCache(draft.brandId);`. The first-branch optimisation deleted (the helper handles all paths uniformly). Imports trimmed to `getBrandFromCache` only.
**Why:** SPEC §4.6 special case + Const #8.
**Lines changed:** −15 / +5.

---

## 3. Spec Traceability — Success Criteria Verification

| ID | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | Persisted state contains only `currentBrandId` | ✅ PASS | `partialize` returns `{ currentBrandId }` only at `currentBrandStore.ts:377-379`. |
| SC-2 | v13 → v14 migration extracts `currentBrand.id` and discards rest | ✅ PASS (code-verified) | Migrate function at `currentBrandStore.ts:381-394` reads `old.currentBrand?.id`. Live cold-start verification deferred to mingla-tester (manual blob-plant). |
| SC-3 | `useCurrentBrand()` returns server-fresh `Brand \| null` | ✅ PASS | Wrapper at `useCurrentBrand.ts` calls `useBrand(currentBrandId)`. Re-export at `currentBrandStore.ts:415` keeps existing import sites stable. |
| SC-4 | Cross-device delete propagation | ✅ PASS (code-verified) | Cycle-1 focusManager + Cycle-2 auto-clear `useEffect` chain proven at the code level; manual cross-device E2E deferred to tester. |
| SC-5 | Cross-device rename propagation | ✅ PASS (code-verified) | Same chain as SC-4; `useBrand` 5-min staleTime + focusManager refetch returns the renamed Brand. Manual E2E deferred to tester. |
| SC-6 | Cold-start with deleted brand auto-clears | ✅ PASS (code-verified) | Auto-clear `useEffect` at `useCurrentBrand.ts:38-42` gated on `isFetched && brand === null`. Manual cold-start blob-plant test deferred to tester. |
| SC-7 | `tsc --noEmit` exit 0 | ✅ PASS | Real exit code 0 captured this session. |
| SC-8 | `expo export -p web` exit 0 | ✅ PASS | Bundled 2008 modules, full route table emitted (52 routes including all touched files), `Exported: dist`, exit 0. |
| SC-9 | Strict-grep CI gates pass | ✅ PASS | Local probes: 0 `setBrands(` callers (I-PROPOSED-C preserved). No new write paths added. |
| SC-10 | No regression in 15 consumers | ✅ PASS (code-verified) | See §5 — every consumer mapped to its post-edit behaviour. Manual smoke-tests deferred to tester. |
| SC-11 | (Hotfix) `currentRank` declared exactly once each | ✅ PASS | door/index.tsx:160, scanners/index.tsx:135 — 1 hit each. |
| SC-12 | (Hotfix) Zero `V11Brand` references | ✅ PASS | 0 hits across `mingla-business/`. |

Verification labels:
- "PASS" = static / build-time evidence captured this session.
- "PASS (code-verified)" = the code path is correct on inspection; runtime / live-device verification belongs to mingla-tester.

---

## 4. Invariant Verification

| Invariant | Status | Note |
|-----------|--------|------|
| Const #1 (no dead taps) | ✅ Preserved | No UI changes. |
| Const #2 (one owner per truth) | ✅ Strengthened | Server data has exactly one owner now (React Query). Zustand holds only the client pointer. |
| Const #3 (no silent failures) | ✅ Preserved | Auto-clear is a deliberate, documented behaviour with `isFetched` guard against spurious clears. |
| Const #4 (one query key per entity) | ✅ Preserved | No new keys; `getBrandFromCache` reads via existing `brandKeys.detail` / `brandKeys.lists`. |
| Const #5 (server state stays server-side) | ✅ Strengthened | Full Brand snapshot leaves Zustand entirely. |
| Const #6 (logout clears everything) | ✅ Preserved | `reset()` still clears `currentBrandId`; `clearAllStores` still calls `reset()`; signOut still calls `queryClient.clear()` (Cycle 1). |
| Const #7 (label temporary) | ✅ Preserved | New wrapper documents EXIT condition for I-PROPOSED-C in its docblock. |
| Const #8 (subtract before adding) | ✅ Strengthened | Removed: persisted Brand snapshot, `liveEventConverter` first-branch optimisation, dead `Mirror to currentBrand` block in `brand/edit.tsx`, orphaned selector in `payments/onboard.tsx`. |
| Const #14 (persisted-state startup) | ✅ Strengthened | Cold-start no longer replays stale Brand snapshot — only an ID. |
| I-PROPOSED-C (server state via React Query) | ✅ Strengthened | 0 `setBrands(` write paths; new helper `getBrandFromCache` is read-only. |
| I-PROPOSED-J (ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS) | ✅ ACTIVE on this CLOSE | New invariant codified; `currentBrand` is the first store to comply. CI-gate authoring deferred per SPEC §6.2. |
| I-32 (BrandRole rank parity) | ✅ Preserved | Orthogonal. |
| I-PROPOSED-H/I (RLS-RETURNING-OWNER-GAP-PREVENTED + MUTATION-ROWCOUNT-VERIFIED) | ✅ Preserved | Orthogonal — no DB changes. |

---

## 5. 15-Consumer Cascade Verification

Per SPEC §1.2 — every consumer's post-edit state and verification:

| # | File | Pattern | Cycle-2 action | Verification |
|---|------|---------|----------------|--------------|
| 1 | `src/components/ui/TopBar.tsx:144` | `useCurrentBrand()` (display) | No-op — wrapper auto-resolves to fresh Brand | ✅ Re-export from `currentBrandStore.ts:415`; no API change. |
| 2 | `app/(tabs)/home.tsx:103, 142` | `useCurrentBrand()` + imperative auto-clear | Auto-clear migrated | ✅ Lines updated this session (§2.7). |
| 3 | `app/(tabs)/events.tsx:111, 281` | Same pattern | Auto-clear migrated | ✅ Lines updated this session (§2.7). |
| 4 | `app/(tabs)/account.tsx:145` | Imperative auto-clear | Migrated | ✅ Lines updated this session (§2.7). |
| 5 | `app/brand/[id]/index.tsx:53` | Imperative auto-clear | Migrated | ✅ Lines updated this session (§2.7). |
| 6 | `app/brand/[id]/edit.tsx:46, 77, 97` | Selector + imperative + dead mirror | Migrated; mirror-write deleted | ✅ Lines updated this session (§2.4 + §2.7). |
| 7 | `app/brand/[id]/payments/onboard.tsx:38` | Selector | **Selector deleted** (already-orphaned post-B2a) | ✅ Lines updated this session (§2.5). |
| 8 | `app/event/create.tsx:39` | `useCurrentBrand()` (display) | No-op — wrapper auto-resolves | ✅ Re-export keeps the import working unchanged. |
| 9 | `app/event/[id]/orders/[oid]/index.tsx:220` | Imperative full-Brand | Migrated to `getBrandFromCache` | ✅ Lines updated this session (§2.8). |
| 10 | `src/utils/liveEventConverter.ts:46` | Imperative full-Brand IIFE | Simplified to single helper call | ✅ Lines updated this session (§2.9). |
| 11 | `src/store/liveEventStore.ts:473` | Imperative full-Brand IIFE | Migrated to `getBrandFromCache` | ✅ Lines updated this session (§2.8). |
| 12 | `src/components/orders/RefundSheet.tsx:216` | Imperative full-Brand | Migrated | ✅ Lines updated this session (§2.8). |
| 13 | `src/components/orders/CancelOrderDialog.tsx:102` | Imperative full-Brand | Migrated | ✅ Lines updated this session (§2.8). |
| 14 | `src/components/brand/BrandSwitcherSheet.tsx:87, 117, 313` | Selector + 2× setter writes | Selector migrated; setter writes preserved | ✅ Lines updated this session (§2.6). |
| 15 | `src/utils/clearAllStores.ts:31` | `useCurrentBrandStore.getState().reset()` | No-op — `reset()` still clears `currentBrandId` | ✅ Reset semantics preserved at `currentBrandStore.ts:407`. |

---

## 6. Discoveries for Orchestrator

| ID | Type | Description |
|----|------|-------------|
| D-0742-IMPL-1 | 🔵 | `app/brand/[id]/payments/onboard.tsx` line-33 `currentBrand` selector was already orphaned by B2a Stripe Connect refactor — its consumer block (SPEC §4.5.2 lines 71-73) was deleted by the prior cycle. Resolution: deleted the selector entirely (Const #8), did not migrate it. SPEC §4.5.2's "Update line 71 comparison" no longer applicable. |
| D-0742-IMPL-2 | 🔵 | `mingla-business` build environment on this Mac lacked a configured `.env` file and the Bash sandbox in this Claude Code session lacked `node`/`npx` on `$PATH`. Workaround: explicit `node` invocation via `/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node`, plus stub `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` env vars to bypass the runtime Supabase-client constructor validation during `expo export -p web`. Bundle compile is clean either way; static-render needs real env. Recommend orchestrator note this for future Mac sessions. |
| D-0742-IMPL-3 | 🔵 | Pre-existing diag console.error markers `[ORCH-0728-DIAG]`, `[ORCH-0729-DIAG]`, `[ORCH-0730-DIAG]`, `[ORCH-0733-DIAG]`, `[ORCH-0734-RW-DIAG]` survive in `useBrands.ts` and `BrandSwitcherSheet.tsx` (per D-0742-4). Out of Cycle 2 scope; left untouched. |
| D-0742-IMPL-4 | 🔵 | `liveEventConverter.ts` error message at line 50 still reads `Cannot publish: brand ${draft.brandId} not found in store.` — "store" is now technically inaccurate (the lookup is the React Query cache). Cosmetic only; left as-is to keep diff scope tight. Consider updating in a future trim cycle. |

---

## 7. Parity Check

- **Mobile vs web parity:** Single code path. No Platform.OS branching introduced. `expo export -p web` confirms web bundle. iOS / Android use the same files.
- **Solo vs collab:** N/A — `currentBrandStore` is per-user client state, not a collab surface.

---

## 8. Cache Safety

- Query keys unchanged: `brandKeys.list(accountId)`, `brandKeys.detail(brandId)`, `brandKeys.lists()`. No factory drift.
- New cache READER (`getBrandFromCache`) — read-only, no writes, no invalidation. Cannot cause stale-cache bugs.
- Persist storage key bumped from `mingla-business.currentBrand.v13` → `mingla-business.currentBrand.v14`. Migrate function reads either old (`currentBrand?.id`) or new (`currentBrandId`) shape. Cold-start contract: first render fetches live Brand via `useBrand(id)`; splash gate covers the loading window (no flash).
- React Query staleTime / focusManager / 30s role TTL all preserved from Cycle 1.

---

## 9. Regression Surface (recommended tester focus)

1. **Cold-start with persisted v13 blob** — does `migrate` correctly extract the ID from the old `{currentBrand: {id, ...}}` shape? Manual blob-plant in AsyncStorage and force-cold-start.
2. **Cold-start with phantom brand ID** — plant a `currentBrandId` of a known-deleted brand; cold-start should resolve to `useCurrentBrand() === null` after the auto-clear `useEffect` fires once.
3. **Brand switcher** — picking a brand should set `currentBrandId` and the TopBar should render the freshly-fetched Brand.
4. **Brand edit** — renaming a brand: `useCurrentBrand()` returns the new name within the same render cycle (via `useUpdateBrand.onSuccess` updating the detail cache).
5. **Cross-device delete** — delete on Phone, foreground Tablet: `useCurrentBrand()` should return null, all currentBrand-gated CTAs vanish, no crash.
6. **Notification copy** — RefundSheet / CancelOrderDialog / order-detail Resend / liveEventStore.recordEdit should still produce non-empty `brandName` when the brand is in the React Query cache.
7. **Draft publish** — `convertDraftToLiveEvent` still resolves the Brand and freezes the slug correctly when publishing for the active brand and for any brand in the list cache.
8. **Sign out** — `clearAllStores` clears `currentBrandId`; `queryClient.clear()` (Cycle 1) wipes server caches; next sign-in starts fresh.

---

## 10. Constitutional Compliance

Quick-scanned against the 14 principles (see §4 Invariant Verification for the long form). No violations introduced. Three principles strengthened (#2, #5, #8), one new invariant added to active set (I-PROPOSED-J).

---

## 11. Hand-back to Orchestrator

1. **No commit performed** — operator commits per established protocol.
2. Next dispatch sequence per memory rule "Post-Tester Flow":
   - Orchestrator REVIEW → operator commits → operator dispatches `/mingla-tester` against this report.
   - Tester PASS → orchestrator CLOSE protocol (update 7 artifacts + commit message + EAS commands) → Cycle 3 (Realtime push) dispatch.
   - Tester FAIL → orchestrator writes Implementor rework prompt; this report becomes `IMPLEMENTATION_ORCH_0742_REPORT_v2.md`.

3. Recommended commit-message draft (no Co-Authored-By per memory rule):

```text
feat(mingla-business): ORCH-0742 Phase 2 — currentBrand ID-only architectural fix

Convert currentBrandStore from persisted full Brand snapshot to persisted
brand ID + React Query for fresh data. 1 new file, 12 edits, ~80 LOC net
delta. No DB changes, no visible UI changes, single code path on iOS /
Android / Web.

Architecture:
- store: persists currentBrandId: string | null only (v14 key bump);
  setCurrentBrand(brand) preserved (extracts id internally — Option A);
  new setCurrentBrandId(id) + useCurrentBrandId() for ID-only consumers
- new src/hooks/useCurrentBrand.ts: server-fresh wrapper around
  useBrand(currentBrandId) with auto-clear useEffect on isFetched + null
  (clears phantom selection on cold-start)
- new getBrandFromCache(brandId) helper in useBrands.ts for non-hook
  consumers (5 sites: RefundSheet, CancelOrderDialog, order detail,
  liveEventStore, liveEventConverter)

Migrations: v13 → v14 reads old.currentBrand?.id and falls back to
old.currentBrandId. Splash gate covers initial loading window.

Cycle 1 work (focusManager, queryClient.clear in signOut, brandRoleKeys
factory, 30s role TTL) untouched. I-PROPOSED-J (ZUSTAND-PERSIST-NO-
SERVER-SNAPSHOTS) flips ACTIVE on CLOSE.

Verification: tsc --noEmit exit 0; expo export -p web exit 0 (2008
modules, 52 routes); 0 leftover (s)=>s.currentBrand selectors; exactly 5
getBrandFromCache callers; 0 setBrands callers (I-PROPOSED-C preserved);
Phase 1 hotfix protected (currentRank x1 each, V11Brand 0 hits).

Closes: ORCH-0742-PHASE-2 (Cycle 2 architectural).
```

---

**End of report.**
