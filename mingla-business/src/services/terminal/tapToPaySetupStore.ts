/**
 * #4271 — remembers, on this phone only, that Tap to Pay setup finished
 * (device check passed and Apple's "How to Tap" education was shown).
 *
 * This is a per-device client preference, not server state. Apple's Tap to Pay
 * terms are accepted per Stripe account on the first reader connection, which the
 * sale screen handles; this flag only decides whether the door sheet says
 * "Set up once on this phone" or "Take a card or phone on this iPhone".
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const TAP_TO_PAY_SETUP_KEY = "mingla.tapToPay.setupComplete.v1";

type Listener = (complete: boolean) => void;
const listeners = new Set<Listener>();
let cached: boolean | null = null;

export const readTapToPaySetupComplete = async (): Promise<boolean> => {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(TAP_TO_PAY_SETUP_KEY)) === "1";
  } catch (error) {
    // Unreadable storage: ask for setup again (it is short and repeatable).
    if (__DEV__) console.warn("[#4271] could not read Tap to Pay setup flag", error);
    cached = false;
  }
  return cached;
};

export const markTapToPaySetupComplete = async (): Promise<void> => {
  cached = true;
  listeners.forEach((listener) => listener(true));
  await AsyncStorage.setItem(TAP_TO_PAY_SETUP_KEY, "1");
};

export const subscribeTapToPaySetup = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test seam. */
export const resetTapToPaySetupCacheForTests = (): void => {
  cached = null;
  listeners.clear();
};
