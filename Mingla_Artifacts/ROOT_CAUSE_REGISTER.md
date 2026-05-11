# Root Cause Register

> Last updated: 2026-05-09
> Last updated: 2026-05-11
> Proven root causes with causal clusters.

## Root Causes

### RC-PR69: Admin Vercel deployment payload excluded the admin package
- **Discovery date:** 2026-05-09
- **Proof:** Failed admin Vercel deployment logged `ENOENT: no such file or directory, open '/vercel/path0/mingla-admin/package.json'` while running `npm run build`. PR 69 final status then showed `Vercel - mingla-admin` SUCCESS after commit `466d98f2`, and PR 69 merged at `89e107340920e39f9546d7947419d014d6a9d517` with all checks successful. Close report: `reports/CLOSE_PR-69_ADMIN_VERCEL_AND_CI_CHECKS.md`.
- **Symptoms caused:** Admin preview deployment failed before build compilation because npm could not find `mingla-admin/package.json` inside the Vercel deployment root.
- **Causal chain:**
  1. Vercel configured the admin project to build from `/vercel/path0/mingla-admin`.
  2. The repo-level `.vercelignore` excluded `mingla-admin/` from the uploaded deployment payload.
  3. Vercel still entered the configured admin root and ran `npm run build`.
  4. npm failed before dependency resolution or compilation because `package.json` was absent.
- **Structural fix:** `.vercelignore` now allows `mingla-admin/` into the deployment payload while continuing to exclude admin `.env`, `dist/`, and `node_modules/`. Related PR checks also repaired strict invariant gates and made the event-cover storage migration compatible with the CI storage schema.
- **Status:** **CLOSED PASS 2026-05-09**. Evidence: final PR head `291de92684a3b770d9776b25aa75f96350a6f551` had successful admin/business/marketing Vercel contexts, Supabase Preview, migration baseline, Deno Stripe tests, docs-artifact-regression, GitGuardian, and strict grep gates before merge.
- **Invariant / regression guard:** Vercel deployment ignore rules must never exclude a configured project root that Vercel is expected to build. Ignore project-local generated outputs and secrets, not the package directory itself.
- **Causal cluster:** Cluster 6: deployment packaging/config drift can masquerade as an application build failure.
- **Follow-ups not part of RC:** ORCH-0764B/0764C Stripe runtime gates, ORCH-0763 event/share runtime gates, and product QA remain separate.
### RC-0777: Organizer Orders queried nonexistent `orders.brand_id`; failed-terminal notification rows were outside retry selection
- **Discovery date:** 2026-05-11
- **Proof:** `reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md` proved `mingla-business/src/services/eventOrdersService.ts` selected `brand_id` directly from `orders`, while production `orders.brand_id` does not exist. The same investigation proved the operator's free-checkout notification rows created during the provider repair window were `failed_terminal`, which the dispatcher retry selector intentionally ignores.
- **Symptoms caused:** Organizers saw false-empty Orders/revenue/guest/sold/activity surfaces even though durable checkout rows existed; the operator's free ticket confirmation would not revive without explicit state repair because terminal rows are not polled.
- **Structural fix:** `eventOrdersService` now sources brand identity through `events!inner(brand_id)`, preserves `OrderRecord.brandId`, and the Orders screen renders an honest load error instead of falling through to "No orders yet" on query failure. Regression coverage was added through `ticketCheckoutMigrationGuards.test.ts`, `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`, and the strict-grep workflow job. The targeted failed-terminal notification rows were revived without migration or Edge Function deploy.
- **Status:** **CLOSED PASS 2026-05-11**. Evidence: spec `specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`; implementation `reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`; QA `reports/QA_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`; close note `CLOSE_NOTE_ORCH-0777.md`; operator attestation accepted the residual Twilio external lane and confirmed Orders/tickets.
- **Invariant / regression guard:** Organizer order queries must source brand identity from the event relation, not from a nonexistent `orders.brand_id` column; failed-terminal notification revival must be deliberate, privacy-safe, and idempotent.
- **Causal cluster:** Cluster 2/3 crossover: schema/source-of-truth mismatch plus notification state-machine terminal classification.
- **Follow-ups not part of RC:** ORCH-0782 owns organizer "Resend ticket" CTA and notification rollup recompute. Twilio toll-free / Messaging Service sender configuration remains an external provider lane unless a future proof shows a Mingla code regression.

### RC-0781: Clean-tree sweep reverted Stripe web boundary and removed its guard wiring
- **Discovery date:** 2026-05-11
- **Proof:** `reports/INVESTIGATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md` proves commit `ca69de38` changed `mingla-business/app/_layout.tsx` back to direct `@stripe/stripe-react-native` import/`StripeProvider`, changed `mingla-business/app/checkout/[eventId]/payment.tsx` back to direct `useStripe` while removing the web unsupported short-circuit, removed `mingla-business/package.json` script `test:orch-0778`, and replaced the `.github/workflows/strict-grep-mingla-business.yml` ORCH-0778 CI job slot with ORCH-0776D. `b7431fe1` restored only the two product-code files. ORCH-0781 implementation `14c3b59d` then restored the missing npm/CI/push wiring and made the gate self-validate those layers.
- **Symptoms caused:** Mingla Business Web became undeployable when Stripe React Native pulled native-only React Native internals into the Expo web bundle; the failure surfaced during ORCH-0779 Vercel deploy work instead of through the intended repo-time guard. At HEAD, production web builds again, but future direct `@stripe/stripe-react-native` imports outside `.native` payment-boundary files are no longer protected by the documented npm command or CI job.
- **Causal chain:** ORCH-0778 closed with platform-resolved wrappers, `test:orch-0778`, and CI job `orch-0778-web-stripe-native-import-gate`; `ca69de38` performed a broad clean-tree sweep that restored pre-ORCH-0778 product file shapes and edited the guard files in the same commit; the workflow only triggered on `pull_request`, so direct pushes to `Seth` bypassed every strict-grep gate even if the job had still existed; Vercel/web export caught the native-only import chain later; `b7431fe1` fixed the product files but left npm/CI guard wiring disarmed.
- **Structural fix:** Closed by ORCH-0781: restored `test:orch-0778`, restored the CI job as a sibling without removing ORCH-0776D, added `push` triggers for `main` and `Seth`, and added self-wiring checks that fail on missing npm script, CI job, or push trigger.
- **Status:** **CLOSED PASS 2026-05-11**. Evidence: implementation `reports/IMPLEMENTATION_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`; QA PASS `reports/QA_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`; close note `CLOSE_NOTE_ORCH-0781.md`; branch HEAD `14c3b59d`.
- **Invariant / regression guard:** `@stripe/stripe-react-native` may appear only in approved `.native` Mingla Business payment-boundary files. The local npm command and CI job named by `I-PROPOSED-AE` must exist and must run on both pull requests and direct pushes for protected branches.
- **Causal cluster:** Cluster 5/6 crossover: release/provenance drift plus external/native package boundary enforcement disarmed by broad branch cleanup.
- **Follow-ups not part of RC:** D-0781-2 should audit ORCH-0776A and ORCH-0777 strict-grep scripts that appear npm-wired but not CI-wired. ORCH-0777 checkout backend, B2 Connect, scanner, Resend/Twilio, QR pepper, and native live-fire remain separate.

