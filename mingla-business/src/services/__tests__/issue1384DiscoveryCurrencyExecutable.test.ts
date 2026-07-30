const mockInvoke = jest.fn();
const mockRpc = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    rpc: mockRpc,
  },
}));

import {
  getBrandDiscoveryCurrencyState,
  saveDiscoveryPriceRange,
  setBrandProvisionalCurrency,
} from "../businessPlaceAuthoringService";
import { getPublicVenueDiscoveryPrice } from "../publicEventsService";
import {
  formatSourceRange,
  minorToMajorInput,
  parseMajorToMinor,
} from "../../utils/currencyFormatter";

const canonicalRange = {
  brandId: "brand-1",
  venueId: "venue-1",
  placePoolId: "place-1",
  sourceMinMinor: 20_000,
  sourceMaxMinor: 50_000,
  currencyCode: "NGN",
};

describe("issue #1384 executable Business and buyer currency matrix", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockRpc.mockReset();
  });

  it("new and existing place authoring invoke the same canonical action", async () => {
    mockInvoke.mockResolvedValue({ data: { kind: "ok", data: {} }, error: null });
    await saveDiscoveryPriceRange(canonicalRange);
    await saveDiscoveryPriceRange({ ...canonicalRange, expectedVersion: 7 });

    const newPlaceBody = mockInvoke.mock.calls[0][1].body;
    const existingPlaceBody = mockInvoke.mock.calls[1][1].body;
    expect(newPlaceBody).toEqual({
      action: "save_discovery_price_range",
      ...canonicalRange,
      expectedVersion: null,
    });
    expect(existingPlaceBody).toEqual({
      ...newPlaceBody,
      expectedVersion: 7,
    });
    expect(newPlaceBody).not.toHaveProperty("priceTiers");
    expect(newPlaceBody).not.toHaveProperty("tier2");
  });

  it("executes unset-to-provisional state calls without inventing settlement", async () => {
    const unset = {
      brandId: "brand-1",
      stateVersion: 0,
      authority: "unset",
      currencyCode: null,
      canAuthorRange: false,
      canAcceptPaidReservations: false,
      supportedCurrencies: [{ code: "NGN", minorUnitExponent: 2 }],
      reconciliation: null,
    };
    const provisional = {
      ...unset,
      stateVersion: 1,
      authority: "provisional",
      currencyCode: "NGN",
      canAuthorRange: true,
    };
    mockInvoke
      .mockResolvedValueOnce({ data: { kind: "ok", data: unset }, error: null })
      .mockResolvedValueOnce({
        data: { kind: "ok", data: provisional },
        error: null,
      });
    await expect(getBrandDiscoveryCurrencyState("brand-1")).resolves.toEqual(unset);
    await expect(setBrandProvisionalCurrency({
      brandId: "brand-1",
      currencyCode: "NGN",
      expectedStateVersion: 0,
    })).resolves.toEqual(provisional);
    expect(mockInvoke.mock.calls[1][1].body).toEqual({
      action: "set_provisional_currency",
      brandId: "brand-1",
      currencyCode: "NGN",
      expectedStateVersion: 0,
    });
  });

  it("buyer and Business preview format exact source money or nothing", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: [{
          price_range_status: "active",
          source_min_minor: 20_000,
          source_max_minor: 50_000,
          source_currency_code: "NGN",
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ code: "NGN", minor_unit_exponent: 2 }],
        error: null,
      });
    const source = await getPublicVenueDiscoveryPrice("place-1");
    expect(source).toEqual({
      minMinor: 20_000,
      maxMinor: 50_000,
      currencyCode: "NGN",
      minorUnitExponent: 2,
    });
    for (const runtime of ["buyer_web", "business_ios", "business_android", "business_web_preview"]) {
      expect({
        runtime,
        label: source === null ? null : formatSourceRange({
          minMinor: source.minMinor,
          maxMinor: source.maxMinor,
          currencyCode: source.currencyCode,
          exponent: source.minorUnitExponent,
          locale: "en-NG",
        }),
      }).toEqual({
        runtime,
        label: "₦200.00–₦500.00 · NGN",
      });
    }

    mockRpc
      .mockResolvedValueOnce({
        data: [{ price_range_status: "legacy_unresolved" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ code: "NGN", minor_unit_exponent: 2 }],
        error: null,
      });
    await expect(getPublicVenueDiscoveryPrice("place-2")).resolves.toBeNull();
  });

  it("parses exponent-aware input and rejects excess precision", () => {
    expect(parseMajorToMinor("200.50", 2)).toBe(20_050);
    expect(parseMajorToMinor("201", 0)).toBe(201);
    expect(parseMajorToMinor("201.5", 0)).toBeNull();
    expect(parseMajorToMinor("1.234", 2)).toBeNull();
    expect(minorToMajorInput(20_050, 2)).toBe("200.5");
  });
});
