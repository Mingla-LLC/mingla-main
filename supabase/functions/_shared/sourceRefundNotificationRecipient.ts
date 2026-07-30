import {
  type AttentionKeySlot,
  readSourceRefundAttentionKeyRing,
} from "./sourceRefundAttentionToken.ts";

const KID_RE = /^[a-z0-9_-]{1,16}$/;
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function decodeKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("attention_security_config_invalid");
  }
  const key = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (key.length !== 32 || btoa(String.fromCharCode(...key)) !== value) {
    throw new Error("attention_security_config_invalid");
  }
  return key;
}

export function normalizeSourceRefundRecipient(
  channel: "email" | "sms",
  value: string,
): string {
  const normalized = value.replace(/^[ \t]+|[ \t]+$/g, "");
  if (/[\u0000-\u001f\u007f-\uffff]/.test(normalized)) {
    throw new Error("invalid_recipient");
  }
  if (channel === "sms") {
    if (!/^\+[1-9][0-9]{1,14}$/.test(normalized)) {
      throw new Error("invalid_recipient");
    }
    return normalized;
  }
  const email = normalized.toLowerCase();
  if (encoder.encode(email).length > 254) throw new Error("invalid_recipient");
  const parts = email.split("@");
  if (
    parts.length !== 2 || parts[0].length < 1 ||
    encoder.encode(parts[0]).length > 64
  ) {
    throw new Error("invalid_recipient");
  }
  const labels = parts[1].split(".");
  if (
    labels.length < 2 ||
    labels.some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    )
  ) throw new Error("invalid_recipient");
  return email;
}

export function readSourceRefundRecipientKeys(
  raw = Deno.env.get("AD_CONVERSION_TOKENS"),
): {
  current: AttentionKeySlot;
  previous: AttentionKeySlot | null;
} {
  // Validate the token/IP ring too so purpose-separated keys cannot silently
  // converge inside the shared bundle.
  const attention = readSourceRefundAttentionKeyRing(raw);
  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(raw ?? "") as Record<string, unknown>;
  } catch {
    throw new Error("attention_security_config_invalid");
  }
  const make = (kid: unknown, encoded: unknown, required: boolean) => {
    if (!required && kid === undefined && encoded === undefined) return null;
    if (typeof kid !== "string" || !KID_RE.test(kid)) {
      throw new Error("attention_security_config_invalid");
    }
    return { kid, key: decodeKey(encoded) };
  };
  const current = make(
    bundle.SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID,
    bundle.SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64,
    true,
  )!;
  const previous = make(
    bundle.SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KID,
    bundle.SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KEY_B64,
    false,
  );
  if (
    previous &&
    (current.kid === previous.kid ||
      current.key.every((byte, index) => byte === previous.key[index]))
  ) throw new Error("attention_security_config_invalid");
  const attentionSlots = [
    attention.current,
    attention.previous,
    attention.ipCurrent,
    attention.ipPrevious,
  ].filter(Boolean) as AttentionKeySlot[];
  const recipientSlots = [current, previous].filter(
    Boolean,
  ) as AttentionKeySlot[];
  for (const slot of attentionSlots) {
    for (const recipient of recipientSlots) {
      if (
        slot.kid === recipient.kid ||
        slot.key.every((byte, index) => byte === recipient.key[index])
      ) throw new Error("attention_security_config_invalid");
    }
  }
  return { current, previous };
}

export async function sourceRefundRecipientFingerprint(input: {
  key: AttentionKeySlot;
  channel: "email" | "sms";
  recipient: string;
}): Promise<string> {
  const normalized = normalizeSourceRefundRecipient(
    input.channel,
    input.recipient,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(input.key.key).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message =
    `source_refund_notification_recipient:v1\0${input.key.kid}\0${input.channel}\0${normalized}`;
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
  return `v1:${input.key.kid}:${base64Url(mac)}`;
}
