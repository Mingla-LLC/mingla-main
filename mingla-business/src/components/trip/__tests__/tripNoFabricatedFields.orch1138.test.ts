/**
 * RT-4 — no-fabricated-trip-fields structural gate (ORCH-1138 / Constitution #9).
 *
 * The public trip page renders ONLY real model fields. It MUST NOT render:
 *   - per-day timed STOPS (the wizard does not author them — mockup v3 removed),
 *   - a trip-level standalone gallery (no model field — mockup v5 removed),
 *   - a placeholder map (the destination map renders ONLY when lat/lng present).
 * Cites I-PROPOSED-1138-NO-FABRICATED-TRIP-FIELDS.
 *
 * fails-on-revert: re-introducing a `day.stops` render row, a trip-level gallery,
 * or an unconditional map block in TripPreview flips this gate red.
 * Owner: mingla-implementor.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

// [TEST-MOD-APPROVED META-ORCH-1174] retarget: the public-trip render moved into
// the shared @mingla/offering-rendering body — the destination map gate now lives in
// TripOfferingBody (gated on data.destinationLat/Lng) and the per-day gallery in the
// promoted DayByDay (fed from real day.media). The no-fabricated-fields invariant
// (I-PROPOSED-1138-NO-FABRICATED-TRIP-FIELDS) is byte-preserved at the new homes.
const bodySrc = readFileSync(
  path.join(process.cwd(), "../packages/offering-rendering/TripOfferingBody.tsx"),
  "utf8",
);
const dayByDaySrc = readFileSync(
  path.join(process.cwd(), "../packages/offering-rendering/DayByDay.tsx"),
  "utf8",
);

describe("RT-4 ORCH-1138 — the shared trip body renders no fabricated trip fields", () => {
  test("no per-day timed-stop rows are rendered", () => {
    // The Trip model carries `day.stops` (a JSON array) but the wizard does not
    // author them. They must NOT be mapped/rendered in the body or DayByDay.
    expect(bodySrc).not.toMatch(/\bstops\.map\(/);
    expect(dayByDaySrc).not.toMatch(/\bstops\.map\(/);
    expect(dayByDaySrc).not.toMatch(/day\.stops\b/);
  });

  test("the destination map is GATED on real lat/lng (no placeholder map)", () => {
    // The §11 map block must be guarded by a lat !== null && lng !== null check.
    expect(bodySrc).toContain(
      "data.destinationLat !== null && data.destinationLng !== null",
    );
  });

  test("no trip-level standalone gallery (per-day media is the only imagery)", () => {
    // There is no trip-level gallery; the only gallery is the per-day one inside
    // DayByDay, fed from real day.media.
    expect(bodySrc).not.toMatch(/trip\.gallery\b/);
    expect(dayByDaySrc).toContain("day.media");
  });

  test("per-day media galleries are fed from real day.media only", () => {
    expect(dayByDaySrc).toMatch(/day\.media/);
  });
});
