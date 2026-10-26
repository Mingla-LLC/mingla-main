/**
 * #3872 — one place that turns Creator-program server values into Host words.
 *
 * Copy rule: hosts never see raw values — no status keys, budget codes ("b2"),
 * follower-band keys ("10k_50k"), ISO dates, minor units, provider names,
 * UUIDs or server error text. Every program screen formats through here.
 */
import {
  formatCurrency,
  formatCurrencyRound,
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "./currency";
import { CREATOR_FORMATS } from "../services/creatorProgramContract";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** "$300" for whole amounts, "$118.80" otherwise. Minor units in, words out. */
export function programMoney(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "—";
  const code = normalizeCurrency(currency);
  const major = majorFromMinor(minor, code);
  return Number.isInteger(major)
    ? formatCurrencyRound(minor, code, true)
    : formatCurrency(minor, code, true);
}

/** Headline money: "$1,240", "₦486k", "₦1.3M" for tiles. */
export function programMoneyShort(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "—";
  const code = normalizeCurrency(currency);
  const major = majorFromMinor(minor, code);
  if (Math.abs(major) < 100_000) return programMoney(Math.round(minor), code);
  const glyph = formatCurrencyRound(0, code).replace(/[0\s.,]/g, "");
  const scaled =
    Math.abs(major) >= 1_000_000
      ? `${trimNumber(major / 1_000_000)}M`
      : `${trimNumber(major / 1_000)}k`;
  return `${glyph}${scaled}`;
}

function trimNumber(value: number): string {
  return value >= 100
    ? String(Math.round(value))
    : String(Math.round(value * 10) / 10);
}

/**
 * Parse what a host typed as whole currency ("$300", "300", "1,200") into
 * minor units. Returns null when it is not a positive amount.
 */
export function wholeCurrencyToMinor(
  text: string,
  currency: string,
): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  const minor = minorFromMajor(value, currency);
  return minor > 0 ? minor : null;
}

/** Whole-currency text for an input from minor units (30000 USD → "300"). */
export function minorToWholeText(
  minor: number | null | undefined,
  currency: string,
): string {
  if (typeof minor !== "number" || !Number.isFinite(minor) || minor <= 0)
    return "";
  return String(Math.round(majorFromMinor(minor, currency)));
}

