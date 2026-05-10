# Implementation Rework ORCH-0773B Stale Draft Recovery Route and Test Assertion

Date: 2026-05-09
Implementor: Codex `$implementor`
Status: implemented and verified with focused gates

## Summary

Reworked the ORCH-0773 stale server-backed draft lifecycle fix so stale draft cleanup can no longer cancel its own recovery navigation.

The edit and preview routes now mark stale recovery as started for the current draft id, clean the stale local/query state, and route immediately without a cleanup-cleared timeout. If the local draft deletion causes an intermediate re-render before navigation completes, the per-id recovery guard prevents the legacy missing-draft Home fallback from taking over.

Also hardened the non-draft server-row lifecycle test so it must actually reject.

## Files Changed

- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/app/event/[id]/preview.tsx`
- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`

## Route Ordering Strategy

Before:

1. stale branch deleted the local draft;
2. removed/invalidate query cache;
3. scheduled `router.replace(...)` through `setTimeout(..., 0)`;
4. returned cleanup that cleared that timeout.

That meant `deleteDraft(draft.id)` could trigger a re-render, React could run cleanup, and the intended navigation could be canceled before firing.

After:

1. stale branch checks whether recovery already started for this draft id;
2. marks `staleRecoveryDraftIdRef.current = draft.id`;
3. computes the deterministic recovery route;
4. deletes the local stale draft and cleans query/list state;
5. calls `router.replace(...)` immediately;
6. returns `undefined`, with no timeout cleanup;
7. the following missing-draft branch exits early when `staleRecoveryDraftIdRef.current === idParam`.

Edit route recovery:

- readable published business event -> `/event/${draft.id}/edit?mode=edit-published`;
- no readable published event -> `/(tabs)/events`.

Preview route recovery:

- always -> `/(tabs)/events`.

## Regression Tests

Updated `eventDraftsCurrency.test.ts`:

- The non-draft context lifecycle test now uses `await expect(autosaveServerDraft(draft)).rejects.toMatchObject(...)`, so the test fails if autosave unexpectedly resolves.

Updated `serverDraftLifecycleGuards.test.ts`:

- Added a static guard proving stale route recovery uses `staleRecoveryDraftIdRef`, routes directly, and does not encode the stale branch as `setTimeout` plus `clearTimeout`.

## Verification

From `mingla-business`:

```bash
npx jest --runInBand src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS. 2 suites, 30 tests.

Note: Watchman emitted its existing recrawl warning; Jest passed.

```bash
npx tsc --noEmit
```

Result: PASS.

```bash
npx eslint src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts 'app/event/[id]/edit.tsx' 'app/event/[id]/preview.tsx' src/store/draftEventStore.ts src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS with warnings only.

Warnings:

- `src/services/__tests__/eventDraftsCurrency.test.ts`: existing import-order warnings and `Array<T>` style warnings.
- `src/store/draftEventStore.ts`: existing `Array<T>` style warnings.

From repo root:

```bash
git diff --check
```

Result: PASS.

## Scope Confirmation

No changes were made to:

- Cloudinary or ORCH-0770 video processing;
- public video playback/audio/mute behavior;
- Giphy/Pexels;
- brand/profile/ticket media;
- Stripe, checkout, admin, consumer app, Supabase migrations, RLS, or edge functions.

## Residual Risks

- This remains a code/static verification pass. The operator's stale local fixture should still be runtime-verified by `$tester` to confirm the app routes honestly and no `PGRST116` autosave loop returns.
- The worktree contains unrelated dirty/untracked files from previous ORCH media/video work. This rework intentionally touched only the four scoped files above plus this report.

