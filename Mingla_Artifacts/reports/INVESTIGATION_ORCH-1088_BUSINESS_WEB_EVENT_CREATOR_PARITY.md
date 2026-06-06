# INVESTIGATION - ORCH-1088 Business Web Event Creator Phone-Browser Parity

Date: 2026-06-05 / 2026-06-06 UTC
Mode: INVESTIGATE-THEN-SPEC, no product-code edit
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1088-[business-web-event-creator-parity]`
Branch: `ORCH-1088-business-web-event-creator-parity`

## Executive Result

Verdict: **NEEDS-WORK, READY FOR IMPLEMENTOR SPEC**.

Static Home is now safe after ORCH-1087, but the real `/event/create` route is not ready to reopen from phone-browser Home. Production Android Chrome and iPhone Simulator Safari both stayed on `Finishing sign-in...` when opening `https://business.usemingla.com/event/create`; neither reached `/event/{draftId}/edit`, neither mounted the wizard, and neither proved any creator step.

The root blocker is the route contract, not the static Home shell. `app/event/create.tsx` waits forever when `isAuthReady` is false or current-brand recovery never settles, because it has no signed-out/error terminal state and no static callback/session self-repair path. Even after that is fixed, the wizard must be proven step by step before Home can link to it: the first three steps are structurally web-aware, but Cover/media, ticket sheets, publish bank-readiness, viewport/keyboard behavior, and direct re-entry still need automated and physical phone-browser proof.

Recommended implementor slice: fix `/event/create` as a robust phone-browser authoring entry, add a browser-safe auth/current-brand terminal contract, then prove the full event creator through Step 7 on Android Chrome and Safari before changing static Home's `Create event` action away from the ORCH-1087 shell.

## Comms Ledger And Historical Context

Read first: `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`.

Factored open `ALL` WARN entries:

- COMMS-0003: if this spec changes provider contracts, cite canonical provider docs inline. ORCH-1088 avoids backend/provider payload changes.
- COMMS-0004/0011/0019: ORCH-ID collisions require full registry scans; ORCH-1088 is already dispatched and unique in this worktree.
- COMMS-0002: backend/function/migration changes need strict-grep allowlist awareness; ORCH-1088 should not touch backend.
- COMMS-0009/0010/0012/0013/0015/0018: deploy and DB drift hazards remain active. Any web deploy must happen only after merge to `main`; no deploy from this worktree.
- COMMS-0016/0018: experience pipeline source reconciliation is not in scope.
- COMMS-0021: seller surface copy must remain provider-neutral. The creator publish gate already says `Connect a bank`/payout-ready through the provider-neutral helper.

Required artifacts read:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
- `Mingla_Artifacts/reports/CLOSE_ORCH-1087_BUSINESS_WEB_STATIC_ROUTE_FIREWALL.md`
- `Mingla_Artifacts/AGENT_HANDOFFS.md`
- Related historical creator reports surfaced by Phase 0 search: ORCH-0893 creator-entry performance and ghost-draft work, Cycle 3 event creator build, Cycle 6 public event publish loop.

Key historical truths:

- ORCH-1085 proved full signed-in `/home` could OOM physical Android Chrome, so static `/home.html` became the safe phone-browser post-sign-in shell.
- ORCH-1087 closed S1 by removing phone-browser direct links from static Home to `/event/create`, Hub, Ari, Marketing, Account, and payout-management. Production Home is now deterministic and Expo-free.
- ORCH-1087's direct production probe already showed `/event/create` stuck on `Finishing sign-in...` after 12 seconds.
- ORCH-0893 changed event creation from eager server-row insertion to a client-only `d_*` draft with lazy server insertion on first dirty autosave.

Memory read:

- `feedback_forensics_depth_and_spec_granularity.md`
- `feedback_physical_device_first_testing.md`
- `feedback_worktree_per_orch_workflow.md`
- `feedback_response_2_section_universal.md`

## Investigation Frame

