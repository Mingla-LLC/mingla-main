/**
 * ORCH-1269 [claim-adoption phone country mis-defaults to GB] — implementor
 * happy-path regression suite.
 *
 * Live-fire prod bug (2026-07-03): claiming "Academy Street Bistro"
 * (place_pool country "USA", national_phone_number "(919) 377-0509") reached
 * c6 with the phone pre-filled + "On Mingla" chip but the picker on the GB
 * default — a wrong-country flag presented as adopted truth, and a
 * +44-mis-composition hazard for any E.164 consumer.
 *
 * Guards, in order:
 *   M-*  the tolerant place-country → ISO-2 mapper (probe-proven values).
 *   P-*  both ORCH-1263 prefills carry the mapped ISO into the draft.
 *   W-*  c6 source contract — the adopted ISO reaches the picker and the
 *        operator's pick persists (ClaimStepContact wiring).
 *   V-*  c6 belt-and-braces — an E.164-implausible phone never leaves c6.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { phoneCountryIsoFromPlaceCountry } from "../phoneCountryIsoFromPlaceCountry";
import {
  prefillDraftFromAdoption,
  prefillDraftFromPoolMatch,
} from "../prefillDraftFromPoolMatch";
import { venueStepError } from "../../components/venue/venueWizardValidation";
import type { DraftVenueState } from "../../store/draftVenueStore";
import type { PoolAdoptionDetail, PoolMatch } from "../../types/poolMatch";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const usMatch: PoolMatch = {
  id: "008c13b3-a97e-48bf-908c-5f5eca09aa11",
  name: "Academy Street Bistro",
  address: "200 S Academy St",
  city: "Cary",
  country: "USA",
  lat: 35.78,
  lng: -78.78,
  googlePlaceId: "ChIJacademy",
  primaryPhotoUrl: null,
  primaryType: "restaurant",
  types: ["restaurant"],
  venueCategory: "restaurant",
  openingHours: null,
  photoUrls: [],
  venueCategoryConfident: true,
};

const usDetail: PoolAdoptionDetail = {
  id: usMatch.id,
  name: usMatch.name,
  address: usMatch.address,
  city: usMatch.city,
  country: "USA",
  lat: usMatch.lat,
  lng: usMatch.lng,
  googlePlaceId: usMatch.googlePlaceId,
  primaryType: usMatch.primaryType,
  types: usMatch.types,
  openingHours: null,
  photoUrls: [],
  nationalPhoneNumber: "(919) 377-0509",
  website: null,
  priceTiers: [],
  priceLevel: null,
  generativeSummary: null,
  editorialSummary: null,
  reservable: false,
  facets: {},
  venueCategory: "restaurant",
  venueCategoryConfident: true,
};

const baseDraft: DraftVenueState = {
  placePoolId: null,
  workingName: "",
  venueCategory: null,
  displayName: "",
  slug: "",
  formattedAddress: "",
  googlePlaceId: null,
  lat: null,
  lng: null,
  city: null,
  countryCode: null,
  hours: [],
  contactEmail: "",
  contactPhone: "",
  contactPhoneCountryIso: null,
  tagline: "",
  description: "",
  website: "",
  priceTiers: [],
  wantsReservations: false,
  claim: null,
  step: 0,
};

// ─── M — mapper unit tests ───────────────────────────────────────────────────

describe("M — phoneCountryIsoFromPlaceCountry (tolerant, probe-proven)", () => {
  test("M-1 ISO-3 / common US variants → US", () => {
    expect(phoneCountryIsoFromPlaceCountry("USA")).toBe("US");
    expect(phoneCountryIsoFromPlaceCountry(" usa ")).toBe("US");
    expect(phoneCountryIsoFromPlaceCountry("United States")).toBe("US");
    expect(phoneCountryIsoFromPlaceCountry("united states of america")).toBe(
      "US",
    );
    expect(phoneCountryIsoFromPlaceCountry("U.S.A.")).toBe("US");
    expect(phoneCountryIsoFromPlaceCountry("US")).toBe("US");
  });

  test("M-2 GB variants → GB", () => {
    expect(phoneCountryIsoFromPlaceCountry("UK")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("GB")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("GBR")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("United Kingdom")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("Great Britain")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("England")).toBe("GB");
  });

  test("M-3 plain country names resolve via the shared directory", () => {
    expect(phoneCountryIsoFromPlaceCountry("Nigeria")).toBe("NG");
    expect(phoneCountryIsoFromPlaceCountry("NGA")).toBe("NG");
    expect(phoneCountryIsoFromPlaceCountry("France")).toBe("FR");
  });

  test("M-4 seeded postal-suffix rows: leading bare code maps, longer runs stay null", () => {
    // Real prod rows (read-only probe 2026-07-03).
    expect(phoneCountryIsoFromPlaceCountry("GB邮政编码: SW1P 2AF")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("USSet P邮政编码: 27545")).toBeNull();
    expect(
      phoneCountryIsoFromPlaceCountry("Staten Island邮政编码: 10305"),
    ).toBeNull();
    expect(
      phoneCountryIsoFromPlaceCountry("Level 0邮政编码: E14 4QT"),
    ).toBeNull();
  });

  test("M-5 unmappable / empty / null → null (no fabricated country)", () => {
    expect(phoneCountryIsoFromPlaceCountry("Atlantis")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("   ")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry(null)).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry(undefined)).toBeNull();
  });
});

// ─── P — prefill carries the ISO ─────────────────────────────────────────────

describe("P — ORCH-1263 prefills map the place country to the phone ISO", () => {
  test("P-1 adoption prefill: USA place → contactPhoneCountryIso US beside the adopted number", () => {
    const p = prefillDraftFromAdoption(usMatch, usDetail);
    expect(p.contactPhone).toBe("(919) 377-0509");
    expect(p.contactPhoneCountryIso).toBe("US");
  });

  test("P-2 adoption prefill: unmappable country → null ISO (picker keeps its own default)", () => {
    const p = prefillDraftFromAdoption(usMatch, {
      ...usDetail,
      country: "Staten Island邮政编码: 10305",
    });
    expect(p.contactPhoneCountryIso).toBeNull();
  });

  test("P-3 lean fallback prefill maps match.country too", () => {
    const p = prefillDraftFromPoolMatch({ ...usMatch, country: "UK" });
    expect(p.contactPhoneCountryIso).toBe("GB");
  });

  test("P-4 null country → null ISO on both prefills", () => {
    expect(
      prefillDraftFromPoolMatch({ ...usMatch, country: null })
        .contactPhoneCountryIso,
    ).toBeNull();
    expect(
      prefillDraftFromAdoption(usMatch, { ...usDetail, country: null })
        .contactPhoneCountryIso,
    ).toBeNull();
  });
});

// ─── W — c6 wiring source contract ───────────────────────────────────────────

describe("W — the adopted ISO reaches the c6 picker (source contract)", () => {
  const contactSrc = readFileSync(
    join(__dirname, "../../components/venue/claim/ClaimStepContact.tsx"),
    "utf8",
  );

  test("W-1 picker default follows the draft ISO, undefined-tolerant", () => {
    expect(contactSrc).toContain(
      "defaultCountryIso={draft.contactPhoneCountryIso ?? undefined}",
    );
  });

  test("W-2 operator country picks persist to the draft", () => {
    expect(contactSrc).toContain("onCountryChange={(country) =>");
    expect(contactSrc).toContain(
      "patch({ contactPhoneCountryIso: country.iso })",
    );
  });

  test("W-3 the picker's directory accepts the mapper's probe-country outputs", () => {
    const inputSrc = readFileSync(
      join(__dirname, "../../components/ui/Input.tsx"),
      "utf8",
    );
    for (const iso of ["US", "GB", "NG"]) {
      expect(inputSrc).toContain(`{ iso: "${iso}",`);
    }
  });
});

// ─── V — c6 belt-and-braces validation ───────────────────────────────────────

describe("V — E.164-implausible phone never leaves c6", () => {
  test("V-1 adopted US number under US ISO passes", () => {
    const d: DraftVenueState = {
      ...baseDraft,
      contactPhone: "(919) 377-0509",
      contactPhoneCountryIso: "US",
    };
    expect(venueStepError("c6", d)).toBeNull();
  });

  test("V-2 digit-free phone is rejected inline", () => {
    const d: DraftVenueState = {
      ...baseDraft,
      contactPhone: "call us!",
      contactPhoneCountryIso: "US",
    };
    expect(venueStepError("c6", d)).toBe(
      "That phone number doesn't look right — check it.",
    );
  });

  test("V-3 over-long compose (>15 digits) is rejected inline", () => {
    const d: DraftVenueState = {
      ...baseDraft,
      contactPhone: "9999999999999999",
      contactPhoneCountryIso: "US",
    };
    expect(venueStepError("c6", d)).toBe(
      "That phone number doesn't look right — check it.",
    );
  });

  test("V-4 unknown ISO mirrors the picker's GB default and still accepts a plausible number", () => {
    const d: DraftVenueState = {
      ...baseDraft,
      contactPhone: "7700 900000",
      contactPhoneCountryIso: null,
    };
    expect(venueStepError("c6", d)).toBeNull();
  });

  test("V-5 create-path s3 rule is untouched (byte-equal 1263 contract)", () => {
    const d: DraftVenueState = { ...baseDraft, contactPhone: "call us!" };
    expect(venueStepError("s3", d)).toBeNull();
  });
});
