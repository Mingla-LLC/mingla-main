/* eslint-disable import/first */
/**
 * Ve1 — place_pool name gate + brand_hours upsert service regression.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { upsertBrandHours } from "../brandsService";
import { placePoolHasNameMatch } from "../venueSearchService";

describe("placePoolHasNameMatch", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  test("returns false for short query without hitting DB", async () => {
    const r = await placePoolHasNameMatch("x");
    expect(r).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test("returns true when a row is returned", async () => {
    const limitMock = jest.fn(() =>
      Promise.resolve({ data: [{ id: "p1" }], error: null }),
    );
    const eqMock = jest.fn(() => ({ limit: limitMock }));
    const ilikeMock = jest.fn(() => ({ eq: eqMock }));
    const selectMock = jest.fn(() => ({ ilike: ilikeMock }));
    fromMock.mockReturnValue({
      select: selectMock,
    });
    const r = await placePoolHasNameMatch("Cafe Nero");
    expect(r).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("place_pool");
  });
});

describe("upsertBrandHours", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  test("throws when hours length !== 7", async () => {
    await expect(
      upsertBrandHours("brand-1", [
        {
          weekday: 0,
          openTime: "09:00",
          closeTime: "17:00",
          isClosed: false,
        },
      ]),
    ).rejects.toThrow("expected 7 weekday rows");
  });

  test("delete then insert 7 rows on happy path", async () => {
    const selectMock = jest.fn(() =>
      Promise.resolve({
        data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday })),
        error: null,
      }),
    );
    const insertMock = jest.fn(() => ({ select: selectMock }));
    const deleteEqMock = jest.fn(() => Promise.resolve({ error: null }));
    const deleteMock = jest.fn(() => ({ eq: deleteEqMock }));

    let brandHoursCalls = 0;
    fromMock.mockImplementation((table: unknown) => {
      if (table !== "brand_hours") return {};
      brandHoursCalls += 1;
      if (brandHoursCalls === 1) {
        return { delete: deleteMock };
      }
      return { insert: insertMock };
    });

    const hours = [
      { weekday: 0, openTime: "09:00", closeTime: "17:00", isClosed: false },
      { weekday: 1, openTime: "09:00", closeTime: "17:00", isClosed: false },
      { weekday: 2, openTime: "09:00", closeTime: "17:00", isClosed: false },
      { weekday: 3, openTime: "09:00", closeTime: "17:00", isClosed: false },
      { weekday: 4, openTime: "09:00", closeTime: "17:00", isClosed: false },
      { weekday: 5, openTime: "09:00", closeTime: "17:00", isClosed: false },
      { weekday: 6, openTime: null, closeTime: null, isClosed: true },
    ];

    await upsertBrandHours("brand-1", hours);

    expect(deleteMock).toHaveBeenCalled();
    expect(deleteEqMock).toHaveBeenCalledWith("brand_id", "brand-1");
    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          brand_id: "brand-1",
          weekday: 0,
          is_closed: false,
          open_time: "09:00:00",
          close_time: "17:00:00",
        }),
        expect.objectContaining({
          weekday: 6,
          is_closed: true,
          open_time: null,
          close_time: null,
        }),
      ]),
    );
  });
});
