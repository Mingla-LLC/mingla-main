/**
 * BrandStripeDetachConfirmSheet — confirm-by-typing-name destructive sheet
 * for severing a brand's Stripe Connect account.
 *
 * Per ORCH-0802 SPEC §6.2. Pattern lifted verbatim from
 * `BrandDeleteSheet.tsx` (brand soft-delete), simplified to 2 steps
 * (confirm + submitting) because the detach mutation handles its own
 * partial-failure semantics — the edge fn always succeeds locally even
 * when Stripe rejects (e.g., balance > 0), exposing the Stripe outcome
 * via `stripeDeleteStatus`.
 *
 * Surfaces today's missing UX gap: `useBrandStripeDetach` +
 * `brandStripeDetachService` shipped in B2a Path C V3 but no UI invoked
 * them. Brand admins could not disconnect Stripe from inside the app.
 *
 * Audit log is emitted by the `brand-stripe-detach` edge fn itself
 * (`stripe_connect.detach_completed` or
 * `stripe_connect.detach_local_success_stripe_rejected`); no client-side
 * audit emit.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandStripeDetach } from "../../hooks/useBrandStripeDetach";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

type Step = "confirm" | "submitting";

export interface BrandStripeDetachConfirmSheetProps {
  visible: boolean;
  brandId: string | null;
  brandName: string | null;
  onClose: () => void;
  /**
   * Fires after a successful detach. Parent invalidates queries (the
   * mutation already does cache invalidation; this callback is for any
   * additional parent-level coordination like analytics or navigation).
   */
  onDetached?: (brandId: string) => void;
}

export const BrandStripeDetachConfirmSheet: React.FC<
  BrandStripeDetachConfirmSheetProps
> = ({ visible, brandId, brandName, onClose, onDetached }) => {
  const [step, setStep] = useState<Step>("confirm");
  const [confirmInput, setConfirmInput] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const detachMutation = useBrandStripeDetach();

  // Reset state every time the sheet re-opens for any brand.
  useEffect(() => {
    if (visible) {
      setStep("confirm");
      setConfirmInput("");
      setSubmitError(null);
    }
  }, [visible, brandId]);

  // Type-to-confirm: case-insensitive trim match (same rule as BrandDeleteSheet).
  const canConfirm = useMemo<boolean>(() => {
    if (brandName === null) return false;
    return (
      confirmInput.trim().toLowerCase() === brandName.trim().toLowerCase()
    );
  }, [confirmInput, brandName]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canConfirm || brandId === null || step === "submitting") return;
    setStep("submitting");
    setSubmitError(null);
    try {
      await detachMutation.mutateAsync({ brandId });
      onDetached?.(brandId);
      onClose();
    } catch (error) {
      // Const #3: surface the error inline; do not silently retry.
      setStep("confirm");
      setSubmitError(
        error instanceof Error
          ? `Couldn't disconnect: ${error.message}`
          : "Couldn't disconnect. Tap Disconnect Stripe to try again.",
      );
    }
  }, [canConfirm, brandId, detachMutation, onDetached, onClose, step]);

  if (brandId === null || brandName === null) return null;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        {step === "confirm" ? (
          <View>
            <Text style={styles.title}>
              Disconnect Stripe from {brandName}?
            </Text>
            <View style={styles.warnCard}>
              <Icon name="bank" size={18} color={textTokens.tertiary} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitle}>This stops ticket sales</Text>
                <Text style={styles.warnBody}>
                  Disconnecting stops {brandName} from selling tickets.
                  Existing buyers keep their tickets. Refunds for
                  completed sales remain visible under your refund
                  history.
                </Text>
              </View>
            </View>
            <View style={[styles.warnCard, styles.warnCardWarn]}>
              <Icon name="flag" size={18} color={accent.warm} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitleWarn}>Reconnect requires KYC</Text>
                <Text style={styles.warnBody}>
                  You can reconnect later, but it requires re-onboarding
                  from scratch including KYC verification.
                </Text>
              </View>
            </View>
            <Text style={styles.confirmHelper}>
              Type the brand name exactly to disconnect.
            </Text>
            <Text style={styles.brandLabelLarge}>{brandName}</Text>
            <View
              style={[
                styles.inputWrap,
                submitError !== null && styles.inputWrapError,
              ]}
            >
              <TextInput
                value={confirmInput}
                onChangeText={setConfirmInput}
                placeholder={brandName}
                placeholderTextColor={textTokens.quaternary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                accessibilityLabel={`Type ${brandName} to confirm`}
                accessibilityHint="Type the brand name exactly to confirm disconnecting Stripe"
              />
            </View>
            {submitError !== null ? (
              <Text style={styles.errorText}>{submitError}</Text>
            ) : null}
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Keep connected"
                  variant="ghost"
                  size="md"
                  onPress={onClose}
                  fullWidth
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label="Disconnect Stripe"
                  variant="primary"
                  size="md"
                  onPress={handleSubmit}
                  disabled={!canConfirm}
                  fullWidth
                  accessibilityLabel={`Disconnect Stripe from ${brandName}`}
                />
              </View>
            </View>
          </View>
        ) : null}

        {step === "submitting" ? (
          <View style={styles.submittingWrap}>
            <Text style={styles.title}>Disconnecting…</Text>
            <Text style={styles.confirmHelper}>
              Severing the Stripe connection for {brandName}.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  warnCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  warnCardWarn: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderColor: "rgba(245, 158, 11, 0.32)",
  },
  warnTextCol: {
    flex: 1,
    gap: 4,
  },
  warnTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  warnTitleWarn: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  warnBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  confirmHelper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  brandLabelLarge: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginVertical: spacing.sm,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  inputWrapError: {
    borderColor: semantic.error,
  },
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    padding: 0,
    margin: 0,
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionCell: {
    flex: 1,
  },
  submittingWrap: {
    paddingVertical: spacing.xl,
  },
});
