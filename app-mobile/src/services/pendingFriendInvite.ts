/**
 * Issue #4114 Wave 2b — hold a friend invite token from a text-invite OneLink
 * (deep_link_value=friend_invite) until the person has a verified phone, then
 * claim it with claim_friend_invite. Mirrors pendingFollowInvite.ts: memory +
 * AsyncStorage so the token survives the store install and the onboarding steps.
 *
 * The claim covers the case where the invitee signs up with a DIFFERENT number
 * than the one invited; when they use the invited number the phone-verified
 * trigger has already converted the invite and the claim is a no-op read-back.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const KEY = "mingla_pending_friend_invite_v1";
// Invites have no expiry server-side; drop a held token after 30 days.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PendingFriendInvite = {
  token: string;
  ts: number;
  /** Set once claimed: whose invite it was (drives the onboarding card). */
  inviterId?: string;
};

export type ClaimFriendInviteResult =
  | { status: "claimed"; inviterId: string; friendRequestId: string | null; pairRequestId: string | null }
  | { status: "none" }
  | { status: "refused"; reason: string }
  | { status: "error"; message: string };

let memory: PendingFriendInvite | null = null;
const listeners = new Set<(p: PendingFriendInvite | null) => void>();

function emit(): void {
  for (const l of listeners) l(memory);
}

async function persist(): Promise<void> {
  try {
    if (memory) await AsyncStorage.setItem(KEY, JSON.stringify(memory));
    else await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn("[pendingFriendInvite] persist failed", e);
  }
}

export function subscribePendingFriendInvite(
  listener: (p: PendingFriendInvite | null) => void,
): () => void {
  listeners.add(listener);
  listener(memory);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingFriendInvite(): PendingFriendInvite | null {
  return memory;
}

export async function setPendingFriendInvite(token: string): Promise<void> {
  memory = { token, ts: Date.now() };
  emit();
  await persist();
}

export async function clearPendingFriendInvite(): Promise<void> {
  memory = null;
  emit();
  await persist();
}

export async function hydratePendingFriendInvite(): Promise<PendingFriendInvite | null> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingFriendInvite;
    if (typeof parsed?.token !== "string" || parsed.token.length === 0) return null;
    if (Date.now() - (parsed.ts ?? 0) > MAX_AGE_MS) {
      await clearPendingFriendInvite();
      return null;
    }
    memory = parsed;
    emit();
    return memory;
  } catch (e) {
    console.warn("[pendingFriendInvite] hydrate failed", e);
    return null;
  }
}

/** Refusals that will never succeed on retry: drop the held token. */
const TERMINAL_REFUSALS = new Set(["invalid_token", "own_invite", "invite_cancelled", "already_claimed", "unavailable"]);

/**
 * Claim the held invite, if any, for the signed-in user. Idempotent server-side,
 * so calling it after phone verification AND again on the friends step is safe.
 * Keeps the inviter id after a successful claim (the onboarding card reads it).
 */
export async function claimPendingFriendInvite(): Promise<ClaimFriendInviteResult> {
  const held = await hydratePendingFriendInvite();
  if (!held) return { status: "none" };
  if (held.inviterId) {
    return { status: "claimed", inviterId: held.inviterId, friendRequestId: null, pairRequestId: null };
  }
  const { data, error } = await supabase.rpc("claim_friend_invite", { p_token: held.token });
  if (error) {
    console.warn("[pendingFriendInvite] claim_friend_invite failed:", error.message);
    return { status: "error", message: error.message };
  }
  const result = (typeof data === "string" ? JSON.parse(data) : data) as {
    success?: boolean;
    error?: string;
    inviter_id?: string;
    friend_request_id?: string | null;
    pair_request_id?: string | null;
  } | null;
  if (result?.success && result.inviter_id) {
    memory = { ...held, inviterId: result.inviter_id };
    emit();
    await persist();
    return {
      status: "claimed",
      inviterId: result.inviter_id,
      friendRequestId: result.friend_request_id ?? null,
      pairRequestId: result.pair_request_id ?? null,
    };
  }
  const reason = result?.error ?? "unknown";
  if (TERMINAL_REFUSALS.has(reason)) await clearPendingFriendInvite();
  return { status: "refused", reason };
}
