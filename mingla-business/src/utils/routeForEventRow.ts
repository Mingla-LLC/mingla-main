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
 *   - event_type='rsvp' + status='draft' → /rsvp/{id}/edit (resume the RSVP wizard)
 *   - event_type='rsvp' + status anything else → /rsvp/{id} (RSVP dashboard)
 *     (ORCH-1150 [RSVP event wizard] — RSVP drafts/rows MUST resume into
 *     RsvpCreatorWizard, never the ticketed EventCreatorWizard. The camelCase
 *     DraftEvent shape has no `event_type`; it carries `isRsvp` instead, so the
 *     defensive variant coerces `isRsvp===true` → event_type:'rsvp'.)
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

export type EventTypeForRouting = "event" | "experience" | "trip" | "rsvp";
export type BusinessRecentEntityType = EventTypeForRouting | "venue";
export type BusinessRecentDestination = "detail" | "edit";

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
  if (row.event_type === "rsvp") {
    // ORCH-1150 — RSVP rows resume into the RSVP wizard / dashboard, never the
    // ticketed event surfaces. Mirrors the event branch's draft-vs-live split.
    return row.status === "draft"
      ? `/rsvp/${row.id}/edit`
      : `/rsvp/${row.id}`;
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
  row: {
    id: string;
    eventType?: string;
    event_type?: string;
    status?: string;
    // ORCH-1150 — the camelCase DraftEvent / LiveEvent shape carries `isRsvp`
    // (the DraftEvent type has NO `event_type` field at all), so callers route
    // RSVP rows by passing this flag. It takes precedence over a missing
    // event_type and coerces to event_type:'rsvp'.
    isRsvp?: boolean;
  },
): string {
  const eventType = (
    row.isRsvp === true
      ? "rsvp"
      : row.event_type ?? row.eventType ?? "event"
  ) as EventTypeForRouting;
  const status = row.status as EventStatusForRouting;
  return routeForEventRow({ id: row.id, event_type: eventType, status });
}

/** Canonical route for the mixed #2794 Recent workspace. */
export function routeForBusinessRecent(row: {
  id: string;
  entityType: BusinessRecentEntityType;
  destination?: BusinessRecentDestination;
  status?: string | null;
}): string | null {
  if (
    !["venue", "event", "rsvp", "experience", "trip"].includes(row.entityType)
  )
    return null;
  if (
    row.status != null &&
    !["draft", "scheduled", "live", "ended", "cancelled"].includes(row.status)
  )
    return null;
  const destination =
    row.destination ?? (row.status === "draft" ? "edit" : "detail");
  if (row.entityType === "venue") return `/venue/${row.id}`;
  if (destination === "edit") {
    switch (row.entityType) {
      case "event":
        return `/event/${row.id}/edit`;
      case "rsvp":
        return `/rsvp/${row.id}/edit`;
      case "experience":
        return `/experience/${row.id}/edit`;
      case "trip":
        return `/trip/${row.id}/edit`;
    }
  }
  return routeForEventRow({
    id: row.id,
    event_type: row.entityType,
    status: row.status as EventStatusForRouting,
  });
}
