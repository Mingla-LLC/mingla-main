# INVESTIGATION: ORCH-1089 Business Web Signed-In Event Creator Wizard Parity

Date: 2026-06-05  
Agent: Codex `forensic-mingla`  
Mode: INVESTIGATE-THEN-SPEC  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1089-[business-web-event-creator-signedin-wizard]`  
Branch: `ORCH-1089-business-web-event-creator-signedin-wizard`  
Registration commit: `ffdc751d3`

## Verdict

ORCH-1089 is not ready for implementation as a simple Home relink. The repo still has the real seven-step Event Creator wizard behind `/event/create` and `/event/[id]/edit`, but the current proven production-safe phone-browser behavior is the ORCH-1088 safety shell: static Home keeps Create closed, `/event/create` terminates safely when unsigned, and missing-draft edit URLs terminate safely when unsigned.

The signed-in phone-browser happy path remains unproven because no physical Android device was attached and no real signed-in business session/current-brand fixture was available in this worktree. Implementation must restore the real wizard by proving the actual signed-in path end-to-end first, not by linking static Home directly to `/event/create` and hoping the route survives.

## Required Context Ingested

- COMMS-0015 and COMMS-0018: deploy only from merged `main`; never deploy durable production from an ORCH worktree.
- COMMS-0021: seller/payout copy must remain provider-neutral.
- ORCH-1085 Phase 3: full Expo routes can crash phone browsers; static Home was the P0 recovery surface.
- ORCH-1087: static Home route firewall passed; Home actions are hash-shell links, not full route links.
- ORCH-1088: safety slice passed; `/event/create` no-session state is bounded, Reanimated web shim is hardened, phone-web cover upload is intentionally degraded, and full signed-in wizard parity was explicitly left for ORCH-1089.

## User Goal

A signed-in business user on a phone browser should be able to start Create from business Home, reach the real Event Creator wizard, complete Steps 1-7, save a real draft under their current brand, and recover safely from auth, brand, draft, module, and browser failures.

Fixing only the Create link does not deliver that goal. It only changes the trigger; it does not prove auth hydration, current-brand recovery, draft creation, route chunk stability, or Step 1-7 interaction on mobile browsers.

## Runtime Evidence

### Physical Android

Blocked. Re-check in the ORCH-1089 worktree:

```text
$ adb devices -l
List of devices attached
```

There were no device rows. Per the orchestrator update, this report does not claim physical Android Chrome proof.

### Automated Browser Fallback

Commands run:

```text
npm ci
npm run test:orch-1088
npx expo export -p web --output-dir dist
node scripts/inject-mobile-blur-css.mjs
```

Results:

- `npm run test:orch-1088`: PASS.
- Expo web export: PASS.
- Mobile preboot/static injection: PASS.

Playwright/mobile browser proof:

- Static Home served with `python3 -m http.server 8190 --directory dist`.
- Chromium Pixel 5 and WebKit iPhone 13 both loaded `http://127.0.0.1:8190/home.html`.
- Both saw `data-shell-link="create-event"` with `href="#create-event"`.
- Both clicked Create and saw the static shell copy: "The event creator is blocked on phone browsers until the full web workflow is proven stable."
- Both reported no page errors.

Full Expo route recovery proof:

- Export served with `npx serve dist -l 8189 --single`.
- Chromium Pixel 5 and WebKit iPhone 13 loaded `/event/create`.
- Both rendered: "Sign in to create an event. Your browser session is not available on this route. Sign in again. Back to Home."
- Chromium Pixel 5 and WebKit iPhone 13 loaded `/event/d_orch1089_missing/edit?step=0`.
- Both rendered: "We could not load this draft. Refresh, return to Home, or use desktop/the app if this phone browser cannot restore the draft. Back to Home."
- Both reported no page errors for these event-route probes.

Local-server caveat:

- `npx serve --single` redirects `/home.html` to `/home` and serves the full Expo Home route. That is not valid static Home proof and even crashed/headless-hung during an early probe. Static Home proof used Python's plain file server to avoid rewriting `home.html`.

