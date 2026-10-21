// Issue #3827 — sole crypto owner for private ticket links.
// Raw bearer tokens must never be persisted or logged. The database stores
// only a lookup HMAC and the nonce needed to re-derive a host's share URL.

import {
  type OfferingInvitePepper,
  resolveOfferingInviteTokenPepper,
} from "./offeringInviteToken.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const TICKET_LINK_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const DERIVE_DOMAIN = new TextEncoder().encode("mingla:ticket-link:derive:v1");
const LOOKUP_DOMAIN = new TextEncoder().encode("mingla:ticket-link:lookup:v1");
const IP_DOMAIN = new TextEncoder().encode("mingla:ticket-link:ip:v1");
const ZERO = new Uint8Array([0]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hmac(pepper: Uint8Array, input: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(pepper).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, Uint8Array.from(input).buffer));
}

export function ticketLinkNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function ticketLinkNonceHex(nonce: Uint8Array): string {
  if (nonce.length !== 16) throw new Error("ticket_link_nonce_invalid");
  return hex(nonce);
}

export function ticketLinkNonceFromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new Error("ticket_link_nonce_invalid");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

export async function hashTicketLinkToken(token: string, pepper: Uint8Array): Promise<string> {
  if (!TICKET_LINK_TOKEN.test(token)) throw new Error("ticket_link_invalid");
  return hex(await hmac(pepper, concat(LOOKUP_DOMAIN, ZERO, new TextEncoder().encode(token))));
}

export async function deriveTicketLinkToken(
  pepper: OfferingInvitePepper,
  linkId: string,
  nonce: Uint8Array,
): Promise<{ opaqueToken: string; tokenHash: string; nonceHex: string }> {
  if (!UUID.test(linkId) || nonce.length !== 16) throw new Error("ticket_link_context_invalid");
  const digest = await hmac(
    pepper.bytes,
    concat(DERIVE_DOMAIN, ZERO, new TextEncoder().encode(linkId), ZERO, nonce),
  );
  const opaqueToken = base64Url(digest.slice(0, 16));
  return {
    opaqueToken,
    tokenHash: await hashTicketLinkToken(opaqueToken, pepper.bytes),
    nonceHex: ticketLinkNonceHex(nonce),
  };
}

export async function hashTicketLinkIp(value: string, pepper: Uint8Array): Promise<string> {
  const normalized = value.trim().slice(0, 128);
  return hex(await hmac(pepper, concat(IP_DOMAIN, ZERO, new TextEncoder().encode(normalized))));
}

export function requestClientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    "unknown").trim();
}

export { resolveOfferingInviteTokenPepper };
