/**
 * PaymentElementStub — Cycle 8 stub Stripe Payment Element.
 *
 * 4 method tabs: Card / Apple Pay / Google Pay / (PayPal reserved for
 * B-cycle, not rendered).
 *   - Card: 4 stub Inputs (Number, Expiry, CVC, Postcode). Hint copy
 *     "Stub mode — no card data is sent or stored."
 *   - Apple Pay: shown on iOS + Web Safari only. Visual mock button.
 *   - Google Pay: shown on Android + Web Chrome only. Visual mock button.
 *
 * Resolves payment after 1.2s mock processing → "ok" | "requiresAction"
 * (when __DEV__ Force-3DS ticked) | "declined" (when __DEV__ Force-decline
 * ticked).
 *
 * [TRANSITIONAL] No real Stripe SDK import. Replaced in B3 by a wrapper
 * around `<StripePaymentElement>` from `@stripe/stripe-react-native`
 * (already in package.json but not imported here). EXIT CONDITION: B3
 * server-side payment intent creation + Stripe Element + 3DS native
 * handler land together.
 *
 * Per Cycle 8 spec §4.8.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Spinner } from "../ui/Spinner";

export type PaymentMethodId = "card" | "apple_pay" | "google_pay";
export type PaymentResult = "ok" | "requiresAction" | "declined";

export interface PaymentElementStubProps {
  /** Caller fires when user taps the Pay button. */
  onPay: (method: PaymentMethodId, result: PaymentResult) => void;
  /** Set true while parent screen is processing — disables tabs + buttons. */
  processing: boolean;
  /** GBP whole-units total — rendered into the Apple/Google Pay button label. */
  totalGbp: number;
}

// Web platform sniffing — mirrors Cycle 6's pattern. On web, the
// userAgent reveals Safari vs Chrome. On native, Platform.OS is enough.
const isWeb = Platform.OS === "web";
const userAgent: string = (() => {
  if (!isWeb) return "";
  const nav = (globalThis as unknown as { navigator?: { userAgent?: string } })
    .navigator;
  return nav?.userAgent ?? "";
})();
const isWebSafari = isWeb && /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent);
const isWebChrome = isWeb && /Chrome|Chromium/i.test(userAgent);
const showApplePay = Platform.OS === "ios" || isWebSafari;
const showGooglePay = Platform.OS === "android" || isWebChrome;

const PROCESSING_MS = 1200;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface MethodTab {
  id: PaymentMethodId;
  label: string;
  icon: IconName;
}

const formatGbpInline = (n: number): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(n);

