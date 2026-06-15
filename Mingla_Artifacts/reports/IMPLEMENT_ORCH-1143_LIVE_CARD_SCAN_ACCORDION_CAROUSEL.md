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

- **SC-7 (no-duplication) — NOW IMPLEMENTED 2026-06-15 (commit `d0c7f0b50`).** The earlier deferral (A-05 append-only lock) was resolved with Seth's `[TEST-MOD-APPROVED ORCH-1143]` token. The Upcoming list (mobile FlatList + desktop pane) now renders `upcoming.nonLiveItems` (non-live only); live offerings are surfaced exclusively in the Live-now carousel. See §13 (SC-7) below for the full receipt.
- **`accessible={false}` on the chevron Icon** was specified (§4.4-A) but `IconProps` doesn't expose `accessible`; the Icon renders an inert SVG (no `accessibilityRole`) and the expanded/collapsed state lives on the parent Pressable's `accessibilityState`, so VoiceOver/TalkBack announce only the header button — the intended a11y is preserved without the prop.

## 11. Operator action required

- NONE for backend (no migration, no edge-fn deploy).
- CLOSE / OTA: pure-JS business-app change → OTA the business `development`/`production` channel per the EAS gotchas memory (no native build needed). Orchestrator-owned.
- Orchestrator to flip `I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS` ACTIVE on CLOSE.

## 12. Discoveries for Orchestrator

- **DISC-1143-D (pre-existing, unrelated):** `liveEventStore-migrator-chain.adversarial.test.ts` + `liveEventStore-v4-v5-migrator.test.ts` FAIL on this branch AND are independent of ORCH-1143 — the tests expect `liveEventStore` persist `version: 5` but the source is `version: 6` (a prior ORCH bumped the store without updating these adversarial tests). I did not touch `liveEventStore.ts` (confirmed `git diff origin/main...HEAD`). Register as a stale-test cleanup.
- **SC-7 / A-05 lock conflict — RESOLVED 2026-06-15.** Seth approved the TEST-MOD; A-05's data-source assertion was retargeted under `[TEST-MOD-APPROVED ORCH-1143]` and SC-7 is implemented (§13). No longer open.
- **DISC-1143-C (from investigation, confirmed):** no per-offering historical scanned count source exists; Scanned stays `—`. Future enhancement if a real count is wanted.

---

## Next handoff

Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`, commit `9bbf98980`. Route back to **mingla-orchestrator** for REVIEW, then **mingla-tester** (live-fire the per-kind scan happy path on device + re-verify the T10 fails-on-revert).

---

## 13. SC-7 — live/Upcoming de-duplication (DEFERRED criterion, completed 2026-06-15)

**Status: implemented and verified.** Commit `d0c7f0b50` (TEST-MOD token `[TEST-MOD-APPROVED ORCH-1143]`, Seth-approved 2026-06-15). Rebased on origin/main `0fd6f39c4`.

### 13.1 Problem
A currently-live offering appeared in BOTH the new "Live now" carousel (with its scan button) AND as a row in the "Upcoming" list below. SC-7 requires live offerings to live ONLY in the carousel; the Upcoming list shows non-live (upcoming/draft) items only.

### 13.2 Files changed (4 product/test files)
| File | Change | ~lines |
|------|--------|--------|
| `mingla-business/src/utils/upcomingBuilder.ts` | Added `nonLiveItems: UpcomingItem[]` to the `buildUpcomingItems` return type + computed it as `nonPast.filter((i) => i.status !== "live")`. Does NOT mutate `items` or `liveItems`. | +9 |
| `mingla-business/src/hooks/useUpcomingForBrand.ts` | Added `nonLiveItems` to the `UpcomingForBrand` interface; destructured it from the builder + returned it. No query-key/query change. | +6 |
| `mingla-business/app/(tabs)/home.tsx` | Mobile FlatList `data={upcoming.items}` → `data={upcoming.nonLiveItems}`; desktop Upcoming pane `upcoming.items.map` → `upcoming.nonLiveItems.map`; `hasUpcomingItems` gated on `upcoming.nonLiveItems.length > 0`. keyExtractor, renderItem (`<UpcomingListItem>`), and the three handlers unchanged. | ~3 edits |
| `mingla-business/app/(tabs)/__tests__/home.orch_0974.adversarial.test.tsx` | TEST-MOD: A-05 data-source assertion retargeted. | 1 line |

### 13.3 New non-live field name
**`nonLiveItems`** — owned by `upcomingBuilder.buildUpcomingItems`, threaded through `useUpcomingForBrand`. It is a strict projection of the SAME sorted `nonPast` set (live-state stays single-sourced as `liveItems`; one owner per truth, Constitution #2). `items` is never mutated — the carousel, `counts`, and KPI grid still consume the full set / live subset unchanged.

### 13.4 Old → New receipt — `home.tsx`
- **Before:** the Upcoming list (mobile FlatList + desktop pane) rendered `upcoming.items` (the full non-past set, INCLUDING live offerings). A live offering therefore rendered twice on Home — a live carousel card AND an Upcoming row.
- **Now:** the Upcoming list renders `upcoming.nonLiveItems` (upcoming + draft only). `hasUpcomingItems` is gated on `nonLiveItems.length > 0`, so when every active item is live the Upcoming section header + list hide cleanly (no empty list). KPI counts (`upcoming.counts`, `hasActiveEvents`, `showKpiGrid`) still count the full set including live.
- **Why:** SPEC §SC-7 — live offerings belong exclusively in the Live-now carousel.

### 13.5 TEST-MOD rationale (intent preserved)
A-05 (`home.orch_0974.adversarial.test.tsx`) is append-only-locked. The ONLY change is the FlatList data-source assertion:
- `data: flatList.includes("data={upcoming.items}")` → `data: flatList.includes("data={upcoming.nonLiveItems}")`
- The `data: true` expectation (~line 138) is an outcome boolean and is unchanged.
- Inline comment added: `// ORCH-1143 SC-7 [TEST-MOD-APPROVED by Seth 2026-06-15]: Upcoming list excludes live items (now in the Live-now carousel); single-scroll + all item-kind branches still asserted.`

