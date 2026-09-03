/**
 * #2830 — the type choices a brand can make.
 *
 * ONE OWNER. The Payload picker, the artifact contract and the renderer all
 * read this list, so a pairing cannot exist in the editor and be unknown to the
 * page — the shape of bug that leaves a brand choosing a font that never
 * applies.
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
