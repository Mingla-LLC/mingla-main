# TEST — ORCH-1143 [business Home live-card: scan parity + accordion + multi-live carousel]

**Skill:** mingla-tester+claude · **Phase:** TEST (production gatekeeper) · **Date:** 2026-06-15
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`
**Branch HEAD at verdict:** `34102f6dc` · **Implementation commit:** `a7f1ebe5a` (report cites stale pre-rebase `9bbf98980`)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1143_LIVE_CARD_SCAN_ACCORDION_CAROUSEL.md`
**App:** Mingla BUSINESS (`mingla-business/`). UI-only — no backend / migration / edge-fn / scanner-route change.

---

## 1. Verdict

### CONDITIONAL PASS — P0: 0 · P1: 0 · P2: 2 · P3: 1 · P4: 2

Zero P0, zero unaccepted P1. The three asks are met and proven: (1) the scan button renders + FIRES for every live kind (event/experience/trip) via a real RN render mount — runtime evidence, above the source-grep ceiling; (2) the accordion is persisted + hydration-gated with the no-flash invariant proven across the full truth table; (3) the carousel/single boundary is correct and the live enumeration surfaces ALL live kinds. The CONDITIONAL tier (not PASS) is driven by **two documented deferrals/conditions** that need Seth's affirmative acceptance, NOT by any defect:

- **C-1 (P2, accepted-deferral candidate):** SC-7 no-duplication is NOT implemented — a live offering appears in BOTH the new live carousel AND the Upcoming list. This is blocked by the append-only ORCH-0974 A-05 lock and was explicitly anticipated by SPEC §SC-7. Needs a follow-up `[TEST-MOD-APPROVED ORCH-NNNN]` to fix. Pre-existing list behavior, not a regression.
- **C-2 (CONDITION, not a defect):** physical-device live-fire of an ACTUAL QR scan of a real experience/trip ticket is a STOP point owned by Seth (requires a seeded paid ticket + an authorized scanner). The scanner backend + screen + route kind-agnosticism is proven at the source/schema layer (forensics F-1..F-9) and the home-side scan button + routing is proven at the render layer; the end-to-end QR decode on a physical device remains the one human-in-the-loop step.

