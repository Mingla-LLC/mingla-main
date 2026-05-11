/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { getBrands } from "../brandsService";
import type { BrandRow } from "../brandMapping";

const brandRow = (id: string, name: string): BrandRow => ({
  id,
  account_id: "account-1",
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  description: null,
  profile_photo_url: null,
  contact_email: null,
  contact_phone: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: true,
  tax_settings: {},
  default_currency: "GBP",
  stripe_connect_id: null,
  stripe_payouts_enabled: false,
  stripe_charges_enabled: false,
  kind: "popup",
  address: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: null,
  profile_photo_type: null,
  created_at: "2026-05-09T00:00:00.000Z",
  updated_at: "2026-05-09T00:00:00.000Z",
  deleted_at: null,
});

const brandsQuery = (result: { data: BrandRow[]; error: Error | null }) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
};

const eventsQuery = (
  result: { data: { brand_id: string | null }[]; error: Error | null },
) => {
  const builder = {
    select: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
};

beforeEach(() => {
  mockFrom.mockReset();
});

describe("getBrands", () => {
  test("attaches accurate non-deleted event counts to each brand", async () => {
    const brandListQuery = brandsQuery({
      data: [brandRow("brand-1", "One"), brandRow("brand-2", "Two")],
      error: null,
    });
    const eventCountQuery = eventsQuery({
      data: [
        { brand_id: "brand-1" },
        { brand_id: "brand-1" },
        { brand_id: "brand-2" },
      ],
      error: null,
    });
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brands") return brandListQuery;
      if (table === "events") return eventCountQuery;
      throw new Error(`unexpected table ${String(table)}`);
    });

    const brands = await getBrands("account-1");

    expect(brands.map((brand) => [brand.id, brand.stats.events])).toEqual([
      ["brand-1", 2],
      ["brand-2", 1],
    ]);
    expect(eventCountQuery.select).toHaveBeenCalledWith("brand_id");
    expect(eventCountQuery.in).toHaveBeenCalledWith("brand_id", [
      "brand-1",
      "brand-2",
    ]);
    expect(eventCountQuery.is).toHaveBeenCalledWith("deleted_at", null);
  });

  test("does not query event counts when the account has no brands", async () => {
    const brandListQuery = brandsQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brands") return brandListQuery;
      throw new Error(`unexpected table ${String(table)}`);
    });

    await expect(getBrands("account-1")).resolves.toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});
