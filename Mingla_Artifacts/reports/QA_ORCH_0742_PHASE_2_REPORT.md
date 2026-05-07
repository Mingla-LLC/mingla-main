# QA Report — ORCH-0742 Phase 2 (currentBrand ID-only)

**Date:** 2026-05-06
**Tester:** mingla-tester
**Mode:** TARGETED + SPEC-COMPLIANCE
**Commit under test:** `80c15297e1e4d707e8914af50439b7b5ba9acab6` (HEAD on `Seth`, pushed to `origin/Seth`)
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`](../specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md)
**Implementor report:** [`reports/IMPLEMENTATION_ORCH_0742_REPORT.md`](IMPLEMENTATION_ORCH_0742_REPORT.md)
**Dispatch:** [`prompts/TEST_ORCH_0742_PHASE_2.md`](../prompts/TEST_ORCH_0742_PHASE_2.md)

---

## 1. Verdict — **CONDITIONAL PASS**

| Severity | Count |
|----------|-------|
| P0 — CRITICAL | **0** |
| P1 — HIGH | **2** (one is mitigation-required, one is rare-edge-case) |
| P2 — MEDIUM | **2** |
| P3 — LOW | **1** |
| P4 — NOTE | **3** |

**Layman summary:** The architectural fix is structurally correct — the persisted Brand snapshot is gone, the v13→v14 migration is sound across all input shapes, the auto-clear `useEffect` is gated correctly to prevent spurious clears, every grep gate passes, the consumer cascade is migrated, and there is zero spillover into admin/supabase/app-mobile. **However**, a transient cold-start flash exists because the splash gate at `_layout.tsx:55-75` only waits for AuthContext bootstrap, not for the new `useBrand(currentBrandId)` query. On cold-start with a persisted brand ID, every screen that reads `useCurrentBrand()` will see `null` for ~100ms–1s (network-dependent) before the wrapper resolves. The flash is bounded and the fix can ship — but the conditions below must be acknowledged.

---

## 2. Conditions (must accept or fix to clear PASS)

### C1 — P1 — Cold-start "flash of null" before useBrand resolves

**Site:** `_layout.tsx:55-75` (splash gate) does NOT wait on `useBrand(currentBrandId).isFetched`. Splash hides at `loading: false && elapsed >= 500ms` from AuthContext, regardless of whether the brand fetch has resolved.

**Reproduction (code-traced):**
1. App cold-launch with persisted `currentBrandId: "X"` in AsyncStorage v14 blob.
2. T=0–500ms: splash visible.
3. T=500ms+: tab tree mounts. `useBrand("X")` is enabled but `data: undefined`, `isFetched: false`. Wrapper returns `null`.
4. T=500ms+: render fires for `home.tsx`, `TopBar.tsx`, etc.
5. T=~600ms–2000ms (network-dependent): `useBrand` resolves with the Brand row. Wrapper re-renders.

**User-visible effects:**
- **TopBar.tsx:172** — flashes label "Create brand" → real brand name.
- **home.tsx:180** — `isEmpty = brands.length === 0 || currentBrand === null`. Both transiently true → renders "No brands yet" empty state → flips to populated state.
- **events.tsx:111** — `useDraftsForBrand(currentBrand?.id ?? null)` runs with `null` accountId during the flash → drafts list briefly empty.

**Why this is P1, not P0:** the architecture is correct (this is the price of replacing the persisted snapshot). The flash duration is bounded by network speed. Pre-Phase-2 had no flash but had stale data. Trade-off documented in SPEC §4.7 ("Splash gate (existing) covers the first-fetch window") — but the splash gate as implemented does NOT actually gate on the brand fetch, only on AuthContext.

**Recommended remediations (operator picks one):**
- **(a) Extend splash gate** in `_layout.tsx` to additionally wait on `useBrand(useCurrentBrandId()).isFetched` (or `data !== undefined`) before hiding splash. ~10 LOC. Eliminates flash entirely.
- **(b) Wire React Query persistence** to AsyncStorage via `@tanstack/query-async-storage-persister` (already installed per `queryClient.ts:19-23` comment but unused). Cache survives across cold-starts; no flash. ~30 LOC, 1 cycle.
- **(c) Accept the flash** as the correctness trade-off; document in user-facing notes and proceed. Operationally lowest-cost; user-visible cost is the flash itself.

Recommend (a) or (b) — operator's call on follow-up scope. Filing as a new ORCH (suggested: ORCH-0743 — currentBrand cold-start polish).

### C2 — P1 (rare edge case) — `event/create.tsx:42-49` redirect-on-null

**Site:** `event/create.tsx:42-49`:
```ts
useEffect(() => {
  if (currentBrand === null) {
    router.replace("/(tabs)/home" as never);
    return;
  }
  const newDraft = createDraft(currentBrand.id);
  router.replace(`/event/${newDraft.id}/edit?step=0` as never);
}, [currentBrand, createDraft, router]);
```

The effect redirects to home immediately on `currentBrand === null`. In typical flow, the user navigates to `/event/create` from home AFTER the home tab has already loaded the brand (cache warm via `useBrand` 5min staleTime), so the wrapper returns the cached Brand synchronously and the effect creates the draft. **SAFE in typical flow.**

**Edge case (rare):** cold-start + deep-link directly to `/event/create` (e.g., from a push notification or external URL). The cache is empty, `useBrand` is fetching, wrapper returns null, effect fires immediately and redirects to home. Draft never created.

**Recommended fix:** gate the effect on the wrapper having actually resolved. Two options:
- **(a)** Switch to `useCurrentBrandId()` for the synchronous ID check (added per SPEC §4.3 specifically for this kind of consumer):
  ```ts
  const currentBrandId = useCurrentBrandId();
  useEffect(() => {
    if (currentBrandId === null) { router.replace("/(tabs)/home"); return; }
    const newDraft = createDraft(currentBrandId);
    router.replace(`/event/${newDraft.id}/edit?step=0`);
  }, [currentBrandId, createDraft, router]);
  ```
  Synchronous; no React Query roundtrip; fixes the redirect loop completely. 2 LOC.
- **(b)** Read `useBrand(useCurrentBrandId()).isFetched` and only redirect when fetched-and-null.

**Why this is P1 (not P2):** the bug is real, the fix is trivial, and a deep-link to `/event/create` is a plausible flow once push notifications or external app shortcuts ship.

### C3 — P2 — Five `useCurrentBrand()` consumers not migrated to `useCurrentBrandId()`

**Sites:**
- `app/(tabs)/home.tsx:103` — uses `currentBrand?.id` for `useDraftsForBrand`. ID-only.
- `app/(tabs)/events.tsx:111` — uses `currentBrand?.id` for `useDraftsForBrand` + `useLiveEventsForBrand`. ID-only.
- `app/event/create.tsx:39` — uses `currentBrand.id`. ID-only. (Same site as C2.)

The other 2 (`TopBar.tsx:144`, `brand/edit.tsx` indirect via mutation) genuinely need full Brand for displayName/edit-state. Those are correct as-is.

**Why this is P2:** SPEC §4.3 explicitly added `useCurrentBrandId` for this exact use case. Implementor missed migrating the 3 ID-only consumers. Fixing them eliminates 3 unnecessary loading-window penalties. Same fix as C2 (a) but applied to home + events. Also reduces flash severity for C1.

### C4 — P3 — Cosmetic: `liveEventConverter.ts:46` "not found in store"

After Phase 2, the helper reads the React Query cache, not Zustand. The error log message at `liveEventConverter.ts:46` should say "not found in cache" for accuracy. 1 LOC. Implementor flagged this as D-0742-IMPL-4. Non-blocking.

### C5 — P4 — Note: SPEC §4.5.2 / §4.6 line numbers drift

SPEC's "Update line 71 comparison to currentBrandId === updated.id" referred to a dead-code mirror block that was already deleted by the prior B2a Stripe Connect refactor before Phase 2 started. Implementor correctly deleted the orphaned selector instead of migrating it (D-0742-IMPL-1). Process note for orchestrator: SPECs that lock line numbers go stale fast when other cycles touch the same files — consider line-range markers or pattern matchers instead.

---

## 3. SPEC Success Criteria — Verification Matrix

| ID | Criterion | Tester Result | Evidence |
|----|-----------|----------|----------|
| SC-1 | Persisted state contains only `currentBrandId` | ✅ PASS | `currentBrandStore.ts:377-379` — `partialize` returns `{ currentBrandId: state.currentBrandId }` only. Type `PersistedState = Pick<CurrentBrandState, "currentBrandId">` enforces this at compile-time. |
| SC-2 | v13 → v14 migration extracts ID and discards rest | ✅ PASS (code-verified, all 7 input shapes traced) | `currentBrandStore.ts:381-397`. Traced shapes: (a) v14 entry → passthrough; (b) v13 with `currentBrand: { id: "X" }` → `{ currentBrandId: "X" }`; (c) v13 with `currentBrand: null` → `{ currentBrandId: null }`; (d) v13 with no currentBrand key → null; (e) null persistedState → null; (f) v12 or earlier → same as (b)/(c)/(d); (g) corrupted v13 with `currentBrandId` accidentally already set → preserves it. All paths return a valid `PersistedState`. Live blob-plant verification deferred to operator (no emulator/device in tester sandbox). |
| SC-3 | `useCurrentBrand()` returns server-fresh Brand via React Query | ✅ PASS | `useCurrentBrand.ts:36-48` calls `useBrand(currentBrandId)` and returns `brand ?? null`. Re-export at `currentBrandStore.ts:446` works (verified — TopBar.tsx:144, home.tsx:103, events.tsx:111, event/create.tsx:39 all import from currentBrandStore and resolve cleanly through tsc). |
| SC-4 | Cross-device delete propagation | ✅ PASS (code-verified) | Cycle 1's `focusManager.setFocused` at `_layout.tsx:84-91` triggers query invalidation on app-foreground; `useBrand(id)` refetches; if backend returns null, the wrapper's `useEffect` at `useCurrentBrand.ts:41-45` fires `setCurrentBrandId(null)`. Live cross-device E2E deferred to operator (requires 2 physical devices). |
| SC-5 | Cross-device rename propagation | ✅ PASS (code-verified) | Same chain as SC-4: foreground refetch returns the renamed Brand row; wrapper re-renders. Live E2E deferred to operator. |
| SC-6 | Cold-start with deleted brand auto-clears | ✅ PASS (code-verified) | Auto-clear gate at `useCurrentBrand.ts:42` correctly checks `currentBrandId !== null && isFetched && brand === null`. Traced 4 states: loading (`isFetched: false` → no fire), success-with-brand (`brand !== null` → no fire), success-with-null (`brand === null && isFetched: true` → fires), error (`data: undefined` → strict `=== null` fails → no spurious fire). Live blob-plant verification deferred to operator. |
| SC-7 | `tsc --noEmit` exit 0 | ✅ PASS | Independently re-run by tester this session: `node node_modules/typescript/bin/tsc --noEmit; echo TSC_EXIT=$?` → `TSC_EXIT=0`. |
| SC-8 | `expo export -p web` exit 0 | ✅ PASS | Independently re-run by tester this session: `node node_modules/expo/bin/cli export -p web` (with stub Supabase env) → exit 0; full route table emitted including all touched routes (52 routes, 2008 modules). |
| SC-9 | Strict-grep CI gates pass | ✅ PASS | All 8 invariant grep gates green (zero `setBrands(`, zero leftover `(s) => s.currentBrand` selectors, etc. — see §4 below). I-PROPOSED-C preserved. |
| SC-10 | No regression in 15 consumers | ⚠️ CONDITIONAL — see C1, C2, C3 | 12/15 consumers PASS. 3 sites (`home.tsx`, `events.tsx`, `event/create.tsx`) suffer transient null on cold-start due to wrapper's loading-window behavior. Architecture is correct; UX trade-off documented above. |
| SC-11 | (Hotfix) `currentRank` declared exactly once | ✅ PASS | `door/index.tsx:160` (1 hit), `scanners/index.tsx:135` (1 hit). |
| SC-12 | (Hotfix) Zero `V11Brand` references | ✅ PASS | 0 hits in `mingla-business/`. |

---

## 4. Independent grep gates

All 11 gates run by tester this session against commit `80c15297`:

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| Leftover `useCurrentBrandStore((s) => s.currentBrand)` selectors | 0 | 0 | ✅ |
| Leftover `getState().currentBrand` reads (code paths) | 0 | 0 (1 hit is a docblock comment in `useBrands.ts:79` — acceptable) | ✅ |
| `getBrandFromCache(` callers | 5 | 5 (RefundSheet, CancelOrderDialog, order detail, liveEventStore, liveEventConverter) | ✅ |
| `mingla-business.currentBrand.v13` storage key | 0 | 0 | ✅ |
| `mingla-business.currentBrand.v14` storage key | 1 | 1 (`currentBrandStore.ts:375`) | ✅ |
| `setBrands(` write paths | 0 | 0 | ✅ |
| `V11Brand` references | 0 | 0 | ✅ |
| `currentRank` decls in door/scanners | 1 each | 1 each | ✅ |
| `useCurrentBrand` re-export from store | 1 | 1 (`currentBrandStore.ts:446`) | ✅ |
| Existing import sites resolved through re-export | All | TopBar, home, events, event/create — all resolve | ✅ |
| Cross-domain spillover (admin / app-mobile / supabase) | 0 | 0 | ✅ |

---

## 5. Implementor-discovered cases (EXTRA-1…EXTRA-4)

| ID | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| EXTRA-1 | `payments/onboard.tsx` no longer imports `useCurrentBrandStore` | ✅ PASS | grep returns 0 hits; only `useBrandList` import remains. Route still typechecks + bundles. |
| EXTRA-2 | `liveEventConverter.ts` no longer imports `queryClient`, `brandKeys`, `useCurrentBrandStore` | ✅ PASS | grep returns 0 hits for all three. Only `getBrandFromCache` import remains. Function logic simplified to single helper call (line 40). |
| EXTRA-3 | `getBrandFromCache` cache miss returns null (not undefined) | ✅ PASS | All return paths in `useBrands.ts:86-101` return `null` (typed signature `Brand \| null`). No path returns `undefined`. Downstream consumers use `?? ""` safely. |
| EXTRA-4 | Auto-clear `useEffect` does NOT fire during initial loading | ✅ PASS | Traced: during loading, `isFetched: false` → gate `currentBrandId !== null && isFetched && brand === null` is FALSE → no fire. The TanStack Query strict `isFetched` flag flips to `true` only after the queryFn resolves at least once, so spurious clear during the loading window is impossible. |

---

## 6. Constitutional 14-rule audit

| # | Principle | Result | Evidence |
|---|-----------|--------|----------|
| 1 | No dead taps | ✅ N/A | No UI changes. Pre-existing tap behaviors preserved. |
| 2 | One owner per truth | ✅ STRENGTHENED | Server data → React Query (single owner); client pointer → Zustand. Full Brand snapshot left Zustand entirely. |
| 3 | No silent failures | ✅ PASS | Auto-clear is intentional + documented; not a swallowed error. Network errors leave `data: undefined`, which fails the strict `=== null` check, preventing spurious clear. |
| 4 | One key per entity | ✅ PASS | `brandKeys.list/detail/lists/cascadePreview` factories used; `getBrandFromCache` reads via factories, not hardcoded keys. |
| 5 | Server state server-side | ✅ STRENGTHENED | Const #5 explicitly strengthened by this cycle — full Brand object no longer in Zustand. |
| 6 | Logout clears everything | ✅ PASS | `clearAllStores.ts:31` calls `useCurrentBrandStore.getState().reset()`. New `reset()` at `currentBrandStore.ts:408` sets `currentBrandId: null`. signOut still calls `queryClient.clear()` (Cycle 1, untouched). |
| 7 | Label temporary | ✅ PASS | `useCurrentBrand.ts` docblock + `currentBrandStore.ts:441-446` re-export comment document the EXIT condition for the wrapper pattern. |
| 8 | Subtract before adding | ✅ STRENGTHENED | Multiple deletions: persisted Brand snapshot, `liveEventConverter` first-branch optimization, dead `Mirror to currentBrand` block in `brand/edit.tsx`, orphaned selector in `payments/onboard.tsx`. |
| 9 | No fabricated data | ✅ N/A | No data-display changes. |
| 10 | Currency-aware | ✅ N/A | No currency surfaces touched. |
| 11 | One auth instance | ✅ N/A | Auth surface untouched. |
| 12 | Validate at right time | ✅ N/A | No validation surfaces. |
| 13 | Exclusion consistency | ✅ N/A | No filter logic. |
| 14 | Persisted-state startup | ⚠️ PARTIAL | The persisted state (`currentBrandId`) is correct on cold-start. But "works correctly from cold cache" is partially compromised by the loading window for the wrapper hook (see C1). Pre-Phase-2 had full Brand persisted, no fetch needed. Post-Phase-2 needs network roundtrip to render TopBar correctly. SPEC §4.7 acknowledged this gap. Wiring React Query persistence to AsyncStorage in a follow-up cycle would close the gap. |

**Verdict: 12 PASS / 1 PARTIAL (Const #14, by design trade-off) / 0 FAIL.** No P0 constitutional violation.

---

## 7. Cross-domain blast — clean

Cross-domain spillover check across the monorepo:

```
grep -rn "useCurrentBrandStore|currentBrandId" mingla-admin/ supabase/ app-mobile/
→ 0 hits
```

`mingla-admin/`, `supabase/`, and `app-mobile/` are correctly untouched. Phase 2 is properly scoped to `mingla-business/`. No DB / RLS / edge-function impact. No admin dashboard impact. No app-mobile (consumer-side) impact.

---

## 8. Regression surface — tester recommendations to operator

Post-deploy operator smoke-tests (in priority order):

1. **(blocks PASS-acceptance)** Cold-start a clean install, sign in fresh, pick a brand on Phone, force-quit + relaunch — observe how long the "Create brand" / empty-state flash lasts. If <300ms it's barely perceptible; if >500ms it's a real UX hit. This calibrates whether C1 is ship-as-is or follow-up-required.
2. **(blocks PASS-acceptance for deep-link flows)** Cold-start + deep-link directly to `/event/create` (simulate via Expo dev URL or test with a push notification). Verify the route doesn't loop back to home.
3. AsyncStorage v13 → v14 migration — manually plant a v13 blob, force-cold-start, dump v14 blob via debugger or `await AsyncStorage.getItem(...)`. Confirm only `currentBrandId` survives. Implementor-side reasoning is sound; live verification belongs to operator.
4. Cross-device delete + rename E2E (requires 2 physical devices). Cycle 1's focusManager + Cycle 2's wrapper auto-clear chain proven at code level; live confirmation valuable.
5. Brand edit save → TopBar reflects new name on the same Phone. Code path: `useUpdateBrand.onSuccess` writes Brand to detail + list caches → wrapper re-renders. No mirror-write needed. Verify live.
6. signOut → `clearAllStores` clears `currentBrandId`. Sign back in — fresh `currentBrandId: null` state. Verify no residual brand snapshot anywhere.
7. RefundSheet / CancelOrderDialog notifications — verify `brandName` is non-empty when the brand is cached (typical flow); empty when cache cold (acceptable per SPEC §4.6 best-effort semantic).
8. Draft publish — `convertDraftToLiveEvent` should resolve brand and freeze brandSlug correctly when active brand is cached. With cache cold, returns null + draft preserved (correct fail-loud behavior per SPEC §4.6 special case).

---

## 9. Discoveries for orchestrator

| ID | Type | Description |
|----|------|-------------|
| D-0742-QA-1 | 🟠 follow-up | Cold-start flash for `useCurrentBrand()` consumers (C1). Recommend new ORCH for splash-gate extension OR React Query persistence wiring. |
| D-0742-QA-2 | 🟠 follow-up | `event/create.tsx` redirect-on-null edge case (C2). Trivial fix; can fold into the same follow-up ORCH or a small standalone patch. |
| D-0742-QA-3 | 🔵 process | `home.tsx`, `events.tsx`, `event/create.tsx` should migrate from `useCurrentBrand()` → `useCurrentBrandId()` for ID-only reads (C3). SPEC §4.3 added the hook explicitly for this; implementor missed the migration. Same trivial fix as C2. |
| D-0742-QA-4 | 🔵 cosmetic | `liveEventConverter.ts:46` "not found in store" → "not found in cache" (C4 / D-0742-IMPL-4). |
| D-0742-QA-5 | 🔵 process | SPEC line-number drift across cycles (C5 / D-0742-IMPL-1). Consider pattern-matchers or unique anchors instead of literal line numbers in future SPECs. |
| D-0742-QA-6 | 🔵 environment | Tester sandbox lacked `node`/`npx` on `$PATH`; required `/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node` direct invocation. Same issue as D-0742-IMPL-2. Operator may want to wire a `.envrc` or shell init for this sandbox. |
| D-0742-QA-7 | 🟢 positive | Architectural cleanliness is exemplary: 11/11 grep gates, 12 SC PASS, 4 EXTRA cases all PASS, constitutional audit 12 PASS / 1 partial-by-design. The PARTIAL on Const #14 is honest acknowledgment of the trade-off, not a defect. |

---

## 10. Recommended next actions (orchestrator-side)

1. **Accept CONDITIONAL PASS** with conditions C1–C5 logged. Run the 8-step DEPRECATION CLOSE EXTENSION because I-PROPOSED-J flips ACTIVE on this CLOSE.
2. **File ORCH-0743** (suggested name: "currentBrand cold-start polish") covering C1 + C2 + C3 in a single cycle — they share root cause (loading-window UX) and same fix patterns. Estimated ~1 day implementor effort + tester pass.
3. **Defer C4 + C5** as P3/process notes; address opportunistically.
4. **Operator runs the 8 smoke-tests in §8** post-deploy; if any FAIL, implementor rework dispatch with this report's findings.

---

**End of QA report.** Verdict file path: `Mingla_Artifacts/reports/QA_ORCH_0742_PHASE_2_REPORT.md`. Hand back to orchestrator for CLOSE protocol decision.
