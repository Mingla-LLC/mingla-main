# IMPLEMENTATION — ORCH-1143 [business Home live-card: scan parity + accordion + multi-live carousel]

**Skill:** mingla-implementor+claude · **Phase:** IMPLEMENT · **Date:** 2026-06-15
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`
**Commit:** `9bbf98980`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1143_LIVE_CARD_SCAN_ACCORDION_CAROUSEL.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1143_LIVE_CARD_SCAN_PARITY.md`
**App:** Mingla BUSINESS (`mingla-business/`). UI-only — NO backend, NO migration, NO edge-fn, NO new scanner route.

---

## 1. Summary

The business Home "Live now" section now: (1) shows a **Scan QR codes** button on EVERY live offering kind — event, experience, AND trip — all routing to the shared kind-agnostic `/event/{id}/scanner` (proven event-type-agnostic by the investigation; zero backend change); (2) is a **collapsible accordion** with a persisted, hydration-gated open/closed state (no flash-of-wrong-state on cold start); and (3) renders **all concurrently-live offerings** as a horizontal peek-width **carousel** (one full-width card when exactly one is live). The former inline hero was lifted into a reusable `LiveOfferingCard` (one owner per truth). The "Scanned" tile stays honest-empty (`—`); per-card revenue stays currency-aware.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `9bbf98980`) |
|----|-----------|--------|------------------------------|
| SC-1 | Scan button on every live kind → `/event/{id}/scanner` | ✓ | `LiveOfferingCard` emits the button unconditionally; `handleScanPress(id)` pushes `/event/${id}/scanner` with no kind gate (`home.tsx`). Test `home.orch_1143` T1/T10. |
| SC-1-iOS / Android | native scanner mounts (kind-aware) | ✓ (source-verified; runtime = tester) | route unchanged; `/event/[id]/scanner/index.tsx` byte-untouched. |
| SC-1-Web | routes to web EmptyState, not a dead tap | ✓ (source-verified) | button always enabled; `.web.tsx` ORCH-1099 EmptyState untouched. |
| SC-2 | ≥2 live → ALL render, live-first start-asc | ✓ | carousel maps `liveItems` (owned by `upcomingBuilder.liveItems`). Builder test T4/T12. |
| SC-3 | carousel ≥2; single full-width card for 1 | ✓ | `liveItems.length === 1 ? <card> : <ScrollView horizontal snapToInterval…>`. Test T-SC3. |
| SC-4 | accordion toggle (easeInEaseOut + chevron swap + expanded state) | ✓ | `LayoutAnimation.Presets.easeInEaseOut` + `chevU/chevD` + `accessibilityState.expanded`. Test T6. |
| SC-5 | persisted collapse + hydration gate (no flash) | ✓ | `liveSectionCollapseStore` (`hasHydrated` not persisted) + `showOpen = !hasHydrated || !collapsed`. Tests T7/T8. |
| SC-6 | honest data (Scanned `—`) + currency-aware | ✓ | Scanned cell `—`; revenue `view.currency ?? brand.defaultCurrency`. Tests SC-6. |
| SC-7 | live not duplicated in Upcoming list | ⚠ DEFERRED (see §10) | locked ORCH-0974 test A-05 pins `data={upcoming.items}`; de-dup would require a TEST-MOD-APPROVED ORCH. |
| SC-8 | logout cascade resets the store | ✓ | `reset` wired into `clearAllStores`. Tests SC-8/T11. |
| SC-9 | live TRIP renders a scannable card | ✓ | trips adapt via `tripToLiveEvent`; included in `liveEventViews`/metrics + scan. Builder test T2/T3. |

---

## 3. Files changed (commit `9bbf98980`; +968 / −284)

