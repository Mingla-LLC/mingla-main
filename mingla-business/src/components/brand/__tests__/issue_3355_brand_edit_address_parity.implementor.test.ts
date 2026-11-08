/**
 * #3355 — Brand Edit's address field behaves exactly like the other Host
 * address fields.
 *
 *   1. MAP PREVIEW: the event "Where" step's map preview now lives in the
 *      shared `AddressMapPreview`; the Where step and Brand Edit both render it
 *      (no fork).
 *   2. PHONE CHIP FOLLOWS THE ADDRESS: with an empty phone box the chip moves
 *      to every newly picked address's country (London → UK, then New York →
 *      US); with a number in the box it never moves.
 *   3. RANKING WITH NO SAVED POINT: every Host address field ranks by the
 *      brand's country when there is no brand or draft point (a UK brand saw
 *      "Margate, Florida" first). Rank-only: no `country` / `types` filter.
 *   4. LABEL: "10 Downing Street" over "10 Downing St, London…" no longer
 *      saves as "10 Downing Street, 10 Downing St, London…".
 *
 * FAILS-ON-REVERT (true line deletion): drop the country step from
 * resolveAddressSearchProximity → the ranking cases go red; delete
 * brandPhoneCountryAfterAddressPick's empty-box guard → the "typed number never
 * moves" case goes red; drop normaliseStreetWords from addressBeginsWithName →
 * the label cases go red.
 *
 * Rendered elsewhere: Brand Edit's field ranks by the brand's point and
 * country and shows the shared map preview
 * (issue_3355_brand_edit_address_field.implementor.test.tsx); the shared
 * preview's empty state and real map
 * (location/__tests__/issue_3355_address_map_preview.implementor.test.tsx);
 * the Host search request carries no types/country filter
 * (location/__tests__/issue_3827_host_address_suggest_limit.implementor.test.tsx).
 */
import { describe, expect, test } from "@jest/globals";

import {
  approximatePointForCountry,
  resolveAddressSearchProximity,
  resolveHostAddressProximity,
} from "../../../utils/addressSearchProximity";
import { brandPhoneCountryAfterAddressPick } from "../brandContactPhoneRules";
import {
  addressBeginsWithName,
  composeSuggestionLabel,
  resolvePickedLabel,
} from "../../../../../packages/location-input/src/AddressInput";

const DIRECTORY = [
  { iso: "GB", dialCode: "+44" },
  { iso: "US", dialCode: "+1" },
  { iso: "CA", dialCode: "+1" },
  { iso: "NG", dialCode: "+234" },
];

describe("#3355 — ranking falls back to the brand's country (shared, rank-only)", () => {
  test("a UK brand with no point ranks from the UK, not the device's US zone", () => {
    expect(
      resolveAddressSearchProximity({
        brandPoint: { countryCode: "GB" },
        timeZone: "America/New_York",
      }),
    ).toBe("-0.13,51.51");
  });

  test("Nigeria and the US resolve inside their own country", () => {
    expect(resolveAddressSearchProximity({ brandPoint: { countryCode: "NG" } })).toBe(
      "3.4,6.45",
    );
    expect(resolveAddressSearchProximity({ brandPoint: { countryCode: "us" } })).toBe(
      "-74.01,40.71",
    );
  });

  test("a saved brand point and a draft point still win over the country", () => {
    expect(
      resolveAddressSearchProximity({
        brandPoint: { lat: 6.43, lng: 3.42, countryCode: "GB" },
      }),
    ).toBe("3.42,6.43");
    expect(
      resolveAddressSearchProximity({
        brandPoint: { countryCode: "GB" },
        draftPoint: { lat: 40.75, lng: -73.98 },
      }),
    ).toBe("-73.98,40.75");
  });

  test("an unknown country falls through to the time zone, never a guess", () => {
    expect(approximatePointForCountry("ZZ")).toBeNull();
    expect(approximatePointForCountry(null)).toBeNull();
    expect(
      resolveAddressSearchProximity({
        brandPoint: { countryCode: "ZZ" },
        timeZone: "Africa/Lagos",
      }),
    ).toBe("3.4,6.45");
  });

  test("a Brand record handed to a Host field ranks by its country", () => {
    const memory = { lastDraftPoint: null };
    expect(
      resolveHostAddressProximity(memory, {
        brandPoint: { countryCode: "GB" },
        draftPoint: null,
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("-0.13,51.51");
  });
});

describe("#3355 — the phone chip follows the address only while the box is empty", () => {
  test("empty box: London → UK, then New York → US, every pick", () => {
    expect(brandPhoneCountryAfterAddressPick("", "GB", DIRECTORY)).toEqual({
      iso: "GB",
      countrySource: "brand",
    });
    expect(brandPhoneCountryAfterAddressPick("", "US", DIRECTORY)?.iso).toBe("US");
    expect(brandPhoneCountryAfterAddressPick("   ", "NG", DIRECTORY)?.iso).toBe("NG");
    expect(brandPhoneCountryAfterAddressPick(undefined, "GB", DIRECTORY)?.iso).toBe(
      "GB",
    );
  });

  test("a typed number never moves its country", () => {
    expect(brandPhoneCountryAfterAddressPick("07700 900123", "US", DIRECTORY)).toBeNull();
    expect(brandPhoneCountryAfterAddressPick("+2348031234567", "GB", DIRECTORY)).toBeNull();
  });

  test("a country the chip does not list leaves it alone", () => {
    expect(brandPhoneCountryAfterAddressPick("", "ZZ", DIRECTORY)).toBeNull();
    expect(brandPhoneCountryAfterAddressPick("", null, DIRECTORY)).toBeNull();
  });
});

describe("#3355 — a street name is not repeated in its label", () => {
  const downing = {
    displayName: "10 Downing Street",
    fullAddress: "10 Downing St, London SW1A 2AA, United Kingdom",
  };

  test("an abbreviated street line counts as the same name", () => {
    expect(addressBeginsWithName(downing.fullAddress, downing.displayName)).toBe(true);
    expect(composeSuggestionLabel(downing)).toBe(
      "10 Downing St, London SW1A 2AA, United Kingdom",
    );
    expect(resolvePickedLabel(downing, "10 Downing St, London SW1A 2AA, United Kingdom")).toBe(
      "10 Downing St, London SW1A 2AA, United Kingdom",
    );
    expect(
      composeSuggestionLabel({
        displayName: "350 Fifth Avenue",
        fullAddress: "350 Fifth Ave., New York, New York 10118, United States",
      }),
    ).toBe("350 Fifth Ave., New York, New York 10118, United States");
  });

  test("a grey line that is only the area still gets the name in front", () => {
    expect(
      composeSuggestionLabel({
        displayName: "Admiralty Way",
        fullAddress: "Lekki, Lagos, Nigeria",
      }),
    ).toBe("Admiralty Way, Lekki, Lagos, Nigeria");
    // "Greater London" is not "London" — still a whole-part comparison.
    expect(addressBeginsWithName("Greater London, England", "London")).toBe(false);
  });
});
