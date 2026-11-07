/**
 * DoorRefundSheet — J-D4 partial/full refund of an in-person door sale.
 *
 * Mirrors Cycle 9c RefundSheet pattern (per-line stepper + reason input
 * 10..200 chars → the atomic server refund RPC.
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
 *
 * #4271 door polish: one subhead says the buyer stays checked in (the footer
 * note and "Total updates as you select." are gone), a 44pt header close
 * replaces Cancel, steppers are 44pt and name the ticket for screen readers,
 * and the reason has one helper line (utils/refundReason.ts).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { DoorSaleRecord } from "../../types/doorSales";
import { formatCurrency } from "../../utils/currency";
import { useRefundDoorSale } from "../../hooks/useEventDoorSales";
import { refundReasonHelper, refundReasonSendGate } from "../../utils/refundReason";

import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { Sheet } from "../ui/Sheet";

import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  canPerformAction,
  gateCaptionFor,
} from "../../utils/permissionGates";

const REASON_MIN = 10;
const REASON_MAX = 200;
export const DOOR_REFUND_SUBHEAD = "The buyer stays checked in. Only the money goes back.";
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [perLineRefund, setPerLineRefund] = useState<PerLineRefundState[]>([]);
  // #4271: tapping Send with a short reason explains it and focuses the box.
  const reasonInputRef = useRef<TextInput>(null);
  const [reasonErrorShown, setReasonErrorShown] = useState<boolean>(false);
  const refundSale = useRefundDoorSale(sale.eventId);

  // Reset on visible flip → true
  useEffect(() => {
    if (visible) {
      setReason("");
      setSubmitting(false);
      setSubmitError(null);
      setReasonErrorShown(false);
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
  const remainingAmount = Math.max(
    0,
    (sale.totalAtSale ?? sale.totalGbpAtSale) -
      (sale.refundedAmount ?? sale.refundedAmountGbp),
  );
  const hasRefundQty = refundTotalGbp > 0 && refundTotalGbp <= remainingAmount;

  // Cycle 13a J-T6 G4: Confirm CTA gated on REFUND_DOOR_SALE (finance_manager+).
  // Hooks run on every render before any early-return shell (ORCH-0710).
  const { rank: currentRank } = useCurrentBrandRole(sale.brandId);
  const canRefund = canPerformAction(currentRank, "REFUND_DOOR_SALE");

  const canSubmit = !submitting && reasonValid && hasRefundQty && canRefund;
  const sendGate = refundReasonSendGate({
    trimmedLength: trimmedLen,
    minLength: REASON_MIN,
    maxLength: REASON_MAX,
    otherwiseReady: !submitting && hasRefundQty && canRefund,
  });
  const showReasonError = reasonErrorShown && trimmedLen < REASON_MIN;

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
    if (sendGate.onPress === "show_reason_error") {
      setReasonErrorShown(true);
      reasonInputRef.current?.focus();
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    const trimmedReason = reason.trim();
    // OBS-1 lock: refund affects MONEY only, NOT check-in. NO useScanStore touch.
    // I-19 spirit (immutable order financials): refund creates a new event
    // without undoing the original. The buyer physically attended; financial
    // event ≠ attendance event. Edge case "operator wants to undo BOTH money
    // + check-in" is deferred to a future cycle (see SPEC §3.2 OBS-1 + D-CYCLE12-5).
    try {
      const result = await refundSale.mutateAsync({
        orderId: sale.id,
        amountCents: Math.round(refundTotalGbp * 100),
        reason: trimmedReason,
      });
      const amount = result.amountCents / 100;
      const refundedAmount = result.refundedAmountCents / 100;
      onSuccess({
        ...sale,
        status: result.status === "refunded" ? "refunded_full" : "refunded_partial",
        refundedAmount,
        refundedAmountGbp: refundedAmount,
        refunds: [
          ...sale.refunds,
          {
            id: result.refundId,
            saleId: sale.id,
            amount,
            amountGbp: amount,
            reason: trimmedReason,
            refundedAt: new Date().toISOString(),
            lines: [],
          },
        ],
      });
    } catch {
      setSubmitError("Couldn't refund this sale. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    sendGate.onPress,
    sale,
    refundTotalGbp,
    reason,
    onSuccess,
    refundSale,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const reasonHelper = refundReasonHelper({
    trimmedLength: trimmedLen,
    length: reason.length,
    minLength: REASON_MIN,
    maxLength: REASON_MAX,
    pressedShort: showReasonError,
  });
  const fullyRefunded = refundableLines.length === 0;

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              Refund door sale
            </Text>
            {/* OBS-1: said once. Refunds never undo the check-in. */}
            <Text style={styles.subhead}>{DOOR_REFUND_SUBHEAD}</Text>
          </View>
          <IconChrome
            icon="close"
            size={44}
            onPress={handleClose}
            disabled={submitting}
            accessibilityLabel="Close refund"
            testID="door-refund-close"
          />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Refund line picker */}
          {fullyRefunded ? (
            <View style={styles.lineRow}>
              <Text style={styles.lineSubline}>Already fully refunded.</Text>
            </View>
          ) : (
            <>
              <View style={styles.linesList}>
                {refundableLines.map((line) => {
                  const partialState = perLineRefund.find(
                    (p) => p.ticketTypeId === line.ticketTypeId,
                  ) ?? {
                    ticketTypeId: line.ticketTypeId,
                    selectedQty: 0,
                  };
                  const maxRefundable =
                    line.quantity - line.refundedQuantity;
                  const name = line.ticketNameAtSale;
                  return (
                    <View
                      key={line.ticketTypeId}
                      style={[styles.lineRow, partialState.selectedQty > 0 && styles.lineRowPicked]}
                    >
                      <View style={styles.lineCol}>
                        <Text style={styles.lineName} numberOfLines={2} accessibilityLabel={name}>
                          {name}
                        </Text>
                        <Text style={styles.lineSubline}>
                          {maxRefundable} left ·{" "}
                          {line.isFreeAtSale
                            ? "Free"
                            : formatCurrency(line.unitPriceGbpAtSale, sale.currency)}{" "}
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
                          accessibilityLabel={`Refund one fewer ${name}`}
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
                          accessibilityLabel={`Refund one more ${name}`}
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
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Refund total</Text>
                <Text style={styles.summaryValueBold}>
                  {formatCurrency(refundTotalGbp, sale.currency)}
                </Text>
              </View>

              {/* Required reason input: the helper line says it's required. */}
              <View style={styles.reasonSection}>
                <Text style={styles.reasonLabel}>Reason</Text>
                <View
                  style={[
                    styles.reasonInputWrap,
                    showReasonError && styles.reasonInputError,
                  ]}
                >
                  <TextInput
                    ref={reasonInputRef}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="e.g. Charged twice at the door"
                    placeholderTextColor={textTokens.quaternary}
                    multiline
                    numberOfLines={4}
                    maxLength={REASON_MAX}
                    style={styles.reasonInput}
                    editable={!submitting}
                    accessibilityLabel={`Refund reason, required, at least ${REASON_MIN} characters`}
                  />
                </View>
                <View style={styles.reasonMetaRow}>
                  <Text
                    style={[
                      styles.reasonHelper,
                      reasonHelper.tone === "error" && styles.reasonHelperError,
                    ]}
                    accessibilityRole={reasonHelper.tone === "error" ? "alert" : undefined}
                    testID={reasonHelper.tone === "error" ? "door-refund-reason-too-short" : "door-refund-reason-helper"}
                  >
                    {reasonHelper.text}
                  </Text>
                  {reasonHelper.counter !== null ? (
                    <Text style={styles.reasonCount}>{reasonHelper.counter}</Text>
                  ) : null}
                </View>
              </View>
            </>
          )}
        </ScrollView>

        {/* Sticky bottom CTA. Fully refunded: nothing to send, only the close X. */}
        {fullyRefunded ? null : (
          <View style={styles.actions}>
            {submitError !== null ? (
              <Text style={styles.submitError} accessibilityRole="alert">
                {submitError}
              </Text>
            ) : null}
            <Button
              label={`Refund ${formatCurrency(refundTotalGbp, sale.currency)}`}
              onPress={handleConfirm}
              variant="destructive"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={!sendGate.enabled}
              accessibilityLabel="Send refund"
            />
            {!canRefund ? (
              <Text style={styles.gateCaption}>
                {gateCaptionFor("REFUND_DOOR_SALE")}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </Sheet>
  );
};

const STEPPER_BUTTON = 44;

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.h3,
    fontWeight: "700",
    color: textTokens.primary,
  },
  subhead: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  scroll: {
    flex: 1,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  linesList: {
    gap: spacing.xs,
  },
  // Same row as the sale sheet.
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.sm,
  },
  lineRowPicked: {
    borderColor: accent.border,
    backgroundColor: accent.faint,
  },
  lineCol: {
    flex: 1,
    minWidth: 0,
  },
  lineName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
  lineSubline: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: STEPPER_BUTTON * 2 + 22 + spacing.sm * 2,
  },
  stepperBtn: {
    width: STEPPER_BUTTON,
    height: STEPPER_BUTTON,
    borderRadius: 999,
    overflow: "hidden",
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
    fontSize: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    width: 22,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  summaryValueBold: {
    fontSize: 17,
    lineHeight: 22,
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
  // One line, fixed height: it goes quiet when valid without the layout jumping.
  reasonMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: 6,
  },
  reasonHelper: {
    flex: 1,
    minHeight: 16,
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
  },
  reasonHelperError: {
    color: semantic.errorText,
  },
  reasonCount: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  actions: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  gateCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 6,
    textAlign: "center",
  },
  submitError: {
    fontSize: 12,
    lineHeight: 16,
    color: semantic.errorText,
    textAlign: "center",
  },
});

export default DoorRefundSheet;
