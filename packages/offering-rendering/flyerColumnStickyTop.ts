/**
 * #4490 N116 — where the desktop flyer column of a public page sticks.
 *
 * 96 from the top of the scroll area when the column fits; higher (never
 * lower) when it is taller than the scroll area minus the foot gap, so its last
 * row (the docked action bar) stays in view above the Privacy & ad choices
 * strip. The scroll area is already the window minus that strip
 * (I-PRIVACY-BAR-NEVER-OCCLUDES: #root ends above it), so no inset is read here.
 */
/** Space above the desktop columns inside the scroll area (the page's top padding). */
export const PREMIUM_DESK_PAGE_TOP = 84;
const PREMIUM_FLYER_TOP = 96;
const PREMIUM_FLYER_FOOT_GAP = 16;

export function flyerColumnStickyTop(scrollHeight: number, columnHeight: number): number {
  if (!(scrollHeight > 0) || !(columnHeight > 0)) return PREMIUM_FLYER_TOP;
  return Math.min(PREMIUM_FLYER_TOP, Math.round(scrollHeight - columnHeight - PREMIUM_FLYER_FOOT_GAP));
}

/**
 * #4490 N116 — the flyer's height cap. At the top of the page the column starts
 * PREMIUM_DESK_PAGE_TOP down; when it would end below the scroll area (a short
 * window), the portrait flyer (4:5) is cropped by the shortfall so the docked
 * action bar under it is in view at once, not only after a scroll. The flyer's
 * natural height comes from its WIDTH, so the cap never feeds back into itself.
 * Returns null when nothing needs cropping (or before everything is measured).
 */
export function flyerMaxHeight(input: {
  scrollHeight: number;
  columnHeight: number;
  flyerWidth: number;
  flyerHeight: number;
}): number | null {
  const { scrollHeight, columnHeight, flyerWidth, flyerHeight } = input;
  if (!(scrollHeight > 0) || !(columnHeight > 0) || !(flyerWidth > 0) || !(flyerHeight > 0)) return null;
  const natural = Math.round((flyerWidth * 5) / 4);
  const rest = columnHeight - flyerHeight;
  const shortfall = PREMIUM_DESK_PAGE_TOP + rest + natural + PREMIUM_FLYER_FOOT_GAP - scrollHeight;
  if (shortfall <= 0) return null;
  return Math.max(MIN_FLYER_HEIGHT, natural - shortfall);
}

const MIN_FLYER_HEIGHT = 240;
