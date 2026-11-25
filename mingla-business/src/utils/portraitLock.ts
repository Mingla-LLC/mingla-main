/**
 * #4490 spec 08 O3 part B — the portrait-lock step behind usePhonePortraitLock
 * (native only; the web build of the hook never imports this file).
 *
 * The `ExpoScreenOrientation` native module is asked for by name and called
 * directly; the `expo-screen-orientation` JS package is never imported (its JS
 * requires the native module on import and would throw on an older binary).
 */
import { shouldLockPortrait, type Size } from "./deviceOrientation";

/** expo-screen-orientation 9.0.9 build/ScreenOrientation.types.js `OrientationLock`. */
export const ORIENTATION_LOCK_DEFAULT = 0;
export const ORIENTATION_LOCK_PORTRAIT_UP = 3;

export interface ScreenOrientationModule {
  lockAsync: (orientationLock: number) => Promise<void>;
}
export type ScreenOrientationLoader = () => ScreenOrientationModule | null;

export const loadScreenOrientation: ScreenOrientationLoader = () => {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (moduleName: string) => ScreenOrientationModule | null;
    };
    const mod = requireOptionalNativeModule("ExpoScreenOrientation");
    return mod != null && typeof mod.lockAsync === "function" ? mod : null;
  } catch {
    return null;
  }
};

export type PortraitLockResult = "locked" | "unlocked" | "unchanged" | "unavailable";

/**
 * Applies the rule once. `previous` is the last decision (null at start), so
 * a tablet is only unlocked after it was locked (a foldable opening).
 */
export async function applyPortraitLock(
  platform: string,
  screen: Size,
  previous: boolean | null,
  load: ScreenOrientationLoader = loadScreenOrientation,
): Promise<{ result: PortraitLockResult; locked: boolean | null }> {
  if (platform === "web") return { result: "unavailable", locked: previous };
  const lock = shouldLockPortrait(screen);
  if (lock === previous || (!lock && previous === null)) return { result: "unchanged", locked: lock };
  const mod = load();
  if (mod === null) return { result: "unavailable", locked: previous };
  try {
    await mod.lockAsync(lock ? ORIENTATION_LOCK_PORTRAIT_UP : ORIENTATION_LOCK_DEFAULT);
    return { result: lock ? "locked" : "unlocked", locked: lock };
  } catch (error) {
    console.warn("[orientation] lock failed", error instanceof Error ? error.message : "unknown");
    return { result: "unavailable", locked: previous };
  }
}

