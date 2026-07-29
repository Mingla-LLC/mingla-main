/**
 * Issue #1363 [three-tier address] — TESTER adversarial regression test.
 *
 * DIFFERENT ANGLE than the implementor happy-path
 * (orch_1363_pindrop_freetext.implementor.test.ts, which drives the SUCCESS
 * path + a THROWN forward-geocode). This suite attacks the FAILURE/MALFORMED
 * corners the happy-path never touches:
 *
 *   1. Fabricated-coordinate guard (Constitution rule 9): a geocoder that
 *      RESOLVES (does NOT throw) with a NON-FINITE / MISSING location must yield
 *      null — a garbage {lat:NaN}/{location:undefined} response must never leak
 *      through as a "real" coordinate. The implementor only tested a THROWN
 *      error; a resolved-but-malformed body is the untested attack.
 *   2. Zero-Island honesty: a geocoder returning a literal {lat:0,lng:0} is NOT
 *      fabricated by us — but we must never MANUFACTURE a {0,0} when the body is
 *      malformed (asserted via #1: malformed → null, not {0,0}).
 *   3. Reverse-geocode FAILURE isolation (rule 3, pin authority): resolvePinLocation
 *      must keep the dropped coordinate authoritative (precision "exact") and
 *      leave city/region/country NULL when reverse-geocode throws — never
 *      dead-end the pin by returning null. The implementor tested reverse SUCCESS
 *      only.
 *   4. Pin-math southern-hemisphere + antimeridian: the implementor tested only
 *      northern/equatorial centers and an "absurd tap" range clamp. Here a
 *      SOUTHERN center must round-trip its own center exactly (Mercator cy sign),
 *      and a realistic eastward tap across the +180 meridian must WRAP to a
 *      NEGATIVE (western) longitude — never return a value > 180.
 *
 * FAILS-ON-REVERT: reverting the `isFiniteNumber` fabrication guard in
 * resolveFreeTextLocation makes a {lat:NaN} body leak through as non-null ⇒
 * test #1 FAILS. Reverting resolvePinLocation's reverse-failure try/catch to
 * `return null` ⇒ test #3 FAILS. Reverting `normalizeLng` to identity ⇒ the
 * antimeridian assertion in #4 FAILS.
 *
 * Pure/unit — no network, no supabase, no rendering (the service module is
 * mocked so the REAL resolve logic runs against stubbed geocoder bodies).
 */

import type { PlaceDetails } from "@mingla/location-input";

const mockForward = jest.fn<Promise<PlaceDetails>, [string]>();
const mockReverse = jest.fn<Promise<PlaceDetails>, [number, number]>();
jest.mock("../services/mapboxGeocodeService", () => ({
  forwardGeocodeMapbox: (q: string) => mockForward(q),
  reverseGeocodeMapbox: (lat: number, lng: number) => mockReverse(lat, lng),
}));

import {
  resolveFreeTextLocation,
  resolvePinLocation,
} from "../utils/resolveApproxLocation";
import { staticMapPixelToLngLat } from "../utils/staticMapPixelToLngLat";

/** A PlaceDetails with intentionally-controllable location for the attacks. */
const details = (over: Partial<PlaceDetails>): PlaceDetails =>
  ({
    placeId: "",
    formattedAddress: "Somewhere, Lagos",
    city: "Lagos",
    region: "Lagos",
    regionCode: null,
    regionCodeFull: null,
    countryCode: "NG",
    location: { lat: 6.45, lng: 3.4 },
    ...over,
  }) as PlaceDetails;

