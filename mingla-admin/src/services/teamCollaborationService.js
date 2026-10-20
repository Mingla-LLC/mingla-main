import { invokeWithRefresh, supabase } from "../lib/supabase";

async function rpc(name, args = {}) {
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

export const getTeamPermissions = () => rpc("issue_3720_team_my_permissions");
export const getTeamNotificationPreferences = () => rpc("issue_3720_team_notification_preferences");
export const setMentionEmail = (enabled) => rpc("issue_3720_set_team_mention_email", { p_enabled: !!enabled });
export const listTeamMentions = (limit = 50, before = null) => rpc("issue_3720_list_team_mentions", { p_limit: limit, p_before: before });
export const markMentionRead = (id) => rpc("issue_3720_mark_team_mention_read", { p_mention_id: id });

// #3988 — per-category email alerts for the signed-in teammate.
export const getEmailAlertPreferences = () => rpc("issue_3988_my_email_alert_preferences");
export const setEmailAlertPreference = (categoryKey, enabled) =>
  rpc("issue_3988_set_email_alert_preference", { p_category_key: categoryKey, p_enabled: !!enabled });

// #3988 — the teammate's own in-app support and product alerts (RLS: own rows).
export async function listSupportAlerts(types, limit = 30) {
  const result = await supabase
    .from("notifications")
    .select("id, type, title, body, deep_link, data, created_at, read_at")
    .in("type", types)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (result.error) throw result.error;
  return result.data ?? [];
}

export async function markSupportAlertRead(id) {
  const result = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (result.error) throw result.error;
  return Array.isArray(result.data) && result.data.length === 1;
}

export async function loadDataRoom() {
  const result = await invokeWithRefresh("admin-data-room", { body: { action: "manifest" } });
  if (result.error) throw result.error;
  return result.data;
}

export async function openDataRoomDocument(key) {
  const result = await invokeWithRefresh("admin-data-room", { body: { action: "document", key } });
  if (result.error) throw result.error;
  if (result.data instanceof Blob) return result.data;
  if (result.data instanceof ArrayBuffer) return new Blob([result.data]);
  throw new Error("document_response_invalid");
}
