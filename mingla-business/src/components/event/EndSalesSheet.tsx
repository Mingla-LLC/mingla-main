/**
 * EndSalesSheet — confirm Sheet for ending ticket sales on a live event.
 *
 * Per Cycle 9 spec §3.B.2 J-E9.
 *
 * Tapping Confirm runs an 800ms simulated processing delay (matches Q-9-3
 * timing convention) then calls `onConfirm`. Parent calls
 * `liveEventStore.updateLifecycle(id, {endedAt: now})` — setting endedAt
 * triggers EventListCard's `deriveStatus` to return "past" (no new
 * status field needed; D-INV-CYCLE9-9).
 *
 * Buyers can no longer purchase after sales end. Existing tickets remain
 * valid. Door scanning still works (Cycle 11).
 *
 * Per Cycle 9 spec §3.B.2 + §3.B.3 9b-AC#1, 9b-AC#2.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
} from "../../constants/designSystem";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

const PROCESSING_MS = 800;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface EndSalesSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Caller fires lifecycle mutation + Toast after this resolves. */
  onConfirm: () => void | Promise<void>;
  eventName: string;
}

export const EndSalesSheet: React.FC<EndSalesSheetProps> = ({
  visible,
  onClose,
  onConfirm,
  eventName,
}) => {
  const [submitting, setSubmitting] = useState<boolean>(false);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    await sleep(PROCESSING_MS);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }, [submitting, onConfirm]);

  const handleCancel = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Sheet visible={visible} onClose={handleCancel} snapPoint="half">
      <View style={styles.body}>
        <Text style={styles.title}>End ticket sales?</Text>
        <Text style={styles.copy}>
          Buyers can no longer purchase tickets to {eventName}. Existing
          tickets remain valid — door scanning still works.
        </Text>
        <View style={styles.actions}>
          <Button
            label="End sales"
            onPress={handleConfirm}
            variant="destructive"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitting}
            accessibilityLabel="End ticket sales"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Keep selling"
            onPress={handleCancel}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Keep selling"
          />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    // #4420: the Sheet owns the 20 side padding.
    paddingTop: space[4],
    paddingBottom: space[7],
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: color.text1,
    marginBottom: space[2],
  },
  copy: {
    fontSize: 14,
    color: color.text2,
    lineHeight: 20,
    marginBottom: space[6],
  },
  actions: {
    marginTop: space[2],
  },
  actionSpacer: {
    height: space[2],
  },
});

export default EndSalesSheet;
