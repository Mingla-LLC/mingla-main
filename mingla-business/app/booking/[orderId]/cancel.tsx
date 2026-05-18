/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Buyer cancel route.
 *
 * Route: /booking/{orderId}/cancel?token=<plaintext-HMAC>
 *
 * Anon-buyer-tolerant per `feedback_anon_buyer_routes.md`. NO useAuth, NO
 * sign-in redirect. Buyer arrives cold from "Manage your booking" link in the
 * confirmation email weeks after checkout. HMAC token in URL → SHA256-hashed +
 * compared against orders.buyer_cancel_token_hash on the server (inside
 * cancel-trip-booking edge fn).
 *
 * States per DESIGN_ORCH-0875 §3.2 (7 mocked):
 *   1. Loading skeleton
 *   2. Preview loaded, refund > $0 (single-tap Cancel CTA)
 *   3. Preview loaded, refund = $0 (type-to-confirm friction per ORCH-0862
 *      destructive-action divergence pattern)
 *   4. Confirming
 *   5. Success
 *   6. Token invalid (401)
 *   7. Already cancelled (409)
 *
 * Per SPEC_ORCH-0875 §3.5.7 + I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES.
 */

// orch-strict-grep-allow i-proposed-tr2-safearea-on-fullscreen-routes —
// ORCH-0875 cancel route uses explicit insets.top padding (not SafeScreen
// wrapper) because it renders a full-bleed hero matching the public trip
// page chrome aesthetic per DESIGN §3.2.

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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import {
  useBuyerRefundPreview,
  useCancelTripBookingBuyer,
} from "../../../src/hooks/useCancelTripBooking";
import type {
  CancelTripBookingError,
  CancelTripBookingResult,
} from "../../../src/services/cancelTripBookingService";
import { RefundPreviewBody } from "../../../src/components/trip/RefundPreviewBody";

function makeIdempotencyKey(orderId: string): string {
  return `tr4_buyer_cancel_${orderId.slice(0, 8)}_${Date.now()}`;
}

