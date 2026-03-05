import { supabase } from "./supabase";
import {
  FriendLink,
  UserSearchResult,
  SendLinkResponse,
  RespondLinkResponse,
} from "../types/friendLink";

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapFriendLink(row: any): FriendLink {
  return {
    id: row.id,
    requesterId: row.requester_id,
    targetId: row.target_id,
    status: row.status,
    requesterPersonId: row.requester_person_id ?? null,
    targetPersonId: row.target_person_id ?? null,
    acceptedAt: row.accepted_at ?? null,
    unlinkedAt: row.unlinked_at ?? null,
    unlinkedBy: row.unlinked_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getAuthToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

// ── Edge Function Calls ─────────────────────────────────────────────────────

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const token = await getAuthToken();

  const response = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/search-users`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to search users");
  }

  const data = await response.json();
  return data.users ?? [];
}

export async function sendFriendLink(
  targetUserId: string
): Promise<SendLinkResponse> {
  const token = await getAuthToken();

  const response = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-friend-link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetUserId }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to send friend link");
  }

  return response.json();
}

export async function respondToFriendLink(
  linkId: string,
  action: "accept" | "decline"
): Promise<RespondLinkResponse> {
  const token = await getAuthToken();

  const response = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/respond-friend-link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ linkId, action }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to respond to friend link");
  }

  return response.json();
}

export async function unlinkFriend(linkId: string): Promise<void> {
  const token = await getAuthToken();

  const response = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/unlink-friend`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ linkId }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to unlink friend");
  }
}

// ── Direct Supabase Queries ─────────────────────────────────────────────────

export async function getPendingLinkRequests(
  userId: string
): Promise<FriendLink[]> {
  const { data, error } = await supabase
    .from("friend_links")
    .select("*")
    .eq("target_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapFriendLink);
}

export async function getSentLinkRequests(
  userId: string
): Promise<FriendLink[]> {
  const { data, error } = await supabase
    .from("friend_links")
    .select("*")
    .eq("requester_id", userId)
    .eq("status", "pending");

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapFriendLink);
}

export async function cancelLinkRequest(linkId: string): Promise<void> {
  const { error } = await supabase
    .from("friend_links")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", linkId);

  if (error) throw new Error(error.message);
}
