# SPEC — ORCH-1149 — in-app browser bottom-anchor (cover the consumer tab bar, slide up)

**Phase:** SPEC (forensics, IA mode — follows `INVESTIGATE_ORCH-1149_INAPP_BROWSER_BOTTOM_GAP.md`)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1149-[inapp-browser-bottom-anchor]/` on branch `ORCH-1149-inapp-browser-bottom-anchor`
**Date:** 2026-06-15
**Investigation confidence:** `proven`
**Approach (decided in investigation F-6):** **In-place raw-RN-`<Modal>` refactor** — keep the existing `<Modal transparent>`, switch `animationType` to `"slide"`, bottom-anchor a full-bleed container, add bottom safe-area inset. **Do NOT** route through `BaseBottomSheet` and **do NOT** import `@gorhom/bottom-sheet`.

---

## 1. Executive summary

The shared consumer in-app browser (`app-mobile/src/components/InAppBrowserModal.tsx`) renders as a centered floating card at a fixed 85% screen height, so it leaves a ~7.5% gap at the bottom through which the consumer tab bar (Explore/Discover/Friends/Likes/Profile) shows. It also fades in instead of sliding up, so it doesn't feel like a Mingla sheet. This SPEC bottom-anchors the sheet flush to the bottom (covering the tab bar) and switches the open animation to slide-up — with **zero** change to the dark title header, the back/forward + lock/URL nav bar, any WebView prop/behavior, the URL-normalization flow, or error handling. It is a surgical, single-file layout/animation fix that propagates to all 5 mount sites automatically (shared default export).

---

## 2. Scope & non-goals

**In scope (the only changes permitted):**
- `InAppBrowserModal.tsx` `<Modal>` prop: `animationType="fade"` → `animationType="slide"`; add `statusBarTranslucent` (confirm/keep `transparent`).
- `InAppBrowserModal.tsx` `styles.overlay`: remove vertical centering so the container can sit flush at the bottom.
- `InAppBrowserModal.tsx` `styles.modalContainer`: remove the fixed `height: SCREEN_HEIGHT * 0.85` / `maxHeight`, the `width:'95%'`/`maxWidth`, and the all-corner `borderRadius: 20`; make it a full-width, bottom-anchored sheet with **top-only** corner radius and a height that covers the tab bar at the base.
- `InAppBrowserModal.tsx`: add `useSafeAreaInsets` and apply `insets.bottom` padding at the new bottom edge (WebView container).

**Non-goals (explicitly NOT in scope):**
- No chrome redesign. The dark header (`#1C1C1E`), the close button, the back/forward buttons, the lock icon + URL text bar stay byte-identical in look and behavior.
- No removal of the URL bar.
- No change to any WebView prop or callback.
- No `@gorhom/bottom-sheet` import; no routing through `BaseBottomSheet`.
- No edits to the 5 call sites beyond confirming they still compile (props contract unchanged).
- No business-app work (different browser path — investigation F-8).
- No new error-state UI, no i18n additions (investigation D-1 — deferred).
- No top safe-area inset change (investigation D-2 — not needed at current sheet height).

**Assumptions:** `react-native-safe-area-context` is available app-wide (`SafeAreaProvider` mounted at root; 46 src files already use `useSafeAreaInsets`). The RN `<Modal>` continues to mount in its own OS overlay window that renders over the in-tree tab bar (ORCH-0908 pattern).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched | Parity |
|---|---------|---------|-------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | **YES** | In-app browser slides up from the bottom, sits flush, covers the tab bar; content clears the home indicator (bottom inset). | `app-mobile/src/components/InAppBrowserModal.tsx` | Shared component → automatic across all 5 mounts. |
| 2 | Consumer Android (`app-mobile` Android) | **YES** | Same; clears the Android nav bar (bottom inset); `statusBarTranslucent` keeps it layered over the in-tree tab bar. | same | Automatic. |
| 3 | Buyer/anon Web | NO | Unchanged | none | Native-only component; not on web buyer routes. |
| 4 | Business iOS | NO | Unchanged | none | Business app does not import `InAppBrowserModal` (F-8). |
| 5 | Business Android | NO | Unchanged | none | F-8. |
| 6 | Admin Web (adjacent) | NO | Unchanged | none | No usage. |
| 7 | Business Web preview (adjacent) | NO | Unchanged | none | No usage. |

---

## 4. Layered specification

Only the **Component** layer is touched. No DB / edge / service / hook / realtime changes.

### Component — `app-mobile/src/components/InAppBrowserModal.tsx`

**4.1 Imports**
- Add: `import { useSafeAreaInsets } from 'react-native-safe-area-context';`
- `Dimensions` / `SCREEN_HEIGHT` (L9, L15) become unnecessary for the container height once it's flex/anchored. The implementor MAY remove the `Dimensions` import and the `SCREEN_HEIGHT` constant if no longer referenced (lint will flag an unused import). Keep them only if still used.

