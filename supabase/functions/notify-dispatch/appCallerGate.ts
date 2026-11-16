// notify-dispatch: who may send what.
//
// Server callers (other edge functions, database triggers, cron) send with the
// service-role key and keep every option. A signed-in app may only send the
// group notices the Explorer app has always sent from the device, only to
// people in that group, and only while it is (or was a moment ago) an accepted
// member of it. A "group was deleted" notice goes out only once the group is
// really gone.

/** The notice types the Explorer app sends from the device (1.1.0 onwards). */
export const APP_SESSION_NOTICE_TYPES: ReadonlySet<string> = new Set([
  "session_member_joined",
  "session_member_left",
  "session_deleted",
  "board_card_saved",
  "board_card_voted",
  "board_card_rsvp",
]);

/** How long a "deleted" notice waits for the group to be gone. */
export const SESSION_GONE_WAIT_MS = 8_000;
export const SESSION_GONE_POLL_MS = 2_000;

export function bearerToken(authorization: string | null): string | null {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/** The `role` claim of a JWT, or null. The gateway has already checked the signature. */
export function jwtRole(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

/** True for the service-role key (exact match, or a service-role JWT such as the database's copy). */
export function isServerCaller(authorization: string | null, serviceRoleKey: string): boolean {
  const token = bearerToken(authorization);
  if (!token) return false;
  if (serviceRoleKey.length > 0 && token === serviceRoleKey) return true;
  return jwtRole(token) === "service_role";
}

export interface SessionNoticeFacts {
  session_exists: boolean;
  sender_member: boolean;
  recipient_member: boolean;
}

export interface AppCallerDeps {
  /** The signed-in user behind the token, or null. */
  userIdForToken(token: string): Promise<string | null>;
  /** The database's membership check, or null when it could not run. */
  sessionFacts(sessionId: string, senderId: string, recipientId: string): Promise<SessionNoticeFacts | null>;
}

export type AppCallerDecision =
  | {
    allowed: true;
    senderId: string;
    sessionId: string;
    /** The request to dispatch, with server-only options removed. */
    payload: Record<string, unknown>;
    /** A "deleted" notice for a group that still exists: send only once it is gone. */
    waitForSessionGone: boolean;
  }
  | { allowed: false; status: number; reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Decide whether a signed-in app's request may be dispatched, and in what form. */
export async function authorizeAppCaller(
  authorization: string | null,
  payload: Record<string, unknown>,
  deps: AppCallerDeps,
): Promise<AppCallerDecision> {
  const token = bearerToken(authorization);
  if (!token) return { allowed: false, status: 401, reason: "unauthorized" };
  if (typeof payload.category_key === "string" && payload.category_key.length > 0) {
    return { allowed: false, status: 403, reason: "not_allowed" };
  }
  const senderId = await deps.userIdForToken(token);
  if (!senderId) return { allowed: false, status: 401, reason: "unauthorized" };

  const type = payload.type;
  const recipientId = payload.userId;
  const data = asRecord(payload.data);
  const sessionId = typeof data.sessionId === "string" && data.sessionId.length > 0
    ? data.sessionId
    : payload.relatedType === "session" && typeof payload.relatedId === "string"
    ? payload.relatedId
    : null;
  if (
    typeof type !== "string" || !APP_SESSION_NOTICE_TYPES.has(type) ||
    typeof recipientId !== "string" || !UUID_RE.test(recipientId) ||
    !sessionId || !UUID_RE.test(sessionId) ||
    recipientId === senderId ||
    payload.emailTo || payload.transientPayLinkPush === true
  ) {
    return { allowed: false, status: 403, reason: "not_allowed" };
  }

  const facts = await deps.sessionFacts(sessionId, senderId, recipientId);
  if (!facts) return { allowed: false, status: 503, reason: "check_unavailable" };
  if (!facts.sender_member || !facts.recipient_member) {
    return { allowed: false, status: 403, reason: "not_allowed" };
  }
  if (type !== "session_deleted" && !facts.session_exists) {
    return { allowed: false, status: 403, reason: "not_allowed" };
  }

  const overrides = asRecord(payload.pushOverrides);
  const pushOverrides: Record<string, unknown> = {};
  if (typeof overrides.collapseId === "string") pushOverrides.collapseId = overrides.collapseId;
  if (typeof overrides.androidChannelId === "string") pushOverrides.androidChannelId = overrides.androidChannelId;

  const sanitized: Record<string, unknown> = {
    userId: recipientId,
    type,
    title: payload.title,
    body: payload.body,
    data,
    actorId: typeof payload.actorId === "string" ? payload.actorId : senderId,
    relatedId: payload.relatedId,
    relatedType: payload.relatedType,
    // App keys live in their own namespace so they can never take a key a
    // server notice will use.
    idempotencyKey: typeof payload.idempotencyKey === "string" && payload.idempotencyKey.length > 0
      ? `app:${payload.idempotencyKey}`
      : `app:${type}:${sessionId}:${recipientId}:${Math.floor(Date.now() / 300_000)}`,
    pushOverrides,
  };
  return {
    allowed: true,
    senderId,
    sessionId,
    payload: sanitized,
    waitForSessionGone: type === "session_deleted" && facts.session_exists,
  };
}

/** Polls until the session is gone or the wait runs out. True when gone. */
export async function waitForSessionGone(
  sessionExists: () => Promise<boolean | null>,
  sleep: (ms: number) => Promise<void>,
  waitMs: number = SESSION_GONE_WAIT_MS,
  pollMs: number = SESSION_GONE_POLL_MS,
): Promise<boolean> {
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    await sleep(pollMs);
    const exists = await sessionExists();
    if (exists === false) return true;
  }
  return false;
}
