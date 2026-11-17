// issue #4420 wave 2 (D-V6 / D-S3) — open a hosted payment page.
//
// Web: navigate THIS tab (`location.assign`). The old path awaited a network
// call and then called `Linking.openURL`, which react-native-web turns into
// `window.open` outside the click gesture, so popup blockers stopped it
// silently (payments test, 16 Nov). Same-tab navigation is never a popup.
// Native: the system browser, as before.

import { Linking, Platform } from "react-native";

export interface PaymentPageWindow {
  location: { assign: (url: string) => void };
}

const browserWindow = (): PaymentPageWindow | null =>
  typeof window !== "undefined" && typeof window.location?.assign === "function"
    ? window
    : null;

export const openPaymentPage = async (
  url: string,
  target: PaymentPageWindow | null = browserWindow(),
): Promise<void> => {
  if (Platform.OS === "web") {
    if (target === null) throw new Error("The payment page could not open. Try again.");
    target.location.assign(url);
    return;
  }
  await Linking.openURL(url);
};

/** How long the handoff waits before offering the manual link. */
export const PAYMENT_HANDOFF_FALLBACK_MS = 3000;
