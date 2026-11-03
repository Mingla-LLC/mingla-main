// Issue #4255 — the ONLY browser caller of the shared email drafts.
// Reads go through the table (RLS: every active teammate); writes go through
// admin_email_draft_save / admin_email_draft_delete, which check the author or
// an admin and refuse a stale save with PT409.
import { supabase } from "../lib/supabase";

const DRAFT_COLUMNS =
  "id,subject,document,audience,status,author_id,author_email,last_editor_email,revision,created_at,updated_at";

function fail(error) {
  const wrapped = new Error(error?.message || "Email drafts request failed");
  wrapped.code = error?.code || "";
  wrapped.name = "EmailDraftError";
  return wrapped;
}

export async function listEmailDrafts() {
  const { data, error } = await supabase
    .from("admin_email_drafts")
    .select(DRAFT_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw fail(error);
  return Array.isArray(data) ? data : [];
}

export async function getEmailDraft(id) {
  const { data, error } = await supabase
    .from("admin_email_drafts")
    .select(DRAFT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fail(error);
  return data || null;
}

/** id null creates a draft; otherwise revision must be the one you opened. */
export async function saveEmailDraft({ id = null, revision = null, subject, document, audience, status }) {
  const { data, error } = await supabase.rpc("admin_email_draft_save", {
    p_id: id,
    p_subject: subject,
    p_document: document,
    p_audience: audience,
    p_status: status,
    p_revision: id ? revision : null,
  });
  if (error) throw fail(error);
  return data;
}

export async function deleteEmailDraft(id) {
  const { data, error } = await supabase.rpc("admin_email_draft_delete", { p_id: id });
  if (error) throw fail(error);
  return data;
}
