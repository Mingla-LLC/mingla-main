/**
 * Issue #4114 Wave 2b — hold a friend invite token from a text-invite OneLink
 * (deep_link_value=friend_invite) until the person has a verified phone, then
 * claim it with claim_friend_invite. Mirrors pendingFollowInvite.ts: memory +
 * AsyncStorage so the token survives the store install and the onboarding steps.
 *
 * The claim covers the case where the invitee signs up with a DIFFERENT number
 * than the one invited; when they use the invited number the phone-verified
 * trigger has already converted the invite and the claim is a no-op read-back.
 *
 * Issue #4261 — the same slot also holds a personal invite link
 * (deep_link_value=friend_share, `kind: 'share'`), claimed with
 * claim_friend_share_link. A share claim connects straight away (no pending
 * request) and, the first time, tells the link owner "… joined from your
 * invite". Stored v1 values have no kind and stay phone invites.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, trackedInvoke } from "./supabase";
import { refreshChatListAfterConversationChange } from "./chatListRefresh";
import {
  claimRpcForPendingInvite,
  normalizePendingInviteKind,
  readShareClaim,
  shareJoinedNotificationBody,
  TERMINAL_INVITE_REFUSALS,
  type PendingInviteKind,
} from "../utils/friendShareLink";

const KEY = "mingla_pending_friend_invite_v1";
// Invites have no expiry server-side; drop a held token after 30 days.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PendingFriendInvite = {
  token: string;
  ts: number;
  /** #4261: which claim runs. Missing on stored v1 values (= 'invite'). */
  kind?: PendingInviteKind;
  /** Set once claimed: whose invite it was (drives the onboarding card). */
  inviterId?: string;
};

export type ClaimFriendInviteResult =
  | {
      status: "claimed";
      kind: PendingInviteKind;
      inviterId: string;
      friendRequestId: string | null;
      pairRequestId: string | null;
      /**
       * #4261 share claims: this claim made the friendship (false when they
       * were already friends). Share claims never leave a request to accept.
       */
      connected: boolean;
    }
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
  memory = { token, ts: Date.now(), kind: "invite" };
  emit();
  await persist();
}

/** Issue #4261 — hold a personal invite link token (friend_share). */
export async function setPendingFriendShare(token: string): Promise<void> {
  memory = { token, ts: Date.now(), kind: "share" };
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
    memory = { ...parsed, kind: normalizePendingInviteKind(parsed.kind) };
    emit();
    return memory;
  } catch (e) {
    console.warn("[pendingFriendInvite] hydrate failed", e);
    return null;
  }
}

/** Refusals that will never succeed on retry: drop the held token. */
const TERMINAL_REFUSALS = new Set(TERMINAL_INVITE_REFUSALS);

/**
 * Claim the held invite, if any, for the signed-in user. Idempotent server-side,
 * so calling it after phone verification AND again on the friends step is safe.
 * Keeps the inviter id after a successful claim (the onboarding card reads it).
 * The id is only ever trusted from a fresh server answer for this account.
 */
export async function claimPendingFriendInvite(): Promise<ClaimFriendInviteResult> {
  const held = await hydratePendingFriendInvite();
  if (!held) return { status: "none" };
  const kind = normalizePendingInviteKind(held.kind);
  // Always ask the server (idempotent): a repeat from the same account reads
  // back the same rows; a different account on this device gets already_claimed
  // and the held token is dropped, so no one sees another account's inviter.
  const rpc = claimRpcForPendingInvite(kind);
  const { data, error } = await supabase.rpc(rpc, { p_token: held.token });
  if (error) {
    console.warn(`[pendingFriendInvite] ${rpc} failed:`, error.message);
    return { status: "error", message: error.message };
  }

  if (kind === "share") {
    const claim = readShareClaim(data);
    if (claim.status === "claimed") {
      memory = { ...held, kind, inviterId: claim.ownerId };
      emit();
      await persist();
      // #4261: the new friendship changes who the Chats list shows (#4265's
      // useChatList entry is marked stale through chatListKeys.all).
      refreshChatListAfterConversationChange();
      // Tell the link owner once: the server returns alreadyClaimed=false only
      // on the claim that made the friendship.
      const { data: session } = await supabase.auth.getSession();
      const body = shareJoinedNotificationBody(session.session?.user.id, claim);
      if (body) {
        trackedInvoke("send-friend-accepted-notification", { body }).catch((notifyErr: unknown) => {
          console.warn("[pendingFriendInvite] share joined notification failed:", notifyErr);
        });
      }
      return {
        status: "claimed",
        kind,
        inviterId: claim.ownerId,
        friendRequestId: claim.friendRequestId,
        pairRequestId: null,
        connected: claim.connected,
      };
    }
    if (TERMINAL_REFUSALS.has(claim.reason)) await clearPendingFriendInvite();
    return { status: "refused", reason: claim.reason };
  }

  const result = (typeof data === "string" ? JSON.parse(data) : data) as {
    success?: boolean;
    error?: string;
    inviter_id?: string;
    friend_request_id?: string | null;
    pair_request_id?: string | null;
  } | null;
  if (result?.success && result.inviter_id) {
    memory = { ...held, kind, inviterId: result.inviter_id };
    emit();
    await persist();
    return {
      status: "claimed",
      kind,
      inviterId: result.inviter_id,
      friendRequestId: result.friend_request_id ?? null,
      pairRequestId: result.pair_request_id ?? null,
      connected: false,
    };
  }
  const reason = result?.error ?? "unknown";
  if (TERMINAL_REFUSALS.has(reason)) await clearPendingFriendInvite();
  return { status: "refused", reason };
}