/** Mingla's 15% booking fee on a creator fee, rounded half up in minor units. */
export function bookingFeeMinor(feeMinor: number): number {
  if (!Number.isFinite(feeMinor) || feeMinor <= 0) return 0;
  return Math.floor((feeMinor * 1500 + 5000) / 10000);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse "YYYY-MM-DD" as a LOCAL calendar date (no UTC day shift); ISO timestamps as instants. */
export function parseProgramDate(
  value: string | null | undefined,
): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Dec 5" (adds the year when it is not this year). */
export function shortDate(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseProgramDate(value);
  if (!date) return "";
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? base
    : `${base}, ${date.getFullYear()}`;
}

/** "Thu 15 Oct, 6 PM" style for a shoot time. */
export function shortDateTime(value: string | null | undefined): string {
  const date = parseProgramDate(value);
  if (!date) return "";
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const time =
    minutes === 0
      ? `${hour12} ${hours < 12 ? "AM" : "PM"}`
      : `${hour12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}, ${time}`;
}

/** "Nov 20–25", "Nov 28 – Dec 3", or a single "Nov 20". */
export function dateRangeLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date(),
): string {
  const a = parseProgramDate(start);
  const b = parseProgramDate(end);
  if (!a && !b) return "";
  if (!a || !b) return shortDate(start ?? end, now);
  if (a.getTime() === b.getTime()) return shortDate(start, now);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    const year =
      a.getFullYear() === now.getFullYear() ? "" : `, ${a.getFullYear()}`;
    return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}${year}`;
  }
  return `${shortDate(start, now)} – ${shortDate(end, now)}`;
}

/** "YYYY-MM-DD" for a local Date. */
export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Add whole days to a "YYYY-MM-DD" value. */
export function addDays(day: string, days: number): string {
  const date = parseProgramDate(day) ?? new Date();
  date.setDate(date.getDate() + days);
  return toIsoDay(date);
}

/** "in 47 hours", "in 3 days", "now" — for auto-approve deadlines. */
export function dueIn(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseProgramDate(value);
  if (!date) return "";
  const hours = Math.round((date.getTime() - now.getTime()) / 3_600_000);
  if (hours <= 0) return "now";
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// Audience, platforms, formats
// ---------------------------------------------------------------------------

/** "10k_50k" → "10k–50k", "100k_plus" → "100k+", "under_1k" → "Under 1k". */
export function followerBandLabel(band: string | null | undefined): string {
  if (typeof band !== "string" || band.trim().length === 0) return "";
  const key = band.trim().toLowerCase();
  if (key.startsWith("under_")) return `Under ${key.slice(6)}`;
  if (key.endsWith("_plus")) return `${key.slice(0, -5)}+`;
  const parts = key.split("_").filter(Boolean);
  if (parts.length === 2) return `${parts[0]}–${parts[1]}`;
  return parts.join(" ");
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  snapchat: "Snapchat",
  facebook: "Facebook",
};

export function platformLabel(platform: string | null | undefined): string {
  if (typeof platform !== "string") return "";
  return (
    PLATFORM_LABELS[platform.toLowerCase()] ??
    capitalise(platform.replace(/_/g, " "))
  );
}

/** "Instagram 10k–50k" — the band a host sees on an applicant row. */
export function audienceLabel(
  bands:
    | ReadonlyArray<{ platform?: string | null; band?: string | null }>
    | null
    | undefined,
): string {
  if (!Array.isArray(bands)) return "";
  return bands
    .filter(
      (item) => item && typeof item.band === "string" && item.band.length > 0,
    )
    .map((item) =>
      `${platformLabel(item.platform)} ${followerBandLabel(item.band)}`.trim(),
    )
    .join(" · ");
}

export function formatName(formatKey: string | null | undefined): string {
  const match = CREATOR_FORMATS.find((item) => item.key === formatKey);
  if (match) return match.name;
  return typeof formatKey === "string"
    ? capitalise(formatKey.replace(/_/g, " "))
    : "";
}

export function nicheLabel(niche: string): string {
  return capitalise(niche.replace(/_/g, " "));
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// Budget: real range when Admin configured one for the currency, else a level
// ---------------------------------------------------------------------------

export type BudgetBandKey = "b1" | "b2" | "b3" | "b4";
export const BUDGET_BANDS: readonly BudgetBandKey[] = ["b1", "b2", "b3", "b4"];

export type BudgetBandRange = {
  currency: string;
  band: BudgetBandKey;
  min_minor: number;
  max_minor: number;
};

export type BudgetDisplay =
  | { kind: "range"; label: string }
  | { kind: "level"; level: 1 | 2 | 3 | 4; label: string };

/** From a gig's budget fields (budget_min_minor/max_minor/currency, band fallback). */
export function budgetDisplay(input: {
  budget_min_minor?: number | null;
  budget_max_minor?: number | null;
  budget_currency?: string | null;
  budget_band?: string | null;
}): BudgetDisplay {
  const {
    budget_min_minor: min,
    budget_max_minor: max,
    budget_currency: currency,
  } = input;
  if (
    typeof currency === "string" &&
    currency.length === 3 &&
    typeof min === "number" &&
    typeof max === "number"
  ) {
    return {
      kind: "range",
      label: `${programMoney(min, currency)}–${programMoney(max, currency)}`,
    };
  }
  const level = bandLevel(input.budget_band);
  return { kind: "level", level, label: `Budget level ${level} of 4` };
}

export function bandLevel(band: string | null | undefined): 1 | 2 | 3 | 4 {
  const index = BUDGET_BANDS.indexOf((band ?? "") as BudgetBandKey);
  return (index >= 0 ? index + 1 : 1) as 1 | 2 | 3 | 4;
}

/** Ranges configured for one currency, ordered b1..b4 (empty when none). */
export function bandsForCurrency(
  ranges: readonly BudgetBandRange[],
  currency: string,
): BudgetBandRange[] {
  const code = normalizeCurrency(currency);
  return BUDGET_BANDS.map((band) =>
    ranges.find(
      (row) => row.band === band && normalizeCurrency(row.currency) === code,
    ),
  ).filter((row): row is BudgetBandRange => Boolean(row));
}

/** The smallest configured band whose max covers the pay-up-to amount. */
export function bandForAmount(
  ranges: readonly BudgetBandRange[],
  amountMinor: number,
): BudgetBandKey {
  const sorted = [...ranges].sort(
    (a, b) => BUDGET_BANDS.indexOf(a.band) - BUDGET_BANDS.indexOf(b.band),
  );
  for (const row of sorted) if (amountMinor <= row.max_minor) return row.band;
  return sorted.length > 0 ? sorted[sorted.length - 1].band : "b2";
}

// ---------------------------------------------------------------------------
// Contract states, host words
// ---------------------------------------------------------------------------

export type HostStatusTone =
  "action" | "waiting" | "done" | "problem" | "ended";

const HOST_STATE_WORDS: Record<
  string,
  { label: string; tone: HostStatusTone }
> = {
  offered: { label: "Waiting for the creator", tone: "waiting" },
  accepted: { label: "Approve the shoot time", tone: "action" },
  shoot_planned: { label: "Approve the shoot time", tone: "action" },
  script_drafting: { label: "Creator is writing the script", tone: "waiting" },
  script_sent: { label: "Review the script", tone: "action" },
  script_locked: { label: "Creator is filming", tone: "waiting" },
  delivered: { label: "Review the video", tone: "action" },
  fix_requested: { label: "Waiting for the fix", tone: "waiting" },
  approved: { label: "Waiting for posts", tone: "waiting" },
  posting: { label: "Waiting for posts", tone: "waiting" },
  posts_failed: { label: "Waiting for posts", tone: "waiting" },
  posts_submitted: { label: "Checking posts", tone: "waiting" },
  posts_verified: { label: "Posts verified", tone: "done" },
  released: { label: "Paid to the creator", tone: "done" },
  day30: { label: "Paid to the creator", tone: "done" },
  completed: { label: "Done", tone: "done" },
  disputed: { label: "In dispute", tone: "problem" },
  resolved_release: { label: "Settled · paid to the creator", tone: "ended" },
  resolved_partial: { label: "Settled · part refunded", tone: "ended" },
  resolved_refund: { label: "Settled · refunded", tone: "ended" },
  declined: { label: "Declined", tone: "ended" },
  expired: { label: "Expired", tone: "ended" },
  cancelled: { label: "Cancelled", tone: "ended" },
};

export function hostContractStatus(state: string | null | undefined): {
  label: string;
  tone: HostStatusTone;
} {
  return (
    HOST_STATE_WORDS[state ?? ""] ?? { label: "In progress", tone: "waiting" }
  );
}

/** The six steps of the host step bar. */
export const HOST_CONTRACT_STEPS = [
  "Offer",
  "Shoot",
  "Script",
  "Video",
  "Posts",
  "Paid",
] as const;

/** 1-based step number for the step bar ("Step 3 of 6"). */
export function hostContractStep(state: string | null | undefined): number {
  switch (state) {
    case "offered":
      return 1;
    case "accepted":
    case "shoot_planned":
      return 2;
    case "script_drafting":
    case "script_sent":
      return 3;
    case "script_locked":
    case "delivered":
    case "fix_requested":
      return 4;
    case "approved":
    case "posting":
    case "posts_failed":
    case "posts_submitted":
      return 5;
    default:
      return 6;
  }
}

const GIG_STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  open: "Live",
  filled: "Filled",
  closed: "Closed",
  cancelled: "Cancelled",
};

export function gigStatusLabel(status: string | null | undefined): string {
  return GIG_STATUS_WORDS[status ?? ""] ?? "";
}

const EVENT_WORDS: Record<string, string> = {
  offer_sent: "Offer sent",
  offered: "Offer sent",
  accepted: "Creator accepted",
  declined: "Creator declined",
  expired: "Offer expired",
  cancelled: "Offer cancelled",
  shoot_plan_proposed: "Shoot time suggested",
  shoot_plan_confirmed: "Shoot time approved",
  script_saved: "Script draft saved",
  script_sent: "Script sent for review",
  script_locked: "Script approved",
  delivered: "Video sent for review",
  fix_requested: "Fix requested",
  approved: "Video approved",
  posts_submitted: "Post links added",
  posts_verified: "Posts verified",
  released: "Payment released to the creator",
  completed: "Done",
  disputed: "Dispute opened",
  rating_submitted: "Rating left",
  counter_sent: "Creator suggested a different fee",
  counter_accepted: "New fee agreed",
  counter_declined: "Counter-offer declined",
};

/**
 * #3872 round 2 — Activity lists what happened, never the buttons pressed.
 * gig_transition records the action name ("approve", "lock_script") and
 * other writers record the event ("approved"), so the same step showed twice
 * ("Approve" and "Video approved"). Both now read as the event; unknown kinds
 * are left out rather than shown as raw words.
 */
const ACTION_EVENT_WORDS: Record<string, string> = {
  accept: "Creator accepted",
  decline: "Creator declined",
  creator_decline: "Creator declined",
  approve: "Video approved",
  auto_approve: "Video approved",
  lock_script: "Script approved",
  auto_lock: "Script approved",
  posts_passed: "Posts verified",
  host_confirm: "Posts verified",
  auto_confirm: "Posts verified",
  release: "Payment released to the creator",
  expire: "Offer expired",
  cancel: "Offer cancelled",
  offer_created: "Offer sent",
  hold_captured: "Payment received",
  offer_payment_abandoned: "Payment not completed",
  delivery_submitted: "Video sent for review",
  refund_recorded: "Refund recorded",
  topup_captured: "Difference paid",
  counter_refund_recorded: "Difference refunded",
  terms_change_declined: "Change declined",
  dispute_offer_made: "Settlement offered",
  dispute_offer_accepted: "Settlement accepted",
  dispute_offer_declined: "Settlement declined",
  dispute_decided: "Dispute decided by Mingla",
  dispute_release_recorded: "Payment released to the creator",
};

export function activityWords(kind: string | null | undefined): string | null {
  if (typeof kind !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(EVENT_WORDS, kind))
    return EVENT_WORDS[kind];
  if (Object.prototype.hasOwnProperty.call(ACTION_EVENT_WORDS, kind))
    return ACTION_EVENT_WORDS[kind];
  return null;
}

/** Timeline row words for a contract event kind (falls back to plain words). */
export function timelineWords(kind: string | null | undefined): string {
  if (typeof kind !== "string" || kind.length === 0) return "Update";
  if (EVENT_WORDS[kind]) return EVENT_WORDS[kind];
  if (kind.startsWith("transition_"))
    return hostContractStatus(kind.slice(11)).label;
  return capitalise(kind.replace(/_/g, " "));
}

export function actorWords(actor: string | null | undefined): string {
  switch (actor) {
    case "host":
      return "You";
    case "creator":
      return "Creator";
    case "admin":
      return "Mingla";
    default:
      return "Mingla";
  }
}

// ---------------------------------------------------------------------------
// Brand-free public brief check (mirrors the server lint so hosts see it live)
// ---------------------------------------------------------------------------

export type BriefLintHit =
  "url" | "email" | "phone" | "handle" | "brand" | "listing";

export function lintPublicBrief(
  text: string,
  names: {
    brandName?: string | null;
    brandSlug?: string | null;
    listingTitle?: string | null;
  } = {},
): BriefLintHit[] {
  const hits: BriefLintHit[] = [];
  if (/(https?:\/\/|www\.)/i.test(text)) hits.push("url");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) hits.push("email");
  if (/(^|[^0-9])\+?[0-9][0-9 ()-]{7,}[0-9]/.test(text)) hits.push("phone");
  if (/(^|\s)@[a-z0-9_.-]+/i.test(text)) hits.push("handle");
  const lower = text.toLowerCase();
  const contains = (value: string | null | undefined): boolean =>
    typeof value === "string" &&
    value.trim().length > 1 &&
    lower.includes(value.trim().toLowerCase());
  if (contains(names.brandName) || contains(names.brandSlug))
    hits.push("brand");
  if (contains(names.listingTitle)) hits.push("listing");
  return hits;
}

const LINT_WORDS: Record<string, string> = {
  url: "a link",
  email: "an email address",
  phone: "a phone number",
  handle: "a social handle",
  brand: "your brand name",
  listing: "the listing's name",
};

/** "Remove your brand name and a link — creators see this before they're hired." */
export function briefLintMessage(hits: readonly string[]): string {
  const words = Array.from(new Set(hits)).map(
    (hit) => LINT_WORDS[hit] ?? "contact details",
  );
  if (words.length === 0) return "";
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Remove ${list}. Creators see this before they're hired, so keep it brand-free.`;
}

