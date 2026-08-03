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
  eventName:
    | "refund.pending"
    | "refund.processing"
    | "refund.needs-attention"
    | "refund.processed"
    | "refund.failed",
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

  // #1221 markers are resolved before every legacy order/trip/venue marker.
  const typedMatch = merchantNote.match(
    /^mingla_source_refund:([0-9a-f-]{36}):([1-9][0-9]*)$/i,
  );
  if (typedMatch) {
    const refundId = typedMatch[1];
    const attemptNo = Number(typedMatch[2]);
    const { data: operation, error: operationError } = await supabase
      .from("source_refunds")
      .select(
        "id,provider,currency,buyer_refund_requested_cents,provider_payment_reference,active_buyer_attempt_no",
      )
      .eq("id", refundId).eq("provider", "paystack").maybeSingle();
    if (operationError || !operation) {
      throw new Error("source_refund_exact_match_missing");
    }
    const observedAmount = Number(data.amount ?? data.deducted_amount ?? 0);
    if (
      transaction !== operation.provider_payment_reference ||
      (observedAmount > 0 &&
        observedAmount !== operation.buyer_refund_requested_cents) ||
      attemptNo < Number(operation.active_buyer_attempt_no ?? 0)
    ) {
      throw new Error("source_refund_provider_evidence_mismatch");
    }
    const nextState = eventName === "refund.processed"
      ? "processed"
      : eventName === "refund.needs-attention"
      ? "needs_attention"
      : eventName === "refund.failed"
      ? "failed_terminal"
      : "provider_pending";
    const eventId = `paystack-refund:${
      providerRefundId || merchantNote
    }:${eventName}`;
    const { error } = await supabase.rpc(
      "record_source_refund_provider_event",
      {
        p_refund_id: refundId,
        p_leg_type: "buyer_refund",
        p_attempt_no: attemptNo,
        p_event_key: eventId,
        p_provider_event_type: eventName,
        p_provider_event_id: eventId,
        p_next_state: nextState,
        p_amount_observed_cents: Math.max(0, Math.trunc(observedAmount)),
        p_provider_operation_id: providerRefundId || null,
        p_safe_reason_code: eventName === "refund.failed"
          ? "paystack_verified_failed"
          : "paystack_verified_lifecycle",
      },
    );
    if (error) {
      throw new Error(`source_refund_event_commit_failed:${error.message}`);
    }
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