## Current Execution Path

### Static Home

File: `mingla-business/public/home.html`

- Create uses `href="#create-event"` with `data-shell-link="create-event"` at lines 461-467.
- Hub, Ari, Marketing, Account, and payout actions are also hash shell links.
- Create shell copy at lines 624-631 says the event creator remains blocked on phone browsers until the full workflow is proven stable.
- The shell interceptor at lines 744-748 prevents full route navigation.
- Static Home reads `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]` only to display an email label at lines 751-759. It does not validate, refresh, or pass a real Expo auth context into `/event/create`.

External platform note: MDN documents that `localStorage` is origin-scoped and persists across browser sessions, but it is only storage; reading a token from it is not equivalent to proving the app's auth context has a usable session. Source: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API

### Auth Callback

File: `mingla-business/public/auth/callback.html`

- Hardcodes the Supabase URL, anon key, and storage key at lines 85-89.
- Persists session data to localStorage and broadcasts `SIGNED_IN` at lines 167-178.
- Redirects to `/home` after token persistence at lines 210-222.

This explains why static Home can show "Signed in" after callback without proving the full Expo route can hydrate auth/current-brand/draft state.

### `/event/create`

File: `mingla-business/app/event/create.tsx`

- Bounded route timeout and draft hydration timeout are defined at lines 46-47.
- Auth/current-brand/draft hydration state is read at lines 73-82.
- Zustand draft hydration is subscribed at lines 100-115.
- Terminal states are computed at lines 137-153: `signed_out`, `auth_timeout`, `auth_error`, `brand_error`, `no_brand`, `draft_hydration_timeout`.
- Draft minting only runs after auth is ready, current-brand recovery has completed, draft hydration is complete, and `currentBrandId !== null` at lines 167-185.
- Terminal recovery UI renders at lines 195-292.

Current state: safe when unsigned, but signed-in draft minting is still unproven on phone browsers.

### Auth Readiness

Files:

- `mingla-business/src/context/AuthContext.tsx`
- `mingla-business/src/utils/authReadiness.ts`

Key facts:

- Auth bootstrap races `supabase.auth.getSession()` against a 3s timeout.
- A usable business session requires a non-empty `access_token`.
- Late passive usable sessions can be applied after timeout.

This is a good safety net, but ORCH-1089 still needs proof that callback-persisted web sessions become usable enough for `/event/create` before the route concludes `signed_out` or `auth_timeout`.

### Current Brand Recovery

File: `mingla-business/src/hooks/useCurrentBrandRecovery.ts`

- `dataReady` requires auth, a fetched non-error brands query, and a fetched non-error creator account query at lines 40-46.
- `isResolving` waits for unfetched queries, but query errors are not surfaced as `isError`; `isError` only reflects default-brand-save failure at lines 113-116.

This creates a likely misclassification risk: a brands or creator account query error can fall through to `no_brand` instead of `brand_error`.

### `/event/[id]/edit`

File: `mingla-business/app/event/[id]/edit.tsx`

- Web-safe exit helper returns `/home#hub-events` at lines 65-66.
- Missing-draft timeout exists at lines 153-165.
- Missing-draft recovery UI uses the safe static route at lines 491-520.
- But the immediate "draft not found" branch still routes to `"/(tabs)/home"` at lines 260-263.

This is a confirmed source bug for signed-in missing-draft paths: before the bounded recovery UI can render, the route can send phone web users into the full tabs Home route rather than static Home.

### Event Creator Step 1-7

File: `mingla-business/src/components/event/EventCreatorWizard.tsx`

