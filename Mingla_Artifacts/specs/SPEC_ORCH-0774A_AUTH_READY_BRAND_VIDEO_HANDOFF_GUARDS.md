# SPEC ORCH-0774A - Auth-Ready, Brand Honesty, and Video Handoff Guards

Status: READY FOR IMPLEMENTOR  
Mode: Forensics SPEC  
Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md`  
Review: `Mingla_Artifacts/reports/REVIEW_INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md`

## Verdict

ORCH-0774A must fix one proven failure class: Mingla Business currently lets organiser flows run while the app is only half signed in. The implementation must add a first-class auth-ready contract and make brand lists, draft creation, draft autosave/migration, and Step 4 cover-video handoff respect it.

This spec keeps Step 4 video failure UX in ORCH-0774A. It is part of the same broken journey: upload-intent/status/apply can fail because auth is not ready, and the screen currently leaves stale `Preparing secure video upload...` copy instead of a retryable failed state.

## Scope

Included:

- `mingla-business` auth readiness contract.
- Brand-list honesty during auth loading, query loading, disabled queries, and errors.
- `/event/create` server draft creation gating.
- Legacy local-draft to server-draft migration gating.
- Server draft autosave behavior for temporary auth-missing versus true sign-out.
- Event cover video upload-intent, status, and apply auth gating.
- Step 4 stale video-progress cleanup and retryable inline failure state.
- Development instrumentation that identifies which stage failed.
- Automated regression tests and focused gates.

Explicitly excluded:

- ORCH-0774B full editing of server-loaded live events.
- Giphy and Pexels.
- Media picker redesign.
- Stripe onboarding changes, except that this auth-ready primitive may later be reused by ORCH-0764C.
- Cloudinary architecture changes beyond client-side auth gating and error mapping.
- Weakening real sign-out cleanup.

## User Promise

After login, session refresh, or returning from background:

- organisers never see their brands disappear just because auth or queries are still settling;
- tapping “Build a new event” waits until a usable Supabase session exists, then creates exactly one server draft;
- drafts do not spam auth-missing errors while the app is still restoring session state;
- video covers do not begin upload-intent/status/apply calls without a real session token;
- if a cover video fails at auth, upload-intent, source upload, processing, status polling, or apply, Step 4 shows a clear retry state and preserves the previous cover or hue.

## Current Broken Behavior

Evidence from the investigation and current code:

- `mingla-business/src/context/AuthContext.tsx` exposes only `user`, `session`, and `loading`; callers infer readiness inconsistently.
- `mingla-business/app/event/create.tsx` calls `createDraft(currentBrandId)` as soon as there is a current brand, with no session/access-token gate.
- `mingla-business/src/services/eventDrafts.ts` calls `supabase.auth.getUser()` in `requireUserId`; if the Supabase auth client has no active session it throws `AuthSessionMissingError`.
- `mingla-business/src/hooks/useServerDraftEvents.ts` logs `AuthSessionMissingError` through generic mutation logging and retries can restart from route state.
- `mingla-business/src/hooks/useBrandListShim.ts` returns `query.data ?? []`, collapsing loading, disabled, error, and true-empty into the same value.
- `mingla-business/app/(tabs)/account.tsx` renders `Your brands` only when `brands.length > 0`, so unresolved state looks like the user has no brands.
- `mingla-business/src/hooks/useCurrentBrandRecovery.ts` and `useCurrentBrand.ts` can treat unresolved auth/query state as empty or invalid if callers do not distinguish the fetch lifecycle.
- `mingla-business/src/components/event/CreatorStep4Cover.tsx` starts video processing without an auth-ready check. On failure after `setVideoStatusText("Preparing secure video upload...")`, it clears uploading flags but does not clear the stale progress text or expose retry state.
- `mingla-business/src/services/eventCoverVideoProcessingService.ts` maps all Supabase Edge Function invoke failures to generic `edge_error`, losing auth/provider/source/status/apply distinction.
- `supabase/functions/_shared/eventCoverVideo.ts` correctly requires a bearer token and returns `401 { error: "unauthenticated" }` when absent or invalid; the client must not treat that as a generic processing failure.
- `supabase/config.toml` leaves upload-intent/status/apply JWT-protected, which is correct and must remain.

## Auth-Ready Contract

Add a durable auth readiness model in `mingla-business/src/context/AuthContext.tsx`. Exact names may vary, but behavior must match this contract:

```ts
type BusinessAuthStatus =
  | "bootstrapping"
  | "signed_out"
  | "signed_in_ready"
  | "refreshing"
  | "error";
