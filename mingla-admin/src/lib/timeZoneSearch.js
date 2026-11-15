// #4339 — the searchable time zone picker (components/ui/TimeZoneCombobox.jsx):
// which zones it offers, how a query matches them, and how each one reads.
//
// Pure module: no React, no Supabase, so plain node tests can load it.
// The zones are the ones both this browser and the database know
// (timeZoneOptions / isValidTimeZone in scheduleTime.js, one source), with
// Mingla cities and common zones (COMMON_ZONES) first.

import { COMMON_ZONES, isValidTimeZone, timeZoneOptions } from "./scheduleTime.js";

/** How many zones outside the common ones a search shows at once. */
export const TIME_ZONE_REST_LIMIT = 60;

// The country a zone is searched by. IANA ids name a city, not a country, so
// the zones people are likely to pick carry their country here; every other
// zone is still found by its city or id.
const ZONE_COUNTRY = Object.freeze({
  "Africa/Lagos": "Nigeria",
  "Africa/Accra": "Ghana",
  "Africa/Abidjan": "Côte d'Ivoire",
  "Africa/Cairo": "Egypt",
  "Africa/Casablanca": "Morocco",
  "Africa/Johannesburg": "South Africa",
  "Africa/Nairobi": "Kenya",
  "Africa/Kigali": "Rwanda",
  "Africa/Dakar": "Senegal",
  "America/New_York": "United States (Eastern)",
  "America/Chicago": "United States (Central)",
  "America/Denver": "United States (Mountain)",
  "America/Phoenix": "United States (Arizona)",
  "America/Los_Angeles": "United States (Pacific)",
  "America/Anchorage": "United States (Alaska)",
  "Pacific/Honolulu": "United States (Hawaii)",
  "America/Toronto": "Canada (Eastern)",
  "America/Vancouver": "Canada (Pacific)",
  "America/Mexico_City": "Mexico",
  "America/Sao_Paulo": "Brazil",
  "America/Bogota": "Colombia",
  "America/Argentina/Buenos_Aires": "Argentina",
  "America/Buenos_Aires": "Argentina",
  "America/Jamaica": "Jamaica",
  "Europe/London": "United Kingdom",
  "Europe/Dublin": "Ireland",
  "Europe/Paris": "France",
  "Europe/Brussels": "Belgium",
  "Europe/Amsterdam": "Netherlands",
  "Europe/Berlin": "Germany",
  "Europe/Madrid": "Spain",
  "Europe/Lisbon": "Portugal",
  "Europe/Rome": "Italy",
  "Europe/Zurich": "Switzerland",
  "Europe/Stockholm": "Sweden",
  "Europe/Oslo": "Norway",
  "Europe/Copenhagen": "Denmark",
  "Europe/Helsinki": "Finland",
  "Europe/Warsaw": "Poland",
  "Europe/Athens": "Greece",
  "Europe/Istanbul": "Türkiye",
  "Asia/Dubai": "United Arab Emirates",
  "Asia/Kolkata": "India",
  "Asia/Calcutta": "India",
  "Asia/Singapore": "Singapore",
  "Asia/Tokyo": "Japan",
  "Asia/Shanghai": "China",
  "Asia/Hong_Kong": "Hong Kong",
  "Australia/Sydney": "Australia (Sydney)",
  "Pacific/Auckland": "New Zealand",
  UTC: "Coordinated Universal Time",
});

/** The zone's city in words: "Africa/Lagos" -> "Lagos", "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function zoneCity(zone) {
  if (zone === "UTC") return "UTC";
  return String(zone || "").split("/").pop().replace(/_/g, " ");
}

// Today's city names for zones whose IANA (and browser) id still uses the old
// one, so "Kolkata" or "Kyiv" finds them (tester P3-2).
const ZONE_ALIASES = Object.freeze({
  "Asia/Calcutta": "Kolkata",
  "Asia/Kolkata": "Kolkata",
  "Europe/Kiev": "Kyiv",
  "Europe/Kyiv": "Kyiv",
  "Asia/Saigon": "Ho Chi Minh City",
  "Asia/Ho_Chi_Minh": "Ho Chi Minh City",
  "Asia/Rangoon": "Yangon",
  "Asia/Yangon": "Yangon",
  "America/Godthab": "Nuuk",
  "America/Nuuk": "Nuuk",
  "Asia/Katmandu": "Kathmandu",
  "Asia/Kathmandu": "Kathmandu",
});

/** The current city name for a zone whose id uses an old one, or "". */
export function zoneAlias(zone) {
  return Object.hasOwn(ZONE_ALIASES, zone) ? ZONE_ALIASES[zone] : "";
}

/** The country a zone is searched by, or "" when none is listed. */
export function zoneCountry(zone) {
  return Object.hasOwn(ZONE_COUNTRY, zone) ? ZONE_COUNTRY[zone] : "";
}

/** The zone's offset from GMT at an instant: "GMT+1", "GMT-5", "GMT+5:30", or "GMT". */
export function zoneOffset(zone, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(at);
    return parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  } catch {
    return "";
  }
}

/** The zone's wall clock at an instant: "14:05". */
export function zoneClock(zone, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  } catch {
    return "";
  }
}