### RC-0779: Supabase Auth Site URL pointed web OAuth callbacks at Expo Go
- **Discovery date:** 2026-05-11
- **Proof:** ORCH-0779 Web callback forensics predicted the allow-list/Site URL failure class in `.worktrees/orch-0779-business-android-google-signin-developer-error/Mingla_Artifacts/reports/FORENSIC_HYPOTHESIS_ORCH-0779_WEB_CALLBACK.md`. The confirmed Supabase Auth project `gqnoajqerqhnvulmnyvv` state had `site_url = "exp://*"` and lacked the production/preview business web redirect allow-list entries, so rejected `redirectTo` values fell back to the Expo Go URL and Safari reported an invalid address.
- **Symptoms caused:** Production Web Google sign-in could launch Google account selection but could not return into authenticated Mingla state; Safari/web callback could fall through to `exp://*`. Android native sign-in was unaffected by this Web callback root cause because Android used the native ID-token flow and separately passed after the Google Cloud Android OAuth tuple was correct.
- **Structural fix:** Supabase Management API patch changed `site_url` to `https://business.usemingla.com` and appended business production, Vercel preview, wildcard preview, and localhost `8091` redirect patterns while preserving prior demo/admin/marketing/Expo/localhost entries. Production deploy `dpl_CPQgBkaXa5nTvVNsCgeAe1UVQ6M5` was aliased to `https://business.usemingla.com`.
- **Status:** **CLOSED PASS 2026-05-11**. Evidence: QA report `.worktrees/orch-0779-business-android-google-signin-developer-error/Mingla_Artifacts/reports/QA_ORCH-0779_BUSINESS_ANDROID_GOOGLE_SIGNIN_DEVELOPER_ERROR.md` §11-§12; pushed commit `b7431fe1`; operator-confirmed production Web authenticated state.
- **Invariant / regression guard:** Supabase Auth Site URL must be the public HTTPS domain for the surface initiating web OAuth; `exp://*` is Expo Go-only and cannot be the project-wide fallback for web. `uri_allow_list` must include every production custom domain and Vercel preview pattern for each web surface that calls `signInWithOAuth`.
- **Causal cluster:** Cluster 1/6 crossover: external auth provider redirect authority misconfigured relative to production web host.
- **Follow-ups not part of RC:** ORCH-0781 owns the separate Stripe web import regression caused by `ca69de38`; ORCH-0777 owns checkout live-fire/native PaymentSheet.

### RC-0774A: Auth/session readiness is not a hard gate for business server mutations
- **Discovery date:** 2026-05-10
- **Proof:** `reports/INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md` traces the logged `[useCreateServerDraft] AuthSessionMissingError` to `/event/create` calling `createDraft(currentBrandId)` solely from a persisted brand pointer while `createServerDraft()` immediately calls `supabase.auth.getUser()`. The same missing-session class can block auth-required video upload-intent/status/apply functions.
- **Symptoms caused:** New event creation can fail or retry after login with `AuthSessionMissingError`; Step 4 video upload handoff can fail before source upload when no bearer token is available; auth-required business operations can emit noisy errors while the UI still appears signed in.
- **Causal chain:**
  1. AuthContext exposes `user/session/loading`, but app surfaces do not have one canonical "authenticated server calls are ready" gate.
  2. `currentBrandId` can exist from persisted local state.
  3. `/event/create` starts `createServerDraft()` from that pointer without proving `auth.getUser()` can succeed.
  4. Supabase auth has no restored session/access token yet.
  5. `auth.getUser()` throws `AuthSessionMissingError`, and the hook logs it as a generic operation failure.
  6. Video upload-intent/status/apply share the same session-token dependency through Supabase Edge Function auth.
- **Structural fix:** Approved spec `specs/SPEC_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`; implementation returned in `reports/IMPLEMENTATION_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`; orchestrator review `reports/REVIEW_IMPLEMENTATION_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`; tester prompt `prompts/TESTER_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`.
- **Status:** **OPEN - PARTIAL RUNTIME SMOKE PASSED / MANUAL GATES REMAIN 2026-05-10**. Static tester returned conditional pass in `reports/TEST_REPORT_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`; runtime smoke `reports/RUNTIME_QA_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md` proved logged-in Account brands and create-event `Server draft` with no forbidden auth/create/autosave signatures in the filtered window. Close still requires the remaining operator-assisted gates: fresh login, edit/autosave/background, Step 4 image/GIF, Step 4 video processing/failure recovery, and true sign-out; or explicit operator risk acceptance.
- **Invariant / regression guard:** Authenticated DB mutations and auth-required Edge Function calls must not start until auth/session is restored and usable. Transient auth restoration must not be treated as true sign-out or true empty data.
- **Causal cluster:** Cluster 1/4 crossover: auth/session source-of-truth gap plus mutation readiness contract gap.
- **Follow-ups not part of RC:** ORCH-0774B live-event server edit mutation, Giphy/Pexels, Cloudinary transcoding architecture, Stripe onboarding, and public playback remain separate.

### RC-0774B: Brand-list loading/error states collapse into an empty brand list
- **Discovery date:** 2026-05-10
- **Proof:** `reports/INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md` shows `useBrandList()` returns `query.data ?? []` while `useBrands(user?.id ?? null)` is disabled when `user` is null. Account renders `Your brands` only when `brands.length > 0`, so loading/disabled/error and true no-brands become visually identical.
- **Symptoms caused:** Organiser brands can appear to disappear while the user is still apparently logged in; Account can silently hide brand-management rows; Home/current-brand recovery can miscommunicate loading, no-selection, and empty states during auth transitions.
- **Causal chain:**
  1. Auth user is temporarily unavailable or a brand query is disabled/loading/error.
  2. `useBrandList()` returns `[]`.
  3. Account checks only array length.
  4. The `Your brands` card disappears with no loading/recovery/error state.
  5. Logout/login restores session/query data and the brands reappear.
- **Structural fix:** Covered by approved ORCH-0774A spec `specs/SPEC_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`; implementation returned in `reports/IMPLEMENTATION_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`; tester verification pending via `prompts/TESTER_ORCH-0774A_AUTH_READY_BRAND_VIDEO_HANDOFF_GUARDS.md`.
- **Status:** **OPEN - PARTIAL RUNTIME SMOKE PASSED / MANUAL GATES REMAIN 2026-05-10**. Runtime smoke proved the current logged-in Account brand list is populated and not silently empty; close still requires fresh-login transition proof and the remaining ORCH-0774A operator-assisted runtime gates, or explicit operator risk acceptance.
- **Invariant / regression guard:** "No brands" must only mean a fetched, authenticated, successful empty result. Loading, auth restoration, signed-out, and error are separate states.
- **Causal cluster:** Cluster 1/3 crossover: query state collapsed into false product data.
- **Follow-ups not part of RC:** ORCH-0768 count/identity honesty remains separate except where Account brand-list state is touched.

### RC-0774C: Server-loaded live-event edit screen intentionally disables non-cover saves
- **Discovery date:** 2026-05-10
- **Proof:** `reports/INVESTIGATION_ORCH-0774_AUTH_BRAND_LIVE_EVENT_EDIT_REGRESSION_CLUSTER.md` proves that `app/event/[id]/edit.tsx` passes `disableLocalSaveReason` when a published event is loaded from `useBusinessEventById` instead of local `liveEventStore`, and `EditPublishedScreen` disables Save when that reason exists and the patch is not cover-media-only.
- **Symptoms caused:** Organisers can open an already-live event, edit normal fields, and still see a greyed-out Save button. Cover-media-only updates can save, but title/date/ticket/settings edits cannot persist from server-loaded published events.
- **Causal chain:**
  1. ORCH-0763 enabled server-backed published-event hydration.
  2. Local `liveEventStore` may not contain the event after new build/logout/cache loss.
  3. The edit route uses server event detail.
  4. The route marks the screen server-loaded/read-only for local save.
  5. Non-cover edits are allowed in the UI but Save is disabled because no server edit mutation exists.
- **Structural fix:** Needs separate ORCH-0774B spec after ORCH-0774A, unless operator explicitly prioritizes live-event edit mutation first.
- **Status:** **OPEN - SPLIT FOLLOW-UP 2026-05-10**.
- **Invariant / regression guard:** A server-loaded published event edit surface must either support saving allowed fields through a server mutation or present non-cover sections as read-only before the organiser edits them.
- **Causal cluster:** Cluster 1: split local/server authority after server-backed event migration.
- **Follow-ups not part of RC:** Auth-ready and video handoff guards are ORCH-0774A.

