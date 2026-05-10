# Review Implementation Rework ORCH-0773 Draft Autosave Stale Local Draft Lifecycle

Date: 2026-05-09
Reviewer: Codex `$orchestrator`
Verdict: **FAIL - REWORK REQUIRED BEFORE TESTER**

## Plain-English Impact

The main stale-draft fix is directionally right: the app now has a typed way to say "this local draft is no longer an editable server draft" instead of spamming raw `PGRST116`.

But the route recovery is not safe enough to hand to tester. In the stale edit/preview route, the code deletes the local draft before the delayed navigation fires. That local deletion can trigger a re-render, React can run the effect cleanup, and the cleanup clears the exact timeout that was supposed to route the organiser away. The fallback path can then treat the draft as simply missing and send the organiser to Home instead of the intended Events/published-edit recovery.

## Evidence Reviewed

- Implementation report: `reports/IMPLEMENTATION_REWORK_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`
- Spec: `specs/SPEC_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`
- Route diff and source:
  - `mingla-business/app/event/[id]/edit.tsx`
  - `mingla-business/app/event/[id]/preview.tsx`
- Service/hook/test diff:
  - `mingla-business/src/services/eventDrafts.ts`
  - `mingla-business/src/hooks/useServerDraftEvents.ts`
  - `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
  - `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`

## Findings

### P1 - Stale-draft recovery navigation can cancel itself

Evidence:

- `mingla-business/app/event/[id]/edit.tsx:185-207`
- `mingla-business/app/event/[id]/preview.tsx:159-174`

Both stale branches do this sequence:

1. `deleteDraft(draft.id)`
2. remove/invalidate React Query draft state
3. schedule `router.replace(...)` in `setTimeout(..., 0)`
4. return cleanup that calls `clearTimeout(t)`

Because `deleteDraft` updates Zustand state immediately, the component can re-render before the zero-delay timeout fires. React then runs the previous effect cleanup, which clears the pending navigation. On the next render `draft === null`, so the existing missing-draft branch can schedule the old Home redirect instead of the ORCH-0773 intended recovery route.

Impact:

- Stale local draft can still produce a confusing route outcome.
- The organiser may be bounced Home instead of Events or published edit.
- The implementation does not yet satisfy the spec requirement that stale server-backed drafts retire and route honestly.

Required rework:

- Make stale recovery navigation non-cancellable by local draft deletion.
- The stale branch must route deterministically to:
  - `/event/${draft.id}/edit?mode=edit-published` when the published business event is readable from server; or
  - `/(tabs)/events` when no readable published event exists.
- The missing-draft legacy fallback must not win after stale recovery begins.

### P2 - One lifecycle regression test can pass if the call unexpectedly resolves

Evidence:

- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts:337-370`

The non-draft context test uses:

```ts
await autosaveServerDraft(draft).catch((error) => {
  expect(isServerDraftLifecycleError(error)).toBe(true);
  expect(error).toMatchObject(...)
});
```

If `autosaveServerDraft(draft)` unexpectedly resolves, the `catch` block never runs and the test still passes. This weakens the exact regression guard that is supposed to prove non-draft server rows become typed lifecycle errors.

Required rework:

- Replace this with `await expect(autosaveServerDraft(draft)).rejects.toMatchObject(...)`.
- Keep the `isServerDraftLifecycleError` assertion by catching through a helper or by asserting the rejected object's shape/name/code/draftId.

## Accepted Direction

These parts look aligned and should be preserved unless the implementor finds a stronger issue while reworking:

- `ServerDraftLifecycleError` / `isServerDraftLifecycleError` service boundary.
- `maybeSingle()` replacement for draft context and update zero-row handling.
- Autosave hook retiring lifecycle errors without generic red error spam.
- Discard handling converting already-gone/no-longer-draft into cleanup success.
- Publish success removing local draft/query cache state.
- Pending autosave timer cleanup before discard.

## Lifecycle Decision

Do **not** send ORCH-0773 to tester yet.

Next gate: dispatch `$implementor` with:

`prompts/IMPLEMENTOR_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`

