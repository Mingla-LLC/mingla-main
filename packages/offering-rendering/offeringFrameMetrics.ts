// issue #4420 — premium public frame metrics shared outside the shell (a
// pinned venue tab strip sits under the glass header). Pure: no imports, so
// a surface reads them without loading ParallaxCoverShell.

import type { StyleProp, ViewStyle } from "react-native";

/** Height of the premium glass header row, under the safe area. */
export const OFFERING_PREMIUM_HEADER_ROW = 56;

// issue #4420 audit — premium desktop page geometry (mirrors the shell's
// premiumDeskPage / premiumDeskCols / flyer column styles).
export const OFFERING_PREMIUM_DESK_MAX = 1160;
export const OFFERING_PREMIUM_DESK_PAD_X = 40;
export const OFFERING_PREMIUM_FLYER_MAX = 420;
export const OFFERING_PREMIUM_FLYER_SHARE = 0.4;

/**
 * issue #4420 audit — where a desktop page's floating glass bar sits: fixed
 * to the bottom of the viewport but inside the LEFT flyer column, so it can
 * never cover the right column's text. Returned as CSS strings for
 * react-native-web (position: fixed); native never takes the desktop frame.
 */
export interface PremiumDesktopBarDockStyle {
  position: "fixed";
  left: string;
  width: string;
  bottom: number;
  zIndex: number;
}

export const premiumDesktopBarDock = (
  bottom: number,
): PremiumDesktopBarDockStyle => {
  const content = `(min(100vw, ${OFFERING_PREMIUM_DESK_MAX}px) - ${
    OFFERING_PREMIUM_DESK_PAD_X * 2
  }px)`;
  return {
    position: "fixed",
    left: `calc((100vw - min(100vw, ${OFFERING_PREMIUM_DESK_MAX}px)) / 2 + ${OFFERING_PREMIUM_DESK_PAD_X}px)`,
    width: `min(${OFFERING_PREMIUM_FLYER_MAX}px, calc(${content} * ${OFFERING_PREMIUM_FLYER_SHARE}))`,
    bottom,
    zIndex: 6,
  };
};

/**
 * The dock as a react-native style. react-native-web passes `position:
 * fixed` and the CSS `calc()` strings through; RN's ViewStyle type has no
 * name for them, so this is the one place the web-only shape is widened
 * (the same pattern as ParallaxCoverShell's `webStyle`).
 */
export const premiumDesktopBarDockStyle = (
  bottom: number,
): StyleProp<ViewStyle> =>
  premiumDesktopBarDock(bottom) as StyleProp<ViewStyle>;
