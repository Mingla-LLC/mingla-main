/**
 * ORCH-1138 Leg 3 REWORK — TESTER ADVERSARIAL (different angle than the
 * implementor's render/seed happy-path).
 *
 * ANGLE: anon column-privilege of the WEB publicExperienceService brand read.
 *
 * P0 found in pre-merge QA: the rework added `theme_color, theme_font,
 * theme_animation` to the `supabase.from("brands").select(...)` call in
 * publicExperienceService.fetchPublicExperienceBySlug. The `anon` Postgres role
 * does NOT have column-level SELECT on those three theme columns (proven live:
 * a select including them returns 42501 "permission denied for table brands",
 * HTTP 401 — while the same select WITHOUT them returns 200). Because the public
 * /exp/{brandSlug}/{experienceSlug} route is anon-tolerant, this 401 makes the
 * ENTIRE page fail to load ("Couldn't load experience") for every logged-out
 * buyer. The anon-safe path (the SPEC's COMMS-0009 contract) is to read theme
 * from `business_public_events_view` (which exposes `brand_theme_color` /
 * `brand_theme_font` / `brand_theme_animation`, anon-readable), NOT from a raw
 * `.from("brands")` select.
 *
 * This guard FAILS while the service selects the non-anon-readable theme columns
 * directly off `brands`, and PASSES once the theme source is moved to the
 * anon-safe view (or the columns are removed from the brands select).
 *
 * FAILS-ON-REVERT: re-adding `theme_color`/`theme_font`/`theme_animation` to the
 * `.from("brands").select(...)` flips this red.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVICE = resolve(__dirname, "..", "publicExperienceService.ts");

describe("ORCH-1138 tester adversarial — anon cannot read brands.theme_* (P0)", () => {
  const src = readFileSync(SERVICE, "utf8");

  // Capture each `.from("brands") ... .select(<literal>)` block. The chain can
  // span multiple lines (.eq/.is between from and select), and the select string
  // itself can be multi-line, so the capture is greedy up to the closing
  // `.select( ... )` quote+paren — bounded by the next statement terminator.
  const brandSelects = Array.from(
    src.matchAll(
      /\.from\(\s*["']brands["']\s*\)[\s\S]*?\.select\(\s*([`"'])([\s\S]*?)\1\s*\)/g,
    ),
  ).map((m) => m[2]);

  test("publicExperienceService DOES read brands (sanity — guard targets the right call)", () => {
    expect(brandSelects.length).toBeGreaterThan(0);
  });

  const FORBIDDEN = ["theme_color", "theme_font", "theme_animation"];

  test.each(FORBIDDEN)(
    "no brands.select(...) requests the non-anon-readable column %s",
    (col) => {
      const offenders = brandSelects.filter((s) => s.includes(col));
      expect(offenders).toEqual([]);
    },
  );
});
