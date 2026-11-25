/**
 * #4490 Explorer W1 — where an app payment returns when the app did not catch
 * the return (/paid/visit/<groupId>, /paid/plan/<subscriptionId>). It calls
 * nothing and shows no booking data: one line and one button that reopens the
 * Mingla app on the purchase. An id that is not a UUID shows the same page
 * without the button (never a dead tap).
 */
import React from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, radius, space, type } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AppPaymentReturnKind = "visit" | "plan";

export const APP_PAYMENT_RETURN_COPY = {
  title: "Payment received",
  visit: "Go back to the Mingla app to see your booking.",
  plan: "Go back to the Mingla app to see your plan.",
  button: "Open Mingla",
} as const;

/** The app link for a purchase, or null for an id that is not a UUID. */
export function appPurchaseLink(kind: AppPaymentReturnKind, id: string | null): string | null {
  if (id === null || !UUID.test(id)) return null;
  const route = kind === "visit" ? "venue_booking" : "venue_membership";
  return `com.mingla.app.v2://purchases/${route}/${id.toLowerCase()}`;
}

export function AppPaymentReturn({
  kind,
  id,
}: {
  kind: AppPaymentReturnKind;
  id: string | null;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const link = appPurchaseLink(kind, id);
  const open = (): void => {
    if (link === null) return;
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(link);
    else void Linking.openURL(link);
  };
  return (
    <View style={[styles.host, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[8] }]} testID="app-payment-return">
      <View style={styles.card}>
        <View style={styles.tick}>
          <Icon name="check" size={34} color={color.successText} />
        </View>
        <Text style={styles.title} accessibilityRole="header">{APP_PAYMENT_RETURN_COPY.title}</Text>
        <Text style={styles.body}>{APP_PAYMENT_RETURN_COPY[kind]}</Text>
        {link !== null ? (
          <Button label={APP_PAYMENT_RETURN_COPY.button} variant="primary" size="lg" onPress={open} testID="app-payment-return-open" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas, paddingHorizontal: space[5] },
  card: { width: "100%", maxWidth: 440, alignSelf: "center", alignItems: "center", gap: space[4] },
  tick: { width: 72, height: 72, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color.successTint },
  title: { ...type.title, color: color.text1, textAlign: "center" },
  body: { ...type.body, color: color.text2, textAlign: "center" },
});
