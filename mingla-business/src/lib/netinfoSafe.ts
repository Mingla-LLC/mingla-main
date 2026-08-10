/**
 * #1758 [netinfo-ota-guard] — the SOLE owner of the
 * `@react-native-community/netinfo` require in mingla-business.
 *
 * WHY: #1719 (merged 2026-08-09) added netinfo AFTER the last shipped native
 * builds (prod 2026-07-14, dev-sim 2026-07-20 — zero RNCNetInfo symbols in
 * either binary, tester evidence on #1735). The package throws
 * "NativeModule.RNCNetInfo is null" AT MODULE EVAL (its nativeInterface.js has
 * a top-level `if (!nativeModule) throw`), so a bare static import bricks
 * startup during Expo Router's eager route load on every OTA install whose
 * binary predates the dependency (COMMS-0138).
 *
 * CONTRACT:
 * - Native module PRESENT (future native builds): `useNetInfoSafe` IS the
 *   package's own `useNetInfo` export — zero behavior change.
 * - Native module ABSENT (every currently shipped business binary): the
 *   require throws, is caught here once at module eval, and `useNetInfoSafe`
 *   returns null forever. Callers MUST degrade gracefully (treat null as
 *   "online").
 * - No other mingla-business file may import/require this package — enforced
 *   by `mingla-business/__tests__/issue1758NetinfoSoleOwner.test.ts` (the full
 *   business jest suite is a required PR gate since #1062).
 *
 * [TRANSITIONAL] assume-online fallback — exit condition: the next business
 * native build ships with RNCNetInfo compiled in (autolinked from
 * package.json). See docs/TRANSITIONAL_ITEMS_REGISTRY.md item 6.
 */

export interface NetInfoSafeState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

type UseNetInfoHook = () => NetInfoSafeState;

function loadUseNetInfo(): UseNetInfoHook | null {
  try {
    // Dynamic require so a missing RNCNetInfo native module throws HERE,
    // inside the catch — never at route eval. This module must remain the
    // only reach into the package (sole-owner guard above).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-community/netinfo") as {
      useNetInfo?: unknown;
    };
    if (typeof mod.useNetInfo === "function") {
      return mod.useNetInfo as UseNetInfoHook;
    }
    console.warn(
      "[netinfoSafe] netinfo loaded without a useNetInfo export — treating network state as online.",
    );
    return null;
  } catch (err) {
    // Expected on every binary built before 2026-08-09 (no RNCNetInfo native
    // module). NOT silent (Constitution #3): one boot-time warn keeps the
    // degrade diagnosable without crashing route eval.
    console.warn(
      "[netinfoSafe] RNCNetInfo native module unavailable — treating network state as online until the next native build ships it.",
      err,
    );
    return null;
  }
}

const useNetInfoOrNull = loadUseNetInfo();

/** True when the netinfo native module is compiled into this binary. */
export function isNetInfoAvailable(): boolean {
  return useNetInfoOrNull !== null;
}

/**
 * The package's real `useNetInfo` when the native module is present (zero
 * behavior change on future native builds); a stable `() => null` when it is
 * absent — callers treat null as "assume online". The branch is fixed once at
 * module eval, so hook order is stable for the app's lifetime (Rules of Hooks
 * safe).
 */
export const useNetInfoSafe: () => NetInfoSafeState | null =
  useNetInfoOrNull ?? ((): null => null);
