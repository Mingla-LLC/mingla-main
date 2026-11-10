/**
 * #4334 — tester adversarial: Venue details same-pin re-pick.
 *
 *   VT-1 blank and padded saved ids never invent a change on an untouched
 *        form or on a re-pick of the same place; a fresh id still does, and
 *        the RPC args then carry p_location_place_id.
 *   VT-2 a typed (approximate) address with no place id onto a known place's
 *        point and precision is a change that clears the id (null sent).
 *   VT-3 a re-pick that changes nothing but the id leaves the other fields
 *        (name, category) out of the patch.
 *
 * Note (not provable in jest): the server's issue_3386_identity_patch does
 * not compare the place id, so biz_update_venue_identity_in_review answers
 * changed:false and writes nothing for an id-only change, and the live-venue
 * request RPC raises nothing_to_change. See the QA report on #4334.
 *
 * Fails-on-revert: delete the place-id comparison from `sameAddress` in
 * venueDetailsEditRules.ts → VT-1 (fresh id) and VT-2 red.
 */
import { describe, expect, test } from "@jest/globals";

import {
  identityPatchToRpcArgs,
  type VenueDetailsForHost,
} from "../../../services/venueDetailsEditService";
import {
  identityDraftFromVenue,
  identityPatchFromDraft,
  isEmptyIdentityPatch,
} from "../venueDetailsEditRules";

const SAVED_ID = "ChIJsaved-venue-0001";
const FRESH_ID = "ChIJfresh-venue-0002";

const venue = (overrides: Partial<VenueDetailsForHost> = {}): VenueDetailsForHost => ({
  id: "venue-4334-t",
  brandId: "brand-4334-t",
  name: "Tester Lounge",
  venueCategory: "restaurant",
  address: "9 Tester Road",
  city: "Abuja",
  countryCode: "NG",
  lat: 9.0765,
  lng: 7.3986,
  coordinatePrecision: "exact",
  contactPhone: null,
  contactPhoneCountryIso: null,
  contactEmail: null,
  claimStatus: "pending_review",
  changeRequest: null,
  ...overrides,
});

const pick = (
  v: VenueDetailsForHost,
  place: { id: string | null; precision?: "exact" | "approximate" },
) => ({
  ...identityDraftFromVenue(v),
  address: {
    address: "9 Tester Road",
    city: "Abuja",
    countryCode: "NG",
    lat: 9.0765,
    lng: 7.3986,
    coordinatePrecision: place.precision ?? ("exact" as const),
    locationProviderPlaceId: place.id,
  },
});

describe("#4334 tester — venue same-pin re-pick", () => {
  test("VT-1 blank/padded saved ids are no change; a fresh id is, and reaches the RPC", () => {
    for (const savedId of ["", "  ", null]) {
      const v = venue({ locationProviderPlaceId: savedId });
      expect(isEmptyIdentityPatch(identityPatchFromDraft(v, identityDraftFromVenue(v)))).toBe(true);
      // A typed address that resolves with no id equals "none".
      expect(isEmptyIdentityPatch(identityPatchFromDraft(v, pick(v, { id: null })))).toBe(true);
    }
    const padded = venue({ locationProviderPlaceId: `  ${SAVED_ID}  ` });
    expect(
      isEmptyIdentityPatch(identityPatchFromDraft(padded, pick(padded, { id: SAVED_ID }))),
    ).toBe(true);

    const known = venue({ locationProviderPlaceId: SAVED_ID });
    const patch = identityPatchFromDraft(known, pick(known, { id: FRESH_ID }));
    expect(isEmptyIdentityPatch(patch)).toBe(false);
    const args = identityPatchToRpcArgs(known.id, patch);
    expect(args.p_location_place_id).toBe(FRESH_ID);
    expect(args.p_lat).toBe(9.0765);
    expect(args.p_coordinate_precision).toBe("exact");
  });

  test("VT-2 a typed address with no id onto a known place clears the id", () => {
    const known = venue({ locationProviderPlaceId: SAVED_ID });
    const patch = identityPatchFromDraft(known, pick(known, { id: null }));
    expect(patch.address).toBeDefined();
    expect(identityPatchToRpcArgs(known.id, patch).p_location_place_id).toBeNull();
  });

  test("VT-3 an id-only re-pick leaves name and category out of the patch", () => {
    const known = venue({ locationProviderPlaceId: SAVED_ID });
    const patch = identityPatchFromDraft(known, pick(known, { id: FRESH_ID }));
    expect(Object.keys(patch)).toEqual(["address"]);
    const args = identityPatchToRpcArgs(known.id, patch);
    expect(args.p_name).toBeNull();
    expect(args.p_venue_category).toBeNull();
  });
});
