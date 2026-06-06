# IMPLEMENTATION - ORCH-1088 Business Web Event Creator Phone-Browser Parity

Date: 2026-06-06
Status: implemented, partially verified
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1088-[business-web-event-creator-parity]/`
Branch: `ORCH-1088-business-web-event-creator-parity`

## Summary

ORCH-1088 implemented the safe-termination and phone-web hardening slice for the Business Web event creator. `/event/create` no longer has an unbounded `Finishing sign-in...` spinner for signed-out, auth timeout/error, brand error/no-brand, or draft-hydration timeout states. `/event/[id]/edit` now has a bounded missing-draft recovery state and routes web exits to the static-safe `/home#hub-events` path instead of the unsafe Hub route. Phone-web device cover uploads are degraded with honest copy while GIF, stock photo, and color-cover paths remain available.

Static Home's `Create event` action remains on the ORCH-1087 shell. I did not reopen it because the required Android Chrome and Safari real-wizard gates were not completed in this implementation pass.

## Files Changed

- `mingla-business/app/event/create.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/src/components/ui/CoverPicker.tsx`
- `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs`
- `mingla-business/src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts`
- `mingla-business/package.json`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`

## Spec Traceability

| Spec area | Implementation |
|---|---|
| `/event/create` bounded auth/session/brand/draft states | Added route and draft hydration timeouts, typed terminal states, visible recovery UI, `Try again`/`Sign in again`/`Back to Home`, and console warnings. |
| No-brand behavior | Shows `Create or select a brand before starting an event.` and does not route into unsafe Home/Hub. |
| Draft hydration failure | Shows `This browser cannot save drafts right now.` and does not mint a draft before hydration. |
| Edit-route missing local draft | Adds 6s bounded recovery with `We could not load this draft.` |
| Static-safe exits | Web event exits now use `/home#hub-events`; native keeps `/(tabs)/hub/events`. |
| Cover/media launch contract | Phone-web device image/video upload buttons are disabled with copy; GIF/stock/color paths remain available. |
| Provider-neutral copy | Paid publish checks assert `Connect a bank` and no user-facing `Connect Stripe` in the shared publish card. |
| Static Home reopen | Not reopened; ORCH-1087 shell remains until Android/Safari gates pass. |

## Cross-Surface Matrix

| Surface | Result |
|---|---|
| Business Web phone browser | Primary target. Safer route termination and media degradation implemented; full real-wizard phone proof not completed. |
| Business Web desktop | Existing desktop route behavior preserved; desktop device upload remains enabled. |
| Business iOS native | No intended behavior change; safe exit helper preserves native Hub route. |
| Business Android native | No intended behavior change; safe exit helper preserves native Hub route. |
| Consumer iOS / Android | Not touched. |
| Buyer / anonymous Web | Not touched. |
| Admin Web | Not touched. |
| Backend schema/RLS/provider payloads | Not touched. |

## Verification

Passed:

```bash
cd mingla-business && npm install
cd mingla-business && npm run test:orch-1088
cd mingla-business && npx expo export -p web
cd mingla-business && node scripts/inject-mobile-blur-css.mjs
cd mingla-business && npm run test:orch-1088
```

`npm run test:orch-1088` covers:

- `npm run test:orch-1087`
- ORCH-1088 static/source guard
- ORCH-1088 Jest source-contract tests

Export evidence:

- `npx expo export -p web` completed and wrote `dist`.
- `node scripts/inject-mobile-blur-css.mjs` injected `mingla-mobile-web-home-preboot` and `mingla-mobile-web-no-blur`.
- Route chunks exist under `dist/_expo/static/js/web/`, including `create-*.js` and `edit-*.js`.
- The exported `create`/`edit` chunks contain the new terminal/recovery strings.

Partially verified / not passed:

```bash
cd mingla-business && npm run typecheck
```

This still fails on pre-existing unrelated repo errors, including account icon typing, checkout buyer implicit anys, marketing rich editor types, package-level missing React typings, and tests with stale `DraftEvent.category` fields. The ORCH-1088-local `isPhoneWeb` type error found during the first run was fixed; no remaining reported typecheck errors point at ORCH-1088-touched files.

Local static-server note:

```bash
cd mingla-business && npx serve dist -l 4508
curl -I http://localhost:4508/event/create
```

The generic static server returned 404 for `/event/create` because it does not emulate Vercel's SPA fallback. This is not counted as runtime route proof.

## Phone-Browser Evidence

No physical Android Chrome or Safari real-wizard pass was completed in this implementation pass. Because those gates are explicitly required before reopening static Home's Create action, the Home action remains shelled.

Required next runtime gates:

1. Android Chrome physical Samsung A72 `R58R54YV7JT`: open the deployed/preview Home, tap Create only after reopening is intentionally enabled, verify Step 1 through Step 7, refresh/re-entry, close/discard, and fatal logcat grep.
2. Safari: run the same flow on iPhone Simulator Safari and physical iPhone Safari if available.
3. If those pass, reopen only the static Home Create action in a follow-up commit with `data-orch-1088-create-reopened`; do not reopen Hub/Ari/Marketing/Account/payout links.

## Risk And Residual Work

- The real wizard was not proven on phone browsers end-to-end, so this branch is not ready to tell Seth that Create is reopened.
- Static Home remains safe and Expo-free.
- No backend/schema/RLS/provider deploy notes are needed.
- No deploy, merge, reap, OTA, or Supabase action was performed.

## Readiness

Ready for tester: conditional. Tester can verify the implemented safety slice and source/export guards now, but full PASS for ORCH-1088 requires a later phone-browser runtime pass and static Home reopen commit.

## Rework - 2026-06-06 Ari/Reanimated Web Shim Blocker

Status: implemented and verified for the scoped rework blocker.

### Blocker

