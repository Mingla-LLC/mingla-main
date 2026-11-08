// Issue #4130 (Wave 4a) — Inbound leads: beta leads and web free-tool leads
// in one list. Pure: no React, no Supabase.
//
// Issue #4339 round A — a third kind: every confirmed "Book a call" booking
// from usemingla.com/schedule (source `book_a_call`). Its row carries the ICP,
// the social as a working profile link, the website, the call time and where
// the booker came from; Add to Hosts puts the email and social on the card.
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

/**
 * The Hosts pipeline ICP for a booking's ICP (crm_records_icp_check); null
 * when none fits, so the card is made without one rather than with a guess.
 */
export const BOOKING_ICP_TO_HOST_ICP = Object.freeze({
  events: "event_organizer",
  trips: "trip_stay_host",
  experiences: "experience_host",
  restaurants: "restaurant_bar",
  hotels: "trip_stay_host",
  art: "venue_gallery",
  play: "venue_gallery",
  other: null,
});

/** Only a real https profile or http(s) site is ever rendered as a link. */
function safeLink(url, allowHttp) {
  if (typeof url !== "string") return null;
  const value = url.trim();
  return (allowHttp ? /^https?:\/\/[^\s]+$/i : /^https:\/\/[^\s]+$/i).test(value) ? value : null;
}

/** A booking row's details, or null for the other kinds. */
export function bookingView(booking) {
  if (!booking || typeof booking !== "object") return null;
  const platform = typeof booking.social_platform === "string" ? booking.social_platform : "";
  return {
    icp: BOOKING_ICP_LABELS[booking.icp] || null,
    socialLabel: SOCIAL_LABELS[platform] || "Social",
    socialHandle: typeof booking.social_handle === "string" && booking.social_handle.trim() ? booking.social_handle.trim() : null,
    socialUrl: safeLink(booking.social_url, false),
    website: safeLink(booking.website, true),
    callAt: typeof booking.call_at === "string" && !Number.isNaN(new Date(booking.call_at).getTime()) ? booking.call_at : null,
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
    source: SOURCE_LABELS[row.source] || "Lead",
    business: row.business || null,
    tool: row.source === "tool" ? TOOL_LABELS[row.tool] || "Free tool" : null,
    city: row.city || null,
    hasEmail: !!row.has_email,
    host: row.host && row.host.id ? row.host : null,
    isTest: !!row.is_test,
    booking: row.source === "book_a_call" ? bookingView(row.booking) : null,
    // A lead can go to Hosts once, and needs a business name to be a host.
    canAdd: !(row.host && row.host.id) && !!row.business,
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
 * duplicate check sees them), the booker as the contact, and the ICP.
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
  const icp = BOOKING_ICP_TO_HOST_ICP[detail?.icp] || null;
  if (icp) fields.icp = icp;
  return fields;
}
