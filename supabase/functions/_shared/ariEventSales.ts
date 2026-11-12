// Issue #3355 rework 9 (fix 5) — what list_events tells the model about
// tickets, in words it cannot misread.
//
// Local demo 2026-11-12: Ari said Suya Sunday Brunch "has 1 ticket sold". The
// read's `tickets.count` (business_list_events_for_ari) is the number of
// TICKET TYPES, not tickets sold. On the switch's on path the row's tickets
// object becomes
//   { ticket_type_count, total_capacity, all_free, tickets_sold }
// where `tickets_sold` is read from the tickets themselves (the source of
// truth the event lifecycle uses: every ticket not void or refunded), with
// the caller's login, so RLS decides (any brand member reads its tickets).
// A read that fails, or is too big to count, says `tickets_sold: null` with
// `tickets_sold_known: false`, never a guess. The off path keeps origin/main's
// row as it is (ariRolloutTurn.ts).
//
// Invariant I-ARI-SOLD-COUNT-FROM-TICKETS (declared beside its enforcing test): On the "Ari understands first" path, list_events never hands the model a bare tickets.count: each row carries ticket_type_count and tickets_sold (the event's tickets that are not void or refunded, read as the caller), and a sold count in Ari's reply must match a sold count a read returned this turn (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_9.implementor.test.ts).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/** Tickets that count as sold (the event lifecycle's own rule). */
const NOT_SOLD_STATUSES = ["void", "refunded"] as const;
/** One read counts at most this many tickets; more is "not known". */
export const ARI_SOLD_READ_CAP = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TicketsClient = Pick<SupabaseClient, "from">;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Tickets sold per event id, or null when the read failed or was capped. */
export async function readTicketsSold(
  client: TicketsClient,
  eventIds: readonly string[],
): Promise<Map<string, number> | null> {
  const ids = [...new Set(eventIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return out;
  try {
    const { data, error } = await client.from("tickets")
      .select("event_id")
      .in("event_id", ids)
      .not("status", "in", `(${NOT_SOLD_STATUSES.join(",")})`)
      .range(0, ARI_SOLD_READ_CAP - 1);
    if (error || !Array.isArray(data)) return null;
    if (data.length >= ARI_SOLD_READ_CAP) return null;
    for (const row of data as Array<{ event_id?: unknown }>) {
      if (typeof row.event_id === "string" && out.has(row.event_id)) {
        out.set(row.event_id, (out.get(row.event_id) ?? 0) + 1);
      }
    }
    return out;
  } catch (_error) {
    return null;
  }
}

/**
 * One list_events row with its tickets said plainly: ticket types are a
 * count of types, sold is a count of tickets (null when not known).
 */
export function labelEventTickets(
  row: unknown,
  sold: ReadonlyMap<string, number> | null,
): unknown {
  const event = recordOf(row);
  if (!event) return row;
  const tickets = recordOf(event.tickets);
  const id = typeof event.id === "string" ? event.id : "";
  const count = sold && sold.has(id) ? sold.get(id)! : null;
  return {
    ...event,
    tickets: {
      ticket_type_count: typeof tickets?.count === "number"
        ? tickets.count
        : null,
      total_capacity: typeof tickets?.capacity === "number"
        ? tickets.capacity
        : null,
      all_free: typeof tickets?.free === "boolean" ? tickets.free : null,
      tickets_sold: count,
      tickets_sold_known: count !== null,
    },
  };
}

/** list_events' result on the on path: every row labelled, sold read once. */
export async function withTicketsSold(
  result: unknown,
  client: TicketsClient,
): Promise<unknown> {
  const top = recordOf(result);
  if (!top || !Array.isArray(top.events)) return result;
  const ids = top.events.flatMap((row) => {
    const id = recordOf(row)?.id;
    return typeof id === "string" ? [id] : [];
  });
  const sold = await readTicketsSold(client, ids);
  return {
    ...top,
    events: top.events.map((row) => labelEventTickets(row, sold)),
  };
}

/** A sold-count fact a read of this turn returned. */
export interface SoldCountFact {
  title: string | null;
  sold: number | null;
}

/**
 * The sold counts this turn's reads returned: list_events rows (title,
 * tickets_sold) and get_event_order_reconciliation (sold_count, titled from
 * the same turn's list_events when it named the event).
 */
export function soldCountFacts(
  observations: ReadonlyArray<
    { tool: string; result?: unknown; error?: unknown }
  >,
): SoldCountFact[] {
  const titles = new Map<string, string>();
  const out: SoldCountFact[] = [];
  for (const item of observations) {
    if (item.error || item.tool !== "list_events") continue;
    const events = recordOf(item.result)?.events;
    if (!Array.isArray(events)) continue;
    for (const row of events) {
      const event = recordOf(row);
      if (!event) continue;
      const title = typeof event.title === "string" ? event.title : null;
      if (title && typeof event.id === "string") titles.set(event.id, title);
      const tickets = recordOf(event.tickets);
      if (!tickets || !("tickets_sold" in tickets)) continue;
      out.push({
        title,
        sold: typeof tickets.tickets_sold === "number"
          ? tickets.tickets_sold
          : null,
      });
    }
  }
  for (const item of observations) {
    if (item.error || item.tool !== "get_event_order_reconciliation") continue;
    const result = recordOf(item.result);
    if (!result || typeof result.sold_count !== "number") continue;
    const id = typeof result.event_id === "string" ? result.event_id : "";
    out.push({ title: titles.get(id) ?? null, sold: result.sold_count });
  }
  return out;
}
