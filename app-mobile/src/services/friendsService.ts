/**
 * SERVICE ERROR CONTRACT (transitional):
 * fetchFriends() throws on primary query failure but swallows secondary
 * profile fetch errors (returns partial data).
 * [TRANSITIONAL] tagged logs mark masked error paths.
 * Full fix: migrate to ServiceResult<T> return type.
 * See: HARDENING_EXECUTION_PLAN_V3.md, Deferred items.
 */
import { supabase } from "./supabase";
import { blockService } from "./blockService";

// ─── Types ───────────────────────────────────────────────

export interface Friend {
  id: string;
  user_id: string;
  friend_user_id: string;
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  status: "accepted" | "pending" | "blocked";
  created_at: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  sender: {
    username: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    email?: string;
  };
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
  type?: "incoming" | "outgoing";
}

export interface BlockedUser {
  id: string;
  name: string;
  username?: string;
  avatar_url?: string;
  blocked_at?: string;
}

// ─── Query Functions ─────────────────────────────────────

/**
 * Fetch all accepted friends for a user, with profile data.
 * Two queries: friends table + batch profiles.
 */
export async function fetchFriends(userId: string): Promise<Friend[]> {
  // Query 1: Get friend rows from both sides
  const { data: allRawFriends, error: friendsError } = await supabase
    .from("friends")
    .select("id, user_id, friend_user_id, status, created_at")
    .eq("status", "accepted")
    .or(`user_id.eq.${userId},friend_user_id.eq.${userId}`);

  if (friendsError) throw friendsError;

  // Normalize so friend_user_id always points to the OTHER user
  const normalized = (allRawFriends || []).map((f: any) => {
    if (f.user_id === userId) return f;
    return { ...f, user_id: f.friend_user_id, friend_user_id: f.user_id };
  });

  // Deduplicate using Set (O(n) instead of O(n²))
  const seen = new Set<string>();
  const uniqueFriends = normalized.filter((f: any) => {
    if (seen.has(f.friend_user_id)) return false;
    seen.add(f.friend_user_id);
    return true;
  });

  if (uniqueFriends.length === 0) return [];

  // Query 2: Batch-fetch profiles
  const friendUserIds = uniqueFriends.map((f: any) => f.friend_user_id);
  const { data: allProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, first_name, last_name, avatar_url")
    .in("id", friendUserIds);

  if (profilesError) {
    console.error("[TRANSITIONAL] friendsService.fetchFriends — profile fetch failed, returning partial data:", profilesError);
  }

  const profilesMap = new Map((allProfiles || []).map((p: any) => [p.id, p]));

  return uniqueFriends.map((friend: any) => {
    const profile = profilesMap.get(friend.friend_user_id);
    return {
      id: friend.id,
      user_id: friend.user_id,
      friend_user_id: friend.friend_user_id,
      username: profile?.username || `user_${friend.friend_user_id.substring(0, 8)}`,
      display_name:
        profile?.display_name ||
        (profile?.first_name && profile?.last_name
          ? `${profile.first_name} ${profile.last_name}`
          : undefined),
      first_name: profile?.first_name,
      last_name: profile?.last_name,
      avatar_url: profile?.avatar_url,
      status: friend.status as "accepted" | "pending" | "blocked",
      created_at: friend.created_at,
    };
  });
}

/**
 * Fetch all pending friend requests (incoming + outgoing) for a user.
 * Incoming + outgoing queries run in parallel, then a single merged profile fetch.
 */
export async function fetchFriendRequests(userId: string): Promise<FriendRequest[]> {
  // Fire incoming + outgoing queries in parallel
  const [incomingResult, outgoingResult] = await Promise.all([
    supabase
      .from("friend_requests")
      .select("id, sender_id, receiver_id, status, created_at")
      .eq("receiver_id", userId)
      .eq("status", "pending"),
    supabase
      .from("friend_requests")
      .select("id, sender_id, receiver_id, status, created_at")
      .eq("sender_id", userId)
      .eq("status", "pending"),
  ]);

  if (incomingResult.error) throw incomingResult.error;
  if (outgoingResult.error) throw outgoingResult.error;

  const incomingRequests = incomingResult.data || [];
  const outgoingRequests = outgoingResult.data || [];

  // Batch-fetch ALL needed profiles in a SINGLE query (instead of two separate)
  const allProfileIds = [
    ...incomingRequests.map((r: any) => r.sender_id),
    ...outgoingRequests.map((r: any) => r.receiver_id),
  ];
  const uniqueProfileIds = [...new Set(allProfileIds)];

  let profilesMap = new Map<string, any>();
  if (uniqueProfileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, first_name, last_name, avatar_url, email")
      .in("id", uniqueProfileIds);
    profilesMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  }

  const transformed: FriendRequest[] = [];

  for (const request of incomingRequests) {
    const profile = profilesMap.get(request.sender_id);
    transformed.push({
      id: request.id,
      sender_id: request.sender_id,
      receiver_id: request.receiver_id,
      sender: {
        username: profile?.username || `user_${request.sender_id.substring(0, 8)}`,
        display_name:
          profile?.display_name ||
          (profile?.first_name && profile?.last_name
            ? `${profile.first_name} ${profile.last_name}`
            : undefined),
        first_name: profile?.first_name,
        last_name: profile?.last_name,
        avatar_url: profile?.avatar_url,
        email: profile?.email,
      },
      status: request.status,
      created_at: request.created_at,
      type: "incoming",
    });
  }

  for (const request of outgoingRequests) {
    const profile = profilesMap.get(request.receiver_id);
    transformed.push({
      id: request.id,
      sender_id: request.sender_id,
      receiver_id: request.receiver_id,
      sender: {
        username: profile?.username || `user_${request.receiver_id.substring(0, 8)}`,
        display_name:
          profile?.display_name ||
          (profile?.first_name && profile?.last_name
            ? `${profile.first_name} ${profile.last_name}`
            : undefined),
        first_name: profile?.first_name,
        last_name: profile?.last_name,
        avatar_url: profile?.avatar_url,
        email: profile?.email,
      },
      status: request.status,
      created_at: request.created_at,
      type: "outgoing",
    });
  }

  return transformed;
}

/**
 * Fetch blocked users for current user.
 */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const result = await blockService.getBlockedUsers();
  if (result.error) {
    console.error("Error fetching blocked users:", result.error);
    return [];
  }
  return result.data.map((b: any) => ({
    id: b.blocked_id,
    name:
      b.profile
        ? [b.profile.first_name, b.profile.last_name].filter(Boolean).join(" ") ||
          b.profile.display_name ||
          b.profile.username ||
          "Unknown"
        : "Unknown",
    username: b.profile?.username,
    avatar_url: undefined,
    blocked_at: b.created_at,
  }));
}
