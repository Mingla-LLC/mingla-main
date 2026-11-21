// Issue #3281 S4 — add-on lines on the Admin order view, and refunding an
// add-on on its own (decision D-2: the buyer keeps the ticket).
//
// Rows come from admin_order_add_on_lines(p_order_id): { id, name, quantity,
// unit_price_cents, total_cents, refunded_quantity, refunded_cents }. Money is
// integer minor units throughout. The server prices every refund itself
// (quantity × unit price at purchase, never more than the line has left), so the
// amount here is only what the window shows before the admin confirms.

const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** One display/refund row per add-on line; malformed rows are dropped. */
export function addOnRows(lines, qtys = {}) {
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((line) => {
    if (line === null || typeof line !== "object" || typeof line.id !== "string") return [];
    const quantity = whole(line.quantity);
    if (quantity === 0) return [];
    const unit = whole(line.unit_price_cents);
    const refundedQty = Math.min(quantity, whole(line.refunded_quantity));
    const remaining = quantity - refundedQty;
    // Never more than the line has left in money either (a capped earlier refund).
    const leftCents = Math.max(0, whole(line.total_cents) - whole(line.refunded_cents));
    const picked = Math.max(0, Math.min(remaining, whole(qtys[line.id])));
    return [{
      id: line.id,
      name: typeof line.name === "string" && line.name.trim() !== "" ? line.name : "Add-on",
      quantity,
      unit,
      paidCents: whole(line.total_cents),
      refundedQty,
      refundedCents: whole(line.refunded_cents),
      remaining,
      qty: picked,
      amount: Math.min(unit * picked, leftCents),
    }];
  });
}

/** The add-on part of an admin-refund-order body; absent when nothing is picked. */
export function addOnLinesBody(rows) {
  const picked = (rows || [])
    .filter((row) => row.qty > 0)
    .map((row) => ({ order_add_on_line_item_id: row.id, quantity: row.qty }));
  return picked.length === 0 ? {} : { addOnLines: picked };
}

/** "×2 · paid $20.00 · refunded 1 ($10.00)" pieces for the order view. */
export function addOnSummary(row, formatMoney, currency) {
  const parts = [`×${row.quantity}`, `paid ${formatMoney(row.paidCents, currency)}`];
  if (row.refundedQty > 0 || row.refundedCents > 0) {
    parts.push(`refunded ${row.refundedQty} (${formatMoney(row.refundedCents, currency)})`);
  }
  return parts.join(" · ");
}
