import { supabase, supabaseUrl } from "./supabase";
import { generateInitials } from "../utils/stringUtils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PairingPill {
  id: string;
  type: "active" | "pending_request" | "pending_invite";
  displayName: string;
  firstName: string | null;
  avatarUrl: string | null;
  initials: string;
  pillState:
    | "active"
    | "pending_active"
    | "greyed_waiting_friend"
    | "greyed_waiting_pair"
    | "greyed_waiting_signup";
  statusMessage: string | null;
  pairedUserId: string | null;
  birthday: string | null;
  gender: string | null;
  pairingId: string | null;
  pairRequestId: string | null;
  pendingInviteId: string | null;
  createdAt: string;
}

export interface PairRequest {
  id: string;
  senderId: string;
  receiverId: string;
  senderName: string;
  senderAvatar: string | null;
  receiverName: string;
  receiverAvatar: string | null;
  status: "pending" | "accepted" | "declined" | "cancelled" | "unpaired";
  visibility: "visible" | "hidden_until_friend";
  createdAt: string;
}

export interface SendPairRequestResponse {
  success: boolean;
  tier: 1 | 2 | 3;
  requestId?: string;
  inviteId?: string;
  message: string;
  pillState:
    | "pending_active"
    | "greyed_waiting_friend"
    | "greyed_waiting_signup";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// ── Service Functions ───────────────────────────────────────────────────────

/**
 * Fetch all pairings + pending pair requests for pill rendering.
 * Returns a sorted list: active first, then pending by createdAt desc.
 */
export async function fetchPairingPills(userId: string): Promise<PairingPill[]> {
  const pills: PairingPill[] = [];

  // 1. Query active pairings (a row existing in pairings IS the active state — no status column)
  const { data: pairings, error: pairingsError } = await supabase
    .from("pairings")
    .select(`
      id,
      user_a_id,
      user_b_id,
      pair_request_id,
      created_at
    `)
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

  if (pairingsError) throw new Error(pairingsError.message);

  if (pairings && pairings.length > 0) {
    // Get the partner user IDs
    const partnerIds = pairings.map((p) =>
      p.user_a_id === userId ? p.user_b_id : p.user_a_id
    );

    // Batch-fetch partner profiles
    const { data: partnerProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, display_name, first_name, last_name, avatar_url, birthday, gender")
      .in("id", partnerIds);

    if (profilesError) throw new Error(profilesError.message);

    const profileMap = new Map(
      (partnerProfiles || []).map((p) => [p.id, p])
    );

    for (const pairing of pairings) {
      const partnerId =
        pairing.user_a_id === userId ? pairing.user_b_id : pairing.user_a_id;
      const profile = profileMap.get(partnerId);
      const displayName =
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
        profile?.display_name ||
        "Unknown";

      pills.push({
        id: `pairing-${pairing.id}`,
        type: "active",
        displayName,
        firstName: profile?.first_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        initials: generateInitials(displayName),
        pillState: "active",
        statusMessage: null,
        pairedUserId: partnerId,
        birthday: profile?.birthday ?? null,
        gender: profile?.gender ?? null,
        pairingId: pairing.id,
        pairRequestId: pairing.pair_request_id ?? null,
        pendingInviteId: null,
        createdAt: pairing.created_at,
      });
    }
  }

  // 2. Query outgoing pending pair_requests
  const { data: outgoingRequests, error: requestsError } = await supabase
    .from("pair_requests")
    .select(`
      id,
      sender_id,
      receiver_id,
      status,
      visibility,
      gated_by_friend_request_id,
      created_at
    `)
    .eq("sender_id", userId)
    .eq("status", "pending");

  if (requestsError) throw new Error(requestsError.message);

  if (outgoingRequests && outgoingRequests.length > 0) {
    // Batch-fetch receiver profiles
    const receiverIds = outgoingRequests.map((r) => r.receiver_id);
    const { data: receiverProfiles, error: recProfilesError } = await supabase
      .from("profiles")
      .select("id, display_name, first_name, last_name, avatar_url, birthday, gender")
      .in("id", receiverIds);

    if (recProfilesError) throw new Error(recProfilesError.message);

    const recProfileMap = new Map(
      (receiverProfiles || []).map((p) => [p.id, p])
    );

    // For hidden_until_friend requests, check gated friend_request status
    const gatedFrIds = outgoingRequests
      .filter((r) => r.visibility === "hidden_until_friend" && r.gated_by_friend_request_id)
      .map((r) => r.gated_by_friend_request_id!);

    let friendRequestMap = new Map<string, string>();
    if (gatedFrIds.length > 0) {
      const { data: friendRequests, error: frError } = await supabase
        .from("friend_requests")
        .select("id, status")
        .in("id", gatedFrIds);

      if (!frError && friendRequests) {
        friendRequestMap = new Map(
          friendRequests.map((fr) => [fr.id, fr.status])
        );
      }
    }

    for (const request of outgoingRequests) {
      const profile = recProfileMap.get(request.receiver_id);
      const displayName =
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
        profile?.display_name ||
        "Unknown";

      let pillState: PairingPill["pillState"];
      if (request.visibility === "visible") {
        // Tier 1: friend exists, waiting for pair accept
        pillState = "pending_active";
      } else {
        // Tier 2: hidden_until_friend — check gated friend_request status
        const frStatus = request.gated_by_friend_request_id
          ? friendRequestMap.get(request.gated_by_friend_request_id)
          : undefined;
        if (frStatus === "accepted") {
          pillState = "greyed_waiting_pair";
        } else {
          pillState = "greyed_waiting_friend";
        }
      }

      pills.push({
        id: `request-${request.id}`,
        type: "pending_request",
        displayName,
        firstName: profile?.first_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        initials: generateInitials(displayName),
        pillState,
        statusMessage: null,
        pairedUserId: request.receiver_id,
        birthday: profile?.birthday ?? null,
        gender: profile?.gender ?? null,
        pairingId: null,
        pairRequestId: request.id,
        pendingInviteId: null,
        createdAt: request.created_at,
      });
    }
  }

  // 3. Query pending_pair_invites (Tier 3 pre-signup)
  const { data: pendingInvites, error: invitesError } = await supabase
    .from("pending_pair_invites")
    .select(`
      id,
      inviter_id,
      phone_e164,
      status,
      created_at
    `)
    .eq("inviter_id", userId)
    .eq("status", "pending");

  if (invitesError) throw new Error(invitesError.message);

  if (pendingInvites && pendingInvites.length > 0) {
    for (const invite of pendingInvites) {
      const displayName = invite.phone_e164;
      pills.push({
        id: `invite-${invite.id}`,
        type: "pending_invite",
        displayName,
        firstName: null,
        avatarUrl: null,
        initials: generateInitials(displayName),
        pillState: "greyed_waiting_signup",
        statusMessage: null,
        pairedUserId: null,
        birthday: null,
        gender: null,
        pairingId: null,
        pairRequestId: null,
        pendingInviteId: invite.id,
        createdAt: invite.created_at,
      });
    }
  }

  // 4. Sort: active first, then pending by createdAt desc
  pills.sort((a, b) => {
    if (a.pillState === "active" && b.pillState !== "active") return -1;
    if (a.pillState !== "active" && b.pillState === "active") return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return pills;
}

/**
 * Fetch incoming visible pair requests (for notifications).
 */
export async function fetchIncomingPairRequests(userId: string): Promise<PairRequest[]> {
  const { data: requests, error } = await supabase
    .from("pair_requests")
    .select(`
      id,
      sender_id,
      receiver_id,
      status,
      visibility,
      created_at
    `)
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .eq("visibility", "visible");

  if (error) throw new Error(error.message);
  if (!requests || requests.length === 0) return [];

  // Batch-fetch sender and receiver profiles
  const allUserIds = [
    ...new Set(requests.flatMap((r) => [r.sender_id, r.receiver_id])),
  ];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, first_name, last_name, avatar_url")
    .in("id", allUserIds);

  if (profilesError) throw new Error(profilesError.message);

  const profileMap = new Map(
    (profiles || []).map((p) => [p.id, p])
  );

  const getDisplayName = (profile: { first_name?: string | null; last_name?: string | null; display_name?: string | null } | undefined): string =>
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.display_name ||
    "Unknown";

  return requests.map((r) => {
    const senderProfile = profileMap.get(r.sender_id);
    const receiverProfile = profileMap.get(r.receiver_id);

    return {
      id: r.id,
      senderId: r.sender_id,
      receiverId: r.receiver_id,
      senderName: getDisplayName(senderProfile),
      senderAvatar: senderProfile?.avatar_url ?? null,
      receiverName: getDisplayName(receiverProfile),
      receiverAvatar: receiverProfile?.avatar_url ?? null,
      status: r.status,
      visibility: r.visibility,
      createdAt: r.created_at,
    };
  });
}

/**
 * Send pair request (calls edge function).
 * Uses the edge function error handling pattern: read as .text() first, then JSON.parse().
 */
export async function sendPairRequest(params: {
  friendUserId?: string;
  phoneE164?: string;
}): Promise<SendPairRequestResponse> {
  const token = await getAuthToken();

  const response = await fetch(
    `${supabaseUrl}/functions/v1/send-pair-request`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    }
  );

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from server: ${text}`);
  }

  if (!response.ok) {
    throw new Error(parsed.error || parsed.message || "Failed to send pair request");
  }

  return parsed;
}

/**
 * Accept pair request (calls RPC).
 */
export async function acceptPairRequest(
  requestId: string
): Promise<{ pairingId: string; pairedWithUserId: string }> {
  const { data, error } = await supabase.rpc("accept_pair_request_atomic", {
    p_request_id: requestId,
  });

  if (error) throw new Error(error.message);

  // The RPC returns a JSON result — parse if it's a string
  const result = typeof data === "string" ? JSON.parse(data) : data;

  return {
    pairingId: result.pairing_id,
    pairedWithUserId: result.paired_with_user_id,
  };
}

/**
 * Decline pair request.
 */
export async function declinePairRequest(requestId: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from("pair_requests")
    .update({ status: "declined" })
    .eq("id", requestId)
    .eq("receiver_id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Cancel outgoing pair request.
 * Also cancels the gated friend_request if it was created by this pairing flow.
 */
export async function cancelPairRequest(requestId: string): Promise<void> {
  const userId = await getCurrentUserId();

  // 1. Fetch the pair_request to get gated_by_friend_request_id
  const { data: request, error: fetchError } = await supabase
    .from("pair_requests")
    .select("id, sender_id, gated_by_friend_request_id")
    .eq("id", requestId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  // 2. Update pair_requests set status = 'cancelled'
  const { error: updateError } = await supabase
    .from("pair_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("sender_id", userId);

  if (updateError) throw new Error(updateError.message);

  // 3. If gated_by_friend_request_id exists, also cancel that friend_request
  //    ONLY if the friend_request sender matches the pair_request sender
  if (request.gated_by_friend_request_id) {
    const { error: frError } = await supabase
      .from("friend_requests")
      .update({ status: "declined" })
      .eq("id", request.gated_by_friend_request_id)
      .eq("sender_id", request.sender_id);

    if (frError) {
      console.warn(
        "[pairingService] Failed to cancel gated friend_request:",
        frError.message
      );
    }
  }
}

/**
 * Cancel pending invite (Tier 3 pre-conversion).
 */
export async function cancelPairInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from("pending_pair_invites")
    .update({ status: "cancelled" })
    .eq("id", inviteId);

  if (error) throw new Error(error.message);
}

/**
 * Unpair — delete the pairing and mark the associated pair_request as 'unpaired'.
 */
export async function unpair(pairingId: string): Promise<void> {
  // 1. Fetch the pairing to get pair_request_id
  const { data: pairing, error: fetchError } = await supabase
    .from("pairings")
    .select("id, pair_request_id")
    .eq("id", pairingId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  // 2. Delete from pairings (CASCADE handles custom_holidays, etc.)
  const { error: deleteError } = await supabase
    .from("pairings")
    .delete()
    .eq("id", pairingId);

  if (deleteError) throw new Error(deleteError.message);

  // 3. Update the associated pair_request to 'unpaired'
  if (pairing.pair_request_id) {
    const { error: updateError } = await supabase
      .from("pair_requests")
      .update({ status: "unpaired" })
      .eq("id", pairing.pair_request_id);

    if (updateError) {
      console.warn(
        "[pairingService] Failed to update pair_request status to unpaired:",
        updateError.message
      );
    }
  }
}
