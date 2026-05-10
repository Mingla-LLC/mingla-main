# Implementation Rework ORCH-0773 Draft Autosave Stale Local Draft Lifecycle

Date: 2026-05-09
Implementor: Codex `$implementor`
Status: implemented and verified with focused gates

## Summary

Implemented the app-side stale draft lifecycle repair for Mingla Business.

The business app now treats missing/non-draft server draft rows as a typed lifecycle state instead of a generic autosave failure. When autosave or route hydration discovers that a server-backed local draft is no longer an editable server draft, the app retires the local stale draft, clears draft query state, and routes away from the stale wizard path.

No Supabase migration was added.

## Root Cause Fixed

Before:

1. Local Zustand could keep a `DraftEvent` for a server id after the server row was already scheduled/public.
2. `fetchExistingDraftSaveContext` could read that scheduled row because it filtered only by id/deleted.
3. Autosave update required `status = draft`, updated zero rows, and `.single()` emitted raw `PGRST116`.
4. The hook logged repeated `[useServerDraftAutosave] Operation failed`.
5. Edit/preview routes could keep rendering stale local draft state.

After:

1. Draft context reads are draft-only and use `maybeSingle()`.
2. Missing/non-draft/deleted/no-longer-readable server draft rows become `ServerDraftLifecycleError`.
3. Autosave update zero-row outcomes become typed lifecycle, not raw `PGRST116`.
4. Autosave hook retires stale server-backed drafts without generic red error spam.
5. Edit and preview routes detect stale server-backed local drafts after server draft detail resolves `null`, disable the stale path, clear local/query state, and route to recovery.

## Files Changed

- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/hooks/useBusinessEvents.ts`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/app/event/[id]/preview.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`

## Implementation Details

### Service Lifecycle Error

Added:

- `ServerDraftLifecycleError`
- `ServerDraftLifecycleErrorCode`
- `isServerDraftLifecycleError`

Lifecycle codes:

- `draft_not_found`
- `draft_not_editable`
- `draft_not_readable`

`fetchExistingDraftSaveContext` now requires `status = draft`, uses `maybeSingle()`, and resolves missing context through a typed lifecycle probe. `autosaveServerDraft` also uses `maybeSingle()` on the update/select and throws typed lifecycle when the update returns no row.

Known discard lifecycle failures from `business_discard_event_draft` are converted to the same lifecycle error family, while permission/auth/unknown failures still throw normally.

### Hook / Cache Cleanup

`useServerDraftAutosave` now handles `ServerDraftLifecycleError` separately:

- deletes local stale server-backed draft;
- removes draft detail query;
- removes the id from draft list cache;
- invalidates draft list;
- does not call `markDraftSaved`;
- does not expose the lifecycle retirement as generic `hasError`.

`useDiscardServerDraft` treats known already-gone/no-longer-draft lifecycle as cleanup success, but still surfaces unknown errors.

`usePublishBusinessEventDraft` now deletes the local draft and removes it from draft list cache on publish success, in addition to the existing query invalidation/public-business cache writes.

### Route Guards

`app/event/[id]/edit.tsx` now detects stale server-backed local drafts:

- local draft exists;
- id is not `d_`;
- server draft query finished;
- server draft data is `null`;
- server draft query did not error.

In that state it does not render an autosave-enabled wizard. It removes local/query draft state and routes to published edit recovery if the business event is readable, otherwise to Events with honest copy.

`app/event/[id]/preview.tsx` applies the same stale guard and blocks preview override autosave for stale server-backed ids.

### Pending Autosave Cleanup

`EventCreatorWizard` now clears its pending autosave timer before discard, matching the existing publish cleanup pattern.

## Tests Added / Updated

Updated `eventDraftsCurrency.test.ts` with lifecycle coverage:

- non-draft context becomes typed lifecycle;
- zero-row autosave update becomes typed lifecycle;
- unknown Supabase context error stays visible;
- existing currency and cover media autosave tests still pass.

Updated `serverDraftLifecycleGuards.test.ts` with static guard coverage:

- service uses typed lifecycle and `maybeSingle()`;
- autosave hook retires stale server-backed drafts;
- edit/preview routes contain stale-server-draft guards;
- publish/discard cleanup removes draft cache state.

## Verification

From `mingla-business`:

```bash
npx jest --runInBand src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS. 2 suites, 29 tests.

Note: Watchman emitted an existing recrawl warning; Jest passed.

```bash
npx tsc --noEmit
```

Result: PASS.

```bash
npx eslint src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts 'app/event/[id]/edit.tsx' 'app/event/[id]/preview.tsx' src/store/draftEventStore.ts
```

Result: PASS with warnings only. Warnings were pre-existing `Array<T>` style warnings in untouched migration-type lines of `src/store/draftEventStore.ts`.

Additional touched-file lint:

```bash
npx eslint src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts 'app/event/[id]/edit.tsx' 'app/event/[id]/preview.tsx' src/store/draftEventStore.ts src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS with warnings only. In addition to the store warnings, the test file reports existing Jest mock import-order warnings and `Array<T>` style warnings.

From repo root:

```bash
git diff --check
```

Result: PASS.

## Manual QA Gate For Tester

Tester should verify:

1. Open stale fixture id `98e880f3-43ef-47ab-a530-deaa117b21a7` if still present locally.
2. Confirm the app does not keep rendering/autosaving a stale draft wizard.
3. Confirm no repeated `[useServerDraftAutosave]` `PGRST116`.
4. Confirm the app routes or recovers honestly for the stale id.
5. Create a fresh server draft.
6. Upload/edit cover media and confirm autosave succeeds.
7. Publish the fresh draft.
8. Revisit the old edit route and confirm stale local draft editing does not return.

## Scope Notes

No changes were made to:

- Cloudinary or ORCH-0770 video processing.
- Public video sound/mute/close behavior.
- Giphy/Pexels.
- Brand/profile/ticket media.
- Stripe, checkout, admin, or consumer app.
- Supabase migrations, RLS, RPC definitions, or edge functions.

## Remaining Risks

- Route recovery behavior still needs runtime validation on the operator's stale local fixture.
- Lint warnings remain in existing test/store style patterns, but no lint errors were produced.
- The worktree contains many unrelated dirty/untracked files from previous ORCH media/video work. They were not reverted or intentionally cleaned during this scoped ORCH-0773 implementation.
