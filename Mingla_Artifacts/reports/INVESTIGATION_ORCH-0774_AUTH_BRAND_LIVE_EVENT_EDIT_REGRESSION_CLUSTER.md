# Investigation ORCH-0774 Auth, Brand, Live Event Edit Regression Cluster

Date: 2026-05-10  
Mode: Forensics / investigation only  
Prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md`

## Verdict

**MULTIPLE ROOT CAUSES.**

This is not one single Cloudinary or video bug. The current bundle exposes a shared auth-readiness weakness plus two separate product-state gaps:

1. **Auth/session is not a hard readiness gate for server mutations.** The app can route into server-backed draft creation and video upload-intent while `useAuth()` may look signed in at the UI level but the Supabase client has no usable session for `auth.getUser()` or auth-required Edge Functions.
2. **Brand list surfaces collapse "auth/query not ready" into an empty array.** That can make brands visually disappear while the user still appears logged in.
3. **Server-loaded live events are intentionally read-only for non-cover edits.** The Save button is disabled by code whenever the live event came from the server and the patch is not cover-media-only.
4. **Step 4 video processing leaves stale status text after a failed upload-intent/processing call.** The screenshot state `Preparing secure video upload...` is exactly the text set before the edge call; failure paths do not clear it.

The exact Edge Function HTTP response for the user's video attempt is **not proven** from the provided logs. The logs prove `AuthSessionMissingError` in the same session and prove the video picker returned a valid 34-second MP4. The code proves an auth-missing or edge failure at upload-intent will leave the Step 4 UI looking stuck at the same text in the screenshot.

## Layman Explanation

The app currently has moments where it says, "you are logged in," but the database client is not actually ready to make authenticated calls yet. When the organiser immediately tries to create an event or prepare a video upload, the server asks "who is this?" and the client cannot answer.

Separately, some screens use an empty list as the fallback while brand data is still loading or disabled. So brands can look gone even when the user still owns them.

The live-event edit issue is a different problem: if the event was loaded fresh from the server instead of from the old local app memory, the edit screen only allows cover-media saves. Normal title/date/ticket edits are deliberately blocked, so the Save button stays grey.

## Reproduction Conditions Found

| Symptom | Reproduction condition proven |
| --- | --- |
| Create draft auth failure | Navigate to `/event/create` with a non-null `currentBrandId` while Supabase `auth.getUser()` has no session. `create.tsx` calls `createDraft(currentBrandId)` immediately and retries on failure. |
| Brands disappear | Any caller of `useBrandList()` during `user === null`, disabled brand query, query error, or auth transition receives `[]`; Account hides `Your brands` entirely when `brands.length === 0`. |
| Live event Save greyed out | Open `app/event/[id]/edit?mode=edit-published` for an event that is not present in local `liveEventStore`, so the route uses `businessEventQuery.data.event`. Any non-cover-only edit keeps Save disabled. |
| Step 4 video stuck text | Select a video, confirm trim, then have `createEventCoverVideoUploadIntent()` fail or reject. `videoStatusText` stays at the last status text because failure paths do not clear it. |

Runtime limitation: I could not retrieve Supabase function logs with this local CLI; `supabase functions logs` is unavailable in the installed binary. Therefore I cannot claim the user's specific upload-intent returned 401/403/500, only that the client and function contract make that failure path real.

## Evidence Table

| Area | Evidence | Meaning |
| --- | --- | --- |
| Auth bootstrap | `mingla-business/src/context/AuthContext.tsx:112-145` sets `session/user`, then does creator-account work, then `setLoading(false)`; `onAuthStateChange` sets `session/user` at `:154-155` and clears stores only on `SIGNED_OUT` at `:180-188`. | UI state and Supabase session restoration are not exposed as a single "auth ready for mutations" contract. |
| Create route | `mingla-business/app/event/create.tsx:43-61` reads `currentBrandId`, calls `createDraft(currentBrandId)` immediately, and retries by setting `hasStarted(false)` on catch. | A stored brand pointer is enough to start a server mutation; no `loading/session/user` guard exists. |
| Draft service | `mingla-business/src/services/eventDrafts.ts:48-56` calls `supabase.auth.getUser()` and throws any auth error; `createServerDraft()` calls this at `:154-159`. | The user log matches this path exactly: `AuthSessionMissingError` from `useCreateServerDraft`. |
| Create hook | `mingla-business/src/hooks/useServerDraftEvents.ts:243-259` logs `[useCreateServerDraft] Operation failed:` on any mutation error. | Explains the exact console label. |
| Brand list shim | `mingla-business/src/hooks/useBrandListShim.ts:23-27` returns `query.data ?? []`. | Disabled/loading/error states become an empty brand list. |
| Brand query | `mingla-business/src/hooks/useBrands.ts:103-115` disables the list query when `accountId === null`. | A transient `user === null` makes the shim return `[]`. |
| Account UI | `mingla-business/app/(tabs)/account.tsx:55-57` uses `useBrandList()`; `:169-200` renders `Your brands` only when `brands.length > 0`. | Brands can visually disappear with no loading/error message. |
| Current brand recovery | `mingla-business/src/hooks/useCurrentBrandRecovery.ts:21-41` keys recovery off `user?.id`; `isResolving` is false when `userId === null` at `:97-103`. | Recovery does not protect no-user/auth-transition windows. |
| Current brand auto-clear | `mingla-business/src/hooks/useCurrentBrand.ts:34-45` clears `currentBrandId` when `useBrand(currentBrandId)` fetches `null`. | If a brand detail query resolves no row under missing auth/RLS/access conditions, the selected brand pointer can be cleared. |
| Store clearing | `mingla-business/src/utils/clearAllStores.ts:30-42` resets current brand, drafts, live events, orders, guests, scan, team, and prefs. | Correct on real sign-out; high blast radius if a transient `SIGNED_OUT` event occurs. I did not prove such an event happened in the current log. |
| Edit route server-loaded flag | `mingla-business/app/event/[id]/edit.tsx:83-115` resolves local `liveEvent` and server `businessEventQuery.data.event`; `:327-334` passes `disableLocalSaveReason` when `liveEvent === null`. | Server-loaded published events are explicitly marked readable/limited. |
| Edit save disabled | `mingla-business/src/components/event/EditPublishedScreen.tsx:855-860` disables Save when `disableLocalSaveReason !== undefined && !canSaveServerCoverMediaOnly`. | Non-cover edits cannot be saved for server-loaded events. |
| Cover-only exception | `EditPublishedScreen.tsx:135-151`, `:328-330`, `:556-599` allow cover-media-only patches to write server cover media. | This is why media cover replacement can work while normal live-event edits stay disabled. |
| Video upload status | `mingla-business/src/components/event/CreatorStep4Cover.tsx:224-235` sets `Preparing secure video upload...` then calls `createEventCoverVideoUploadIntent()`. | Screenshot text marks the pre-intent phase. |
| Video failure handling | `CreatorStep4Cover.tsx:386-407` catches errors and clears uploading flags but does not clear `pendingVideo` or `videoStatusText` on failure. | UI can remain on stale "Preparing secure video upload..." text after failure. |
| Video service | `mingla-business/src/services/eventCoverVideoProcessingService.ts:73-88` invokes `event-cover-video-upload-intent` and throws `edge_error` on error. | No local session guard or detailed response handling exists before the edge call. |
| Upload intent auth | `supabase/functions/event-cover-video-upload-intent/index.ts:28-30` requires a user; shared helper `eventCoverVideo.ts:58-71` requires `Authorization: Bearer ...` and returns 401 if absent/invalid. | Missing Supabase session blocks the video processing handoff. |
| Edge config | `supabase/config.toml:21-25` only disables JWT verification for `event-cover-video-webhook`; upload-intent/status/apply use default auth-required gateway behavior plus in-function auth checks. | User-facing video actions depend on a valid app session token. |
| ORCH-0770 history | `TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md` says real phone-video job row/public playback runtime was still unverified. | The pipeline was static/deploy-verified, not fully user-journey proven. |
| Tests run now | `npm run test:orch-0756a`, `npm run test:orch-0756b`, `npm run test:orch-0770` all passed. | Existing guards do not cover this auth-ready regression. |

## Causal Chains

### 1. Auth Missing During Create Draft

Classification: **confirmed bug / invariant violation**

Six-field proof:

1. File/line: `app/event/create.tsx:47-61`, `eventDrafts.ts:48-56`, `useServerDraftEvents.ts:243-259`.
2. Exact code: create route starts `createDraft(currentBrandId)` solely from persisted `currentBrandId`; service calls `supabase.auth.getUser()`; hook logs any error.
3. Current behavior: a non-null brand pointer can trigger draft creation before the Supabase auth session is available, causing `AuthSessionMissingError`.
4. Expected behavior: no server draft creation should start until auth/session is ready and a user access token exists.
5. Causal chain: login/bootstrap/session transition -> `currentBrandId` exists -> `/event/create` starts mutation -> `auth.getUser()` has no session -> Supabase throws `AuthSessionMissingError` -> hook logs and route retries.
6. Verification step: mock `useCurrentBrandId()` as non-null and `supabase.auth.getUser()` as `AuthSessionMissingError`; assert `/event/create` does not call `createDraft` until auth-ready, after fix.

### 2. Brands Disappear While Logged In

Classification: **likely bug with confirmed code path**

The exact operator session transition was not captured, but the code path is deterministic:

1. `useBrandList()` uses only `user?.id`; if `user` is null, query is disabled and the hook returns `[]`.
2. Account renders no `Your brands` section for `[]`.
3. Home has better empty/loading handling than Account, but still keys brand list off `user?.id`.
4. Brand recovery does not mark itself resolving when `userId === null`, so it cannot protect a transient auth gap.
5. `clearAllStores()` and `queryClient.clear()` would wipe stores and caches on a real or transient `SIGNED_OUT`, but the current log does not prove `SIGNED_OUT` fired.

Six-field proof:

1. File/line: `useBrandListShim.ts:23-27`, `useBrands.ts:103-115`, `account.tsx:169-200`.
2. Exact code: `return query.data ?? []`; `enabled = accountId !== null`; Account renders brands only if `brands.length > 0`.
3. Current behavior: auth/loading/disabled/error and "real zero brands" share the same visible `[]` result on Account.
4. Expected behavior: Account and brand-dependent screens should distinguish loading, signed-out, auth-refreshing, error, and true empty brand list.
5. Causal chain: auth user unavailable or query disabled -> `useBrands(null)` has no data -> shim returns `[]` -> Account hides brands -> operator sees brands disappear until logout/login restores session/query state.
6. Verification step: component test with authenticated UI shell but `useAuth.user = null/loading` or brand query disabled should not render a true empty brand state or hide brand management without loading/error copy.

### 3. Live Event Edit Save Remains Disabled

Classification: **confirmed product/implementation gap**

This is not primarily an auth bug.

Six-field proof:

1. File/line: `app/event/[id]/edit.tsx:83-115`, `:327-334`; `EditPublishedScreen.tsx:855-860`.
2. Exact code: when `liveEvent === null`, route passes `disableLocalSaveReason`; Save is disabled if that reason exists and the patch is not cover-media-only.
3. Current behavior: server-loaded published events can be viewed and cover media can be saved, but normal edits cannot be saved.
4. Expected behavior: an authorised organiser editing a live event loaded from the server should either be able to save supported fields through a server mutation/RPC, or the UI must clearly present the screen as read-only before edits are made.
5. Causal chain: latest event-system work allows server-loaded published events -> local `liveEventStore` may not contain the event after new build/logout/cache loss -> route uses server event detail -> `disableLocalSaveReason` set -> user edits title/date/etc. -> patch is not cover-media-only -> Save disabled.
6. Verification step: open a server-loaded published event not present in `liveEventStore`, edit title, assert the Save button is enabled only after a real server edit mutation exists; current code keeps it disabled.

### 4. Step 4 Video Upload Stuck at Secure Upload / Edge Handoff

Classification: **confirmed client UI bug; exact edge response unproven**

The video symptom is not proven to be a Cloudinary processing failure. The provided log stops after picker selection and contains no upload-intent/job id/status evidence.

Six-field proof:

1. File/line: `CreatorStep4Cover.tsx:224-235`, `:386-407`; `eventCoverVideoProcessingService.ts:73-88`; `event-cover-video-upload-intent/index.ts:28-30`; `_shared/eventCoverVideo.ts:58-71`.
2. Exact code: UI sets `videoStatusText` to `Preparing secure video upload...`, calls upload-intent, catches errors without clearing that status, while the edge function requires a valid bearer token.
3. Current behavior: if auth is missing or the intent call fails, the organiser can remain seeing the stale "Preparing secure video upload..." line and the hue fallback preview.
4. Expected behavior: upload-intent should not be attempted until auth-ready; failures should transition to an explicit failed/retry state and clear stale progress copy.
5. Causal chain: user selects 34-second MP4 -> trim panel shown -> `Use this clip` -> status set to preparing -> upload-intent needs auth -> same session already proved Supabase auth missing for draft creation, or another edge error occurs -> error is toasted but `videoStatusText` persists -> screenshot appears stuck with no processed cover.
6. Verification step: mock `createEventCoverVideoUploadIntent()` to reject with 401/edge error; current component leaves `videoStatusText` stale. After fix it must show failed/retry copy and keep old cover/hue unchanged.

## Shared or Split?

Split into **three implementation tracks**, but fix auth readiness first because it can poison the others.

| Track | Why |
| --- | --- |
| ORCH-0774A auth-ready + brand-list honesty | Shared root for create draft auth error, disappearing brands, and auth-required video handoff risk. |
| ORCH-0774B server-loaded live-event edit save | Separate missing server edit mutation/product contract. Save disabled is currently intentional for non-cover edits. |
| ORCH-0774C Step 4 video processing failure UX | Closely related to auth for upload-intent, but also needs its own failed/retry state even for non-auth provider errors. |

Do not reopen ORCH-0770 broadly unless runtime job evidence shows Cloudinary processing/webhook itself failed after a valid upload-intent and source upload.

## Blast Radius

| Surface | Impact |
| --- | --- |
| Business Home | Can show loading/choose-brand/empty inconsistently if auth user or brand query is transient. Build-event CTA depends on current brand readiness. |
| Account / Your brands | Highest brand-visibility risk: `useBrandList()` returns `[]` and Account hides the whole brand list. |
| Event create | Confirmed: can call server draft creation while Supabase session is missing. |
| Event edit draft | Legacy migration uses `createServerDraft()` directly in `edit.tsx:140-159`; same auth-missing class can affect local-to-server draft migration. |
| Live event edit | Confirmed: server-loaded events disable non-cover saves. |
| Media cover upload runtime | Video upload-intent/status/apply require auth; Step 4 has no auth-ready gate and stale failure text. Images/GIFs use direct storage path and are less implicated by this specific log. |
| ORCH-0770 pipeline | Static/deploy checks still pass, but real runtime remains sensitive to auth-ready and failed-state UX. |
| Stripe/brand role gates | Not directly proven, but role hooks also key off `user?.id` and `useBrandList()`; they can default-closed during auth gaps. |
| Public event runtime | Not directly implicated by this ORCH. Public video playback was ORCH-0770; current report is about organiser upload/edit state. |

## Product Severity

**S1 launch blocker for Mingla Business organiser trust.**

The affected promise is core: sign in, see my brands, create an event, edit a live event, upload a cover, and save. The issue is especially dangerous because it can look like data loss even when the server data still exists.

## Required Implementation Direction

### ORCH-0774A: Auth-Ready and Brand Honesty Contract

- Add an explicit auth-ready contract exposed by `AuthContext`: not just `user`, but "Supabase session/access token is restored and usable for authenticated DB/function calls."
- Gate `/event/create`, legacy draft migration, draft autosave, upload-intent/status/apply, brand role queries, and other authenticated mutations behind that contract.
- Treat `AuthSessionMissingError` as a transient auth-not-ready state during bootstrap, not as a generic repeated mutation failure.
- Stop retry loops that hammer `createServerDraft()` while auth is missing.
- Refactor `useBrandList()` or its callers so disabled/loading/error are not converted to true empty brands.
- Account must render loading/error/recovering states for `Your brands`; it must not silently hide owned brands because query data is undefined.
- Do not remove `clearAllStores()` for real sign-out, but add instrumentation/dev logging around auth events and store clearing so a transient sign-out can be proven if it happens.

### ORCH-0774B: Server-Loaded Published Event Edit Save

- Decide and implement the supported live-edit server mutation contract.
- If full live-event editing is in scope, add a server-backed update path for allowed fields and replace the `disableLocalSaveReason` read-only gate.
- If only cover edits are currently supported, make the screen honest before editing: non-cover sections should be disabled/read-only with clear copy, not editable with a grey Save button.
- Preserve existing cover-media-only apply path unless superseded by a unified edit mutation.

### ORCH-0774C: Video Upload Failure State

- Before calling `event-cover-video-upload-intent`, require auth-ready and a server event id.
- Add a real failed state for upload-intent/source-upload/status failures:
  - clear stale `Preparing secure video upload...`;
  - show a persistent inline error;
  - allow retry with the same selected clip;
  - preserve the previous cover/hue until a processed derivative is ready.
- Log structured dev info for `upload-intent-start`, `upload-intent-failed`, `source-upload-start`, `status-poll-failed`, and include job id when present.
- Do not change Cloudinary transcoding unless runtime evidence shows a valid job fails after upload-intent/source upload.

## Tests Implementor Must Add

These must ship in the same scoped commit as the fix.

| Test | Why it fails today |
| --- | --- |
| `/event/create` auth gate test: non-null `currentBrandId` + auth loading/missing session does not call `createDraft`. | Current route starts immediately from `currentBrandId`. |
| `AuthSessionMissingError` create-draft handling test: no retry loop/log storm while auth is restoring; mutation starts after session is ready. | Current catch resets `hasStarted` and retries. |
| Account brand-list state test: `useAuth.user` null/loading or query disabled does not render true empty/hide brands as if none exist. | `useBrandList()` returns `[]`; Account renders nothing. |
| Brand recovery auth-transition test: recovery remains resolving or guarded while auth is not ready. | `isResolving` false when `userId === null`. |
| Server-loaded live-event edit test: edit title/date on server-loaded event either enables server save or renders field read-only by contract. | Current non-cover patch leaves Save disabled. |
| Cover-only server-loaded edit regression test. | Current cover-only exception should keep working. |
| Video upload-intent failure UI test: mocked edge reject clears `Preparing secure video upload...`, shows persistent retryable error, keeps old cover. | Current failure leaves stale status. |
| Video auth gate test: no upload-intent call until auth-ready/session token exists. | Current component calls service directly. |
| Edge auth contract test or Deno test: missing/invalid bearer token returns structured 401 and client maps it to auth/retry copy. | Current client maps all edge errors through generic `edge_error`. |

## Runtime Gates for Tester

1. Fresh app launch after logout/login: existing brands never disappear; Account shows loading/recovered/brands honestly.
2. Start a new event immediately after login: no `AuthSessionMissingError`; one server draft row is created once.
3. Start a new event during deliberate network/auth restoration delay if possible: app waits, does not log retry storm.
4. Open an existing live event loaded from server with local stores cleared: edit allowed fields and save, or confirm fields are intentionally read-only before editing.
5. Upload short phone video: upload-intent creates a job, source upload completes, processed MP4 applies, preview updates.
6. Upload >15s phone video: trim, process, preview updates, no stale `Preparing secure video upload...`.
7. Force upload-intent auth failure in dev/sandbox: persistent inline retry state appears, old cover remains.
8. Public event page browser check remains ORCH-0770 gate: processed MP4 plays/loops and is not black.

## Historical Context Accounted For

- ORCH-0756A fixed active-brand resolver logic statically, but runtime sign-out/sign-in smoke was previously blocked/unverified. ORCH-0774 shows a new auth-transition failure class around that area.
- ORCH-0756B moved drafts server-side, but `/event/create` still lacks auth-ready gating before `createServerDraft`.
- ORCH-0763 repaired server-backed published event hydration. ORCH-0774 exposes the remaining edit mutation gap for server-loaded published events.
- ORCH-0768 restored Account `Your brands`, but the restored list still uses a shim that collapses loading/disabled/error into `[]`.
- ORCH-0773 fixed stale draft lifecycle/PGRST116 and was operator-accepted. This report does not reopen it; the new create error is `AuthSessionMissingError`, not stale-row `PGRST116`.
- ORCH-0770 introduced the Cloudinary processing path and deploy/static checks passed. Runtime full journey was explicitly unverified; ORCH-0774 adds auth/failure-state evidence before the provider layer.
- Commit `0cfce5ee Bundle event media lifecycle fixes` touched event media, edit, draft lifecycle, and ORCH-0770 functions, but did not fundamentally add the missing auth-ready invariant in `AuthContext`/`/event/create`/`useBrandList`.

## Verification Performed

Commands run:

```text
cd mingla-business && npm run test:orch-0756a
cd mingla-business && npm run test:orch-0756b
cd mingla-business && npm run test:orch-0770
```

Results:

- `test:orch-0756a`: PASS, active-brand recovery guard and 6 resolver tests passed.
- `test:orch-0756b`: PASS, 2 suites / 31 tests passed.
- `test:orch-0770`: PASS, strict guard passed and TypeScript completed successfully.

These passing tests confirm older contracts but do **not** cover the auth-ready and failure-state issues proven above.

## Explicit Non-Goals

- No Giphy/Pexels work.
- No new Cloudinary/video-processing architecture unless a later runtime job row proves ORCH-0770 provider processing itself failed.
- No Stripe onboarding rework unless a specific brand-role/Stripe auth failure is captured.
- No broad visual redesign.
- No product code changes in this forensic pass.
