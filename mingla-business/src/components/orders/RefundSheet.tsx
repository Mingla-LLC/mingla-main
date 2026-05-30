/**
 * RefundSheet — J-M3 (full refund) + J-M4 (partial refund).
 *
 * Two modes via `mode` prop:
 *
 *   "full"     — single Refund-total line + reason input + Send refund.
 *   "partial"  — line-item picker (one row per OrderLineRecord with
 *                checkbox + qty stepper); computed total updates live.
 *
 * Both modes require a 10..200 char trimmed reason (D-9c-9 — symmetry
 * with I-20 edit reason capture).
 *
 * Confirm onPress: 1.2s simulated processing → useOrderStore.recordRefund
 * → toast on parent.
 *
 * NO Stripe-fee-retained line in stub mode (Const #9; D-9c-4 — would
 * fabricate fee data). Wires when B-cycle adds real Stripe.
 *
 * Per Cycle 9c spec §3.4.3.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { OrderRecord } from "../../store/orderStore";
// ORCH-0787: replaced useOrderStore.recordRefund (Zustand-only client-side stub) with the
// real refund-order edge function via useRefundOrder mutation. Event-edit-log + parent
// notification rollup side effects are removed in v1 (owned by ORCH-0782 if it needs them).
import { useRefundOrder } from "../../hooks/useEventOrders";
import { formatCurrency } from "../../utils/currency";
import { randomId } from "../../utils/randomId";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  canPerformAction,
  gateCaptionFor,
} from "../../utils/permissionGates";

const REASON_MIN = 10;
const REASON_MAX = 200;

export type RefundMode = "full" | "partial";

export interface RefundSheetProps {
  visible: boolean;
  mode: RefundMode;
  order: OrderRecord;
  onClose: () => void;
  onSuccess: (amountGbp: number) => void;
}

interface PartialLineState {
  ticketTypeId: string;
  /** Selected quantity to refund (0..maxRefundable). */
  selectedQty: number;
}

