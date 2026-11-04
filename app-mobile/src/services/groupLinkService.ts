/**
 * Issue #4261 Wave B1 — group link, joining and adding people (spec section 4.3).
 *
 * Every function throws an Error whose message is the RPC's error code
 * (`not_allowed`, `not_found`, `unavailable`, `conflict_*` …) so callers can
 * map it to copy. Nothing is fabricated on failure.
 */
import { supabase } from "./supabase";
import { refreshChatListAfterConversationChange } from "./chatListRefresh";
import { getDisplayName } from "../utils/getDisplayName";
import type {
  AddGroupMembersResult,
  DecideJoinRequestResult,
  GroupJoinRequest,
  GroupLinkInfo,
  GroupLinkPreview,
  JoinByLinkResult,
} from "../types/chatPlans";

function parseJson(data: unknown): Record<string, unknown> {
  const value = typeof data === "string" ? JSON.parse(data) : data;
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  return value as Record<string, unknown>;
}

function codeOf(error: { message?: string } | null, fallback: string): Error {
  return new Error(error?.message || fallback);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function getGroupLink(conversationId: string): Promise<GroupLinkInfo> {
  const { data, error } = await supabase.rpc("get_or_create_group_link", { p_conversation_id: conversationId });
  if (error) throw codeOf(error, "group_link_failed");
  const row = parseJson(data);
  const token = str(row.token);
  if (!token) throw new Error("invalid_response");
  return {
    token,
    requireApproval: row.requireApproval === true,
    canManage: row.canManage === true,
    memberCount: Number(row.memberCount ?? 0) || 0,
  };
}

export async function resetGroupLink(conversationId: string): Promise<{ token: string }> {
  const { data, error } = await supabase.rpc("reset_group_link", { p_conversation_id: conversationId });
  if (error) throw codeOf(error, "group_link_reset_failed");
  const token = str(parseJson(data).token);
  if (!token) throw new Error("invalid_response");
  return { token };
}

export async function setGroupLinkApproval(
  conversationId: string,
  requireApproval: boolean,
): Promise<{ requireApproval: boolean }> {
  const { data, error } = await supabase.rpc("set_group_link_approval", {
    p_conversation_id: conversationId,
    p_require: requireApproval,
  });
  if (error) throw codeOf(error, "group_link_approval_failed");
  return { requireApproval: parseJson(data).requireApproval === true };
}

export async function previewGroupLink(token: string): Promise<GroupLinkPreview> {
  const { data, error } = await supabase.rpc("group_link_preview", { p_token: token });
  if (error) throw codeOf(error, "group_link_preview_failed");
  const row = parseJson(data);
  const conversationId = str(row.conversationId);
  if (!conversationId) throw new Error("invalid_response");
  return {
    conversationId,
    name: str(row.name),
    memberCount: Number(row.memberCount ?? 0) || 0,
    requireApproval: row.requireApproval === true,
    isMember: row.isMember === true,
  };
}

export async function joinGroupByLink(token: string, shareToken: string | null): Promise<JoinByLinkResult> {
  const { data, error } = await supabase.rpc("join_group_by_link", {
    p_token: token,
    p_share_token: shareToken,
  });
  if (error) throw codeOf(error, "group_join_failed");
  const row = parseJson(data);
  const status = row.status;
  if (status !== "joined" && status !== "invited" && status !== "requested" && status !== "already_member") {
    throw new Error("invalid_response");
  }
  // #4261: joining (or asking to join) a group changes the Chats list; #4265's
  // useChatList entry is marked stale through chatListKeys.all.
  refreshChatListAfterConversationChange();
  return {
    status,
    conversationId: str(row.conversationId),
    sessionId: str(row.sessionId),
    inviteId: str(row.inviteId),
    requestId: str(row.requestId),
  };
}

export interface GroupJoinRequestWithNames extends GroupJoinRequest {
  userName: string | null;
  sharerName: string | null;
}

/** The chat's join requests (RLS: members, and the joiner for their own). */
export async function fetchGroupJoinRequests(conversationId: string): Promise<GroupJoinRequestWithNames[]> {
  const { data, error } = await supabase
    .from("group_join_requests")
    .select("id, conversation_id, user_id, sharer_id, status, decided_by, decided_at, message_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw codeOf(error, "group_join_requests_failed");
  const rows = (data ?? []) as GroupJoinRequest[];
  const people = [...new Set(rows.flatMap((r) => [r.user_id, r.sharer_id]).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (people.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, display_name, username")
      .in("id", people);
    if (profileError) {
      // Names are decoration; the card falls back to the server's line.
      console.warn("[groupLinkService] join request names failed:", profileError.message);
    } else {
      for (const p of (profiles ?? []) as Array<{ id: string; first_name?: string | null; last_name?: string | null; display_name?: string | null; username?: string | null }>) {
        const firstOnly = p.first_name?.trim();
        const name = firstOnly || getDisplayName(p, "");
        if (name) names.set(p.id, name);
      }
    }
  }
  return rows.map((r) => ({
    ...r,
    userName: names.get(r.user_id) ?? null,
    sharerName: r.sharer_id ? names.get(r.sharer_id) ?? null : null,
  }));
}

export async function decideGroupJoinRequest(requestId: string, approve: boolean): Promise<DecideJoinRequestResult & { sessionId: string | null }> {
  const { data, error } = await supabase.rpc("decide_group_join_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) throw codeOf(error, "group_join_decide_failed");
  const row = parseJson(data);
  const status = row.status;
  if (status !== "pending" && status !== "approved" && status !== "declined" && status !== "invited" && status !== "joined") {
    throw new Error("invalid_response");
  }
  return { status, inviteId: str(row.inviteId), sessionId: str(row.sessionId) };
}

export async function addGroupMembers(conversationId: string, userIds: string[]): Promise<AddGroupMembersResult> {
  const { data, error } = await supabase.rpc("add_group_members", {
    p_conversation_id: conversationId,
    p_user_ids: userIds,
  });
  if (error) throw codeOf(error, "group_add_failed");
  const row = parseJson(data);
  return { added: ids(row.added), skipped: ids(row.skipped) };
}
