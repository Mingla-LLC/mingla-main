import { supabase } from "./supabase";
import type {
  GuestRosterFilter,
  GuestRosterActionPreview,
  GuestRosterPage,
  GuestRosterSort,
} from "../types/guestRoster";

export interface GuestRosterListInput {
  eventId: string;
  filter: GuestRosterFilter;
  search: string;
  sort: GuestRosterSort;
  cursor?: Record<string, unknown> | null;
  limit?: number;
  /**
   * issue #3281 — read each row's booked start(s). Only open-hours
   * experiences have them, so the guests screen asks only for experiences
   * (the roster refreshes every 15 s; ordinary events skip the read).
   */
  bookedStarts?: boolean;
}

export interface GuestRosterAccess {
  enabled: boolean;
  phase: "dark" | "internal_read" | "cohort_read" | "single_actions" | "bulk_actions" | "ga";
}

export class GuestRosterError extends Error {
  public readonly code: string;

  public constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "GuestRosterError";
    this.code = code;
  }
}

export function createGuestRosterRequestId(): string {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") return maybeCrypto.randomUUID();
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GuestRosterError("guest_roster_invalid_response");
  }
  return value as Record<string, unknown>;
};

export async function fetchGuestRoster(input: GuestRosterListInput): Promise<GuestRosterPage> {
  const { data, error } = await supabase.rpc("biz_guest_roster_list", {
    p_event_id: input.eventId,
    p_filter: input.filter,
    p_search: input.search.trim().length > 0 ? input.search.trim() : null,
    p_sort: input.sort,
    p_cursor: input.cursor ?? null,
    p_limit: input.limit ?? 100,
  });
  if (error !== null) {
    const code = typeof error.message === "string" && error.message.length > 0
      ? error.message : "guest_roster_load_failed";
    throw new GuestRosterError(code, error.message);
  }
  const page = asObject(data) as unknown as GuestRosterPage;
  return input.bookedStarts === true ? await withBookedStarts(page, input.eventId) : page;
}

/**
 * A failed booked-start read must be visible somewhere other than a missing
 * line. The reporter loads only on this path, as refundPolicyWrites does, so
 * the native Sentry SDK is not pulled into every screen that loads a roster.
 */
function reportBookedStartFailure(failure: unknown): void {
  void import("../diagnostics/reportNonFatal").then(
    ({ reportNonFatal }) => reportNonFatal("guestRosterBookedStarts", failure),
    () => undefined,
  );
}

/** Order ids per `.in()` request: keeps the GET URL short for a full page. */
export const BOOKED_START_BATCH = 100;

/**
 * issue #3281 — each row's booked start(s) (`orders.booked_start_at`, the
 * guest-chosen start on an open-hours experience), read with the page so they
 * refresh with it. One person may hold several orders, so a row carries its
 * distinct starts in order. Fail-soft: any read error leaves the rows as they
 * were (no booked-start line), never failing the roster.
 */
export async function withBookedStarts(
  page: GuestRosterPage,
  eventId: string,
): Promise<GuestRosterPage> {
  const rows = Array.isArray(page.rows) ? page.rows : [];
  const ids = [
    ...new Set(
      rows.flatMap((row) => (Array.isArray(row.orderIds) ? row.orderIds : [])),
    ),
  ];
  if (ids.length === 0) return page;
  const startById = new Map<string, string>();
  // A failed batch stops the read and keeps what earlier batches found; it is
  // reported, never thrown (the roster still shows, without that line).
  try {
    for (let i = 0; i < ids.length; i += BOOKED_START_BATCH) {
      const { data, error } = await supabase
        .from("orders")
        .select("id, booked_start_at")
        .in("id", ids.slice(i, i + BOOKED_START_BATCH))
        .eq("event_id", eventId);
      if (error !== null) {
        reportBookedStartFailure(error);
        break;
      }
      for (const order of (data ?? []) as Array<{ id: string; booked_start_at: string | null }>) {
        if (typeof order.booked_start_at === "string" && order.booked_start_at.length > 0) {
          startById.set(order.id, order.booked_start_at);
        }
      }
    }
  } catch (thrown) {
    reportBookedStartFailure(thrown);
  }
  if (startById.size === 0) return page;
  return {
    ...page,
    rows: rows.map((row) => {
      const starts = [
        ...new Set(
          (row.orderIds ?? [])
            .map((id) => startById.get(id))
            .filter((start): start is string => start !== undefined),
        ),
      ].sort((a, b) => Date.parse(a) - Date.parse(b));
      return starts.length > 0 ? { ...row, bookedStarts: starts } : row;
    }),
  };
}

