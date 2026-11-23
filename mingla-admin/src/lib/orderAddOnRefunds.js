// Issue #3281 S4 — add-on lines on the Admin order view, and refunding an
// add-on on its own (decision D-2: the buyer keeps the ticket).
//
// Rows come from admin_order_add_on_lines(p_order_id): { id, name, quantity,
// unit_price_cents, total_cents, refunded_quantity, refunded_cents } plus, for
// an add-on spread over a trip plan (#3281 S5), plan_choice "spread" and, once
// some of it came off the plan's unpaid payments, removed_quantity and
// removed_cents. A removed unit is back like a refunded one. Money is
// integer minor units throughout. The server prices every refund itself
// (quantity × unit price at purchase, never more than the line has left), so the
// amount here is only what the window shows before the admin confirms.

import { isMissingFunctionError } from "./systemPages.js";

/**
 * issue #3281 deploy window — what admin_order_add_on_lines answered. Before
 * the branch's migrations are applied the function does not exist: no add-on
 * lines, no section, exactly as on main. Any other failure throws (the page
 * says the add-ons didn't load).
 */
export function readAddOnLinesResult(result) {
  const error = result?.error ?? null;
  if (error) {
    if (isMissingFunctionError(error)) return [];
    throw new Error(error.message || "Failed to load the order's add-ons.");
  }
  return Array.isArray(result?.data) ? result.data : [];
}

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
    // #3281 S5 — units taken off the trip plan are back too.
    const removedQty = Math.min(quantity - refundedQty, whole(line.removed_quantity));
    const removedCents = whole(line.removed_cents);
    const remaining = quantity - refundedQty - removedQty;
    // Never more than the line has left in money either (a capped earlier
    // refund, or a part already taken off the plan).
    const leftCents = Math.max(0, whole(line.total_cents) - whole(line.refunded_cents) - removedCents);
    const picked = Math.max(0, Math.min(remaining, whole(qtys[line.id])));
    return [{
      id: line.id,
      name: typeof line.name === "string" && line.name.trim() !== "" ? line.name : "Add-on",
      quantity,
      unit,
      paidCents: whole(line.total_cents),
      refundedQty,
      refundedCents: whole(line.refunded_cents),
      removedQty,
      removedCents,
      spread: line.plan_choice === "spread",
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
  // #4522 X-9 — a spread add-on was not paid at checkout: it rides the plan's
  // payments, so it is never shown as "paid".
  const parts = [
    `×${row.quantity}`,
    row.spread
      ? `spread over the plan ${formatMoney(row.paidCents, currency)}`
      : `paid ${formatMoney(row.paidCents, currency)}`,
  ];
  if (row.refundedQty > 0 || row.refundedCents > 0) {
    parts.push(`refunded ${row.refundedQty} (${formatMoney(row.refundedCents, currency)})`);
  }
  // #3281 S5 — the unpaid part of a spread add-on comes off the trip plan.
  if (row.removedCents > 0) {
    parts.push(`taken off the plan ${formatMoney(row.removedCents, currency)}`);
  }
  return parts.join(" · ");
}

/** #3281 S5 — the refund window's note under an add-on spread over a trip plan. */
export const SPREAD_ADD_ON_NOTE =
  "Paid in instalments: the unpaid part comes off the plan and only what was paid is refunded.";

/** #3281 S5 — what admin-refund-order answered when no money moved. */
export function planRemovalNotice(body, formatMoney, currency) {
  if (body === null || typeof body !== "object" || body.status !== "removed_from_plan") return null;
  const removed = whole(body.removed_from_plan_cents);
  if (removed === 0) return null;
  return `Taken off the plan (${formatMoney(removed, currency)}). Nothing was paid for it yet, so no money moved.`;
}
