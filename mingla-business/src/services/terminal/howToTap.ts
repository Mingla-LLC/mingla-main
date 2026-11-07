/**
 * #4271 — Apple's "How to Tap" education for Tap to Pay on iPhone.
 *
 * Apple requires this overlay when a merchant enables Tap to Pay on iPhone. It
 * comes from Apple's ProximityReaderDiscovery (iOS 18+) through the local Expo
 * module in mingla-business/modules/mingla-tap-to-pay-education. The Stripe
 * Terminal SDK has no helper for it.
 *
 * The native module is looked up lazily and optionally: a binary without it
 * (older build, Android, web) returns "unavailable" and the setup screen's own
 * explanation stands in, as Apple allows before iOS 18.
 */
import { Platform } from "react-native";

interface HowToTapNativeModule {
  isEntitled(): boolean;
  isAvailable(): Promise<boolean>;
  showHowToTap(): Promise<boolean>;
}

export type HowToTapResult = "shown" | "unavailable";

const loadModule = (): HowToTapNativeModule | null => {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require("expo") as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    return expo.requireOptionalNativeModule<HowToTapNativeModule>("MinglaTapToPayEducation");
  } catch {
    return null;
  }
};

/**
 * The binary half of the release gate: was this iPhone build made with Apple's
 * Tap to Pay entitlement? Read from Info.plist through the module, so an
 * over-the-air update cannot turn it on. No module means no: an older binary
 * stays hidden.
 */
export const isTapToPayIphoneEntitled = (): boolean => {
  const native = loadModule();
  if (native === null || typeof native.isEntitled !== "function") return false;
  try {
    return native.isEntitled() === true;
  } catch {
    return false;
  }
};

/** Shows Apple's How to Tap sheet when this iPhone supports it. Throws if presenting fails. */
export const showHowToTapEducation = async (): Promise<HowToTapResult> => {
  const native = loadModule();
  if (native === null) return "unavailable";
  if (!(await native.isAvailable())) return "unavailable";
  return (await native.showHowToTap()) ? "shown" : "unavailable";
};
