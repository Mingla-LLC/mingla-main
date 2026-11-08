/**
 * issue #1023 wave 2 — the theme font picker's pure model: catalogue shape,
 * chips, Popular, search ranking and row copy.
 *
 * PURE (no React, no React Native) so the list rules are unit-testable.
 *
 * The catalogue itself (packages/offering-rendering/fonts/googleFontsCatalog.json,
 * 1,626 families) is loaded LAZILY by the Font tab only. Nothing here imports
 * it: I-1023-ONLY-CHOSEN-FONT-DOWNLOADS keeps it out of the eager web chunk.
 */

import {
  LEGACY_FONT_FAMILY_NAMES,
  THEME_FONT_SLUGS,
  type ThemeFontSlug,
} from "../../../../packages/offering-rendering/designTokens";

export type FontCategoryCode = "s" | "r" | "d" | "h" | "m";

/** One catalogue row: [family, category code, upright weights]. */
export type CatalogFamily = readonly [string, FontCategoryCode, readonly number[]];

export interface GoogleFontsCatalog {
  v: number;
  generatedAt: string;
  source: string;
  /** Sorted by Google popularity: the index is the rank. */
  families: readonly CatalogFamily[];
}

export type FontChip = "popular" | "all" | "s" | "r" | "d" | "h" | "m";

export const FONT_CHIPS: readonly { key: FontChip; label: string }[] = [
  { key: "popular", label: "Popular" },
  { key: "all", label: "All" },
  { key: "s", label: "Sans" },
  { key: "r", label: "Serif" },
  { key: "d", label: "Display" },
  { key: "h", label: "Handwriting" },
  { key: "m", label: "Mono" },
];

export const POPULAR_COUNT = 30;

const CATEGORY_LABEL: Readonly<Record<FontCategoryCode, string>> = {
  s: "Sans serif",
  r: "Serif",
  d: "Display",
  h: "Handwriting",
  m: "Monospace",
};

export interface FontRow {
  family: string;
  category: FontCategoryCode;
  /** Google popularity rank (0 = most used). */
  rank: number;
}

/** The 14 bundled families, in the legacy order, as rows. */
export const LEGACY_FONT_ROWS: readonly FontRow[] = (
  THEME_FONT_SLUGS as readonly ThemeFontSlug[]
).map((slug, i) => ({
  family: LEGACY_FONT_FAMILY_NAMES[slug],
  category: ((): FontCategoryCode => {
    if (["playfair_display", "dm_serif_display", "fraunces", "lora"].includes(slug)) return "r";
    if (["bebas_neue", "anton", "unbounded"].includes(slug)) return "d";
    if (["caveat", "dancing_script"].includes(slug)) return "h";
    return "s";
  })(),
  rank: 100000 + i,
}));

export const catalogRows = (catalog: GoogleFontsCatalog): FontRow[] =>
  catalog.families.map(([family, category], rank) => ({ family, category, rank }));

/** The family a saved theme font names: a slug maps to its Google family. */
export const familyOfThemeFont = (font: string | null | undefined): string | null => {
  if (typeof font !== "string" || font.length === 0) return null;
  return (LEGACY_FONT_FAMILY_NAMES as Record<string, string>)[font] ?? font;
};

/**
 * The rows a chip and query show.
 *   - Search (trimmed, case-insensitive): prefix matches first, then
 *     substring matches, each by rank, across every category.
 *   - Popular: the top 30, then the current pick and the 14 legacy families
 *     pinned underneath when they are not already listed.
 *   - All / a category: by rank.
 */
export const visibleFontRows = (
  rows: readonly FontRow[],
  chip: FontChip,
  query: string,
  currentFamily: string | null,
): FontRow[] => {
  const q = query.trim().toLowerCase();
  if (q.length > 0) {
    const prefix: FontRow[] = [];
    const substring: FontRow[] = [];
    for (const row of rows) {
      const name = row.family.toLowerCase();
      if (name.startsWith(q)) prefix.push(row);
      else if (name.includes(q)) substring.push(row);
    }
    return [...prefix, ...substring];
  }
  if (chip === "all") return [...rows];
  if (chip !== "popular") return rows.filter((row) => row.category === chip);
  const top = rows.slice(0, POPULAR_COUNT);
  const listed = new Set(top.map((row) => row.family));
  const pinned: FontRow[] = [];
  const pin = (family: string | null): void => {
    if (family === null || listed.has(family)) return;
    const row =
      rows.find((r) => r.family === family) ??
      LEGACY_FONT_ROWS.find((r) => r.family === family) ??
      // A saved family Google no longer lists still shows, so it stays visible
      // and selected.
      { family, category: "s" as const, rank: Number.MAX_SAFE_INTEGER };
    listed.add(family);
    pinned.push(row);
  };
  pin(currentFamily);
  for (const legacy of LEGACY_FONT_ROWS) pin(legacy.family);
  return [...top, ...pinned];
};

/** "Sans serif · Popular" for the top 30, else the category alone. */
export const fontRowCaption = (row: FontRow): string =>
  `${CATEGORY_LABEL[row.category]}${row.rank < POPULAR_COUNT ? " · Popular" : ""}`;

/** "Roboto Slab, serif font". */
export const fontRowAccessibilityLabel = (row: FontRow): string =>
  `${row.family}, ${CATEGORY_LABEL[row.category].toLowerCase()} font`;

const thousands = (n: number): string =>
  String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "Search 1,626 fonts" once the catalogue is in, "Search fonts" before. */
export const fontSearchPlaceholder = (count: number | null): string =>
  count === null || count <= 0 ? "Search fonts" : `Search ${thousands(count)} fonts`;
