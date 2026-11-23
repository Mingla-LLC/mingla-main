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
  defaultDispatchBuyerEmail,
  mintPayLinkToken,
  PAY_LINK_TOKEN_PATTERN,
  payLinkTokenHashHex,
} from "../_shared/installments/installmentPayLinks.ts";
import { claimPaidInFullNotice } from "../_shared/installments/paidInFullNotice.ts";
import { chargePaystackInstallment } from "../_shared/installments/chargePaystackInstallment.ts";
import {
  createFlexPaymentIntent,
  type FlexPaymentIntentStripe,
} from "../_shared/installments/createInstallmentPI.ts";
import { handleInstallmentPaystackCharge } from "../_shared/installments/paystackInstallmentWebhook.ts";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";
import { paystackChannelsForCountry } from "../_shared/paymentProvider.ts";
import { STRIPE_API_VERSION, stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  type FlexStripe,
  loadFlexPaymentsToVerify,
  verifyOpenFlexPayments,
} from "../_shared/installments/flexReclaim.ts";
import { handleInstallmentPaymentSucceeded } from "../_shared/installmentWebhookHandlers.ts";
import { installmentOpsAlert } from "../_shared/installments/installmentOpsAlert.ts";
import { planV2SchemaAvailable } from "../_shared/installments/planV2Schema.ts";
import { resolvePublishableKey } from "../_shared/stripeMode.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

type Action = "view" | "start" | "status";
type Method = "saved_card" | "new_card";

/** The Stripe surface this function uses (injectable for tests). */
export type StripeLike = FlexPaymentIntentStripe & FlexStripe & {
  ephemeralKeys: {
    create(
      params: { customer: string },
      options: {
        apiVersion: string;
        stripeAccount: string;
        idempotencyKey: string;
      },
    ): Promise<{ secret?: string | null }>;
  };
};

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
  publishableKey: () => string;
  /** issue #4522 (N3) — the webhook's success path for a verified PaymentIntent. */
  settleStripe: (supabase: SupabaseClient, paymentIntent: Record<string, unknown>) => Promise<void>;
  alertOps: (subject: string, paragraphs: string[]) => Promise<void>;
}

