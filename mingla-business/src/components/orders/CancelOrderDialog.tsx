/**
 * CancelOrderDialog — J-M5 Cancel order with required reason input.
 *
 * Composes Modal + custom layout (rather than ConfirmDialog v1 which
 * doesn't support a reason input prop). Mirrors ConfirmDialog visual
 * contract: title + description + REQUIRED reason input + Cancel/Confirm
 * buttons.
 *
 * Used ONLY for free orders (paymentMethod === "free") per Q-9c-5. Paid
 * orders use RefundSheet instead.
 *
 * On Confirm: 1.2s simulated processing → useOrderStore.cancelOrder
 * → fires destructive notification → toast on parent.
 *
 * Per Cycle 9c spec §3.4.4.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
// ORCH-0787: replaced useOrderStore.cancelOrder (Zustand stub) with the real
// cancel-order edge function via useCancelOrder mutation. Event-edit-log + parent
// notification rollup side effects are removed in v1 (owned by ORCH-0782).
import { useCancelOrder } from "../../hooks/useEventOrders";
import { randomId } from "../../utils/randomId";

import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const REASON_MIN = 10;
const REASON_MAX = 200;

export interface CancelOrderDialogProps {
  visible: boolean;
  orderId: string;
  /** ORCH-0787: required for React Query cache invalidation on success. */
  eventId: string;
  buyerName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const CancelOrderDialog: React.FC<CancelOrderDialogProps> = ({
  visible,
  orderId,
  eventId,
  buyerName,
  onClose,
  onSuccess,
}) => {
  // ORCH-0787: server-truth mutation. Replaces the stub useOrderStore.cancelOrder.
  const cancelMutation = useCancelOrder(eventId);
  const [reason, setReason] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>("");

  // Reset state on visible flip → true (defensive)
  useEffect(() => {
    if (visible) {
      setReason("");
      setErrorMessage(null);
      idempotencyKeyRef.current = randomId();
    }
  }, [visible]);

  const submitting = cancelMutation.isPending;

  const trimmedLen = reason.trim().length;
  const reasonValid =
    trimmedLen >= REASON_MIN && trimmedLen <= REASON_MAX;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (submitting || !reasonValid) return;
    setErrorMessage(null);
    try {
      await cancelMutation.mutateAsync({
        orderId,
        reason: reason.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
    }
  }, [submitting, reasonValid, cancelMutation, orderId, reason, onSuccess]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Modal visible={visible} onClose={handleClose}>
      <View style={styles.body}>
        <Text style={styles.title}>Cancel this order?</Text>
        <Text style={styles.description}>
          {buyerName.trim().length > 0 ? buyerName : "The buyer"}'s ticket
          will be marked invalid. They'll be notified by email and SMS.
        </Text>

        {/* Required reason input */}
        <View style={styles.reasonSection}>
          <Text style={styles.reasonLabel}>
            Why are you cancelling? <Text style={styles.required}>*</Text>
          </Text>
          <View
            style={[
              styles.reasonInputWrap,
              trimmedLen > 0 && !reasonValid && styles.reasonInputError,
            ]}
          >
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Buyer no longer attending; admin cleanup"
              placeholderTextColor={textTokens.quaternary}
              multiline
              numberOfLines={3}
              maxLength={REASON_MAX}
              style={styles.reasonInput}
              editable={!submitting}
              accessibilityLabel="Cancellation reason"
            />
          </View>
          <View style={styles.reasonMetaRow}>
            <Text
              style={[
                styles.reasonHelper,
                trimmedLen >= REASON_MIN && styles.reasonHelperOk,
              ]}
            >
              {trimmedLen < REASON_MIN
                ? `Min ${REASON_MIN} characters`
                : "Looks good"}
            </Text>
            <Text style={styles.reasonCount}>
              {trimmedLen} / {REASON_MAX}
            </Text>
          </View>
        </View>

        {errorMessage !== null ? (
          <Text style={styles.errorCaption} accessibilityRole="text">
            {errorMessage}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <View style={styles.actionFlex}>
            <Button
              label="Keep order"
              onPress={handleClose}
              variant="secondary"
              size="md"
              fullWidth
              disabled={submitting}
            />
          </View>
          <View style={styles.actionFlex}>
            <Button
              label="Cancel order"
              onPress={handleConfirm}
              variant="destructive"
              size="md"
              fullWidth
              loading={submitting}
              disabled={submitting || !reasonValid}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  description: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  reasonSection: {
    gap: spacing.xs,
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  required: {
    color: accent.warm,
  },
  reasonInputWrap: {
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 80,
  },
  reasonInputError: {
    borderColor: semantic.error,
  },
  reasonInput: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    minHeight: 60,
    textAlignVertical: "top",
    ...(Platform.OS === "web"
      ? ({ outlineWidth: 0 } as Record<string, number>)
      : null),
  },
  reasonMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  reasonHelper: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  reasonHelperOk: {
    color: textTokens.secondary,
  },
  reasonCount: {
    fontSize: 11,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionFlex: {
    flex: 1,
  },
  errorCaption: {
    fontSize: 13,
    color: semantic.error,
    textAlign: "center",
    lineHeight: 18,
    marginTop: spacing.xs,
  },
});

export default CancelOrderDialog;
