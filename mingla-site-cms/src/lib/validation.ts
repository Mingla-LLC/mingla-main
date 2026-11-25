import { actionHrefProblem, isIanaTimeZone, isRegionCityTimeZone, offersBookingOrPayment } from "../contracts/generated/safety.ts";
const FORBIDDEN_TEXT = /<(?:script|style|iframe|svg)|\son[a-z]+\s*=|javascript:|data:|blob:|file:/i;
const HEX = /^#[0-9a-f]{6}$/i;
// #3149 wave 4 — `reservations` links straight into Mingla's own booking
// flow, which already owns the policy, the attribution and the bookings.
export const PAGE_ROLES = ["home", "about", "menu", "gallery", "contact", "reservations"] as const;
export const MEDIA_STATES = ["UPLOADING", "QUARANTINED", "PROCESSING", "READY", "REJECTED", "RETRYABLE_FAILED", "TOMBSTONED"] as const;
export function safeText(value: unknown, max: number): true | string { return typeof value === "string" && value.length <= max && !FORBIDDEN_TEXT.test(value) ? true : "Use plain text without code or embedded markup."; }
export function safeUrl(value: unknown): true | string {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001F]/.test(value)) return "Enter a safe link.";
  if (value.startsWith("/")) return value.startsWith("//") ? "Enter a safe relative link." : true;
  try { const url = new URL(value); return !url.username && !url.password && ["https:", "mailto:", "tel:"].includes(url.protocol) ? true : "Only secure web, email, or telephone links are allowed."; } catch { return "Enter a valid link."; }
}
/*
 * #4453 PR 2 (booking lock) — a BOOKING button link. Bookings and payments on
 * a Mingla site go through Mingla, so a booking button may only open a page
 * of this site, a Mingla page (host.usemingla.com /t/, /e/, /exp/, /b/,
 * /checkout/), or an email or phone link. Which brand the Mingla page belongs
 * to is checked at publish, where Core names the brand (OUTBOUND_ACTION_LINK).
 */
export const ACTION_LINK_MESSAGE =
  "This button points outside Mingla. Bookings and payments on your site go through Mingla. Use a page of your site or one of your Mingla pages.";
export function safeActionUrl(value: unknown): true | string {
  if (value == null || value === "") return true;
  const safe = safeUrl(value);
  if (safe !== true) return safe;
  return actionHrefProblem(value, null, "booking") === null ? true : ACTION_LINK_MESSAGE;
}

export const BOOKING_SITE_MESSAGE =
  "That site takes bookings or payments. Bookings and payments on your site go through Mingla. Use one of your Mingla pages.";
export const INFO_LINK_MESSAGE =
  "A button can link to your pages, your Mingla pages, a map, your social profiles, a file on your site, or your own WhatsApp, email or phone.";

export const OWNER_CTA_LINK_MESSAGE =
  "Use another page on this site, or paste a secure Mingla brand or event link from host.usemingla.com/b/ or host.usemingla.com/e/.";

/**
 * #4572 — the small owner editor deliberately offers a narrower link surface
 * than Studio: a page of this site, or a Mingla brand/event page. It never
 * turns an arbitrary outside address into a button.
 */
export function safeOwnerCtaUrl(value: unknown): true | string {
  if (value == null || value === "") return true;
  const safe = safeUrl(value);
  if (safe !== true || typeof value !== "string" || value === "/") {
    return OWNER_CTA_LINK_MESSAGE;
  }
  if (value.startsWith("/")) {
    // URL parsers normalize backslashes in special URLs, so `/\\evil.com`
    // must not slip through as an apparently relative owner link. Dot paths,
    // encoded dot segments and a query/hash on `/` also normalize to the dead
    // home target. A query/hash on a real page remains valid.
    const rawPath = value.split(/[?#]/, 1)[0];
    const normalizedPath = new URL(value, "https://site.invalid").pathname;
    return !value.includes("\\") &&
      normalizedPath !== "/" &&
      normalizedPath === rawPath &&
      actionHrefProblem(value, null, "booking") === null
      ? true
      : OWNER_CTA_LINK_MESSAGE;
  }
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const [root] = parts;
    return url.protocol === "https:" &&
      url.hostname === "host.usemingla.com" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      (root === "b" || root === "e") &&
      parts.length >= 2 &&
      actionHrefProblem(value, null, "booking") === null
      ? true
      : OWNER_CTA_LINK_MESSAGE;
  } catch {
    return OWNER_CTA_LINK_MESSAGE;
  }
}

/*
 * #4453 PR 2 rework — any other button: a booking action when its label
 * (`labelField` beside it) reads as booking or paying, else informational
 * (maps, socials, the site's own files and WhatsApp may stay). A third-party
 * booking site is refused either way.
 */
export function buttonUrl(labelField: string) {
  return (value: unknown, options?: { siblingData?: Record<string, unknown> }): true | string => {
    if (value == null || value === "") return true;
    const safe = safeUrl(value);
    if (safe !== true) return safe;
    const booking = offersBookingOrPayment(options?.siblingData?.[labelField]);
    const problem = actionHrefProblem(value, null, booking ? "booking" : "informational");
    if (problem === null) return true;
    return problem === "booking_site" ? BOOKING_SITE_MESSAGE : booking ? ACTION_LINK_MESSAGE : INFO_LINK_MESSAGE;
  };
}
export function boundedColor(value: unknown): true | string { return value == null || value === "" || (typeof value === "string" && HEX.test(value)) ? true : "Use a six-digit color value."; }
/*
 * #3149 wave 4 / #4453 — timezone validators built on the ONE rule in
 * packages/site-contracts/src/safety.ts (generated copy). The runtime is the
 * authority and refuses the publish; these are the messages the editor sees
 * first.
 *
 * `safeTimeZone` accepts Region/City zones plus UTC and GMT (offerings,
 * routes, settings). `safeCityTimeZone` is for the venue clock ("open now,
 * 22:03 in Lagos"), which needs a real city, so a bare UTC is refused.
 */
export function safeTimeZone(value: unknown): true | string {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 60) return "Enter a timezone name.";
  if (isIanaTimeZone(value)) return true;
  const text: string = value;
  return text.includes("/") || text === "UTC" || text === "GMT"
    ? "That timezone is not one this system knows."
    : "Use a region and city, for example Africa/Lagos, or UTC.";
}
export function safeCityTimeZone(value: unknown): true | string {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 60) return "Enter a timezone name.";
  if (isRegionCityTimeZone(value)) return true;
  const text: string = value;
  return text.includes("/")
    ? "That timezone is not one this system knows."
    : "Use a region and city, for example Africa/Lagos.";
}
