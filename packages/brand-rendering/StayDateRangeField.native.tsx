/**
 * StayDateRangeField — NATIVE entry (iOS + Android). Issue #1503, reworked for
 * #4523: the same Mingla range calendar rows as web (`./StayDateRangeRows`);
 * the OS date picker this file used to render is gone.
 *
 * SC-8 tripwire (#1503): this marker is attached at runtime on native only, and
 * the web export must not contain it, which proves Metro still resolves the
 * `.native.tsx` split. It is attached as `nativeID`, not merely exported, so
 * the minifier cannot drop it.
 */
import { View } from "react-native";

import {
  StayDateRangeRows,
  type StayDateRangeFieldProps,
} from "./StayDateRangeRows";
import {
  BrandRenderingReact as React,
  type BrandRenderingReactElement,
} from "./PublicVenueTabs";

export {
  STAY_DATE_RANGE_CHECK_IN_TESTID,
  STAY_DATE_RANGE_CHECK_OUT_TESTID,
  type RenderStayRangeCalendar,
  type StayCalendarTokens,
  type StayDateRangeFieldProps,
  type StayRangeCalendarArgs,
} from "./StayDateRangeRows";

export const STAY_DATE_RANGE_FIELD_NATIVE_MARKER =
  "stay-date-range-field-native-only-1503";

export function StayDateRangeField(props: StayDateRangeFieldProps): BrandRenderingReactElement {
  return (
    <View nativeID={STAY_DATE_RANGE_FIELD_NATIVE_MARKER}>
      <StayDateRangeRows {...props} />
    </View>
  );
}
