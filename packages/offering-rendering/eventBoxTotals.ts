/**
 * eventBoxTotals — ORCH-1167 [event-page-canonical].
 *
 * The PURE (React-Native-free) running-total math for the canonical event page's
 * inline ticket box. Extracted from EventOfferingBody so it is unit-testable under
 * a plain node/ts-jest environment (the component imports react-native and cannot
 * be imported in node-env jest). EventOfferingBody re-exports these.
 *
 * I-PROPOSED-1167-ALLIN-PRICE-IN-TICKET-BOX: the running total is Σ(server all-in ×
 * qty) — WYSIWYP (ORCH-1147). The per-unit price reads priceAllInGbp, falling back
 * to priceGbp ONLY when the tier carries no all-in (free / RPC miss) — never
 * fabricating a markup (Constitution #9), never showing the bare base under the box.
 */

export interface TicketLike {
  id: string;
  isFree: boolean;
  priceGbp: number | null;
  priceAllInGbp?: number | null;
}

/** The per-unit all-in price (WYSIWYP). Free / missing → 0. */
export const ticketUnitAllIn = (ticket: TicketLike): number => {
  if (ticket.isFree) return 0;
  const price = ticket.priceAllInGbp ?? ticket.priceGbp;
  return typeof price === "number" && Number.isFinite(price) ? price : 0;
};

/** Σ(priceAllInGbp × qty) across the selected quantities (never bare base). */
export const computeRunningTotal = (
  tickets: TicketLike[],
  quantities: Record<string, number>,
): number => {
  let total = 0;
  for (const t of tickets) {
    const qty = quantities[t.id] ?? 0;
    if (qty > 0) total += ticketUnitAllIn(t) * qty;
  }
  return total;
};

/** Total selected quantity across all tiers. */
export const totalSelectedQuantity = (
  quantities: Record<string, number>,
): number => {
  let n = 0;
  for (const key of Object.keys(quantities)) n += quantities[key] ?? 0;
  return n;
};
