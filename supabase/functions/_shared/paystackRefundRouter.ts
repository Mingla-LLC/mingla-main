import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
    ? ""
    : String(value);
}

function transactionReference(data: Record<string, unknown>): string {
  const direct = text(data.transaction_reference);
  if (direct) return direct;
  if (data.transaction && typeof data.transaction === "object") {
    return text((data.transaction as Record<string, unknown>).reference);
  }
  return "";
}

export async function handlePaystackRefundEvent(
  supabase: SupabaseClient,
  eventName: "refund.processed" | "refund.failed",
  data: Record<string, unknown>,
): Promise<void> {
  const providerRefundId = text(data.id);
  let merchantNote = text(data.merchant_note);
  let transaction = transactionReference(data);

  if ((!merchantNote || !transaction) && providerRefundId) {
    const { data: attempt, error } = await supabase
      .from("paystack_refund_attempts")
      .select("merchant_note, transaction_reference")
      .eq("provider_refund_id", providerRefundId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `paystack_refund_attempt_lookup_failed: ${error.message}`,
      );
    }
    merchantNote = merchantNote || text(attempt?.merchant_note);
    transaction = transaction || text(attempt?.transaction_reference);
  }
  if (!merchantNote || !transaction) {
    console.warn(
      "[paystack-refund-router] refund event lacks reconciliation identity",
      { eventName, providerRefundId },
    );
    return;
  }

  let sourceType: "order" | "venue_reservation";
  let sourceId: string;
  let localRefundId: string | null = null;
  let amountCents = Number(data.amount ?? data.deducted_amount ?? 0);

  const orderMatch = merchantNote.match(
    /^mingla_(?:admin_)?refund:([0-9a-f-]{36})$/i,
  );
  const tripMatch = merchantNote.match(
    /^mingla_trip_refund:([0-9a-f-]{36}):/,
  );
  const venueMatch = merchantNote.match(
    /^mingla_venue_refund:([0-9a-f-]{36})$/i,
  );

  if (orderMatch || tripMatch) {
    localRefundId = (orderMatch ?? tripMatch)?.[1] ?? null;
    const { data: refund, error } = await supabase
      .from("refunds")
      .select("order_id, amount_cents")
      .eq("id", localRefundId)
      .maybeSingle();
    if (error || !refund?.order_id) {
      throw new Error(
        `paystack_refund_local_row_missing: ${error?.message ?? localRefundId}`,
      );
    }
    sourceType = "order";
    sourceId = String(refund.order_id);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      amountCents = Number(refund.amount_cents ?? 0);
    }
  } else if (venueMatch) {
    sourceType = "venue_reservation";
    const reservationId = venueMatch[1];
    const { data: checkoutSession, error: checkoutError } = await supabase
      .from("reservation_checkout_sessions")
      .select("id")
      .eq("reservation_id", reservationId)
      .eq("status", "completed")
      .maybeSingle();
    if (checkoutError || !checkoutSession?.id) {
      throw new Error(
        `paystack_reservation_checkout_lookup_failed: ${
          checkoutError?.message ?? reservationId
        }`,
      );
    }
    sourceId = String(checkoutSession.id);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      const { data: reservation, error } = await supabase
        .from("reservations")
        .select("fee_cents")
        .eq("id", reservationId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `paystack_reservation_refund_lookup_failed: ${error.message}`,
        );
      }
      amountCents = Number(reservation?.fee_cents ?? 0);
    }
  } else {
    console.warn("[paystack-refund-router] unknown Mingla refund marker", {
      merchantNote,
      providerRefundId,
    });
    return;
  }

  const { error } = await supabase.rpc("record_paystack_refund_outcome", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_local_refund_id: localRefundId,
    p_transaction_reference: transaction,
    p_merchant_note: merchantNote,
    p_provider_refund_id: providerRefundId || null,
    p_amount_cents: Math.max(0, Math.trunc(amountCents)),
    p_status: eventName === "refund.processed" ? "processed" : "failed",
    p_error_message: eventName === "refund.failed"
      ? text(data.reason) || "paystack_refund_failed"
      : null,
  });
  if (error) {
    throw new Error(`record_paystack_refund_outcome_failed: ${error.message}`);
  }
}
