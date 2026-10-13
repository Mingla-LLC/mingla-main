/**
 * toward #3697 Wave 7 — Add credit / withdraw quote preview sheets.
 *
 * Shows the fee-inclusive split from `ad-credit` quotes. Live card charge
 * and provider refund adapters land in the payment follow-up; this sheet
 * never invents a completed payment.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  AdCreditAppError,
  quoteAdCreditTopUp,
  quoteAdCreditWithdraw,
  type AdCreditTopUpQuote,
  type AdCreditWithdrawQuote,
} from "../../services/adCreditService";
import { formatCurrency, minorFromMajor } from "../../utils/currency";
import { Button } from "../ui/Button";

export type AdCreditQuoteMode = "top_up" | "withdraw";

/** Map edge machine details to host-facing copy (never show raw tokens). */
export function mapAdCreditQuoteError(err: unknown): string {
  if (!(err instanceof AdCreditAppError)) {
    return "Could not quote. Try again.";
  }
  const detail = (err.detail ?? err.message ?? "").trim();
  switch (detail) {
    case "pay_below_minimum":
      return "That amount is below the minimum top-up for this currency.";
    case "pay_above_maximum":
      return "That amount is above the maximum top-up for this currency.";
    case "currency_unsupported":
      return "This currency is not supported for Ads credit yet.";
    case "credit_below_minimum":
    case "credit_invalid":
      return "Enter a valid credit amount to withdraw.";
    case "balance_too_low":
      return "That is more than your available credit.";
    default:
      if (err.code === "forbidden") {
        return "You need finance permission to add or withdraw credit.";
      }
      if (err.code === "unauthorized") {
        return "Sign in again to continue.";
      }
      return "Could not quote. Try again.";
  }
}

export interface AdCreditQuoteSheetProps {
  visible: boolean;
  mode: AdCreditQuoteMode;
  currency: string;
  /** Available credit cents (withdraw max). */
  balanceCents: number;
  canManage: boolean;
  onClose: () => void;
}

export const AdCreditQuoteSheet: React.FC<AdCreditQuoteSheetProps> = ({
  visible,
  mode,
  currency,
  balanceCents,
  canManage,
  onClose,
}) => {
  const [majorText, setMajorText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<AdCreditTopUpQuote | null>(null);
  const [withdraw, setWithdraw] = useState<AdCreditWithdrawQuote | null>(null);

  useEffect(() => {
    if (!visible) {
      setMajorText("");
      setError(null);
      setTopUp(null);
      setWithdraw(null);
      setBusy(false);
    }
  }, [visible]);

  // Editing the amount (or switching mode) invalidates any prior Preview quote.
  useEffect(() => {
    setTopUp(null);
    setWithdraw(null);
    setError(null);
  }, [majorText, mode]);

  const runQuote = useCallback(async () => {
    setError(null);
    setTopUp(null);
    setWithdraw(null);
    const major = Number(majorText);
    if (!Number.isFinite(major) || major <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    const cents = minorFromMajor(major, currency);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "top_up") {
        const q = await quoteAdCreditTopUp(cents, currency);
        setTopUp(q);
      } else {
        if (cents > balanceCents) {
          setError("That is more than your available credit.");
          return;
        }
        const q = await quoteAdCreditWithdraw(cents);
        setWithdraw(q);
      }
    } catch (e) {
      setError(mapAdCreditQuoteError(e));
    } finally {
      setBusy(false);
    }
  }, [balanceCents, currency, majorText, mode]);

  const title = mode === "top_up" ? "Add Ads credit" : "Withdraw credit";
  const hint = mode === "top_up"
    ? "Mingla keeps 15% as the service fee; the rest becomes spendable Ads credit. Min $25 / £20 / ₦25,000."
    : "Unused credit is refunded with its fee (FIFO). Card refund runs when the payment adapter ships.";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet} testID="ad-credit-quote-sheet">
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
        <Text style={styles.label}>Amount ({currency})</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={majorText}
          onChangeText={setMajorText}
          placeholder="0"
          placeholderTextColor={textTokens.tertiary}
          editable={!busy}
          testID="ad-credit-quote-amount"
        />
        {error !== null ? (
          <Text style={styles.error} testID="ad-credit-quote-error">{error}</Text>
        ) : null}
        {topUp !== null ? (
          <View style={styles.quoteBox} testID="ad-credit-topup-quote">
            <Text style={styles.quoteLine}>
              You pay {formatCurrency(topUp.pay_cents, topUp.currency, true)}
            </Text>
            <Text style={styles.quoteLine}>
              Fee {formatCurrency(topUp.fee_cents, topUp.currency, true)}
            </Text>
            <Text style={styles.quoteLineStrong}>
              Credit {formatCurrency(topUp.credit_cents, topUp.currency, true)}
            </Text>
          </View>
        ) : null}
        {withdraw !== null ? (
          <View style={styles.quoteBox} testID="ad-credit-withdraw-quote">
            <Text style={styles.quoteLine}>
              Credit out{" "}
              {formatCurrency(withdraw.credit_cents, currency, true)}
            </Text>
            <Text style={styles.quoteLine}>
              Fee returned{" "}
              {formatCurrency(withdraw.fee_returned_cents, currency, true)}
            </Text>
            <Text style={styles.quoteLineStrong}>
              Est. refund{" "}
              {formatCurrency(withdraw.refund_cents, currency, true)}
            </Text>
            <Text style={styles.quoteNote}>
              Estimate only — live withdraw uses FIFO lots; card refund follows
              the payment adapter.
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={busy ? "Quoting…" : "Preview"}
            onPress={() => {
              void runQuote();
            }}
            disabled={busy || !canManage}
            testID="ad-credit-quote-preview"
          />
          {!canManage ? (
            <Text style={styles.denied}>
              Finance permission is required to add or withdraw credit.
            </Text>
          ) : (
            <Text style={styles.coming}>
              Card charge and refund complete in a follow-up — preview stays
              honest until then.
            </Text>
          )}
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeLink}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        {busy ? (
          <ActivityIndicator
            style={styles.spinner}
            color={textTokens.secondary}
          />
        ) : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    backgroundColor: canvas.discover,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  hint: {
    ...typography.caption,
    color: textTokens.secondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    color: textTokens.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: glass.tint.profileBase,
  },
  error: {
    ...typography.caption,
    color: semantic.errorText,
    marginTop: spacing.sm,
  },
  quoteBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  quoteLine: {
    ...typography.body,
    color: textTokens.secondary,
    marginBottom: 4,
  },
  quoteLineStrong: {
    ...typography.body,
    color: textTokens.primary,
    marginTop: 4,
  },
  quoteNote: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  denied: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  coming: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  closeLink: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
  },
  closeText: {
    ...typography.body,
    color: textTokens.secondary,
  },
  spinner: {
    position: "absolute",
    right: spacing.lg,
    top: spacing.lg,
  },
});
