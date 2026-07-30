const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KID_RE = /^[a-z0-9_-]{1,16}$/;
const RAW_TOKEN_RE = /^([a-z0-9_-]{1,16})\.([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();

export type AttentionKeySlot = { kid: string; key: Uint8Array };
export type AttentionKeyRing = {
  current: AttentionKeySlot;
  previous: AttentionKeySlot | null;
  ipCurrent: AttentionKeySlot;
  ipPrevious: AttentionKeySlot | null;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeCanonicalKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("attention_security_config_invalid");
  }
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("attention_security_config_invalid");
  }
  if (
    decoded.length !== 32 || btoa(String.fromCharCode(...decoded)) !== value
  ) {
    throw new Error("attention_security_config_invalid");
  }
  return decoded;
}

function slot(
  bundle: Record<string, unknown>,
  kidName: string,
  keyName: string,
  required: boolean,
): AttentionKeySlot | null {
  const kid = bundle[kidName];
  const key = bundle[keyName];
  if (!required && kid === undefined && key === undefined) return null;
  if (typeof kid !== "string" || !KID_RE.test(kid)) {
    throw new Error("attention_security_config_invalid");
  }
  return { kid, key: decodeCanonicalKey(key) };
}

export function readSourceRefundAttentionKeyRing(
  raw = Deno.env.get("AD_CONVERSION_TOKENS"),
): AttentionKeyRing {
  let bundle: unknown;
  try {
    bundle = JSON.parse(raw ?? "");
  } catch {
    throw new Error("attention_security_config_invalid");
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("attention_security_config_invalid");
  }
  const record = bundle as Record<string, unknown>;
  const current = slot(
    record,
    "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID",
    "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64",
    true,
  )!;
  const previous = slot(
    record,
    "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KID",
    "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KEY_B64",
    false,
  );
  const ipCurrent = slot(
    record,
    "SOURCE_REFUND_ATTENTION_IP_CURRENT_KID",
    "SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64",
    true,
  )!;
  const ipPrevious = slot(
    record,
    "SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KID",
    "SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KEY_B64",
    false,
  );
  for (const [primary, prior] of [
    [current, previous],
    [ipCurrent, ipPrevious],
  ] as Array<[AttentionKeySlot, AttentionKeySlot | null]>) {
    if (
      prior &&
      (primary.kid === prior.kid ||
        primary.key.every((byte, index) => byte === prior.key[index]))
    ) throw new Error("attention_security_config_invalid");
  }
  const tokenSlots = [current, previous].filter(Boolean) as AttentionKeySlot[];
  const ipSlots = [ipCurrent, ipPrevious].filter(Boolean) as AttentionKeySlot[];
  for (const tokenSlot of tokenSlots) {
    for (const ipSlot of ipSlots) {
      if (
        tokenSlot.kid === ipSlot.kid ||
        tokenSlot.key.every((byte, index) => byte === ipSlot.key[index])
      ) {
        throw new Error("attention_security_config_invalid");
      }
    }
  }
  return { current, previous, ipCurrent, ipPrevious };
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
  );
}

export async function deriveSourceRefundAttentionToken(input: {
  refundId: string;
  generation: number;
  key: AttentionKeySlot;
}): Promise<string> {
  if (
    !UUID_RE.test(input.refundId) || !Number.isSafeInteger(input.generation) ||
    input.generation < 1
  ) {
    throw new Error("attention_token_input_invalid");
  }
  const mac = await hmac(
    input.key.key,
    `source_refund_attention:v1:${input.key.kid}:${input.refundId}:${input.generation}`,
  );
  return `${input.key.kid}.${base64Url(mac)}`;
}

export function attentionTokenKid(rawToken: string): string | null {
  return rawToken.match(RAW_TOKEN_RE)?.[1] ?? null;
}

export async function hashSourceRefundAttentionToken(
  rawToken: string,
): Promise<string> {
  const match = rawToken.match(RAW_TOKEN_RE);
  if (!match || rawToken.length > 256) {
    throw new Error("attention_token_invalid");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(rawToken)),
  );
  return `v1:${match[1]}:${hex(digest)}`;
}

export async function sourceRefundSecurityFingerprint(input: {
  key: AttentionKeySlot;
  domain: "ip" | "actor";
  value: string;
}): Promise<string> {
  const digest = await hmac(
    input.key.key,
    `source_refund_attention_${input.domain}:v1:${input.key.kid}:${input.value}`,
  );
  return `v1:${input.key.kid}:${base64Url(digest)}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}
