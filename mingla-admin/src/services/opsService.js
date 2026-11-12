// Issue #3980 — the ONLY browser caller of ops_* functions (Work board, Agent
// log, To review, Calendar, host cards). Every function gates on the server;
// this file only shapes calls and turns refusals into an OpsError the screens
// can word.
import { supabase } from "../lib/supabase";
import { parseServerError } from "../lib/crmModel";
import { readPersonAsTodo } from "../lib/opsModel";

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
  // #4270 rework (P3-5): any card the server still marks with the retired
  // status person is read as To do with its tag, so the board never hides it.
  return readPersonAsTodo(result.data);
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
// #4398: the watcher confirms a card waiting In review, or sends it back with what is missing.
export const confirmWork = (id, revision) => call(() => supabase.rpc("ops_work_confirm", { p_id: id, p_expected_revision: revision }));
export const sendBackWork = (id, reason, revision) =>
  call(() => supabase.rpc("ops_work_send_back", { p_id: id, p_reason: reason, p_expected_revision: revision }));
// #4398: a card reopens with one owner and one watcher; when it has neither, the person picks them here.
export const reopenWork = (id, reason, revision, people = {}) =>
  call(() => supabase.rpc("ops_work_reopen", { p_id: id, p_reason: reason || null, p_expected_revision: revision,
    ...(people.owner ? { p_owner: people.owner } : {}), ...(people.watcher ? { p_watcher: people.watcher } : {}) }));
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
// #4339 Creators and Locals calls: every booked call (Host, Creator, Local) in
// [from, to) instants, read beside ops_calendar (which it does not change).
export const fetchCalendarCalls = (fromIso, toIso, showTest) =>
  call(() => supabase.rpc("admin_calendar_calls", { p_from: fromIso, p_to: toIso, p_show_test: !!showTest }));
export const fetchRunwayReport = (from, to, today) =>
  call(() => supabase.rpc("ops_runway_report", { p_from: from || null, p_to: to || null, p_today: today || null }));
export const fetchAnchorDetail = (kind, id, today) =>
  call(() => supabase.rpc("ops_anchor_detail", { p_kind: kind, p_id: id, p_today: today || null }));
export const fetchHostOnMingla = (recordId, today, tz) =>
  call(() => supabase.rpc("ops_host_on_mingla", { p_record_id: recordId, p_today: today || null, p_tz: tz || null }));
export const setExpectedEvent = (item, requestKey) =>
  call(() => supabase.rpc("ops_expected_event_set", { p_item: item, p_request_key: requestKey }));
// #4270 W2: the host card for a brand, for the Brand group header's host avatar.
export const fetchBrandHostRecord = (brandId) => call(() => supabase.rpc("ops_brand_host_record", { p_brand_id: brandId }));
// #4270 W3: the brand plan on a host card, adding to it, and its links.
export const fetchBrandPlan = (recordId, from, to, today) =>
  call(() => supabase.rpc("ops_brand_plan", { p_record_id: recordId, p_from: from, p_to: to, p_today: today || null }));
export const addBrandPlanItem = (recordId, item, requestKey) =>
  call(() => supabase.rpc("ops_brand_plan_add", { p_record_id: recordId, p_item: item, p_request_key: requestKey }));
export const setBrandPlanLink = (kind, id, link, revision) =>
  call(() => supabase.rpc("ops_brand_plan_set_link", { p_kind: kind, p_id: id, p_link: link || null, p_expected_revision: revision }));

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

// Issue #3980 Wave 4 (P3): the owner's opt-in backfills. Previews write
// nothing; a confirm runs once per request key.
export const previewRoadmapLinks = (links) => call(() => supabase.rpc("ops_roadmap_links_preview", { p_links: links }));
export const confirmRoadmapLinks = (links, requestKey) =>
  call(() => supabase.rpc("ops_roadmap_links_confirm", { p_links: links, p_request_key: requestKey }));
export const previewBrandCards = () => call(() => supabase.rpc("ops_brand_cards_preview"));
// The next pages of the same preview, and the cheap count for the heading.
// #3980 W4 rework 2: "Show more" reads right after the last brand already
// shown (the page before's page.next), so no brand is skipped or repeated
// when brands gain a host card between pages.
export const previewBrandCardsPage = (after, limit) =>
  call(() => supabase.rpc("ops_brand_cards_preview_page", { p_after_created_at: after?.created_at ?? null, p_after_id: after?.id ?? null, p_limit: limit }));
