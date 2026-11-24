// #4490 spec 08 O5 fix 3 — the guest refund decision on a Till device login.
//
// Approving a guest's refund request moves money. A Till device login (the
// venue.till_device capability, the Till released at that venue) approves it
// only with a live PIN session (`staffSession` in the body) and a fresh PIN
// from someone with money rights at that venue (`stepUp: { pin, memberId? }`),
// exactly like a Till refund. The approval is for purpose "refund" and this
// order; biz_venue_order_refund_decision consumes it in the same transaction
// as the refund (single use) and records the refund under the approver. Any
// other login is unchanged (no PIN asked).

import {
  requireStepUp,
  resolveTillActor,
} from "../_shared/venueTillStaffSession.ts";

// deno-lint-ignore no-explicit-any
type Client = any;
type Respond = (body: Record<string, unknown>, status?: number) => Response;

/** null: go on with the decision; otherwise the refusal to return. */
export async function refundDecisionStepUp(
  client: Client,
  input: {
    orderId: string;
    userId: string;
    jwt: string;
    body: Record<string, unknown>;
  },
  respond: Respond,
): Promise<Response | null> {
  const { data: order, error } = await client.from("venue_orders")
    .select("id, venue_id").eq("id", input.orderId).maybeSingle();
  if (error) {
    console.error(
      "[venue-order-staff] refund_decision order read failed",
      error.code ?? "unknown",
    );
    return respond({ error: "internal_error" }, 500);
  }
  if (!order) return respond({ error: "not_found" }, 404);
  const venueId = String(order.venue_id).toLowerCase();
  const who = await resolveTillActor(client, {
    venueId,
    userId: input.userId,
    jwt: input.jwt,
    staffSession: input.body.staffSession,
  });
  if (!who.ok) return respond({ error: who.code }, who.status);
  if (!who.actor.isDevice) return null;
  const step = await requireStepUp(client, {
    venueId,
    actor: who.actor,
    stepUp: input.body.stepUp,
    purpose: "refund",
    target: input.orderId.toLowerCase(),
  });
  if (!step.ok) {
    return respond({
      ...step.body,
      error: String(step.body.code ?? "pin_step_up_required"),
    }, step.status);
  }
  return null;
}
