/**
 * ORCH-1269(tester): adversarial regression suite — claim-adoption phone
 * country mis-defaults to GB.
 *
 * DIFFERENT ANGLES than the implementor's happy-path suite
 * (`claimPhoneCountry.orch1269.test.ts`):
 *
 *   TA-M  mapper attacked with the full input taxonomy: ISO-3 vs ISO-2 vs
 *         full-name vs lowercase vs whitespace vs unicode garbage vs null vs
 *         empty — INCLUDING countries whose ISO-2 is NOT a prefix of their
 *         English name (Germany→DE, Japan→JP), which a naive
 *         `country.slice(0, 2)` (the pre-existing `countryCode` bug this fix
 *         deliberately did NOT copy) would fabricate as GE (Georgia!) / JA.
 *   TA-P  never-fabricate-a-flag: unmappable → null ISO while the adopted
 *         phone VALUE keeps riding; mapping is real name-resolution, not a
 *         prefix slice.
 *   TA-W  source contracts: no hardcoded ISO at the c6 callsite (null →
 *         component default only), country picker carries NO provenance
 *         chip, store rehydrates pre-1269 blobs with `?? null`.
 *   TA-V  the ACTUAL E.164 gate contract: shape/length-only (a 10-digit US
 *         number under +44 still composes ≤15 digits and is NOT blocked —
 *         the documented fix-contract limit; the MAPPING is the defense),
 *         phone-optional behavior, and the c6 gate provably not leaking
 *         into the create-path s3 rule (byte-equal 1263 contract).
 *
 * Append-only: this file is NEW; no existing test file was modified.
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

const mkMatch = (country: string | null): PoolMatch => ({
  id: "008c13b3-a97e-48bf-908c-5f5eca09aa11",
  name: "Academy Street Bistro",
  address: "200 S Academy St",
  city: "Cary",
  country,
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
});

const mkDetail = (country: string | null): PoolAdoptionDetail => ({
  id: "008c13b3-a97e-48bf-908c-5f5eca09aa11",
  name: "Academy Street Bistro",
  address: "200 S Academy St",
  city: "Cary",
  country,
  lat: 35.78,
  lng: -78.78,
  googlePlaceId: "ChIJacademy",
  primaryType: "restaurant",
  types: ["restaurant"],
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
});

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

// ─── TA-M — mapper input taxonomy ────────────────────────────────────────────

describe("ORCH-1269(tester): TA-M mapper — full input taxonomy", () => {
  test("TA-M1 ISO-2 NOT a name-prefix: Germany→DE, Japan→JP (a naive slice(0,2) would fabricate GE=Georgia / JA)", () => {
    expect(phoneCountryIsoFromPlaceCountry("Germany")).toBe("DE");
    expect(phoneCountryIsoFromPlaceCountry("germany")).toBe("DE");
    expect(phoneCountryIsoFromPlaceCountry("DE")).toBe("DE");
    expect(phoneCountryIsoFromPlaceCountry("Japan")).toBe("JP");
    expect(phoneCountryIsoFromPlaceCountry("Switzerland")).toBe("CH");
    // The fabrication a prefix-slice would produce must NOT happen:
    expect(phoneCountryIsoFromPlaceCountry("Germany")).not.toBe("GE");
  });

  test("TA-M2 ISO-3 outside the alias table (USA/GBR/NGA) does NOT fabricate", () => {
    // Only the three probe-proven ISO-3 aliases exist; other ISO-3s must be
    // honest nulls, never a truncated 2-letter guess (DEU→DE would be a guess).
    expect(phoneCountryIsoFromPlaceCountry("DEU")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("FRA")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("CAN")).toBeNull();
    // ...while the three deliberate aliases keep working.
    expect(phoneCountryIsoFromPlaceCountry("GBR")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("NGA")).toBe("NG");
  });

  test("TA-M3 lowercase / mixed case / interior+exotic whitespace all normalize", () => {
    expect(phoneCountryIsoFromPlaceCountry(" gb ")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry("\tunited kingdom\n")).toBe("GB");
    expect(phoneCountryIsoFromPlaceCountry(" nIgEriA ")).toBe("NG");
    expect(phoneCountryIsoFromPlaceCountry(" France ")).toBe("FR");
  });

  test("TA-M4 unicode garbage never yields a flag", () => {
    expect(phoneCountryIsoFromPlaceCountry("邮政编码: 10305")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("🇺🇸")).toBeNull(); // a literal flag emoji is NOT a country
    expect(phoneCountryIsoFromPlaceCountry("Ünited States")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("ＵＳＡ")).toBeNull(); // full-width letters don't sneak past
    expect(phoneCountryIsoFromPlaceCountry("12")).toBeNull();
  });

  test("TA-M5 null / undefined / empty / whitespace-only stay null", () => {
    expect(phoneCountryIsoFromPlaceCountry(null)).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry(undefined)).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry(" \t\n  ")).toBeNull();
  });

  test("TA-M6 leading-code tolerance is bounded: bare ISO-2 + non-letter maps, longer letter runs don't", () => {
    expect(phoneCountryIsoFromPlaceCountry("DE 10115")).toBe("DE");
    expect(phoneCountryIsoFromPlaceCountry("US-EAST")).toBe("US");
    // 4+ leading letters never truncate into a code.
    expect(phoneCountryIsoFromPlaceCountry("USSR 1980")).toBeNull();
    expect(phoneCountryIsoFromPlaceCountry("FRX")).toBeNull();
  });
});

// ─── TA-P — never fabricate a flag at prefill ───────────────────────────────

describe("ORCH-1269(tester): TA-P prefill — no fabricated flag, phone value keeps riding", () => {
  test("TA-P1 unmappable country → null ISO while the adopted phone VALUE still prefills", () => {
    const p = prefillDraftFromAdoption(
      mkMatch("Level 0邮政编码: E14 4QT"),
      mkDetail("Level 0邮政编码: E14 4QT"),
    );
    expect(p.contactPhoneCountryIso).toBeNull();
    expect(p.contactPhone).toBe("(919) 377-0509");
  });

  test("TA-P2 adoption maps by real resolution, not prefix slice: Germany → DE (never GE)", () => {
    const p = prefillDraftFromAdoption(mkMatch("Germany"), mkDetail("Germany"));
    expect(p.contactPhoneCountryIso).toBe("DE");
  });

  test("TA-P3 lean prefill: lowercase full name resolves via the shared directory", () => {
    expect(
      prefillDraftFromPoolMatch(mkMatch("nigeria")).contactPhoneCountryIso,
    ).toBe("NG");
  });
});

// ─── TA-W — source contracts (callsite + store rehydration) ─────────────────

describe("ORCH-1269(tester): TA-W source contracts", () => {
  const contactSrc = readFileSync(
    join(__dirname, "../../components/venue/claim/ClaimStepContact.tsx"),
    "utf8",
  );
  const storeSrc = readFileSync(
    join(__dirname, "../../store/draftVenueStore.ts"),
    "utf8",
  );
  const validationSrc = readFileSync(
    join(
      __dirname,
      "../../components/venue/venueWizardValidation.ts",
    ),
    "utf8",
  );

  test("TA-W1 c6 callsite: draft-driven default only — no hardcoded ISO literal, null falls through to the component default", () => {
    expect(contactSrc).toContain(
      "defaultCountryIso={draft.contactPhoneCountryIso ?? undefined}",
    );
    // Never a fabricated fixed flag at the callsite:
    expect(contactSrc).not.toMatch(/defaultCountryIso="\w+"/);
    // The provenance chip stays bound to the phone VALUE, never the country:
    expect(contactSrc).toContain('provenanceFor("phone", draft)');
    expect(contactSrc).not.toMatch(
      /ProvenanceChip[^\n]*contactPhoneCountryIso/,
    );
  });

  test("TA-W2 store: optional-at-type field, null initial, `?? null` rehydration for pre-1269 persisted blobs", () => {
    expect(storeSrc).toContain("contactPhoneCountryIso?: string | null;");
    expect(storeSrc).toContain(
      "contactPhoneCountryIso: s.contactPhoneCountryIso ?? null,",
    );
  });

  test("TA-W3 the E.164 gate exists EXACTLY once in validation and only in the c6 case (s3 create rule untouched)", () => {
    const calls = validationSrc.match(/composeE164\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // The single call sits AFTER the c6 case opens and BEFORE c7 —
    // i.e., inside c6, structurally incapable of running for s3.
    const c6Start = validationSrc.indexOf('case "c6": {');
    const c7Start = validationSrc.indexOf('case "c7":');
    const callAt = validationSrc.indexOf("composeE164(c6DialCode(");
    expect(c6Start).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(c6Start);
    expect(callAt).toBeLessThan(c7Start);
  });
});

// ─── TA-V — the ACTUAL E.164 gate contract at c6 ────────────────────────────

describe("ORCH-1269(tester): TA-V c6 gate — actual contract, phone-optional, s3 isolation", () => {
  const d = (over: Partial<DraftVenueState>): DraftVenueState => ({
    ...baseDraft,
    ...over,
  });

  test("TA-V1 DOCUMENTED LIMIT: a 10-digit US number under GB ISO is NOT shape-blocked (+44 + 10 digits = 12 ≤ 15) — the MAPPING is the defense", () => {
    // Pins the fix's contract (impl report §5): composeE164 is length/shape
    // only. If this ever starts failing, the gate grew per-country length
    // metadata — re-read the 1269 contract before "fixing" either side.
    expect(
      venueStepError(
        "c6",
        d({ contactPhone: "(919) 377-0509", contactPhoneCountryIso: "GB" }),
      ),
    ).toBeNull();
    // ...and the reason this is safe: the prod fixture maps to US upstream.
    expect(
      prefillDraftFromAdoption(mkMatch("USA"), mkDetail("USA"))
        .contactPhoneCountryIso,
    ).toBe("US");
  });

  test("TA-V2 habitual national entry never blocked: 0-leading GB number under GB passes the shape gate", () => {
    expect(
      venueStepError(
        "c6",
        d({ contactPhone: "07700 900000", contactPhoneCountryIso: "GB" }),
      ),
    ).toBeNull();
  });

  test("TA-V3 phone is optional: empty phone + email passes; both empty hits the presence rule FIRST (never the E.164 copy)", () => {
    expect(
      venueStepError(
        "c6",
        d({ contactPhone: "", contactEmail: "owner@bistro.com" }),
      ),
    ).toBeNull();
    expect(venueStepError("c6", d({}))).toBe("Add an email or phone number.");
  });

  test("TA-V4 shape violations blocked under ANY ISO: digit-free under null (GB-default mirror), 18 digits under NG", () => {
    expect(
      venueStepError(
        "c6",
        d({ contactPhone: "call us!", contactPhoneCountryIso: null }),
      ),
    ).toBe("That phone number doesn't look right — check it.");
    expect(
      venueStepError(
        "c6",
        d({
          contactPhone: "999999999999999999",
          contactPhoneCountryIso: "NG",
        }),
      ),
    ).toBe("That phone number doesn't look right — check it.");
  });

  test("TA-V5 create-path s3 stays byte-equal behaviorally: garbage/over-long phones sail through s3, presence rule intact", () => {
    expect(venueStepError("s3", d({ contactPhone: "call us!" }))).toBeNull();
    expect(
      venueStepError(
        "s3",
        d({
          contactPhone: "999999999999999999",
          contactPhoneCountryIso: "NG",
        }),
      ),
    ).toBeNull();
    expect(venueStepError("s3", d({}))).toBe("Add an email or phone number.");
  });
});
