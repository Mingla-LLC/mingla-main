/**
 * Issue #1363 [three-tier address · Tier-3 pin-drop] — IMPLEMENTOR pure-math test
 * (SPEC §6.4 / §12).
 *
 * `staticMapPixelToLngLat` is the ONLY coordinate-guessing step in the pin-drop
 * flow (it recenters the map on a tap). It is pure Web-Mercator math, so it is
 * unit-testable exactly and fails-on-revert if the formula is broken:
 *   - a tap on the image CENTER must return the center's own lng/lat exactly;
 *   - a tap at a KNOWN off-center pixel must return the documented Mercator
 *     result (at zoom 1 the right edge of a 512-wide image centered at (0,0) is
 *     +90° longitude).
 */

import { staticMapPixelToLngLat } from "../utils/staticMapPixelToLngLat";

describe("staticMapPixelToLngLat (Issue #1363 pin-drop math)", () => {
  it("returns the center's own coordinate for a tap on the image center", () => {
    const r = staticMapPixelToLngLat({
      centerLat: 6.4488, // Lekki, Lagos — the un-indexed-place case.
      centerLng: 3.5397,
      zoom: 13,
      width: 350,
      height: 340,
      px: 175, // W/2
      py: 170, // H/2
    });
    expect(r.lat).toBeCloseTo(6.4488, 6);
    expect(r.lng).toBeCloseTo(3.5397, 6);
  });

  it("maps the right edge to +90° longitude at zoom 1 (documented Mercator)", () => {
    // worldPx = 512 * 2**1 = 1024; a 512-wide image centered at (0,0) spans half
    // the world in x, so its right edge (256 px right of center) is +90° lng.
    const r = staticMapPixelToLngLat({
      centerLat: 0,
      centerLng: 0,
      zoom: 1,
      width: 512,
      height: 512,
      px: 512, // right edge
      py: 256, // vertical center
    });
    expect(r.lng).toBeCloseTo(90, 6);
    expect(r.lat).toBeCloseTo(0, 6);
  });

  it("moves latitude NORTH for a tap above center", () => {
    const r = staticMapPixelToLngLat({
      centerLat: 0,
      centerLng: 0,
      zoom: 1,
      width: 512,
      height: 512,
      px: 256, // horizontal center
      py: 0, // top edge
    });
    // Top edge (256px above center at zoom 1) → the Web-Mercator latitude
    // atan(sinh(pi/2)) ≈ 66.51°N; sign must be positive (north), never NaN.
    expect(r.lat).toBeGreaterThan(60);
    expect(r.lat).toBeLessThan(70);
    expect(r.lng).toBeCloseTo(0, 6);
  });

  it("clamps latitude to the Web-Mercator limit and wraps longitude", () => {
    const r = staticMapPixelToLngLat({
      centerLat: 85,
      centerLng: 179,
      zoom: 2,
      width: 400,
      height: 400,
      px: 20000, // absurd tap far off the image → still in-range output
      py: -20000,
    });
    expect(r.lat).toBeLessThanOrEqual(85.06);
    expect(r.lat).toBeGreaterThanOrEqual(-85.06);
    expect(r.lng).toBeGreaterThan(-180);
    expect(r.lng).toBeLessThanOrEqual(180);
    expect(Number.isFinite(r.lat)).toBe(true);
    expect(Number.isFinite(r.lng)).toBe(true);
  });
});
