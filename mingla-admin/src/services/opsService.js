// Issue #3980 — the ONLY browser caller of ops_* functions (Work board, Agent
// log, To review, Calendar, host cards). Every function gates on the server;
// this file only shapes calls and turns refusals into an OpsError the screens
// can word.
import { supabase } from "../lib/supabase";
import { parseServerError } from "../lib/crmModel";

export class OpsError extends Error {
  constructor({ token, message, detail, fixes }) {
    super(typeof message === "string" ? message : "");
    this.name = "OpsError";
    this.token = token;
    this.detail = detail || "";
    this.fixes = Array.isArray(fixes) ? fixes : [];
  }
}

function fixesFrom(detail) {
  if (typeof detail !== "string" || !detail.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(detail);
    return Array.isArray(parsed?.fixes) ? parsed.fixes.filter((f) => f && typeof f.message === "string") : [];
  } catch {
    return [];
  }
}

async function call(run) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new OpsError({ token: "network", message: "" });
  }
  let result;
  try {
    result = await run();
  } catch (error) {
    const parsed = parseServerError(error);
    throw new OpsError({ ...parsed, fixes: fixesFrom(parsed.detail) });
  }
  if (result.error) {
    const parsed = parseServerError(result.error);
    throw new OpsError({ ...parsed, fixes: fixesFrom(parsed.detail) });
  }
  return result.data;
}

export const fetchOpsConfig = (today) => call(() => supabase.rpc("ops_config", { p_today: today || null }));
export const listWork = (query = {}) => call(() => supabase.rpc("ops_work_list", { p_query: query }));
export const getWork = (id, today) => call(() => supabase.rpc("ops_work_get", { p_id: id, p_today: today || null }));
export const addWork = (items, requestKey) => call(() => supabase.rpc("ops_work_add", { p_items: items, p_request_key: requestKey }));
export const updateWork = (id, changes, revision, requestKey) =>
  call(() => supabase.rpc("ops_work_update", { p_id: id, p_changes: changes, p_expected_revision: revision, p_request_key: requestKey || null }));
export const startWork = (id, revision) => call(() => supabase.rpc("ops_work_start", { p_id: id, p_expected_revision: revision }));
export const closeWork = (id, proof, result, revision) =>
  call(() => supabase.rpc("ops_work_close", { p_id: id, p_proof: proof, p_result: result || null, p_expected_revision: revision }));
export const pushBackWork = (id, kind, reason, proof, revision) =>
  call(() => supabase.rpc("ops_work_push_back", { p_id: id, p_kind: kind, p_reason: reason, p_proof: proof || [], p_expected_revision: revision }));
export const reopenWork = (id, reason, revision) =>
  call(() => supabase.rpc("ops_work_reopen", { p_id: id, p_reason: reason || null, p_expected_revision: revision }));
export const noteWork = (id, body, mentionEmails, requestKey) =>
  call(() => supabase.rpc("ops_work_note", { p_id: id, p_body: body, p_mention_emails: mentionEmails || [], p_request_key: requestKey || null }));
export const personAction = (id, action, note, revision) =>
  call(() => supabase.rpc("ops_work_person_action", { p_id: id, p_action: action, p_note: note || null, p_expected_revision: revision }));
export const undoWork = (eventId) => call(() => supabase.rpc("ops_work_undo", { p_event_id: eventId }));
export const archiveWork = (id, reason) => call(() => supabase.rpc("ops_work_archive", { p_id: id, p_reason: reason }));
export const fetchMyCounts = (today) => call(() => supabase.rpc("ops_my_counts", { p_today: today || null }));
export const listReview = (today) => call(() => supabase.rpc("ops_review_list", { p_today: today || null }));
export const searchLinks = (kind, query) => call(() => supabase.rpc("ops_link_search", { p_kind: kind, p_query: query }));
export const fetchRecordSignals = (recordId) => call(() => supabase.rpc("ops_record_signals", { p_record_id: recordId }));
export const allowOneMore = (recordId, reason) => call(() => supabase.rpc("ops_contact_override", { p_record_id: recordId, p_reason: reason }));
export const listLog = (query = {}) => call(() => supabase.rpc("ops_log_list", { p_query: query }));
export const releaseClaims = (cardId, claimIds) =>
  call(() => supabase.rpc("ops_release", { p_card_id: cardId || null, p_claim_ids: claimIds || null }));
export const setSprintGoal = (week, goal) => call(() => supabase.rpc("ops_sprint_set_goal", { p_week: week, p_goal: goal }));

// Wave 2 — the Calendar, runway and host sync.
export const fetchCalendar = (from, to, today) =>
  call(() => supabase.rpc("ops_calendar", { p_from: from, p_to: to, p_today: today || null }));
