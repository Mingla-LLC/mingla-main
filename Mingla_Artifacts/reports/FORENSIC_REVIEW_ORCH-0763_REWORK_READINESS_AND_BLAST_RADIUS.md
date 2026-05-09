# FORENSIC REVIEW - ORCH-0763 Business Event Publish/Link Rework Readiness

Date: 2026-05-08
Mode: Forensics review
Verdict: REWORK PROMPT INCOMPLETE - ADDENDUM REQUIRED

## Layman Summary

The current repair direction is right, but it does not cover the full blast radius yet.

The app now lets a newly published event be loaded from the real database on the main event detail page. But several buttons on that page still send the user into older screens that only know how to read local phone/app memory. So the user can open a published event, tap Orders, Guests, Scanner, Scanners, Door Sales, or Reconciliation, and land on "Event not found" even though the event exists.

This is the same class of problem as the bad share link: one part of the app moved to real server event IDs, while nearby parts still assume old local event IDs.

## Scope Reviewed

- Prior implementation report for ORCH-0763
- Tester failure report for ORCH-0763
- Current local app route behavior for event detail and management subroutes
- Current local and remote migration state
- Current rework prompt direction

## Confirmed Existing Tester Failures

The tester report remains valid.

### P1 - Autosave race protection is still incomplete

Evidence:

- `mingla-business/src/components/event/EventCreatorWizard.tsx:201` queues a debounced autosave, but there is no monotonic client revision.
- `mingla-business/src/components/event/EventCreatorWizard.tsx:331` updates the local draft and queues the save from the current object snapshot.
- `mingla-business/src/hooks/useServerDraftEvents.ts:56` hydrates query data directly into local draft state.
- `mingla-business/src/hooks/useServerDraftEvents.ts:138` hydrates individual draft query data directly into local draft state.
- `mingla-business/src/hooks/useServerDraftEvents.ts:161` applies autosave success directly and invalidates the list.

Root cause:

- A slower server response can still overwrite a newer local edit because the client has no revision guard and no dirty-draft hydration guard.

User impact:

- A user can type or edit event fields and have older saved data reappear.

### P1 - Lifecycle actions still give false success

Evidence:

- `mingla-business/app/(tabs)/events.tsx:390` ends ticket sales by mutating `liveEventStore` and shows "Ticket sales ended."
- `mingla-business/app/(tabs)/events.tsx:405` cancels an event by mutating `liveEventStore` after simulated processing and shows success copy.
- `mingla-business/app/event/[id]/index.tsx:243` ends ticket sales by mutating `liveEventStore`.
- `mingla-business/app/event/[id]/index.tsx:255` cancels by mutating `liveEventStore` after simulated processing.

Root cause:

- Published server-backed events are no longer guaranteed to exist in `liveEventStore`, but lifecycle UI still treats local mutation as real persistence.

User impact:

- The app can tell a user that sales ended or an event was cancelled when the real database was not changed.

### P1 - Database repair is local-only

Evidence:

Remote migration list:

```text
20260515000003 | 20260515000003 | 2026-05-15 00:00:03
20260515000004 |                | 2026-05-15 00:00:04
```

Root cause:

- `supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql` exists locally but is not applied to the linked remote database.

User impact:

- Production cannot rely on the new RPC/database repair behavior until this is deployed.

## New P1 Finding - Event Management Subroutes Still Local-Only

### What Is Broken

The event detail screen now resolves server events, but the management routes opened from that screen still resolve events only from `liveEventStore`.

That means the event can be visible on `/event/{server_uuid}`, but its child routes can fail immediately.

### Evidence

The event detail page resolves server data:

- `mingla-business/app/event/[id]/index.tsx:105` calls `useBusinessEventById(id)`.
- `mingla-business/app/event/[id]/index.tsx:106` reads `businessEventQuery.data?.event`.
- `mingla-business/app/event/[id]/index.tsx:107` prefers the server event over the local event.

The same event detail page exposes visible action tiles:

- `mingla-business/app/event/[id]/index.tsx:194` routes to `/event/${id}/scanner`.
- `mingla-business/app/event/[id]/index.tsx:200` routes to `/event/${id}/scanners`.
- `mingla-business/app/event/[id]/index.tsx:206` routes to `/event/${id}/orders`.
- `mingla-business/app/event/[id]/index.tsx:212` routes to `/event/${id}/guests`.
- `mingla-business/app/event/[id]/index.tsx:225` routes to `/event/${id}/door`.
- `mingla-business/app/event/[id]/index.tsx:232` routes to `/event/${id}/reconciliation`.
- `mingla-business/app/event/[id]/index.tsx:577` renders those action tiles.

