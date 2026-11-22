/**
 * issue #3281 S3 — the Add-ons card every offering editor shows.
 *
 * Renders nothing while EXPO_PUBLIC_FF_EXTRAS_ENABLED is off (the default) or
 * before the offering has a saved row, so every editor looks and saves
 * exactly as before. The editor itself loads on the first tap and stays
 * mounted after it (one lazy owner for the feature; Host web boot stays flat).
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { isFeatureEnabled } from "../../config/featureFlags";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { AddOnsEditorSheetProps } from "./AddOnsEditorSheet";
import type { AddOnOfferingKind } from "./addOnsEditorModel";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { draftAddOnsFromSave, draftAddOnsPayload } from "./draftAddOnsSource";

// The editor's chunk loads on the first tap; a failed load (offline) shows
// the house retry instead of breaking the offering editor. Nothing here
// imports the Sheet (its module-scope reanimated import would load with
// every offering editor).
const LazyAddOnsEditorSheet = createRetryableLazyErrorBoundary<AddOnsEditorSheetProps>(
  () => import("./AddOnsEditorSheet"),
  { loadingLabel: "Loading add-ons…" },
);

const SAVED_OFFERING = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AddOnsEntryProps {
  /** The saved offering's id; anything else (a local draft id, null) hides the card. */
  eventId: string | null | undefined;
  offering: AddOnOfferingKind;
  currency?: string | null;
  /**
   * issue #3281 S3 (§6.4) — an event draft: the editor reads and writes the
   * add-ons on the draft's tickets (saved with the draft, mapped at publish).
   */
  draft?: {
    event: Pick<DraftEvent, "id" | "tickets" | "currency" | "whenMode" | "multiDates" | "timezone">;
    onChange: (tickets: TicketStub[]) => void;
  };
}

export const AddOnsEntry: React.FC<AddOnsEntryProps> = ({ eventId, offering, currency = null, draft }) => {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const offeringId =
    draft !== undefined
      ? draft.event.id
      : typeof eventId === "string" && SAVED_OFFERING.test(eventId)
        ? eventId
        : null;
  if (!isFeatureEnabled("extras") || offeringId === null) return null;
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
        <LazyAddOnsEditorSheet
          visible={open}
          onClose={() => setOpen(false)}
          eventId={offeringId}
          offering={offering}
          currency={currency}
          draftSource={
            draft !== undefined
              ? {
                  payload: draftAddOnsPayload(draft.event),
                  onSave: (items) => draft.onChange(draftAddOnsFromSave(items, draft.event)),
                }
              : undefined
          }
        />
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
