/**
 * issue #4522 — "Pay toward your balance" for a trip on a v2 payment plan.
 *
 * verify_jwt=false. A caller is either the order's buyer (a Supabase JWT whose
 * user is orders.buyer_user_id) or holds a balance-link token from a reminder
 * email (its SHA-256 is resolved by issue_4522_resolve_balance_link; the raw
 * token is never stored or logged). Actions:
 *   view   — the balance (remaining, paid, terms, next payment, history).
 *   start  — {amountMinor, expectedRemainingMinor, clientKey, method} opens one
 *            flexible payment (issue_4522_begin_flex_payment: one open per
 *            order, PT409 on a race or a moved balance) and charges it:
 *            Stripe — a PaymentIntent on the brand's connected account with
 *            the instalment fee rule; Paystack — the saved reusable card, or a
 *            hosted page that returns to /pay/balance/{token}?return=1.
 *   status — reconciles a Paystack attempt, then returns the balance.
 * Inert while issue_4522_plan_v2_enabled() is false: begin_flex refuses with
 * payment_plan_v2_unavailable before any provider call.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { applicationFeeWithReferralShare } from "../_shared/attribution.ts";
import {
  installmentFeeCents,
  resolveInstallmentFeeRate,
} from "../_shared/installments/installmentFeeRate.ts";
import { flexPaymentIdempotencyKey } from "../_shared/installments/installmentIdempotencyKey.ts";
import {
  mintPayLinkToken,
  PAY_LINK_TOKEN_PATTERN,
  payLinkTokenHashHex,
} from "../_shared/installments/installmentPayLinks.ts";
import { chargePaystackInstallment } from "../_shared/installments/chargePaystackInstallment.ts";
import { handleInstallmentPaystackCharge } from "../_shared/installments/paystackInstallmentWebhook.ts";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";
import { paystackChannelsForCountry } from "../_shared/paymentProvider.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

type Action = "view" | "start" | "status";
type Method = "saved_card" | "new_card";

/** The Stripe surface this function uses (injectable for tests). */
export interface StripeLike {
  paymentIntents: {
    create(
      params: Record<string, unknown>,
      options: { idempotencyKey: string; stripeAccount: string },
    ): Promise<{ id: string; client_secret: string | null; status: string }>;
  };
}

export interface TripBalancePayDeps {
  supabase: SupabaseClient;
  now: () => Date;
  userIdFromJwt: (jwt: string) => Promise<string | null>;
  stripe: () => StripeLike;
  initialize: typeof paystackInitializeTransaction;
  verify: typeof paystackVerifyTransaction;
  handleCharge: typeof handleInstallmentPaystackCharge;
  chargePaystack: typeof chargePaystackInstallment;
  feeRate: typeof resolveInstallmentFeeRate;
  mintToken: () => string;
}

export const CLIENT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;

const windows = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_LIMIT = 30;

function rateLimited(key: string, now: number): boolean {
  const current = windows.get(key);
  if (current === undefined || now - current.startedAt >= WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > WINDOW_LIMIT;
}

async function defaultUserIdFromJwt(jwt: string): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url === undefined || key === undefined) return null;
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.auth.getUser(jwt);
  return error !== null || data.user === null ? null : data.user.id;
}

/** Database refusals the client maps to copy (spec §7). */
const KNOWN_REFUSALS: Record<string, number> = {
  balance_payment_in_flight: 409,
  balance_changed: 409,
  flex_amount_invalid: 422,
  flex_amount_below_minimum: 422,
  plan_not_flexible: 409,
  deposit_not_paid: 409,
  payment_plan_v2_unavailable: 409,
  order_cancelled: 409,
  event_cancelled: 409,
  balance_not_found: 404,
};

function refusalFrom(
  error: { message?: string; details?: string } | null,
): Response | null {
  if (error === null) return null;
  const message = String(error.message ?? "");
  for (const [code, status] of Object.entries(KNOWN_REFUSALS)) {
    if (message.includes(code)) {
      return jsonResponse({
        error: code,
        ...(code === "balance_changed" || code === "flex_amount_below_minimum"
          ? { detail: error.details ?? null }
          : {}),
      }, status);
    }
  }
  return jsonResponse({ error: "balance_payment_failed" }, 502);
}

function publicBalance(
  balance: Record<string, unknown>,
): Record<string, unknown> {
  // The history and audit stay server-side for the buyer; hosts read them
  // through biz_trip_order_balance.
  const keep = [
    "orderId",
    "currency",
    "depositMinor",
    "paidMinor",
    "remainingMinor",
    "totalMinor",
    "canPayAnyAmount",
    "minPaymentMinor",
    "paymentInFlight",
    "nextPayment",
    "openRows",
    "history",
  ];
  return Object.fromEntries(
    keep.filter((k) => k in balance).map((k) => [k, balance[k]]),
  );
}

