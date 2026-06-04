/**
 * paystack-checkout-create (META-ORCH-1076 proof slice).
 *
 * Minimal Paystack transaction initializer to prove the test-mode integration
 * end-to-end: POST { email?, amount?, currency? } -> /transaction/initialize ->
 * { authorization_url, reference }. Open authorization_url in a browser, pay
 * with a Paystack test card, and paystack-webhook receives charge.success.
 *
 * TEST-ONLY HARNESS: verify_jwt is false for easy sandbox calls. The secret key
 * never leaves the server. Phase 1 wires this into ticket-checkout-create
 * (auth-gated, all-in pricing, real orders, brand subaccount split).
 *
 * Docs: https://paystack.com/docs/api/transaction/#initialize
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md (Part 1)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  paystackInitializeTransaction,
  resolvePaystackMode,
} from "../_shared/paystack.ts";

// Nigeria default channels — NO mobile_money (that is Ghana-only).
const NG_CHANNELS = ["card", "bank", "ussd", "bank_transfer"];
const DEFAULT_CALLBACK = "https://business.usemingla.com/pay/callback";

function genReference(): string {
  // Unique per attempt; allowed chars are alnum + - . =
  const rand = crypto.randomUUID().replace(/-/g, "");
  return `mingla_test_${Date.now()}_${rand}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({} as Record<string, unknown>));
    const email = (payload.email as string) ?? "test-buyer@usemingla.com";
    // Harness accepts amount in MAJOR units (e.g. 5000 = ₦5,000); converted to kobo below.
    const amountMajor = Number(payload.amount ?? 5000);
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      return jsonResponse({ error: "invalid_amount" }, 400);
    }
    const currency = (payload.currency as string) ?? "NGN";
    const reference = (payload.reference as string) ?? genReference();

    const result = await paystackInitializeTransaction({
      email,
      amountSubunits: Math.round(amountMajor * 100),
      currency,
      reference,
      callbackUrl: (payload.callback_url as string) ?? DEFAULT_CALLBACK,
      channels: (payload.channels as string[]) ?? NG_CHANNELS,
      metadata: { source: "meta-orch-1076-proof", ...(payload.metadata as object ?? {}) },
      subaccount: payload.subaccount as string | undefined,
      transactionChargeSubunits: payload.transaction_charge as number | undefined,
      bearer: payload.bearer as "account" | "subaccount" | undefined,
    });

    return jsonResponse({
      mode: resolvePaystackMode(),
      authorization_url: result.authorization_url,
      reference: result.reference,
      access_code: result.access_code,
    });
  } catch (err) {
    return jsonResponse(
      { error: "initialize_failed", detail: String((err as Error)?.message ?? err) },
      502,
    );
  }
});
