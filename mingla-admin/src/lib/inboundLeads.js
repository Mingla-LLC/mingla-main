// Issue #4130 (Wave 4a) — Inbound leads: beta leads and web free-tool leads
// in one list. Pure: no React, no Supabase.
//
// Issue #4339 round A — a third kind: every confirmed "Book a call" booking
// from usemingla.com/schedule (source `book_a_call`). Its row carries the ICP,
// the social as a working profile link, the website, the call time and where
// the booker came from; Add to Hosts puts the email and social on the card.
//
// Issue #4339 Creators and Locals calls (Seth approved, 9 Nov): a booking has
// an audience. It reads "Host call", "Creator call" or "Local call", the list
// can be filtered by it, and only a Host call can be added to Hosts (a Creator
// or a Local is not a host).
//
// The server (admin_inbound_leads) already leaves out tool runs inside the
// Business app (product usage, not leads) and hides staff and test rows unless
// asked. This file owns the words and the "no new lead" warning.

import { INBOUND_QUIET_DAYS } from "./dashboardToday.js";

export const TOOL_LABELS = Object.freeze({
  venues: "Venue website grader",
  events: "Event turnout predictor",
  trips: "Quote any trip",
  experiences: "Undercharging audit",
});

export const SOURCE_LABELS = Object.freeze({ beta: "Beta form", tool: "Free tool", book_a_call: "Book a call" });

/** A booking's audience as Inbound leads names it. */
export const BOOKING_AUDIENCE_LABELS = Object.freeze({ host: "Host call", creator: "Creator call", local: "Local call" });
export const CREATOR_MAKES_LABELS = Object.freeze({ video: "Video", photo: "Photos", both: "Video and photos" });

/** The audience filter on Inbound leads ("" is every lead). */
export const LEAD_FILTERS = Object.freeze([
  { value: "", label: "All leads" },
  { value: "host", label: "Host calls" },
  { value: "creator", label: "Creator calls" },
  { value: "local", label: "Local calls" },
]);

/** A booking's audience; host when the row predates audiences. */
export function bookingAudience(booking) {
  const a = booking && typeof booking === "object" ? booking.audience : null;
  return Object.hasOwn(BOOKING_AUDIENCE_LABELS, a || "") ? a : "host";
}

/** The rows a filter keeps: every lead, or the bookings of one audience. */
export function filterLeads(rows, audience) {
  const list = Array.isArray(rows) ? rows : [];
  if (!audience) return list;
  return list.filter((row) => row && row.source === "book_a_call" && bookingAudience(row.booking) === audience);
}

/** What the booker runs, as the /schedule page asks it. */
export const BOOKING_ICP_LABELS = Object.freeze({
  events: "Events",
  trips: "Trips",
  experiences: "Experiences or classes",
  restaurants: "Restaurant, café or diner",
  hotels: "Hotel or resort",
  art: "Gallery, museum or art space",
  play: "Play space, bowling or arcade",
  other: "Something else",
});

export const SOCIAL_LABELS = Object.freeze({
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
});

/** Only a real https profile or http(s) site is ever rendered as a link. */
function safeLink(url, allowHttp) {
  if (typeof url !== "string") return null;
  const value = url.trim();
  return (allowHttp ? /^https?:\/\/[^\s]+$/i : /^https:\/\/[^\s]+$/i).test(value) ? value : null;
}

// #4339 calendar sync: what Google Calendar says happened to a booked call
// (growth-tools-calendar-sync). Unknown or missing reads as booked.
export const CALL_STATUS_LABELS = Object.freeze({ booked: "Booked", moved: "Moved", cancelled: "Cancelled", declined: "Declined" });

/** A call's status: booked, moved, cancelled or declined. */
export function callStatus(value) {
  return typeof value === "string" && Object.hasOwn(CALL_STATUS_LABELS, value) ? value : "booked";
}

