// #4339 §6 — the booker's context: what they run (ICP), their main social as a
// working profile link, and their website.
//
// ZERO IMPORTS, BY CONTRACT (the same rule as bookingDetails.ts): the Deno suites
// run with `--allow-read` only, no network and no environment priming.
//
// The marketing page validates the same way in the browser
// (mingla-marketing/lib/booking-social.ts). The two are kept in step by one
// shared fixture table, asserted on both sides; the server is the authority.
//
// Rules (Seth, 8 Nov 2026, round 3 point 2):
//   - ICP and social are REQUIRED on every booking. The only caller of `book` is
//     the /schedule page, and every funnel (the four free tools, the landing
//     pages, Help, the nav) reaches it through that page.
//   - The handle: a leading @ is stripped, no spaces, only the characters that
//     platform allows. A pasted full profile URL is kept as typed, but only from
//     that platform's own domain.
//   - The profile URL is built from platform + handle:
//       instagram.com/<h>, tiktok.com/@<h>, facebook.com/<h>, x.com/<h>,
//       youtube.com/@<h>, linkedin.com/in/<h>.
//   - Website is optional; when given it must be a public http(s) address.

export const ICP_VALUES = [
  "events",
  "trips",
  "experiences",
  "restaurants",
  "hotels",
  "art",
  "play",
  "other",
] as const;
export type BookingIcp = (typeof ICP_VALUES)[number];

/** How each ICP reads on the invite and in the notification (the page's labels). */
export const ICP_LABELS: Readonly<Record<BookingIcp, string>> = {
  events: "Events",
  trips: "Trips",
  experiences: "Experiences or classes",
  restaurants: "A restaurant, café or diner",
  hotels: "A hotel or resort",
  art: "A gallery, museum or art space",
  play: "A play space, bowling or arcade",
  other: "Something else",
};

export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "facebook",
  "x",
  "youtube",
  "linkedin",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Readonly<Record<SocialPlatform, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

interface PlatformRule {
  /** The whole handle, after the leading @ is stripped. */
  handle: RegExp;
  /** The domains a pasted profile URL may come from (lower case, no www.). */
  domains: readonly string[];
  /** The profile URL built from a handle. */
  profile: (handle: string) => string;
}

const RULES: Readonly<Record<SocialPlatform, PlatformRule>> = {
  // Letters, numbers, periods and underscores, up to 30.
  instagram: {
    handle: /^[A-Za-z0-9._]{1,30}$/,
    domains: ["instagram.com"],
    profile: (h) => `https://instagram.com/${h}`,
  },
  // Letters, numbers, periods and underscores, 2 to 24.
  tiktok: {
    handle: /^[A-Za-z0-9._]{2,24}$/,
    domains: ["tiktok.com"],
    profile: (h) => `https://tiktok.com/@${h}`,
  },
  // Letters, numbers and periods, up to 50.
  facebook: {
    handle: /^[A-Za-z0-9.]{1,50}$/,
    domains: ["facebook.com", "fb.com"],
    profile: (h) => `https://facebook.com/${h}`,
  },
  // Letters, numbers and underscores, up to 15.
  x: {
    handle: /^[A-Za-z0-9_]{1,15}$/,
    domains: ["x.com", "twitter.com"],
    profile: (h) => `https://x.com/${h}`,
  },
  // Letters, numbers, periods, underscores and hyphens, 3 to 30.
  youtube: {
    handle: /^[A-Za-z0-9._-]{3,30}$/,
    domains: ["youtube.com"],
    profile: (h) => `https://youtube.com/@${h}`,
  },
  // Letters, numbers and hyphens, 3 to 100.
  linkedin: {
    handle: /^[A-Za-z0-9-]{3,100}$/,
    domains: ["linkedin.com"],
    profile: (h) => `https://linkedin.com/in/${h}`,
  },
};

export const MAX_SOCIAL_INPUT = 300;
export const MAX_WEBSITE_INPUT = 300;

export function parseIcp(raw: unknown): BookingIcp | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return (ICP_VALUES as readonly string[]).includes(value)
    ? value as BookingIcp
    : null;
}

export function parseSocialPlatform(raw: unknown): SocialPlatform | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value)
    ? value as SocialPlatform
    : null;
}

