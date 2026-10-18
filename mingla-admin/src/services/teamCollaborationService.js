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
