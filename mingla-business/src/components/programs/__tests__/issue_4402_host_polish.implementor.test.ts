/**
 * #4402 — Host polish: cancel confirms, refund rows, zone-labelled times, the
 * minimum fee, posting-deadline copy, the named timeline, polling, roster
 * initials, city grouping and the listing filter. Pure functions plus
 * source-shape checks for the confirm sheets.
 */
import * as fs from "fs";
import * as path from "path";

import {
  cancelRefundQuote,
  deliveryPosterUrl,
  formatInZone,
  gigMinFeeMinor,
  gigReachCopy,
  gigZone,
  groupCitiesByCountry,
  isUpcomingListing,
  minFeeError,
  minFeeHint,
  programErrorMessage,
  rosterInitialsName,
  zoneLabel,
} from "../../../utils/creatorProgramFormat";
import {
  activityEvents,
  contractFeeWords,
  contractStatusCard,
  hostPostingCopy,
  workspaceRefundedMinor,
} from "../contractCopy";
import { briefFromGig, briefServerErrors, emptyBrief, timeOf, validateBrief } from "../gigBrief";
import { HOST_POLL_MS, hostPollMs } from "../screenLifecycle";
import type { HostGig } from "../../../services/creatorGigsService";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");

describe("zone-labelled times (item 12)", () => {
  it("prints the gig's own zone, not the device's", () => {
    expect(formatInZone("2026-12-15T17:00:00Z", "Africa/Lagos")).toBe(
      "Tue Dec 15, 6:00 PM Lagos time",
    );
    expect(formatInZone("2026-12-15T22:59:00Z", "Africa/Lagos")).toBe(
      "Tue Dec 15, 11:59 PM Lagos time",
    );
  });
  it("labels by city and falls back without a label when the zone is unknown", () => {
    expect(zoneLabel("America/New_York")).toBe("New York time");
    expect(zoneLabel("UTC")).toBe("UTC");
    expect(formatInZone("2026-12-15T17:00:00Z", null)).not.toMatch(/time$/);
  });
  it("reads the zone from the workspace, the gig or the contract", () => {
    expect(gigZone({ timezone: "Africa/Lagos" })).toBe("Africa/Lagos");
    expect(gigZone({ gig: { timezone: "Europe/London" } })).toBe("Europe/London");
    expect(gigZone({})).toBeNull();
  });
  it("Edit gig pre-fills the same wall-clock time as the header (H20)", () => {
    expect(timeOf("2026-12-15T17:00:00Z", "Africa/Lagos")).toBe("18:00");
    expect(timeOf("2026-12-15T17:00:00Z")).toBe("17:00");
    const gig = {
      post_by: "2026-12-15",
      video_due_at: "2026-12-15T17:00:00Z",
      timezone: "Africa/Lagos",
      deliverables: [],
    } as unknown as HostGig;
    expect(briefFromGig(gig, "NGN").videoDueTime).toBe("18:00");
  });
});

describe("refund rows and cancel confirms (items 9, 10)", () => {
  it("the refund row shows what really went back", () => {
    expect(contractFeeWords(10000, "NGN", "refunded", 11500)).toBe("₦115 refunded");
    expect(contractFeeWords(4000000, "NGN", "partially_refunded", 3600000, 4600000)).toBe(
      "₦36,000 refunded of ₦46,000",
    );
    expect(contractFeeWords(10000, "NGN", "paid", 11500)).toBe("₦100 paid");
  });
  it("reads refunded_minor from the workspace", () => {
    expect(workspaceRefundedMinor({ refunded_minor: 11500 })).toBe(11500);
    expect(workspaceRefundedMinor({ contract: { refunded_minor: 5 } })).toBe(5);
    expect(workspaceRefundedMinor({})).toBeNull();
  });
  it("quotes exact amounts for both cancels", () => {
    expect(cancelRefundQuote("offer", 4000000, 600000)).toMatchObject({
      totalMinor: 4600000,
    });
    expect(cancelRefundQuote("gig", 4000000, 600000)).toEqual({
      feeShareMinor: 3000000,
      bookingMinor: 600000,
      totalMinor: 3600000,
      creatorKeepsMinor: 1000000,
    });
  });
  it("neither cancel button refunds on a single tap", () => {
    const screen = read("components/creators/screens/HostGigContractScreen.tsx");
    // The only refund calls live inside the confirm sheet body.
    const calls = screen.split("creatorGigsService.refund(").length - 1;
    expect(calls).toBe(1);
    const sheetStart = screen.indexOf('sheet === "cancel_offer" || sheet === "cancel_gig"');
    expect(sheetStart).toBeGreaterThan(0);
    expect(screen.indexOf("creatorGigsService.refund(")).toBeGreaterThan(sheetStart);
    expect(screen).toContain('setSheet("cancel_offer")');
    expect(screen).toContain('setSheet("cancel_gig")');
    expect(screen).toContain('"Keep the offer"');
    expect(screen).toContain('"Keep the gig"');
  });
});