/** An ISO instant, or null. */
function instant(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

/** A booking row's details, or null for the other kinds. */
export function bookingView(booking) {
  if (!booking || typeof booking !== "object") return null;
  const platform = typeof booking.social_platform === "string" ? booking.social_platform : "";
  const audience = bookingAudience(booking);
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    audience,
    label: BOOKING_AUDIENCE_LABELS[audience],
    icp: BOOKING_ICP_LABELS[booking.icp] || null,
    city: text(booking.city),
    makes: CREATOR_MAKES_LABELS[booking.creator_makes] || null,
    workUrl: safeLink(booking.work_url, true),
    firstPlace: text(booking.first_place),
    socialLabel: SOCIAL_LABELS[platform] || "Social",
    socialHandle: typeof booking.social_handle === "string" && booking.social_handle.trim() ? booking.social_handle.trim() : null,
    socialUrl: safeLink(booking.social_url, false),
    website: safeLink(booking.website, true),
    callAt: instant(booking.call_at),
    status: callStatus(booking.status),
    statusLabel: CALL_STATUS_LABELS[callStatus(booking.status)],
    statusChangedAt: instant(booking.status_changed_at),
    originalCallAt: callStatus(booking.status) === "moved" ? instant(booking.original_call_at) : null,
    cameFrom: typeof booking.source === "string" && booking.source.trim() ? booking.source.trim() : null,
  };
}

const DAY_MS = 86400000;

/** Whole days between a lead time and now, by the viewer's calendar. */
export function daysSince(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/**
 * The warning when leads stop coming: null while a lead arrived in the last
 * INBOUND_QUIET_DAYS days, else { days, lastAt } (days null = never).
 */
export function quietWarning(summary, now = new Date()) {
  if (!summary) return null;
  const lastAt = summary.last_lead_at || null;
  if (!lastAt) return { days: null, lastAt: null };
  const days = daysSince(lastAt, now);
  if (days == null || days < INBOUND_QUIET_DAYS) return null;
  return { days, lastAt };
}

/** What one row shows. */
export function leadView(row) {
  return {
    id: row.id,
    source: row.source === "book_a_call" ? BOOKING_AUDIENCE_LABELS[bookingAudience(row.booking)] : SOURCE_LABELS[row.source] || "Lead",
    business: row.business || null,
    tool: row.source === "tool" ? TOOL_LABELS[row.tool] || "Free tool" : null,
    city: row.city || null,
    hasEmail: !!row.has_email,
    host: row.host && row.host.id ? row.host : null,
    isTest: !!row.is_test,
    booking: row.source === "book_a_call" ? bookingView(row.booking) : null,
    // A lead can go to Hosts once, and needs a business name to be a host.
    // A Creator or Local call is not a host (#4339).
    canAdd: !(row.host && row.host.id) && !!row.business && !(row.source === "book_a_call" && bookingAudience(row.booking) !== "host"),
  };
}

/** The fields a web tool lead carries into a new host card. */
export function toolLeadHostFields(lead, detail) {
  const email = typeof detail?.email === "string" && detail.email.trim() ? detail.email.trim() : null;
  const fields = { name: lead.business, source: "inbound" };
  if (email) {
    // As a contact detail, so the pipeline's duplicate check sees it.
    fields.identifiers = [{ kind: "email", value: email }];
    fields.channel = "email";
  }
  return fields;
}

/**
 * The fields a Book a call booking carries into a new host card at Prospect:
 * the email and the social profile as contact details (so the pipeline's
 * duplicate check sees them), the booker as the contact, and the Hosts ICP
 * the server mapped the booking's ICP to.
 */
export function bookCallHostFields(lead, detail) {
  const fields = { name: lead.business, source: "inbound" };
  const identifiers = [];
  const email = typeof detail?.email === "string" && detail.email.trim() ? detail.email.trim() : null;
  if (email) identifiers.push({ kind: "email", value: email });
  const social = safeLink(detail?.social_url, false);
  if (social) {
    const platform = SOCIAL_LABELS[detail?.social_platform] ? detail.social_platform : null;
    identifiers.push(platform ? { kind: "handle", value: social, platform } : { kind: "handle", value: social });
  }
  if (identifiers.length) fields.identifiers = identifiers;
  if (email) fields.channel = "email";
  const contact = typeof detail?.name === "string" && detail.name.trim() ? detail.name.trim() : null;
  if (contact) fields.contact = contact;
  // The server names the Hosts ICP the booking files under (host_icp from
  // admin_book_call_lead_get), or none; the client never writes an ICP id
  // itself (#3802 C-8).
  const icp = typeof detail?.host_icp === "string" && detail.host_icp.trim() ? detail.host_icp.trim() : null;
  if (icp) fields.icp = icp;
  return fields;
}
