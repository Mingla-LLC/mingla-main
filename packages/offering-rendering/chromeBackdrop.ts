/**
 * chromeBackdrop — when the floating close / share / mute row gets a solid bar.
 *
 * WHY (RSVP tutorial recording, 2026-09-17, #3431): the public offering pages
 * float the close, share and mute buttons over the cover as translucent 40pt
 * circles with nothing behind them. Once the guest scrolls, the body slides up
 * under the status bar and under those circles, so the buttons sat on top of
 * page rows and page text ran under the clock.
 *
 * ParallaxCoverShell paints an opaque page-coloured bar behind the status bar
 * and the chrome row. It fades in as the body's rounded top edge approaches the
 * bar and is fully solid by the time that edge reaches it, so body content can
 * never pass under the buttons without a header behind them. Over the cover
 * (scroll 0) nothing changes.
 *
 * Deliberately NOT exported from the package barrel: app-mobile suites mock the
 * barrel with partial factories, and ParallaxCoverShell is the only consumer.
 *
 * Pure and dependency-free.
 */

/** OfferingChrome's glass buttons are 40×40. */
export const CHROME_BUTTON_SIZE = 40;

/** The chrome row sits this far below the safe-area top; the bar keeps the same gap below it. */
export const CHROME_TOP_GAP = 12;

/** Scroll distance over which the bar fades from clear to solid. */
export const CHROME_BACKDROP_FADE = 24;

/** Height of the bar: status bar / safe area, gap, button row, gap. */
export const chromeBackdropHeight = (safeAreaTop: number): number =>
  Math.max(0, safeAreaTop) + CHROME_TOP_GAP + CHROME_BUTTON_SIZE + CHROME_TOP_GAP;

export interface ChromeBackdropRange {
  /** Scroll offset where the bar starts to fade in. */
  start: number;
  /** Scroll offset where the bar is fully solid. Always greater than `start`. */
  end: number;
}

/**
 * The scroll offsets across which the bar fades in.
 *
 * `bodyTop` is where the body's top edge sits at scroll 0, in the scroll
 * content's coordinates (the cover spacer height minus the seam overlap). The
 * bar is solid at the offset where that edge meets the bar's bottom. `null`
 * until the spacer has been measured: no bar is shown rather than a guessed one.
 */
export const chromeBackdropRange = (
  bodyTop: number | null,
  safeAreaTop: number,
): ChromeBackdropRange | null => {
  if (bodyTop === null || !Number.isFinite(bodyTop) || bodyTop <= 0) return null;
  const end = Math.max(1, bodyTop - chromeBackdropHeight(safeAreaTop));
  return { start: Math.max(0, end - CHROME_BACKDROP_FADE), end };
};

/**
 * True once the bar is fully solid. The shell then lets the bar take touches,
 * so a tap on the header strip can never land on content hidden behind it.
 */
export const isChromeBackdropSolid = (
  scrollY: number,
  range: ChromeBackdropRange | null,
): boolean => range !== null && scrollY >= range.end;

/**
 * Status-bar text colour while the solid bar sits behind it: dark text on a
 * light page, light text on a dark page — whichever of black or white has the
 * higher contrast against the page colour (the same rule the palette uses for
 * its primary text). Accepts `#rgb`, `#rrggbb`, `rgb()` and `rgba()`; returns
 * `null` for anything else so the shell leaves the status bar alone rather
 * than guess.
 */
export const chromeStatusBarStyle = (
  pageColor: string,
): "dark-content" | "light-content" | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(pageColor.trim());
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(
    pageColor.trim(),
  );
  let channels: number[];
  if (hex !== null) {
    const digits = hex[1].length === 3
      ? hex[1].split("").map((d) => d + d).join("")
      : hex[1];
    channels = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  } else if (rgb !== null) {
    channels = [rgb[1], rgb[2], rgb[3]].map((c) => Math.min(255, Number(c)));
  } else {
    return null;
  }
  const [r, g, b] = channels.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against black is (L + 0.05) / 0.05; against white 1.05 / (L + 0.05).
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "dark-content"
    : "light-content";
};
