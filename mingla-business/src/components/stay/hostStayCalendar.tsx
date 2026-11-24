/**
 * #4523 — the Host app's stay dates calendar for `@mingla/brand-rendering`
 * StayGuestBooking (buyer web stay page, staff reservation sheet). The calendar
 * body loads on first open through the shared Host calendar chunk
 * (`HostCalendarBody`), with a spinner meanwhile, never a blank gap. Imported
 * only by the lazily loaded stay booking (`StayGuestBooking.lazy`).
 */
import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { StayRangeCalendarArgs } from "@mingla/brand-rendering/StayDateRangeRows";

const StayRangeEmbedBody = React.lazy(() =>
  import("../ui/HostCalendarBody").then((m) => ({ default: m.StayRangeEmbedBody })),
);

export function renderHostStayCalendar(args: StayRangeCalendarArgs): React.ReactElement {
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel="Loading calendar" color={args.tokens.textMuted} />
        </View>
      }
    >
      <StayRangeEmbedBody {...args} />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loading: { minHeight: 120, alignItems: "center", justifyContent: "center" },
});
