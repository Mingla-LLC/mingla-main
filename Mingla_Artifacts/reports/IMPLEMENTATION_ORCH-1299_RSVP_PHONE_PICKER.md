# IMPLEMENTATION — ORCH-1299 [rsvp-phone-picker-nested-modal]

Worktree: `~/Desktop/mingla-orchs/ORCH-1299-[rsvp-phone-picker-nested-modal]/` on branch `ORCH-1299-rsvp-phone-picker-nested-modal`
Status: **implemented, NOT runtime-verified for the fix** (no local web build in this session) · **root cause CORRECTED vs the dispatch** (runtime-proven) · NOTIFY-LIST triggered.

---

## 0. ROOT-CAUSE CORRECTION (read first — NOTIFY-LIST trigger)

The dispatch's HIGH-confidence source diagnosis (a nested `<Modal>` freezing on react-native-web) is **NOT the cause of the reported dead-tap.** I reproduced the bug on LIVE web and drilled to the true cause with runtime proof.

**The real cause:** `handleOpenPicker` in `packages/phone-input/PhoneInput.tsx` sets `pickerVisible` **only inside `InteractionManager.runAfterInteractions(...)`**. On the RSVP public page a long-running Animated interaction handle (a looping animation) is held indefinitely, so `runAfterInteractions` **never fires its callback** → `setPickerVisible(true)` never runs → **the picker (CountryPickerModal OR CountryPickerOverlay) never mounts.** The tap is received; nothing opens.

**Why the nested-modal theory is wrong:** the SAME phone field rendered in the **inline §5 contact box — which is NOT inside any modal** — is frozen identically. A standalone RN `<Modal>` renders fine on web (the buyer checkout proves it), so if `setPickerVisible` flipped, the inline picker would open. It doesn't. The blocker is upstream of the modal-vs-overlay choice.

### Runtime evidence (live: `https://business.usemingla.com/e/smokerhythm/july-4th-bbq-pool-party`, headless Chromium/Playwright, mobile viewport)
| Probe | Result | Meaning |
|---|---|---|
| Tap inline flag → observe 5s | node count flat (232), no "Select Country", no search input | inline picker never mounts (a 240-country FlatList would add hundreds of nodes) |
| DOM click listener on tap | 1 click fired | the tap reaches the DOM (not an overlay/hit-target problem) |
| Console/page errors on tap | none | `handleOpenPicker` does not throw |
| Open details modal (tap "Going") | modal mounts (nodes 232→280) | React `setState` works on this page (the modal is a plain setState) |
| Tap details-modal flag → observe 3s | node count flat (280) | modal-instance picker also never mounts |
| `InteractionManager` located in live Metro bundle (module id 233) | found | direct probe possible |
| `setTimeout` fires | true | JS event loop alive |
| `requestAnimationFrame` fires | true | render loop alive |
| `InteractionManager.runAfterInteractions(cb)` within 6s | **false** | **the callback NEVER fires on this page** |
| Same, after create+clear my own handle | **false** | OTHER interaction handles are held (a running animation) → the set never empties |

Evidence artifacts: `Mingla_Artifacts/evidence/ORCH-1299/` (`00`–`08` screenshots: landing, inline frozen tap, details modal open, modal-flag frozen tap).