| File | Δ | What |
|------|---|------|
| `mingla-business/src/utils/upcomingBuilder.ts` | +18/−6 | add `liveItems` to `buildUpcomingItems` return + type |
| `mingla-business/src/hooks/useUpcomingForBrand.ts` | +7/−2 | thread `liveItems` through interface + return |
| `mingla-business/src/store/liveSectionCollapseStore.ts` | +67 NEW | persisted, `hasHydrated`-gated collapse store |
| `mingla-business/src/components/home/LiveOfferingCard.tsx` | +250 NEW | reusable live card (hero lifted) + contained scan button |
| `mingla-business/app/(tabs)/home.tsx` | +~288/−284 | accordion header + carousel/single render; generalized scan handler; metrics over `liveItems`; stale comment removed; dead hero styles removed |
| `mingla-business/src/utils/clearAllStores.ts` | +2 | wire `reset` (logout cascade) |
| `mingla-business/src/utils/reapOrphanStorageKeys.ts` | +1 | register new persist key (I-PROPOSED-M gate sync) |
| `mingla-business/app/(tabs)/__tests__/home.orch_1143.test.tsx` | +141 NEW | source-contract tests incl. T10 fails-on-revert |
| `mingla-business/src/utils/__tests__/upcomingBuilder.test.ts` | +110 | append ORCH-1143 `liveItems` tests (T2/T3/T4/T5/T12) |
| `mingla-business/src/store/__tests__/liveSectionCollapseStore.test.ts` | +84 NEW | store behaviour (T7/T8/T11) |

---

## 4. Data-model changes

NONE. No `supabase/` file touched. No migration, no edge fn, no RLS. (Investigation F-1..F-8 proved the scan backend is already event-type-agnostic.)

## 5. Edge functions touched

NONE. `/event/[id]/scanner` (index.tsx + index.web.tsx), `scan-ticket`, `biz_ticket_scan`, `useManagedEventRoute`, `tripToLiveEvent` all byte-unchanged (read-only consumers). No `verify_jwt` change.

---

## 6. Regression tests added + fails-on-revert proof

- **`mingla-business/app/(tabs)/__tests__/home.orch_1143.test.tsx`** (NEW, 10 tests) — source-contract proofs for carousel-off-`liveItems`, single-vs-carousel, accordion motion/glyph/expanded, hydration gate, scan-route-no-gate, honest data + currency, store persist/partialize, logout reset.
- **`mingla-business/src/store/__tests__/liveSectionCollapseStore.test.ts`** (NEW, 5 tests) — T7/T8/T11 store behaviour.
- **`mingla-business/src/utils/__tests__/upcomingBuilder.test.ts`** (APPENDED, +6 tests) — T2/T3/T4/T5/T12 `liveItems` enumeration over all kinds.

**fails-on-revert verified at `9bbf98980`** (TRUE LINE DELETION, not comment-out): deleting the scan-button `Pressable` block from `LiveOfferingCard.tsx` → `home.orch_1143` T10 FAILS (`Tests: 1 failed, 9 passed`); restoring the block (working tree byte-identical to the commit) → `Tests: 10 passed`. The revert removes the scan affordance for experience/trip live cards — exactly the bug.

Note on test style: the default biz-app jest config is node/ts-jest with NO RN renderer and `@testing-library/react-native` NOT installed (render proofs are segregated to dedicated configs per `jest.config.cjs`). The home proofs are therefore source-contract tests — the established repo pattern (mirrors `home.orch_0974.test.tsx`). Runtime/device live-fire of the per-kind scan happy path is the tester's job (INVESTIGATE flagged the end-to-end as "probable" pending live-fire).

---

## 7. Old → New receipts

