// #4452 §5.6 open and click tracking links (shared by forms-automation-sender and forms-track).
//
// Every link in a form email is https://<project>/functions/v1/forms-track?s=<send>&u=<url>&h=<sig>
// and the open pixel is ?o=<send>.<sig>. The key is HMAC-SHA256 over the
// UNSUBSCRIBE_TOKEN_SECRET with a "forms-track:" domain prefix, so a tracking
// signature can never be replayed as an unsubscribe token (or the reverse).
// A bad signature, a signature for another send, or a non-http(s) target is
// refused: forms-track then redirects to https://usemingla.com and records
// nothing, so there is no open redirect.

const ENC = new TextEncoder();
const SAFE_HOME = "https://usemingla.com";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", ENC.encode(`forms-track:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), ENC.encode(message));
  return b64url(new Uint8Array(sig)).slice(0, 32);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Only absolute http(s) URLs are ever tracked or redirected to. */
export function trackableUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname || raw.startsWith("//")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function clickUrl(base: string, secret: string, sendId: string, target: string): Promise<string> {
  const url = trackableUrl(target);
  if (!url) return target;
  const h = await sign(secret, `click:${sendId}:${url}`);
  return `${base}?s=${encodeURIComponent(sendId)}&u=${encodeURIComponent(url)}&h=${h}`;
}

export async function openPixelUrl(base: string, secret: string, sendId: string): Promise<string> {
  return `${base}?o=${encodeURIComponent(sendId)}.${await sign(secret, `open:${sendId}`)}`;
}

/** Verify a click: the original URL, or null (then redirect home, record nothing). */
export async function verifyClick(secret: string, sendId: string | null, url: string | null, h: string | null): Promise<string | null> {
  if (!sendId || !url || !h || !/^[0-9a-f-]{36}$/.test(sendId)) return null;
  const target = trackableUrl(url);
  if (!target) return null;
  return sameText(await sign(secret, `click:${sendId}:${target}`), h) ? target : null;
}

/** Verify an open pixel value `<send id>.<sig>`: the send id, or null. */
export async function verifyOpen(secret: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  const [sendId, h] = value.split(".");
  if (!sendId || !h || !/^[0-9a-f-]{36}$/.test(sendId)) return null;
  return sameText(await sign(secret, `open:${sendId}`), h) ? sendId : null;
}

export { SAFE_HOME };
