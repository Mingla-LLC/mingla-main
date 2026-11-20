// issue #3281 — the start a guest booked on an open-daily experience
// (`orders.booked_start_at`, round 1b / #3979), carried to the door: the QR
// scan answer (`scan-ticket`) and the "Find by name" search (`guest-list`).
//
// Authorization is NOT decided here. Callers read only order ids that an
// actor-checked RPC already returned for this event (`biz_ticket_scan`,
// `biz_door_guest_search`), and every read is also pinned to that event, so
// this can never reveal an order the door could not already see.
//
// Every read is optional: a slow, refused or failed read returns "nothing"
// and the caller's answer goes back exactly as it would have without it.
//
// Loose structural client types on purpose: importing supabase-js types here
// would put a second `@supabase/supabase-js@2` type graph into every function
// that imports this file (see AGENTS.md, Deno / esm.sh).

type QueryResult = { data: unknown; error: unknown };

// deno-lint-ignore no-explicit-any
type Chain = any;

export type DoorReadClient = {
  from: (table: string) => Chain;
  rpc: (fn: string, args: Record<string, unknown>) => Chain;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A readable instant, as the database wrote it; anything else is null. */
export function bookedStartValue(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/** One order's booked start, or null (none, unreadable, failed, too slow). */
export async function readBookedStart(
  client: DoorReadClient,
  eventId: string,
  orderId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const found = await readBookedStarts(client, eventId, [orderId], signal);
  return found[orderId] ?? null;
}

/** orderId -> booked start, only for orders that have one. */
export async function readBookedStarts(
  client: DoorReadClient,
  eventId: string,
  orderIds: readonly string[],
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const ids = [...new Set(orderIds)].filter((id) => UUID.test(id));
  if (!UUID.test(eventId) || ids.length === 0) return {};
  try {
    const result = await client
      .from("orders")
      .select("id, booked_start_at")
      .eq("event_id", eventId)
      .in("id", ids)
      .not("booked_start_at", "is", null)
      .abortSignal(signal) as QueryResult;
    if (result.error || !Array.isArray(result.data)) {
      console.error("[door] booked start unavailable");
      return {};
    }
    const out: Record<string, string> = {};
    for (const row of result.data) {
      if (row === null || typeof row !== "object") continue;
      const id = (row as { id?: unknown }).id;
      const value = bookedStartValue((row as { booked_start_at?: unknown }).booked_start_at);
      if (typeof id === "string" && ids.includes(id) && value !== null) out[id] = value;
    }
    return out;
  } catch {
    console.error("[door] booked start unavailable");
    return {};
  }
}

/** The extras an order still owes, for the door; [] on any failure. */
export async function readScanExtras(
  client: DoorReadClient,
  actorId: string,
  eventId: string,
  orderId: string,
  signal: AbortSignal,
): Promise<unknown[]> {
  try {
    const result = await client
      .rpc("issue_3281_door_order_extras", {
        p_actor_id: actorId,
        p_event_id: eventId,
        p_order_ids: [orderId],
      })
      .abortSignal(signal) as QueryResult;
    if (result.error) {
      console.error("[scan-ticket] door extras unavailable");
      return [];
    }
    const items = (result.data as Record<string, unknown> | null)?.[orderId];
    return Array.isArray(items) ? items : [];
  } catch {
    console.error("[scan-ticket] door extras unavailable");
    return [];
  }
}

// #4514 §6 — the door line, ready to show. ONE owner for every door surface:
// the ticket scan (`scan-ticket`) and the name admit (`guest-list` admit) both
// send this shape, and each screen only renders `lines` (no client formatting
// module, so nothing door-shaped lands in the shared web boot chunk).
//

/** Decision 16: at most 3 door questions, each answer cut at 60 characters. */
export const DOOR_LINE_MAX_ITEMS = 3;
export const DOOR_LINE_MAX_VALUE = 60;
const DOOR_LINE_MAX_LABEL = 40;

export const DOOR_LINE_COPY = Object.freeze({
  notAnswered: "Questions not answered",
  unavailable: "Answers unavailable",
});

export type DoorAnswersState = "answered" | "not_answered" | "unavailable";

/** What the door shows: the words, the tone, the header, and whether "See all answers" may open. */
export type DoorAnswersView = {
  state: DoorAnswersState;
  /** "From Quinn B.'s order" on another ticket of the buyer's order (decision 15). */
  header: string | null;
  /** At most 3 "label: value" lines, or the one state line. */
  lines: string[];
  /** The host switch, or manager rank; brand_form_door_full_answers enforces it again. */
  fullAnswers: boolean;
};

/** #4514 §6: the door line when the read failed or missed the deadline. */
export const doorAnswersUnavailable = (): DoorAnswersView => ({
  state: "unavailable",
  header: null,
  lines: [DOOR_LINE_COPY.unavailable],
  fullAnswers: false,
});

const cut = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/**
 * The SQL door line (`brand_form_door_answers`) as the door shows it, or null
 * when there is nothing to show (no form, a malformed answer). Pure.
 */
export function doorAnswersView(raw: unknown): DoorAnswersView | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const line = raw as Record<string, unknown>;
  if (line.state === "unavailable") return doorAnswersUnavailable();
  if (line.state === "not_answered") {
    return { state: "not_answered", header: null, lines: [DOOR_LINE_COPY.notAnswered], fullAnswers: false };
  }
  if (line.state !== "answered" || !Array.isArray(line.items)) return null;
  const lines = line.items
    .flatMap((item) => {
      if (item === null || typeof item !== "object") return [];
      const x = item as Record<string, unknown>;
      if (typeof x.label !== "string" || typeof x.value !== "string") return [];
      const label = x.label.trim();
      const value = x.value.trim();
      if (label.length === 0 || value.length === 0) return [];
      return [`${cut(label, DOOR_LINE_MAX_LABEL)}: ${cut(value, DOOR_LINE_MAX_VALUE)}`];
    })
    .slice(0, DOOR_LINE_MAX_ITEMS);
  if (lines.length === 0) return null;
  const from = typeof line.fromOrderOf === "string" ? line.fromOrderOf.trim() : "";
  return {
    state: "answered",
    header: from.length > 0 ? `From ${from}'s order` : null,
    lines,
    fullAnswers: line.fullAnswers === true,
  };
}

/**
 * #4514 §6 — the guest's door line, ready to show: the answers to the
 * questions the host marked "Shown to door staff", "Questions not answered",
 * or null when there is nothing to show (no form, an optional form left blank,
 * a guest added by the host). Never throws: a refused, failed or too-slow read
 * is "unavailable", so the scan or admit answer still goes back unchanged.
 * Callers pass only a ticket the actor-checked RPC already resolved at this
 * event (biz_ticket_scan, biz_ticket_admit_by_id).
 */
export async function readDoorAnswers(
  client: DoorReadClient,
  actorId: string,
  eventId: string,
  orderId: string,
  ticketId: string | null,
  signal: AbortSignal,
): Promise<DoorAnswersView | null> {
  if (!UUID.test(eventId) || !UUID.test(orderId)) return null;
  try {
    const result = await client
      .rpc("brand_form_door_answers", {
        p_actor_id: actorId,
        p_event_id: eventId,
        p_subject: {
          kind: "order",
          id: orderId,
          ...(ticketId !== null && UUID.test(ticketId) ? { ticketId } : {}),
        },
      })
      .abortSignal(signal) as QueryResult;
    if (result.error) {
      console.error("[door] answers unavailable");
      return doorAnswersUnavailable();
    }
    const line = result.data;
    if (line === null || line === undefined) return null;
    if (typeof line !== "object" || Array.isArray(line)) {
      console.error("[door] answers unreadable");
      return doorAnswersUnavailable();
    }
    return doorAnswersView(line);
  } catch {
    console.error("[door] answers unavailable");
    return doorAnswersUnavailable();
  }
}

/**
 * The scan answer with the door's optional fields added. With no extras, no
 * booked start and no door line it is the same object, so the body stays
 * byte-identical.
 */
export function withDoorFields(
  scan: Record<string, unknown>,
  extras: unknown[],
  bookedStartAt: string | null,
  doorAnswers: DoorAnswersView | null = null,
): Record<string, unknown> {
  if (extras.length === 0 && bookedStartAt === null && doorAnswers === null) return scan;
  return {
    ...scan,
    ...(extras.length > 0 ? { extras } : {}),
    ...(bookedStartAt !== null ? { bookedStartAt } : {}),
    ...(doorAnswers !== null ? { doorAnswers } : {}),
  };
}
