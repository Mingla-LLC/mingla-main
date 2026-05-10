# SPEC ORCH-0773 Draft Autosave Stale Local Draft Lifecycle

## Verdict

Implement a narrow lifecycle fix for Mingla Business server-backed event drafts: a local persisted draft for a server id must never keep autosaving after the server row is no longer an editable draft. Missing, deleted, non-draft, and no-longer-readable server rows must become a typed lifecycle state that retires the local draft path. Unknown Supabase, network, auth, and validation failures must remain visible failures.

This is not a Cloudinary/media-provider fix, not a public video audio fix, and not another currency-null fix.

## Evidence Base

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md`
- `Mingla_Artifacts/reports/REVIEW_INVESTIGATION_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md`
- `Mingla_Artifacts/reports/REVIEW_RUNTIME_ORCH-0770_OPERATOR_LOG_NATIVE_PLAYER_AND_AUTOSAVE_PGRST116.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0769B_DRAFT_AUTOSAVE_CURRENCY_NOT_NULL.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

Current code facts:

- `mingla-business/src/services/eventDrafts.ts:199-215` reads draft save context by `id` and `deleted_at` only, using `.single()`.
- `mingla-business/src/services/eventDrafts.ts:229-236` updates the same row only when `status = draft`, using `.single()`.
- `mingla-business/src/hooks/useServerDraftEvents.ts:159-184` logs all autosave mutation errors as `[useServerDraftAutosave] Operation failed:`.
- `mingla-business/app/event/[id]/edit.tsx:92-100` reads both local Zustand draft and server draft detail, but `edit.tsx:170-180` redirects only when the local draft is null.
- `mingla-business/app/event/[id]/edit.tsx:318` enables autosave for any non-`d_` id, even when `serverDraftQuery.data === null`.
- `mingla-business/src/components/event/EventCreatorWizard.tsx:235-245` queues delayed autosave; `EventCreatorWizard.tsx:538-543` clears a pending publish autosave and deletes the draft after publish success.

## Problem

The proven fixture id `98e880f3-43ef-47ab-a530-deaa117b21a7` exists locally as `status: "draft"`, while the server/public row for the same id is already `status: "scheduled"` and `visibility: "public"`.

Autosave currently follows this broken chain:

`published server row -> stale persisted local draft survives -> edit route renders local draft -> autosave reads context from the scheduled row -> update requires status=draft and updates zero rows -> .single() emits PGRST116 -> hook logs repeated red autosave failures`.

The same user-facing class can also happen when the server row is deleted, missing, or no longer readable because of permission/RLS changes. Those states are lifecycle terminal for draft editing, not ordinary retryable autosave failures.

## Scope

Change only the Mingla Business draft lifecycle surfaces required to stop stale server-backed drafts from autosaving and to preserve fresh draft autosave behavior.

Expected product files:

- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/app/event/[id]/preview.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/hooks/useBusinessEvents.ts`
- `mingla-business/app/(tabs)/events.tsx`

Expected tests:

- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts` or a new `eventDraftsLifecycle.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- Add route/hook/store tests if the current harness supports them; otherwise add the strongest static guard test plus the manual gate below.

Database/RLS: no migration expected. Only propose a migration if implementation proves the current `events` draft row lifecycle cannot be expressed from existing columns. If a migration becomes necessary, the filename prefix must be greater than the current max local and remote migration head, and the deploy split must be called out before implementation.

## Non-Goals

- Do not change Cloudinary, compression, transcode, webhook, Giphy, Pexels, or media provider behavior.
- Do not change public event video close/audio lifecycle; that remains ORCH-0771/ORCH-0772.
- Do not touch Stripe, checkout, admin, consumer app, ticketing payment behavior, or published-event edit capability.
- Do not silently recreate a new server draft from a stale published server id.
- Do not preserve a stale server-backed local draft as the source of truth over server lifecycle.
- Do not hide unknown Supabase/network/auth/write failures.

## Lifecycle Contract

Add a typed service-level lifecycle result or error in `eventDrafts.ts`.

Required shape, exact naming may vary:

```ts
export class ServerDraftLifecycleError extends Error {
  code: "draft_not_found" | "draft_not_editable" | "draft_not_readable";
  draftId: string;
}

