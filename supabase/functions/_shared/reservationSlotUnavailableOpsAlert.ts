/**
 * #1345 — durable drain for paid NG reservation slot-unavailable ops alerts.
 *
 * Finalize atomically marks the session failed + enqueues into
 * `reservation_slot_unavailable_alert_outbox` (no Resend await).
 * `payout-release-sweep` drains pending/stale-dispatching rows fail-open AFTER
 * organiser money work (or just before the dark early-return), with a whole-
 * drain wall-clock budget: claim (lease + claim_id) → sendOpsAlertEmail
 * (AbortSignal timeout + Resend Idempotency-Key) → record delivery with
 * matching claim_id only when succeeded > 0.
 * Send failures / timeouts leave the row retryable (or reclaim after 10m).
 *
 * Kept OUT of reservationPaystackFinalize.ts so ticket-checkout confirm/status
 * (which import the webhook router → finalize) do not pull RESEND_API_KEY into
 * their secret-contract closures.
 */

// Structural admin surface only — do NOT import SupabaseClient from
// esm.sh/@supabase/supabase-js@2 here. That specifier can resolve a newer
// generic shape than payout-release-sweep's createClient in the same deno
// check graph (#1437 secret-bundle suite), which then fails every admin.rpc
// call site in the sweep. Callers already pass AdminClient / cast as never.
import { resolveAlertRecipientValue } from "./secretBundle.ts";
import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";

type OpsAlertAdmin = {
  // deno-lint-ignore no-explicit-any
  rpc: (...args: any[]) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

/** Bound each Resend attempt so a stalled fetch cannot hang the sweep forever. */
const RESEND_SEND_TIMEOUT_MS = 8_000;
/** Default claim batch — small so one tick cannot monopolise the 30s sweep. */
const DEFAULT_CLAIM_LIMIT = 3;
/** Whole-drain wall clock (claim + sends + record) for the sweep caller. */
const DEFAULT_DRAIN_BUDGET_MS = 12_000;

export type ReservationSlotUnavailableAlertRow = {
  alert_id: string;
  session_id: string;
  reference: string;
  amount_cents: number | null;
  currency: string | null;
  claim_id: string;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_SEND_TIMEOUT_MS);
  try {
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
      signal: controller.signal,
      // Deterministic per outbox row so a timed-out fetch that later accepts
      // does not create a second Resend email on the next sweep.
      idempotencyKey:
        `reservation_slot_unavailable_alert:${row.alert_id}`,
    });
    return (result?.succeeded ?? 0) > 0;
  } finally {
    clearTimeout(timer);
  }
}

export type DrainReservationSlotUnavailableAlertsOptions = {
  pLimit?: number;
  /** Absolute Date.now() deadline; when hit, stop claiming/sending more rows. */
  deadlineMs?: number;
};

/**
 * Claim pending/stale-dispatching outbox rows, send via the shared Resend
 * ops-alert spine (AbortSignal timeout + Idempotency-Key), and record delivery
 * with the claim_id. Complete (provider_accepted) only when succeeded > 0.
 * Never throws for per-row send failures — those requeue as retryable.
 * Claim/record RPC errors propagate so the sweep fail-open wrapper can log them.
 */
export async function drainReservationSlotUnavailableAlerts(
  supabase: OpsAlertAdmin,
  pLimitOrOpts: number | DrainReservationSlotUnavailableAlertsOptions =
    DEFAULT_CLAIM_LIMIT,
): Promise<{ listed: number; delivered: number }> {
  const opts: DrainReservationSlotUnavailableAlertsOptions =
    typeof pLimitOrOpts === "number"
      ? { pLimit: pLimitOrOpts }
      : pLimitOrOpts ?? {};
  const pLimit = opts.pLimit ?? DEFAULT_CLAIM_LIMIT;
  const deadlineMs = opts.deadlineMs ??
    (Date.now() + DEFAULT_DRAIN_BUDGET_MS);

  if (Date.now() >= deadlineMs) {
    return { listed: 0, delivered: 0 };
  }

  const { data, error } = await supabase.rpc(
    "claim_reservation_slot_unavailable_alerts" as never,
    {
      p_limit: pLimit,
      p_now: new Date().toISOString(),
    } as never,
  );
  if (error) {
    throw new Error(
      `reservation_slot_unavailable_alert_claim_failed:${error.message}`,
    );
  }
  const rows = (Array.isArray(data) ? data : []) as ReservationSlotUnavailableAlertRow[];
  let delivered = 0;
  for (const row of rows) {
    if (Date.now() >= deadlineMs) {
      console.warn(
        "[reservation-slot-unavailable-alert] drain budget exhausted; leaving remaining claimed rows for reclaim",
        { alertId: row.alert_id, listed: rows.length, delivered },
      );
      break;
    }
    let outcome: "provider_accepted" | "retryable" = "retryable";
    let deliveryError: string | null = null;
    try {
      const ok = await deliverOne(row);
      if (ok) outcome = "provider_accepted";
      else {
        deliveryError = "alert_delivery_not_confirmed";
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
      deliveryError = err instanceof Error ? err.message : String(err);
      console.error(
        "[reservation-slot-unavailable-alert] drain send failed (non-fatal)",
        {
          alertId: row.alert_id,
          sessionId: row.session_id,
          reference: row.reference,
          error: deliveryError,
        },
      );
    }

    const { data: recorded, error: recordError } = await supabase.rpc(
      "record_reservation_slot_unavailable_alert_delivery" as never,
      {
        p_alert_id: row.alert_id,
        p_claim_id: row.claim_id,
        p_outcome: outcome,
        p_error_message: deliveryError,
        p_now: new Date().toISOString(),
      } as never,
    );
    if (recordError) {
      // Stale claim (another sweeper reclaimed) is non-fatal; other errors bubble.
      if (
        String(recordError.message ?? "").includes(
          "stale_reservation_slot_unavailable_alert_claim",
        )
      ) {
        console.warn(
          "[reservation-slot-unavailable-alert] stale claim rejected on record",
          { alertId: row.alert_id, claimId: row.claim_id },
        );
        continue;
      }
      throw new Error(
        `reservation_slot_unavailable_alert_record_failed:${recordError.message}`,
      );
    }
    if (recorded === "provider_accepted") delivered += 1;
  }
  return { listed: rows.length, delivered };
}

/** Fail-open wrapper for payout-release-sweep (never blocks money movement). */
export async function drainReservationSlotUnavailableAlertsFailOpen(
  supabase: OpsAlertAdmin,
  logPrefix: string,
  opts?: DrainReservationSlotUnavailableAlertsOptions,
): Promise<void> {
  try {
    const result = await drainReservationSlotUnavailableAlerts(
      supabase,
      opts ?? {},
    );
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