describe("Issue #1363 — TESTER adversarial (malformed geocode + pin math corners)", () => {
  beforeEach(() => {
    mockForward.mockReset();
    mockReverse.mockReset();
  });

  // ── 1. Fabricated-coordinate guard (rule 9) ────────────────────────────────
  it("resolved body with a NaN latitude → null (never leaks a non-finite coord)", async () => {
    mockForward.mockResolvedValue(
      details({ location: { lat: NaN, lng: 3.4 } as unknown as PlaceDetails["location"] }),
    );
    const approx = await resolveFreeTextLocation("garbage that resolves");
    expect(approx).toBeNull();
  });

  it("resolved body with a MISSING location object → null (no fabricated {0,0})", async () => {
    mockForward.mockResolvedValue(
      details({ location: undefined as unknown as PlaceDetails["location"] }),
    );
    const approx = await resolveFreeTextLocation("resolves but empty");
    expect(approx).toBeNull();
    // Prove no fabrication: the absence of a coordinate is null, not a 0,0 stub.
    expect(approx).not.toEqual({ lat: 0, lng: 0 });
  });

  it("a REAL zero-island {0,0} is passed through faithfully (we don't fabricate, and we don't drop a legit finite coord)", async () => {
    mockForward.mockResolvedValue(
      details({ location: { lat: 0, lng: 0 }, city: "", formattedAddress: "Null Island" }),
    );
    const approx = await resolveFreeTextLocation("null island");
    // {0,0} IS finite → it is a real (if unlikely) coordinate; the guard must
    // not over-reach and null it. Precision is honestly "approximate".
    expect(approx).not.toBeNull();
    expect(approx?.lat).toBe(0);
    expect(approx?.lng).toBe(0);
    expect(approx?.precision).toBe("approximate");
  });

  // ── 3. Reverse-geocode FAILURE isolation (rule 3, pin authority) ───────────
  it("pin: reverse-geocode THROWS → coordinate stays authoritative (exact), admin fields NULL, never null-return", async () => {
    mockReverse.mockRejectedValue(new Error("reverse_unavailable"));
    const resolved = await resolvePinLocation(6.4488, 3.5397);
    expect(resolved).not.toBeNull(); // the pin must NOT dead-end on reverse failure
    expect(resolved?.lat).toBe(6.4488);
    expect(resolved?.lng).toBe(3.5397);
    expect(resolved?.precision).toBe("exact");
    // Honest, not guessed:
    expect(resolved?.city).toBeNull();
    expect(resolved?.region).toBeNull();
    expect(resolved?.countryCode).toBeNull();
  });

  it("pin: a NON-FINITE dropped coordinate itself → null (guards a bad pixel-math result)", async () => {
    const resolved = await resolvePinLocation(NaN, 3.4);
    expect(resolved).toBeNull();
    expect(mockReverse).not.toHaveBeenCalled();
  });

  // ── 4. Pin-math: southern hemisphere + antimeridian wrap ───────────────────
  it("southern-hemisphere center round-trips its own center exactly (Mercator cy sign)", () => {
    const r = staticMapPixelToLngLat({
      centerLat: -34.6037, // Buenos Aires — southern latitude the impl never tested
      centerLng: -58.3816,
      zoom: 12,
      width: 320,
      height: 300,
      px: 160, // W/2
      py: 150, // H/2
    });
    expect(r.lat).toBeCloseTo(-34.6037, 6);
    expect(r.lng).toBeCloseTo(-58.3816, 6);
  });

  it("eastward tap across the +180 meridian WRAPS to a negative (western) longitude — never > 180", () => {
    // Center hard against the antimeridian; tap on the far right edge so the raw
    // (unwrapped) longitude exceeds +180 and MUST wrap into (-180,180] as a
    // negative value. Reverting normalizeLng to identity returns ~+224 → FAILS.
    const r = staticMapPixelToLngLat({
      centerLat: 0,
      centerLng: 179,
      zoom: 2,
      width: 512,
      height: 512,
      px: 512, // right edge → +45° of raw lng past 179 = 224 (unwrapped)
      py: 256,
    });
    expect(r.lng).toBeLessThanOrEqual(180);
    expect(r.lng).toBeGreaterThan(-180);
    expect(r.lng).toBeLessThan(0); // wrapped into the western hemisphere
    expect(Number.isFinite(r.lng)).toBe(true);
  });
});
