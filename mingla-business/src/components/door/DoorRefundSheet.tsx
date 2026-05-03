/**
 * DoorRefundSheet — J-D4 partial/full refund of an in-person door sale.
 *
 * Mirrors Cycle 9c RefundSheet pattern (per-line stepper + reason input
 * 10..200 chars + 1.2s simulated processing → useDoorSalesStore.recordRefund).
 *
 * **OBS-1 hard lock — NEVER call useScanStore here.**
 * Refund affects MONEY only, NOT check-in. The buyer was physically at
 * the door (auto-check-in fired at sale time per Cycle 12 Decision #5).
 * Refund creates a NEW DoorRefundRecord without undoing the original
 * scan — financial event ≠ attendance event. This mirrors I-19 spirit
 * (immutable order financials). Edge case "operator wants to undo BOTH
 * money + check-in" is deferred to a future cycle (D-CYCLE12-5; see
 * SPEC §3.2 OBS-1).
 *
 * Per Cycle 12 SPEC §4.11 / §5/J-D4.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
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
import {
  useDoorSalesStore,
  type DoorSaleRecord,
} from "../../store/doorSalesStore";
import { formatGbp } from "../../utils/currency";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

const REASON_MIN = 10;
const REASON_MAX = 200;
const REFUND_PROCESSING_MS = 1200;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface DoorRefundSheetProps {
  visible: boolean;
  sale: DoorSaleRecord;
  onClose: () => void;
  onSuccess: (updatedSale: DoorSaleRecord) => void;
}

interface PerLineRefundState {
  ticketTypeId: string;
  selectedQty: number;
}

export const DoorRefundSheet: React.FC<DoorRefundSheetProps> = ({
  visible,
  sale,
  onClose,
  onSuccess,
}) => {
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [perLineRefund, setPerLineRefund] = useState<PerLineRefundState[]>([]);

  // Reset on visible flip → true
  useEffect(() => {
    if (visible) {
      setReason("");
      setSubmitting(false);
      setPerLineRefund(
        sale.lines.map((l) => ({
          ticketTypeId: l.ticketTypeId,
          selectedQty: 0,
        })),
      );
    }
  }, [visible, sale.lines]);

  // Lines that still have refundable quantity remaining
  const refundableLines = useMemo(
    () =>
      sale.lines.filter((l) => l.quantity - l.refundedQuantity > 0),
    [sale.lines],
  );

  // Computed refund total
  const refundTotalGbp = useMemo<number>(() => {
    let sum = 0;
    for (const p of perLineRefund) {
      const line = sale.lines.find((l) => l.ticketTypeId === p.ticketTypeId);
      if (line === undefined) continue;
      sum += p.selectedQty * line.unitPriceGbpAtSale;
    }
    return sum;
  }, [perLineRefund, sale.lines]);

  const trimmedLen = reason.trim().length;
  const reasonValid =
    trimmedLen >= REASON_MIN && trimmedLen <= REASON_MAX;
  const hasRefundQty = refundTotalGbp > 0 || perLineRefund.some((p) => p.selectedQty > 0);
  const canSubmit = !submitting && reasonValid && hasRefundQty;

  const handleStepperChange = useCallback(
    (ticketTypeId: string, delta: number, max: number): void => {
      setPerLineRefund((prev) =>
        prev.map((p) =>
          p.ticketTypeId === ticketTypeId
            ? {
                ...p,
                selectedQty: Math.max(
                  0,
                  Math.min(max, p.selectedQty + delta),
                ),
              }
            : p,
        ),
      );
    },
    [],
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    await sleep(REFUND_PROCESSING_MS);

    const refundLines = perLineRefund
      .filter((p) => p.selectedQty > 0)
      .map((p) => {
        const orderLine = sale.lines.find(
          (l) => l.ticketTypeId === p.ticketTypeId,
        );
        const unitPrice = orderLine?.unitPriceGbpAtSale ?? 0;
        return {
          ticketTypeId: p.ticketTypeId,
          quantity: p.selectedQty,
          amountGbp: p.selectedQty * unitPrice,
        };
      });

    const trimmedReason = reason.trim();
    // OBS-1 lock: refund affects MONEY only, NOT check-in. NO useScanStore touch.
    // I-19 spirit (immutable order financials): refund creates a new event
    // without undoing the original. The buyer physically attended; financial
    // event ≠ attendance event. Edge case "operator wants to undo BOTH money
    // + check-in" is deferred to a future cycle (see SPEC §3.2 OBS-1 + D-CYCLE12-5).
    const updated = useDoorSalesStore.getState().recordRefund(sale.id, {
      saleId: sale.id,
      amountGbp: refundTotalGbp,
      reason: trimmedReason,
      lines: refundLines,
    });

    setSubmitting(false);
    if (updated === null) {
      // Sale disappeared mid-flight (rare). Surface via parent toast.
      onSuccess(sale);
      return;
    }
    onSuccess(updated);
  }, [
    canSubmit,
    sale,
    perLineRefund,
    refundTotalGbp,
    reason,
    onSuccess,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>Refund door sale</Text>
        <Text style={styles.subhead}>
          Pick which tickets to refund. The buyer stays checked in either way.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {/* Refund line picker */}
          <View style={styles.summaryCard}>
            {refundableLines.length === 0 ? (
              <Text style={styles.partialHelper}>
                Already fully refunded.
              </Text>
            ) : (
              <>
                <Text style={styles.partialHelper}>
                  Total updates as you select.
                </Text>
                {refundableLines.map((line) => {
                  const partialState = perLineRefund.find(
                    (p) => p.ticketTypeId === line.ticketTypeId,
                  ) ?? {
                    ticketTypeId: line.ticketTypeId,
                    selectedQty: 0,
                  };
                  const maxRefundable =
                    line.quantity - line.refundedQuantity;
                  return (
                    <View key={line.ticketTypeId} style={styles.lineRow}>
                      <View style={styles.lineCol}>
                        <Text style={styles.lineName} numberOfLines={1}>
                          {line.ticketNameAtSale}
                        </Text>
                        <Text style={styles.lineSubline}>
                          {maxRefundable} remaining ·{" "}
                          {line.isFreeAtSale
                            ? "Free"
                            : formatGbp(line.unitPriceGbpAtSale)}{" "}
                          each
                        </Text>
                      </View>
                      <View style={styles.stepper}>
                        <Pressable
                          onPress={() =>
                            handleStepperChange(
                              line.ticketTypeId,
                              -1,
                              maxRefundable,
                            )
                          }
                          disabled={
                            partialState.selectedQty === 0 || submitting
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Decrease refund quantity"
                          style={[
                            styles.stepperBtn,
                            (partialState.selectedQty === 0 || submitting) &&
                              styles.stepperBtnDisabled,
                          ]}
                        >
                          <Text style={styles.stepperBtnText}>−</Text>
                        </Pressable>
                        <Text style={styles.stepperValue}>
                          {partialState.selectedQty}
                        </Text>
                        <Pressable
                          onPress={() =>
                            handleStepperChange(
                              line.ticketTypeId,
                              1,
                              maxRefundable,
                            )
                          }
                          disabled={
                            partialState.selectedQty >= maxRefundable ||
                            submitting
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Increase refund quantity"
                          style={[
                            styles.stepperBtn,
                            (partialState.selectedQty >= maxRefundable ||
                              submitting) &&
                              styles.stepperBtnDisabled,
                          ]}
                        >
                          <Text style={styles.stepperBtnText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Refund total</Text>
                  <Text style={styles.summaryValueBold}>
                    {formatGbp(refundTotalGbp)}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Required reason input */}
          <View style={styles.reasonSection}>
            <Text style={styles.reasonLabel}>
              Why are you issuing this refund?{" "}
              <Text style={styles.required}>*</Text>
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
                placeholder="e.g. Buyer changed their mind; venue change; double-charged"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={4}
                maxLength={REASON_MAX}
                style={styles.reasonInput}
                editable={!submitting}
                accessibilityLabel="Refund reason"
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

          {/* OBS-1 footer note */}
          <View style={styles.footerNote}>
            <Text style={styles.footerCopy}>
              Refunds don&apos;t un-check-in the buyer. They were physically at
              the door — only the money is returned.
            </Text>
          </View>
        </ScrollView>

        {/* Sticky bottom CTAs */}
        <View style={styles.actions}>
          <Button
            label={`Refund ${formatGbp(refundTotalGbp)}`}
            onPress={handleConfirm}
            variant="destructive"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Send refund"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel refund"
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
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  scroll: {
    flex: 1,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  summaryCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    marginBottom: spacing.md,
  },
  partialHelper: {
    fontSize: 13,
    color: textTokens.secondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  lineCol: {
    flex: 1,
    minWidth: 0,
  },
  lineName: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },
  lineSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: "600",
    color: textTokens.primary,
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: "600",
    color: textTokens.primary,
    minWidth: 24,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  summaryDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: textTokens.secondary,
  },
  summaryValueBold: {
    fontSize: 18,
    color: textTokens.primary,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  reasonSection: {
    marginBottom: spacing.md,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: spacing.xs,
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
    minHeight: 100,
  },
  reasonInputError: {
    borderColor: semantic.error,
  },
  reasonInput: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    minHeight: 80,
    textAlignVertical: "top",
    ...(Platform.OS === "web"
      ? ({ outlineWidth: 0 } as Record<string, number>)
      : null),
  },
  reasonMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
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
  footerNote: {
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.24)",
    backgroundColor: "rgba(59, 130, 246, 0.10)",
  },
  footerCopy: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
  },
  actions: {
    marginTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
});

export default DoorRefundSheet;
