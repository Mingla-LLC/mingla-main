# Close Review ORCH-0772 Public Route Unmount Native Player Disposed Exception

Date: 2026-05-09
Mode: ORCHESTRATOR CLOSE REVIEW
Status: CLOSE EVIDENCE PASS / GIT LOCK-IN BLOCKED BY OVERLAPPING DIRTY WORKTREE

## Plain-English Outcome

The user-visible ORCH-0772 problem is fixed and independently retested: closing or routing away from the public event video page no longer emits the red iOS native disposed-player `pause()` exception.

The lifecycle evidence is sufficient for ORCH-0772 closure in product terms, scoped only to the native `expo-video` disposed shared-object teardown error. It does **not** close ORCH-0771 audible audio-after-close runtime QA or ORCH-0770 video processing/transcode/browser-safe playback.

The final Git lock-in is blocked in this worktree because the product files needed for ORCH-0772 also contain earlier uncommitted media/audio lifecycle changes from adjacent ORCHs. A clean ORCH-0772-only commit cannot be made without either pulling in those overlapping changes or losing the tested contract.

## Evidence Chain

1. Initial runtime failure:
   - `reports/RUNTIME_QA_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_FAIL.md`
   - The exact public route-unmount smoke reproduced:
     - `FunctionCallException: Calling the 'pause' function has failed`
     - `NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object`

2. Rework implementation:
   - `reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
   - `EventCoverMedia` native cleanup now removes listeners only and no longer calls `player.pause()` at teardown.
   - Mounted pause behavior remains for `shouldPlay === false` and AppState inactive/background.

3. Orchestrator implementation review:
   - `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
   - Verdict: PASS -> tester retest next.

4. Independent tester retest:
   - `reports/RETEST_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
   - Verdict: PASS.
   - Required automated gates passed:
     - `npm run test:orch-0771 -- --runInBand`
     - `npx tsc --noEmit`
     - targeted ESLint
     - `git diff --check`
     - artifact placement check
   - Required runtime smoke passed:
     - opened `mingla-business://e/leggothis/a-life-in-vegas`
     - routed away to `mingla-business://(tabs)/events`
     - log grep found zero ORCH-0772 disposed-player signatures

## Closure Decision

Product/lifecycle verdict:

**ORCH-0772 is close-ready and accepted as fixed.**

Lock-in verdict:

**Commit/push is blocked until overlapping dirty work is either committed together under its own accepted lifecycle or split safely.**

## Git Lock-In Blocker

Current `git diff --stat` for the two ORCH-0772 code/test files shows:

```text
mingla-business/src/components/ui/EventCoverMedia.tsx          | 288 +++++++++++++++++++--
mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts | 128 ++++++++-
```

That diff is broader than the final ORCH-0772 cleanup rework. It includes prior uncommitted media/audio lifecycle functionality required by the current tested code path, including active playback intent, web/native video split, sound control wiring, media error surfacing, and earlier event-cover media tests. The ORCH-0772 cleanup fix sits inside that broader uncommitted surface.

Because of that overlap:

- staging only the tiny cleanup change is not representable against current `HEAD`;
- staging the full files would commit adjacent ORCH work under an ORCH-0772 close commit;
- omitting the adjacent files would produce a commit that does not reproduce the tested contract from a clean checkout.

No product code was reverted or destructively changed.

## Scoped Files Involved In ORCH-0772 Evidence

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_FAIL.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
- `Mingla_Artifacts/reports/RETEST_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
- `Mingla_Artifacts/reports/CLOSE_REVIEW_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

Note: the generated tester prompt exists locally at `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`, but `Mingla_Artifacts/prompts/` is ignored by `.gitignore`.

## Next Operational Step

Use `$orchestrator` after the overlapping media/audio worktree is either:

1. committed under the correct accepted ORCH lifecycle(s), or
2. split into a safe staged patch that includes all dependencies for ORCH-0772 without unrelated scope.

Then run the close commit/push for ORCH-0772 lock-in.

## Scope Guard

Do not reopen ORCH-0772 unless the disposed native shared-object `pause()` signature returns.

Keep these separate:

- ORCH-0771: audible public event video audio after close / active-page auto-resume runtime QA.
- ORCH-0770: full phone-video processing, compression, Cloudinary callback, and browser-safe public playback.
- ORCH-0773: stale local draft/autosave lifecycle.
