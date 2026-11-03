/**
 * #4238 — plain words for every Host ad screen.
 *
 * Hosts don't know Mingla's internal terms. This module turns server codes,
 * plan states, platform keys and targeting notes into short sentences that
 * say what is happening to the ad and the money, and what to do next. Pure:
 * no React, no I/O. It changes words only, never what the code does.
 */

import { countryName } from "./hostAdCountries";

/** Internal words a Host must never read (code identifiers may use them). */
export const HOST_AD_BANNED_WORDS: readonly RegExp[] = [
  /\bproviders?\b/i,
  /\blanes?\b/i,
  /\bplan versions?\b/i,
  /\bimmutable\b/i,
  /\bfrozen\b/i,
  /\bfreez(e|es|ing)\b/i,
  /\bhash(es)?\b/i,
  /\bsnapshots?\b/i,
  /\bwiden(s|ed|ing)?\b/i,
  /\bnative\b/i,
  /\bcanonical\b/i,
  /\bdestinations?\b/i,
  /\bdelivery\b/i,
  /\bcreatives?\b/i,
  /\bobjectives?\b/i,
  /\ballocations?\b/i,
  /\bmappings?\b/i,
  /\bpreflight\b/i,
  /\battest(ation|ed|s)?\b/i,
  /\bcurrency authority\b/i,
  /\bresults feed\b/i,
  /\bsafety cap\b/i,
  /\bledger\b/i,
  /\bservers?\b/i,
  // #4238 D3: words Hosts don't use for results.
  /\bconversions?\b/i,
  /\bimpressions?\b/i,
  /\blanding page views?\b/i,
  // Raw city keys such as "NG:lagos".
  /\b[A-Z]{2}:[a-z]/,
  // #4238 retest 2: raw result, step and review-reason codes read aloud.
  /\brsvp registrations?\b/i,
  /\bfirst three host campaigns\b/i,
  /\bSaved at (promote|audience|budget|creative|review)\b/,
];

export function hostAdCopyIsPlain(text: string): boolean {
  return !HOST_AD_BANNED_WORDS.some((pattern) => pattern.test(text));
}

/** "NG" → "Nigeria"; unknown codes stay as they are. */
function countryWord(code: string): string {
  const upper = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? countryName(upper) : code.trim();
}

/** "lagos" → "Lagos", "port-harcourt" → "Port Harcourt". */
function titleWords(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Turns a raw list from the audience check ("NG:lagos, GH:accra" or
 * "NG, GH" or "live_music") into names: "Lagos, Nigeria and Accra, Ghana".
 */
export function hostAdPlaceList(raw: string): string {
  const items = raw
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const city = /^([A-Za-z]{2}):(.+)$/.exec(item);
      if (city) return `${titleWords(city[2])}, ${countryWord(city[1])}`;
      if (/^[A-Za-z]{2}$/.test(item)) return countryWord(item);
      return titleWords(item);
    });
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join("; ")} and ${items[items.length - 1]}`;
}

/**
 * A place name from an ad app ("Lagos, Lagos State, NG") with the country
 * code spelled out ("Lagos, Lagos State, Nigeria").
 */
export function hostAdPlaceName(raw: string): string {
  return raw
    .split(/\s*,\s*/)
    .map((part) => (/^[A-Z]{2}$/.test(part.trim()) ? countryWord(part) : part.trim()))
    .filter(Boolean)
    .join(", ");
}

export const HOST_AD_PLATFORM_NAMES: Record<string, string> = {
  meta: "Facebook & Instagram",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
  reddit: "Reddit",
};

export function platformName(platform: string): string {
  return HOST_AD_PLATFORM_NAMES[platform] ?? humanize(platform);
}

/** "Snapchat", "Snapchat and TikTok", "Facebook & Instagram, Snapchat and TikTok". */
/**
 * #4238: the video still failed after the app already retried it once, so
 * the server's "Retry this platform." would ask the Host to repeat what we
 * just did. Admin keeps the server text; the Host reads this.
 */
export function hostAdVideoFailedMessage(platform: string): string {
  return `${platformName(platform)} couldn't use this video. Try a different video.`;
}

