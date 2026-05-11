# REVIEW RUNTIME ORCH-0770 OPERATOR LOG — Native Player Exception + Draft Autosave PGRST116

## Verdict

Two separate runtime issues surfaced during the attempted ORCH-0770 media runtime test. Neither should be treated as proof that the Cloudinary transcode/webhook implementation itself failed.

Plain-English impact: the organiser still cannot get a clean event-cover-video test because the runtime is being interrupted by a native video teardown error and repeated draft autosave failures. We need to clear those layers before ORCH-0770 can be trusted.

## Evidence From Operator Log

### Issue A — Native video cleanup still throws disposed-player exception

Operator log:

```text
FunctionCallException: Calling the 'pause' function has failed
Caused by: NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object

Code: EventCoverMedia.tsx
  166 | player.pause();
```

Current source check:

- `mingla-business/src/components/ui/EventCoverMedia.tsx` now wraps native play/pause/replay in `callNativeVideoPlayer`.
- Current cleanup source uses `callNativeVideoPlayer(() => player.pause())`, not the raw `player.pause()` shown in the operator stack.

Interpretation: the operator runtime appears to be running stale JS/native bundle code or a build that does not include the hotfix currently in the workspace. This is exactly what `prompts/TESTER_RUNTIME_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md` is designed to prove.

Lifecycle decision:

- Keep ORCH-0772 open.
- Next action: dispatch `$tester` with `prompts/TESTER_RUNTIME_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md`.
- Tester must explicitly record reload/rebundle/build evidence before retesting.

### Issue B — Draft autosave fails with `PGRST116`

Operator log:

```text
[useServerDraftAutosave] Operation failed:
{"code":"PGRST116","details":"The result contains 0 rows","message":"Cannot coerce the result to a single JSON object"}
```

Current source check:

- `mingla-business/src/hooks/useServerDraftEvents.ts` logs autosave failures from `autosaveServerDraft`.
- `mingla-business/src/services/eventDrafts.ts` uses `.single()` in `fetchExistingDraftSaveContext`.
- If the draft id points to no readable row, `.single()` returns `PGRST116`.

This is not the previously fixed ORCH-0769B `events.currency` null error. ORCH-0769B fixed null currency write payloads. The fresh error is a missing/unreadable server draft row during autosave readback/update.

Potential causes to prove, not assume:

- local/Zustand draft id points to a deleted/discarded server row;
- draft status changed away from the expected lifecycle while autosave still runs;
- RLS/role context can update/read in one path but not another;
- draft was published or discarded while autosave continued;
- server draft hydration/list cache is stale after media upload or route transition;
- autosave should use `maybeSingle()` plus honest recovery instead of `.single()` for missing context.

Lifecycle decision:

- Register fresh forensics item ORCH-0773.
- Do not send directly to implementor until root cause is proven.

## Relationship To ORCH-0770

ORCH-0770 remains blocked for runtime proof. These logs do not yet prove the Cloudinary processed-video path failed or passed because the test was contaminated by unrelated lifecycle/autosave errors.

ORCH-0770 can resume after:

1. ORCH-0772 native video teardown error is proven fixed in the actually running bundle.
2. ORCH-0773 autosave `PGRST116` root cause is investigated and either fixed or scoped away from the ORCH-0770 runtime fixture.

