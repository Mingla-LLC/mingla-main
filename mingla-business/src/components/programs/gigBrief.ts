/**
 * #3872 — the "Hire a creator" brief: form state, inline validation and the
 * gig_save payload. Pure so it can be unit tested.
 */
import {
  bandForAmount,
  bandsForCurrency,
  briefLintMessage,
  lintPublicBrief,
  minorToWholeText,
  programErrorMessage,
  type BudgetBandKey,
  type BudgetBandRange,
} from "../../utils/creatorProgramFormat";
import type { HostGig } from "../../services/creatorGigsService";

export type BriefGoal = "sell" | "seen";
export type BriefPlatform = "instagram" | "tiktok" | "youtube";
export type UsageDays = 30 | 90 | 365;

export const PLATFORM_DELIVERABLES: Record<BriefPlatform, { label: string; kind: string }> = {
  instagram: { label: "Instagram Reel", kind: "reel" },
  tiktok: { label: "TikTok", kind: "video" },
  youtube: { label: "YouTube Short", kind: "short" },
};

export const FORMAT_EXAMPLES: Record<string, string> = {
  first_timer_reaction: "A creator walks in for the first time and reacts on camera: the door, the room, the first taste.",
  night_out_30: "Arrival, the view, signature drinks and the dance floor, cut to 30 seconds.",
  what_price_gets: "Shows exactly what the ticket price gets you, item by item.",
  behind_the_scenes: "Set-up, the team and the moments guests never see, before doors open.",
  three_reasons: "Three quick reasons to go, each with a shot that proves it.",
  date_idea: "Pitched as a date night: getting there, the vibe, and why it works for two.",
};

export type BriefForm = {
  goal: BriefGoal;
  formatKey: string;
  title: string;
  briefPublic: string;
  briefPrivate: string;
  platforms: BriefPlatform[];
  shoot: { start: string; end: string } | null;
  postBy: string;
  slots: number;
  payText: string;
  level: BudgetBandKey;
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
  | "shoot"
  | "postBy"
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
    shoot: null,
    postBy: "",
    slots: 1,
    payText: "",
    level: "b2",
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
    .filter((platform): platform is BriefPlatform => platform === "instagram" || platform === "tiktok" || platform === "youtube");
  const share = typeof gig.sales_share_bps === "number" ? gig.sales_share_bps : null;
  const usage = gig.usage_days === 30 || gig.usage_days === 365 ? gig.usage_days : 90;
  const payMinor = typeof gig.pay_up_to_minor === "number" ? gig.pay_up_to_minor : null;
  return {
    goal: share ? "sell" : "seen",
    formatKey: gig.format_key,
    title: gig.title_public ?? "",
    briefPublic: gig.brief_public ?? "",
    briefPrivate: gig.brief_private ?? "",
    platforms: platforms.length > 0 ? Array.from(new Set(platforms)) : ["instagram"],
    shoot: gig.shoot_window_start && gig.shoot_window_end ? { start: gig.shoot_window_start, end: gig.shoot_window_end } : null,
    postBy: gig.post_by ?? "",
    slots: typeof gig.slots === "number" ? gig.slots : 1,
    payText: payMinor ? minorToWholeText(payMinor, currency) : "",
    level: (/^b[1-4]$/.test(gig.budget_band) ? gig.budget_band : "b2") as BudgetBandKey,
    salesShare: share !== null,
    salesSharePercent: share ? Math.round(share / 100) : 10,
    usageDays: usage,
    cityId: gig.city_id ?? null,
  };
}

export type BriefContext = {
  currency: string;
  today: string;
  bands: readonly BudgetBandRange[];
  brandName?: string | null;
  brandSlug?: string | null;
  listingTitle?: string | null;
};

