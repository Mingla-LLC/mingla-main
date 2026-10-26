/**
 * Issue #4114 Wave 2b — the friends sheet and Add a friend, as pure logic.
 *
 * No React, no React Native, no Supabase: every rule the sheet shows lives
 * here so a Deno test can lock it (issue_4114_friends_sheet_model test).
 *
 *  - Requests → Received: a friend request that carries a hidden pair request
 *    (sent through "Add a friend") is ONE row with ONE Accept; a pair-only
 *    request from an existing friend is its own gold row.
 *  - Requests → Sent: friend requests, pair requests and phone invites, with a
 *    friend request and the pair request it gates folded into one row.
 *  - Paired: next-birthday label, the + tile's free-plan label.
 *  - Add a friend: the inline result card and the outcome after sending.
 *  - The combined Accept: friend accept, then the revealed pair accept, and
 *    what to show when either person is at the pairing limit.
 */

// ── Shapes (structural, so the screens' own types fit) ──────────────────────

export interface PersonLike {
  username?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

export interface FriendRequestLike {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
  type?: "incoming" | "outgoing";
  /** The OTHER person (useFriends maps the receiver here for outgoing rows). */
  sender?: PersonLike | null;
}

export interface VisiblePairRequestLike {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  createdAt: string;
}

export interface HiddenPairRequestLike {
  id: string;
  senderId: string;
  gatedByFriendRequestId: string | null;
  pendingPhoneE164: string | null;
}

export interface PairingPillLike {
  id: string;
  type: "active" | "pending_request" | "pending_invite";
  displayName: string;
  avatarUrl: string | null;
  pillState: string;
  pairedUserId: string | null;
  birthday: string | null;
  pairingId: string | null;
  pairRequestId: string | null;
  pendingInviteId: string | null;
  createdAt: string;
}

export interface LegacyPhoneInviteLike {
  id: string;
  phoneE164: string;
  createdAt: string;
}

export function personName(person: PersonLike | null | undefined, fallback = "Someone"): string {
  if (!person) return fallback;
  const display = (person.display_name ?? "").trim();
  if (display) return display;
  const full = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  const username = (person.username ?? "").trim();
  return username || fallback;
}

// ── Requests → Received ────────────────────────────────────────────────────

export type ReceivedRow =
  | {
      kind: "friend_pair";
      key: string;
      friendRequestId: string;
      pairRequestId: string;
      senderId: string;
      name: string;
      avatarUrl: string | null;
      createdAt: string;
      /** The pair request carries the invited number: they texted you. */
      invitedByText: boolean;
    }
  | {
      kind: "friend";
      key: string;
      friendRequestId: string;
      senderId: string;
      name: string;
      avatarUrl: string | null;
      createdAt: string;
    }
  | {
      kind: "pair";
      key: string;
      pairRequestId: string;
      senderId: string;
      name: string;
      avatarUrl: string | null;
      createdAt: string;
    };

export function buildReceivedRows(input: {
  incomingFriendRequests: readonly FriendRequestLike[];
  hiddenPairRequests: readonly HiddenPairRequestLike[];
  visiblePairRequests: readonly VisiblePairRequestLike[];
}): ReceivedRow[] {
  const hiddenByFriendRequest = new Map<string, HiddenPairRequestLike>();
  for (const hidden of input.hiddenPairRequests) {
    if (hidden.gatedByFriendRequestId) hiddenByFriendRequest.set(hidden.gatedByFriendRequestId, hidden);
  }
  const rows: ReceivedRow[] = [];
  for (const request of input.incomingFriendRequests) {
    if (request.status !== "pending") continue;
    const base = {
      friendRequestId: request.id,
      senderId: request.sender_id,
      name: personName(request.sender),
      avatarUrl: request.sender?.avatar_url ?? null,
      createdAt: request.created_at,
    };
    const hidden = hiddenByFriendRequest.get(request.id);
    if (hidden) {
      rows.push({
        kind: "friend_pair",
        key: `friend-pair-${request.id}`,
        pairRequestId: hidden.id,
        invitedByText: Boolean(hidden.pendingPhoneE164),
        ...base,
      });
    } else {
      rows.push({ kind: "friend", key: `friend-${request.id}`, ...base });
    }
  }
  for (const pair of input.visiblePairRequests) {
    rows.push({
      kind: "pair",
      key: `pair-${pair.id}`,
      pairRequestId: pair.id,
      senderId: pair.senderId,
      name: pair.senderName,
      avatarUrl: pair.senderAvatar,
      createdAt: pair.createdAt,
    });
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// ── Requests → Sent ────────────────────────────────────────────────────────

export type SentRow =
  | {
      kind: "friend_request";
      key: string;
      friendRequestId: string;
      name: string;
      avatarUrl: string | null;
      createdAt: string;
    }
  | {
      /** A friend request plus the pair request it gates ("Add a friend"). */
      kind: "friend_pair_request";
      key: string;
      pairRequestId: string;
      name: string;
      avatarUrl: string | null;
      createdAt: string;
    }
  | {
      kind: "pair_request";
      key: string;
      pairRequestId: string;
      name: string;
      avatarUrl: string | null;
      createdAt: string;
    }
  | {
      kind: "phone_invite";
      key: string;
      /** pending_pair_invites id (Add a friend) — cancelled via cancelPairInvite. */
      pairInviteId: string | null;
      /** Legacy pending_invites id (old friends-sheet invite) — cancelPendingInvite. */
      legacyInviteId: string | null;
      phoneE164: string;
      createdAt: string;
    };

const SENT_PAIR_STATES = new Set(["pending_active", "greyed_waiting_friend", "greyed_waiting_pair"]);

export function buildSentRows(input: {
  outgoingFriendRequests: readonly FriendRequestLike[];
  pairingPills: readonly PairingPillLike[];
  legacyPhoneInvites: readonly LegacyPhoneInviteLike[];
}): SentRow[] {
  const rows: SentRow[] = [];
  const foldedUserIds = new Set<string>();

  for (const pill of input.pairingPills) {
    if (pill.type === "pending_request" && pill.pairRequestId && SENT_PAIR_STATES.has(pill.pillState)) {
      const gatesFriendRequest = pill.pillState === "greyed_waiting_friend";
      if (gatesFriendRequest && pill.pairedUserId) foldedUserIds.add(pill.pairedUserId);
      rows.push({
        kind: gatesFriendRequest ? "friend_pair_request" : "pair_request",
        key: `pair-${pill.pairRequestId}`,
        pairRequestId: pill.pairRequestId,
        name: pill.displayName,
        avatarUrl: pill.avatarUrl,
        createdAt: pill.createdAt,
      });
    }
  }

  for (const request of input.outgoingFriendRequests) {
    if (request.status !== "pending") continue;
    if (foldedUserIds.has(request.receiver_id)) continue;
    rows.push({
      kind: "friend_request",
      key: `friend-${request.id}`,
      friendRequestId: request.id,
      name: personName(request.sender),
      avatarUrl: request.sender?.avatar_url ?? null,
      createdAt: request.created_at,
    });
  }

  const invitedPhones = new Set<string>();
  for (const pill of input.pairingPills) {
    if (pill.type === "pending_invite" && pill.pendingInviteId) {
      invitedPhones.add(pill.displayName);
      rows.push({
        kind: "phone_invite",
        key: `invite-${pill.pendingInviteId}`,
        pairInviteId: pill.pendingInviteId,
        legacyInviteId: null,
        phoneE164: pill.displayName,
        createdAt: pill.createdAt,
      });
    }
  }
  for (const invite of input.legacyPhoneInvites) {
    if (invitedPhones.has(invite.phoneE164)) continue;
    invitedPhones.add(invite.phoneE164);
    rows.push({
      kind: "phone_invite",
      key: `legacy-invite-${invite.id}`,
      pairInviteId: null,
      legacyInviteId: invite.id,
      phoneE164: invite.phoneE164,
      createdAt: invite.createdAt,
    });
  }

  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// ── Phone masking ──────────────────────────────────────────────────────────

/**
 * "+2348035554412" → "+234 803 ••• 4412". The dial code is the longest known
 * prefix (pass the country list's dial codes); unknown numbers keep "+" and
 * the first 3 digits.
 */
export function maskPhone(phoneE164: string, dialCodes: readonly string[] = []): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  if (digits.length < 7) return phoneE164;
  const known = [...dialCodes]
    .map((code) => code.replace(/[^\d]/g, ""))
    .filter((code) => code.length > 0 && digits.startsWith(code))
    .sort((a, b) => b.length - a.length)[0];
  const dial = known ?? digits.slice(0, Math.min(3, digits.length - 7));
  const national = digits.slice(dial.length);
  const head = national.slice(0, Math.min(3, Math.max(0, national.length - 4)));
  const tail = national.slice(-4);
  return [`+${dial}`, head, "•••", tail].filter(Boolean).join(" ");
}

// ── Paired section ─────────────────────────────────────────────────────────

export type BirthdayLabel =
  | { kind: "today" }
  | { kind: "in_days"; days: number }
  | { kind: "on_date"; month: number; day: number };

/** Next-birthday label: within 30 days → "in N days", else the date. */
export function nextBirthdayLabel(birthday: string | null | undefined, today: Date): BirthdayLabel | null {
  if (!birthday) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const nextIn = (year: number): number => {
    // 29 Feb falls on 1 Mar in non-leap years.
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCMonth() === month - 1 ? candidate.getTime() : Date.UTC(year, 2, 1);
  };
  let next = nextIn(today.getFullYear());
  if (next < start) next = nextIn(today.getFullYear() + 1);
  const days = Math.round((next - start) / 86_400_000);
  if (days === 0) return { kind: "today" };
  if (days <= 30) return { kind: "in_days", days };
  return { kind: "on_date", month, day };
}

export function activePairs(pills: readonly PairingPillLike[]): PairingPillLike[] {
  return pills.filter((pill) => pill.pillState === "active" && pill.pairedUserId);
}

/** The + tile: "1 of 1 free" on the free plan; at the limit it opens the paywall. */
export function pairTileState(input: { pairedCount: number; isUnlimited: boolean; freeLimit: number }): {
  showFreeCount: boolean;
  used: number;
  limit: number;
  atLimit: boolean;
} {
  if (input.isUnlimited) return { showFreeCount: false, used: input.pairedCount, limit: -1, atLimit: false };
  const limit = Math.max(1, input.freeLimit);
  return {
    showFreeCount: true,
    used: Math.min(input.pairedCount, limit),
    limit,
    atLimit: input.pairedCount >= limit,
  };
}

// ── Add a friend ───────────────────────────────────────────────────────────

export interface PhoneLookupLike {
  found: boolean;
  user: (PersonLike & { id: string; username?: string | null }) | null;
  friendship_status: "none" | "pending_sent" | "pending_received" | "friends";
}

export type AddFriendCard =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "error" }
  | { kind: "self" }
  | { kind: "found"; userId: string; name: string; username: string | null; avatarUrl: string | null }
  | { kind: "friends"; userId: string; name: string; username: string | null; avatarUrl: string | null }
  | { kind: "pending"; userId: string; name: string; username: string | null; avatarUrl: string | null }
  | { kind: "not_on_mingla" };

/** 7+ digits, the lookup has settled → the inline card (no alerts). */
export function addFriendCard(input: {
  digitCount: number;
  debouncing: boolean;
  loading: boolean;
  failed: boolean;
  lookup: PhoneLookupLike | null | undefined;
  currentUserId: string;
  /** People I already have a pending pair/friend request with (from pills). */
  pendingUserIds?: ReadonlySet<string>;
}): AddFriendCard {
  if (input.digitCount < 7) return { kind: "idle" };
  if (input.debouncing || input.loading) return { kind: "searching" };
  if (input.failed) return { kind: "error" };
  const lookup = input.lookup;
  if (!lookup) return { kind: "searching" };
  if (!lookup.found || !lookup.user) return { kind: "not_on_mingla" };
  const user = lookup.user;
  if (user.id === input.currentUserId) return { kind: "self" };
  const person = {
    userId: user.id,
    name: personName(user, "Mingla user"),
    username: user.username ?? null,
    avatarUrl: user.avatar_url ?? null,
  };
  if (lookup.friendship_status === "friends") return { kind: "friends", ...person };
  if (lookup.friendship_status !== "none" || input.pendingUserIds?.has(user.id)) return { kind: "pending", ...person };
  return { kind: "found", ...person };
}

/** What Add / Invite sends — always send-pair-request (add = pair). */
export function addFriendRequestBody(card: AddFriendCard, phoneE164: string): { friendUserId: string } | { phoneE164: string } | null {
  if (card.kind === "found") return { friendUserId: card.userId };
  if (card.kind === "not_on_mingla") return { phoneE164 };
  return null;
}

export interface SendResponseLike {
  tier: 1 | 2 | 3;
  friendOnly?: boolean;
  pairingLimitReached?: boolean;
  smsStatus?: "sent" | "failed";
  inviteLink?: string;
}

export type AddFriendOutcome =
  | { kind: "request_sent"; pairingLimitReached: boolean }
  | { kind: "invite_texted"; pairingLimitReached: boolean }
  | { kind: "invite_not_texted"; inviteLink: string | null; pairingLimitReached: boolean };

/** "Invite texted" ONLY when the server says the text went. */
export function addFriendOutcome(response: SendResponseLike): AddFriendOutcome {
  const pairingLimitReached = Boolean(response.pairingLimitReached || response.friendOnly);
  if (response.tier === 3) {
    return response.smsStatus === "sent"
      ? { kind: "invite_texted", pairingLimitReached }
      : { kind: "invite_not_texted", inviteLink: response.inviteLink ?? null, pairingLimitReached };
  }
  return { kind: "request_sent", pairingLimitReached };
}

// ── The combined Accept ────────────────────────────────────────────────────

export interface CombinedAcceptDeps {
  acceptFriend: (friendRequestId: string) => Promise<void>;
  acceptPair: (pairRequestId: string) => Promise<unknown>;
}

export type CombinedAcceptResult =
  | { friends: true; paired: true }
  /** Friends, but the pair hit a limit: 'mine' → paywall; 'theirs' → just friends. */
  | { friends: true; paired: false; limit: "mine" | "theirs" }
  | { friends: true; paired: false; limit: null; pairError: string };

function isLimitError(error: unknown): error is Error & { limitedUserId?: string | null } {
  return error instanceof Error && error.message.startsWith("pairing_limit_reached");
}

/**
 * ONE Accept for a request sent through "Add a friend": the friend accept (its
 * trigger reveals the hidden pair request), then the pair accept. A failed
 * friend accept throws (nothing changed); a failed pair accept still leaves you
 * friends and says why.
 */
export async function runCombinedAccept(
  row: { friendRequestId: string; pairRequestId: string },
  currentUserId: string,
  deps: CombinedAcceptDeps,
): Promise<CombinedAcceptResult> {
  await deps.acceptFriend(row.friendRequestId);
  try {
    await deps.acceptPair(row.pairRequestId);
    return { friends: true, paired: true };
  } catch (error) {
    if (isLimitError(error)) {
      const limited = error.limitedUserId ?? null;
      return { friends: true, paired: false, limit: limited && limited !== currentUserId ? "theirs" : "mine" };
    }
    return {
      friends: true,
      paired: false,
      limit: null,
      pairError: error instanceof Error ? error.message : String(error),
    };
  }
}
