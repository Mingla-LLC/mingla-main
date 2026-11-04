// Issue #4271 — the Tap to Pay webhook backstop.
//
// door-tap-intent `complete` normally records a tapped sale right away. If the
// phone loses signal after the tap, Stripe's payment_intent.succeeded (a
// Connect event: the charge lives on the brand's account) still arrives here,
// discriminated by `metadata.mingla_door_tap`. It converges on the same
// idempotent RPC, so a sale is recorded once whichever arrives first.
// Checked before the ticket finalize path so the two money paths never cross.

// deno-lint-ignore-file no-explicit-any

type ServiceClient = any;

export interface DoorTapStripeEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export function isDoorTapStripeEvent(event: DoorTapStripeEvent): boolean {
  if (!event.type.startsWith("payment_intent.")) return false;
  const metadata = event.data?.object?.metadata as Record<string, unknown> | undefined;
  return metadata?.mingla_door_tap === "1";
}

/** Returns the brand id for the audit row, or null. Throws to make Stripe retry. */
export async function handleDoorTapStripeEvent(
  supabase: ServiceClient,
  event: DoorTapStripeEvent,
): Promise<string | null> {
  const pi = event.data.object;
  const metadata = (pi.metadata ?? {}) as Record<string, unknown>;
  const brandId = typeof metadata.mingla_brand_id === "string"
    ? metadata.mingla_brand_id
    : null;
  // Only a succeeded payment is a sale. A failed or cancelled tap leaves the
  // intent unrecorded; the host retries on the same PaymentIntent.
  if (event.type !== "payment_intent.succeeded") return brandId;
  if (pi.status !== "succeeded") return brandId;
  const latest = pi.latest_charge;
  const chargeId = typeof latest === "string"
    ? latest
    : latest && typeof latest === "object" && typeof (latest as any).id === "string"
    ? (latest as any).id
    : null;
  const { error } = await supabase.rpc("biz_door_tap_record", {
    p_payment_intent_id: String(pi.id ?? ""),
    p_charge_id: chargeId,
    p_amount_received_cents: Number(pi.amount_received ?? pi.amount ?? 0),
    p_card_brand: null,
    p_card_last4: null,
  });
  if (error) {
    throw new Error(`door_tap_record_failed:${error.message}`);
  }
  return brandId;
}
