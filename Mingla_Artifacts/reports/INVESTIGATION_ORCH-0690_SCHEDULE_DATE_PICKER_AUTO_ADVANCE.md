# Investigation — ORCH-0690 Schedule date-picker auto-advance

**Mode:** INVESTIGATE-ONLY
**Dispatch:** [`prompts/FORENSICS_ORCH-0690_SCHEDULE_DATE_PICKER_AUTO_ADVANCE.md`](../prompts/FORENSICS_ORCH-0690_SCHEDULE_DATE_PICKER_AUTO_ADVANCE.md)
**Date:** 2026-04-27
**Investigator:** mingla-forensics
**Confidence ceiling:** Static analysis HIGH on iOS code path (deterministic from source). Android code path HIGH for the **post-OK auto-flip**; the user's "change the month" wording is interpreted in §1.3 — operator clarification welcome but does not change root-cause classification.

---

## §0 Executive verdict (5 lines)

- **Root cause is two-platform**: iOS auto-flips date→time on **every wheel tick** (HIGH); Android auto-flips date→time **immediately after the user presses OK on the calendar dialog** with no preview/confirm step (HIGH).
- **The `<Modal>` wrapper's "Next" button on iOS is structurally redundant** — `handleDateTimePickerChange` already mutates `pickerMode` before the user can press it. The button works only because the picker re-renders in time-mode by then.
- **No path back from time-mode to date-mode** — once flipped, the user must Cancel (losing all progress) and restart from "now."
- **Blast radius:** 8 ExpandedCardModal mount surfaces (not just chat/deck/saved as user reported) — fix in ActionButtons itself cascades to all.
- **Findings tally:** 2 RC + 2 CF + 5 HF + 3 OBS + 4 Discoveries.

---

## §0.5 Phase 0 ingestion summary

**Prior artifacts.** No `INVESTIGATION_ORCH-0690_*` exists. Only the dispatch prompt (one file) — clean slate.

**Memory hits.** None directly relevant; `feedback_headless_qa_rpc_gap.md` applies (no live device test from this agent — confidence ceiling enforced).

**Sub-agent verification.** None used; all findings are direct file reads.

**Migration chain.** N/A — mobile-only investigation, no DB / no edge fn / no RLS.

---

## §1 Investigation manifest

| # | File | Layer | Why |
|---|---|---|---|
| 1 | [`app-mobile/src/components/expandedCard/ActionButtons.tsx`](app-mobile/src/components/expandedCard/ActionButtons.tsx) | Component | Primary suspect — picker state machine |
| 2 | [`app-mobile/src/components/ExpandedCardModal.tsx`](app-mobile/src/components/ExpandedCardModal.tsx) | Component (parent) | Both mount paths to ActionButtons (curated and single) |
| 3 | All ExpandedCardModal callsites (8 surfaces) | Component (grandparent) | Blast-radius mapping |
| 4 | [`@react-native-community/datetimepicker@8.4.4`](app-mobile/node_modules/@react-native-community/datetimepicker/README.md) | Native module | Confirm onChange / event.type semantics — was it a library upgrade that broke this? |
| 5 | [`app-mobile/src/utils/openingHoursUtils.ts`](app-mobile/src/utils/openingHoursUtils.ts) (referenced) | Util | `isPlaceOpenAt` — confirm not a contributing factor |

---

## §2 Symptom reconciliation (Q-1 through Q-4 from dispatch)

### §2.1 Q-1: Platform scope — iOS / Android / both?

**Both, but different mechanisms.**

#### iOS path — [`ActionButtons.tsx:312-316`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L312-L316)

```tsx
} else {
  // iOS flow
  if (date) {
    if (pickerMode === "date") {
      setSelectedDate(date);
      setSelectedTime(date);
      setPickerMode("time");      // ← line 316 — auto-flip
    } else {
      // Time selected - wait for Done button
      const combinedDateTime = new Date(selectedDate);
      ...
    }
  }
}
```

