import {
  BrandAnalyticsContractError,
  normalizeBrandCustomerPatternsRollup,
  normalizeBrandRegularsRollup,
} from "../brandAnalyticsService";

const BRAND_ID = "brand-874-tester";
const patternView = (
  key: string,
  label: string,
  overrides: Record<string, unknown> = {},
) => ({
  state: "more_data_needed",
  sample_commitments: 6,
  distinct_dates: 2,
  positive_buckets: 1,
  winner: null,
  buckets: [{ key, label, commitments: 6 }],
  ...overrides,
});
const patternEnvelope = (days: Record<string, unknown>) => ({
  brand_id: BRAND_ID,
  authorized: true,
  generated_at: "2026-07-30T00:00:00Z",
  window_days: 180,
  metric: "qualified_customer_commitments",
  days,
  dayparts: patternView("morning", "Morning"),
  types: patternView("event", "Event"),
});

describe("issue #874 tester adversarial regular-contact privacy boundary", () => {
  it.each(["person@example.com", "+14155551234"])(
    "rejects an unmasked contact instead of making raw PII renderable: %s",
    (unmaskedContact) => {
      expect(() =>
        normalizeBrandRegularsRollup(
          {
            brand_id: BRAND_ID,
            authorized: true,
            regulars_count: 1,
            top_regulars: [
              {
                masked_contact: unmaskedContact,
                visits: 2,
                listings: 2,
              },
            ],
          },
          BRAND_ID,
        ),
      ).toThrow(BrandAnalyticsContractError);
    },
  );

  it.each(["p***@e***.com", "***1234", "***"])(
    "preserves a server-masked contact: %s",
    (maskedContact) => {
      const result = normalizeBrandRegularsRollup(
        {
          brand_id: BRAND_ID,
          authorized: true,
          regulars_count: 1,
          top_regulars: [
            {
              masked_contact: maskedContact,
              visits: 2,
              listings: 2,
            },
          ],
        },
        BRAND_ID,
      );

      expect(result.topRegulars[0]?.maskedContact).toBe(maskedContact);
    },
  );
});

describe("issue #874 tester adversarial server-owned pattern boundary", () => {
  it("rejects a zero-filled bucket instead of making fabricated distribution data renderable", () => {
    expect(() =>
      normalizeBrandCustomerPatternsRollup(
        patternEnvelope(
          patternView("monday", "Monday", {
            buckets: [{ key: "monday", label: "Monday", commitments: 0 }],
          }),
        ),
        BRAND_ID,
      ),
    ).toThrow(BrandAnalyticsContractError);
  });

  it("rejects a positive-bucket count that disagrees with the returned distribution", () => {
    expect(() =>
      normalizeBrandCustomerPatternsRollup(
        patternEnvelope(
          patternView("monday", "Monday", { positive_buckets: 2 }),
        ),
        BRAND_ID,
      ),
    ).toThrow(BrandAnalyticsContractError);
  });

  it("rejects a no-data state carrying hidden nonzero data", () => {
    expect(() =>
      normalizeBrandCustomerPatternsRollup(
        patternEnvelope(
          patternView("monday", "Monday", {
            state: "no_data",
            sample_commitments: 6,
            distinct_dates: 2,
            positive_buckets: 1,
          }),
        ),
        BRAND_ID,
      ),
    ).toThrow(BrandAnalyticsContractError);
  });

  it("rejects an unauthorized envelope carrying hidden pattern data", () => {
    const raw = patternEnvelope(patternView("monday", "Monday"));
    expect(() =>
      normalizeBrandCustomerPatternsRollup(
        {
          ...raw,
          authorized: false,
          days: {
            ...patternView("monday", "Monday"),
            state: "unauthorized",
          },
          dayparts: {
            ...patternView("morning", "Morning"),
            state: "unauthorized",
          },
          types: {
            ...patternView("event", "Event"),
            state: "unauthorized",
          },
        },
        BRAND_ID,
      ),
    ).toThrow(BrandAnalyticsContractError);
  });
});
