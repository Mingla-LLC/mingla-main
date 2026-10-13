/**
 * ad-credit — toward #3697 Wave 6 / 7b / 7c.
 *
 * Host Ads credit quotes + ledger applies. Wave 7b: platform Stripe top-up
 * (`start_top_up`) and PaymentIntent verify before `apply_top_up`. Wave 7c:
 * NGN Paystack top-up, platform Stripe/Paystack withdraw refunds (FIFO lots),
 * webhook apply via adCreditWebhook.
 *
 * Actions:
 *   quote_top_up    — fee split + min/max (auth required; no brand gate)
 *   quote_withdraw  — estimate only; live refund uses FIFO lots at apply
 *   start_top_up    — create platform PI (native) or Checkout Session (web)
 *   apply_top_up    — after payment succeeds (payment_ref or checkout_session_id)
 *   apply_withdraw  — debit wallet via FIFO lots; returns refund_cents
 *   get_wallet      — balance + recent ledger (payment view authority)
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  quoteTopUp,
  quoteWithdraw,
} from "../_shared/adMoney.ts";
import {
  adCreditTopUpMetadata,
  buildAdCreditPaystackReference,
  isAdCreditPaystackTopUpCurrency,
  isAdCreditStripeTopUpCurrency,
  verifyAdCreditTopUpPaymentIntent,
} from "../_shared/adCreditStripe.ts";
import {
  PRODUCTION_BUSINESS_WEB_ORIGIN,
  resolveBusinessWebOrigin,
} from "../_shared/businessWebOrigin.ts";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";
import { createPaystackRefund } from "../_shared/paystackRefunds.ts";
import {
  stripeTicketCheckout,
  stripeTicketRefund,
} from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function configuredBusinessWebOrigin(): string {
  const fromEnv = (Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "").trim().replace(
    /\/$/,
    "",
  );
  return fromEnv.length > 0 ? fromEnv : PRODUCTION_BUSINESS_WEB_ORIGIN;
}

/** Checkout returns only to Mingla business web (or host deep link). */
function isAllowedAdCreditReturnUrl(returnUrl: string): boolean {
  if (returnUrl.startsWith("mingla-business://")) return true;
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const configured = configuredBusinessWebOrigin();
  const origin = parsed.origin;
  const resolved = resolveBusinessWebOrigin({
    configuredOrigin: configured,
    override: origin === configured ? undefined : origin,
  });
  return resolved.ok && resolved.origin === origin;
}

/**
 * Build Stripe success/cancel URLs from a validated return path.
 * `{CHECKOUT_SESSION_ID}` must stay literal (Stripe template — do not encode).
 */
