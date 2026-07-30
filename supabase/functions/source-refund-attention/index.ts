import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  getPaystackRefund,
  paystackRefundCanonicalState,
  retryPaystackRefundWithCustomerDetails,
} from "../_shared/paystackRefunds.ts";
import { PaystackApiError, paystackListBanks } from "../_shared/paystack.ts";
import {
  hashSourceRefundAttentionToken,
  readSourceRefundAttentionKeyRing,
  sourceRefundSecurityFingerprint,
} from "../_shared/sourceRefundAttentionToken.ts";
import { sourceRefundClientIp } from "../_shared/sourceRefundClientIp.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BODY_BYTES = 4096;

type Mode = "banks" | "submit_paystack_details";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function exactKeys(
  body: Record<string, unknown>,
  required: string[],
  optional: string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(body, key)) &&
    Object.keys(body).every((key) => allowed.has(key));
}

function hasDuplicateTopLevelKeys(raw: string): boolean {
  const keys: string[] = [];
  let cursor = 0;
  const whitespace = () => {
    while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1;
  };
  whitespace();
  if (raw[cursor++] !== "{") return true;
  whitespace();
  while (cursor < raw.length && raw[cursor] !== "}") {
    if (raw[cursor] !== '"') return true;
    const start = cursor;
    let escaped = false;
    cursor += 1;
    while (cursor < raw.length) {
      if (escaped) escaped = false;
      else if (raw[cursor] === "\\") escaped = true;
      else if (raw[cursor] === '"') break;
      cursor += 1;
    }
    if (raw[cursor] !== '"') return true;
    let key: string;
    try {
      key = JSON.parse(raw.slice(start, cursor + 1));
    } catch {
      return true;
    }
    keys.push(key);
    cursor += 1;
    whitespace();
    if (raw[cursor++] !== ":") return true;
    let objectDepth = 0;
    let arrayDepth = 0;
    let inString = false;
    escaped = false;
    for (; cursor < raw.length; cursor += 1) {
      const character = raw[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === "{") objectDepth += 1;
      else if (character === "[") arrayDepth += 1;
      else if (character === "}") {
        if (objectDepth === 0 && arrayDepth === 0) break;
        objectDepth -= 1;
      } else if (character === "]") arrayDepth -= 1;
      else if (
        character === "," && objectDepth === 0 && arrayDepth === 0
      ) break;
    }
    if (raw[cursor] === ",") {
      cursor += 1;
      whitespace();
    }
  }
  return new Set(keys).size !== keys.length;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      req.headers.get("content-type") ?? "",
    )
  ) return null;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) return null;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (hasDuplicateTopLevelKeys(raw)) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function exactPaystackIdentity(
  authority: Record<string, unknown>,
  provider: Awaited<ReturnType<typeof getPaystackRefund>>,
): boolean {
  const integrationIdentity = authority.integrationFingerprint ??
    authority.providerAccountReference;
  return authority.provider === "paystack" &&
    authority.currency === "NGN" &&
    provider.id === authority.providerRefundId &&
    provider.amount === Number(authority.amountCents) &&
    provider.currency === "NGN" &&
    provider.transaction === authority.providerReference &&
    typeof integrationIdentity === "string" &&
    integrationIdentity.length > 0 &&
    provider.integration === integrationIdentity &&
    Number.isSafeInteger(Number(authority.attemptNo)) &&
    Number(authority.attemptNo) > 0 &&
    Number.isSafeInteger(Number(authority.generation)) &&
    Number(authority.generation) > 0;
}

