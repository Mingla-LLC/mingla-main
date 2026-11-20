/**
 * #4490 07-L — "Use {Venue}'s cover" for an event or experience at one of the
 * brand's venues. The edge copies the venue's cover onto the row
 * (event-cover-attest-selection copy_venue_cover); the result is handed to
 * `onApply` as an ordinary upload patch, the same writer the step's device
 * upload uses (the event draft's handleCoverChange, the experience wizard's
 * setCover). Renders nothing when the row is not at a venue with a cover.
 */
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { useEventVenueCover } from "../../hooks/useEventVenueCover";
import { copyVenueCoverToEvent, venueCoverPatch } from "../../services/eventCoverMediaService";
import { Button } from "./Button";

export type VenueCoverPatch = ReturnType<typeof venueCoverPatch>;

export interface VenueCoverButtonProps {
  /** The events-row id; a local "d_" id or null hides the button. */
  rowId: string | null;
  noun: "event" | "experience";
  disabled?: boolean;
  onApply: (patch: VenueCoverPatch) => void;
}

export function VenueCoverButton({ rowId, noun, disabled = false, onApply }: VenueCoverButtonProps): React.ReactElement | null {
  const usable = rowId !== null && !rowId.startsWith("d_") ? rowId : null;
  const venueCover = useEventVenueCover(usable, noun);
  const [state, setState] = useState<"idle" | "copying" | "applied" | "error">("idle");

  const apply = useCallback((): void => {
    if (venueCover === null || usable === null || state === "copying") return;
    setState("copying");
    void copyVenueCoverToEvent(usable, venueCover.venueId)
      .then((copied) => {
        onApply(venueCoverPatch(copied, venueCover.venueName));
        setState("applied");
      })
      .catch(() => setState("error"));
  }, [onApply, state, usable, venueCover]);

  if (venueCover === null) return null;
  return (
    <View style={styles.host}>
      <Button
        label={state === "copying" ? "Copying the cover…" : `Use ${venueCover.venueName}'s cover`}
        leadingIcon="home"
        variant="secondary"
        size="md"
        shape="square"
        disabled={disabled || state === "copying"}
        loading={state === "copying"}
        onPress={apply}
        accessibilityLabel={`Use ${venueCover.venueName}'s cover for this ${noun}`}
        testID="cover-step-use-venue-cover"
      />
      {state === "applied" ? (
        <Text style={styles.note} testID="cover-step-venue-cover-applied">
          Copied from {venueCover.venueName}
        </Text>
      ) : null}
      {state === "error" ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="cover-step-venue-cover-error">
          Couldn&apos;t use the venue&apos;s cover. Try again or upload one.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1], marginTop: space[2] },
  note: { ...type.small, color: color.text2 },
  error: { ...type.small, color: color.errorText },
});
