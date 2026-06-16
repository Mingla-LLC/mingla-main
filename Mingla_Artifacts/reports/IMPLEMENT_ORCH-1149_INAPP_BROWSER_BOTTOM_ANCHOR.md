# IMPLEMENT — ORCH-1149 — in-app browser bottom-anchor

**Phase:** IMPLEMENT (mingla-implementor, consumer side)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1149-[inapp-browser-bottom-anchor]/` on branch `ORCH-1149-inapp-browser-bottom-anchor`
**Date:** 2026-06-15
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1149_INAPP_BROWSER_BOTTOM_ANCHOR.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1149_INAPP_BROWSER_BOTTOM_GAP.md`
**Status:** implemented and verified (source-static + gate + tsc + eslint; sim/device verification is the tester's runtime step)

---

## 1. Summary

The shared consumer in-app browser (`app-mobile/src/components/InAppBrowserModal.tsx`) was a centered floating card at a fixed 85% screen height that left a ~7.5% gap at the base, through which the consumer tab bar (Explore/Discover/Friends/Likes/Profile) bled through, and it faded in instead of sliding up. This change bottom-anchors the sheet flush to the screen bottom (covering the tab bar), makes it full-width with top-only corner rounding, opens it with a slide-up animation, and pads the WebView container by the bottom safe-area inset so content clears the iOS home indicator / Android nav bar. Zero chrome change: the dark title header, close button, back/forward buttons, lock-icon + URL bar, every WebView prop, URL normalization, and error handling are byte-identical. It is a single product-file layout/animation change that propagates automatically to all 5 mount sites (shared default export). A new CI gate + an implementor happy-path regression test lock the bottom-anchored shape against a future re-centering refactor.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied by |
|----|-----------|--------|--------------|
| SC-1-iOS / SC-1-Android | Sheet flush to bottom, tab bar covered | ✓ implemented | `overlay.justifyContent:'flex-end'` + `modalContainer { width:'100%', height:'92%' }` + `statusBarTranslucent` — commit `30f70a9` |
| SC-2-iOS / SC-2-Android | Slides up on open / down on close | ✓ implemented | `<Modal animationType="slide">` — commit `30f70a9` |
| SC-3-iOS | WebView content clears the iOS home indicator | ✓ implemented | `style={[styles.webviewContainer, { paddingBottom: insets.bottom }]}` via `useSafeAreaInsets()` — commit `30f70a9` |
| SC-3-Android | WebView content clears the Android nav bar | ✓ implemented | same inset — commit `30f70a9` |
| SC-4 | Header/close/back-forward/lock+URL byte-identical (no chrome change) | ✓ preserved | JSX + `header`/`navBar`/`navButton`/`navUrlContainer`/`navUrlText` styles untouched; `git diff` shows no chrome edits |
| SC-5 | Scrim tap still closes (overlayBackground) | ✓ preserved | `overlayBackground` style + `<TouchableOpacity onPress={onClose}>` untouched |
| SC-6 | All nav stays in WebView; error shows in-app, no external eject | ✓ preserved | `handleShouldStartLoad`/`handleError`/`onError`/`onHttpError`/WebView props untouched |
| SC-7 | URL stays normalized https:// (call-site owned) | ✓ preserved | `source={{ uri: url }}` verbatim; no normalization touched |
| SC-8 | All 5 mount sites still open + bottom-anchor | ✓ verified (compile) | shared default export + prop contract unchanged; tsc clean on all 5 call sites (§ below) |
| SC-9 | orch-1022 + sole-gorhom gates still pass | ✓ sole-gorhom PASS; orch-1022 see note | sole-gorhom PASS (real + self-test); orch-1022 has a **pre-existing** failure independent of this change (Discoveries) |

> `30f70a9` = the commit hash recorded in the chat handoff and Section 6 below (filled after commit).

---

## 3. Files changed

| File | Change | Δ |
|------|--------|---|
| `app-mobile/src/components/InAppBrowserModal.tsx` | modify — bottom-anchor layout + slide animation + bottom inset + protective comment; removed unused `Dimensions`/`SCREEN_HEIGHT` | +33 / −12 |
| `app-mobile/package.json` | add `test:orch-1149` npm script registering the new gate | +1 / −1 (trailing comma) |
| `app-mobile/scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs` | create — new strict-grep CI gate (7 checks + `--self-test`) | new (~180 lines) |
| `app-mobile/src/components/__tests__/orch-1149-inapp-browser-bottom-anchor.test.tsx` | create — implementor happy-path regression test (T-01..T-08) | new (~150 lines) |

No edits to the 5 call sites (`ExpandedCardModal.tsx`, `ProfilePage.tsx`, `CustomPaywallScreen.tsx`, `OnboardingFlow.tsx`), `normalizeWebsiteUrl.ts`, `BaseBottomSheet.tsx`, or the two existing gates — all DO-NOT-TOUCH, all untouched.

---

## 4. Data-model / edge-function changes

None. Component-layer (UI) change only. No DB, migration, RLS, edge function, service, or hook touched.

---

## 5. Old → New receipt

### `app-mobile/src/components/InAppBrowserModal.tsx`
**What it did before:** Rendered as a centered floating card — `overlay` used `justifyContent:'center' / alignItems:'center'`; `modalContainer` was `width:'95%', maxWidth:600, height/maxHeight: SCREEN_HEIGHT*0.85, borderRadius:20` (all four corners). The `<Modal>` opened with `animationType="fade"`. No safe-area handling. Result: ~7.5% gap at the base exposing the consumer tab bar, and a fade-in that didn't read as a Mingla sheet.
**What it does now:** `overlay` uses `justifyContent:'flex-end'` (bottom-anchored; `alignItems` dropped). `modalContainer` is `width:'100%', height:'92%'`, top-only rounded (`borderTopLeftRadius/borderTopRightRadius:20`, bottom corners 0), flush to the screen bottom — covers the tab bar. The `<Modal>` opens with `animationType="slide"` + `statusBarTranslucent={true}` (layers over the in-tree tab bar, ORCH-0908 pattern). `useSafeAreaInsets()` is read and `{ paddingBottom: insets.bottom }` is applied inline to the WebView container so web content clears the home indicator / nav bar. Unused `Dimensions` import + `SCREEN_HEIGHT` constant removed. A protective comment block cites ORCH-1149 / I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED explaining WHY it's bottom-anchored and WHY the inset exists.
**Why:** SPEC §4 (4.1–4.8), SC-1/SC-2/SC-3; investigation root cause (centered fixed-height card + fade).
**Lines changed:** ~33 insertions / ~12 deletions.

The dark header (`#1C1C1E`), close button, back/forward nav, lock+URL bar, the WebView element and ALL its props, `handleNavigationStateChange`, `handleShouldStartLoad`, `handleError`, `goBack`, `goForward`, `handleShow`, and the `{ visible, url, title, onClose }` prop contract are UNCHANGED.

---

## 6. Regression tests added

**Implementor happy-path test:** `app-mobile/src/components/__tests__/orch-1149-inapp-browser-bottom-anchor.test.tsx` (T-01..T-08; node-runnable source-static-analysis, the app-mobile convention — no jest in app-mobile).

- Passing run (restored fix):
  ```
  PASS T-01..T-08 ORCH-1149 in-app browser bottom-anchor: slide animation, statusBarTranslucent,
  bottom-anchored overlay, full-width flush sheet (no 0.85 card), top-only rounding,
  bottom safe-area inset on webview, prop contract preserved, no gorhom import
  ```

**New CI gate:** `app-mobile/scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs` (G-01..G-07 + `--self-test`), registered as `npm run test:orch-1149` in `app-mobile/package.json` — same runner (the `app-mobile/package.json` `test:orch-*` scripts block) as orch-1022 / orch-1054 / orch-1072 / orch-1125. (Note: app-mobile `scripts/ci/orch-*` gates are wired as npm scripts in `app-mobile/package.json`, NOT as individual jobs in the GitHub strict-grep workflow — that workflow runs only `.github/scripts/strict-grep/*` gates. This matches all existing app-mobile orch gates.)

- Gate passing run (restored fix): all 7 PASS, `ORCH-1149 in-app browser bottom-anchor regression passed.`
- Gate self-test: `ORCH-1149 self-test passed: gate correctly FAILS the reverted shape (5/7 checks failed as expected).`

**Fails-on-revert proof (TRUE line deletion — `git checkout origin/main -- InAppBrowserModal.tsx`, NOT a comment-out):**
- On the reverted origin/main shape (centered, `fade`, `SCREEN_HEIGHT*0.85`, no inset): the happy-path test FAILED (exit 1, `AssertionError: T-01 <Modal> must use animationType="slide"`) AND the CI gate FAILED (exit 1, 5/7 checks failed).
- After restoring the fix (`cp` back; verified byte-identical to the fix via `diff`): both PASS again (exit 0).
- **fails-on-revert verified at `30f70a9`** (the commit recorded below).

---

## 7. Cross-surface impact table

| # | Surface | Affected | What changes / why not | Parity |
|---|---------|----------|------------------------|--------|
| 1 | Consumer iOS | YES | In-app browser slides up, sits flush, covers tab bar; content clears home indicator | Shared component → automatic across all 5 mounts |
| 2 | Consumer Android | YES | Same; clears Android nav bar; `statusBarTranslucent` layers over the in-tree tab bar | Automatic |
| 3 | Buyer/anon Web | NO | Native-only component; not on web buyer routes | — |
| 4 | Business iOS | NO | Business app does not import `InAppBrowserModal` (F-8) | — |
| 5 | Business Android | NO | F-8 | — |
| 6 | Admin Web (adjacent) | NO | No usage | — |
| 7 | Business Web preview (adjacent) | NO | No usage | — |

Parity is automatic (single shared default export). No manual parity work required.

---

## 8. Smoke / verification result

- **Gate (orch-1149):** real PASS (7/7), self-test PASS (fails the reverted shape as designed).
- **Gate (orch-1022, sole-gorhom):** sole-gorhom PASS (real + self-test). orch-1022 has a **pre-existing** 2/8 failure unrelated to this change — see Discoveries.
- **Happy-path test:** PASS; fails-on-revert proven by true line deletion.
- **tsc (`npx tsc --noEmit`):** ZERO errors mention `InAppBrowserModal` or any of the 5 call sites. All ~410 remaining errors are pre-existing and confined to `../packages/phone-input/*` (missing react types) and Deno/react-dom test files (run by deno/jest, not tsc) — none in product source I touched.
- **eslint (`npx eslint src/components/InAppBrowserModal.tsx`):** exit 0, clean (no unused-import warning after removing `Dimensions`/`SCREEN_HEIGHT`).
- **Per-mount-site compile confirmation:** `ExpandedCardModal.tsx` (ticket browser L2273 + policies browser L2282), `ProfilePage.tsx` (L602), `CustomPaywallScreen.tsx` (L442), `OnboardingFlow.tsx` (L3298) — all typecheck clean (prop contract `{ visible, url, title, onClose }` unchanged; no call-site edits).

**UNVERIFIED (tester's runtime step):** on-device/sim visual confirmation that the tab bar is fully covered, the slide animation plays, and the home-indicator/nav-bar clearance holds on a device WITH a home indicator AND one without (inset=0 edge). This requires iOS sim + Android emulator and is the tester's adversarial angle (SPEC §9).

---

## 9. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- Sheet height set to `92%` per SPEC §10 OQ-1 default (tall sheet, thin top scrim). If Seth wants a shorter sheet, it remains acceptable so long as bottom-flush + tab-bar-covered — the gate/test only enforce "not centered / not 0.85-fixed / bottom-inset", not a specific height %.

---

## 10. Operator action required

- **No migration. No edge-function deploy.** Component-layer change only.
- **OTA (orchestrator/operator, after merge to main + tester PASS):** consumer channels per the EAS OTA gotchas (per-platform, `npx -y eas-cli@latest update`, runtime app 1.1.0). Not the implementor's step.

---

## 11. Discoveries for Orchestrator

- **Pre-existing failure: `orch-1022-expanded-card-modal-gating-check.mjs` fails 2/8 (G-01, G-03) on origin/main — NOT caused by ORCH-1149.** `ExpandedCardModal.tsx` is byte-identical to origin/main here (I never touched it; `git diff origin/main` is empty). The gate's G-01/G-03 regexes were written before ORCH-1072 inserted `selectedVenueExperience !== null` into the `anyChildModalOpen` chain (`ExpandedCardModal.tsx:1425-1441`); the strict regex expects the expression to terminate at `curatedLightbox.visible;` but the source now appends `|| selectedVenueExperience !== null;`. This is a stale-gate drift (gate not updated when ORCH-1072 extended the child-overlay aggregate), independent of and orthogonal to this layout change. The orch-1022 gate is DO-NOT-TOUCH for ORCH-1149, so I left it untouched. **Recommend a small follow-up ORCH** to update the orch-1022 G-01/G-03 regexes to include `selectedVenueExperience` (the architecture is still correct — the aggregate DOES cover the venue-experience surface; only the gate's pattern is stale). Note: SC-9's intent ("orch-1022 still PASS") is "do not regress it" — this change cannot affect the orch-1022 result because that gate reads only `ExpandedCardModal.tsx`, which is unchanged.

---

## 12. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No OPEN+BLOCK row targets `mingla-implementor`, `ORCH-1149`, or `ALL`. COMMS-0033 (WARN, ORCH-1133 ID-collision) is already ACKNOWLEDGED and concerns unrelated ORCHs — no action. No new cross-ORCH discovery requiring a COMMS write (the orch-1022 stale-gate is a same-repo follow-up, captured in Discoveries for the orchestrator, not a cross-in-flight-ORCH blocker).
