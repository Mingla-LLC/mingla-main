# SPEC ORCH-0756B - Business Server-Backed Event Drafts

Status: Ready for implementor
Owner: implementor
Scope: `mingla-business` event draft persistence, Supabase draft source of truth, migration/RLS only where needed
Non-scope: Mobile app guest/session persistence, full buyer checkout, full live-event/order durability program

## Problem

Business event drafts still disappear after sign-out because the current draft system is device-local only.

Evidence:
- `mingla-business/src/store/draftEventStore.ts` explicitly says the store is transitional local-only storage. It persists `drafts` to AsyncStorage under `mingla-business.draftEvent.v1`.
- `signOut`/store clearing wipes that local store, so the draft is not secretly deleted from Supabase; it was never saved there.
- App deletion also removes AsyncStorage, so drafts cannot survive reinstall.
- `mingla-business/app/event/create.tsx`, `app/event/[id]/edit.tsx`, `app/event/[id]/preview.tsx`, and `src/components/event/EventCreatorWizard.tsx` all read/write drafts through the local Zustand store.
- Supabase already has an `events.status = 'draft'` state, but the business draft wizard is not using it.

The fix must make Supabase the durable source of truth for business event drafts. Zustand may remain as a UI cache, but it must not be the only place the draft exists.

## Required Outcome

1. Creating a draft creates a server draft row immediately.
2. Editing a draft autosaves to Supabase.
3. Signing out, signing back in, refreshing, changing browser/device, or deleting/reinstalling the app still recovers the draft after login.
4. Existing local drafts from before this fix are migrated once into server drafts instead of being discarded.
5. A draft page must not redirect home just because server hydration is still loading.
6. Draft ticket/password handling must not store plaintext passwords in Supabase JSON.
7. Publishing or discarding a draft must cleanly resolve the server draft so it does not reappear later.

## Source Of Truth

Use Supabase `events` as the durable draft envelope:

- `events.id` is the draft id for all new drafts.
- `events.status = 'draft'` while the draft is unpublished.
- `events.visibility = 'draft'` while unpublished.
- `events.brand_id` scopes the draft to the selected brand.
- `events.created_by` is the signed-in business user.
- `events.slug` must be generated at create time and treated as immutable.
- `events.title` must be non-empty, using `Untitled draft` until the user enters a title.
- `events.theme.business_draft` stores versioned draft-only state that does not yet fit canonical columns.

Zustand should become cache and pending-edit state only:

- It may keep the currently opened draft for fast UI updates.
- It may keep unsynced pending patches while the network is unavailable.
- It must not be the only durable record.
- Logging out can clear the local cache because the server copy will hydrate after login.

## Schema And Migration

Existing schema is enough for the durable draft envelope, because `events.theme jsonb` can carry draft metadata. A migration is still required for the publish/delete contract and RLS hardening.

Before adding a migration, re-check the latest local migration. At forensic time, the latest observed migration is:

`20260515000000_orch_0757_place_intel_retry_lineage.sql`

Use a higher prefix, for example:

`supabase/migrations/20260515000001_orch_0756b_event_draft_persistence.sql`

Migration requirements:

1. Add comments documenting the supported `events.theme.business_draft` JSON contract.
2. Add or update RLS/policies/functions so an authorized brand event creator can save, discard, and publish their own draft.
3. Provide an atomic publish path if the implementation promotes drafts to canonical `event_dates` and `ticket_types`.
4. Do not weaken public select policies or expose private draft data to non-team users.

Important RLS finding:

- Existing event and event date policies allow event-manager-style access.
- Existing `ticket_types` mutation policies are finance-manager rank or above.
- The current business wizard allows event creators to configure tickets. If the server publish path materializes tickets into `ticket_types`, implement one of these:
  - Preferred: a security-definer RPC such as `biz_publish_event_draft(...)` that validates brand role, validates payload, hashes ticket passwords, writes dates/tickets atomically, and promotes the event.
  - Acceptable: additional draft-scoped `ticket_types` policies allowing event-manager-plus users to mutate ticket rows only for draft events in brands they manage.

Do not rely on partial client-side multi-table writes for publish. A local publish success with a server failure would recreate the same class of data-loss bug in another form.

## Field Mapping

Map local `DraftEvent` to server as follows.

Core event:

- `id` -> `events.id` for new server drafts. Legacy local ids like `d_...` go to `theme.business_draft.legacyLocalDraftId`.
- `brandId` -> `events.brand_id`
- `name` -> `events.title`, fallback `Untitled draft`
- `description` -> `events.description`
- `format` -> `events.is_online` plus `theme.business_draft.format`
- `category` -> `theme.business_draft.category`
- `timezone` -> `events.timezone`, fallback `UTC`
- `visibility` -> `theme.business_draft.requestedVisibility` while draft. On publish map:
  - `public` -> `events.visibility = 'public'`
  - `unlisted` -> `events.visibility = 'hidden'`
  - `private` -> `events.visibility = 'private'`
- `coverHue` -> `events.theme.coverHue` or `events.theme.business_draft.coverHue`

When/date:

- `whenMode` -> `events.is_recurring`, `events.is_multi_date`, and `theme.business_draft.whenMode`
- `date`, `doorsOpen`, `endsAt` -> canonical `event_dates` only when complete and valid; always preserve raw draft values in `theme.business_draft.when`
- `recurrenceRule` -> `events.recurrence_rules` and `theme.business_draft.recurrenceRule`
- `multiDates` -> canonical `event_dates` only when valid; always preserve raw draft values and overrides in `theme.business_draft.multiDates`

Location:

- `venueName` and `address` -> `events.location_text` when usable; preserve separated values in `theme.business_draft.location`
- `onlineUrl` -> `events.online_url`
- `hideAddressUntilTicket` -> `theme.business_draft.hideAddressUntilTicket`

Settings:

- `requireApproval`, `allowTransfers`, `hideRemainingCount`, `passwordProtected`, `privateGuestList`, `inPersonPaymentsEnabled` -> `theme.business_draft.settings`
- These may later map to canonical event/ticket settings, but draft survival must not depend on that future work.

Wizard metadata:

- `lastStepReached` -> `theme.business_draft.lastStepReached`
- `createdAt` -> `events.created_at`
- `updatedAt` -> `events.updated_at`
- Local UI status `publishing` is client-only pending state, not a durable DB status.

Tickets:

- Preserve draft ticket shape in `theme.business_draft.tickets`, except never store plaintext `password`.
- Persist non-sensitive fields: name, description, price, capacity, visibility, approval, transfer, waitlist, quantities, sale windows, display order, availability.
- If `passwordProtected` is true, store only a durable server indication that a password exists and the server-side hash needed for publish/access checks.
- On hydration, the UI must support a ticket state like `passwordConfigured: true` with `password` empty/null, and show that a password is set without revealing it.
- Existing validation must accept a recovered configured password without forcing the user to re-enter it unless they choose to change it.

## Client Architecture

Add a small server draft layer instead of spreading Supabase calls through the wizard.

Recommended files:

- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- Tests beside those modules using the repo's existing test style.

Service responsibilities:

- `createServerDraft(brandId)` inserts an `events` row with status/visibility `draft`, generated immutable slug, fallback title, creator id, timezone, and initial `theme.business_draft`.
- `fetchDraftsForBrand(brandId)` loads accessible draft events for a brand.
- `fetchDraftById(eventId)` loads one draft and verifies brand/team access through RLS.
- `autosaveDraft(eventId, patch)` merges draft fields into server columns/JSON.
- `discardDraft(eventId)` soft-deletes the server draft or marks it deleted according to existing delete conventions.
- `publishDraft(eventId, payload)` promotes the server draft only after validation and successful canonical writes.

Mapper responsibilities:

- Convert current `DraftEvent` to the server write payload.
- Convert server rows back to `DraftEvent`.
- Preserve unknown `theme` keys outside `business_draft`.
- Normalize DB lifecycle vocabulary:
  - DB status: `draft`, `scheduled`, `live`, `ended`, `cancelled`
  - UI lifecycle labels such as `upcoming` and `past` are derived client-side and must not be queried as DB statuses.

Store refactor:

- Keep `draftEventStore` as a UI cache.
- Remove or reduce persisted `drafts` as the authoritative source.
- If local persistence remains, persist only safe pending autosave metadata and legacy migration state.
- Do not clear a server draft on sign-out.

## Route Behavior

`app/event/create.tsx`:

- If no active brand, redirect as today.
- If active brand exists, create the server draft first.
- Navigate to `/event/{serverEventId}/edit?step=0` only after the server draft exists.
- Show a loading/error state if creation is in progress or fails.

`app/event/[id]/edit.tsx`:

