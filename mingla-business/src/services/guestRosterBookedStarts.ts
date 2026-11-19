/**
 * issue #3281 — each guest-roster row's booked start(s) (`orders.booked_start_at`,
 * the guest-chosen start on an open-hours experience), read with the page so they
 * refresh with it. One person may hold several orders, so a row carries its
 * distinct starts in order.
 *
 * Loaded on demand by guestRosterService.fetchGuestRoster (experiences only), so
 * it stays out of the shared web chunk. Optional enrichment: it never fails or
 * blocks the roster. A failed batch stops the read, a stalled one is cut at the
 * deadline, and both keep what earlier batches found and are reported.
 */
import { supabase } from "./supabase";
import type { GuestRosterPage } from "../types/guestRoster";

/** Order ids per `.in()` request: keeps the GET URL short for a full page. */
export const BOOKED_START_BATCH = 100;

/** The whole read, every batch: past this the roster shows without the line. */
export const BOOKED_START_DEADLINE_MS = 4_000;

function reportBookedStartFailure(failure: unknown): void {
  // Loaded only on this path, as refundPolicyWrites does: statically it would
  // pull the native Sentry SDK into every screen that loads a roster.
  void import("../diagnostics/reportNonFatal").then(
    ({ reportNonFatal }) => reportNonFatal("guestRosterBookedStarts", failure),
    () => undefined,
  );
}

export async function withBookedStarts(
  page: GuestRosterPage,
  eventId: string,
  options: { deadlineMs?: number } = {},
): Promise<GuestRosterPage> {
  const rows = Array.isArray(page.rows) ? page.rows : [];
  const ids = [
    ...new Set(
      rows.flatMap((row) => (Array.isArray(row.orderIds) ? row.orderIds : [])),
    ),
  ];
  if (ids.length === 0) return page;

  const startById = new Map<string, string>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), options.deadlineMs ?? BOOKED_START_DEADLINE_MS);
  });
  const read = (async (): Promise<"done"> => {
    for (let i = 0; i < ids.length; i += BOOKED_START_BATCH) {
      if (controller.signal.aborted) break;
      const { data, error } = await supabase
        .from("orders")
        .select("id, booked_start_at")
        .in("id", ids.slice(i, i + BOOKED_START_BATCH))
        .eq("event_id", eventId)
        .abortSignal(controller.signal);
      if (controller.signal.aborted) break;
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
    return "done";
  })().catch((thrown: unknown) => {
    if (!controller.signal.aborted) reportBookedStartFailure(thrown);
    return "done" as const;
  });
  try {
    if ((await Promise.race([read, deadline])) === "deadline") {
      controller.abort();
      reportBookedStartFailure(new Error("guest_roster_booked_starts_deadline"));
    }
  } finally {
    clearTimeout(timer);
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
