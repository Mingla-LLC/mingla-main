/**
 * #4238 B7 — the ad media tile's fit line. Its own module (not adVideoFit,
 * which loads at boot) so it ships with the ad builder only.
 */
import { isFitRow, joinWithAnd, PLATFORM_NAMES } from "../../../utils/adVideoFit";

/**
 * #4238 B7 — the one line under an ad media tile, judged only against the
 * apps this ad runs on: "Fits all 3 apps", "Fits Facebook & Instagram", or the
 * first app that misses ("Snapchat needs 1080×1920"). Null when the server
 * sent no fit for those apps.
 */
export const adTileFitLine = (
  fit: unknown,
  apps: readonly string[],
): { text: string; warn: boolean } | null => {
  if (!Array.isArray(fit)) return null;
  const rows = fit.filter(isFitRow).filter((row) => apps.includes(row.platform));
  if (rows.length === 0) return null;
  const miss = rows.find((row) => !row.fits);
  if (miss) {
    const needs = miss.needs.filter((need) => need.trim().length > 0);
    return {
      text: needs.length > 0
        ? `${PLATFORM_NAMES[miss.platform]} needs ${joinWithAnd(needs)}`
        : `${PLATFORM_NAMES[miss.platform]} can't run this video`,
      warn: true,
    };
  }
  return {
    text: rows.length <= 2
      ? `Fits ${joinWithAnd(rows.map((row) => PLATFORM_NAMES[row.platform]))}`
      : `Fits all ${rows.length} apps`,
    warn: false,
  };
};
