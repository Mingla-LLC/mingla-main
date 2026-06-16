# TEST — ORCH-1149 — in-app browser bottom-anchor (adversarial QA)

**Phase:** TEST (mingla-tester, adversarial)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1149-[inapp-browser-bottom-anchor]/` on branch `ORCH-1149-inapp-browser-bottom-anchor`
**Impl commit:** `a684169b1` (rebased from the dispatch's intermediate `30f70a9fe` — component content byte-identical between the two; reconciled below)
**Tester adversarial commit:** `8a4c74d9a`
**Date:** 2026-06-15
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1149_INAPP_BROWSER_BOTTOM_ANCHOR.md`
**Mode:** TARGETED (single-file deterministic StyleSheet/animation change)

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2.

The implementation matches the SPEC exactly: the shared consumer in-app browser is re-laid-out from a centered 85%-height floating card to a bottom-anchored, full-width, slide-up sheet with a top-only radius and a `useSafeAreaInsets().bottom` pad on the WebView container. Chrome is **byte-identical**. All 5 mount sites inherit the change via the shared default export. The new gate + both regression tests are green and fail-on-revert is proven for both. The orch-1022 gate fails 2/8 but is a **pre-existing stale-gate drift unrelated to and unaffected by ORCH-1149** (proven below) — it does NOT block this change's pre-merge gate.