But the destination routes still read only local store event state:

- `mingla-business/app/event/[id]/orders/index.tsx:81` reads `useLiveEventStore`; `:129` returns the not-found shell.
- `mingla-business/app/event/[id]/guests/index.tsx:211` reads `useLiveEventStore`; `:351` returns the not-found shell.
- `mingla-business/app/event/[id]/scanner/index.tsx:150` reads `useLiveEventStore`; `:429` returns "Event not found".
- `mingla-business/app/event/[id]/scanners/index.tsx:122` reads `useLiveEventStore`; `:196` returns the not-found shell.
- `mingla-business/app/event/[id]/door/index.tsx:146` reads `useLiveEventStore`; `:295` returns the not-found shell.
- `mingla-business/app/event/[id]/reconciliation.tsx:95` reads `useLiveEventStore`; `:233` returns "Event not found".

### Six-Field Root Cause Proof

Symptom:

- User opens a newly published event, then taps management actions and sees "Event not found" or loses access to the feature.

Entry point:

- Published event detail route: `/event/{server_event_uuid}`.

Broken assumption:

- Child management routes assume every event ID can be found in `liveEventStore`.

Actual architecture after ORCH-0763:

- Newly published events are server-backed and identified by `events.id` from Supabase.
- Server events are intentionally not guaranteed to be mirrored into `liveEventStore`.

Causal chain:

1. User publishes an event.
2. The app routes to or opens `/event/{server_uuid}`.
3. Event detail resolves the event from Supabase.
4. The detail page shows Orders, Guests, Scanner, Scanners, Door, and Reconciliation actions.
5. Those actions route to child screens with the same server UUID.
6. Child screens look only in `liveEventStore`, do not find the server UUID, and return not-found states.

Proof boundary:

- This is proven from code paths. It does not require a live repro because the data source mismatch is explicit in the route implementations.

## Contract Addendum Required Before Implementation

The current implementor rework prompt should be amended before more code changes.

### Required Product Contract

For any visible action on a server-loaded published event detail page:

- The destination route must either resolve the same server event ID successfully, or
- The action must be hidden/disabled with honest copy explaining that the feature is not yet available for server-backed events.

Visible action tiles must not route a real published event into "Event not found."

### Required Engineering Contract

Implement one shared event resolver for event management routes, or equivalent route-local behavior:

- Try local `liveEventStore` first for legacy/offline `le_...` events.
- Try `useBusinessEventById(eventId)` for server UUID events.
- Use the server event as canonical when found.
- Use `BusinessEventDetail.brand` for brand and permission gates when server-backed.
- Keep `events.id` as the canonical event ID for local child stores going forward.
- Preserve legacy `le_...` compatibility only as a redirect/recovery path.

Routes that must be covered:

- `/event/[id]/orders`
- `/event/[id]/orders/[orderId]`
- `/event/[id]/guests`
- `/event/[id]/guests/[guestId]`
- `/event/[id]/scanner`
- `/event/[id]/scanners`
- `/event/[id]/door`
- `/event/[id]/door/[saleId]`
- `/event/[id]/reconciliation`

### Required Test Contract

Add behavioral tests proving:

- A server-only event ID with an empty `liveEventStore` does not produce "Event not found" from any still-visible event detail action.
- If a management feature is intentionally unavailable for server events, its event detail tile/action is not visible or is disabled with honest copy.
- Brand/permission gates use server brand data when the event is server-backed.
- Legacy `le_...` routes still recover or redirect without breaking.
- Lifecycle actions cannot show success unless a server mutation succeeds or the action is explicitly unavailable.
- Autosave stale responses cannot overwrite newer local edits.

## Forensic Verdict

Do not proceed with the current rework prompt as-is.

The prompt correctly covers autosave races, lifecycle honesty, legacy route recovery, and shallow tests. It must also cover server-backed child route access from the event detail action grid. Without that addendum, the fix can still ship with a real user-facing regression: published events open, but core management screens break immediately after tapping visible buttons.
