/**
 * ThreeDSStubSheet — Cycle 8 stub 3DS challenge sheet.
 *
 * Opens as a Sheet (snap=half) over J-C3 Payment when PaymentElementStub
 * returns "requiresAction" (i.e. when the __DEV__ Force-3DS toggle is
 * ticked). Buyer types any 6-digit code → 800ms processing → onSuccess.
 * Cancel closes the sheet → return to PaymentElementStub Idle.
 *
 * [TRANSITIONAL] Real Stripe handles 3DS via stripe.confirmCardPayment()
 * returning a `next_action` URL that the Stripe SDK presents natively.
 * This stub mirrors the buyer-facing UX without the SDK. EXIT CONDITION:
 * B3 wires real Stripe Element + 3DS native handler.
 *
 * Per Cycle 8 spec §4.9.
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";

const VERIFY_PROCESSING_MS = 800;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ThreeDSStubSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ThreeDSStubSheet: React.FC<ThreeDSStubSheetProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const [code, setCode] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when sheet opens (or closes)
  useEffect(() => {
    if (!visible) {
      setCode("");
      setVerifying(false);
      setError(null);
    }
  }, [visible]);

  const handleContinue = useCallback(async (): Promise<void> => {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your bank");
      return;
    }
    setError(null);
    setVerifying(true);
    await sleep(VERIFY_PROCESSING_MS);
    setVerifying(false);
    onSuccess();
  }, [code, onSuccess]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.body}>
        <Text style={styles.title}>Verify your purchase</Text>
        <Text style={styles.subhead}>
          Your bank wants to confirm this payment is you.
        </Text>

        <View style={styles.codeWrap}>
          <Input
            value={code}
            onChangeText={(next) => {
              setCode(next.replace(/\D/g, "").slice(0, 6));
              if (error !== null) setError(null);
            }}
            variant="number"
            placeholder="6-digit code"
            accessibilityLabel="6-digit verification code"
            disabled={verifying}
          />
          {error !== null ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}
        </View>

        <Text style={styles.stubHint}>
          Stub mode — type any 6 digits to continue.
        </Text>

        <View style={styles.actions}>
          <Button
            label="Continue"
            onPress={handleContinue}
            variant="primary"
            size="lg"
            fullWidth
            loading={verifying}
            disabled={verifying}
          />
          <View style={styles.cancelSpacer} />
          <Button
            label="Cancel"
            onPress={onClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={verifying}
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
    gap: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.3,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  codeWrap: {
    marginTop: spacing.sm,
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: semantic.error,
    fontWeight: "500",
  },
  stubHint: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  actions: {
    marginTop: spacing.md,
  },
  cancelSpacer: {
    height: spacing.sm,
  },
});

export default ThreeDSStubSheet;