export const PaymentElementStub: React.FC<PaymentElementStubProps> = ({
  onPay,
  processing,
  totalGbp,
}) => {
  const [activeTab, setActiveTab] = useState<PaymentMethodId>("card");
  const [cardNumber, setCardNumber] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");
  const [cvc, setCvc] = useState<string>("");
  const [postcode, setPostcode] = useState<string>("");
  const [force3DS, setForce3DS] = useState<boolean>(false);
  const [forceDecline, setForceDecline] = useState<boolean>(false);

  const tabs = useMemo<MethodTab[]>(() => {
    const t: MethodTab[] = [{ id: "card", label: "Card", icon: "ticket" }];
    if (showApplePay) t.push({ id: "apple_pay", label: "Apple Pay", icon: "apple" });
    if (showGooglePay) t.push({ id: "google_pay", label: "Google Pay", icon: "google" });
    return t;
  }, []);

  const handlePay = useCallback(
    async (method: PaymentMethodId): Promise<void> => {
      if (processing) return;
      // Caller will set processing=true on its side via onPay callback flow;
      // we simulate the network roundtrip here and resolve.
      await sleep(PROCESSING_MS);
      const result: PaymentResult = force3DS
        ? "requiresAction"
        : forceDecline
          ? "declined"
          : "ok";
      onPay(method, result);
    },
    [processing, force3DS, forceDecline, onPay],
  );

  return (
    <GlassCard variant="base" radius="lg" padding={spacing.md}>
      {/* Method tabs */}
      <View style={styles.tabsRow}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Pressable
              key={tab.id}
              onPress={() => !processing && setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled: processing }}
              accessibilityLabel={tab.label}
              disabled={processing}
              style={({ pressed }) => [
                styles.tab,
                active && styles.tabActive,
                pressed && !processing && styles.tabPressed,
                processing && styles.tabDisabled,
              ]}
            >
              <Icon
                name={tab.icon}
                size={16}
                color={active ? accent.warm : textTokens.tertiary}
              />
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Method body */}
      {activeTab === "card" ? (
        <View style={styles.methodBody}>
          <View style={styles.cardFieldFull}>
            <Input
              value={cardNumber}
              onChangeText={setCardNumber}
              variant="number"
              placeholder="Card number"
              accessibilityLabel="Card number"
              disabled={processing}
            />
          </View>
          <View style={styles.cardFieldRow}>
            <View style={styles.cardFieldHalf}>
              <Input
                value={expiry}
                onChangeText={setExpiry}
                variant="text"
                placeholder="MM/YY"
                accessibilityLabel="Expiry"
                disabled={processing}
              />
            </View>
            <View style={styles.cardFieldHalf}>
              <Input
                value={cvc}
                onChangeText={setCvc}
                variant="number"
                placeholder="CVC"
                accessibilityLabel="CVC"
                disabled={processing}
              />
            </View>
          </View>
          <View style={styles.cardFieldFull}>
            <Input
              value={postcode}
              onChangeText={setPostcode}
              variant="text"
              placeholder="Postcode"
              accessibilityLabel="Postcode"
              disabled={processing}
            />
          </View>
          <Text style={styles.hint}>
            Stub mode — no card data is sent or stored.
          </Text>
        </View>
      ) : null}

      {activeTab === "apple_pay" ? (
        <View style={styles.methodBody}>
          <Pressable
            onPress={() => handlePay("apple_pay")}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel={`Pay with Apple Pay, ${formatGbpInline(totalGbp)}`}
            style={({ pressed }) => [
              styles.platformPayBtn,
              styles.platformPayBtnApple,
              pressed && !processing && styles.platformPayBtnPressed,
              processing && styles.platformPayBtnDisabled,
            ]}
          >
            {processing ? (
              <Spinner size={24} color="#ffffff" />
            ) : (
              <>
                <Icon name="apple" size={20} color="#ffffff" />
                <Text style={styles.platformPayLabel}>
                  Pay {formatGbpInline(totalGbp)}
                </Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>Stub mode — no charge is processed.</Text>
        </View>
      ) : null}

      {activeTab === "google_pay" ? (
        <View style={styles.methodBody}>
          <Pressable
            onPress={() => handlePay("google_pay")}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel={`Pay with Google Pay, ${formatGbpInline(totalGbp)}`}
            style={({ pressed }) => [
              styles.platformPayBtn,
              styles.platformPayBtnGoogle,
              pressed && !processing && styles.platformPayBtnPressed,
              processing && styles.platformPayBtnDisabled,
            ]}
          >
            {processing ? (
              <Spinner size={24} color="#ffffff" />
            ) : (
              <>
                <Icon name="google" size={20} color="#ffffff" />
                <Text style={styles.platformPayLabel}>
                  Pay {formatGbpInline(totalGbp)}
                </Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>Stub mode — no charge is processed.</Text>
        </View>
      ) : null}

      {/* __DEV__ test toggles (hidden in production builds) */}
      {__DEV__ ? (
        <View style={styles.devTogglesWrap}>
          <Text style={styles.devTogglesHeading}>Dev test toggles</Text>
          <Pressable
            onPress={() => setForce3DS((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: force3DS }}
            style={styles.devToggleRow}
          >
            <View
              style={[styles.devToggleBox, force3DS && styles.devToggleBoxOn]}
            >
              {force3DS ? (
                <Icon name="check" size={12} color={textTokens.primary} />
              ) : null}
            </View>
            <Text style={styles.devToggleLabel}>
              Force 3DS challenge (stub only)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setForceDecline((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: forceDecline }}
            style={styles.devToggleRow}
          >
            <View
              style={[
                styles.devToggleBox,
                forceDecline && styles.devToggleBoxOn,
              ]}
            >
              {forceDecline ? (
                <Icon name="check" size={12} color={textTokens.primary} />
              ) : null}
            </View>
            <Text style={styles.devToggleLabel}>
              Force decline (stub only)
            </Text>
          </Pressable>
        </View>
      ) : null}
    </GlassCard>
  );
};

/**
 * Caller-side helper — Card method's "Pay" button is in the parent screen's
 * sticky bottom bar, not this component. Parent calls this to run the same
 * 1.2s stub processing logic Apple/Google Pay use internally.
 */
export const runCardPaymentStub = async (
  force3DS: boolean,
  forceDecline: boolean,
): Promise<PaymentResult> => {
  await sleep(PROCESSING_MS);
  return force3DS ? "requiresAction" : forceDecline ? "declined" : "ok";
};

const styles = StyleSheet.create({
  tabsRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  tabActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  tabPressed: {
    opacity: 0.7,
  },
  tabDisabled: {
    opacity: 0.5,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
  tabLabelActive: {
    color: textTokens.primary,
  },
  methodBody: {
    gap: spacing.sm,
  },
  cardFieldFull: {
    marginBottom: 0,
  },
  cardFieldRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cardFieldHalf: {
    flex: 1,
  },
  hint: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  platformPayBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.lg,
  },
  platformPayBtnApple: {
    backgroundColor: "#000000",
  },
  platformPayBtnGoogle: {
    backgroundColor: "#000000",
  },
  platformPayBtnPressed: {
    opacity: 0.85,
  },
  platformPayBtnDisabled: {
    opacity: 0.5,
  },
  platformPayLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  devTogglesWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  devTogglesHeading: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: semantic.warning,
    marginBottom: spacing.xs,
  },
  devToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  devToggleBox: {
    width: 18,
    height: 18,
    borderRadius: radiusTokens.sm,
    borderWidth: 1.5,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  devToggleBoxOn: {
    backgroundColor: semantic.warning,
    borderColor: semantic.warning,
  },
  devToggleLabel: {
    fontSize: 12,
    color: textTokens.secondary,
  },
});

export default PaymentElementStub;
