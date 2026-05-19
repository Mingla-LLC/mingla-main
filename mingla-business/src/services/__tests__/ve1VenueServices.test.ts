/* eslint-disable import/first */
/**
 * Ve1 — place_pool name gate + brand_hours upsert service regression.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { upsertBrandHours } from "../brandsService";
import { placePoolHasNameMatch } from "../venueSearchService";

describe("placePoolHasNameMatch", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test("returns false for short query without hitting DB", async () => {
    const r = await placePoolHasNameMatch("x");
    expect(r).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("returns true when RPC reports a match", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const r = await placePoolHasNameMatch("Cafe Nero");
    expect(r).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("biz_place_pool_name_contains", {
      p_query: "Cafe Nero",
    });
  });

  test("escapes ILIKE metacharacters via server RPC", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await placePoolHasNameMatch("100%_off");
    expect(rpcMock).toHaveBeenCalledWith("biz_place_pool_name_contains", {
      p_query: "100%_off",
    });
  });
});

describe("upsertBrandHours", () => {
  beforeEach(() => {
    rpcMock.mockReset();
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

  test("calls biz_upsert_brand_hours RPC on happy path", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

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

    expect(rpcMock).toHaveBeenCalledWith(
      "biz_upsert_brand_hours",
      expect.objectContaining({
        p_brand_id: "brand-1",
        p_hours: expect.arrayContaining([
          expect.objectContaining({ weekday: 0, is_closed: false }),
          expect.objectContaining({ weekday: 6, is_closed: true }),
        ]),
      }),
    );
  });
});
