// MINGLA-INVARIANT: I-1023-FONT-SHAPE-PARITY | issue #1023 | The Google family-name shape is one rule in four places: the app (GOOGLE_FONT_FAMILY_RE), the database helper public.issue_1023_is_theme_font, Ari's theme schema, and the catalogue build script. Every catalogue name passes it.
/**
 * issue #1023 wave 2 — P-1. Also pins the catalogue's integrity: all 14
 * bundled families present, the count, the filter rules, and that Ari's family
 * list is exactly the catalogue's names.
 *
 * Fails on revert: putting the 14-slug list back in the SQL helper, changing
 * any one of the four patterns, or a catalogue rebuild that drops a legacy
 * family or lets a non-Latin / oversize / colour family in.
 */
import { readFile } from "fs/promises";
import path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

import {
  GOOGLE_FONT_FAMILY_MAX,
  GOOGLE_FONT_FAMILY_RE,
  LEGACY_FONT_FAMILY_NAMES,
  THEME_FONT_SLUGS,
} from "../../../../../packages/offering-rendering/designTokens";
import {
  canonicalThemeFont,
  isThemeFontValue,
} from "../../../../../packages/offering-rendering/themeResolver";

const REPO = path.resolve(__dirname, "../../../../..");
const read = (rel: string): Promise<string> => readFile(path.join(REPO, rel), "utf8");

type Catalog = { v: number; families: [string, string, number[]][] };
let catalog: Catalog;
let ariFamilies: string[];
let migration: string;
let ariValidation: string;
let buildScript: string;
let names: string[];
beforeAll(async () => {
  catalog = JSON.parse(await read("packages/offering-rendering/fonts/googleFontsCatalog.json")) as Catalog;
  ariFamilies = JSON.parse(await read("supabase/functions/_shared/googleFontFamilies.json")) as string[];
  migration = await read("supabase/migrations/20280430011023_issue_1023_theme_fonts_and_gradients.sql");
  ariValidation = await read("supabase/functions/_shared/themeFontValidation.ts");
  buildScript = await read("packages/offering-rendering/scripts/build-google-fonts-catalog.mjs");
  names = catalog.families.map(([name]) => name);
});

const SHAPE = GOOGLE_FONT_FAMILY_RE.source;

describe("I-1023-FONT-SHAPE-PARITY — one family-name shape in four places", () => {
  test("the SQL helper uses the same pattern, the same length cap and the 14 slugs", () => {
    const helper = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1023_is_theme_font"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1023_is_theme_gradient"),
    );
    expect(helper).toContain(`p ~ '${SHAPE}'`);
    expect(helper).toContain(`length(p) <= ${GOOGLE_FONT_FAMILY_MAX}`);
    for (const slug of THEME_FONT_SLUGS) expect(helper).toContain(`'${slug}'`);
    // The CHECKs use the helper, not a list.
    for (const name of [
      "brands_theme_font_whitelist_chk",
      "events_theme_font_override_whitelist_chk",
      "venue_listings_theme_font_override_whitelist_chk",
    ]) {
      expect(migration).toMatch(
        new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\(public\\.issue_1023_is_theme_font\\(`),
      );
    }
  });

  test("Ari's schema pattern is a slug or the same family shape", () => {
    expect(ariValidation).toContain(`GOOGLE_FONT_FAMILY_PATTERN = "${SHAPE}"`);
    expect(ariValidation).toContain(
      `ARI_THEME_FONT_PATTERN =\n  "^([a-z_]+|${SHAPE.slice(1, -1)})$"`,
    );
    expect(ariValidation).toContain(`GOOGLE_FONT_FAMILY_MAX = ${GOOGLE_FONT_FAMILY_MAX}`);
  });

  test("the catalogue build script filters with the same shape and cap", () => {
    expect(buildScript).toContain(`const FAMILY_RE = /${SHAPE}/;`);
    expect(buildScript).toContain(`const FAMILY_MAX = ${GOOGLE_FONT_FAMILY_MAX};`);
  });

  test("the shape refuses look-alikes, lower case, doubled spaces, underscores and injection", () => {
    for (const bad of [
      "roboto slab",
      "Roboto  Slab",
      "Roboto_Slab",
      " Inter",
      "Inter ",
      "Inter;drop",
      "Inter';}body{display:none}",
      "Іnter", // Cyrillic I
      "A".repeat(GOOGLE_FONT_FAMILY_MAX + 1),
    ]) {
      expect(isThemeFontValue(bad)).toBe(false);
    }
    expect(isThemeFontValue("Roboto Slab")).toBe(true);
    expect(isThemeFontValue("inter")).toBe(true);
  });
});

describe("the catalogue", () => {

  test("holds 1,626 eligible families (and never fewer than 1,400)", () => {
    expect(catalog.v).toBe(1);
    expect(names.length).toBe(1626);
    expect(names.length).toBeGreaterThanOrEqual(1400);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every name passes the stored shape, and every row has upright weights and a category", () => {
    for (const [name, cat, weights] of catalog.families) {
      expect(GOOGLE_FONT_FAMILY_RE.test(name) && name.length <= GOOGLE_FONT_FAMILY_MAX).toBe(true);
      expect(["s", "r", "d", "h", "m"]).toContain(cat);
      expect(weights.length).toBeGreaterThan(0);
      for (const w of weights) expect(w % 100).toBe(0);
    }
  });

  test("all 14 bundled families are present and canonicalise to their slugs", () => {
    for (const slug of THEME_FONT_SLUGS) {
      const family = LEGACY_FONT_FAMILY_NAMES[slug];
      expect(names).toContain(family);
      expect(canonicalThemeFont(family)).toBe(slug);
    }
  });

  test("filter rules: no colour, symbol, CJK-primary or oversize families slipped in", () => {
    for (const excluded of ["Noto Color Emoji", "Material Symbols Outlined", "Noto Sans JP", "Google Sans"]) {
      expect(names).not.toContain(excluded);
    }
  });

  test("Popular order: the list opens on Google's most-used families", () => {
    expect(names.slice(0, 5)).toEqual(
      expect.arrayContaining(["Roboto", "Open Sans", "Inter"]),
    );
  });

  test("Ari validates against exactly the catalogue's names", () => {
    expect([...ariFamilies]).toEqual([...names].sort());
  });
});