export async function fetchGuestRosterAccess(eventId: string): Promise<GuestRosterAccess> {
  const { data, error } = await supabase.rpc("biz_guest_roster_access", {
    p_event_id: eventId,
  });
  if (error !== null) throw new GuestRosterError(error.message, error.message);
  return asObject(data) as unknown as GuestRosterAccess;
}

export async function requestGuestRosterExport(input: {
  eventId: string;
  filter: GuestRosterFilter;
  search: string;
  sort: GuestRosterSort;
  clientRequestId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("brand-people-export", {
    body: {
      scope: "offering_guest_roster",
      eventId: input.eventId,
      filter: input.filter,
      search: input.search.trim().length > 0 ? input.search.trim() : null,
      sort: input.sort,
      filterSnapshot: {},
      clientRequestId: input.clientRequestId,
    },
  });
  if (error !== null) throw new GuestRosterError(error.message, error.message);
  return asObject(data);
}

export async function getGuestRosterExport(jobId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("brand-people-export", {
    body: { operation: "status", jobId },
  });
  if (error !== null) throw new GuestRosterError("guest_roster_export_status_failed", error.message);
  return asObject(data);
}

export async function previewGuestRosterAction(input: {
  eventId: string;
  action: "reminder" | "retry_delivery";
  rosterKeys: string[];
  channels: Array<"email" | "sms" | "push">;
}): Promise<GuestRosterActionPreview> {
  const { data, error } = await supabase.functions.invoke("guest-roster-actions", {
    body: { operation: "preview", ...input },
  });
  if (error !== null) throw new GuestRosterError("guest_roster_action_preview_failed", error.message);
  const value = asObject(data);
  if (value.ok !== true) throw new GuestRosterError(String(value.code ?? "guest_roster_action_preview_failed"));
  return value as unknown as GuestRosterActionPreview;
}

export async function executeGuestRosterAction(input: {
  previewId: string;
  clientRequestId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("guest-roster-actions", {
    body: { operation: "execute", ...input },
  });
  if (error !== null) throw new GuestRosterError("guest_roster_action_execute_failed", error.message);
  const value = asObject(data);
  if (value.ok !== true) throw new GuestRosterError(String(value.code ?? "guest_roster_action_execute_failed"));
  return value;
}

export async function setGuestRosterRsvpApproval(input: {
  eventId: string;
  rosterKey: string;
  decision: "approve" | "deny";
  clientRequestId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("business_set_rsvp_guest_status", {
    p_event_id: input.eventId,
    p_decision: input.decision,
    p_scope: "selected",
    p_roster_keys: [input.rosterKey],
    p_expected_watermark: null,
    p_client_request_id: input.clientRequestId,
  });
  // issue #3047 — `error.code` is the PostgREST code (PGRST202 for the 404 this
  // RPC returns in production today); `error.message` is prose. Passing the
  // MESSAGE as the code made GuestRosterError.code unmatchable, so every caller
  // fell through to one blanket sentence. Carry the real code, keep the message.
  if (error !== null) {
    throw new GuestRosterError(
      error.code ?? "rsvp_guest_status_failed",
      error.message,
    );
  }
  return asObject(data);
}