export const RefundSheet: React.FC<RefundSheetProps> = ({
  visible,
  mode,
  order,
  onClose,
  onSuccess,
}) => {
  // ORCH-0787: useRefundOrder is the server-truth mutation. Replaces the stub
  // useOrderStore.recordRefund (which only wrote to Zustand).
  const refundMutation = useRefundOrder(order.eventId);
  const [reason, setReason] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [partialLines, setPartialLines] = useState<PartialLineState[]>([]);
  // ORCH-0787: idempotency key regenerated on each sheet-open. Retries within the same
  // sheet share the key so Stripe and the RPC dedupe correctly.
  const idempotencyKeyRef = useRef<string>("");

  // Reset state on visible flip → true (defensive)
  useEffect(() => {
    if (visible) {
      setReason("");
      setErrorMessage(null);
      setPartialLines(
        order.lines.map((l) => ({
          ticketTypeId: l.ticketTypeId,
          selectedQty: 0,
        })),
      );
      // Fresh idempotency key per sheet-open.
      idempotencyKeyRef.current = randomId();
    }
  }, [visible, order.lines]);

  const submitting = refundMutation.isPending;

  // Available lines for partial refund (only those with remaining qty)
  const refundableLines = useMemo(
    () =>
      order.lines.filter((l) => l.quantity - l.refundedQuantity > 0),
    [order.lines],
  );

  // Computed total for partial refund
  const partialTotalGbp = useMemo<number>(() => {
    if (mode !== "partial") return 0;
    return partialLines.reduce((sum, p) => {
      const orderLine = order.lines.find(
        (l) => l.ticketTypeId === p.ticketTypeId,
      );
      if (orderLine === undefined) return sum;
      return sum + p.selectedQty * orderLine.unitPriceGbpAtPurchase;
    }, 0);
  }, [mode, partialLines, order.lines]);

  // Total amount the operator is about to refund
  const refundAmount = mode === "full"
    ? order.totalGbpAtPurchase - order.refundedAmountGbp
    : partialTotalGbp;

  const trimmedLen = reason.trim().length;
  const reasonValid =
    trimmedLen >= REASON_MIN && trimmedLen <= REASON_MAX;

  const partialHasSelection = mode === "partial" && partialTotalGbp > 0;
  const fullHasAmount = mode === "full" && refundAmount > 0;

  // Cycle 13a J-T6 G3: Confirm CTA gated on REFUND_ORDER (finance_manager+).
  // Hooks run on every render before any early-return shell (ORCH-0710).
  const { rank: currentRank } = useCurrentBrandRole(order.brandId);
  const canRefund = canPerformAction(currentRank, "REFUND_ORDER");

  const canSubmit =
    !submitting &&
    reasonValid &&
    canRefund &&
    (mode === "full" ? fullHasAmount : partialHasSelection);

  const handleStepperChange = useCallback(
    (ticketTypeId: string, delta: number, max: number): void => {
      setPartialLines((prev) =>
        prev.map((p) =>
          p.ticketTypeId === ticketTypeId
            ? {
                ...p,
                selectedQty: Math.max(0, Math.min(max, p.selectedQty + delta)),
              }
            : p,
        ),
      );
    },
    [],
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setErrorMessage(null);

    // ORCH-0787: build refund-order edge function payload using order_line_items.id
    // (the server-side UUID). For full refunds, refund remaining qty on every line.
    const lines =
      mode === "full"
        ? order.lines
            .filter((l) => l.quantity - l.refundedQuantity > 0)
            .map((l) => ({
              orderLineItemId: l.orderLineItemId ?? "",
              quantity: l.quantity - l.refundedQuantity,
              amountCents: Math.round(
                (l.quantity - l.refundedQuantity) * l.unitPriceGbpAtPurchase * 100,
              ),
            }))
        : partialLines
            .filter((p) => p.selectedQty > 0)
            .map((p) => {
              const orderLine = order.lines.find(
                (l) => l.ticketTypeId === p.ticketTypeId,
              );
              const unitPrice = orderLine?.unitPriceGbpAtPurchase ?? 0;
              return {
                orderLineItemId: orderLine?.orderLineItemId ?? "",
                quantity: p.selectedQty,
                amountCents: Math.round(p.selectedQty * unitPrice * 100),
              };
            });

    // Defensive: if any line is missing orderLineItemId, the order pre-dates the
    // ORCH-0787 migration. Surface a clear error instead of calling the edge fn.
    if (lines.some((l) => !l.orderLineItemId)) {
      setErrorMessage(
        "This order can't be refunded in-app. It may pre-date the refund system. Refund it from the Stripe dashboard instead.",
      );
      return;
    }

    const trimmedReason = reason.trim();
    try {
      const result = await refundMutation.mutateAsync({
        orderId: order.id,
        lines,
        reason: trimmedReason,
        idempotencyKey: idempotencyKeyRef.current,
      });
      // Success path: React Query invalidates event-orders queries automatically.
      // No Zustand write. No event-edit-log fire (server audit row already written).
      onSuccess(result.amountCents / 100);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      return;
    }
  }, [
    canSubmit,
    mode,
    order,
    partialLines,
    refundMutation,
    reason,
    onSuccess,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const title =
    mode === "full"
      ? `Refund ${formatCurrency(refundAmount, order.currency)}?`
      : `Refund partial`;

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subhead}>
          Buyer will see refund on their card in 3–5 business days.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {mode === "full" ? (
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Refund total</Text>
                <Text style={styles.summaryValueBold}>
                  {formatCurrency(refundAmount, order.currency)}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.summaryCard}>
              <Text style={styles.partialHelper}>
                Pick which tickets to refund. Total updates as you select.
              </Text>
              {refundableLines.map((line) => {
                const partialState = partialLines.find(
                  (p) => p.ticketTypeId === line.ticketTypeId,
                ) ?? { ticketTypeId: line.ticketTypeId, selectedQty: 0 };
                const maxRefundable =
                  line.quantity - line.refundedQuantity;
                return (
                  <View key={line.ticketTypeId} style={styles.lineRow}>
                    <View style={styles.lineCol}>
                      <Text style={styles.lineName} numberOfLines={1}>
                        {line.ticketNameAtPurchase}
                      </Text>
                      <Text style={styles.lineSubline}>
                        {maxRefundable} remaining · {formatCurrency(line.unitPriceGbpAtPurchase, order.currency)} each
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
                        disabled={partialState.selectedQty === 0}
                        accessibilityRole="button"
                        accessibilityLabel="Decrease refund quantity"
                        style={[
                          styles.stepperBtn,
                          partialState.selectedQty === 0 &&
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
                        disabled={partialState.selectedQty >= maxRefundable}
                        accessibilityRole="button"
                        accessibilityLabel="Increase refund quantity"
                        style={[
                          styles.stepperBtn,
                          partialState.selectedQty >= maxRefundable &&
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
                  {formatCurrency(partialTotalGbp, order.currency)}
                </Text>
              </View>
            </View>
          )}

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
                placeholder="e.g. Buyer requested refund; tier oversold; venue change"
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

          {/* Notification footer note (destructive — banner + email + SMS always) */}
          <View style={styles.footerNote}>
            <Icon name="flag" size={14} color={accent.warm} />
            <Text style={styles.footerCopy}>
              Refunds notify the buyer by email and SMS. Your reason will be
              included in the message.
            </Text>
          </View>
        </ScrollView>

        {/* Sticky bottom CTAs */}
        <View style={styles.actions}>
          {errorMessage !== null ? (
            <Text style={styles.errorCaption} accessibilityRole="text">
              {errorMessage}
            </Text>
          ) : null}
          <Button
            label={
              mode === "full"
                ? "Send refund"
                : `Refund ${formatCurrency(refundAmount, order.currency)}`
            }
            onPress={handleConfirm}
            variant="destructive"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Send refund"
          />
          {!canRefund ? (
            <Text style={styles.gateCaption}>
              {gateCaptionFor("REFUND_ORDER")}
            </Text>
          ) : null}
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
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    marginBottom: spacing.md,
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
  summaryDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
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
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
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
    overflow: "hidden",
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  footerCopy: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  actions: {
    marginTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
  gateCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 6,
    textAlign: "center",
  },
  errorCaption: {
    fontSize: 13,
    color: semantic.error,
    marginBottom: spacing.sm,
    textAlign: "center",
    lineHeight: 18,
  },
});

export default RefundSheet;