export interface BookingSocial {
  platform: SocialPlatform;
  /** The handle as shown ("@name"), or the pasted URL when there was no handle to read. */
  display: string;
  /** A working https profile link. */
  url: string;
}

/** A pasted profile URL on the platform's own domain, kept as typed (https added when there was no scheme). */
function pastedProfileUrl(
  platform: SocialPlatform,
  value: string,
): string | null {
  const looksLikeUrl = /^https?:\/\//i.test(value) ||
    /^(?:www\.|m\.|mobile\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(value);
  if (!looksLikeUrl) return null;
  const typed = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, "");
  if (!RULES[platform].domains.includes(host)) return null;
  // A profile, not the site's front page.
  if (url.pathname.replace(/\/+$/, "") === "") return null;
  return typed;
}

/**
 * The booker's social, or null when it is missing or not valid for the platform.
 * Never throws: it is fed straight from a public request body.
 */
export function parseSocial(
  platformRaw: unknown,
  handleRaw: unknown,
): BookingSocial | null {
  const platform = parseSocialPlatform(platformRaw);
  if (platform === null || typeof handleRaw !== "string") return null;
  const value = handleRaw.trim();
  if (value === "" || value.length > MAX_SOCIAL_INPUT || /\s/.test(value)) {
    return null;
  }
  const pasted = pastedProfileUrl(platform, value);
  if (pasted !== null) return { platform, display: pasted, url: pasted };
  if (/[/:]/.test(value)) return null; // a URL from another site, or a broken one
  const handle = value.replace(/^@/, "");
  if (!RULES[platform].handle.test(handle)) return null;
  return {
    platform,
    display: `@${handle}`,
    url: RULES[platform].profile(handle),
  };
}

export type WebsiteResult = { ok: true; url: string | null } | { ok: false };

/**
 * The optional website. Empty is fine (null); anything else must be a public
 * http(s) address with a real host name ("yourplace.com" gains https://).
 */
export function parseWebsite(raw: unknown): WebsiteResult {
  if (raw === undefined || raw === null) return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim();
  if (value === "") return { ok: true, url: null };
  if (value.length > MAX_WEBSITE_INPUT || /\s/.test(value)) {
    return { ok: false };
  }
  const typed = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false };
  }
  if (url.username !== "" || url.password !== "") return { ok: false };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return { ok: false };
  if (!/[a-z]/i.test(url.hostname.split(".").pop() ?? "")) return { ok: false }; // no bare IPs
  return { ok: true, url: typed };
}

export interface BookingContext {
  icp: BookingIcp;
  social: BookingSocial;
  website: string | null;
}

export type BookingContextResult =
  | { ok: true; context: BookingContext }
  | { ok: false; field: "icp" | "social" | "website" };

/** Validates the three new booking fields from a request body. */
export function parseBookingContext(
  body: Record<string, unknown>,
): BookingContextResult {
  const icp = parseIcp(body.icp);
  if (icp === null) return { ok: false, field: "icp" };
  const social = parseSocial(body.social_platform, body.social_handle);
  if (social === null) return { ok: false, field: "social" };
  const website = parseWebsite(body.website);
  if (!website.ok) return { ok: false, field: "website" };
  return { ok: true, context: { icp, social, website: website.url } };
}

/**
 * The lines at the TOP of the calendar invite description: the social link and
 * the website first (so the team can open them before the call), then what
 * they run. Every value here was validated above, so none can carry a line
 * break.
 */
export function buildContextLines(context: BookingContext): string[] {
  return [
    `Social: ${context.social.url} (${SOCIAL_LABELS[context.social.platform]})`,
    `Website: ${context.website ?? "none given"}`,
    `Runs: ${ICP_LABELS[context.icp]}`,
  ];
}

/** The calendar description: the context lines, then the #3601 description unchanged. */
export function buildBookingDescription(
  context: BookingContext,
  base: string,
): string {
  return [...buildContextLines(context), base].join("\n");
}

/**
 * The same facts as machine-readable private properties on the calendar event,
 * so the booking itself carries them (Google Calendar `extendedProperties`).
 */
export function buildPrivateProperties(
  context: BookingContext,
  source: string,
): Record<string, string> {
  return {
    mingla_icp: context.icp,
    mingla_social_platform: context.social.platform,
    mingla_social_url: context.social.url,
    mingla_website: context.website ?? "",
    mingla_source: source,
  };
}
