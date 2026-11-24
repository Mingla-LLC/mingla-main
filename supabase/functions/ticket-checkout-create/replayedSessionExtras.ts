/**
 * issue #4522 E-4 — the add-ons of a checkout session a replayed attempt
 * resolved to.
 *
 * `issue_3859_resolve_checkout_attempt` predates add-ons: the session it
 * returns carries no `extras` / `extrasTotalCents`. Without them the replay
 * prices an add-on cart as tickets only, its contract fingerprint differs from
 * the first call's, and an unchanged cart is sent to "Please review your
 * order" (and, accepted, to a second session). The extras are read from the
 * session's own add-on rows, in the shape the create RPC returns them.
 */
/** The columns read for each add-on row (`ticket_checkout_session_add_on_items`). */
export const REPLAY_EXTRAS_COLUMNS =
  "ticket_add_on_id, ticket_type_id, add_on_name_at_purchase, ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents";

export interface ReplayedSessionExtras {
  extras: Array<{
    addOnId: unknown;
    ticketTypeId: unknown;
    addOnName: unknown;
    ticketName: unknown;
    dayScope: unknown;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  extrasTotalCents: number;
}

/** null — the rows could not be read; the caller refuses (never guesses 0). */
export async function replayedSessionExtras(
  readRows: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<ReplayedSessionExtras | null> {
  const { data, error } = await readRows();
  if (error !== null || !Array.isArray(data)) return null;
  const extras = (data as Array<Record<string, unknown>>).map((x) => ({
    addOnId: x.ticket_add_on_id,
    ticketTypeId: x.ticket_type_id,
    addOnName: x.add_on_name_at_purchase,
    ticketName: x.ticket_type_name_at_purchase,
    dayScope: x.day_scope ?? null,
    quantity: Number(x.quantity),
    unitPriceCents: Number(x.unit_price_cents),
    totalCents: Number(x.total_cents),
  }));
  if (extras.some((x) => !Number.isInteger(x.totalCents) || x.totalCents < 0)) {
    return null;
  }
  return {
    extras,
    extrasTotalCents: extras.reduce((sum, x) => sum + x.totalCents, 0),
  };
}
