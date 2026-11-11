// Issue #4383 — the Communications screens' server calls. Every call goes
// through a SECURITY DEFINER RPC that checks who is calling first; every
// failure throws a CommunicationsError carrying the server code (no silent
// catch, never an empty list on failure).
//
// Each function names its RPC in its own `supabase.rpc("…")` call, so the
// screen contract test (issue_3988_tab_capability_contract) can see it.

import { supabase } from "../lib/supabase";
import { CommunicationsError } from "../lib/communicationsErrors";

function unwrap({ data, error }) {
  if (error) throw new CommunicationsError(error);
  return data;
}

const list = (rows) => (Array.isArray(rows) ? rows : []);

// ── Push ─────────────────────────────────────────────────────────────────────

export async function getPushAudienceCounts() {
  return unwrap(await supabase.rpc("issue_4383_push_preview")) || { hosts: 0, explorers: 0, both: 0 };
}

export async function savePush({ id = null, title, body, audience, explorerTarget, hostTarget, scheduledFor = null, timezone, revision = null }) {
  return unwrap(await supabase.rpc("issue_4383_push_save", {
    p_id: id,
    p_title: title,
    p_body: body,
    p_audience: audience,
    p_explorer_target: explorerTarget,
    p_host_target: hostTarget,
    p_scheduled_for: scheduledFor,
    p_timezone: timezone,
    p_revision: revision,
  }));
}

export async function sendPushNow(id, revision) {
  return unwrap(await supabase.rpc("issue_4383_push_send_now", { p_id: id, p_revision: revision }));
}

export async function cancelPush(id) {
  return unwrap(await supabase.rpc("issue_4383_push_cancel", { p_id: id }));
}

export async function sendPushTestToMe(id) {
  return unwrap(await supabase.rpc("issue_4383_push_test_to_me", { p_id: id }));
}

export async function listPushes() {
  return list(unwrap(await supabase.rpc("issue_4383_push_list")));
}

export async function retryPushDelivery(campaignId) {
  return Number(unwrap(await supabase.rpc("issue_3720_admin_retry_announcement", { p_campaign_id: campaignId })) ?? 0);
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function scheduleAnnouncement(id, scheduledFor, timezone) {
  return unwrap(await supabase.rpc("issue_4383_announcement_schedule", { p_id: id, p_scheduled_for: scheduledFor, p_timezone: timezone }));
}

export async function unscheduleAnnouncement(id) {
  return unwrap(await supabase.rpc("issue_4383_announcement_unschedule", { p_id: id }));
}

// ── Roadmap ──────────────────────────────────────────────────────────────────

export async function scheduleRoadmapCard(cardId, goLiveAt, timezone) {
  return unwrap(await supabase.rpc("issue_4383_roadmap_schedule_card", { p_card_id: cardId, p_go_live_at: goLiveAt, p_timezone: timezone }));
}

export async function unscheduleRoadmapCard(cardId) {
  return unwrap(await supabase.rpc("issue_4383_roadmap_unschedule_card", { p_card_id: cardId }));
}

export async function scheduleRoadmapNotice(scheduledFor, timezone) {
  return unwrap(await supabase.rpc("issue_4383_roadmap_schedule_notice", { p_scheduled_for: scheduledFor, p_timezone: timezone }));
}

export async function cancelRoadmapNotice(id) {
  return unwrap(await supabase.rpc("issue_4383_roadmap_cancel_notice", { p_id: id }));
}

export async function listRoadmapScheduled() {
  const data = unwrap(await supabase.rpc("issue_4383_roadmap_scheduled_list"));
  return { cards: list(data?.cards), notices: list(data?.notices) };
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function listScheduledCommunications() {
  return list(unwrap(await supabase.rpc("issue_4383_scheduled_communications")));
}

export async function listCommunicationsFailures() {
  return list(unwrap(await supabase.rpc("issue_4383_communications_failures")));
}

// ── Email ────────────────────────────────────────────────────────────────────

export async function listScheduledEmails() {
  return list(unwrap(await supabase.rpc("issue_4383_email_scheduled_list")));
}
