// Issue #3872 PR 1 (money truth, F4) — refund lines are priced by the server.
//
// biz_refund_order / admin_refund_order compute each line's amount as
// quantity x order_line_items.unit_price_cents and return those lines. The edge
// functions use the RETURNED lines (never the request's amount_cents) for the
// Stripe tax reversal and the buyer's refund notice. A request may still carry
// amount_cents (older Host apps send it); it is accepted, ignored and logged by
// the RPC when it differs.

export interface RefundLineRequest {
  order_line_item_id: string;
  quantity: number;
  amount_cents?: number;
}

export interface ServerRefundLine {
  order_line_item_id: string;
  quantity: number;
  amount_cents: number;
}

/** A requested line: an id and a positive whole quantity; amount optional. */
export function isRefundLineRequest(value: unknown): value is RefundLineRequest {
  const row = value as Partial<RefundLineRequest> | null;
  if (row === null || typeof row !== "object") return false;
  const amountOk = row.amount_cents === undefined || row.amount_cents === null ||
    (Number.isInteger(row.amount_cents) && Number(row.amount_cents) > 0);
  return (
    typeof row.order_line_item_id === "string" &&
    row.order_line_item_id.length > 0 &&
    Number.isInteger(row.quantity) &&
    Number(row.quantity) > 0 &&
    amountOk
  );
}

/** The server-priced lines from the refund RPC's response. */
export function serverRefundLines(pending: Record<string, unknown>): ServerRefundLine[] {
  const raw = Array.isArray(pending.lines) ? pending.lines : [];
  const lines: ServerRefundLine[] = [];
  for (const item of raw) {
    const row = item as Record<string, unknown>;
    const id = typeof row.order_line_item_id === "string" ? row.order_line_item_id : "";
    const quantity = Number(row.quantity);
    const amount = Number(row.amount_cents);
    if (id.length === 0 || !Number.isInteger(quantity) || !Number.isInteger(amount)) continue;
    lines.push({ order_line_item_id: id, quantity, amount_cents: amount });
  }
  return lines;
}

// Issue #3281 S4 — a host or admin may refund add-on lines on their own. The
// request field `addOnLines` ([{order_add_on_line_item_id, quantity}]) is
// optional; the lines ride the refund RPC's p_lines as elements keyed
// order_add_on_line_item_id (the SQL splits them off and refuses them while
// add_on_rollout.free_parent_enabled is off). Absent or empty, p_lines is the
// ticket lines exactly as before.
export interface AddOnRefundLineRequest {
  order_add_on_line_item_id: string;
  quantity: number;
}

/** [] when the field is absent or empty; null when it is present but malformed. */
export function parseAddOnRefundLines(value: unknown): AddOnRefundLineRequest[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: AddOnRefundLineRequest[] = [];
  for (const item of value) {
    const row = item as Record<string, unknown> | null;
    if (row === null || typeof row !== "object") return null;
    const id = row.order_add_on_line_item_id;
    const quantity = row.quantity;
    if (typeof id !== "string" || id.length === 0) return null;
    if (!Number.isInteger(quantity) || Number(quantity) <= 0) return null;
    out.push({ order_add_on_line_item_id: id, quantity: Number(quantity) });
  }
  return out;
}

/** The refund RPC's p_lines: ticket lines, then any add-on lines. */
export function refundRpcLines(
  lines: RefundLineRequest[],
  addOnLines: AddOnRefundLineRequest[],
): Array<RefundLineRequest | AddOnRefundLineRequest> {
  return addOnLines.length === 0 ? lines : [...lines, ...addOnLines];
}

/** Add-on refund refusals, checked before the ticket-line codes they contain. */
export function addOnRefundRpcError(
  errorMessage: string,
): { code: string; status: number; detail: string } | null {
  const msg = errorMessage.toLowerCase();
  for (const code of ["add_on_line_overrefund", "add_on_line_not_found", "add_on_refunds_off"]) {
    if (msg.includes(code)) return { code, status: 422, detail: errorMessage };
  }
  // Issue #3281 S5 — a spread add-on's trip plan: every ticket back while add-on
  // money is still on open rows is a cancellation, and a plan that moved (a
  // payment in flight, or rows changed under the removal) is retried.
  for (const code of ["add_on_plan_open_use_cancel", "add_on_plan_changed", "balance_payment_in_flight"]) {
    if (msg.includes(code)) return { code, status: 409, detail: errorMessage };
  }
  return null;
}

// Issue #3281 S5 — refunding a spread add-on first takes it off the trip
// plan's open rows. When none of it was collected yet no money moves: the RPC
// answers `plan_removal_only` and the edge returns without calling a provider.
export interface PlanRemovalOnlyResponse {
  refund_id: null;
  order_id: string;
  amount_cents: 0;
  currency: string;
  status: "removed_from_plan";
  removed_from_plan_cents: number;
  new_payment_status: string | null;
  idempotent_replay: boolean;
}

/** The edge's reply for a plan-only removal, or null for an ordinary refund. */
export function planRemovalOnlyResponse(
  pending: Record<string, unknown>,
): PlanRemovalOnlyResponse | null {
  if (pending.plan_removal_only !== true) return null;
  const removed = pending.removed_from_plan_cents;
  if (
    typeof removed !== "number" || !Number.isInteger(removed) || removed <= 0 ||
    pending.amount_cents !== 0
  ) {
    throw new Error("plan_removal_result_invalid");
  }
  return {
    refund_id: null,
    order_id: String(pending.order_id ?? ""),
    amount_cents: 0,
    currency: String(pending.currency ?? ""),
    status: "removed_from_plan",
    removed_from_plan_cents: removed,
    new_payment_status: typeof pending.proposed_new_payment_status === "string"
      ? pending.proposed_new_payment_status
      : null,
    idempotent_replay: pending.idempotent_replay === true,
  };
}
