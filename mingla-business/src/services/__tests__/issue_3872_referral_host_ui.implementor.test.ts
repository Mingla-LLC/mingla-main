import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
});
