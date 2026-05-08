# SPEC ORCH-0763 - Business Event System Regression Repair

Date: 2026-05-08  
Status: Ready for implementor  
Owner: implementor  
Scope: `mingla-business` event create/publish/read/edit contracts, Supabase RPC/view/RLS, tests, and runtime gates  
Non-scope: Giphy/Pexels search, brand/profile media expansion, cosmetic wizard redesign, paid checkout completion, destructive production data repair

## 1. Summary

ORCH-0763 is a P0 event-system integrity repair. The current business app can make an organiser believe an event is published while the durable server event either remains a draft or is not used as the organiser source of truth after local storage/new build loss.

The repair must make Supabase `public.events` plus canonical child rows the durable authority for both drafts and organiser published events. `liveEventStore` may remain only as a legacy compatibility cache. New publishes must use one server-side transaction/RPC that promotes the event and materializes tickets atomically, returns the durable event payload, and prevents local false-success.

This spec supersedes closing ORCH-0756B, ORCH-0758A, and ORCH-0759 as "event system ready" until this repair passes tester gates.

## 2. User Story

As a Mingla Business organiser, I can create a free event, type through the wizard without text being overwritten, publish it, restart the app or install a new build, and still see/manage that event from Home, Events, Event Detail, and Edit Published because the event exists on the server.

## 3. Current Proven Behavior

Accepted findings from `INVESTIGATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md`:

- Home hydrates server drafts but reads published events from local `useLiveEventsForBrand` at `mingla-business/app/(tabs)/home.tsx:131-133`.
- Events does the same at `mingla-business/app/(tabs)/events.tsx:114-116`.
- Event Detail resolves published events only from `liveEventStore` at `mingla-business/app/event/[id]/index.tsx:106-108`.
- Edit Published resolves only local live events at `mingla-business/app/event/[id]/edit.tsx:73-78`.
- `liveEventStore` declares itself persisted local storage for published events at `mingla-business/src/store/liveEventStore.ts:1-18`.
- Publish writes `ticket_types` and then updates `events` client-side without returned-row/row-count proof at `mingla-business/src/services/eventDrafts.ts:35-57` and `:160-191`.
- The wizard calls server publish, then still creates a local `LiveEvent` through `publishDraft` at `mingla-business/src/components/event/EventCreatorWizard.tsx:443-487`.
- `publishDraft` converts the draft into a local `LiveEvent` and deletes the draft at `mingla-business/src/store/draftEventStore.ts:660-674`.
- The converter creates a local `le_...` id, stores `serverEventId`, and marks server `scheduled` events as local `live` at `mingla-business/src/utils/liveEventConverter.ts:77-86`.
- Autosave/list hydration can overwrite dirty local text because `handleUpdate` autosaves every patch at `EventCreatorWizard.tsx:310-320`, autosave success always `upsertDraft`s at `useServerDraftEvents.ts:160-168`, and server list/detail hydration always overwrites at `useServerDraftEvents.ts:57-61` and `:139-143`.
- Public buyer reads are more server-backed, but `publicEventsService.ts:130-135` collapses unknown statuses, including `scheduled`, into local `"live"`.

Latest local migration authority:

- Current max local migration is `supabase/migrations/20260515000003_orch_0759_public_event_contract.sql`.
- ORCH-0759 created `public.business_public_events_view`, filtering public events to `status IN ('scheduled', 'live')`.
- ORCH-0756B documented canonical event statuses as `draft`, `scheduled`, `live`, `ended`, `cancelled`.
- Baseline RLS allows event-manager-plus users to manage `events`, but direct `ticket_types` insert/update/delete policies require finance-manager-plus. The publish path must therefore centralize permission handling instead of relying on scattered client table writes.

## 4. Target Behavior

After repair:

- A published event is visible to authorised brand team members from server reads even with an empty `liveEventStore`.
- Publish cannot create a local-only published event. If server promotion fails, the draft remains a draft and the user sees an honest failure.
- Free-only events publish without Stripe and create public free ticket rows.
- Wizard typing remains local-first and stable while autosave runs in the background.
- Edit Published accepts a server `events.id`, hydrates from Supabase, and does not spin forever or redirect because local cache is empty.
- Public buyer pages still resolve public events by brand/event slug and see the same tickets and cover media produced by publish.

## 5. Source-Of-Truth Contract

Durable event truth:

