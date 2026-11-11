/**
 * #4389 (screen HT) — "Take a payment" for every brand with payments set up:
 * a white pill in the money panel header and a chip under Home's Ask Ari.
 * Both open the door sale for today's event through `openDoorSale` (one way
 * in, owned by Door mode). The icon is Tap to Pay where it works, else the
 * pay-code (QR) icon. Payments are always for an event's tickets.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { trackBrandSetup } from "../brand/brandSetupAnalytics";
import { TapToPayIcon } from "../door/tap/TapToPayIcon";
import { Icon } from "../ui/Icon";
import { HOME_SETUP_COPY as C } from "./homeSetupCopy";

export type TakePaymentOutcome = "opened" | "picker" | "none" | "failed";

/** Open the door sale for this brand; never throws. */
export async function openTakePayment(
  router: { push: (href: never) => void },
  brandId: string,
  source: "home" | "ari",
): Promise<TakePaymentOutcome> {
  trackBrandSetup("take_payment_opened", { source, brand_id: brandId });
  try {
    // Door mode owns the route; loaded on tap so Home's boot path stays light.
    const { openDoorSale } = await import("../../utils/openDoorSale");
    return await openDoorSale(router, brandId, null, { source });
  } catch (error) {
    console.warn("[home-take-payment] could not open the door sale", error);
    return "failed";
  }
}

export interface TakePaymentButtonProps {
  brandId: string;
  /** Tap to Pay works for this brand on this phone (else the QR icon). */
  tapToPay: boolean;
  variant: "pill" | "chip";
  source?: "home" | "ari";
  onMessage: (message: string) => void;
}

export const TakePaymentButton: React.FC<TakePaymentButtonProps> = ({
  brandId,
  tapToPay,
  variant,
  source = "home",
  onMessage,
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const press = (): void => {
    if (busy) return;
    setBusy(true);
    void openTakePayment(router as never, brandId, source).then((outcome) => {
      setBusy(false);
      if (outcome === "none") onMessage(C.takePayment.noEventToday);
      else if (outcome === "failed") onMessage(C.takePayment.openFailed);
    });
  };
  const pill = variant === "pill";
  const label = pill ? C.takePayment.pill : C.takePayment.chip;
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      hitSlop={8}
      style={({ pressed }) => [pill ? styles.pill : styles.chip, pressed && styles.pressed]}
      testID={pill ? "home-take-payment-pill" : "home-take-payment-chip"}
    >
      {tapToPay ? (
        // The Tap to Pay mark is drawn light; on the white pill it sits in a
        // dark disc so it stays visible (the mark itself is never recoloured).
        <View style={pill ? styles.markDisc : null}>
          <TapToPayIcon size={pill ? 12 : 14} />
        </View>
      ) : (
        <Icon name="qr" size={14} color={pill ? "#101216" : textTokens.primary} />
      )}
      <Text style={pill ? styles.pillLabel : styles.chipLabel}>{label}</Text>
    </Pressable>
  );
};

/** "At the door today · {n} sales · {amount}". */
export const DoorTodayLine: React.FC<{
  count: number;
  totalMajor: number;
  currency: string;
}> = ({ count, totalMajor, currency }) => (
  <View style={styles.doorLine} testID="home-door-today">
    <Text style={styles.doorText}>
      {C.takePayment.atDoorToday(count, formatCurrency(totalMajor, currency))}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radiusTokens.full,
    backgroundColor: "#FFFFFF",
  },
  markDisc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#101216",
    alignItems: "center",
    justifyContent: "center",
  },
  pillLabel: { ...typography.caption, color: "#101216", fontWeight: "700" },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: spacing.sm,
  },
  chipLabel: { ...typography.bodySm, color: textTokens.primary, fontWeight: "600" },
  doorLine: { marginTop: spacing.xs },
  doorText: { ...typography.bodySm, color: textTokens.secondary },
  pressed: { opacity: 0.72 },
});