// deno-lint-ignore no-explicit-any
async function rateLimit(client: any, input: {
  scope: "ip" | "actor_refund_generation";
  mode: Mode;
  fingerprints: string[];
}): Promise<{ allowed: boolean; retryAfter: number }> {
  const { data, error } = await client.rpc(
    "consume_source_refund_attention_rate_limit",
    {
      p_scope: input.scope,
      p_mode: input.mode,
      p_fingerprints: input.fingerprints,
      p_now: new Date().toISOString(),
    },
  );
  if (error || !data) throw new Error("attention_rate_limit_unavailable");
  return {
    allowed: data.allowed === true,
    retryAfter: Math.max(1, Number(data.retryAfter ?? 60)),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await readBody(req);
  if (!body) return json({ error: "invalid_request" }, 400);
  const mode = body.mode;
  if (mode !== "banks" && mode !== "submit_paystack_details") {
    return json({ error: "invalid_request" }, 400);
  }
  const required = mode === "banks"
    ? ["mode", "refundId"]
    : ["mode", "refundId", "currency", "accountNumber", "bankId"];
  if (!exactKeys(body, required, ["attentionToken"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const refundId = typeof body.refundId === "string" ? body.refundId : "";
  const attentionToken = typeof body.attentionToken === "string"
    ? body.attentionToken
    : "";
  if (!UUID_RE.test(refundId) || attentionToken.length > 256) {
    return json({ error: "action_unavailable" }, 404);
  }

  let keyRing;
  try {
    keyRing = readSourceRefundAttentionKeyRing();
  } catch {
    return json({ error: "attention_temporarily_unavailable" }, 503);
  }
  const userId = await userIdFromAuthHeader(req);
  const ip = sourceRefundClientIp(req.headers.get("x-forwarded-for"));
  if (!ip && !userId) {
    return json({ error: "attention_temporarily_unavailable" }, 503);
  }
  const ipFingerprints = ip
    ? await Promise.all([
      sourceRefundSecurityFingerprint({
        key: keyRing.ipCurrent,
        domain: "ip",
        value: ip,
      }),
      ...(keyRing.ipPrevious
        ? [
          sourceRefundSecurityFingerprint({
            key: keyRing.ipPrevious,
            domain: "ip",
            value: ip,
          }),
        ]
        : []),
    ])
    : ["signed_in_unattributed"];
  const client = serviceClient();
  const preauth = await rateLimit(client, {
    scope: "ip",
    mode,
    fingerprints: ipFingerprints,
  });
  if (!preauth.allowed) {
    return json(
      { error: "rate_limited", retryAfter: preauth.retryAfter },
      429,
    );
  }

  let attentionHash: string | null = null;
  try {
    attentionHash = attentionToken
      ? await hashSourceRefundAttentionToken(attentionToken)
      : null;
  } catch {
    return json({ error: "action_unavailable" }, 404);
  }
  if (!userId && !attentionHash) {
    return json({ error: "action_unavailable" }, 404);
  }
  const { data: authority, error: authorityError } = await client.rpc(
    "authorize_source_refund_attention",
    {
      p_refund_id: refundId,
      p_user_id: userId,
      p_attention_token_hash: attentionHash,
      p_now: new Date().toISOString(),
    },
  );
  if (authorityError || !authority) {
    return json({ error: "action_unavailable" }, 404);
  }

  const actorValue = userId ??
    `${attentionHash}:${refundId}:${Number(authority.generation)}`;
  const actorFingerprints = await Promise.all([
    sourceRefundSecurityFingerprint({
      key: keyRing.ipCurrent,
      domain: "actor",
      value: actorValue,
    }),
    ...(keyRing.ipPrevious
      ? [
        sourceRefundSecurityFingerprint({
          key: keyRing.ipPrevious,
          domain: "actor",
          value: actorValue,
        }),
      ]
      : []),
  ]);
  const postauth = await rateLimit(client, {
    scope: "actor_refund_generation",
    mode,
    fingerprints: actorFingerprints,
  });
  if (!postauth.allowed) {
    return json(
      { error: "rate_limited", retryAfter: postauth.retryAfter },
      429,
    );
  }

  if (mode === "banks") {
    try {
      const banks = await paystackListBanks({
        country: "nigeria",
        currency: "NGN",
        type: "nuban",
      });
      return json({
        currency: "NGN",
        banks: banks.map((bank) => ({ id: bank.code, name: bank.name })),
      });
    } catch {
      return json({ error: "banks_unavailable" }, 503);
    }
  }

  const accountNumber = typeof body.accountNumber === "string"
    ? body.accountNumber
    : "";
  const bankId = typeof body.bankId === "string" ? body.bankId : "";
  if (
    body.currency !== "NGN" ||
    !/^[0-9]{10}$/.test(accountNumber) ||
    !/^[0-9]{1,10}$/.test(bankId)
  ) {
    return json({ error: "invalid_bank_details" }, 422);
  }
  try {
    const authorizedBanks = await paystackListBanks({
      country: "nigeria",
      currency: "NGN",
      type: "nuban",
    });
    if (!authorizedBanks.some((bank) => bank.code === bankId)) {
      return json({ error: "invalid_bank_details" }, 422);
    }
  } catch {
    return json({ error: "banks_unavailable" }, 503);
  }

  const providerRefundId = String(authority.providerRefundId ?? "");
  let providerBefore;
  try {
    providerBefore = await getPaystackRefund(providerRefundId);
  } catch {
    return json({ error: "provider_status_unavailable" }, 503);
  }
  if (
    !exactPaystackIdentity(
      authority as Record<string, unknown>,
      providerBefore,
    )
  ) {
    return json({ error: "provider_identity_mismatch" }, 409);
  }
  const providerBeforeStatus = providerBefore.status.trim().toLowerCase();
  const beforeState = paystackRefundCanonicalState(providerBeforeStatus);
  if (providerBeforeStatus !== "needs-attention") {
    if (
      ["provider_pending", "processed", "failed_terminal"].includes(beforeState)
    ) {
      await client.rpc("record_source_refund_provider_event", {
        p_refund_id: refundId,
        p_leg_type: "buyer_refund",
        p_attempt_no: Number(authority.attemptNo),
        p_event_key: `attention-preflight:${refundId}:${
          Number(authority.generation)
        }:${beforeState}`,
        p_provider_event_type: "paystack_attention_preflight",
        p_provider_event_id: `attention-preflight:${refundId}:${
          Number(authority.generation)
        }:${beforeState}`,
        p_next_state: beforeState,
        p_amount_observed_cents: providerBefore.amount,
        p_provider_operation_id: providerRefundId,
        p_safe_reason_code: "paystack_attention_preflight_advanced",
      });
    }
    return json({
      refundId,
      state: beforeState,
      submitted: false,
    }, beforeState === "processed" ? 200 : 202);
  }

  const now = new Date().toISOString();
  const { data: claim, error: claimError } = await client.rpc(
    "claim_source_refund_attention_submission",
    {
      p_refund_id: refundId,
      p_generation: Number(authority.generation),
      p_actor_type: userId ? "authenticated_buyer" : "attention_token_guest",
      p_now: now,
    },
  );
  if (claimError || !claim?.claimed) {
    return json({ error: claim?.code ?? "action_unavailable" }, 409);
  }
  const claimId = String(claim.claimId);
  let renewed = false;
  const renewalTimer = setTimeout(async () => {
    renewed = true;
    await client.rpc("renew_source_refund_attention_submission", {
      p_refund_id: refundId,
      p_generation: Number(authority.generation),
      p_claim_id: claimId,
      p_now: new Date().toISOString(),
    });
  }, 60_000);

  try {
    const result = await retryPaystackRefundWithCustomerDetails({
      refundId: providerRefundId,
      currency: "NGN",
      accountNumber,
      bankId,
    });
    clearTimeout(renewalTimer);
    if (
      !exactPaystackIdentity(authority as Record<string, unknown>, result)
    ) {
      return json({ error: "provider_response_unknown" }, 503);
    }
    const nextState = paystackRefundCanonicalState(result.status);
    const observedAmount = Math.max(0, Math.trunc(Number(result.amount ?? 0)));
    const { data: summary, error: recordError } = await client.rpc(
      "record_source_refund_provider_event",
      {
        p_refund_id: refundId,
        p_leg_type: "buyer_refund",
        p_attempt_no: Number(authority.attemptNo),
        p_event_key: `attention:${refundId}:${
          Number(authority.generation)
        }:${nextState}`,
        p_provider_event_type: "paystack_customer_details_submitted",
        p_provider_event_id: `attention:${providerRefundId}:${
          Number(authority.generation)
        }:${nextState}`,
        p_next_state: nextState,
        p_amount_observed_cents: observedAmount,
        p_provider_operation_id: providerRefundId,
        p_safe_reason_code: "paystack_customer_details_accepted",
      },
    );
    if (recordError) return json({ error: "state_commit_unavailable" }, 503);
    await client.rpc("release_source_refund_attention_submission", {
      p_refund_id: refundId,
      p_generation: Number(authority.generation),
      p_claim_id: claimId,
      p_disposition: "accepted",
      p_now: new Date().toISOString(),
    });
    return json({
      refundId,
      state: summary?.buyer_state ?? nextState,
      submitted: true,
    }, 202);
  } catch (error) {
    clearTimeout(renewalTimer);
    if (
      error instanceof PaystackApiError &&
      (error.status === 409 || error.status === 422)
    ) {
      try {
        const reconciled = await getPaystackRefund(providerRefundId);
        if (
          !exactPaystackIdentity(
            authority as Record<string, unknown>,
            reconciled,
          )
        ) {
          return json({ error: "provider_response_unknown" }, 503);
        }
        const reconciledStatus = reconciled.status.trim().toLowerCase();
        const reconciledState = paystackRefundCanonicalState(reconciledStatus);
        if (
          ["pending", "processing", "processed"].includes(reconciledStatus)
        ) {
          const { data: summary, error: recordError } = await client.rpc(
            "record_source_refund_provider_event",
            {
              p_refund_id: refundId,
              p_leg_type: "buyer_refund",
              p_attempt_no: Number(authority.attemptNo),
              p_event_key: `attention-followup:${refundId}:${
                Number(authority.generation)
              }:${reconciledState}`,
              p_provider_event_type: "paystack_attention_followup",
              p_provider_event_id: `attention-followup:${refundId}:${
                Number(authority.generation)
              }:${reconciledState}`,
              p_next_state: reconciledState,
              p_amount_observed_cents: reconciled.amount,
              p_provider_operation_id: providerRefundId,
              p_safe_reason_code: "paystack_attention_followup_advanced",
            },
          );
          if (recordError) {
            return json({ error: "state_commit_unavailable" }, 503);
          }
          await client.rpc("release_source_refund_attention_submission", {
            p_refund_id: refundId,
            p_generation: Number(authority.generation),
            p_claim_id: claimId,
            p_disposition: "accepted",
            p_now: new Date().toISOString(),
          });
          return json({
            refundId,
            state: summary?.buyer_state ?? reconciledState,
            submitted: true,
          }, 202);
        }
        if (reconciledStatus === "needs-attention") {
          await client.rpc("release_source_refund_attention_submission", {
            p_refund_id: refundId,
            p_generation: Number(authority.generation),
            p_claim_id: claimId,
            p_disposition: "definitive_unsent",
            p_now: new Date().toISOString(),
          });
          return json({ error: "bank_details_rejected" }, 422);
        }
        return json({ error: "provider_response_unknown" }, 503);
      } catch {
        return json({ error: "provider_response_unknown" }, 503);
      }
    }
    if (
      error instanceof PaystackApiError && error.status >= 400 &&
      error.status < 500 && error.status !== 408 && error.status !== 429
    ) {
      await client.rpc("release_source_refund_attention_submission", {
        p_refund_id: refundId,
        p_generation: Number(authority.generation),
        p_claim_id: claimId,
        p_disposition: "definitive_unsent",
        p_now: new Date().toISOString(),
      });
      return json({ error: "bank_details_rejected" }, 422);
    }
    return json({
      error: renewed ? "provider_response_unknown" : "provider_unavailable",
    }, 503);
  }
});
