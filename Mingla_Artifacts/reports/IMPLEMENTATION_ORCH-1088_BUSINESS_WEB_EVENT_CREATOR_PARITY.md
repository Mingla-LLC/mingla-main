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
