/**
 * #4420 — the web viewport pin for screens with a bottom-pinned composer or
 * commit bar (Brand group thread, customer enquiry, the Blast composer shell).
 *
 * Those screens pin their height to `useWindowDimensions().height` (the
 * VISIBLE height, so the bar rides the soft keyboard, #2262). The Privacy &
 * ad choices strip owns a constant band at the bottom of the layout viewport,
 * and the app root (`#root`) is the fixed box that ends at its top edge
 * (I-PRIVACY-BAR-NEVER-OCCLUDES, #2331), so a pin to the full window height
 * pushed the composer 28px under the strip.
 *
 * The cap is the app root's own height. Keyboard closed: the cap wins, the
 * composer sits on the strip. Keyboard open: the visible height is already
 * below the cap (the strip is behind the keyboard), so the field stays flush
 * above the keyboard.
 */
import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

/** `maxHeight` that keeps a pinned screen clear of the privacy strip (web only). */
export function webPrivacyMaxHeight(): ViewStyle | null {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const rootHeight = document.getElementById("root")?.clientHeight ?? 0;
  if (!(rootHeight > 0)) return null;
  return { maxHeight: rootHeight };
}

/**
 * #4420 A2 — how a Messages screen sizes itself on web.
 *
 * Inside the desktop shell (HostDesktopShell: the web top bar sits ABOVE the
 * route) the screen must FILL the slot the shell leaves it. Pinning it to the
 * full window height made the page 80px taller than the screen, so #root
 * scrolled and the composer scrolled out of view at 1280x800 / 1440x900.
 * There is no soft keyboard on wide desktop, so nothing needs the pin there.
 *
 * Outside the shell (phones, narrow web) the pin stays: the visible height,
 * capped clear of the privacy strip, so the composer rides the keyboard.
 */
export function messagesScreenWebSize(windowHeight: number, shellActive: boolean): ViewStyle[] | null {
  if (Platform.OS !== "web") return null;
  if (shellActive) return [{ flex: 1, minHeight: 0 }];
  return webViewportPin(windowHeight);
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