### RC-0772: Native video cleanup called `pause()` after Expo player disposal
- **Discovery date:** 2026-05-09
- **Proof:** `reports/RUNTIME_QA_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_FAIL.md` reproduced the exact public event route-unmount failure after opening `mingla-business://e/leggothis/a-life-in-vegas` and routing away to Events: `FunctionCallException: Calling the 'pause' function has failed` caused by `NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object`.
- **Symptoms caused:** Repeated red iOS native errors after a public event video route unmounted or closed, even though the user had simply left the event page.
- **Causal chain:**
  1. Public event pages can render native `expo-video` covers.
  2. `EventCoverNativeVideo` cleanup called `player.pause()` while unmounting.
  3. Expo can dispose the native shared object before or during React cleanup.
  4. The cleanup `pause()` call then targets a JavaScript wrapper whose native object no longer exists.
  5. The iOS native layer emits `FunctionCallException` / `NativeSharedObjectNotFoundException`.
- **Structural fix:** `reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md` removed cleanup-time native pause and kept mounted pause paths for `shouldPlay === false` plus AppState inactive/background. Review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`; tester PASS: `reports/RETEST_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`; close review: `reports/CLOSE_REVIEW_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`.
- **Status:** **PRODUCT FIXED / CLOSE-READY; GIT LOCK-IN BLOCKED 2026-05-09**. Independent tester retest passed the exact public route-unmount smoke with zero disposed-player signatures. Final commit/push is blocked because the relevant code/test files overlap with earlier uncommitted media/audio lifecycle work, so a clean ORCH-0772-only commit cannot be safely staged from current `HEAD`.
- **Invariant / regression guard:** Native route-unmount cleanup must not call player methods on a potentially disposed `expo-video` shared object. Pause/play calls belong to mounted lifecycle transitions; cleanup should remove listeners/subscriptions only.
- **Causal cluster:** Cluster 4: media lifecycle side effect after native resource disposal.
- **Follow-ups not part of RC:** ORCH-0771 audible audio lifecycle and ORCH-0770 video processing/browser-safe playback remain separate.

### RC-0773: Stale local draft cache survived server draft lifecycle changes
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md` proved the active fixture: local AsyncStorage still contains a `DraftEvent` for id `98e880f3-43ef-47ab-a530-deaa117b21a7`, while the remote/public row for that same id is already `status = scheduled`, `visibility = public`, and `currency = USD`. The context read in `mingla-business/src/services/eventDrafts.ts` can see the row because it does not require draft status; the autosave update then filters `status = draft`, updates zero rows, and `.single()` emits `PGRST116`.
- **Symptoms caused:** Repeated `[useServerDraftAutosave]` `PGRST116` / `Cannot coerce the result to a single JSON object`; media/edit changes can appear local but fail to persist; ORCH-0770 runtime media verification is polluted by unrelated autosave failures.
- **Causal chain:**
  1. A server draft is published/promoted to a scheduled/public event.
  2. The business app still has a persisted local `DraftEvent` copy for the same id.
  3. Edit route/wizard can render that stale local draft instead of retiring it when the server draft detail is missing/non-draft.
  4. Autosave reads enough server context to build a save, then updates with `status = draft`.
  5. The update affects zero rows because the row is no longer a draft.
  6. `.single()` converts that lifecycle mismatch into repeated generic `PGRST116` errors instead of a typed stale-draft outcome.
- **Structural fix:** Approved spec `specs/SPEC_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`; implementor prompt `prompts/IMPLEMENTOR_REWORK_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`.
- **Status:** **PASS ACCEPTED BY OPERATOR 2026-05-09**. First implementation report: `reports/IMPLEMENTATION_REWORK_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`. First review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`. Route/test rework implementation: `reports/IMPLEMENTATION_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`; review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`; tester retest: `reports/RETEST_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`; retest review: `reports/REVIEW_RETEST_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`; runtime QA: `reports/RUNTIME_QA_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`; runtime review: `reports/REVIEW_RUNTIME_QA_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`; operator acceptance: `reports/OPERATOR_ACCEPTANCE_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`. Residual risk accepted: runtime stale-fixture proof unavailable.
- **Invariant / regression guard:** A non-local draft whose server row is missing, deleted, or no longer `status = draft` must be treated as a lifecycle transition, not an autosave error loop. Local draft cache must be retired or routed away before the wizard can keep editing/autosaving stale state.
- **Causal cluster:** Cluster 1/4 crossover: duplicate local/server state authority plus mutation result contract gap.
- **Follow-ups not part of RC:** ORCH-0770 Cloudinary/transcode/browser playback, ORCH-0771 audio lifecycle, ORCH-0772 native player teardown, Giphy/Pexels, brand/profile/ticket media, Stripe, and checkout remain separate.

### RC-0771: Event-cover video playback had no active-surface silence contract
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0771_EVENT_VIDEO_AUDIO_PERSISTS_AFTER_CLOSE.md` proves the public event hero can intentionally render audible native video (`muted={false}`), while `EventCoverMedia` starts/restarts playback through ready/autoplay/play-to-end/AppState-active paths and does not explicitly pause on close, route blur, AppState inactive/background, cleanup start, or `autoplay=false`.
- **Symptoms caused:** Video sound can continue after a public event page appears closed, especially if route unmount/release races with navigation, share-sheet return, AppState transitions, or hidden stack retention.
- **Causal chain:**
  1. Public event page renders an audible `EventCoverMedia` hero.
  2. The shared native video component treats `autoplay` plus ready/AppState active/play-to-end as sufficient to call `player.play()`.
  3. The component depends on eventual `useVideoPlayer` unmount cleanup, but does not pause immediately when the page becomes inactive or closes.
  4. AppState `active` replay is not gated by current route/surface visibility.
  5. A stale/hidden/still-mounted public event hero can continue or resume audio after the user leaves the page.
- **Structural fix:** Approved narrow spec `specs/SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`; orchestrator reviews: `reports/REVIEW_ORCH-0771_EVENT_VIDEO_AUDIO_PERSISTS_AFTER_CLOSE.md`, `reports/REVIEW_SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`, `reports/REVIEW_IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`, and `reports/REVIEW_TEST_REPORT_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`; implementation report `reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`; conditional tester report `reports/TEST_REPORT_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`; runtime tester prompt `prompts/TESTER_RUNTIME_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`.
- **Status:** **OPEN - CONDITIONAL STATIC PASS / RUNTIME VERIFY NEXT 2026-05-09**.
- **Invariant / regression guard:** Event-cover video may autoplay, loop, and auto-resume only while its surface is active and visible. Close, route deactivation, AppState inactive/background, cleanup, and `autoplay=false` must silence/pause the player immediately. Public-page autoplay and valid focused auto-resume must be preserved.
- **Causal cluster:** Cluster 4/6 crossover: media lifecycle side effect without an explicit screen-visibility authority.
- **Follow-ups not part of RC:** ORCH-0770 video transcode/compression, media upload validation, public video codec compatibility, safe-area chrome layout, Giphy/Pexels, brand/profile media, and ticket media remain separate.

### RC-0770: Public event cover videos accepted native-only QuickTime/HEVC assets as web-public media
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md` directly probed public Supabase event-cover objects and proved they are served as `video/quicktime` / `.mov`, include QuickTime/HEVC `hvc1` markers, lack H.264 `avc1` markers, and in at least one failing sample place `moov` after `mdat` rather than using fast-start ordering.
- **Symptoms caused:** Public event pages can show a black video hero or a still frame in browser; video playback can fail or not resume after share-sheet/app visibility changes; the sound/mute button can overlap public-page chrome and be hard to reach on mobile.
- **Causal chain:**
  1. The picker accepts iPhone-shot MOV/QuickTime videos.
  2. Upload/storage fixes allow those raw files into `event_covers`.
  3. The app saves the raw public URL as the event cover without proving browser-safe codec/container/metadata.
  4. Browser public pages receive `video/quicktime` HEVC assets instead of MP4/H.264/AAC fast-start derivatives.
  5. Browser playback fails even though native app playback may work.
  6. Public media sound control is positioned independently from close/share chrome, creating mobile safe-area overlap.