export const isServerDraftLifecycleError = (
  error: unknown,
) => error is ServerDraftLifecycleError;
```

Equivalent discriminated-union return values are acceptable if the hook and callers are updated consistently. The important invariant is that callers can reliably distinguish terminal draft lifecycle from unknown failures.

Terminal lifecycle states:

- `draft_not_found`: no matching non-deleted draft row exists for the id.
- `draft_not_editable`: row exists but is no longer `status = draft`, including scheduled/published rows.
- `draft_not_readable`: the row cannot be read under the current actor, or the read resolves no draft row after auth/permission state changes.

Unknown failures remain errors:

- Supabase network failures.
- Auth API failures.
- Permission errors that come back as explicit Supabase errors rather than a draft-detail null.
- Validation, serialization, malformed response, or unexpected update failures.

The hook must not log terminal lifecycle as `[useServerDraftAutosave] Operation failed:`. It should retire local draft eligibility and optionally emit a lower-noise dev diagnostic such as `[useServerDraftAutosave] Draft retired: draft_not_editable`.

## Service Requirements

In `eventDrafts.ts`:

1. Align `fetchExistingDraftSaveContext` with the update semantics.
   - It must filter to `status = draft` and `deleted_at is null`, or the implementation must remove the separate context read and use one draft-only update/select path.
   - It must not use `.single()` for a query where zero rows is a known lifecycle outcome.
   - Use `.maybeSingle()` or equivalent typed handling so missing/non-draft/deleted/no-readable rows become `ServerDraftLifecycleError`, not raw `PGRST116`.

2. Keep currency fix behavior from ORCH-0769B.
   - If local currency is null and a real draft row exists, preserve existing server currency.
   - If local and server currency are missing, use brand default.
   - Do not reintroduce null writes to `events.currency`.

3. Handle zero-row updates deliberately.
   - The final update must not use `.single()` in a way that leaks raw `PGRST116` for zero rows.
   - If update/select returns no row, throw/return the typed lifecycle state.
   - If update returns a Supabase error other than known zero-row lifecycle, throw the original error.

4. Preserve happy path.
   - A fresh server draft whose row is `status = draft` still returns a mapped `DraftEvent`.
   - Cover media fields and normal fields still write through `draftToServerUpdate`.

## Hook, Store, And Cache Requirements

In `useServerDraftEvents.ts`:

1. `useServerDraftById` must continue to treat `fetchDraftById(id) -> null` as "server has no editable draft for this id."
2. `useServerDraftAutosave` must handle `ServerDraftLifecycleError` separately from unknown errors.
   - Delete or retire the local draft for the server id.
   - Remove `eventDraftKeys.detail(id)`.
   - Remove the id from `eventDraftKeys.list(brandId)` cache, or invalidate the list if removal is simpler.
   - Do not call `markDraftSaved`.
   - Do not set a fake "Saved" state for a retired draft.
   - Unknown errors still set `hasError` and log through the existing visible error path.
3. `useDiscardServerDraft` must treat server "not found"/already discarded/not editable as local cleanup success only when the error code/message is a known discard lifecycle terminal. Permission and unknown errors must stay visible.

In `draftEventStore.ts`:

1. Add a small explicit action if useful, e.g. `retireServerDraft(id: string): void`, or use `deleteDraft` directly from hooks/routes.
2. Retirement must remove the draft, active draft id, and edit metadata for that id.
3. Do not delete `d_` local-only drafts through server-detail null handling. Local-only drafts are still migrated or edited normally.

React Query/Zustand invariant:

Server lifecycle wins for server-backed ids. A persisted Zustand draft with a non-`d_` id must not override `fetchDraftById(id) -> null`.

## Route And User Experience Requirements

In `app/event/[id]/edit.tsx`:

1. Detect stale server-backed local drafts:
   - `draft !== null`
   - `!draft.id.startsWith("d_")`
   - server draft query has finished loading/fetching
   - `serverDraftQuery.data === null`
   - `serverDraftQuery.isError === false`
2. On that state, stop autosave eligibility immediately.
   - Pass `onAutosaveDraft={undefined}` for stale server-backed drafts.
   - Delete/retire the local draft id and remove related query cache.
   - Route honestly.
3. Preferred recovery:
   - If `useBusinessEventById(id)` resolves a published/scheduled event for the same id, redirect to `/event/${id}/edit?mode=edit-published` or to the public slug path if the published edit shell is not the desired destination.
   - If no published event is readable, route to `/(tabs)/events` with an honest toast such as `This draft is no longer editable.`
4. Do not keep rendering `EventCreatorWizard` for the stale local draft after server draft detail resolves null.
5. `serverSaveState.hasError` must not show "Unsaved changes - retrying" for terminal stale lifecycle.

In `app/event/[id]/preview.tsx`:

1. Apply the same server-backed stale guard.
2. Do not allow multi-date override autosave for a server-backed id whose server draft detail resolved null.
3. Retire local state and route back to edit-published/public/events according to the same recovery decision.

In `EventCreatorWizard.tsx`:

1. Keep the existing pending autosave clear on publish.
2. Also clear pending autosave when discard succeeds and when parent route retires/unmounts the wizard.
3. If the parent disables `onAutosaveDraft`, queued local edits must not fire a stale server save.
4. Preserve local-only draft behavior: `d_` drafts may update locally and migrate to a server draft as before.

In `app/(tabs)/events.tsx`:

1. Draft list hydration must not keep stale server-backed ids after the server draft list for the brand excludes them and the corresponding business event list includes the same id.
2. Delete draft action should clean local stale state if the server says the draft is already gone or no longer a draft, without showing repeated failure to the organiser.

## Publish And Discard Cleanup

Publish success:

- `EventCreatorWizard` already clears `autosaveTimerRef` before `onPublishDraft`; keep this.
- After `usePublishBusinessEventDraft` succeeds, remove the local draft from Zustand in the publish flow and remove `eventDraftKeys.detail(draft.id)`.
- Ensure the draft id is removed from draft list cache, not just invalidated.
- Ensure public/business event caches are written or invalidated as today.
- No autosave for the published id may fire after success.

Discard success:

- `useDiscardServerDraft` should delete local draft and remove detail query as today.
- If server discard returns a known terminal "already gone/not draft" condition, still delete local draft and clear query state.
- If discard returns permission/auth/unknown failure, preserve local draft and show the existing error UI.

Lifecycle retirement:

- A typed autosave lifecycle error or server draft detail null should delete/retire the stale local server-backed draft and remove query cache.
- It should not delete local-only `d_` drafts.
- It should not create a replacement draft.

## Success Criteria

1. Opening stale fixture id `98e880f3-43ef-47ab-a530-deaa117b21a7` no longer leaves `EventCreatorWizard` autosaving it as a draft.
2. No repeated `[useServerDraftAutosave]` raw `PGRST116` logs appear for missing/deleted/non-draft/no-readable draft rows.
3. The organiser sees an honest recovery path: published edit/public view/events tab, not a fake draft editor with "Saved" or endless "Unsaved changes - retrying."
4. Fresh server drafts still autosave title, description, step progress, and cover media.
5. Publish success removes the server id from persisted local drafts and draft autosave eligibility.
6. Discard success or known already-gone lifecycle removes the local stale draft.
7. Unknown Supabase/network/auth/write failures still surface through visible error state and logs.
8. ORCH-0769B currency fallback remains green; no autosave writes `events.currency = null`.

## Implementation Order

1. Add lifecycle type/guard in `eventDrafts.ts`.
2. Change service read/update to draft-only `.maybeSingle()` or equivalent typed zero-row handling.
3. Add service tests for lifecycle states before hook/route changes.
4. Update `useServerDraftAutosave` to retire known lifecycle and preserve unknown error visibility.
5. Add store action only if it makes route/hook behavior clearer; otherwise use `deleteDraft`.
6. Update edit and preview stale server-backed draft guards.
7. Tighten publish/discard cache removal and known terminal cleanup.
8. Add/update static guard tests and any route/hook tests available in the repo harness.
9. Run focused tests, then the manual tester gate.

## Required Automated Tests

Service tests:

- Non-draft update: mock an existing row or update result that matches zero draft rows. Assert `autosaveServerDraft` throws/returns typed lifecycle (`draft_not_editable` or equivalent), not raw `PGRST116`.
- Missing/deleted/no-readable context: context read returns null. Assert typed lifecycle and no brand-default/update call runs.
- Context/update alignment: assert context query and update query both target `status = draft` and `deleted_at is null`, or that a single update/select path makes this invariant explicit.
- Fresh draft regression: mock a real draft row and assert autosave returns a `DraftEvent`.
- Cover/media regression: existing `cover media autosave does not write null currency` must still pass.

Hook/store/route tests:

- `useServerDraftAutosave` terminal lifecycle deletes/retires local server-backed draft, removes detail cache, does not call `markDraftSaved`, and does not log through generic operation-failed path.
- Unknown autosave error still sets error state/logs visibly.
- Stale local server id plus `useServerDraftById(id).data === null` after loading retires or recovers instead of rendering autosave-enabled `EventCreatorWizard`.
- Publish lifecycle: publish success removes the id from local persisted drafts and draft query caches.
- Discard lifecycle: discard success and known not-found terminal remove the local draft; permission failure preserves it and shows error.
- Preview route: stale server-backed id cannot autosave multi-date override after server detail null.

If route/hook tests are impractical in the current harness, add static guard assertions in `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` that prove:

- `edit.tsx` checks `serverDraftQuery.data === null` for non-`d_` ids.
- `edit.tsx` disables `onAutosaveDraft` for stale server-backed ids.
- `preview.tsx` has the same stale guard.
- `useServerDraftEvents.ts` imports/checks `isServerDraftLifecycleError`.
- publish/discard paths remove detail cache and local draft state.

Automated tests must ship in the same scoped implementation commit/push as the fix.

## Manual Runtime Gate

Tester must verify after implementation:

1. Current stale fixture id `98e880f3-43ef-47ab-a530-deaa117b21a7` does not keep autosaving as a draft.
2. No `[useServerDraftAutosave]` `PGRST116` repeats.
3. The app routes or recovers honestly for the stale id.
4. A fresh draft can still autosave normal fields and cover/media updates.
5. Publishing the fresh draft removes local draft autosave eligibility.

Recommended extra checks:

- Delete/discard a fresh server draft and confirm it leaves the draft list without retry noise.
- Simulate network failure during autosave and confirm the user still gets visible unsaved/error behavior.

## Rollback And Safety

- This should be a client-only Mingla Business fix with no database migration.
- It is safe to roll back by restoring previous service/hook/route behavior, but rollback reopens the stale autosave/PGRST116 bug.
- Do not change persisted store key name. Deleting specific stale server-backed draft objects is allowed; orphaning all local drafts is not.
- Do not delete local-only `d_` drafts during lifecycle retirement.
- Keep logs quieter only for typed lifecycle terminal states; do not blanket-suppress autosave errors.

## Related Work

- ORCH-0763: This is a continuation of server-backed business event draft lifecycle repair. ORCH-0763 established server draft/publish/discard paths; ORCH-0773 closes the stale local persisted draft gap after server lifecycle changes.
- ORCH-0769B: Currency normalization/fallback must remain intact. ORCH-0773 must not regress `events.currency` NOT NULL behavior.
- ORCH-0770: Runtime media/upload proof must use a fresh server draft verified as remote `status = draft` unless ORCH-0773 is fixed first. After this fix, stale draft ids should retire cleanly and no longer contaminate ORCH-0770 evidence.
- ORCH-0771: Public page close/audio lifecycle is separate. Do not modify it here.
- ORCH-0772: Native video disposed-player pause exception is separate. Do not modify EventCoverMedia here except through existing cover/media autosave verification if tests touch it indirectly.