**4.2 Component body**
- Add at top of the component: `const insets = useSafeAreaInsets();`

**4.3 `<Modal>` props (currently L71-77)**
- `animationType="fade"` → `animationType="slide"`.
- Keep `transparent={true}`, `visible`, `onRequestClose={onClose}`, `onShow={handleShow}`.
- Add `statusBarTranslucent={true}` (so the slide-up overlay layers over the in-tree tab bar consistently on Android — matches the ORCH-0908 pattern).

**4.4 `styles.overlay` (currently L154-159)**
- Change `justifyContent: 'center'` → `justifyContent: 'flex-end'` (anchor children to the bottom).
- Remove `alignItems: 'center'` (the sheet is full-width now).
- Keep `flex: 1` and `backgroundColor: 'rgba(0,0,0,0.5)'` (the dim scrim above the sheet is retained — it covers the upper portion of the screen and the `overlayBackground` tap-to-close still works).

**4.5 `styles.overlayBackground` (currently L160-166)** — UNCHANGED (absolute-fill tap-to-close behind the sheet).

**4.6 `styles.modalContainer` (currently L167-180)** — bottom-anchored full-bleed sheet:
- REMOVE: `width: '95%'`, `maxWidth: 600`, `height: SCREEN_HEIGHT * 0.85`, `maxHeight: SCREEN_HEIGHT * 0.85`.
- ADD/SET: `width: '100%'`.
- Height: the sheet must cover the tab bar at the base. Use a tall sheet that reaches near the top but leaves the upper scrim visible (so it reads as a sheet, not a full-screen takeover). Recommended: `height: '92%'` (or `flex` within an `overlay` that has top padding). The container's bottom is flush to the screen bottom because `overlay` is `flex-end`. The exact top gap is a design value — `92%` keeps a thin scrim strip at the top consistent with other tall Mingla sheets; the implementor MUST NOT reintroduce a centered or `0.85` fixed-with-bottom-margin layout.
- Border radius: `borderRadius: 20` → **top-only**: `borderTopLeftRadius: 20`, `borderTopRightRadius: 20`, `borderBottomLeftRadius: 0`, `borderBottomRightRadius: 0` (flush bottom = no bottom rounding).
- Keep `backgroundColor: '#ffffff'`, `overflow: 'hidden'`.
- Shadow/elevation: keep the top shadow (`shadowOffset: { width: 0, height: 10 }` casts upward-ish); acceptable to retain as-is. (Optional: `shadowOffset` height to a small negative for an upward shadow — purely optional, not required.)

**4.7 Header `styles.header` (currently L181-190)** — UNCHANGED. It already has `borderTopLeftRadius: 20` / `borderTopRightRadius: 20`, which now correctly matches the sheet's top corners.

**4.8 Bottom safe-area inset (the critical un-centering regression guard, F-7)**
- Apply `paddingBottom: insets.bottom` to the **WebView container** (`styles.webviewContainer`, currently L243-246) so the WebView content does not sit under the iOS home indicator / Android nav bar.
- Implementation note for the implementor: `insets.bottom` is dynamic, so apply it inline as an array style on the `webviewContainer` `<View>` (L124): `style={[styles.webviewContainer, { paddingBottom: insets.bottom }]}`. This is the ONE allowed inline style (a dynamic runtime value); do not move static styles inline.

**4.9 Everything else** — UNCHANGED: `navBar`, `navButton`, `navUrlContainer`, `navUrlText`, `loadingOverlay`, `webview`, the WebView element and ALL its props (L130-145), `handleNavigationStateChange`, `handleShouldStartLoad`, `handleError`, `goBack`, `goForward`, `handleShow`, and the `{ visible, url, title, onClose }` prop contract.

---

## 5. Success criteria (numbered, per-surface where parity is manual; here parity is automatic so iOS+Android share each criterion unless split)

