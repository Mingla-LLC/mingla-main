// issue #4420 wave 2 (§2.4) — the "Taking you to secure payment" step.
//
// Shown while a hosted payment page (Stripe Checkout, Paystack) opens in this
// tab. If the page is still here after a few seconds (the browser stopped the
// navigation), it offers a real link the guest can press, which is a user
// gesture no blocker stops, and a way back to review. Nothing has been
// charged at this point, and the copy says so.

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import {
  neutralControl,
  neutralHair,
  themeTextAccent,
} from "@mingla/offering-rendering/themePalette";

import { Icon } from "../ui/Icon";

import {
  PAYMENT_HANDOFF_FALLBACK_MS,
  openPaymentPage,
} from "../../payments/openPaymentPage";

export interface SecurePaymentHandoffProps {
  url: string;
  palette: ThemePalette;
  /** "Stripe" or "Paystack": who the guest is about to see. */
  providerName: string;
  /** e.g. "Your table is held until 14:32." Null hides it. */
  holdLine?: string | null;
  onBack: () => void;
  testID?: string;
}

export const SecurePaymentHandoff: React.FC<SecurePaymentHandoffProps> = ({
  url,
  palette,
  providerName,
  holdLine = null,
  onBack,
  testID = "issue-4420-secure-payment",
}: SecurePaymentHandoffProps) => {
  const [stuck, setStuck] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const leftRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const onPageHide = (): void => {
      leftRef.current = true;
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("pagehide", onPageHide);
    }
    openPaymentPage(url).catch((caught: unknown) => {
      if (cancelled) return;
      setOpenError(
        caught instanceof Error ? caught.message : "The payment page could not open. Try again.",
      );
      setStuck(true);
    });
    const timer = setTimeout(() => {
      if (!cancelled && !leftRef.current) setStuck(true);
    }, PAYMENT_HANDOFF_FALLBACK_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
    };
  }, [url]);

  const continueLabel = "Continue to payment";
  const continueButton =
    Platform.OS === "web" ? (
      // A real <a> in this tab: pressing it is a user gesture.
      React.createElement(
        "a",
        {
          href: url,
          target: "_self",
          rel: "noopener",
          role: "link",
          "aria-label": continueLabel,
          "data-testid": `${testID}-continue`,
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 52,
            borderRadius: 999,
            backgroundColor: palette.accent,
            color: palette.accentText,
            fontWeight: 800,
            fontSize: 15,
            textDecoration: "none",
            fontFamily: "inherit",
          },
        },
        continueLabel,
      )
    ) : (
      <Pressable
        onPress={() => {
          void openPaymentPage(url).catch(() => setOpenError("The payment page could not open. Try again."));
        }}
        accessibilityRole="link"
        accessibilityLabel={continueLabel}
        testID={`${testID}-continue`}
        style={[styles.primary, { backgroundColor: palette.accent }]}
      >
        <Text style={[styles.primaryLabel, { color: palette.accentText }]}>{continueLabel}</Text>
      </Pressable>
    );

  return (
    <View
      style={[styles.card, { backgroundColor: palette.card, borderColor: neutralHair(palette) }]}
      testID={testID}
    >
      <View style={[styles.disc, { backgroundColor: palette.accentWash }]}>
        <Icon name="shield" size={22} color={themeTextAccent(palette)} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.primaryText }]}>
        Taking you to secure payment
      </Text>
      <Text style={[styles.body, { color: palette.secondaryText }]}>
        {`${providerName} opens in this tab and brings you back here when you're done.`}
        {holdLine !== null ? ` ${holdLine}` : ""}
      </Text>
      {!stuck ? (
        <View style={styles.openingRow} accessibilityLiveRegion="polite">
          <ActivityIndicator color={palette.primaryText} />
          <Text style={[styles.openingText, { color: palette.secondaryText }]}>
            {`Opening ${providerName}…`}
          </Text>
        </View>
      ) : (
        <View style={styles.fallback} testID={`${testID}-fallback`}>
          <View
            style={[styles.banner, { backgroundColor: palette.accentWash }]}
            accessibilityRole="alert"
          >
            <Text style={[styles.bannerText, { color: palette.primaryText }]}>
              {openError ??
                "Still here after a few seconds? Your browser may have stopped the page. Nothing has been charged."}
            </Text>
          </View>
          {continueButton}
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to review"
            testID={`${testID}-back`}
            style={[styles.ghost, { borderColor: neutralControl(palette) }]}
          >
            <Text style={[styles.ghostLabel, { color: palette.primaryText }]}>Back to review</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 12 },
  disc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800" },
  body: { fontSize: 14.5, lineHeight: 21 },
  openingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  openingText: { fontSize: 14, fontWeight: "600" },
  fallback: { gap: 12, marginTop: 4 },
  banner: { borderRadius: 12, padding: 12 },
  bannerText: { fontSize: 13.5, lineHeight: 19 },
  primary: { minHeight: 52, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 15, fontWeight: "800" },
  ghost: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostLabel: { fontSize: 15, fontWeight: "700" },
});

export default SecurePaymentHandoff;
