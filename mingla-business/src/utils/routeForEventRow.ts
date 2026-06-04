/**
 * routeForEventRow — canonical navigation decision for events-table rows.
 *
 * ORCH-0865 [trips-leak systemic + routeForEventRow helper] — REWORK 5 of
 * ORCH-0859 [Tr2 Minimum Viable Trip]. Every tap-handler / navigation
 * action in mingla-business that receives an id from an events-table
 * row MUST route through this helper instead of hardcoding
 * `/event/${id}` or `/trip/${id}`.
 *
 * Why this exists:
 *   - Pre-REWORK-5 every tap-handler constructed its own route string.
 *     home.tsx:246, hub/events.tsx, EventManageMenu, EventListCard,
 *     deep-link handlers — N call sites, N opportunities to forget that
 *     `event_type` matters post-Tr2.
 *   - ORCH-0859 REWORK 2/3 added event_type filters at the query layer
 *     (12 sites + strict-grep gate). Necessary but not sufficient: if a
 *     trip row reached a tap-handler via any path (Zustand legacy, cache,
 *     race), the handler still routed to /event/{id} — wrong screen.
 *   - Forensics report (ORCH-0865) named this the structural root cause.
 *     Operator's Home Upcoming list tap → events tab is the proof.
 *
 * Routing rules:
 *   - event_type='trip' + status='draft' → /trip/{id}/edit (resume wizard)
 *   - event_type='trip' + status='scheduled' | 'live' | 'ended' | 'cancelled'
 *     → /trip/{id} (operator dashboard)
 *   - event_type='experience' + ANY status → /experience/{id} (operator
 *     dashboard is ALWAYS the entry point — draft or live). The dashboard's
 *     own "Continue editing" / "Edit" action is the only path into the wizard.
 *     (META-ORCH-1059 — operator: tapping an experience opened the edit screen
 *     directly; the dashboard must be the landing surface, with Edit deliberate.)
 *   - event_type='event' + status='draft' → /event/{id}/edit
 *   - event_type='event' + status anything else → /event/{id}
 *   - status undefined → default to non-edit path
 *
 * Enforcement:
 *   `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs`
 *   bans hardcoded `/event/${id}` or `/trip/${id}` constructions outside
 *   (a) this helper file, (b) routes under `app/event/[id]/*` or
 *   `app/trip/[id]/*` (internal navigation within an already-known-type
 *   screen), (c) explicit allowlist comment. Wired into
 *   `.github/workflows/strict-grep-mingla-business.yml`.
 */

export type EventTypeForRouting = "event" | "experience" | "trip";

export type EventStatusForRouting =
  | "draft"
  | "scheduled"
  | "live"
  | "ended"
  | "cancelled"
  | null
  | undefined;

export interface EventRowForRouting {
  id: string;
  event_type: EventTypeForRouting;
  status?: EventStatusForRouting;
}

/**
 * Returns the canonical route string for an events-table row based on
 * its `event_type` and `status`. The caller passes the returned string
 * to `router.push(route as never)`.
 */
export function routeForEventRow(row: EventRowForRouting): string {
  if (row.event_type === "trip") {
    return row.status === "draft"
      ? `/trip/${row.id}/edit`
      : `/trip/${row.id}`;
  }
  if (row.event_type === "experience") {
    // META-ORCH-1059: the experience DASHBOARD is the single entry point for
    // every status (draft included). Unlike event/trip drafts (which resume the
    // wizard directly), tapping an experience ALWAYS opens `/experience/{id}`;
    // the dashboard surfaces draft state + a deliberate "Continue editing" action
    // into `/experience/{id}/edit`. (Operator: taps were jumping straight to edit.)
    return `/experience/${row.id}`;
  }
  // event_type === 'event' (default)
  return row.status === "draft"
    ? `/event/${row.id}/edit`
    : `/event/${row.id}`;
}

/**
 * Variant of routeForEventRow that accepts the camelCased shape used by
 * mingla-business client-side LiveEvent / DraftEvent types (where
 * `event_type` may not be on the type). Falls back to "event" if the
 * field is missing — defensive default for callers that haven't been
 * migrated to carry event_type yet. New callers should prefer
 * `routeForEventRow` directly with the raw row shape.
 */
export function routeForEventRowDefensive(
  row: { id: string; eventType?: string; event_type?: string; status?: string },
): string {
  const eventType = (row.event_type ?? row.eventType ?? "event") as EventTypeForRouting;
  const status = row.status as EventStatusForRouting;
  return routeForEventRow({ id: row.id, event_type: eventType, status });
}
