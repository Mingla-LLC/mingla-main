import { supabase } from "./supabase";
import { extractFunctionError } from "../utils/edgeFunctionError";

export interface PendingLinkConsent {
  linkId: string;
  friendUserId: string;
  friendName: string;
  friendAvatarUrl: string | null;
  createdAt: string;
}

export interface LinkConsentResponse {
  status: "pending" | "consented" | "declined";
  linkStatus: string;
  personId?: string;
  linkedPersonId?: string;
}

/**
 * Fetch all friend_links where the current user has pending link consent.
 * Returns links where status='accepted' AND link_status='pending_consent'
 * AND the user's consent field is still false.
 */
export async function getPendingLinkConsents(
  userId: string
): Promise<PendingLinkConsent[]> {
  // Links where user is requester and hasn't consented
  const { data: asRequester, error: err1 } = await supabase
    .from("friend_links")
    .select("id, target_id, accepted_at")
    .eq("requester_id", userId)
    .eq("status", "accepted")
    .eq("link_status", "pending_consent")
    .eq("requester_link_consent", false);

  // Links where user is target and hasn't consented
  const { data: asTarget, error: err2 } = await supabase
    .from("friend_links")
    .select("id, requester_id, accepted_at")
    .eq("target_id", userId)
    .eq("status", "accepted")
    .eq("link_status", "pending_consent")
    .eq("target_link_consent", false);

  if (err1 || err2) {
    // Gracefully handle missing columns (migration not yet applied)
    const msg = err1?.message || err2?.message || "";
    if (msg.includes("does not exist")) {
      console.warn("[LinkConsent] link_consent columns not found — migration may not be applied yet");
      return [];
    }
    if (err1) throw new Error(err1.message);
    if (err2) throw new Error(err2.message);
  }

  // Collect friend user IDs
  const friendIds: string[] = [
    ...(asRequester || []).map((l: any) => l.target_id),
    ...(asTarget || []).map((l: any) => l.requester_id),
  ];

  if (friendIds.length === 0) return [];

  // Fetch friend profiles
  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", friendIds);

  if (profileErr) throw new Error(profileErr.message);

  const profileMap = new Map(
    (profiles || []).map((p: any) => [p.id, p])
  );

  // Build result
  const results: PendingLinkConsent[] = [];

  for (const link of asRequester || []) {
    const profile = profileMap.get(link.target_id);
    results.push({
      linkId: link.id,
      friendUserId: link.target_id,
      friendName: profile?.display_name || profile?.username || "Friend",
      friendAvatarUrl: profile?.avatar_url || null,
      createdAt: link.accepted_at,
    });
  }

  for (const link of asTarget || []) {
    const profile = profileMap.get(link.requester_id);
    results.push({
      linkId: link.id,
      friendUserId: link.requester_id,
      friendName: profile?.display_name || profile?.username || "Friend",
      friendAvatarUrl: profile?.avatar_url || null,
      createdAt: link.accepted_at,
    });
  }

  return results;
}

/**
 * Respond to a link consent prompt (accept or decline).
 */
export async function respondToLinkConsent(
  linkId: string,
  action: "accept" | "decline"
): Promise<LinkConsentResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const { data, error } = await supabase.functions.invoke(
    "respond-link-consent",
    {
      body: { linkId, action },
    }
  );

  if (error) {
    const msg = await extractFunctionError(error, "Failed to respond to link consent");
    throw new Error(msg);
  }

  return data as LinkConsentResponse;
}
