/**
 * #3386 — the rules behind the Venue details editor (pure).
 *
 *   M — which details a host may change, by venue status (Seth, 2026-09-15)
 *   D — the form opens on the pending request's values, never dropping half
 *   P — only changed fields are sent; an address never travels without its pin
 *   C — contact phone is E.164 with its country, by the app's phone rules
 */

import { describe, expect, test } from "@jest/globals";

import type { VenueDetailsForHost } from "../../../services/venueDetailsEditService";
import {
  canEditVenueContact,
  contactPayloadFromDraft,
  contactPhoneLocalText,
  contactStartCountryIso,
  identityDraftFromVenue,
  identityDraftProblem,
  identityPatchFromDraft,
  isEmptyIdentityPatch,
  proposedChangeLines,
  venueIdentityEditMode,
} from "../venueDetailsEditRules";

const liveVenue = (overrides: Partial<VenueDetailsForHost> = {}): VenueDetailsForHost => ({
  id: "venue-3386",
  brandId: "brand-3386",
  name: "Live Lounge",
  venueCategory: "restaurant",
  address: "2 Live Street",
  city: "Lagos",
  countryCode: "NG",
  lat: 6.5,
  lng: 3.35,
  coordinatePrecision: "exact",
  contactPhone: "+2348031234567",
  contactPhoneCountryIso: "NG",
  contactEmail: "live@example.test",
  claimStatus: "verified",
  changeRequest: null,
  ...overrides,
});

describe("M — what a host can change, by venue status", () => {
  test("in review saves directly; live sends a request; anything else is locked", () => {
    expect(venueIdentityEditMode("pending_review")).toBe("direct");
    expect(venueIdentityEditMode("verified")).toBe("request");
    for (const status of ["rejected", "suspended", "revoked", "none", null, undefined] as const) {
      expect(venueIdentityEditMode(status)).toBe("locked");
    }
  });

  test("contact is editable in every status except a removed venue", () => {
    for (const status of ["pending_review", "verified", "rejected", "suspended", "none"] as const) {
      expect(canEditVenueContact(status)).toBe(true);
    }
    expect(canEditVenueContact("revoked")).toBe(false);
    expect(canEditVenueContact(undefined)).toBe(false);
  });
});