User goal: Seth taps `Create event` on phone-browser Home and lands in a usable, real event creator without a crash, spinner trap, data loss, invalid publish path, or fake success.

Feature slice:

- Start trigger: phone browser opens static Home, then Create event is reopened to the real route.
- Runtime route: `/event/create` creates a client `d_*` draft, then replaces into `/event/{draftId}/edit?step=0`.
- Terminal success: user completes Steps 1-7, sees validation, publish readiness, and can publish or safely exit/discard without losing data.
- Required proof: direct route entry, Home handoff, refresh/re-entry, Android Chrome physical smoke, Safari smoke, automated regressions, export/build proof.

Surfaces:

- In scope: business Web phone browsers, business Web desktop as a parity/sanity surface, static Home handoff, event create/edit wizard, event draft local/server chain.
- Explicitly out of scope: consumer iOS, consumer Android, business iOS native, business Android native, admin Web, buyer checkout, Hub/Trips/Experiences full parity, Marketing Composer, Ari, Account/Payout sessions, backend schema/RLS changes, provider API changes.

## Runtime Evidence

### Production Android Chrome

Device:

- Samsung Galaxy A72 physical device, ADB serial `R58R54YV7JT`
- Chrome `148.0.7778.215`
- CDP endpoint available through `adb forward tcp:9222 localabstract:chrome_devtools_remote`
- Chrome user agent reported by `/json/version`: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36`

Commands:

```bash
adb -s R58R54YV7JT shell am force-stop com.android.chrome
adb -s R58R54YV7JT logcat -c
adb -s R58R54YV7JT shell am start -a android.intent.action.VIEW -d 'https://business.usemingla.com/event/create' com.android.chrome
sleep 15
adb -s R58R54YV7JT exec-out screencap -p > /tmp/orch1088-event-create-android.png
adb -s R58R54YV7JT logcat -d | rg -i 'V8 javascript OOM|CrRendererMain|onServiceDisconnected|Aw, Snap|fatal exception|SIGSEGV|Render process|chromium|event/create|auth|Supabase|mingla' | tail -n 120 > /tmp/orch1088-event-create-logcat-grep.txt
sleep 45
adb -s R58R54YV7JT exec-out screencap -p > /tmp/orch1088-event-create-android-60s.png
adb -s R58R54YV7JT logcat -d | rg -i 'V8 javascript OOM|CrRendererMain|onServiceDisconnected|Aw, Snap|fatal exception|SIGSEGV|Render process' /tmp/orch1088-event-create-logcat-grep-60s.txt
```

Result:

- At 15 seconds, screenshot showed only the dark Expo route with spinner and `Finishing sign-in...`.
- At about 60 seconds, screenshot still showed the same `Finishing sign-in...` state.
- No `Aw, Snap`, `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, fatal exception, SIGSEGV, or render-process crash markers were found in the fatal grep.
- The route did not redirect to `/event/{draftId}/edit?step=0`.
- The wizard did not mount.

Classification: **confirmed bug**. The route is not crashing in this probe, but it is an infinite spinner from the user's perspective.

External/platform reference: Chrome's official remote-debugging docs describe the Android DevTools flow used here and confirm that the device Chrome version determines the DevTools target exposed over the debug bridge: https://developer.chrome.com/docs/devtools/remote-debugging .

### iPhone Simulator Safari

Device:

- iPhone 17 Pro Simulator, UDID `17091E60-C3B6-4167-980D-60C348E177F6`
- iOS 26.4

Commands:

```bash
xcrun simctl openurl 17091E60-C3B6-4167-980D-60C348E177F6 'https://business.usemingla.com/event/create'
sleep 20
xcrun simctl io 17091E60-C3B6-4167-980D-60C348E177F6 screenshot /tmp/orch1088-event-create-ios-safari.png
```

Result:

- Screenshot showed Safari on `business.usemingla.com` with the same dark route, spinner, and `Finishing sign-in...`.
- The route did not reach `/event/{draftId}/edit`.
- No Step 1 content was visible.

