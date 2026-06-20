# IMPLEMENTATION — ORCH-1170 [keyboard "Done" bar missing inside Sheet + Modal windows]

**Phase:** IMPLEMENT (mingla-implementor+claude). **Date:** 2026-06-20.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1170-[keyboard-modal-provider]/` on branch `ORCH-1170-keyboard-modal-provider`, rebased onto `origin/main` (includes the tester report commit `446c4bd97`).
**Binding QA report:** `Mingla_Artifacts/reports/QA_ORCH-1165_BUSINESS_KEYBOARD_DONE_BAR.md` — section "ORCH-1170 SC-4 Samsung drive" (FAIL, P1).
**Status:** implemented, partially verified (static gates + jest + fails-on-revert proven by me; on-device Samsung render of the bar inside both Modals is the tester's job, per dispatch).

---

## 1. Summary (plain English)

The brand-orange keyboard "Done" bar was being mounted inside two pop-up windows — the ticket-tier edit **sheet** and the cancel-order **dialog** — but it never actually appeared there. Those pop-ups open in their own separate Android window, and the keyboard library that drives the bar only listens for the keyboard inside whatever window holds its provider. The app's single provider lives at the app root, which does not reach into a pop-up window, so the bar stayed off-screen in both. The fix gives each pop-up its **own** keyboard provider (the same one the app root uses), so the bar now gets keyboard updates inside the sheet and the dialog. Pure-JS, OTA-able, business-app only; web is untouched (no bar on web).

---

## 2. SPEC / SC coverage table

The binding contract is the QA "ORCH-1170 SC-4 Samsung drive" defect + required fix. Success criteria derived from it:

| SC | Criterion | Verdict | Commit |
|----|-----------|---------|--------|
| SC-4a | The Done bar can render inside the ticket-tier edit **Sheet** (`SheetMobile.tsx` → RN `Modal` window): a per-window `KeyboardProvider` now wraps the sheet content + the toolbar. | ✓ source + jest (runtime = tester) | `9510221c6` |
| SC-4b | The Done bar can render inside the cancel-order **Dialog** (`Modal.tsx` → `RNModal` window): a per-window `KeyboardProvider` now wraps the dialog content + the toolbar. | ✓ source + jest (runtime = tester) | `9510221c6` |
| SC-G1 | The fix is scoped to the two named files (+ the test). No other files touched. | ✓ | `9510221c6` |
| SC-G2 | Web variants untouched (`SheetWeb` / `ModalWeb` have no toolbar and no provider added); library import stays out of the web bundle (wrapped via the existing `KeyboardRoot` web-split). | ✓ | `9510221c6` |
| SC-G3 | App-root provider, `KeyboardToolbarRoot` Done-only/brand-orange config, `SmartScrollView`, and the 9 at-risk surfaces are NOT touched. | ✓ | `9510221c6` |
| SC-G4 | `orch-0892` strict-grep gate stays EXIT 0; no safelist change needed. | ✓ (proven, §gates) | `9510221c6` |
| SC-G5 | TypeScript: no new errors in the touched files. | ✓ (proven, §gates) | `9510221c6` |

(`9510221c6` = the single fix commit on this branch.)

---

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/src/components/ui/SheetMobile.tsx` | +93 / −67 (net = wrapper add + JSX re-indent) | `SheetNative` Modal content wrapped in `<KeyboardRoot>`; added `KeyboardRoot` import. |
| `mingla-business/src/components/ui/Modal.tsx` | +76 / −29 | `ModalNative` RNModal content wrapped in `<KeyboardRoot>`; added `KeyboardRoot` import. |
| `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts` | +68 / −0 (append-only) | New `describe("ORCH-1170 ...")` block: each Modal host imports `KeyboardRoot` AND nests `<KeyboardToolbarRoot/>` inside a `<KeyboardRoot>` span. |

Line counts are inflated by re-indentation of the existing JSX one level deeper under the new wrapper; the substantive change is the `<KeyboardRoot>` open/close tags + one import per source file.

---

## 4. Data-model changes applied

