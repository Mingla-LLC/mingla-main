# ORCH-0763 Business Event System Regression Audit

Date: 2026-05-08  
Mode: Forensics  
Verdict: FAIL - do not continue media/Giphy/Pexels expansion until the event source-of-truth and publish path are fixed.

## Executive Finding

The user's report is credible and the system has regressed at the event contract level, not just in one screen.

Mingla Business now partially persists drafts to Supabase, but published organiser events are still primarily local `liveEventStore` records. A publish can therefore appear successful in the app, create a local live event, and then disappear after a new build, logout, storage reset, or app reinstall because Home, Events, Event Detail, Edit Published, orders, scanner, guests, and lifecycle actions still depend on local published-event state.

The current server evidence I could inspect from the existing 2026-05-08 dump shows one relevant `public.events` row and it is still `status = draft`, `visibility = draft`, title `Untitled draft`, no `published_at`, and no `ticket_types` rows. That does not prove the user's event never existed locally; it proves the durable server currently does not contain the published/free event that the app told the user they had.

## Evidence Read

- Dispatch: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md`
- Historical root cause: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0756_BUSINESS_DRAFT_AND_BRAND_PERSISTENCE.md`
- Server-draft spec: `Mingla_Artifacts/specs/SPEC_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Server-draft retest: `Mingla_Artifacts/reports/RETEST_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Rich media investigation/retests: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0758_RICH_MEDIA_COVERS_AND_PICKERS.md`, `RETEST_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md`, `RUNTIME_ORCH-0758A_EVENT_COVER_MEDIA_NATIVE_QA.md`
- Public domain/server public route investigation/retest: `INVESTIGATION_ORCH-0759...`, `RETEST_ORCH-0759...`
- Current code across create/edit/publish/Home/Events/public routes/server draft services/live stores.
- Existing data dump at `/tmp/mingla_public_dump.sql` lines 150594-150610.

## Confirmed Findings

### F1 - Published organiser events are still local-only for the main app shell

Severity: P0 data-visibility regression.

Evidence:
- `mingla-business/app/(tabs)/home.tsx:131-133` hydrates server drafts, then reads published events from `useLiveEventsForBrand`.
- `mingla-business/app/(tabs)/events.tsx:114-116` does the same.
- `mingla-business/src/store/liveEventStore.ts:1-18` still declares published events as persisted Zustand/local transitional state.
- `mingla-business/src/store/liveEventStore.ts:304-320` stores and filters published events only from local `events`.
- `mingla-business/app/event/[id]/index.tsx:106-108` resolves event detail only from local `liveEventStore`.
- `mingla-business/app/event/[id]/edit.tsx:73-78` resolves `?mode=edit-published` only from local `liveEventStore`.

Impact:
If a user publishes, then the local persisted store is cleared or incompatible after a new build, the organiser-facing event disappears even if the user previously saw it as live. This directly matches the user report.

Root cause:
ORCH-0756B moved draft persistence server-side, but there is no equivalent organiser server query for scheduled/live events. Public buyer routes are server-backed; organiser management routes are not.

Required fix:
Create a server-backed organiser events source for non-draft events and replace Home, Events, Event Detail, Edit Published, orders, scanner, guests, door, reconciliation, and lifecycle actions that currently require local `LiveEvent.id`. Local Zustand can be a cache only, never the authority.

### F2 - Publish is not atomic and can report success without durable publication

Severity: P0 data-integrity / false-success risk.

Evidence:
- `mingla-business/src/services/eventDrafts.ts:35-59` soft-deletes and inserts `ticket_types` before event promotion.
- `mingla-business/src/services/eventDrafts.ts:169-189` then updates `events` to `status: "scheduled"`.
- The final event update is not `.select()`ed, does not request row count, and does not verify that exactly one row changed.
- `mingla-business/src/components/event/EventCreatorWizard.tsx:459-464` calls server promotion before local `publishDraft`.
- `mingla-business/src/store/draftEventStore.ts:657-671` then converts the local draft into a local `LiveEvent` and deletes the local draft.

Impact:
The app can create a local published event even when durable server publication is incomplete or unverifiable. If the final event update affects zero rows because of stale status, RLS, deleted row, or a concurrent state change, Supabase/PostgREST-style updates can complete without a selected row proving success. The next build then has no local event and no server published event to rehydrate.

Root cause:
The original ORCH-0756B spec warned against partial client-side multi-table writes. The implementation still performs multi-table publish on the client without an atomic RPC or row-count proof.

Required fix:
Replace client publish with a single Supabase RPC/transaction such as `business_publish_event_draft(draft_id, payload)` that:
- Locks the event row.
- Verifies caller role/RLS-equivalent membership.
- Verifies current status is `draft`.
- Replaces ticket types safely.
- Promotes event to `scheduled`/public visibility.
- Removes `theme.business_draft`.
- Returns the published event row plus ticket rows.
- Fails loudly if one row was not promoted.

### F3 - Current remote-shaped evidence does not contain the user's published event

Severity: P0 recovery concern.

Evidence:
- `/tmp/mingla_public_dump.sql:150594-150602` contains the visible brand rows.
- `/tmp/mingla_public_dump.sql:150609-150610` contains one visible event row:
  - id `ecb4839f-1448-47e2-ba27-094fff6a9a61`
  - brand `22a18413-bfbf-4087-9ba7-45f70deba0f3`
  - title `Untitled draft`
  - slug `draft-nlhj`
  - `visibility = draft`
  - `status = draft`
  - `published_at = NULL`
  - `theme.business_draft.tickets = []`
- Search found zero `INSERT INTO "public"."ticket_types"` rows in the dump.

Impact:
The event the user remembers as published is not currently recoverable as a durable published server event from the evidence available here. The likely explanation is false local publication or local-only publication, not a hidden public scheduled event.

Required fix:
Before implementing any new media feature, run a production data recovery check with authenticated/admin read access:
- Query all `events` for the user's account/brands, including deleted rows.
- Query `audit_log` around the publish time.
- Query `ticket_types` for any orphan rows for draft event ids.
- Query storage objects for event covers uploaded around that time.

### F4 - Wizard typing instability is architecturally explained by autosave races

Severity: P0/P1 UX/data-loss risk.

Evidence:
- `mingla-business/src/components/event/EventCreatorWizard.tsx:310-320` calls local `updateDraft` and immediate `onAutosaveDraft` on every patch/keystroke.
- `mingla-business/src/hooks/useServerDraftEvents.ts:148-169` autosave success always `upsertDraft(draft)`.
- `mingla-business/src/hooks/useServerDraftEvents.ts:116-127` server list queries also always `upsertDrafts(query.data)`.
- `mingla-business/src/store/draftEventStore.ts:590-613` `upsertDraft`/`upsertDrafts` overwrite local draft objects without dirty-version, updatedAt, in-flight mutation id, or field-level merge protection.

Impact:
Typing can glitch because older autosave responses and list refetches can overwrite newer local text. Every keystroke also creates network pressure and React/Zustand churn. This matches "can't type, keeps glitching, buggy."

Root cause:
Autosave is immediate, full-object, and last-response-wins. The code does not separate local draft editing state from remote save acknowledgment.

Required fix:
Use a local edit buffer plus debounced autosave queue. Each save needs a monotonically increasing client revision. Server responses must only update save status/server timestamps unless their revision is newer than the local dirty revision. List/detail hydration must not overwrite a dirty open editor.

### F5 - The maximum update depth crash was a symptom of unstable editor effects

Severity: P1, currently partially fixed in worktree.

Evidence:
- User runtime log pointed to `draftEventStore.ts:643 setLastStep` called from `EventCreatorWizard.tsx:268`.
- Current `EventCreatorWizard.tsx:267-286` now includes a sync key/idempotence guard before `setLastStep`.
- Current tests still do not mount the wizard or reproduce the loop; `serverDraftLifecycleGuards.test.ts` is source-inspection only.

Impact:
The exact reported infinite loop appears patched in this worktree, but the wizard remains vulnerable because autosave/list hydration can still mutate the same draft object during render/effect cycles.

Required fix:
Add real component/hook tests for opening an existing server draft with `lastStepReached`, typing in step 1, autosave success resolving out of order, and ensuring no repeated `setLastStep`/update loop.

### F6 - Edit-published cannot survive local store loss

Severity: P1.

Evidence:
- `mingla-business/app/event/[id]/edit.tsx:60-78` checks `mode=edit-published` and loads only local live event by id.
- `mingla-business/app/event/[id]/edit.tsx:219-245` shows a loading shell briefly, then redirects to Events when local `liveEvent` is null.
- `EditPublishedScreen` server media updates require `liveEvent.serverEventId`, but the screen cannot load from server if only the server event id exists.

Impact:
A real server-published event still cannot be edited after local store loss unless the local `LiveEvent` cache exists.

Required fix:
Edit-published route must accept server event id and hydrate a management event detail from Supabase. It should never redirect solely because local Zustand is empty.

### F7 - Free ticket mapping is not the primary failure

Severity: Not root cause.

Evidence:
- `mingla-business/src/utils/draftEventValidation.ts:64-75` correctly bypasses Stripe for free-only events.
- `mingla-business/src/utils/draftEventValidation.ts:379-450` requires at least one valid ticket.
- `mingla-business/src/services/ticketTypeMapper.ts:3-20` maps free tickets to `price_cents: 0`, `is_free: true`.

Impact:
Free events should be publishable without Stripe. The missing free event is better explained by publish/source-of-truth failure, not by an intentional free-ticket gate.

Required fix:
The new publish RPC and tests must include a free-only event as the baseline acceptance path.

### F8 - Public buyer routes are more server-backed than organiser routes, but status mapping is lossy

Severity: P2 once P0s are fixed.

Evidence:
- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` uses `usePublicEventBySlug`.
- `mingla-business/app/b/[brandSlug]/index.tsx` uses `usePublicBrandBySlug`.
- `mingla-business/app/checkout/[eventId]/index.tsx` uses `usePublicEventById`.
- `mingla-business/src/services/publicEventsService.ts:130-135` maps any status except `cancelled`, `ended`, or `live` to local `"live"`, so server `scheduled` becomes local `live`.

