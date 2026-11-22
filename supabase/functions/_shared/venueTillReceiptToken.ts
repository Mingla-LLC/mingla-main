// #4490 spec 08 O1 (T20) — the private receipt link for a Till payment.
//
// Like the member token (venueMembershipToken.ts) the token is DERIVED from
// the payment id with the existing manage key ring, under its own label, so
// the outbox drain can re-derive it when a receipt is SENT and put a working
// link in that text or email (05: guest links are generated at send time,
// never stored). The database keeps only sha256(token)
// (venue_till_payments.receipt_token_hash). No new secret name. With no key
// ring installed a receipt is still sent, without a link.
//
// Link: `<origin>/receipt/till/<paymentId>#t=<token>`. The token rides in the
// URL fragment, which browsers never send to a server; the page keeps it on
// the device and scrubs it from the address bar.
import {
  readVenueReservationManageKeyRing,
  type VenueReservationManageKeyRing,
} from "./venueReservationManageToken.ts";
import {
  type AttentionKeySlot,
  constantTimeEqual,
} from "./sourceRefundAttentionToken.ts";
import { venueOfferTokenHashHex } from "./venueOfferBookingToken.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KID_RE = /^[a-z0-9_-]{1,16}$/;
/** A derived receipt token: `kid.mac` (43 base64url characters). */
export const TILL_RECEIPT_TOKEN_RE = /^[a-z0-9_-]{1,16}\.[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export async function deriveTillReceiptToken(input: {
  paymentId: string;
  key: AttentionKeySlot;
}): Promise<string> {
  if (!UUID_RE.test(input.paymentId) || !KID_RE.test(input.key.kid)) {
    throw new Error("receipt_token_input_invalid");
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
        `venue_till_receipt:v1:${input.key.kid}:${input.paymentId.toLowerCase()}`,
      ),
    ),
  );
  return `${input.key.kid}.${base64Url(mac)}`;
}

/** sha256(token) as hex: what the database stores (bytea). */
export function tillReceiptTokenHashHex(token: string): Promise<string> {
  return venueOfferTokenHashHex(token);
}

/**
 * The token's hash for a payment's first receipt: derived with the current
 * key when the ring is installed, otherwise a random token nobody can rebuild
 * (the receipt then goes without a link).
 */
export async function issueTillReceiptTokenHash(input: {
  paymentId: string;
  ring?: VenueReservationManageKeyRing;
}): Promise<{ hashHex: string; derived: boolean }> {
  const ring = input.ring ?? readVenueReservationManageKeyRing();
  if (ring.ok) {
    try {
      const token = await deriveTillReceiptToken({
        paymentId: input.paymentId,
        key: ring.current,
      });
      return { hashHex: await tillReceiptTokenHashHex(token), derived: true };
    } catch {
      // fall through
    }
  }
  const random = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { hashHex: await tillReceiptTokenHashHex(random), derived: false };
}

/**
 * Re-derive a payment's token (current, then previous key) and return it only
 * when it hashes to the stored value; null when no working token exists.
 */
export async function rederiveTillReceiptToken(input: {
  paymentId: string;
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
      token = await deriveTillReceiptToken({ paymentId: input.paymentId, key });
    } catch {
      continue;
    }
    if (constantTimeEqual(await tillReceiptTokenHashHex(token), stored)) {
      return token;
    }
  }
  return null;
}

/** `<origin>/receipt/till/<paymentId>#t=<token>`. */
export function buildTillReceiptUrl(input: {
  origin: string;
  paymentId: string;
  token: string;
}): string {
  if (
    !UUID_RE.test(input.paymentId) || !TILL_RECEIPT_TOKEN_RE.test(input.token)
  ) {
    throw new Error("receipt_link_input_invalid");
  }
  return `${input.origin}/receipt/till/${input.paymentId.toLowerCase()}#t=${
    encodeURIComponent(input.token)
  }`;
}

/**
 * The payment id a well-formed receipt link opens, or null for anything else
 * (another origin or path, a query, extra fragment keys, a bad id or token).
 * Exact rebuild, so there is one accepted spelling.
 */
export function tillReceiptUrlPaymentId(
  url: unknown,
  origin: string,
): string | null {
  if (typeof url !== "string" || url.length > 512) return null;
  const prefix = `${origin}/receipt/till/`;
  if (!url.startsWith(prefix)) return null;
  const match = url.slice(prefix.length).match(
    /^([0-9a-f-]{36})#t=([A-Za-z0-9_.-]{1,64})$/,
  );
  if (!match) return null;
  try {
    return buildTillReceiptUrl({
        origin,
        paymentId: match[1],
        token: match[2],
      }) ===
        url
      ? match[1]
      : null;
  } catch {
    return null;
  }
}

/**
 * The receipt link notify-dispatch may use: only for a service-role caller,
 * the Till receipt category, and exactly the link of the SAME payment the
 * payload names, on the expected origin. Anything else is dropped (the
 * receipt still goes, without a link).
 */
export function trustedTillReceiptUrl(input: {
  serviceCaller: boolean;
  categoryKey: unknown;
  payload: Record<string, unknown>;
  receiptUrl: unknown;
  origin: string;
}): string | undefined {
  if (String(input.categoryKey ?? "") !== "buyer_till_receipt") {
    return undefined;
  }
  if (input.receiptUrl === undefined || input.receiptUrl === null) {
    return undefined;
  }
  const paymentId = tillReceiptUrlPaymentId(input.receiptUrl, input.origin);
  if (
    !input.serviceCaller || paymentId === null ||
    String(input.payload.till_payment_id ?? "").toLowerCase() !== paymentId
  ) {
    console.warn("[notify-dispatch v2] till_receipt_url_rejected");
    return undefined;
  }
  return input.receiptUrl as string;
}