If Seth accepts C-1's deferral and treats C-2 as the standard post-merge device smoke, this is a clean ship. Without that affirmative, it stays CONDITIONAL (per the tester contract, do not auto-route to CLOSE).

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | Scan button on every live kind → `/event/{id}/scanner` | **PASS** | Render proof `LiveOfferingCard.orch1143.render.test.tsx` `test.each([event,experience,trip])` — button renders + `fireEvent.press` calls `onScanPress(id)` for all 3 kinds. `handleScanPress` (`home.tsx:411-416`) pushes `/event/${id}/scanner` with NO kind gate. |
| SC-1-iOS / Android | native scanner mounts, kind-aware | **PASS (source-proven) / device-CONDITION** | Scanner screen `app/event/[id]/scanner/index.tsx` byte-unchanged; no `event_type` refusal (line 372+ `kind===` are scan-RESULT kinds, not type gates); `useManagedEventRoute` resolves event+experience+trip (forensics F-6). Actual camera scan = physical-device step (C-2). |
| SC-1-Web | routes to web EmptyState, not a dead tap | **PASS (source-proven)** | `index.web.tsx` uses `offeringKindConfig` + `router` (kind-aware EmptyState + back), byte-unchanged. Button always enabled (`LiveOfferingCard` — no web disable). |
| SC-2 | ≥2 live → ALL render, live-first start-asc | **PASS** | `upcomingBuilder.liveItems = nonPast.filter(status==="live")` after the live-first comparator sort; executable tests T2/T3/T4/T12 (`upcomingBuilder.test.ts`) prove event+experience+trip all enumerated in order. `home.tsx` maps `liveItems` (one owner). |
| SC-3 | carousel ≥2; single full-width for 1 | **PASS (boundary proven)** | `home.tsx:540` `liveItems.length === 1 ? <card/> : <ScrollView horizontal snapToInterval…>`; single card has no `width` prop (full-width), carousel cards get `width={liveCardWidth}`. Source-contract T-SC3 + render proof of the card both green. |
| SC-4 | accordion toggle (easeInEaseOut + chevron swap + expanded) | **PASS** | `LayoutAnimation.Presets.easeInEaseOut` + `chevU/chevD` glyph swap + `accessibilityState={{expanded:!liveCollapsed}}` + Android `setLayoutAnimationEnabledExperimental(true)` guard at module top (`home.tsx:105-111`). |
| SC-5 | persisted collapse + hydration gate (no flash) | **PASS (runtime-proven)** | `liveSectionCollapseStore` — `hasHydrated` NOT persisted, flipped in `onRehydrateStorage`. **Tester adversarial** `liveSectionCollapseStore.orch1143.adversarial.test.ts` executes the gate truth table: pre-hydration ALWAYS open even with `collapsed=true` persisted (the flash defect); only `(hydrated,collapsed)` hides. |
| SC-6 | honest data (Scanned `—`) + currency-aware | **PASS (runtime-proven)** | Render proof asserts the `—` Scanned cell at mount + kind-neutral copy. Revenue uses `view.currency ?? brand.defaultCurrency ?? "GBP"` — the SAME pre-existing fallback already on origin/main (`home.tsx:319`), generalized over the array; NO new GBP introduced (ORCH-1034 deferred, untouched). |
| SC-7 | live NOT duplicated in Upcoming list | **FAIL → DEFERRED (C-1, P2)** | Mobile FlatList renders `data={upcoming.items}` (incl. live); the append-only A-05 lock (`home.orch_0974.adversarial.test.tsx:102-106`) pins that literal string. De-dup requires `[TEST-MOD-APPROVED]`. SPEC §SC-7 anticipated this. Live appears in carousel (with scan) AND list (nav-only). |
| SC-8 | logout cascade resets the store | **PASS** | `clearAllStores` calls `useLiveSectionCollapseStore.getState().reset()`. Store test T11 + adversarial ADV-1143-04 (reset returns `collapsed=false`, LEAVES `hasHydrated` true). |
| SC-9 | live TRIP renders a scannable card | **PASS (runtime-proven)** | Render proof's `trip` case: card renders via `tripToLiveEvent` + scan button fires with the trip id. Builder T2/T3 include the trip in `liveItems`. Fixes DISC-1143-B (trips were previously excluded from the hero entirely). |

---

## 3. Findings (P-ranked)

### C-1 / P2 — SC-7 no-duplication NOT implemented (live offering shows in carousel AND Upcoming list)
- **Evidence:** `home.tsx:889` mobile `<FlatList data={upcoming.items} …>` (and `:693` desktop `upcoming.items.map`) render the full set including live items; `home.orch_0974.adversarial.test.tsx:102-106` A-05 asserts `flatList.includes("data={upcoming.items}")`. Filtering live out changes that binding → A-05 fails → `tests-append-only.yml` forbids the test-mod without a `[TEST-MOD-APPROVED ORCH-NNNN]` token.
- **Impact:** A live offering renders twice on Home — once as a live carousel card (with the scan button) and once as a navigation-only Upcoming row. Mild visual redundancy; not a functional break (the scan affordance is unique to the carousel card).
- **Required fix:** spawn a follow-up ORCH carrying `[TEST-MOD-APPROVED]` to retarget A-05 so the Upcoming list filters `status !== "live"`. OR Seth accepts live-in-both-places.
- **Retest:** after the follow-up, assert the FlatList data excludes live items and A-05 is updated under the approved token.
- **Status:** DEFERRED by the implementor with operator flag; SPEC-anticipated. Pre-existing list behavior — NOT a regression introduced by ORCH-1143.

### C-2 / CONDITION — physical-device QR live-fire (owned by Seth)
- **Evidence:** No mingla-business dev build is installed on the booted iOS sim (`simctl listapps` shows only Apple system apps); a full sim build + a seeded paid experience/trip ticket + an authorized scanner are needed for a real camera decode.
- **Impact:** the end-to-end "scan a real experience/trip ticket on a physical device" path is the one step not machine-verifiable here.
- **Required action:** Seth (or a post-merge device smoke) scans one experience ticket and one trip ticket on a physical device against prod and confirms a `success` result + the duplicate-on-rescan path.
- **Mitigation already in place:** the backend (`scan-ticket`/`biz_ticket_scan`), the ticket mint (`biz_ticket_checkout_finalize`), the scanner screen + `useManagedEventRoute` are all event-type-agnostic and byte-unchanged (forensics F-1..F-9); the home-side button + routing is render-proven. Risk is low.

