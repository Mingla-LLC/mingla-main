/**
 * Event slug generator — URL-safe brand-scoped event slugs.
 *
 * Format: `<kebab-case-from-name>-<4-char-suffix>`
 * Example: "Slow Burn vol. 4" → "slow-burn-vol-4-x7q3"
 *
 * Brand-scoped uniqueness: the suffix retries on collision against the
 * brand's existing live events. Maximum 8 retries before falling through
 * to a timestamp-suffixed slug (statistically near-impossible to need —
 * 36^4 = 1.6M slot space per name root).
 *
 * Also exports `sanitizeSlugForUrl` as a defensive helper (per Cycle 6
 * investigation HIDDEN-1: brand slug is created kebab-case at brand
 * creation, but defensive sanitization here protects against any edge
 * case where a non-URL-safe character slipped through).
 *
 * Per Cycle 6 spec §3.1.3.
 */

const SLUG_SUFFIX_LEN = 4;
const MAX_RETRIES = 8;
const MAX_BASE_LEN = 60;

/**
 * Strip diacritics + lowercase + replace non-alphanumeric with hyphens +
 * collapse repeated hyphens + trim leading/trailing hyphens. URL-safe.
 */
const kebabify = (raw: string): string => {
  const decomposed = raw.normalize("NFD");
  // Strip Unicode combining marks (diacritics) — covers ä → a, é → e, etc.
  const stripped = decomposed.replace(/[̀-ͯ]/g, "");
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LEN);
};

const randomSuffix = (): string =>
  Math.random().toString(36).slice(2, 2 + SLUG_SUFFIX_LEN);

/**
 * Generate a URL-safe brand-scoped event slug.
 *
 * @param rawName - the event name (DraftEvent.name)
 * @param existingSlugsForBrand - set of slugs already in use within this brand
 *
 * Returns a slug guaranteed unique within the brand (modulo astronomical
 * collision probability after MAX_RETRIES — at which point a timestamp
 * fallback is used, also guaranteed unique).
 */
export const generateEventSlug = (
  rawName: string,
  existingSlugsForBrand: ReadonlySet<string>,
): string => {
  const base = kebabify(rawName) || "event";
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!existingSlugsForBrand.has(candidate)) return candidate;
  }
  // Fall through — append timestamp + extra random for guaranteed uniqueness
  const fallback = `${base}-${Date.now().toString(36)}-${randomSuffix()}`;
  return fallback;
};

/**
 * URL-safe sanitizer for brand slugs (defensive — Cycle 6 HIDDEN-1).
 *
 * Brand slugs ARE created kebab-case at brand creation, but this defensive
 * pass protects against any edge case where a non-URL-safe character
 * slipped through. Used by `liveEventConverter` when freezing brandSlug
 * into a LiveEvent.
 */
export const sanitizeSlugForUrl = (raw: string): string => {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};