async function defaultSettleStripe(
  supabase: SupabaseClient,
  paymentIntent: Record<string, unknown>,
): Promise<void> {
  await handleInstallmentPaymentSucceeded(supabase, {
    type: "payment_intent.succeeded",
    data: { object: paymentIntent },
  });
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
  // A client key reused for another amount or method (never replays the row).
  flex_client_key_reused: 409,
  flex_amount_invalid: 422,
  flex_amount_below_minimum: 422,
  // T4-3: short of the whole balance, it would leave less than the provider can charge.
  flex_amount_leaves_unpayable_remainder: 422,
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
        ...(code === "balance_changed" || code === "flex_amount_below_minimum" ||
            code === "flex_amount_leaves_unpayable_remainder"
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
    "maxPartialMinor",
    "providerMinimumMinor",
    "waivedMinor",
    "paymentInFlight",
    "heldCreditMinor",
    "overpaymentRefundedMinor",
    "nextPayment",
    "openRows",
    "history",
  ];
  // issue #4522 (N6) — the clients show the flexible actions only for a v2
  // plan; an older instalment plan keeps its schedule as before.
  const terms = balance.terms as { v?: unknown } | null | undefined;
  const planVersion = Number.isSafeInteger(terms?.v) ? Number(terms?.v) : 1;
  return {
    ...Object.fromEntries(
      keep.filter((k) => k in balance).map((k) => [k, balance[k]]),
    ),
    planVersion,
  };
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
    publishableKey: depsIn.publishableKey ?? resolvePublishableKey,
    settleStripe: depsIn.settleStripe ?? defaultSettleStripe,
    alertOps: depsIn.alertOps ?? installmentOpsAlert,
  };
  const { supabase } = deps;
  const now = deps.now();

  // issue #4522 (F6) — this endpoint exists only with the #4522 schema. While
  // the function is deployed ahead of its migrations it refuses cleanly.
  if (!(await planV2SchemaAvailable(supabase))) {
    return jsonResponse({ error: "payment_plan_v2_unavailable" }, 409);
  }

  // ── Who is asking: a balance-link token, or the order's own buyer. ──────
  const token = typeof body.token === "string" ? body.token : null;
  let orderId: string | null = null;
  let credentialState = "payable";
  let tokenTripTitle: string | undefined;
  let tokenBrandName: string | undefined;
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
    credentialState = String(link.state);
    tokenTripTitle = typeof link.trip_title === "string"
      ? link.trip_title
      : undefined;
    tokenBrandName = typeof link.brand_name === "string"
      ? link.brand_name
      : undefined;
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

  const loadPresentation = async (): Promise<Record<string, unknown>> => {
    const { data: row } = await supabase.from("orders")
      .select(
        "payment_card_last4,events!inner(title,brands(name))",
      )
      .eq("id", orderId).maybeSingle();
    const order = (row ?? {}) as Record<string, unknown>;
    const event =
      (Array.isArray(order.events) ? order.events[0] : order.events) as
        | Record<string, unknown>
        | undefined;
    const brand =
      (Array.isArray(event?.brands) ? event?.brands[0] : event?.brands) as
        | Record<string, unknown>
        | undefined;
    const { data: providerRow } = await supabase.from("order_installments")
      .select("provider")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const provider = (providerRow as { provider?: unknown } | null)?.provider;
    const last4 = order.payment_card_last4;
    return {
      ...(tokenTripTitle ?? event?.title
        ? { tripTitle: String(tokenTripTitle ?? event?.title) }
        : {}),
      ...(tokenBrandName ?? brand?.name
        ? { brandName: String(tokenBrandName ?? brand?.name) }
        : {}),
      ...(provider === "stripe" || provider === "paystack" ? { provider } : {}),
      ...(typeof last4 === "string" && /^[0-9]{4}$/.test(last4)
        ? { savedCardLast4: last4 }
        : {}),
    };
  };

  if (action === "view") {
    const balance = await loadBalance();
    if (balance === null) {
      return jsonResponse({ error: "balance_not_found" }, 404);
    }
    return jsonResponse({
      state: credentialState,
      ...(await loadPresentation()),
      balance: publicBalance(balance),
    });
  }

  if (action === "status") {
    if (credentialState !== "payable") {
      const balance = await loadBalance();
      return jsonResponse({
        state: credentialState,
        ...(await loadPresentation()),
        balance: balance === null ? null : publicBalance(balance),
      });
    }
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
      state: credentialState,
      ...(await loadPresentation()),
      paymentInFlight: balance?.paymentInFlight === true,
      balance: balance === null ? null : publicBalance(balance),
    });
  }

  if (credentialState !== "payable") {
    return jsonResponse(
      { error: "payment_not_due", state: credentialState },
      409,
    );
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
      "id,buyer_email,payment_status,cancelled_at,stripe_customer_id_on_connected_account,saved_payment_method_id,events!inner(brand_id,status)",
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
    if (order.cancelled_at !== null || event?.status === "cancelled") {
      return jsonResponse({ error: "order_cancelled" }, 409);
    }
    if (order.payment_status !== "paid") {
      return jsonResponse({ error: "deposit_not_paid" }, 409);
    }
    const { data: enabled, error: switchError } = await supabase.rpc(
      "issue_4522_plan_v2_enabled",
    );
    if (switchError !== null || enabled !== true) {
      return jsonResponse({ error: "payment_plan_v2_unavailable" }, 409);
    }
    const current = await loadBalance();
    if (current === null) {
      return jsonResponse({ error: "balance_not_found" }, 404);
    }
    const remaining = Number(current.remainingMinor);
    const next = (current.nextPayment ?? null) as
      | { amountMinor?: unknown }
      | null;
    const nextAmount = Number(next?.amountMinor);
    const flexible = current.canPayAnyAmount === true;
    const minimum = Number(current.minPaymentMinor ?? 0);
    if (remaining !== expectedRemainingMinor) {
      return jsonResponse(
        { error: "balance_changed", detail: String(remaining) },
        409,
      );
    }
    if (amountMinor > remaining) {
      return jsonResponse({ error: "flex_amount_invalid" }, 422);
    }
    if (flexible && amountMinor < minimum) {
      return jsonResponse(
        { error: "flex_amount_below_minimum", detail: String(minimum) },
        422,
      );
    }
    // T4-3: the same rule as issue_4522_begin_flex_payment (quoted as maxPartialMinor).
    const maxPartial = current.maxPartialMinor === undefined ? remaining
      : current.maxPartialMinor === null ? null : Number(current.maxPartialMinor);
    if (flexible && amountMinor < remaining && (maxPartial === null || amountMinor > maxPartial)) {
      return jsonResponse(
        { error: "flex_amount_leaves_unpayable_remainder", detail: String(maxPartial ?? 0) },
        422,
      );
    }
    if (!flexible && amountMinor !== nextAmount && amountMinor !== remaining) {
      return jsonResponse({ error: "plan_not_flexible" }, 409);
    }
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

  // issue #4522 (N3) — an earlier payment still open on this order is never
  // released on time alone: ask its provider first, and settle or release it
  // on the answer. A payment that succeeded is settled now, so the begin below
  // answers balance_changed and the buyer sees the new balance.
  try {
    const open = await loadFlexPaymentsToVerify(supabase, String(orderId), 10);
    if (open.length > 0) {
      const stripeAccountForOrder = async (): Promise<string | null> => {
        const { data: account } = await supabase.from("stripe_connect_accounts")
          .select("stripe_account_id").eq("brand_id", brandId).is("detached_at", null)
          .maybeSingle();
        const id = (account as { stripe_account_id?: unknown } | null)?.stripe_account_id;
        return typeof id === "string" ? id : null;
      };
      await verifyOpenFlexPayments({
        supabase,
        stripe: () => deps.stripe(),
        stripeAccountFor: stripeAccountForOrder,
        settleStripe: (pi) => deps.settleStripe(supabase, pi),
        paystackVerify: (reference) => deps.verify(reference),
        settlePaystack: async (reference, txn) => {
          await deps.handleCharge(supabase, reference, txn);
        },
        alertOps: deps.alertOps,
      }, open);
    }
  } catch (error) {
    // Unverified stays open: begin answers balance_payment_in_flight.
    console.warn(JSON.stringify({
      event: "flex_verify_before_begin_failed",
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    }));
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
  // T4-3: a whole balance below the provider's minimum is settled by waiver;
  // nothing is charged. T5-3: the paid-in-full email, once per order.
  if (flex.waived === true) {
    if (await claimPaidInFullNotice(supabase, String(orderId), "flex_payment_waiver")) {
      await defaultDispatchBuyerEmail("installment_plan_paid_in_full", { orderId: String(orderId) });
    }
    return jsonResponse({ error: "balance_settled", waivedMinor: Number(flex.waivedMinor ?? 0) }, 409);
  }
  const installmentId = String(flex.installmentId ?? "");
  if (installmentId.length === 0) {
    return jsonResponse({ error: "balance_payment_failed" }, 502);
  }
  const replayed = flex.replayed === true;
  // A replay of a payment that already finished (collected, closed) starts
  // nothing new: the client refetches the balance.
  if (replayed && flex.status !== "scheduled") {
    return jsonResponse({ error: "balance_changed" }, 409);
  }

  // issue #4522 (F10) — only a payment THIS request opened is closed when the
  // provider call fails; a replayed one may be live in another tab.
  const closeOnFailure = async (): Promise<void> => {
    if (replayed) return;
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
      const stripe = deps.stripe();
      let customerEphemeralKeySecret: string | null = null;
      if (token === null) {
        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer },
          {
            apiVersion: STRIPE_API_VERSION,
            stripeAccount,
            idempotencyKey:
              `mingla_flex_ephkey:${stripeAccount}:${customer}:${clientKey}`,
          },
        );
        customerEphemeralKeySecret = typeof ephemeralKey.secret === "string" &&
            ephemeralKey.secret.length > 0
          ? ephemeralKey.secret
          : null;
        if (customerEphemeralKeySecret === null) {
          throw new Error("ephemeral_key_missing");
        }
      }
      const pi = await createFlexPaymentIntent({
        stripe,
        installmentId,
        orderId: String(orderId),
        brandId,
        amountMinor,
        currency,
        customer,
        savedPaymentMethodId:
          method === "saved_card" && typeof savedPm === "string"
            ? savedPm
            : null,
        applicationFeeMinor: fee,
        idempotencyKey: flexPaymentIdempotencyKey(String(orderId), clientKey),
        stripeAccount,
      });
      // issue #4522 (N3) — the id is stored before the payment sheet is handed
      // out, so "no PaymentIntent on the row" always means nothing was ever
      // presented to pay. If it cannot be stored, the PaymentIntent is
      // cancelled and the payment closed: the buyer never gets a sheet.
      const { error: storeError } = await supabase.from("order_installments")
        .update({
          stripe_payment_intent_id: pi.id,
          updated_at: now.toISOString(),
        })
        .eq("id", installmentId).eq("kind", "flex");
      if (storeError !== null) {
        try {
          await stripe.paymentIntents.cancel(pi.id, {}, {
            idempotencyKey: `flex-store-failed-cancel:${installmentId}:${pi.id}`,
            stripeAccount,
          });
        } catch {
          // Unconfirmed and never presented: it cannot be paid by anyone.
        }
        throw new Error("payment_intent_store_failed");
      }
      return jsonResponse({
        kind: "stripe",
        installmentId,
        amountMinor,
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id,
        stripeAccountId: stripeAccount,
        publishableKey: deps.publishableKey(),
        ...(customerEphemeralKeySecret !== null
          ? { customerId: customer, customerEphemeralKeySecret }
          : {}),
        replayed,
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
        `${PRODUCTION_BUSINESS_WEB_ORIGIN}/pay/balance/${token}?return=1&expected=${expectedRemainingMinor}`,
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
