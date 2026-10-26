// Issue #4130 (Wave 4a) — the Dashboard's one server read, Inbound leads, the
// Hosts and creators chips and bulk due-date reset, and the Notifications
// inbox. Every function returns the server's data or throws the server's
// error; no failure is turned into an empty answer here.
import { supabase } from "../lib/supabase";

async function rpc(name, args = {}) {
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

/** Owner/admin. Sign-ups, paid tickets, hosts with a next event, support, inbound. */
export const getDashboardSummary = (today) => rpc("admin_dashboard_summary", { p_today: today || null });

/** Beta leads and WEB tool leads (never app runs). Test rows only when asked. */
export const listInboundLeads = (showTest = false) =>
  rpc("admin_inbound_leads", { p_show_test: !!showTest, p_limit: 500 });

/** One web tool lead's details (admin): the email Add to Hosts carries over. */
export const getToolLead = (id) => rpc("admin_tool_lead_get", { p_id: id });

/** Funnel and due chips over every Hosts and Creators card. */
export const getOutreachSummary = (today) => rpc("outreach_summary", { p_today: today || null });

/** Owner/admin, a person: set a new due date on the listed stale cards. */
export const resetStaleDue = (pipeline, recordIds, newDue, today) =>
  rpc("outreach_reset_stale_due", {
    p_pipeline: pipeline,
    p_record_ids: recordIds,
    p_new_due: newDue,
    p_today: today,
  });

/** The signed-in teammate's inbox: mentions, Work updates and support alerts. */
export const getInbox = (alertTypes) => rpc("team_inbox", { p_alert_types: alertTypes, p_limit: 100 });

/** Mark read: "all", "mentions", "work_updates" or "support". */
export const markInboxRead = (scope, alertTypes) =>
  rpc("team_inbox_mark_read", { p_scope: scope, p_alert_types: alertTypes });

/** The Calendar's event runway in each event's own time, test brands marked. */
export const getCalendarRunway = (from, to, today) =>
  rpc("calendar_runway", { p_from: from || null, p_to: to || null, p_today: today || null });
