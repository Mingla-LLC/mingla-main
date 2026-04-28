# SPEC — ORCH-0690 Schedule date-picker auto-advance fix

**Spec writer:** mingla-forensics (SPEC mode)
**Date:** 2026-04-27
**ORCH-ID:** ORCH-0690
**Severity:** S2
**Investigation:** [reports/INVESTIGATION_ORCH-0690_SCHEDULE_DATE_PICKER_AUTO_ADVANCE.md](../reports/INVESTIGATION_ORCH-0690_SCHEDULE_DATE_PICKER_AUTO_ADVANCE.md) — REVIEW APPROVED 10/10
**Dispatch:** [prompts/SPEC_ORCH-0690_SCHEDULE_DATE_PICKER.md](../prompts/SPEC_ORCH-0690_SCHEDULE_DATE_PICKER.md)
**Steering accepted:** Shape A + bundle all 4 D's + both-platform parity

---

## §1 Layman summary

The Schedule date-picker auto-commits the user's first wheel touch on iOS and immediately
advances to time-mode after Android calendar OK with no preview. Once committed, there is
no "back to date" affordance — Cancel loses all progress. This spec deletes the iOS
auto-flip, inserts an Android preview/confirm step, adds a "Back to date" button on iOS
time-mode, and bundles 4 cohesive flaws (past-date validation, isAssumption surfacing,
isScheduling orphan-true audit, extract shared confirmAndSchedule helper) that touch the
same handlers. Both platforms ship in one IMPL cycle. ~30 LOC of behavior change plus
~50 LOC of helper extraction and ~9 new i18n keys.

---

## §2 Hard locks from user steering (do NOT deviate)

| Decision | Locked value | Source |
|---|---|---|
| Fix shape | **Shape A — surgical** (~30 LOC behavior change + ~50 LOC refactor) | AskUserQuestion 2026-04-27 |
| D-1 past-date validation | **Bundled** | AskUserQuestion 2026-04-27 |
| D-2 isAssumption surfacing | **Bundled** | AskUserQuestion 2026-04-27 |
| D-3 isScheduling orphan-true audit | **Bundled** | AskUserQuestion 2026-04-27 |
| D-4 extract shared confirmAndSchedule | **Bundled** | AskUserQuestion 2026-04-27 |
| Platform parity | **iOS + Android in same IMPL cycle** | AskUserQuestion 2026-04-27 |
| Library replacement | **NO** — keep `@react-native-community/datetimepicker@8.4.4` | Dispatch §D non-goal #1 |
| Display modes | **iOS `display="spinner"` + Android `display="default"` preserved** | Dispatch §D non-goal #2 |
| Custom unified Modal | **NO** (Shape B rejected) | Dispatch §D non-goal #3 |
| `mode="datetime"` combined picker | **NO** (Shape C rejected) | Dispatch §D non-goal #4 |

Implementor authority: cannot deviate from these locks. If a contradiction is found
during implementation, STOP and escalate to orchestrator.

---

## §3 Scope — what this spec covers

