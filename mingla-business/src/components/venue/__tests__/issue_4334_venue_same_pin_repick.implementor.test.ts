/**
 * #4334 — Venue details: re-picking the same address onto the same pin with a
 * new Google place id is a change, so Save sends it.
 *
 * Cause: `sameAddress` in venueDetailsEditRules.ts compared text, coordinates,
 * city, country and precision but not the place id, so the re-pick produced
 * an empty patch ("nothing to save") and the new place id never reached
 * biz_update_venue_identity's p_location_place_id.
 *
 *   V-1 same text + pin + precision, new place id → patch.address with the id
 *   V-2 an untouched venue (unknown saved id) still diffs to nothing
 *   V-3 re-picking the exact saved place (id known and equal) is no change
 *
 * Fails-on-revert: delete the place-id comparison from `sameAddress` → V-1 red.
 */
import { describe, expect, test } from "@jest/globals";

import type { VenueDetailsForHost } from "../../../services/venueDetailsEditService";
import {
  identityDraftFromVenue,
  identityPatchFromDraft,
  isEmptyIdentityPatch,
} from "../venueDetailsEditRules";

const GOOGLE_ID = "ChIJxQ9M1UpZwokRpOCXqDaFP2c";

const venue = (overrides: Partial<VenueDetailsForHost> = {}): VenueDetailsForHost => ({
  id: "venue-4334",
  brandId: "brand-4334",
  name: "Live Lounge",
  venueCategory: "restaurant",
  address: "2 Live Street",
  city: "Lagos",
  countryCode: "NG",
  lat: 6.5,
  lng: 3.35,
  coordinatePrecision: "exact",
  contactPhone: null,
  contactPhoneCountryIso: null,
  contactEmail: null,
  claimStatus: "pending_review",
  changeRequest: null,
  ...overrides,
});

/** What VenueDetailsEditor's onPick writes for the same Google suggestion. */
const repick = (v: VenueDetailsForHost) => {
  const draft = identityDraftFromVenue(v);
  return {
    ...draft,
    address: {
      address: "2 Live Street",
      city: "Lagos",
      countryCode: "NG",
      lat: 6.5,
      lng: 3.35,
      coordinatePrecision: "exact" as const,
      locationProviderPlaceId: GOOGLE_ID,
    },
  };
};

describe("#4334 — venue same-pin re-pick", () => {
  test("V-1 same text, pin and precision with a new place id is sent", () => {
    const v = venue();
    const patch = identityPatchFromDraft(v, repick(v));
    expect(patch.address?.locationProviderPlaceId).toBe(GOOGLE_ID);
    expect(patch.address?.lat).toBe(6.5);
    expect(isEmptyIdentityPatch(patch)).toBe(false);
  });

  test("V-2 an untouched venue with an unknown saved place id diffs to nothing", () => {
    const v = venue();
    expect(isEmptyIdentityPatch(identityPatchFromDraft(v, identityDraftFromVenue(v)))).toBe(true);
    const known = venue({ locationProviderPlaceId: GOOGLE_ID });
    expect(
      isEmptyIdentityPatch(identityPatchFromDraft(known, identityDraftFromVenue(known))),
    ).toBe(true);
  });

  test("V-3 re-picking the exact saved place is no change", () => {
    const v = venue({ locationProviderPlaceId: GOOGLE_ID });
    expect(isEmptyIdentityPatch(identityPatchFromDraft(v, repick(v)))).toBe(true);
  });
});