### P3 — render-proof test file emits a base-tsconfig `TS2307` for `@testing-library/react-native`
- **Evidence:** `npx tsc --noEmit` → `LiveOfferingCard.orch1143.render.test.tsx(20): Cannot find module '@testing-library/react-native'`.
- **Impact:** none at runtime / CI. RTL lives only in the gitignored `.orch1118-testdeps` overlay. The EXISTING ORCH-1118/1122 render tests on origin/main emit the IDENTICAL error (verified) — this is the accepted render-proof pattern, and no CI workflow runs `tsc --noEmit`.
- **Required fix:** none (matches precedent). Optional: exclude `*.render.test.tsx` from the base tsconfig program if the noise is ever undesirable.
- **Retest:** n/a.

### P4 — IMPLEMENT report cites a stale commit hash
- The report's `9bbf98980` / "fails-on-revert verified at 9bbf98980" no longer exists post-rebase; the real implementation commit is `a7f1ebe5a`. Independently re-verified at the real HEAD (see §4). Cosmetic; flag for the orchestrator's close record.

### P4 — clean patterns worth crediting
- Store mirrors `currentBrandStore` hydration gate exactly; `liveItems` added as a single owner on the builder (no ad-hoc re-derive in `home.tsx`); scan affordance is structurally unconditional (no kind gate) with a protective comment + invariant id; live section correctly placed ABOVE the ORCH-0974 locked single-scroll pane so the horizontal carousel never violates the one-scroll lock; per-icon named imports preserved (no barrel) for the ORCH-1083 budget.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

The implementor claimed T10 fails-on-revert at `9bbf98980` (stale). Re-verified at the REAL HEAD `ceea8ed0e`/`a7f1ebe5a` by TRUE LINE DELETION:

- Deleted the scan-button `<Pressable>` block from `LiveOfferingCard.tsx` (466-byte block, not a comment-out).
- Ran `npx jest home.orch_1143` → **T10 FAILED** (`Tests: 1 failed, 9 passed`); the failing assertion is `expect(CARD).toContain('testID="home-live-card-scan-button"')`.
- Restored the block → working tree byte-identical to the commit (`git diff --quiet` clean) → **all 10 pass**.
- Conclusion: the implementor's T10 fails-on-revert holds at the real HEAD. **Caveat:** T10 is a SOURCE-GREP (string presence), so its "fails-on-revert" only proves the string was deleted — it does not prove behavior. The tester render-proof (§5) supplies the behavioral fails-on-revert.

---

## 5. Adversarial tests added (tester-owned, different angle)

Two tester files, both in the closing diff (`git diff origin/main...HEAD --name-only`), both append-only-new:

### 5a. `mingla-business/src/store/__tests__/liveSectionCollapseStore.orch1143.adversarial.test.ts` (committed `e9a567970`)
- **Angle:** the implementor only source-greps the literal `showLiveOpen` string and checks `reset` returns `collapsed=false`. This test EXECUTES the real store and evaluates the no-flash gate across the full `(hasHydrated, collapsed)` truth table, and asserts `reset()` LEAVES `hasHydrated` true (logout must not re-arm the cold-start gate).
- **fails-on-revert verified at `e9a567970`:** injecting the bug `reset: () => set({ collapsed:false, hasHydrated:false })` → **ADV-1143-04 FAILS** (`1 failed, 4 passed`); restore → byte-identical, **5 pass**. This catches a real Constitution #14 defect invisible to the implementor's suite.

### 5b. `mingla-business/src/components/home/__tests__/LiveOfferingCard.orch1143.render.test.tsx` (committed `34102f6dc`)
- **Angle:** RUNTIME render mount (RTL via the `.orch1118-testdeps` overlay + worktree-local `jest.orch1143.render.cjs`) — proves the scan button RENDERS + FIRES `onScanPress(id)` for event, experience, AND trip; honest-empty `—` at render; kind-neutral a11y label. Lifts SC-1/SC-9 above the source-grep "suspected" ceiling.
- **fails-on-revert (behavioral):** re-gating the card's scan button to `{item.kind === "event" ? … : null}` → the **experience + trip + a11y cases FAIL** (`3 failed, 2 passed`), event passes; restore → byte-identical, **5 pass**. Stronger than T10: catches ANY mechanism that suppresses the button for non-events, not just one string.
- Added to the default `jest.config.cjs` `testPathIgnorePatterns` (RTL is overlay-only) — mirrors the ORCH-1118/1122 render-proof precedent; the default node/ts-jest run does NOT pick it up.

