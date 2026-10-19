// Issue #3980 — the ONLY browser caller of ops_* functions (Work board, Agent
// log, To review). Every function gates on the server; this file only shapes
// calls and turns refusals into an OpsError the screens can word.
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
