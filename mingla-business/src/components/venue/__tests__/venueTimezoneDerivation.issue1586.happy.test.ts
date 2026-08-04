/**
 * issue #1586 [timezone-backfill] — THE ZONE NAMES, AND WHOSE CHOICE WINS.
 *
 * WHAT THIS FILE GUARDS THAT THE SQL SUITE CANNOT. The Postgres suite
 * (`supabase/migrations/__tests__/issue_1586_venue_timezone_derivation.test.sql`)
 * proves the derivation resolves the right zone for ~100 real coordinates and
 * that an operator's choice survives a re-run. It cannot reach the ONE
 * function that decides whether any of those values will render:
 * `isIanaZoneName` in `packages/brand-rendering/venueOpenState.ts`.
 *
 * That is the whole trap this issue was written around. #1562's resolver
 * REFUSES anything that is not an IANA zone NAME — `-05:00`, `+0500`, `Z`,
 * `Etc/GMT+5`, `EST` — because an offset cannot express daylight saving
 * (`-05:00` IS New York in January and is an hour WRONG in July) and because
 * offset acceptance tracks the runtime's ICU version, so one stored row would
 * render "Open" on the web and "unknown" on a phone. A backfill that produced
 * offsets would therefore not merely be wrong; it would go SILENTLY green in
 * SQL and blank the feature in the product.
 *
 * So this file takes every zone the migration can ever produce, out of the
 * migration itself, and runs each one through the real validator and the real
 * engine. Nothing is assumed; both directions are asserted.
 *
 * EVERY LOOKUP IS VACUITY-GUARDED. The seed is parsed out of a .sql file, and
 * a parser that matched nothing would make every "no bad zones" assertion pass
 * trivially — so the count is asserted BEFORE the contents are, and the
 * validator is checked against a known-bad input in the same test so it cannot
 * pass by returning true for everything.
 *
 * FAILS ON REVERT:
 *   - deleting `iana_timezone_source` from the view's CASE gate makes the
 *     "publishes NULL for an unestablished clock" test fail;
 *   - deleting the `iana_timezone_source = "operator"` line from
 *     `buildVenueAvailabilityConfigRow` makes the operator-provenance tests
 *     fail;
 *   - replacing any seeded zone with an offset makes the name-rule tests fail.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest venueTimezoneDerivation.issue1586 --runInBand
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

import { isIanaZoneName } from "@mingla/brand-rendering/venueOpenState";

import {
  buildVenueAvailabilityConfigRow,
  readVenueTimezoneSource,
} from "../../../hooks/useVenueAvailability";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = path.join(
  REPO_ROOT,
  "supabase/migrations/20270215001586_issue_1586_venue_timezone_derivation.sql",
);

const migrationSql = readFileSync(MIGRATION, "utf8");

/**
 * Every zone name the seed can hand back. Matched on the IANA shape itself
 * (`Region/Location`) rather than on column position, so re-formatting the
 * INSERT cannot make this parser quietly stop finding rows.
 */
const seededZones: string[] = Array.from(
  new Set(
    (
      migrationSql.match(
        /'([A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+)'/g,
      ) ?? []
    )
      .map((quoted) => quoted.slice(1, -1))
      // The file also contains SQL identifiers with slashes in prose and the
      // `public.x` schema-qualified names; zones always carry a region prefix
      // from this fixed set.
      .filter((z) =>
        /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(
          z,
        ),
      ),
  ),
).sort();

