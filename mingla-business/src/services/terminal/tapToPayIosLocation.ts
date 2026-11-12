/**
 * #4389 — location for Tap to Pay on iPhone, asked in SETUP, never at checkout.
 *
 * Apple's Tap to Pay on iPhone requirements (Onboarding): if location is needed,
 * say why on a pre-alert screen during onboarding and request it well before
 * checkout. Stripe Terminal asks iOS itself the first time a payment needs it,
 * which put the system prompt in the middle of a sale (live $1 film), so setup
 * asks first (behind our pre-alert) and a sale never starts until it's answered.
 *
 * Read through the app's own Tap to Pay native module. A binary without these
 * functions answers "unavailable" and keeps the old behaviour.
 */
import { Platform } from "react-native";

export type TapLocationStatus = "granted" | "denied" | "not_determined" | "unavailable";

interface LocationNativeModule {
  locationAuthorization?: () => string;
  requestLocationWhenInUse?: () => Promise<string>;
}

const loadModule = (): LocationNativeModule | null => {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require("expo") as { requireOptionalNativeModule: <T>(name: string) => T | null };
    return expo.requireOptionalNativeModule<LocationNativeModule>("MinglaTapToPayEducation");
  } catch {
    return null;
  }
};

const asStatus = (value: unknown): TapLocationStatus =>
  value === "granted" || value === "denied" || value === "not_determined" ? value : "unavailable";

/** iPhone only; anything else (and an older binary) is "unavailable". */
export const tapLocationStatus = (): TapLocationStatus => {
  const native = loadModule();
  if (native === null || typeof native.locationAuthorization !== "function") return "unavailable";
  try {
    return asStatus(native.locationAuthorization());
  } catch {
    return "unavailable";
  }
};

/** Shows the system prompt (only from setup, after the pre-alert). */
export const requestTapLocation = async (): Promise<TapLocationStatus> => {
  const native = loadModule();
  if (native === null || typeof native.requestLocationWhenInUse !== "function") return "unavailable";
  return asStatus(await native.requestLocationWhenInUse());
};

/** A sale may start: the system prompt can't appear mid-checkout. */
export const tapLocationReadyForSale = (status: TapLocationStatus = tapLocationStatus()): boolean =>
  status === "granted" || status === "unavailable";
