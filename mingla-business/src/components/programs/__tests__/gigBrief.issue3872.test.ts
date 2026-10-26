import {
  briefFromGig,
  briefServerErrors,
  emptyBrief,
  gigPayload,
  validateBrief,
  type BriefContext,
  type BriefForm,
} from "../gigBrief";
import { monthGrid, nextRange } from "../dateRangeGrid";
import type { HostGig } from "../../../services/creatorGigsService";

// #3872 walkthrough (08-host-gig-invalid-dates, brief redesign): the brief
// used typed YYYY-MM-DD fields, hardcoded platforms/slots/usage/budget, and
// showed "[object Object]" or the word "brand" on failure.
const ctx: BriefContext = {
  currency: "USD",
  today: "2026-10-26",
  bands: [
    { currency: "USD", band: "b1", min_minor: 5000, max_minor: 15000 },
    { currency: "USD", band: "b2", min_minor: 15000, max_minor: 32000 },
    { currency: "USD", band: "b3", min_minor: 32000, max_minor: 80000 },
  ],
  brandName: "Sky Lounge",
  listingTitle: "QA Rooftop Social",
};

const filled = (): BriefForm => ({
  ...emptyBrief(),
  title: "Rooftop night out",
  briefPublic:
    "Film a lively rooftop night: arrival, the view, signature drinks and the dance floor.",
  briefPrivate: "Ask for Sam at the door.",
  platforms: ["instagram", "tiktok"],
  shoot: { start: "2026-11-20", end: "2026-11-25" },
  postBy: "2026-12-05",
  slots: 2,
  payText: "300",
  salesShare: true,
  salesSharePercent: 15,
  usageDays: 365,
  cityId: "city-1",
});

describe("gig brief validation", () => {
  it("accepts a complete brand-free brief", () => {
    expect(validateBrief(filled(), ctx, 30000)).toEqual({});
  });

  it("puts every problem next to its field", () => {
    const errors = validateBrief({ ...emptyBrief(), platforms: [] }, ctx, null);
    expect(Object.keys(errors).sort()).toEqual([
      "briefPublic",
      "city",
      "pay",
      "platforms",
      "postBy",
      "shoot",
      "title",
    ]);
    expect(errors.briefPublic).toBe(
      "Describe what to film in at least 40 characters (0 so far).",
    );
  });

  it("flags brand names live instead of failing on the server", () => {
    const errors = validateBrief(
      {
        ...filled(),
        briefPublic:
          "Come and film the Sky Lounge rooftop night with drinks and the dance floor.",
      },
      ctx,
      30000,
    );
    expect(errors.briefPublic).toBe(
      "Remove your brand name. Creators see this before they're hired, so keep it brand-free.",
    );
  });

  it("refuses a post-by date before the last shoot day", () => {
    expect(
      validateBrief({ ...filled(), postBy: "2026-11-21" }, ctx, 30000).postBy,
    ).toBe("Pick a post-by date on or after the last shoot day.");
  });
});

describe("gig brief payload", () => {
  it("sends what the host chose, not hardcoded values", () => {
    const payload = gigPayload({
      form: filled(),
      ctx,
      payMinor: 30000,
      brandId: "brand-1",
      listingKind: "event",
      listingId: "event-1",
    });
    expect(payload).toMatchObject({
      deliverables: [
        { platform: "instagram", kind: "reel", count: 1 },
        { platform: "tiktok", kind: "video", count: 1 },
      ],
      shoot_window_start: "2026-11-20",
      shoot_window_end: "2026-11-25",
      post_by: "2026-12-05",
      slots: 2,
      usage_days: 365,
      sales_share_bps: 1500,
      budget_band: "b2",
      currency: "USD",
      status: "open",
    });
    expect(payload).not.toHaveProperty("id");
  });

  it("uses the chosen level when no ranges are configured, and drops the share for Get seen", () => {
    const payload = gigPayload({
      form: { ...filled(), goal: "seen", level: "b4" },
      ctx: { ...ctx, bands: [] },
      payMinor: 30000,
      brandId: "b",
      listingKind: "venue",
      listingId: "v",
      gigId: "gig-1",
    });
    expect(payload).toMatchObject({
      id: "gig-1",
      budget_band: "b4",
      sales_share_bps: null,
      category: "venue",
    });
  });

  it("prefills from an existing gig for edit and Book again", () => {
    const gig = {
      id: "gig-1",
      brand_id: "b",
      listing_kind: "event",
      listing_id: "e",
      title_public: "Rooftop night out",
      brief_public: "x".repeat(50),
      brief_private: null,
      format_key: "date_idea",
      deliverables: [{ platform: "youtube", kind: "short", count: 1 }],
      city_id: "c",
      shoot_window_start: "2026-11-20",
      shoot_window_end: "2026-11-21",
      post_by: "2026-11-30",
      usage_days: 30,
      budget_band: "b3",
      currency: "USD",
      sales_share_bps: null,
      slots: 3,
      status: "open",
      interest_count: 0,
      hired_count: 0,
    } as HostGig;
    expect(briefFromGig(gig, "USD")).toMatchObject({
      goal: "seen",
      formatKey: "date_idea",
      platforms: ["youtube"],
      slots: 3,
      usageDays: 30,
      level: "b3",
    });
  });
});

describe("gig brief server answers", () => {
  it("shows the brand-free reasons next to the public brief", () => {
    expect(
      briefServerErrors({
        error: "public_brief_not_anonymous",
        reasons: ["brand", "url"],
      }),
    ).toEqual({
      briefPublic:
        "Remove your brand name and a link. Creators see this before they're hired, so keep it brand-free.",
    });
  });

  it("never shows a raw code", () => {
    expect(
      briefServerErrors({ error: "check_violation", field: "post_by" }),
    ).toEqual({ postBy: "Check this and try again." });
    expect(briefServerErrors({ error: "something_else" })).toEqual({
      form: "We couldn't post this gig. Check the details and try again.",
    });
    expect(briefServerErrors({ error: "permission_denied" })).toEqual({
      form: "You don't have permission to do that for this brand.",
    });
  });
});

describe("shoot date range picker", () => {
  it("lays out a Monday-first month", () => {
    const grid = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(grid.slice(0, 7)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-11-01",
    ]);
    expect(grid.length % 7).toBe(0);
  });

  it("builds a range from two taps, in either order", () => {
    const first = nextRange(null, "start", "2026-11-25");
    expect(first).toEqual({
      range: { start: "2026-11-25", end: "2026-11-25" },
      picking: "end",
    });
    expect(nextRange(first.range, first.picking, "2026-11-20").range).toEqual({
      start: "2026-11-20",
      end: "2026-11-25",
    });
  });
});
