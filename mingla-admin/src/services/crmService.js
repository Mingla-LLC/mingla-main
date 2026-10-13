// Issue #3802 (Wave 1) — the ONLY caller of the crm_* server functions.
//
// No other file in the admin app may call a crm_ function (a test pins this).
// The Hosts and Creators tables have no client access at all: every read and
// write goes through these functions, which check the person's role, record
// who did it and are safe to repeat. The agent connector (a later wave) calls
// the same functions.
//
// Every function here returns the server's data or throws a CrmError carrying
// { token, message, detail } — never a raw database or network error.
// Invariant: I-PROPOSED-3802-CRM-HAS-ONE-FUNCTION-WRITE-PATH.

import { supabase } from "../lib/supabase";
import { parseServerError } from "../lib/crmModel";

export class CrmError extends Error {
  constructor({ token, message, detail }) {
    // The message is the server's own sentence or nothing. It is NEVER the
    // token: a token is not something to show a person (lib/crmModel.js turns
    // it into words).
    super(typeof message === "string" ? message : "");
    this.name = "CrmError";
    this.token = token;
    this.detail = detail || "";
  }
}

/** A fresh key per new request; the same key again changes nothing on the server. */
export function newRequestKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(12, "0");
}

async function call(run) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new CrmError({ token: "network", message: "" });
  }
  let result;
  try {
    result = await run();
  } catch (err) {
    console.error("[crm] request failed:", err?.message || err);
    throw new CrmError(parseServerError(err));
  }
  if (result.error) {
    const parsed = parseServerError(result.error);
    if (parsed.token === "unknown" || parsed.token === "not_ready") {
      console.error("[crm] server refused:", result.error.code, result.error.message);
    }
    throw new CrmError(parsed);
  }
  return result.data;
}

export function fetchConfig() {
  return call(() => supabase.rpc("crm_config"));
}

export function listRecords(pipeline) {
  return call(() => supabase.rpc("crm_records_list", { p_pipeline: pipeline }));
}

export function getRecord(id) {
  return call(() => supabase.rpc("crm_record_get", { p_id: id }));
}

export function duplicateCheck(pipeline, name, excludeId = null) {
  return call(() =>
    supabase.rpc("crm_duplicate_check", { p_pipeline: pipeline, p_name: name, p_exclude: excludeId })
  );
}

/** kind: "brand" | "place". Returns { kind, results }. */
export function linkSearch(kind, query) {
  return call(() => supabase.rpc("crm_link_search", { p_kind: kind, p_query: query }));
}

/** Returns { status: "created", record, moved_to } or { status: "duplicate", existing }. */
export function createRecord(pipeline, fields, requestKey) {
  return call(() =>
    supabase.rpc("crm_record_create", {
      p_pipeline: pipeline,
      p_fields: fields,
      p_request_key: requestKey || newRequestKey(),
    })
  );
}

/** Returns { record, changed, moved_to }. */
export function updateRecord(id, changes) {
  return call(() => supabase.rpc("crm_record_update", { p_id: id, p_changes: changes }));
}

/**
 * Returns { record, changed, activity_id }. `expectedFrom` is the stage the
 * card was in when the person chose to move it: the server refuses the move
 * (stage_changed) if the card has moved since, so two people can never move
 * one card to different stages at once. It is sent on every move.
 */
export function moveStage(id, toStage, reason = null, expectedFrom = null) {
  return call(() =>
    supabase.rpc("crm_record_move_stage", {
      p_id: id,
      p_to: toStage,
      p_reason: reason,
      p_expected_from: expectedFrom,
    })
  );
}

/** Returns { record, changed }. */
export function undoStageMove(activityId) {
  return call(() => supabase.rpc("crm_record_undo_stage_move", { p_activity_id: activityId }));
}

/** Returns { record, changed }. */
export function setOwners(id, ownerEmails) {
  return call(() =>
    supabase.rpc("crm_record_set_owners", { p_id: id, p_owner_emails: ownerEmails })
  );
}

/** entry: { kind: "note", body } or { kind: "touch", channel, direction, ... }. */
export function logActivity(id, entry, requestKey) {
  return call(() =>
    supabase.rpc("crm_record_log", {
      p_id: id,
      p_entry: entry,
      p_request_key: requestKey || newRequestKey(),
    })
  );
}

/** Owner and admin only (the server refuses everyone else). */
export function deleteRecord(id) {
  return call(() => supabase.rpc("crm_record_delete", { p_id: id }));
}

/** Owner and admin only. The Undo after a delete. */
export function restoreRecord(id) {
  return call(() => supabase.rpc("crm_record_restore", { p_id: id }));
}

// ── Homes, targets and Beta leads (issue #3802, Wave 1) ────────────────────

/** The numbers on a role home. `today` is the viewer's own day, YYYY-MM-DD. */
export function fetchHomeSummary(today) {
  return call(() => supabase.rpc("crm_home_summary", { p_today: today || null }));
}

/** The team dashboard. Owner and admin only (the server refuses everyone else). */
export function fetchTeamSummary(today) {
  return call(() => supabase.rpc("crm_team_summary", { p_today: today || null }));
}

/**
 * Set, change or remove (monthlyTarget = null) one monthly host target.
 * Owner and admin only. Returns { changed, previous, target }.
 */
export function setTarget(regionId, icp, monthlyTarget) {
  return call(() =>
    supabase.rpc("crm_target_set", {
      p_region_id: regionId,
      p_icp: icp,
      p_monthly_target: monthlyTarget ?? null,
    })
  );
}

/** Returns { leads, total, new_count, truncated }. */
export function listBetaLeads() {
  return call(() => supabase.rpc("crm_beta_leads_list"));
}

/**
 * Add one beta lead to Hosts. Safe to repeat: a lead becomes at most one
 * host. Returns { status: created | exists | linked | duplicate, record, ... }.
 */
export function betaLeadToHost(leadId) {
  return call(() => supabase.rpc("crm_beta_lead_to_host", { p_lead_id: leadId }));
}
