// Issue #1770 / parent #876: sole offering-invite token crypto owner.
// Secret material, derivation input, and raw tokens must never be logged or persisted.

const HEX_SECRET = /^[0-9a-f]{64,}$/;
const BASE64_SECRET = /^[A-Za-z0-9+/]{43,}={0,2}$/;

export class OfferingInviteTokenPepperError extends Error {
  readonly code = "offering_invite_token_pepper_unavailable";
  constructor() {
    super("offering_invite_token_pepper_unavailable");
    this.name = "OfferingInviteTokenPepperError";
  }
}

export interface OfferingInvitePepper {
  bytes: Uint8Array;
  format: "hex" | "base64";
  fingerprint: string;
}

function decodeHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new OfferingInviteTokenPepperError();
  }
}

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function deploymentFingerprint(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  return encodeHex(digest.slice(0, 8));
}

export async function parseOfferingInviteTokenPepper(
  raw: string | undefined,
): Promise<OfferingInvitePepper> {
  if (raw === undefined || raw.length === 0) {
    throw new OfferingInviteTokenPepperError();
  }
  const format = HEX_SECRET.test(raw)
    ? "hex"
    : BASE64_SECRET.test(raw)
    ? "base64"
    : null;
  if (format === null) throw new OfferingInviteTokenPepperError();
  const bytes = format === "hex" ? decodeHex(raw) : decodeBase64(raw);
  if (bytes.byteLength < 32) throw new OfferingInviteTokenPepperError();
  return { bytes, format, fingerprint: await deploymentFingerprint(bytes) };
}

export async function resolveOfferingInviteTokenPepper(): Promise<
  OfferingInvitePepper
> {
  return await parseOfferingInviteTokenPepper(
    Deno.env.get("OFFERING_INVITE_TOKEN_PEPPER"),
  );
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DERIVE_DOMAIN = new TextEncoder().encode(
  "mingla:offering-invite:derive:v1",
);
const LOOKUP_DOMAIN = new TextEncoder().encode(
  "mingla:offering-invite:lookup:v1",
);
const ZERO = new Uint8Array([0]);

export interface OfferingInviteTokenContextV1 {
  tokenId: string;
  inviteId: string;
  deliveryAttemptId: string;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function canonicalUuid(value: string): Uint8Array {
  if (!CANONICAL_UUID.test(value)) {
    throw new Error("offering_invite_token_context_invalid");
  }
  return new TextEncoder().encode(value);
}

async function hmacSha256(
  pepper: Uint8Array,
  input: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(pepper).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, Uint8Array.from(input).buffer),
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replace(/=+$/, "");
}

export function offeringInviteDeriveInput(
  context: OfferingInviteTokenContextV1,
): Uint8Array {
  return concatBytes(
    DERIVE_DOMAIN,
    ZERO,
    canonicalUuid(context.tokenId),
    ZERO,
    canonicalUuid(context.inviteId),
    ZERO,
    canonicalUuid(context.deliveryAttemptId),
  );
}

export function offeringInviteLookupInput(opaqueToken: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(opaqueToken)) {
    throw new Error("offering_invite_token_invalid");
  }
  return concatBytes(
    LOOKUP_DOMAIN,
    ZERO,
    new TextEncoder().encode(opaqueToken),
  );
}

export async function hashOfferingInviteToken(
  token: string,
  pepper: Uint8Array,
): Promise<string> {
  return encodeHex(await hmacSha256(pepper, offeringInviteLookupInput(token)));
}

export async function deriveOfferingInviteToken(
  pepper: OfferingInvitePepper,
  context: OfferingInviteTokenContextV1,
): Promise<{ opaqueToken: string; tokenHash: string; fingerprint: string }> {
  const opaqueToken = encodeBase64Url(
    await hmacSha256(pepper.bytes, offeringInviteDeriveInput(context)),
  );
  return {
    opaqueToken,
    tokenHash: await hashOfferingInviteToken(opaqueToken, pepper.bytes),
    fingerprint: pepper.fingerprint,
  };
}

export function constantTimeTokenHashEquals(
  expectedHex: string,
  actualHex: string,
): boolean {
  if (
    !/^[0-9a-f]{64}$/.test(expectedHex) || !/^[0-9a-f]{64}$/.test(actualHex)
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expectedHex.length; index += 1) {
    difference |= expectedHex.charCodeAt(index) ^ actualHex.charCodeAt(index);
  }
  return difference === 0;
}

export function pepperReadiness(pepper: OfferingInvitePepper): {
  configured: true;
  format: "base64" | "hex";
  minBytesSatisfied: true;
  fingerprintMatch: true;
} {
  return {
    configured: true,
    format: pepper.format,
    minBytesSatisfied: true,
    fingerprintMatch: true,
  };
}
