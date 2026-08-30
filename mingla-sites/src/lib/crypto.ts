const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return toHex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer));
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

export async function hmacBase64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(base64Bytes(secret)).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, encoder.encode(value))).toString("base64");
}
