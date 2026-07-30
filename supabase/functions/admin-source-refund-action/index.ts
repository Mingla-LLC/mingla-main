import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "../_shared/sourceRefundNotificationRecipient.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHONE_RE = /^\+[1-9][0-9]{1,14}$/;
const ORIGINAL_ACTIONS = new Set([
  "reconcile_provider",
  "retry_terminal",
  "escalate",
  "resolve_ops",
]);
const RECOVERY_ACTIONS = new Set([
  "correct_attention_contact",
  "reclaim_confirmed_unsent",
  "invalidate_and_resend_attention",
]);
const CORRECTION_REASONS = new Set([
  "invalid_recipient",
  "recipient_updated_contact",
]);
const INVALIDATION_REASONS = new Set([
  "delivery_acceptance_unknown",
  "delivery_undelivered",
  "recipient_contact_corrected",
  "recipient_requested_resend",
]);

interface RpcResult {
  data: unknown;
  error: unknown;
}

interface AdminActionContext {
  userId: string | null;
  userEmail: string | null;
  isActiveAdmin: boolean;
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<RpcResult>;
}

type ResolveAdminActionContext = (
  authorization: string,
) => Promise<AdminActionContext>;

function reply(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

function skipWhitespace(raw: string, start: number): number {
  let cursor = start;
  while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1;
  return cursor;
}

function readJsonString(raw: string, start: number): {
  value: string;
  end: number;
} {
  if (raw[start] !== '"') throw new Error("invalid_request");
  let escaped = false;
  for (let cursor = start + 1; cursor < raw.length; cursor += 1) {
    const character = raw[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      return {
        value: JSON.parse(raw.slice(start, cursor + 1)),
        end: cursor + 1,
      };
    }
  }
  throw new Error("invalid_request");
}

/**
 * JSON.parse discards duplicate properties. Recovery requests are deliberately
 * flat, so enumerate their top-level properties before accepting the parsed
 * value and fail closed if any property occurs twice.
 */
function topLevelJsonKeys(raw: string): string[] {
  const keys: string[] = [];
  let cursor = skipWhitespace(raw, 0);
  if (raw[cursor] !== "{") throw new Error("invalid_request");
  cursor = skipWhitespace(raw, cursor + 1);
  if (raw[cursor] === "}") return keys;

  while (cursor < raw.length) {
    const key = readJsonString(raw, cursor);
    keys.push(key.value);
    cursor = skipWhitespace(raw, key.end);
    if (raw[cursor] !== ":") throw new Error("invalid_request");
    cursor += 1;

    let objectDepth = 0;
    let arrayDepth = 0;
    let inString = false;
    let escaped = false;
    for (; cursor < raw.length; cursor += 1) {
      const character = raw[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") objectDepth += 1;
      else if (character === "}") {
        if (objectDepth === 0 && arrayDepth === 0) return keys;
        objectDepth -= 1;
      } else if (character === "[") arrayDepth += 1;
      else if (character === "]") arrayDepth -= 1;
      else if (
        character === "," && objectDepth === 0 && arrayDepth === 0
      ) {
        cursor = skipWhitespace(raw, cursor + 1);
        break;
      }
    }
  }
  throw new Error("invalid_request");
}

function hasExactKeys(
  body: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(body).sort().join(",") === [...keys].sort().join(",");
}

function normalizeEmail(value: string): string | null {
  const normalized = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "")
    .toLowerCase();
  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).length > 254 ||
    /[^\x21-\x7e]/.test(normalized)
  ) return null;
  const parts = normalized.split("@");
  if (parts.length !== 2 || parts[0].length < 1 || parts[0].length > 64) {
    return null;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])) return null;
  const labels = parts[1].split(".");
  if (
    labels.length < 2 ||
    labels.some((label) =>
      label.length < 1 || label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) return null;
  return normalized;
}

function normalizeContact(channel: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (channel === "email") return normalizeEmail(value);
  if (channel === "sms") {
    const normalized = value.replace(
      /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g,
      "",
    );
    return PHONE_RE.test(normalized) ? normalized : null;
  }
  return null;
}

function parseRecoveryRequest(
  raw: string,
  parsed: Record<string, unknown>,
): Record<string, unknown> | null {
  if (new TextEncoder().encode(raw).length > 4096) return null;
  let rawKeys: string[];
  try {
    rawKeys = topLevelJsonKeys(raw);
  } catch {
    return null;
  }
  if (new Set(rawKeys).size !== rawKeys.length) return null;

  const refundId = parsed.refundId;
  const action = parsed.action;
  const expectedGeneration = parsed.expectedGeneration;
  if (
    typeof refundId !== "string" || !UUID_RE.test(refundId) ||
    typeof action !== "string" || !RECOVERY_ACTIONS.has(action) ||
    !Number.isSafeInteger(expectedGeneration) ||
    Number(expectedGeneration) < 1 ||
    Number(expectedGeneration) > 2_147_483_647
  ) return null;

  if (action === "correct_attention_contact") {
    if (
      !hasExactKeys(parsed, [
        "refundId",
        "action",
        "expectedGeneration",
        "channel",
        "newContact",
        "reasonCode",
      ]) ||
      (parsed.channel !== "email" && parsed.channel !== "sms") ||
      typeof parsed.reasonCode !== "string" ||
      !CORRECTION_REASONS.has(parsed.reasonCode)
    ) return null;
    const normalized = normalizeContact(parsed.channel, parsed.newContact);
    if (!normalized) return null;
    return {
      refundId,
      action,
      expectedGeneration,
      deliveryId: null,
      channel: parsed.channel,
      newContact: normalized,
      reasonCode: parsed.reasonCode,
    };
  }

  if (action === "reclaim_confirmed_unsent") {
    if (
      !hasExactKeys(parsed, [
        "refundId",
        "action",
        "expectedGeneration",
        "deliveryId",
        "channel",
        "reasonCode",
      ]) ||
      typeof parsed.deliveryId !== "string" ||
      !UUID_RE.test(parsed.deliveryId) ||
      (parsed.channel !== "email" && parsed.channel !== "sms") ||
      parsed.reasonCode !== "provider_confirmed_unsent"
    ) return null;
    return {
      refundId,
      action,
      expectedGeneration,
      deliveryId: parsed.deliveryId,
      channel: parsed.channel,
      newContact: null,
      reasonCode: parsed.reasonCode,
    };
  }

  if (
    !hasExactKeys(parsed, [
      "refundId",
      "action",
      "expectedGeneration",
      "reasonCode",
    ]) ||
    typeof parsed.reasonCode !== "string" ||
    !INVALIDATION_REASONS.has(parsed.reasonCode)
  ) return null;
  return {
    refundId,
    action,
    expectedGeneration,
    deliveryId: null,
    channel: null,
    newContact: null,
    reasonCode: parsed.reasonCode,
  };
}

