/**
 * Issue #4435: the server-checked group chat verbs. Every function throws an
 * Error whose message is the RPC's error code (`not_allowed`,
 * `conflict_group_full`, `creator_protected`, `last_admin`, …) so callers map
 * it to copy with groupErrorKey. Nothing is fabricated on failure.
 */
import { supabase } from "./supabase";
import { refreshChatListAfterConversationChange } from "./chatListRefresh";

export interface CreatedGroupChat {
  sessionId: string;
  conversationId: string;
  boardId: string | null;
  added: string[];
  skipped: string[];
}

function parseJson(data: unknown): Record<string, unknown> {
  const value = typeof data === "string" ? JSON.parse(data) : data;
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  return value as Record<string, unknown>;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** create_group_chat: a live group with a board, the caller and 0-14 friends in at once. */
export async function createGroupChat(name: string, friendIds: string[]): Promise<CreatedGroupChat> {
  const { data, error } = await supabase.rpc("create_group_chat", {
    p_name: name,
    p_friend_ids: friendIds,
  });
  if (error) throw new Error(error.message || "group_create_failed");
  const row = parseJson(data);
  const sessionId = str(row.sessionId);
  const conversationId = str(row.conversationId);
  if (!sessionId || !conversationId) throw new Error("invalid_response");
  refreshChatListAfterConversationChange();
  return { sessionId, conversationId, boardId: str(row.boardId), added: ids(row.added), skipped: ids(row.skipped) };
}

/** remove_group_member: an admin removes someone (never the creator). */
export async function removeGroupMember(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_group_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message || "group_remove_failed");
  refreshChatListAfterConversationChange();
}

/** set_group_admin: an admin makes or removes an admin (the creator stays admin; the last admin stays). */
export async function setGroupAdmin(conversationId: string, userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_group_admin", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (error) throw new Error(error.message || "group_admin_failed");
}

/**
 * The creator's Delete group: the same writes as before #4435, in one place.
 * Invites go, pending phone invites are cancelled, the other members are
 * removed, then the session (its chat goes with it).
 */
export async function deleteGroup(sessionId: string, creatorId: string): Promise<void> {
  const { error: inviteError } = await supabase
    .from("collaboration_invites")
    .delete()
    .eq("session_id", sessionId);
  if (inviteError) throw new Error(inviteError.message || "group_delete_failed");
  const { error: phoneInviteError } = await supabase
    .from("pending_session_invites")
    .update({ status: "cancelled" })
    .eq("session_id", sessionId)
    .eq("status", "pending");
  if (phoneInviteError) throw new Error(phoneInviteError.message || "group_delete_failed");
  const { error: membersError } = await supabase
    .from("session_participants")
    .delete()
    .eq("session_id", sessionId)
    .neq("user_id", creatorId);
  if (membersError) throw new Error(membersError.message || "group_delete_failed");
  const { error: sessionError } = await supabase
    .from("collaboration_sessions")
    .delete()
    .eq("id", sessionId);
  if (sessionError) throw new Error(sessionError.message || "group_delete_failed");
  refreshChatListAfterConversationChange();
}
