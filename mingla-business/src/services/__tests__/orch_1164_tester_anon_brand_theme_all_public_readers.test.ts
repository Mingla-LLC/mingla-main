/**
 * ORCH-1164 (#507 regression recovery) — TESTER adversarial regression test.
 *
 * DIFFERENT ANGLE than the implementor's two tests:
 *   - implementor `orch_1164_anon_trip_page_loads.test.ts` scans ONLY the trip
 *     hook (`usePublicTripBySlug.ts`) for a column-subset.
 *   - the (extended) `orch_1138_tester_anon_brand_theme_columns.test.ts` scans
 *     ONLY `publicExperienceService.ts` + `usePublicTripBySlug.ts`.
 *
 * #507 proved the failure mode is NOT trip-specific: any anon-reachable read
 * path that adds `theme_color/theme_font/theme_animation` to a DIRECT
 * `supabase.from("brands").select(...)` 401s the whole anon query
 * (`42501 permission denied for table brands`) and blanks the public page.
 * The implementor's guards leave a HOLE: a future regression in
 * `publicEventsService.ts`, `usePublicTripById.ts`, `usePublicEvents.ts`, or
 * `usePublicExperience.ts` would ship green. This test closes that hole by
 * GLOBBING EVERY public read path (the spec's preferred B1 coverage, OQ/D-4)
 * and asserting NO brands.select anywhere requests a theme_* column.
 *
 * Brand theme on public pages MUST be sourced from the anon-safe
 * security-definer `business_public_events_view` (COMMS-0009 /
 * I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW), never read directly off `brands`.
 *
 * FAILS-ON-REVERT: re-adding theme_color/theme_font/theme_animation to ANY
 * `.from("brands").select(...)` in ANY scanned public reader flips this red
 * (verified by the tester against the exact #507 break in usePublicTripBySlug).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "..", "..");
const HOOKS_DIR = resolve(SRC, "hooks");
const SERVICES_DIR = resolve(SRC, "services");

// EVERY anon-reachable public read path: usePublic*.ts hooks + public*Service.ts.
// Globbed (not hardcoded) so a NEW public reader is automatically covered.
const collect = (dir: string, re: RegExp): string[] =>
  readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => resolve(dir, f));

const PUBLIC_READERS = [
  ...collect(HOOKS_DIR, /^usePublic.*\.ts$/),
  ...collect(SERVICES_DIR, /^public.*Service\.ts$/),
];

const FORBIDDEN = ["theme_color", "theme_font", "theme_animation"];

// Matches `.from("brands") ... .select(<literal>)` allowing an optional trailing
// comma before the close paren (the column lists are multi-line with a trailing
// comma). The lazy capture terminates at the first real string boundary.
const BRANDS_SELECT =
  /\.from\(\s*["']brands["']\s*\)[\s\S]*?\.select\(\s*([`"'])([\s\S]*?)\1\s*,?\s*\)/g;

describe("ORCH-1164 tester adversarial — NO public read path selects brands.theme_* (P0, all-readers glob)", () => {
  test("sanity: the glob actually found public read paths (guard is not vacuous)", () => {
    expect(PUBLIC_READERS.length).toBeGreaterThanOrEqual(4);
  });

  test("sanity: at least one public reader DOES select from brands directly (guard targets real calls)", () => {
    const readersHittingBrands = PUBLIC_READERS.filter((f) =>
      Array.from(readFileSync(f, "utf8").matchAll(BRANDS_SELECT)).length > 0,
    );
    expect(readersHittingBrands.length).toBeGreaterThan(0);
  });

  test("no public reader's brands.select(...) requests a non-anon-readable theme_* column", () => {
    const offenders: string[] = [];
    for (const file of PUBLIC_READERS) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(BRANDS_SELECT)) {
        const cols = m[2];
        for (const col of FORBIDDEN) {
          // word-boundary so brand_theme_color / theme_color_override do NOT
          // false-positive — only a bare brands-table theme_* column counts.
          if (new RegExp(`(^|[,\\s])${col}([,\\s]|$)`).test(cols)) {
            offenders.push(`${file.split("/src/")[1]} :: ${col}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
