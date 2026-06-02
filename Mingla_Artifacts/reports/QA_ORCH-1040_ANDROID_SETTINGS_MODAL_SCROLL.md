# QA — ORCH-1040 [android-settings-modal-scroll]

**Mode:** TARGETED (orchestrator-dispatched TEST)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1040-[android-settings-modal-scroll]/` on branch `ORCH-1040-android-settings-modal-scroll`
**HEAD at dispatch:** `8f689e25e` · **HEAD after tester commit:** `5b5c9154c` (adds the tester adversarial test)
**Comms ledger:** read on entry. No BLOCK/WARN addressed to mingla-tester, ORCH-1040, or ALL requiring action. COMMS-0017 (Samsung A72 reservation) is RESOLVED/expired and explicitly leaves `emulator-5554` unreserved — that is the device used here.

---

## Verdict: **PASS**

- P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 2
- The Android frozen-scroll bug is fixed and PROVEN on device (bounds-delta). Both dismiss paths work. The fix is a routing change in the shared `BaseBottomSheet` primitive; iOS rests on mechanism (`strong`) after a genuine, blocked login attempt (no OTP path exists in the shipped consumer auth UI — documented below).

---

## Live-fire sim gate (Phase 0.A)

| Leg | Status | Evidence |
|---|---|---|
| Android (Pixel 8 Pro `emulator-5554`, 1344×2992) | **PROVEN** | bounds-delta below; screenshots `/tmp/orch1040_qa_07..16` |
| iOS (iPhone 17 Pro `17091E60`) | **probable→strong (mechanism)** | blocked at login — see iOS section; fix compiles + app launches clean |
| Web | N/A | AccountSettings is a native consumer sheet; not a web surface |

Method note: the running Metro :8109 serves the **anchor** checkout (operator's build), which is on clean `main` (the buggy `header=` version). To independently verify the FIX I copied ONLY the worktree's `AccountSettings.tsx` onto the anchor (shared-anchor-hazard rule — single file, no `add -A`/`reset`), force-relaunched the emulator app against :8109 via `adb reverse tcp:8109`, ran the live test, then restored the anchor byte-for-byte. Anchor backup sha `ca1392f6d0e636cde246de6c9b476d3e06621e75e670e337e851aa3113979102`; restored sha identical; `git status` for the file is clean. Operator's Metro/build undisturbed.

---

## Android — independent device proof (PROVEN)

Repro setup: Profile → Account Settings opened. Expanded **Privacy** + **Notification Settings** (on top of the default-expanded The Basics) to overflow the 89% sheet (root sheet bounds `[0,311][1344,2992]`).

### Body SCROLLS (non-zero bounds-delta — the inverse of the frozen 0px state)

The first swipe started on a toggle row and was (correctly) consumed by the toggle; a swipe originating on a neutral label area scrolled cleanly. uiautomator bounds, expanded state, before → after one scroll:

| Probe element | BEFORE scroll | AFTER scroll | Delta |
|---|---|---|---|
| "Push Notifications" | `[99,2383][1053,2444]` | `[99,1114][1053,1175]` | **−1269px (up)** |
| "Notification Settings" header | `[183,2228][628,2293]` | `[183,959][628,1024]` | **−1269px (up)** |
| "Settings" title (top scroll child) | `[72,347][296,428]` | scrolled OFF the top | up off-viewport |
| "The Red Zone" | below fold (absent) | `[183,2761][483,2826]` | entered viewport |
| "Delete My Account" | below fold (absent) | `[99,2874][1245,2992]` | entered viewport |

Continued scrolling settled the bottom into full view: **"Delete My Account" at `[99,2484][1245,2635]`**, "The Red Zone" `[183,2371][483,2436]`, warning "This permanently deletes your data…" `[51,2659][1293,2809]`. Screenshot `/tmp/orch1040_qa_10_delete_full.png`.

### Both dismiss paths VERIFIED

1. **In-body close-X** — `[1200,352][1272,424]` (content-desc "Close account settings"). Tap → sheet dismissed (uiautomator `content-desc="Settings"` count 0) → Profile page restored ("Account Settings" row + "Profile" tab present). `/tmp/orch1040_qa_15_closeX_dismissed.png`.
2. **Swipe-down handle** — gorhom exposes "Bottom sheet handle" at `[0,239][1344,311]` (OUTSIDE the scroll content). At scroll offset 0, swipe down from the handle → sheet dismissed (count 0) → Profile restored. `/tmp/orch1040_qa_16_handle_dismissed.png`.

This is the exact inverse of the investigation's frozen state (0px delta, Delete unreachable, dismiss-only-via-handle). Confidence: **proven**.

---

## iOS — mechanism (login genuinely blocked; OTP premise does not match shipped UI)

The dispatch expected a reviewer phone-OTP login (`+12015550199`/`123456`). Findings after a real attempt:

- Consumer app `com.mingla.app.v2` is installed on the iPhone 17 Pro sim and **launches clean** (no red-box) on the fresh state — `/tmp/orch1040_ios_01_launch.png`.
- The login screen (`app-mobile/src/components/signIn/WelcomeScreen.tsx`) exposes **only "Continue with Apple" + "Continue with Google"**. Source grep confirms there is **NO phone/OTP/`signInWithOtp`/PhoneInput path** in the consumer sign-in UI at all. The reviewer-OTP credential in the dispatch corresponds to no affordance in the current consumer build (this is the same wall the implementor hit — it is a real absence, not a missed tap).
- Checked the iOS app data container for a reusable persisted Supabase session (`RCTAsyncLocalStorage_V1`): **no JWT / access_token / refresh_token** stored — genuinely logged out.
- Apple/Google OAuth cannot be completed headlessly on a simulator autonomously, and is not a phone-OTP flow.

Genuine recovery was attempted (install confirmed, launch, source inspection, session-injection reconnaissance) and the blocker is a real product fact, so per the gate iOS rests on mechanism at **`strong`**:
(a) the fix is a pure JSX routing change in the **shared cross-platform** `BaseBottomSheet`; removing `header=` routes the root sheet through the bare `case 'scroll' → return scroll;` path (BaseBottomSheet.tsx:558) — the EXACT binding the allowlisted, on-device-verified `ExpandedBusinessEventSheet` uses on iOS;
(b) iOS already scrolled WITH the more-fragile header-wrapper (the freeze was Android-gorhom-5.2.8-specific); the bare path is strictly safer on iOS;
(c) the change compiles (`tsc` clean on the touched files) and the app renders on iOS.
This matches the implementor's and the investigation's iOS confidence.

---

## Regression tests

### Implementor (happy-path) — exists, green, fails-on-revert
- **Path:** `app-mobile/src/components/profile/__tests__/orch_1040_account_settings_bare_scroll.test.mjs`
- **In diff:** yes (`git diff origin/main...HEAD --name-only`).
- **Passing on fix:** `PASS ORCH-1040 AccountSettings bare-scroll regression suite (T-1..T-4)` (re-run by tester).
- **Fails-on-revert (tester-verified):** reverted `AccountSettings.tsx` to `origin/main` → `FAIL … T-2: root settings sheet must NOT pass a header= prop`. Implementor cites fails-on-revert at `cc41734db`; tester independently reproduced FAIL against the `origin/main` version. Restored → PASS.

### Tester (adversarial) — authored this turn, DIFFERENT angle, committed
- **Path:** `app-mobile/src/components/profile/__tests__/orch_1040_account_settings_no_freeze_wrapper.adversarial.test.mjs`
- **Committed:** `5b5c9154c` (now in `git diff origin/main...HEAD --name-only`).
- **Different angle (not a renamed happy-path copy):** the implementor's T-2 guards exactly ONE freeze token (`header={`). The adversarial suite asserts the **broader invariant** that *no* wrapper-routing prop can re-freeze the Android viewport — `header=` **AND** `stickyFooter=` **AND** `stickyHeader=` (the latter two route the root sheet into the sticky branch's `flex:1` wrapper, BaseBottomSheet.tsx:453/500-506, re-collapsing the scroll exactly like `header=` did, yet would NOT trip the implementor's `header={`-only guard). It also pins `scrollMode="scroll"` (A-4) and adds a **positional** invariant (A-5): the relocated header must appear BEFORE the first `<AccordionCard`, proving the title/close-X is the first scroll child at offset 0 — not merely present somewhere in the file.
- **Passing on fix:** `PASS ORCH-1040 AccountSettings no-freeze-wrapper ADVERSARIAL suite (A-1..A-5)`.
- **Fails-on-revert (tester-verified):** reverted file → `FAIL … A-1: root settings sheet must NOT pass a header= prop`. Restored → PASS.

Both tests ship together with the fix (both in the closing diff).

---

## Country picker observation (Step 4 — observational, NOT a pass/fail for this ORCH)

The dispatch flagged the 3 nested pickers (esp. the "tall Country picker") as possibly sharing the freeze. Empirical Android result:

- The **Country picker scrolls fine on Android.** Live bounds-delta (Settings → Country → list scrolled): "Nigeria" `[179,1831]` → `[179,799]` = **−1032px**; "Argentina" `[179,2839]` → `[179,1807]` = −1032px; lower-alphabet entries (Austria/Belgium) scrolled into view. `/tmp/orch1040_qa_17_countrypicker.png`.
- **Why it's safe:** the Country picker is NOT a gorhom `BaseBottomSheet` with a pinned `header=`. `app-mobile/src/components/onboarding/CountryPickerModal.tsx` is a thin wrapper around a shared-package component that renders a full-screen RN `Modal` + `FlatList` (with its own search bar + close-X). Different scroll architecture → does NOT share the gorhom header-wrapper freeze.
- **Input for the sweep decision:** the Country picker is NOT a member of the at-risk set. The actually-at-risk nested siblings are the **gender / language / birthday** pickers, which still pass a `header=` prop to `BaseBottomSheet` (AccountSettings.tsx:884/911/941). They are short + fixed-snap (45%/70%/60%) so overflow is unlikely, but they are the candidates for the operator's sibling-sweep — NOT the Country picker. (Not fixed here; out of ORCH-1040 scope.)

---

## Constitution check (relevant rules)

| Rule | Result | Note |
|---|---|---|
| 1 No dead taps | PASS | close-X + handle both dismiss; verified on device |
| 3 No silent failures | PASS | scroll now functions; the bug was a silent freeze — now resolved |
| 8 Subtract before adding | PASS | fix REMOVES the offending `header=` prop, doesn't layer on |
| Others | N/A | no data/auth/currency/state surface touched |

---

## Completion Condition traceability

| `/goal` clause | Status | Evidence |
|---|---|---|
| Android bounds-delta proves body scrolls + Delete reachable | PASS | "Push Notifications" −1269px; "Delete My Account" `[99,2484][1245,2635]` |
| Both dismiss paths work | PASS | close-X tap + handle swipe-down both → Profile (count 0) |
| iOS verified-or-mechanism | PASS (mechanism, `strong`) | login genuinely blocked — no OTP path in consumer UI; shared-primitive routing + EBES precedent + clean launch |
| Tester adversarial test: written + passing + fails-on-revert + in diff | PASS | `…no_freeze_wrapper.adversarial.test.mjs` @ `5b5c9154c`; PASS on fix, FAIL on revert |
| Implementor happy-path test: green + fails-on-revert + in diff | PASS | `…bare_scroll.test.mjs`; PASS on fix, FAIL on revert (tester-reproduced) |
| Country-picker scroll state recorded | PASS | scrolls (−1032px); different architecture; not in at-risk set |
| `tsc` on touched files | PASS | 0 errors in AccountSettings.tsx / BaseBottomSheet.tsx / tests / ProfilePage.tsx (worktree-wide 260 errors are pre-existing symlinked-node_modules `react`/jsx-runtime resolution noise — the documented per-ORCH worktree hazard, none in touched files) |
| Zero open P0/P1 | PASS | none |

---

## Discoveries for orchestrator

- **P4-1 (sweep input):** The at-risk nested siblings are gender/language/birthday pickers (still `header=` on `BaseBottomSheet`), NOT the Country picker (separate full-screen Modal+FlatList, scrolls fine on Android). Already a registered orchestrator follow-up (16 siblings + the `i-bottomsheet-inline-scroll-binding.mjs` `wrapInRNModal`-exemption defect F3); this QA narrows the candidate list.
- **P4-2 (dispatch premise correction):** The consumer iOS/Android login UI exposes ONLY Apple/Google sign-in — there is no phone/OTP path in `WelcomeScreen.tsx`. The reviewer-OTP `+12015550199`/`123456` does not map to any affordance in the shipped consumer build. Future iOS-sim test dispatches that need an authed consumer session should plan for OAuth-or-seeded-session, not OTP. (Android sim was already authed as Ava Thompson, which is how the live-fire there succeeded.)

---

## Environment restored

- Anchor `app-mobile/src/components/profile/AccountSettings.tsx` restored byte-for-byte to `main` (sha `ca1392f6…`); `git status` clean for the file. No other anchor file touched.
- Operator's Metro :8109 (PID 43534) left running, undisturbed.
- `adb reverse tcp:8109` left on `emulator-5554` (harmless; that emulator is the ORCH test device).
- Tester adversarial test committed on the ORCH branch only (`5b5c9154c`).
