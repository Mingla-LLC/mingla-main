/**
 * #3872 — the "Hire a creator" brief: form state, inline validation and the
 * gig_save payload. Pure so it can be unit tested.
 *
 * Round 2 (approved M-brief1 / M-brief2, H2.5): two steps — Brief, then
 * Timing and pay. "Video needed by" (date and time) is required; "Shoot"
 * (date, optional time) is optional, with "The event day" / "Any day before"
 * shortcuts. Left blank, the creator proposes a time in Plan the shoot and
 * the host approves it, so the shoot window runs from today to the due day.
 */
import {
  addDays,
  briefLintMessage,
  lintPublicBrief,
  minorToWholeText,
  programErrorMessage,
} from "../../utils/creatorProgramFormat";
import type { HostGig } from "../../services/creatorGigsService";

export type BriefGoal = "sell" | "seen";
export type BriefPlatform = "instagram" | "tiktok" | "youtube";
export type UsageDays = 30 | 90 | 365;
/** How the shoot day was chosen. "open" = blank: the creator proposes one. */
export type ShootMode = "open" | "day" | "event_day" | "any_before";
export type BriefStep = 1 | 2;
export const PUBLIC_BRIEF_MAX = 800;
export const PRIVATE_BRIEF_MAX = 2000;

export const PLATFORM_DELIVERABLES: Record<
  BriefPlatform,
  { label: string; kind: string }
> = {
  instagram: { label: "Instagram Reel", kind: "reel" },
  tiktok: { label: "TikTok", kind: "video" },
  youtube: { label: "YouTube Short", kind: "short" },
};

export const FORMAT_EXAMPLES: Record<string, string> = {
  first_timer_reaction:
    "A creator walks in for the first time and reacts on camera: the door, the room, the first taste.",
  night_out_30:
    "Arrival, the view, signature drinks and the dance floor, cut to 30 seconds.",
  what_price_gets:
    "Shows exactly what the ticket price gets you, item by item.",
  behind_the_scenes:
    "Set-up, the team and the moments guests never see, before doors open.",
  three_reasons: "Three quick reasons to go, each with a shot that proves it.",
  date_idea:
    "Pitched as a date night: getting there, the vibe, and why it works for two.",
};

export type BriefForm = {
  goal: BriefGoal;
  formatKey: string;
  title: string;
  briefPublic: string;
  briefPrivate: string;
  platforms: BriefPlatform[];
  /** "Video needed by" — required day ("YYYY-MM-DD") and time ("HH:MM"). */
  videoDueDay: string;
  videoDueTime: string;
  /** "Shoot" — optional. */
  shootMode: ShootMode;
  shootDay: string;
  shootTime: string;
  slots: number;
  payText: string;
  salesShare: boolean;
  salesSharePercent: number;
  usageDays: UsageDays;
  cityId: string | null;
};

export type BriefField =
  | "title"
  | "briefPublic"
  | "briefPrivate"
  | "platforms"
  | "videoDue"
  | "shoot"
  | "slots"
  | "pay"
  | "city"
  | "form";

export type BriefErrors = Partial<Record<BriefField, string>>;

export function emptyBrief(): BriefForm {
  return {
    goal: "sell",
    formatKey: "night_out_30",
    title: "",
    briefPublic: "",
    briefPrivate: "",
    platforms: ["instagram"],
    videoDueDay: "",
    videoDueTime: "",
    shootMode: "open",
    shootDay: "",
    shootTime: "",
    slots: 1,
    payText: "",
    salesShare: true,
    salesSharePercent: 10,
    usageDays: 90,
    cityId: null,
  };
}

/** Prefill from an existing gig (edit, or Book again). */
export function briefFromGig(gig: HostGig, currency: string): BriefForm {
  const platforms = (Array.isArray(gig.deliverables) ? gig.deliverables : [])
    .map((item) => item.platform)
    .filter(
      (platform): platform is BriefPlatform =>
        platform === "instagram" ||
        platform === "tiktok" ||
        platform === "youtube",
    );
  const share =
    typeof gig.sales_share_bps === "number" ? gig.sales_share_bps : null;
  const usage =
    gig.usage_days === 30 || gig.usage_days === 365 ? gig.usage_days : 90;
  const payMinor =
    typeof gig.pay_up_to_minor === "number" ? gig.pay_up_to_minor : null;
  return {
    goal: share ? "sell" : "seen",
    formatKey: gig.format_key,
    title: gig.title_public ?? "",
    briefPublic: gig.brief_public ?? "",
    briefPrivate: gig.brief_private ?? "",
    platforms:
      platforms.length > 0 ? Array.from(new Set(platforms)) : ["instagram"],
    videoDueDay: gig.post_by ?? "",
    videoDueTime: timeOf(gig.video_due_at),
    ...(gig.shoot_window_start &&
    gig.shoot_window_start === gig.shoot_window_end
      ? {
          shootMode: "day" as const,
          shootDay: gig.shoot_window_start,
          shootTime: timeOf(gig.shoot_at),
        }
      : { shootMode: "open" as const, shootDay: "", shootTime: "" }),
    slots: typeof gig.slots === "number" ? gig.slots : 1,
    payText: payMinor ? minorToWholeText(payMinor, currency) : "",
    salesShare: share !== null,
    salesSharePercent: share ? Math.round(share / 100) : 10,
    usageDays: usage,
    cityId: gig.city_id ?? null,
  };
}