**Consequence for the dispatched fix:** swapping `CountryPickerModal` → `CountryPickerOverlay` (the dispatch's plan) does not fix the dead-tap on its own, because the overlay is gated behind the same `setPickerVisible(true)` that never runs.

---

## 1. Summary (what changed, plain English)

Two fixes, both web-only, native untouched:

- **FIX 1 (PRIMARY, runtime-proven):** the country picker now opens **immediately on web** instead of waiting on `InteractionManager.runAfterInteractions`. This is the change that actually un-freezes the tap. Native still uses the deferred open (it exists for Android keyboard-dismiss timing).
- **FIX 2 (SECONDARY, source-justified, kept):** the RSVP phone field (which lives inside `RsvpDetailsModal`) now renders the in-place **`CountryPickerOverlay`** on web via a new `pickerPresentation="overlay"` prop, instead of a nested `<Modal>`. The package docstring + the app-mobile `AddFriendView` comment both state a nested `<Modal>` freezes on web, so once FIX 1 lets the picker open, the modal-instance needs the overlay. **Its necessity could not be runtime-verified** (the picker never opened pre-FIX-1 to observe the nested-modal behavior); it is retained as a well-supported precaution. The standalone buyer-checkout fields are unchanged (default `'modal'`).

---

## 2. SPEC success-criteria coverage

The dispatch's /goal: "the RSVP guest phone country-picker OPENS and CHANGES country on web, with runtime evidence; checkout unchanged; a fails-on-revert regression test; committed + pushed."

| Criterion | State | Note |
|---|---|---|
| SC-1 picker OPENS on web | **implemented, unverified-at-runtime** | FIX 1 removes the runAfterInteractions gate on web (proven to be the blocker). Not verified end-to-end (no local web build). Needs tester live-fire. |
| SC-2 selecting a country CHANGES flag/dial/composed number | **implemented, unverified-at-runtime** | existing `onChangeCountry` → `composeE164` wiring in PublicEventPage; unchanged. Needs live-fire once picker opens. |
| SC-3 checkout phone path unchanged | ✓ verified (static) | 3 `buyer.tsx` hosts keep default `'modal'`; gate check D fails if overlay leaks in. |
| SC-4 fails-on-revert regression test | ✓ verified | strict-grep gate (self-test 11/11) + fails-on-revert by line deletion of BOTH fixes (see §6). |
| SC-5 committed + pushed | ✓ | branch `ORCH-1299-rsvp-phone-picker-nested-modal`. |
| SC-6 no new dependency | ✓ | none added. |

---

## 3. Files changed

| File | Δ | What |
|---|---|---|
| `packages/phone-input/PhoneInput.tsx` | ~+50 | FIX 1 (web-immediate open in `handleOpenPicker`); FIX 2 (`pickerPresentation` prop + overlay/modal branch via `resolvePickerPresentation`). |
| `packages/phone-input/pickerPresentation.ts` | NEW | pure `resolvePickerPresentation(presentation, platformOS)` + `PhoneInputPickerPresentation` type. |
| `packages/phone-input/CountryPickerModal.tsx` | ~+21 | `CountryPickerOverlay` pins `position:'fixed'` on web (via the `ParallaxCoverShell`-sanctioned `WebViewStyle` cast) so it covers the details modal, not PhoneInput's 56px box. |
| `packages/phone-input/index.ts` | +2 | export `resolvePickerPresentation` + `PhoneInputPickerPresentation`. |
| `mingla-business/src/components/event/PublicEventPage.tsx` | +4 | RSVP `<PhoneInput>` passes `pickerPresentation="overlay"` (comment). |
| `.github/scripts/strict-grep/orch-1299-rsvp-phone-picker-overlay.mjs` | NEW | CI regression gate (checks A,B,C,D,E,F; self-test 11/11). |
| `.github/workflows/strict-grep-mingla-business.yml` | +14 | registers the gate job + registry header comment. |
| `mingla-business/src/components/event/__tests__/orch1299_picker_presentation.test.ts` | NEW | ts-jest unit test for `resolvePickerPresentation` (4 cases). |

No migration. No edge function. No DB/RLS change. No new dependency.

---

## 4. Old → New receipts

### packages/phone-input/PhoneInput.tsx
- **Before:** `handleOpenPicker` = `if (disabled) return; Keyboard.dismiss(); InteractionManager.runAfterInteractions(() => setPickerVisible(true));` on ALL platforms. The picker branch hardcoded `<CountryPickerModal visible={pickerVisible} .../>`.
- **Now:** on web, `handleOpenPicker` calls `setPickerVisible(true)` immediately (returns before `runAfterInteractions`); native unchanged. New optional prop `pickerPresentation?: 'modal' | 'overlay'` (default `'modal'`); `usePickerOverlay = resolvePickerPresentation(pickerPresentation, Platform.OS) === 'overlay'`; the picker branch renders `<CountryPickerOverlay>` when overlay-resolved, else `<CountryPickerModal>` (default, unchanged).
- **Why:** FIX 1 = SC-1 (the runtime-proven un-freeze). FIX 2 = the modal-instance nested-`<Modal>` precaution.

### packages/phone-input/pickerPresentation.ts (NEW)
- Pure helper (no RN imports) so it is node-testable. Returns `'overlay'` ONLY for `presentation === 'overlay' && platformOS === 'web'`; `'modal'` otherwise. Native + the default are never diverted.

### packages/phone-input/CountryPickerModal.tsx
- **Before:** `CountryPickerOverlay` container = `StyleSheet.absoluteFillObject` (position `absolute`) → on web fills only the parent (PhoneInput's ~56px box).
- **Now:** on web the container uses `position:'fixed'` (covers the details modal / viewport); native keeps `absolute`. Typed via `WebViewStyle = ViewStyle & { position?: ViewStyle['position'] | 'fixed' }` + `as StyleProp<ViewStyle>` — the same sanctioned escape hatch shipped in `packages/offering-rendering/ParallaxCoverShell.tsx`.
- **Why:** the overlay is a real consumer for the first time; it must cover the modal, not the field.

### mingla-business/src/components/event/PublicEventPage.tsx
- **Before:** RSVP `<PhoneInput>` used the default picker (nested `<Modal>`).
- **Now:** passes `pickerPresentation="overlay"`. The shared `contactForm` node is re-hosted in both the inline §5 box and `RsvpDetailsModal`, so one prop covers both; on web both use the overlay (harmless in the inline context), native both keep the modal.

---

## 5. Cross-surface impact

| Surface | Affected? | Detail |
|---|---|---|
| Buyer/anonymous Web (business) | YES | FIX 1 un-freezes the picker for the RSVP field (and hardens the checkout field, same `handleOpenPicker`). FIX 2 renders the overlay for the RSVP field. Ships via Vercel `[deploy]`. |
| Business iOS | NO (behavior) | native keeps `runAfterInteractions` + `CountryPickerModal`; `pickerPresentation='overlay'` resolves to `'modal'` off web. Rides next business native build. |
| Business Android | NO (behavior) | same as iOS. |
| Consumer iOS / Android | NO | `app-mobile` PhoneInput/CountryPicker wrappers pass no `pickerPresentation` (default `'modal'`); FIX 1 is web-gated. |
| Admin Web | NO | not imported. |
| Business Web preview | Incidental | shares the buyer-web code. |

Parity: automatic (shared `@mingla/phone-input` package). No manual parity paths.

---

## 6. Regression tests + fails-on-revert

### A. Strict-grep CI gate (CLOSE HARD MUST — the CI-enforced regression guard)
`.github/scripts/strict-grep/orch-1299-rsvp-phone-picker-overlay.mjs`, registered in `strict-grep-mingla-business.yml`. Checks: A (helper web-gate), B (PhoneInput renders both surfaces via `resolvePickerPresentation`), C (RSVP passes overlay), D (checkout hosts do NOT), E (overlay web-`fixed`), **F (handleOpenPicker web-immediate `setPickerVisible`)**.
- Self-test: **PASS 11/11** (5 fixed shapes pass; 6 reverts fail).
- Live run: **PASS**.
- **Fails-on-revert by TRUE LINE DELETION (both fixes), verified at commit `30022ded2`:**
  - Deleted `pickerPresentation="overlay"` from PublicEventPage → gate FAIL (check C), exit 1 → restored → PASS.
  - Deleted the `if (Platform.OS === "web") { setPickerVisible(true); return; }` block from PhoneInput → gate FAIL (check F), exit 1 → restored → PASS.

### B. ts-jest unit test (runnable happy-path)
`mingla-business/src/components/event/__tests__/orch1299_picker_presentation.test.ts` — asserts `resolvePickerPresentation` over 5 cases (web→overlay; native→modal; default→modal; explicit modal→modal; union shape).
- **Could not run under jest in this session** (worktree `node_modules` symlinks to an EMPTY anchor install — no jest/ts-jest present). The identical logic was executed via node: **7/7 PASS**. The jest file will run under `npx jest orch1299_picker_presentation` once deps are installed. Deleting the web-gate branch in `pickerPresentation.ts` fails cases T-1/T-2.

Append-only: both new test artifacts are additions; no existing test modified.

---

## 7. Gates run / not run

- **Strict-grep gate:** RUN — self-test 11/11 + live PASS + fails-on-revert (both fixes). ✓
- **`resolvePickerPresentation` logic:** RUN via node — 7/7. ✓
- **`tsc --noEmit`:** NOT RUN — no TypeScript/RN types installed in the worktree (anchor `node_modules` empty this session). Operator/CI must run `cd mingla-business && npx tsc --noEmit`. Type-safety reasoned manually; the web-`fixed` overlay mirrors the shipped, CI-tsc'd `ParallaxCoverShell` sanctioned pattern and is type-checked transitively via mingla-business's tsc.
- **`npx jest`:** NOT RUN — same reason. Logic validated via node.
- **Runtime verification of the FIX:** NOT RUN — no local web build (no deps → cannot run Metro `--web` / export). **The BUG was reproduced on LIVE web; the FIX was not.** Hand to tester (see §11).

---

## 8. Smoke result

Live-web reproduction only (§0 evidence table). The fix itself was not smoke-tested (no local web build).

---

## 9. Known issues / deferred

- FIX 2 (overlay) necessity is **source-asserted, not runtime-confirmed** — verify at TEST whether, after FIX 1, the details-modal `CountryPickerModal` would open on web (if it does, the overlay is optional; if it freezes as documented, the overlay is required).
- The `runAfterInteractions`-never-fires condition is a **page-level defect** (a looping Animated animation on the RSVP public page holds an interaction handle forever). FIX 1 sidesteps it for the picker; the underlying held-handle may affect any other `runAfterInteractions` consumer on that page. Filed as a discovery (§12).

---

## 10. Operator action required

- None for DB/edge (none touched).
- Merge ships web via Vercel `[deploy]`; **NO business `eas update`** (COMMS-0052 OTA freeze) — native rides the next business native build.
- CI: run `cd mingla-business && npx tsc --noEmit` and `npx jest orch1299_picker_presentation` (could not run locally).

---

## 11. Downstream routing

Conductor REVIEW → **mingla-tester MUST live-fire on web** (the implementor could not run a local web build): confirm the RSVP guest phone picker (a) OPENS on tapping the flag inside the details modal AND the inline box, (b) selecting a country changes the flag/dial code and the composed E.164, (c) buyer checkout picker still opens. Then merge (web via Vercel `[deploy]`).

---

## 12. Discoveries for Orchestrator

- **DISCOVERY (root-cause):** `InteractionManager.runAfterInteractions` never fires on the RSVP public page (`/e/{brand}/{event}`) — a looping Animated animation holds an interaction handle indefinitely (runtime-proven; setTimeout/rAF fire, runAfterInteractions does not, even after clearing our own handle). Any feature deferring work behind `runAfterInteractions` on that page is at risk. Candidate deeper fix: audit the RSVP page's Animated loops for `isInteraction: true` (the default) and set `isInteraction: false` on purely-decorative loops, OR globally prefer immediate opens on web. Worth a follow-up ORCH.
- **NOTE:** the dispatch's premise "the buyer CHECKOUT phone field works because it is NOT inside a modal" is consistent with FIX 1 (checkout is a static page → `runAfterInteractions` fires there); it was asserted, not re-verified live here.
