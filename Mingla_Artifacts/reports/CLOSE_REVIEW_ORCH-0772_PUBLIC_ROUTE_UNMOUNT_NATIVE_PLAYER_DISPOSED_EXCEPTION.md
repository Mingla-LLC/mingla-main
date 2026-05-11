# Close Review ORCH-0772 Public Route Unmount Native Player Disposed Exception

Date: 2026-05-09
Lock-in sync: 2026-05-10
Mode: ORCHESTRATOR CLOSE REVIEW
Status: CLOSED / GIT-LOCKED IN `0cfce5ee`

## Plain-English Outcome

The user-visible ORCH-0772 problem is fixed and independently retested: closing or routing away from the public event video page no longer emits the red iOS native disposed-player `pause()` exception.

The lifecycle evidence is sufficient for ORCH-0772 closure in product terms, scoped only to the native `expo-video` disposed shared-object teardown error. It does **not** close ORCH-0771 audible audio-after-close runtime QA or ORCH-0770 video processing/transcode/browser-safe playback.

Git lock-in is now complete. The overlapping media/audio lifecycle work was bundled with the accepted event media lifecycle fixes and pushed to `origin/Seth` in commit `0cfce5ee24314a1a9078a20e92071c42c68508c8` (`Bundle event media lifecycle fixes`) on 2026-05-09.

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

**Committed and pushed in `0cfce5ee24314a1a9078a20e92071c42c68508c8` on branch `Seth` / `origin/Seth`.**

## Git Lock-In Resolution

Earlier close review found that `EventCoverMedia.tsx` and `eventCoverMedia.test.ts` contained overlapping accepted media/audio lifecycle work, making an ORCH-0772-only commit unsafe from that `HEAD`. The resolution was to bundle the tested media lifecycle set together and lock it in with one scoped event-media commit:

```text
0cfce5ee24314a1a9078a20e92071c42c68508c8 Bundle event media lifecycle fixes
```

The pushed bundle preserves the tested ORCH-0772 contract and keeps scope boundaries explicit: ORCH-0772 is closed only for the native disposed-player route-unmount exception. ORCH-0771 audible audio-after-close and ORCH-0770 Cloudinary/transcode/browser playback remain separate open runtime gates.

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

No further ORCH-0772 specialist dispatch remains. Continue with the separate media gates:

1. ORCH-0770 operator-assisted phone-video processing/runtime QA.
2. ORCH-0771 runtime audio close/autoplay verification.

## Scope Guard

Do not reopen ORCH-0772 unless the disposed native shared-object `pause()` signature returns.

Keep these separate:

- ORCH-0771: audible public event video audio after close / active-page auto-resume runtime QA.
- ORCH-0770: full phone-video processing, compression, Cloudinary callback, and browser-safe public playback.
- ORCH-0773: stale local draft/autosave lifecycle.
