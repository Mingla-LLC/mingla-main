import { isIanaTimeZone, isRegionCityTimeZone } from "../contracts/generated/safety.ts";
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
