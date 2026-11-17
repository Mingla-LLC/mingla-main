/**
 * #4420 — the web viewport pin for screens with a bottom-pinned composer or
 * commit bar (Brand group thread, customer enquiry, the Blast composer shell).
 *
 * Those screens pin their height to `useWindowDimensions().height` (the
 * VISIBLE height, so the bar rides the soft keyboard, #2262). The Privacy &
 * ad choices strip is fixed to the bottom of the LAYOUT viewport and #root is
 * already shortened by its height (`--mingla-privacy-inset`,
 * I-PRIVACY-BAR-NEVER-OCCLUDES), so a pin to the full window height pushed
 * the composer 28px under the strip.
 *
 * The cap is the layout height minus the strip. Keyboard closed: the cap
 * wins, the composer sits on the strip. Keyboard open: the visible height is
 * already below the cap (the strip is behind the keyboard), so the field
 * stays flush above the keyboard.
 */
import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

export const PRIVACY_INSET_VAR = "--mingla-privacy-inset";

/** `maxHeight` that keeps a pinned screen clear of the privacy strip (web only). */
export function webPrivacyMaxHeight(): ViewStyle | null {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const layoutHeight = document.documentElement.clientHeight;
  if (!(layoutHeight > 0)) return null;
  return {
    maxHeight: `calc(${layoutHeight}px - var(${PRIVACY_INSET_VAR}, 0px))` as unknown as number,
  };
}

/** The full pin: the visible height, capped clear of the privacy strip. */
export function webViewportPin(windowHeight: number): ViewStyle[] | null {
  if (Platform.OS !== "web" || windowHeight <= 0) return null;
  const cap = webPrivacyMaxHeight();
  return [
    { height: windowHeight, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
    ...(cap ? [cap] : []),
  ];
}
