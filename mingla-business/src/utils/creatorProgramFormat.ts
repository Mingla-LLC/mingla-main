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

/**
 * #4402 (D2) — the smallest creator fee Mingla accepts, in minor units. The
 * server enforces it; this copy only explains it. Other currencies have no
 * minimum (OQ-7), so they return null.
 */
const GIG_MIN_FEE_MINOR: Record<string, number> = {
  NGN: 10000,
  USD: 1000,
  EUR: 1000,
  GBP: 1000,
};

export function gigMinFeeMinor(currency: string | null | undefined): number | null {
  const code = typeof currency === "string" ? currency.toUpperCase() : "";
  return Object.prototype.hasOwnProperty.call(GIG_MIN_FEE_MINOR, code)
    ? GIG_MIN_FEE_MINOR[code]
    : null;
}

/** "The minimum creator fee is ₦100." — null when the fee is fine or no minimum applies. */
export function minFeeError(
  feeMinor: number | null | undefined,
  currency: string,
): string | null {
  const min = gigMinFeeMinor(currency);
  if (min === null || typeof feeMinor !== "number" || feeMinor >= min) return null;
  return `The minimum creator fee is ${programMoney(min, currency)}.`;
}

/**
 * The hint under a fee field. Host copy speaks to the host ("you also pay").
 * With a typed fee at or above the minimum it shows the real total.
 */
export function minFeeHint(
  currency: string,
  feeMinor?: number | null,
  voice: "host" | "creator" = "host",
): string | null {
  const min = gigMinFeeMinor(currency);
  if (min === null) return null;
  const lead = `Minimum ${programMoney(min, currency)}.`;
  const who = voice === "host" ? "You also pay" : "The host also pays";
  const cost = voice === "host" ? "costs you" : "costs the host";
  if (typeof feeMinor === "number" && feeMinor >= min) {
    return `${lead} ${who} Mingla's 15% booking fee on top, so ${programMoney(feeMinor, currency)} ${cost} ${programMoney(feeMinor + bookingFeeMinor(feeMinor), currency)}.`;
  }
  return `${lead} ${who} Mingla's 15% booking fee on top.`;
}

/**
 * #4402 — what a host gets back when they cancel (mirrors gig_refund_quote).
 * Before the creator accepts: everything paid. After accept, before the
 * script is approved: 75% of the fee plus the booking fee.
 */
export function cancelRefundQuote(
  kind: "offer" | "gig",
  feeMinor: number,
  bookingMinor: number,
): {
  feeShareMinor: number;
  bookingMinor: number;
  totalMinor: number;
  creatorKeepsMinor: number;
} {
  const feeShareMinor = kind === "offer" ? feeMinor : Math.round((feeMinor * 75) / 100);
  return {
    feeShareMinor,
    bookingMinor,
    totalMinor: feeShareMinor + bookingMinor,
    creatorKeepsMinor: feeMinor - feeShareMinor,
  };
}

/**
 * Initials from letters only ("S(eth) Ogieva" → "Seth Ogieva" for the
 * Initials badge → "SO"); an email falls back to its first letter.
 */
export function rosterInitialsName(
  name: string | null | undefined,
  email?: string | null,
): string {
  const words = (name ?? "")
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ""))
    .filter((part) => part.length > 0);
  if (words.length > 0) return words.join(" ");
  const letter = (email ?? "").match(/\p{L}/u);
  return letter ? letter[0] : "?";
}

/**
 * #4402 (H23) — group cities by country (the brand's country first, the rest
 * A to Z) after a case-insensitive search on the name or country.
 */
