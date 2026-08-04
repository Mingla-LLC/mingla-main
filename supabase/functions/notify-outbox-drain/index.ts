import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  constantTimeEqual,
  deriveSourceRefundAttentionToken,
  readSourceRefundAttentionKeyRing,
} from "../_shared/sourceRefundAttentionToken.ts";
import {
  normalizeSourceRefundRecipient,
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "../_shared/sourceRefundNotificationRecipient.ts";
import { sourceRefundPayloadFingerprint } from "../_shared/sourceRefundNotifications.ts";
// #1529 — the source-refund pool is the ONE path whose outbox row can never
// carry a country (see the derivation comment in processSource below).
import { countryFromE164 } from "../_shared/e164Country.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const GENERIC_RESERVE = 15;
const SOURCE_RESERVE = 10;

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function interleave<T>(
  generic: T[],
  source: T[],
): Array<{ kind: "generic" | "source"; row: T }> {
  const result: Array<{ kind: "generic" | "source"; row: T }> = [];
  const max = Math.max(generic.length, source.length);
  for (let index = 0; index < max; index++) {
    if (generic[index]) result.push({ kind: "generic", row: generic[index] });
    if (source[index]) result.push({ kind: "source", row: source[index] });
  }
  return result;
}

export function dualPoolBorrowLimits(
  genericClaimed: number,
  sourceClaimed: number,
): { generic: number; source: number } {
  return {
    generic: Math.max(0, SOURCE_RESERVE - sourceClaimed),
    source: Math.max(0, GENERIC_RESERVE - genericClaimed),
  };
}

async function readBoundedSuccessEnvelope(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 1024) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 1024) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function processGeneric(
  admin: any,
  row: Record<string, unknown>,
  url: string,
  key: string,
) {
  const id = row.id as string;
  let brandName = "Mingla";
  if (row.brand_id) {
    const { data: brand } = await admin.from("brands").select("name")
      .eq("id", row.brand_id).maybeSingle();
    if (brand?.name && typeof brand.name === "string") brandName = brand.name;
  }
  const payload = {
    ...((row.payload as Record<string, unknown>) ?? {}),
    brand_name: brandName,
  };
  try {
    const res = await fetch(`${url}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        category_key: row.category_key,
        user_id: row.user_id ?? null,
        contact: row.contact ?? null,
        payload,
        idempotency_key: row.idempotency_key,
        country_code: row.country_code ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`notify-dispatch ${res.status}: ${text}`);
    }
    await admin.from("notification_outbox").update({
      status: "done",
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    return true;
  } catch (err) {
    const attempts = ((row.attempts as number) ?? 0) + 1;
    await admin.from("notification_outbox").update({
      status: attempts >= 3 ? "failed" : "pending",
      attempts,
      last_error: err instanceof Error ? err.message : String(err),
    }).eq("id", id);
    console.error("[notify-outbox-drain] dispatch failed for", id, err);
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function completeSource(admin: any, input: {
  deliveryId: string;
  claimId: string;
  outcome: string;
  providerMessageId: string | null;
  safeCode: string | null;
}) {
  await admin.rpc("complete_source_refund_notification_delivery", {
    p_delivery_id: input.deliveryId,
    p_claim_id: input.claimId,
    p_outcome: input.outcome,
    p_provider_message_id: input.providerMessageId,
    p_safe_code: input.safeCode,
    p_now: new Date().toISOString(),
  });
}

// deno-lint-ignore no-explicit-any
// #1529 — EXPORTED so the country-derivation and policy-skip behaviour can be
// driven directly by a test with a fake client, instead of being asserted from
// source text. A grep-style check on this file would pass vacuously; only
// executing it proves the dispatch body actually carries the derived country.
export async function processSource(
  admin: any,
  row: Record<string, unknown>,
  url: string,
  key: string,
) {
  const claimId = crypto.randomUUID();
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_source_refund_notification_delivery",
    {
      p_outbox_id: row.id,
      p_claim_id: claimId,
      p_contract_version: 9,
      p_now: new Date().toISOString(),
    },
  );
  if (claimError || claim?.outcome !== "claimed") {
    if (claim?.outcome === "already_accepted") {
      await admin.from("notification_outbox").update({
        status: "done",
        processed_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
    return false;
  }
  const deliveryId = String(claim.deliveryId);
  try {
    const actualPayloadFingerprint = await sourceRefundPayloadFingerprint({
      payload: (row.payload as Record<string, unknown>) ?? {},
      category: String(row.category_key ?? ""),
      audience: String(claim.audience) as "buyer" | "brand" | "ops",
      channel: String(claim.channel) as "inapp" | "push" | "email" | "sms",
      serializerVersion: Number(claim.serializerVersion),
    });
    if (
      !constantTimeEqual(
        actualPayloadFingerprint,
        String(claim.payloadFingerprint),
      )
    ) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "payload_changed",
        providerMessageId: null,
        safeCode: "payload_changed",
      });
      return false;
    }
    const { data: resolved, error: resolveError } = await admin.rpc(
      "resolve_source_refund_notification_recipient",
      { p_delivery_id: deliveryId, p_claim_id: claimId },
    );
    if (resolveError || !resolved) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "terminal_unsent",
        providerMessageId: null,
        safeCode: "invalid_recipient",
      });
      return false;
    }
    const channel = String(claim.channel) as "inapp" | "push" | "email" | "sms";
    const contact = (channel === "email" || channel === "sms") &&
        typeof resolved.recipient === "string"
      ? normalizeSourceRefundRecipient(
        channel === "sms" ? "sms" : "email",
        resolved.recipient,
      )
      : null;
    if ((channel === "email" || channel === "sms") && !contact) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "skipped",
        providerMessageId: null,
        safeCode: "no_contact",
      });
      return true;
    }
    if (contact) {
      const recipientKeys = readSourceRefundRecipientKeys();
      const recipientKey = [
        recipientKeys.current,
        recipientKeys.previous,
      ].find((slot) => slot?.kid === claim.recipientKeyId);
      if (!recipientKey) throw new Error("recipient_key_unavailable");
      const actual = await sourceRefundRecipientFingerprint({
        key: recipientKey,
        channel: channel as "email" | "sms",
        recipient: contact,
      });
      if (!constantTimeEqual(actual, String(claim.recipientFingerprint))) {
        await completeSource(admin, {
          deliveryId,
          claimId,
          outcome: "terminal_unsent",
          providerMessageId: null,
          safeCode: "invalid_recipient",
        });
        return false;
      }
    }

    let attentionUrl: string | null = null;
    if (
      (row.payload as Record<string, unknown> | null)?.state ===
        "needs_attention" &&
      typeof resolved.keyId === "string"
    ) {
      const tokenKeys = readSourceRefundAttentionKeyRing();
      const tokenKey = [tokenKeys.current, tokenKeys.previous].find((slot) =>
        slot?.kid === resolved.keyId
      );
      if (!tokenKey) throw new Error("attention_key_unavailable");
      const token = await deriveSourceRefundAttentionToken({
        refundId: String(claim.refundId),
        generation: Number(claim.generation),
        key: tokenKey,
      });
      attentionUrl = `https://business.usemingla.com/refund/${
        String(claim.refundId)
      }/attention#attentionToken=${encodeURIComponent(token)}`;
    }
    let response: Response;
    try {
      response = await fetch(`${url}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          contract_version: 9,
          category_key: row.category_key,
          user_id: row.user_id ?? null,
          contact,
          payload: {
            ...((row.payload as Record<string, unknown>) ?? {}),
            brand_name: row.brand_name_snapshot ?? "Mingla",
          },
          idempotency_key: row.idempotency_key,
          // #1529 — DERIVE AT THE DRAIN, because this pool structurally cannot
          // carry a country on the outbox row. #1221 deliberately writes
          // `contact: null` for source-refund notifications and keeps the
          // plaintext recipient out of the outbox entirely — only an HMAC
          // fingerprint is persisted, and the real recipient is recovered here
          // by `resolve_source_refund_notification_recipient` and normalised a
          // few lines above. Writing a country at enqueue would mean putting
          // recipient PII into a table that was built to hold none, which would
          // regress #1221's privacy design. So `row.country_code` is ALWAYS
          // NULL for this pool and deriving from the resolved contact is the
          // only correct answer. Non-SMS channels keep the column as-is.
          country_code: channel === "sms"
            ? countryFromE164(contact)
            : row.country_code ?? null,
          requested_channel: channel,
          delivery_id: deliveryId,
          delivery_claim_id: claimId,
          attention_url: attentionUrl,
        }),
      });
    } catch {
      await admin.rpc("classify_source_refund_notification_failure", {
        p_delivery_id: deliveryId,
        p_claim_id: claimId,
        p_safe_code: "dispatch_unavailable",
        p_certainty: "derive",
        p_now: new Date().toISOString(),
      });
      return false;
    }
    if (response.status === 503) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "definitive_unsent_retryable",
        providerMessageId: null,
        safeCode: "dispatch_unavailable",
      });
      return false;
    }
    if (response.status === 422) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "terminal_unsent",
        providerMessageId: null,
        safeCode: "dispatch_rejected",
      });
      return false;
    }
    if (response.status === 409) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "definitive_unsent_retryable",
        providerMessageId: null,
        safeCode: "delivery_in_progress",
      });
      return false;
    }
    if (response.status === 500 || !response.ok) {
      await admin.rpc("classify_source_refund_notification_failure", {
        p_delivery_id: deliveryId,
        p_claim_id: claimId,
        p_safe_code: response.status === 500
          ? "source_dispatch_failed"
          : "dispatch_protocol_error",
        p_certainty: "derive",
        p_now: new Date().toISOString(),
      });
      return false;
    }
    const result = await readBoundedSuccessEnvelope(response);
    // #1529 — a POLICY SKIP terminates cleanly and must NOT touch ops_status.
    //
    // notify-dispatch now answers 200 {success:true, outcome:"skipped"} when a
    // market kill-switch (or a can_send suppression) deliberately stopped the
    // send. Without this branch that envelope falls through to the
    // `!accepted && !ambiguous` protocol-error path below and is recorded as a
    // delivery failure, which escalates the refund to `needs_review`.
    //
    // No SQL change is needed to make this correct:
    // `complete_source_refund_notification_delivery` already handles
    // p_outcome='skipped' properly — it sets the delivery to `skipped` and the
    // outbox row to `failed`, and crucially 'skipped' is NOT in the
    // ('ambiguous','failed_terminal') set that triggers the
    // `source_refunds.ops_status='needs_review'` update. The function was
    // always right; it was simply never handed the right outcome.
    const policySkipped = response.status === 200 &&
      result?.success === true &&
      result?.outcome === "skipped";
    if (policySkipped) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "skipped",
        providerMessageId: null,
        safeCode: typeof result?.reason === "string"
          ? result.reason
          : "provider_kill_switch_off",
      });
      return true;
    }
    const accepted = response.status === 200 &&
      result?.success === true &&
      (result?.outcome === "accepted" ||
        result?.outcome === "already_accepted");
    const ambiguous = response.status === 202 &&
      result?.success === false &&
      result?.outcome === "ambiguous_parked" &&
      result?.reason === "delivery_ambiguous";
    if (!accepted && !ambiguous) {
      await admin.rpc("classify_source_refund_notification_failure", {
        p_delivery_id: deliveryId,
        p_claim_id: claimId,
        p_safe_code: "dispatch_protocol_error",
        p_certainty: "derive",
        p_now: new Date().toISOString(),
      });
      return false;
    }
    await completeSource(admin, {
      deliveryId,
      claimId,
      outcome: accepted ? "accepted" : "acceptance_unknown",
      providerMessageId: accepted &&
          typeof result?.providerMessageId === "string"
        ? result.providerMessageId
        : null,
      safeCode: accepted ? null : "delivery_ambiguous",
    });
    return accepted;
  } catch {
    await admin.rpc("classify_source_refund_notification_failure", {
      p_delivery_id: deliveryId,
      p_claim_id: claimId,
      p_safe_code: "source_dispatch_failed",
      p_certainty: "derive",
      p_now: new Date().toISOString(),
    });
    return false;
  }
}

export async function handleNotifyOutboxDrain(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return json({ error: "server_misconfigured" }, 500);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!constantTimeEqual(authHeader, `Bearer ${key}`)) {
    return json({ error: "unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return json({ error: "server_misconfigured" }, 500);
  const admin = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const [{ data: firstGeneric, error: genericError }, {
    data: firstSource,
    error: sourceError,
  }] = await Promise.all([
    admin.rpc("claim_notification_outbox", { p_limit: GENERIC_RESERVE }),
    admin.rpc("claim_source_refund_notification_outbox", {
      p_limit: SOURCE_RESERVE,
      p_contract_version: 9,
      p_worker_id: crypto.randomUUID(),
      p_now: new Date().toISOString(),
    }),
  ]);
  const generic = genericError
    ? []
    : [...(firstGeneric ?? [])] as Array<Record<string, unknown>>;
  const source = sourceError
    ? []
    : [...(firstSource ?? [])] as Array<Record<string, unknown>>;
  const borrow = dualPoolBorrowLimits(generic.length, source.length);
  if (borrow.source > 0 && !sourceError) {
    const { data } = await admin.rpc(
      "claim_source_refund_notification_outbox",
      {
        p_limit: borrow.source,
        p_contract_version: 9,
        p_worker_id: crypto.randomUUID(),
        p_now: new Date().toISOString(),
      },
    );
    source.push(...(data ?? []));
  }
  if (borrow.generic > 0 && !genericError) {
    const { data } = await admin.rpc("claim_notification_outbox", {
      p_limit: borrow.generic,
    });
    generic.push(...(data ?? []));
  }
  if (generic.length + source.length === 0) {
    return json({ ok: true, processed: 0, failed: 0 });
  }
  let processed = 0;
  let failed = 0;
  for (const item of interleave(generic, source)) {
    const ok = item.kind === "generic"
      ? await processGeneric(admin, item.row, url, key)
      : await processSource(admin, item.row, url, key);
    if (ok) processed++;
    else failed++;
  }
  return json({
    ok: true,
    processed,
    failed,
    generic_claimed: generic.length,
    source_claimed: source.length,
  });
}

if (import.meta.main) {
  serve(handleNotifyOutboxDrain);
}
