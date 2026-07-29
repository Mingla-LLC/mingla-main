/**
 * Issue #1363 [three-tier address] — IMPLEMENTOR happy-path regression test
 * (SPEC §12). Drives the venue s0 flow through the THREE tiers' shared owners:
 *
 *   Tier 2 (free-text): resolveFreeTextLocation() → coord (precision "approximate")
 *   Tier 3 (pin-drop):  staticMapPixelToLngLat() → coord, resolvePinLocation()
 *                       → coord (precision "exact")
 *
 * and asserts the un-indexed Nigerian address becomes SUBMITTABLE:
 *   venueStepError("s0", draft) === null  AND  the createVenueListing input
 *   carries a NON-NULL coordinate (satisfying the DB location_required guard).
 *
 * FAILS-ON-REVERT: if the free-text/pin coordinate logic is reverted (the
 * resolve helpers stop returning a coordinate), the applied patch leaves lat/lng
 * null ⇒ venueStepError returns the "Add the location …" error ⇒ this test FAILS.
 *
 * The service module is mocked so the resolve helpers run their REAL logic
 * against stubbed geocoder responses (no network, no supabase) — the assertions
 * exercise resolveFreeTextLocation / resolvePinLocation, not the mock.
 */

import type { PlaceDetails } from "@mingla/location-input";

// Mock the business geocode service so resolveApproxLocation's default forward/
// reverse are deterministic stubs (and ./supabase is never loaded under node).
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
import { venueStepError } from "../components/venue/venueWizardValidation";
import type { DraftVenueState } from "../store/draftVenueStore";
import type { CreateVenueListingInput } from "../services/venueListingsService";

const placeDetails = (over: Partial<PlaceDetails>): PlaceDetails => ({
  placeId: "",
  formattedAddress: "",
  city: "Lagos",
  region: "Lagos",
  regionCode: null,
  regionCodeFull: null,
  countryCode: "NG",
  location: { lat: 6.4488, lng: 3.5397 },
  ...over,
});

/** A minimal-but-complete venue draft; only s0's fields are load-bearing. */
const makeDraft = (): DraftVenueState => ({
  placePoolId: null,
  workingName: "",
  venueCategory: "restaurant",
  displayName: "Admiralty Kitchen",
  slug: "admiraltykitchen",
  formattedAddress: "23 Admiralty Way, Lekki", // typed (un-indexed) address
  googlePlaceId: null,
  lat: null,
  lng: null,
  city: null,
  countryCode: null,
  coordinatePrecision: null,
  hours: [],
  contactEmail: "",
  contactPhone: "",
  contactPhoneCountryIso: null,
  tagline: "",
  description: "",
  website: "",
  priceTiers: [],
  wantsReservations: false,
  galleryUrls: [],
  coverChoice: null,
  claim: null,
  step: 0,
});

/** Mirror of the store's shallow `patch` merge (patch: (p) => set(p)). */
const applyPatch = (
  d: DraftVenueState,
  p: Partial<DraftVenueState>,
): DraftVenueState => ({ ...d, ...p });

describe("Issue #1363 — venue s0 free-text + pin makes an un-indexed place submittable", () => {
  beforeEach(() => {
    mockForward.mockReset();
    mockReverse.mockReset();
  });

  it("starts BLOCKED with a typed-but-uncoordinated address", () => {
    const draft = makeDraft();
    // The typed address exists but no coordinate yet → s0 blocks on location.
    expect(venueStepError("s0", draft)).toBe(
      "Add the location — pick a suggestion or drop a pin.",
    );
  });

  it("Tier 2 (free-text) resolves a coordinate → s0 passes, precision approximate", async () => {
    mockForward.mockResolvedValue(
      placeDetails({
        formattedAddress: "Lekki, Lagos, Nigeria",
        location: { lat: 6.4478, lng: 3.4723 },
      }),
    );

    const approx = await resolveFreeTextLocation("Lekki, Lagos");
    expect(approx).not.toBeNull();
    expect(approx?.precision).toBe("approximate");
    expect(Number.isFinite(approx?.lat)).toBe(true);
    expect(Number.isFinite(approx?.lng)).toBe(true);

    // The venue onFreeText handler applies exactly this patch.
    const draft = applyPatch(makeDraft(), {
      lat: approx!.lat,
      lng: approx!.lng,
      city: approx!.city,
      countryCode: approx!.countryCode,
      coordinatePrecision: "approximate",
    });

    expect(venueStepError("s0", draft)).toBeNull();
    expect(draft.coordinatePrecision).toBe("approximate");
  });

  it("Tier 3 (pin-drop) yields an exact coordinate → s0 passes, and the create input carries it", async () => {
    // The pin lands via the pure pixel→lng/lat math (map centered on Lekki).
    const pinned = staticMapPixelToLngLat({
      centerLat: 6.4488,
      centerLng: 3.5397,
      zoom: 15,
      width: 350,
      height: 340,
      px: 190, // slightly right/below center — a real tap
      py: 180,
    });
    expect(Number.isFinite(pinned.lat)).toBe(true);
    expect(Number.isFinite(pinned.lng)).toBe(true);

    mockReverse.mockResolvedValue(
      placeDetails({
        formattedAddress: "23 Admiralty Way, Lekki, Lagos",
        location: { lat: pinned.lat, lng: pinned.lng },
      }),
    );

    const resolved = await resolvePinLocation(pinned.lat, pinned.lng);
    expect(resolved).not.toBeNull();
    expect(resolved?.precision).toBe("exact");

    // The venue onConfirm handler keeps the typed label + applies the coordinate.
    const draft = applyPatch(makeDraft(), {
      lat: resolved!.lat,
      lng: resolved!.lng,
      city: resolved!.city,
      countryCode: resolved!.countryCode,
      coordinatePrecision: "exact",
    });

    expect(venueStepError("s0", draft)).toBeNull();
    expect(draft.coordinatePrecision).toBe("exact");

    // The create RPC input built from this draft carries a NON-NULL coordinate,
    // satisfying the DB location_required guard (never fabricated {0,0}).
    const input: CreateVenueListingInput = {
      brandId: "brand-1",
      name: draft.displayName,
      slug: draft.slug,
      googlePlaceId: draft.googlePlaceId,
      lat: draft.lat as number,
      lng: draft.lng as number,
      city: draft.city,
      countryCode: draft.countryCode,
      coordinatePrecision: draft.coordinatePrecision,
      address: draft.formattedAddress,
      venueCategory: draft.venueCategory!,
      contact: {},
      coverMediaUrl: null,
      coverMediaType: null,
      hours: draft.hours,
    };
    expect(input.lat).not.toBeNull();
    expect(input.lng).not.toBeNull();
    expect(Number.isFinite(input.lat)).toBe(true);
    expect(Number.isFinite(input.lng)).toBe(true);
    expect(input.coordinatePrecision).toBe("exact");
  });

  it("rule 3 / rule 9 — a failed free-text geocode returns null (never a fabricated {0,0})", async () => {
    mockForward.mockRejectedValue(new Error("no_location"));
    const approx = await resolveFreeTextLocation("nowhere-that-exists-zzz");
    expect(approx).toBeNull(); // host leaves lat/lng null + shows the pin hint.

    // The onFreeText null-branch patch leaves the draft BLOCKED (no fake coord).
    const draft = applyPatch(makeDraft(), {
      lat: null,
      lng: null,
      coordinatePrecision: null,
    });
    expect(venueStepError("s0", draft)).toBe(
      "Add the location — pick a suggestion or drop a pin.",
    );
  });
});