- **Structural fix:** Implemented in `reports/IMPLEMENTATION_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`: Supabase job table + Cloudinary-backed Edge Function pipeline for upload intent/status/webhook/apply/cancel, app-owned trim UI, processed public MP4 derivative, live-event save boundary, and legacy unsafe MOV fallback avoidance. Original spec `specs/SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md` is superseded by `specs/SPEC_AMENDMENT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`.
- **Status:** **OPEN - STATIC/DEPLOY PASS, OPERATOR-ASSISTED RUNTIME QA NEXT 2026-05-09**. Webhook/security rework evidence: `reports/IMPLEMENTATION_REWORK_ORCH-0770_CLOUDINARY_WEBHOOK_AND_SECRET_HARDENING.md`; orchestrator rework review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0770_CLOUDINARY_WEBHOOK_AND_SECRET_HARDENING.md`; tester report: `reports/TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`; orchestrator test review: `reports/REVIEW_TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`. Next prompt: `prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`. Remaining gate: prove real phone video -> Cloudinary processing -> webhook callback -> processed MP4 apply -> public browser playback with job-row data. Cloudinary API secret rotation remains recommended because credential material previously existed in local/chat context.
- **Invariant / regression guard:** A public event cover video must be a processed browser-safe derivative before it can become the public cover URL. Raw picker video may not be published unchanged; phone-shot videos must be transcoded/compressed into MP4/H.264/AAC fast-start public derivatives, with final public cover size <=25 MB.
- **Causal cluster:** Cluster 4/6 crossover: media pipeline accepted native-device artifacts without browser delivery normalization.
- **Follow-ups not part of RC:** Giphy/Pexels provider picker, brand page media, profile media, and ticket media remain separate and blocked behind this base event-cover video contract.

### RC-0769: Stripe account currency was stranded outside the app-wide commerce currency model
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md` proves `brand-stripe-onboard` writes selected/default currency to `stripe_connect_accounts.default_currency`, while `brands.default_currency` remains GBP and `Brand.defaultCurrency` is mapped from `brands.default_currency`. It also proves event publish forces `ticket_types.currency = 'GBP'`, checkout/order/door/refund snapshots freeze `currency: "GBP"` and `*Gbp` fields, and broad UI/export surfaces still use GBP-only formatters/fields.
- **Symptoms caused:** After onboarding with Stripe in a non-GBP country/currency, organisers and buyers can still see GBP across Home, Events, public pages, checkout, orders, door sales, reconciliation, finance reports, exports, and stored event/order records.
- **Causal chain:**
  1. Stripe country selection determines a default currency.
  2. Onboarding upserts that currency only into `stripe_connect_accounts`.
  3. SCA-to-brand sync triggers mirror Stripe id/enabled flags but not `default_currency`.
  4. Business app brand queries map `Brand.defaultCurrency` from still-GBP `brands.default_currency`.
  5. Event publish, checkout, order, door sale, refund, reconciliation, and export contracts still persist/render GBP-specific fields.
  6. Partial `formatCurrency` usage in Brand Payments cannot correct app-wide state because its source is still GBP and adjacent amounts are still GBP-named.
- **Structural fix:** Partial implementation returned via `reports/IMPLEMENTATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`, DB push rework via `reports/IMPLEMENTATION_REWORK_ORCH-0769_DB_PUSH_SQL_SCOPE_FIX.md`, and deploy via `reports/DEPLOY_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`. Fresh rework investigation `reports/INVESTIGATION_REWORK_ORCH-0769_CURRENCY_MISMATCH_REVENUE_RECON_WIZARD_ORDERS_SALES.md` proves the first implementation did not finish the semantic money model: active summaries still aggregate currencyless legacy numbers and repaint them as event/brand currency.
- **Status:** **OPEN - IMPLEMENTOR REWORK DISPATCH READY 2026-05-09**. Rework prompt: `prompts/IMPLEMENTOR_REWORK_ORCH-0769_CURRENCY_MISMATCH_REVENUE_RECON_WIZARD_ORDERS_SALES.md`; expected output: `reports/IMPLEMENTATION_REWORK_ORCH-0769_CURRENCY_MISMATCH_REVENUE_RECON_WIZARD_ORDERS_SALES.md`. Close remains blocked on semantic rework, independent QA, business deploy/OTA, and non-GBP runtime proof.
- **Invariant / regression guard:** Currency display and persisted commerce amounts must carry a real ISO currency source; active single-currency totals may be shown only when all included rows match the displayed currency. Historical GBP transactions must remain GBP. Mixed currencies must be grouped or flagged, never silently summed.
- **Causal cluster:** Cluster 1/4/6 crossover: duplicate source-of-truth, non-neutral persisted commerce schema, and Stripe integration metadata stranded from app state.
- **Follow-ups not part of RC:** ORCH-0764A/B/C Stripe onboarding/status repairs remain separate; real paid checkout/destination charges are not solved by this RC alone.

### RC-0767: Public brand existence was derived from public event rows
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md` proved `/b/{brandSlug}` called `getPublicBrandBySlug`, which queried `business_public_events_view`; that view only contains brands through qualifying public event rows, so a real brand with zero public events returned no rows and became `PublicBrandNotFound`.
- **Symptoms caused:** Organisers could tap **View public page** for an existing empty brand such as `Brand 3` and see `We couldn't find that brand`.
- **Causal chain:**
  1. Brand profile routed to `/b/{brandSlug}` correctly.
  2. Public brand route delegated to `getPublicBrandBySlug`.
  3. `getPublicBrandBySlug` used `business_public_events_view` as both brand identity and event-list source.
  4. Empty brands had no qualifying public event row.
  5. Service returned `null`, and the route rendered not-found.
- **Structural fix:** Added field-limited `business_public_brands_view` for public brand identity; kept `business_public_events_view` as public event-row source; refactored app/server preview code to return `{ brand, events: [] }` for real empty brands; added regression tests and deployed to `business.usemingla.com`.
- **Status:** **CLOSED PASS 2026-05-09**. Evidence: `reports/IMPLEMENTATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`, `reports/DEPLOY_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`, `reports/CLOSE_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`, and operator runtime acceptance.
- **Invariant / regression guard:** Public brand existence must not be inferred from event rows. Public profile identity comes from a field-limited public brand read model; public event cards remain event-view-backed.
- **Causal cluster:** Cluster 1/3 crossover: wrong source-of-truth plus launch-visible transitional public page behavior.
- **Follow-ups not part of RC:** ORCH-0768 public `@slug` and fabricated audience/count cleanup remains separate.

### RC-0764B: Stripe onboarding UI used split status truths and treated actionable KYC as terminal failure
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md` proved Payments could render cached `brand.stripeStatus=onboarding` while live `useBrandStripeStatus().requirements.disabled_reason=requirements.past_due` rendered restricted remediation. `reports/IMPLEMENTATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md` reports implementation of the primary repair contract. `reports/RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md` then proved two remaining P1 gaps: production return route `https://business.usemingla.com/stripe-onboarding-return` returns Vercel `404_NOT_FOUND`, and `BrandOnboardView` still has a cached `brand.stripeStatus === "active"` terminal-success bypass.
- **Symptoms caused:** Users saw contradictory "Onboarding submitted — verifying" and "Verification overdue" states, remediation could leave the app through bare `connect.stripe.com/express_login`, and ordinary past-due KYC could end in "Stripe couldn't verify."
- **Causal chain:**
  1. Payments used cached `brand.stripeStatus` for the main banner while live Stripe requirements powered remediation cards.
  2. Restricted remediation used a generic Express login URL instead of Mingla's controlled Account Link creation path.
  3. The onboarding modal treated every `restricted` status as terminal failure rather than distinguishing actionable requirements from true Stripe rejection.
  4. Browser return performed one refresh only, so Stripe propagation lag could produce false final states.
  5. SQL status derivation checked `charges_enabled` before `requirements.disabled_reason`, while TS/product expectation already treated disabled requirements as `restricted`.
  6. Business web export contained the onboarding return screen locally, but production routing did not serve the clean `/stripe-onboarding-return` URL used by Stripe.
  7. `BrandOnboardView` retained an older cached-active shortcut, so one onboarding surface could still terminally trust stale brand status before live Stripe requirements loaded.
