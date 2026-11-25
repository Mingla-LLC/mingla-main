/**
 * #4490 — the Mingla wordmark at the top of the guest pay pages
 * (/pay/<token>, /pay/till/<code>, /pay/door/<code>): the real logo, not the
 * word typed out. Native: the bundled wordmark image. The web build resolves
 * GuestPayWordmark.web.tsx instead (a plain <img> of /brand/mingla-wordmark.png,
 * as BusinessWelcomeScreen draws it), so the web bundle never carries the
 * image asset. One small component for all three pages.
 */
import React from "react";
import { Image, StyleSheet } from "react-native";
import { MINGLA_WORDMARK } from "@mingla/brand-assets";

/** 30 high in the logo's own 1356 x 480 proportions; labelled "Mingla". */
export const GUEST_PAY_WORDMARK = {
  label: "Mingla",
  webSrc: "/brand/mingla-wordmark.png",
  height: 30,
  width: Math.round((30 * 1356) / 480),
} as const;

export function GuestPayWordmark(): React.ReactElement {
  return (
    <Image
      source={MINGLA_WORDMARK}
      style={styles.logo}
      resizeMode="contain"
      accessibilityLabel={GUEST_PAY_WORDMARK.label}
      accessibilityRole="image"
      testID="guest-pay-wordmark"
    />
  );
}

const styles = StyleSheet.create({
  logo: { width: GUEST_PAY_WORDMARK.width, height: GUEST_PAY_WORDMARK.height },
});
