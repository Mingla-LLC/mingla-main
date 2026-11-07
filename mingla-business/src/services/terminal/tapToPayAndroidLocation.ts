/**
 * #4271 — the one location permission Tap to Pay on Android needs.
 *
 * Stripe Terminal Android 5.8.0 (bundled by @stripe/stripe-terminal-react-native
 * 0.0.1-beta.33) checks only ACCESS_COARSE_LOCATION before it discovers or
 * connects a reader (AndroidSdkPermissionsValidator), and uses fine location
 * only when it happens to be granted (GPS first, then network). Its manifest
 * caps ACCESS_FINE_LOCATION at API 30, so on Android 12+ a fine-location check
 * is always false. Coarse is what the SDK needs on every API level Tap to Pay
 * runs on (33+), and no Bluetooth permission is involved in a phone tap.
 */
import { PermissionsAndroid } from "react-native";

export const TAP_TO_PAY_ANDROID_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

/** The warm-up never prompts: it only asks whether the permission is there. */
export const hasTapToPayLocation = (): Promise<boolean> =>
  PermissionsAndroid.check(TAP_TO_PAY_ANDROID_LOCATION);

/** A sale asks, with the reason, when someone is actually taking a payment. */
export const requestTapToPayLocation = async (): Promise<boolean> => {
  const result = await PermissionsAndroid.request(TAP_TO_PAY_ANDROID_LOCATION, {
    title: "Location for card payments",
    message:
      "Card payments need to know where they are taken. Mingla Host only uses your location for payments at the door.",
    buttonPositive: "Allow",
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
};