describe("honest re-offer copy and the minimum fee (items 5, 27)", () => {
  it("maps the 409 answers", () => {
    expect(programErrorMessage("interest_not_open")).toBe(
      "This creator is no longer available for this gig.",
    );
    expect(programErrorMessage("already_offered")).toBe(
      "You already have an open offer with this creator. Open it from Creators.",
    );
    expect(programErrorMessage("gig_not_open")).toBe(
      "This gig is closed. Reopen it to make offers.",
    );
  });
  it("knows the four minimums and no others", () => {
    expect(gigMinFeeMinor("NGN")).toBe(500000);
    expect(gigMinFeeMinor("usd")).toBe(1000);
    expect(gigMinFeeMinor("CAD")).toBeNull();
  });
  it("errors below the minimum and explains the 15% on the field", () => {
    expect(minFeeError(499999, "NGN")).toBe("The minimum creator fee is ₦5,000.");
    expect(minFeeError(500000, "NGN")).toBeNull();
    expect(minFeeError(1, "CAD")).toBeNull();
    expect(minFeeHint("NGN", 4000000)).toBe(
      "Minimum ₦5,000. You also pay Mingla's 15% booking fee on top, so ₦40,000 costs you ₦46,000.",
    );
    expect(minFeeHint("USD", 20000)).toContain("$200 costs you $230");
    expect(minFeeHint("NGN", null, "creator")).toContain("The host also pays");
    expect(minFeeHint("CAD")).toBeNull();
  });
  it("the brief refuses a budget under the minimum and maps the server answer", () => {
    const form = { ...emptyBrief(), cityId: "c1" };
    const errors = validateBrief(form, { currency: "USD", today: "2026-12-01" }, 500);
    expect(errors.pay).toBe("The minimum creator fee is $10.");
    expect(
      briefServerErrors({ error: "fee_below_minimum", field: "pay_up_to_minor", min_minor: 500000, currency: "NGN" }).pay,
    ).toBe("The minimum creator fee is ₦5,000.");
  });
});

describe("posting deadline and review copy (items 3, 4)", () => {
  const base = {
    creatorName: "Ada",
    deadlineWords: "Wed Dec 16, 11:59 PM Lagos time",
    cancelReason: null,
    refundWords: null,
  };
  it("explains the deadline and the automatic full refund", () => {
    const soon = hostPostingCopy({
      ...base,
      state: "posting",
      deadlineAt: "2026-12-16T22:59:00Z",
      nowMs: Date.parse("2026-12-16T10:00:00Z"),
    });
    expect(soon?.dueSoon).toBe(true);
    expect(soon?.title).toBe("Posts due soon");
    expect(soon?.lines).toContain(
      "Ada posts by Wed Dec 16, 11:59 PM Lagos time. If they don't, you're refunded in full automatically.",
    );
    expect(soon?.lines[0]).toContain("Mingla's team checks each link, usually within a day.");
  });
  it("is not 'due soon' with more than a day left", () => {
    const early = hostPostingCopy({
      ...base,
      state: "approved",
      deadlineAt: "2026-12-16T22:59:00Z",
      nowMs: Date.parse("2026-12-10T10:00:00Z"),
    });
    expect(early?.dueSoon).toBe(false);
  });
  it("says Mingla's team is checking, and names the missed-post refund", () => {
    expect(
      hostPostingCopy({ ...base, state: "posts_submitted", deadlineAt: null })?.lines[0],
    ).toBe("Ada posted. Mingla's team is checking the links. You'll hear when they pass.");
    expect(
      hostPostingCopy({
        ...base,
        state: "cancelled",
        deadlineAt: null,
        cancelReason: "post_missed",
        refundWords: "₦46,000",
      })?.lines[0],
    ).toBe("The creator didn't post in time. Your full refund of ₦46,000 has started.");
    expect(hostPostingCopy({ ...base, state: "offered", deadlineAt: null })).toBeNull();
  });
});

describe("stage header follows the shoot plan at once (item 15)", () => {
  const input = {
    state: "shoot_planned",
    moneyState: null,
    creatorName: "Ada",
    hostRated: false,
    stepCaption: "Step 2 of 6 · Shoot",
  };
  it("changes from approve to confirmed without a navigation", () => {
    const waiting = contractStatusCard({
      ...input,
      shoot: { proposedBy: "creator", confirmed: false, whenWords: "Sat Dec 5, 7:30 PM Lagos time" },
    });
    expect(waiting.title).toBe("Approve the shoot time");
    expect(waiting.line).toBe("Ada proposed Sat Dec 5, 7:30 PM Lagos time.");
    const done = contractStatusCard({
      ...input,
      shoot: { proposedBy: "creator", confirmed: true, whenWords: "Sat Dec 5, 7:30 PM Lagos time" },
    });
    expect(done.title).toBe("Shoot time confirmed");
    expect(
      contractStatusCard({ ...input, shoot: null, working: "Approving…" }).title,
    ).toBe("Approving…");
  });
});

