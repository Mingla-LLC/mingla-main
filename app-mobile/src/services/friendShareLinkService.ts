/**
 * Issue #4261 Wave B1 — the personal invite link RPCs (spec section 4.2).
 *
 * Transport errors throw (the hook surfaces them with a toast). The claim's
 * refusals come back as data, not throws, exactly as the RPC returns them.
 */
import { supabase } from "./supabase";
import { getDisplayName } from "../utils/getDisplayName";
import { readShareClaim, type ShareClaimReading } from "../utils/friendShareLink";
import type { FriendShareLinkInfo, FriendShareLinkReset } from "../types/chatPlans";

function parseJson(data: unknown): Record<string, unknown> {
  const value = typeof data === "string" ? JSON.parse(data) : data;
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  return value as Record<string, unknown>;
}

/** `get_or_create_friend_share_link()` — creates mine on first call. */
export async function getFriendShareLink(): Promise<FriendShareLinkInfo> {
  const { data, error } = await supabase.rpc("get_or_create_friend_share_link");
  if (error) throw new Error(error.message || "friend_share_link_failed");
  const row = parseJson(data);
  if (typeof row.token !== "string") throw new Error("invalid_response");
  return {
    token: row.token,
    referralCode: typeof row.referralCode === "string" ? row.referralCode : null,
    joinedCount: typeof row.joinedCount === "number" ? row.joinedCount : Number(row.joinedCount ?? 0) || 0,
  };
}

/** `reset_friend_share_link()` — the old link stops working. */
export async function resetFriendShareLink(): Promise<FriendShareLinkReset> {
  const { data, error } = await supabase.rpc("reset_friend_share_link");
  if (error) throw new Error(error.message || "friend_share_reset_failed");
  const row = parseJson(data);
  if (typeof row.token !== "string") throw new Error("invalid_response");
  return { token: row.token };
}

/** `claim_friend_share_link(p_token)` — refusals are returned, not thrown. */
export async function claimFriendShareLink(token: string): Promise<ShareClaimReading> {
  const { data, error } = await supabase.rpc("claim_friend_share_link", { p_token: token });
  if (error) throw new Error(error.message || "friend_share_claim_failed");
  return readShareClaim(data);
}

/** The name to show for the person whose link connected us ("You and Ada are friends"). */
export async function fetchPersonName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, display_name, username")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[friendShareLinkService] profile name read failed:", error.message);
    return null;
  }
  const name = getDisplayName(data, "");
  return name.length > 0 ? name : null;
}
