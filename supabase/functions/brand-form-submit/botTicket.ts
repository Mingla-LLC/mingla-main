// #4541 R8.5 layer 1: the bot ticket for replies from people we cannot identify.
//
// The page_form and blast_form reads hand out
//   base64url(issuedAtMs) + "." + base64url(HMAC-SHA256(key, formId|campaignId|issuedAtMs))
// keyed by the shared per-purpose derivation (_shared/derivedSecret.ts, label
// SCOPED_SECRET_LABELS.brandFormBotTicket; no new secret). An Unknown submit
// must carry a valid ticket issued at least 3 seconds and at most 2 hours
// earlier. When the derivation root is unavailable, issuing returns null and
// verifying fails closed (bot_check_failed); signed-in and personal-link paths
// never read a ticket.

import {
  deriveScopedSecret,
  SCOPED_SECRET_LABELS,
} from "../_shared/derivedSecret.ts";

export const BOT_TICKET_MIN_AGE_MS = 3_000;
export const BOT_TICKET_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type BotTicketKey = () => Promise<string>;

export const defaultBotTicketKey: BotTicketKey = () =>
  deriveScopedSecret(SCOPED_SECRET_LABELS.brandFormBotTicket);

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") +
      "===".slice((text.length + 3) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

async function mac(
  key: string,
  formId: string,
  campaignId: string,
  issuedAtMs: number,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${formId}|${campaignId}|${issuedAtMs}`),
  );
  return b64url(new Uint8Array(sig));
}

/** A ticket for this form (and Blast campaign, "" for a page), or null when the key is unavailable. */
export async function issueBotTicket(
  formId: string,
  campaignId: string | null,
  key: BotTicketKey = defaultBotTicketKey,
  nowMs: number = Date.now(),
): Promise<string | null> {
  let secret: string;
  try {
    secret = await key();
  } catch {
    return null;
  }
  const issued = Math.floor(nowMs);
  return `${b64url(new TextEncoder().encode(String(issued)))}.${await mac(
    secret,
    formId.toLowerCase(),
    (campaignId ?? "").toLowerCase(),
    issued,
  )}`;
}

/** True only for an untampered ticket for this form and campaign, 3 s to 2 h old. */
export async function verifyBotTicket(
  ticket: unknown,
  formId: string,
  campaignId: string | null,
  key: BotTicketKey = defaultBotTicketKey,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (typeof ticket !== "string" || ticket.length > 200) return false;
  const [issuedPart, sigPart, extra] = ticket.split(".");
  if (!issuedPart || !sigPart || extra !== undefined) return false;
  const issuedText = fromB64url(issuedPart);
  if (issuedText === null || !/^[0-9]{1,15}$/.test(issuedText)) return false;
  const issued = Number(issuedText);
  const age = nowMs - issued;
  if (age < BOT_TICKET_MIN_AGE_MS || age > BOT_TICKET_MAX_AGE_MS) return false;
  let secret: string;
  try {
    secret = await key();
  } catch {
    return false;
  }
  const expected = await mac(
    secret,
    formId.toLowerCase(),
    (campaignId ?? "").toLowerCase(),
    issued,
  );
  if (expected.length !== sigPart.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sigPart.charCodeAt(i);
  }
  return diff === 0;
}