**Why CONDITIONAL, not PASS:** this is a UI/runtime layout change, and per the tester confidence ladder a full PASS on a UI change requires `proven`-level live-fire visual confirmation. I could NOT drive the in-app browser to a visible state in this environment (the booted sim's app landed on a deep-link intercept screen and would not cleanly bind to the worktree Metro bundle; reaching the browser requires authenticated multi-screen navigation through the Discover deck). The runtime claims are therefore capped at **`suspected (source-conclusive)`**. Because the change is a deterministic, data-independent, branch-free StyleSheet swap whose visual outcome is fully determined by the verified style values, source-level layout reasoning carries the bulk of the verdict with high confidence — but the live-fire visual (tab-bar coverage, slide animation playing, home-indicator clearance) remains **un-run** and is the one open condition. **Seth's call** whether to accept the deferred live-fire or require a sim/device pass before merge.

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1-iOS / SC-1-Android | Sheet flush to bottom, tab bar covered | PASS (source-conclusive; live-fire NOT run) | `overlay.justifyContent:'flex-end'` (L174) + `modalContainer { width:'100%', height:'92%' }` (L186-187) + `statusBarTranslucent={true}` (L91). RN `<Modal transparent statusBarTranslucent>` mounts in its own OS overlay over the in-tree tab bar (ORCH-0908). Visual confirmation of coverage NOT performed — capped `suspected`. |
| SC-2-iOS / SC-2-Android | Slides up on open / down on close | PASS (source-conclusive) | `<Modal animationType="slide">` (L89); `fade` absent. Animation play NOT visually confirmed. |
| SC-3-iOS | WebView content clears the iOS home indicator | PASS (source-conclusive) | `style={[styles.webviewContainer, { paddingBottom: insets.bottom }]}` (L141) via `const insets = useSafeAreaInsets()` (L46). Inset value is dynamic + runtime-correct by construction; not visually measured. |
| SC-3-Android | WebView content clears the Android nav bar | PASS (source-conclusive) | same inset (L141). |
| SC-4 | Header/close/back-forward/lock+URL byte-identical | **PASS (verified)** | `git diff origin/main -- InAppBrowserModal.tsx` shows ZERO chrome edits — header `#1C1C1E` (L206), closeButton, navBar/navButton/navUrlContainer/navUrlText, lock-closed icon (L135), chevron-back/forward (L122/L132) all untouched. Only the webviewContainer inline `paddingBottom` + comments changed. |
| SC-5 | Scrim tap still closes (overlayBackground) | **PASS (verified)** | `overlayBackground` style (L177-183) + `<TouchableOpacity ... onPress={onClose}>` (L96-100) byte-identical to origin/main. |
| SC-6 | All nav stays in WebView; error in-app, no external eject | **PASS (verified)** | `handleShouldStartLoad` returns `true` (L62-64); `onError={handleError}` + `onHttpError={handleError}` (L155-156); `setSupportMultipleWindows={false}` + `javaScriptCanOpenWindowsAutomatically={false}` (L157-158) all untouched. |
| SC-7 | URL stays normalized https:// (call-site owned) | **PASS (verified)** | `source={{ uri: url }}` verbatim (L149); zero `normalize` refs inside the modal. Normalization owned by `ExpandedCardModal.tsx` + `ActionButtons.tsx` (I-WEBVIEW-URL-NORMALIZED preserved). |
| SC-8 | All 5 mount sites still open + bottom-anchor | **PASS (verified)** | Exactly 5 mounts app-wide: `ExpandedCardModal.tsx:2273` (ticket) + `:2282` (policies), `ProfilePage.tsx:602`, `CustomPaywallScreen.tsx:442`, `OnboardingFlow.tsx:3298`. All import the default export → all inherit the bottom-anchor. Each passes precisely `{visible,url,title,onClose}` (no extra props). tsc clean on all 5. Live-open of each NOT run. |
| SC-9 | orch-1022 + sole-gorhom gates still pass | **PARTIAL — sole-gorhom PASS; orch-1022 pre-existing 2/8 fail (NOT caused by 1149)** | sole-gorhom: `node .github/scripts/strict-grep/meta-orch-0991-...mjs` → OK (BaseBottomSheet sole importer, exit 0). orch-1022: 2/8 fail (G-01/G-03) — pre-existing on origin/main, reads only `ExpandedCardModal.tsx` which 1149 never touches (see §3 P3 + §11). |

---

## 3. Findings

### P3-1 — orch-1022 gate is stale (pre-existing; NOT caused by ORCH-1149) — recommend a small follow-up ORCH

- **Evidence:** `npm run test:orch-1022` → `FAIL G-01`, `FAIL G-03`, `2/8 failed` (exit 1). `git diff origin/main -- app-mobile/src/components/ExpandedCardModal.tsx` is **empty** (byte-identical) and `git diff origin/main -- .../orch-1022-...mjs` is **empty**. ORCH-1149's commit `a684169b1` touches NEITHER file. The gate reads only `ExpandedCardModal.tsx` + `expandedCard/ActionButtons.tsx` (gate L23-24) — neither changed by 1149 — so it is mathematically impossible for 1149 to have caused or affected this result. Root cause: ORCH-1072 inserted `|| selectedVenueExperience !== null` into the `anyChildModalOpen` chain (`ExpandedCardModal.tsx:1431` + the close-effect L1437) but the gate's G-01/G-03 regexes still expect the chain to terminate at `curatedLightbox.visible`. The architecture is correct (the aggregate DOES cover the venue-experience surface); only the gate's pattern is stale.
- **Impact:** If a CI pre-merge job runs `npm run test:orch-1022`, it will RED on this branch — but it is equally RED on origin/main today, so it is not a *regression* introduced by 1149 and must not be charged against this change. SPEC §11 pre-declared this as a known stale gate from ORCH-1072.
- **Required fix (NOT for this ORCH — orch-1022 is DO-NOT-TOUCH here):** a follow-up ORCH updates the orch-1022 G-01/G-03 regexes to include `selectedVenueExperience` in the expected `anyChildModalOpen` aggregate.
- **Retest:** after the follow-up, `npm run test:orch-1022` → 8/8 PASS.
- **Pre-merge-gate assessment:** does NOT block ORCH-1149. It is a pre-existing red unrelated to this diff; gate it on its own follow-up.

### P4-1 — clean, surgical, spec-faithful implementation (praise)

Single product file, exact spec match, protective comment block cites `I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED` with the WHY (tab-bar bleed / home-indicator occlusion), unused `Dimensions`/`SCREEN_HEIGHT` cleanly removed, the one dynamic inline style correctly scoped. Subtract-before-add honored.

### P4-2 — dispatch hash reconciliation (informational, no defect)

The dispatch cited "impl commit `a684169b1`, in-branch fix `30f70a9`". `30f70a9fe` exists in the object store (reflog) as the pre-rebase impl commit; it is NOT an ancestor of `a684169b1`, but `git diff 30f70a9 a684169b1 -- InAppBrowserModal.tsx` is **empty** (component byte-identical). The branch was rebased onto current origin/main, producing `a684169b1` with identical component content. No fix was lost; the code under test is exactly what was implemented. The IMPLEMENT report's "commit `30f70a9`" references are the pre-rebase hash.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the implementor's component shape and the origin/main shape myself; ran their happy-path test + the gate against each.

- **Reverted to origin/main** (`cp $(git show origin/main:.../InAppBrowserModal.tsx)` — TRUE line replacement, not comment-out):
  - Implementor happy-path test → **FAIL**, exact assertion: `AssertionError [ERR_ASSERTION]: T-01 <Modal> must use animationType="slide"` (exit 1).
  - orch-1149 gate → **FAIL 5/7** (G-01..G-05 fail; G-06/G-07 pass), exit 1.
- **Restored fix** (`git checkout -- InAppBrowserModal.tsx`; confirmed empty diff = byte-identical):
  - Implementor happy-path test → **PASS** (exit 0).
  - orch-1149 gate → **PASS 7/7** (exit 0); gate `--self-test` → PASS (correctly fails the reverted shape 5/7).
- **Verified at impl commit `a684169b1`.** The implementor's fails-on-revert claim is independently confirmed.

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `app-mobile/src/components/__tests__/orch-1149-inapp-browser-bottom-anchor-tester-adv.test.tsx`
- **Commit:** `8a4c74d9a` (on branch, in `git diff origin/main...HEAD --name-status` as `A`).
- **Different angle vs the implementor's test** (implementor asserts the NEW shape is PRESENT — slide/flex-end/100%/top-radius/inset). This test attacks what the happy-path test does NOT cover:
  - **Angle A — NO leftover centered-card markers:** asserts `width:'95%'`, `maxWidth:600`, `maxHeight: SCREEN_HEIGHT`, `Dimensions`, `SCREEN_HEIGHT` are GONE, and `alignItems:'center'` is absent **scoped to the `overlay` block specifically** (it legitimately survives in chrome styles — closeButton/navBar/navButton/navUrlContainer/loadingOverlay — which a coarse file-wide grep would get wrong; the implementor test never checks these markers at all).
  - **Angle B — chrome/WebView/error-path byte-PRESERVED:** asserts header `#1C1C1E`, lock+URL bar, back/forward chrome, `source={{ uri: url }}` verbatim, no in-modal `normalizeWebsiteUrl`, `setSupportMultipleWindows={false}` + `javaScriptCanOpenWindowsAutomatically={false}`, `onError`+`onHttpError`→`handleError`, and `handleShouldStartLoad` returns `true` (no external eject). The implementor test never verifies chrome preservation.
  - **Angle C — all 5 mount sites still import + mount the shared default export** (and ExpandedCardModal hosts exactly 2). The implementor test only reads InAppBrowserModal.tsx.
- **fails-on-revert verified at `a684169b1`:** on the origin/main centered shape the test FAILS with `AssertionError: A-1 the centered-card width:'95%' must be GONE` (exit 1); on the fix it PASSES (exit 0). Restore confirmed byte-identical.
- **Both tests appear in the closing diff** (`git diff origin/main...HEAD --name-status`): implementor `orch-1149-inapp-browser-bottom-anchor.test.tsx` (A) + tester `orch-1149-inapp-browser-bottom-anchor-tester-adv.test.tsx` (A) + the gate (A). Append-only respected (the implementor's test was not modified).
- **Lint:** tester test = 0 errors, 3 `no-require-imports` warnings — identical count/kind to the implementor's test (the app-mobile node-runnable test convention). No new error class.

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | scrim tap-to-close, close button, back/forward all untouched + wired. |
| 2 | One owner per truth | PASS | layout owned solely by `InAppBrowserModal` styles; URL normalization owned by call sites (unchanged). |
| 3 | No silent failures | PASS | error path unchanged (`handleError` clears loading; no swallow added). |
| 4 | One query key per entity | N/A | no data layer touched. |
| 5 | Server state server-side | N/A | no Zustand/React-Query touched. |
| 6 | Logout clears everything | N/A | no auth/persistence touched. |
| 7 | Label `[TRANSITIONAL]` | N/A | none introduced. |
| 8 | Subtract before adding | PASS | removed `Dimensions`/`SCREEN_HEIGHT`/`width:95%`/`maxWidth`/`maxHeight`/`borderRadius:20`/`alignItems` before adding the sheet shape. |
| 9 | No fabricated data | N/A | no data. |
| 10 | Currency-aware | N/A | no money. |
| 11 | One auth instance | N/A | no auth. |
| 12 | Validate at right time | N/A | no validation. |
| 13 | Exclusion consistency | N/A | no filtering. |
| 14 | Persisted-state startup | N/A | no persisted state. |

No constitutional violation.

---

## 7. Device / parity matrix

| Surface | Result | Notes |
|---------|--------|-------|
| Consumer iOS | **suspected (source-conclusive); live-fire NOT run** | iPhone 17 Pro sim booted + `com.mingla.app.v2` dev build installed + worktree Metro started, but the app landed on a deep-link "Open this event from the app" intercept with an uncaught-promise toast and would not cleanly bind to the worktree bundle (Metro stayed "Waiting on http://localhost:8081"). Reaching the in-app browser needs authenticated Discover-deck navigation to a curated card's "Policies & Reservations". Did NOT fabricate a visual. Evidence: `Mingla_Artifacts/evidence/ORCH-1149/ios_sim_deeplink_intercept_could_not_reach_browser.png`. |
| Consumer Android | **suspected (source-conclusive); live-fire NOT run** | Android device attached (`R58R54YV7JT`) but not driven (same reachability blocker; deterministic shared style change). |
| Buyer/anon Web | N/A (skip) | native-only component; not on web buyer routes (SPEC §3). |
| Business iOS | N/A (skip) | business app does not import `InAppBrowserModal` (SPEC F-8). |
| Business Android | N/A (skip) | F-8. |
| Admin Web | N/A (skip) | no usage. |
| Business Web preview | N/A (skip) | no usage. |
| Physical iPhone (HITL) | NOT requested in dispatch | no physical-device step required by the dispatch; available if Seth wants the live-fire visual. |

**Live deploy state:** N/A — no edge function / migration. Component-layer change; ships via OTA after merge (orchestrator/operator, per EAS OTA gotchas / COMMS-0027).

---

## 8. Source-verified vs live-fire (explicit)

**Source-verified (high confidence — deterministic style change):** the exact style values, the `<Modal>` props, the inset application, byte-identical chrome/WebView/error-path vs origin/main, the 5 mount sites + their props, URL-normalization ownership, the gate + both tests green, both fails-on-revert proofs, sole-gorhom green, orch-1022 pre-existing-and-unaffected.

**NOT live-fire (capped `suspected`):** the on-screen visual that (a) the sheet slides up, (b) the tab bar is fully covered with no nav-menu bleed at the base, (c) content clears the home indicator on an inset>0 device AND behaves correctly on an inset=0 edge. These are the SPEC §9(b)/(c) angles and remain un-run in this environment.

---

## 9. Discoveries for Orchestrator

- **DISC-1149-1:** orch-1022 gate is stale (2/8) on origin/main due to ORCH-1072's `selectedVenueExperience` extension of `anyChildModalOpen` — recommend a small follow-up ORCH to update the G-01/G-03 regexes (architecture is correct; gate pattern lags). NOT caused by 1149; do NOT block 1149 on it.
- **DISC-1149-2:** the consumer dev build on the booted iPhone 17 Pro sim opened to a deep-link intercept + uncaught-promise toast and would not bind to a freshly-started worktree Metro — an environment/dev-build state issue worth noting for future runtime QA (possibly stale-bundle / dev-launcher state, cf. COMMS-0027 dev-OTA cache poisoning).

---

## 10. Accepted conditions (CONDITIONAL PASS)

One open condition, requiring Seth's decision:
- **AC-1:** Live-fire visual confirmation (slide-up + tab-bar coverage + home-indicator clearance on inset>0 and inset=0) was NOT performed; runtime claims capped at `suspected (source-conclusive)`. **Accept the deferred live-fire** (merge on the strength of the deterministic source proof) **OR require a sim/device pass first.** No follow-up ORCH-ID assigned yet — Seth's call.

---

## 11. orch-1022 pre-merge-gate assessment (explicit, per dispatch)

`npm run test:orch-1022` is RED (2/8) on this branch AND identically RED on origin/main. ORCH-1149 touches neither `ExpandedCardModal.tsx` nor the gate, and the gate does not read `InAppBrowserModal.tsx` for its failing checks — so 1149 cannot have caused it and it is **not a regression attributable to this change**. It is a stale gate from ORCH-1072, pre-declared in SPEC §11. **It does NOT block ORCH-1149's pre-merge gate** and should be resolved on its own follow-up ORCH, not charged here. The ORCH-1149-relevant gates — `test:orch-1149` (7/7), the sole-gorhom gate (OK), both regression tests, tsc, eslint — are all green.
