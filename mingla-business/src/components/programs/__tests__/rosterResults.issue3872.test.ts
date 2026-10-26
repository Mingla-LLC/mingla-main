import { rosterStatus } from "../rosterStatus";
import { summarizeResults } from "../resultsSummary";

// #3872 walkthrough: My creators opened on a form and showed raw statuses
// ("active", "joined"); Creator results was not built.
describe("My creators status", () => {
  it("uses On Mingla / Invited / Link only words", () => {
    expect(
      rosterStatus({
        status: "active",
        linked_creator_account_id: "c",
        referral_member_id: null,
        link_slug: null,
      }).label,
    ).toBe("On Mingla");
    expect(
      rosterStatus({
        status: "invited",
        linked_creator_account_id: null,
        referral_member_id: "m",
        link_slug: "x",
      }).label,
    ).toBe("Invited");
    expect(
      rosterStatus({
        status: "active",
        linked_creator_account_id: null,
        referral_member_id: null,
        link_slug: "kiki",
      }).label,
    ).toBe("Link only");
    expect(
      rosterStatus({
        status: "active",
        linked_creator_account_id: null,
        referral_member_id: null,
        link_slug: null,
      }).label,
    ).toBe("Saved");
  });
});

describe("Creator results", () => {
  const row = (
    creator: string,
    gig: string,
    sold: number,
    fee: number,
    clicks: number,
    orders: number,
  ) => ({
    contract_id: `${creator}-${gig}`,
    gig_id: gig,
    gig_title: "Rooftop",
    creator_id: creator,
    creator_display_name: creator,
    fee_minor: fee,
    currency: "USD",
    orders,
    tickets: orders,
    sold_minor: sold,
    clicks,
  });
  it("rolls up sales, spend with the booking fee, conversion and ranks creators", () => {
    const summary = summarizeResults([
      row("Amara", "g1", 300000, 100000, 400, 30),
      row("Tobi", "g2", 100000, 100000, 100, 10),
      row("Amara", "g3", 24000, 0, 12, 6),
    ]);
    expect(summary.spentMinor).toBe(230000);
    expect(summary.returnOnSpend).toBeCloseTo(424000 / 230000);
    expect(summary.conversion).toBeCloseTo((46 / 512) * 100);
    expect(summary.creators.map((c) => [c.name, c.lastGigId])).toEqual([
      ["Amara", "g3"],
      ["Tobi", "g2"],
    ]);
  });
  it("has no ratio when nothing was spent or clicked", () => {
    expect(summarizeResults([])).toMatchObject({
      returnOnSpend: null,
      conversion: null,
      creators: [],
    });
  });
});