- Drafts: `public.events.status = 'draft'`, `visibility = 'draft'`, `theme.business_draft` contains wizard state.
- Published organiser events: `public.events.status IN ('scheduled', 'live', 'ended', 'cancelled')`, plus canonical `ticket_types` rows and public-safe event fields.
- Public buyer events: existing `business_public_events_view` or its successor, still excluding `theme.business_draft`.

Client truth:

- React Query owns server event read/write cache.
- Zustand `draftEventStore` is UI edit/cache state and legacy migration support.
- Zustand `liveEventStore` is no longer authoritative for organiser published events. It must not be the only source used by Home, Events, Event Detail, Edit Published, order, guest, scanner, door, or reconciliation routes.

New client type:

- Add a server-backed management event type, recommended `BusinessEvent` or `ManagedEvent`.
- `BusinessEvent.id` must be the server `events.id`.
- `BusinessEvent.status` must preserve DB lifecycle vocabulary: `scheduled`, `live`, `ended`, `cancelled`.
- UI buckets such as `upcoming`, `past`, and `draft` must be derived separately.

## 6. Atomic Publish Contract

Add one Supabase RPC:

`public.business_publish_event_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer default null)`

Return shape:

```json
{
  "event": {
    "id": "uuid",
    "brand_id": "uuid",
    "title": "string",
    "description": "string|null",
    "slug": "string",
    "status": "scheduled",
    "visibility": "public|hidden|private",
    "cover_media_url": "string|null",
    "cover_media_type": "image|video|gif|null",
    "timezone": "string",
    "theme": {},
    "published_at": "timestamp",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  },
  "brand": {
    "id": "uuid",
    "slug": "string",
    "name": "string"
  },
  "tickets": [
    {
      "id": "uuid",
      "event_id": "uuid",
      "name": "string",
      "price_cents": 0,
      "is_free": true,
      "quantity_total": "integer|null",
      "is_unlimited": "boolean",
      "display_order": "integer"
    }
  ],
  "client_revision": 12
}
```

RPC semantics:

- `SECURITY DEFINER`, with fixed `search_path = public`.
- Reject unauthenticated callers.
- `SELECT ... FOR UPDATE` the `events` row by `p_event_id`.
- Require `events.deleted_at IS NULL`.
- Require current `events.status = 'draft'`; if already scheduled/live, return a typed error such as `event_draft_not_publishable`.
- Require caller rank for the event brand to match the app create/edit contract: `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager')`.
- Validate `p_draft_payload` server-side for minimum publishability: non-empty title, valid visibility mapping, at least one ticket, ticket name non-empty, non-negative price, free ticket price exactly `0`, valid quantities, and no plaintext ticket password leakage into `theme.business_draft`.
- Write latest event fields from `p_draft_payload`.
- Remove `theme.business_draft` from the published row.
- Soft-delete existing active `ticket_types` for the event and insert replacement rows in the same transaction.
- Promote exactly one event row to `status = 'scheduled'`, `published_at = now()`, and mapped visibility.
- Use explicit row-count proof where possible; if any step cannot prove the expected row count, raise and roll back.
- Return the durable event, brand, and ticket rows from the same transaction.

The client must delete/disable `markServerDraftPublished` as a client multi-table publish path. Client publish should call only this RPC, then hydrate React Query from the returned server payload.

## 7. Server Organiser Event Read Contract

Create a server-backed organiser read model for brand management events. Preferred implementation:

- RPC or view: `public.business_management_events_view` with `security_invoker = true`, plus client ticket fetch using existing RLS; or
- RPCs: `public.business_get_brand_events(p_brand_id uuid)` and `public.business_get_event(p_event_id uuid)`.

Minimum returned data:

- `events.id`, `brand_id`, `created_by`, `title`, `description`, `slug`, `location_text`, `online_url`, `is_online`, `is_recurring`, `is_multi_date`, `recurrence_rules`, `cover_media_url`, `cover_media_type`, `visibility`, `show_on_discover`, `status`, `published_at`, `timezone`, `created_at`, `updated_at`, `theme - 'business_draft'`.
- Brand slug/name/profile photo needed by share URLs and cards.
- Active `ticket_types` ordered by `display_order`.

Access:

- Brand team members may read management events for their brand.
- Public/anon must not read private organiser-only event metadata from this management read model.
- Public buyer reads continue through the public view/path.

