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
  results: "results",
};

const COST_PER_LABELS: Record<string, string> = {
  "ticket sales": "Cost per sale",
  "sign-ups": "Cost per sign-up",
  bookings: "Cost per booking",
  "page visits": "Cost per visit",
};

/** "Cost per sale", "Cost per visit", or "Cost per result". */
export function hostAdCostPerLabel(kind: string | null | undefined): string {
  return COST_PER_LABELS[hostAdResultLabel(kind)] ?? "Cost per result";
}

export function hostAdResultLabel(kind: string | null | undefined): string {
  const key = String(kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return RESULT_LABELS[key] ?? humanize(key).toLowerCase();
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
    hostAdCopyIsPlain(message)
  ) {
    return message;
  }
  return fallback;
}
