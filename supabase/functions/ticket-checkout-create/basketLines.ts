// Issue #4624 — normalise basket lines before anything is priced or held.
//
// One ticket type is one basket line. A basket that names the same ticket type
// more than once is merged into a single line when the copies differ only in
// how many tickets they ask for (and, for a dated line, how many per date).
// Copies that disagree on anything else (extras, plan choice, other options)
// cannot be merged safely and are refused with `checkout_lines_duplicate`.
// Checkout v2 already refuses repeated ticket types in its own parser; this
// covers every other request shape (v1 web and native, quote mode, door code,
// ticket link) before the session is created.

export type BasketLineResult<T> =
  | { ok: true; lines: T[] }
  | { ok: false; error: "checkout_lines_duplicate" };

type LineShape = {
  ticketTypeId: string;
  quantity: number;
  byDate?: Record<string, number>;
};

/** Every field except the quantities, in a stable order. */
function mergeKey(line: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(line).sort()) {
    if (key === "quantity" || key === "byDate") continue;
    rest[key] = line[key];
  }
  return JSON.stringify(rest, (_key, value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
        Object.keys(value as Record<string, unknown>).sort().map((k) => [
          k,
          (value as Record<string, unknown>)[k],
        ]),
      )
      : value);
}

/**
 * Merges repeated ticket types; first-seen order is kept. A line carrying
 * extras (`addOns`) is never merged, because extras are priced per line.
 */
export function normaliseBasketLines<T extends LineShape>(
  lines: readonly T[],
): BasketLineResult<T> {
  const byTicket = new Map<string, { line: T; key: string }>();
  const order: string[] = [];
  for (const line of lines) {
    const record = line as unknown as Record<string, unknown>;
    const existing = byTicket.get(line.ticketTypeId);
    if (existing === undefined) {
      byTicket.set(line.ticketTypeId, { line: { ...line }, key: mergeKey(record) });
      order.push(line.ticketTypeId);
      continue;
    }
    const hasAddOns = (value: Record<string, unknown>): boolean =>
      Array.isArray(value.addOns) && value.addOns.length > 0;
    if (
      existing.key !== mergeKey(record) ||
      hasAddOns(record) ||
      hasAddOns(existing.line as unknown as Record<string, unknown>) ||
      (existing.line.byDate === undefined) !== (line.byDate === undefined)
    ) {
      return { ok: false, error: "checkout_lines_duplicate" };
    }
    const merged: T = { ...existing.line, quantity: existing.line.quantity + line.quantity };
    if (existing.line.byDate !== undefined && line.byDate !== undefined) {
      const byDate: Record<string, number> = { ...existing.line.byDate };
      for (const [dateId, count] of Object.entries(line.byDate)) {
        byDate[dateId] = (byDate[dateId] ?? 0) + count;
      }
      merged.byDate = byDate;
    }
    byTicket.set(line.ticketTypeId, { line: merged, key: existing.key });
  }
  return {
    ok: true,
    lines: order.flatMap((id) => {
      const entry = byTicket.get(id);
      return entry === undefined ? [] : [entry.line];
    }),
  };
}
