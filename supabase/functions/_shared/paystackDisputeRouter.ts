/**
 * Issue #3645 — Paystack chargeback / dispute webhook router.
 *
 * Events (Paystack docs):
 *   charge.dispute.create  — dispute logged
 *   charge.dispute.remind  — every 4h until resolved
 *   charge.dispute.resolve — resolved (merchant-accepted includes 16h auto-accept)
 * https://paystack.com/docs/payments/manage-disputes/
 * https://support.paystack.com/en/articles/2125698
 *
 * Persistence + debt: public.record_paystack_dispute_outcome (SQL).
 * Ops alert reuses the Stripe dispute email inbox when configured.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";
import { notifyBrandRoles } from "./businessNotifyTriggers.ts";

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
    ? ""
    : String(value);
}

function numberCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Paystack often sends amount in kobo already; keep trunc.
  return Math.trunc(n);
}

function transactionReference(data: Record<string, unknown>): string {
  const direct = text(data.transaction_reference);
  if (direct) return direct;
  if (data.transaction && typeof data.transaction === "object") {
    const tx = data.transaction as Record<string, unknown>;
    return text(tx.reference) || text(tx.transaction_reference);
  }
  return text(data.reference);
}

function disputeId(data: Record<string, unknown>): string {
  return text(data.id) || text(data.dispute_id) || text(data.disputeId);
}

function dueAtIso(data: Record<string, unknown>): string | null {
  const raw = data.due_at ?? data.dueAt ?? data.response_due_by;
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Paystack sometimes sends unix seconds.
    const ms = raw > 1e12 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function alertEmails(): string[] {
  const raw = Deno.env.get("PAYSTACK_DISPUTE_ALERT_EMAILS") ??
    Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS") ??
    "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

async function alertOps(input: {
  eventName: string;
  disputeId: string;
  amountCents: number;
  currency: string;
  responseDueBy: string | null;
  resolution: string | null;
  matched: boolean;
}): Promise<void> {
  const emails = alertEmails();
  if (emails.length === 0) {
    console.warn(
      "[paystack-dispute] dispute alert emails missing; dispute persisted without operator notification",
      { disputeId: input.disputeId },
    );
    return;
  }
  const amountStr = formatMoney(input.amountCents, input.currency);
  const isResolve = input.eventName === "charge.dispute.resolve";
  const subject = isResolve
    ? `Paystack chargeback resolved — ${amountStr} (${input.resolution || "unknown"})`
    : `Paystack chargeback — ${amountStr} (respond within 16h)`;
  const paragraphs = [
    isResolve
      ? "A Paystack chargeback dispute was resolved."
      : "A Paystack chargeback dispute needs a response within 16 hours (NG auto-accept).",
    `Amount: ${amountStr}`,
    `Dispute ID: ${input.disputeId}`,
    `Event: ${input.eventName}`,
    input.responseDueBy
      ? `Response due: ${input.responseDueBy}`
      : "Response due: (not provided — treat as 16h from create)",
    input.resolution ? `Resolution: ${input.resolution}` : "Resolution: (open)",
    input.matched ? "Matched to a Mingla order/reservation." : "Unmatched — investigate reference.",
  ];
  try {
    await sendOpsAlertEmail({
      subject,
      paragraphs,
      recipients: emails,
      cta: {
        label: "Open Paystack disputes",
        url: "https://dashboard.paystack.com/#/disputes",
      },
    });
  } catch (err) {
    console.error("[paystack-dispute] ops alert failed", {
      disputeId: input.disputeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handlePaystackDisputeEvent(
  supabase: SupabaseClient,
  eventName:
    | "charge.dispute.create"
    | "charge.dispute.remind"
    | "charge.dispute.resolve",
  data: Record<string, unknown>,
): Promise<void> {
  const id = disputeId(data);
  const reference = transactionReference(data);
  if (!id || !reference) {
    console.warn("[paystack-dispute] dispute event lacks identity", {
      eventName,
      id,
      reference,
    });
    return;
  }

  const amountCents = numberCents(
    data.refund_amount ?? data.amount ??
      (data.transaction && typeof data.transaction === "object"
        ? (data.transaction as Record<string, unknown>).amount
        : 0),
  );
  const currency = text(data.currency) ||
    (data.transaction && typeof data.transaction === "object"
      ? text((data.transaction as Record<string, unknown>).currency)
      : "") ||
    "ngn";
  const status = text(data.status) ||
    (eventName === "charge.dispute.resolve" ? "resolved" : "pending");
  const resolution = text(data.resolution) || text(data.category) || null;
  const reason = text(data.reason) || text(data.category) || null;
  const dueIso = dueAtIso(data);

  const { data: outcome, error } = await supabase.rpc(
    "record_paystack_dispute_outcome",
    {
      p_paystack_dispute_id: id,
      p_transaction_reference: reference,
      p_event_name: eventName,
      p_status: status,
      p_resolution: resolution,
      p_amount_cents: amountCents,
      p_currency: currency.toLowerCase(),
      p_reason: reason,
      p_due_at: dueIso,
      p_raw: data,
    },
  );
  if (error) {
    throw new Error(`paystack_dispute_record_failed:${error.message}`);
  }

  const matched = outcome?.matched === true;
  const responseDueBy = typeof outcome?.response_due_by === "string"
    ? outcome.response_due_by
    : dueIso;
  const brandId = typeof outcome?.brand_id === "string" ? outcome.brand_id : null;

  await alertOps({
    eventName,
    disputeId: id,
    amountCents,
    currency,
    responseDueBy,
    resolution,
    matched,
  });

  if (brandId && eventName === "charge.dispute.create") {
    try {
      const amountStr = formatMoney(amountCents, currency);
      await notifyBrandRoles(supabase as never, {
        brandId,
        roles: ["brand_owner", "finance_manager"],
        type: "business.dispute_opened",
        title: "Chargeback opened",
        body: `A ${amountStr} Paystack chargeback needs a response within 16 hours.`,
        data: {
          disputeId: id,
          orderId: outcome?.order_id ?? null,
          amount: amountCents,
          currency,
          evidenceDueBy: responseDueBy,
          provider: "paystack",
        },
        relatedId: id,
        relatedType: "dispute",
        idempotencyKey: `business.dispute_opened:paystack:${id}`,
        deepLink: `mingla-business://payments`,
      });
      await notifyBrandRoles(supabase as never, {
        brandId,
        roles: ["brand_owner", "finance_manager"],
        type: "business.dispute_action_needed",
        title: "Respond within 16 hours",
        body: `Paystack auto-accepts unanswered chargebacks after 16 hours. Amount: ${amountStr}.`,
        data: {
          disputeId: id,
          evidenceDueBy: responseDueBy,
          provider: "paystack",
        },
        relatedId: id,
        relatedType: "dispute",
        idempotencyKey: `business.dispute_action_needed:paystack:${id}`,
        deepLink: `mingla-business://payments`,
      });
    } catch (err) {
      console.error("[paystack-dispute] brand notify failed", {
        disputeId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