export function platformNames(platforms: readonly string[]): string {
  const names = platforms.map(platformName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "PARTIALLY_LIVE" → "Partially live". */
export function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

const STATUS_LABELS: Record<string, string> = {
  live: "Running",
  active: "Running",
  partially_live: "Running on some apps",
  paused: "Paused",
  pause_requested: "Pausing",
  ended: "Ended",
  archived: "Ended",
  deleted: "Cancelled",
  draft: "Draft",
  validating: "Checking your ad",
  ready_for_funding: "Ready for money",
  funded_held: "Money set aside",
  staff_review_required: "Mingla is checking your ad",
  staff_approved: "Approved by Mingla",
  creating_paused_objects: "Setting up on the apps",
  creation_failed_retryable: "Setup didn't finish",
  creation_failed_terminal: "Couldn't set up",
  changes_requested: "Changes needed",
  cancelled_before_create: "Cancelled",
  launched: "Running",
};

export function hostAdStatusLabel(status: string | null | undefined): string {
  const key = String(status ?? "").trim().toLowerCase();
  return STATUS_LABELS[key] ?? humanize(key);
}

const RESULT_LABELS: Record<string, string> = {
  tickets: "ticket sales",
  ticket_purchase: "ticket sales",
  ticket_purchases: "ticket sales",
  ticket_sales: "ticket sales",
  purchase: "ticket sales",
  purchases: "ticket sales",
  signups: "sign-ups",
  sign_up: "sign-ups",
  reservation: "sign-ups",
  reservations: "sign-ups",
  bookings: "bookings",
  clicks: "page visits",
  click: "page visits",
  link_click: "page visits",
  sign_ups: "sign-ups",
  page_visits: "page visits",
  landing_page_view: "page visits",
  landing_page_views: "page visits",
  page_view: "page visits",
  conversions: "results",
  rsvp_registration: "RSVPs",
  rsvp_registrations: "RSVPs",
  rsvps: "RSVPs",
  rsvp: "RSVPs",
  checkouts_started: "checkouts started",
  app_installs: "app installs",
  installs: "app installs",
  app_store_visits: "app store visits",
  checkout_started: "checkouts started",
  booking_confirmed: "bookings",
  install: "app installs",
  app_store_click: "app store visits",
  // #4238: "impressions" is a banned word; Hosts read "times shown".
  impression: "times shown",
  impressions: "times shown",
  results: "results",
};

const COST_PER_LABELS: Record<string, string> = {
  "ticket sales": "Cost per sale",
  "sign-ups": "Cost per sign-up",
  bookings: "Cost per booking",
  "page visits": "Cost per visit",
  RSVPs: "Cost per sign-up",
};

/** "Cost per sale", "Cost per visit", or "Cost per result". */
export function hostAdCostPerLabel(kind: string | null | undefined): string {
  return COST_PER_LABELS[hostAdResultLabel(kind)] ?? "Cost per result";
}

const PLAIN_RESULT_LABELS = new Set(Object.values(RESULT_LABELS));

/**
 * Plain words for any result kind: a raw key ("rsvp_registration"), a
 * spaced key ("landing page view") or a label the server already made plain
 * ("RSVPs", "ticket sales") all come back as the plain label.
 */
export function hostAdResultLabel(kind: string | null | undefined): string {
  const raw = String(kind ?? "").trim();
  if (PLAIN_RESULT_LABELS.has(raw)) return raw;
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return RESULT_LABELS[key] ?? humanize(key).toLowerCase();
}

/** The builder steps, as a Host reads them ("Saved at: Budget and dates"). */
const STEP_LABELS: Record<string, string> = {
  promote: "What you're promoting",
  audience: "Who sees it",
  budget: "Budget and dates",
  creative: "Video and words",
  review: "Review and launch",
};

export function hostAdStepLabel(step: string | null | undefined): string {
  const key = String(step ?? "").trim().toLowerCase();
  return STEP_LABELS[key] ?? humanize(key);
}

/** Why Mingla is checking an ad, in a Host's words. */
const REVIEW_REASON_LABELS: Record<string, string> = {
  first_three_host_campaigns:
    "Mingla checks a brand's first three ads before they run",
};

export function hostAdReviewReason(reason: string | null | undefined): string {
  const raw = String(reason ?? "").trim();
  if (/\s/.test(raw)) return raw;
  return REVIEW_REASON_LABELS[raw.toLowerCase()] ?? humanize(raw);
}

/** Ads credit history rows (ad_credit_ledger.entry_kind) in plain words. */
const LEDGER_LABELS: Record<string, string> = {
  top_up: "Credit added",
  withdraw: "Credit withdrawn",
  unspend_return: "Returned to credit",
  campaign_spend: "Set aside for an ad",
};

/** Unknown kinds read as a safe generic phrase, never the raw code. */
export function hostAdLedgerLabel(kind: string | null | undefined): string {
  return LEDGER_LABELS[String(kind ?? "").trim().toLowerCase()] ??
    "Ads credit change";
}

const SINGULAR_RESULTS: Record<string, string> = {
  "ticket sales": "sale",
  RSVPs: "RSVP",
  "sign-ups": "sign-up",
  bookings: "booking",
  "page visits": "visit",
};

/**
 * "How we count results" lines: each result once, in order ("We count
 * RSVPs, then page visits."), and the result Mingla always counts.
 */
export function hostAdCountingLines(hierarchy: readonly unknown[]): {
  counts: string;
  sharing: string;
} {
  const labels = [...new Set(hierarchy.map((value) => hostAdResultLabel(String(value))))]
    .filter(Boolean);
  const first = labels[0] ?? "results";
  const singular = SINGULAR_RESULTS[first] ?? "result";
  return {
    counts: labels.length > 0
      ? `We count ${labels.join(", then ")}.`
      : "We count the results Mingla can see.",
    sharing: `We only share results with ad apps when people agree to it. Your results in Mingla still count every ${singular}.`,
  };
}

const TIMELINE_LABELS: Record<string, string> = {
  create: "Ad set up",
  launch: "Ad started",
  pause: "Ad paused",
  resume: "Ad restarted",
  end: "Ad ended",
  cancel: "Ad cancelled",
  hold: "Money set aside",
  release: "Money returned",
  top_up: "Credit added",
  withdraw: "Credit withdrawn",
  campaign_spend: "Set aside for an ad",
  unspend_return: "Returned to credit",
  spend: "Ad spend",
  refund: "Money returned",
};

export function hostAdEventLabel(action: string | null | undefined): string {
  const key = String(action ?? "").trim().toLowerCase();
  return TIMELINE_LABELS[key] ?? humanize(key);
}

const VERDICT_LABELS: Record<string, string> = {
  exact: "Matches who you picked",
  broader: "Will reach a wider group",
  unavailable: "Needs a change",
  check_required: "Needs a change",
};

export function hostAdVerdictLabel(verdict: string): string {
  return VERDICT_LABELS[verdict] ?? humanize(verdict);
}

/**
 * Turns one targeting note from the ad builder check into a plain sentence
 * that names the app and says what to do. Unknown notes fall back to a safe
 * sentence for the verdict instead of showing raw technical text.
 */
export function hostAdTargetingNote(
  platform: string,
  verdict: string,
  line: string,
  countries: readonly string[] = [],
): string {
  const app = platformName(platform);
  const missing = /for: (.+?)\.?$/.exec(line)?.[1];
  if (/^Resolve .+ for: /.test(line) && missing) {
    return `${app} couldn't find ${hostAdPlaceList(missing)}. Remove it, or turn ${app} off.`;
  }
  if (/radius targeting needs at least one verified/i.test(line)) {
    return `${app} needs a city before it can use a distance. Add a city or turn ${app} off.`;
  }
  if (/cannot preserve city targeting/i.test(line)) {
    return `${app} can't target cities, so it will show your ad across ${
      countries.length > 0
        ? hostAdPlaceList(countries.join(", "))
        : "your whole country list"
    }. Accept that or turn ${app} off.`;
  }
  if (/radius/i.test(line)) {
    return `${app} can't use your exact distance, so it will show your ad across the whole city area. Accept that or turn ${app} off.`;
  }
  if (/age/i.test(line)) {
    return `${app} uses its own age groups, so a few people just outside your ages may see your ad.`;
  }
  if (/gender/i.test(line)) {
    return `${app} may show your ad to people of any gender.`;
  }
  if (/interest/i.test(line)) {
    return `${app} treats your interests as a guide, not a strict rule.`;
  }
  if (verdict === "broader") {
    return `${app} will show your ad to a wider group than you picked. Accept that or turn ${app} off.`;
  }
  if (verdict === "unavailable" || verdict === "check_required") {
    return `${app} can't run this audience yet. Change your places or interests, or turn ${app} off.`;
  }
  return `${app} is set up for the people you picked.`;
}

/** "About 1,000–2,000 people could see it on TikTok", or a plain fallback. */
export function hostAdReachLine(
  platform: string,
  estimate:
    | { state?: string; lower_bound?: number | null; upper_bound?: number | null }
    | null
    | undefined,
): string {
  const app = platformName(platform);
  if (
    estimate?.state === "available" &&
    Number.isFinite(estimate.lower_bound) &&
    Number.isFinite(estimate.upper_bound)
  ) {
    return `About ${Number(estimate.lower_bound).toLocaleString()}–${Number(
      estimate.upper_bound,
    ).toLocaleString()} people could see it on ${app}.`;
  }
  return `${app} didn't give us a reach number yet. Your ad can still run.`;
}

type CodedError = { code?: unknown; detail?: unknown; message?: unknown };

const ERROR_COPY: { match: RegExp; text: string }[] = [
  {
    match: /^network$/,
    text: "We couldn't reach Mingla. Check your connection and try again.",
  },
  // #4238: every audience_* refusal from ad-plan, create and Ari. These come
  // first so a plan_conflict that names an audience reads as an audience.
  {
    match: /audience_country_mismatch/,
    text: "\"People like your guests\" can only run in its own country. Pick just that country, or remove that audience.",
  },
  {
    match: /audience_binding_mismatch|audience_binding_unverified/,
    text: "One of your audiences changed after you checked your ad. Go back to the review step and check it again.",
  },
  {
    match: /audience_not_owned|audience_not_found/,
    text: "One of the audiences you picked isn't available for this brand. Remove it and try again.",
  },
  {
    match: /audience_selection_invalid|audience_intent_invalid/,
    text: "Something about the people you picked didn't work. Check who should see it and try again.",
  },
  {
    match: /audience_[a-z_]+/,
    text: "One of the audiences you picked can't be used right now. Remove it, or try again later.",
  },
  {
    match: /forbidden|permission_denied/,
    text: "Your role on this brand can't do that. Ask the brand owner for access.",
  },
  {
    match: /currency_authority/,
    text: "We can't confirm your brand's payout currency right now, so you can't add money or start ads for the moment. Check your payout setup, then try again.",
  },
  {
    match: /staff_review/,
    text: "Mingla is still checking your ad. We'll let you know when it's approved.",
  },
  {
    match: /draft_conflict/,
    text: "This ad was changed somewhere else. Reopen it to see the latest version.",
  },
  {
    match: /plan_version_stale|plan_version_hash_mismatch|plan_conflict/,
    text: "This ad changed since you last looked. Go back to the review step and check it again.",
  },
  {
    match: /budget_below_minimum/,
    text: "Your daily budget is too low for one of the apps. Raise the daily budget or turn that app off.",
  },
  {
    match: /purchase_signal_below_minimum|pixel_no_signal|pixel_missing|optimization_sales_unsupported/,
    text: "One of the apps hasn't seen enough ticket sales yet. Choose \"Visits to your page\" instead.",
  },
  {
    match: /_not_connected/,
    text: "One of the apps isn't ready for ads right now. Turn it off or try again later.",
  },
  {
    match: /insufficient|balance/,
    text: "You don't have enough Ads credit for this budget. Add credit or lower the budget.",
  },
  {
    match: /destination|not_public|page_not/,
    text: "The page you're promoting isn't public right now. Publish it again, then try.",
  },
  {
    match: /creative|video/,
    text: "Your ad video isn't ready. Pick a ready video and try again.",
  },
];

const FALLBACK_ERROR =
  "That didn't work just now. Try again in a minute, or contact Mingla support if it keeps happening.";

/**
 * #4238: transport and SDK text ("Edge Function returned a non-2xx status
 * code", "Failed to fetch") is never a sentence for a Host.
 */
const HOST_AD_TECHNICAL_TEXT =
  /edge function|non-2xx|status code|\bhttps?\b|\bfetch\b|\bjson\b|\brequest failed\b|\bnetwork request\b|\bundefined\b|\bnull\b|\bexception\b|\bstack\b|\btrace\b|\bsupabase\b/i;

/** A plain sentence for any error the Host ad screens can hit. */
export function hostAdErrorMessage(cause: unknown, fallback = FALLBACK_ERROR): string {
  const coded = (cause !== null && typeof cause === "object" ? cause : {}) as CodedError;
  // Match server codes only: a detail with spaces is a sentence, not a code.
  const haystack = [coded.code, coded.detail]
    .filter((part): part is string => typeof part === "string" && !/\s/.test(part.trim()))
    .join(" ")
    .toLowerCase();
  for (const entry of ERROR_COPY) {
    if (entry.match.test(haystack)) return entry.text;
  }
  // A sentence the app wrote itself (e.g. "Add a campaign name.") is shown as
  // is when it is already plain; raw codes and technical text never are.
  const message = typeof coded.message === "string" ? coded.message.trim() : "";
  if (
    /\s/.test(message) &&
    !/[_{}]|[a-z][A-Z]/.test(message) &&
    !HOST_AD_TECHNICAL_TEXT.test(message) &&
    hostAdCopyIsPlain(message)
  ) {
    return message;
  }
  return fallback;
}

// ── #4238 wave 2: audiences ─────────────────────────────────────────────────

export const HOST_AD_AUDIENCE_COPY = {
  title: "Reach people you know",
  helper:
    "Show this ad to people who already know you, or people like them. You'll only see rough sizes, never names.",
  empty:
    "Once you've had guests or added contacts, you can show ads to them here.",
  error:
    "We couldn't load your audiences. You can still run this ad to everyone in the places you picked.",
  limit: "You can pick up to 3.",
  notReadyAnywhere: "Not ready on any app you picked yet.",
} as const;

/** Apps that build lookalikes. Google has none, so it never gets a line. */
export const HOST_AD_LOOKALIKE_PLATFORMS: readonly string[] = ["meta", "snapchat", "tiktok", "reddit"];

/**
 * #4238: a lookalike runs only when its one country is the only country
 * picked (the server refuses anything else with audience_country_mismatch).
 */
export function hostAdLookalikeCountryReason(
  audience: { kind: "list" | "lookalike"; lookalikeCountry: string | null },
  countries: readonly string[],
): string | null {
  if (audience.kind !== "lookalike" || !audience.lookalikeCountry) return null;
  const picked = countries.map((code) => code.trim().toUpperCase());
  if (picked.length === 1 && picked[0] === audience.lookalikeCountry.toUpperCase()) {
    return null;
  }
  return `Runs only when ${countryWord(audience.lookalikeCountry)} is the one country you picked.`;
}

/** The Host-facing name; a lookalike names its country in full. */
export function hostAdAudienceName(audience: {
  name: string;
  kind: "list" | "lookalike";
  lookalikeCountry: string | null;
}): string {
  if (audience.kind === "lookalike" && audience.lookalikeCountry) {
    return `People like your guests in ${countryWord(audience.lookalikeCountry)}`;
  }
  return audience.name || "Your audience";
}

/**
 * "About 250 people", "Fewer than 10 people", "No people yet" or "Building
 * now". A lookalike has no size of its own (each app builds it), so it reads
 * "Built by {apps}" for the apps where it is ready, or nothing at all.
 */
export function hostAdAudienceSize(audience: {
  kind?: "list" | "lookalike";
  approxSize: number | null;
  platforms: readonly { platform?: string; state: string }[];
}): string | null {
  if (audience.kind === "lookalike") {
    const ready = audience.platforms
      .filter((p) => p.state === "ready" && typeof p.platform === "string")
      .map((p) => String(p.platform))
      .filter((platform) => HOST_AD_LOOKALIKE_PLATFORMS.includes(platform));
    return ready.length > 0 ? `Built by ${platformNames(ready)}` : null;
  }
  if (audience.approxSize === 0) return "No people yet";
  const building =
    audience.platforms.length > 0 &&
    audience.platforms.every((p) => p.state === "pending" || p.state === "syncing");
  if (audience.approxSize === null || building) return "Building now";
  if (audience.approxSize < 10) return "Fewer than 10 people";
  return `About ${audience.approxSize.toLocaleString("en-US")} people`;
}

/** One plain line per selected app. */
export function hostAdAudienceStatusLine(
  platform: string,
  state: string | null,
  neededCount: number | null,
): string {
  const app = platformName(platform);
  switch (state) {
    case "ready":
      return `${app}: Ready`;
    case "below_minimum":
      return neededCount !== null && neededCount > 0
        ? `${app}: Not enough people yet: ${neededCount.toLocaleString("en-US")} more needed`
        : `${app}: Not enough people yet`;
    case "too_small":
      return `${app}: Not enough people yet`;
    case "ineligible":
      return `Not eligible on ${app} yet`;
    case "pending":
    case "syncing":
    case "terms_required":
    case null:
      return `Getting ready on ${app}`;
    default:
      return `Not available on ${app}`;
  }
}

// ── #4238 wave 2: results charts ────────────────────────────────────────────

export const HOST_AD_RESULTS_COPY = {
  noSpend: "Your ad hasn't spent anything yet. Charts appear after its first day.",
  usdOnly: "Spend shown in US dollars, the currency the ad apps bill in.",
  chartError: "We couldn't load the chart. Your totals above are still right.",
  visitsNote: "Page visits are counted when people land on your page from this ad.",
  whereFrom: "Where results came from",
  /** Explains the chart's "98%" mark (#4238 wave 2 rework). */
  pauseNote: "Dashed line: your budget. 98%: we pause your ad when 98% of the budget is spent.",
} as const;

/** "No ticket sales counted yet. We count them when people buy on Mingla…" */
export function hostAdNoResultsLine(resultLabel: string): string {
  const label = hostAdResultLabel(resultLabel);
  if (label === "ticket sales") {
    return "No ticket sales counted yet. We count them when people buy on Mingla after seeing this ad.";
  }
  return `No ${label} counted yet. We count them when people act on Mingla after seeing this ad.`;
}
