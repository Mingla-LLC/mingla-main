// @ts-nocheck — Jest globals follow the app-mobile test convention.
import {
  canonicalDiscoveryPriceDetail,
  canonicalDiscoveryPriceFields,
  canonicalDiscoveryPriceLabel,
} from "../priceTiers";

const source = {
  priceRangeStatus: "active",
  sourceMinMinor: 125000,
  sourceMaxMinor: 250000,
  sourceCurrencyCode: "NGN",
  sourceMinorUnitExponent: 2,
  displayMinMinor: null,
  displayMaxMinor: null,
  displayCurrencyCode: null,
  displayMinorUnitExponent: null,
  priceIsApproximate: false,
  fxSnapshotId: null,
  fxProvider: null,
  fxProviderUpdatedAt: null,
  fxFreshness: "not_needed",
};

describe("issue #1384 canonical venue price rendering", () => {
  it("renders exact source and never invents a display currency", () => {
    expect(canonicalDiscoveryPriceLabel(source)).toContain("NGN");
    expect(canonicalDiscoveryPriceDetail(source)?.approximate).toBeNull();
  });

  it("keeps exact source identifiable when a server conversion exists", () => {
    const converted = {
      ...source,
      displayMinMinor: 750,
      displayMaxMinor: 1500,
      displayCurrencyCode: "USD",
      displayMinorUnitExponent: 2,
      priceIsApproximate: true,
      fxSnapshotId: "00000000-0000-4000-8000-000000000001",
      fxProvider: "exchange_rate_api_open_v6",
      fxProviderUpdatedAt: "2027-01-29T00:00:00.000Z",
      fxFreshness: "stale_soft",
    };
    const detail = canonicalDiscoveryPriceDetail(converted);
    expect(detail?.source).toContain("NGN");
    expect(detail?.approximate).toContain("$");
    expect(detail?.ratesDate).toBe("2027-01-29T00:00:00.000Z");
    expect(detail?.attributionUrl).toBe("https://www.exchangerate-api.com/");
  });

  it.each([
    [{ ...source, priceRangeStatus: "legacy_unresolved" }],
    [{ ...source, priceRangeStatus: "reconciliation_required" }],
    [{ ...source, sourceCurrencyCode: null }],
    [undefined],
  ])("hides unresolved or invalid source money", (value) => {
    expect(canonicalDiscoveryPriceLabel(value)).toBeNull();
    expect(canonicalDiscoveryPriceDetail(value)).toBeNull();
  });

  it("uses Free only for explicit zero-to-zero source money", () => {
    expect(canonicalDiscoveryPriceLabel({
      ...source,
      sourceMinMinor: 0,
      sourceMaxMinor: 0,
    })).toBe("Free");
    expect(canonicalDiscoveryPriceLabel({
      ...source,
      sourceMinMinor: 0,
      sourceMaxMinor: null,
    })).not.toBe("Free");
  });

  it("copies only canonical fields and excludes tier authority", () => {
    const copied = canonicalDiscoveryPriceFields({
      ...source,
      priceTier: "treat",
      priceLevel: "PRICE_LEVEL_EXPENSIVE",
    });
    expect(copied.sourceCurrencyCode).toBe("NGN");
    expect(copied).not.toHaveProperty("priceTier");
    expect(copied).not.toHaveProperty("priceLevel");
  });
});