export const countBrandCards = () => call(() => supabase.rpc("ops_brand_cards_count"));
export const confirmBrandCards = (brandIds, requestKey) =>
  call(() => supabase.rpc("ops_brand_cards_confirm", { p_brand_ids: brandIds, p_request_key: requestKey }));

// Issue #4130 Wave 1 — Work › Today, This week and This month. Read-only;
// the server checks the caller (the crm area, as the Agent log).
export const fetchEventsSince = (since, owner) =>
  call(() => supabase.rpc("ops_events_since", { p_since: since, p_owner: owner || null }));
export const fetchPeriodSummary = (from, to, owner, tz) =>
  call(() => supabase.rpc("ops_period_summary", { p_from: from, p_to: to, p_owner: owner || null, p_tz: tz || null }));

// Issue #4255 (Work board v2, W2 and W3) — columns, moving a card, subtasks,
// files, the card's thread and sprint planning. Every function checks the
// caller on the server and refuses a stale revision with PT409 (stale_write).
export const listStatuses = (includeArchived) => call(() => supabase.rpc("ops_status_list", { p_include_archived: !!includeArchived }));
export const addStatus = (name, color, grp, position) =>
  call(() => supabase.rpc("ops_status_add", { p_name: name, p_color: color, p_grp: grp, p_position: Number.isInteger(position) ? position : null }));
export const updateStatus = (id, changes, revision) => call(() => supabase.rpc("ops_status_update", { p_id: id, p_changes: changes, p_expected_revision: revision }));
export const moveStatus = (id, position, revision) => call(() => supabase.rpc("ops_status_move", { p_id: id, p_position: position, p_expected_revision: revision }));
export const archiveStatus = (id, moveTo, revision) => call(() => supabase.rpc("ops_status_archive", { p_id: id, p_move_to: moveTo, p_expected_revision: revision }));
export const moveWork = (id, statusId, revision, { proof = null, result = null, closeChildren = false } = {}) =>
  call(() => supabase.rpc("ops_work_move", { p_id: id, p_status_id: statusId, p_expected_revision: revision, p_proof: proof, p_result: result || null, p_close_children: !!closeChildren }));
export const addSubtask = (parentId, item, key) => call(() => supabase.rpc("ops_subtask_add", { p_parent_id: parentId, p_item: item, p_request_key: key }));
export const reorderSubtasks = (parentId, ids, revision) => call(() => supabase.rpc("ops_subtask_reorder", { p_parent_id: parentId, p_ids: ids, p_expected_revision: revision }));
export const addFile = (cardId, file, key) => call(() => supabase.rpc("ops_file_add", { p_card_id: cardId, p_file: file, p_request_key: key || null }));
export const archiveFile = (fileId) => call(() => supabase.rpc("ops_file_archive", { p_file_id: fileId }));
export const signFile = (fileId) => call(() => supabase.rpc("ops_file_sign", { p_file_id: fileId }));
// #4255 rework (P3): my read marker on a card's thread (the Thread badge).
export const markThreadRead = (cardId) => call(() => supabase.rpc("ops_thread_read", { p_card_id: cardId }));
export const listMessages = (cardId, limit, before) => call(() => supabase.rpc("ops_message_list", { p_card_id: cardId, p_limit: limit || 200, p_before: before || null }));
export const postMessage = (cardId, { body = "", mentions = [], parentId = null, fileIds = [], everyone = false, key = null } = {}) =>
  call(() => supabase.rpc("ops_message_post", { p_card_id: cardId, p_body: body, p_mentions: mentions, p_parent_message_id: parentId, p_file_ids: fileIds.length ? fileIds : null, p_everyone: !!everyone, p_request_key: key }));