Client service:

- Add `mingla-business/src/services/businessEvents.ts` or equivalent.
- Add `businessEventKeys` for list/detail query keys. Do not overload `eventDraftKeys`.
- Add hooks such as `useBusinessEventsForBrand(brandId)` and `useBusinessEventById(eventId)`.

## 8. Local Store / Cache Transition Contract

`liveEventStore` transition:

- Stop using `liveEventStore` as the source for new organiser event lists and detail routes.
- Keep legacy local records only for compatibility with old `le_...` routes and local-only artifacts.
- Add a compatibility resolver:
  - If a route receives a local `le_...` id and that cached event has `serverEventId`, replace route with `/event/{serverEventId}`.
  - If a local `le_...` event has no server id, show a recovery/error state, not a fake success.
- New publish must never call `draftEventStore.publishDraft` or `convertDraftToLiveEvent`.
- `addLiveEvent` should become legacy-only or be removed from the publish flow. Add tests/guards so publish cannot reintroduce it.

Draft store transition:

- `upsertDraft` and `upsertDrafts` must not overwrite an active dirty editor with server/list responses.
- Add active edit metadata in the store or hook layer: active draft id, local edit revision, latest accepted server revision, dirty flag, and pending save state.

## 9. Wizard Autosave Contract

Replace immediate full-object autosave with local-first debounced autosave:

- `handleUpdate` updates local draft state immediately and increments a monotonically increasing local `clientRevision`.
- Autosave is debounced, recommended 600-800ms after the latest change.
- Autosave payload includes the complete current draft snapshot and `clientRevision`.
- Autosave success updates save status and query cache only if the response revision is not older than the currently accepted server revision.
- Older autosave responses must never overwrite newer typed text.
- Server list/detail hydration must not overwrite the currently active dirty draft. It may update non-active drafts.
- List invalidation must not fire after every autosave keystroke. Update query data directly for accepted responses; invalidate only on create/discard/publish/route exit or explicit refetch.
- The UI must show honest save states: saving, saved, retrying/error. No silent failure.
- The existing `setLastStep` idempotence guard is acceptable as a partial fix, but tester must add a real mount/effect regression test for the previous maximum-update-depth failure.

## 10. Route / ID / Slug Contract

Canonical ID decision:

- New published event routes use server `events.id`.
- Draft edit/preview routes already use server `events.id` for server-backed drafts.
- Local `le_...` IDs are legacy compatibility only.

Routes to update:

- `app/(tabs)/home.tsx`: list drafts from `useServerDraftsForBrand`, published events from `useBusinessEventsForBrand`.
- `app/(tabs)/events.tsx`: same. Lifecycle actions must call server mutations or be disabled with honest messaging until server mutation exists.
- `app/event/[id]/index.tsx`: attempt server published detail by id and server draft detail by id. If server draft exists, redirect to edit as today. If neither exists, show missing/inaccessible state.
- `app/event/[id]/edit.tsx?mode=edit-published`: hydrate `BusinessEvent` by server id and render edit screen.
- Share/public links use returned `brand.slug` and `event.slug`, not a locally generated event slug.

Adjacent flows:

- Orders, guest list, scanner, door sales, reconciliation, lifecycle, edit log, and notifications must accept server event ids for newly published events.
- If any of these flows remain local-only, the implementor must keep them coherent by using server event ids as their local foreign key and marking unavailable server actions honestly.

## 11. Free Ticket Publish Contract

Free-only events are the baseline acceptance path:

- A free ticket maps to `ticket_types.price_cents = 0`.
- `ticket_types.is_free = true`.
- No Stripe connection is required for free-only tickets.
- At least one active ticket type must exist after publish.
- Public buyer route must show the free ticket after publish.
- Publish tests must use free-only event first, because this is the user-reported regression.

## 12. Published Edit Contract

Edit Published must be server-hydrated:

- `EditPublishedScreen` should receive a `BusinessEvent`/management event object, not require a local `LiveEvent`.
- Existing cover media updates must use `event.id` as the server event id.
- Field edits must either:
  - call existing server update services if present and prove row update, or
  - be explicitly limited/disabled with honest copy until a later edit-published server mutation is specified.
- Never redirect or spin forever solely because local `liveEventStore` is empty.

## 13. Public Buyer Route Compatibility

Keep ORCH-0759 public route behavior:

