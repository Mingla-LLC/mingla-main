// Issue #3802 — the ONLY browser caller of team_draft_* functions.
import { supabase } from "../lib/supabase";
import { parseServerError } from "../lib/crmModel";

export class DraftError extends Error {
  constructor({ token, message, detail }) {
    super(typeof message === "string" ? message : "");
    this.name = "DraftError";
    this.token = token;
    this.detail = detail || "";
  }
}

async function call(run) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new DraftError({ token: "network", message: "" });
  }
  let result;
  try {
    result = await run();
  } catch (error) {
    throw new DraftError(parseServerError(error));
  }
  if (result.error) throw new DraftError(parseServerError(result.error));
  return result.data;
}

export const listDrafts = (query = {}) => call(() => supabase.rpc("team_draft_list", { p_query: query }));
export const updateDraft = (id, changes) => call(() => supabase.rpc("team_draft_update", { p_id: id, p_changes: changes }));
export const discardDrafts = (ids) => call(() => supabase.rpc("team_draft_discard", { p_ids: ids }));
export const restoreDraft = (id) => call(() => supabase.rpc("team_draft_restore", { p_id: id }));
export const markDraftSent = (id, body) => call(() => supabase.rpc("team_draft_mark_sent", { p_id: id, p_sent_body: body }));
export const undoDraftSent = (id) => call(() => supabase.rpc("team_draft_unsend", { p_id: id }));
export const fetchDraftCounts = () => call(() => supabase.rpc("team_draft_counts"));
