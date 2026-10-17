/**
 * toward #3697 Wave 7 / 7b — Add credit / withdraw sheets.
 *
 * Top-up (USD/GBP): Preview → Confirm and pay → platform Stripe → apply.
 * Withdraw stays quote-only until the refund adapter ships.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
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
import { useAdCreditTopUpPay } from "../../payments/useAdCreditTopUpPay";
import { mapAdCreditQuoteError } from "../../services/adCreditQuoteErrors";
import {
  applyAdCreditTopUp,
  applyAdCreditWithdraw,
  quoteAdCreditTopUp,
  quoteAdCreditWithdraw,
  startAdCreditTopUp,
  type AdCreditTopUpQuote,
  type AdCreditWithdrawQuote,
} from "../../services/adCreditService";
import { formatCurrency, minorFromMajor } from "../../utils/currency";
import { randomId } from "../../utils/randomId";
import { Button } from "../ui/Button";

export type AdCreditQuoteMode = "top_up" | "withdraw";

export interface AdCreditQuoteSheetProps {
  visible: boolean;
  mode: AdCreditQuoteMode;
  brandId: string;
  currency: string;
  /** Available credit cents (withdraw max). */
  balanceCents: number;
  canManage: boolean;
  onClose: () => void;
  /** Called after a verified top-up lands in the wallet. */
  onTopUpApplied?: () => void;
}

function adsReturnUrl(): string | undefined {
  // Native: Host deep link so Paystack/Stripe can return into the Ads screen
  // (ad-credit allows mingla-business://; ads/index reads reference params).
  if (Platform.OS !== "web") return "mingla-business://marketing/ads";
  if (typeof window === "undefined" || !window.location?.origin) return undefined;
  // Host web Ads route (tabs group is omitted in the public path).
  return `${window.location.origin}/marketing/ads`;
}

export const AdCreditQuoteSheet: React.FC<AdCreditQuoteSheetProps> = ({
  visible,
  mode,
  brandId,
  currency,
  balanceCents,
  canManage,
  onClose,
  onTopUpApplied,
}) => {
  const presentPay = useAdCreditTopUpPay();
  const [majorText, setMajorText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<AdCreditTopUpQuote | null>(null);
  const [withdraw, setWithdraw] = useState<AdCreditWithdrawQuote | null>(null);
  // Stable per Confirm attempt so start_top_up / apply_withdraw retries stay idempotent.
  const topUpIdemRef = useRef<string>("");
  const withdrawIdemRef = useRef<string>("");

  useEffect(() => {
    if (!visible) {
      setMajorText("");
      setError(null);
      setTopUp(null);
      setWithdraw(null);
      setBusy(false);
      topUpIdemRef.current = "";
      withdrawIdemRef.current = "";
    }
  }, [visible]);

  // Editing the amount (or switching mode) invalidates any prior Preview quote.
  useEffect(() => {
    setTopUp(null);
    setWithdraw(null);
    setError(null);
    topUpIdemRef.current = "";
    withdrawIdemRef.current = "";
  }, [majorText, mode]);

  useEffect(() => {
    if (topUp !== null && topUpIdemRef.current.length === 0) {
      topUpIdemRef.current = randomId();
    }
    if (topUp === null) {
      topUpIdemRef.current = "";
    }
  }, [topUp]);

  useEffect(() => {
    if (withdraw !== null && withdrawIdemRef.current.length === 0) {
      withdrawIdemRef.current = randomId();
    }
    if (withdraw === null) {
      withdrawIdemRef.current = "";
    }
  }, [withdraw]);

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
        const q = await quoteAdCreditTopUp(brandId, cents);
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
  }, [balanceCents, brandId, currency, majorText, mode]);

  const runConfirmTopUp = useCallback(async () => {
    if (topUp === null) return;
    setError(null);
    setBusy(true);
    try {
      if (topUpIdemRef.current.length === 0) {
        topUpIdemRef.current = randomId();
      }
      const returnUrl = adsReturnUrl();
      const started = await startAdCreditTopUp({
        brandId,
        payCents: topUp.pay_cents,
        returnUrl,
        idempotencyKey: topUpIdemRef.current,
      });
      const pay = await presentPay(started);
      if (pay.outcome === "redirected") {
        // Web leaves for Checkout; apply runs on return to Ads.
        return;
      }
      if (pay.outcome === "canceled") {
        setError("Payment canceled. Credit was not added.");
        return;
      }
      if (pay.outcome === "failed") {
        setError(pay.message);
        return;
      }
      await applyAdCreditTopUp({
        brandId,
        paymentRef: pay.paymentIntentId,
        idempotencyKey: `top_up:${pay.paymentIntentId}`,
      });
      topUpIdemRef.current = "";
      onTopUpApplied?.();
      onClose();
    } catch (e) {
      setError(mapAdCreditQuoteError(e));
    } finally {
      setBusy(false);
    }
  }, [brandId, onClose, onTopUpApplied, presentPay, topUp]);

  const runConfirmWithdraw = useCallback(async () => {
    if (withdraw === null) return;
    setError(null);
    setBusy(true);
    try {
      if (withdrawIdemRef.current.length === 0) {
        withdrawIdemRef.current = randomId();
      }
      await applyAdCreditWithdraw({
        brandId,
        creditCents: withdraw.credit_cents,
        idempotencyKey: withdrawIdemRef.current,
      });
      withdrawIdemRef.current = "";
      onTopUpApplied?.();
      onClose();
    } catch (e) {
      setError(mapAdCreditQuoteError(e));
    } finally {
      setBusy(false);
    }
  }, [brandId, onClose, onTopUpApplied, withdraw]);

  const title = mode === "top_up" ? "Add Ads credit" : "Withdraw credit";
  const hint = mode === "top_up"
    ? "Mingla keeps 15% as the service fee; the rest becomes spendable Ads credit in your brand's verified settlement currency."
    : "Unused credit is refunded with its fee (FIFO) to the original payment method.";

  const topUpPayReady =
    mode === "top_up" &&
    topUp !== null;
  const withdrawReady = mode === "withdraw" && withdraw !== null;

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
              Confirm refunds to the original top-up payment(s) via FIFO lots.
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={busy ? "Working…" : "Preview"}
            onPress={() => {
              void runQuote();
            }}
            disabled={busy || !canManage}
            testID="ad-credit-quote-preview"
          />
          {topUpPayReady && canManage ? (
            <Button
              label={busy ? "Paying…" : "Confirm and pay"}
              onPress={() => {
                void runConfirmTopUp();
              }}
              disabled={busy}
              testID="ad-credit-quote-confirm-pay"
            />
          ) : null}
          {withdrawReady && canManage ? (
            <Button
              label={busy ? "Refunding…" : "Confirm withdraw"}
              onPress={() => {
                void runConfirmWithdraw();
              }}
              disabled={busy}
              testID="ad-credit-quote-confirm-withdraw"
            />
          ) : null}
          {!canManage ? (
            <Text style={styles.denied}>
              Finance permission is required to add or withdraw credit.
            </Text>
          ) : null}
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