function buildAdCreditCheckoutReturnUrls(
  returnUrl: string,
): { successUrl: string; cancelUrl: string } | null {
  if (!isAllowedAdCreditReturnUrl(returnUrl)) return null;
  if (returnUrl.startsWith("mingla-business://")) {
    const sep = returnUrl.includes("?") ? "&" : "?";
    return {
      successUrl:
        `${returnUrl}${sep}ad_credit_top_up=1&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${returnUrl}${sep}ad_credit_top_up=0&payment=cancelled`,
    };
  }
  let base: URL;
  try {
    base = new URL(returnUrl);
  } catch {
    return null;
  }
  const success = new URL(base.pathname + base.search, base.origin);
  success.searchParams.set("ad_credit_top_up", "1");
  const cancel = new URL(base.pathname + base.search, base.origin);
  cancel.searchParams.set("ad_credit_top_up", "0");
  cancel.searchParams.set("payment", "cancelled");
  return {
    successUrl: `${success.toString()}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: cancel.toString(),
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "quote_top_up") {
    const payCents = typeof body.pay_cents === "number" ? body.pay_cents : NaN;
    const currency = typeof body.currency === "string" ? body.currency : "USD";
    const quoted = quoteTopUp(payCents, currency);
    if (!quoted.ok) return json({ error: quoted.error, detail: quoted.detail }, 400);
    return json(quoted);
  }

  if (action === "quote_withdraw") {
    const creditCents = typeof body.credit_cents === "number"
      ? body.credit_cents
      : NaN;
    const quoted = quoteWithdraw(creditCents);
    if (!quoted.ok) return json({ error: quoted.error, detail: quoted.detail }, 400);
    return json({
      ...quoted,
      note: "estimate_only_fifo_lots_apply_at_withdraw",
    });
  }

  const brandId = typeof body.brand_id === "string" ? body.brand_id : "";
  if (!UUID_REGEX.test(brandId)) {
    return json({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }

  if (action === "get_wallet") {
    const { data: canView, error: viewErr } = await supabase.rpc(
      "biz_can_view_payments_for_brand",
      { p_brand_id: brandId, p_user_id: user.id },
    );
    if (viewErr) {
      console.error("[ad-credit] view auth failed:", viewErr.message);
      return json({ error: "internal_error" }, 500);
    }
    if (canView !== true) {
      return json({ error: "forbidden", detail: "permission_denied" }, 403);
    }

    const { data: wallet } = await supabase
      .from("ad_credit_wallets")
      .select("brand_id, currency, balance_cents, updated_at")
      .eq("brand_id", brandId)
      .maybeSingle();
    const { data: history } = await supabase
      .from("ad_credit_ledger")
      .select(
        "id, entry_kind, amount_cents, fee_cents, pay_cents, refund_cents, balance_after_cents, currency, created_at, external_ref",
      )
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(50);
    return json({
      wallet: wallet ?? {
        brand_id: brandId,
        currency: "USD",
        balance_cents: 0,
        updated_at: null,
      },
      history: history ?? [],
    });
  }

  // Mutating actions: owner / brand_admin / finance_manager (not event_manager).
  const { data: canManage, error: manageErr } = await supabase.rpc(
    "biz_can_manage_payments_for_brand",
    { p_brand_id: brandId, p_user_id: user.id },
  );
  if (manageErr) {
    console.error("[ad-credit] manage auth failed:", manageErr.message);
    return json({ error: "internal_error" }, 500);
  }
  if (canManage !== true) {
    return json({ error: "forbidden", detail: "permission_denied" }, 403);
  }

  // Wave 7b: platform Stripe top-up (host → Mingla). Reuses TICKET_CHECKOUT
  // RAK for platform PIs — no stripeAccount, no application_fee.
  if (action === "start_top_up") {
    const payCents = typeof body.pay_cents === "number" ? body.pay_cents : NaN;
    const currency = typeof body.currency === "string" ? body.currency : "USD";
    const returnUrl = typeof body.return_url === "string"
      ? body.return_url.trim()
      : "";
    const clientIdem = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    // Client must own the attempt key (stable across transport retries).
    if (clientIdem.length < 8) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }

    const quoted = quoteTopUp(payCents, currency);
    if (!quoted.ok) return json({ error: quoted.error, detail: quoted.detail }, 400);
    const stripeOk = isAdCreditStripeTopUpCurrency(quoted.currency);
    const paystackOk = isAdCreditPaystackTopUpCurrency(quoted.currency);
    if (!stripeOk && !paystackOk) {
      return json({
        error: "validation_error",
        detail: "currency_unsupported",
      }, 400);
    }

    const meta = adCreditTopUpMetadata({
      brandId,
      payCents: quoted.pay_cents,
      currency: quoted.currency,
      actorId: user.id,
    });
    const createIdem =
      `ad_credit_top_up:${brandId}:${quoted.pay_cents}:${quoted.currency}:${clientIdem}`
        .slice(0, 240);

    // Wave 7c — NGN via Paystack (host→Mingla; no subaccount split).
    if (paystackOk) {
      if (returnUrl.length === 0 || !buildAdCreditCheckoutReturnUrls(returnUrl)) {
        return json({
          error: "validation_error",
          detail: "return_url_invalid",
        }, 400);
      }
      const email = typeof user.email === "string" && user.email.includes("@")
        ? user.email
        : `ads-credit+${brandId.slice(0, 8)}@usemingla.com`;
      const reference = buildAdCreditPaystackReference({
        brandId,
        clientIdem,
      });
      try {
        const init = await paystackInitializeTransaction({
          email,
          amountSubunits: quoted.pay_cents,
          currency: "NGN",
          reference,
          callbackUrl: returnUrl,
          metadata: {
            ...meta,
            mingla_idempotency_key: clientIdem,
          },
        });
        return json({
          ok: true,
          kind: "requires_checkout_redirect",
          url: init.authorization_url,
          checkout_session_id: init.reference,
          payment_intent_id: null,
          paystack_reference: init.reference,
          quote: quoted,
        });
      } catch (e) {
        console.error("[ad-credit] start_top_up paystack failed:", e);
        return json({
          error: "apply_failed",
          detail: "paystack_start_failed",
        }, 502);
      }
    }

    const stripe = stripeTicketCheckout();
    try {
      if (returnUrl.length > 0) {
        const urls = buildAdCreditCheckoutReturnUrls(returnUrl);
        if (!urls) {
          return json({
            error: "validation_error",
            detail: "return_url_invalid",
          }, 400);
        }

        // Platform Checkout Session (no stripeAccount) — host pays Mingla.
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            currency: quoted.currency.toLowerCase(),
            line_items: [{
              price_data: {
                currency: quoted.currency.toLowerCase(),
                unit_amount: quoted.pay_cents,
                product_data: { name: "Mingla Ads credit" },
              },
              quantity: 1,
            }],
            payment_intent_data: {
              metadata: meta,
              statement_descriptor_suffix: "ADS CREDIT",
            },
            success_url: urls.successUrl,
            cancel_url: urls.cancelUrl,
            metadata: meta,
          },
          { idempotencyKey: `cs:${createIdem}` },
        );
        if (!session.url) {
          return json({ error: "apply_failed", detail: "checkout_url_missing" }, 502);
        }
        const piId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
        return json({
          ok: true,
          kind: "requires_checkout_redirect",
          url: session.url,
          checkout_session_id: session.id,
          payment_intent_id: piId,
          quote: quoted,
        });
      }

      const pi = await stripe.paymentIntents.create(
        {
          amount: quoted.pay_cents,
          currency: quoted.currency.toLowerCase(),
          payment_method_types: ["card", "link"],
          metadata: meta,
          statement_descriptor_suffix: "ADS CREDIT",
        },
        { idempotencyKey: createIdem },
      );
      if (!pi.client_secret) {
        return json({
          error: "apply_failed",
          detail: "client_secret_missing",
        }, 502);
      }
      // Host uses its bundled EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (platform PI;
      // no Connect stripeAccountId). Avoid resolvePublishableKey here so
      // ad-credit does not pull unclassified publishable-key literals.
      return json({
        ok: true,
        kind: "requires_payment_sheet",
        client_secret: pi.client_secret,
        payment_intent_id: pi.id,
        quote: quoted,
      });
    } catch (e) {
      console.error("[ad-credit] start_top_up stripe failed:", e);
      return json({
        error: "apply_failed",
        detail: "stripe_start_failed",
      }, 502);
    }
  }

  if (action === "apply_top_up") {
    let payCents = typeof body.pay_cents === "number" ? body.pay_cents : NaN;
    let currency = typeof body.currency === "string" ? body.currency : "USD";
    let paymentRef = typeof body.payment_ref === "string"
      ? body.payment_ref.trim()
      : "";
    const checkoutSessionId = typeof body.checkout_session_id === "string"
      ? body.checkout_session_id.trim()
      : "";
    const paystackReference = typeof body.paystack_reference === "string"
      ? body.paystack_reference.trim()
      : "";
    const idempotencyKey = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    if (!paymentRef && !checkoutSessionId && !paystackReference) {
      return json({ error: "validation_error", detail: "payment_ref_required" }, 400);
    }

    let quoted;
    try {
      // Paystack NGN: verify transaction by reference.
      if (paystackReference || paymentRef.startsWith("mingla_adc_")) {
        const ref = paystackReference || paymentRef;
        const verified = await paystackVerifyTransaction(ref);
        const status = String(verified.status ?? "");
        if (status !== "success") {
          return json({
            error: "validation_error",
            detail: "payment_not_succeeded",
          }, 400);
        }
        const amount = typeof verified.amount === "number" ? verified.amount : NaN;
        const cur = typeof verified.currency === "string"
          ? verified.currency.toUpperCase()
          : "NGN";
        payCents = amount;
        currency = cur;
        paymentRef = ref;
        quoted = quoteTopUp(payCents, currency);
        if (!quoted.ok) {
          return json({ error: quoted.error, detail: quoted.detail }, 400);
        }
        if (!isAdCreditPaystackTopUpCurrency(quoted.currency)) {
          return json({
            error: "validation_error",
            detail: "currency_unsupported",
          }, 400);
        }
        const metaRaw = verified.metadata;
        const meta = metaRaw && typeof metaRaw === "object"
          ? metaRaw as Record<string, unknown>
          : {};
        if (String(meta.mingla_purpose ?? "") !== "ad_credit_top_up") {
          return json({
            error: "validation_error",
            detail: "payment_purpose_mismatch",
          }, 400);
        }
        if (String(meta.brand_id ?? "") !== brandId) {
          return json({
            error: "validation_error",
            detail: "payment_brand_mismatch",
          }, 400);
        }
      } else {
        // Reuses TICKET_CHECKOUT RAK — platform retrieve (no stripeAccount).
        const stripe = stripeTicketCheckout();
        if (!paymentRef && checkoutSessionId) {
          // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
          const session = await stripe.checkout.sessions.retrieve(
            checkoutSessionId,
          ); // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
          const piField = session.payment_intent;
          paymentRef = typeof piField === "string"
            ? piField
            : (piField && typeof piField === "object" && "id" in piField
              ? String((piField as { id: string }).id)
              : "");
          if (!paymentRef) {
            return json({
              error: "validation_error",
              detail: "payment_not_found",
            }, 400);
          }
        }

        // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
        const pi = await stripe.paymentIntents.retrieve(paymentRef); // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
        if (checkoutSessionId || !Number.isFinite(payCents) || payCents <= 0) {
          payCents = typeof pi.amount === "number" ? pi.amount : NaN;
          currency = typeof pi.currency === "string"
            ? pi.currency.toUpperCase()
            : currency;
        }
        quoted = quoteTopUp(payCents, currency);
        if (!quoted.ok) {
          return json({ error: quoted.error, detail: quoted.detail }, 400);
        }
        if (!isAdCreditStripeTopUpCurrency(quoted.currency)) {
          return json({
            error: "validation_error",
            detail: "currency_unsupported",
          }, 400);
        }
        const verified = verifyAdCreditTopUpPaymentIntent(pi, {
          brandId,
          payCents: quoted.pay_cents,
          currency: quoted.currency,
        });
        if (!verified.ok) {
          return json({
            error: "validation_error",
            detail: verified.detail,
          }, 400);
        }
      }
    } catch (e) {
      console.error("[ad-credit] apply_top_up verify failed:", e);
      return json({
        error: "validation_error",
        detail: "payment_not_found",
      }, 400);
    }

    const { data, error } = await supabase.rpc("ad_credit_apply", {
      p_brand_id: brandId,
      p_entry_kind: "top_up",
      p_amount_cents: quoted.credit_cents,
      p_currency: quoted.currency,
      p_idempotency_key: idempotencyKey || `top_up:${paymentRef}`,
      p_fee_cents: quoted.fee_cents,
      p_pay_cents: quoted.pay_cents,
      p_refund_cents: null,
      p_campaign_id: null,
      p_external_ref: paymentRef,
      p_actor_id: user.id,
      p_metadata: { source: "ad-credit", action: "apply_top_up" },
    });
    if (error) {
      return json({
        error: "apply_failed",
        detail: error.message,
      }, 409);
    }
    return json({ ok: true, quote: quoted, result: data, payment_ref: paymentRef });
  }

  if (action === "apply_withdraw") {
    const creditCents = typeof body.credit_cents === "number"
      ? body.credit_cents
      : NaN;
    const idempotencyKey = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    const quoted = quoteWithdraw(creditCents);
    if (!quoted.ok) return json({ error: quoted.error, detail: quoted.detail }, 400);
    if (!idempotencyKey) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }

    const { data: wallet } = await supabase
      .from("ad_credit_wallets")
      .select("currency, balance_cents")
      .eq("brand_id", brandId)
      .maybeSingle();
    const currency = typeof wallet?.currency === "string" ? wallet.currency : "USD";
    if (!wallet || Number(wallet.balance_cents) < quoted.credit_cents) {
      return json({ error: "insufficient_credit", detail: "balance_too_low" }, 409);
    }

    // Debit + pending provider_refunds (FIFO lot takes). Edge issues refunds.
    const { data, error } = await supabase.rpc("ad_credit_apply", {
      p_brand_id: brandId,
      p_entry_kind: "withdraw",
      p_amount_cents: quoted.credit_cents,
      p_currency: currency,
      p_idempotency_key: idempotencyKey,
      p_fee_cents: 0,
      p_pay_cents: null,
      p_refund_cents: null,
      p_campaign_id: null,
      p_external_ref: null,
      p_actor_id: user.id,
      p_metadata: {
        source: "ad-credit",
        action: "apply_withdraw",
      },
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("ad_credit_insufficient")) {
        return json({ error: "insufficient_credit", detail: "balance_too_low" }, 409);
      }
      if (msg.includes("ad_credit_lot_missing_payment_ref")) {
        return json({
          error: "apply_failed",
          detail: "withdraw_missing_payment_ref",
        }, 409);
      }
      if (msg.includes("ad_credit_lot_payment_ref_unsupported")) {
        return json({
          error: "apply_failed",
          detail: "withdraw_payment_ref_unsupported",
        }, 409);
      }
      return json({ error: "apply_failed", detail: msg }, 409);
    }
    const result = data && typeof data === "object"
      ? data as Record<string, unknown>
      : {};
    const refunds = Array.isArray(result.provider_refunds)
      ? result.provider_refunds as Array<Record<string, unknown>>
      : [];

    // Platform Stripe refunds (no stripeAccount) — same Mingla platform charge
    // as Wave 7b top-up. Reuses TICKET_REFUND RAK for refunds:write.
    const stripe = stripeTicketRefund();
    let refundFailures = 0;
    for (const row of refunds) {
      const status = String(row.status ?? "");
      if (status === "succeeded") continue;
      const id = String(row.id ?? "");
      const provider = String(row.provider ?? "");
      const paymentRef = String(row.payment_ref ?? "");
      const payTake = Number(row.pay_take_cents);
      const rowIdem = String(row.idempotency_key ?? "");
      if (!id || !paymentRef || !Number.isFinite(payTake) || payTake <= 0) {
        refundFailures += 1;
        continue;
      }
      try {
        if (provider === "stripe") {
          const refund = await stripe.refunds.create(
            {
              payment_intent: paymentRef,
              amount: payTake,
              metadata: {
                mingla_purpose: "ad_credit_withdraw",
                brand_id: brandId,
              },
            },
            { idempotencyKey: rowIdem },
          );
          await supabase.rpc("ad_credit_mark_provider_refund", {
            p_id: id,
            p_status: "succeeded",
            p_provider_refund_id: refund.id,
            p_error_detail: null,
          });
        } else if (provider === "paystack") {
          const refund = await createPaystackRefund({
            transaction: paymentRef,
            amountSubunits: payTake,
            currency: "NGN",
            merchantNote: rowIdem.slice(0, 100),
          });
          await supabase.rpc("ad_credit_mark_provider_refund", {
            p_id: id,
            p_status: "succeeded",
            p_provider_refund_id: refund.id,
            p_error_detail: null,
          });
        } else {
          refundFailures += 1;
          await supabase.rpc("ad_credit_mark_provider_refund", {
            p_id: id,
            p_status: "failed",
            p_provider_refund_id: null,
            p_error_detail: "provider_unsupported",
          });
        }
      } catch (e) {
        refundFailures += 1;
        console.error("[ad-credit] provider refund failed:", e);
        await supabase.rpc("ad_credit_mark_provider_refund", {
          p_id: id,
          p_status: "failed",
          p_provider_refund_id: null,
          p_error_detail: e instanceof Error ? e.message : "refund_failed",
        });
      }
    }

    if (refundFailures > 0) {
      return json({
        ok: false,
        error: "apply_failed",
        detail: "provider_refund_partial",
        estimate: quoted,
        result,
        provider_refund_cents: result.refund_cents ?? null,
      }, 502);
    }

    return json({
      ok: true,
      estimate: quoted,
      result,
      provider_refund_cents: result.refund_cents ?? null,
    });
  }

  return json({ error: "validation_error", detail: "action_invalid" }, 400);
});
