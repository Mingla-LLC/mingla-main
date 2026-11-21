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
  return null;
}
