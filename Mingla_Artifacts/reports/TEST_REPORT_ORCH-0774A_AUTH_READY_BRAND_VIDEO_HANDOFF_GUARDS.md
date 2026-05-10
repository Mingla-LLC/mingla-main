# TEST REPORT ORCH-0774A - Auth-Ready Brand Video Handoff Guards

Verdict: CONDITIONAL PASS - static gates passed, limited simulator runtime passed, full picker/fresh-login runtime still needs operator-assisted proof  
Date: 2026-05-10  
Tester mode: TARGETED / SPEC-COMPLIANCE / RUNTIME-SMOKE  
Prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`

## Plain-English Verdict

The implementation is code-sound against the ORCH-0774A contract and the focused regression gates pass. I also verified a limited authenticated simulator slice: Account showed the user's brands instead of disappearing, and opening the create-event route produced a **Server draft** wizard screen rather than an auth error.

This is not a full runtime PASS because I could not perform fresh sign-in, sign-out, media picker, image/GIF upload, or video upload/processing interactions with the available CLI harness. Those are the remaining conditions before orchestrator should close ORCH-0774A.

## Evidence Inputs Read

- `Mingla_Artifacts/specs/SPEC_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md`

## Static Gates

Run from `mingla-business`:

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

Run from repo root:

```bash
git diff --check
```

Result: PASS.

Note: Jest emitted the existing Watchman recrawl warning. It did not fail any gate.

## Code Evidence

### Auth-ready contract

Verified:

- `mingla-business/src/utils/authReadiness.ts` defines `BusinessAuthStatus`, `BusinessAuthNotReadyError`, `hasUsableBusinessSession`, `deriveBusinessAuthStatus`, `requireBusinessAuthReady`, and Supabase `AuthSessionMissingError` mapping.
- `mingla-business/src/context/AuthContext.tsx` exposes `authStatus`, `isAuthReady`, `hasUsableSession`, and `authError`.
- True `SIGNED_OUT` still calls `clearAllStores()` and `queryClient.clear()`.

Residual note:

- This was verified by code/static tests, not by a real sign-out runtime click.

### Brand-list honesty

Verified:

- `mingla-business/src/utils/brandListState.ts` distinguishes `auth_loading`, `signed_out`, `query_disabled`, `query_loading`, `ready`, `empty`, and `error`.
- `mingla-business/src/hooks/useBrandListShim.ts` adds `useBrandListState()`.
- `mingla-business/app/(tabs)/account.tsx` uses `brandList.status` and renders loading/error/empty separately instead of treating unresolved query state as empty.
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` uses `useBrandListState()` and avoids auto-create mode unless the result is true empty.

Limited runtime proof:

- Booted simulator: iPhone 17 Pro, UDID `17091E60-C3B6-4167-980D-60C348E177F6`.
- Installed app: `com.sethogieva.minglabusiness`.
- Authenticated state visible on Home for brand `Leggo This`.
- Account deep link screenshot showed the **Your brands** card populated with `Carry Test`, `Brand 3`, `Test Stripe`, and `Leggo This`; brands did not disappear in this logged-in slice.
- Screenshot captured at `/tmp/orch0774a-account.png`.

### Create-event auth guard

Verified:

- `mingla-business/app/event/create.tsx` waits for `isAuthReady` and `currentBrandRecovery.isResolving === false` before `createDraft(currentBrandId)`.
- The loading label switches to `Finishing sign-in…` when auth/recovery is not ready.
- `useCreateServerDraft()` calls `requireBusinessAuthReady(authStatus, session)` before `createServerDraft`.
- `eventDrafts.requireUserId()` maps Supabase auth session errors to `BusinessAuthNotReadyError`.

Limited runtime proof:

- Opened `mingla-business://event/create` on the authenticated simulator.
- After ~3 seconds, the app showed Event Creator Wizard Step 1 with `Leggo This · Step 1 of 7` and `Server draft`.
- This proves a logged-in create route reached a server draft rather than the earlier visible auth failure.
- Screenshot captured at `/tmp/orch0774a-create.png`.

