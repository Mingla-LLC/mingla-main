/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — <RefundPreviewSheet />.
 *
 * Operator-facing wrapper around <RefundPreviewBody />. Mounts inside <Sheet />
 * primitive. Reason text input (10-200 chars, required) + Cancel/Keep CTAs +
 * loading/error/success states.
 *
 * Per SPEC_ORCH-0875 §3.5.3 + DESIGN_ORCH-0875 §6.3 (shared body composition).
 *
 * Buyer-mode cancellation lives at /booking/{orderId}/cancel — separate full-
 * screen route per design §3 DECISION B (not a sheet).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  useCancelTripBookingOperator,
  useOperatorRefundPreview,
} from "../../hooks/useCancelTripBooking";
import type {
  CancelTripBookingError,
  CancelTripBookingResult,
} from "../../services/cancelTripBookingService";
import { Sheet } from "../ui/Sheet";
import { RefundPreviewBody } from "./RefundPreviewBody";

export interface RefundPreviewSheetProps {
  visible: boolean;
  orderId: string | null;
  /** Trip metadata for the preview body hero. */
  tripName?: string | null;
  tripDateRange?: string | null;
  onClose: () => void;
  /** Called after successful commit. Parent typically invalidates queries + dismisses. */
  onCancelled?: (result: CancelTripBookingResult) => void;
}

const REASON_MIN_CHARS = 10;
const REASON_MAX_CHARS = 200;

function makeIdempotencyKey(orderId: string): string {
  // Edge fn requires 8-128 char idempotency key. Use orderId + tab-separated
  // timestamp to keep it stable within a single attempt but unique per attempt.
  return `tr4_op_cancel_${orderId.slice(0, 8)}_${Date.now()}`;
}