async function resolveAdminActionContext(
  authorization: string,
): Promise<AdminActionContext> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const user = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData } = await user.auth.getUser();
  if (!authData.user) {
    return { userId: null, userEmail: null, isActiveAdmin: false };
  }
  const service = createClient(url, serviceKey);
  const { data: admin } = await service.from("admin_users").select(
    "email,status",
  )
    .eq("id", authData.user.id).eq("status", "active").maybeSingle();
  return {
    userId: authData.user.id,
    userEmail: admin?.email ?? null,
    isActiveAdmin: Boolean(admin),
    rpc: async (name, args) => {
      if (name === "admin_request_source_refund_attention_recovery") {
        const recipientHeaders = await recoveryRecipientHmacHeaders(
          args,
        );
        const hmacBoundService = createClient(url, serviceKey, {
          global: { headers: recipientHeaders },
        });
        return await hmacBoundService.rpc(name, args);
      }
      return await service.rpc(name, args);
    },
  };
}

async function recoveryRecipientHmacHeaders(
  args: Record<string, unknown>,
): Promise<Record<string, string>> {
  if (
    args.p_action === "correct_attention_contact" &&
    (args.p_channel === "email" || args.p_channel === "sms") &&
    typeof args.p_new_contact === "string"
  ) {
    const keys = readSourceRefundRecipientKeys();
    return {
      "X-Source-Refund-Recipient-Hmac": await sourceRefundRecipientFingerprint({
        key: keys.current,
        channel: args.p_channel,
        recipient: args.p_new_contact,
      }),
    };
  }
  if (
    args.p_action !== "invalidate_and_resend_attention" ||
    typeof args.p_refund_id !== "string"
  ) return {};

  const keys = readSourceRefundRecipientKeys();
  return {
    "X-Source-Refund-Recipient-Kid": keys.current.kid,
    "X-Source-Refund-Recipient-Key-B64": btoa(
      String.fromCharCode(...keys.current.key),
    ),
  };
}

export function createAdminSourceRefundActionHandler(
  resolveContext: ResolveAdminActionContext = resolveAdminActionContext,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") {
      return reply({ error: "method_not_allowed" }, 405);
    }
    const context = await resolveContext(
      req.headers.get("authorization") ?? "",
    );
    if (!context.userId) return reply({ error: "not_authenticated" }, 401);
    if (!context.isActiveAdmin || !context.userEmail || !context.rpc) {
      return reply({ error: "not_authorized" }, 403);
    }

    const raw = await req.text().catch(() => "");
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply({ error: "invalid_request" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return reply({ error: "invalid_request" }, 400);
    }

    if (
      typeof body.action === "string" && RECOVERY_ACTIONS.has(body.action)
    ) {
      const recovery = parseRecoveryRequest(raw, body);
      if (!recovery) return reply({ error: "invalid_request" }, 400);
      try {
        const { data, error } = await context.rpc(
          "admin_request_source_refund_attention_recovery",
          {
            p_refund_id: recovery.refundId,
            p_action: recovery.action,
            p_expected_generation: recovery.expectedGeneration,
            p_delivery_id: recovery.deliveryId,
            p_channel: recovery.channel,
            p_new_contact: recovery.newContact,
            p_reason_code: recovery.reasonCode,
            p_actor_user_id: context.userId,
            p_actor_email: context.userEmail,
          },
        );
        if (!error) return reply({ refund: data }, 202);
      } catch {
        // Security-bundle, HMAC preparation, and RPC failures intentionally
        // collapse into the same non-oracle conflict.
      }
      return reply({ error: "attention_recovery_conflict" }, 409);
    }

    const refundId = typeof body.refundId === "string" ? body.refundId : "";
    if (!UUID_RE.test(refundId)) {
      return reply({ error: "invalid_request" }, 400);
    }
    if (
      typeof body.action !== "string" || !ORIGINAL_ACTIONS.has(body.action)
    ) {
      return reply({ error: "invalid_action" }, 422);
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) {
      return reply({ error: "reason_required" }, 422);
    }
    const { data, error } = await context.rpc(
      "admin_request_source_refund_action",
      {
        p_refund_id: refundId,
        p_action: body.action,
        p_reason: reason,
        p_actor_user_id: context.userId,
        p_actor_email: context.userEmail,
      },
    );
    if (error) return reply({ error: "action_failed" }, 409);
    return reply({ refund: data }, 202);
  };
}

if (import.meta.main) {
  serve(createAdminSourceRefundActionHandler());
}