- Load draft from server/cache by id.
- While loading, show a loading state.
- If loading finishes and the server says the draft is missing/inaccessible, then redirect.
- Do not redirect during hydration.

`app/event/[id]/preview.tsx`:

- Same hydration rules as edit.
- Any preview override edits must autosave or be queued for autosave.

`EventCreatorWizard.tsx`:

- `handleUpdate` should update local UI immediately and schedule/server-save the patch.
- `setLastStep` must autosave `lastStepReached`.
- Discard must delete/soft-delete the server draft.
- Publish must not remove local/server draft state until server publish succeeds.
- If autosave fails, show a visible non-blocking save error and retry state. Do not silently pretend the draft is saved.

## Legacy Local Draft Migration

On authenticated business app startup, after brand/team state is available:

1. Read existing local drafts from `mingla-business.draftEvent.v1`.
2. For each local draft whose brand is still accessible, create a server draft using the current field mapping.
3. Store `legacyLocalDraftId` in `events.theme.business_draft`.
4. Replace the local cached id with the new server UUID.
5. If the current route points at a legacy `d_...` id, redirect/replace to the new server UUID route.
6. Mark the legacy draft as migrated so the app does not duplicate it on next launch.

If migration fails, keep the local copy and surface a retryable warning. Do not delete local legacy drafts until the server row is confirmed.

## Offline And Error Handling

- Online save success: show normal saved state and keep server/cache in sync.
- Temporary network failure: keep edits in local pending state, show unsaved/retrying status, retry with backoff.
- Sign-out with pending unsaved edits: warn if there are local-only pending changes. Already-synced server draft must survive sign-out.
- App deletion after successful server save: draft must rehydrate from Supabase after login.
- Conflict handling: last writer wins is acceptable for ORCH-0756B, but use server `updated_at` to avoid overwriting a newer server row with an older stale local snapshot during legacy migration.

## Security And Privacy

- Draft rows must only be visible to authorized brand team members.
- Public/buyer surfaces must not show `status='draft'` events.
- Plaintext ticket passwords must never be stored in `events.theme`, `ticket_types`, AsyncStorage durable persisted state, logs, or artifacts.
- RLS must be tested for:
  - Owner/authorized brand member can create/read/update/discard draft.
  - User from another brand cannot read or mutate draft.
  - Anonymous user cannot read draft.

## Tests Required

Add focused tests for:

- Mapper round trip from `DraftEvent` to server payload and back.
- Fallback title/slug behavior for blank drafts.
- `lastStepReached` persists to server payload.
- Date fields are preserved even when incomplete.
- Multi-date override fields survive round trip.
- Ticket fields survive round trip without plaintext password persistence.
- `passwordConfigured` or equivalent recovered-password state validates correctly.
- DB/UI status vocabulary mapping does not query `upcoming` or `past` as Supabase statuses.
- Edit route does not redirect while draft hydration is loading.
- Create route creates a server draft before navigation.
- Legacy local draft migration creates one server draft and does not duplicate on rerun.
- Sign-out clears local cache but rehydrates the server draft after sign-in.

Recommended verification commands:

```bash
cd mingla-business
npm test -- --runInBand serverDraftEventMapper
npm test -- --runInBand eventDrafts
npm test -- --runInBand draftEvent
npm run lint
npm run typecheck
```

Also run Supabase migration verification after adding the migration:

```bash
supabase db reset
supabase db push --dry-run
```

Use the repo's actual available scripts if names differ.

## Acceptance Criteria

PASS only when all are true:

1. User creates a draft, adds meaningful details, signs out, signs back in, and the draft is still present.
2. User creates a draft, closes the app/browser, reopens, and the draft is still present.
3. User deletes/reinstalls the app or clears local storage after a successful autosave, signs in, and the draft rehydrates from Supabase.
4. Existing pre-fix local drafts migrate to server without duplication.
5. Draft routes no longer kick the user home during server loading.
6. Autosave failures are visible and retryable.
7. Plaintext ticket passwords are not stored durably.
8. Public surfaces and unrelated users cannot see drafts.
9. Brand auto-selection from ORCH-0756A is not regressed.

## Explicit Non-Goals

- Do not solve all mobile app persistence gaps in this ticket.
- Do not redesign the event wizard UI except for required save/error states.
- Do not invent fake sample drafts or stub events.
- Do not change active brand recovery except as needed to consume the selected brand id.
- Do not expand this into full orders/payments/check-in durability.
