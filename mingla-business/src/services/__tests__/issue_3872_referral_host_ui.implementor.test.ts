import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: mockRpc, functions: { invoke: jest.fn() } },
}));

import { fetchReferralOffers } from "../referralService";

const read = (path: string): string =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("#3872 B4 Host referral operations", () => {
  it("shows presets, operating totals, promoter detail, leaderboard and resend", () => {
    const home = read("components/referrals/ReferralHomeView.tsx");
    const editor = read("components/referrals/ReferralOfferSheet.tsx");

    expect(editor).toContain("Start from a preset");
    expect(editor).toContain("Buyer cash share");
    expect(editor).toContain("Buyer voucher");
    expect(editor).toContain("Invited promoter perk");
    expect(home).toContain("Active offers");
    expect(home).toContain("Attributed orders");
    expect(home).toContain("Leaderboard");
    expect(home).toContain("View details");
    expect(home).toContain("Invite resent");
    expect(home).toContain("TimelineRow");
  });

  it("shows tracking link QR controls and per-link results", () => {
    const home = read("components/referrals/ReferralHomeView.tsx");
    const service = read("services/referralService.ts");

    expect(home).toContain("Show QR");
    expect(home).toContain("react-native-qrcode-svg");
    expect(home).toContain('label="Visits"');
    expect(home).toContain('label="Orders"');
    expect(home).toContain('label="Revenue"');
    expect(service).toContain('supabase.rpc("brand_tracking_links"');
  });

  it("maps Host referral totals from the scoped RPC response", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        id: "offer-1",
        brand_id: "brand-1",
        name: "Local launch",
        audience: "both",
        scope_kind: "brand",
        reward_kind: "cash",
        share_bps: 750,
        currency: "USD",
        starts_at: "2026-10-26T00:00:00.000Z",
        status: "active",
        version: 2,
        member_count: 4,
        sales_count: 9,
        share_minor: 3200,
      }],
      error: null,
    });
    const [offer] = await fetchReferralOffers("brand-1");
    expect(offer).toEqual(expect.objectContaining({
      memberCount: 4,
      salesCount: 9,
      shareMinor: 3200,
    }));
    expect(mockRpc).toHaveBeenCalledWith("brand_referral_offers", {
      p_brand_id: "brand-1",
    });
  });
});