PRESERVED unchanged (intent NOT weakened): `keyExtractor`, `renderItem` (`<UpcomingListItem>`), the three handlers (`onOpenDraft`/`onOpenTrip`/`onOpenLiveEvent`), and ALL UpcomingListItem branch-preservation checks — draft length 4, trip length 3, event length 5. The single-scroll intent (one FlatList in the locked mobile-populated pane) and the per-kind branch preservation remain fully protected. Only the data-source contract changed (`items` → `nonLiveItems`).

### 13.6 New regression test + fails-on-revert
- **Path:** `mingla-business/src/utils/__tests__/upcomingBuilder.test.ts` — describe block `"ORCH-1143 SC-7 nonLiveItems — live offerings excluded from the Upcoming list"` (3 tests, append-only, real `buildUpcomingItems` pipeline, `Date.now()` pinned to NOW):
  - **SC7-1:** a live event is in `liveItems` but NOT in `nonLiveItems`; a future-dated (upcoming) event + a draft ARE in `nonLiveItems`; `items.length === liveItems.length + nonLiveItems.length` (projection, no mutation).
  - **SC7-2 (all-live edge case):** all items live → `nonLiveItems` empty, `.map` over it is safe (no crash) — proves the clean Upcoming-hides behavior.
  - **SC7-3 (no-live edge case):** none live → `nonLiveItems` equals `items` in the same order (Upcoming unchanged).
- **Fails-on-revert verified at commit `d0c7f0b50`.** Method: TRUE line replacement of the fix — `const nonLiveItems = nonPast.filter((i) => i.status !== "live");` → `const nonLiveItems = nonPast;` (live leaks back into the Upcoming view). Re-ran the SC-7 block → **2 failed** (SC7-1: live id present in nonLiveItems; SC7-2: length 2 ≠ 0). Restored the filter → **3 passed**. Output captured during implementation.

### 13.7 Edge-case handling (confirmed)
- **ALL items live** → `nonLiveItems` is empty; `hasUpcomingItems` is false → the Upcoming header + FlatList/desktop-pane do not render (their existing `hasUpcomingItems ?` gate). No empty list, no crash (SC7-2). The live carousel still renders all live cards.
- **NONE live** → `nonLiveItems === items` (same order); Upcoming list is identical to prior behavior (SC7-3).

### 13.8 Gates (SC-7)
- `npx jest home.orch_0974 home.orch_1143 src/utils/__tests__/upcomingBuilder.test.ts` → **4 suites, 51 tests, all PASS** (incl. the modified A-05 and the 3 new SC-7 tests).
- `npx tsc --noEmit` → zero errors on the 5 touched files (pre-existing unrelated errors remain only in `../packages/phone-input/`).
- `npx eslint` on the 5 touched files → 0 errors; the 2 `react-hooks/exhaustive-deps` warnings on `useUpcomingForBrand.ts` are PRE-EXISTING on origin/main (confirmed via `git stash`), not introduced here.

