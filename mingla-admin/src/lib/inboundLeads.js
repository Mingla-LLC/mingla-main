// Issue #4130 (Wave 4a) — Inbound leads: beta leads and web free-tool leads
// in one list. Pure: no React, no Supabase.
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

export const SOURCE_LABELS = Object.freeze({ beta: "Beta form", tool: "Free tool" });

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