Both implementor happy-path test (`home.orch_1143.test.tsx`) and tester adversarial tests appear in the closing diff. Regression gate satisfied.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | scan button fires `onScanPress(id)` (render-proven) for all kinds; web routes to a real EmptyState (byte-unchanged ORCH-1099 screen). |
| 2 | One owner per truth | PASS | live-state owned by `upcomingBuilder.liveItems`; `home.tsx` maps it, does not re-derive. |
| 3 | No silent failures | PASS | no new catch/swallow; metrics fall back to `EMPTY_LIVE_CARD_METRICS` (honest `—`), not a fake. |
| 4 | One query key per entity | N/A | no new query/key — `useUpcomingForBrand` threads `liveItems` off the existing query. |
| 5 | Server state stays server-side | PASS | `liveSectionCollapseStore` is a client UI flag only (collapsed boolean). |
| 6 | Logout clears everything | PASS | `reset` wired into `clearAllStores`; adversarial ADV-1143-04 proves reset semantics. |
| 7 | Label `[TRANSITIONAL]` | N/A | no transitional code. |
| 8 | Subtract before adding | PASS | inline hero block REMOVED from `home.tsx`, lifted into `LiveOfferingCard`; dead hero styles deleted; stale ORCH-0965 comment deleted. |
| 9 | No fabricated data | PASS | Scanned cell is `—` (render-proven); revenue currency-aware, no new hardcoded symbol. |
| 10 | Currency-aware | PASS | `view.currency ?? brand.defaultCurrency` (pre-existing `?? "GBP"` fallback untouched — ORCH-1034 deferred). |
| 11 | One auth instance | N/A | no auth touched (business operator surface). |
| 12 | Validate at the right time | N/A | no datetime validation added. |
| 13 | Exclusion consistency | PASS | `liveItems` derived from the same `nonPast` set as the rest of the builder. |
| 14 | Persisted-state startup gate | PASS | `hasHydrated` gate; `showLiveOpen = !hasHydrated || !collapsed`; runtime no-flash proven across the truth table (adversarial). |

---

## 7. Device / parity matrix

| Surface | Verdict | Notes |
|---------|---------|-------|
| Consumer iOS | N/A | no business Home/scanner. |
| Consumer Android | N/A | — |
| Buyer/anonymous Web | N/A | buyer surface. |
| Business iOS | PASS (render+source) / device-CONDITION | card render-proven; accordion + carousel source-proven; real QR camera scan = C-2 (physical device, Seth). No biz dev build on the booted iOS 17 Pro sim → full sim live-fire not run; component render mount substitutes for the card-layer proof. |
| Business Android | PASS (shared RN) | shared `home.tsx`/card → automatic; `GlassCard` Android opaque-fallback intact (ORCH-1105 strict-grep gate PASS); no new translucent Android fill introduced (diff-verified). |
| Admin Web | N/A | — |
| Business Web preview (adjacent) | PASS (source) | accordion + carousel + scan button render on web; scan routes to the kind-aware web EmptyState (byte-unchanged), NOT a dead tap. |

**Physical iPhone HITL:** NOT performed (no real ticket/scanner seeded). Captured as C-2 condition, not skipped/faked.

---

## 8. Gate results (run in-worktree, HEAD `34102f6dc`)

