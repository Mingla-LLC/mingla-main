/**
 * #4420 (round-3 item 12) — a time zone is never shown as its IANA slug
 * ("America/New_York"). Hosts see the city and the offset in force now:
 * "New York (GMT-5)". `UTC` stays "UTC". Pure.
 */
import { formatTimezoneOffset } from "../../utils/timezones";

export function venueTimezoneLabel(tz: string, at: Date = new Date()): string {
  const trimmed = tz.trim();
  if (trimmed.length === 0) return "";
  if (trimmed === "UTC" || trimmed === "Etc/UTC") return "UTC";
  const city = (trimmed.split("/").pop() ?? trimmed).replace(/_/g, " ");
  const offset = formatTimezoneOffset(trimmed, at);
  return offset.length > 0 ? `${city} (${offset})` : city;
}
