# IMPLEMENTATION — ORCH-1040 [android-settings-modal-scroll]

**Mode:** IMPLEMENT
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1040-[android-settings-modal-scroll]/` on branch `ORCH-1040-android-settings-modal-scroll`
**Status:** implemented and verified (Android PROVEN on Pixel 8 Pro; iOS non-regression by mechanism + clean launch)
**Comms ledger:** read on entry. No BLOCK/WARN addressed to ORCH-1040 or mingla-implementor. COMMS-0017 (Samsung A72 reservation) is RESOLVED. No new cross-ORCH discovery requiring a COMMS write (blast radius is the AccountSettings sheet only; the 16 sibling sheets + the gate defect are already registered as orchestrator follow-ups in the investigation, out of scope here).

---

## Summary

The consumer Account Settings sheet would not scroll on Android — once 2+ accordion sections were expanded, the body froze and "Delete My Account" (Red Zone) was unreachable. Root cause (proven by the investigation on Pixel 8 Pro): the root `BaseBottomSheet` used `scrollMode="scroll"` AND a `header=` prop, which routes the primitive through its header-bearing branch that wraps the `BottomSheetScrollView` inside a `flex:1 BottomSheetView`. On Android (gorhom 5.2.8) that wrapper collapses the inner scroll viewport to content height → maxScrollY = 0 → frozen body.

Fix (precedent-matched to ORCH-1016 + the verified-scrolling `ExpandedBusinessEventSheet`): removed the `header=` prop from the ROOT settings sheet and moved the Settings title + close-X INTO the scroll body as the first scroll child. The path now falls into the bare `case 'scroll'` branch (`BaseBottomSheet.tsx:558 return scroll;`), so the scroll is the bare direct child of the sheet content → bounded viewport → scrolls on Android.

---

## Old → New Receipts

### `app-mobile/src/components/profile/AccountSettings.tsx`
**What it did before:** The root `<BaseBottomSheet>` (the settings sheet) passed both `scrollMode="scroll"` and a `header={<View style={styles.header}>…title + close-X…</View>}` prop. With a `header` prop present, `BaseBottomSheet` wraps the `BottomSheetScrollView` inside a `flex:1 BottomSheetView` (lines 550-556). On Android this collapsed the scroll viewport → body frozen → Red Zone / "Delete My Account" unreachable when content overflowed the 92% snap.
**What it does now:** The root sheet no longer passes a `header=` prop. The Settings title + close-X markup (`styles.header` row) is now rendered as the FIRST child INSIDE the scroll body. The primitive therefore takes the bare `return scroll;` path → the `BottomSheetScrollView` is the direct child of the sheet content → bounded viewport → scrolls on Android. The close-X still calls `onClose` (parent dismiss). The `styles.header` `paddingHorizontal` was reduced from `24` to `8` because the header now sits inside the `scrollContent` container which already applies `paddingHorizontal: 16` — keeps the title visually aligned with the cards.
**Why:** ORCH-1040 root cause — the header-wrapped scroll freezes on Android. Removing the wrapper is the proven ORCH-1016 fix.
**Lines changed:** ~25 (root-sheet prop block + header markup relocation + one style value).

**Scope note:** The 3 nested picker sheets (gender/language/birthday) STILL pass a `header=` prop. They are intentionally untouched: they are short, fixed-snap (45%/70%/60%), and not the reported bug. ORCH-1040 scope is locked to the root settings sheet only.

### `app-mobile/src/components/profile/__tests__/orch_1040_account_settings_bare_scroll.test.mjs` (NEW)
Step-0.5 structural regression test (node `.mjs`, same harness style as the locked Wave-C Batch-2 suite — the gorhom host is not mountable in this harness). Asserts on the ROOT settings sheet only:
- **T-1** root sheet uses `scrollMode="scroll"`.
- **T-2** root sheet does NOT pass a `header=` prop (the bug).
- **T-3** the Settings title (`styles.header`) + close-X (`<Icon name="close"`) render INSIDE the scroll body.
- **T-4** dismissibility preserved — the in-body close-X calls `onClose`.

---

## Dismissibility — how it is preserved

Two independent dismiss affordances, both verified on Android:

1. **gorhom swipe-down handle.** `BaseBottomSheet` defaults `enablePanDownToClose = true` (line 314) and shows the drag handle (line 632). This is sheet chrome, OUTSIDE the scroll content, so it is always present regardless of scroll position. (Verified earlier in ORCH conversion history; unaffected by this change.)
2. **In-body close-X.** The close-X is now the first scroll child. At the sheet's resting open position the scroll is at offset 0, so the title + close-X are fully visible without scrolling. It calls the parent `onClose`. Verified live: tapped the close-X → sheet dismissed → returned to Profile page (`/tmp/orch1040_12_after_close.png`; uiautomator confirmed "Settings" sheet gone, "Profile" tab present).

The close-X only scrolls off-screen when the user deliberately scrolls down to reach lower content; at that point the swipe-down handle remains the always-available dismiss. This mirrors the `ExpandedBusinessEventSheet` pattern (no pinned header; dismiss via handle).

---

## Pixel 8 Pro runtime verification (PROVEN — runtime geometry, not source)

Device: Pixel 8 Pro AVD `emulator-5554` (1344×2992), consumer app `com.mingla.app.v2`, Metro :8109 (anchor checkout) + `adb reverse tcp:8109`. The fix was applied onto the anchor checkout's `AccountSettings.tsx` (the running Metro serves the anchor; operator is testing there — per `feedback_testing_handoff_just_run_expo_start.md` + shared-anchor-hazard rule, only this one file was copied, then restored byte-for-byte after — anchor sha `a79298ab…` restored, `git status` clean). App force-relaunched + deep-linked to :8109 to load the fresh bundle. Logged in as the seeded reviewer profile (Ava Thompson) — no separate OTP login needed.

Repro setup: opened Settings, expanded The Basics (default) + Privacy + Notification Settings to overflow the 92% sheet.

| Probe element | BEFORE scroll | AFTER scroll (settled) | Delta |
|---|---|---|---|
| "Push Notifications" (persistent mid element) | `[99,2383][1053,2444]` | `[99,1538][1053,1599]` | **−845px (moved up)** |
| "Settings" title (top scroll child) | `[72,347][296,428]` | scrolled OFF the top (absent) | moved up off-viewport |
| "Quiet Hours" | below fold (absent) | scrolled INTO view (`y≈2793`) | entered viewport |
| "App Information" | below fold (absent) | scrolled INTO view | entered viewport |

Continued scrolling reached the bottom: **"Delete My Account" VISIBLE at `[99,2484][1245,2635]`**, "The Red Zone" header `[183,2371][483,2436]`, and the "permanently deletes…" warning `[51,2659][1293,2809]` (`/tmp/orch1040_09_bottom.png`).

This is the exact inverse of the investigation's frozen state (0px delta, Delete unreachable). The body now scrolls; the full sheet — including the Red Zone — is reachable.

**Dismiss verified:** scrolled back toward the top, returned to the root settings sheet (Settings title + "Close account settings" affordance at `[1200,352][1272,424]`), tapped the close-X → sheet dismissed → Profile page (`/tmp/orch1040_12_after_close.png`). Nested picker swap (Country picker) also still works (observed during scroll-back).

Screenshots captured to `/tmp/orch1040_*.png` (05 settings open, 06 overflow, 07 after-scroll, 08/09 Red Zone reachable, 12 after-close). Key frames copied into this report folder as `PIXEL_*` (see below).

### iOS non-regression
iPhone 17 Pro sim (`17091E60-…`): consumer app launched cleanly on the fresh bundle (no red-box) and rendered the login screen. The sim is logged out and exposes only Apple/Google login (no reachable phone-OTP affordance on that screen — same condition the investigation documented), so a full in-sheet iOS scroll could not be live-fired within scope. iOS non-regression rests on mechanism (`probable→strong`): (a) removing `header` routes iOS through the bare `return scroll` path, which is the EXACT binding the allowlisted, on-device-verified `ExpandedBusinessEventSheet` uses on iOS; (b) iOS already scrolled WITH the more-fragile header-wrapper, and the bare path is strictly safer; (c) clean bundle launch confirms the change compiles + renders on iOS. This matches the investigation's own iOS confidence level.

---

## Regression Test

- **Path:** `app-mobile/src/components/profile/__tests__/orch_1040_account_settings_bare_scroll.test.mjs`
- **Passing run (on fix):**
  ```
  PASS ORCH-1040 AccountSettings bare-scroll regression suite (T-1..T-4)
  ```
- **Fails-on-revert verified at commit `cc41734dbcb9f5206cc5da11cd41313f1c2b8350`** (branch HEAD before the fix). `git stash push` of `AccountSettings.tsx` re-introduced the `header={…}` prop; re-running the test produced:
  ```
  FAIL ORCH-1040 AccountSettings bare-scroll regression suite
  T-2: root settings sheet must NOT pass a `header=` prop — that wraps the scroll
  in a flex:1 BottomSheetView and freezes the body on Android. The scroll must be
  the bare direct child.
  ```
  `git stash pop` restored the fix → test PASS again.
- **Real proof is the Pixel bounds-delta above** (the structural test is the cheap guard; the on-device geometry is load-bearing, per the ORCH-1016 "runtime geometry, not source" lesson).

---

## Gates

- **Strict-grep `i-bottomsheet-inline-scroll-binding.mjs`:** `OK` (unchanged — AccountSettings uses `wrapInRNModal`, which the gate exempts; the gate's `wrapInRNModal`-is-safe assumption is the F3 defect the investigation flagged for a SEPARATE orchestrator follow-up; NOT touched here per locked scope).
- **Existing locked test `WaveCBatch2.test.mjs`:** `PASS` (it does not assert the `header` prop, so the fix does not break it; no `[TEST-MOD-APPROVED]` needed — file untouched).
- **`tsc --noEmit`:** 0 errors attributable to `AccountSettings.tsx`.

---

## Spec / Completion Condition Traceability

| `/goal` clause | Status | Evidence |
|---|---|---|
| AccountSettings scrolls on Android (non-zero bounds-delta + Delete reachable) | PASS | "Push Notifications" −845px; "Delete My Account" reached at `[99,2484][1245,2635]` |
| Via the bare `scrollMode="scroll"` direct-child pattern | PASS | `header=` removed; primitive takes `return scroll` path; header moved into scroll body |
| Dismissibility preserved | PASS | close-X tap dismissed sheet → Profile; swipe-down handle still default-on |
| iOS not regressed | PASS (mechanism + clean launch) | bare path = verified EBES iOS binding; clean iOS bundle launch |
| Scoped to AccountSettings only | PASS | only `AccountSettings.tsx` (+ new test) changed; gate + 16 siblings untouched |
| Step-0.5 test passing + fails-on-revert | PASS | green on fix; FAIL on revert @ `cc41734db` |
| Committed | PASS | see commit hash below |

---

## Discoveries for Orchestrator

- None new. The two follow-ups (16 sibling header+scroll+wrapInRNModal sheets at risk; the `i-bottomsheet-inline-scroll-binding.mjs` `wrapInRNModal`-exemption defect F3) were already registered by the investigation as P1 orchestrator follow-ups and are explicitly OUT OF SCOPE for ORCH-1040 per the locked dispatch.

---

## Commit

- Branch: `ORCH-1040-android-settings-modal-scroll`
- Commit hash: `9dbb7a0f86b6f6199f8ba71bd7c73bc5909db9ce` (HEAD; supersedes the pre-amend `7f6532024` — amend only added this line).
