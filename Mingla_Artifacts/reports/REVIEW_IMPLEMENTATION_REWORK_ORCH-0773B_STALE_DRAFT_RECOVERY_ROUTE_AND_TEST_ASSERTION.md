# Review Implementation Rework ORCH-0773B Stale Draft Recovery Route and Test Assertion

Date: 2026-05-09
Reviewer: Codex `$orchestrator`
Verdict: **PASS TO TESTER**

## Plain-English Impact

The rework fixes the hole found in the first ORCH-0773 implementation review.

Before this rework, stale-draft cleanup could delete the local draft, trigger a re-render, clear the delayed navigation timeout, and accidentally let the old Home fallback win. Now stale recovery marks the draft id as being recovered, routes immediately, and blocks the missing-draft fallback from taking over during the intermediate render.

This is ready for independent tester verification against the real stale fixture and fresh-draft autosave flow. It is not closed yet.

## Evidence Reviewed

- Rework prompt: `prompts/IMPLEMENTOR_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`
- Rework implementation report: `reports/IMPLEMENTATION_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`
- Prior failed review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`
- Code paths:
  - `mingla-business/app/event/[id]/edit.tsx`
  - `mingla-business/app/event/[id]/preview.tsx`
  - `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
  - `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`

## Review Findings

No blocking findings.

Accepted fixes:

- `edit.tsx` and `preview.tsx` now use `staleRecoveryDraftIdRef` to mark stale recovery as in progress.
- Stale recovery calls `router.replace(...)` immediately and returns `undefined`, not a cleanup-cleared timeout.
- The missing-draft fallback exits early when `staleRecoveryDraftIdRef.current === idParam`, so local deletion cannot hand control to the legacy Home redirect.
- Edit route still selects the correct recovery target:
  - readable published server event -> `/event/${draft.id}/edit?mode=edit-published`;
  - otherwise -> `/(tabs)/events`.
- Preview route recovers to `/(tabs)/events`.
- The non-draft lifecycle service test now uses `await expect(...).rejects.toMatchObject(...)`, so it cannot pass if autosave unexpectedly resolves.
- Static guard coverage now checks that the stale route block does not contain `setTimeout` or `clearTimeout`.

## Verification Accepted From Implementor

Accepted reported gates:

```bash
cd mingla-business
npx jest --runInBand src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
npx tsc --noEmit
npx eslint src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts 'app/event/[id]/edit.tsx' 'app/event/[id]/preview.tsx' src/store/draftEventStore.ts src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
cd ..
git diff --check
```

Reported results:

- Jest: PASS, 2 suites, 30 tests.
- TypeScript: PASS.
- ESLint: PASS with warnings only in existing import-order / `Array<T>` style patterns.
- Diff check: PASS.

## Lifecycle Decision

ORCH-0773 is ready for independent `$tester` verification.

Next prompt:

`prompts/TESTER_RETEST_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

Do not close until tester proves the stale fixture no longer renders/autosaves stale state and no repeated `PGRST116` autosave loop returns.

