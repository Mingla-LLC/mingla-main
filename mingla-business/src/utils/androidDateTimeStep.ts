/**
 * #2664 [editing a sale window crashes on Android] — Android date+time stepping.
 *
 * `@react-native-community/datetimepicker` registers exactly two Android
 * pickers (`src/picker.android.js`):
 *
 *     const pickers = {
 *       [ANDROID_MODE.date]: DatePickerAndroid,
 *       [ANDROID_MODE.time]: TimePickerAndroid,
 *     };
 *
 * There is no `datetime` key. `constants.js` still declares
 * `datetime: 'datetime'` in the shared mode union, so `mode="datetime"`
 * type-checks and builds clean — it simply has no Android implementation. The
 * failure is deferred to unmount, where `datetimepicker.android.js:46` runs
 * `() => DateTimePickerAndroid.dismiss(mode, design)` and `dismiss` does
 * `pickers[mode].dismiss()` on `pickers['datetime'] === undefined`. The picker
 * opens, looks fine, and throws `TypeError: Cannot read property 'dismiss' of
 * undefined` when it closes (Sentry MINGLA-BUSINESS-18, SM-A725F / Android 14).
 *
 * Both Android registries are affected — `materialPickers` in `androidUtils.js`
 * carries the same two keys — so this is not avoidable via `design`.
 *
 * Android therefore has to SEQUENCE the two real modes: present `date`, then
 * present `time`, then combine. This module owns the combine so the two call
 * sites (TicketTierEditSheet's sale window, BookingDeadlinePicker's booking
 * deadline) cannot drift apart.
 */

/**
 * Which half of the Android date-then-time sequence is currently presented.
 * `null` means no Android picker is up.
 */
export type AndroidDateTimeStep = "date" | "time";

/**
 * Combine the calendar date the operator picked in step 1 with the clock time
 * they picked in step 2.
 *
 * CROSS-SURFACE PARITY. The construction is deliberately
 * `new Date(y, m, d, h, min, 0, 0)` — local wall-clock components, seconds and
 * milliseconds zeroed. That is byte-identical to what the web surface already
 * builds from its `datetime-local` input (TicketTierEditSheet's hidden
 * `<input>` handler), and it matches iOS to the minute, which is the finest
 * granularity any of the three pickers exposes. Carrying seconds through from
 * whichever seed `value` happened to be passed would make the same user
 * selection produce a different instant on Android than on web.
 *
 * Only the Y/M/D of `datePart` and the H/M of `timePart` are read; every other
 * component of both inputs is discarded.
 */
export function combineAndroidDateAndTime(datePart: Date, timePart: Date): Date {
  return new Date(
    datePart.getFullYear(),
    datePart.getMonth(),
    datePart.getDate(),
    timePart.getHours(),
    timePart.getMinutes(),
    0,
    0,
  );
}

/**
 * The `value` to seed the step-2 time picker with: the date the operator just
 * chose, still carrying the clock time of the value they started from, so the
 * time wheel opens on the existing time rather than jumping to midnight.
 */
export function seedAndroidTimeStep(datePart: Date, originalValue: Date): Date {
  return combineAndroidDateAndTime(datePart, originalValue);
}
