#!/usr/bin/env node
// issue #1023 wave 2 — builds the Google Fonts catalogue the theme font picker
// reads, plus the bare family-name list Ari validates against.
//
// Run by hand, then commit both outputs in an ordinary PR:
//   node packages/offering-rendering/scripts/build-google-fonts-catalog.mjs
//
// Source: https://fonts.google.com/metadata/fonts (no API key). Families keep
// Google's popularity order, so an index in `families` is the rank.
//
// Eligible family: Latin subset; at least one upright weight; no colour
// capability; not a Symbols family; not CJK-primary; at most 1.5 MB; and a
// name the database CHECK accepts (the same shape as GOOGLE_FONT_FAMILY_RE in
// ../designTokens.ts). The run fails if a legacy family is missing or the
// count drops below 1,400, so a bad upstream response never ships.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const CATALOG_OUT = path.join(here, "../fonts/googleFontsCatalog.json");
const FAMILIES_OUT = path.join(
  repoRoot,
  "supabase/functions/_shared/googleFontFamilies.json",
);

// Must equal GOOGLE_FONT_FAMILY_RE / GOOGLE_FONT_FAMILY_MAX in designTokens.ts.
const FAMILY_RE = /^[A-Z0-9][A-Za-z0-9]*( [A-Za-z0-9]+)*$/;
const FAMILY_MAX = 40;
const MAX_BYTES = 1_500_000;
const MIN_COUNT = 1400;
const CJK_SCRIPTS = new Set(["Jpan", "Kore", "Hant", "Hans", "Hira", "Kana"]);
const LEGACY_FAMILIES = [
  "Inter",
  "Poppins",
  "Space Grotesk",
  "Plus Jakarta Sans",
  "Manrope",
  "Playfair Display",
  "DM Serif Display",
  "Fraunces",
  "Lora",
  "Bebas Neue",
  "Anton",
  "Unbounded",
  "Caveat",
  "Dancing Script",
];
const CATEGORY_CODE = {
  "Sans Serif": "s",
  Serif: "r",
  Display: "d",
  Handwriting: "h",
  Monospace: "m",
};

const uprightWeights = (fonts) =>
  Object.keys(fonts ?? {})
    .filter((key) => /^\d{3}$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);

export const filterFamilies = (list) => {
  const eligible = [];
  for (const item of list) {
    const name = item.family;
    const cat = CATEGORY_CODE[item.category];
    const weights = uprightWeights(item.fonts);
    if (typeof name !== "string" || cat === undefined) continue;
    if (!FAMILY_RE.test(name) || name.length > FAMILY_MAX) continue;
    if (!(item.subsets ?? []).includes("latin")) continue;
    if (weights.length === 0) continue;
    if ((item.colorCapabilities ?? []).length > 0) continue;
    if ((item.classifications ?? []).some((c) => /symbol/i.test(c))) continue;
    if (CJK_SCRIPTS.has(item.primaryScript)) continue;
    if (typeof item.size === "number" && item.size > MAX_BYTES) continue;
    eligible.push({ name, cat, weights, popularity: item.popularity ?? 1e9 });
  }
  eligible.sort((a, b) => a.popularity - b.popularity);
  return eligible;
};

const main = async () => {
  const response = await fetch("https://fonts.google.com/metadata/fonts");
  if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
  const raw = (await response.text()).replace(/^\)\]\}'\s*/, "");
  const metadata = JSON.parse(raw);
  const families = filterFamilies(metadata.familyMetadataList ?? []);
  const names = new Set(families.map((f) => f.name));
  const missing = LEGACY_FAMILIES.filter((f) => !names.has(f));
  if (missing.length > 0) throw new Error(`legacy families missing: ${missing}`);
  if (families.length < MIN_COUNT) {
    throw new Error(`only ${families.length} families (< ${MIN_COUNT})`);
  }
  const catalog = {
    v: 1,
    generatedAt: new Date().toISOString(),
    source: "fonts.google.com/metadata/fonts",
    families: families.map((f) => [f.name, f.cat, f.weights]),
  };
  fs.writeFileSync(CATALOG_OUT, `${JSON.stringify(catalog)}\n`);
  fs.writeFileSync(
    FAMILIES_OUT,
    `${JSON.stringify([...names].sort())}\n`,
  );
  console.log(`wrote ${families.length} families`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
