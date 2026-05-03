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
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

const PROCESSING_MS = 800;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface EndSalesSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Caller fires liveEventStore.updateLifecycle + Toast after this resolves. */
  onConfirm: () => void;
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
    setSubmitting(false);
    onConfirm();
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  copy: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  actions: {
    marginTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
});

export default EndSalesSheet;
