const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
export function fromBase64url(value: string): Uint8Array { return Uint8Array.from(Buffer.from(value, "base64url")); }
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer)).toString("hex");
}
export async function hmac(secret: string, value: string): Promise<string> {
  const keyBytes = Uint8Array.from(Buffer.from(secret, "base64"));
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, encoder.encode(value))).toString("base64url");
}
export async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const a = encoder.encode(left); const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}
