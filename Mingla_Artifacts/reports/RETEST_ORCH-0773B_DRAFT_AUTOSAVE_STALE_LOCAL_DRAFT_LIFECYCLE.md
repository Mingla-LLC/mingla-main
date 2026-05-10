# Retest ORCH-0773B Draft Autosave Stale Local Draft Lifecycle

Date: 2026-05-09
Tester: Codex `$tester`
Verdict: **CONDITIONAL PASS - STATIC/CODE GATES PASS, RUNTIME FIXTURE UNAVAILABLE**

## Summary

The ORCH-0773B implementation satisfies the static/code contract for stale server-backed draft lifecycle repair. The service converts missing/non-draft rows into typed lifecycle errors, autosave retires stale server-backed drafts without raw `PGRST116` surfacing, and edit/preview route recovery no longer uses cleanup-cleared deferred navigation.

Runtime PASS cannot be granted from this tester pass because the current visible iOS simulator container does not contain the stale local draft fixture and is not authenticated. The stale id appears only in cached server/public data, not in the local draft store.

## Static / Code Verification

### Verified

- `mingla-business/src/services/eventDrafts.ts`
  - Defines `ServerDraftLifecycleError` and `isServerDraftLifecycleError`.
  - `fetchDraftById` filters `status = draft` and uses `maybeSingle()`.
  - `fetchExistingDraftSaveContext` filters `status = draft`, `deleted_at IS NULL`, and uses `maybeSingle()`.
  - Missing draft context is resolved through typed lifecycle probing.
  - `autosaveServerDraft` updates only draft/non-deleted rows and throws `ServerDraftLifecycleError("draft_not_editable", draft.id)` on zero-row update.
  - Known discard RPC lifecycle errors are converted into typed lifecycle errors.

- `mingla-business/src/hooks/useServerDraftEvents.ts`
  - Handles `isServerDraftLifecycleError(error)` without calling the generic `logMutationError`.
  - Deletes stale non-local draft ids, removes draft detail query, removes draft from list cache, and invalidates the brand draft list.
  - `hasError` excludes lifecycle retirement errors.

- `mingla-business/app/event/[id]/edit.tsx`
  - Detects stale server-backed local draft state.
  - Waits for published business event recovery query before deciding route.
  - Uses `staleRecoveryDraftIdRef`.
  - Calls `router.replace(recoveryRoute as never)` directly in the stale branch.
  - Does not use `setTimeout` / `clearTimeout` in the stale branch.
  - Guards the missing-draft fallback with `staleRecoveryDraftIdRef.current === idParam`.

- `mingla-business/app/event/[id]/preview.tsx`
  - Uses the same stale recovery ref guard.
  - Routes directly to `/(tabs)/events`.
  - Blocks preview override autosave when `staleServerDraft` is true.

- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
  - The non-draft context regression now uses `await expect(autosaveServerDraft(draft)).rejects.toMatchObject(...)`, so it cannot pass if autosave unexpectedly resolves.

- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
  - Includes a static guard that the stale route block uses `staleRecoveryDraftIdRef`, direct `router.replace`, and no `setTimeout` / `clearTimeout`.

## Commands Run

From `mingla-business`:

```bash
npx jest --runInBand src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result:

```text
PASS src/services/__tests__/eventDraftsCurrency.test.ts (5.799 s)
PASS src/utils/__tests__/serverDraftLifecycleGuards.test.ts

Test Suites: 2 passed, 2 total
Tests:       30 passed, 30 total
Snapshots:   0 total
Time:        7.005 s
```

Note: Watchman emitted its existing recrawl warning.

```bash
npx tsc --noEmit
```

Result: PASS.

```bash
npx eslint src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts 'app/event/[id]/edit.tsx' 'app/event/[id]/preview.tsx' src/store/draftEventStore.ts src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS with warnings only:

```text
src/services/__tests__/eventDraftsCurrency.test.ts
   57:1   warning  Import in body of module; reorder to top
   61:1   warning  Import in body of module; reorder to top
  166:12  warning  Array type using 'Array<T>' is forbidden. Use 'T[]' instead
  436:18  warning  Array type using 'Array<T>' is forbidden. Use 'T[]' instead

src/store/draftEventStore.ts
  611:46  warning  Array type using 'Array<T>' is forbidden. Use 'T[]' instead
  621:46  warning  Array type using 'Array<T>' is forbidden. Use 'T[]' instead

0 errors, 6 warnings
```

From repo root:

```bash
git diff --check
```

Result: PASS.

## Runtime Fixture Probe

Booted simulator detected:

```text
iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6) (Booted)
```

Mingla Business bundle id:

```text
com.sethogieva.minglabusiness
```

Data container:

```text
/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Data/Application/C509364A-577E-42EE-8306-10422F6BD63B
```

Read-only search results:

- `sb-gqnoajqerqhnvulmnyvv-auth-token` is `null`.
- `mingla-business.draftEvent.v1` has `"drafts":[]`.
- Stale id `98e880f3-43ef-47ab-a530-deaa117b21a7` appears only in cached server/public data under `Library/Caches/.../fsCachedData/...`, with remote-shaped `status:"scheduled"`.

Conclusion: the required stale local draft fixture is not available in this simulator data container. Runtime stale-route/fresh-autosave verification remains unverified in this tester pass.

## Manual Runtime Conditions Still Required

Before close, run on an authenticated business app session where a stale local draft exists or can be recreated:

1. Open `/event/98e880f3-43ef-47ab-a530-deaa117b21a7/edit`.
2. Confirm it does not keep rendering an editable/autosaving draft wizard.
3. Confirm route recovery goes to published edit mode if the published event is readable, otherwise Events.
4. Open `/event/98e880f3-43ef-47ab-a530-deaa117b21a7/preview`.
5. Confirm it routes to Events and does not keep preview/autosave state.
6. Confirm no repeated `[useServerDraftAutosave] Operation failed` with `PGRST116` / `Cannot coerce the result to a single JSON object`.
7. Create a fresh server-backed draft, edit a normal field, and confirm autosave succeeds without lifecycle retirement.

## Findings

No P0/P1 code blockers found.

### P2 - Runtime stale fixture and fresh-draft autosave were not verified

The static implementation is sound and the targeted tests pass, but the prompt's full PASS criteria require runtime proof against the stale local fixture and a fresh-draft autosave path. The visible simulator has no auth token and no local drafts, so this pass cannot prove the user-session behavior.

## Recommended Next Gate

Return to `$orchestrator`.

Recommended decision: treat this as a static/code **CONDITIONAL PASS** and schedule an operator-assisted runtime retest for ORCH-0773B on an authenticated session with either the original stale fixture restored or a controlled stale local draft fixture seeded.