- **SC-1-iOS / SC-1-Android:** Opening the in-app browser (via curated card "Policies & Reservations") shows the sheet **flush to the bottom of the screen** with **no visible tab bar** below it (Explore/Discover/Friends/Likes/Profile fully covered).
- **SC-2-iOS / SC-2-Android:** The sheet **slides up from the bottom** on open (not a fade), and slides down on close.
- **SC-3-iOS:** The WebView content's bottom edge clears the iOS home indicator (no content under the indicator) — `insets.bottom` padding applied.
- **SC-3-Android:** The WebView content's bottom edge clears the Android nav bar — `insets.bottom` padding applied.
- **SC-4:** The dark title header (`#1C1C1E`), the close (×) button, the back/forward buttons, and the lock-icon + URL text bar are **visually and behaviorally identical** to before (no chrome change).
- **SC-5:** Tapping the dimmed scrim above the sheet still closes the browser (`overlayBackground` tap-to-close preserved).
- **SC-6:** All in-page navigation stays inside the WebView; an error shows the existing (blank/loading-cleared) state and never ejects to an external browser (`onShouldStartLoadWithRequest`/`onError`/`onHttpError` unchanged).
- **SC-7:** The URL passed to the WebView is still the normalized `https://` URL (I-WEBVIEW-URL-NORMALIZED) — unchanged because normalization is call-site owned.
- **SC-8 (all 5 mount sites):** ExpandedCardModal ticket browser, ExpandedCardModal policies browser, ProfilePage, CustomPaywallScreen, OnboardingFlow each still open the browser and each now bottom-anchors + slides up (verify each compiles and opens).
- **SC-9 (CI):** `orch-1022-expanded-card-modal-gating-check.mjs` and `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` both still PASS (component name/export/contract preserved; no gorhom import added).

---

## 6. Invariants

**Preserved:**
- **I-WEBVIEW-URL-NORMALIZED (ORCH-0649):** modal renders `source={{ uri: url }}` verbatim; normalization is at the call sites. Verified by SC-7 + the orch-0649 / call-site tests (unchanged).
- **Sole-gorhom-consumer (`meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`):** no `@gorhom/bottom-sheet` import added to `InAppBrowserModal`. Verified by SC-9 (that gate).
- **orch-1022 gate (G-01…G-06):** component name, default export, `{ visible, url, title, onClose }` prop contract, and the parent-owned mount architecture all unchanged; `<InAppBrowserModal` stays ABSENT from `curatedBody`. Verified by SC-9 (that gate).
- **ORCH-0908 z-stacking (`<Modal transparent statusBarTranslucent>`):** kept `transparent`, added `statusBarTranslucent` — the sheet continues to render over the in-tree tab bar. Verified by SC-1.
- **Keep-all-nav-inside-WebView:** `onShouldStartLoadWithRequest` returns true; errors → error state. Unchanged. Verified by SC-6.

**New (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip):**
- **`I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED`** — `app-mobile/src/components/InAppBrowserModal.tsx` MUST render as a bottom-anchored, full-width sheet that covers the in-tree tab bar, opened with `animationType="slide"`. The `overlay` style MUST NOT use `justifyContent:'center'`; the `modalContainer` MUST NOT use a fixed `SCREEN_HEIGHT * 0.85` height nor all-four-corner `borderRadius`; the WebView container MUST pad `useSafeAreaInsets().bottom`. *Why:* a future "simplifying" refactor could re-center the dialog and silently reopen the tab-bar bleed-through and the home-indicator occlusion.
  - **Enforcement gate (to add):** `app-mobile/scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs` — see §9.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy, iOS) | Open browser from curated "Policies & Reservations" | Tap button | Sheet bottom-anchored, slides up, tab bar covered | Component / sim |
| T2 (happy, Android) | Same | Tap button | Same; Android nav-bar cleared by inset | Component / emulator |
| T3 (regression-structural) | Grep the component styles | source | `overlay` has no `justifyContent:'center'`; `modalContainer` has no `SCREEN_HEIGHT * 0.85`; no all-corner `borderRadius: 20` on the container; `animationType="slide"` present; `useSafeAreaInsets` imported & `paddingBottom` applied to webview container | CI gate (orch-1149) |
| T4 (error path) | WebView hard error | Bad URL load | Loading clears, no external-browser eject, sheet stays bottom-anchored | Component / sim |
| T5 (edge — small device) | Open on a device with no home indicator (older) | Open | Bottom inset = 0, sheet still flush, no gap | Component / sim |
| T6 (gate non-regression) | Run orch-1022 + sole-gorhom gates | CI | Both PASS | CI |
| T7 (all mounts) | Open browser from Profile, Paywall, Onboarding, ticket CTA | Each | Each bottom-anchors + slides up | Component / sim |
| T8 (invariant) | Confirm URL normalization | http:// stop website | WebView loads https:// (normalized at call site) | Source + sim |

---

## 8. Implementation order