// ---------------------------------------------------------------------------
// Server error codes → words
// ---------------------------------------------------------------------------

const ERROR_WORDS: Record<string, string> = {
  public_brief_not_anonymous: "Keep the public brief brand-free.",
  permission_denied: "You don't have permission to do that for this brand.",
  gig_full: "Every creator slot on this gig is already filled.",
  stale_contract_state:
    "This changed while you were looking. Pull to refresh and try again.",
  captured_hold_required: "The payment hasn't gone through yet.",
  shoot_outside_window: "Pick a time inside the shoot dates.",
  shoot_proposal_limit:
    "You've suggested three times already. Approve a time or message the creator.",
  rating_not_open: "You can rate once the gig is done.",
  offer_prepare_failed:
    "We couldn't prepare this offer. Check the creator is still available and try again.",
  provider_start_failed:
    "Payments aren't available right now. Try again in a few minutes.",
  client_secret_missing:
    "Payments aren't available right now. Try again in a few minutes.",
  payment_not_proven:
    "We couldn't confirm the payment yet. If you paid, wait a minute and check again.",
  payment_confirm_failed:
    "We couldn't confirm the payment yet. If you paid, wait a minute and check again.",
  validation_error:
    "Something in this offer isn't valid. Check the fee and try again.",
  invalid_quote: "Enter a fee above zero.",
  unauthorized: "Sign in again to continue.",
  counter_not_open: "This counter-offer is no longer open.",
  proposal_not_open: "This request is no longer open.",
  delivery_not_found: "We couldn't find this video. Pull to refresh.",
  contract_not_found: "We couldn't find this gig. It may have been cancelled.",
  creator_gigs_unavailable: "Creator gigs aren't available for this brand yet.",
  feature_unavailable: "Creator gigs aren't available for this brand yet.",
  rollout_required: "Creator gigs aren't available for this brand yet.",
  fix_rounds_exhausted:
    "Both fix rounds are used. Approve the video or open a dispute.",
};

