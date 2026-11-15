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
import { StyleSheet, Text, TextInput, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import { useBrandStripeDetach } from "../../hooks/useBrandStripeDetach";
import type { BrandStripeDetachResult } from "../../services/brandStripeDetachService";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

type Step = "confirm" | "submitting" | "done";

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
  // ORCH-1140: hold the resolved detach result so the "done" step can show an
  // honest Stripe-side outcome (succeeded/skipped → clean; rejected → reason).
  const [detachResult, setDetachResult] =
    useState<BrandStripeDetachResult | null>(null);

  const detachMutation = useBrandStripeDetach();

  // Reset state every time the sheet re-opens for any brand.
  useEffect(() => {
    if (visible) {
      setStep("confirm");
      setConfirmInput("");
      setSubmitError(null);
      setDetachResult(null);
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
      // ORCH-1140: capture the result and advance to the "done" confirmation
      // step (was: dismiss silently). onDetached/onClose now fire from the
      // "Done" button so the user sees the success before the sheet closes.
      const result = await detachMutation.mutateAsync({ brandId });
      setDetachResult(result);
      setStep("done");
    } catch (error) {
      // Const #3: surface the error inline; do not silently retry.
      setStep("confirm");
      setSubmitError(
        error instanceof Error
          ? `Couldn't disconnect: ${error.message}`
          : "Couldn't disconnect. Tap Disconnect bank to try again.",
      );
    }
  }, [canConfirm, brandId, detachMutation, step]);

  // ORCH-1140: fire parent coordination + dismiss only after the user
  // acknowledges the "Disconnected" confirmation.
  const handleDone = useCallback((): void => {
    if (brandId !== null) onDetached?.(brandId);
    onClose();
  }, [brandId, onDetached, onClose]);

  if (brandId === null || brandName === null) return null;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {step === "confirm" ? (
          <View>
            <Text style={styles.title}>
              Disconnect bank from {brandName}?
            </Text>
            <View style={styles.warnCard}>
              <Icon name="bank" size={18} color={color.text3} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitle}>This stops incoming payments</Text>
                <Text style={styles.warnBody}>
                  This disconnects your payout account from {brandName}.
                  You won{"’"}t be able to take payments until you connect
                  a bank again. Existing buyers keep their bookings.
                  Refunds for completed sales remain visible under your
                  refund history.
                </Text>
              </View>
            </View>
            <View style={[styles.warnCard, styles.warnCardWarn]}>
              <Icon name="flag" size={18} color={color.text1} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitleWarn}>
                  Reconnecting means starting again
                </Text>
                <Text style={styles.warnBody}>
                  You can reconnect later, but bank setup starts from
                  scratch, including identity verification.
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
                placeholderTextColor={color.text4}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                accessibilityLabel={`Type ${brandName} to confirm`}
                accessibilityHint="Type the brand name exactly to confirm disconnecting the bank"
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
                  label="Disconnect bank"
                  variant="primary"
                  size="md"
                  onPress={handleSubmit}
                  disabled={!canConfirm}
                  fullWidth
                  accessibilityLabel={`Disconnect bank from ${brandName}`}
                />
              </View>
            </View>
          </View>
        ) : null}

        {step === "submitting" ? (
          <View style={styles.submittingWrap}>
            <Text style={styles.title}>Disconnecting…</Text>
            <Text style={styles.confirmHelper}>
              Disconnecting the bank for {brandName}.
            </Text>
          </View>
        ) : null}

        {step === "done" ? (
          <View style={styles.doneWrap}>
            <View style={styles.doneHeaderRow}>
              <Icon name="check" size={20} color={color.success} />
              <Text style={styles.title}>Disconnected</Text>
            </View>
            <Text style={styles.confirmHelper}>
              The bank is disconnected for {brandName}.
            </Text>
            {detachResult?.stripeDeleteStatus === "rejected" ? (
              <View style={[styles.warnCard, styles.warnCardWarn]}>
                <Icon name="flag" size={18} color={color.text1} />
                <View style={styles.warnTextCol}>
                  <Text style={styles.warnTitleWarn}>
                    Payment account not fully closed
                  </Text>
                  <Text style={styles.warnBody}>
                    {detachResult.rejectionReason !== null
                      ? `The payment account couldn't be fully closed (${detachResult.rejectionReason}). Your payouts are still disconnected.`
                      : "The payment account couldn't be fully closed. Your payouts are still disconnected."}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Done"
                  variant="primary"
                  size="md"
                  onPress={handleDone}
                  fullWidth
                  accessibilityLabel="Done"
                />
              </View>
            </View>
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
    paddingTop: space[6],
    paddingBottom: space[7],
    // #4420: the Sheet owns the 20pt side padding; no second inset here.
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    marginBottom: space[4],
  },
  warnCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[4],
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[2],
  },
  warnCardWarn: {
    backgroundColor: color.warningTint,
    borderColor: color.line,
  },
  warnTextCol: {
    flex: 1,
    gap: 4,
  },
  warnTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  warnTitleWarn: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  warnBody: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
  confirmHelper: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginTop: space[4],
    marginBottom: space[2],
  },
  brandLabelLarge: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
    marginVertical: space[2],
  },
  inputWrap: {
    paddingHorizontal: space[4],
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  inputWrapError: {
    borderColor: color.danger,
  },
  input: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: color.text1,
    padding: 0,
    margin: 0,
  },
  errorText: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
    marginTop: space[1],
  },
  actionRow: {
    flexDirection: "row",
    gap: space[2],
    marginTop: space[6],
  },
  actionCell: {
    flex: 1,
  },
  submittingWrap: {
    paddingVertical: space[7],
  },
  doneWrap: {
    paddingVertical: space[6],
  },
  doneHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginBottom: space[1],
  },
});