export const RefundPreviewSheet: React.FC<RefundPreviewSheetProps> = ({
  visible,
  orderId,
  tripName,
  tripDateRange,
  onClose,
  onCancelled,
}) => {
  const [reason, setReason] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successResult, setSuccessResult] =
    useState<CancelTripBookingResult | null>(null);

  const previewQuery = useOperatorRefundPreview(visible ? orderId : null);
  const commitMutation = useCancelTripBookingOperator();

  const reasonTrimmed = reason.trim();
  const reasonValid =
    reasonTrimmed.length >= REASON_MIN_CHARS &&
    reasonTrimmed.length <= REASON_MAX_CHARS;

  const handleConfirm = useCallback(async () => {
    if (!orderId) return;
    if (!previewQuery.data) return;
    if (!reasonValid) return;
    setSubmitError(null);
    try {
      const result = await commitMutation.mutateAsync({
        orderId,
        reason: reasonTrimmed,
        expectedRefundTotalCents: previewQuery.data.refundTotalCents,
        idempotencyKey: makeIdempotencyKey(orderId),
      });
      setSuccessResult(result);
      onCancelled?.(result);
    } catch (err) {
      const tErr = err as CancelTripBookingError;
      if (tErr.code === "policy_updated") {
        // SC-22 freshness divergence — re-fetch preview so the operator sees
        // the new amount and re-confirms.
        await previewQuery.refetch();
        setSubmitError(
          "The cancellation policy was updated. Review the new refund amount above and confirm again.",
        );
      } else {
        setSubmitError(tErr.message ?? "Couldn't cancel the reservation. Try again.");
      }
    }
  }, [
    commitMutation,
    onCancelled,
    orderId,
    previewQuery,
    reasonTrimmed,
    reasonValid,
  ]);

  const handleClose = useCallback(() => {
    if (commitMutation.isPending) return; // don't close mid-submit
    setReason("");
    setSubmitError(null);
    setSuccessResult(null);
    onClose();
  }, [commitMutation.isPending, onClose]);

  const isPending = commitMutation.isPending;
  const isPreviewLoading = previewQuery.isLoading;
  const previewError = previewQuery.error;
  const preview = previewQuery.data;

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      snapPoint="full"
      dismissOnScrimTap={!isPending}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {successResult ? "Reservation cancelled" : "Cancel this booking?"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close cancel sheet"
            hitSlop={8}
            disabled={isPending}
            onPress={handleClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeIcon}>×</Text>
          </Pressable>
        </View>

        {/* Loading */}
        {isPreviewLoading && !successResult && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.loadingText}>Computing refund…</Text>
          </View>
        )}

        {/* Preview error */}
        {previewError && !preview && !successResult && (
          <View style={styles.errorWrap}>
            <Text style={styles.errorTitle}>Couldn't compute refund</Text>
            <Text style={styles.errorBody}>
              {(previewError as CancelTripBookingError).message ??
                "Try again or contact support."}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry refund preview"
              hitSlop={8}
              onPress={() => previewQuery.refetch()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Preview loaded — show body + reason input + CTAs */}
        {preview && !successResult && (
          <>
            <RefundPreviewBody
              preview={preview}
              mode="operator"
              tripName={tripName}
              tripDateRange={tripDateRange}
              density="concise"
            />

            <View style={styles.reasonWrap}>
              <Text style={styles.reasonLabel}>
                Reason for cancellation (visible to buyer)
              </Text>
              <TextInput
                style={styles.reasonInput}
                value={reason}
                onChangeText={setReason}
                editable={!isPending}
                multiline
                numberOfLines={3}
                placeholder="e.g. Trip cancelled due to insufficient bookings — apologies."
                placeholderTextColor={textTokens.quaternary}
                maxLength={REASON_MAX_CHARS}
                accessibilityLabel="Cancellation reason"
                accessibilityHint="10 to 200 characters; shown in the buyer cancellation email"
              />
              <Text style={styles.reasonHelper}>
                {reasonTrimmed.length}/{REASON_MAX_CHARS} characters{" "}
                {reasonTrimmed.length < REASON_MIN_CHARS &&
                  `(${REASON_MIN_CHARS} minimum)`}
              </Text>
            </View>

            {submitError !== null && (
              <View style={styles.submitErrorBanner} accessibilityLiveRegion="polite">
                <Text style={styles.submitErrorText}>{submitError}</Text>
              </View>
            )}

            <View style={styles.ctaRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keep reservation"
                hitSlop={8}
                disabled={isPending}
                onPress={handleClose}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  isPending && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Keep reservation</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel reservation and process refund"
                accessibilityState={{ disabled: !reasonValid || isPending }}
                hitSlop={8}
                disabled={!reasonValid || isPending}
                onPress={handleConfirm}
                style={({ pressed }) => [
                  styles.destructiveButton,
                  pressed && styles.pressed,
                  (!reasonValid || isPending) && styles.disabled,
                ]}
              >
                {isPending ? (
                  <ActivityIndicator color={semantic.error} />
                ) : (
                  <Text style={styles.destructiveButtonText}>Cancel & refund</Text>
                )}
              </Pressable>
            </View>
          </>
        )}

        {/* Success */}
        {successResult !== null && (
          <View style={styles.successWrap}>
            <Text style={styles.successCheckmark}>✓</Text>
            <Text style={styles.successTitle}>Cancellation processed</Text>
            <Text style={styles.successBody}>
              Refund of{" "}
              {new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: successResult.currency.toUpperCase(),
              }).format(successResult.refundAmountCents / 100)}{" "}
              issued to the buyer.{" "}
              {successResult.installmentsCancelled > 0 &&
                `${successResult.installmentsCancelled} scheduled installment${successResult.installmentsCancelled === 1 ? "" : "s"} cancelled.`}
            </Text>
            <Text style={styles.successReference}>
              Reference: RFD-{successResult.refundId.slice(0, 6)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              onPress={handleClose}
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.successCloseButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Done</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: textTokens.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    fontSize: 22,
    color: textTokens.secondary,
    fontWeight: "300",
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  loadingWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    color: textTokens.tertiary,
  },
  errorWrap: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: semantic.error,
  },
  errorBody: {
    fontSize: 13,
    color: textTokens.secondary,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    minHeight: 44,
    justifyContent: "center",
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
  reasonWrap: {
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  reasonInput: {
    minHeight: 80,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: 14,
    textAlignVertical: "top",
  },
  reasonHelper: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  submitErrorBanner: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.error,
  },
  submitErrorText: {
    fontSize: 13,
    color: semantic.error,
  },
  ctaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  destructiveButton: {
    flex: 1.5,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: semantic.error,
  },
  successWrap: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  successCheckmark: {
    fontSize: 48,
    color: semantic.success,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: textTokens.primary,
  },
  successBody: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  successReference: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontFamily: "Menlo",
  },
  successCloseButton: {
    marginTop: spacing.md,
    minWidth: 120,
    flex: 0,
  },
});