```

AuthContext must expose, at minimum:

- `authStatus: BusinessAuthStatus`
- `isAuthReady: boolean`
- `hasUsableSession: boolean`
- `authError: Error | null`
- existing `user`, `session`, `loading`, and auth actions

Definitions:

- `bootstrapping`: initial `getSession()` or auth bootstrap is unresolved. UI can show cached non-sensitive shells, but must not start server mutations.
- `refreshing`: an existing session is being refreshed or auth-state change is in progress. UI can keep showing already loaded/cached data, but auth-required mutations must wait unless there is a current non-empty `session.access_token`.
- `signed_in_ready`: `session !== null`, `user !== null`, and `session.access_token` is a non-empty string after bootstrap/auth event handling. Auth-required mutations and Edge Function calls are allowed.
- `signed_out`: bootstrap is complete and no user/session exists, or Supabase emitted a true `SIGNED_OUT`.
- `error`: auth bootstrap or refresh failed in a way the app cannot classify as signed out.

Operation matrix:

| Operation | bootstrapping | refreshing | signed_in_ready | signed_out | error |
| --- | --- | --- | --- | --- | --- |
| Show cached brand chrome | Allowed with loading affordance | Allowed | Allowed | No | Allowed with error affordance |
| Fetch brand list | Wait | Wait or keep prior query | Allowed | Disabled | Disabled/error |
| Resolve/clear current brand | Wait | Wait | Allowed | Clear through sign-out flow only | Wait |
| Create server draft | Wait | Wait unless usable token exists | Allowed | Block/sign-in | Block/retry auth |
| Migrate legacy local draft | Wait | Wait unless usable token exists | Allowed | Do not migrate | Do not migrate |
| Autosave server draft | Wait/queue locally | Wait/queue locally | Allowed | Stop/route sign-in | Stop with retry |
| Video upload-intent/status/apply | Wait | Wait unless usable token exists | Allowed | Block/sign-in | Block/retry auth |
| `clearAllStores()` | No | No | No | Yes, on true `SIGNED_OUT` | No |

Do not use `user !== null` alone as an auth-ready signal for mutations.

## Required Implementation By Layer

### 1. AuthContext And Auth Helpers

- Extend `AuthContextValue` with the auth-ready fields above.
- Set `authStatus="bootstrapping"` until initial `supabase.auth.getSession()` has completed.
- Set `authStatus="signed_in_ready"` only after session/user/access-token are present.
- Preserve `clearAllStores()` and `queryClient.clear()` on true `SIGNED_OUT`.
- Do not call `clearAllStores()` for bootstrap errors, transient missing session during a mutation, query errors, or auth helper errors.
- Add a small service/helper that classifies auth errors consistently:
  - `AuthSessionMissingError` from Supabase auth-js;
  - missing `session.access_token`;
  - Edge Function `401 { error: "unauthenticated" }`.
- The helper must return/throw a typed local error such as `BusinessAuthNotReadyError` with `code: "auth_not_ready" | "signed_out" | "unauthenticated"`.
- No helper may log access tokens, refresh tokens, Cloudinary signatures, or signed upload fields.

### 2. Hooks, State, And Cache

- Update server-draft hooks so auth-required work is disabled until `signed_in_ready` or an equivalent usable-token state.
- `useCreateServerDraft` must not call `createServerDraft` while auth is unresolved.
- `useServerDraftsForBrand` legacy migration must not call `createServerDraft(brandId, draft)` until auth is ready.
- `useServerDraftAutosave` must treat typed auth-not-ready as a deferred state, not a generic operation failure.
- Auth-not-ready autosave failures must not delete drafts, mark them saved, or clear local state.
- Server draft lifecycle errors (`draft_not_found`, `draft_not_editable`, `draft_not_readable`) must keep their current behavior.
- React Query remains the owner of server brand/draft rows. Zustand must not regain persisted `Brand` rows.

### 3. Brand-List Honesty

Add a stateful brand-list API for surfaces where empty has user meaning. Suggested shape:

```ts
type BrandListStatus =
  | "auth_loading"
  | "signed_out"
  | "query_disabled"
  | "query_loading"
  | "ready"
  | "empty"
  | "error";

