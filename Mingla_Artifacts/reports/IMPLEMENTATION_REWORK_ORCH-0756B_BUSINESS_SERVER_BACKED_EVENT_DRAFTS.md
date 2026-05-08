# Implementation Rework Report: ORCH-0756B Business Server-Backed Event Drafts

> Date: 2026-05-08
> Status: implemented, partially verified
> Scope: tester P2/P3 rework only

## Summary

This rework hardens the server-backed draft publish path so a draft cannot be promoted out of Supabase `events.status='draft'` when the local publish conversion is known to fail. It also expands `test:orch-0756b` beyond mapper-only coverage with static lifecycle guards, and cleans the adjacent invalid `upcoming` event-status query in brand soft-delete.

Runtime sign-out/sign-in and app-deletion smoke remains unverified and must still be performed by tester/operator before orchestrator close.

## Files Changed

- `mingla-business/src/utils/liveEventConverter.ts`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/services/brandsService.ts`
- `mingla-business/src/utils/__tests__/serverDraftEventMapper.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- `mingla-business/package.json`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`

No migration was added. No `supabase db push` was run. No commit or push was performed.

## P2-002 Publish Ordering Fix

Added `canConvertDraftToLiveEvent(draft)` in `liveEventConverter.ts` as a side-effect-free preflight. It checks the local publish conversion prerequisite that caused the tester finding: the brand snapshot must exist in the React Query cache before local publish conversion can succeed.

`EventCreatorWizard` now runs that preflight before calling `onBeforeLocalPublish?.(liveDraft)`, which is the server `markPublished` hook. If the brand snapshot is missing, the wizard stops publishing, closes the publish dialog, shows a retry toast, and leaves the server row as `status='draft'`.

The resulting order is now:

1. Validate publish form/Stripe state.
2. Preflight local conversion with no server mutation.
3. Mark server draft published only if the local conversion can proceed.
4. Convert local draft to live event.

This directly addresses the tester edge case: brand cache missing/local publish precondition failure no longer promotes the server draft out of `draft`.

## P2-003 Test Expansion

Updated `test:orch-0756b` to run:

```bash
npx jest serverDraftEventMapper.test serverDraftLifecycleGuards.test
```

Added `serverDraftLifecycleGuards.test.ts` with guards for:

- Publish preflight appears before server promotion and local publish conversion.
- Create route waits for `createDraft(currentBrandId)` before navigating with `newDraft.id`.
- Edit and preview routes do not redirect while server draft hydration is loading/fetching.
- Legacy local migration has duplicate-prevention guards via `serverLegacyIds`, in-flight `migratingIdsRef`, and `replaceDraft`.
- Autosave/discard/publish service paths continue targeting `status='draft'`.
- Brand delete blocking statuses use DB lifecycle values and do not regress to `["upcoming", "live"]`.

Kept the existing mapper/password/status tests intact.

## P3-001 Status Vocabulary Cleanup

Changed `brandsService.ts` brand soft-delete event blocker from invalid DB status values:

```ts
["upcoming", "live"]
```

to the valid DB lifecycle values:

```ts
["scheduled", "live"]
```

The existing workflow rejection field remains named `upcoming_events` because it is UI/workflow language, not a DB enum value.

## Verification

```bash
cd mingla-business && npm run test:orch-0756b
```

PASS. 2 suites, 12 tests.

```bash
cd mingla-business && npm run test:orch-0756a
```

PASS. Strict guard passed 22 checks; resolver Jest 6/6 passed.

```bash
cd mingla-business && npm run test:orch-0754
```

PASS. Strict Home guard passed; brandEventSummary Jest 5/5 passed.

```bash
cd mingla-business && npx tsc --noEmit
```

PASS.

```bash
cd mingla-business && npx eslint src/utils/liveEventConverter.ts src/components/event/EventCreatorWizard.tsx src/services/brandsService.ts src/utils/__tests__/serverDraftEventMapper.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

PASS.

```bash
git diff --check -- mingla-business/src/utils/liveEventConverter.ts mingla-business/src/components/event/EventCreatorWizard.tsx mingla-business/src/services/brandsService.ts mingla-business/src/utils/__tests__/serverDraftEventMapper.test.ts mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts mingla-business/package.json
```

PASS.

```bash
cd mingla-business && npm run lint
```

FAIL, unrelated existing repo debt. Output reports 171 problems across broad existing files such as `app/__styleguide.tsx`, `app/account/delete.tsx`, `app/event/[id]/index.tsx`, `BrandEditView.tsx`, `CreatorStep2When.tsx`, and other pre-existing surfaces. None of the ORCH-0756B rework-touched files appear in the lint failure output.

## Residual Risk / Manual Runtime Gate

The required credentialed runtime smoke is still not performed in this implementor pass. Tester/operator still needs to verify:

1. Create a business draft.
2. Confirm a Supabase `events.status='draft'` row exists with `theme.business_draft`.
3. Sign out and sign back in.
4. Confirm the draft rehydrates.
5. Clear local storage/app data or simulate app deletion.
6. Sign in again and confirm the same draft rehydrates from Supabase.
7. Edit and resave the recovered draft.
8. Discard and confirm it does not reappear.
9. Publish if safe and confirm it does not reappear as a draft.
10. Inspect server JSON to confirm plaintext ticket passwords are not stored.
11. Probe anonymous/other-brand access if safe fixtures are available.

## Notes

An initial test attempt imported runtime service/converter modules directly and hit Jest's known Expo transform boundary through `expo-constants`. The final tests avoid that by using static lifecycle guards for route/service ordering while keeping mapper tests as runtime unit tests.