describe("D — the form opens on what the host is asking for", () => {
  test("no request: the live values, with the live pin", () => {
    const draft = identityDraftFromVenue(liveVenue());
    expect(draft.name).toBe("Live Lounge");
    expect(draft.address).toEqual({
      address: "2 Live Street",
      city: "Lagos",
      countryCode: "NG",
      lat: 6.5,
      lng: 3.35,
      coordinatePrecision: "exact",
    });
  });

  test("a pending request's values win only where it proposes them", () => {
    const venue = liveVenue({
      changeRequest: {
        requestId: "req-1",
        status: "pending",
        name: "Live Lounge Rooftop",
        venueCategory: null,
        address: null,
        requestedAt: "2026-09-15T10:00:00Z",
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    const draft = identityDraftFromVenue(venue);
    expect(draft.name).toBe("Live Lounge Rooftop");
    expect(draft.venueCategory).toBe("restaurant");
    expect(draft.addressText).toBe("2 Live Street");
    // Re-sending it keeps the rename (a new request replaces the old one).
    expect(identityPatchFromDraft(venue, draft)).toEqual({ name: "Live Lounge Rooftop" });
  });

  test("a rejected request does not prefill the form", () => {
    const venue = liveVenue({
      changeRequest: {
        requestId: "req-2",
        status: "rejected",
        name: "Refused Name",
        venueCategory: null,
        address: null,
        requestedAt: null,
        reviewedAt: "2026-09-15T11:00:00Z",
        rejectionReason: "Sign says otherwise.",
      },
    });
    expect(identityDraftFromVenue(venue).name).toBe("Live Lounge");
  });
});

describe("P — only changes are sent; an address keeps its pin (#3407)", () => {
  test("an untouched form is an empty patch", () => {
    const venue = liveVenue();
    expect(isEmptyIdentityPatch(identityPatchFromDraft(venue, identityDraftFromVenue(venue)))).toBe(true);
  });

  test("a venue without precision does not read as moved", () => {
    const venue = liveVenue({ coordinatePrecision: null });
    expect(isEmptyIdentityPatch(identityPatchFromDraft(venue, identityDraftFromVenue(venue)))).toBe(true);
  });

  test("rename + move sends both, the move with its pin and precision", () => {
    const venue = liveVenue();
    const patch = identityPatchFromDraft(venue, {
      name: "  New Name ",
      venueCategory: "play",
      addressText: "20 Admiralty Way",
      address: {
        address: "20 Admiralty Way",
        city: "Lagos",
        countryCode: "NG",
        lat: 6.43,
        lng: 3.42,
        coordinatePrecision: "approximate",
      },
    });
    expect(patch).toEqual({
      name: "New Name",
      venueCategory: "play",
      address: {
        address: "20 Admiralty Way",
        city: "Lagos",
        countryCode: "NG",
        lat: 6.43,
        lng: 3.42,
        coordinatePrecision: "approximate",
      },
    });
  });

  test("typed-but-unpicked address blocks the save; so does an empty name or a Stay move", () => {
    const venue = liveVenue();
    const base = identityDraftFromVenue(venue);
    expect(identityDraftProblem(venue, { ...base, addressText: "11 Somewhere", address: null })).toBe(
      "Choose the address from the list so your map pin is right.",
    );
    expect(identityDraftProblem(venue, { ...base, addressText: "", address: null })).toBe(
      "Add your venue's address.",
    );
    expect(identityDraftProblem(venue, { ...base, name: "   " })).toBe("Add your venue's name.");
    expect(identityDraftProblem(venue, { ...base, name: "n".repeat(81) })).toMatch(/80 characters/);
    expect(identityDraftProblem(venue, { ...base, venueCategory: "stay" })).toMatch(/Stay needs Mingla/);
    expect(identityDraftProblem(venue, base)).toBeNull();
  });

  test("proposed lines read the request, not the live row", () => {
    const lines = proposedChangeLines(
      liveVenue({
        changeRequest: {
          requestId: "req-3",
          status: "pending",
          name: null,
          venueCategory: "creative_and_arts",
          address: {
            address: "20 Admiralty Way",
            city: "Lekki",
            countryCode: "NG",
            lat: 6.43,
            lng: 3.42,
            coordinatePrecision: "exact",
          },
          requestedAt: null,
          reviewedAt: null,
          rejectionReason: null,
        },
      }),
    );
    expect(lines).toEqual([
      { label: "Category", value: "Creative & Arts" },
      { label: "Address", value: "20 Admiralty Way, Lekki" },
    ]);
  });
});

describe("C — contact phone is E.164 with its country", () => {
  test("a Lagos number typed the local way saves as +234 with NG", () => {
    expect(
      contactPayloadFromDraft({
        phoneText: "0803 123 4567",
        countryIso: "NG",
        dialCode: "+234",
        emailText: " hello@venue.example ",
      }),
    ).toEqual({
      ok: true,
      phoneE164: "+2348031234567",
      phoneCountryIso: "NG",
      email: "hello@venue.example",
    });
  });

  test("the wrong length is refused with the specific reason, never guessed", () => {
    const result = contactPayloadFromDraft({
      phoneText: "0803 123",
      countryIso: "NG",
      dialCode: "+234",
      emailText: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("phone");
      expect(result.message).toMatch(/\+234/);
    }
  });

  test("a Nigerian number under the US flag is refused (NANP has no trunk 0)", () => {
    const result = contactPayloadFromDraft({
      phoneText: "08031234567",
      countryIso: "US",
      dialCode: "+1",
      emailText: "",
    });
    expect(result.ok).toBe(false);
  });

  test("email only is fine; clearing the phone clears its country", () => {
    expect(
      contactPayloadFromDraft({ phoneText: "", countryIso: "NG", dialCode: "+234", emailText: "a@b.co" }),
    ).toEqual({ ok: true, phoneE164: null, phoneCountryIso: null, email: "a@b.co" });
  });

  test("nothing at all, or a malformed email, is refused", () => {
    expect(
      contactPayloadFromDraft({ phoneText: " ", countryIso: "NG", dialCode: "+234", emailText: "" }).ok,
    ).toBe(false);
    const bad = contactPayloadFromDraft({
      phoneText: "",
      countryIso: null,
      dialCode: null,
      emailText: "not an email",
    });
    expect(bad.ok === false && bad.field === "email").toBe(true);
  });

  test("the picker starts on the saved country, then the venue's, then the brand's", () => {
    expect(contactStartCountryIso({ contactPhoneCountryIso: "GB", countryCode: "NG" }, "US")).toBe("GB");
    expect(contactStartCountryIso({ contactPhoneCountryIso: null, countryCode: "NG" }, "US")).toBe("NG");
    expect(contactStartCountryIso({ contactPhoneCountryIso: null, countryCode: null }, "USA")).toBe("US");
    expect(contactStartCountryIso({ contactPhoneCountryIso: null, countryCode: null }, null)).toBeUndefined();
  });

  test("a saved E.164 number opens without its dial code; an older number opens as saved", () => {
    expect(contactPhoneLocalText("+2348031234567", "+234")).toBe("8031234567");
    expect(contactPhoneLocalText("0803 123 4567", "+234")).toBe("0803 123 4567");
    expect(contactPhoneLocalText(null, "+234")).toBe("");
  });
});
