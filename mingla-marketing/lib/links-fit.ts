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

// ---------------------------------------------------------------- chips

/** 0 = full chips, 1 = counts hidden, 2 = counts hidden and chips tightened. */
export type ChipFitLevel = 0 | 1 | 2
export const CHIP_FIT_LEVELS: readonly ChipFitLevel[] = [0, 1, 2]

/**
 * The first chip level at which the chip row does not overflow its box, so a
 * chip is never clipped. `overflowsAt` applies a level and measures.
 */
export function chipFitLevel(overflowsAt: (level: ChipFitLevel) => boolean): ChipFitLevel {
  for (const level of CHIP_FIT_LEVELS) {
    if (!overflowsAt(level)) return level
  }
  return 2
}

/**
 * The flush rule's post-condition: once fitted, the room left under the
 * "more" link is smaller than one strip whenever anything is still hidden.
 */
export function leavesStripGap(input: {
  leftover: number
  stripStep: number
  pinsHidden: number
  listHidden: number
}): boolean {
  return input.leftover >= input.stripStep && (input.pinsHidden > 0 || input.listHidden > 0)
}

/**
 * How many listing strips fit whole in the listings box when the "more" link
 * must sit flush under the last one and still fit: `bottoms` are each strip's
 * bottom edge inside the box (in order), `room` the box height.
 */
/** Sub-pixel slack: layout offsets round, so a strip within 2 px still counts as fitting. */
export const FIT_TOLERANCE_PX = 2

export function stripsThatFit(bottoms: readonly number[], room: number, moreHeight: number, gap: number): number {
  const limit = room - moreHeight - gap
  let n = 0
  for (const bottom of bottoms) {
    if (bottom <= limit + FIT_TOLERANCE_PX) n++
    else break
  }
  return n
}

// ---------------------------------------------------------------- leftover

export const FILL_CAP_PER_GAP_PX = 24

/**
 * After a maximal fit, the room left under the "more" link must not sit as one
 * blank block: it is spread evenly over the vertical gaps between the page's
 * sections (each grows by the same amount, at most 24 px), and anything beyond
 * the cap goes to the very bottom.
 */
export function spreadLeftover(leftover: number, gaps: number, cap: number = FILL_CAP_PER_GAP_PX): { perGap: number; bottom: number } {
  const room = Math.max(0, leftover)
  if (gaps <= 0) return { perGap: 0, bottom: room }
  const perGap = Math.min(cap, Math.floor((room / gaps) * 100) / 100)
  return { perGap, bottom: Math.max(0, Math.floor((room - perGap * gaps) * 100) / 100) }
}