describe("#1586 — every zone the backfill can produce is a NAME, and renders", () => {
  test("the seed was actually found, and is the size the migration claims", () => {
    expect.assertions(3);
    // VACUITY GUARD. A parser that matched nothing would make every assertion
    // below trivially true. The migration's own seed guard refuses fewer than
    // 200 region rows; the distinct NAMES are fewer than the rows (the US uses
    // America/New_York across several rectangles), so 180 is the floor.
    expect(seededZones.length).toBeGreaterThan(180);
    // And the two live non-US markets are actually in there, which is what
    // makes "all zones are fine" mean something about this product.
    expect(seededZones).toContain("Africa/Lagos");
    expect(seededZones).toContain("Europe/London");
  });

  /**
   * THE HEADLINE ASSERTION. #1562 pinned that every zone its own operator
   * picker can offer is accepted by `isIanaZoneName`. This is the other half:
   * every zone this backfill can WRITE is accepted by the same gate. A zone
   * that fails here is a venue whose page silently renders no time cell.
   */
  test("every seeded zone passes #1562's validator", () => {
    expect.assertions(2);
    expect(seededZones.filter((z) => !isIanaZoneName(z))).toEqual([]);
    // …and the gate is not simply returning true for everything.
    expect(isIanaZoneName("-05:00")).toBe(false);
  });

  /**
   * The validator precedes the engine; it does not replace it. A shape-valid
   * zone that does not exist (`Mars/Olympus_Mons`) passes `isIanaZoneName` and
   * is caught here, by `Intl`, which is the authority on which zones are real.
   */
  test("every seeded zone is a zone the runtime can actually format in", () => {
    expect.assertions(2);
    const refused = seededZones.filter((zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
        return false;
      } catch {
        return true;
      }
    });
    expect(refused).toEqual([]);
    // Control: a shape-valid zone that does not exist IS refused here, so the
    // check above cannot be passing because the try/catch never fires.
    expect(() =>
      new Intl.DateTimeFormat("en-US", { timeZone: "Mars/Olympus_Mons" }).format(
        new Date(0),
      ),
    ).toThrow();
  });

  /**
   * THE ANTI-PATTERN, named. `place_pool.utc_offset_minutes` is a NUMBER that
   * already exists in this database beside every venue, and turning it into
   * `"-05:00"` is the obvious thing to reach for. It is also exactly the defect
   * #1586 exists to end, so the migration must never consult it.
   */
  test("the migration derives from coordinates, never from utc_offset_minutes", () => {
    expect.assertions(4);
    // Reduce to EXECUTABLE SQL first. Both the header comment and the
    // COMMENT ON bodies name the anti-pattern in prose — deliberately — so a
    // naive substring search would hit the warning rather than a use of it.
    // Line comments go, then every single-quoted literal ('' escapes included).
    const executable = migrationSql
      .replace(/^\s*--.*$/gm, "")
      .replace(/'(?:[^']|'')*'/g, "''");
    // Vacuity guard on the reduction itself: over-eager stripping would leave
    // nothing and make the two negatives below trivially true.
    expect(executable.length).toBeGreaterThan(2000);
    // The column exists in this database, sits beside every venue, and is a
    // NUMBER. Deriving "-05:00" from it is the exact defect #1586 ends.
    expect(executable).not.toContain("utc_offset_minutes");
    // Positive control: the derivation really is reading the venue's location.
    expect(executable).toContain("v.lat, v.lng, v.country_code");
    // No offset-shaped string is ever written as a zone.
    expect(migrationSql).not.toMatch(/'[+-]\d{2}:\d{2}'/);
  });

  /**
   * The view gate is what makes `'UTC'` safe. A row still sitting on the
   * column's own default publishes NULL, so #1562 renders no time cell instead
   * of computing a confident open-now in UTC for a venue in Raleigh.
   */
  test("the public view publishes a zone only when someone established it", () => {
    expect.assertions(2);
    expect(migrationSql).toContain(
      "CASE WHEN vac.iana_timezone_source IN ('derived', 'operator')",
    );
    // …and the un-gated form is gone. Its return is the regression.
    const viewBody = migrationSql.slice(
      migrationSql.indexOf("CREATE OR REPLACE VIEW public.venue_public_view"),
    );
    expect(viewBody).not.toMatch(/^\s*vac\.iana_timezone AS iana_timezone/m);
  });
});

describe("#1586 — a human's choice is distinguishable, and protected", () => {
  const BRAND = "11111111-1111-4111-8111-111111111111";
  const VENUE = "22222222-2222-4222-8222-222222222222";

  test("choosing a zone writes the operator provenance in the SAME statement", () => {
    expect.assertions(3);
    const row = buildVenueAvailabilityConfigRow(BRAND, VENUE, {
      ianaTimezone: "America/New_York",
    });
    expect(row.iana_timezone).toBe("America/New_York");
    // This single key is the entire protection: the backfill's predicate is
    // `WHERE iana_timezone_source <> 'operator'`, so writing it here is what
    // takes the row permanently out of the derivation's reach.
    expect(row.iana_timezone_source).toBe("operator");
    // The zone an operator picks is still subject to the same name rule.
    expect(isIanaZoneName(String(row.iana_timezone))).toBe(true);
  });

  test("an unrelated edit never touches provenance", () => {
    expect.assertions(4);
    const row = buildVenueAvailabilityConfigRow(BRAND, VENUE, {
      bufferMinutes: 15,
    });
    // Both keys ABSENT, not present-and-null: an explicit null would overwrite
    // a derived zone with nothing, and an explicit 'default' would hand a
    // venue's established clock back to the derivation.
    expect(Object.keys(row)).not.toContain("iana_timezone");
    expect(Object.keys(row)).not.toContain("iana_timezone_source");
    // Vacuity guard: the patch DID do its actual job, so the two absences
    // above are not "the builder ignored the patch".
    expect(row.buffer_minutes).toBe(15);
    expect(row.venue_id).toBe(VENUE);
  });

  test("an unrecognised provenance reads as 'default' — the silent arm", () => {
    expect.assertions(5);
    // The safe reading. 'default' is the value that makes the public view
    // publish NULL, so a wire value this build does not understand produces
    // silence rather than a claim.
    expect(readVenueTimezoneSource(null)).toBe("default");
    expect(readVenueTimezoneSource("")).toBe("default");
    expect(readVenueTimezoneSource("something-new")).toBe("default");
    // …and the two real values are passed through, so the reader is not simply
    // constant.
    expect(readVenueTimezoneSource("derived")).toBe("derived");
    expect(readVenueTimezoneSource("operator")).toBe("operator");
  });
});
