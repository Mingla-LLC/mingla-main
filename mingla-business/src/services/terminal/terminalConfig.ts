/**
 * #4271 — Tap to Pay runtime switches.
 *
 * Simulated reader: follows the Stripe key mode, never the build type.
 * A simulated reader only works with test-mode keys, so a development build
 * pointed at production (live publishable key) must connect the real reader;
 * otherwise Stripe Terminal shows "tap to simulate payment" and the server then
 * fails the payment.
 *
 * - pk_test_ key: simulated.
 * - EXPO_PUBLIC_TERMINAL_SIMULATED=1: simulated only when the key is not live.
 * - pk_live_ key: never simulated, even with the env set (a warning is logged).
 * - no key: not simulated.
 */

export type TerminalSimulationInputs = {
  publishableKey: string | null | undefined;
  simulatedFlag: string | null | undefined;
};

let warnedLiveOverride = false;

/** Pure decision, unit-tested with injected values. */
export const resolveTerminalSimulated = (
  { publishableKey, simulatedFlag }: TerminalSimulationInputs,
  warn: (message: string) => void = (message) => console.warn(message),
): boolean => {
  const key = (publishableKey ?? "").trim();
  const flagOn = simulatedFlag === "1";
  if (key.startsWith("pk_live_")) {
    if (flagOn && !warnedLiveOverride) {
      warnedLiveOverride = true;
      warn(
        "[tap-to-pay] EXPO_PUBLIC_TERMINAL_SIMULATED=1 ignored: the publishable key is live, so the real reader is used.",
      );
    }
    return false;
  }
  if (key.startsWith("pk_test_")) return true;
  return flagOn && key.length > 0;
};

/**
 * The publishable key the app uses: app config extra first, then the inlined
 * env (same source order as the native Stripe payment sheet).
 */
const readPublishableKey = (): string | null => {
  let fromExtra: string | undefined;
  try {
    fromExtra = (
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("expo-constants").default?.expoConfig?.extra as
        | { EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string }
        | undefined
    )?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  } catch (error) {
    console.warn("[tap-to-pay] could not read app config for the Stripe key", error);
  }
  // An empty or blank app config value falls back to the inlined env.
  const extraKey = (fromExtra ?? "").trim();
  const key = extraKey.length > 0
    ? extraKey
    : (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").trim();
  return key.length > 0 ? key : null;
};

export const isTerminalSimulated = (): boolean =>
  resolveTerminalSimulated({
    publishableKey: readPublishableKey(),
    simulatedFlag: process.env.EXPO_PUBLIC_TERMINAL_SIMULATED,
  });
