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
import { useOfferingAddOns } from "../../hooks/useOfferingAddOns";

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
  const extrasOn = isFeatureEnabled("extras");
  // issue #3281 G-9 — on a server with no add-on reader yet (web deploys before
  // its migrations) there are no add-ons to manage: hide the card rather than
  // leave a sheet that can only spin or fail. Same key the card's line and the
  // sheet read, so this is one request. A saved offering only; a draft reads
  // nothing from the server.
  const reader = useOfferingAddOns(
    extrasOn && draft === undefined && offeringId !== null ? offeringId : "",
  );
  if (!extrasOn || offeringId === null) return null;
  if (reader.error?.code === "add_ons_unavailable") return null;
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
        {draft === undefined ? (
          <SavedAddOnsLine eventId={offeringId} offering={offering} />
        ) : (
          <AddOnNamesLine
            names={draftAddOnsPayload(draft.event).addOns.map((addOn) => addOn.name)}
            offering={offering}
          />
        )}
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

/** The card's line before any add-on exists (and while the list loads). */
const PromoLine: React.FC<{ offering: AddOnOfferingKind }> = ({ offering }) => (
  <Text style={styles.sub}>
    Sell things like dinner, a tote or a transfer with your {offering === "rsvp" ? "RSVP" : offering === "trip" ? "packages" : offering === "experience" ? "options" : "tickets"}.
  </Text>
);

/**
 * issue #3281 S-22 — the collapsed card names the add-ons the offering
 * already has ("Airport transfer · Dinner"), from the same read the editor
 * uses (one key per offering), so the host sees them without opening it.
 */
const SavedAddOnsLine: React.FC<{ eventId: string; offering: AddOnOfferingKind }> = ({ eventId, offering }) => {
  const query = useOfferingAddOns(eventId);
  return (
    <AddOnNamesLine names={(query.data?.addOns ?? []).map((addOn) => addOn.name)} offering={offering} />
  );
};

/** The add-on names ("Coat check · Dinner"), or the promo line when there are none. */
const AddOnNamesLine: React.FC<{ names: readonly string[]; offering: AddOnOfferingKind }> = ({
  names,
  offering,
}) => {
  const shown = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (shown.length === 0) return <PromoLine offering={offering} />;
  return (
    <Text style={styles.sub} numberOfLines={2} testID="add-ons-entry-list">
      {shown.join(" · ")}
    </Text>
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
