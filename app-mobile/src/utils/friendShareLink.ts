/**
 * Issue #4261 Wave B1 — the personal invite link, the group link, and the
 * decisions the app makes when one is opened.
 *
 * PURE by contract (Deno-unit-tested): no imports, no React Native, never
 * throws, never navigates. Services and screens call these; the rules live
 * here once.
 *
 * Links in this phase ride the Explorer OneLink (`EXPLORER_ONELINK_BASE`,
 * equal to `supabase/functions/_shared/friendInviteLink.ts`; a unit test pins
 * the two strings equal). A web landing page is a later phase.
 */

/** The Explorer OneLink: branded domain + template id. */
export const EXPLORER_ONELINK_BASE = "https://go.usemingla.com/w36m";

/** Share and group link tokens: `encode(gen_random_bytes(16), 'hex')`. */
const LINK_TOKEN_RE = /^[0-9a-f]{32}$/;
/** Same rule as oneLinkResolver.sanitizeReferralCode. */
const REFERRAL_CODE_RE = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;

export function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && LINK_TOKEN_RE.test(value);
}

function cleanReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return REFERRAL_CODE_RE.test(trimmed) ? trimmed : null;
}

/**
 * My personal invite link. Returns null without a valid token: the caller
 * must say the link failed, never fall back to the bare install link.
 */
export function buildFriendShareOneLink(input: {
  token: string | null | undefined;
  referralCode?: string | null;
}): string | null {
  if (!isLinkToken(input.token)) return null;
  const code = cleanReferralCode(input.referralCode);
  let url =
    `${EXPLORER_ONELINK_BASE}?pid=friend_invite&c=friend_share` +
    `&deep_link_value=friend_share&deep_link_sub1=${input.token}`;
  if (code) url += `&af_sub1=${encodeURIComponent(code)}`;
  return url;
}

/**
 * A group chat's link, carrying MY share token so whoever joins is connected
 * to me. Returns null without a valid group token. The share token is optional
 * (left out when mine could not be loaded or is malformed).
 */
export function buildGroupInviteOneLink(input: {
  groupToken: string | null | undefined;
  shareToken?: string | null;
  referralCode?: string | null;
}): string | null {
  if (!isLinkToken(input.groupToken)) return null;
  const code = cleanReferralCode(input.referralCode);
  let url =
    `${EXPLORER_ONELINK_BASE}?pid=group_invite&c=group_link` +
    `&deep_link_value=group_invite&deep_link_sub1=${input.groupToken}`;
  if (isLinkToken(input.shareToken)) url += `&deep_link_sub2=${input.shareToken}`;
  if (code) url += `&af_sub1=${encodeURIComponent(code)}`;
  return url;
}