type BrandListState = {
  brands: Brand[];
  status: BrandListStatus;
  isTrueEmpty: boolean;
  isLoading: boolean;
  error: Error | null;
};
```

Requirements:

- `useBrandList()` may remain as backward-compatible array sugar, but Account, recovery, brand switcher, and any surface where empty means “you have no brands” must use the richer state.
- `query.data ?? []` must not be used as the only truth for user-facing empty states.
- `Your brands` in `app/(tabs)/account.tsx` must not silently disappear during auth/query loading, disabled query, or query error.
- Account must show one of:
  - existing cached/previous brands while refreshing;
  - a loading state such as “Loading your brands…”;
  - an error state with retry affordance;
  - a true empty state only when auth is ready and the brand query has succeeded with `[]`.
- `useCurrentBrandRecovery` must not resolve to true empty while auth is not ready or the brand/creator-account queries are not successful.
- `useCurrentBrand` must clear `currentBrandId` only when a successful, auth-ready brand detail query returns `null`. It must not clear on disabled, loading, or error states.

### 4. `/event/create`

- `mingla-business/app/event/create.tsx` must consume the auth-ready contract.
- If auth is bootstrapping/refreshing/error, render a non-dead waiting or retry state and do not call `createDraft`.
- If signed out, route to the welcome/sign-in path or show a sign-in required state according to existing navigation patterns.
- Once `signed_in_ready` and `currentBrandId !== null`, create exactly one server draft for that mount/attempt.
- If a typed auth-not-ready error is thrown due to a race, return to the waiting state without generic console-error spam and without a tight retry loop.
- If `currentBrandId === null` after auth and brand recovery are ready, then route back to Home as today.

### 5. Draft Migration And Autosave

- Legacy local-draft migration inside `useServerDraftsForBrand` must wait for auth-ready and brand query success before attempting server creation.
- Migration in-flight tracking must not permanently suppress a draft when auth-not-ready occurs; it must clear in-flight state and retry after auth becomes ready.
- Autosave must not call Supabase while auth is unresolved.
- Autosave auth-not-ready must leave the local draft dirty and retryable.
- Autosave must continue to handle true server lifecycle retirement by deleting the local server draft and invalidating queries.
- Existing ORCH-0773 stale-draft lifecycle behavior must remain untouched unless a direct failing test proves overlap.

### 6. Step 4 Cover Video UI

`mingla-business/src/components/event/CreatorStep4Cover.tsx` must implement an explicit video-processing UI state. Suggested state:

```ts
type VideoCoverPhase =
  | "idle"
  | "trim_required"
  | "preparing"
  | "uploading_source"
  | "processing"
  | "ready"
  | "failed";
