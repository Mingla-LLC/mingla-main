// @ts-nocheck
// ORCH-1062 Part 2 (implementor-owned, happy-path) regression test.
//
// Deno-runnable: imports the PURE exports `VISIBLE_CATEGORY_SLUGS` and
// `getCategoryIcon` from categoryUtils.ts. categoryUtils.ts has NO top-level RN
// imports (the i18n singleton is loaded lazily — see the §6.1/ORCH-1044 seam
// note in the source), so this never boots react-i18next / AsyncStorage.
//
// Asserts the three new vibe slugs (romantic / lively / scenic) are:
//   (a) present in VISIBLE_CATEGORY_SLUGS (so they survive normalization +
//       appear in user-facing slug lists),
//   (b) mapped to their exact glyphs in getCategoryIcon.
//
// Fails-on-revert: removing the slugs from VALID_SLUGS drops them from the
// derived VISIBLE_CATEGORY_SLUGS (clause a fails); removing the iconMap entries
// makes getCategoryIcon fall back to 'location' (clause b fails).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  VISIBLE_CATEGORY_SLUGS,
  getCategoryIcon,
} from "../categoryUtils.ts";

const VIBE: Array<[string, string]> = [
  ["romantic", "heart-pulse"],
  ["lively", "flame"],
  ["scenic", "tree-pine"],
];

Deno.test("ORCH-1062 T-15a: vibe slugs are visible categories", () => {
  for (const [slug] of VIBE) {
    assert(
      VISIBLE_CATEGORY_SLUGS.includes(slug),
      `expected VISIBLE_CATEGORY_SLUGS to contain "${slug}"`,
    );
  }
});

Deno.test("ORCH-1062 T-15b: vibe slugs map to their exact glyphs", () => {
  for (const [slug, glyph] of VIBE) {
    assertEquals(
      getCategoryIcon(slug),
      glyph,
      `expected getCategoryIcon("${slug}") === "${glyph}"`,
    );
  }
});

Deno.test("ORCH-1062 T-15c: existing categories unchanged (no regression)", () => {
  // Spot-check shipped pills still resolve to their glyphs + stay visible.
  assertEquals(getCategoryIcon("nature"), "trees");
  assertEquals(getCategoryIcon("upscale_fine_dining"), "chef-hat");
  assert(VISIBLE_CATEGORY_SLUGS.includes("play"));
  assert(VISIBLE_CATEGORY_SLUGS.includes("movies"));
  // Hidden / legacy slugs must NOT leak into the visible list.
  assert(!VISIBLE_CATEGORY_SLUGS.includes("flowers"));
  assert(!VISIBLE_CATEGORY_SLUGS.includes("brunch_lunch_casual"));
});
