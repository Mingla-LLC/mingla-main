import { supabase } from "./supabase";

export interface JoinWaitlistInput {
  eventId: string;
  ticketTypeId: string;
  email?: string;
  phone?: string;
  name?: string;
  qtyRequested: number;
  consent: true;
}

export interface JoinWaitlistResult {
  waitlistEntryId: string;
  status: "waiting" | "already_waiting";
}

export interface EventWaitlistEntry {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  qtyRequested: number;
  status: "waiting" | "invited" | string;
  createdAt: string;
}

export interface EventWaitlistTicket {
  ticketTypeId: string;
  ticketTypeName: string;
  waitlistEnabled: boolean;
  waitingCount: number;
  invitedCount: number;
  recent: EventWaitlistEntry[];
}

interface EventWaitlistRpcRow {
  ticket_type_id: string;
  ticket_type_name: string;
  waitlist_enabled: boolean;
  waiting_count: number;
  invited_count: number;
  recent: unknown;
}

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const mapWaitlistEntry = (value: unknown): EventWaitlistEntry | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = asStringOrNull(row.id);
  const createdAt = asStringOrNull(row.created_at);
  if (id === null || createdAt === null) return null;
  return {
    id,
    name: asStringOrNull(row.name),
    email: asStringOrNull(row.email),
    phone: asStringOrNull(row.phone),
    qtyRequested:
      typeof row.qty_requested === "number" &&
      Number.isFinite(row.qty_requested)
        ? row.qty_requested
        : 1,
    status: asStringOrNull(row.status) ?? "waiting",
    createdAt,
  };
};

const mapWaitlistRow = (row: EventWaitlistRpcRow): EventWaitlistTicket => ({
  ticketTypeId: row.ticket_type_id,
  ticketTypeName: row.ticket_type_name,
  waitlistEnabled: row.waitlist_enabled,
  waitingCount: row.waiting_count,
  invitedCount: row.invited_count,
  recent: Array.isArray(row.recent)
    ? row.recent
        .map(mapWaitlistEntry)
        .filter((entry): entry is EventWaitlistEntry => entry !== null)
    : [],
});

async function readFunctionJson(
  error: unknown,
): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown }).context;
  if (context && typeof context === "object" && "json" in context) {
    try {
      return (await (context as Response).json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export async function joinWaitlist(
  input: JoinWaitlistInput,
): Promise<JoinWaitlistResult> {
  const { data, error } = await supabase.functions.invoke("waitlist-signup", {
    body: {
      event_id: input.eventId,
      ticket_type_id: input.ticketTypeId,
      email: input.email,
      phone: input.phone,
      name: input.name,
      qty_requested: input.qtyRequested,
      consent: input.consent,
    },
  });

  if (error !== null) {
    const errorBody = await readFunctionJson(error);
    if (errorBody?.error === "already_waiting") {
      return {
        waitlistEntryId:
          typeof errorBody.waitlist_entry_id === "string"
            ? errorBody.waitlist_entry_id
            : "",
        status: "already_waiting",
      };
    }
    throw new Error(
      typeof errorBody?.error === "string" ? errorBody.error : error.message,
    );
  }

  const body = data as {
    waitlist_entry_id?: unknown;
    status?: unknown;
  } | null;
  return {
    waitlistEntryId:
      typeof body?.waitlist_entry_id === "string" ? body.waitlist_entry_id : "",
    status: body?.status === "already_waiting" ? "already_waiting" : "waiting",
  };
}

export async function fetchEventWaitlist(
  eventId: string,
): Promise<EventWaitlistTicket[]> {
  const { data, error } = await supabase.rpc("event_waitlist_get", {
    p_event_id: eventId,
    p_recent_limit: 25,
  });
  if (error !== null) {
    throw new Error(error.message);
  }
  return ((data ?? []) as EventWaitlistRpcRow[]).map(mapWaitlistRow);
}
