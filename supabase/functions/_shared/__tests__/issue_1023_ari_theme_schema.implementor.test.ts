// issue #1023 wave 2 — P-9. Ari's update_brand_context theme: the schema
// accepts a Google family name and all 29 motions, the proposal check and the
// handler refuse a misspelt family and a second colour without a first, and a
// bundled family is sent as its slug.
//
// Fails on revert: the 14-item font enum coming back, the 9-item motion enum,
// or validateAriTheme accepting any shape-valid name.
import {
  assert,
  assertEquals,
  assertMatch,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { assertSiteToolArgs, SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import {
  ARI_THEME_FONT_PATTERN,
  THEME_ANIMATION_SLUGS,
  validateAriTheme,
} from "../themeFontValidation.ts";

const tool = SITE_AGENT_TOOLS.find((t) => t.name === "update_brand_context");
// deno-lint-ignore no-explicit-any
const themeSchema = (tool?.parameters as any)?.properties?.patch?.properties?.theme;

Deno.test("#1023 — the theme schema takes a family name, color2 and 29 motions", () => {
  assert(themeSchema, "update_brand_context exposes a theme schema");
  const font = themeSchema.properties.font;
  assertEquals(font.enum, undefined);
  assertEquals(font.pattern, ARI_THEME_FONT_PATTERN);
  assertEquals(font.maxLength, 40);
  for (const ok of ["Roboto Slab", "inter", "DM Serif Display"]) {
    assertMatch(ok, new RegExp(font.pattern));
  }
  assertEquals(themeSchema.properties.color2.pattern, "^#[0-9a-fA-F]{6}$");
  assertEquals(themeSchema.properties.animation.enum.length, 30);
  assert(themeSchema.properties.animation.enum.includes("aurora"));
  assertEquals([...themeSchema.properties.animation.enum], [...THEME_ANIMATION_SLUGS]);
});

Deno.test("#1023 — a real family saves; a misspelt one is refused with the tool copy", () => {
  const ok = validateAriTheme({ color: "#e8508f", font: "Roboto Slab", animation: "aurora" });
  assertEquals(ok, { ok: true, theme: { color: "#e8508f", font: "Roboto Slab", animation: "aurora" } });
  const bad = validateAriTheme({ font: "Robotto Slab" });
  assertEquals(bad, {
    ok: false,
    message: "Unknown font `Robotto Slab`. Use an exact Google Fonts family name.",
  });
  assertEquals(validateAriTheme({ font: "Comic Sans MS" }).ok, false);
});

Deno.test("#1023 — a bundled family is sent as its slug; slugs still pass", () => {
  assertEquals(validateAriTheme({ font: "Inter" }), { ok: true, theme: { font: "inter" } });
  assertEquals(validateAriTheme({ font: "dancing_script" }).ok, true);
});

Deno.test("#1023 — a second colour needs a first", () => {
  assertEquals(validateAriTheme({ color2: "#7c5cff" }).ok, false);
  assertEquals(validateAriTheme({ color: "#e8508f", color2: "#7c5cff" }).ok, true);
  assertEquals(validateAriTheme({ color: "#e8508f", color2: "violet" }).ok, false);
});

Deno.test("#1023 — the proposal check refuses before the owner is asked", () => {
  const base = {
    why: "Matches the brand's new look.",
    cites: [{ kind: "owner_words", quote: "Use Berry and Roboto Slab." }],
  };
  assertThrows(
    () => assertSiteToolArgs("update_brand_context", { ...base, patch: { theme: { font: "Robotto Slab" } } }),
    Error,
    "Unknown font",
  );
  assertThrows(
    () => assertSiteToolArgs("update_brand_context", { ...base, patch: { theme: { color2: "#7c5cff" } } }),
    Error,
    "second colour",
  );
  assertSiteToolArgs("update_brand_context", {
    ...base,
    patch: { theme: { color: "#e8508f", color2: "#7c5cff", font: "Roboto Slab" } },
  });
});
