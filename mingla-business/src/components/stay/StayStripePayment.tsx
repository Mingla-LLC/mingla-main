import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { StayPaymentSession } from "@mingla/brand-rendering/stayGuest";

import { color } from "../../constants/designSystem";
// Native fallback. Metro resolves StayStripePayment.web.tsx for buyer web.
export function StayStripePayment(_props: {
  session: Extract<StayPaymentSession, { provider: "stripe" }>;
  groupId: string;
  accent: string;
  palette?: import("@mingla/offering-rendering").ThemePalette;
  onComplete: () => void;
  returnUrl?: string;
}): React.ReactElement {
  return (
    <View style={styles.host}>
      <Text style={styles.text}>
        Open this Stay on buyer web or the Mingla consumer app to pay.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { padding: 16 },
  text: { color: color.textStrong, fontSize: 14, lineHeight: 20 },
});
