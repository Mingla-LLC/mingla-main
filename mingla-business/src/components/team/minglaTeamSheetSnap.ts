import { space } from "../../constants/designSystem";

/**
 * #4579 retest P2-3 — the detail sheet is sized to its content, so Remove and
 * Cancel are fully visible the moment it opens (a "half" sheet cut Remove off
 * at the fold on a standard iPhone). The panel is the content plus the sheet's
 * own chrome: the 24pt handle band (SHEET_TOP_INSET) above and the body's
 * space[6] + bottom safe area below. Before the content is measured the sheet
 * opens at "full" (never clipped), and Sheet caps any height at 95% of the
 * screen, where the body scrolls.
 */
export const MINGLA_TEAM_SHEET_CHROME_TOP = 24;
export function minglaTeamSheetSnap(
  contentHeight: number | null,
  bottomInset: number,
): number | "full" {
  if (contentHeight === null || !Number.isFinite(contentHeight) || contentHeight <= 0) return "full";
  const inset = Number.isFinite(bottomInset) && bottomInset > 0 ? bottomInset : 0;
  return Math.ceil(MINGLA_TEAM_SHEET_CHROME_TOP + contentHeight + space[6] + inset);
}
