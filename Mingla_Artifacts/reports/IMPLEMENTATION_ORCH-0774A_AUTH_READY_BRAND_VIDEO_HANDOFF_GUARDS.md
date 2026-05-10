# IMPLEMENTATION ORCH-0774A - Auth-Ready Brand Video Handoff Guards

Status: implemented and verified  
Source spec: `Mingla_Artifacts/specs/SPEC_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`  
Implementation scope: `mingla-business`

## Summary

ORCH-0774A is implemented. Mingla Business now has a first-class auth-ready contract, brand list surfaces no longer treat unresolved auth/query state as "no brands", server draft creation/migration/autosave are guarded against half-signed-in sessions, and Step 4 video cover handoff no longer starts upload-intent/status/apply work before auth is usable.

This does not implement ORCH-0774B full live-event editing, Giphy/Pexels, picker redesign, Stripe changes, migrations, or Edge Function rewrites.

## What Changed

### Auth readiness

- Added `mingla-business/src/utils/authReadiness.ts`.
- Extended `mingla-business/src/context/AuthContext.tsx` with:
  - `authStatus`
  - `isAuthReady`
  - `hasUsableSession`
  - `authError`
- Preserved true sign-out cleanup through `clearAllStores()` and `queryClient.clear()`.
- Added dev-only auth instrumentation for bootstrap, auth events, auth errors, and true sign-out cleanup.

### Brand honesty

- Added `mingla-business/src/utils/brandListState.ts`.
- Updated `mingla-business/src/hooks/useBrandListShim.ts` with `useBrandListState()`.
- Updated account and brand switcher surfaces so unresolved auth/query/error states do not masquerade as an empty brand list.
- Updated current-brand recovery/detail hooks so they wait for auth-ready and successful query state before resolving empty or clearing `currentBrandId`.

### Draft lifecycle guards

- Updated draft service auth errors in `mingla-business/src/services/eventDrafts.ts` to map Supabase `AuthSessionMissingError` into a typed `BusinessAuthNotReadyError`.
- Updated `mingla-business/src/hooks/useServerDraftEvents.ts` so:
  - draft fetching is disabled until auth is ready;
  - legacy migration waits for auth-ready;
  - autosave treats auth-not-ready as deferred, not as a destructive lifecycle failure;
  - create draft requires a usable session before calling Supabase.
- Updated create/edit/preview routes to wait for auth-ready before draft creation, migration, or missing-draft redirects.

### Step 4 cover video handoff

- Updated `mingla-business/src/components/event/CreatorStep4Cover.tsx` so:
  - image/GIF and video upload entry points wait for auth-ready;
  - trim confirmation waits for auth-ready;
  - video handoff shows stage-specific progress;
  - failures clear stale progress text;
  - failures show persistent inline error copy;
  - previous cover/hue is preserved on failure;
  - selected video/trim state remains retryable where feasible.
- Updated `mingla-business/src/services/eventCoverVideoProcessingService.ts` to distinguish auth, provider, validation, permission, missing job, source upload, timeout/provider, malformed response, and fallback Edge Function errors.

### Tests

- Added `mingla-business/src/utils/__tests__/authReadiness.test.ts`.
- Added `mingla-business/src/hooks/__tests__/brandListState.test.ts`.
- Added `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`.
- Updated existing lifecycle/UI guard tests.
- Added `test:orch-0774a` to `mingla-business/package.json`.

## Verification

All required command-contract gates passed from `mingla-business`:

```bash
npm run test:orch-0774a
```

Result: PASS. 5 suites, 41 tests.

```bash
npm run test:orch-0756a
```

Result: PASS. Strict grep 22 checks plus 6 Jest tests.

```bash
npm run test:orch-0756b
```

Result: PASS. 2 suites, 31 tests.

```bash
npm run test:orch-0770
```

Result: PASS. Event cover video processing strict guard plus TypeScript.

```bash
npx tsc --noEmit
```

Result: PASS.

```bash
git diff --check
```

Result: PASS.

Note: Jest emitted the existing Watchman recrawl warning. It did not fail any gate.

## Deployment Notes

- Supabase migration: none.
- Edge Function deploy: not required for this implementation.
- Deno gates: not applicable because no Edge Functions were changed.
- Native dependency: none.
- Native rebuild: not expected.
- App/web deployment: required for the `mingla-business` JS/TS changes to reach users.

## Tester Runtime Gates

Tester should verify:

- fresh login does not temporarily wipe or hide existing brands as "empty";
- create event after login waits cleanly and creates one draft without `AuthSessionMissingError`;
- account and brand switcher show loading/error/empty honestly;
- server draft autosave no longer logs auth-missing storms after login or refresh;
- Step 4 image/GIF upload still works;
- Step 4 video upload waits for auth-ready, then progresses through upload/processing;
- video auth/Edge/source/status/apply failures leave prior cover/hue intact and show persistent inline error;
- too-long video trimming still works;
- true sign-out still clears stores/cache.

## Residual Scope

The following remain intentionally outside ORCH-0774A:

- ORCH-0774B live-event non-cover editing save behavior.
- Giphy/Pexels media selection.
- Full picker redesign.
- Stripe onboarding.
- Cloudinary architecture changes beyond client-side auth gating and error mapping.