- **Structural fix:** Primary repair is implemented: Payments now prefers live Stripe status over cached brand status; all actionable remediation CTAs route through Mingla's Account Link continuation; onboarding shell distinguishes `needs-information` from terminal `failed-stripe`; status settlement polls briefly after browser return; SQL parity migration `20260515000007_orch_0764b_stripe_status_derivation_parity.sql` makes `requirements.disabled_reason` win over `charges_enabled`. Rework `reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md` adds the return-route rewrite and makes cached `active` wait for live status in `checking-status`.
- **Status:** **OPEN - VERCEL DEPLOY GATE THEN TESTER 2026-05-09**. Next prompt after deploy: `prompts/TESTER_RETEST_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`.
- **Invariant / regression guard:** Stripe Connect account state has one effective UI truth per surface: live server status first, cached brand status only as loading fallback; actionable KYC requirements must be resumable through fresh Account Links, not terminal failure or generic Express login.
- **Causal cluster:** Cluster 1/6 crossover: duplicate state authority plus external payment-provider hosted-flow semantics.
- **Follow-ups not part of RC:** Checkout/destination charges, webhook fulfillment, Stripe live-mode review, and Vercel production route deployment remain separate gates.

### RC-0764A: Stripe Accounts v2 onboarding is gated by Stripe key permission/context after versioning repair
- **Discovery date:** 2026-05-08
- **Proof:** `reports/RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md` proves the deployed version-header fix advanced runtime past the earlier missing `Stripe-Version` error. Fresh authenticated `Stripe Wise 2` runtime accepted Mingla ToS, repeated ToS safely, and then failed in `brand-stripe-onboard` with Stripe's permission/context error before account creation.
- **Symptoms caused:** Organisers can accept Mingla ToS but cannot start Stripe payout onboarding; no `stripe_connect_accounts` row, no `account_id`, no `client_secret: null` success contract, and no Stripe-hosted onboarding URL are produced.
- **Causal chain:**
  1. ORCH-0764A moved from stale Connect onboarding/session behavior to raw Accounts v2 hosted onboarding.
  2. Runtime first failed because raw `/v2` calls lacked `Stripe-Version`; ORCH-0764A version-header rework fixed that enough to reach Stripe's next gate.
  3. The live deployed call now fails with Stripe permission/context wording, implicating key scope, key selection, required `Stripe-Context`, payload configuration, or platform/preview access.
  4. The exact root cause is not yet proven; implementation would be premature without a key/context investigation and spec.
- **Structural fix:** Pending forensics/spec with `prompts/FORENSICS_SPEC_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`.
- **Status:** **OPEN - FORENSICS SPEC DISPATCH READY 2026-05-08**. Orchestrator review: `reports/REVIEW_RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT_GATE.md`.
- **Invariant / regression guard:** Stripe onboarding cannot be marked payout-ready until runtime proves HTTP `200`, `client_secret: null`, `account_id: acct_...`, Stripe-hosted `onboarding_url`, and a created/reused `stripe_connect_accounts` row.
- **Causal cluster:** Cluster 6: external payment-provider capability/key configuration can masquerade as app integration failure.
- **Follow-ups not part of RC:** ORCH-0764B checkout remains paused; webhook fulfillment and destination-charge checkout should not proceed until ORCH-0764A hosted onboarding is live-proven.

### RC-0763: Business event truth split between server drafts/public reads and local organiser published events
- **Discovery date:** 2026-05-08
- **Proof:** `reports/INVESTIGATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md` proves organiser Home/Events/Event Detail/Edit Published still resolve published events from local `liveEventStore`, while drafts and buyer public reads have moved toward server-backed paths. It also proves publish is client-side multi-table work without atomic event-promotion proof, and wizard autosave can overwrite dirty editor state with stale server/list responses.
- **Symptoms caused:** A free event can appear published locally, then disappear after a new build/local storage loss; published-event edit/detail routes cannot recover from server; wizard typing glitches under autosave; current durable server evidence does not contain the user's reported published free event.
- **Causal chain:**
  1. ORCH-0756B introduced server-backed drafts but left organiser published events as persisted local `LiveEvent` rows.
  2. ORCH-0759 made buyer public routes more server-backed, but organiser management routes still rely on local state.
  3. Publish promotes tickets/event through client-side sequential writes and then creates a local `LiveEvent` from the draft.
  4. The final event update does not prove one row was promoted, so false-local publication remains possible.
  5. A new build, sign-out cleanup, app deletion, or local storage reset removes the local published event, leaving no organiser server hydration path.
  6. Immediate full-object autosave and server/list upserts can also race active typing and destabilize the wizard.
- **Structural fix:** Pending spec under `prompts/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`. Required direction: atomic server-side publish RPC/transaction, server-backed organiser management event reads, local published-event store as cache only, edit-published server hydration, autosave debounce/revisioning/stale-response protection, and free-event regression coverage.
- **Status:** **OPEN - SPEC DISPATCH READY 2026-05-08**. Orchestrator review: `reports/REVIEW_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md`.
- **Invariant / regression guard:** Proposed: organiser published-event source of truth must be server-backed; local stores may cache but cannot be the only authority for published/scheduled events. Publish must be atomic and must fail loudly if one durable server event is not promoted.
- **Causal cluster:** Cluster 1/4 crossover: duplicate state authority plus non-atomic mutation/RETURNING-proof gap.
- **Follow-ups not part of RC:** Giphy/Pexels provider integration, brand/profile media expansion, full paid checkout, and native cover-media runtime proof remain separate; they are blocked behind this event-integrity repair.

### RC-0754: Transitional Home event stubs survived after their retirement cycle excluded Home
- **Discovery date:** 2026-05-08
- **Proof:** `reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md` proves `mingla-business/app/(tabs)/home.tsx` still defines and renders `STUB_UPCOMING_ROWS` (`Sunday Languor Brunch`, `The Long Lunch (Series)`), hardcodes `"1 live · 2 upcoming"`, and uses fictional live-event values, while `mingla-business/app/(tabs)/events.tsx` already derives brand-scoped event rows from `useDraftsForBrand`, `useLiveEventsForBrand`, and lifecycle helpers.
- **Symptoms caused:** The business app Home tab's Upcoming section and adjacent event summary can show fabricated upcoming/live operational data instead of the organiser's actual event pipeline.
- **Causal chain:**
  1. Cycle 1 introduced Home's live row plus two stub upcoming rows.
  2. Cycle 3 intentionally preserved `STUB_UPCOMING_ROWS` while adding real draft rows and documented that Cycle 9 would retire the stubs when the real event list existed.
  3. Cycle 9 shipped the full Events tab pipeline but explicitly declared "Live tonight on Home tab: NO TOUCH in Cycle 9."
  4. No later cycle moved Home to the Events tab event derivation path, so the transitional rows and hardcoded summary copy remained.
- **Structural fix:** Home fake-data signatures were removed, Home now derives event truth from brand-scoped draft/live/order stores, `I-PROPOSED-Z` strict fake-signature guard was added, and implementation rework aligned empty-state copy, live hero date line, all-unlimited capacity label, and KPI zero-bucket subcopy with the approved spec.
- **Status:** **CLOSED CONDITIONAL PASS 2026-05-08** via DEC-132. Evidence: `reports/IMPLEMENTATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`, `reports/IMPLEMENTATION_REWORK_ORCH-0754_BUSINESS_HOME_UPCOMING_SPEC_ALIGNMENT.md`, and tester conditional PASS `reports/TEST_REPORT_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`. Accepted condition: full business-app lint remains red due unrelated repo-wide lint debt; no ORCH-0754 file appears in lint output.
- **Invariant / regression guard:** `I-PROPOSED-Z HOME-NO-FABRICATED-EVENTS` ratified ACTIVE at close. Business Home must not contain fabricated event rows or hardcoded event metrics; Home event truth derives from brand-scoped draft/live/order sources.
- **Causal cluster:** Cluster 3: transitional/demo data retirement drift after scope split.
- **Follow-ups not part of RC:** Brand Profile fake `STUB_PAST_EVENTS`, Finance Reports Brand-level `events` stub dependency, and Supabase/client event status vocabulary drift are separate discoveries from ORCH-0754.

