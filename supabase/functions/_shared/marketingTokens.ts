// ORCH-0815-B — HS256 signed-token helpers for marketing email links.
//
// Two token types share the same primitive (HS256 over base64url-encoded
// JSON payload) but differ in payload shape + secret + max-age:
//
//   1. Unsubscribe tokens — bound to {campaign_id, recipient_email,
//      brand_id, exp}. Secret: `UNSUBSCRIBE_TOKEN_SECRET`. 90 days.
//      Used by `marketing-unsubscribe` to authenticate the buyer's
//      one-click unsubscribe redirect without requiring a login.
//
//   2. Tracking IDs — opaque UUID stored in `marketing_clicks.tracking_id`.
//      No signing needed (existence in DB = authorisation). Helper here
//      just exposes `generateTrackingId()` for parity with the unsubscribe
//      flow and to keep all marketing-link primitives in one file.
//
// Why HS256 and not unsigned-UUID for unsubscribe? An unsigned UUID would
// let an attacker who guesses one row's UUID unsubscribe arbitrary
// (campaign, recipient) pairs. HS256 binds the link content to a server-
// side secret so tampering invalidates the signature.
//
// Why hand-rolled and not djwt? We need a tiny, audit-able verifier with
// constant-time signature comparison and explicit expiration semantics.
// djwt adds 200 LOC of options for features (multiple alg, claims) we
// don't use. The whole module is ~120 lines.

export interface UnsubscribeTokenPayload {
  campaign_id: string;
  recipient_email: string;
  brand_id: string;
  /** Unix seconds. */
  exp: number;
}

const UNSUB_DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in Deno + browsers.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") +
    "==".slice(0, (4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function requireSecret(envKey: string): string {
  const raw = Deno.env.get(envKey);
  if (raw === undefined || raw.trim().length < 32) {
    // 32-char minimum mirrors the qr_token_pepper guardrail in
    // _shared/ticketCheckout.ts. Anything shorter is a weak HMAC key
    // that defeats the point of signing.
    throw new Error(`marketing_token_secret_missing_or_weak:${envKey}`);
  }
  return raw;
}

/** Constant-time byte-array comparison (avoids HMAC verify-timing leaks). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens
// ---------------------------------------------------------------------------

export async function signUnsubscribeToken(
  payload: Omit<UnsubscribeTokenPayload, "exp"> & { exp?: number },
  options: { secretEnvKey?: string; ttlSeconds?: number } = {},
): Promise<string> {
  const secret = requireSecret(options.secretEnvKey ?? "UNSUBSCRIBE_TOKEN_SECRET");
  const exp = payload.exp ??
    Math.floor(Date.now() / 1000) +
      (options.ttlSeconds ?? UNSUB_DEFAULT_TTL_SECONDS);
  const body: UnsubscribeTokenPayload = {
    campaign_id: payload.campaign_id,
    recipient_email: payload.recipient_email,
    brand_id: payload.brand_id,
    exp,
  };
  const payloadEncoded = base64UrlEncode(
    ENCODER.encode(JSON.stringify(body)),
  );
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    ENCODER.encode(payloadEncoded),
  );
  return `${payloadEncoded}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifyUnsubscribeToken(
  token: string,
  options: { secretEnvKey?: string; nowSeconds?: number } = {},
): Promise<UnsubscribeTokenPayload> {
  const secret = requireSecret(options.secretEnvKey ?? "UNSUBSCRIBE_TOKEN_SECRET");
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("unsubscribe_token_malformed");
  }
  const [payloadEncoded, sigEncoded] = parts;
  const key = await hmacKey(secret);
  const expectedSigBytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      ENCODER.encode(payloadEncoded),
    ),
  );
  let providedSig: Uint8Array;
  try {
    providedSig = base64UrlDecode(sigEncoded);
  } catch (_err) {
    throw new Error("unsubscribe_token_signature_invalid");
  }
  if (!timingSafeEqual(expectedSigBytes, providedSig)) {
    throw new Error("unsubscribe_token_signature_invalid");
  }
  let payload: UnsubscribeTokenPayload;
  try {
    payload = JSON.parse(DECODER.decode(base64UrlDecode(payloadEncoded))) as
      UnsubscribeTokenPayload;
  } catch (_err) {
    throw new Error("unsubscribe_token_payload_invalid");
  }
  if (
    typeof payload.campaign_id !== "string" ||
    typeof payload.recipient_email !== "string" ||
    typeof payload.brand_id !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("unsubscribe_token_payload_invalid");
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("unsubscribe_token_expired");
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Tracking IDs (opaque UUID, no signing)
// ---------------------------------------------------------------------------

/**
 * Generate a fresh per-link tracking ID for `marketing_clicks.tracking_id`.
 * Edge-function-only path — Hermes constraint does NOT apply (no RN runtime).
 */
export function generateTrackingId(): string {
  return crypto.randomUUID();
}

/**
 * UUID v4 shape check — used by marketing-track-click to validate the
 * path param before hitting the DB. Cheap defence-in-depth.
 */
export const TRACKING_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
