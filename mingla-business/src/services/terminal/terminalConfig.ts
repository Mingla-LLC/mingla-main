/**
 * #4271 — Tap to Pay runtime switches.
 *
 * Simulated reader: on in development builds, or when a build sets
 * EXPO_PUBLIC_TERMINAL_SIMULATED=1 (internal test builds against Stripe test
 * mode). A simulated reader only works with test-mode keys; live builds leave
 * it off so a real card is required.
 */
export const isTerminalSimulated = (): boolean =>
  (typeof __DEV__ !== "undefined" && __DEV__) ||
  process.env.EXPO_PUBLIC_TERMINAL_SIMULATED === "1";
