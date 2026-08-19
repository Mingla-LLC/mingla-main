/**
 * #2306 [secure-random-ota-guard] — the SOLE owner of the
 * `react-native-get-random-values` require in mingla-business.
 *
 * WHY: #1774 (merged 2026-08-13) added this polyfill AFTER the last shipped
 * native builds of 1.1.2 and 1.1.4, so those binaries carry no RNGetRandomValues
 * native module. The package installs `crypto.getRandomValues` as a top-level
 * side effect and touches the native module while doing it, so a bare static
 * import throws AT MODULE EVAL on every OTA install whose binary predates the
 * dependency — the same failure shape as the netinfo brick documented in
 * src/lib/netinfoSafe.ts (COMMS-0138) and the 2026-07-02 stuck-on-splash.
 *
 * That is what blocks #2107's update gate from being delivered to Host 1.1.4
 * and Host 1.1.2 by OTA — the very installs the gate exists to move forward.
 *
 * CONTRACT:
 * - Native module PRESENT (1.1.5 and later): the polyfill installs exactly as
 *   before and `crypto.getRandomValues` is available — zero behaviour change.
 * - Native module ABSENT (1.1.2 / 1.1.4 binaries): the require throws, is
 *   caught here once at module eval, and callers see whatever `globalThis.crypto`
 *   already offers. Callers MUST handle its absence; this module deliberately
 *   does NOT substitute a Math.random fallback, because the caller asked for
 *   cryptographic randomness and quietly weakening it would be worse than
 *   failing.
 * - No other mingla-business file may import or require this package —
 *   enforced by .github/scripts/strict-grep/issue-2306-lazy-native-imports.mjs.
 */

let installed = false;

export function ensureSecureRandom(): boolean {
  if (installed) return true;
  try {
    // Dynamic require so a missing RNGetRandomValues native module throws HERE,
    // inside the catch — never at route eval.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-get-random-values");
    installed = true;
    return true;
  } catch (err) {
    // Expected on every binary built before 2026-08-13. NOT silent: one
    // boot-time warn keeps the degrade diagnosable without crashing eval.
    console.warn(
      "[secureRandomSafe] RNGetRandomValues native module unavailable — secure id generation will fail until the next native build ships it.",
      err,
    );
    return false;
  }
}