Impact:
Buyer public pages are no longer purely local, which is good. But status vocabulary is being collapsed, so public/local code can treat scheduled events as live.

Required fix:
Unify status vocabulary or add explicit UI buckets separate from durable lifecycle state.

### F9 - Native media dependency remains a runtime gate

Severity: P1 for animated cover rollout, not proven root of disappeared event.

Evidence:
- `mingla-business/src/components/ui/EventCoverMedia.tsx:11` imports `expo-video`.
- `mingla-business/package.json:51` includes `expo-video`.
- `mingla-business/app.config.ts:59` includes the `expo-video` plugin.
- Previous `RUNTIME_ORCH-0758A_EVENT_COVER_MEDIA_NATIVE_QA.md` still marked native authenticated runtime proof blocked.

Impact:
Animated covers should not be treated as shippable until the dev client/native build used by the tester includes the native module and can prove image/video/gif render paths. This is adjacent to the regression because Home/Event Detail import `EventCoverMedia`.

Required fix:
Native dev-client rebuild and authenticated runtime smoke must be mandatory before expanding to Giphy/Pexels.

## Test Results

Ran:
- `npm run test:orch-0756b`
- `npm run test:orch-0758a`

Result:
- PASS: 2 suites / 18 tests for ORCH-0756B.
- PASS: 6 suites / 29 tests for ORCH-0758A.
- Watchman emitted a recrawl warning.

