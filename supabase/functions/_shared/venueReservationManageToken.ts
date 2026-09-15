// ===========================================================================
// #3392 — the guest's venue-booking manage token, DERIVED instead of random.
// ---------------------------------------------------------------------------
// Before: `venue-reservation-create` minted a random token for web bookings, the
// guest's browser held the only plaintext and the database kept only its hash
// (#1221). A confirmation email sent a minute later had no token to put in a
// link, so neither the free nor the paid confirmation email could offer
// "Manage or cancel".
//
// Now (Seth approved, 2026-09-15 — the credential sits in the guest's inbox and
// cancel stays behind the manage page's confirmation step):
//
//   token = "<kid>." + base64url(HMAC-SHA256(key,
//             "venue_reservation_manage:v1:<kid>:<checkout_session_id>"))
//
// Same shape and key format as the refund-attention token
// (sourceRefundAttentionToken.ts): a key id for rotation, a 32-byte key, the
// same token grammar, and its constant-time compare.
//
// WHY THE CHECKOUT SESSION ID, NOT THE RESERVATION ID. The session row is where
// the credential hash lives (`reservation_checkout_sessions.guest_cancel_token_
// hash`), and on the PAID path the reservation does not exist yet when the token
// must be issued: it is minted after payment, while the browser needs the token
// (it doubles as the `bst` status token) before it leaves for Stripe or
// Paystack. The session is 1:1 with the booking on both paths, so binding to it
// gives the free and paid paths one rule.
//
// What does NOT change: `venue-reservation-create` still stores only
// 'v1:' || sha256(token); the manage page, `venue-reservation-refund-status`,
// `venue-reservation-cancel` and the #1221 guest RPCs hash whatever token they
// are given, so derived tokens and every existing random token keep working.
//
// FAIL CLOSED, NEVER BREAK A BOOKING OR AN EMAIL. The key lives in four fields
// of the governed `AD_CONVERSION_TOKENS` envelope (not a new secret name — the
// production set is pinned at 88, COMMS-0177). When the fields are absent or
// invalid: create falls back to today's random token, and the email is sent
// without the link. Nothing here throws on configuration.
// ===========================================================================

import {
  type AttentionKeySlot,
  constantTimeEqual,
} from "./sourceRefundAttentionToken.ts";
import { guestCancelTokenHash } from "./guestReservationManageView.ts";
import { buildVenueReservationManageUrl } from "./venueReservationManageLink.ts";

export const VENUE_RESERVATION_MANAGE_TOKEN_FIELDS = {
  currentKid: "VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KID",
  currentKey: "VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KEY_B64",
  previousKid: "VENUE_RESERVATION_MANAGE_TOKEN_PREVIOUS_KID",
  previousKey: "VENUE_RESERVATION_MANAGE_TOKEN_PREVIOUS_KEY_B64",
} as const;

export type VenueReservationManageKeyRing =
  | {
    ok: true;
    current: AttentionKeySlot;
    previous: AttentionKeySlot | null;
  }
  | { ok: false; reason: "manage_key_absent" | "manage_key_invalid" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KID_RE = /^[a-z0-9_-]{1,16}$/;
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

// Canonical standard Base64 of exactly 32 bytes — the refund-attention rule.
function decodeCanonicalKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return null;
  }
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (
    decoded.length !== 32 || btoa(String.fromCharCode(...decoded)) !== value
  ) {
    return null;
  }
  return decoded;
}

type SlotRead = { slot: AttentionKeySlot } | { absent: true } | {
  invalid: true;
};

function readSlot(
  bundle: Record<string, unknown>,
  kidField: string,
  keyField: string,
): SlotRead {
  const kid = bundle[kidField];
  const key = bundle[keyField];
  if (kid === undefined && key === undefined) return { absent: true };
  const decoded = decodeCanonicalKey(key);
  if (typeof kid !== "string" || !KID_RE.test(kid) || decoded === null) {
    return { invalid: true };
  }
  return { slot: { kid, key: decoded } };
}

/**
 * Read the manage-token key ring from the governed envelope. Never throws and
 * never returns key material in an error: callers get a safe reason code.
 */
export function readVenueReservationManageKeyRing(
  raw: string | undefined = Deno.env.get("AD_CONVERSION_TOKENS"),
): VenueReservationManageKeyRing {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, reason: "manage_key_absent" };
  }
  let bundle: unknown;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "manage_key_invalid" };
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return { ok: false, reason: "manage_key_invalid" };
  }
  const record = bundle as Record<string, unknown>;
  const current = readSlot(
    record,
    VENUE_RESERVATION_MANAGE_TOKEN_FIELDS.currentKid,
    VENUE_RESERVATION_MANAGE_TOKEN_FIELDS.currentKey,
  );
  const previous = readSlot(
    record,
    VENUE_RESERVATION_MANAGE_TOKEN_FIELDS.previousKid,
    VENUE_RESERVATION_MANAGE_TOKEN_FIELDS.previousKey,
  );
  if ("absent" in current) {
    // A lone previous slot with no current one is a broken rotation, not an
    // uninstalled key.
    return {
      ok: false,
      reason: "absent" in previous ? "manage_key_absent" : "manage_key_invalid",
    };
  }
  if ("invalid" in current || "invalid" in previous) {
    return { ok: false, reason: "manage_key_invalid" };
  }
  const prior = "slot" in previous ? previous.slot : null;
  if (
    prior !== null &&
    (prior.kid === current.slot.kid ||
      prior.key.every((byte, index) => byte === current.slot.key[index]))
  ) {
    return { ok: false, reason: "manage_key_invalid" };
  }
  return { ok: true, current: current.slot, previous: prior };
}