### 13.9 Scope adherence
Stayed within `home.tsx` + `upcomingBuilder.ts` + `useUpcomingForBrand.ts` (the hook is the established thread for builder fields, already in the SPEC §4.2 allowlist) + the two test files. Did NOT touch the scanner, the carousel render, `LiveOfferingCard`, the collapse store, or any other ORCH-1143 work. No new config files. Currency-awareness + no-fabricated-data untouched.

---

## Live-now header styling fix (device feedback) — 2026-06-15

**Trigger:** Seth device-tested the dev OTA and reported the "Live now" header sat too close to the screen edges and didn't read as a tappable dropdown. The designer traced both to SPEC under-spec and wrote the exact fix in SPEC §4.4-A "REVISED 2026-06-15 (device-feedback fix)". This is HEADER CHROME ONLY — zero behavior change. Edited ONLY `mingla-business/app/(tabs)/home.tsx`.

### Style keys changed (per §4.4-A revised delta table)
| Key | Before | After |
|-----|--------|-------|
| `liveSection` | `{ marginBottom: spacing.md }` | `{ paddingHorizontal: spacing.md, marginBottom: spacing.md }` — the gutter fix (16pt Home gutter; wrapper View now owns it). |
| `liveHeaderRow` | `{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.sm, minHeight: 44 }` | `{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', minHeight: 44 }` — dropped all padding (GlassCard `padding={spacing.md}` owns the inset). |
| `liveHeaderChevron` | (NEW) | `{ width:28, height:28, borderRadius: radiusTokens.full, alignItems:'center', justifyContent:'center', backgroundColor: glass.tint.profileBase }` — 28pt circular dropdown handle. |
| `liveHeaderRowPressed`, `liveHeaderLeft`, `liveHeaderDot`, `liveHeaderTitle`, `liveHeaderCount` | (current) | unchanged. |

**JSX deltas:** (1) added `import { GlassCard } from "../../src/components/ui/GlassCard";` (alphabetical, after `EventCoverMedia`, before `Icon`). (2) wrapped the existing header `Pressable` in `<GlassCard variant="base" padding={spacing.md}>…</GlassCard>` inside the `liveSection` View; the card body (single card / carousel) stays a sibling BELOW the GlassCard, NOT enclosed. (3) replaced the bare `<Icon … size={20} …/>` with `<View style={styles.liveHeaderChevron}><Icon name={showLiveOpen ? "chevU" : "chevD"} size={18} color={textTokens.secondary} /></View>`. The `chevU`/`chevD` conditional Icon-name string was preserved verbatim (home.orch_1143 asserts it).

### Token verification — ALL RESOLVED (zero new tokens)
Every referenced token already exists and is imported in `home.tsx`. Two name substitutions vs. the spec's literal token names, because this file imports the design-system under aliases (verified at the import block, `home.tsx:58-65`):
- `radius.full` (spec) → **`radiusTokens.full`** (file alias; `radius as radiusTokens`). Value `999`, defined `designSystem.ts:46`. SUBSTITUTION.
- `text.secondary` (spec) → **`textTokens.secondary`** (file alias; `text as textTokens`). `rgba(255,255,255,0.72)`, `designSystem.ts:290`. SUBSTITUTION.
- `glass.tint.profileBase` → unchanged (`glass` imported directly); `rgba(255,255,255,0.04)`, `designSystem.ts:260`; already used at `home.tsx:1214`. RESOLVED.
- `spacing.md` (16) — RESOLVED. `GlassCard` export — RESOLVED (`variant`/`padding` props confirmed). Icon `chevD`/`chevU` — RESOLVED (`Icon.tsx:25-26,128-129`).

No invented tokens. Substitutions are alias-name only (same underlying values), forced by the file's existing import aliasing.

### Gate results — ALL GREEN
- `npx tsc --noEmit` → **zero errors in `app/(tabs)/home.tsx`** (the listed errors are all pre-existing in unrelated files: checkout buyers, marketing composer, payments modules, and `@testing-library/react-native` type-resolution in render-test files — none in home.tsx).
- `npx eslint app/(tabs)/home.tsx` → **exit 0**, clean.
- `npx jest home.orch_1143 home.orch_0974` (+ adversarial) → **21 passed** (3 suites).
- `npx jest --config jest.orch1143.render.cjs` (the dedicated RN render config for the two `.orch1143.render` proofs — they are `testPathIgnore`d from the default config) → **7 passed** (2 suites).
- Strict-grep gates: `orch-0974-home-mobile-lock-pane` PASS · `orch-0965-home-uses-upcoming-hook` PASS · `orch-1105-web-glass-opaque-fallback` PASS · `i-proposed-z-home-no-fabricated-events` PASS.

