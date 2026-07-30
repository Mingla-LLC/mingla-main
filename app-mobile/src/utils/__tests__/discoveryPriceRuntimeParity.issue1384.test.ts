// @ts-nocheck — Jest globals follow the app-mobile test convention.
import {
  canonicalDiscoveryPriceDetail,
  canonicalDiscoveryPriceLabel,
} from "../priceTiers";

const sourceOnly = {
  priceRangeStatus: "active" as const,
  sourceMinMinor: 20_000,
  sourceMaxMinor: 50_000,
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
  fxFreshness: "unavailable" as const,
};

describe("issue #1384 consumer runtime-parity seam", () => {
  it.each(["ios", "android"])(
    "%s renders exact source-only, unresolved, free, and open-ended states identically",
    (runtime) => {
      expect({ runtime, value: canonicalDiscoveryPriceLabel(sourceOnly) }).toEqual({
        runtime,
        value: expect.stringMatching(/NGN/),
      });
      expect(canonicalDiscoveryPriceLabel({
        ...sourceOnly,
        priceRangeStatus: "legacy_unresolved",
        sourceMinMinor: null,
      })).toBeNull();
      expect(canonicalDiscoveryPriceLabel({
        ...sourceOnly,
        sourceMinMinor: 0,
        sourceMaxMinor: 0,
      })).toBe("Free");
      expect(canonicalDiscoveryPriceDetail({
        ...sourceOnly,
        sourceMaxMinor: null,
      })?.source).toMatch(/\+$/);
    },
  );

  it.each(["ios", "android"])(
    "%s accepts an approximation only when it has a pinned snapshot",
    (runtime) => {
      const converted = {
        ...sourceOnly,
        displayMinMinor: 1_300,
        displayMaxMinor: 3_300,
        displayCurrencyCode: "USD",
        displayMinorUnitExponent: 2,
        priceIsApproximate: true,
        fxSnapshotId: "snapshot-1",
        fxProvider: "exchange_rate_api_open_v6",
        fxProviderUpdatedAt: "2026-07-29T00:00:00Z",
        fxFreshness: "stale_soft" as const,
      };
      expect({
        runtime,
        approximate: canonicalDiscoveryPriceDetail(converted)?.approximate,
      }).toEqual({
        runtime,
        approximate: expect.stringMatching(/\$/),
      });
      expect(canonicalDiscoveryPriceDetail({
        ...converted,
        fxSnapshotId: null,
      })?.approximate).toBeNull();
    },
  );
});
