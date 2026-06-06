# SPEC - ORCH-1088 Business Web Event Creator Phone-Browser Parity

Date: 2026-06-05 / 2026-06-06 UTC
Mode: SPEC from ORCH-1088 investigation
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1088-[business-web-event-creator-parity]`
Branch: `ORCH-1088-business-web-event-creator-parity`

## 1. Outcome And Scope

Goal: reopen static Home's `Create event` action only when the real Business Web Event Creator works on phone browsers.

The user promise is not "show a spinner" or "show a shell." The promise is: a signed-in organiser on a phone browser can start an event listing, enter the core event details, move through the wizard, see honest validation/publish readiness, and leave without losing work or crashing the browser.

In scope:

- `mingla-business/public/home.html`
- `mingla-business/app/event/create.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/event/CreatorStep1Basics.tsx`
- `mingla-business/src/components/event/CreatorStep2When.tsx`
- `mingla-business/src/components/event/CreatorStep3Where.tsx`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/components/event/CreatorStep5Tickets.tsx`
- `mingla-business/src/components/event/CreatorStep6Settings.tsx`
- `mingla-business/src/components/event/CreatorStep7Preview.tsx`
- `mingla-business/src/components/event/TicketTierEditSheet.tsx`
- `mingla-business/src/components/event/MultiDateOverrideSheet.tsx`
- `mingla-business/src/components/event/PublishErrorsSheet.tsx`
- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/utils/draftEventValidation.ts`
- `mingla-business/src/utils/draftDirtyCheck.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/utils/authReadiness.ts`
- `mingla-business/src/context/AuthContext.tsx`
- `mingla-business/src/hooks/useCurrentBrandRecovery.ts`
- `mingla-business/src/components/location/MapboxAddressInput.tsx`
- `packages/location-input/src/MapboxAddressInput.tsx` only if the creator address field needs a phone-browser layout/state fix.
- `mingla-business/src/components/ui/CoverPicker.tsx`
- `mingla-business/src/components/ui/CoverPickerSheet.tsx`
- `mingla-business/src/components/ui/coverTarget.ts`
- `mingla-business/vercel.json` only if static export/routing needs a creator-specific static fallback.
- `mingla-business/scripts/ci/*` and `mingla-business/package.json` for the ORCH-1088 test script.

Out of scope:

- No Supabase migrations.
- No RLS changes.
- No edge-function deploys.
- No Stripe, Paystack, Mapbox, Cloudinary, Giphy, or Pexels API payload changes.
- No native app changes.
- No Hub/Ari/Marketing/Account full-route parity work.
- No buyer checkout/tax work.
- No deploy, OTA, merge, or reap by implementor.

Hard guard: if implementation discovers that a backend/provider payload must change, stop and route back to forensics/spec. COMMS-0003 requires canonical provider docs URLs inline for every changed external endpoint, enum, parameter, and payload. This spec intentionally avoids that.

## 2. Implementor Verdict

Ready for Codex `implementor-mingla`.

Implement as one bounded PR: **ORCH-1088 Event Creator phone-browser parity reopen**.

Do not reopen static Home's Create action until every locked acceptance criterion in this spec passes. If the real route cannot pass in this PR, leave the ORCH-1087 shell in place and return a NEEDS-REWORK report.

## 3. Locked Route Contract

### 3.1 `/event/create`

LOCKED:

- The route must never display `Finishing sign-in...` for more than a bounded timeout without changing to a terminal or actionable state.
- Valid signed-in session + recovered current brand + hydrated draft store must create a client `d_*` draft and replace to `/event/{draftId}/edit?step=0`.
- Signed-out/no usable session must show clear sign-in guidance or route to the appropriate sign-in/static Home path. It must not spin.
- Auth bootstrap timeout must show a retry/re-auth state, not permanent `Finishing sign-in...`.
- Current-brand recovery error must show a recoverable error state, not permanent spinner.
- No-brand state must show "Create or select a brand before starting an event" or route to an existing brand-creation path if that path is phone-browser safe. If the brand path is not phone-browser proven, show desktop/app guidance.
- Draft-store hydration failure or timeout must show "Could not load local drafts. Refresh or use desktop/app" copy.
- The route must log a console warning for auth/brand/storage failure modes so silent failure does not return.

OPEN:

- Implementor may keep a spinner during the initial bounded wait. Suggested timeout: 4,000ms after AuthContext `loading=false`, or 6,000ms total after route mount, whichever is easier to implement without race risk.
- Implementor may add a small local route-state helper in `event/create.tsx` if it keeps the route readable.

### 3.2 `/event/{id}/edit?step=N`

LOCKED:

- Direct edit-route entry with a local `d_*` id must render a bounded loading/recovery state and then either render the wizard, find a `legacyLocalDraftId` server replacement, or show clear missing-draft recovery. It must not sit on `Loading...` indefinitely.
- Refresh/re-entry after the first dirty autosave must land on the server id and preserve user-entered fields.
- A stale server draft must keep the existing recovery behavior and not regress the stale-draft toast.
- Close X on a pristine create-mode draft must delete the local-only draft and route to a browser-safe destination.
- Close X on edited create-mode draft must show discard confirmation and not dead-end behind the keyboard.
- Edit route must not navigate a phone-browser user into Hub if Hub remains static-shelled/unsafe; if `/(tabs)/hub/events` is still unsafe for phone browsers, route exits should go back to `/home#hub-events` or a static-safe Events shell on web phone.

OPEN:

- Implementor may add a phone-web specific `safeBusinessExitHref()` helper if repeated in create/edit exits.

### 3.3 Static Home Create Action

LOCKED:

- Keep ORCH-1087 static shell behavior until the real route passes automated tests, export proof, Android Chrome smoke, and Safari smoke.
- In the same commit that reopens Create, change only the Create event action. Do not reopen Hub, Ari, Marketing, Account, or payout links.
- The reopened action may link directly to `/event/create` only for phone browsers after proof. If implementor prefers a guarded intermediate static page, that page must immediately route to `/event/create` only when a validated browser session exists.
- Static Home must remain Expo-free: no `_expo/static` scripts, no app bundle tokens.
- Static Home must preserve provider-neutral copy: `Payout account`, `Connect bank`, `Payments & Bank`; never reintroduce `Stripe account`.

## 4. Wizard Acceptance Contract

### 4.1 Boot

LOCKED:

- The wizard must render Step 1 on Android Chrome and Safari after Create.
- First Step 1 paint must not show root error boundary, blank page, Chrome `Aw, Snap`, Safari blank, or a reload loop.
- Boot must not create a server `events` row until first dirty autosave. Preserve ORCH-0893 lazy-server-draft invariant.
- Boot must preserve Zustand hydration guard from `event/create.tsx`.

### 4.2 Step 1 - Basics

LOCKED:

- Name, format, category, description, party type/vibe/music chips, and errors must be usable by touch.
- Keyboard must not hide the focused description field.
- Continue with required fields missing must show inline errors and stay on Step 1.
- Entered fields must persist after navigating away and back within the wizard.

### 4.3 Step 2 - When

LOCKED:

- Single-date date, doors-open, and end-time controls must open browser-native or browser-safe controls on Android Chrome and Safari.
- Multi-date AddDateSheet must work on phone browsers or be explicitly disabled with copy.
- Recurrence controls must not use native-only DateTimePicker on web.
- Timezone sheet must be scrollable and tappable on phone browsers.
- Overnight/end-before-start logic must preserve current `computeEndsAtUtcWithSmartInfer` behavior.

Implementation note: existing `CreatorStep2When.tsx` already has hidden HTML input/showPicker web branches. Preserve them. Platform reference: MDN documents `datetime-local` input behavior/fallback and the Visual Viewport API for mobile keyboard/viewport handling:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local
- https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API

### 4.4 Step 3 - Where

LOCKED:

- In-person vs online toggle must work.
- Mapbox address input must allow typing, show loading, suggestions, no-results/offline state, pick details, clear, and retry.
- Suggestion list must remain visible above the bottom dock/keyboard on phone browsers.
- Online URL validation must remain visible and actionable.
- No Mapbox endpoint/payload change is allowed in ORCH-1088.

### 4.5 Step 4 - Cover

LOCKED:

- Cover step must not crash the edit-route chunk on web.
- Hue/color-only cover path must work on phone browsers.
- GIF/Pexels/stock provider paths may work only if already using existing provider service shapes and passing runtime proof.
- Device image/video upload must either:
  - pass Android Chrome and Safari runtime proof, including successful server persistence and display, or
  - be disabled/degraded on phone browsers with honest copy and no dead tap.
- If local `d_*` drafts do not yet have a server UUID, any media upload button must be disabled until the first dirty autosave replaces the draft id with a server id, or must force/create the server draft explicitly through existing `createServerDraft` without adding a provider/backend contract.
- Video trimming on web may remain degraded to raw clip/no trim only if the UI says so and upload is otherwise proven.

OPEN:

- Suggested launch path: keep cover hue and provider selections; disable device upload/video on phone browsers until ORCH-1085-P3D media-picker parity.

### 4.6 Step 5 - Tickets

LOCKED:

- Add/edit/remove ticket tier sheet must work on Android Chrome and Safari.
- Ticket name, price, quantity, sale period, and description must be keyboard-safe.
- Free event path must not require payout readiness.
- Paid ticket path must use provider-neutral bank/payout copy.
- Who-covers-costs section must retain existing pricing switch semantics; no pricing engine/backend change.
- Sale period web pickers must be browser-safe or disabled with copy.

### 4.7 Step 6 - Settings

LOCKED:

- Visibility, approval, transfer, and settings toggles must work by touch.
- Continue must preserve settings state.
- Validation must not block with hidden errors.

### 4.8 Step 7 - Preview And Publish Gate

LOCKED:

- Preview summary must render without media crash.
- Publish validation errors must open the errors sheet and allow jump-to-step.
- Paid-and-no-payout state must say `Connect a bank` or equivalent provider-neutral bank copy.
- Publish for free events must not require bank/payout connection.
- Publish mutation may use the existing `usePublishBusinessEventDraft` path only. No backend/RPC change.
- If publish itself cannot be safely proven in phone browsers for ORCH-1088, keep final publish disabled on phone browsers with explicit desktop/app guidance, but the wizard must still save a draft.

OPEN:

- Public preview route may remain disabled/degraded on phone browsers if it has not been separately proven.

## 5. Auth/Session/Brand State Matrix

Implementation must cover all states:

| State | Required behavior |
|---|---|
| Valid session, current brand id persisted, brand fetch succeeds | Create draft and route to Step 1. |
| Valid session, no current brand id, user has brands | Recover/set a brand, then create draft. |
| Valid session, no brands | Show no-brand guidance; do not spin. |
| Static callback localStorage session exists, Supabase getSession succeeds | Full Expo route becomes ready and creates draft. |
| Static callback localStorage stale/invalid | Show re-auth/sign-in guidance; do not spin. |
| Supabase getSession times out | Show retry/re-auth state; do not spin. |
| Current-brand recovery query errors | Show recoverable brand error with retry; do not spin. |
| Zustand draft-store hydration not finished after timeout | Show local-draft recovery copy; do not create draft into pre-hydration state. |
| Browser storage unavailable/private mode | Show storage-unavailable copy; do not claim draft persistence works. |

## 6. Tests Required In Same Commit

Add `npm run test:orch-1088` in `mingla-business/package.json`.

It must run at least:

1. `npm run test:orch-1087`
2. A static/source guard, e.g. `scripts/ci/orch-1088-event-creator-phone-parity.mjs`
3. Focused Jest tests for auth route states and creator-entry behavior once local Jest deps are available.

Required automated guard coverage:

- Fails if `public/home.html` links Create event to `/event/create` before an ORCH-1088 pass marker is present in the same guard.
- Fails if static Home gains any direct full-route link from ORCH-1087's blocked list except the single approved Create event link.
- Fails if static Home includes `Stripe account`.
- Fails if `/event/create` source has no terminal state for signed-out/auth-error/auth-timeout/current-brand-error.
- Fails if `/event/create` can wait only on `!isAuthReady || currentBrandRecovery.isResolving` without a timeout or terminal branch.
- Fails if phone-web media upload remains enabled for local `d_*` drafts without a server-id guard.
- Fails if creator publish-bank copy reintroduces `Connect Stripe` in the paid publish path.
- Fails if `EventCreatorWizard` exits phone-web users to `/(tabs)/hub/events` while Hub remains unsafe for phone browsers.

Required Jest coverage:

- `event/create` valid ready state creates draft and calls router.replace with `/event/{d_*}/edit?step=0`.
- signed-out state renders visible reauth/sign-in copy after timeout.
- auth bootstrap timeout renders retry/reauth copy.
- brand recovery error renders retry/no-brand guidance.
- draft-store hydration not ready does not call `createDraft`; hydration timeout renders recovery copy.
- edit-route missing local draft shows bounded recovery instead of infinite loading.
- local `d_*` dirty autosave still lazy-inserts through `createServerDraft` and merges live fields.
- payout-blocked paid publish uses provider-neutral bank copy.

Required export/build proof:

```bash
cd mingla-business
npx expo export -p web
node scripts/inject-mobile-blur-css.mjs
npm run test:orch-1088
```

The export proof must confirm:

- static Home remains Expo-free;
- mobile blur-kill/preboot marker remains in `dist/index.html`;
- `/event/create` route chunk exists;
- no build error from web imports in the event creator chunk.

If Jest cannot run because `ts-jest` or node_modules are missing in the worktree, implementor must fix the local dependency/install state or route back. Do not replace automated tests with only manual gates.

## 7. Manual Runtime Gates

These are required before static Home Create can reopen.

### Android Chrome physical device

Use Samsung Galaxy A72 `R58R54YV7JT`.

Commands/evidence:

```bash
adb -s R58R54YV7JT forward tcp:9222 localabstract:chrome_devtools_remote
curl -s http://127.0.0.1:9222/json/version
adb -s R58R54YV7JT logcat -c
```

Smoke:

1. Open `https://business.usemingla.com/home`.
2. Confirm static Home is Expo-free and signed-in display is correct.
3. Tap `Create event`.
4. Expected: reaches real creator Step 1, not shell, spinner, Aw Snap, or error boundary.
5. Fill Step 1 required fields and continue.
6. Step 2: pick single date/time; add multi-date if enabled; choose timezone.
7. Step 3: type address, select suggestion, clear/retry; test online URL.
8. Step 4: use launch-approved cover path; if device upload disabled, tap proves honest disabled copy.
9. Step 5: add free ticket and one paid ticket; verify provider-neutral bank readiness.
10. Step 6: toggle settings.
11. Step 7: verify validation sheet, free publish readiness, paid bank block, and publish/disabled contract.
12. Refresh at Step 3 or later; expected: draft resumes or clear recovery state.
13. Close/discard; expected: routes to static-safe Home/Events shell, not unsafe Hub.
14. Logcat grep for `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, `Aw, Snap`, `fatal exception`, `SIGSEGV`, `Render process`; expected zero new fatal lines.

Chrome official remote-debugging reference for the setup: https://developer.chrome.com/docs/devtools/remote-debugging .

### Safari

Minimum for implementor/tester:

- iPhone Simulator Safari automated screenshot pass.
- Physical iPhone Safari operator-in-loop pass if device is available.

Smoke mirrors Android:

1. Open production or preview Home.
2. Tap Create.
3. Complete Steps 1-7 or explicitly confirm the launch-approved degraded states.
4. Test keyboard focus and viewport on long text, date/time, address, ticket sheet.
5. Refresh/re-entry and close/discard.
6. Confirm no blank page, reload loop, stuck spinner, or off-screen picker.

## 8. Visual And UX Contract

LOCKED:

- Do not create a landing page. The first real screen after Create is either the wizard or a concise, recoverable state.
- Spinner copy must be specific to the actual state:
  - `Finishing sign-in...` only during an active auth bootstrap/refresh window.
  - `Getting your brand ready...` during current-brand recovery.
  - `Loading local drafts...` during draft-store hydration.
- Terminal error copy must be plain:
  - Signed out: `Sign in to create an event.`
  - Auth timeout: `We could not finish sign-in. Refresh or sign in again.`
  - No brand: `Create or select a brand before starting an event.`
  - Storage unavailable: `This browser cannot save drafts right now. Use desktop or the app.`
  - Brand recovery error: `We could not load your brand. Try again.`
- Buttons:
  - Primary: `Try again` for recoverable auth/brand/storage states.
  - Secondary: `Back to Home`.
  - Sign-in state may use `Sign in again`.
- Keep dark creator canvas consistent with current wizard: `canvas.discover`, warm accent, existing `Spinner`, existing `Button`, existing `Toast`.
- Phone viewport must preserve safe areas and avoid text under browser chrome or keyboard.
- Text must not mention internal ORCH IDs to users.

OPEN:

- Implementor can polish exact layout of terminal states using existing Mingla UI primitives.
- If a static fallback page is needed, it may reuse ORCH-1087 shell styling, but the preferred outcome is an in-route recoverable state.

## 9. Cross-Surface Impact

| Surface | Impact |
|---|---|
| Business Web phone browser | Primary target. |
| Business Web desktop | Must remain working; use as sanity, not the only proof. |
| Business iOS native | No change intended. |
| Business Android native | No change intended. |
| Consumer iOS | None. |
| Consumer Android | None. |
| Buyer/anonymous Web | None. |
| Admin Web | None. |
| Backend schema/RLS | None. |
| Provider integrations | None; existing Mapbox/media/provider services only. |

## 10. Implementation Order

1. Read this spec and the investigation report.
2. Confirm worktree/branch and clean status.
3. Add ORCH-1088 CI guard and package script first, initially failing on current source where practical.
4. Add `/event/create` bounded state machine and terminal UI.
5. Add edit-route bounded missing-draft/re-entry recovery and static-safe phone-web exit target.
6. Harden Step 4 cover launch contract: disable/degrade or prove media upload for phone web.
7. Verify Step 5 ticket sheet and publish bank copy; patch only if tests/smoke prove a gap.
8. Reopen static Home Create link only after local route gates and Android/Safari smoke pass. If runtime fails, leave shell.
9. Run `npm run test:orch-1088`.
10. Run export/inject proof.
11. Produce `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`.
12. Commit product code, tests, and implementation report together.

## 11. Deploy Discipline

No deploy from the worktree.

If implementation changes web runtime/static assets, the PR title must include `[deploy]`.

Required sequence:

1. Implement on ORCH-1088 worktree branch only.
2. Commit product code, tests, and implementation report together.
3. Push branch and open PR.
4. Merge through GitHub only after required checks pass.
5. Verify `origin/main` contains the squash commit and changed files.
6. Deploy Vercel from merged `main` only.
7. Run production Android Chrome and Safari smoke after deploy.

No Supabase deploy, edge-function deploy, native OTA, or native rebuild is part of ORCH-1088.

## 12. Success Criteria

ORCH-1088 implementation succeeds only when:

- `/event/create` has no infinite spinner under signed-out, stale-session, auth-timeout, current-brand-error, no-brand, or draft-hydration states.
- Valid signed-in phone-browser session reaches Step 1.
- User can complete the launch-approved wizard path through Step 7 on Android Chrome and Safari.
- Draft data persists across step navigation and refresh/re-entry.
- Close/discard routes to static-safe Home/Events shell, not unsafe Hub.
- Cover/media behavior is either proven or honestly degraded with no dead tap.
- Publish readiness is provider-neutral and no `Connect Stripe` copy returns in the phone-browser paid publish path.
- `npm run test:orch-1088` passes.
- Web export and blur-kill injection proof pass.
- Static Home Create action is reopened only in the same verified commit.
- Production post-merge smoke passes on Android Chrome and Safari before Seth is told to test the reopened action.

## 13. Downstream Routing

After orchestrator review, route to Codex `implementor-mingla` for ORCH-1088 implementation. Expected implementation output: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`.