/** What the group info card shows for the link: `go.usemingla.com/…a1b2c3`. */
export function groupLinkDisplay(token: string | null | undefined): string | null {
  if (!isLinkToken(token)) return null;
  return `go.usemingla.com/…${token.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// The held invite (pendingFriendInvite.ts): which claim runs
// ---------------------------------------------------------------------------

/** `invite` = a phone text invite (claim_friend_invite); `share` = a personal link. */
export type PendingInviteKind = "invite" | "share";

/** Stored v1 values have no kind: they were phone invites. */
export function normalizePendingInviteKind(raw: unknown): PendingInviteKind {
  return raw === "share" ? "share" : "invite";
}

export function claimRpcForPendingInvite(
  kind: PendingInviteKind,
): "claim_friend_invite" | "claim_friend_share_link" {
  switch (kind) {
    case "share":
      return "claim_friend_share_link";
    case "invite":
      return "claim_friend_invite";
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** Refusals that will never succeed on retry: the held token is dropped. */
export const TERMINAL_INVITE_REFUSALS: readonly string[] = [
  "invalid_token",
  "own_invite",
  "own_link",
  "invite_cancelled",
  "already_claimed",
  "unavailable",
];

export type ShareClaimReading =
  | {
      status: "claimed";
      ownerId: string;
      friendRequestId: string | null;
      /** A new friendship was made by this claim (not already friends). */
      connected: boolean;
      /** Tell the link owner "… joined from your invite" (first connect only). */
      notifyOwner: boolean;
    }
  | { status: "refused"; reason: string };

/** Read the jsonb `claim_friend_share_link` returns. */
export function readShareClaim(data: unknown): ShareClaimReading {
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { status: "refused", reason: "unknown" };
    }
  }
  if (!value || typeof value !== "object") return { status: "refused", reason: "unknown" };
  const row = value as Record<string, unknown>;
  if (row.success === true && typeof row.ownerId === "string" && row.ownerId.length > 0) {
    const connected = row.outcome === "connected";
    return {
      status: "claimed",
      ownerId: row.ownerId,
      friendRequestId: typeof row.friendRequestId === "string" ? row.friendRequestId : null,
      connected,
      notifyOwner: connected && row.alreadyClaimed === false,
    };
  }
  return { status: "refused", reason: typeof row.error === "string" ? row.error : "unknown" };
}

/** The body for `send-friend-accepted-notification` after a share claim. */
export function shareJoinedNotificationBody(
  myUserId: string | null | undefined,
  claim: ShareClaimReading,
): { accepterId: string; senderId: string; requestId: string; source: "share_link" } | null {
  if (!myUserId || claim.status !== "claimed" || !claim.notifyOwner || !claim.friendRequestId) return null;
  return { accepterId: myUserId, senderId: claim.ownerId, requestId: claim.friendRequestId, source: "share_link" };
}

// ---------------------------------------------------------------------------
// Opening a group link: what the app does with join_group_by_link's answer
// ---------------------------------------------------------------------------

export type GroupJoinToastKey =
  | "chat:group_join_requested"
  | "chat:group_link_reset_toast"
  | "chat:group_link_unavailable"
  | "chat:plan_action_failed";

export type GroupJoinAction =
  | { type: "open_chat"; conversationId: string; sessionId: string | null }
  | { type: "accept_then_open"; conversationId: string; sessionId: string; inviteId: string }
  | { type: "toast"; key: GroupJoinToastKey; tone: "info" | "error" };

/** `mingla://chat/<id>?type=group[&sessionId=<id>]` (deepLinkService `chat`). */
export function groupChatUrl(conversationId: string, sessionId?: string | null): string {
  const base = `mingla://chat/${encodeURIComponent(conversationId)}?type=group`;
  return sessionId ? `${base}&sessionId=${encodeURIComponent(sessionId)}` : base;
}

/**
 * Map `join_group_by_link` (its result, or the raised error code) to one
 * action. Never a half-formed navigation: a result missing the ids it needs
 * becomes the generic failure toast.
 */
export function groupJoinAction(
  result: {
    status?: unknown;
    conversationId?: unknown;
    sessionId?: unknown;
    inviteId?: unknown;
  } | null,
  errorCode: string | null,
): GroupJoinAction {
  if (errorCode) {
    if (errorCode === "not_found") return { type: "toast", key: "chat:group_link_reset_toast", tone: "error" };
    if (errorCode === "unavailable" || errorCode === "not_allowed" || errorCode === "conflict_group_full") {
      return { type: "toast", key: "chat:group_link_unavailable", tone: "error" };
    }
    return { type: "toast", key: "chat:plan_action_failed", tone: "error" };
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const conversationId = str(result?.conversationId);
  const sessionId = str(result?.sessionId);
  const inviteId = str(result?.inviteId);
  switch (result?.status) {
    case "joined":
    case "already_member":
      return conversationId
        ? { type: "open_chat", conversationId, sessionId }
        : { type: "toast", key: "chat:plan_action_failed", tone: "error" };
    case "invited":
      return conversationId && sessionId && inviteId
        ? { type: "accept_then_open", conversationId, sessionId, inviteId }
        : { type: "toast", key: "chat:plan_action_failed", tone: "error" };
    case "requested":
      return { type: "toast", key: "chat:group_join_requested", tone: "info" };
    default:
      return { type: "toast", key: "chat:plan_action_failed", tone: "error" };
  }
}

/** The error code a Supabase RPC error carries in `message` (spec section 3). */
export function rpcErrorCode(error: { message?: unknown } | null | undefined): string | null {
  if (!error) return null;
  return typeof error.message === "string" && error.message.length > 0 ? error.message : "unknown";
}
