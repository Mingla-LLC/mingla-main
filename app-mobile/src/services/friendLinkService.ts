import { supabase, supabaseUrl } from "./supabase";
import {
  FriendLink,
  SentFriendLink,
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
    `${supabaseUrl}/functions/v1/search-users`,
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
    const text = await response.text();
    let errorMsg = "Failed to search users";
    try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return data.users ?? [];
}

export async function sendFriendLink(
  targetUserId: string,
  personId?: string
): Promise<SendLinkResponse> {
  const token = await getAuthToken();

  const body: Record<string, string> = { targetUserId };
  if (personId) body.personId = personId;

  const response = await fetch(
    `${supabaseUrl}/functions/v1/send-friend-link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let errorMsg = "Failed to send friend link";
    try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
    throw new Error(errorMsg);
  }

  return response.json();
}

export async function respondToFriendLink(
  linkId: string,
  action: "accept" | "decline"
): Promise<RespondLinkResponse> {
  const token = await getAuthToken();

  const response = await fetch(
    `${supabaseUrl}/functions/v1/respond-friend-link`,
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
    const text = await response.text();
    let errorMsg = "Failed to respond to friend link";
    try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
    throw new Error(errorMsg);
  }

  return response.json();
}

export async function unlinkFriend(linkId: string): Promise<void> {
  const token = await getAuthToken();

  const response = await fetch(
    `${supabaseUrl}/functions/v1/unlink-friend`,
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
    const text = await response.text();
    let errorMsg = "Failed to unlink friend";
    try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
    throw new Error(errorMsg);
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
): Promise<SentFriendLink[]> {
  const { data, error } = await supabase
    .from("friend_links")
    .select("*")
    .eq("requester_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const links = (data ?? []).map(mapFriendLink);
  if (links.length === 0) return [];

  // Batch-fetch target profiles
  const targetIds = links.map((l) => l.targetId);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", targetIds);

  const profileMap = new Map(
    (profiles ?? []).map((p: any) => [p.id, p])
  );

  return links.map((link) => {
    const p = profileMap.get(link.targetId);
    return {
      ...link,
      targetProfile: p
        ? {
            display_name: p.display_name ?? null,
            username: p.username ?? null,
            avatar_url: p.avatar_url ?? null,
          }
        : null,
    };
  });
}

export async function cancelLinkRequest(linkId: string): Promise<void> {
  const { error } = await supabase
    .from("friend_links")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", linkId);

  if (error) throw new Error(error.message);
}