/** What the closed picker shows for the chosen zone: "Lagos — Africa/Lagos (GMT+1)". */
export function zoneLabel(zone, at = new Date()) {
  if (!zone) return "";
  const offset = zoneOffset(zone, at);
  return `${zoneAlias(zone) || zoneCity(zone)} — ${zone}${offset ? ` (${offset})` : ""}`;
}

const OFFSET_QUERY = /^(?:gmt|utc)?\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?$/i;

// "utc+1", "GMT +1", "+1", "-05:00" -> "GMT+1" / "GMT-5" / "GMT+5:30" (null when not an offset).
function offsetFromQuery(query) {
  const match = OFFSET_QUERY.exec(query.trim());
  if (!match) return null;
  const sign = match[1] === "+" ? "+" : "-";
  const hours = Number(match[2]);
  const minutes = match[3] && match[3] !== "00" ? `:${match[3]}` : "";
  return hours === 0 && !minutes ? "GMT" : `GMT${sign}${hours}${minutes}`;
}

/** True when the zone matches what was typed: its city, id, country or offset ("GMT+1"). */
export function zoneMatches(zone, query, at = new Date()) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const offset = offsetFromQuery(q);
  if (offset) return zoneOffset(zone, at) === offset;
  if (q === "gmt" || q === "utc") return zoneOffset(zone, at) === "GMT";
  return zoneNameMatches(zone, q)
    || zone.toLowerCase().includes(q)
    || zone.toLowerCase().replace(/_/g, " ").includes(q);
}

// The strong match: the city, its current name or its country (ranked first).
function zoneNameMatches(zone, q) {
  return zoneCity(zone).toLowerCase().includes(q)
    || zoneAlias(zone).toLowerCase().includes(q)
    || zoneCountry(zone).toLowerCase().includes(q);
}

/**
 * The picker's choices for a query, as two groups: the common zones (Mingla
 * cities first) and every other zone, capped at TIME_ZONE_REST_LIMIT. `zones`
 * defaults to every zone the browser and the database both know.
 */
export function searchTimeZones(query, { zones = timeZoneOptions(), at = new Date(), limit = TIME_ZONE_REST_LIMIT } = {}) {
  const common = COMMON_ZONES.filter((zone) => isValidTimeZone(zone) && zoneMatches(zone, query, at));
  const commonSet = new Set(COMMON_ZONES);
  const q = String(query || "").trim().toLowerCase();
  const matched = zones.filter((zone) => !commonSet.has(zone) && zoneMatches(zone, query, at));
  // Country and current-name matches first, then city, then zone id only
  // ("India" lists Kolkata before the Indiana zones, tester P3-2).
  const tier = (zone) => {
    if (!q) return 0;
    if (zoneCountry(zone).toLowerCase().includes(q) || zoneAlias(zone).toLowerCase().includes(q)) return 0;
    return zoneCity(zone).toLowerCase().includes(q) ? 1 : 2;
  };
  // Stable sort: the zones keep their order inside each tier.
  const rest = matched.map((zone, index) => ({ zone, index, rank: tier(zone) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.zone)
    .slice(0, limit);
  return { common, rest, more: Math.max(0, matched.length - rest.length) };
}

/**
 * A text split around the first case-insensitive match of the query, for
 * highlighting: [{ text, match }]. No query, or no match, is one plain part.
 */
export function highlightParts(text, query) {
  const value = String(text ?? "");
  const q = String(query || "").trim().toLowerCase();
  const at = q ? value.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [{ text: value, match: false }];
  return [
    { text: value.slice(0, at), match: false },
    { text: value.slice(at, at + q.length), match: true },
    { text: value.slice(at + q.length), match: false },
  ].filter((part) => part.text);
}

/**
 * The combobox's keyboard rules (WAI-ARIA 1.2 combobox, listbox popup), as a
 * pure step: given whether the list is open, the highlighted option (-1 for
 * none) and how many options there are, what a key does. ArrowDown / ArrowUp
 * open the list and move (wrapping), Enter picks the highlighted option (or
 * the only one), Escape closes, Tab closes and lets focus move on.
 * Returns { open, active, pick (an option index or null), handled }.
 */
export function comboboxKeyStep({ open, active, count }, key) {
  const none = { open, active, pick: null, handled: false };
  switch (key) {
    case "ArrowDown":
      if (!count) return { open: true, active: -1, pick: null, handled: true };
      return { open: true, active: open ? (active + 1) % count : 0, pick: null, handled: true };
    case "ArrowUp":
      if (!count) return { open: true, active: -1, pick: null, handled: true };
      return { open: true, active: !open || active <= 0 ? count - 1 : active - 1, pick: null, handled: true };
    case "Enter":
      if (!open) return none;
      if (active >= 0 && active < count) return { open: false, active: -1, pick: active, handled: true };
      if (count === 1) return { open: false, active: -1, pick: 0, handled: true };
      return { open, active, pick: null, handled: true };
    case "Escape":
      return open ? { open: false, active: -1, pick: null, handled: true } : none;
    case "Tab":
      return open ? { open: false, active: -1, pick: null, handled: false } : none;
    default:
      return none;
  }
}