Interpretation:
Passing tests do not clear the regression. The existing tests are mostly mapper/static guard tests and do not cover the failing runtime contract: publish, clear local state/new build, rehydrate organiser published event from server.

## Required Implementation Contract

Do not implement Giphy/Pexels or broader media expansion until these are done:

1. Server-backed organiser published events
   - Add service/hook for brand management events from Supabase.
   - Include event rows, ticket types, cover media, slugs, lifecycle state, schedule, and brand identity.
   - Replace organiser reliance on `liveEventStore` as authority.

2. Atomic publish RPC
   - One server transaction for ticket replacement plus event promotion.
   - Return published row/tickets.
   - Error if zero or multiple event rows are promoted.
   - Client should create/update local cache only from returned server payload.

3. Wizard autosave hardening
   - Debounce keystroke autosave.
   - Add client revision/in-flight id.
   - Prevent stale server/list responses from overwriting dirty editor state.
   - Never invalidate/refetch list in a way that mutates the active editor while typing.

4. Edit-published server hydration
   - Edit route must load server event by id.
   - No redirect just because local `liveEventStore` is empty.

5. Runtime regression suite
   - Free-only event: create, type, ticket, publish, verify public page, kill/restart or clear local storage, verify Home/Events/Event Detail/Edit Published.
   - Autosave race: simulate out-of-order saves and prove latest typing survives.
   - Publish failure: force RPC/update failure and prove no local false-published event is created.
   - Native cover smoke: image/video/gif on iOS dev client.

## Recovery Recommendation

Run an authenticated/admin recovery probe before any destructive testing:

```sql
select id, brand_id, title, slug, visibility, status, published_at, deleted_at, created_at, updated_at
from public.events
where created_by = '<user_id>'
order by updated_at desc;

select tt.*
from public.ticket_types tt
join public.events e on e.id = tt.event_id
where e.created_by = '<user_id>'
order by tt.created_at desc;

select *
from public.audit_log
where user_id = '<user_id>'
  and created_at >= now() - interval '7 days'
order by created_at desc;
```

Expected outcome for the user's missing free event:
- If the event exists as `draft`, it can likely be repaired/promoted after verifying ticket data.
- If it exists as `scheduled/live`, the organiser app is failing to hydrate it.
- If it exists only in local `liveEventStore`, it is not recoverable from server unless device storage still has the old persisted Zustand state.

## Bottom Line

This is not ready for more feature surface. The event system currently has split authority: server drafts, server public buyer reads, but local organiser published events. That split is the regression engine. Fix the publish transaction and organiser server hydration first, then retest free-event publish from a clean build before touching richer media search integrations.
