export type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text: string;
};

export type EmailDeliveryClaimAction =
  | "send_new"
  | "retry_same_provider_key"
  | "already_accepted"
  | "in_progress"
  | "idempotency_conflict"
  | "acceptance_unknown";

export type EmailDeliveryClaim = {
  action: EmailDeliveryClaimAction;
  deliveryId: string | null;
  claimId: string | null;
  providerMessageId: string | null;
};

export type EmailDeliveryCompletionOutcome =
  | "accepted"
  | "retryable"
  | "manual_review";

export type ResendAttempt =
  | { outcome: "accepted"; providerMessageId: string }
  | { outcome: "retryable"; reason: string }
  | { outcome: "manual_review"; reason: string };

export type LegacyEmailDispatchResult =
  | {
    outcome: "provider_accepted";
    providerMessageId: string;
    duplicate: boolean;
  }
  | {
    outcome: "retry_pending";
    reason: string;
  }
  | {
    outcome: "manual_review";
    reason: string;
  };

export type LegacyEmailDispatchDeps = {
  claimDelivery: (input: {
    idempotencyKey: string;
    recipientFingerprint: string;
    payloadFingerprint: string;
  }) => Promise<EmailDeliveryClaim>;
  completeDelivery: (input: {
    deliveryId: string;
    claimId: string;
    outcome: EmailDeliveryCompletionOutcome;
    providerMessageId: string | null;
    errorReason: string | null;
  }) => Promise<void>;
  sendResend: (
    payload: ResendEmailPayload,
    providerIdempotencyKey: string,
  ) => Promise<ResendAttempt>;
};

const encoder = new TextEncoder();

export function isExactServiceBearer(
  authorization: string | null,
  serviceRoleKey: string,
): boolean {
  return serviceRoleKey.length > 0 &&
    authorization === `Bearer ${serviceRoleKey}`;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${
    entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")
  }}`;
}

export function normalizeEmailRecipient(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 || normalized.length > 320 ||
    !normalized.includes("@")
  ) {
    throw new Error("invalid_email_recipient");
  }
  return normalized;
}

function assertRecipientHmacSecret(secret: string): void {
  if (secret.trim().length < 32) {
    throw new Error("notification_recipient_hmac_secret_missing");
  }
}

export async function recipientFingerprint(
  recipient: string,
  secret: string,
): Promise<string> {
  assertRecipientHmacSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(recipient)),
  );
}

export async function payloadFingerprint(
  payload: ResendEmailPayload,
): Promise<string> {
  return await sha256(stableJson(payload));
}

export async function resendProviderIdempotencyKey(
  logicalKey: string,
): Promise<string> {
  if (logicalKey.trim().length === 0) {
    throw new Error("email_idempotency_key_required");
  }
  return `mingla-email-${await sha256(logicalKey)}`;
}

export async function dispatchIdempotentLegacyEmail(
  input: {
    recipient: string;
    logicalIdempotencyKey: string;
    recipientHmacSecret: string;
    payload: ResendEmailPayload;
  },
  deps: LegacyEmailDispatchDeps,
): Promise<LegacyEmailDispatchResult> {
  const recipient = normalizeEmailRecipient(input.recipient);
  if (
    input.payload.to.length !== 1 ||
    normalizeEmailRecipient(input.payload.to[0] ?? "") !== recipient
  ) {
    return { outcome: "manual_review", reason: "recipient_payload_mismatch" };
  }
  if (
    input.logicalIdempotencyKey.toLowerCase().includes(recipient)
  ) {
    return { outcome: "manual_review", reason: "recipient_in_idempotency_key" };
  }
  // Validate the one required authority synchronously before constructing the
  // parallel hash batch. Otherwise its rejected promise can make Promise.all
  // return while the two sibling digest operations are still running.
  assertRecipientHmacSecret(input.recipientHmacSecret);
  const [recipientHash, payloadHash, providerKey] = await Promise.all([
    recipientFingerprint(recipient, input.recipientHmacSecret),
    payloadFingerprint(input.payload),
    resendProviderIdempotencyKey(input.logicalIdempotencyKey),
  ]);
  const claim = await deps.claimDelivery({
    idempotencyKey: input.logicalIdempotencyKey,
    recipientFingerprint: recipientHash,
    payloadFingerprint: payloadHash,
  });
  if (
    claim.action === "already_accepted" && claim.providerMessageId
  ) {
    return {
      outcome: "provider_accepted",
      providerMessageId: claim.providerMessageId,
      duplicate: true,
    };
  }
  if (claim.action === "in_progress") {
    return { outcome: "retry_pending", reason: "email_dispatch_in_progress" };
  }
  if (
    claim.action === "idempotency_conflict" ||
    claim.action === "acceptance_unknown"
  ) {
    return { outcome: "manual_review", reason: claim.action };
  }
  if (!claim.deliveryId || !claim.claimId) {
    return { outcome: "retry_pending", reason: "email_claim_incomplete" };
  }

  const provider = await deps.sendResend(input.payload, providerKey);
  if (provider.outcome === "accepted") {
    await deps.completeDelivery({
      deliveryId: claim.deliveryId,
      claimId: claim.claimId,
      outcome: "accepted",
      providerMessageId: provider.providerMessageId,
      errorReason: null,
    });
    return {
      outcome: "provider_accepted",
      providerMessageId: provider.providerMessageId,
      duplicate: false,
    };
  }

  await deps.completeDelivery({
    deliveryId: claim.deliveryId,
    claimId: claim.claimId,
    outcome: provider.outcome,
    providerMessageId: null,
    errorReason: provider.reason,
  });
  return provider.outcome === "retryable"
    ? { outcome: "retry_pending", reason: provider.reason }
    : { outcome: "manual_review", reason: provider.reason };
}
