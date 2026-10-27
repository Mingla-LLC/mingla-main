// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  gigPaystackInitialize,
  type GigQuote,
  gigStripeIntent,
  gigTopupPaystackInitialize,
  gigTopupStripeIntent,
  quoteGig,
} from "../_shared/gigMoney.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null) as
    | Record<string, unknown>
    | null;
  if (!body) return json({ error: "invalid_json" }, 400);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userDb = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const serviceDb = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: { user } } = await userDb.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const action = String(body.action ?? "");
  if (action === "start") {
    const interestId = String(body.interest_id ?? "");
    const clientKey = String(body.idempotency_key ?? "");
    if (!uuid.test(interestId) || clientKey.length < 8) {
      return json({ error: "validation_error" }, 400);
    }
    const feeMinor = Number(body.fee_minor);
    let quote;
    try {
      quote = quoteGig(feeMinor, "NGN");
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "invalid_quote",
      }, 400);
    }
    const idempotencyKey = `gig_hold:${interestId}:${clientKey}`.slice(0, 240);
    const { data: prepared, error: prepareError } = await userDb.rpc(
      "gig_offer_prepare",
      {
        p_interest_id: interestId,
        p_terms: {
          ...(typeof body.terms === "object" && body.terms ? body.terms : {}),
          fee_minor: feeMinor,
        },
        p_idempotency_key: idempotencyKey,
      },
    );
    if (prepareError || !prepared) {
      return json({
        error: "offer_prepare_failed",
        detail: prepareError?.message,
      }, prepareError?.code === "42501" ? 403 : 409);
    }
    // Validation failures (gig_full, interest_not_open, already_offered...)
    // come back as {ok:false}; never start a payment for them.
    if (prepared.ok === false) {
      return json({
        error: String(prepared.error),
        field: prepared.field ?? null,
      }, 409);
    }
    quote = quoteGig(Number(prepared.fee_minor), String(prepared.currency));
    const contractId = String(prepared.contract_id);
    const termsVersion = Number(prepared.terms_version);
    const rail = String(prepared.rail);
    try {
      if (rail === "paystack") {
        const initialized = await paystackInitializeTransaction(
          gigPaystackInitialize({
            contractId,
            termsVersion,
            quote,
            email: user.email ?? `gig+${user.id.slice(0, 8)}@usemingla.com`,
            callbackUrl: typeof body.return_url === "string"
              ? body.return_url
              : null,
          }),
        );
        return json({
          ok: true,
          kind: "requires_checkout_redirect",
          contract_id: contractId,
          terms_version: termsVersion,
          rail,
          url: initialized.authorization_url,
          provider_ref: initialized.reference,
          quote,
        });
      }
      const stripe = stripeTicketCheckout();
      const intent = await stripe.paymentIntents.create(
        gigStripeIntent({ contractId, termsVersion, quote }),
        { idempotencyKey: `gig_hold:${contractId}:${termsVersion}` },
      );
      if (!intent.client_secret) {
        return json({ error: "client_secret_missing" }, 502);
      }
      return json({
        ok: true,
        kind: "requires_payment_sheet",
        contract_id: contractId,
        terms_version: termsVersion,
        rail,
        client_secret: intent.client_secret,
        provider_ref: intent.id,
        quote,
      });
    } catch (error) {
      console.error("[gig-hire] provider start failed", error);
      return json({ error: "provider_start_failed" }, 502);
    }
  }
  if (action === "topup") {
    // A host accepted a higher counter-offer: charge only the difference on
    // the same rail. Same response shapes as "start".
    const contractId = String(body.contract_id ?? "");
    const termsVersion = Number(body.terms_version);
    if (!uuid.test(contractId) || !Number.isInteger(termsVersion)) {
      return json({ error: "validation_error" }, 400);
    }
    const { data: prepared, error: prepareError } = await userDb.rpc(
      "gig_topup_prepare",
      { p_contract_id: contractId, p_terms_version: termsVersion },
    );
    if (prepareError || !prepared) {
      return json(
        { error: "topup_prepare_failed" },
        prepareError?.code === "42501" ? 403 : 409,
      );
    }
    if (prepared.ok === false) {
      return json({ error: String(prepared.error) }, 409);
    }
    const quote: GigQuote = {
      feeMinor: Number(prepared.fee_minor),
      bookingFeeMinor: Number(prepared.booking_fee_minor),
      totalMinor: Number(prepared.total_minor),
      currency: String(prepared.currency),
    };
    if (!Number.isSafeInteger(quote.totalMinor) || quote.totalMinor <= 0) {
      return json({ error: "topup_amount_invalid" }, 409);
    }
    const rail = String(prepared.rail);
    try {
      if (rail === "paystack") {
        const initialized = await paystackInitializeTransaction(
          gigTopupPaystackInitialize({
            contractId,
            termsVersion,
            quote,
            email: user.email ?? `gig+${user.id.slice(0, 8)}@usemingla.com`,
            callbackUrl: typeof body.return_url === "string"
              ? body.return_url
              : null,
          }),
        );
        return json({
          ok: true,
          kind: "requires_checkout_redirect",
          contract_id: contractId,
          terms_version: termsVersion,
          rail,
          url: initialized.authorization_url,
          provider_ref: initialized.reference,
          quote,
        });
      }
      const intent = await stripeTicketCheckout().paymentIntents.create(
        gigTopupStripeIntent({ contractId, termsVersion, quote }),
        { idempotencyKey: `gig_topup:${contractId}:${termsVersion}` },
      );
      if (!intent.client_secret) {
        return json({ error: "client_secret_missing" }, 502);
      }
      return json({
        ok: true,
        kind: "requires_payment_sheet",
        contract_id: contractId,
        terms_version: termsVersion,
        rail,
        client_secret: intent.client_secret,
        provider_ref: intent.id,
        quote,
      });
    } catch (error) {
      console.error("[gig-hire] topup start failed", error);
      return json({ error: "provider_start_failed" }, 502);
    }
  }
  if (action === "confirm") {
    const contractId = String(body.contract_id ?? "");
    const termsVersion = Number(body.terms_version);
    const rail = String(body.rail ?? "");
    const providerRef = String(body.provider_ref ?? "");
    if (
      !uuid.test(contractId) || !Number.isInteger(termsVersion) || !providerRef
    ) return json({ error: "validation_error" }, 400);
    try {
      let kind = "gig_hold";
      if (rail === "paystack") {
        const verified = await paystackVerifyTransaction(providerRef);
        const metadata = verified.metadata as
          | Record<string, unknown>
          | undefined;
        if (
          String(verified.status) !== "success" ||
          String(metadata?.contract_id ?? "") !== contractId ||
          String(metadata?.terms_version ?? "") !== String(termsVersion)
        ) return json({ error: "payment_not_proven" }, 409);
        kind = String(metadata?.mingla_kind ?? "gig_hold");
      } else {
        const pi = await stripeTicketCheckout().paymentIntents.retrieve(
          providerRef,
        );
        if (
          pi.status !== "succeeded" || pi.metadata.contract_id !== contractId ||
          pi.metadata.terms_version !== String(termsVersion)
        ) return json({ error: "payment_not_proven" }, 409);
        kind = String(pi.metadata.mingla_kind ?? "gig_hold");
      }
      // The provider's own metadata says whether this was the offer hold or
      // a counter-offer top-up; both recorders are replay-safe.
      const { data, error } = await serviceDb.rpc(
        kind === "gig_topup"
          ? "gig_topup_mark_captured"
          : "gig_hold_mark_captured",
        {
          p_contract_id: contractId,
          p_terms_version: termsVersion,
          p_provider_ref: providerRef,
        },
      );
      if (error) throw error;
      return json({ ok: true, hold: data });
    } catch (error) {
      console.error("[gig-hire] confirm failed", error);
      return json({ error: "payment_confirm_failed" }, 502);
    }
  }
  return json({ error: "unknown_action" }, 400);
});
