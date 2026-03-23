# Investigation Prompt: Pass 4a — Scheduling Fixes (4 fixes)

**Target skill:** Software and Code Architect (Investigator mode)
**Gate:** 1 (Audit)
**Pass:** 4a
**Bugs:** P4-01, P4-02, P4-03, P4-04

---

## 4 Bugs to Investigate

### P4-01: Schedule picker opens behind modal
**What we think:** On the Saved page, when scheduling and choosing "today", "this weekend", or "pick a date", the date/time picker opens BEHIND the schedule modal, making it invisible. Likely a z-index or modal stacking issue.
**Investigate:**
- Find the scheduling flow on the Saved page. What modal opens? What component renders the date/time picker?
- Is the DateTimePicker a native modal? A React Native modal? An overlay?
- On iOS, `DateTimePicker` is a native component — does it render inside or outside the React Native modal?
- What's the z-index / elevation of the schedule modal vs the picker?
- Is this iOS-only, Android-only, or both?
- What's the fix? Render picker AFTER closing the schedule modal? Use a different picker mode? Increase z-index?

### P4-02: No schedule confirmation (abrupt)
**What we think:** When scheduling from the swipeable deck expanded card, there's no confirmation that the experience is scheduled. It just schedules abruptly — no toast, no animation, no feedback.
**Investigate:**
- Trace the schedule action from ActionButtons → handler → what happens after success?
- Is there a toast? A state change? An animation? Or does the modal just close?
- What should happen? Toast "Scheduled for [date]"? Check mark animation? Both?
- Does the Saved page scheduling flow have better feedback? If so, what pattern does it use?

### P4-03: Can't use current date to schedule
**What we think:** When scheduling from expanded card modal, the current date shows "Cancel" instead of "Done". User must pick a DIFFERENT date first, then "Done" appears. Likely the DateTimePicker's `onChange` doesn't fire when the already-selected date is re-confirmed.
**Investigate:**
- Find the DateTimePicker in the scheduling flow. What mode is it in? (`date`, `time`, `datetime`?)
- What triggers "Done" vs "Cancel"? Is it the picker's `onChange` event?
- On iOS, the DateTimePicker in `mode="date"` has an inline Done/Cancel. Does `onChange` fire when you tap Done without changing the date?
- What's the fix? Set initial date to null and require selection? Or pre-confirm the current date?

### P4-04: Schedule handler race condition
**Reported location:** `ActionButtons.tsx:401-413`
**What we think:** Multiple setState calls in one handler. If `isScheduled` prop changes mid-execution, button shows "Scheduled" but picker still opens.
**Investigate:**
- Read lines 401-413. What's the flow? Multiple setState? Is `isScheduled` checked before opening picker?
- Can double-tap trigger it? What if the user taps Schedule while the save is in flight?
- What's the fix? Re-check `isScheduled` before showing picker? Use ref for latest value? Disable button during operation?

### P4-05: Time picker uses 24hr format instead of AM/PM
**What the user sees:** When scheduling an experience or picking a time in the preferences sheet, the time picker shows 24-hour format (e.g., 14:00) instead of 12-hour AM/PM format (e.g., 2:00 PM).
**Investigate:**
- Find ALL DateTimePicker instances that show time (`mode="time"` or `mode="datetime"`)
- Check: is there a `is24Hour` prop? What's it set to? On iOS, the picker respects device settings by default — is it being overridden?
- Check the preferences sheet time picker AND the scheduling time picker
- Fix: set `is24Hour={false}` explicitly on all time pickers, or use `display="spinner"` which shows AM/PM on iOS
- Note: Android respects `is24Hour` prop directly. iOS may depend on device settings or picker `display` mode.

---

## For Each Bug

1. Read the exact file and lines
2. Confirm the bug exists
3. Trace the full scheduling flow
4. Identify the exact fix
5. Note iOS vs Android differences

---

## Output Format

Write to `outputs/INVESTIGATION_PASS4A.md` with per-bug:
- CONFIRMED or NOT FOUND
- Exact current code
- Platform-specific behavior (iOS vs Android)
- Exact fix
- Edge cases
- Files/lines to change