- **tsc --noEmit:** ZERO errors in any ORCH-1143 PRODUCT file. One `TS2307 @testing-library/react-native` in the tester render-proof test — matches the existing ORCH-1118/1122 render-test pattern on origin/main (overlay-only RTL); not in any CI gate. Pre-existing repo-wide tsc errors in unrelated files unchanged.
- **eslint (ORCH-1143 product files):** 0 errors. 4 warnings, ALL pre-existing on origin/main (`useUpcomingForBrand` serverEvents/trips exhaustive-deps; `reapOrphanStorageKeys` unused-disable) — not introduced here.
- **jest (default config, ORCH-1143 surface):** `home.orch_1143` (10) + `liveSectionCollapseStore` (5) + `liveSectionCollapseStore.orch1143.adversarial` (5) + `upcomingBuilder.test` (27) = **47/47 PASS**.
- **jest (render config `jest.orch1143.render.cjs`):** **5/5 PASS** (real RN mount).
- **append-only check (`test-append-only-check.js`):** **5 passed, 0 failed** — 4 new test files ADDED, `upcomingBuilder.test.ts` MODIFIED additions-only (0 deletions).
- **strict-grep gates:** `i-proposed-m-persist-key-whitelist` PASS (new key registered), `orch-1105-web-glass-opaque-fallback` PASS, `i-proposed-1137-biz-web-lucide-real` PASS.
- **NOT run (CI/operator):** `web-build-check.yml` full `expo export` + ORCH-1083 `__common` 2.25MB budget — needs the full export; change adds only local named imports + no new library, low risk; CI runs it on the PR.

---

## 9. DISC-1143-D CI-blocker assessment (EXPLICIT)

**DISC-1143-D is PRE-EXISTING on origin/main and does NOT block the ORCH-1143 PR.**

- **Tests:** `liveEventStore-migrator-chain.adversarial.test.ts` + `liveEventStore-v4-v5-migrator.test.ts` (2 failures) assert the store persist `version: 5`, but `liveEventStore.ts` is `version: 6`.
- **Pre-existing proof:** `liveEventStore.ts` is `version: 6` on BOTH origin/main AND this branch (identical, line 421). ORCH-1143 touches neither `liveEventStore.ts` nor the migrator test files (`git diff origin/main...HEAD --name-only` confirms).
- **Bonus pre-existing failure found:** `upcomingBuilder.adversarial.test.ts` ADV-09 (`pickHomeNextAction` brand-switch ladder) also FAILS. PROVEN pre-existing by reverting `upcomingBuilder.ts` to origin/main and re-running — ADV-09 still fails (it tests `homeNextAction.ts`, untouched by ORCH-1143).
- **CI-blocker verdict:** The ONLY jest invocation in ALL CI workflows is `production-readiness-audit.yml:63` → `npx jest src/config/__tests__/featureFlags.test.ts --runInBand`. There is NO CI workflow that runs the full business-app jest suite. Therefore neither DISC-1143-D nor the ADV-09 failure runs in any required CI gate, and **neither blocks the ORCH-1143 PR merge.** They are local-suite hygiene items for a future stale-test cleanup ORCH.

---

## 10. Discoveries for Orchestrator

- **DISC-1143-D (confirmed pre-existing):** 2 `liveEventStore` migrator tests assert `version:5` vs source `version:6`. Stale-test cleanup ORCH. Not in CI; not blocking.
- **DISC-1143-E (new, tester-found):** `upcomingBuilder.adversarial.test.ts` ADV-09 fails on origin/main (`pickHomeNextAction` brand-switch ladder rung 1 vs 2). Independent of ORCH-1143. Same stale-test cleanup. Not in CI; not blocking.
- **SC-7 / A-05 lock conflict (C-1):** needs a decision — accept live-in-both-places, or spawn a `[TEST-MOD-APPROVED]` follow-up to filter live out of the Upcoming list.
- **DISC-1143-C (from investigation):** no per-offering historical scanned count source; Scanned stays `—`. Future-enhancement candidate.
- **IMPLEMENT report stale hash:** cites `9bbf98980`; real commit `a7f1ebe5a`. Fix in the close record.

---

## 11. Accepted conditions (CONDITIONAL PASS)

This verdict is CONDITIONAL pending Seth's affirmative on:
1. **C-1 (P2):** accept SC-7 deferral (live shows in carousel + Upcoming list) OR authorize a `[TEST-MOD-APPROVED]` follow-up ORCH.
2. **C-2 (CONDITION):** accept that the physical-device QR live-fire of a real experience/trip ticket is a post-merge device smoke owned by Seth (everything machine-verifiable is proven).

With both accepted → routes to CLOSE. Without → STOP and surface to Seth (do not auto-CLOSE).
