# CLOSE NOTE ORCH-1093 - Business Web Signed-In Route OOM

Date: 2026-06-06
Status: CLOSED PASS Grade A for safety release
Branch: `ORCH-1093-business-web-signedin-route-oom`

## Outcome

Phone browsers no longer enter the OOM-prone Expo boot path on risky signed-in business-web routes. `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/hub/trips` render protected recovery before Expo Web scripts load. `/event/create` remains the only approved real Expo phone route for this slice.

This is a crash-stop and safety release, not full route parity. Full Events, Marketing, Compose, Account, Trips, Ari, payouts, media-picker, overlay, and route-family functionality remains follow-up work.

## Evidence

- `npm run test:orch-1093` PASS.
- `npx expo export -p web` PASS.
- `node scripts/inject-mobile-blur-css.mjs` PASS.
- `node scripts/ci/orch-1093-signedin-route-oom.mjs` PASS with `phoneBoot=2884313; __common=1881530; deferred=true; approved=/event/create`.
- Samsung A72 Chrome verified protected recovery with `expoResourceCount=0` on `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/hub/trips`.
- Android logcat after protected-route run had no `V8 javascript OOM`, `CrRendererMain`, `Aw, Snap`, or renderer-death signatures.
- Seth confirmed the mobile Safari protected-route smoke works.

## Artifacts

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM_REWORK.md`
- `Mingla_Artifacts/reports/QA_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM_REWORK.md`

## Deploy Notes

No migrations, edge functions, backend deploys, or native OTA are attached to ORCH-1093.

Business web requires PR with `[deploy]`, merge to `main`, and deploy from merged main only. Do not deploy from the worktree.

## Follow-Up Boundary

Open a new route-family parity/code-splitting ORCH to restore full functionality. Do not describe ORCH-1093 as restoring Events, Marketing, Compose, Account, or Trips; it prevents their mobile-browser crash path by protected recovery.