- Public event route by `/e/{brandSlug}/{eventSlug}` must still read `business_public_events_view` or equivalent.
- Public checkout by event id must still read the server event and public ticket rows.
- `theme.business_draft` must not be exposed publicly.

Status fix:

- Stop mapping `scheduled` to durable local `"live"`.
- Introduce `PublicEventStatus`/`BusinessEventStatus` that includes `scheduled`.
- Derive display bucket separately where components need `live/upcoming/past`.

## 14. Supabase Schema / RLS / RPC Changes

Add migration:

`supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql`

This prefix is greater than current local max `20260515000003`. If remote linked migration head is higher at implementation time, choose a prefix greater than both local and remote head before writing the migration.

Migration contents:

- Create `business_publish_event_draft(...)` RPC.
- Grant execute to `authenticated`; revoke from `anon`.
- Add comments documenting that it is the only supported business draft publish path.
- Add management read view/RPC for organiser published events.
- Grant management read only through RLS-safe/authenticated paths.
- Preserve public view behavior for anon public events.

RLS/security requirements:

- Do not weaken public event select policies.
- Do not expose draft JSON publicly.
- Do not grant direct broad `ticket_types` mutation to less-privileged users unless it is scoped to draft publish and explicitly justified. Preferred path is RPC-mediated ticket replacement with event-manager-plus validation.
- Add tests or SQL checks proving viewer/scanner without event-manager permission cannot publish.

No edge function is required unless implementation discovers an existing architectural convention demanding one. If an edge function is added, the spec must be amended with exact function name and deploy command before implementation.

## 15. Client Changes

Implementor must update or add:

- `mingla-business/src/services/businessEvents.ts` for management event reads and publish RPC adapter.
- `mingla-business/src/hooks/useBusinessEvents.ts` or equivalent for React Query keys/hooks/mutations.
- `mingla-business/src/services/eventDrafts.ts` to remove client multi-table publish or leave only draft create/fetch/autosave/discard.
- `mingla-business/src/components/event/EventCreatorWizard.tsx` to use debounced revisioned autosave and server RPC publish result.
- `mingla-business/src/hooks/useServerDraftEvents.ts` to prevent stale server responses/list hydration overwrites.
- `mingla-business/src/store/draftEventStore.ts` to add dirty/revision-safe merge or expose safe merge helpers.
- `mingla-business/src/store/liveEventStore.ts` and `liveEventConverter.ts` to remove new publish dependency.
- `mingla-business/app/(tabs)/home.tsx`, `app/(tabs)/events.tsx`, `app/event/[id]/index.tsx`, `app/event/[id]/edit.tsx`.
- `mingla-business/src/components/event/EditPublishedScreen.tsx` to accept server-backed event shape or a compatibility adapter.
- `mingla-business/src/services/publicEventsService.ts` status mapping.

Do not implement Giphy/Pexels provider search in this slice.

## 16. Data Recovery Probe

Before destructive runtime testing, run an authenticated/admin recovery probe for the user's missing event. This is investigation only; do not mutate production data from Codex.

```sql
select id, brand_id, created_by, title, slug, visibility, status, published_at, deleted_at, created_at, updated_at
from public.events
where created_by = '<user_id>'
order by updated_at desc;

select e.id, e.title, e.status, e.visibility, tt.*
from public.events e
left join public.ticket_types tt on tt.event_id = e.id
where e.created_by = '<user_id>'
order by e.updated_at desc, tt.display_order asc;

select *
from public.audit_log
where user_id = '<user_id>'
  and created_at >= now() - interval '14 days'
order by created_at desc;
```

Interpretation:

- If the event exists as draft, it may be recoverable by manual/support-guided promotion after verifying ticket data.
- If it exists as scheduled/live, organiser hydration is the active failure.
- If it exists only in old local storage, it is not server-recoverable unless the device still has the pre-build persisted Zustand state.

## 17. Implementation Order

Minimum safe order:

1. Add Supabase migration with publish RPC and management read model.
2. Add service mappers and React Query hooks for management events.
3. Replace publish flow so successful publish is driven only by RPC return payload.
4. Convert Home/Events/Event Detail/Edit Published to server management reads.
5. Transition `liveEventStore` to compatibility-only for published organiser events.
6. Harden wizard autosave with debounce/revision/stale-response protections.
7. Fix public status mapping to preserve `scheduled`.
8. Add automated tests and run focused gates.
9. Run runtime smoke on a dev client/native build.

