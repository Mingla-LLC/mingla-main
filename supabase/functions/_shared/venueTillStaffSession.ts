// #4490 spec 08 O5 part A — the PIN session on a shared Till device login.
//
// A Till device login (the venue.till_device capability, the Till released at
// that venue) has every Till sale, payment, refund, void and close action
// refused unless the request body carries `staffSession` (the token from
// "Who's selling?"). The server then acts as the PIN member, with that
// member's own rights at that venue (never more), and records the device user.
// An account that is not a Till device is never gated: its actor and device
// are itself, exactly as before.
//
// The token travels in the POST body only (never a URL or a header a proxy
// logs). Only its sha256 reaches the database. Neither the token nor a PIN is
// ever logged, returned in an error or put in an audit row.
//
// Parts B and C call resolveTillActor (who is acting, which device) and
// requireStepUp (a fresh PIN at that moment, with money rights) exactly as
// venue-till does; the database side re-checks the session in the same
// transaction as the write (issue_4490_pin_actor_assert).

// deno-lint-ignore no-explicit-any
type Client = any;

export const STAFF_SESSION_RE = /^[0-9a-f]{64}$/;
export const STAFF_PIN_RE = /^[0-9]{4,6}$/;

export type StepUpPurpose =
  | "refund"
  | "void_sent"
  | "reopen"
  | "export"
  | "swap_refund"
  | "sign_out";

export type TillActor = {
  /** Who acts: the PIN member on a Till device, else the signed-in account. */
  actorUserId: string;
  /** The signed-in account (the device on a Till device login). */
  deviceUserId: string;
  isDevice: boolean;
  sessionId: string | null;
  memberId: string | null;
  /** sha256 of the token as a Postgres bytea literal (only when isDevice). */
  tokenHash: string | null;
  authSessionId: string | null;
};

export type TillActorResult =
  | { ok: true; actor: TillActor }
  | { ok: false; status: number; code: string };

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256 of the token's 32 bytes, as `\x…` for a bytea argument. */
export async function staffTokenHash(token: string): Promise<string | null> {
  if (!STAFF_SESSION_RE.test(token)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(token.slice(i * 2, i * 2 + 2), 16);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `\\x${hexOf(digest)}`;
}

/**
 * The auth session id of a bearer the caller has ALREADY verified with
 * auth.getUser (we only read a claim; the signature was checked there). A PIN
 * session is bound to it, so signing the device out (a new sign-in is a new
 * auth session) ends every PIN session of that device everywhere.
 */
export function jwtAuthSessionId(jwt: string): string | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(
      part.replace(/-/g, "+").replace(/_/g, "/").padEnd(
        Math.ceil(part.length / 4) * 4,
        "=",
      ),
    );
    const claims = JSON.parse(json) as Record<string, unknown>;
    const id = claims.session_id;
    return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)
      ? id.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** PostgREST / Postgres "function does not exist" (the migration not applied yet). */
export function isMissingPinFunction(
  error: { code?: unknown; message?: unknown } | null | undefined,
): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/**
 * #4490 08-O5 fix 3: is this account a Till device at this venue by its grant
 * (the venue.till_device capability), read straight from the tables. Used only
 * when the PIN gate function cannot be found, so a Till device login never
 * acts as itself (fail closed). A failed read answers "unknown" (null).
 */