None. Pure-JS UI fix. No migration, no edge function, no service, no hook, no RLS.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Path:** `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts` (append-only; new `describe("ORCH-1170 per-Modal-window KeyboardProvider (adversarial)")` block; commit body cites `[TEST-MOD-APPROVED ORCH-1165]` per the existing file token).
- **Angle (different from the ORCH-1165 assertions above it):** the prior suite only checks `<KeyboardToolbarRoot/>` is RENDERED in each host — exactly the thing that PASSED while the bar stayed inert on device. The new block asserts each Modal host (a) imports the `KeyboardRoot` provider wrapper and (b) nests `<KeyboardToolbarRoot/>` INSIDE a `<KeyboardRoot> ... </KeyboardRoot>` span (provider opens before the toolbar mounts and closes after it).
- **Run:** `npx jest orch_1165_keyboard_toolbar` → **23 passed / 23 total** (was 19; +4 = 2 hosts × {import, nesting}).
- **fails-on-revert verified at `9510221c6` by TRUE LINE DELETION (not comment-out):**
  - Deleted the `<KeyboardRoot>` open + `</KeyboardRoot>` close tags from `Modal.tsx` (toolbar left as a bare sibling) → re-ran → **FAIL** ("Modal native host nests <KeyboardToolbarRoot/> INSIDE a <KeyboardRoot>" at test line 224: `expect(withoutImports).toMatch(/<KeyboardRoot\b[^>]*>/)`). Restored → **23/23 PASS**.
  - Deleted the `<KeyboardRoot>` open + close tags from `SheetMobile.tsx` → re-ran → **FAIL** ("Sheet native host nests ..."). Restored → **23/23 PASS**.
  - Each Modal host is independently guarded (deleting either wrapper fails its own assertion).
- Both the pre-existing implementor clearance test AND this adversarial extension are present in `git diff origin/main...HEAD --name-only` (the test file is modified on-branch; the clearance test was added by ORCH-1165 and is on `origin/main`).

---

## 7. Old → New receipts

### `mingla-business/src/components/ui/SheetMobile.tsx`
**Before:** `SheetNative` rendered its RN `<Modal>` content (`<View absoluteFill>` → scrim + panel + `<KeyboardToolbarRoot/>`) with NO `KeyboardProvider` in that Modal window. The toolbar mounted but received no keyboard frames → Done bar stayed off-screen inside the sheet.
**After:** the Modal content `<View>` (inputs + toolbar) is wrapped in `<KeyboardRoot>` (native = `<KeyboardProvider>` from `react-native-keyboard-controller`; web = passthrough). The sheet's own native window now has a provider, so the toolbar gets keyboard frames there.
**Why:** QA "ORCH-1170 SC-4 Samsung drive" — SC-4a FAIL: no Done bar in the ticket-tier sheet; root cause = no per-window `KeyboardProvider`.
**Lines changed:** ~12 substantive (1 import + open/close wrapper); rest = JSX re-indent.

### `mingla-business/src/components/ui/Modal.tsx`
**Before:** `ModalNative` rendered its `<RNModal>` content with NO `KeyboardProvider` in that window. `<KeyboardToolbarRoot/>` mounted but inert → Done bar absent inside the cancel-order dialog.
**After:** the RNModal content `<View>` (inputs + toolbar) wrapped in `<KeyboardRoot>`. The dialog's window now has its own provider.
**Why:** QA SC-4b FAIL: no Done bar in `CancelOrderDialog`; same root cause.
**Lines changed:** ~12 substantive; rest = JSX re-indent.

### `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts`
**Before:** asserted mount-coverage (toolbar rendered) + keyed-offset for ORCH-1165; could not catch the inert-provider defect (toolbar WAS rendered).
**After:** append-only block asserting the provider wraps the toolbar in each Modal host.
**Why:** fails-on-revert guard for the ORCH-1170 fix.
**Lines changed:** +68 (append-only).

---

