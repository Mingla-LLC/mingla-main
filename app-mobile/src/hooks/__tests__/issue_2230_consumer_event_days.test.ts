/** #2230 mapper contract: only authoritative, valid occurrence truth reaches buyers. */
jest.mock("../../services/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock("@mingla/offering-rendering", () => ({
  isThemeAnimationSlug: () => false,
  isThemeColor: () => false,
  isThemeFontSlug: () => false,
}));

import { mapRpcPayloadToPublicEvent } from "../usePublicEventBySlug";

const payload = (mode: unknown = "per_day"): Record<string, unknown> => ({
  id: "event-2230",
  brandId: "brand-1",
  brandSlug: "mingla",
  eventSlug: "two-days",
  name: "Two days",
  status: "scheduled",
  tickets: [],
  brand: null,
  timezone: "Africa/Lagos",
  isMultiDate: true,
  multiDatePricingMode: mode,
  occurrences: [
    {
      id: "day-2",
      startAt: "2026-08-23T10:00:00.000Z",
      endAt: "2026-08-23T17:00:00.000Z",
      timezone: "Not/AZone",
    },
    {
      id: "day-1",
      startAt: "2026-08-22T10:00:00.000Z",
      endAt: "2026-08-22T17:00:00.000Z",
      timezone: "Africa/Lagos",
    },
    {
      id: "day-1",
      startAt: "2026-08-21T10:00:00.000Z",
      endAt: "2026-08-21T17:00:00.000Z",
      timezone: "UTC",
    },
    { id: "bad-start", startAt: "nope", endAt: "2026-08-24T11:00:00.000Z" },
    { id: "bad-end", startAt: "2026-08-24T10:00:00.000Z", endAt: "" },
    {
      id: "   ",
      startAt: "2026-08-25T10:00:00.000Z",
      endAt: "2026-08-25T11:00:00.000Z",
    },
    {
      id: "",
      startAt: "2026-08-25T10:00:00.000Z",
      endAt: "2026-08-25T11:00:00.000Z",
    },
  ],
});

describe("#2230 consumer event occurrence mapper", () => {
  it("sorts, deduplicates, drops malformed rows, and uses the valid event timezone fallback", () => {
    const mapped = mapRpcPayloadToPublicEvent(payload());
    expect(mapped.occurrences.map((day) => day.id)).toEqual(["day-1", "day-2"]);
    expect(mapped.occurrences[1].timezone).toBe("Africa/Lagos");
    expect(mapped.isMultiDate).toBe(true);
    expect(mapped.multiDatePricingMode).toBe("per_day");
  });

  it("defaults an invalid event timezone to UTC and coerces unknown modes to per_day", () => {
    const mapped = mapRpcPayloadToPublicEvent({
      ...payload("unexpected"),
      timezone: "Not/AZone",
    });
    expect(mapped.occurrences[1].timezone).toBe("UTC");
    expect(mapped.multiDatePricingMode).toBe("per_day");
    expect(
      mapRpcPayloadToPublicEvent(payload("all_days")).multiDatePricingMode,
    ).toBe("all_days");
  });
});