export function groupCitiesByCountry<T extends { name: string; country: string }>(
  cities: readonly T[],
  query: string,
  brandCountry?: string | null,
): Array<{ country: string; cities: T[] }> {
  const needle = query.trim().toLowerCase();
  const kept = needle
    ? cities.filter(
        (city) =>
          city.name.toLowerCase().includes(needle) ||
          city.country.toLowerCase().includes(needle),
      )
    : [...cities];
  const byCountry = new Map<string, T[]>();
  for (const city of kept) {
    const key = city.country || "Other";
    byCountry.set(key, [...(byCountry.get(key) ?? []), city]);
  }
  const mine = (brandCountry ?? "").toLowerCase();
  return [...byCountry.entries()]
    .sort(([a], [b]) => {
      const aMine = a.toLowerCase() === mine ? 0 : 1;
      const bMine = b.toLowerCase() === mine ? 0 : 1;
      return aMine - bMine || a.localeCompare(b);
    })
    .map(([country, list]) => ({
      country,
      cities: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * #4402 (item 18) — only published, upcoming events can carry a gig. `ends`
 * are the event's date end times; an event with none is left out.
 */
export function isUpcomingListing(
  row: { status?: string | null; ends?: ReadonlyArray<string | null> },
  now: Date = new Date(),
): boolean {
  if (row.status !== "scheduled" && row.status !== "live") return false;
  return (row.ends ?? []).some((end) => {
    if (!end) return false;
    const time = new Date(end).getTime();
    return Number.isFinite(time) && time >= now.getTime();
  });
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

/** "Africa/Lagos" → "Lagos time"; "UTC" → "UTC". The same words on every device. */
export function zoneLabel(timezone: string | null | undefined): string {
  if (typeof timezone !== "string" || timezone.length === 0) return "";
  if (timezone === "UTC" || timezone === "Etc/UTC") return "UTC";
  const city = timezone.split("/").pop() ?? timezone;
  return `${city.replace(/_/g, " ")} time`;
}

/**
 * #4402 (item 12) — "Tue Dec 15, 6:00 PM Lagos time": a gig's own zone, never
 * the phone's. With no zone it falls back to the phone's time without a label
 * rather than guessing one.
 */
export function formatInZone(
  value: string | null | undefined,
  timezone: string | null | undefined,
): string {
  const date = parseProgramDate(value);
  if (!date) return "";
  if (typeof timezone !== "string" || timezone.length === 0) {
    return shortDateTime(value);
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const pick = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    // #4402: Hermes on iOS splits formatToParts on punctuation, so hour /
    // minute / dayPeriod can be missing ("undefined:undefined"). The time
    // comes from format() then, which every engine renders whole.
    const time =
      pick("hour") && pick("minute") && pick("dayPeriod")
        ? `${pick("hour")}:${pick("minute")} ${pick("dayPeriod").toUpperCase()}`
        : new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
            .format(date)
            .replace(/\u202f|\u00a0/g, " ")
            .toUpperCase();
    return `${pick("weekday")} ${pick("month")} ${pick("day")}, ${time} ${zoneLabel(timezone)}`;
  } catch {
    return shortDateTime(value);
  }
}

/**
 * #4402 — the posting deadline as people read it. The server stores the first
 * instant after the grace day ("00:00"); show the last minute ("11:59 PM") the
 * day before, the same as the creator's app.
 */
export function postDeadlineShownIso(deadlineAt: string | null | undefined): string | null {
  if (typeof deadlineAt !== "string" || deadlineAt.length === 0) return null;
  const ms = Date.parse(deadlineAt);
  return Number.isFinite(ms) ? new Date(ms - 60_000).toISOString() : null;
}

/** The gig's zone from a workspace or gig row (the server sends `timezone`). */
export function gigZone(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const row = source as Record<string, unknown>;
  const direct = row.timezone;
  if (typeof direct === "string" && direct.length > 0) return direct;
  for (const key of ["gig", "contract"]) {
    const nested = row[key];
    if (nested && typeof nested === "object") {
      const zone = (nested as Record<string, unknown>).timezone;
      if (typeof zone === "string" && zone.length > 0) return zone;
    }
  }
  return null;
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
export const AUDIENCE_NOT_CHECKED = "Not checked yet";

/**
 * #4402: hosts see only a band a Mingla admin recorded; with none, "Not
 * checked yet". The creator's own band is never shown to hosts.
 */
export function audienceLabel(
  bands:
    | ReadonlyArray<{ platform?: string | null; band?: string | null; source?: string | null }>
    | null
    | undefined,
): string {
  const checked = (Array.isArray(bands) ? bands : []).filter(
    (item) =>
      item &&
      item.source === "admin" &&
      typeof item.band === "string" &&
      item.band.length > 0,
  );
  if (checked.length === 0) return AUDIENCE_NOT_CHECKED;
  return checked
    .map((item) =>
      `${platformLabel(item.platform)} ${followerBandLabel(item.band)}`.trim(),
    )
    .join(" · ");
}

/**
 * #4430 H-A: the confirm shown before a host passes on an applicant. Passing
 * is final for this gig's list, so it is never one tap.
 */
export function passConfirmCopy(name: string): {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
} {
  const who = name.trim() || "this creator";
  return {
    title: `Pass on ${who}?`,
    description:
      "You won't be able to send them an offer for this gig from this list.",
    confirmLabel: "Pass",
    cancelLabel: "Keep",
  };
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
// Pay: the most the host pays each creator, in the gig's currency
// ---------------------------------------------------------------------------

/** "up to $300" from a gig's pay_up_to_minor, or null when none was stored. */
export function payUpToLabel(
  payMinor: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (typeof payMinor !== "number" || !Number.isFinite(payMinor) || payMinor <= 0)
    return null;
  return `up to ${programMoneyShort(payMinor, currency || "USD")}`;
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
  posts_submitted: "Links added",
  posts_verified: "Posts verified",
  released: "Payment released to the creator",
  completed: "Done",
  disputed: "Dispute opened",
  rating_submitted: "Rating left",
  counter_sent: "Counter-offer sent",
  counter_accepted: "Counter-offer accepted",
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
  host_confirm: "Posts verified",
  auto_confirm: "Posts verified",
  release: "Payment released to the creator",
  expire: "Offer expired",
  cancel: "Offer cancelled",
  offer_created: "Offer sent",
  hold_captured: "Payment held by Mingla",
  offer_payment_abandoned: "Payment not completed",
  delivery_submitted: "Video sent for review",
  refund_recorded: "Refund recorded",
  plan_confirmed: "Shoot time confirmed",
  start_script: "Script started",
  send_script: "Script sent",
  request_script_changes: "Script changes requested",
  request_fix: "Fix requested",
  start_posting: "Posting started",
  posts_passed: "All posts checked",
  posts_failed: "A post needs a fix",
  gig_release_recorded: "Payment released to the creator",
  post_reviewed: "Post checked",
  topup_captured: "Difference paid",
  counter_refund_recorded: "Difference refunded",
  terms_change_declined: "Change declined",
  dispute_offer_made: "Settlement offered",
  dispute_offer_accepted: "Settlement accepted",
  dispute_offer_declined: "Settlement declined",
  dispute_decided: "Dispute decided by Mingla",
  dispute_release_recorded: "Payment released to the creator",
};

export function activityWords(
  kind: string | null | undefined,
  data?: Record<string, unknown> | null,
): string | null {
  if (typeof kind !== "string") return null;
  if (kind === "post_reviewed") {
    return data?.result === "failed"
      ? "Post checked: failed"
      : data?.result === "passed"
        ? "Post checked: passed"
        : "Post checked";
  }
  if (kind === "refund_recorded" || kind === "counter_refund_recorded") {
    const minor = data?.refund_minor;
    const currency = data?.currency;
    if (typeof minor === "number" && typeof currency === "string") {
      return `Refund of ${programMoney(minor, currency)} recorded`;
    }
  }
  if (kind.startsWith("dispute_") && !(kind in ACTION_EVENT_WORDS)) {
    return "Dispute updated";
  }
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
  // #4402 — creator-hire payment checks.
  already_paid: "This offer is already paid. Opening it now.",
  payment_pending:
    "Your last payment for this creator is still being confirmed. You won't be charged twice. Open the offer to check it.",
  payment_failed: "The payment didn't go through. Nothing was charged.",
  payment_unfinished:
    "This payment wasn't finished. You can start again; you won't be charged twice.",
  refund_in_progress: "A refund for this offer is already on its way.",
  payment_mismatch:
    "We couldn't match this payment. Our team has been alerted.",
  payment_check_failed:
    "We couldn't check the payment right now. Try again in a minute.",
  payment_late_refunded:
    "This payment arrived after the offer closed, so it is being refunded in full.",
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
  // #4402 — re-offering after a cancel, and the minimum creator fee.
  interest_not_open: "This creator is no longer available for this gig.",
  already_offered:
    "You already have an open offer with this creator. Open it from Creators.",
  gig_not_open: "This gig is closed. Reopen it to make offers.",
  fee_below_minimum: "That fee is below the minimum creator fee.",
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

/**
 * #4402 — creator videos play through Bunny's signed EMBED page
 * (player.mediadelivery.net/embed/...), not a media file. Fed to a raw video
 * element it never loads (MediaError 4, a frozen 0:00 player). Explorer and
 * Admin show it in a WebView / iframe; Host does the same. Anything else is an
 * error state, never a silent player.
 */
export type CreatorVideoSurface = "iframe" | "webview" | "error";

export function isCreatorEmbedUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  return /^https:\/\/(player|iframe)\.mediadelivery\.net\/(embed|play)\/[^\s]+$/.test(url);
}

export function creatorVideoSurface(
  url: string | null | undefined,
  platformOS: string,
): CreatorVideoSurface {
  if (!isCreatorEmbedUrl(url)) return "error";
  return platformOS === "web" ? "iframe" : "webview";
}

/**
 * #4402 (item 17) — a delivery's poster image, when the server sends one
 * (`thumbnail_url`, `thumbnail` or `poster_url`, plain https only). Null shows
 * a branded poster instead of a blank box.
 */
export function deliveryPosterUrl(delivery: unknown): string | null {
  if (!delivery || typeof delivery !== "object") return null;
  const row = delivery as Record<string, unknown>;
  for (const key of ["thumbnail_url", "thumbnail", "poster_url"]) {
    const value = row[key];
    if (typeof value === "string" && /^https:\/\//.test(value)) return value;
  }
  return null;
}

/**
 * #4402 (H18) — what the host is told right after posting. It only claims
 * reach the server counted: `verified_creator_count` in the gig's city.
 */
export function gigReachCopy(gig: unknown): { tone: "ok" | "none" | "unknown"; body: string } {
  const row = gig && typeof gig === "object" ? (gig as Record<string, unknown>) : {};
  const count = row.verified_creator_count;
  const city =
    typeof row.city_name === "string" && row.city_name ? row.city_name : "your city";
  if (typeof count === "number" && count > 0) {
    return {
      tone: "ok",
      body: `Your gig is live. ${count} verified creator${count === 1 ? "" : "s"} in ${city} can see it.`,
    };
  }
  if (count === 0) {
    return {
      tone: "none",
      body: `Your gig is live. There are no verified creators in ${city} yet; we'll tell you when someone applies.`,
    };
  }
  return {
    tone: "unknown",
    body: "Your gig is live. We'll tell you when a creator applies.",
  };
}

export const CREATOR_VIDEO_ERROR = "This video couldn't play. Close it and try again in a moment.";