/** "HH:MM" from a stored "YYYY-MM-DDTHH:MM" value, or "". */
function timeOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : "";
}

export type BriefContext = {
  currency: string;
  today: string;
  /** The event's first day ("YYYY-MM-DD"); null for venues. */
  eventDay?: string | null;
  brandName?: string | null;
  brandSlug?: string | null;
  listingTitle?: string | null;
};

/** Every problem, next to the field it belongs to. Empty object = ready to post. */
export function validateBrief(
  form: BriefForm,
  ctx: BriefContext,
  payMinor: number | null,
): BriefErrors {
  const errors: BriefErrors = {};
  const names = {
    brandName: ctx.brandName,
    brandSlug: ctx.brandSlug,
    listingTitle: ctx.listingTitle,
  };
  const title = form.title.trim();
  if (title.length < 8)
    errors.title = "Give the gig a title of at least 8 characters.";
  else if (title.length > 70)
    errors.title = "Keep the title under 70 characters.";
  else if (lintPublicBrief(title, names).length > 0)
    errors.title = briefLintMessage(lintPublicBrief(title, names));
  const brief = form.briefPublic.trim();
  if (brief.length < 40)
    errors.briefPublic = `Describe what to film in at least 40 characters (${brief.length} so far).`;
  else if (brief.length > 800)
    errors.briefPublic = "Keep the public brief under 800 characters.";
  else if (lintPublicBrief(brief, names).length > 0)
    errors.briefPublic = briefLintMessage(lintPublicBrief(brief, names));
  if (form.briefPrivate.length > 2000)
    errors.briefPrivate = "Keep the private brief under 2,000 characters.";
  if (form.platforms.length === 0)
    errors.platforms = "Pick at least one place to post.";
  if (!form.videoDueDay)
    errors.videoDue = "Pick the day you need the finished video.";
  else if (form.videoDueDay < ctx.today)
    errors.videoDue = "The video can't be due in the past.";
  else if (!form.videoDueTime)
    errors.videoDue = "Pick the time you need the video by.";
  if (form.shootMode === "day" && !form.shootDay)
    errors.shoot = "Pick the shoot day, or leave Shoot blank.";
  else if (form.shootMode === "event_day" && !ctx.eventDay)
    errors.shoot = "This listing has no event day. Pick a shoot day instead.";
  else if (form.shootMode === "day" && form.shootDay < ctx.today)
    errors.shoot = "The shoot can't be in the past.";
  else if (!errors.videoDue && form.videoDueDay) {
    const window = shootWindow(form, ctx);
    if (window && window.end > form.videoDueDay)
      errors.shoot =
        "The shoot is after the video is due. Pick an earlier shoot or a later due day.";
  }
  if (!Number.isInteger(form.slots) || form.slots < 1 || form.slots > 10)
    errors.slots = "Hire between 1 and 10 creators.";
  if (payMinor === null) errors.pay = "Enter the most you'll pay each creator.";
  if (!form.cityId) errors.city = "Pick the city the shoot is in.";
  return errors;
}

const STEP_FIELDS: Record<BriefStep, readonly BriefField[]> = {
  1: ["title", "briefPublic", "briefPrivate", "platforms"],
  2: ["videoDue", "shoot", "slots", "pay", "city"],
};

/** Only the problems that belong to one step (Next checks step 1 only). */
export function validateBriefStep(
  step: BriefStep,
  form: BriefForm,
  ctx: BriefContext,
  payMinor: number | null,
): BriefErrors {
  const all = validateBrief(form, ctx, payMinor);
  const errors: BriefErrors = {};
  for (const field of STEP_FIELDS[step]) {
    if (all[field]) errors[field] = all[field];
  }
  return errors;
}

/** The step a server field error belongs to, so the editor can go back to it. */
export function stepForErrors(errors: BriefErrors): BriefStep {
  return STEP_FIELDS[1].some((field) => errors[field]) ? 1 : 2;
}

/**
 * The shoot window gig_save needs, from what the host chose:
 * - a day → that day;
 * - The event day → the event's first day;
 * - Any day before → today until the day before the event (or the due day);
 * - blank → today until the due day; the creator proposes a time.
 */
