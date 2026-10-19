/**
 * #3040 design AD-04 — "Fits Meta and TikTok. Snapchat needs 1080×1920."
 *
 * The fit itself is judged on the server by the shared ads channel matrix
 * (`supabase/functions/_shared/adCreativeFit.ts`, the same rules every ads
 * gate applies) and arrives on each Host creative as `fit`. This module only
 * turns it into the sentence. It holds no platform rule of its own, so the
 * host never reads a fit the funding gate would contradict.
 */

export type AdVideoFitPlatform = "meta" | "tiktok" | "snapchat" | "google" | "reddit";

export type AdVideoFit = {
  platform: AdVideoFitPlatform;
  fits: boolean;
  /** Short phrases from the server, e.g. "1080×1920", "at least 5 seconds". */
  needs: string[];
};

const PLATFORM_NAMES: Record<AdVideoFitPlatform, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
  reddit: "Reddit",
};

/** "A", "A and B", "A, B and C". */
export const joinWithAnd = (items: readonly string[]): string => {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

const isFitRow = (value: unknown): value is AdVideoFit => {
  if (value === null || typeof value !== "object") return false;
  const row = value as { platform?: unknown; fits?: unknown; needs?: unknown };
  return typeof row.platform === "string" && row.platform in PLATFORM_NAMES &&
    typeof row.fits === "boolean" && Array.isArray(row.needs) &&
    row.needs.every((need) => typeof need === "string");
};

/**
 * The AD-04 body, or null when there is nothing true to say (an older server
 * with no `fit`, or a brand with no connected platform) — the card then keeps
 * its generic "Saved to this ad" body.
 */
export const formatAdFitSummary = (fit: unknown): string | null => {
  if (!Array.isArray(fit)) return null;
  const rows = fit.filter(isFitRow);
  if (rows.length === 0) return null;
  const sentences: string[] = [];
  const fitting = rows.filter((row) => row.fits).map((row) => PLATFORM_NAMES[row.platform]);
  if (fitting.length > 0) sentences.push(`Fits ${joinWithAnd(fitting)}.`);
  for (const row of rows) {
    if (row.fits) continue;
    const needs = row.needs.filter((need) => need.trim().length > 0);
    sentences.push(
      needs.length > 0
        ? `${PLATFORM_NAMES[row.platform]} needs ${joinWithAnd(needs)}.`
        : `${PLATFORM_NAMES[row.platform]} can't run this video.`,
    );
  }
  return sentences.join(" ");
};