### RC-0752: Android billing failure came from test-install eligibility plus stale cached app state, not app product-ID drift
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0752_REVENUECAT_PRODUCT_OFFERING_CONFIGURATION.md` proved app code fetches RevenueCat `offerings.current` and buys returned packages rather than hardcoding store product IDs. `reports/INVESTIGATION_ORCH-0752B_ANDROID_PLAY_BILLING_PURCHASE_VERSION_GATE.md` captured the screenshot-era failure against a local/debug/sideload install. Close evidence in `reports/CLOSE_ORCH-0752_REVENUECAT_ANDROID_BILLING_CONFIG.md` shows the later tested app was the Play/internal build (`versionCode=12`, installer `com.android.vending`, no debug flag), app data was cleared successfully, and the user confirmed Billing works.
- **Symptoms caused:** Android purchase/package QA showed Google Play "This version of the application is not configured for billing through Google Play" during the screenshot-era install, then later the Billing/paywall sheet appeared stuck loading packages.
- **Causal chain:**
  1. The screenshot-era app instance was not the Play/internal eligible install, so Google Play Billing rejected purchase launch.
  2. The operator then installed the proper Play/internal build.
  3. Stale local app data/cache preserved a bad offering/session state, so packages still appeared stuck.
  4. Clearing app data forced a clean RevenueCat/offering/session path, and Billing worked after restart/sign-in.
- **Structural fix:** External/test-state correction only: use the Play/internal build for billing QA and clear stale app data when switching from debug/sideload or broken offering states. No product-code product-ID fix was required.
- **Status:** **CLOSED PASS 2026-05-07** via DEC-131 and user runtime confirmation after ADB install proof + `pm clear`.
- **Invariant / regression guard:** Android purchase QA must record the installed package source/version/debug state before interpreting Play Billing errors. If packages are empty after known dashboard changes, clear app data or invalidate RevenueCat/query cached null state before escalating to code.
- **Causal cluster:** Cluster 6: external billing/config/tester state can masquerade as app paywall failure.
- **Follow-ups not part of RC:** ORCH-0752A Billing sheet plan-pricing UX redesign remains open; iOS App Store product approval remains external release readiness if production iOS purchases are launch scope.

### RC-0753: Remote-applied Supabase migration was not versioned in Git
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` proved the linked remote had applied migration version `20260507000003` while `origin/main` lacked `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`. `reports/SPEC_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` locked the safe repair to versioning the exact already-applied file. Tester PASS in `reports/TEST_REPORT_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` proved commit `54553cb8` contains the migration, exact SQL matches the spec, and GitHub `Migrations apply cleanly from baseline` is green.
- **Symptoms caused:** Supabase Preview/main database-release checks reported `Remote migration versions not found in local migrations directory`, so the repository could not reproduce the linked remote migration ledger from Git.
- **Causal chain:**
  1. ORCH-0737 v8 timing diagnostics migration `20260507000003` was applied to the linked remote.
  2. The matching migration file stayed outside tracked Git history.
  3. GitHub's Supabase migration check compared remote-applied versions against local migrations on main.
  4. The remote version had no local tracked file, so the check failed even though app/docs checks were otherwise healthy.
- **Structural fix:** Versioned `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` with the exact already-applied SQL. No live DB mutation, migration repair, `supabase db push`, edge deploy, or product runtime change was part of the repair.
- **Status:** **CLOSED PASS 2026-05-07** via DEC-130, tester PASS, Git tree proof on `54553cb8`, GitHub migration baseline check success, and final Vercel commit statuses success.
- **Invariant / regression guard:** Every remote-applied Supabase migration version must be present in tracked Git history; intentional historical/backfill versioning must be documented as provenance repair and must not be paired with live DB mutation unless separately authorized.
- **Causal cluster:** Cluster 5: release provenance drift between live Supabase ledger and repository migration history.
- **Follow-ups not part of RC:** ORCH-0737 remains open for timing diagnostics/full-city baseline analysis.

### RC-0751: Duplicate auth cleanup callers raced RevenueCat logout after the first logout made the SDK anonymous
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` proved the red Metro line was not a purchase failure but duplicate cleanup against RevenueCat's strict `logOut()` semantics. Runtime failure evidence in `reports/RUNTIME_QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` showed explicit sign-out logging `Logged out successfully` followed by native `Called logOut but the current user is anonymous`. Final proof in `reports/RETEST_ORCH-0751_REVENUECAT_LOGOUT_SERIALIZATION.md` showed the same Android sign-in -> sign-out -> sign-in path without the anonymous logout line.
- **Symptoms caused:** Healthy auth cleanup could emit a scary RevenueCat error during no-session/sign-out paths, making normal teardown look broken and making it harder to spot real purchase/auth failures.
- **Causal chain:**
  1. Auth cleanup had more than one caller capable of reaching RevenueCat logout during the same transition.
  2. RevenueCat `Purchases.logOut()` succeeds once and leaves the SDK anonymous.
  3. A second concurrent cleanup call can then hit native `logOut()` while anonymous.
  4. RevenueCat treats anonymous logout as an error, so Metro prints a red error even though user sign-out is otherwise healthy.
- **Structural fix:** `logoutRevenueCatIfIdentified()` now checks configuration and anonymity before native logout, treats only the exact anonymous-logout condition as a quiet no-op, keeps unknown errors visible, and serializes concurrent cleanup through one shared `guardedLogoutInFlight` promise. `loginRevenueCat(user.id)` remains untouched so anonymous-to-identified purchase identity merge still works.
- **Status:** **CLOSED PASS 2026-05-07** via Android runtime retest, `cd app-mobile && npm run test:orch-0751` PASS 11/11 including the T11 serialization guard, `cd app-mobile && npm run test:orch-0749` PASS, and `git diff --check` PASS.
- **Invariant / regression guard:** RevenueCat cleanup logout must be idempotent and serialized; duplicate cleanup callers cannot issue duplicate native `Purchases.logOut()` calls during one auth transition.
- **Causal cluster:** Cluster 2: noisy expected teardown versus real failures, with a concurrency/idempotency edge.
- **Follow-ups not part of RC:** ORCH-0752 RevenueCat product/offering/store approval configuration remains separate.

### RC-0749: Mobile auth cleanup allowed stale private query/cache state to outlive its user
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md` proved the startup log storm was not one bug but an auth-boundary failure across query persistence, auth cleanup, private fetchers, and noisy SDK/error classification. Runtime proof closed in `reports/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`.
- **Symptoms caused:** Fresh no-session startup could repeatedly log `A query that was dehydrated as pending ended up rejecting` for `userPreferences.<oldUserId>`; stale old-user query keys could continue after sign-out/reload; blocked-users fetch could log `Not authenticated` and still return/cached `[]`; Apple cancel and expected cancellation surfaced as app errors; AppsFlyer/engagement paths could fire after auth moved underneath them; Profile scroll/tabScroll updates produced repeated no-op store writes.
- **Causal chain:**
  1. React Query persistence allowed pending/non-idle private queries into hydration.
  2. Query keys containing a previous user id were not consistently removed on no-session, sign-out, or user-switch transitions.
  3. Some private service paths did not verify "the user I expected is still the user who owns this response" before returning fallback empty data.
  4. Expected auth teardown/cancellation paths were logged as errors, making normal lifecycle churn look like production failures.
  5. Profile tabScroll state updates lacked a no-op guard, amplifying noise after navigation.
