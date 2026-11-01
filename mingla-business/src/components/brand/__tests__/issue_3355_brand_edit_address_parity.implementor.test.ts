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
 * resolveAddressSearchProximity → the ranking cases go red; drop the
 * `countryCode` from Brand Edit's brandPoint → its wiring case goes red;
 * delete brandPhoneCountryAfterAddressPick's empty-box guard → the "typed
 * number never moves" case goes red; drop Input's `countryIso` effect or
 * Brand Edit's `countryIso=` → the chip wiring cases go red; drop
 * normaliseStreetWords from addressBeginsWithName → the label cases go red;
 * inline the map back into the Where step or drop it from Brand Edit → the
 * preview cases go red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
} from "../../../../../packages/location-input/src/MapboxAddressInput";

const SRC = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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

  test("Brand Edit and the venue editor hand the brand's country to the shared resolver", () => {
    const field = strip(read("components/brand/BrandEditAddressField.tsx"));
    expect(field).toContain("brandPoint: { lat, lng, countryCode },");
    const venue = strip(read("components/venue/VenueDetailsEditor.tsx"));
    expect(venue).toContain("brandPoint: { countryCode: brandCountryCode },");
  });

  test("still rank-only: the business wrapper adds no country or types filter", () => {
    const wrapper = strip(read("components/location/MapboxAddressInput.tsx"));
    expect(wrapper).not.toMatch(/\bcountry\s*[:=]/);
    expect(wrapper).not.toMatch(/\btypes\s*[:=]/);
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

  test("Brand Edit moves the chip from the address pick, through the edit", () => {
    const view = strip(read("components/brand/BrandEditView.tsx"));
    const address = view.slice(
      view.indexOf("<BrandEditAddressField"),
      view.indexOf('testID="brand-edit-address"'),
    );
    expect(address).toContain("brandPhoneCountryAfterAddressPick(");
    expect(address).toContain("const phoneText = latestPhoneTextRef.current;");
    expect(address).toContain("countryIso: follow.iso,");
    expect(address).toContain("countrySource: follow.countrySource,");
    expect(view).toContain(
      "latestPhoneTextRef.current = phoneEdit?.text ?? openedPhone.localText;",
    );
    expect(view).toContain("countryIso={phoneEdit?.countryIso}");
  });

  test("the phone Input follows an opt-in countryIso when it changes", () => {
    const input = strip(read("components/ui/Input.tsx"));
    expect(input).toMatch(
      /useEffect\(\(\) => \{\s*if \(countryIso !== undefined\) setCountry\(findCountryByIso\(countryIso\)\);\s*\}, \[countryIso\]\);/,
    );
  });
});

describe("#3355 — Brand Edit shows the same map preview as the event Where step", () => {
  test("the Where step renders the shared preview, not an inline copy", () => {
    const where = strip(read("components/event/CreatorStep3Where.tsx"));
    expect(where).toContain('import { AddressMapPreview } from "../location/AddressMapPreview";');
    expect(where).toContain("<AddressMapPreview");
    expect(where).not.toContain("buildStaticMapUrl(");
  });

  test("Brand Edit renders that same component with the brand's point", () => {
    const field = strip(read("components/brand/BrandEditAddressField.tsx"));
    expect(field).toContain('import { AddressMapPreview } from "../location/AddressMapPreview";');
    expect(field).toContain("<AddressMapPreview");
    expect(field).toContain("lat={text.length > 0 ? lat : null}");
    expect(field).toContain("lng={text.length > 0 ? lng : null}");
  });

  test("the shared preview keeps the honest empty state and the real map", () => {
    const preview = strip(read("components/location/AddressMapPreview.tsx"));
    expect(preview).toContain("buildStaticMapUrl({");
    expect(preview).toContain("mapUrl !== null ?");
    expect(preview).toContain("<Image");
    expect(read("components/location/AddressMapPreview.tsx")).toContain(
      "Pick an address to preview the map",
    );
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