This should be one implementation milestone with small commits/slices, not a broad product expansion. Splitting off autosave after server publish/read is acceptable only if publish false-success and server rehydration land first; Giphy/Pexels remains blocked either way.

## 18. Test Matrix

Automated tests must fail against the current architecture:

- Publish failure: mock RPC failure/zero-row promotion and prove no local `LiveEvent` is created, draft remains, and user sees failure.
- Publish success: free-only draft RPC returns durable server event and ticket rows; client routes use returned server `events.id`.
- Home rehydrate: with empty `liveEventStore`, server management list shows a published event.
- Events rehydrate: with empty `liveEventStore`, server management list shows the same event and correct bucket.
- Detail rehydrate: `/event/{serverEventId}` opens with empty `liveEventStore`.
- Edit Published rehydrate: `/event/{serverEventId}/edit?mode=edit-published` opens with empty `liveEventStore`.
- Autosave race: out-of-order save responses cannot overwrite newer typed text.
- Hydration race: list/detail server responses cannot overwrite a dirty active editor.
- Free ticket mapping: `price_cents = 0`, `is_free = true`, public ticket visible after publish.
- Status mapping: `scheduled` remains durable status; display helpers derive upcoming/live/past.
- Permission: non-brand user and insufficient role cannot publish; event-manager-plus can publish according to app permission contract.

Run expected commands, adjusted to repo scripts:

- Existing focused event draft/media tests: `npm run test:orch-0756b`, `npm run test:orch-0758a`.
- New ORCH-0763 focused Jest suite/script, recommended `npm run test:orch-0763`.
- Supabase SQL/RPC tests or Deno gate if the repo has an established Supabase test harness. If no harness exists, add at least static SQL tests plus manual SQL verification steps for tester.

Static grep-only tests are not sufficient for the core publish/rehydration/autosave behaviors.

## 19. Runtime Smoke Matrix

Tester must run this after `supabase db push` and a build/dev client containing required native modules:

1. Sign in as a brand user with create-event permission.
2. Create a fresh free-only event.
3. Type across wizard fields while autosave is active; confirm typed text does not jump, erase, or flicker.
4. Add one free ticket.
5. Publish.
6. Confirm Home and Events show the published event.
7. Open Event Detail.
8. Open Edit Published.
9. Open public route `/e/{brandSlug}/{eventSlug}` and verify the free ticket appears.
10. Clear local app storage or simulate new build/local store loss.
11. Restart/sign in.
12. Confirm Home, Events, Detail, and Edit Published still load the event from server.
13. Confirm the old draft no longer appears in drafts.
14. Smoke image/video/gif cover rendering only if the dev client includes `expo-video`; animated media expansion remains blocked until native proof passes.

## 20. Rollback Plan

If client deploy must be rolled back:

- Leaving the RPC/view migration in place is safe if it only adds functions/views and does not weaken policies.
- Old clients may still use the broken client publish path; release should be held until repaired client is deployed.
- If RPC has a bug, revoke execute from `authenticated` and restore after patch:

```sql
revoke execute on function public.business_publish_event_draft(uuid, jsonb, integer) from authenticated;
```

Do not roll back by deleting event rows or ticket rows created during successful tests unless an operator explicitly authorizes test-data cleanup.

## 21. Launch / Residual Risk

Launch remains blocked until:

- Atomic publish RPC passes tests.
- Organiser server rehydration passes after local store loss.
- Wizard typing/autosave race tests pass.
- Free-only runtime smoke passes.
- Native media smoke passes before resuming animated cover/provider work.

Residual risks after this spec:

- Paid checkout/payment finalization remains outside this repair.
- Full post-publish edit mutation coverage may require a follow-up spec if existing edit flows are still local-only beyond cover media.
- Recovery of the user's already-missing event depends on whether durable server rows or old local storage still exist.

## 22. Handoff To Implementor

Implement exactly the ORCH-0763 repair described here. Do not add Giphy, Pexels, brand media expansion, profile media expansion, or broader redesign work.

Start with migration:

`supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql`

If the linked remote Supabase project has a newer migration head than local `20260515000003`, choose a higher monotonic prefix and note it in the implementation report.

Required implementor prompt title:

`IMPLEMENTOR_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR`

Spec Verdict: READY FOR IMPLEMENTATION
