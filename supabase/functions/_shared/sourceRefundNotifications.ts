import {
  deriveSourceRefundAttentionToken,
  hashSourceRefundAttentionToken,
  readSourceRefundAttentionKeyRing,
} from "./sourceRefundAttentionToken.ts";
import {
  normalizeSourceRefundRecipient,
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "./sourceRefundNotificationRecipient.ts";

type Channel = "inapp" | "push" | "email" | "sms";
type Audience = "buyer" | "brand" | "ops";
export const SOURCE_REFUND_TEMPLATE_REVISION = 1;
export const SOURCE_REFUND_SENDER_PROFILE_KEY = "transactional_system_v1";

export interface SourceRefundOutboxRow {
  category_key: string;
  idempotency_key: string;
  brand_id: string;
  payload: Record<string, unknown>;
  user_id: string | null;
  contact: null;
  channel: Channel;
  notification_group_key: string;
  contract_version: 9;
  attention_generation: number;
  source_refund_event_id: number;
  status: "pending";
  next_attempt_at: string;
  brand_name_snapshot: string;
  recipient?: string | null;
  audience: Audience;
}

function cleanContact(
  channel: "email" | "sms",
  value?: string | null,
): string | null {
  if (!value) return null;
  try {
    return normalizeSourceRefundRecipient(channel, value);
  } catch {
    return null;
  }
}

export function buildSourceRefundRecipientRows(input: {
  categoryKey: string;
  idempotencyPrefix: string;
  brandId: string;
  payload: Record<string, unknown>;
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  audience: Audience;
  generation: number;
  eventId: number;
  brandName: string;
}): SourceRefundOutboxRow[] {
  const email = cleanContact("email", input.email);
  const phone = cleanContact("sms", input.phone);
  const group = `source_refund:${
    String(input.payload.source_refund_id)
  }:${input.generation}`;
  const common = {
    category_key: input.categoryKey,
    brand_id: input.brandId,
    payload: { ...input.payload, audience: input.audience },
    contact: null as null,
    notification_group_key: group,
    contract_version: 9 as const,
    attention_generation: input.generation,
    source_refund_event_id: input.eventId,
    status: "pending" as const,
    next_attempt_at: new Date().toISOString(),
    brand_name_snapshot: input.brandName,
    audience: input.audience,
  };
  return [
    ...(input.userId
      ? (["inapp", "push"] as const).map((channel) => ({
        ...common,
        channel,
        user_id: input.userId!,
        recipient: null,
        idempotency_key:
          `${input.idempotencyPrefix}:${input.audience}:${channel}:${input.userId}`,
      }))
      : []),
    ...(email
      ? [{
        ...common,
        channel: "email" as const,
        user_id: null,
        recipient: email,
        idempotency_key:
          `${input.idempotencyPrefix}:${input.audience}:email:contact`,
      }]
      : []),
    ...(phone
      ? [{
        ...common,
        channel: "sms" as const,
        user_id: null,
        recipient: phone,
        idempotency_key:
          `${input.idempotencyPrefix}:${input.audience}:sms:contact`,
      }]
      : []),
  ];
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jcs(value: unknown): string {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("source_refund_payload_not_canonical");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) => {
        if (record[key] === undefined) {
          throw new Error("source_refund_payload_not_canonical");
        }
        return `${JSON.stringify(key)}:${jcs(record[key])}`;
      }).join(",")
    }}`;
  }
  throw new Error("source_refund_payload_not_canonical");
}

export async function sourceRefundPayloadFingerprint(input: {
  payload: Record<string, unknown>;
  category: string;
  audience: Audience;
  channel: Channel;
  serializerVersion: number;
}): Promise<string> {
  return await sha256Hex(jcs({
    audience: input.audience,
    category: input.category,
    channel: input.channel,
    payload: input.payload,
    senderProfileKey: SOURCE_REFUND_SENDER_PROFILE_KEY,
    serializerVersion: input.serializerVersion,
    templateRevision: SOURCE_REFUND_TEMPLATE_REVISION,
  }));
}

// deno-lint-ignore no-explicit-any
export async function enqueueSourceRefundNotifications(client: any, input: {
  refundId: string;
  state: string;
  eventId: number;
  attentionGeneration: number;
  buyerUserId?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  brandId: string;
  amountLabel: string;
  sourceLabel: string;
}): Promise<void> {
  if (!Number.isSafeInteger(input.eventId) || input.eventId < 1) {
    throw new Error("source_refund_notification_event_missing");
  }
  const stateCopy: Record<string, string> = {
    provider_pending: `Your ${input.amountLabel} refund is processing.`,
    needs_attention:
      `Action is needed to continue your ${input.amountLabel} refund.`,
    processed: `Your ${input.amountLabel} refund has been processed.`,
    failed_retryable:
      `Your ${input.amountLabel} refund is delayed. We’re retrying it.`,
    failed_terminal: `Your ${input.amountLabel} refund needs support review.`,
  };
  const buyerCopy = stateCopy[input.state] ??
    `Your ${input.amountLabel} refund is processing.`;
  const { data: brand } = await client.from("brands")
    .select("name,contact_email,contact_phone")
    .eq("id", input.brandId).maybeSingle();
  const brandName = typeof brand?.name === "string" && brand.name.trim()
    ? brand.name.trim()
    : "Mingla";

  if (input.state === "needs_attention") {
    const tokenKeys = readSourceRefundAttentionKeyRing();
    const rawToken = await deriveSourceRefundAttentionToken({
      refundId: input.refundId,
      generation: input.attentionGeneration,
      key: tokenKeys.current,
    });
    const tokenHash = await hashSourceRefundAttentionToken(rawToken);
    const { data: prepared, error } = await client.rpc(
      "prepare_source_refund_attention_delivery",
      {
        p_refund_id: input.refundId,
        p_attention_generation: input.attentionGeneration,
        p_attention_token_hash: tokenHash,
        p_now: new Date().toISOString(),
      },
    );
    if (error || prepared?.deliverable !== true) {
      throw new Error("source_refund_attention_prepare_failed");
    }
  }

  const buyerPayload = {
    message: buyerCopy,
    amount: input.amountLabel,
    state: input.state,
    source_refund_id: input.refundId,
  };
  const prefix =
    `source_refund:${input.refundId}:${input.attentionGeneration}:${input.eventId}`;
  const rows = buildSourceRefundRecipientRows({
    categoryKey: "source_refund_buyer_state",
    idempotencyPrefix: prefix,
    brandId: input.brandId,
    payload: buyerPayload,
    userId: input.buyerUserId,
    email: input.buyerEmail,
    phone: input.buyerPhone,
    audience: "buyer",
    generation: input.attentionGeneration,
    eventId: input.eventId,
    brandName,
  });

  const { data: teamRows, error: teamError } = await client
    .from("brand_team_members")
    .select("user_id,role")
    .eq("brand_id", input.brandId)
    .is("removed_at", null)
    .not("accepted_at", "is", null)
    .in("role", ["brand_owner", "brand_admin", "finance_manager"]);
  if (teamError) throw new Error("source_refund_brand_team_lookup_failed");
  const brandPayload = {
    message: `${input.sourceLabel}: ${buyerCopy}`,
    operation_id: input.refundId,
    source_refund_id: input.refundId,
    amount: input.amountLabel,
    state: input.state,
  };
  const teamIds = Array.from(
    new Set(
      // deno-lint-ignore no-explicit-any
      (teamRows ?? []).map((row: any) => String(row.user_id)).filter(Boolean),
    ),
  ) as string[];
  for (const userId of teamIds) {
    rows.push(...buildSourceRefundRecipientRows({
      categoryKey: "source_refund_brand_state",
      idempotencyPrefix: prefix,
      brandId: input.brandId,
      payload: brandPayload,
      userId,
      audience: "brand",
      generation: input.attentionGeneration,
      eventId: input.eventId,
      brandName,
    }));
  }
  rows.push(...buildSourceRefundRecipientRows({
    categoryKey: "source_refund_brand_state",
    idempotencyPrefix: prefix,
    brandId: input.brandId,
    payload: brandPayload,
    email: brand?.contact_email ?? null,
    phone: brand?.contact_phone ?? null,
    audience: "brand",
    generation: input.attentionGeneration,
    eventId: input.eventId,
    brandName,
  }));

  const recipientKeys = readSourceRefundRecipientKeys();
  for (const row of rows) {
    const { recipient, audience, ...persisted } = row;
    const { data: outbox, error: outboxError } = await client
      .from("notification_outbox")
      .upsert(persisted, {
        onConflict: "idempotency_key",
        ignoreDuplicates: false,
      })
      .select("id")
      .single();
    if (outboxError || !outbox?.id) {
      throw new Error("source_refund_notification_enqueue_failed");
    }
    const recipientFingerprint = recipient &&
        (row.channel === "email" || row.channel === "sms")
      ? await sourceRefundRecipientFingerprint({
        key: recipientKeys.current,
        channel: row.channel,
        recipient,
      })
      : null;
    const payloadFingerprint = await sourceRefundPayloadFingerprint({
      payload: persisted.payload,
      category: persisted.category_key,
      audience,
      channel: persisted.channel,
      serializerVersion: 9,
    });
    const { error: deliveryError } = await client.from(
      "source_refund_notification_deliveries",
    ).upsert({
      refund_id: input.refundId,
      source_refund_event_id: input.eventId,
      outbox_id: outbox.id,
      attention_generation: input.attentionGeneration,
      audience,
      channel: row.channel,
      recipient_revision: 0,
      recipient_key_id: recipientFingerprint ? recipientKeys.current.kid : null,
      recipient_fingerprint: recipientFingerprint,
      payload_fingerprint: payloadFingerprint,
      serializer_version: 9,
      idempotency_key: row.idempotency_key,
      status: "queued",
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: "outbox_id", ignoreDuplicates: true });
    if (deliveryError) {
      throw new Error("source_refund_notification_delivery_enqueue_failed");
    }
  }
}