Limitation:

- I could not prove fresh-login timing from signed-out state with CLI-only control.

### Draft autosave and migration

Verified by code/static gate:

- `useServerDraftsForBrand()` query/migration is disabled until `brandId !== null && isAuthReady`.
- Legacy migration catches typed auth-not-ready without generic error logging and clears in-flight state in `finally`.
- `useServerDraftAutosave()` defers `saveDraft()` when `!isAuthReady`.
- Autosave typed auth-not-ready does not delete drafts, mark drafts saved, or surface as generic mutation failure.

Limitation:

- I did not runtime-edit fields/background/foreground to prove no auth-missing autosave storm because CLI-only simulator control cannot reliably type and navigate the wizard.

### Step 4 cover video handoff

Verified by code/static gate:

- `CreatorStep4Cover` gates image/GIF, video pick, and trim confirmation behind `isAuthReady`.
- Video processing errors clear `videoStatusText`, set persistent `videoErrorText`, and toast the same message.
- Short-video failure preserves `pendingVideo` because the selected asset is assigned before processing and only cleared after success.
- Long-video trim selection preserves `pendingVideo` and `trimStartMs`.
- Previous `draft.coverMediaUrl`, `draft.coverMediaType`, and `draft.coverHue` are only updated after successful upload/process result.
- `onCoverVideoProcessingChange?.(false)` is called from `finally` around pick/confirm flows.

Verified service mapping:

- `eventCoverVideoProcessingService` maps `{ error: "unauthenticated" }` and Edge 401 to `BusinessAuthNotReadyError`.
- Provider, validation, forbidden, not found, job-not-ready, source upload, malformed, timeout/provider failure, and fallback errors stay distinguishable.
- Signed upload fields are appended to `FormData` but are not logged by the service.

Limitation:

- I could not runtime-pick an image/GIF or video from the simulator because the repo has no available UI automation harness for native picker flows, and shell `simctl` cannot drive those touches reliably.

## Runtime Coverage Matrix

| Gate | Status | Evidence |
| --- | --- | --- |
| A. Fresh login / brand honesty | PARTIAL | Logged-in Account showed brands; fresh sign-in transition not verified. |
| B. Create event auth guard | PARTIAL PASS | Deep link to create produced a `Server draft` wizard screen; no visible auth error. |
| C. Draft autosave / migration | STATIC PASS / RUNTIME UNVERIFIED | Code gates passed; no field-edit/background runtime proof. |
| D. Step 4 image/GIF smoke | STATIC PASS / RUNTIME UNVERIFIED | Code gates passed; picker not exercised. |
| E. Step 4 video handoff | STATIC PASS / RUNTIME UNVERIFIED | Code gates passed; picker/upload not exercised. |
| F. Step 4 failure recovery | STATIC PASS / RUNTIME UNVERIFIED | Failure states are implemented; failure not induced. |
| G. True sign-out | STATIC PASS / RUNTIME UNVERIFIED | `SIGNED_OUT` cleanup preserved in code; sign-out click not exercised. |

## Findings

No P0/P1 blocker was proven in this tester pass.

### P2 - Full runtime proof remains operator-assisted

The code and static gates are strong, and the limited logged-in simulator smoke is positive. However, the central user-reported symptoms include fresh auth restoration, picker-driven media upload, video processing failure states, and sign-out cleanup. Those require touch/picker runtime interaction or operator-assisted testing.

Required before close:

- Fresh sign-in while watching Account/Home/BrandSwitcher and logs.
- Create event immediately after sign-in/session restore.
- Edit wizard fields and background/foreground the app to watch autosave.
- Upload image/GIF on Step 4.
- Upload a short video on Step 4.
- Induce or observe a video handoff failure and confirm inline retryable error.
- Intentional sign-out and verify private state clears.

## Verdict

CONDITIONAL PASS.

Static/spec compliance passed and limited authenticated simulator runtime passed. Do not close ORCH-0774A yet. Dispatch or perform the remaining operator-assisted runtime gates above, then return to orchestrator with either PASS evidence or a focused rework finding.