export function shootWindow(
  form: BriefForm,
  ctx: BriefContext,
): { start: string; end: string } | null {
  switch (form.shootMode) {
    case "day":
      return form.shootDay ? { start: form.shootDay, end: form.shootDay } : null;
    case "event_day":
      return ctx.eventDay ? { start: ctx.eventDay, end: ctx.eventDay } : null;
    case "any_before": {
      const lastDay = ctx.eventDay ? addDays(ctx.eventDay, -1) : form.videoDueDay;
      if (!lastDay) return null;
      const end =
        form.videoDueDay && form.videoDueDay < lastDay ? form.videoDueDay : lastDay;
      return { start: ctx.today, end: end < ctx.today ? ctx.today : end };
    }
    default:
      return form.videoDueDay ? { start: ctx.today, end: form.videoDueDay } : null;
  }
}

/** "Most you'll spend": fee (with booking fee) per creator × creators, plus the share. */
export function briefMaxSpend(input: {
  payMinor: number | null;
  slots: number;
  bookingFeeMinor: number;
  shareLabel: string | null;
  money: (minor: number) => string;
}): string | null {
  if (input.payMinor === null) return null;
  const total = (input.payMinor + input.bookingFeeMinor) * input.slots;
  return input.shareLabel
    ? `${input.money(total)} + ${input.shareLabel} of sales`
    : input.money(total);
}

export function gigPayload(input: {
  form: BriefForm;
  ctx: BriefContext;
  payMinor: number | null;
  brandId: string;
  listingKind: "event" | "venue";
  listingId: string;
  gigId?: string | null;
}): Record<string, unknown> {
  const { form, ctx } = input;
  return {
    ...(input.gigId ? { id: input.gigId } : {}),
    brand_id: input.brandId,
    listing_kind: input.listingKind,
    listing_id: input.listingId,
    title_public: form.title.trim(),
    brief_public: form.briefPublic.trim(),
    brief_private:
      form.briefPrivate.trim().length > 0 ? form.briefPrivate.trim() : null,
    format_key: form.formatKey,
    deliverables: form.platforms.map((platform) => ({
      platform,
      kind: PLATFORM_DELIVERABLES[platform].kind,
      count: 1,
    })),
    must_tag: { disclosure: "#ad", mingla: "@usemingla" },
    city_id: form.cityId,
    category: input.listingKind === "venue" ? "venue" : "experience",
    shoot_window_start: shootWindow(form, ctx)?.start ?? null,
    shoot_window_end: shootWindow(form, ctx)?.end ?? null,
    post_by: form.videoDueDay,
    // Round 2: the due time and an exact shoot time. gig_save stores dates
    // only today; these keys carry the times for the server to keep.
    video_due_at: form.videoDueDay
      ? `${form.videoDueDay}T${form.videoDueTime || "23:59"}`
      : null,
    shoot_at:
      form.shootMode === "day" && form.shootDay && form.shootTime
        ? `${form.shootDay}T${form.shootTime}`
        : null,
    usage_days: form.usageDays,
    // The most each creator can be paid, in the listing's minor units.
    pay_up_to_minor: input.payMinor,
    currency: ctx.currency,
    sales_share_bps:
      form.goal === "sell" && form.salesShare
        ? Math.round(form.salesSharePercent * 100)
        : null,
    shoot_passes: 1,
    slots: form.slots,
    visibility: "board",
    status: "open",
  };
}

const SERVER_FIELD: Record<string, BriefField> = {
  title_public: "title",
  brief_public: "briefPublic",
  brief_private: "briefPrivate",
  deliverables: "platforms",
  shoot_window_start: "shoot",
  shoot_window_end: "shoot",
  post_by: "videoDue",
  video_due_at: "videoDue",
  shoot_at: "shoot",
  slots: "slots",
  pay_up_to_minor: "pay",
  city_id: "city",
};

/** Map a `{ok:false,error,field,reasons}` gig_save answer onto the form. */
export function briefServerErrors(result: {
  error?: string;
  field?: string;
  reasons?: string[];
}): BriefErrors {
  if (result.error === "public_brief_not_anonymous") {
    return {
      briefPublic:
        briefLintMessage(result.reasons ?? []) ||
        "Keep the public brief brand-free.",
    };
  }
  // Round 2 server checks on the video-due time, shown next to Video needed by.
  if (result.error === "video_due_required") {
    return { videoDue: "Pick the day and time you need the video by." };
  }
  if (result.error === "video_due_before_shoot") {
    return {
      videoDue:
        "The video can't be due before the shoot. Pick a later time or an earlier shoot.",
    };
  }
  if (result.error === "pay_required") {
    return { pay: "Enter the most you'll pay each creator." };
  }
  const field = result.field ? SERVER_FIELD[result.field] : undefined;
  const message =
    result.error === "shoot_outside_window"
      ? "Pick a shoot day that works for the listing."
      : result.error === "post_by_before_shoot"
        ? "The video can't be due before the shoot."
        : result.error === "shoot_window_in_past"
          ? "The shoot can't be in the past."
      : "Check this and try again.";
  if (field) return { [field]: message };
  return {
    form: programErrorMessage(
      result.error ?? null,
      "We couldn't post this gig. Check the details and try again.",
    ),
  };
}