### Regression test
No new test required — pure visual token change with zero behavior/store/carousel-math/a11y change. No existing test asserts the old style keys (the only style-adjacent assertion, `home.orch_1143:63`, checks the `chevU`/`chevD` Icon-name string, which is preserved verbatim and still passes). Android opaque-glass is automatic via GlassCard's internal GlassChrome. Touch target stays ≥44pt (`liveHeaderRow.minHeight: 44`).

### Commit
`97c661ca137567ccb71d544b46225966c43d8e29`

---

## Continuous-section fix (device feedback v2) — 2026-06-15

Seth device-tested the prior (device-feedback v1) fix and reported the "Live now" header + content read as "two different sections as opposed to one continuous section with a divider." The designer revised §4.4-A (the "REVISED 2026-06-15 (continuous-section fix) — AUTHORITATIVE" block) to bind header + divider + body into ONE shared `base` GlassCard surface. This section records the v2 delta. Scope: visual/structure ONLY — zero behavior change (collapse store, carousel cardWidth math, scan button, per-kind routing, ≥44pt header target all untouched).

### Files changed (v2)
- `mingla-business/app/(tabs)/home.tsx` — `renderLiveSection` JSX restructure + 1 style edit + 3 new style keys + 1 style key augmented (~+55 lines net incl. comments).
- `mingla-business/src/components/home/LiveOfferingCard.tsx` — `flat?: boolean` prop + content/chrome split + `flatRoot` style (~+45 lines net incl. comments).
- `mingla-business/jest.orch1143.render.cjs` — appended the new flat render-test to `testMatch` (config, not a test; append-only).
- `mingla-business/src/components/home/__tests__/LiveOfferingCard.flat.orch1143.render.test.tsx` — NEW happy-path regression test (3 tests).