/** Every problem, next to the field it belongs to. Empty object = ready to post. */
export function validateBrief(form: BriefForm, ctx: BriefContext, payMinor: number | null): BriefErrors {
  const errors: BriefErrors = {};
  const names = { brandName: ctx.brandName, brandSlug: ctx.brandSlug, listingTitle: ctx.listingTitle };
  const title = form.title.trim();
  if (title.length < 8) errors.title = "Give the gig a title of at least 8 characters.";
  else if (title.length > 70) errors.title = "Keep the title under 70 characters.";
  else if (lintPublicBrief(title, names).length > 0) errors.title = briefLintMessage(lintPublicBrief(title, names));
  const brief = form.briefPublic.trim();
  if (brief.length < 40) errors.briefPublic = `Describe what to film in at least 40 characters (${brief.length} so far).`;
  else if (brief.length > 800) errors.briefPublic = "Keep the public brief under 800 characters.";
  else if (lintPublicBrief(brief, names).length > 0) errors.briefPublic = briefLintMessage(lintPublicBrief(brief, names));
  if (form.briefPrivate.length > 2000) errors.briefPrivate = "Keep the private brief under 2,000 characters.";
  if (form.platforms.length === 0) errors.platforms = "Pick at least one place to post.";
  if (!form.shoot) errors.shoot = "Pick the days a creator can film.";
  else if (form.shoot.start < ctx.today) errors.shoot = "Shoot dates can't be in the past.";
  if (!form.postBy) errors.postBy = "Pick the date the video should be posted by.";
  else if (form.shoot && form.postBy < form.shoot.end) errors.postBy = "Pick a post-by date on or after the last shoot day.";
  if (!Number.isInteger(form.slots) || form.slots < 1 || form.slots > 10) errors.slots = "Hire between 1 and 10 creators.";
  if (payMinor === null) errors.pay = "Enter the most you'll pay each creator.";
  if (!form.cityId) errors.city = "Pick the city the shoot is in.";
  return errors;
}

/** The band creators see: from the pay-up-to amount when ranges exist, else the chosen level. */
export function briefBand(form: BriefForm, ctx: BriefContext, payMinor: number | null): BudgetBandKey {
  const ranges = bandsForCurrency(ctx.bands, ctx.currency);
  if (ranges.length > 0 && payMinor !== null) return bandForAmount(ranges, payMinor);
  return form.level;
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
    brief_private: form.briefPrivate.trim().length > 0 ? form.briefPrivate.trim() : null,
    format_key: form.formatKey,
    deliverables: form.platforms.map((platform) => ({ platform, kind: PLATFORM_DELIVERABLES[platform].kind, count: 1 })),
    must_tag: { disclosure: "#ad", mingla: "@usemingla" },
    city_id: form.cityId,
    category: input.listingKind === "venue" ? "venue" : "experience",
    shoot_window_start: form.shoot?.start ?? null,
    shoot_window_end: form.shoot?.end ?? null,
    post_by: form.postBy,
    usage_days: form.usageDays,
    budget_band: briefBand(form, ctx, input.payMinor),
    currency: ctx.currency,
    sales_share_bps: form.goal === "sell" && form.salesShare ? Math.round(form.salesSharePercent * 100) : null,
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
  post_by: "postBy",
  slots: "slots",
  budget_band: "pay",
  city_id: "city",
};

/** Map a `{ok:false,error,field,reasons}` gig_save answer onto the form. */
export function briefServerErrors(result: { error?: string; field?: string; reasons?: string[] }): BriefErrors {
  if (result.error === "public_brief_not_anonymous") {
    return { briefPublic: briefLintMessage(result.reasons ?? []) || "Keep the public brief brand-free." };
  }
  const field = result.field ? SERVER_FIELD[result.field] : undefined;
  const message = result.error === "shoot_outside_window"
    ? "Pick shoot dates that work for the listing."
    : "Check this and try again.";
  if (field) return { [field]: message };
  return {
    form: programErrorMessage(
      result.error ?? null,
      "We couldn't post this gig. Check the details and try again.",
    ),
  };
}