Classification: **confirmed bug** for simulator Safari. Physical iPhone Safari remains a post-implementation gate because this session did not have operator-in-the-loop physical iPhone tapping.

## Source Evidence - Entry And Auth Chain

### Static Home no longer opens `/event/create`

`mingla-business/public/home.html:460-467` now renders Create event as `href="#create-event"` with `data-shell-link="create-event"`, not `/event/create`.

`public/home.html:624-631` defines the exact shell copy: `The event creator is blocked on phone browsers until the full web workflow is proven stable...` and names the prior sign-in spinner as the reason.

`public/home.html:744-748` intercepts every `data-shell-link`, prevents navigation, and opens the shell panel. `public/home.html:751-759` only reads the Supabase localStorage token for a static email label; it does not validate or refresh the session.

Implication: the current production user path is safe because Home deliberately does not enter the real creator. ORCH-1088 must not undo that until the real route passes.

### Static callback writes the expected Supabase session key

`mingla-business/public/auth/callback.html:85-89` hardcodes the Supabase project URL, anon key, and storage key `sb-gqnoajqerqhnvulmnyvv-auth-token`.

`auth/callback.html:167-178` persists the session JSON to localStorage and broadcasts `SIGNED_IN`. `auth/callback.html:210-222` then replaces the callback URL and redirects to `/home`.

This is a valid static handoff into Home, but it does not prove that the full Expo app will consider the stored session usable. Full Expo auth still depends on Supabase client bootstrap.

### Full Expo auth can legally stay not-ready

`mingla-business/src/context/AuthContext.tsx:167-249` races `supabase.auth.getSession()` against the 3,000ms `AUTH_BOOTSTRAP_TIMEOUT_MS`. On timeout it sets `session=null`, `user=null`, and `loading=false`.

`AuthContext.tsx:742-759` derives `authStatus` and `isAuthReady` from `deriveBusinessAuthStatus` and `isBusinessAuthReady`.

`mingla-business/src/utils/authReadiness.ts:37-70` says `isBusinessAuthReady` is true only when the session has a non-empty access token and the user has an id. A signed-out or timed-out bootstrap produces `isAuthReady=false`.

`AuthContext.tsx:280-312` can apply a late passive usable session after timeout, but if no usable session arrives, the app remains not ready.

### `/event/create` has no signed-out/error terminal state

`mingla-business/app/event/create.tsx:86-93` returns early while `!isAuthReady`, current-brand recovery is resolving, or the draft store is not hydrated.

`event/create.tsx:94-97` routes to `/(tabs)/home` only when auth/recovery/hydration are done and `currentBrandId === null`.

`event/create.tsx:103-104` creates a client `d_*` draft and replaces to `/event/{draft.id}/edit?step=0` only after all gates pass.

`event/create.tsx:113-130` renders the spinner copy. The first branch is `Finishing sign-in...` for both true auth bootstrap and permanent signed-out/not-usable states.

There is no branch for:

- auth bootstrap timed out and signed out;
- localStorage has a stale/invalid static-session token;
- Supabase session refresh is blocked or fails;
- current-brand recovery errors;
- user has no brand but should be told what to do;
- browser storage is unavailable/private/blocked;
- route has waited too long and should offer retry/re-auth.

This exactly matches runtime: the route can sit on `Finishing sign-in...` forever.

### Current-brand recovery can extend the spinner

`mingla-business/src/hooks/useCurrentBrandRecovery.ts:21-47` waits for auth, `useBrands(userId)`, and `useCreatorAccount()` before resolving brand choice.

`useCurrentBrandRecovery.ts:103-111` reports `isResolving` when auth is bootstrapping/refreshing, brand/account queries are not fetched, or a resolved brand id has not yet been applied.

`event/create.tsx:88` blocks on `currentBrandRecovery.isResolving`, but `event/create.tsx` does not surface `isError` or `errorMessage`.