1. `InAppBrowserModal.tsx`: add `useSafeAreaInsets` import + `const insets = useSafeAreaInsets();`.
2. `<Modal>`: `animationType` → `"slide"`; add `statusBarTranslucent`.
3. `styles.overlay`: `justifyContent: 'flex-end'`, drop `alignItems:'center'`.
4. `styles.modalContainer`: full-width, drop fixed height/maxHeight/width/maxWidth, top-only radius, set sheet height (~92%).
5. WebView container `<View>` (L124): `style={[styles.webviewContainer, { paddingBottom: insets.bottom }]}`.
6. Remove now-unused `Dimensions`/`SCREEN_HEIGHT` if lint flags them.
7. Add CI gate `orch-1149-inapp-browser-bottom-anchored.mjs` (§9) and register it in the strict-grep CI workflow.
8. Run gates (orch-1022, sole-gorhom, orch-1149) + typecheck + the consumer test suite.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** a new strict-grep gate `app-mobile/scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs` that reads `InAppBrowserModal.tsx` and asserts ALL of:
1. `animationType="slide"` is present AND `animationType="fade"` is ABSENT.
2. The `overlay` style block does NOT contain `justifyContent: 'center'`.
3. The `modalContainer` style block does NOT contain `SCREEN_HEIGHT * 0.85` (or any `height: SCREEN_HEIGHT *`).
4. `useSafeAreaInsets` is imported AND `paddingBottom` is applied to the webview container (e.g. asserts both `useSafeAreaInsets` and `insets.bottom` appear).
5. The component still exports default `InAppBrowserModal` and the `{ visible, url, title, onClose }` prop names are present (so the fix can't accidentally break the contract the other gates depend on).

**Fails-on-revert proof requirement (for the tester):** reverting the fix (restoring `justifyContent:'center'`, `height: SCREEN_HEIGHT*0.85`, `animationType="fade"`, dropping the inset) MUST make this gate FAIL; restoring the fix MUST make it PASS. The implementor includes a protective comment block in `InAppBrowserModal.tsx` citing ORCH-1149 and `I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED` explaining WHY the sheet is bottom-anchored (tab-bar bleed-through) and WHY the bottom inset exists (home-indicator occlusion).

**Tester's adversarial angle (for mingla-tester):** (a) assert no `0.85` fixed height / centered `justify` remains anywhere in the file; (b) snapshot/visually verify the bottom-anchored layout on BOTH iOS sim and Android emulator with the tab bar covered; (c) verify the home-indicator/nav-bar clearance on a device WITH a home indicator AND one without (inset=0 edge); (d) prove all 5 mount sites still open and bottom-anchor; (e) confirm the orch-1022 + sole-gorhom gates still pass (no architectural regression); (f) confirm the URL bar, header, and back/forward chrome are byte-identical; (g) confirm error path still shows in-app (no external eject).

---

## 10. Open questions

- **OQ-1 (design value):** sheet height — SPEC recommends `~92%` (tall sheet, thin top scrim) consistent with other tall Mingla sheets. If Seth wants a SHORTER sheet that still covers the tab bar (e.g. `~80%` but bottom-flush), that is acceptable so long as it is bottom-anchored and covers the nav — the only hard constraint is "flush bottom, tab bar covered." Implementor should default to `92%` unless Seth directs otherwise. (Not a blocker.)
- No other open questions — the fix is fully specified.

---

## 11. Downstream routing

**Next = mingla-implementor (consumer side).** Build per §4/§8 in the worktree `~/Desktop/mingla-orchs/ORCH-1149-[inapp-browser-bottom-anchor]/` on branch `ORCH-1149-inapp-browser-bottom-anchor`. Inputs: this SPEC + `INVESTIGATE_ORCH-1149_INAPP_BROWSER_BOTTOM_GAP.md`. Hard constraints: single-file change to `InAppBrowserModal.tsx` + the one new CI gate; allowlist below; no gorhom import; no chrome change; preserve the prop contract. Output: implementation report under `Mingla_Artifacts/reports/`. Then → **mingla-tester** (adversarial, both platforms, §9 angle) → **orchestrator CLOSE** (flip `I-PROPOSED-1149-…` ACTIVE, register the gate, World Map, OTA the consumer channels per the EAS OTA gotchas / COMMS-0027).

---

## Scoped allowlist + DO-NOT-TOUCH

**ALLOWLIST (implementor may modify/create ONLY these):**
- `app-mobile/src/components/InAppBrowserModal.tsx` (modify — layout/animation/inset only).
- `app-mobile/scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs` (create — new gate).
- The strict-grep CI workflow file that registers app-mobile gates (add the new gate to the run list).
- `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1149_*.md` (implementor's report).

**DO-NOT-TOUCH:**
- The 5 call sites — `ExpandedCardModal.tsx`, `ProfilePage.tsx`, `CustomPaywallScreen.tsx`, `OnboardingFlow.tsx` (confirm-compiles only; no edits).
- `normalizeWebsiteUrl.ts`, `ActionButtons.tsx`.
- `BaseBottomSheet.tsx` and anything `@gorhom/bottom-sheet`.
- `orch-1022-expanded-card-modal-gating-check.mjs`, `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` (must keep passing — do not edit to "make it pass").
- The WebView element and ALL its props; the header and nav/URL bar JSX and styles.
- Anything in `mingla-business/` (out of scope).

The implementor must stop-and-amend (request a SPEC amendment) before touching anything outside the allowlist.
