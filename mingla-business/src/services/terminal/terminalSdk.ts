/**
 * #4271 — the ONLY place the Stripe Terminal React Native SDK is loaded.
 *
 * Why lazy: a business binary built before #4271 has no Stripe Terminal native
 * module. An over-the-air update can still deliver this JavaScript to that
 * binary. Expo Router eagerly requires every route at native startup, so a
 * module-scope import of the SDK on that binary would evaluate during boot and
 * could brick the app. Instead the SDK is required inside a function, and only
 * after the native module is confirmed present. When it is absent the app
 * simply hides Tap to Pay (useTapToPayAvailability → "sdk_missing").
 *
 * Web never reaches this file: terminalSdk.web.ts resolves first and returns
 * null, so the package never enters the web bundle.
 *
 * `import type` is erased at compile time and loads nothing.
 */
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";

import type * as TerminalSdkModule from "@stripe/stripe-terminal-react-native";

export type TerminalSdk = typeof TerminalSdkModule;

/** Native module name registered by @stripe/stripe-terminal-react-native. */
export const TERMINAL_NATIVE_MODULE_NAME = "StripeTerminalReactNative";

let cachedSdk: TerminalSdk | null | undefined;

/** True when this binary was built with the Stripe Terminal native module. */
export const isTerminalNativeModulePresent = (): boolean => {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  const fromBridge = (NativeModules as Record<string, unknown>)[
    TERMINAL_NATIVE_MODULE_NAME
  ];
  if (fromBridge !== undefined && fromBridge !== null) return true;
  try {
    return TurboModuleRegistry.get(TERMINAL_NATIVE_MODULE_NAME) !== null;
  } catch {
    // TurboModuleRegistry.get throws only for malformed registries; treat
    // that as "not present" so Tap to Pay stays hidden rather than crashing.
    return false;
  }
};

/**
 * Loads the SDK, or returns null when this binary cannot run it. Never throws.
 * The result is cached for the life of the JS runtime.
 */
export const loadTerminalSdk = (): TerminalSdk | null => {
  if (cachedSdk !== undefined) return cachedSdk;
  if (!isTerminalNativeModulePresent()) {
    cachedSdk = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedSdk = require("@stripe/stripe-terminal-react-native") as TerminalSdk;
  } catch (error) {
    if (__DEV__) {
      console.warn("[#4271] Stripe Terminal SDK failed to load", error);
    }
    cachedSdk = null;
  }
  return cachedSdk;
};

/** Test seam: forget the cached load result. */
export const resetTerminalSdkCacheForTests = (): void => {
  cachedSdk = undefined;
};