| ID | Item | Investigation reference |
|---|---|---|
| **S-1** | Delete iOS auto-flip on spinner tick | RC-1 ([ActionButtons.tsx:312-316](app-mobile/src/components/expandedCard/ActionButtons.tsx#L312-L316)) |
| **S-2** | Insert Android preview/confirm prompt between calendar-OK and time-clock-open | RC-2 ([ActionButtons.tsx:254-258](app-mobile/src/components/expandedCard/ActionButtons.tsx#L254-L258)) |
| **S-3** | Add "← Back to date" affordance in iOS time-mode header | CF-1 (no soft-escape) |
| **S-4** | Add past-date validation in `proceedWithScheduling` | D-1 / OBS-3 |
| **S-5** | Surface isAssumption=true to user via confirmation prompt | D-2 / HF-5 (Constitution #9 spirit) |
| **S-6** | Wrap `proceedWithScheduling` in `try { } finally { setIsScheduling(false); }` | D-3 / HF-4 |
| **S-7** | Extract shared `confirmAndSchedule(combinedDateTime: Date)` helper | D-4 / HF-3 |
| **S-8** | Closed-place re-prompt preserves `selectedDate`, only resets `selectedTime`, re-opens in time-mode | HF-2 |

---

## §4 Non-goals (explicit)

| Non-goal | Reason |
|---|---|
| Replace the picker library | Steering lock; no library churn risk |
| Change `display="spinner"` (iOS) / `display="default"` (Android) | Steering lock; preserves platform-native UX |
| Custom unified Modal across both platforms | Shape B rejected by user steering |
| `mode="datetime"` combined picker | Shape C rejected by user steering |
| Touch any of the 8 ExpandedCardModal mount sites | Fix in shared `ActionButtons.tsx` cascades; per-site changes risk parallel-ORCH conflicts |
| Touch Save / Share / Visit / opening-hours display | Unrelated to picker state machine |
| Add new i18n locales | Reuse existing locale set; only add ~9 new keys to existing files |
| Introduce React Query / Zustand / new hooks | Picker state stays local; no server-state implication |
| New CI gate | This is a UX-state-machine bug, not a structural drift class |
| Native module changes / `app.json` changes | OTA-eligible build required; native changes break that |

---

## §5 Per-layer specification

### §5.1 Component layer ([ActionButtons.tsx](app-mobile/src/components/expandedCard/ActionButtons.tsx))

Sole modified file. No service / hook / DB / edge fn / RLS / native module changes.

#### §5.1.1 State (final shape)

| Variable | Existing? | Type | Purpose |
|---|---|---|---|
| `isSaving` | yes | `boolean` | unchanged |
| `isScheduling` | yes | `boolean` | unchanged; reset audit (S-6) |
| `showDateTimePicker` | yes | `boolean` | unchanged |
| `selectedDate` | yes | `Date` | unchanged; preserved across HF-2 closed-place re-prompts (S-8) |
| `selectedTime` | yes | `Date` | unchanged |
| `pickerMode` | yes | `"date" \| "time"` | unchanged; advancement gated on user action only (S-1, S-2) |
| `selectedDateTime` | yes | `Date \| null` | unchanged |
| `availabilityCheck` | yes | `{isOpen, isAssumption, reason} \| null` | unchanged |
| `hasCheckedAvailability` | yes | `boolean` | unchanged |
| `pendingDateConfirmation` | **NEW** | `Date \| null` | Holds the Android-OK'd date while the confirmation `Alert` is open. Cleared after [Pick Time] / [Change Date] / dismiss. |

No other state additions. No useReducer, no context — keep local React state.

#### §5.1.2 Handlers (final shape — exact contracts)

##### Existing — unchanged signature, behavior change

**`handleSchedule(): void`** — line ~224, no change to this handler.

**`handleDatePickerConfirm(): void`** — line ~376, no change. Still calls `setPickerMode("time")`. This is now the SOLE iOS path that flips date→time (per S-1).

##### Existing — behavior change

**`handleDateTimePickerChange(event: any, date?: Date): void`**

Final shape:

```ts
const handleDateTimePickerChange = (event: any, date?: Date) => {
  if (Platform.OS === "android") {
    if (event.type === "dismissed") {
      setShowDateTimePicker(false);
      setPendingDateConfirmation(null); // S-2 cleanup
      return;
    }

    if (date) {
      if (pickerMode === "date") {
        // S-2: Android calendar dialog OK'd. Stage the date and surface confirmation.
        setShowDateTimePicker(false);
        setPendingDateConfirmation(date);
        showAndroidDateConfirmation(date);
      } else {
        // Time selected on Android.
        const combinedDateTime = new Date(selectedDate);
        combinedDateTime.setHours(date.getHours());
        combinedDateTime.setMinutes(date.getMinutes());
        setSelectedTime(combinedDateTime);
        setSelectedDateTime(combinedDateTime);
        setShowDateTimePicker(false);
        confirmAndSchedule(combinedDateTime); // S-7
      }
    }
  } else {
    // iOS flow
    if (date) {
      if (pickerMode === "date") {
        // S-1: Spinner tick. Update selectedDate ONLY. Do NOT call setPickerMode here.
        // Mode advances only when user taps the "Next" button (handleDatePickerConfirm).
        // Per ORCH-0690 RC-1: spinner emits onChange per tick; eager mode-flip
        // hijacks user intent before they reach the Next button.
        setSelectedDate(date);
        setSelectedTime(date);
      } else {
        // Time mode: spinner tick updates selectedTime; final commit is via Done button.
        const combinedDateTime = new Date(selectedDate);
        combinedDateTime.setHours(date.getHours());
        combinedDateTime.setMinutes(date.getMinutes());
        setSelectedTime(combinedDateTime);
      }
    }
  }
};
```

##### Existing — call-site change only

**`handleTimePickerConfirm(): void`** — line ~328

Final shape: combine date+time then **delegate to new shared helper**. Body shrinks from ~46 lines to ~6 lines.

```ts
const handleTimePickerConfirm = () => {
  const combinedDateTime = new Date(selectedDate);
  combinedDateTime.setHours(selectedTime.getHours());
  combinedDateTime.setMinutes(selectedTime.getMinutes());
  setSelectedDateTime(combinedDateTime);
  setShowDateTimePicker(false);
  confirmAndSchedule(combinedDateTime); // S-7
};
```

##### NEW — shared helper

**`confirmAndSchedule(combinedDateTime: Date): void`** — replaces duplicate logic at iOS lines 337-374 and Android lines 269-307.

Final shape:

```ts
const confirmAndSchedule = (combinedDateTime: Date) => {
  // S-4: past-date check before any availability work
  if (combinedDateTime.getTime() < Date.now()) {
    Alert.alert(
      t('expanded_details:action_buttons.error_past_date_title'),
      t('expanded_details:action_buttons.error_past_date_message'),
    );
    return;
  }

  // Compute availability (existing canonical isPlaceOpenAt logic)
  const weekdayText = extractWeekdayText(card?.openingHours ?? null);
  const openAt = isPlaceOpenAt(weekdayText, combinedDateTime);
  const availability =
    openAt === null
      ? { isOpen: true, isAssumption: true, reason: "Opening hours data not available" }
      : { isOpen: openAt, isAssumption: false };
  setAvailabilityCheck(availability);
  setHasCheckedAvailability(true);

  // S-5: isAssumption surfacing — never silently auto-schedule on unknown hours
  if (availability.isOpen && availability.isAssumption) {
    Alert.alert(
      t('expanded_details:action_buttons.unverified_hours_title'),
      t('expanded_details:action_buttons.unverified_hours_message', { venueName: card.title }),
      [
        {
          text: t('expanded_details:action_buttons.schedule_anyway'),
          onPress: () => proceedWithScheduling(combinedDateTime),
        },
        {
          text: t('common:cancel'),
          style: 'cancel',
          onPress: () => {
            setAvailabilityCheck(null);
            setHasCheckedAvailability(false);
            setSelectedDateTime(null);
          },
        },
      ],
    );
    return;
  }

  if (availability.isOpen) {
    proceedWithScheduling(combinedDateTime);
  } else {
    // Place closed — preserve selectedDate, only reset selectedTime (S-8 / HF-2)
    Alert.alert(
      t('expanded_details:action_buttons.place_closed_title'),
      t('expanded_details:action_buttons.place_closed_message'),
      [
        {
          text: t('expanded_details:action_buttons.choose_another_time'),
          onPress: () => {
            setAvailabilityCheck(null);
            setHasCheckedAvailability(false);
            setSelectedDateTime(null);
            // S-8: keep selectedDate; only reset selectedTime to now
            setSelectedTime(new Date());
            setPickerMode("time");
            setShowDateTimePicker(true);
          },
        },
        { text: t('common:cancel'), style: 'cancel' },
      ],
    );
  }
};
```

##### NEW — iOS "← Back to date" handler

**`handleBackToDate(): void`** — fired from new iOS Modal header button when `pickerMode === "time"`.

```ts
const handleBackToDate = () => {
  setPickerMode("date");
  // selectedDate intentionally preserved; user wants to revise without losing progress
};
```

##### NEW — Android confirmation prompt opener

**`showAndroidDateConfirmation(date: Date): void`** — fired from `handleDateTimePickerChange` Android branch after OK.

```ts
const showAndroidDateConfirmation = (date: Date) => {
  const formattedDate = date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  Alert.alert(
    t('expanded_details:action_buttons.confirm_date_title'),
    t('expanded_details:action_buttons.confirm_date_message', { date: formattedDate }),
    [
      {
        text: t('expanded_details:action_buttons.change_date'),
        onPress: () => {
          // Re-open calendar dialog. Keep pickerMode="date", clear pending.
          setPendingDateConfirmation(null);
          setSelectedDate(date); // preserve so calendar opens at the just-picked date
          setShowDateTimePicker(true);
        },
      },
      {
        text: t('expanded_details:action_buttons.pick_time'),
        onPress: () => {
          // Commit the date and advance to time mode
          setSelectedDate(date);
          setSelectedTime(date);
          setPickerMode("time");
          setPendingDateConfirmation(null);
          setShowDateTimePicker(true);
        },
      },
    ],
    {
      cancelable: true,
      onDismiss: () => setPendingDateConfirmation(null),
    },
  );
};
```

##### Existing — wrapped for S-6

**`proceedWithScheduling(scheduledDateTime: Date, skipStopCheck = false): Promise<void>`** — line ~381

S-6 contract: every exit path of this function MUST call `setIsScheduling(false)`. The implementor MUST wrap the entire body in `try { ... } finally { setIsScheduling(false); }`. Existing inline `setIsScheduling(false)` calls inside the body become redundant and MAY be removed (cleaner), but if any are kept they don't break correctness — `finally` runs regardless.

The past-date check from S-4 is in `confirmAndSchedule`, NOT here, so this function trusts its caller. **Defense in depth recommended:** keep the existing `isNaN(scheduledDateTime.getTime())` guard at line 390. No additional past-date check needed here.

#### §5.1.3 JSX (final shape)

| Render condition | Rendered output |
|---|---|
| `showDateTimePicker && Platform.OS === "ios" && pickerMode === "date"` | iOS `<Modal>` (existing) — header: title "Select Date" + Cancel + **Next** |
| `showDateTimePicker && Platform.OS === "ios" && pickerMode === "time"` | iOS `<Modal>` (existing) — header: title "Select Time" + Cancel + **← Back** + Done |
| `showDateTimePicker && Platform.OS === "android"` | Native `<DateTimePicker display="default">` (existing — calendar dialog or time clock) |
| Android post-OK confirmation | `Alert.alert` from `showAndroidDateConfirmation` (one-shot, not persistent JSX) |
| isAssumption confirmation | `Alert.alert` from `confirmAndSchedule` (one-shot) |
| Past-date error | `Alert.alert` from `confirmAndSchedule` (one-shot) |
| Closed-place re-prompt | `Alert.alert` from `confirmAndSchedule` (one-shot) |

##### iOS Modal header (final shape, line ~594-617 area)

```tsx
<View style={styles.modalHeader}>
  <Text style={styles.modalTitle}>
    {pickerMode === "date"
      ? t('expanded_details:action_buttons.select_date')
      : t('expanded_details:action_buttons.select_time')}
  </Text>
  <View style={styles.modalHeaderButtons}>
    <TrackedTouchableOpacity
      logComponent="ActionButtons"
      logId="picker_cancel"
      style={styles.modalCancelButton}
      onPress={() => setShowDateTimePicker(false)}
    >
      <Text style={styles.modalCancelText}>{t('expanded_details:action_buttons.cancel')}</Text>
    </TrackedTouchableOpacity>

    {/* NEW S-3: Back-to-date button — only visible in time mode */}
    {pickerMode === "time" && (
      <TrackedTouchableOpacity
        logComponent="ActionButtons"
        logId="picker_back_to_date"
        style={styles.modalCancelButton}
        onPress={handleBackToDate}
      >
        <Text style={styles.modalCancelText}>
          {t('expanded_details:action_buttons.back_to_date')}
        </Text>
      </TrackedTouchableOpacity>
    )}

    <TrackedTouchableOpacity
      logComponent="ActionButtons"
      logId="picker_done"
      style={styles.modalConfirmButton}
      onPress={pickerMode === "date" ? handleDatePickerConfirm : handleTimePickerConfirm}
    >
      <Text style={styles.modalConfirmText}>
        {pickerMode === "date"
          ? t('expanded_details:action_buttons.next')
          : t('expanded_details:action_buttons.done')}
      </Text>
    </TrackedTouchableOpacity>
  </View>
</View>
```

The existing `<DateTimePicker>` element at line ~619 is unchanged. The existing Android branch JSX at line ~634-641 is unchanged. The Android `Alert.alert` calls live inside handlers (no JSX change there).

#### §5.1.4 Protective comment (regression prevention)

Insert above the iOS branch in `handleDateTimePickerChange`, between the `} else {` at ~line 310 and the `// iOS flow` comment at ~line 311:

```ts
// [ORCH-0690 RC-1] Do NOT call setPickerMode("time") in this branch.
// iOS uses display="spinner" which emits onChange per wheel tick. Auto-flipping
// to time-mode here means one wheel notch commits the date and hijacks user
// intent before they can reach the Next button. Mode advancement is owned
// EXCLUSIVELY by handleDatePickerConfirm (Next button at line ~611).
```

This is the lock-in for regression prevention §10.1.

#### §5.1.5 Style additions

No new styles required for S-3. Reuse existing `modalCancelButton` and `modalCancelText` styles for the Back-to-date button (left-side button with Cancel-style text).

If the implementor finds the three-button row crowded on smaller screens (Cancel + Back + Done), spec authority granted to add `gap: 8` to `modalHeaderButtons` style — no other style changes.

### §5.2 Service / hook / DB / edge fn / RLS / native module layers

**ALL N/A.** Mobile-only fix. OTA-eligible build (no `expo-cli` rebuild required).

### §5.3 i18n layer

#### §5.3.1 New keys (add to `expanded_details.json` namespace)

| Key | English copy |
|---|---|
| `action_buttons.confirm_date_title` | `"Date selected"` |
| `action_buttons.confirm_date_message` | `"You picked {{date}}. Continue to time selection?"` |
| `action_buttons.change_date` | `"Change date"` |
| `action_buttons.pick_time` | `"Pick time"` |
| `action_buttons.back_to_date` | `"Back to date"` |
| `action_buttons.unverified_hours_title` | `"Hours unavailable"` |
| `action_buttons.unverified_hours_message` | `"We couldn't verify {{venueName}}'s hours for that time. Schedule anyway?"` |
| `action_buttons.schedule_anyway` | `"Schedule anyway"` |
| `action_buttons.error_past_date_title` | `"Pick a future time"` |
| `action_buttons.error_past_date_message` | `"That time has already passed. Please choose a time in the future."` |

10 new keys total. (One more than dispatch §E sketched — added separate title/message for the past-date alert per Mingla copy convention "title states the action, message gives context.")

##### Existing keys reused (no change)

| Key | Note |
|---|---|
| `expanded_details:action_buttons.select_date` | unchanged |
| `expanded_details:action_buttons.select_time` | unchanged |
| `expanded_details:action_buttons.cancel` | unchanged |
| `expanded_details:action_buttons.next` | unchanged (already present per line 614) |
| `expanded_details:action_buttons.done` | unchanged |
| `expanded_details:action_buttons.choose_another_time` | unchanged (string already in code at line 292) |
| `common:cancel` | unchanged |

> **Note for implementor:** existing closed-place alert text at lines 287-288 is hardcoded English (`"Place Closed"`, `"This place is closed at the selected date and time. Please choose a different time."`). Spec scope adds two new i18n keys — `place_closed_title` and `place_closed_message` — and replaces those hardcoded strings as part of S-7 helper extraction. (See §6 implementation step 8.) Adds 2 keys to the new-keys count → **12 new keys total** in `en/expanded_details.json`.

Final updated key count for English: **12 new keys**.

#### §5.3.2 Locale parity decision (FLAGGED for orchestrator)

**Decision required:** the spec writer cannot resolve this — it's an operational policy choice.

| Option | Trade-off |
|---|---|
| **A. English-only with TODO marker** in 28 other locales | Ships fastest; non-English users see English copy until translation pass; consistent with cycle-1 ORCH-0685's pre-fix state |
| **B. Auto-translate via existing tool/script** at IMPL time | Higher quality from day-1; consistent with ORCH-0685 cycle-1 final state (29 × 12 keys filled); ~10 min added to IMPL effort |
| **C. Translate only top-N locales** (en + es + fr + de + ja + ko + zh + ar + hi + pt) | Compromise; 9 fewer locales translated than B |

**Spec writer recommendation:** **Option B** — match ORCH-0685 cycle-1 precedent (full locale parity is the established Mingla bar). Cost is small (~10 min) and the existing locale infrastructure handles it well. But this is a binary that orchestrator must lock before IMPL dispatch.

**Spec writer authority:** spec is approved with EITHER A or B; cannot ship Option C as it creates a fragmented locale matrix.

---

## §6 Success criteria (numbered, testable, observable)

| # | Criterion | Layer | Verification |
|---|---|---|---|
| **SC-1** | iOS spinner wheel ticks update `selectedDate` only — `pickerMode` remains `"date"` until user taps "Next" | Component | Unit test mocks `onChange` with `event.type === 'set'` per tick; asserts `pickerMode === "date"` after N ticks |
| **SC-2** | iOS Modal header label reads "Next" (not "Done") on first picker open and remains "Next" through any number of date-wheel ticks | Component (visual) | Visual: open Schedule on iOS, observe header right-button label = "Next" |
| **SC-3** | iOS "Next" button advances to time-mode and updates header to "Done" | Component (visual) | Tap Next → wheels swap to time, header label flips to "Done" |
| **SC-4** | iOS time-mode shows "← Back to date" button between Cancel and Done | Component (visual) | Visual: from time mode, observe 3 buttons: Cancel, Back, Done |
| **SC-5** | iOS Back-to-date returns to date-mode with `selectedDate` preserved | Component | Manual: pick Nov 7, advance to time, tap Back, observe date wheel at Nov 7 |
| **SC-6** | Android calendar OK shows preview/confirm `Alert` with formatted date and [Change Date] / [Pick Time] buttons | Component (visual) | Manual: open Schedule Android, pick Nov 7, OK, observe `Alert` titled "Date selected" with body "You picked Friday, November 7. Continue to time selection?" |
| **SC-7** | Android [Pick Time] advances to time picker with `selectedDate` preserved | Component | Manual: from SC-6, tap [Pick Time], observe time-clock with selectedDate=Nov 7 |
| **SC-8** | Android [Change Date] re-opens calendar dialog at the just-picked date | Component | Manual: from SC-6, tap [Change Date], observe calendar dialog reopens (dismissing the alert) |
| **SC-9** | Past-date scheduling rejected with `Alert` "Pick a future time" | Component | Manual: pick today's date with a time in the past (workaround: edit device clock or pick today + earlier hour), observe alert; picker stays open OR re-opens in time-mode |
| **SC-10** | Unverified-hours flow surfaces `Alert` confirmation; user can decline | Component | Manual: schedule against a place with `openingHours = null`, observe "Hours unavailable" alert with [Schedule anyway] / [Cancel]; tap Cancel → no schedule; tap Schedule anyway → scheduled |
| **SC-11** | `isScheduling` resets to false on every error / dismiss / cancel path inside `proceedWithScheduling` | Component | Code review: `proceedWithScheduling` body wrapped in `try { } finally { setIsScheduling(false); }`; OR every exit path explicitly calls reset |
| **SC-12** | Duplicate availability+scheduling logic eliminated — only ONE call site for `isPlaceOpenAt + availability + proceed-or-alert` | Component | grep: only `confirmAndSchedule` references `isPlaceOpenAt`; `handleDateTimePickerChange` time-set branches and `handleTimePickerConfirm` body delegate to helper |
| **SC-13** | Closed-place re-prompt preserves `selectedDate`, resets `selectedTime` to now, opens picker in `pickerMode="time"` | Component | Manual: pick a date+time at a closed venue, "Choose Another Time" alert appears, tap it → picker reopens in **time mode** with `selectedDate` intact |
| **SC-14** | All 8 ExpandedCardModal mount surfaces inherit fix without per-surface modifications | Cross-surface | grep: only `ActionButtons.tsx` modified in this commit (alongside locale json + spec/report). No per-mount-site override |
| **SC-15** | Protective comment present above iOS branch in `handleDateTimePickerChange` referencing ORCH-0690 RC-1 | Code review | grep `\[ORCH-0690 RC-1\]` in ActionButtons.tsx returns the comment |
| **SC-16** | tsc clean — no new type errors | Build | `cd app-mobile && npx tsc --noEmit` shows ≤ baseline 3 pre-existing errors (ConnectionsPage:2763, HomePage:246, HomePage:249); zero new |
| **SC-17** | All 12 new i18n keys present in en + populated across all 28 other locales (per Option B) OR TODO-marked (per Option A) | i18n | grep keys across `app-mobile/src/i18n/locales/*/expanded_details.json` |

---

## §7 Test cases

| ID | Scenario | Input | Expected behavior | Maps to SC |
|---|---|---|---|---|
| T-01 | iOS spinner one notch | Open Schedule iOS, spin month wheel one notch | `pickerMode="date"` still; `selectedDate` updated; header label="Next" | SC-1, SC-2 |
| T-02 | iOS multi-tick browse | Spin month wheel 5 notches forward, day wheel 3 notches | `pickerMode="date"` still throughout; `selectedDate` updated to final values | SC-1 |
| T-03 | iOS "Next" advance | T-02 then tap Next | `pickerMode="time"`; time wheels visible; header label="Done"; Back button visible | SC-3, SC-4 |
| T-04 | iOS "← Back" revert | T-03 then tap Back | `pickerMode="date"`; date wheels visible with selection from T-02; header label="Next" | SC-5 |
| T-05 | iOS multi-flip | T-03 → T-04 → T-03 → T-04 (3+ flips) | Each flip preserves `selectedDate` and `selectedTime`; no state corruption | SC-1, SC-3, SC-5 |
| T-06 | iOS Cancel from date-mode | T-01 then tap Cancel | Picker closed; no scheduling; `isScheduling=false` | SC-11 |
| T-07 | iOS Cancel from time-mode | T-03 then tap Cancel | Picker closed; no scheduling; `isScheduling=false` | SC-11 |
| T-08 | iOS Done with valid future datetime | T-03 advance to time, pick a future time, tap Done | `confirmAndSchedule` runs; place open → `proceedWithScheduling` runs; calendar entry created | SC-3, SC-12 |
| T-09 | iOS Done with past time | T-03 pick a time in the past on today's date, tap Done | "Pick a future time" alert; picker may stay open or re-open | SC-9 |
| T-10 | Android pick date + OK | Open Schedule Android, pick Nov 7, OK | `Alert` titled "Date selected", body shows "You picked Friday, November 7." | SC-6 |
| T-11 | Android prompt → Pick Time | T-10 then tap [Pick Time] | Time-clock dialog opens; `selectedDate=Nov 7` preserved | SC-7 |
| T-12 | Android prompt → Change Date | T-10 then tap [Change Date] | `Alert` dismisses; calendar dialog re-opens at Nov 7 | SC-8 |
| T-13 | Android prompt onDismiss (back press) | T-10 then hardware back | `Alert` dismisses; `pendingDateConfirmation` cleared; picker NOT re-opened | SC-6 cleanup |
| T-14 | Android Cancel from date dialog | Open Schedule Android, system back | Picker closed; `isScheduling=false`; `pendingDateConfirmation=null` | SC-11 |
| T-15 | Android Cancel from time dialog | T-11 then system back | Picker closed; `isScheduling=false` | SC-11 |
| T-16 | Closed-place re-prompt | Pick date+time at a closed venue (e.g., Sunday 3am) | "Place closed" alert; tap "Choose Another Time"; picker reopens in **time mode** with `selectedDate` preserved (Sunday) | SC-13 |
| T-17 | Unverified hours — accept | Schedule at place with `openingHours=null` | "Hours unavailable" alert appears; tap [Schedule anyway] → scheduled | SC-10 |
| T-18 | Unverified hours — decline | Same as T-17, tap [Cancel] | No schedule; `availabilityCheck` cleared; user back to expanded card view | SC-10 |
| T-19 | proceedWithScheduling internal error → isScheduling reset | Force a throw inside `proceedWithScheduling` (e.g., simulated CalendarService failure) | `isScheduling=false` after the throw; Schedule button re-tappable | SC-11 |
| T-20 | All 8 mount surfaces — same fixed UX | Manual smoke test: open Schedule from CalendarTab + SavedTab + DiscoverScreen + MessageInterface + ViewFriendProfileScreen + SessionViewModal + SwipeableCards solo + SwipeableCards collab | All 8 exhibit identical fixed picker behavior | SC-14 |
| T-21 | tsc baseline verification | `cd app-mobile && npx tsc --noEmit` | 3 baseline errors (ConnectionsPage:2763 + HomePage:246 + HomePage:249); zero new | SC-16 |
| T-22 | grep protective comment | `grep "ORCH-0690 RC-1" ActionButtons.tsx` | Returns the comment block | SC-15 |
| T-23 | grep duplicate logic eliminated | `grep -c "isPlaceOpenAt(weekdayText" ActionButtons.tsx` | Returns `1` (only inside `confirmAndSchedule`) | SC-12 |
| T-24 | i18n key parity | Run locale-parity script for the 12 new keys across 29 locales | All present (Option B) OR all TODO-marked (Option A) | SC-17 |

---

## §8 Implementation order (numbered — implementor must follow)

| # | Step | Files touched |
|---|---|---|
| **1** | Read [ActionButtons.tsx](app-mobile/src/components/expandedCard/ActionButtons.tsx) full (1157 lines) | (read only) |
| **2** | Add `pendingDateConfirmation` state declaration after `availabilityCheck` (around line 93) | ActionButtons.tsx |
| **3** | Extract new private helper `confirmAndSchedule(combinedDateTime: Date): void` per §5.1.2 — placement: between `handleDateTimePickerChange` and `handleTimePickerConfirm` (~line 327) | ActionButtons.tsx |
| **4** | Replace `handleTimePickerConfirm` body to delegate to `confirmAndSchedule` (per §5.1.2) | ActionButtons.tsx |
| **5** | Replace Android time-set branch in `handleDateTimePickerChange` (lines ~260-307) to delegate to `confirmAndSchedule` (per §5.1.2) | ActionButtons.tsx |
| **6** | Add new `handleBackToDate` and `showAndroidDateConfirmation` helpers per §5.1.2 | ActionButtons.tsx |
| **7** | Modify Android branch of `handleDateTimePickerChange` (date-set path, line 254-258): replace `setPickerMode("time")` with `showAndroidDateConfirmation(date)` invocation; close picker + stage `pendingDateConfirmation` | ActionButtons.tsx |
| **8** | Modify iOS branch of `handleDateTimePickerChange` (date-set path, line 312-316): delete `setPickerMode("time")` line; add protective comment per §5.1.4 | ActionButtons.tsx |
| **9** | Wrap `proceedWithScheduling` body in `try { ... } finally { setIsScheduling(false); }` per S-6 | ActionButtons.tsx |
| **10** | Add past-date check at top of `confirmAndSchedule` per §5.1.2 (S-4) | ActionButtons.tsx |
| **11** | Add isAssumption confirmation `Alert` inside `confirmAndSchedule` per §5.1.2 (S-5) | ActionButtons.tsx |
| **12** | Add iOS "← Back to date" button to Modal header (line ~611 area) per §5.1.3 | ActionButtons.tsx |
| **13** | Replace HF-2 closed-place re-prompt callback to preserve `selectedDate` and re-open in time mode per §5.1.2 (S-8) | ActionButtons.tsx |
| **14** | Add 12 new i18n keys to `app-mobile/src/i18n/locales/en/expanded_details.json` with English copy from §5.3.1 | en/expanded_details.json |
| **15** | Resolve i18n locale parity per orchestrator decision (Option A: TODO-mark across 28 other locales / Option B: full translation pass / Option C: rejected) | 28 other locale files |
| **16** | Replace hardcoded `"Place Closed"` / `"This place is closed..."` strings (currently at lines 287-288, 354-355) with new `place_closed_title` / `place_closed_message` keys | ActionButtons.tsx + locale json |
| **17** | Run `cd app-mobile && npx tsc --noEmit` — confirm 3 baseline errors only (ConnectionsPage:2763, HomePage:246, HomePage:249), zero new | (verify) |
| **18** | Manually exercise T-01 through T-20 on a Metro dev build (operator can drive) | (manual smoke) |
| **19** | Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0690_SCHEDULE_DATE_PICKER_REPORT.md` with old → new receipts, SC verification matrix, transition register (if any), discoveries for orchestrator | (report) |

---

## §9 Invariants

### §9.1 Existing invariants — preserved

| Constitution / ORCH | Status post-fix |
|---|---|
| **#1 No dead taps** | RESTORED — picker taps respect user intent; auto-flip eliminated |
| **#3 No silent failures** | RESTORED — D-2 surfaces isAssumption to user; closed-place + past-date errors surfaced |
| **#7 Label temporary fixes** | N/A — no `[TRANSITIONAL]` markers introduced |
| **#8 Subtract before adding** | UPHELD — duplicate logic deleted (D-4); auto-flip line deleted (RC-1); helper extracted before handlers consume it |
| **#9 No fabricated data** | RESTORED — D-2 ends silent "isOpen=true when hours unknown" fabrication |
| **#12 Validate at the right time** | RESTORED — D-1 past-date check fires before scheduling, not too early or too late |
| **I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS** (ORCH-0685 cycle-1) | unchanged — no chat / payload changes |
| **I-LOCALE-CATEGORY-PARITY** (ORCH-0685 cycle-1) | UPHELD — new locale keys subject to existing parity contract (Option B) or explicitly TODO-marked (Option A) |
| **I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS** (ORCH-0685 cycle-1) | unchanged — no modal subcomponent changes |

### §9.2 New invariants — none

This spec adds NO new invariants. The state-machine bug class is too narrow to merit a CI gate; the protective comment + unit test serve as adequate regression prevention.

---

## §10 Regression prevention

### §10.1 Structural safeguard

`confirmAndSchedule` becomes the **sole call site** for `isPlaceOpenAt` + availability check + scheduling. Future edits that try to re-introduce per-platform divergence would have to touch the helper itself, which is tested. This locks in D-4 cohesion permanently.

### §10.2 Test

SC-1 unit test (`pickerMode` stays `"date"` after iOS spinner tick) is the regression sentinel. If a future edit silently re-adds `setPickerMode("time")` inside the iOS spinner branch, this test fails.

### §10.3 Protective comment

Above the iOS branch in `handleDateTimePickerChange` (per §5.1.4) — the 5-line block referencing ORCH-0690 RC-1 explicitly forbids future drive-by edits from re-introducing the auto-flip. This is the documentation lock-in.

### §10.4 No new CI gate

A CI gate would require an unambiguous structural pattern — but state-machine semantics are too tightly coupled to handler flow. Manual review + unit test + protective comment cover the regression class.

---

## §11 Constitution compliance summary

| # | Principle | Pre-fix status | Post-fix status |
|---|---|---|---|
| 1 | No dead taps | Spirit-violated (intent-hijacking on picker) | Restored |
| 2 | One owner per truth | OK | OK |
| 3 | No silent failures | Spirit-violated (HF-5 isAssumption, OBS-3 past-date) | Restored |
| 4 | One query key per entity | N/A | N/A |
| 5 | Server state stays server-side | OK | OK |
| 6 | Logout clears everything | OK | OK |
| 7 | Label temporary fixes | OK | OK |
| 8 | Subtract before adding | OK | UPHELD (delete-before-add for RC-1, D-4) |
| 9 | No fabricated data | Spirit-violated (HF-5 silent isOpen=true) | Restored |
| 10 | Currency-aware UI | N/A | N/A |
| 11 | One auth instance | OK | OK |
| 12 | Validate at the right time | Spirit-violated (OBS-3 past-date possible) | Restored |
| 13 | Exclusion consistency | N/A | N/A |
| 14 | Persisted-state startup | N/A | N/A |

---

## §12 Open questions for orchestrator (BLOCKING IMPL DISPATCH)

| # | Question | Recommended | Why |
|---|---|---|---|
| **OQ-1** | i18n locale parity: Option A (English-only TODO) or Option B (full 29-locale translation) | **Option B** | Matches ORCH-0685 cycle-1 precedent (full parity is the established Mingla bar); cost ~10 min IMPL effort |
| **OQ-2** | Past-date alert UX: should the picker stay open in time-mode after user dismisses the alert (so they can re-pick), OR close entirely? | **Stay open in time mode** | Lower friction; user just picks a different time on the same day |

OQ-2 is a small UX detail — orchestrator can default-yes "stay open" if no other steering needed.

OQ-1 is the only true blocker; orchestrator should resolve it (default-yes Option B per recommendation) before IMPL dispatch.

---

## §13 Estimated effort breakdown

| Phase | Estimate |
|---|---|
| IMPL — code (steps 2-13 above, ~30 LOC behavior + ~50 LOC refactor) | 60-80 min |
| IMPL — i18n (step 14-16: 12 keys × 1 locale [Option A] OR × 29 locales [Option B]) | 5 min (A) / 15 min (B) |
| IMPL — verification (step 17 tsc + step 18 manual smoke 8 surfaces) | 15-20 min |
| IMPL — report writing (step 19) | 15-20 min |
| **IMPL total** | **95-135 min wall** |
| Tester | 30-45 min (T-01 to T-24) |
| 2 EAS Updates (iOS + Android separate invocations per memory rule) | 10 min |
| **End-to-end (IMPL → Tester PASS → OTA shipped)** | **~3h** |

---

## §14 Files modified (final inventory)

| Path | Change | LOC delta |
|---|---|---|
| `app-mobile/src/components/expandedCard/ActionButtons.tsx` | Modified — handler refactor + JSX header button + new helpers + protective comment | +80 / -50 |
| `app-mobile/src/i18n/locales/en/expanded_details.json` | Modified — 12 new keys | +12 lines |
| `app-mobile/src/i18n/locales/{28 other}/expanded_details.json` | Modified — 12 new keys (Option B) OR 12 TODO-marked (Option A) | +12 × 28 = 336 lines |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0690_SCHEDULE_DATE_PICKER_REPORT.md` | NEW | ~250 lines |

**No other files touched.** No service / hook / DB / migration / RLS / edge fn / native module changes. OTA-eligible.

---

## §15 Output to orchestrator (post-spec-review handoff)

When orchestrator reviews this spec and approves:

1. Resolve OQ-1 (Option A or B for locale parity) — write into IMPL dispatch as hard lock
2. Resolve OQ-2 (past-date alert UX after dismiss) — write into IMPL dispatch
3. Write IMPL dispatch prompt to `Mingla_Artifacts/prompts/IMPL_ORCH-0690_SCHEDULE_DATE_PICKER.md`
4. Hand to operator for `/mingla-implementor` dispatch

---

End of spec.