export async function deriveVenueReservationManageToken(input: {
  checkoutSessionId: string;
  key: AttentionKeySlot;
}): Promise<string> {
  if (!UUID_RE.test(input.checkoutSessionId) || !KID_RE.test(input.key.kid)) {
    throw new Error("manage_token_input_invalid");
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(input.key.key).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(
        `venue_reservation_manage:v1:${input.key.kid}:${input.checkoutSessionId.toLowerCase()}`,
      ),
    ),
  );
  return `${input.key.kid}.${base64Url(mac)}`;
}

/**
 * The manage token `venue-reservation-create` issues for a WEB booking whose
 * checkout session row will carry `checkoutSessionId`. Derived with the current
 * key when the key ring is installed; otherwise today's random token, so a
 * missing key can never block a booking (that booking's email simply has no
 * link). The caller stores only the hash.
 */
export async function issueWebGuestManageToken(input: {
  checkoutSessionId: string;
  randomToken: () => string;
  ring?: VenueReservationManageKeyRing;
}): Promise<{ token: string; derived: boolean; reason: string | null }> {
  const ring = input.ring ?? readVenueReservationManageKeyRing();
  if (!ring.ok) {
    return { token: input.randomToken(), derived: false, reason: ring.reason };
  }
  try {
    return {
      token: await deriveVenueReservationManageToken({
        checkoutSessionId: input.checkoutSessionId,
        key: ring.current,
      }),
      derived: true,
      reason: null,
    };
  } catch {
    return {
      token: input.randomToken(),
      derived: false,
      reason: "manage_token_input_invalid",
    };
  }
}

export type VenueReservationManageLinkResult =
  | { url: string; reason: null }
  | {
    url: null;
    reason:
      | "manage_key_absent"
      | "manage_key_invalid"
      | "reservation_id_invalid"
      | "session_lookup_failed"
      | "no_web_session"
      | "token_not_derived";
  };

// deno-lint-ignore no-explicit-any
type QueryClient = { from: (table: string) => any };

/**
 * Re-derive a booking's manage token at SEND time and return its link — but only
 * when the derived token hashes to the credential that booking actually stores.
 * A random-token booking (created before the key was installed, or by a native
 * client), an app booking with no guest credential, or a key rotated out of the
 * ring all return `url: null`: an email must never carry a link that 404s.
 *
 * The plaintext token exists only in the returned URL, in memory.
 */
export async function resolveVenueReservationManageLink(
  client: QueryClient,
  input: { reservationId: string; ring: VenueReservationManageKeyRing },
): Promise<VenueReservationManageLinkResult> {
  if (!input.ring.ok) return { url: null, reason: input.ring.reason };
  if (!UUID_RE.test(input.reservationId)) {
    return { url: null, reason: "reservation_id_invalid" };
  }
  const { data, error } = await client
    .from("reservation_checkout_sessions")
    .select("id, brand_id, guest_cancel_token_hash")
    .eq("reservation_id", input.reservationId)
    .eq("created_via", "web")
    .limit(5);
  if (error) return { url: null, reason: "session_lookup_failed" };
  const sessions = (Array.isArray(data) ? data : []).filter((
    row: Record<string, unknown>,
  ) =>
    typeof row?.id === "string" && typeof row.brand_id === "string" &&
    typeof row.guest_cancel_token_hash === "string" &&
    row.guest_cancel_token_hash.length > 0
  ) as Array<{ id: string; brand_id: string; guest_cancel_token_hash: string }>;
  if (sessions.length === 0) return { url: null, reason: "no_web_session" };

  const slots = [input.ring.current, input.ring.previous].filter(
    Boolean,
  ) as AttentionKeySlot[];
  for (const session of sessions) {
    for (const key of slots) {
      let token: string;
      try {
        token = await deriveVenueReservationManageToken({
          checkoutSessionId: session.id,
          key,
        });
      } catch {
        continue;
      }
      if (
        constantTimeEqual(
          await guestCancelTokenHash(token),
          session.guest_cancel_token_hash,
        )
      ) {
        return {
          url: buildVenueReservationManageUrl({
            brandId: session.brand_id,
            reservationId: input.reservationId,
            token,
          }),
          reason: null,
        };
      }
    }
  }
  return { url: null, reason: "token_not_derived" };
}
