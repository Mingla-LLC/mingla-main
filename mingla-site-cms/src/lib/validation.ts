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
 * #3149 wave 4 — an IANA timezone, and only an IANA timezone.
 *
 * The live "open now, 22:03 in Lagos" line is the one moving claim a published
 * site makes, and it is built from this field alone. An offset ("+1") drifts
 * across a daylight-saving boundary and an abbreviation ("WAT") is not
 * something a clock can be constructed from, so both are refused here rather
 * than surfacing as a wrong hour on a real restaurant's real page.
 *
 * Two checks: the shape must be `Region/City`, and the platform must actually
 * KNOW the zone — `Intl` throws on one it cannot resolve, and a zone the
 * renderer cannot format would print this server's own time under a city's
 * name.
 *
 * Kept byte-identical in spirit to `isIanaTimeZone` in
 * `mingla-sites/src/contracts/artifact.ts`; the runtime is the authority and
 * refuses the publish, this is the message the editor sees first.
 */
export function safeTimeZone(value: unknown): true | string {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 60) return "Enter a timezone name.";
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(value)) {
    return "Use a region and city, for example Africa/Lagos.";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return "That timezone is not one this system knows.";
  }
}