### `app/(tabs)/home.tsx`
- **Before:** the live hero rendered only for `primaryLiveItem` of kind `event`/`experience` (trips excluded entirely); the "Scan QR codes" button showed ONLY when `primaryLiveItem.kind === "event"` (`showScanAction`); `handleScanPress` guarded `kind !== "event"`; static, single card; extra live offerings were demoted to Upcoming rows; stale ORCH-0965 comment claimed experiences were a stub and trips had no scanner.
- **Now:** consumes `upcoming.liveItems`; builds a `LiveEvent[]` view (trips via `tripToLiveEvent`) + a `liveMetricsById` map; renders a `LiveSectionHeader` (live dot + "Live now" + count chip + chevron, whole-section collapse via `LayoutAnimation` easeInEaseOut, Android guard at module top, `accessibilityState.expanded`); body = one full-width `LiveOfferingCard` (1 live) or a horizontal `ScrollView` of peek-width cards (≥2); `handleScanPress(id)` routes EVERY kind to `/event/${id}/scanner`; collapse persisted + hydration-gated (`showLiveOpen = !hasHydrated || !collapsed`); stale comment deleted; the live section renders ABOVE the ORCH-0974 locked single-scroll pane so the carousel's horizontal scroller never violates that lock; dead hero styles removed (moved to the card).
- **Why:** SC-1..SC-6, SC-9; DISC-1143-A/B.
- **Lines:** ~288 changed.

### `src/components/home/LiveOfferingCard.tsx` (NEW)
- **Now:** reusable per-offering live card — live pill, name, date, revenue (32/36 hero number), optional progress bar (capacity-gated), sold/capacity/scanned stat row (Scanned always `—`), and a contained 44pt warm-tinted **Scan QR codes** button emitted UNCONDITIONALLY (no per-kind gate, protective comment + `I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS`). Token-only; reuses `GlassCard variant="elevated"` (Android opaque-glass policy baked in), `Pill variant="live" livePulse`, `Icon`.
- **Why:** one owner per truth (SC-2/§4.4-B/C). **Lines:** 250.

### `src/store/liveSectionCollapseStore.ts` (NEW)
- **Now:** persisted Zustand store (`mingla-business.liveSectionCollapse.v1`), `collapsed` persisted (default false=open), `hasHydrated` NOT persisted (flipped in `onRehydrateStorage`), `toggle/setCollapsed/setHasHydrated/reset`. Modeled exactly on `currentBrandStore`. **Why:** SC-5/#14. **Lines:** 67.

### `src/utils/upcomingBuilder.ts` / `useUpcomingForBrand.ts`
- **Now:** `buildUpcomingItems` returns `liveItems` (live-first sorted subset; `primaryLiveItem = liveItems[0]`); the hook threads it. **Why:** one owner per truth (SC-2). **Lines:** +18/+7.

### `src/utils/clearAllStores.ts` / `reapOrphanStorageKeys.ts`
- **Now:** `liveSectionCollapseStore.reset()` in the logout cascade; new persist key registered in `KNOWN_MINGLA_KEYS` (I-PROPOSED-M gate). **Why:** SC-8/#6 + gate sync. **Lines:** +2 / +1.

---

## 8. Cross-surface impact

| Surface | Affected | Behavior | Parity |
|---------|----------|----------|--------|
| Consumer iOS | NO | — | n/a |
| Consumer Android | NO | — | n/a |
| Buyer/anonymous Web | NO | — | n/a |
| Business iOS | YES | accordion + carousel + per-kind scan → native camera scanner | shared RN → automatic |
| Business Android | YES | same; new card uses `GlassCard` opaque-fallback | automatic |
| Admin Web | NO | — | n/a |
| Business Web preview | YES (card UI; camera N/A) | accordion + carousel + scan button render; scan → `/event/{id}/scanner` `.web.tsx` EmptyState (ORCH-1099), not a dead tap | manual but already-built |

---

## 9. Gate results (run inside the worktree)

