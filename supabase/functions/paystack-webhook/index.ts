/**
 * paystack-webhook (META-ORCH-1072 proof slice).
 *
 * Receives Paystack webhooks, verifies x-paystack-signature (HMAC-SHA512 of the
 * RAW body with the secret key), logs the event, returns 200 fast.
 * verify_jwt MUST be false — Paystack sends no Supabase JWT.
 *
 * Proof slice: logs verified events (visible via `supabase functions logs` /
 * MCP get_logs). Phase 0-proper adds the idempotent payment_webhook_events
 * inbox + the event router.
 *
 * Docs: https://paystack.com/docs/payments/webhooks/
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md (Part 4)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  PAYSTACK_WEBHOOK_IPS,
  resolvePaystackSecretKey,
  verifyPaystackSignature,
} from "../_shared/paystack.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Raw body is REQUIRED for signature verification — do not parse before hashing.
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  let secret: string;
  try {
    secret = resolvePaystackSecretKey();
  } catch (err) {
    console.error("[paystack-webhook] key resolution failed:", String(err));
    return json({ error: "server_misconfigured" }, 500);
  }

  const valid = await verifyPaystackSignature(rawBody, signature, secret);
  if (!valid) {
    console.warn("[paystack-webhook] REJECTED — bad signature", {
      sigPrefix: signature?.slice(0, 16) ?? "missing",
    });
    return json({ error: "invalid_signature" }, 401);
  }

  // Soft IP check (log only — Paystack delivers from a static trio).
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipKnown = PAYSTACK_WEBHOOK_IPS.includes(ip);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const data = (event?.data ?? {}) as Record<string, unknown>;
  console.log("[paystack-webhook] VERIFIED event", {
    event: event?.event ?? "unknown",
    reference: data?.reference ?? null,
    status: data?.status ?? null,
    amount: data?.amount ?? null,
    currency: data?.currency ?? null,
    channel: data?.channel ?? null,
    ipKnown,
  });

  // Ack fast. Phase 0-proper enqueues to the idempotent inbox + routes the event.
  return json({ received: true });
});