/** Turn a thrown error or `{ok:false,error}` code into words a host can act on. */
export function programErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  const code = programErrorCode(error);
  if (code && ERROR_WORDS[code]) return ERROR_WORDS[code];
  return fallback;
}

export function programErrorCode(error: unknown): string | null {
  const raw =
    typeof error === "string"
      ? error
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : error &&
            typeof error === "object" &&
            "error" in error &&
            typeof (error as { error: unknown }).error === "string"
          ? (error as { error: string }).error
          : null;
  if (!raw) return null;
  const match = /^([a-z][a-z0-9_]*)(?::|$)/.exec(raw.trim());
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// "Needs you" items on the Promote hub and Creators home
// ---------------------------------------------------------------------------

/** A contract needs the host when the server says so, or its state is a host action. */
export function contractNeedsHost(contract: {
  needs_host?: boolean | null;
  state?: string | null;
  payment_pending?: boolean | null;
}): boolean {
  // An unpaid offer is shown as "Payment not completed", never as work.
  if (contract.payment_pending === true) return false;
  if (contract.needs_host === true) return true;
  if (contract.needs_host === false) return false;
  return (
    hostContractStatus(contract.state).tone === "action" ||
    contract.state === "disputed"
  );
}

export function needsYouCopy(
  state: string,
  creator: string,
  dueAt: string | null,
  now: Date = new Date(),
): { title: string; body: string; cta: string } {
  const due = dueAt ? dueIn(dueAt, now) : "";
  switch (state) {
    case "script_sent":
      return {
        title: `${creator} sent the script`,
        body: `Approve it or ask for one change.${due ? ` It approves itself ${due}.` : ""}`,
        cta: "Review script",
      };
    case "delivered":
      return {
        title: `${creator} sent the video`,
        body: `Approve it or request a fix.${due ? ` It approves itself ${due}.` : ""}`,
        cta: "Review video",
      };
    case "accepted":
    case "shoot_planned":
      return {
        title: `${creator} wants to plan the shoot`,
        body: "Approve the time or suggest another.",
        cta: "Review time",
      };
    case "disputed":
      return {
        title: `Dispute with ${creator}`,
        body: "Make or answer a settlement offer.",
        cta: "Open dispute",
      };
    default:
      return {
        title: `${creator} · ${hostContractStatus(state).label}`,
        body: "",
        cta: "Open",
      };
  }
}

/**
 * #3872 round 2 — short words for a status pill on a list row. Full status
 * words ("Paid to the creator") are too long for a pill; the contract page
 * keeps the full words in its status card.
 */
const HOST_PILL_WORDS: Record<string, string> = {
  offered: "Offer sent",
  accepted: "Plan shoot",
  shoot_planned: "Plan shoot",
  script_drafting: "Script",
  script_sent: "Review script",
  script_locked: "Filming",
  delivered: "Review video",
  fix_requested: "Fixing",
  approved: "Posting",
  posting: "Posting",
  posts_failed: "Posting",
  posts_submitted: "Checking",
  posts_verified: "Verified",
  released: "Paid",
  day30: "Paid",
  completed: "Done",
  disputed: "Dispute",
  resolved_release: "Settled",
  resolved_partial: "Settled",
  resolved_refund: "Refunded",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function hostContractPill(contract: {
  state?: string | null;
  payment_pending?: boolean | null;
}): { label: string; tone: HostStatusTone } {
  if (contract.payment_pending === true) {
    return { label: "Unpaid", tone: "problem" };
  }
  const full = hostContractStatus(contract.state);
  return {
    label: HOST_PILL_WORDS[contract.state ?? ""] ?? full.label,
    tone: full.tone,
  };
}

/**
 * #3872 round 2 — "Dec 5, 6:00 PM" from the gig's video_due_at; falls back to
 * the post-by day ("Dec 5") when no time is stored.
 */
export function videoDueWords(
  videoDueAt: unknown,
  postBy: unknown,
): string {
  if (typeof videoDueAt === "string" && videoDueAt.length > 0) {
    const date = new Date(videoDueAt);
    if (!Number.isNaN(date.getTime())) {
      const hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const twelve = hours % 12 === 0 ? 12 : hours % 12;
      return `${shortDate(toIsoDay(date))}, ${twelve}:${minutes} ${hours >= 12 ? "PM" : "AM"}`;
    }
  }
  return typeof postBy === "string" && postBy.length > 0 ? shortDate(postBy) : "";
}

export type ResultsPeriod = "7d" | "30d" | "all";

/** p_since for gig_results: null for All. */
export function resultsSince(period: ResultsPeriod, now: Date = new Date()): string | null {
  if (period === "all") return null;
  const since = new Date(now.getTime());
  since.setDate(since.getDate() - (period === "7d" ? 7 : 30));
  return since.toISOString();
}
