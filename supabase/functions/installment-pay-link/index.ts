/**
 * Issue #3645 — anonymous, token-authenticated buyer pay/approve page API.
 * The raw token is never persisted or logged; every response is display-safe.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { handleInstallmentPaystackCharge } from "../_shared/installments/paystackInstallmentWebhook.ts";
import {
  PAY_LINK_TOKEN_PATTERN,
  payLinkTokenHashHex,
} from "../_shared/installments/installmentPayLinks.ts";
import { paystackTicketSplitFields } from "../_shared/ngPaystackSplit.ts";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";
import { paystackChannelsForCountry } from "../_shared/paymentProvider.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

type Action = "view" | "start" | "status";
type SafeLink = {
  state: string;
  installment_id?: string;
  purpose?: string;
  trip_title?: string;
  brand_name?: string;
  amount_cents?: number;
  currency?: string;
  due_at?: string;
  ordinal?: number;
  total_payments?: number;
  card_last4?: string | null;
};

export interface PayLinkDeps {
  supabase: SupabaseClient;
  now: () => Date;
  initialize: typeof paystackInitializeTransaction;
  verify: typeof paystackVerifyTransaction;
  handleCharge: typeof handleInstallmentPaystackCharge;
}

const windows = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_LIMIT = 30;

function rateLimited(hash: string, now: number): boolean {
  const current = windows.get(hash);
  if (current === undefined || now - current.startedAt >= WINDOW_MS) {
    windows.set(hash, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > WINDOW_LIMIT;
}

function publicLink(link: SafeLink): Record<string, unknown> {
  return {
    state: link.state,
    ...(link.purpose ? { purpose: link.purpose } : {}),
    ...(link.trip_title ? { tripTitle: link.trip_title } : {}),
    ...(link.brand_name ? { brandName: link.brand_name } : {}),
    ...(Number.isFinite(link.amount_cents)
      ? { amountCents: link.amount_cents }
      : {}),
    ...(link.currency ? { currency: link.currency } : {}),
    ...(link.due_at ? { dueAt: link.due_at } : {}),
    ...(Number.isFinite(link.ordinal) ? { ordinal: link.ordinal } : {}),
    ...(Number.isFinite(link.total_payments)
      ? { totalPayments: link.total_payments }
      : {}),
    ...(link.card_last4 ? { cardLast4: link.card_last4 } : {}),
  };
}

async function resolveLink(
  supabase: SupabaseClient,
  tokenHash: string,
): Promise<SafeLink> {
  const { data, error } = await supabase.rpc("issue_3645_resolve_pay_link", {
    p_token_hash: tokenHash,
  });
  if (error !== null) throw new Error("pay_link_lookup_failed");
  return (data ?? { state: "invalid" }) as SafeLink;
}

async function markUnknown(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<void> {
  await supabase.rpc("issue_3645_resolve_installment_attempt", {
    p_attempt_id: attemptId,
    p_outcome: "unknown",
    p_provider_transaction_id: null,
    p_gateway_response: "initialize_uncertain",
    p_approval_url: null,
    p_provider_fee_cents: null,
    p_verified_amount_cents: null,
  });
}

export async function handleInstallmentPayLink(
  req: Request,
  depsIn: Partial<PayLinkDeps> = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const action = typeof body.action === "string"
    ? body.action as Action
    : "" as Action;
  if (!PAY_LINK_TOKEN_PATTERN.test(token)) {
    return jsonResponse({ error: "invalid_token" }, 400);
  }
  if (!["view", "start", "status"].includes(action)) {
    return jsonResponse({ error: "invalid_action" }, 400);
  }

  const supabase = depsIn.supabase ?? serviceClient();
  const now = depsIn.now?.() ?? new Date();
  const initialize = depsIn.initialize ?? paystackInitializeTransaction;
  const verify = depsIn.verify ?? paystackVerifyTransaction;
  const handleCharge = depsIn.handleCharge ?? handleInstallmentPaystackCharge;
  const tokenHash = await payLinkTokenHashHex(token);
  if (rateLimited(tokenHash, now.getTime())) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  let link = await resolveLink(supabase, tokenHash);
  if (link.state === "invalid") return jsonResponse({ state: "invalid" }, 404);
  if (action === "view") return jsonResponse(publicLink(link));
  if (action === "status") {
    if (typeof link.installment_id === "string" && link.state === "payable") {
      const { data: attempt } = await supabase
        .from("order_installment_charge_attempts")
        .select("reference")
        .eq("installment_id", link.installment_id)
        .in("state", ["created", "unknown"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const reference = (attempt as { reference?: string } | null)?.reference;
      if (typeof reference === "string") {
        try {
          const txn = await verify(reference);
          if (String(txn.status).toLowerCase() === "success") {
            await handleCharge(supabase, reference, txn);
          }
        } catch {
          // Still pending/unknown: the webhook and cron remain backstops.
        }
      }
      link = await resolveLink(supabase, tokenHash);
    }
    return jsonResponse(publicLink(link));
  }

  if (link.state !== "payable" || typeof link.installment_id !== "string") {
    return jsonResponse({ error: "payment_not_due", state: link.state }, 409);
  }
  if (link.purpose === "approve") {
    const { data: paused } = await supabase
      .from("order_installment_charge_attempts")
      .select("approval_url")
      .eq("installment_id", link.installment_id)
      .eq("state", "paused")
      .gt("approval_url_expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const existing = (paused as { approval_url?: string } | null)?.approval_url;
    if (
      typeof existing === "string" &&
      existing.startsWith("https://checkout.paystack.com/")
    ) {
      return jsonResponse({ kind: "redirect", url: existing });
    }
  }

  const { data: installment, error: installmentError } = await supabase
    .from("order_installments")
    .select(
      `id,order_id,ordinal,buyer_total_cents,amount_cents,application_fee_amount_cents,currency,
      orders!inner(buyer_email,event_id,events!inner(brand_id))`,
    )
    .eq("id", link.installment_id)
    .maybeSingle();
  if (installmentError !== null || installment === null) {
    return jsonResponse({ error: "payment_start_failed" }, 502);
  }
  const row = installment as Record<string, unknown>;
  const order =
    (Array.isArray(row.orders) ? row.orders[0] : row.orders) as Record<
      string,
      unknown
    >;
  const event =
    (Array.isArray(order.events) ? order.events[0] : order.events) as Record<
      string,
      unknown
    >;
  const brandId = String(event.brand_id);
  const { data: brand } = await supabase.from("brands")
    .select("paystack_subaccount_code,payout_hold_cutover_at")
    .eq("id", brandId).maybeSingle();
  const { data: authorization } = await supabase.schema("private")
    .from("order_payment_authorizations")
    .select("authorization_email")
    .eq("order_id", String(row.order_id)).maybeSingle();
  const email = String(
    (authorization as { authorization_email?: string } | null)
      ?.authorization_email ?? order.buyer_email ?? "",
  ).trim();
  if (email.length === 0) {
    return jsonResponse({ error: "payment_start_failed" }, 502);
  }
  const fee = Number(row.application_fee_amount_cents);
  if (!Number.isInteger(fee) || fee < 0) {
    return jsonResponse({ error: "payment_start_failed" }, 502);
  }

  const { data: begun, error: beginError } = await supabase.rpc(
    "issue_3645_begin_installment_attempt",
    {
      p_installment_id: link.installment_id,
      p_method: link.purpose === "approve" ? "approve" : "pay_link",
      p_application_fee_cents: fee,
    },
  );
  if (beginError !== null) {
    return jsonResponse({ error: "payment_start_failed" }, 502);
  }
  const attempt = (begun ?? {}) as Record<string, unknown>;
  if (attempt.ok !== true) {
    return jsonResponse({
      error: attempt.reason === "attempt_in_flight"
        ? "payment_in_progress"
        : "payment_not_available",
    }, 409);
  }
  const attemptId = String(attempt.attempt_id);
  try {
    const initialized = await initialize({
      email,
      amountSubunits: Number(attempt.amount_cents),
      currency: "NGN",
      reference: String(attempt.reference),
      callbackUrl: `${PRODUCTION_BUSINESS_WEB_ORIGIN}/pay/${token}?return=1`,
      channels: paystackChannelsForCountry("NG"),
      metadata: {
        mingla_installment_id: link.installment_id,
        mingla_order_id: String(row.order_id),
        mingla_installment_ordinal: Number(row.ordinal),
      },
      ...paystackTicketSplitFields(
        (brand as { payout_hold_cutover_at?: string | null } | null)
          ?.payout_hold_cutover_at != null,
        (brand as { paystack_subaccount_code?: string | null } | null)
          ?.paystack_subaccount_code,
        fee,
      ),
    });
    const { data: stored, error: storeError } = await supabase.rpc(
      "issue_3645_store_attempt_approval_url",
      {
        p_attempt_id: attemptId,
        p_approval_url: initialized.authorization_url,
      },
    );
    if (
      storeError !== null || (stored as { ok?: boolean } | null)?.ok !== true
    ) throw new Error("approval_url_store_failed");
    return jsonResponse({
      kind: "redirect",
      url: initialized.authorization_url,
    });
  } catch {
    await markUnknown(supabase, attemptId);
    return jsonResponse({ error: "payment_start_failed" }, 502);
  }
}

if (import.meta.main) serve((req) => handleInstallmentPayLink(req));