If auth is ready but brand recovery fails, the route has no user-visible recovery path. That is a second confirmed production-hardening gap even though the current runtime screenshot is the auth label.

### Draft store hydration is necessary but not sufficient

`mingla-business/src/store/draftEventStore.ts:696-707` uses Zustand persist with `createJSONStorage(() => AsyncStorage)` and versioned migrations.

`event/create.tsx:69-84` waits for `useDraftEventStore.persist.hasHydrated()` and subscribes to `onFinishHydration`.

This protects the ORCH-0893 draft-overwrite bug, but it also adds another indefinite wait surface if web AsyncStorage/localStorage hydration never fires or throws. There is no timeout or visible storage-error state.

## Source Evidence - Edit Route And Server Draft Chain

`mingla-business/app/event/[id]/edit.tsx:97-104` resolves local `d_*` drafts from Zustand and server drafts through `useServerDraftById`.

`edit.tsx:206-246` waits for auth readiness before bouncing a missing draft home, and for legacy local ids it scans React Query draft lists for a `legacyLocalDraftId` match before bouncing.

`edit.tsx:331-354` lazy-inserts a server draft only when a local `d_*` draft is dirty and auth is ready.

`edit.tsx:354-419` merges the live local draft into the returned server draft and replaces the URL with the server id.

`mingla-business/src/services/eventDrafts.ts:124-165` creates the server draft by requiring a Supabase user, fetching brand default currency, inserting into `events` with `event_type='event'`, and selecting the canonical draft projection.

Implication: once `/event/create` actually reaches the edit route, the first dirty edit should create the durable server row. The risky part for phone-browser parity is not the lazy-draft design itself; it is proving auth/brand/draft hydration, edit-route re-entry, autosave retry, and UI steps in a mobile browser.

Latest DB/schema note: ORCH-1088 does not propose a migration. The relevant service still writes existing `events` columns and calls the already-existing `business_discard_event_draft` RPC. Because no table/function/RLS change is proposed, latest-migration proof is limited to confirming no DB change is needed for this spec.

## Source Evidence - Wizard Boot And Step Hazards

### Wizard boot cost

`mingla-business/src/components/event/EventCreatorWizard.tsx:28-108` imports all seven step components at route-chunk evaluation time. Because Expo Router async routes split by route, `/event/[id]/edit` still pulls the full wizard and all step dependencies together once the edit route loads.

The initial wizard render mounts:

- root custom chrome and stepper;
- `SmartScrollView`;
- all validation utilities;
- provider-neutral payout/publish helpers;
- all step component modules;
- `ConfirmDialog`, `PublishErrorsSheet`, `Toast`;
- desktop layout rail/topbar code even on phone, behind `useResponsiveLayout`.

This is not proven to OOM like Hub/Marketing, but it remains unproven on phone browsers because `/event/create` never reaches it.

### Step 1 - Basics

`CreatorStep1Basics.tsx` uses React Native `TextInput`, format/category pressables, and regular validation. No native-only module import was found. Phone-browser proof still needs typing, long description keyboard behavior, validation errors, and close/discard behavior.

### Step 2 - When

`CreatorStep2When.tsx` imports `@react-native-community/datetimepicker`, but the main date/time paths include explicit `Platform.OS === "web"` hidden HTML input branches using `showPicker()`/`.click()` fallback at the main pickers and AddDateSheet pickers.

This is the strongest existing web-parity step. It still needs runtime proof on Android Chrome and Safari for:

- single-date date/time;
- multi-date add;
- recurrence termination count/until/never;
- timezone sheet;
- hidden inputs firing from touch rows.

Platform reference: MDN documents native date/time inputs and feature-detection/fallback patterns for `datetime-local`, and MDN's Visual Viewport docs describe mobile keyboard/viewport behavior that can differ from the layout viewport. See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local and https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API .

### Step 3 - Where

`CreatorStep3Where.tsx:32-38` uses the shared Mapbox address input.

