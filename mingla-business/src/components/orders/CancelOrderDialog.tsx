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

import React, { useCallback, useEffect, useState } from "react";
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
import { useOrderStore } from "../../store/orderStore";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { useEventEditLogStore } from "../../store/eventEditLogStore";
import { useLiveEventStore } from "../../store/liveEventStore";
import {
  deriveChannelFlags,
  notifyEventChanged,
} from "../../services/eventChangeNotifier";

import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const REASON_MIN = 10;
const REASON_MAX = 200;
const PROCESSING_MS = 1200;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface CancelOrderDialogProps {
  visible: boolean;
  orderId: string;
  buyerName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const CancelOrderDialog: React.FC<CancelOrderDialogProps> = ({
  visible,
  orderId,
  buyerName,
  onClose,
  onSuccess,
}) => {
  const cancelOrder = useOrderStore((s) => s.cancelOrder);
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset state on visible flip → true (defensive)
  useEffect(() => {
    if (visible) {
      setReason("");
      setSubmitting(false);
    }
  }, [visible]);

  const trimmedLen = reason.trim().length;
  const reasonValid =
    trimmedLen >= REASON_MIN && trimmedLen <= REASON_MAX;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (submitting || !reasonValid) return;
    setSubmitting(true);
    await sleep(PROCESSING_MS);
    const trimmedReason = reason.trim();
    const result = cancelOrder(orderId, trimmedReason);

    // Cycle 9c rework v2 — fire side effects from the caller (was inside
    // the store; moved out to break require cycle).
    if (result !== null) {
      const event = useLiveEventStore
        .getState()
        .getLiveEvent(result.eventId);
      if (event !== null) {
        // Cycle 17e-A: brand list moved to React Query. Outside-component
        // context uses current brand selection — falls back to empty.
        const currentBrand = useCurrentBrandStore.getState().currentBrand;
        const brandName =
          currentBrand !== null && currentBrand.id === result.brandId
            ? currentBrand.displayName
            : "";
        const cancelledAt = result.cancelledAt ?? new Date().toISOString();
        useEventEditLogStore.getState().recordEdit({
          eventId: result.eventId,
          brandId: result.brandId,
          reason: trimmedReason,
          severity: "destructive",
          changedFieldKeys: ["__cancel__"],
          diffSummary: ["Order cancelled"],
          affectedOrderIds: [result.id],
          orderId: result.id,
        });
        void notifyEventChanged(
          {
            eventId: result.eventId,
            eventName: event.name,
            brandName,
            brandSlug: event.brandSlug,
            eventSlug: event.eventSlug,
            reason: trimmedReason,
            diffSummary: ["Order cancelled"],
            severity: "destructive",
            affectedOrderIds: [result.id],
            occurredAt: cancelledAt,
          },
          deriveChannelFlags("destructive", false),
        );
      }
    }

    setSubmitting(false);
    if (result !== null) {
      onSuccess();
    }
  }, [submitting, reasonValid, cancelOrder, orderId, reason, onSuccess]);

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
});

export default CancelOrderDialog;
