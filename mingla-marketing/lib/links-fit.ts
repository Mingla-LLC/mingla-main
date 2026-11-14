// #4339 — the one-screen fit rule for usemingla.com/links.
//
// The page never scrolls. After layout (and after fonts load, and on every
// resize) the page measures the Admin strips ("pins") inside the box between
// the banners and the socials:
//
//   - every strip fits: all show, and there is no "more" link;
//   - otherwise the "See N more from Mingla" link takes its room at the bottom
//     and only WHOLE ROWS of strips that fit above it show (one strip per row
//     on a phone, two equal aligned columns on tablet and desktop), so no
//     strip is ever cut in half and no row shows a lone half.
//
// Pure: the DOM is reached only through the numbers handed in, so the rule is
// unit tested with fixture geometry.

/** Sub-pixel slack: layout offsets round, so a strip within 2 px still counts as fitting. */
export const FIT_TOLERANCE_PX = 2

export interface PinsFitInput {
  /** Each strip's bottom edge inside the box, in order (offsets relative to the box). */
  bottoms: readonly number[]
  /** The box height. */
  room: number
  /** The "more" link's height (measured with it visible). */
  moreHeight: number
  /** The vertical gap between rows. */
  gap: number
  /** Columns in the strip grid (1 phone, 2 tablet and desktop). */
  columns: number
}

/** How many strips show: all when they fit, else the whole rows that fit above the "more" link. */
export function pinsThatFit({ bottoms, room, moreHeight, gap, columns }: PinsFitInput): number {
  if (bottoms.length === 0) return 0
  if (bottoms[bottoms.length - 1] <= room + FIT_TOLERANCE_PX) return bottoms.length
  const limit = room - moreHeight - gap
  let fits = 0
  for (const bottom of bottoms) {
    if (bottom <= limit + FIT_TOLERANCE_PX) fits++
    else break
  }
  const perRow = Math.max(1, Math.floor(columns))
  return fits - (fits % perRow)
}

/** The "more" link's text, or null when every strip shows. */
export function pinsMoreLabel(pinCount: number, pinsShown: number): string | null {
  const hidden = Math.max(0, pinCount - pinsShown)
  return hidden > 0 ? `See ${hidden} more from Mingla` : null
}