- **`tsc --noEmit`:** ZERO errors in any ORCH-1143 file (`home.tsx`, `LiveOfferingCard.tsx`, `liveSectionCollapseStore.ts`, `upcomingBuilder.ts`, `useUpcomingForBrand.ts`, `clearAllStores.ts`, `reapOrphanStorageKeys.ts`). Pre-existing repo-wide tsc errors in unrelated files (checkout buyer.tsx, marketing ComposerV2, payments native modules, several test modules) exist on origin/main untouched.
- **`eslint`** (my files): 0 errors, 0 new warnings (after removing the now-unused `GlassCard` import). Remaining warnings in `useUpcomingForBrand`/`reapOrphanStorageKeys` are pre-existing.
- **`jest`** (my touched areas + existing ORCH-0974 locks): **53/53 tests PASS** — `home.orch_1143` (10), `home.orch_0974` (6), `home.orch_0974.adversarial` (5), `liveSectionCollapseStore` (5), `upcomingBuilder` (27). The existing ORCH-0974 single-scroll-pane lock + adversarial branch digest still pass (live section sits outside the lock markers).
- **strict-grep gates:** `i-proposed-m-persist-key-whitelist` PASS (after registering the new key); `orch-1105-web-glass-opaque-fallback` PASS; `orch-0769-app-wide-currency` PASS; `i-proposed-1137-biz-web-lucide-real` PASS.
- **No barrel imports** introduced (per-symbol named imports only) — keeps the ORCH-1083 `__common` web budget honest.

**Unrun gate (CI/operator):** `web-build-check.yml` (full `expo export` + ORCH-1083 `__common` 2.25MB budget). Not runnable as a quick local gate; my change adds only small local-module named imports + no new library, so risk is minimal. Operator/CI runs it on the PR.

---

## 10. Known issues / deferred

- **SC-7 (no-duplication) DEFERRED — needs orchestrator/Seth attention.** The SPEC wanted live offerings to appear in the carousel ONLY, not also as Upcoming-list rows. The existing **append-only-locked** ORCH-0974 test `home.orch_0974.adversarial.test.tsx` A-05 pins the FlatList binding to the literal `data={upcoming.items}` (all items, including live). Filtering live items out of that list would change the binding and FAIL A-05, which CI `tests-append-only.yml` forbids without a `[TEST-MOD-APPROVED ORCH-NNNN]` commit (itself a new ORCH). SPEC §SC-7 explicitly anticipated this ("Confirm current Upcoming-list behavior in IMPLEMENT"). I kept A-05 green and did NOT de-duplicate. Net behavior: a live offering shows in BOTH the new live carousel (with the scan button) and as an existing Upcoming row (navigation only, no scan). If Seth wants strict de-dup, spawn a follow-up ORCH that carries the `[TEST-MOD-APPROVED]` to retarget A-05.
- **`accessible={false}` on the chevron Icon** was specified (§4.4-A) but `IconProps` doesn't expose `accessible`; the Icon renders an inert SVG (no `accessibilityRole`) and the expanded/collapsed state lives on the parent Pressable's `accessibilityState`, so VoiceOver/TalkBack announce only the header button — the intended a11y is preserved without the prop.

## 11. Operator action required

- NONE for backend (no migration, no edge-fn deploy).
- CLOSE / OTA: pure-JS business-app change → OTA the business `development`/`production` channel per the EAS gotchas memory (no native build needed). Orchestrator-owned.
- Orchestrator to flip `I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS` ACTIVE on CLOSE.

## 12. Discoveries for Orchestrator

- **DISC-1143-D (pre-existing, unrelated):** `liveEventStore-migrator-chain.adversarial.test.ts` + `liveEventStore-v4-v5-migrator.test.ts` FAIL on this branch AND are independent of ORCH-1143 — the tests expect `liveEventStore` persist `version: 5` but the source is `version: 6` (a prior ORCH bumped the store without updating these adversarial tests). I did not touch `liveEventStore.ts` (confirmed `git diff origin/main...HEAD`). Register as a stale-test cleanup.
- **SC-7 / A-05 lock conflict** (see §10) — needs a decision: accept live-in-both-places, or spawn a TEST-MOD-APPROVED follow-up.
- **DISC-1143-C (from investigation, confirmed):** no per-offering historical scanned count source exists; Scanned stays `—`. Future enhancement if a real count is wanted.

---

## Next handoff

Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`, commit `9bbf98980`. Route back to **mingla-orchestrator** for REVIEW, then **mingla-tester** (live-fire the per-kind scan happy path on device + re-verify the T10 fails-on-revert).
