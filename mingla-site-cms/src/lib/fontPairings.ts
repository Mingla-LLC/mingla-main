/**
 * #2830 — the type choices a brand can make.
 *
 * ONE OWNER, ENFORCED BY A TEST. This is a byte-for-byte copy of
 * `mingla-sites/src/contracts/fontPairings.ts`, and `fontPairings.issue2830`
 * fails if the two ever differ.
 *
 * It is a copy rather than an import because the two apps deploy as separate
 * Vercel projects with their own root directories — a `../../mingla-sites/...`
 * import typechecks locally and breaks the CMS build. The copy is the safe
 * shape; the test is what stops it drifting into two different lists, which
 * would let the editor offer a font the published site does not serve.
 *
 * Every family here is SELF-HOSTED and SIL Open Font Licensed. Adding one means
 * adding its woff2 to `public/fonts` and its @font-face to the stylesheet; a
 * pairing that names a family the site does not serve would silently fall back,
 * which is exactly the failure self-hosting was meant to end.
 */
export const FONT_PAIRINGS = {
  "condensed-display": {
    label: "Condensed — bold, close-set headlines",
    display: '"Oswald", "Arial Narrow", "Helvetica Neue Condensed", system-ui, sans-serif',
    body: '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
    uppercaseHeadings: true,
  },
  "modern-sans": {
    label: "Modern sans — clean and quiet",
    display: '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
    body: '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
    uppercaseHeadings: false,
  },
  "editorial-serif": {
    label: "Editorial serif — warm and traditional",
    display: '"Playfair Display", "Iowan Old Style", Georgia, serif',
    body: '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
    uppercaseHeadings: false,
  },
} as const;

export type FontPairing = keyof typeof FONT_PAIRINGS;

export const FONT_PAIRING_KEYS = Object.keys(FONT_PAIRINGS) as FontPairing[];

export function isFontPairing(value: unknown): value is FontPairing {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(FONT_PAIRINGS, value);
}
