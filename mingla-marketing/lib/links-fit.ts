// #4318 — the one-screen fit rule for usemingla.com/links (design `fit()`).
//
// The page never scrolls. After layout (and after fonts load, and on every
// resize) the page measures:
//
//   phones and tablet: admin strips come first. Show every admin strip while at
//     least 3 listing strips (1 on a screen under 700 px tall, or all of them
//     when there are fewer) still fit whole; past that, fold the remaining
//     admin strips into "See N more from Mingla".
//   desktop: admin strips sit in the left column under the banners and fold
//     only when that column runs out of room.
//
// Then every listing strip whose bottom falls below the list area is hidden, so
// no strip is ever cut in half; the "more" link counts what was hidden.
//
// Pure: the DOM is reached only through the two probes, so the rule is unit
// tested with fixture geometry.

export interface LinksFitProbe {
  /** Admin strips in the pinned group. */
  pinCount: number
  /** Listing strips in the list (after the chip filter). */
  listCount: number
  /** The page is under 700 px tall. */
  short: boolean
  /** The two-column desktop layout is active. */
  desk: boolean
  /** With `shownPins` admin strips visible: how many listing strips fit whole. */
  fitList: (shownPins: number) => number
  /** With `shownPins` admin strips visible: does the desktop left column overflow. */
  leftOverflows: (shownPins: number) => boolean
}

export interface LinksFit {
  pinsShown: number
  listShown: number
}

export const LIST_FLOOR = 3
export const LIST_FLOOR_SHORT = 1
export const SHORT_SCREEN_PX = 700

export function computeLinksFit(probe: LinksFitProbe): LinksFit {
  let shown = probe.pinCount
  const need = Math.min(probe.short ? LIST_FLOOR_SHORT : LIST_FLOOR, probe.listCount)
  if (probe.desk) {
    while (shown > 0 && probe.leftOverflows(shown)) shown--
  } else {
    while (shown > 0 && probe.fitList(shown) < need) shown--
  }
  return { pinsShown: shown, listShown: Math.min(probe.listCount, probe.fitList(shown)) }
}

/** The "more" link under the listings. */
export function moreLabel(listCount: number, listShown: number): { hidden: number; text: string; count: string | null } {
  const hidden = Math.max(0, listCount - listShown)
  return hidden > 0
    ? { hidden, text: `See ${hidden} more`, count: `${listCount} this week` }
    : { hidden, text: 'Open the full week', count: null }
}

/** The pinned group's fold link, or null when every admin strip shows. */
export function pinsMoreLabel(pinCount: number, pinsShown: number): string | null {
  const hidden = Math.max(0, pinCount - pinsShown)
  return hidden > 0 ? `See ${hidden} more from Mingla` : null
}