describe("named timeline (item 16)", () => {
  it("names every step instead of a vague row", () => {
    const rows = activityEvents(
      [
        { id: "1", kind: "offer_created" },
        { id: "2", kind: "hold_captured" },
        { id: "3", kind: "plan_confirmed" },
        { id: "4", kind: "lock_script" },
        { id: "5", kind: "delivery_submitted" },
        { id: "6", kind: "approve" },
        { id: "7", kind: "posts_submitted" },
        { id: "8", kind: "post_reviewed", data: { result: "passed" } },
        { id: "9", kind: "refund_recorded", data: { refund_minor: 11500, currency: "NGN" } },
      ],
    ).map((row) => row.words);
    // Newest first, like the Activity list.
    expect([...rows].reverse()).toEqual([
      "Offer sent",
      "Payment held by Mingla",
      "Shoot time confirmed",
      "Script approved",
      "Video sent for review",
      "Video approved",
      "Links added",
      "Post checked: passed",
      "Refund of ₦115 recorded",
    ]);
  });
});

describe("polling while the creator is on the move (item 8)", () => {
  it("polls every 20 s in waiting states and never in acting states", () => {
    expect(HOST_POLL_MS).toBe(20000);
    for (const state of ["offered", "accepted", "script_drafting", "posting", "posts_submitted", "disputed"]) {
      expect(hostPollMs(state)).toBe(20000);
    }
    for (const state of ["script_sent", "delivered", "completed", "cancelled", "", undefined]) {
      expect(hostPollMs(state)).toBe(false);
    }
  });
});

describe("roster, cities, listings, reach, poster", () => {
  it("builds initials from letters only (H24)", () => {
    expect(rosterInitialsName("S(eth) Ogieva")).toBe("Seth Ogieva");
    expect(rosterInitialsName("", "kemi@studio.ng")).toBe("k");
    expect(rosterInitialsName("(( ))", null)).toBe("?");
  });
  it("groups cities by country, the brand's first, with search (H23)", () => {
    const cities = [
      { name: "Lagos", country: "Nigeria" },
      { name: "Accra", country: "Ghana" },
      { name: "Abuja", country: "Nigeria" },
      { name: "London", country: "United Kingdom" },
    ];
    expect(groupCitiesByCountry(cities, "", "Nigeria").map((g) => g.country)).toEqual([
      "Nigeria",
      "Ghana",
      "United Kingdom",
    ]);
    expect(groupCitiesByCountry(cities, "", "Nigeria")[0].cities.map((c) => c.name)).toEqual(["Abuja", "Lagos"]);
    expect(groupCitiesByCountry(cities, "gha").map((g) => g.cities[0].name)).toEqual(["Accra"]);
    expect(groupCitiesByCountry(cities, "zzz")).toEqual([]);
  });
  it("keeps drafts and past events out of the picker (item 18)", () => {
    const now = new Date("2026-11-13T10:00:00Z");
    expect(isUpcomingListing({ status: "scheduled", ends: ["2026-12-19T22:00:00Z"] }, now)).toBe(true);
    expect(isUpcomingListing({ status: "draft", ends: ["2026-12-19T22:00:00Z"] }, now)).toBe(false);
    expect(isUpcomingListing({ status: "live", ends: ["2026-11-01T22:00:00Z"] }, now)).toBe(false);
    expect(isUpcomingListing({ status: "live", ends: [] }, now)).toBe(false);
    const screen = read("components/creators/CreatorsHomeView.tsx");
    expect(screen).toContain("fetchGigListingOptions");
    expect(screen).not.toContain("fetchReferralListingOptions");
    expect(screen).toContain("Publish an upcoming event first, then post a gig for it.");
  });
  it("only claims reach the server counted (H18)", () => {
    expect(gigReachCopy({ verified_creator_count: 12, city_name: "Lagos" }).body).toBe(
      "Your gig is live. 12 verified creators in Lagos can see it.",
    );
    expect(gigReachCopy({ verified_creator_count: 0, city_name: "Accra" }).body).toBe(
      "Your gig is live. There are no verified creators in Accra yet; we'll tell you when someone applies.",
    );
    expect(gigReachCopy({}).body).not.toMatch(/can see it/);
  });
  it("reads a poster only from a plain https url (item 17)", () => {
    expect(deliveryPosterUrl({ thumbnail_url: "https://cdn.example/t.jpg" })).toBe("https://cdn.example/t.jpg");
    expect(deliveryPosterUrl({ thumbnail_url: "javascript:alert(1)" })).toBeNull();
    expect(deliveryPosterUrl({})).toBeNull();
  });
});
