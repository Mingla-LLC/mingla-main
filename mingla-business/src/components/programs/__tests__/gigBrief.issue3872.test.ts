import {
  briefFromGig,
  briefMaxSpend,
  briefServerErrors,
  emptyBrief,
  gigPayload,
  shootWindow,
  stepForErrors,
  validateBrief,
  validateBriefStep,
  type BriefContext,
  type BriefForm,
} from "../gigBrief";
import type { HostGig } from "../../../services/creatorGigsService";

// #3872 walkthrough (08-host-gig-invalid-dates, brief redesign): the brief
// used typed YYYY-MM-DD fields, hardcoded platforms/slots/usage/budget, and
// showed "[object Object]" or the word "brand" on failure.
const ctx: BriefContext = {
  currency: "USD",
  today: "2026-10-26",
  eventDay: "2026-11-25",
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
  videoDueDay: "2026-12-05",
  videoDueTime: "18:00",
  shootMode: "open",
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
      "title",
      "videoDue",
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

  // Round 2 (H2.5): "Video needed by" date AND time are required; the shoot
  // is optional and can't land after the video is due.
  it("requires the video-needed-by day and time", () => {
    expect(
      validateBrief({ ...filled(), videoDueTime: "" }, ctx, 30000).videoDue,
    ).toBe("Pick the time you need the video by.");
    expect(
      validateBrief({ ...filled(), videoDueDay: "" }, ctx, 30000).videoDue,
    ).toBe("Pick the day you need the finished video.");
  });

  it("leaves the shoot optional but never after the video is due", () => {
    expect(validateBrief({ ...filled(), shootMode: "open" }, ctx, 30000)).toEqual({});
    expect(
      validateBrief(
        { ...filled(), shootMode: "day", shootDay: "2026-12-10" },
        ctx,
        30000,
      ).shoot,
    ).toBe(
      "The shoot is after the video is due. Pick an earlier shoot or a later due day.",
    );
  });

  it("checks each step on its own (Next only checks the brief)", () => {
    const step1 = validateBriefStep(1, { ...filled(), videoDueDay: "", title: "" }, ctx, 30000);
    expect(Object.keys(step1)).toEqual(["title"]);
    const step2 = validateBriefStep(2, { ...filled(), videoDueDay: "", title: "" }, ctx, 30000);
    expect(Object.keys(step2)).toEqual(["videoDue"]);
    expect(stepForErrors({ briefPublic: "x" })).toBe(1);
    expect(stepForErrors({ videoDue: "x" })).toBe(2);
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
      shoot_window_start: "2026-10-26",
      shoot_window_end: "2026-12-05",
      post_by: "2026-12-05",
      video_due_at: "2026-12-05T18:00",
      shoot_at: null,
      slots: 2,
      usage_days: 365,
      sales_share_bps: 1500,
      pay_up_to_minor: 30000,
      currency: "USD",
      status: "open",
    });
    expect(payload).not.toHaveProperty("id");
    expect(Object.keys(payload).some((key) => key.startsWith("budget"))).toBe(false);
  });

  it("sends the typed pay as minor units and drops the share for Get seen", () => {
    const payload = gigPayload({
      form: { ...filled(), goal: "seen" },
      ctx,
      payMinor: 45000,
      brandId: "b",
      listingKind: "venue",
      listingId: "v",
      gigId: "gig-1",
    });
    expect(payload).toMatchObject({
      id: "gig-1",
      pay_up_to_minor: 45000,
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
      pay_up_to_minor: 32000,
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
      payText: "320",
    });
    expect(briefFromGig({ ...gig, pay_up_to_minor: null }, "USD").payText).toBe("");
  });
});

describe("shoot window from the host's choice", () => {
  it("maps a day, the event day, any day before, and blank", () => {
    const base = filled();
    expect(shootWindow({ ...base, shootMode: "day", shootDay: "2026-11-20" }, ctx)).toEqual({
      start: "2026-11-20",
      end: "2026-11-20",
    });
    expect(shootWindow({ ...base, shootMode: "event_day" }, ctx)).toEqual({
      start: "2026-11-25",
      end: "2026-11-25",
    });
    expect(shootWindow({ ...base, shootMode: "any_before" }, ctx)).toEqual({
      start: "2026-10-26",
      end: "2026-11-24",
    });
    // Blank: the creator proposes a time, any day up to the due day.
    expect(shootWindow(base, ctx)).toEqual({ start: "2026-10-26", end: "2026-12-05" });
  });

  it("sends an exact shoot time only when a day and time are picked", () => {
    const payload = gigPayload({
      form: { ...filled(), shootMode: "day", shootDay: "2026-11-20", shootTime: "19:30" },
      ctx,
      payMinor: 30000,
      brandId: "b",
      listingKind: "event",
      listingId: "e",
    });
    expect(payload).toMatchObject({
      shoot_window_start: "2026-11-20",
      shoot_window_end: "2026-11-20",
      shoot_at: "2026-11-20T19:30",
    });
  });
});

describe("pay and the footer total", () => {
  it("puts a missing pay from the server next to the pay field", () => {
    expect(
      briefServerErrors({ error: "pay_required", field: "pay_up_to_minor" }),
    ).toEqual({ pay: "Enter the most you'll pay each creator." });
    expect(briefServerErrors({ error: "invalid_gig", field: "pay_up_to_minor" })).toHaveProperty("pay");
  });

  it("words the most you'll spend in one short line", () => {
    const money = (minor: number) => `$${minor / 100}`;
    expect(
      briefMaxSpend({ payMinor: 30000, slots: 1, bookingFeeMinor: 0, shareLabel: "10%", money }),
    ).toBe("$300 + 10% of sales");
    expect(
      briefMaxSpend({ payMinor: null, slots: 1, bookingFeeMinor: 0, shareLabel: null, money }),
    ).toBeNull();
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
    ).toEqual({ videoDue: "Check this and try again." });
    expect(briefServerErrors({ error: "something_else" })).toEqual({
      form: "We couldn't post this gig. Check the details and try again.",
    });
    expect(briefServerErrors({ error: "permission_denied" })).toEqual({
      form: "You don't have permission to do that for this brand.",
    });
  });
});
