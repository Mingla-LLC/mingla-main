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

const src = readFileSync(
  path.join(process.cwd(), "src/components/trip/TripPreview.tsx"),
  "utf8",
);

// The FOUNDATION render path only (the LegacyTripPreview is the framed wizard
// preview, which also never rendered stops). We assert against the whole file.
describe("RT-4 ORCH-1138 — TripPreview renders no fabricated trip fields", () => {
  test("no per-day timed-stop rows are rendered", () => {
    // The Trip model carries `day.stops` (a JSON array) but the wizard does not
    // author them. They must NOT be mapped/rendered anywhere.
    expect(src).not.toMatch(/day\.stops\b/);
    expect(src).not.toMatch(/\.stops\.map\(/);
    expect(src).not.toMatch(/stops\.map\(/);
  });

  test("the destination map is GATED on real lat/lng (no placeholder map)", () => {
    // The map block must be guarded by a lat !== null && lng !== null check.
    expect(src).toContain("bt.destinationLat !== null && bt.destinationLng !== null");
  });

  test("no trip-level standalone gallery (per-day media is the only imagery)", () => {
    // There is no Trip.gallery field; the only gallery is the per-day
    // CountAwareGallery fed from `day.media`.
    expect(src).not.toMatch(/trip\.gallery\b/);
    expect(src).toContain("mediaToGalleryItems(day)");
  });

  test("per-day media galleries are fed from real day.media only", () => {
    expect(src).toContain("day.media.map");
  });
});
