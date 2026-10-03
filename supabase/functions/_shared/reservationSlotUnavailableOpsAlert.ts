/**
 * #1345 — durable drain for paid NG reservation slot-unavailable ops alerts.
 *
 * Finalize enqueues into `reservation_slot_unavailable_alert_outbox` and
 * returns without waiting on Resend. Callers (paystack-webhook,
 * venue-reservation-confirm) drain pending rows fail-open: claim →
 * sendOpsAlertEmail → complete ONLY when succeeded > 0. Send failures leave
 * the row open for the next drain.
 *
 * Kept OUT of reservationPaystackFinalize.ts so ticket-checkout confirm/status
 * (which import the webhook router → finalize) do not pull RESEND_API_KEY into
 * their secret-contract closures.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAlertRecipientValue } from "./secretBundle.ts";
import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";

export type ReservationSlotUnavailableAlertRow = {
  alert_id: string;
  session_id: string;
  reference: string;
  amount_cents: number | null;
  currency: string | null;
};

function reservationSlotUnavailableAlertRecipients(): string[] {
  // Same on-call inbox as Paystack/Stripe dispute alerts — never invent a new
  // alert-recipient secret name (#3726 lesson).
  const value = resolveAlertRecipientValue(
    "stripe_disputes",
    "STRIPE_DISPUTE_ALERT_EMAILS",
  );
  if (Array.isArray(value)) {
    const emails = value.map((s) => String(s).trim()).filter(Boolean);
    if (emails.length > 0) return emails;
  }
  const raw = value ?? "seth@usemingla.com";
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

export function formatReservationAlertAmount(
  amountCents: number | null,
  currency: string | null,
): string {
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) {
    return "(amount unknown)";
  }
  const code = String(currency ?? "NGN").toUpperCase() || "NGN";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${code}`;
  }
}

async function deliverOne(
  row: ReservationSlotUnavailableAlertRow,
): Promise<boolean> {
  const recipients = reservationSlotUnavailableAlertRecipients();
  if (recipients.length === 0) {
    console.warn(
      "[reservation-slot-unavailable-alert] recipients missing; leaving outbox open",
      { sessionId: row.session_id, reference: row.reference },
    );
    return false;
  }
  const amountLabel = formatReservationAlertAmount(
    row.amount_cents,
    row.currency,
  );
  const result = await sendOpsAlertEmail({
    subject:
      `Paystack reservation MANUAL REFUND DUE — slot taken after charge (${amountLabel})`,
    paragraphs: [
      "A paid Paystack venue reservation was charged, but the slot was taken between charge and finalize.",
      "Funds are captured and no reservation was minted. MANUAL REFUND REQUIRED (#1175 venue-refund rail is dark).",
      `Session ID: ${row.session_id}`,
      `Paystack reference: ${row.reference}`,
      `Amount: ${amountLabel}`,
      "Audit action: paystack.reservation_slot_unavailable_refund_due",
    ],
    recipients,
    cta: {
      label: "Open Paystack transactions",
      url: "https://dashboard.paystack.com/#/transactions",
    },
  });
  return (result?.succeeded ?? 0) > 0;
}

/**
 * Claim pending outbox rows, send via the shared Resend ops-alert spine, and
 * complete only rows with succeeded > 0. Never throws — callers wrap fail-open.
 */
export async function drainReservationSlotUnavailableAlerts(
  supabase: SupabaseClient,
  pLimit = 20,
): Promise<{ listed: number; delivered: number }> {
  const { data, error } = await supabase.rpc(
    "claim_reservation_slot_unavailable_alerts" as never,
    { p_limit: pLimit } as never,
  );
  if (error) {
    throw new Error(
      `reservation_slot_unavailable_alert_claim_failed:${error.message}`,
    );
  }
  const rows = (Array.isArray(data) ? data : []) as ReservationSlotUnavailableAlertRow[];
  const delivered: string[] = [];
  for (const row of rows) {
    try {
      const ok = await deliverOne(row);
      if (ok) delivered.push(row.alert_id);
      else {
        console.error(
          "[reservation-slot-unavailable-alert] send not confirmed; leaving open",
          {
            alertId: row.alert_id,
            sessionId: row.session_id,
            reference: row.reference,
          },
        );
      }
    } catch (err) {
      console.error(
        "[reservation-slot-unavailable-alert] drain send failed (non-fatal)",
        {
          alertId: row.alert_id,
          sessionId: row.session_id,
          reference: row.reference,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }
  if (delivered.length > 0) {
    const { error: doneError } = await supabase.rpc(
      "complete_reservation_slot_unavailable_alerts" as never,
      { p_alert_ids: delivered } as never,
    );
    if (doneError) {
      throw new Error(
        `reservation_slot_unavailable_alert_complete_failed:${doneError.message}`,
      );
    }
  }
  return { listed: rows.length, delivered: delivered.length };
}

/** Fail-open wrapper for webhook/confirm call sites. */
export async function drainReservationSlotUnavailableAlertsFailOpen(
  supabase: SupabaseClient,
  logPrefix: string,
): Promise<void> {
  try {
    const result = await drainReservationSlotUnavailableAlerts(supabase);
    if (result.listed > 0) {
      console.log(`${logPrefix} slot-unavailable ops-alert drain`, result);
    }
  } catch (err) {
    console.error(
      `${logPrefix} slot-unavailable ops-alert drain failed (non-fatal)`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
