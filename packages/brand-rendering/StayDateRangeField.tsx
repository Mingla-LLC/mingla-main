/**
 * StayDateRangeField — WEB entry. Issue #1503 [stay-date-pickers], reworked for
 * #4523 [one-calendar]: the stay dates are picked from the one Mingla range
 * calendar (`./StayDateRangeRows`), the same control as iOS and Android. No
 * browser date box and no picker bridge remain.
 *
 * `StayDateRangeField.native.tsx` is the iOS/Android entry (Metro resolves it
 * on native); it renders the same rows and only adds the native-bundle marker.
 */
export {
  STAY_DATE_RANGE_CHECK_IN_TESTID,
  STAY_DATE_RANGE_CHECK_OUT_TESTID,
  StayDateRangeRows as StayDateRangeField,
  type RenderStayRangeCalendar,
  type StayCalendarTokens,
  type StayDateRangeFieldProps,
  type StayRangeCalendarArgs,
} from "./StayDateRangeRows";
