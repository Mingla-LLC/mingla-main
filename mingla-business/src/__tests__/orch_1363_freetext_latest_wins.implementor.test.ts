/**
 * Issue #1363 P3-2 — fire-and-forget free-text resolve race (latest-wins guard).
 *
 * The free-text forward-geocode is un-cancellable: a slow earlier resolve can
 * land AFTER the user has re-typed / picked / cleared the field, and would patch
 * a coordinate for text the field no longer shows (a STALE coordinate landing on
 * the draft). Every business address host now records the text it is resolving
 * and drops the async result when the field's committed text has since changed,
 * via `isFreeTextResolveStale`.
 *
 * This suite exercises that guard directly AND simulates the host success path
 * (commit -> resolve starts -> field changes -> stale resolve lands) to prove the
 * stale patch is dropped. Fails-on-revert: neuter `isFreeTextResolveStale` to
 * always return `false` (never stale) -> the "stale is dropped" cases fail.
 */
// Mock the business geocode service so importing resolveApproxLocation does not
// pull in @mingla/location-input / supabase under node (mirrors the sibling
// #1363 suites). The guard + contract assertions never hit the real geocoder.
jest.mock("../services/mapboxGeocodeService", () => ({
  forwardGeocodeMapbox: jest.fn(),
  reverseGeocodeMapbox: jest.fn(),
}));

import {
  isFreeTextResolveStale,
  resolveFreeTextLocation,
  type ApproxLocation,
} from "../utils/resolveApproxLocation";

// A coarse "approximate" hit, as resolveFreeTextLocation would return.
const hit = (lat: number, lng: number): ApproxLocation => ({
  lat,
  lng,
  city: "City",
  region: null,
  countryCode: "US",
  formattedAddress: "Somewhere",
  precision: "approximate",
});

describe("isFreeTextResolveStale — pure latest-wins guard", () => {
  it("is FRESH (not stale) when the committed text is unchanged", () => {
    expect(isFreeTextResolveStale("Lekki, Lagos", "Lekki, Lagos")).toBe(false);
  });

  it("is STALE when the committed text has changed since the resolve began", () => {
    expect(isFreeTextResolveStale("Lekki", "Lekki Phase 1")).toBe(true);
  });

  it("is STALE when the field was cleared while the resolve was in flight", () => {
    expect(isFreeTextResolveStale("Lekki", "")).toBe(true);
  });

  it("ignores surrounding whitespace on both sides (never a false-stale)", () => {
    expect(isFreeTextResolveStale("  Lekki, Lagos ", "Lekki, Lagos")).toBe(false);
  });
});

/**
 * Mirrors the host onFreeText success path: AWAIT the (async, un-cancellable)
 * geocode, THEN patch the coordinate only when the resolve is still the latest
 * (committed text unchanged). `committedRef` is the host's mutable ref of the
 * field's currently-committed text; the await models the network delay during
 * which the field can change under the in-flight resolve.
 */
async function hostApplyFreeText(
  resolvedForText: string,
  committedRef: { current: string },
  approxPromise: Promise<ApproxLocation | null>,
  patchCoords: (a: ApproxLocation) => void,
): Promise<void> {
  const approx = await approxPromise; // = await resolveFreeTextLocation(text)
  if (isFreeTextResolveStale(resolvedForText, committedRef.current)) return;
  if (approx !== null) patchCoords(approx);
}

describe("host free-text race — stale resolve must not land on the draft", () => {
  it("DROPS an earlier resolve that lands after the user kept typing", async () => {
    const committedRef = { current: "Lekki" };
    let coords: ApproxLocation | null = null;

    // User taps "Use 'Lekki'" -> resolve for "Lekki" begins (still in flight).
    const inflight = hostApplyFreeText(
      "Lekki",
      committedRef,
      Promise.resolve(hit(6.45, 3.47)),
      (a) => {
        coords = a;
      },
    );
    // Before it resolves, the user edits the field (host nulls coords + bumps ref).
    committedRef.current = "Lekki Phase 1";
    await inflight;

    // The stale "Lekki" coordinate was NOT applied under the new text.
    expect(coords).toBeNull();
  });

  it("DROPS an earlier resolve that lands after the field was cleared", async () => {
    const committedRef = { current: "Lekki" };
    let coords: ApproxLocation | null = null;

    const inflight = hostApplyFreeText(
      "Lekki",
      committedRef,
      Promise.resolve(hit(6.45, 3.47)),
      (a) => {
        coords = a;
      },
    );
    committedRef.current = ""; // onClear
    await inflight;

    expect(coords).toBeNull();
  });

  it("APPLIES the resolve on the normal (non-racing) path — behavior preserved", async () => {
    const committedRef = { current: "Lekki, Lagos" };
    let coords: ApproxLocation | null = null;

    await hostApplyFreeText(
      "Lekki, Lagos",
      committedRef,
      Promise.resolve(hit(6.45, 3.47)),
      (a) => {
        coords = a;
      },
    );

    expect(coords).not.toBeNull();
    expect(coords).toMatchObject({ lat: 6.45, lng: 3.47, precision: "approximate" });
  });

  it("keeps the LATEST of two rapid commits, dropping the superseded first", async () => {
    const committedRef = { current: "Lekki" };
    let coords: ApproxLocation | null = null;

    // First commit "Lekki" starts resolving (in flight).
    const first = hostApplyFreeText(
      "Lekki",
      committedRef,
      Promise.resolve(hit(6.45, 3.47)),
      (a) => {
        coords = a;
      },
    );
    // Second commit "Yaba" supersedes it (ref bumped), and resolves.
    committedRef.current = "Yaba";
    await hostApplyFreeText(
      "Yaba",
      committedRef,
      Promise.resolve(hit(6.51, 3.38)),
      (a) => {
        coords = a;
      },
    );
    // The earlier "Lekki" resolve lands but is now stale -> dropped.
    await first;

    expect(coords).toMatchObject({ lat: 6.51, lng: 3.38 }); // Yaba wins
  });
});

// Sanity: the guard leaves the resolver's own contract untouched (empty -> null).
describe("resolveFreeTextLocation contract still holds", () => {
  it("returns null for empty input without calling the geocoder", async () => {
    let called = false;
    const out = await resolveFreeTextLocation("   ", {
      forward: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    expect(out).toBeNull();
    expect(called).toBe(false);
  });
});