```

Requirements:

- Video upload button and trim confirmation must not invoke upload-intent while auth is not ready.
- If auth is not ready, show inline copy or toast equivalent to “Finishing sign-in before upload…” and keep the selected video/trim choice when feasible.
- Progress text must reflect the real phase:
  - preparing secure upload;
  - uploading source;
  - compressing cover video;
  - ready;
  - failed.
- On any failure after a video is selected:
  - clear stale progress text;
  - set `phase="failed"`;
  - show a persistent inline error, not only a toast;
  - preserve `pendingVideo` and `trimStartMs` when feasible;
  - keep previous `draft.coverMediaUrl`, `draft.coverMediaType`, and `draft.coverHue` unchanged;
  - expose a retry action that reuses the selected/trimmed clip;
  - call `onCoverVideoProcessingChange(false)` in all exits.
- For `published_manual`, the processed video may update local draft preview only after processing succeeds; saving the live-event cover remains a separate ORCH-0770/cover-only save path.
- Do not redesign the picker or add Giphy/Pexels here.

### 7. Event Cover Video Service

`mingla-business/src/services/eventCoverVideoProcessingService.ts` must distinguish these failure codes:

- `auth_not_ready` or `unauthenticated`
- `provider_not_configured`
- `validation_error`
- `forbidden`
- `not_found`
- `source_upload_failed`
- `processing_timeout`
- `provider_failed` or the job `failureCode`
- `processed_url_missing`
- `malformed_response`
- `edge_error` only as a final fallback

Client mapping requirements:

- Upload-intent `401` or `{ error: "unauthenticated" }` maps to auth copy, not generic processing failure.
- Upload-intent `provider_not_configured` keeps the existing user-facing Cloudinary-not-configured copy.
- Source upload failures are distinct from processing/status failures.
- Status/apply auth failures are distinct from provider failures.
- The service must never log or expose signed Cloudinary upload fields or Supabase tokens.

### 8. Edge Function Behavior

No database migration is expected for ORCH-0774A.

Edge Function auth requirements remain:

- `event-cover-video-upload-intent`: JWT required.
- `event-cover-video-status`: JWT required.
- `event-cover-video-apply`: JWT required.
- `event-cover-video-webhook`: `verify_jwt=false`, Cloudinary signature verified internally.

If implementor changes Edge Function response shapes, each function must still:

- return `401 { error: "unauthenticated" }` when there is no bearer token or token is invalid;
- return `403 { error: "forbidden", detail: "permission_denied" }` when the user lacks event-manager permission;
- return structured `validation_error` details for invalid job/event/brand ids or trim/source limits;
- keep webhook auth independent of user JWTs.

If Edge Functions are untouched, redeploy is not required for this spec.

### 9. Instrumentation

Add development-only logs that make future failures obvious without leaking secrets.

Required event groups:

- Auth:
  - `bootstrap-start`
  - `bootstrap-ready`
  - `bootstrap-no-session`
  - `auth-event`
  - `auth-error`
  - `signed-out-store-clear`
- Draft creation:
  - `draft-create-deferred`
  - `draft-create-start`
  - `draft-create-auth-not-ready`
  - `draft-create-success`
  - `draft-create-failed`
- Brand list:
  - `brand-list-auth-loading`
  - `brand-list-query-loading`
  - `brand-list-error`
  - `brand-list-ready`
- Video cover:
  - `upload-intent-start`
  - `upload-intent-failed`
  - `upload-intent-success`
  - `source-upload-start`
  - `source-upload-failed`
  - `source-upload-success`
  - `status-poll-start`
  - `status-poll-failed`
  - `status-ready`
  - `apply-start`
  - `apply-failed`
  - `apply-success`

Allowed fields: event id, brand id, job id, phase, failure code, HTTP status, media type, source byte count, source duration, trim start/end.  
Forbidden fields: access tokens, refresh tokens, Cloudinary signatures, signed upload form fields, file contents, local file URI in production logs.

## Invariants To Preserve

- Real sign-out clears Zustand stores and React Query cache.
- Server state remains server-side/React Query owned.
- Zustand stores only the active brand id/pointers and local drafts; persisted brand rows must not return.
- No dead taps.
- No silent failures.
- No false “no brands” UI while auth/query is unresolved.
- Edge Functions that mutate/read protected event-cover-video jobs remain JWT-protected.
- ORCH-0770 Cloudinary compression/transcoding architecture remains intact.
- ORCH-0773 stale-draft lifecycle remains intact unless overlap is proven by a failing test.

## Test Contract

The implementor must add tests that fail before the fix and pass after it. Tests must ship in the same scoped commit/push as the implementation.

Required automated tests:

1. `/event/create` does not call `createDraft` while auth is `bootstrapping`, `refreshing` without usable token, `signed_out`, or `error`.
2. `/event/create` calls `createDraft` exactly once after auth becomes `signed_in_ready` and current brand id exists.
3. `AuthSessionMissingError` during create draft is classified as auth-not-ready without generic mutation log spam or a retry storm; after auth-ready, one create call succeeds.
4. Legacy local-draft migration does not call `createServerDraft` while auth is not ready, and retries after auth becomes ready.
5. Server draft autosave does not mark a draft saved, delete it, or log generic operation failure on typed auth-not-ready.
6. Account `Your brands` does not disappear silently when auth is loading, query is disabled/loading, or query errors.
7. Account shows true empty only after auth is ready and the brand query succeeds with `[]`.
8. Current-brand recovery does not resolve to true empty while auth, brand query, or creator-account query is unresolved.
9. `useCurrentBrand` does not clear `currentBrandId` on disabled/loading/error; it clears only after auth-ready successful fetch returns `null`.
10. Video upload-intent is not called until auth is ready.
11. Mock upload-intent `401` or unauthenticated edge failure clears `Preparing secure video upload...`, shows a persistent retryable inline error, and leaves prior cover/hue intact.
12. Source upload failure is displayed separately from processing/status failure.
13. Status/apply auth failure maps distinctly from provider/job failure.
14. Existing ORCH-0756A, ORCH-0756B, and ORCH-0770 focused gates pass or are intentionally updated with written justification.

Required command contract:

```bash
cd mingla-business
npm run test:orch-0774a
npm run test:orch-0756a
npm run test:orch-0756b
npm run test:orch-0770
npx tsc --noEmit
```

Implementation must add `test:orch-0774a` to `mingla-business/package.json`. It may combine Jest tests and a strict-grep guard.

If the implementor touches Edge Functions, also run the relevant Supabase function tests or a documented local invocation gate for:

- `event-cover-video-upload-intent`
- `event-cover-video-status`
- `event-cover-video-apply`

## Runtime Tester Gates

Tester must verify on a real simulator/device session:

- Fresh login does not show empty/disappearing brands while auth is settling.
- Existing brands remain visible or show a loading/error state during refresh.
- Creating a new event after login waits cleanly, creates one draft, and does not log `AuthSessionMissingError`.
- Step 4 image/GIF upload still works.
- Step 4 video upload with a valid short clip does not call upload-intent before auth-ready and either processes successfully or fails with a clear stage-specific message.
- Step 4 video failure leaves the previous cover/hue visible and retryable.
- A too-long video can still be trimmed according to ORCH-0770 behavior.
- No auth-missing autosave log storm appears after login, background/foreground, or return from share sheet.
- Existing `clearAllStores()` behavior still happens after intentional sign-out.

## Deployment Notes

- Supabase migration: none expected.
- Edge Function redeploy: only required if implementor changes upload-intent/status/apply response mapping or shared helper behavior.
- Native dependency: none expected.
- Native rebuild: not expected if implementation stays in JS/TS and existing dependencies.
- OTA/web deployment: required for `mingla-business` app changes.
- If a migration becomes necessary, its filename prefix must be greater than the current repo max migration version and must be justified in the implementation report.

## Rollback Risk

Rollback is schema-safe if no migration is added, but it reopens the user-facing failures:

- brands can appear to disappear while auth/query state is unresolved;
- event creation can call Supabase with no session;
- draft autosave/migration can log auth-missing storms;
- video upload can fail with stale `Preparing secure video upload...` state.

If Edge Functions are changed and then rolled back independently from the client, confirm the client still handles the older `{ error, detail }` response shape.

## Implementor Handoff

Implement ORCH-0774A only.

Do:

- add the auth-ready contract;
- update brand-list truth surfaces;
- gate create/migration/autosave/video calls;
- fix Step 4 retryable failure state;
- add `test:orch-0774a`;
- run the command contract above;
- write an implementation report with file list, test output, and any manual runtime caveats.

Do not:

- implement full live-event non-cover editing;
- add Giphy/Pexels;
- redesign the picker;
- change Stripe onboarding;
- persist full brand rows in Zustand;
- weaken true sign-out cleanup;
- log secrets.

If implementation discovers that ORCH-0774B or ORCH-0770 Cloudinary architecture must change to satisfy this spec, stop and return evidence to orchestrator before expanding scope.