export const editMessage = (id, body, revision) => call(() => supabase.rpc("ops_message_edit", { p_message_id: id, p_body: body, p_expected_revision: revision }));
export const deleteMessage = (id, revision) => call(() => supabase.rpc("ops_message_delete", { p_message_id: id, p_expected_revision: revision }));
export const reactMessage = (id, emoji, on) => call(() => supabase.rpc("ops_message_react", { p_message_id: id, p_emoji: emoji, p_on: on !== false }));
export const fetchSprintPlan = (sprintId, today) => call(() => supabase.rpc("ops_sprint_plan_get", { p_sprint_id: sprintId || null, p_today: today || null }));
export const addSprintGoal = (sprintId, title, owner) => call(() => supabase.rpc("ops_sprint_goal_add", { p_sprint_id: sprintId, p_title: title, p_owner_email: owner || null }));
export const updateSprintGoal = (goalId, changes, revision) => call(() => supabase.rpc("ops_sprint_goal_update", { p_goal_id: goalId, p_changes: changes, p_expected_revision: revision }));
export const archiveSprintGoal = (goalId, revision) => call(() => supabase.rpc("ops_sprint_goal_archive", { p_goal_id: goalId, p_expected_revision: revision }));
export const setSprintCapacity = (sprintId, email, hours) => call(() => supabase.rpc("ops_sprint_capacity_set", { p_sprint_id: sprintId, p_email: email, p_hours: hours }));
export const startSprint = (sprintId, revision) => call(() => supabase.rpc("ops_sprint_start", { p_sprint_id: sprintId, p_expected_revision: revision }));
export const setSprintReviewNote = (sprintId, note, revision) => call(() => supabase.rpc("ops_sprint_review_note_set", { p_sprint_id: sprintId, p_note: note, p_expected_revision: revision }));

// Files live in the private ops-work-files bucket. The database says where a
// file goes (ops_file_add's upload.path) and whether it may be read
// (ops_file_sign); the browser uploads it there and asks storage for a
// 5-minute signed link. No image transformations (spend cap, #1643).
async function storageCall(run) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new OpsError({ token: "network", message: "" });
  let result;
  try {
    result = await run();
  } catch (error) {
    throw new OpsError({ token: "upload_failed", message: typeof error?.message === "string" && /\s/.test(error.message) ? error.message : "The upload didn’t finish. Try again." });
  }
  if (result?.error) {
    throw new OpsError({ token: "upload_failed", message: typeof result.error.message === "string" && /\s/.test(result.error.message) ? result.error.message : "The upload didn’t finish. Try again." });
  }
  return result?.data;
}
export const uploadFileObject = (bucket, path, file, contentType) =>
  storageCall(() => supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false, cacheControl: "3600" }));
export const signedFileUrl = async (bucket, path, seconds = 300) => {
  const data = await storageCall(() => supabase.storage.from(bucket).createSignedUrl(path, seconds));
  return data?.signedUrl || "";
};
export const signedFileUrls = async (bucket, paths, seconds = 300) => {
  if (!paths.length) return {};
  const data = await storageCall(() => supabase.storage.from(bucket).createSignedUrls(paths, seconds));
  const out = {};
  for (const row of Array.isArray(data) ? data : []) if (row?.path && row?.signedUrl) out[row.path] = row.signedUrl;
  return out;
};

/**
 * A picture or document onto a card: the database row first (it checks the
 * caller, the type, the 25 MB cap and the 50-file limit and says where the
 * file goes), then the upload to that path. Returns the file row. A failed
 * upload leaves a row that never shows (it lists only uploaded files).
 */
export async function uploadCardFile(cardId, file, { kind, mime, key } = {}) {
  const added = await addFile(cardId, { kind, name: String(file?.name || "file").slice(0, 200), mime, size_bytes: Number(file?.size) || 0 }, key);
  if (added?.upload?.path) await uploadFileObject(added.upload.bucket || "ops-work-files", added.upload.path, file, mime);
  return added?.file || null;
}

/** A link onto a card (no page is fetched). */
export const addCardLink = (cardId, url, name, key) => addFile(cardId, { kind: "link", url, ...(name ? { name } : {}) }, key).then((r) => r?.file || null);

/** A short-lived address to open a file: a link's own, or a 5-minute signed one. */
export async function openableFileUrl(fileId) {
  const s = await signFile(fileId);
  if (s?.kind === "link") return s.url || "";
  return signedFileUrl(s?.bucket || "ops-work-files", s?.path, Math.min(Number(s?.expires_in) || 300, 300));
}