The orchestrator's local Android Chrome route probe for `http://127.0.0.1:8088/event/create?orch1088nosession=1` crashed before the `/event/create` terminal UI could render with:

```text
_reactNativeReanimated.Easing.bezier is not a function
src/components/ari/AriOrb.tsx:57 -> app/(tabs)/ari.tsx
```

This matched the earlier ORCH-1087 F-4 finding. The crash was global web-route evaluation, not an Event Creator product-flow bug.

### Rework Changes

| File | Change |
|---|---|
| `mingla-business/src/shims/reactNativeReanimatedWebStub.js` | Added minimal web-safe `Easing.bezier` support. It uses React Native's easing when present and otherwise returns the existing linear fallback function. |
| `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs` | Added a guard that the actual Reanimated web alias target exports the `bezier` support required by Ari and other web-evaluated components. |
| `mingla-business/src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts` | Added regression coverage proving Ari still calls `Easing.bezier`, the web shim exports it, the fallback is callable at runtime with a mocked React Native module, and `/event/create` keeps its no-session/recovery copy without importing Ari. |

### Cross-Surface Rework Matrix

| Surface | Result |
|---|---|
| Business Web phone browser | Primary target. The exported route now reaches the no-session terminal UI without the Ari `Easing.bezier` crash. |
| Business Web desktop | Shared web shim improved; no route/copy behavior changed. |
| Business iOS native | Not affected; Metro aliases this shim only on `platform === "web"`. |
| Business Android native | Not affected; Metro aliases this shim only on `platform === "web"`. |
| Consumer iOS / Android | Not touched. |
| Buyer / anonymous Web | Not touched. |
| Admin Web | Not touched. |
| Backend schema/RLS/provider payloads | Not touched. |

### Verification - Rework

Passed:

```bash
cd mingla-business && npm run test:orch-1088
cd mingla-business && npx expo export -p web
cd mingla-business && node scripts/inject-mobile-blur-css.mjs
cd mingla-business && npm run test:orch-1088
```

Local exported-route probe:

```bash
cd mingla-business && npx serve dist -l 8088 --single
```

Port `8088` was already in use, so `serve` selected `http://localhost:59426`. I then probed:

```text
http://localhost:59426/event/create?orch1088nosession=1
```

Playwright mobile Chrome-shaped result:

```json
{
  "url": "http://localhost:59426/event/create?orch1088nosession=1",
  "text": "Sign in to create an event.\nYour browser session is not available on this route.\nSign in again\nBack to Home",
  "errors": [],
  "bezierErrors": [],
  "consoleBezier": [],
  "consoleSample": [
    "warning: [event/create] terminal-state {terminalState: signed_out, authStatus: signed_out, brandError: null}"
  ]
}
```

The temporary local server was stopped after the probe. No deploy, merge, reap, OTA, backend, schema, or provider change was performed.

### Readiness After Rework

Ready for tester: yes, for the scoped rework blocker and the still-closed static Home state. Static Home Create remains intentionally unreopened until tester/orchestrator explicitly authorizes the next runtime reopen pass.

## Rework - 2026-06-06 Draggable Flatlist/Reanimated Web Shim Blocker

Status: implemented and verified on the physical Android browser.

### Blocker

After the Ari `Easing.bezier` shim fix, the orchestrator's physical Samsung A72 Chrome probe for:

```text
http://127.0.0.1:8088/event/create?orch1088nosession=2
```

still crashed before `/event/create` could render, this time with:

```text
(0 , _reactNativeReanimated.runOnUI) is not a function
node_modules/react-native-draggable-flatlist/lib/module/components/CellRendererComponent.js:161
```

This was another shared web-route evaluation failure: the business web bundle imports `react-native-draggable-flatlist`, and that package expects Reanimated's `runOnUI` export even when the Event Creator route itself is trying to show a no-session recovery screen.

### Rework Changes

| File | Change |
|---|---|
| `mingla-business/src/shims/reactNativeReanimatedWebStub.js` | Added a minimal web-safe `runOnUI` export that mirrors the existing `runOnJS` fallback shape by returning a callable wrapper. |
| `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs` | Added source guards that the Reanimated web alias target exports `runOnUI`. |
| `mingla-business/src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts` | Broadened the shim regression from Ari-only to route-wide animation/list imports and added runtime proof that `runOnUI` is callable. |

### Verification - Rework 2

Passed:

```bash
cd mingla-business && npm run test:orch-1088
cd mingla-business && npx expo export -p web
cd mingla-business && node scripts/inject-mobile-blur-css.mjs
cd mingla-business && npm run test:orch-1088
```

Physical Android Chrome proof:

```text
Device: Samsung Galaxy A72, adb serial R58R54YV7JT
URL: http://127.0.0.1:8088/event/create?orch1088nosession=3
```

CDP result:

```json
{
  "finalUrl": "http://127.0.0.1:8088/event/create?orch1088nosession=3",
  "title": "Business",
  "bodyFirst1200": "Sign in to create an event.\nYour browser session is not available on this route.\nSign in again\nBack to Home",
  "hasSignInTerminal": true,
  "hasStuckFinishingOnly": false,
  "hasSomethingWrong": false
}
```

Fatal logcat grep for `V8 javascript OOM`, `CrRendererMain`, `Aw, Snap`, `fatal exception`, `SIGSEGV`, `Render process`, `Easing.bezier`, and `runOnUI` returned no matches after the passing probe.

No deploy, merge, reap, OTA, backend, schema, or provider change was performed.

### Readiness After Rework 2

Ready for tester: yes, for Android phone-browser no-session route stability, source/export guards, static Home remaining shelled, and the provider-neutral copy constraint. Full Event Creator web parity still requires a signed-in phone-browser wizard pass before static Home's Create action can be reopened.
