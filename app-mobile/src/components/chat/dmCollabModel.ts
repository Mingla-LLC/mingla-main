/**
 * Issue #4114 Wave 5 — a collab inside a 1:1 chat.
 *
 * Pure, dependency-free rules shared by the 1:1 chat header, its menu, the
 * invite cards in the thread and the Chats list. Kept free of React Native
 * imports so Deno can run them (see
 * __tests__/issue_4114_dm_collab_model.implementor.happy.test.ts).
 *
 * The server owns the truth: `collaboration_sessions.conversation_id` links a
 * session to the 1:1 chat it was started from (start_dm_collab), and the chat
 * gets system rows with `card_payload.kind = 'dm_collab'` when the collab
 * starts, when the friend joins and when it ends.
 *
 * MINGLA-INVARIANT: I-4114-DM-COLLAB-ONE-LIVE | issue #4114 | A 1:1 chat holds at most one live collab (pending, active, voting or locked); the header offers Collab only to friends when none is live; the deck, matches and plans are driven by that session's id, never by the chat.
 */

/** Session states that count as "this chat has a live collab" (matches the SQL index). */
export const DM_COLLAB_LIVE_STATUSES = ["pending", "active", "voting", "locked"] as const;
export type DmCollabLiveStatus = (typeof DM_COLLAB_LIVE_STATUSES)[number];

export function isLiveSessionStatus(status: string | null | undefined): status is DmCollabLiveStatus {
  return (DM_COLLAB_LIVE_STATUSES as readonly string[]).includes(status ?? "");
}

export interface DmCollabParticipant {
  userId: string;
  hasAccepted: boolean;
}

export interface DmCollabSession {
  id: string;
  name: string;
  status: DmCollabLiveStatus;
  createdBy: string | null;
  createdAt: string;
  participants: DmCollabParticipant[];
}

/** Once the friend has joined, the session is past pending (the app activates it on the second accept). */
export function isDmCollabActive(session: DmCollabSession | null | undefined): boolean {
  return Boolean(session && session.status !== "pending");
}

/**
 * Issue #4114 QA (evidence 71b/72/73b): the friend's "joined" row lands while
 * the session is still `pending` (the app activates it in a later write), so
 * re-reading on that row alone left the starter's header stuck until a manual
 * refresh. While a session is pending the chat also watches that session's
 * status and re-reads when it changes. Returns the session id to watch, or null.
 */
export function dmCollabSessionToWatch(session: DmCollabSession | null | undefined): string | null {
  return session && session.status === "pending" ? session.id : null;
}

/**
 * What the right side of a 1:1 chat header shows.
 *  - `start`: the orange Collab button (a friend, nobody blocked, no live collab);
 *  - `pending`: the invite is out — nothing extra, the thread holds the cards;
 *  - `active`: the group collab header (Swipe + matches/plans strip);
 *  - `none`: not a 1:1 chat, not a friend, or still loading.
 */
export type DmCollabHeaderMode = "none" | "start" | "pending" | "active";

export function dmCollabHeaderMode(input: {
  isDirect: boolean;
  isFriend: boolean;
  session: DmCollabSession | null | undefined;
  loading: boolean;
}): DmCollabHeaderMode {
  if (!input.isDirect) return "none";
  if (input.session) return isDmCollabActive(input.session) ? "active" : "pending";
  if (input.loading || !input.isFriend) return "none";
  return "start";
}

// ── The system rows ──────────────────────────────────────────────────────
export type DmCollabEvent = "started" | "joined" | "ended";

export interface DmCollabEventPayload {
  kind: "dm_collab";
  event: DmCollabEvent;
  session_id: string;
  user_id: string | null;
}

export function isDmCollabEventPayload(payload: unknown): payload is DmCollabEventPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    value.kind === "dm_collab" &&
    (value.event === "started" || value.event === "joined" || value.event === "ended") &&
    typeof value.session_id === "string"
  );
}

/**
 * How a "started" row renders for the person looking at it.
 *  - `starter`: "You started a collab" + Set my vibes (while that collab is live);
 *  - `invitee`: "{name} started a collab with you" + Join / Not now (while the
 *    invite is still open);
 *  - `notice`: a plain centred line (joined, ended, or a started row whose
 *    collab is over or already joined).
 */
export type DmCollabCardView =
  | { kind: "starter" }
  | { kind: "invitee" }
  | { kind: "notice" };

export function dmCollabCardView(input: {
  payload: DmCollabEventPayload;
  session: DmCollabSession | null | undefined;
  currentUserId: string | null | undefined;
}): DmCollabCardView {
  const { payload, session, currentUserId } = input;
  if (payload.event !== "started" || !session || session.id !== payload.session_id || !currentUserId) {
    return { kind: "notice" };
  }
  if (payload.user_id === currentUserId) return { kind: "starter" };
  const me = session.participants.find((participant) => participant.userId === currentUserId);
  if (session.status === "pending" && me && !me.hasAccepted) return { kind: "invitee" };
  return { kind: "notice" };
}

/** The id of the newest dm_collab row, so the chat can refetch its session when one lands. */
export function latestDmCollabEventKey(
  messages: ReadonlyArray<{ id: string; cardPayload?: unknown; systemPayload?: unknown }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isDmCollabEventPayload(message.cardPayload) || isDmCollabEventPayload(message.systemPayload)) {
      return message.id;
    }
  }
  return null;
}

// ── Errors from start_dm_collab ──────────────────────────────────────────
export type DmCollabStartError = "limit" | "already_live" | "not_friends" | "blocked" | "unavailable" | "unknown";

export function parseDmCollabStartError(message: string | null | undefined): DmCollabStartError {
  const text = message ?? "";
  if (text.includes("session_limit_reached")) return "limit";
  if (text.includes("collab_already_live")) return "already_live";
  if (text.includes("not_friends")) return "not_friends";
  if (text.includes("blocked")) return "blocked";
  if (text.includes("conversation_unavailable")) return "unavailable";
  return "unknown";
}

/**
 * Should the Collab button open the paywall instead of starting? Decision D4:
 * a 1:1 collab counts toward the free plan's one open session, with the same
 * gate (useSessionCreationGate) and paywall (CustomPaywallScreen
 * `session_creation`) as a new group.
 */
export function dmCollabNeedsPaywall(gate: { canCreateSession: boolean; isUnlimited: boolean }): boolean {
  return !gate.canCreateSession && !gate.isUnlimited;
}
