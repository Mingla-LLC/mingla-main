/**
 * Lazy settings steps — issue #3827 going-box (bundle budget).
 *
 * CreatorStep6Settings (ticketed) and RsvpStep5Setup (RSVP) are each imported by
 * two lazy route chunks: their create wizard and EditPublishedScreen. A module
 * shared by two lazy chunks is hoisted by Metro into the eager `__common` chunk
 * that every buyer downloads before anything renders, so ~20 KB of host-only
 * settings UI (and its "Guests on your own list" field) sat on the boot path.
 * Every importer loads them through THIS file instead, so each step is one
 * async chunk fetched only when a host opens that step. Same treatment as
 * EventTicketCheckoutAccessCard and SeeWhosGoingGate.
 *
 * Keep every importer on these wrappers: one static import anywhere hoists the
 * module back into `__common`.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { spacing, text as textTokens } from "../../constants/designSystem";
import type { StepBodyProps } from "./types";

const LazyCreatorStep6Settings = React.lazy(() =>
  import("./CreatorStep6Settings").then((m) => ({ default: m.CreatorStep6Settings })),
);

const LazyRsvpStep5Setup = React.lazy(() =>
  import("../rsvp/RsvpStep5Setup").then((m) => ({ default: m.RsvpStep5Setup })),
);

type RsvpStep5SetupProps = React.ComponentProps<
  typeof import("../rsvp/RsvpStep5Setup").RsvpStep5Setup
>;

const StepLoading: React.FC<{ testID: string }> = ({ testID }) => (
  <View
    style={styles.loading}
    accessibilityRole="progressbar"
    accessibilityLabel="Loading settings"
    testID={testID}
  >
    <ActivityIndicator color={textTokens.secondary} />
  </View>
);

export const CreatorStep6SettingsLazy: React.FC<
  StepBodyProps & { publishedEventId?: string }
> = (props) => (
  <React.Suspense fallback={<StepLoading testID="settings-step-loading" />}>
    <LazyCreatorStep6Settings {...props} />
  </React.Suspense>
);

export const RsvpStep5SetupLazy: React.FC<RsvpStep5SetupProps> = (props) => (
  <React.Suspense fallback={<StepLoading testID="rsvp-setup-step-loading" />}>
    <LazyRsvpStep5Setup {...props} />
  </React.Suspense>
);

const styles = StyleSheet.create({
  loading: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
});
