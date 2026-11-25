// #4490 P6 — the member token and the member link.
//
// A member holds one token. It opens their member page (pass, what is left
// this month, the month to pay), pays the open month and lets them leave or
// pause. The database stores only sha256(token)
// (venue_membership_subscriptions.member_token_hash).
//
// Like the booking token (venueOfferBookingToken.ts) the token is DERIVED from
// the member id with the existing manage key ring, under its own label, so
// the email sender can re-derive it at send time and put a working link in
// the renewal email. No new secret name. When no key ring is installed the
// member gets a random token and the emails carry no link.
//
// Link: `<origin>/visit/plan/<subscriptionId>#t=<token>` (05 conflict 59). The
// token rides in the URL fragment, which browsers never send to a server.
import {
  readVenueReservationManageKeyRing,
  type VenueReservationManageKeyRing,
} from "./venueReservationManageToken.ts";
import {
  type AttentionKeySlot,
  constantTimeEqual,
} from "./sourceRefundAttentionToken.ts";
import {
  randomVenueOfferToken,
  VENUE_OFFER_TOKEN_RE,
  venueOfferTokenHashHex,
} from "./venueOfferBookingToken.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KID_RE = /^[a-z0-9_-]{1,16}$/;
const encoder = new TextEncoder();

/** Same shape as a booking token (derived `kid.mac` or random). */
export const VENUE_MEMBER_TOKEN_RE = VENUE_OFFER_TOKEN_RE;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export async function deriveVenueMemberToken(input: {
  subscriptionId: string;
  key: AttentionKeySlot;
}): Promise<string> {
  if (!UUID_RE.test(input.subscriptionId) || !KID_RE.test(input.key.kid)) {
    throw new Error("member_token_input_invalid");
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
        `venue_membership:v1:${input.key.kid}:${input.subscriptionId.toLowerCase()}`,
      ),
    ),
  );
  return `${input.key.kid}.${base64Url(mac)}`;
}

/** The token for a new member (derived when the key ring is installed). */
export async function issueVenueMemberToken(input: {
  subscriptionId: string;
  ring?: VenueReservationManageKeyRing;
}): Promise<{ token: string; derived: boolean }> {
  const ring = input.ring ?? readVenueReservationManageKeyRing();
  if (ring.ok) {
    try {
      return {
        token: await deriveVenueMemberToken({
          subscriptionId: input.subscriptionId,
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
 * Re-derive a member's token (current, then previous key) and return it only
 * when it hashes to the stored value; `null` when no working token can be
 * rebuilt.
 */
export async function rederiveVenueMemberToken(input: {
  subscriptionId: string;
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
      token = await deriveVenueMemberToken({
        subscriptionId: input.subscriptionId,
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

/** The member page link: `<origin>/visit/plan/<id>#t=<token>`. */
export function buildVenueMemberUrl(input: {
  origin: string;
  subscriptionId: string;
  token: string;
}): string {
  if (
    !UUID_RE.test(input.subscriptionId) ||
    !VENUE_MEMBER_TOKEN_RE.test(input.token)
  ) {
    throw new Error("member_link_input_invalid");
  }
  return `${input.origin}/visit/plan/${input.subscriptionId.toLowerCase()}#t=${
    encodeURIComponent(input.token)
  }`;
}

/**
 * The member id a well-formed member link opens, or null for anything else
 * (another origin or path, a query, extra fragment keys, a bad id or token).
 */
export function venueMemberUrlSubscriptionId(
  url: unknown,
  origin: string,
): string | null {
  if (typeof url !== "string" || url.length > 512) return null;
  const prefix = `${origin}/visit/plan/`;
  if (!url.startsWith(prefix)) return null;
  const match = url.slice(prefix.length).match(
    /^([0-9a-f-]{36})#t=([A-Za-z0-9_.-]{1,64})$/,
  );
  if (!match) return null;
  try {
    return buildVenueMemberUrl({
        origin,
        subscriptionId: match[1],
        token: match[2],
      }) === url
      ? match[1]
      : null;
  } catch {
    return null;
  }
}