- **Structural fix:** ORCH-0749 implementation added `queryPersistence` and `authCleanup` utilities, blocked pending/non-idle dehydration, removed auth-mismatched private cache, wired cleanup through no-session/SIGNED_OUT/user-switch/AppState/onboarding paths, made cancellation non-noisy, guarded blocked-users/preferences/Appsflyer/engagement paths, changed profile interests to tolerate missing rows, narrowed Profile subscriptions, added tabScroll no-op behavior, and locked the contracts with `app-mobile/scripts/ci/orch-0749-regression-check.mjs`.
- **Status:** **CLOSED PASS 2026-05-07** via static QA, runtime QA, operator smoke, and `cd app-mobile && npm run test:orch-0749` PASS at 2026-05-07 17:45 EDT.
- **Invariant:** `I-AUTH-PRIVATE-CACHE-CANNOT-OUTLIVE-AUTH-OWNER`.
- **Causal cluster:** Cluster 1/2 crossover: stale cache ownership + silent/noisy error classification. Future auth/query work must prove both data ownership and log behavior, not just "no crash."
- **Follow-ups not part of RC:** ORCH-0751 was closed separately under RC-0751/DEC-129; ORCH-0752 RevenueCat product/offering configuration remains open.

### RC-0728: RLS-RETURNING-OWNER-GAP — supabase-js mutations fail because no SELECT policy admits the post-mutation row
- **Discovery date:** 2026-05-06 (proven after 13 forensic passes ORCH-0728/0729/0731 + H39/H40/H41/H42)
- **Proof:** [reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md](reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md) (PASS-10) + H39 (DISABLE/ENABLE RLS toggle confirmed RLS as denier) + H40 (JWT decode showed `sub === user.id` exactly — JWT not the bug) + H41 (pg_policies enumeration showed 5 policies on brands; only INSERT and UPDATE/DELETE policies for owners, NO owner-SELECT policy) + H42 (operator dashboard SQL: pure INSERT *without* RETURNING succeeded under simulated auth, while INSERT *with* RETURNING returned 42501 — definitive disambiguator). Brands-table relpages = 0 confirmed bug latent since B1 phase 2 cycle.
- **Symptoms caused:** Brand-create from `BrandSwitcherSheet` returns 42501 (operator-reported "create-brand glitch"). Brand-delete from `BrandDeleteSheet` exhibits identical 42501 (operator-confirmed 2026-05-06). Likely also blocks every other operator-facing mutation across mingla-business B1 tables (events, tickets, orders, brand_members, team_invitations) that hits an RLS-gated INSERT/UPDATE/DELETE — full audit pending under ORCH-0734.
- **Causal chain:**
  1. supabase-js `.insert(...).select()` / `.update(...).select()` / `.delete().select()` defaults to `Prefer: return=representation`.
  2. Postgres performs the mutation. WITH CHECK / USING predicates pass for the actor.
  3. Postgres processes the implicit RETURNING by evaluating SELECT policies on the post-mutation row state.
  4. For brands INSERT: no SELECT policy admits an owner of a fresh brand (brand_members policy fails — no membership row, no AFTER INSERT trigger creates one — and public-events policy fails — fresh brand has zero events).
  5. For brands UPDATE soft-delete: every SELECT policy gates on `deleted_at IS NULL`; the post-update row has `deleted_at IS NOT NULL`; no SELECT policy admits.
  6. With no SELECT policy passing, Postgres rolls back the entire mutation and returns 42501 with the misleading message "new row violates row-level security policy" — although the INSERT/UPDATE WITH CHECK actually passed.
- **Structural fix (in dispatch — ORCH-0734 forensics IA):** prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md (PRIVATE_PROMPT_NOT_VERSIONED: `Mingla_Artifacts/prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md`) — comprehensive audit of every authenticated INSERT/UPDATE/DELETE policy on every mingla-business B1 table for matching post-mutation SELECT-policy coverage, followed by single fix migration. Canonical fix archetype: add permissive SELECT policy `(account_id = auth.uid()) AND (deleted_at IS NULL OR <admin/owner branch>)` for owners, and broaden any soft-delete-affected SELECT policies to admit `deleted_at IS NOT NULL` for admins/owners as appropriate.
- **Status:** **CLOSED 2026-05-06** — fix shipped via ORCH-0734 (DB owner-SELECT + owner-UPDATE policies on brands) + ORCH-0734-RW (rowcount verification + trash-icon parent-prop wiring) + ORCH-0740 Cycle 1 Foundation (focusManager + queryClient.clear + role TTL tighten + brandRoleKeys.allForBrand factory). Operator-attested CONDITIONAL PASS via 3 successful UI smoke tests across all 3 dispatch cycles. Wave commit `f6692198` shipped ORCH-0734 + ORCH-0734-RW; ORCH-0740 ships under follow-up commit. I-PROPOSED-H + I-PROPOSED-I flipped DRAFT→ACTIVE.
- **Invariants:** NEW (DRAFT until ORCH-0734 CLOSE) **I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED** — every authenticated mutation policy on `public.*` schema tables MUST be paired with at least one SELECT policy that admits the actor for the post-mutation row state. Enforced by a SQL-aware CI gate plugged into `.github/workflows/strict-grep-mingla-business.yml`.
- **Causal cluster:** Cluster 4 (NEW): "RLS-RETURNING bug class" — distinct from RC-001 (state ownership), RC-002 (silent errors), RC-003 (fabricated data). Architectural pitfall: spec authors who design RLS by thinking about "who can write/edit/delete" forget that supabase-js's RETURNING means "who can write" implies "who can read it back." Brand-create + brand-delete are two confirmed instances; ORCH-0734 audit will surface every other latent instance in mingla-business.
- **Lesson codified:** Every mutation policy needs a paired SELECT policy that admits the post-mutation row state. Soft-delete UPDATEs in particular need owner/admin-broadened SELECT policies because every "active row" SELECT policy excludes the freshly-tombstoned row. Future B-cycle backend work must use this as a checklist item before tester PASS. ORCH-0734 ships an invariant + CI gate + permanent memory file (`feedback_rls_returning_owner_gap.md`) so this pattern never re-emerges.