`mingla-business/src/components/location/MapboxAddressInput.tsx:115-143` injects business Supabase `functions.invoke`, copy, tokens, and `minQueryLength={3}` into the shared package.

`packages/location-input/src/MapboxAddressInput.tsx:185-236` debounces suggestions, calls suggest/retrieve, surfaces no-results/offline/pick-error states, and rotates a session token after successful retrieve.

This should be browser-appropriate, but needs phone proof for keyboard overlap, suggestion placement, retrieve success, retry/offline copy, and touch target behavior.

### Step 4 - Cover

`CreatorStep4Cover.tsx:118-136` opens `CoverPickerSheet` with an event target keyed by the current draft id.

`CoverPicker.tsx:39-45` imports `expo-haptics`, `expo-file-system/legacy`, and `expo-image-picker` at module top. That means the edit route chunk still evaluates these modules when the Cover step component is imported, even before the user opens the sheet.

`CoverPicker.tsx:352-381` requests media-library permission and launches `ImagePicker` for image/GIF upload. `CoverPicker.tsx:475-536` does the same for video and uses raw web clip upload when not native.

`CoverPicker.tsx:319-347` has clear upload error copy, including `This needs a server record before media upload.`

Confirmed hazards:

- Device image/video upload cannot be accepted as launch-ready until run on phone Chrome/Safari.
- For local `d_*` drafts, media upload is risky before the first dirty autosave has produced a server UUID. The current `eventRowId` is non-empty even when it is a `d_*` id, so the empty-id guard alone does not prove the server-record requirement.
- Full media upload is not necessary to reopen Create if the first launch contract explicitly degrades device upload/video and keeps color/GIF/Pexels/provider selections that only patch draft metadata.

### Step 5 - Tickets

`CreatorStep5Tickets.tsx` uses `TicketTierEditSheet`, `WhoCoversCostsSection`, `useCurrentBrand`, and `useBrandTaxRegistration`.

Hazards:

- ticket sheet viewport and keyboard on phone browsers;
- sale period/date inputs inside `TicketTierEditSheet` need their own web proof;
- paid publish readiness must preserve provider-neutral `Connect a bank` copy per COMMS-0021;
- tax registration status is context only; ORCH-1088 should not change Stripe/Tax payloads.

### Step 6 - Settings

`CreatorStep6Settings.tsx` is mostly local pressables and visibility toggles. Needs proof for touch states, validation, and refresh persistence, but no high-risk native import was found.

### Step 7 - Preview and publish

`CreatorStep7Preview.tsx:88-90` uses `payoutGateStatus(brand)` so Paystack-ready brands and Stripe-ready brands both count as payout-ready.

`EventCreatorWizard.tsx:505-529` validates publish and shows `Connect a bank to publish paid tickets.` for payout-blocked paid tickets.

`EventCreatorWizard.tsx:531-578` publishes through `onPublishDraft`, handles paid-publish integrity guard errors, and redirects to Stripe onboarding only if the guard says `stripe_onboarding`.

Hazards:

- public preview route is separate and not proven by this investigation;
- publish path needs an account fixture with payout-ready and payout-blocked variants;
- paid-publish requires backend/RPC state but not a new ORCH-1088 provider contract.

## Non-Causes Eliminated

- Not a static Home regression: ORCH-1087 production Close proved Home now stays static; current source shows Create is shelled, not linked to `/event/create`.
- Not a Vercel 404: `/event/create` loads the Expo route and renders spinner UI.
- Not an Android Chrome renderer OOM in this specific route: logcat fatal grep had no V8 OOM/CrRendererMain/Aw Snap markers during the 60-second probe.
- Not a missing date/time web branch in Step 2: source contains explicit web hidden-input branches for the main date/time and AddDateSheet pickers.
- Not provider-copy regression: current publish path uses provider-neutral bank/payout helper copy, and static Home says `Payout account`, not `Stripe account`.

## Findings

### F-1 - `/event/create` can spin forever on phone browsers

Classification: **confirmed bug**.

Six-field proof:

- File/line: `mingla-business/app/event/create.tsx:86-104` and `:113-130`.
- Exact code: the effect returns while `!isAuthReady || currentBrandRecovery.isResolving`, and the UI renders `Finishing sign-in...` for that same condition.
- Current behavior: production Android Chrome and iPhone Simulator Safari stayed on `Finishing sign-in...` and never reached `/event/{draftId}/edit`.
- Expected behavior: the route should either reach Step 1, route to sign-in/static Home with clear copy, or surface a recoverable auth/current-brand error within a bounded time.
- Causal chain: direct phone-browser route enters full Expo app -> AuthContext does not produce `isAuthReady=true` for the observed session -> EventCreateRoute has no signed-out/error/timeout branch -> startedRef never flips -> createDraft never runs -> router.replace never happens -> user stays on spinner indefinitely.
- Verification step: add a route-level test/harness that forces `isAuthReady=false` after bootstrap and asserts a terminal sign-in/retry state, then production Android/Safari direct `/event/create` must not remain on spinner after the bounded timeout.

User impact: tapping a reopened Create action would put users back into the exact stripped-down reason ORCH-1087 shelled the action.

Fix direction: bounded auth/current-brand state machine for `/event/create`, with explicit signed-out, session-refresh-failed, no-brand, recovery-error, storage-unavailable, and retry states.

### F-2 - Static callback and full Expo auth are not proven as one continuous browser handoff

Classification: **production-hardening gap**.

Evidence:

- Static callback writes localStorage and redirects to `/home`.
- Static Home only reads the storage key for display.
- Full Expo auth independently calls `supabase.auth.getSession()` and requires a usable token/user.
- Runtime direct route did not become ready.

Impact: a phone-browser user can look signed in on static Home while the full route fails to become usable. The Home Create action cannot reopen until the static session -> Expo AuthContext bridge is proven with fresh, expired, stale, missing, private-mode, and refresh-token cases.

Fix direction: add explicit preflight/diagnostic handling in the creator route and tests that seed the same storage key as callback, then assert full AuthContext readiness or visible reauth.

### F-3 - The wizard has not been runtime-proven on phone browsers

Classification: **production-hardening gap**.

Evidence:

- Runtime never reached `/event/{draftId}/edit`.
- Source imports all seven steps and high-risk dependencies when edit route loads.
- Step 4 cover picker still imports web-sensitive media modules and relies on device picker/media upload behavior.

Impact: even after F-1 is fixed, Home should not link to the route until actual Step 1-7 authoring works on phone Chrome and Safari.

Fix direction: implement a targeted phone-browser creator harness/smoke path that proves Step 1 through Step 7, including back/continue, validation, autosave, refresh/re-entry, and close/discard.

### F-4 - Cover/media must launch degraded or be proven separately

Classification: **UX gap** + **production-hardening gap**.

Evidence:

- CoverPicker imports `expo-image-picker` and `expo-file-system/legacy` at module top.
- Device image/video upload depends on web picker behavior and server-row ids.
- The user goal is event creation, not necessarily phone-browser device media upload in the first reopen slice.

Impact: full media upload could delay the safer route reopening and create another dead tap or upload failure. A degraded web contract is acceptable if explicit and tested.

Fix direction: for ORCH-1088, launch phone-browser creator with cover hue/provider selections and explicit disabled/degraded device upload/video if necessary. Reopen full device upload only with Android/Safari proof.

### F-5 - No repo-running ORCH-1088 guard currently protects the creator reopen contract

Classification: **production-hardening gap**.

Evidence:

- Existing `npm run test:orch-1087` passed and protects static Home route firewall.
- Existing ORCH-0893 source tests exist for creator-entry lazy server drafts, but targeted Jest execution failed in this worktree because `ts-jest` is not installed in `mingla-business/node_modules`.
- No `test:orch-1088` script exists yet.

Commands:

```bash
cd mingla-business && npm run test:orch-1087
# PASS: ORCH-1085 mobile-web sign-in PASS; ORCH-1087 static route firewall PASS.

cd mingla-business && npx jest orch_0893_creator_entry_routes.test.ts orch_0893a_hydration_gate.test.ts orch_0893_adversarial_edit_route_wrapper.test.ts orch_0893_cycle2_legacy_loop_skips_untouched.test.ts --runInBand
# FAIL: Preset ts-jest not found relative to rootDir .../mingla-business.
```

Impact: implementation can accidentally reopen the static Home action without proving the real route. This must be prevented by a new script and CI gate.

Fix direction: add `npm run test:orch-1088` with static Home action policy, auth terminal-state tests, wizard source gates, and export-proof checks.

## Route Contract For ORCH-1088

To reopen static Home's Create action to the real route, all of this must be true:

1. `/event/create` never spins indefinitely. It reaches one of: Step 1, visible sign-in/retry, visible no-brand/create-brand guidance, visible storage-unavailable guidance, or visible recovery-error guidance.
2. From a fresh valid static callback session, `/home` -> Create -> `/event/create` -> `/event/{d_*}/edit?step=0` succeeds on Android Chrome and Safari.
3. Direct `/event/create` with no valid session does not show an infinite spinner.
4. Draft-store hydration cannot overwrite or lose the newly minted draft.
5. Refreshing `/event/{d_*}/edit?step=N` either resumes the draft or shows a bounded recoverable state.
6. Step 1-7 basic authoring works on phone browsers.
7. Device cover upload/video is either proven or explicitly disabled/degraded in phone browsers with honest copy.
8. Publish validation is visible and provider-neutral.
9. Static Home's `Create event` link changes only in the same implementation that adds and passes the above automated/regression gates.

What can remain safely degraded in ORCH-1088:

- Device image/video upload from phone browser, if the UI clearly says to use desktop/app and no dead tap remains.
- Public preview route, if Step 7 mini-card is disabled or shows explicit "Preview on desktop/app for now" copy on phone browsers.
- Paid publish for not-payout-ready brands, as long as the block says `Connect a bank`/provider-neutral copy and does not open an invalid session link.

What must stay blocked for later ORCHs:

- Hub list/detail parity.
- Marketing Composer parity.
- Account/Payout generated session parity.
- Ari parity.
- Buyer checkout/tax parity.
- Scanner/camera door ops.

## Affected Surfaces

Touched by the spec:

- Business Web phone browser.
- Business Web desktop sanity.
- Static Home Create action.
- Event creator create/edit routes.
- Event draft local/server chain.

Explicitly not touched:

- Consumer iOS app.
- Consumer Android app.
- Business iOS native app.
- Business Android native app.
- Admin Web.
- Buyer/anonymous Web.
- Backend schema/RLS/provider integrations.
- Hub, Ari, Marketing, Account full route families beyond avoiding regressions from creator reopen.

## Verification Performed

Passed:

```bash
cd mingla-business && npm run test:orch-1087
```

Failed due local dependency state, not product behavior:

```bash
cd mingla-business && npx jest orch_0893_creator_entry_routes.test.ts orch_0893a_hydration_gate.test.ts orch_0893_adversarial_edit_route_wrapper.test.ts orch_0893_cycle2_legacy_loop_skips_untouched.test.ts --runInBand
```

Failure:

```text
Preset ts-jest not found relative to rootDir .../mingla-business.
```

Runtime:

- Android Chrome physical direct `/event/create`: FAIL, stayed on `Finishing sign-in...` through about 60 seconds, no crash markers.
- iPhone Simulator Safari direct `/event/create`: FAIL, stayed on `Finishing sign-in...` after 20 seconds.

## Readiness Conclusion

ORCH-1088 is ready for implementor because the blocker and bounded fix contract are proven. It is **not** ready to reopen Home Create yet. The implementation must first make the real creator route terminate safely under every auth/session/current-brand condition, prove the wizard on phone browsers, and only then replace the current static shell action.