export const fetchRunwayReport = (from, to, today) =>
  call(() => supabase.rpc("ops_runway_report", { p_from: from || null, p_to: to || null, p_today: today || null }));
export const fetchAnchorDetail = (kind, id, today) =>
  call(() => supabase.rpc("ops_anchor_detail", { p_kind: kind, p_id: id, p_today: today || null }));
export const fetchHostOnMingla = (recordId, today) =>
  call(() => supabase.rpc("ops_host_on_mingla", { p_record_id: recordId, p_today: today || null }));
export const setExpectedEvent = (item, requestKey) =>
  call(() => supabase.rpc("ops_expected_event_set", { p_item: item, p_request_key: requestKey }));

// Wave 3 — the launch kit, the giveaway and ads rule, the Team dashboard and
// turning next steps into cards (owner only).
export const previewLaunchKit = (kind, id, options, today) =>
  call(() => supabase.rpc("ops_launch_kit_preview", { p_anchor_kind: kind, p_anchor_id: id, p_options: options || {}, p_today: today || null }));
export const overrideGate = (cardId, reason) => call(() => supabase.rpc("ops_gate_override", { p_card_id: cardId, p_reason: reason }));
export const fetchTeamOverview = (today) => call(() => supabase.rpc("ops_team_overview", { p_today: today || null }));
export const previewNextActions = (limit) => call(() => supabase.rpc("ops_next_action_preview", { p_limit: limit || 600 }));
export const convertNextActions = (recordIds, fallbackOwner, requestKey) =>
  call(() => supabase.rpc("ops_next_action_convert", { p_record_ids: recordIds, p_fallback_owner: fallbackOwner || null, p_request_key: requestKey }));

// #3980 synced program, Wave 1 — the owner or an admin clears an agent's
// working mark on a card, with a reason.
export const clearWorkingMark = (cardId, reason) =>
  call(() => supabase.rpc("ops_working_clear", { p_card_id: cardId, p_reason: reason }));
// Display names and GitHub usernames (owner only). Screens use them through
// services/teamProfileService.js; the call stays here, the one ops_ caller.
export const listTeamProfiles = () => call(() => supabase.rpc("ops_profiles_list"));
export const setTeamProfile = (email, displayName, githubLogin) =>
  call(() => supabase.rpc("ops_profile_set", { p_teammate: email, p_display_name: displayName || null, p_github_login: githubLogin || null }));

// #3980 synced program, Wave 2 — the bridges. Status chips for linked GitHub
// issues and pull requests, a ticket's engineering status, roadmap links and
// GitHub's lane suggestions, release records and what shipped a Feature
// Guide entry. Every function checks the caller on the server.
export const fetchGithubStatuses = (numbers) =>
  call(() => supabase.rpc("ops_github_status_list", { p_numbers: numbers }));
export const fetchTicketEngineering = (sourceKind, sourceId) =>
  call(() => supabase.rpc("ops_ticket_engineering", { p_source_kind: sourceKind, p_source_id: sourceId }));
export const listRoadmapLinks = () => call(() => supabase.rpc("ops_roadmap_links_list"));
export const setRoadmapLink = (cardId, issue) =>
  call(() => supabase.rpc("ops_roadmap_link_set", { p_card_id: cardId, p_issue: issue || null }));
export const decideRoadmapSuggestion = (cardId, decision) =>
  call(() => supabase.rpc("ops_roadmap_suggestion_decide", { p_card_id: cardId, p_decision: decision }));
export const listReleaseRecords = (query = {}) => call(() => supabase.rpc("ops_release_records_list", { p_query: query }));
export const fetchFeatureGuideRelease = (key) => call(() => supabase.rpc("ops_feature_guide_release", { p_key: key }));

// #3980 synced program, Wave 3 — the operations redesign. The people field's
// directory, the switches, each host's next dated thing, Needs attention and
// what just happened. Every function checks the caller on the server.
export const fetchPeopleDirectory = () => call(() => supabase.rpc("ops_people_directory"));
export const fetchOpsSettings = () => call(() => supabase.rpc("ops_settings_get"));
export const setOpsSetting = (key, value) => call(() => supabase.rpc("ops_setting_set", { p_key: key, p_value: value }));
export const fetchHostNext = (recordIds, today) =>
  call(() => supabase.rpc("ops_host_next", { p_record_ids: recordIds, p_today: today || null }));
export const fetchAttention = (today) => call(() => supabase.rpc("ops_attention", { p_today: today || null }));
export const fetchRecentChanges = (kind, id, hours) =>
  call(() => supabase.rpc("ops_recent_changes", { p_kind: kind, p_id: id, p_hours: hours || 72 }));