### RC-0686: TypeScript enum rename without SQL CHECK constraint update (`photo_backfill_runs.mode`)
- **Discovery date:** 2026-04-26
- **Proof:** reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md (missing reference: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md`) — live-fire supabase MCP probe confirmed constraint def `CHECK ((mode = ANY (ARRAY['initial'::text, 'refresh_servable'::text])))`; data layer shows zero rows with new mode value `'pre_photo_passed'` (latest insert 2026-04-20, before ORCH-0678 deploy on 2026-04-25).
- **Symptoms caused:** Admin UI "Create photo download run" returns "Failed to create run / Edge Function returned a non-2xx status code" for every city. 14,401 pre-bouncer-approved places stranded. ORCH-0682 (Lagos+8-city operational recovery) Steps 2+3 cannot complete via the post-ORCH-0678 admin three-button flow.
- **Causal chain:** ORCH-0678 spec specified the `BackfillMode` TypeScript union rename `'initial'` → `'pre_photo_passed'` in `backfill-place-photos/index.ts` and admin UI call sites, but did NOT specify an `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …` migration. Implementor faithfully followed spec; tester PASSed without live-fire of `create_run` end-to-end. Post-deploy, every `INSERT INTO photo_backfill_runs (..., mode='pre_photo_passed', ...)` raises Postgres SQLSTATE 23514 against the stale constraint. Edge fn returns 500. Supabase JS admin client surfaces generic message (body not unwrapped — Constitution #3 sub-finding F-4).
- **Structural fix (specced, not yet shipped):** prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md (PRIVATE_PROMPT_NOT_VERSIONED: `Mingla_Artifacts/prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md`) — migration amends constraint to `('initial','pre_photo_passed','refresh_servable')` (legacy `'initial'` retained for 18 historical rows, all terminal-state); flips DEFAULT to `'pre_photo_passed'`; adds CI gate `I-DB-ENUM-CODE-PARITY` requiring TS union and SQL CHECK to stay in sync; bundles admin error-body unwrapper helper to surface real Postgres errors in toast.
- **Status:** Investigated, specced, awaiting SPEC mode return → IMPL → TEST.
- **Invariants:** `I-PHOTO-FILTER-EXPLICIT` (text rewrite required — currently stale); new `I-DB-ENUM-CODE-PARITY` (registers structural prevention of this exact pattern).
- **Causal cluster:** Same shape as ORCH-0540 (PL/pgSQL type-resolution drift after flag flip — code change without schema/RPC alignment, missed by headless QA). Lesson: any rename of a persisted-value union or enum REQUIRES a migration step in the same spec, plus mandatory live-fire of an end-to-end write through the constrained column before tester PASS.

### RC-0664: DM Realtime Receive Silently Dropped (Pre-emptive Dedup)
- **Discovery date:** 2026-04-25
- **Proof:** `reports/INVESTIGATION_ORCH-0663_0664_0665_CHAT_TRIPLE.md` (3 RCs proven HIGH, 9 hidden flaws); confirmed live on 2026-04-25 via working-tree grep at `useBroadcastReceiver.ts:51`.
- **Symptoms caused:** Every friend's incoming DM silently dropped from receiver's UI until close+reopen. Both delivery paths (broadcast `chat:${id}` and postgres_changes `conversation:${id}`) successfully received the message but neither updated `setMessages`. Side effects (cache, conversation list, mark-as-read) DID run — purely a UI state miss.
- **Causal chain:** `useBroadcastReceiver.ts:51` marked `broadcastSeenIds.current.add(msg.id)` BEFORE invoking `onBroadcastMessageRef.current(msg)`. The delegate (`MessageInterface.handleBroadcastMessage`) was a no-op stub that did nothing. Then `subscribeToConversation`'s postgres_changes backup at `ConnectionsPage:1513` checked `broadcastSeenIds.current.has(newMessage.id)` → returned TRUE → skipped the `setMessages` add. Two delivery paths, both falsely thinking the other had handled it.
- **Structural fix:** Extracted `addIncomingMessageToUI` helper in `ConnectionsPage` as the SINGLE OWNER of message-add logic. Both paths funnel through it. Seen-set add is now INSIDE the helper, AFTER `setMessages` succeeds. `MessageInterface.onBroadcastReceive` is REQUIRED (non-optional) so TypeScript catches missing wiring at compile time. CI grep gate forbids any seen-set mutation calls inside `useBroadcastReceiver.ts`.
- **Status:** Fixed — ORCH-0664 cycle-2 (2026-04-25). Cycle-1 was lost when parallel ORCH-0666/0667/0668 work overwrote the working tree; cycle-2 re-applied the same contract surgically.
- **Invariant:** I-DEDUP-AFTER-DELIVERY (registered in INVARIANT_REGISTRY.md)
- **Recurrence vector:** Any future code using a "seen-set" or "idempotency cache" must populate it AFTER the handled work, not before delegation. The CI gate catches the canonical pattern in this file; pattern-equivalents in other files require code review discipline (no automated coverage). Sender-side at L1936-area is the documented legitimate exception (sender already mutated UI via optimistic-replace).

### RC-001: Duplicate State Authorities
- **Discovery date:** 2026-03-23
- **Proof:** Query key consolidation audit, Zustand field removal
- **Symptoms caused:** ORCH-0205 (query key drift), stale cache after mutations, ghost data
- **Causal chain:** Multiple query keys for same entity → invalidation misses one → stale data displayed
- **Structural fix:** One factory per entity, dead Zustand fields removed
- **Status:** Fixed
- **Invariant:** INV-S02, INV-S07

### RC-002: Silent Error Swallowing
- **Discovery date:** 2026-03-23
- **Proof:** 16 mutations without onError, 7 silent catches
- **Symptoms caused:** ORCH-0206, user actions appearing to succeed but failing silently
- **Causal chain:** try/catch without throw or toast → user sees no feedback → data inconsistency
- **Structural fix:** onError on all mutations, withTimeout wrappers, mutation error toast utility
- **Status:** Partially fixed (50+ remaining non-state-changing silent catches documented)
- **Invariant:** Constitutional #3 (no silent failures)

### RC-003: Fabricated Data on Card Surfaces
- **Discovery date:** 2026-03-24
- **Proof:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md Pass 1
- **Symptoms caused:** Fake ratings, hardcoded travel times, wrong currency symbols
- **Causal chain:** Fallback defaults used instead of real data → user sees plausible but false information
- **Structural fix:** All fallbacks removed, real data or nothing shown
- **Status:** Fixed
- **Invariant:** INV-D08, Constitutional #9

### RC-004: Race Condition in Preferences-to-Deck Pipeline
- **Discovery date:** 2026-03-24
- **Proof:** Commit 79d0905b, TEST_PASS2.md
- **Symptoms caused:** ORCH-0064, stale deck after preference change, cards from old preferences appearing
- **Causal chain:** invalidateQueries after preference save → batch fetch starts before cache clear → old params used
- **Structural fix:** invalidateQueries removed, prefsHash matching gates batch acceptance
- **Status:** Fixed
- **Invariant:** INV-S06

### RC-005: Error-Swallowing Multi-Step Operations
- **Discovery date:** 2026-03-22
- **Proof:** Commit 23f3a0dd (unpair flow)
- **Symptoms caused:** ORCH-0177, partial unpair leaving orphaned data
- **Causal chain:** 3-step sequential code with try/catch per step → step 2 fails → steps 1 and 3 succeed → inconsistent state
- **Structural fix:** Atomic RPC replaces multi-step client code
- **Status:** Fixed for unpair. Pattern likely exists elsewhere (unaudited).

## Recurring Patterns

| Pattern | Occurrences | Examples | Structural Fix | Status |
|---------|------------|----------|----------------|--------|
| Query-key drift | 8+ | ORCH-0205 (3 saved, 2 person, 2 blocked) | Key factory discipline | Fixed |
| Silent catch swallowing | 50+ | ORCH-0206 (16 mutations fixed) | onError + mutationErrorToast | Partially fixed |
| Fabricated fallback data | 10 surfaces | ORCH-0061 (ratings, prices, times) | Remove all fallbacks | Fixed |
| Duplicate state owners | 3 | Zustand prefs, Zustand blocked, old query keys | Single authority map | Fixed |
| Multi-step client mutation | Unknown | Unpair (fixed), other flows unaudited | Atomic RPCs | Partially fixed |

## Causal Clusters

### Cluster 1: "Card Data Truthfulness" (RESOLVED)
Root cause: RC-003. 10+ symptoms across card rendering, pricing, ratings, travel times.
All resolved in Card Pipeline Audit Passes 1-5.

### Cluster 2: "State Consistency" (PARTIALLY RESOLVED)
Root causes: RC-001 + RC-002 + RC-004. Query key drift + silent failures + race conditions.
Key factory fixed. Mutation errors partially addressed. Unknown extent in unaudited surfaces.

### Cluster 3: "Security Layer" (UNAUDITED)
Potential root cause: Missing or inconsistent RLS policies, unvalidated edge functions.
No investigation started. ORCH-0223, 0224, 0225, 0226 all at F.

### Cluster 4: "RLS-RETURNING bug class" (PROVEN, AUDIT IN FLIGHT)
Root cause: RC-0728. supabase-js `.insert/.update/.delete(...).select()` triggers `Prefer: return=representation`, which makes Postgres evaluate SELECT policies for RETURNING. If no SELECT policy admits the post-mutation row, the entire mutation rolls back with 42501 even though WITH CHECK passed. Two confirmed instances in mingla-business: brand-create (owner has no SELECT policy for fresh brands) and brand-delete (every SELECT policy excludes soft-deleted rows). ORCH-0734 audits the remaining surface area to enumerate and patch all latent instances. Lesson: every mutation policy needs a matching SELECT policy that admits post-state.