## 8. Cross-surface impact table

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS (app-mobile) | No | Different app; not touched. |
| Consumer Android (app-mobile) | No | Different app; not touched. |
| Buyer/anon Web | No | `mingla-business` web renders `SheetWeb`/`ModalWeb`, which have no toolbar and no provider added; `KeyboardRoot` resolves to a web passthrough. No keyboard bar on web by design. |
| **Business iOS** | **Yes (parity automatic — shared native code)** | `SheetNative`/`ModalNative` are the iOS+Android path; the per-window provider applies to both. The QA defect was platform-agnostic (no provider in the RN-Modal window on either OS), so iOS gets the same fix. |
| **Business Android** | **Yes (the proven-defect surface)** | Done bar now has a provider inside the sheet + dialog windows. Runtime render = tester. |
| Admin Web | No | Different app. |
| Business Web preview | No | Same as buyer web — web variants untouched. |

Parity is **automatic** (single shared native codepath); no manual mirroring required.

---

## 9. Smoke result

- `orch-0892` strict-grep gate: **EXIT 0**, 846 files scanned, 8 safelisted, 0 violations. No safelist change needed (the two files import the `KeyboardRoot`/`KeyboardToolbarRoot` wrappers, not the library directly, and contain no `TextInput`, so they trip none of the four forbidden patterns).
- `npx jest orch_1165_keyboard_toolbar`: **23/23 PASS** (both `clearance` + `mount_coverage` suites).
- fails-on-revert: proven by true line deletion on BOTH `Modal.tsx` and `SheetMobile.tsx` (§6).
- `npx tsc --noEmit`: 0 new errors in the three touched files (the 540 pre-existing errors are all in `packages/phone-input/*` module-resolution noise, present before this change; 0 mention `KeyboardRoot`/`SheetMobile`/`ui/Modal`).
- On-device render of the bar inside the sheet + dialog on Samsung: **NOT run by me** (tester's job per dispatch).

---

## 10. Known issues / deferred

- No on-device confirmation performed here (by design). The tester must drive the same Samsung recipe from the QA report (ticket-tier edit sheet + cancel-order dialog, keyboard up) and confirm the orange Done bar now renders flush above the keyboard, matching the Ari positive control.
- Library-design note (not a defect): `react-native-keyboard-controller@1.18.5` `KeyboardProvider` renders a flex:1 `KeyboardControllerView` + a React Context; mounting a second provider inside a RN `Modal` window is the documented per-window pattern. The provider's native view fills the Modal's absoluteFill subtree (the wrapped `<View style={absoluteFill}>` is already the full-window root), so no layout change to the scrim/panel.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required (for orchestrator/tester)

- **Migration:** none.
- **Edge-fn deploy:** none.
- **Next:** route to mingla-tester (retest SC-4a/SC-4b on Samsung — drive the ticket-tier edit sheet + cancel-order dialog with the keyboard up; the orange Done bar must now appear in both, matching the Ari positive control). Pure-JS/OTA-able on close.

---

## 12. Discoveries for Orchestrator

- **Dispatch note correction (no action):** the dispatch stated `SheetMobile.tsx` + `Modal.tsx` are "already on the orch-0892 safelist for the existing toolbar mount." They are NOT in the gate's `SAFELIST` set (only `KeyboardToolbarRoot.native.tsx` is). They pass the gate because they import the wrapper, not the library, and contain no `TextInput` — so none of the four forbidden patterns match. Adding the `KeyboardRoot` wrapper import preserves that; gate verified EXIT 0. No safelist edit was made or needed.
- **COMMS-0040 / COMMS-0041 (WARN, OPEN, to ALL):** acknowledged, **zero overlap** — this ORCH touched only the two generic UI container primitives (`SheetMobile.tsx`, `Modal.tsx`) + a wrappers test; it touched NO public RSVP/experience page files (`RsvpPublicBody.tsx`, `RsvpMomentumDecision.tsx`, `ConsumerEventDetailScreen.tsx`, `PublicEventPage.tsx`, `packages/offering-rendering/*`, experience public pages all untouched). Factored, no divergent work. Ack appended on anchor `main`.
- **COMMS-0045 (WARN, RESOLVED):** the ORCH-1165→1170 renumber; this report + branch + test use the correct historical disposition (merged code/tests keep the `1165` label; tracking artifacts use `1170`). No action.