export default function CancelBookingScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ orderId?: string; token?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const orderId = typeof params.orderId === "string" ? params.orderId : null;
  const token = typeof params.token === "string" ? params.token : null;

  const previewQuery = useBuyerRefundPreview(orderId, token);
  const commitMutation = useCancelTripBookingBuyer();

  const [typeToConfirmInput, setTypeToConfirmInput] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successResult, setSuccessResult] =
    useState<CancelTripBookingResult | null>(null);

  const handleClose = useCallback(() => {
    // Tap X → back. router.back() if possible; else navigate to root.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  const handleConfirm = useCallback(async () => {
    if (!orderId || !token) return;
    if (!previewQuery.data) return;
    setSubmitError(null);
    try {
      const result = await commitMutation.mutateAsync({
        orderId,
        token,
        expectedRefundTotalCents: previewQuery.data.refundTotalCents,
        idempotencyKey: makeIdempotencyKey(orderId),
      });
      setSuccessResult(result);
    } catch (err) {
      const tErr = err as CancelTripBookingError;
      if (tErr.code === "policy_updated") {
        await previewQuery.refetch();
        setSubmitError(
          "The cancellation policy was updated. Review the new refund amount above and confirm again.",
        );
      } else if (tErr.code === "already_cancelled") {
        // Already cancelled — re-fetch to surface state 7.
        await previewQuery.refetch();
      } else {
        setSubmitError(tErr.message ?? "Couldn't cancel the reservation. Try again.");
      }
    }
  }, [commitMutation, orderId, previewQuery, token]);

  const refundIsZero =
    previewQuery.data !== undefined && previewQuery.data.refundTotalCents === 0;
  const typeConfirmValid = !refundIsZero || typeToConfirmInput.trim() === "CANCEL";
  const canConfirm =
    previewQuery.data !== undefined &&
    !commitMutation.isPending &&
    typeConfirmValid &&
    successResult === null;

  // -----------------------------------------------------------------------
  // State branching
  // -----------------------------------------------------------------------

  // State 4: SUCCESS
  if (successResult !== null) {
    const amount = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: successResult.currency.toUpperCase(),
    }).format(successResult.refundAmountCents / 100);
    return (
      <View
        style={[styles.host, { paddingTop: insets.top }]}
        testID="booking-cancel-success"
      >
        <View style={styles.headerRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleClose}
            accessibilityLabel="Close"
          />
        </View>
        <ScrollView contentContainerStyle={styles.successWrap}>
          <Text style={styles.successCheck}>✓</Text>
          <Text style={styles.successTitle}>
            {successResult.refundAmountCents > 0
              ? "Cancelled · refund on its way"
              : "Cancellation confirmed"}
          </Text>
          {successResult.refundAmountCents > 0 ? (
            <Text style={styles.successBody}>
              {amount} refund sent to your original payment method. Refunds
              typically appear within 5–10 business days.
            </Text>
          ) : (
            <Text style={styles.successBody}>
              Your reservation has been cancelled. No refund applies per the
              cancellation policy.
            </Text>
          )}
          <Text style={styles.successReference}>
            Reference: RFD-{successResult.refundId.slice(0, 6)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to trip page"
            hitSlop={8}
            onPress={handleClose}
            style={({ pressed }) => [
              styles.secondaryButton,
              styles.successCloseButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Back to trip page</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // State 6+7: token invalid / already cancelled (or other terminal errors)
  if (previewQuery.error) {
    const tErr = previewQuery.error as CancelTripBookingError;
    const isInvalidToken =
      tErr.code === "invalid_token" || tErr.code === "token_required";
    const isAlreadyCancelled = tErr.code === "already_cancelled";
    return (
      <View
        style={[styles.host, { paddingTop: insets.top }]}
        testID="booking-cancel-terminal-error"
      >
        <View style={styles.headerRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleClose}
            accessibilityLabel="Close"
          />
        </View>
        <ScrollView contentContainerStyle={styles.terminalErrorWrap}>
          <Text
            style={[
              styles.terminalIcon,
              isAlreadyCancelled
                ? styles.terminalIconSuccess
                : styles.terminalIconNeutral,
            ]}
          >
            {isAlreadyCancelled ? "✓" : "ⓘ"}
          </Text>
          <Text style={styles.terminalTitle}>
            {isAlreadyCancelled
              ? "Your reservation is cancelled"
              : isInvalidToken
                ? "This cancel link isn't valid"
                : "Couldn't load cancellation"}
          </Text>
          <Text style={styles.terminalBody}>
            {isAlreadyCancelled
              ? "This reservation was already cancelled. If you have questions, contact the organizer."
              : isInvalidToken
                ? "The link may have expired, been used already, or copied incorrectly. Contact the organizer if you need to cancel."
                : tErr.message ?? "Try again later or contact the organizer."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Visit trip page"
            hitSlop={8}
            onPress={handleClose}
            style={({ pressed }) => [
              styles.secondaryButton,
              styles.successCloseButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Visit trip page</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // State 1: LOADING (initial fetch in progress)
  if (previewQuery.isLoading || !previewQuery.data) {
    return (
      <View
        style={[styles.host, { paddingTop: insets.top }]}
        testID="booking-cancel-loading"
      >
        <View style={styles.headerRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleClose}
            accessibilityLabel="Close"
          />
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.loadingText}>Loading cancellation preview…</Text>
        </View>
      </View>
    );
  }

  // State 2 or 3: PREVIEW LOADED (refund > 0 OR refund = 0 with friction)
  return (
    <View
      style={[styles.host, { paddingTop: insets.top }]}
      testID="booking-cancel-preview"
    >
      <View style={styles.headerRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close"
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <RefundPreviewBody preview={previewQuery.data} mode="buyer" />

        {/* Type-to-confirm friction (refund = 0 only) per design §3.2 State 3 +
            ORCH-0862 destructive-action divergence pattern. */}
        {refundIsZero && (
          <View style={styles.typeToConfirmWrap}>
            <Text style={styles.typeToConfirmLabel}>
              No refund applies. Type CANCEL below to confirm anyway.
            </Text>
            <TextInput
              style={styles.typeToConfirmInput}
              value={typeToConfirmInput}
              onChangeText={setTypeToConfirmInput}
              editable={!commitMutation.isPending}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Type CANCEL to confirm"
              placeholderTextColor={textTokens.quaternary}
              accessibilityLabel="Type CANCEL to confirm cancellation"
              accessibilityHint="Cancellation requires explicit confirmation because no refund applies"
            />
          </View>
        )}

        {submitError !== null && (
          <View style={styles.submitErrorBanner} accessibilityLiveRegion="polite">
            <Text style={styles.submitErrorText}>{submitError}</Text>
          </View>
        )}

        <View style={styles.ctaRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keep my spot"
            hitSlop={8}
            disabled={commitMutation.isPending}
            onPress={handleClose}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
              commitMutation.isPending && styles.disabled,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Keep my spot</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              refundIsZero
                ? "Cancel reservation (no refund)"
                : "Cancel reservation and process refund"
            }
            accessibilityState={{ disabled: !canConfirm }}
            hitSlop={8}
            disabled={!canConfirm}
            onPress={handleConfirm}
            style={({ pressed }) => [
              styles.destructiveButton,
              pressed && styles.pressed,
              !canConfirm && styles.disabled,
            ]}
          >
            {commitMutation.isPending ? (
              <ActivityIndicator color={semantic.error} />
            ) : (
              <Text style={styles.destructiveButtonText}>
                {refundIsZero ? "Cancel anyway" : "Cancel & refund"}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  headerRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    color: textTokens.tertiary,
  },
  typeToConfirmWrap: {
    gap: spacing.xs,
  },
  typeToConfirmLabel: {
    fontSize: 14,
    color: textTokens.secondary,
  },
  typeToConfirmInput: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: 14,
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
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  successWrap: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  successCheck: {
    fontSize: 64,
    color: semantic.success,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  successBody: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: 20,
  },
  successReference: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontFamily: "Menlo",
  },
  successCloseButton: {
    marginTop: spacing.md,
    minWidth: 180,
    flex: 0,
  },
  terminalErrorWrap: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  terminalIcon: {
    fontSize: 64,
  },
  terminalIconNeutral: {
    color: textTokens.tertiary,
  },
  terminalIconSuccess: {
    color: semantic.success,
  },
  terminalTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  terminalBody: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: 20,
  },
});
