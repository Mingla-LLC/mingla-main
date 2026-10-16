import { supabase } from "../lib/supabase";
import { parseServerError } from "../lib/crmModel";

export class ContentCalendarError extends Error {
  constructor({ token, message, detail }) {
    super(typeof message === "string" ? message : "");
    this.name = "ContentCalendarError";
    this.token = token;
    this.detail = detail || "";
  }
}

async function call(name, args = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ContentCalendarError({ token: "network", message: "" });
  let answer;
  try { answer = await supabase.rpc(name, args); } catch (error) { throw new ContentCalendarError(parseServerError(error)); }
  if (answer.error) throw new ContentCalendarError(parseServerError(answer.error));
  return answer.data;
}

export const fetchContentConfig = () => call("content_calendar_config");
export const listContent = (query = {}) => call("content_calendar_list", { p_query: query });
export const getContent = (id) => call("content_calendar_get", { p_id: id });
export const createContent = (title, key) => call("content_calendar_create", { p_title: title, p_request_key: key });
export const updateContent = (id, changes, revision, key) => call("content_calendar_update", { p_id: id, p_changes: changes, p_expected_revision: revision, p_request_key: key });
export const assignContent = (id, owners, revision, key) => call("content_calendar_assign", { p_id: id, p_owner_emails: owners, p_expected_revision: revision, p_request_key: key });
export const moveContent = (id, to, revision, approvals, key) => call("content_calendar_move", { p_id: id, p_to: to, p_expected_revision: revision, p_approve_copy: !!approvals?.approve_copy, p_approve_design: !!approvals?.approve_design, p_publish_without_link: !!approvals?.publish_without_link, p_request_key: key });
export const addContentComment = (id, body, key) => call("content_calendar_comment_add", { p_id: id, p_body: body, p_request_key: key });
export const undoContent = (auditId, revision) => call("content_calendar_undo", { p_audit_id: auditId, p_expected_revision: revision });
export const deleteContent = (id, revision) => call("content_calendar_delete", { p_id: id, p_expected_revision: revision });