### home.tsx — exact keys/props changed (per §4.4-A AUTHORITATIVE delta tables)
- **JSX:** enclosing card flipped `<GlassCard variant="base" padding={spacing.md}>` → `<GlassCard variant="base" padding={0}>`. The body block (single-live `LiveOfferingCard` / carousel `ScrollView`) was MOVED from being a SIBLING of the GlassCard to INSIDE it, below the header `Pressable`, with the new `liveSectionDivider` between header and body. The single-live `<LiveOfferingCard>` now passes `flat`; the carousel cards do NOT (stay elevated). Stale "stays a SIBLING below this card, NOT inside it" comment replaced with the continuous-section note. The single-live card is wrapped in `<View style={styles.liveSectionBody}>`; the carousel in `<View style={styles.liveSectionCarouselBody}>`.
- **`liveHeaderRow`:** re-added `paddingHorizontal: spacing.md` + `paddingVertical: spacing.sm` (the GlassCard no longer pads). `minHeight: 44` preserved.
- **`liveSectionDivider` (NEW):** `{ height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileBase, marginHorizontal: spacing.md }`. Rendered ONLY when `showLiveOpen`.
- **`liveSectionBody` (NEW):** `{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }`.
- **`liveSectionCarouselBody` (NEW):** `{ paddingTop: spacing.sm, paddingBottom: spacing.md }` (no h-padding; ScrollView content owns it).
- **`liveCarouselContent`:** added `paddingLeft: spacing.md` (GlassCard `padding:0` no longer supplies the carousel's left inset).
- **UNCHANGED:** `liveSection`, `liveHeaderRowPressed`, `liveHeaderChevron`, `liveHeaderLeft`, `liveHeaderDot`, `liveHeaderTitle`, `liveHeaderCount`.

### LiveOfferingCard.tsx — the flat-prop addition (§4.4-A.6)
- Added `flat?: boolean` (default `false`) to `LiveOfferingCardProps` with a doc comment.
- Extracted the hero content tree into a `content` fragment. When `flat`, the card returns `<View style={styles.flatRoot} testID={testID}>{content}</View>` (chrome-less: no GlassCard, no border/shadow/radius, no air gap; `width` ignored). When unset/false, it returns the unchanged `<GlassCard variant="elevated" padding={spacing.lg} …>{content}</GlassCard>`. `testID` rides the wrapper in BOTH modes so render-test selectors still resolve.
- `flatRoot` style: `{ padding: 0 }` — the enclosing `liveSectionBody` (16/8/16) owns the single-live inset (no double-pad), per A.6 inset reconciliation.

### Token verification (zero new tokens)
All tokens resolve against `home.tsx`'s existing import (`{ accent, glass, radius as radiusTokens, spacing, text as textTokens, typography } from "../../src/constants/designSystem"`):
- `glass.border.profileBase` → **RESOLVED** = `rgba(255,255,255,0.08)` (`designSystem.ts:266`); same token `VARIANT_TOKENS.base.border` uses for the card perimeter (divider reads as internal seam). `glass` imported directly — no alias.
- `spacing.md` (16) / `spacing.sm` (8) → RESOLVED, imported directly.
- `StyleSheet.hairlineWidth` → RESOLVED (RN core; already used at `home.tsx` scanButton-era and now `liveSectionDivider`). `StyleSheet` imported at `home.tsx:30`.
- No new import added to either file. `flat` is the ONLY new component-API surface.

### Render-test selector update
**None required.** The two pre-existing render proofs (`LiveOfferingCard.orch1143.render`, `UpcomingDedup.orch1143.render`) mount `LiveOfferingCard` WITHOUT `flat` (default elevated path), with GlassCard stubbed — the chrome split and the added prop do not touch their selectors (`home-live-card-scan-button`, "Scan QR codes", "Scanned", a11y label). Both still pass unchanged (7/7). A NEW test file was ADDED (not modified) for the v2 behavior.

### Regression test (v2)
- **New:** `LiveOfferingCard.flat.orch1143.render.test.tsx` — 3 tests: (1) `flat` renders WITHOUT a GlassCard chrome marker (the continuous-section requirement) while the wrapper testID still resolves; (2) default/elevated mode DOES wrap in a GlassCard; (3) scan button fires in BOTH modes (behavior unchanged).
- **Fails-on-revert PROVEN by true line-deletion:** deleted the `if (flat) { return <View style={styles.flatRoot} …> }` branch in `LiveOfferingCard.tsx` → test "flat mode renders WITHOUT a GlassCard" FAILED (`expect(queryByTestId("glasscard-marker")).toBeNull()` — the card fell through to the elevated GlassCard, marker present). Restored the branch → re-ran, GREEN (10/10 across the render config). `fails-on-revert verified at 3fa9297d7` (pre-fix-restore baseline HEAD).
- **T10/SC-7 behavioral tests:** unchanged + still passing (behavior is unchanged by a visual restructure). `home.orch_1143` (SC-7 source assertions incl. `liveItems.length === 1 ? (`, `snapToInterval`, `width={liveCardWidth}`, chevron name, scan-button testID), `home.orch_0974` (+adversarial), `liveSectionCollapseStore` (+adversarial), `UpcomingDedup` render — ALL pass.

### Gate results (v2) — ALL GREEN (pre-existing-unrelated noted)
- `npx tsc --noEmit` → **zero errors in `app/(tabs)/home.tsx` and `LiveOfferingCard.tsx`** (confirmed by file-filtered grep). The remaining repo errors (`@testing-library/react-native` type-resolution in test files, `packages/phone-input` standalone deps) are PRE-EXISTING on the rebased origin/main baseline (35 such errors present with my change stashed) — not introduced here.
- `npx eslint app/(tabs)/home.tsx src/components/home/LiveOfferingCard.tsx` → **exit 0**, clean.
- `npx jest --config jest.orch1143.render.cjs` → **10 passed, 3 suites** (incl. the new flat test).
- `npx jest home.orch_1143 home.orch_0974 upcomingBuilder liveSectionCollapseStore` → **71 passed, 1 failed**. The single failure is `upcomingBuilder.adversarial.test.ts › ADV-09` in `pickHomeNextAction` (brand-switch isolation) — **NOT touched by this change** and **fails identically on the rebased origin/main baseline** (verified by stash). Pre-existing, unrelated.
- Strict-grep gates: `i-proposed-z-home-no-fabricated-events` PASS · `orch-1105-web-glass-opaque-fallback` PASS (Android opaque-glass inherited via the single base GlassCard — no manual Platform.select introduced) · `i-proposed-tr2-livestore-addliveevent-owner` PASS.

### Smoke / verification status
**implemented, partially verified** — runtime render evidence via jest+@testing-library/react-native (the flat-vs-elevated chrome split + scan-button fire are proven at runtime). The visual continuous-section appearance on a physical device/sim is NOT machine-verifiable here and is the tester's device step (the prior fix was the one Seth eyeballed; this v2 needs a fresh device look). No native compilation needed (pure-JS/RN style change) → ships via OTA per [[project_ota_deferred_until_new_build]], orchestrator/operator-owned.

### Commit (v2)
`318461e7ecc3887a3f18f2f22bb2c9fe9c354955` (branch `ORCH-1143-live-card-scan-accordion`). The code + tests + this report ship in this single commit; `fails-on-revert verified at 3fa9297d7`.
