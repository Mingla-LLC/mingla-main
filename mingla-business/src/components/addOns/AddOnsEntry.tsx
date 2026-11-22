/**
 * issue #3281 S3 — the Add-ons card every offering editor shows.
 *
 * Renders nothing while EXPO_PUBLIC_FF_EXTRAS_ENABLED is off (the default) or
 * before the offering has a saved row, so every editor looks and saves
 * exactly as before. The editor itself loads on the first tap and stays
 * mounted after it (one lazy owner for the feature; Host web boot stays flat).
 */

import React, { Suspense, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { isFeatureEnabled } from "../../config/featureFlags";
import type { AddOnOfferingKind } from "./addOnsEditorModel";

// The one lazy owner of the feature. Nothing here imports the Sheet (its
// module-scope reanimated import would load with every offering editor).
const LazyAddOnsEditorSheet = React.lazy(() => import("./AddOnsEditorSheet"));

const SAVED_OFFERING = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AddOnsEntryProps {
  /** The saved offering's id; anything else (a local draft id, null) hides the card. */
  eventId: string | null | undefined;
  offering: AddOnOfferingKind;
  currency?: string | null;
}

export const AddOnsEntry: React.FC<AddOnsEntryProps> = ({ eventId, offering, currency = null }) => {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  if (!isFeatureEnabled("extras") || typeof eventId !== "string" || !SAVED_OFFERING.test(eventId)) {
    return null;
  }
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          setOpened(true);
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Manage add-ons"
        style={styles.card}
        testID="add-ons-entry"
      >
        <Text style={styles.title}>Add-ons</Text>
        <Text style={styles.sub}>
          Sell things like dinner, a tote or a transfer with your {offering === "rsvp" ? "RSVP" : offering === "trip" ? "packages" : offering === "experience" ? "options" : "tickets"}.
        </Text>
      </Pressable>
      {opened ? (
        <Suspense
          fallback={
            <Text style={styles.sub} accessibilityLiveRegion="polite">
              Loading add-ons…
            </Text>
          }
        >
          <LazyAddOnsEditorSheet
            visible={open}
            onClose={() => setOpen(false)}
            eventId={eventId}
            offering={offering}
            currency={currency}
          />
        </Suspense>
      ) : null}
    </View>
  );
};

export default AddOnsEntry;

const styles = StyleSheet.create({
  wrap: { marginTop: space[4] },
  card: {
    minHeight: 64,
    padding: space[4],
    gap: space[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  title: { fontSize: type.body.fontSize, fontWeight: "600", color: color.text1 },
  sub: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.text3 },
});
