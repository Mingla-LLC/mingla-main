/**
 * #4271 — web build of terminalSdk. Tap to Pay never runs on the web, and the
 * Stripe Terminal React Native package must never enter the web bundle.
 */
import type * as TerminalSdkModule from "@stripe/stripe-terminal-react-native";

export type TerminalSdk = typeof TerminalSdkModule;

export const TERMINAL_NATIVE_MODULE_NAME = "StripeTerminalReactNative";

export const isTerminalNativeModulePresent = (): boolean => false;

export const loadTerminalSdk = (): TerminalSdk | null => null;

export const resetTerminalSdkCacheForTests = (): void => {};