- The wizard imports Step 1-7 components at module load, so the edit route chunk evaluates all step dependencies.
- Step 1 Basics: text fields, event type, format, description. No native-only module found.
- Step 2 When: uses web hidden HTML date/time inputs and native DateTimePicker on native. MDN documents `datetime-local` as the browser-native control for local date/time values: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/datetime-local
- Step 3 Where: Mapbox address autocomplete via `MapboxAddressInput`.
- Step 4 Cover: shared `CoverPickerSheet`; phone-web device image/video upload remains intentionally degraded.
- Step 5 Tickets: ticket editor sheet, sale-period web hidden `datetime-local` inputs, pricing switches, provider-neutral payout semantics.
- Step 6 Settings: visibility and toggles.
- Step 7 Preview: `payoutGateStatus(brand)` and `StripeBlockedCard`; copy is provider-neutral in the current code path.

### Native Module / Web Shim Risks

Files:

- `mingla-business/metro.config.js`
- `mingla-business/src/shims/reactNativeReanimatedWebStub.js`
- `mingla-business/src/components/ui/Sheet.web.tsx`
- `mingla-business/src/components/ui/CoverPicker.tsx`

Current facts:

- Metro aliases `react-native-reanimated` to the web stub on web at lines 198-203.
- The stub exports `Easing.bezier` and `runOnUI`.
- Web Sheet avoids ORCH-0964 self-recursion by importing `./SheetMobile`.
- `CoverPicker.tsx` still imports Expo native modules at top level, but phone-web upload actions are blocked with honest copy.

Runtime evidence confirms no route-wide crash for unsigned `/event/create` and unsigned missing-draft edit routes in Chromium and WebKit mobile. It does not prove signed-in Step 4/Step 5 sheet interactions.

## Findings

### F-1 confirmed UX/product gap: static Home Create is still intentionally closed

Six-field proof:

- File/line: `mingla-business/public/home.html` lines 461-467 and 624-631.
- Exact code/behavior: Create is `href="#create-event"` with `data-shell-link="create-event"` and shell copy says the creator is blocked on phone browsers.
- Current behavior: signed-in phone-browser users cannot open the real Event Creator from static Home.
- Expected behavior: after ORCH-1089, signed-in phone-browser users can reach the real wizard only after the signed-in route is proven stable.
- Causal chain: ORCH-1085 found full-route phone-web instability; ORCH-1087/1088 kept Home static and closed; ORCH-1089 must reopen only after evidence.
- Verification step: Playwright Chromium Pixel 5 and WebKit iPhone 13 clicked Create on `home.html` and saw the shell, not `/event/create`.

Impact: customers on mobile web cannot create listings from Business Home today.

### F-2 confirmed evidence gap: real signed-in wizard parity is not proven

Six-field proof:

- File/line: `/event/create` requires auth readiness/current-brand/draft hydration before draft creation at `app/event/create.tsx` lines 167-185.
- Exact code/behavior: draft creation only occurs when `currentBrandId !== null`, auth is ready, current-brand recovery is done, and draft store hydration has completed.
- Current behavior: unsigned recovery is proven; real signed-in transition to `/event/{draft.id}/edit?step=0` was not proven.
- Expected behavior: a valid business session on phone browser reaches the real Step 1 wizard with a real draft.
- Causal chain: static callback stores a session in localStorage, but static Home does not validate it; `/event/create` independently hydrates Supabase auth, current brand, and draft state.
- Verification step: run physical Android Chrome remote debugging or a real browser session with a known valid business test account/current brand and capture Step 1-7 proof. Chrome's device debugging flow requires an attached device; docs: https://developer.chrome.com/docs/devtools/remote-debugging/

Impact: relinking Home without this proof risks reintroducing the phone-browser spinner/crash class that ORCH-1085/1088 contained.

### F-3 confirmed bug: signed-in missing drafts can route web users into full tabs Home

Six-field proof:

- File/line: `mingla-business/app/event/[id]/edit.tsx` lines 260-263.
- Exact code: `router.replace("/(tabs)/home" as never);`
- Current behavior: when a signed-in edit route cannot find a draft and does not find a legacy/server replacement, it schedules an immediate navigation to the full tabs Home route.
- Expected behavior: web should either show bounded missing-draft recovery or route to static `/home#hub-events`, matching `safeEventsExitRoute()`.
- Causal chain: the file already defines `safeEventsExitRoute()` for web, and the recovery UI uses it, but this immediate branch bypasses the helper.
- Verification step: add a regression for signed-in missing local/server draft and assert no `"/(tabs)/home"` web redirect occurs; then verify on phone web.

Impact: a stale signed-in draft link can send phone-web users into the same full-route Home surface that static Home was designed to avoid.

### F-4 likely bug: current-brand query failures can be shown as "no brand"

Six-field proof:

- File/line: `mingla-business/src/hooks/useCurrentBrandRecovery.ts` lines 40-46 and 113-116.
- Exact code/behavior: `dataReady` excludes `brandsQuery.isError` and `creatorAccount.isError`, but returned `isError` only checks local `errorMessage`.
- Current behavior: a query error can leave `currentBrandId` null while `currentBrandRecovery.isError` is false, allowing `/event/create` to choose the `no_brand` terminal state.
- Expected behavior: brands/creator-account query failures should surface as a retryable brand/auth data error, not as "create or select a brand."
- Causal chain: `/event/create` trusts `currentBrandRecovery.isError`; the hook does not expose upstream query errors.
- Verification step: add a hook/route regression with a failed brands or creator account query and assert `/event/create` renders the brand error/retry path.

Impact: a signed-in user with a transient backend/RLS/network error may be told they lack a brand, which is misleading and blocks recovery.

### F-5 production-hardening gap: there is no ORCH-1089 regression gate

Six-field proof:

- File/line: `mingla-business/package.json` includes `test:orch-1088` but no `test:orch-1089`.
- Exact code/behavior: ORCH-1088 guard validates static closure and no-session recovery; it does not require signed-in Step 1-7 proof.
- Current behavior: the known-safe shell can pass while the real signed-in wizard remains unproven.
- Expected behavior: ORCH-1089 must add an automated gate that fails if Home is reopened prematurely or if the signed-in route/wizard contract regresses.
- Causal chain: ORCH-1088 was intentionally a safety slice; ORCH-1089 changes the product promise.
- Verification step: implement `test:orch-1089` with source guards plus Playwright/browser proof and require it in the scoped commit.

Impact: without a new gate, the regression that closed Create could return silently.

## Non-Causes Disproved

- The wizard is not stripped down: Step 1-7 components still exist and are imported by `EventCreatorWizard`.
- Provider-neutral copy is not currently broken on the traced event creator path: Step 7 uses `payoutGateStatus` and shared blocked-card copy.
- `web.output`, `asyncRoutes`, and Vercel rewrites were not proven to be the root cause of signed-in wizard parity. They must not be changed in ORCH-1089 without ORCH-1085 coordination.
- No database/RLS defect was proven for this slice. Current create/publish services still depend on authenticated Supabase calls and existing `events`/draft publishing paths; no migration is justified by this investigation.

## Cross-Surface Impact

Touched/proven:

- Business Web static Home.
- Business Web `/event/create`.
- Business Web `/event/[id]/edit`.
- Business Web Event Creator Step 1-7 source path.

Not directly touched/proven:

- Consumer iOS.
- Consumer Android.
- Buyer/anonymous Web beyond public Event Creator dependencies.
- Business iOS.
- Business Android native.
- Admin Web.

## Open Questions

1. What exact production/staging business test account should be used for signed-in phone-browser proof?
2. Does that account already have a current/default brand, payout account state, and permissions that exercise both free and paid publish paths?
3. Will ORCH-1085 coordinate any route/rewrite changes if `/home` must map to `home.html` outside the current static deployment behavior?

## Conclusion

The next implementor must not relink Home first. They must first add the signed-in ORCH-1089 gate, fix the signed-in missing-draft web exit, harden current-brand error classification, prove Step 1-7 on phone browsers, and only then restore static Home Create to the real route.
