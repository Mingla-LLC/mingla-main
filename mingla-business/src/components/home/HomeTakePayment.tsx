/**
 * #4389 (screen HT) — "Take a payment" for every brand with payments set up:
 * one full-width white button at the bottom of the money panel (Seth: not in
 * two places). Ari reaches the same sale through its start_door_sale tool.
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
  /** Full width of the money panel, 50pt (Seth, #4389 HT). */
  variant: "block";
  onMessage: (message: string) => void;
}

export const TakePaymentButton: React.FC<TakePaymentButtonProps> = ({
  brandId,
  tapToPay,
  variant,
  onMessage,
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const press = (): void => {
    if (busy) return;
    setBusy(true);
    void openTakePayment(router as never, brandId, "home").then((outcome) => {
      setBusy(false);
      if (outcome === "none") onMessage(C.takePayment.noEventToday);
      else if (outcome === "failed") onMessage(C.takePayment.openFailed);
    });
  };
  void variant;
  const label = C.takePayment.pill;
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      hitSlop={8}
      style={({ pressed }) => [styles.block, pressed && styles.pressed]}
      testID="home-take-payment-button"
    >
      {tapToPay ? (
        // The Tap to Pay mark is drawn light; on the white button it sits in a
        // dark disc so it stays visible (the mark itself is never recoloured).
        <View style={styles.markDisc}>
          <TapToPayIcon size={14} />
        </View>
      ) : (
        <Icon name="qr" size={18} color="#101216" />
      )}
      <Text style={styles.blockLabel}>{label}</Text>
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
  block: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.full,
    backgroundColor: "#FFFFFF",
  },
  markDisc: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#101216",
    alignItems: "center",
    justifyContent: "center",
  },
  blockLabel: { ...typography.body, color: "#101216", fontWeight: "700" },
  doorLine: { marginTop: spacing.sm },
  doorText: { ...typography.bodySm, color: textTokens.secondary },
  pressed: { opacity: 0.72 },
});
