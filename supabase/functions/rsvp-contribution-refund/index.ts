/**
 * rsvp-contribution-refund — ORCH-1291 [rsvp-chip-in].
 *
 * Organiser/admin refund of a paid voluntary RSVP contribution, on both rails.
 * A contribution has NO order → refund-order cannot handle it (investigation
 * F-7); this is the sibling refund path (refund-order stays byte-unchanged).
 *
 * Amended §4.4 policy (Seth-locked Q-C):
 *   • DISCRETIONARY (guest changed their mind / organiser goodwill) — Mingla
 *     KEEPS its cut: Stripe refund_application_fee=FALSE, refund amount =
 *     amount_cents − application_fee_amount_cents; Paystack refund amount =
 *     buyer_total − application_fee (the transaction_charge already routed to
 *     Mingla's main account is retained). The guest is NOT made whole.
 *   • EVENT-CANCELLATION (batch, cancelAll) — make the guest WHOLE: Stripe
 *     refund_application_fee=TRUE, refund the FULL buyer_total; Paystack refund
 *     the full buyer_total. Chargeback/goodwill protection since a cancelled
 *     event returns nothing to the guest.
 *   The guest's FREE RSVP is untouched either way (only the gift is returned).
 *
 * Permission: verify_jwt=true (a valid organiser JWT is required by the gateway).
 * The row is fetched with the JWT-BOUND client so the event_rsvp_contributions
 * host-read RLS policy (event_manager rank) is the permission gate — a non-owner
 * simply gets zero rows and can refund nothing (no leak).
 *
 * External-API docs (COMMS-0003):
 *   • Stripe refunds + refund_application_fee: https://docs.stripe.com/connect/direct-charges#issue-refunds
 *   • Paystack refund: https://paystack.com/docs/api/refund/#create
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import { PAYSTACK_BASE_URL, resolvePaystackSecretKey } from "../_shared/paystack.ts";
import { serviceClient, userClient, userIdFromAuthHeader } from "../_shared/ticketCheckout.ts";

type RefundMode = "discretionary" | "cancellation";

interface ContributionRow {
  id: string;
  event_id: string;
  brand_id: string;
  provider: string;
  currency: string;
  amount_cents: number;
  buyer_total_cents: number;
  application_fee_amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
}

const CONTRIBUTION_COLS =
  "id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents, application_fee_amount_cents, status, stripe_payment_intent_id, stripe_charge_id";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resolve the amount to return to the guest for a given mode.
function refundAmountForMode(row: ContributionRow, mode: RefundMode): number {
  if (mode === "cancellation") {
    // make whole — full buyer_total (Mingla's cut refunded too).
    return row.buyer_total_cents;
  }
  // discretionary — Mingla keeps its cut; guest gets amount − application_fee.
  return Math.max(0, row.amount_cents - row.application_fee_amount_cents);
}

async function resolveStripeConnectedAccount(
  supabase: ReturnType<typeof serviceClient>,
  eventId: string,
): Promise<string | null> {
  const { data } = await supabase.rpc("resolve_event_pricing_inputs", { p_event_id: eventId });
  if (Array.isArray(data) && data.length > 0) {
    const acct = (data[0] as { stripe_account_id?: string | null }).stripe_account_id;
    return typeof acct === "string" && acct.length > 0 ? acct : null;
  }
  return null;
}

// Refund ONE contribution on its rail. Throws on provider failure.
async function refundOne(
  supabase: ReturnType<typeof serviceClient>,
  row: ContributionRow,
  mode: RefundMode,
  reason: string,
): Promise<{ providerRefundId: string; returnedCents: number }> {
  const returnedCents = refundAmountForMode(row, mode);

  if (row.provider === "paystack") {
    // POST /refund { transaction, amount, currency }. transaction = Paystack txn
    // id (stored in stripe_charge_id) or the reference (stripe_payment_intent_id).
    const transaction = row.stripe_charge_id ?? row.stripe_payment_intent_id;
    if (!transaction) throw new Error("paystack_missing_transaction_ref");
    const secret = resolvePaystackSecretKey();
    const res = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction,
        // amount in subunits (kobo). Omit for a full refund on cancellation.
        ...(mode === "cancellation" ? {} : { amount: returnedCents }),
        currency: "NGN",
        merchant_note: reason.slice(0, 200),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.status !== true) {
      throw new Error(`paystack_refund_failed (${res.status}): ${json?.message ?? "unknown"}`);
    }
    const refundId = String((json?.data as Record<string, unknown>)?.id ?? "");
    return { providerRefundId: refundId, returnedCents };
  }

  // Stripe direct-charge refund on the connected account. Prefer a charge id
  // (ch_…); fall back to a payment_intent id (pi_…). The web path may store the
  // PI id in stripe_charge_id and the Checkout Session id in
  // stripe_payment_intent_id — pick whichever is a usable refund target.
  const connectedAccount = await resolveStripeConnectedAccount(supabase, row.event_id);
  if (!connectedAccount) throw new Error("stripe_missing_connected_account");

  const target: { charge?: string; payment_intent?: string } = {};
  if (row.stripe_charge_id && row.stripe_charge_id.startsWith("ch_")) {
    target.charge = row.stripe_charge_id;
  } else if (row.stripe_charge_id && row.stripe_charge_id.startsWith("pi_")) {
    target.payment_intent = row.stripe_charge_id;
  } else if (row.stripe_payment_intent_id && row.stripe_payment_intent_id.startsWith("pi_")) {
    target.payment_intent = row.stripe_payment_intent_id;
  } else {
    throw new Error("stripe_missing_charge_ref");
  }

  const stripe = stripeTicketRefund();
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const created = await stripe.refunds.create(
    {
      ...target,
      amount: returnedCents,
      reason: "requested_by_customer",
      // Q-C: keep Mingla's cut on a discretionary refund; refund it too on
      // event cancellation (guest made whole).
      refund_application_fee: mode === "cancellation" && row.application_fee_amount_cents > 0,
      metadata: {
        mingla_purpose: "rsvp_contribution_refund",
        mingla_contribution_id: row.id,
        mingla_refund_mode: mode,
      },
    },
    {
      idempotencyKey: `rsvp_contribution_refund:${row.id}:${mode}`,
      stripeAccount: connectedAccount,
    },
  );
  return { providerRefundId: String(created.id), returnedCents };
}

async function markRefunded(
  supabase: ReturnType<typeof serviceClient>,
  row: ContributionRow,
  returnedCents: number,
  reason: string,
): Promise<void> {
  await supabase
    .from("event_rsvp_contributions")
    .update({
      status: "refunded",
      refunded_amount_cents: returnedCents,
      refund_reason: reason.slice(0, 200),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userId = await userIdFromAuthHeader(req);
  if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const reason = typeof body.reason === "string" && body.reason.trim().length >= 3
    ? body.reason.trim()
    : "Organiser refund";
  const cancelAll = body.cancelAll === true;
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const contributionId = typeof body.contributionId === "string" ? body.contributionId : "";

  const supabase = serviceClient();
  const asUser = userClient(req); // JWT-bound → host-read RLS is the permission gate.

  // =====================================================================
  // EVENT-CANCELLATION BATCH — refund all paid contributions WHOLE.
  // =====================================================================
  if (cancelAll) {
    if (!eventId) return jsonResponse({ error: "event_id_required" }, 400);
    // RLS host-read returns paid rows ONLY if the caller manages the brand.
    const { data: rows, error: readErr } = await asUser
      .from("event_rsvp_contributions")
      .select(CONTRIBUTION_COLS)
      .eq("event_id", eventId)
      .eq("status", "paid");
    if (readErr) {
      return jsonResponse({ error: "read_failed", detail: readErr.message }, 500);
    }
    const paid = (rows ?? []) as unknown as ContributionRow[];
    let refunded = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const row of paid) {
      try {
        const { returnedCents } = await refundOne(supabase, row, "cancellation", "event_cancelled");
        await markRefunded(supabase, row, returnedCents, "event_cancelled");
        refunded += 1;
      } catch (err) {
        failures.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return jsonResponse({ ok: failures.length === 0, refunded, failures });
  }

  // =====================================================================
  // SINGLE DISCRETIONARY (or explicit-mode) refund.
  // =====================================================================
  if (!contributionId) return jsonResponse({ error: "contribution_id_required" }, 400);
  const mode: RefundMode = body.mode === "cancellation" ? "cancellation" : "discretionary";

  // Permission: JWT-bound read. Null → not found OR not permitted (both 404/403-ish).
  const { data: rowData, error: rowErr } = await asUser
    .from("event_rsvp_contributions")
    .select(CONTRIBUTION_COLS)
    .eq("id", contributionId)
    .maybeSingle();
  if (rowErr) return jsonResponse({ error: "read_failed", detail: rowErr.message }, 500);
  if (!rowData) return jsonResponse({ error: "not_found_or_forbidden" }, 404);
  const row = rowData as unknown as ContributionRow;

  if (row.status !== "paid") {
    return jsonResponse({ error: "contribution_not_refundable", status: row.status }, 422);
  }

  let providerRefundId: string;
  let returnedCents: number;
  try {
    const result = await refundOne(supabase, row, mode, reason);
    providerRefundId = result.providerRefundId;
    returnedCents = result.returnedCents;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[rsvp-contribution-refund] provider refund failed", detail);
    return jsonResponse({ error: "provider_refund_failed", detail }, 502);
  }

  await markRefunded(supabase, row, returnedCents, reason);

  return jsonResponse({
    ok: true,
    contributionId,
    mode,
    returnedCents,
    providerRefundId,
    currency: row.currency,
  });
});
