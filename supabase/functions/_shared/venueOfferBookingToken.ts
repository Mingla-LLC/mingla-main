// #4490 — the guest's venue-offer booking token.
//
// A signed-out buyer holds one token per booking. It opens the booking page,
// pays its outstanding stage, and cancels. The database stores only
// sha256(token) (stay_reservation_groups.buyer_token_hash).
//
// The token is DERIVED from the booking id with the existing venue-reservation
// manage key ring (same governed envelope fields, no new secret name), so the
// email sender can re-derive it at send time and put a working link in the
// email. Rotation: the sender tries the current then the previous key and uses
// whichever hashes to the stored value. When no key ring is installed the
// booking gets a random token (the email then carries no link). Nothing here
// throws on configuration.
import {
  readVenueReservationManageKeyRing,
  type VenueReservationManageKeyRing,
} from "./venueReservationManageToken.ts";
import {
  type AttentionKeySlot,
  constantTimeEqual,
} from "./sourceRefundAttentionToken.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KID_RE = /^[a-z0-9_-]{1,16}$/;
/** A derived (`kid.mac`) or random (43 base64url chars) booking token. */
export const VENUE_OFFER_TOKEN_RE =
  /^(?:[a-z0-9_-]{1,16}\.)?[A-Za-z0-9_-]{43}$/;

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export function randomVenueOfferToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveVenueOfferBookingToken(input: {
  groupId: string;
  key: AttentionKeySlot;
}): Promise<string> {
  if (!UUID_RE.test(input.groupId) || !KID_RE.test(input.key.kid)) {
    throw new Error("booking_token_input_invalid");
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
        `venue_offer_booking:v1:${input.key.kid}:${input.groupId.toLowerCase()}`,
      ),
    ),
  );
  return `${input.key.kid}.${base64Url(mac)}`;
}

/** SHA-256 of the token, hex (what the database stores, as bytea). */
export async function venueOfferTokenHashHex(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(token)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** The Postgres bytea literal PostgREST expects for an RPC argument. */
export async function venueOfferTokenHashParam(token: string): Promise<string> {
  return `\\x${await venueOfferTokenHashHex(token)}`;
}

/**
 * The token for a new booking: derived from the booking id when the key ring
 * is installed, otherwise random (`derived: false`).
 */
export async function issueVenueOfferBookingToken(input: {
  groupId: string;
  ring?: VenueReservationManageKeyRing;
}): Promise<{ token: string; derived: boolean }> {
  const ring = input.ring ?? readVenueReservationManageKeyRing();
  if (ring.ok) {
    try {
      return {
        token: await deriveVenueOfferBookingToken({
          groupId: input.groupId,
          key: ring.current,
        }),
        derived: true,
      };
    } catch {
      // fall through to a random token
    }
  }
  return { token: randomVenueOfferToken(), derived: false };
}

/**
 * Re-derive a booking's token (current, then previous key) and return it only
 * when it hashes to the stored value. Used by the hold replay and by the email
 * sender at send time. `null` means no working token can be rebuilt.
 */
export async function rederiveVenueOfferBookingToken(input: {
  groupId: string;
  storedHashHex: string | null;
  ring?: VenueReservationManageKeyRing;
}): Promise<string | null> {
  const ring = input.ring ?? readVenueReservationManageKeyRing();
  if (!ring.ok || !input.storedHashHex) return null;
  const stored = input.storedHashHex.replace(/^\\x/, "").toLowerCase();
  for (const key of [ring.current, ring.previous]) {
    if (!key) continue;
    let token: string;
    try {
      token = await deriveVenueOfferBookingToken({
        groupId: input.groupId,
        key,
      });
    } catch {
      continue;
    }
    if (constantTimeEqual(await venueOfferTokenHashHex(token), stored)) {
      return token;
    }
  }
  return null;
}
