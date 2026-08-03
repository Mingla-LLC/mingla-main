/**
 * ISSUE-865 PR1 WP-4 — brandConversionRollupService (NEW, append-only).
 *
 * The read path feeding the "Customers your ads drove" tile. Proves:
 *   • normalizeBrandConversionRollup coerces a populated RPC payload into the
 *     typed shape (customers driven, per-currency value, by-platform, top
 *     campaign, send health);
 *   • a null / unauthorized / empty payload → an HONEST all-zero rollup (no
 *     fabricated numbers — the tile then shows its empty state);
 *   • fetchBrandConversionRollup calls the brand_conversion_rollup RPC with
 *     p_brand_id and THROWS on RPC error (React-Query surfaces it).
 */
jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import {
  fetchBrandConversionRollup,
  normalizeBrandConversionRollup,
} from "../brandConversionRollupService";
import { supabase } from "../supabase";

const rpcMock = supabase.rpc as jest.Mock;
afterEach(() => rpcMock.mockReset());

describe("normalizeBrandConversionRollup", () => {
  it("coerces a populated payload into the typed rollup", () => {
    const r = normalizeBrandConversionRollup({
      authorized: true,
      customers_driven_30d: 4,
      customers_driven_lifetime: 11,
      value_cents_30d: { GBP: 8000 },
      value_cents_lifetime: { GBP: 22000, USD: 500 },
      by_platform: [
        { platform: "meta", conversions: 7, value_cents: 15000 },
        { platform: "tiktok", conversions: 4, value_cents: 7000 },
      ],
      top_campaign: { campaign_id: "cmp-1", name: "Summer push", conversions: 7 },
      send_health: { sent: 30, failed: 2, skipped: 1, pending: 0 },
    });
    expect(r.customersDriven30d).toBe(4);
    expect(r.customersDrivenLifetime).toBe(11);
    expect(r.valueByCurrencyLifetime.GBP).toBe(22000);
    expect(r.byPlatform).toHaveLength(2);
    expect(r.byPlatform[0]).toEqual({ platform: "meta", conversions: 7, valueCents: 15000 });
    expect(r.topCampaign).toEqual({ campaignId: "cmp-1", name: "Summer push", conversions: 7 });
    expect(r.sendHealth.sent).toBe(30);
  });

  it("null / unauthorized payload → honest all-zero rollup (no fabrication)", () => {
    for (const raw of [null, undefined, { authorized: false, customers_driven_lifetime: 0 }]) {
      const r = normalizeBrandConversionRollup(raw);
      expect(r.customersDrivenLifetime).toBe(0);
      expect(r.customersDriven30d).toBe(0);
      expect(r.byPlatform).toEqual([]);
      expect(r.topCampaign).toBeNull();
      expect(r.valueByCurrencyLifetime).toEqual({});
    }
  });

  it("tolerates missing/garbage fields without throwing", () => {
    const r = normalizeBrandConversionRollup({ customers_driven_30d: "oops", by_platform: "nope" });
    expect(r.customersDriven30d).toBe(0);
    expect(r.byPlatform).toEqual([]);
  });
});

describe("fetchBrandConversionRollup", () => {
  it("calls brand_conversion_rollup with p_brand_id and normalizes the result", async () => {
    rpcMock.mockResolvedValue({
      data: { authorized: true, customers_driven_lifetime: 3, by_platform: [] },
      error: null,
    });
    const r = await fetchBrandConversionRollup("brand-42");
    expect(rpcMock).toHaveBeenCalledWith("brand_conversion_rollup", { p_brand_id: "brand-42" });
    expect(r.customersDrivenLifetime).toBe(3);
  });

  it("THROWS on RPC error (React-Query surfaces it)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchBrandConversionRollup("brand-42")).rejects.toThrow(/brand_conversion_rollup failed: boom/);
  });
});