export async function hasTillDeviceGrant(
  client: Client,
  venueId: string,
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await client.from("brand_team_member_venue_grants")
    .select("venue_id, capabilities, brand_team_members!inner(user_id, removed_at)")
    .eq("venue_id", venueId)
    .eq("brand_team_members.user_id", userId)
    .is("brand_team_members.removed_at", null)
    .contains("capabilities", ["venue.till_device"])
    .limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Who acts for this request at venueId.
 * - [TRANSITIONAL] deploy order (#4490 O5): while issue_4490_pin_gate does not
 *   exist (this function deployed before migration 20281203684490) an account
 *   that is not a Till device runs exactly as before O5. A Till device login
 *   (or one whose grant cannot be read) is refused: it never acts as itself
 *   (#4490 08-O5 fix 3, fail closed). Any other error fails closed. Exit: the
 *   migration applied in production.
 */
export async function resolveTillActor(
  client: Client,
  input: {
    venueId: string;
    userId: string;
    jwt: string;
    staffSession: unknown;
  },
): Promise<TillActorResult> {
  const self: TillActor = {
    actorUserId: input.userId,
    deviceUserId: input.userId,
    isDevice: false,
    sessionId: null,
    memberId: null,
    tokenHash: null,
    authSessionId: null,
  };
  const gate = await client.rpc("issue_4490_pin_gate", {
    p_venue_id: input.venueId,
    p_user_id: input.userId,
  });
  if (gate.error) {
    if (isMissingPinFunction(gate.error)) {
      const device = await hasTillDeviceGrant(client, input.venueId, input.userId);
      if (device === false) return { ok: true, actor: self };
      console.error("[till-pin] gate missing; Till device or unknown grant refused");
      return { ok: false, status: 503, code: "till_failed" };
    }
    console.error("[till-pin] gate lookup failed", gate.error.code);
    return { ok: false, status: 500, code: "till_failed" };
  }
  if (gate.data !== true) return { ok: true, actor: self };
  const token = typeof input.staffSession === "string"
    ? input.staffSession
    : "";
  const tokenHash = await staffTokenHash(token);
  if (tokenHash === null) {
    return { ok: false, status: 401, code: "pin_session_required" };
  }
  const authSessionId = jwtAuthSessionId(input.jwt);
  const resolved = await client.rpc("issue_4490_pin_session_resolve", {
    p_token_hash: tokenHash,
    p_device_user: input.userId,
    p_venue_id: input.venueId,
    p_auth_session: authSessionId,
  });
  if (resolved.error) {
    if (resolved.error.message === "pin_session_invalid") {
      return { ok: false, status: 401, code: "pin_session_invalid" };
    }
    console.error("[till-pin] session resolve failed", resolved.error.code);
    return { ok: false, status: 500, code: "till_failed" };
  }
  const data = resolved.data as Record<string, unknown>;
  return {
    ok: true,
    actor: {
      actorUserId: String(data.memberUserId),
      deviceUserId: input.userId,
      isDevice: true,
      sessionId: String(data.sessionId),
      memberId: String(data.memberId),
      tokenHash,
      authSessionId,
    },
  };
}

export type StepUpResult =
  | { ok: true; approverUserId: string; approvalId: string }
  | { ok: false; status: number; body: Record<string, unknown> };

/** The PIN answers the client maps to copy (tillCopy.ts). */
export function pinRefusal(
  result: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } {
  switch (result.reason) {
    case "wrong":
      return {
        status: 403,
        body: {
          code: "pin_wrong",
          triesLeft: typeof result.triesLeft === "number"
            ? result.triesLeft
            : null,
        },
      };
    case "locked":
      return {
        status: 403,
        body: { code: "pin_locked", lockedUntil: result.lockedUntil ?? null },
      };
    case "hard_locked":
      return { status: 403, body: { code: "pin_hard_locked" } };
    case "device_limited":
      return { status: 429, body: { code: "pin_device_limited" } };
    case "no_rights":
      return { status: 403, body: { code: "pin_no_rights" } };
    default:
      return { status: 403, body: { code: "pin_wrong", triesLeft: null } };
  }
}

/**
 * Step-up: a fresh PIN at this moment, by the person selling or by a manager
 * on the spot (`stepUp: { pin, memberId? }` in the body). The person entering
 * the PIN must hold money rights at the venue (manager rights for sign_out).
 * On success the action runs as the approver; the seller's session goes on.
 * Only for a Till device (an account signed in as itself never steps up).
 */
export async function requireStepUp(
  client: Client,
  input: {
    venueId: string;
    actor: TillActor;
    stepUp: unknown;
    purpose: StepUpPurpose;
    target: string | null;
  },
): Promise<StepUpResult> {
  const raw = input.stepUp !== null && typeof input.stepUp === "object" &&
      !Array.isArray(input.stepUp)
    ? input.stepUp as Record<string, unknown>
    : null;
  const pin = typeof raw?.pin === "string" ? raw.pin : "";
  const memberId = typeof raw?.memberId === "string" ? raw.memberId : null;
  if (!raw || !STAFF_PIN_RE.test(pin)) {
    return { ok: false, status: 403, body: { code: "pin_step_up_required" } };
  }
  if (memberId !== null && !/^[0-9a-f-]{36}$/i.test(memberId)) {
    return { ok: false, status: 400, body: { code: "till_invalid_payload" } };
  }
  const { data, error } = await client.rpc("issue_4490_pin_approve", {
    p_token_hash: input.actor.tokenHash,
    p_device_user: input.actor.deviceUserId,
    p_venue_id: input.venueId,
    p_auth_session: input.actor.authSessionId,
    p_member: memberId,
    p_pin: pin,
    p_purpose: input.purpose,
    p_target: input.target,
  });
  if (error) {
    if (error.message === "pin_session_invalid") {
      return { ok: false, status: 401, body: { code: "pin_session_invalid" } };
    }
    console.error("[till-pin] approve failed", error.code);
    return { ok: false, status: 500, body: { code: "till_failed" } };
  }
  const result = data as Record<string, unknown>;
  if (result?.ok !== true) {
    const refusal = pinRefusal(result ?? {});
    return { ok: false, status: refusal.status, body: refusal.body };
  }
  return {
    ok: true,
    approverUserId: String(result.approverUserId),
    approvalId: String(result.approvalId),
  };
}