export async function handleTripBalancePay(
  req: Request,
  depsIn: Partial<TripBalancePayDeps> = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "") as Action;
  if (!["view", "start", "status"].includes(action)) {
    return jsonResponse({ error: "invalid_action" }, 400);
  }
  const deps: TripBalancePayDeps = {
    supabase: depsIn.supabase ?? serviceClient(),
    now: depsIn.now ?? (() => new Date()),
    userIdFromJwt: depsIn.userIdFromJwt ?? defaultUserIdFromJwt,
    stripe: depsIn.stripe ??
      (() => stripeTicketCheckout() as unknown as StripeLike),
    initialize: depsIn.initialize ?? paystackInitializeTransaction,
    verify: depsIn.verify ?? paystackVerifyTransaction,
    handleCharge: depsIn.handleCharge ?? handleInstallmentPaystackCharge,
    chargePaystack: depsIn.chargePaystack ?? chargePaystackInstallment,
    feeRate: depsIn.feeRate ?? resolveInstallmentFeeRate,
    mintToken: depsIn.mintToken ?? (() => mintPayLinkToken()),
  };
  const { supabase } = deps;
  const now = deps.now();

  // ── Who is asking: a balance-link token, or the order's own buyer. ──────
  const token = typeof body.token === "string" ? body.token : null;
  let orderId: string | null = null;
  let rateKey: string;
  if (token !== null) {
    if (!PAY_LINK_TOKEN_PATTERN.test(token)) {
      return jsonResponse({ error: "invalid_token" }, 400);
    }
    const tokenHash = await payLinkTokenHashHex(token);
    rateKey = `t:${tokenHash}`;
    if (rateLimited(rateKey, now.getTime())) {
      return jsonResponse({ error: "rate_limited" }, 429);
    }
    const { data, error } = await supabase.rpc(
      "issue_4522_resolve_balance_link",
      { p_token_hash: tokenHash },
    );
    if (error !== null) {
      return jsonResponse({ error: "balance_lookup_failed" }, 502);
    }
    const link = (data ?? { state: "invalid" }) as Record<string, unknown>;
    if (link.state === "invalid") {
      return jsonResponse({ state: "invalid" }, 404);
    }
    if (link.state === "expired") {
      return jsonResponse({ error: "balance_link_expired" }, 410);
    }
    if (link.state !== "payable") {
      return jsonResponse({ state: link.state });
    }
    orderId = String(link.order_id);
  } else {
    const auth = req.headers.get("authorization") ?? "";
    const jwt = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    const userId = jwt.length > 0 ? await deps.userIdFromJwt(jwt) : null;
    if (userId === null) return jsonResponse({ error: "unauthorized" }, 401);
    rateKey = `u:${userId}`;
    if (rateLimited(rateKey, now.getTime())) {
      return jsonResponse({ error: "rate_limited" }, 429);
    }
    const requested = typeof body.orderId === "string" ? body.orderId : "";
    const { data: owned } = await supabase.from("orders").select("id")
      .eq("id", requested).eq("buyer_user_id", userId).maybeSingle();
    // Not yours and does not exist give the same answer.
    if (owned === null) {
      return jsonResponse({ error: "balance_not_found" }, 404);
    }
    orderId = requested;
  }

  const loadBalance = async (): Promise<Record<string, unknown> | null> => {
    const { data, error } = await supabase.rpc("issue_4522_balance", {
      p_order_id: orderId,
    });
    if (error !== null) throw new Error("balance_read_failed");
    return (data ?? null) as Record<string, unknown> | null;
  };

  if (action === "view") {
    const balance = await loadBalance();
    if (balance === null) {
      return jsonResponse({ error: "balance_not_found" }, 404);
    }
    return jsonResponse({ state: "payable", balance: publicBalance(balance) });
  }

  if (action === "status") {
    const { data: open } = await supabase.from("order_installments")
      .select("id")
      .eq("order_id", orderId).eq("kind", "flex").in("status", [
        "scheduled",
        "failed",
      ])
      .maybeSingle();
    const flexId = (open as { id?: string } | null)?.id;
    if (typeof flexId === "string") {
      const { data: attempt } = await supabase
        .from("order_installment_charge_attempts")
        .select("reference")
        .eq("installment_id", flexId)
        .in("state", ["created", "unknown"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const reference = (attempt as { reference?: string } | null)?.reference;
      if (typeof reference === "string") {
        try {
          const txn = await deps.verify(reference);
          if (String(txn.status).toLowerCase() === "success") {
            await deps.handleCharge(supabase, reference, txn);
          }
        } catch {
          // Unknown stays unknown; the webhook and the cron reconcile it.
        }
      }
    }
    const balance = await loadBalance();
    return jsonResponse({
      state: "payable",
      paymentInFlight: balance?.paymentInFlight === true,
      balance: balance === null ? null : publicBalance(balance),
    });
  }

  // ── start ─────────────────────────────────────────────────────────────
  const amountMinor = Number(body.amountMinor);
  const expectedRemainingMinor = Number(body.expectedRemainingMinor);
  const clientKey = typeof body.clientKey === "string" ? body.clientKey : "";
  const method = String(body.method ?? "") as Method;
  if (
    !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
    !Number.isSafeInteger(expectedRemainingMinor) ||
    !CLIENT_KEY_PATTERN.test(clientKey) ||
    (method !== "saved_card" && method !== "new_card")
  ) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const { data: orderRow, error: orderError } = await supabase.from("orders")
    .select(
      "id,buyer_email,stripe_customer_id_on_connected_account,saved_payment_method_id,events!inner(brand_id)",
    )
    .eq("id", orderId).maybeSingle();
  if (orderError !== null || orderRow === null) {
    return jsonResponse({ error: "balance_not_found" }, 404);
  }
  const order = orderRow as Record<string, unknown>;
  const event =
    (Array.isArray(order.events) ? order.events[0] : order.events) as
      | Record<string, unknown>
      | undefined;
  const brandId = String(event?.brand_id ?? "");
  const { data: providerRow } = await supabase.from("order_installments")
    .select("provider")
    .eq("order_id", orderId).eq("kind", "scheduled")
    .in("status", ["scheduled", "failed"]).limit(1).maybeSingle();
  const provider = (providerRow as { provider?: string } | null)?.provider;
  if (provider !== "stripe" && provider !== "paystack") {
    return jsonResponse({ error: "balance_not_found" }, 404);
  }

  // A buyer in the app with no saved Paystack card finishes on the balance
  // page: mint a link and send them there (the page starts the payment).
  if (provider === "paystack" && method === "new_card" && token === null) {
    const fresh = deps.mintToken();
    const { data: issued, error: issueError } = await supabase.rpc(
      "issue_4522_issue_balance_link",
      { p_order_id: orderId, p_token_hash: await payLinkTokenHashHex(fresh) },
    );
    if (
      issueError !== null || (issued as { ok?: boolean } | null)?.ok !== true
    ) {
      return jsonResponse({ error: "balance_payment_failed" }, 502);
    }
    return jsonResponse({
      kind: "open_page",
      url: `${PRODUCTION_BUSINESS_WEB_ORIGIN}/pay/balance/${fresh}`,
    });
  }

  const { data: begun, error: beginError } = await supabase.rpc(
    "issue_4522_begin_flex_payment",
    {
      p_order_id: orderId,
      p_amount_minor: amountMinor,
      p_expected_remaining_minor: expectedRemainingMinor,
      p_client_key: clientKey,
      p_method: provider === "paystack" && method === "new_card"
        ? "pay_link"
        : "auto_card",
    },
  );
  const refused = refusalFrom(beginError);
  if (refused !== null) return refused;
  const flex = (begun ?? {}) as Record<string, unknown>;
  const installmentId = String(flex.installmentId ?? "");
  if (installmentId.length === 0) {
    return jsonResponse({ error: "balance_payment_failed" }, 502);
  }

  const closeOnFailure = async (): Promise<void> => {
    await supabase.rpc("issue_4522_close_failed_flex", {
      p_installment_id: installmentId,
    });
  };

  if (provider === "stripe") {
    const { data: account } = await supabase.from("stripe_connect_accounts")
      .select("stripe_account_id").eq("brand_id", brandId).is(
        "detached_at",
        null,
      )
      .maybeSingle();
    const stripeAccount = (account as { stripe_account_id?: string } | null)
      ?.stripe_account_id;
    const customer = order.stripe_customer_id_on_connected_account;
    const savedPm = order.saved_payment_method_id;
    if (typeof stripeAccount !== "string" || typeof customer !== "string") {
      await closeOnFailure();
      return jsonResponse({ error: "balance_payment_failed" }, 502);
    }
    const { data: row } = await supabase.from("order_installments")
      .select("referral_share_minor,currency").eq("id", installmentId)
      .maybeSingle();
    const referralShare = Number(
      (row as { referral_share_minor?: number } | null)?.referral_share_minor ??
        0,
    );
    const currency = String(
      (row as { currency?: string } | null)?.currency ?? flex.currency ?? "",
    )
      .trim().toLowerCase();
    const rate = await deps.feeRate(supabase, brandId);
    const fee = applicationFeeWithReferralShare(
      installmentFeeCents(amountMinor, rate),
      { shareMinor: referralShare },
    );
    try {
      // orch-strict-grep-allow stripe-no-idempotency-key — the idempotency key IS passed in the options argument: one key per flexible payment's client key (flex:<order>:<clientKey>).
      const pi = await deps.stripe().paymentIntents.create(
        {
          amount: amountMinor,
          currency,
          customer,
          ...(method === "saved_card" && typeof savedPm === "string"
            ? { payment_method: savedPm }
            : {}),
          payment_method_types: ["card"],
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
          metadata: {
            mingla_installment_id: installmentId,
            mingla_order_id: String(orderId),
            mingla_brand_id: brandId,
            mingla_flex: "1",
          },
        },
        {
          idempotencyKey: flexPaymentIdempotencyKey(String(orderId), clientKey),
          stripeAccount,
        },
      );
      await supabase.from("order_installments")
        .update({
          stripe_payment_intent_id: pi.id,
          updated_at: now.toISOString(),
        })
        .eq("id", installmentId).eq("kind", "flex");
      return jsonResponse({
        kind: "stripe",
        installmentId,
        amountMinor,
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id,
        stripeAccountId: stripeAccount,
        replayed: flex.replayed === true,
      });
    } catch {
      await closeOnFailure();
      return jsonResponse({ error: "balance_payment_failed" }, 502);
    }
  }

  // Paystack.
  if (method === "saved_card") {
    const charged = await deps.chargePaystack({ supabase, installmentId });
    return jsonResponse({
      kind: "paystack_saved_card",
      installmentId,
      amountMinor,
      outcome: charged.outcome,
    });
  }
  const { data: feeRow } = await supabase.from("order_installments")
    .select("planned_application_fee_cents,referral_share_minor")
    .eq("id", installmentId).maybeSingle();
  const plannedFee = Number(
    (feeRow as { planned_application_fee_cents?: number } | null)
      ?.planned_application_fee_cents ?? 0,
  );
  const fee = applicationFeeWithReferralShare(plannedFee, {
    shareMinor: Number(
      (feeRow as { referral_share_minor?: number } | null)
        ?.referral_share_minor ?? 0,
    ),
  });
  const { data: attemptData, error: attemptError } = await supabase.rpc(
    "issue_3645_begin_installment_attempt",
    {
      p_installment_id: installmentId,
      p_method: "pay_link",
      p_application_fee_cents: fee,
    },
  );
  const attempt = (attemptData ?? {}) as Record<string, unknown>;
  if (attemptError !== null || attempt.ok !== true) {
    return jsonResponse({ error: "balance_payment_in_flight" }, 409);
  }
  try {
    const initialized = await deps.initialize({
      email: String(order.buyer_email ?? ""),
      amountSubunits: Number(attempt.amount_cents),
      currency: "NGN",
      reference: String(attempt.reference),
      callbackUrl:
        `${PRODUCTION_BUSINESS_WEB_ORIGIN}/pay/balance/${token}?return=1`,
      channels: paystackChannelsForCountry("NG"),
      metadata: {
        mingla_installment_id: installmentId,
        mingla_order_id: String(orderId),
        mingla_flex: "1",
      },
    });
    const { error: storeError } = await supabase.rpc(
      "issue_3645_store_attempt_approval_url",
      {
        p_attempt_id: String(attempt.attempt_id),
        p_approval_url: initialized.authorization_url,
      },
    );
    if (storeError !== null) throw new Error("approval_url_store_failed");
    return jsonResponse({
      kind: "redirect",
      url: initialized.authorization_url,
    });
  } catch {
    await supabase.rpc("issue_3645_resolve_installment_attempt", {
      p_attempt_id: String(attempt.attempt_id),
      p_outcome: "unknown",
      p_provider_transaction_id: null,
      p_gateway_response: "initialize_uncertain",
      p_approval_url: null,
      p_provider_fee_cents: null,
      p_verified_amount_cents: null,
    });
    return jsonResponse({ error: "balance_payment_failed" }, 502);
  }
}

if (import.meta.main) serve((req) => handleTripBalancePay(req));
