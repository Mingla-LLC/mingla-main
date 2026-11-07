/**
 * #4271 — a per-brand hint, on this phone only: "this brand set up Tap to Pay
 * here, so it's worth warming the reader up."
 *
 * It is NOT status. Whether Apple's terms are accepted is Apple's answer, read by
 * connecting (tapToPaySession `acceptance`), and an iPhone never decides it from
 * this flag alone. Android has no Apple terms, so there this hint is also its
 * setup-done flag.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

/** The old phone-wide flag: it could say a second brand was set up. Removed on read. */
export const TAP_TO_PAY_LEGACY_SETUP_KEY = "mingla.tapToPay.setupComplete.v1";

export const tapToPayWarmHintKey = (brandId: string): string =>
  `mingla.tapToPay.warmHint.v2.${brandId}`;

type Listener = (brandId: string, hint: boolean) => void;
const listeners = new Set<Listener>();
const cached = new Map<string, boolean>();
let legacyRemoved = false;

const removeLegacyKey = (): void => {
  if (legacyRemoved) return;
  legacyRemoved = true;
  void AsyncStorage.removeItem(TAP_TO_PAY_LEGACY_SETUP_KEY).catch((error: unknown) => {
    if (__DEV__) console.warn("[#4271] could not remove the old Tap to Pay flag", error);
  });
};

export const readTapToPayWarmHint = async (brandId: string): Promise<boolean> => {
  removeLegacyKey();
  const known = cached.get(brandId);
  if (known !== undefined) return known;
  let hint = false;
  try {
    hint = (await AsyncStorage.getItem(tapToPayWarmHintKey(brandId))) === "1";
  } catch (error) {
    // Unreadable storage: no warm-up, and Android asks for setup again (short and repeatable).
    if (__DEV__) console.warn("[#4271] could not read the Tap to Pay hint", error);
  }
  cached.set(brandId, hint);
  return hint;
};

export const markTapToPayWarmHint = async (brandId: string): Promise<void> => {
  cached.set(brandId, true);
  listeners.forEach((listener) => listener(brandId, true));
  await AsyncStorage.setItem(tapToPayWarmHintKey(brandId), "1");
};

export const subscribeTapToPayWarmHint = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test seam. */
export const resetTapToPayWarmHintForTests = (): void => {
  cached.clear();
  listeners.clear();
  legacyRemoved = false;
};
