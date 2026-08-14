// Issue #1447 — shared RSVP pass/recovery primitives.
// Recovery tokens are deterministic HMAC output over a per-entity timestamp and
// a server-only pepper. They are cryptographically pseudorandom, can be rebuilt
// for delayed SMS delivery, and only their SHA-256 digest is persisted.

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest).map((v) => v.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function deriveRsvpRecoveryToken(input: {
  entityId: string;
  createdAtIso: string;
  pepper: string;
}): Promise<string> {
  const canonicalCreatedAt = new Date(input.createdAtIso).toISOString();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        `mingla:rsvp-recovery:v1:${input.entityId}:${canonicalCreatedAt}`,
      ),
    ),
  );
  return base64Url(signature);
}

export function rsvpRecoveryUrl(
  entityType: "primary" | "guest",
  entityId: string,
  token: string,
): string {
  const fragment = new URLSearchParams({
    type: entityType,
    entity: entityId,
    token,
  }).toString();
  return `https://host.usemingla.com/rsvp/pass#${fragment}`;
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
