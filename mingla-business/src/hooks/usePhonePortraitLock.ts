/**
 * #4490 spec 08 O3 part B — keep phones in portrait at runtime.
 *
 * app.json `orientation` is "default" (it is not per-platform) so tablets can
 * rotate; this hook locks any device whose shortest screen side is < 600 dp to
 * portrait (Android phones; iPhone as a backstop to its portrait-only
 * Info.plist). Tablets are never locked.
 *
 * Only what the installed binary has: the `ExpoScreenOrientation` native
 * module is asked for by name and called directly, so the `expo-screen-
 * orientation` JS package is never imported (its JS requires the native module
 * on import and would throw on an older binary). A binary without the module —
 * an older store build given this code over the air — keeps its own
 * orientation (those builds are portrait-only from app.json) and nothing
 * throws. Web does nothing.
 */
import { useEffect } from "react";
import { Dimensions, Platform } from "react-native";

import { type Size } from "../utils/deviceOrientation";
import { applyPortraitLock } from "../utils/portraitLock";

export function usePhonePortraitLock(): void {
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    let locked: boolean | null = null;
    let live = true;
    const apply = (screen: Size): void => {
      void applyPortraitLock(Platform.OS, screen, locked).then((next) => {
        if (live) locked = next.locked;
      });
    };
    apply(Dimensions.get("screen"));
    const subscription = Dimensions.addEventListener("change", ({ screen }) => apply(screen));
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
}