The iOS picker mounts with `display="spinner"` ([line 623](app-mobile/src/components/expandedCard/ActionButtons.tsx#L623)). Per the `@react-native-community/datetimepicker@8.4.4` README:

> `onChange` is called when the user changes the date or time in the UI. … It is also called when user dismisses the picker.

For `display="spinner"`, the spinner is **inline**; every spin emits `event.type === 'set'` with the new `date`. The handler enters the `if (date)` branch unconditionally and flips `pickerMode` from `"date"` to `"time"`. After the FIRST tick of the date wheel, the picker re-renders with `mode="time"` (line 621 binds `mode={pickerMode}`), the wheel content swaps to time, and the user can never reach the "Next" button while still in date-mode.

**Confidence:** HIGH (deterministic from source — `display="spinner"` + onChange semantics).

#### Android path — [`ActionButtons.tsx:247-258`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L247-L258)

```tsx
if (Platform.OS === "android") {
  if (event.type === "dismissed") {
    setShowDateTimePicker(false);
    return;
  }

  if (date) {
    if (pickerMode === "date") {
      // Date selected on Android - show time picker next
      setSelectedDate(date);
      setSelectedTime(date);
      setPickerMode("time");      // ← line 258 — auto-flip on OK
      // Keep picker visible for time selection
    } else {
      ...
    }
  }
}
```

Android picker mounts with `display="default"` ([line 638](app-mobile/src/components/expandedCard/ActionButtons.tsx#L638)). Per the README, `default` means "spinner/calendar/clock based on `mode`" — for `mode="date"`, the platform default in API ≥21 is the **Material calendar dialog**. The dialog emits `onChange` only when:
- User presses **OK** → `event.type === 'set'`, `date` populated
- User presses **Cancel** / hardware back → `event.type === 'dismissed'`

So on Android, the user's flow is: tap Schedule → calendar dialog appears → user can browse months/years freely (no event) → user picks a day → presses OK → `onChange` fires `'set'` → handler reaches line 258 → `setPickerMode("time")` → calendar dialog DISMISSES (the dialog is one-shot) → React effect re-mounts a new `<DateTimePicker>` because `showDateTimePicker===true && pickerMode==="time"` ([line 634-641](app-mobile/src/components/expandedCard/ActionButtons.tsx#L634-L641)) → time clock dialog appears.

**The user-visible effect:** they see the calendar dialog vanish and a time clock immediately replace it. There is no preview / confirmation step — the moment they press OK on the date dialog, they are committed to that date and the time picker takes over. No way to glance at "okay, that's the date I picked" or to step back and re-pick a different day.

**Confidence:** HIGH for the auto-flip mechanism itself. The user's wording "change the month" is consistent with two interpretations:
- (a) "After I OK'd a date in the new month, the time picker came up too fast" — matches the proven RC-2.
- (b) "Just spinning month dropdown auto-flipped" — would only match if the user is on a Samsung One UI variant where `display="default"` resolves to spinner instead of dialog. Possible on some Galaxy devices but not the documented behavior. Operator clarification welcome; either way the fix is the same.

### §2.2 Q-2: Escape paths from auto-flipped time mode

**There is no soft-escape.** Once `pickerMode === "time"`:

| Action | Effect |
|---|---|
| Tap Cancel ([iOS Modal line 603](app-mobile/src/components/expandedCard/ActionButtons.tsx#L603)) | `setShowDateTimePicker(false)` — closes entire picker. All progress lost. User must re-tap Schedule. |
| Press hardware back (Android) | `event.type === 'dismissed'` → `setShowDateTimePicker(false)` ([line 249](app-mobile/src/components/expandedCard/ActionButtons.tsx#L249)) — same; all progress lost. |
| Tap iOS Modal backdrop | `setShowDateTimePicker(false)` ([line 591](app-mobile/src/components/expandedCard/ActionButtons.tsx#L591)) — same; all progress lost. |
| Tap "Done" button (iOS time-mode) | `handleTimePickerConfirm` → finalizes, runs availability check, schedules. No back-step. |

**There is no "Back to date" button or pickerMode revert handler.** Once flipped to time, `setPickerMode("date")` is only called from:
- [`handleSchedule` line 242](app-mobile/src/components/expandedCard/ActionButtons.tsx#L242) — fires on tap of Schedule button itself
- [`closed-place re-prompt callback line 300/366`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L300) — fires on closed-place restart
- Nowhere else

Net effect: **once you've committed to a date (even unintentionally), to change the date you must Cancel out completely and restart.** This compounds RC-1/RC-2.

**Classification:** 🟠 **CF-1 (no soft-escape from time-mode)**.

### §2.3 Q-3: Chat + deck + saved tab parity

**Confirmed: identical code path on all three.** All three surfaces mount `<ExpandedCardModal>` which mounts `<ActionButtons>`. There are no surface-specific overrides on `onSave`/`onScheduleSuccess` that change the picker behavior — only the post-success callbacks differ ([SavedTab](app-mobile/src/components/activity/SavedTab.tsx#L2145), [DiscoverScreen](app-mobile/src/components/DiscoverScreen.tsx#L1352), [MessageInterface](app-mobile/src/components/MessageInterface.tsx#L1523)).

Confidence: HIGH.

### §2.4 Q-4: 4th+ mount surfaces (sweep)

**5 additional surfaces beyond user-reported scope** — fixing ActionButtons cascades to all 8:

| # | File:line | Surface |
|---|---|---|
| 1 | [`MessageInterface.tsx:1523`](app-mobile/src/components/MessageInterface.tsx#L1523) | Chat-shared card (user-reported) |
| 2 | [`DiscoverScreen.tsx:1352`](app-mobile/src/components/DiscoverScreen.tsx#L1352) | Discover deck (user-reported) |
| 3 | [`SavedTab.tsx:2145`](app-mobile/src/components/activity/SavedTab.tsx#L2145) | Saved tab (user-reported) |
| 4 | [`CalendarTab.tsx:1866`](app-mobile/src/components/activity/CalendarTab.tsx#L1866) | Calendar/scheduled view |
| 5 | [`ViewFriendProfileScreen.tsx:473`](app-mobile/src/components/profile/ViewFriendProfileScreen.tsx#L473) | Friend profile (paired) |
| 6 | [`SessionViewModal.tsx:848`](app-mobile/src/components/SessionViewModal.tsx#L848) | Collab session |
| 7 | [`SwipeableCards.tsx:1893`](app-mobile/src/components/SwipeableCards.tsx#L1893) | Solo deck inline mount |
| 8 | [`SwipeableCards.tsx:2413`](app-mobile/src/components/SwipeableCards.tsx#L2413) | Collab deck inline mount |

**Implication:** spec must explicitly enumerate cascade. Reseachable claim: any user who has scheduled an experience from any of these 8 paths in production has hit this UX. **A fix here is high-leverage.**

---

## §3 Classified findings

### 🔴 RC-1 — iOS spinner auto-flips date→time on every wheel tick (HIGH)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:312-316`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L312-L316) |
| **Exact code** | `if (pickerMode === "date") { setSelectedDate(date); setSelectedTime(date); setPickerMode("time"); }` |
| **What it does** | On every iOS spinner wheel `onChange` (which fires per tick on `display="spinner"`), unconditionally transitions `pickerMode` from `"date"` to `"time"` after touching the date wheel ONE notch. |
| **What it should do** | Update `selectedDate` only; leave `pickerMode === "date"` until the user explicitly presses the "Next" button at [line 611](app-mobile/src/components/expandedCard/ActionButtons.tsx#L611). The "Next" button already calls `handleDatePickerConfirm` ([line 376](app-mobile/src/components/expandedCard/ActionButtons.tsx#L376)) which is the correct transition. |
| **Causal chain** | (1) User taps Schedule → picker mounts with `mode="date"` showing today. (2) User spins month wheel from October → November. (3) `onChange` fires `event.type === 'set'`, `date` = November 27. (4) Handler enters `pickerMode === "date"` branch, calls `setSelectedDate(date)` AND `setPickerMode("time")`. (5) React re-renders: `<DateTimePicker mode="time" value={selectedTime} />` — wheel content swaps to time. (6) Header label flips from "Select Date" / "Next" to "Select Time" / "Done". (7) User cannot finish picking the day they wanted. |
| **Verification step** | Open any ExpandedCardModal → tap Schedule → spin month wheel one notch on iOS. Observe wheel content swap from month/day/year columns to hour/minute/AM-PM columns immediately. |

### 🔴 RC-2 — Android post-OK auto-flips date→time with no preview (HIGH)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:254-258`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L254-L258) |
| **Exact code** | `if (pickerMode === "date") { setSelectedDate(date); setSelectedTime(date); setPickerMode("time"); /* Keep picker visible for time selection */ }` |
| **What it does** | After the user presses OK on the Android Material date dialog (the only event that fires `onChange` for `display="default"` `mode="date"`), the handler immediately advances to time-mode. The user gets ZERO opportunity to review the selected date or to back out and pick a different day before being committed to time selection. |
| **What it should do** | After `event.type === 'set'`, the spec must decide between (a) keep current behavior (auto-advance) but provide a soft-back affordance from time-mode, OR (b) close the dialog and surface a confirmation row in the modal showing "Date: Friday Nov 7" with [Pick Time] and [Change Date] buttons. The user steering question belongs to the spec. |
| **Causal chain** | (1) User taps Schedule → calendar dialog opens, today highlighted. (2) User browses months freely (no event). (3) User taps Nov 7 → highlighted. (4) User presses OK. (5) `onChange` fires `'set'` with Nov 7. (6) Handler reaches `pickerMode === "date"` branch, calls `setPickerMode("time")`. (7) React effect: dialog vanishes (one-shot), then immediately re-mounts as time clock dialog. (8) User is committed to Nov 7 with no review step. |
| **Verification step** | Open ExpandedCardModal → tap Schedule → in calendar dialog tap any future day → tap OK. Observe time clock appear immediately with no intermediate confirmation. |

### 🟠 CF-1 — No soft-escape from time-mode back to date-mode (HIGH)

| Field | Value |
|---|---|
| **File:line** | Entire picker state machine — `setPickerMode("date")` callsites are at [`242`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L242), [`300`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L300), [`366`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L366); none from a "back" affordance |
| **What it does** | Once `pickerMode === "time"`, the only ways out are: Cancel (loses all progress), platform back (loses all progress), or Done (commits with potentially-wrong date). |
| **What it should do** | Either provide a "← Back to date" affordance in the iOS Modal header during time-mode, OR introduce a confirmation row that lets the user re-tap "Change Date" before time mode begins. |
| **Why CF not RC** | Doesn't itself cause the symptom — it's the design choice that makes RC-1 and RC-2 user-traps. Without a soft-escape, RC-1/RC-2 force a full restart on every misstep. |

### 🟠 CF-2 — iOS "Next" button is structurally redundant (HIGH)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:611`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L611) — Modal header `onPress={pickerMode === "date" ? handleDatePickerConfirm : handleTimePickerConfirm}` |
| **What it does** | The "Next" button calls `handleDatePickerConfirm` ([line 376](app-mobile/src/components/expandedCard/ActionButtons.tsx#L376)) which sets `pickerMode("time")`. **But by the time the user can tap it, RC-1 has already set `pickerMode("time")` from the FIRST wheel tick.** So the user never sees a "Next" label — the button always reads "Done" because `pickerMode === "time"` by then. |
| **Why CF** | The intent of the Next button is correct (explicit transition gate); it's just rendered useless by RC-1's eager flip. Once RC-1 is fixed, the Next button becomes the operational confirm gate it was designed to be. |
| **Verification step** | On iOS, open Schedule → observe header label is "Done" (not "Next") within the first wheel-tick. No way to see "Next" rendered. |

### 🟡 HF-1 — Cancel button discards all progress with no soft-cancel (MEDIUM)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:603`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L603) (iOS) + [`248-249`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L248-L249) (Android dismiss) |
| **What it does** | "Cancel" on iOS modal and back-press on Android both call `setShowDateTimePicker(false)` directly. No state preservation, no "discard scheduling?" confirm dialog. |
| **Severity guess** | S3 — UX speed-bump but no data loss; the user just re-taps Schedule. Bundling this fix is low-cost. |

### 🟡 HF-2 — Closed-place re-prompt resets to "now" not previous selection (MEDIUM)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:294-301`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L294-L301) (Android) + [`360-367`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L360-L367) (iOS) |
| **What it does** | When availability check fails (place closed), the "Choose Another Time" alert callback resets `selectedDate = new Date()` (current moment). The user just spent effort picking, say, Nov 7 5pm — they want to try Nov 7 7pm or Nov 8, NOT start over from today. |
| **What it should do** | Preserve `selectedDate`, only reset `selectedTime`, and re-open in time-mode (or provide both options). |
| **Severity guess** | S2 — actively friction in a real flow (user picks a day, place closed, has to re-navigate to that day). |

### 🟡 HF-3 — `handleTimePickerConfirm` and Android time-set branch duplicate availability + scheduling logic (MEDIUM)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:262-307`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L262-L307) (Android) ≈ [`328-374`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L328-L374) (iOS) |
| **What it does** | The same 40-line block (combine date+time, run `isPlaceOpenAt`, build `availability`, call `proceedWithScheduling` or alert) appears twice with platform-conditional wrapping. |
| **What it should do** | Extract to a single `confirmAndSchedule(combinedDateTime)` helper — one source of truth. Diverges quietly under future edits otherwise. |
| **Severity guess** | S3 — code smell, future-bug breeding ground. Extract during the same fix to lock in cohesion. |

### 🟡 HF-4 — `setIsScheduling` orphan-true paths on dismiss/error (MEDIUM)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:333`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L333) (handleTimePickerConfirm closes picker; `proceedWithScheduling` may or may not return), [`388-393`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L388-L393) (proceedWithScheduling sets `isScheduling=true`) |
| **What it does** | If `proceedWithScheduling` is called but the user dismisses the device-calendar permission prompt or any downstream Alert, `isScheduling` may not be reset to false in all paths. Need a `finally` block audit. |
| **Severity guess** | S2 — the Schedule button stays disabled until next remount, blocking re-attempts. |

### 🟡 HF-5 — `availability.isOpen: true, isAssumption: true` path runs `proceedWithScheduling` without telling the user the venue's hours are unknown (MEDIUM)

| Field | Value |
|---|---|
| **File:line** | [`ActionButtons.tsx:273-285`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L273-L285) (Android) + [`339-351`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L339-L351) (iOS) |
| **What it does** | When `extractWeekdayText` returns null/empty (no hours data on this place), the code defaults to `isOpen: true, isAssumption: true, reason: "Opening hours data not available"` and silently schedules. The `isAssumption` flag is set but never surfaced to the user. |
| **What it should do** | If `isAssumption=true`, surface a "We couldn't verify the venue's hours — proceed anyway?" confirmation dialog. |
| **Severity guess** | S2 — Constitution #9 spirit (no fabricated data); the user is not told that the open-status was assumed. |

### 🔵 OBS-1 — `display="default"` Android resolution depends on OS version

`display="default"` ([line 638](app-mobile/src/components/expandedCard/ActionButtons.tsx#L638)) resolves to **calendar dialog** on Android API ≥21 for `mode="date"`, but on some Samsung One UI / OEM-customized builds, the OEM theme may override to a different presentation. If the user's specific device shows spinner-style date selection inline, then onChange fires per spin (matching iOS behavior) — making RC-2 even more user-trap-like. Spec should consider explicitly setting `design="default"` or `display="spinner"` to normalize cross-OEM behavior.

### 🔵 OBS-2 — `proceedWithScheduling` may run device-calendar I/O which can take seconds

[`proceedWithScheduling`](app-mobile/src/components/expandedCard/ActionButtons.tsx#L381) calls `DeviceCalendarService` and `CalendarService` which may block. The ActivityIndicator spinner inside the Schedule button ([line 737-740 area, not shown in my reads but implied by `isScheduling` state]) is the only feedback. If `availability.isAssumption=true` we proceed too eagerly — see HF-5.

### 🔵 OBS-3 — handleSchedule does not check past-date

`handleSchedule` ([line 224-244](app-mobile/src/components/expandedCard/ActionButtons.tsx#L224-L244)) sets `now = new Date()` and `setSelectedDate(now)` — so the picker opens at "right now." `minimumDate={new Date()}` ([line 625, 640](app-mobile/src/components/expandedCard/ActionButtons.tsx#L625)) prevents selecting past on the picker UI, which is correct. However, the user can pick "today at 3pm" when current time is 5pm → `proceedWithScheduling` runs with a past datetime. `isNaN(scheduledDateTime.getTime())` ([line 390](app-mobile/src/components/expandedCard/ActionButtons.tsx#L390)) does NOT catch past-dates. Needs a separate check before proceeding.

---

## §4 Five-truth-layer reconciliation

| Layer | Finding |
|---|---|
| **Docs** | No product doc / spec mandates "browse-then-confirm" pattern. Convention is implied by the iOS Modal having "Next" / "Done" buttons that suggest two-step intent — but the code at line 316 contradicts the design intent. |
| **Schema** | N/A. |
| **Code** | Two state-machine bugs (RC-1 iOS, RC-2 Android), one design redundancy (CF-2), one missing affordance (CF-1). |
| **Runtime** | The `@react-native-community/datetimepicker@8.4.4` README confirms `onChange` fires per tick on `display="spinner"` (iOS uses spinner) and on OK/dismiss only on `display="default"` (Android uses default). Both behaviors are documented and stable across this minor version. |
| **Data** | N/A — picker state is local React state, not persisted. |

**No layer disagreements** beyond the design-intent vs code-reality mismatch already captured in CF-2.

---

## §5 Blast radius

- **8 ExpandedCardModal mount surfaces** affected (table in §2.4)
- **Solo and collab modes both affected** — SwipeableCards.tsx has separate solo (line 1893) and collab-likely (line 2413) inline mounts; ViewFriendProfileScreen + SessionViewModal cover paired/collab card UX
- **No admin dashboard impact** (admin doesn't expose Schedule)
- **No DB / no edge fn / no native module impact** — all changes are React mobile code
- **No cache impact** — picker state is purely local; no React Query keys touched

---

## §6 Invariant violations

| Constitution / Invariant | Status |
|---|---|
| **#1 No dead taps** | Borderline. The Schedule button responds (opens picker). The picker responds (shows wheels). The wheel taps register. But the user's *intent* of picking a date is hijacked by auto-flip — Constitution #1 spirit is the same class as ORCH-0685's "Save IS technically working but feedback channel is broken." Spirit-level violation. |
| **#3 No silent failures** | HF-5 violates the spirit — `isAssumption: true` is silently treated as `isOpen: true` with no user surfacing. |
| **#9 No fabricated data** | HF-5 again — assuming a place is open when hours are unknown is a fabrication shape. |
| **#12 Validate at the right time** | OBS-3 — past-date check is missing. |

No new invariants introduced; no existing CI gates apply.

---

## §7 Fix-shape sketches (no recommendation — for orchestrator user-steering)

### Shape A — "Two-tap commit per mode" (smallest LOC, most conservative)

**iOS:** delete `setPickerMode("time")` from line 316. Update only `selectedDate` on wheel tick. The "Next" button at line 611 (already wired to `handleDatePickerConfirm`) becomes the actual commit gate. Header label correctly shows "Next" until user taps it.

**Android:** insert a confirmation step between calendar-OK and time-clock open. Implementation options:
- (a) Add an in-app confirmation dialog "Date: Nov 7. Continue to time? [Change Date] [Pick Time]" before `setPickerMode("time")`
- (b) Replace `display="default"` with a custom inline picker that mirrors iOS Modal pattern
- (c) Keep current Android flow but add a "Back to date" affordance on the time clock (probably not possible with `display="default"` since the dialog is platform-managed)

Estimated LOC: iOS ~3 lines deleted, Android ~25 lines added. Lowest risk.

### Shape B — "Custom unified picker" (largest LOC, most consistent)

Replace both platforms' presentation with a single custom modal containing two stacked panels (date / time) with a "Next ▶" button to advance and "◀ Back" button to revert. Use `display="spinner"` on both platforms inside the custom shell.

Estimated LOC: ~150 lines, mostly UI plus styles. Highest UX consistency, biggest blast radius for regression testing.

### Shape C — "Single combined picker" (medium LOC, simplest UX)

Use `mode="datetime"` on both platforms — picker presents date AND time wheels together, no mode-flip needed. Drop `pickerMode` state entirely.

Caveat: per `@react-native-community/datetimepicker@8.4.4` docs, `mode="datetime"` is iOS-supported, Android falls back to date-then-time sequence. Would still need Android-specific shim.

Estimated LOC: ~60 lines net (state machine simplification offsets the Android shim). Best UX on iOS, partial on Android.

---

## §8 Regression prevention

For the class of bug being fixed:

1. **Structural safeguard:** the `<DateTimePicker>` component should be wrapped in a single helper that owns the mode-flip semantic — preventing future direct `setPickerMode` calls scattered across handlers.
2. **Test:** integration test that mounts the picker, fires a `mockOnChange` for `event.type === 'set'`, and asserts `pickerMode` REMAINS `"date"` (does not flip).
3. **Protective comment:** above the iOS branch in `handleDateTimePickerChange`, a 2-line comment "Per ORCH-0690: do NOT call setPickerMode here — only the Next button advances mode. Spinner emits per tick."

No new CI gates needed (this is a UX-state-machine bug, not a structural drift).

---

## §9 Discoveries for orchestrator

| ID | Discovery | Severity guess | Bundle? |
|---|---|---|---|
| **D-1** | OBS-3 — past-date scheduling possible (e.g., "today 3pm" when now is 5pm). `minimumDate={new Date()}` only restricts the picker UI, not the resulting `combinedDateTime` if user had picker open across the boundary. | S2 | Bundle into ORCH-0690 spec |
| **D-2** | HF-5 — `isAssumption=true` silently treated as `isOpen: true`. Constitution #9 spirit. Should surface to user. | S2 | Bundle into ORCH-0690 spec |
| **D-3** | HF-4 — `isScheduling` orphan-true on certain dismiss/error paths. Schedule button can lock until remount. | S2 | Bundle into ORCH-0690 spec (touches same handlers) |
| **D-4** | HF-3 — duplicate availability+scheduling logic across iOS and Android branches. Extract to shared helper during the fix or risk silent divergence. | S3 | Bundle into ORCH-0690 spec (cohesion-improving refactor; lock in while we're already in here) |

D-1 and D-2 are mild Constitution spirit violations adjacent to the date-picker; user steering may decide to bundle or defer.
D-3 is an ergonomic fix easily co-bundled.
D-4 is a refactor that's natural during this fix and locks in invariant cohesion.

**No NEW separate ORCH-IDs requested** — all 4 fit within ORCH-0690 spec scope.

---

## §10 Confidence summary

| Finding | Confidence | Basis |
|---|---|---|
| RC-1 (iOS auto-flip per tick) | HIGH | Source code is deterministic; library docs confirm spinner per-tick onChange semantics |
| RC-2 (Android post-OK auto-flip with no preview) | HIGH | Source code is deterministic on the post-OK behavior. The user's "change the month" wording resolves either to the post-OK path (HIGH match) or to an OEM-skinned spinner variant (MEDIUM match) — both lead to the same fix |
| CF-1 (no soft-escape) | HIGH | Grep-verified — `setPickerMode("date")` is not called from any back-button affordance |
| CF-2 (iOS Next redundant) | HIGH | Mathematical from RC-1 |
| HF-1 to HF-5 | MEDIUM-HIGH | Source-deterministic for HF-1, HF-3; HF-2 / HF-4 / HF-5 are flow-dependent — would benefit from a 5-min device test to PROVE |
| Blast-radius (8 surfaces) | HIGH | Grep-verified |

**Overall report confidence: HIGH** (per the failure-honesty labels: this is "root cause proven" for both RCs).

---

## §11 Recommended next move (for orchestrator)

1. Present 3 fix-shape options (Shape A / B / C above) to user for steering
2. Most likely default-yes lock-ins to confirm with user before spec dispatch:
   - **bundle D-1 (past-date check) and D-2 (isAssumption surfacing)** — both fire on the same code paths the spec will already touch (high cohesion, low marginal cost)
   - **bundle D-3 (isScheduling orphan-true) and D-4 (extract shared helper)** — same reasoning
   - **fix iOS AND Android in same spec** — both surfaces are user-facing; partial fix = unfair UX delta
3. After steering, write SPEC_ORCH-0690_SCHEDULE_DATE_PICKER.md
4. Estimated total effort: spec ~30 min + impl ~60-90 min (Shape A) / ~3 hrs (Shape B) / ~2 hrs (Shape C) + tester ~30 min

---

End of investigation.
