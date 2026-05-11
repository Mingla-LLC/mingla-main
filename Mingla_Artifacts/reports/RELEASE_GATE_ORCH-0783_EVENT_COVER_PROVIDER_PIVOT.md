# RELEASE GATE ORCH-0783 Event Cover Provider Pivot

**Date:** 2026-05-11  
**Operator request:** apply ORCH-0783 release gates, configure provider keys without exposing values, deploy Pexels Edge Function, update `Seth`, clean stale branches, and report remaining smoke status.  
**Final repo state:** `Seth`, `origin/Seth`, and `origin/main` all point to `a6cb084a`.

## Plain-English Summary

The event-cover provider pivot is now deployed at the database/function level. The Pexels secret and GIPHY public env names were configured outside Git, the migration is live, and the Pexels search function is active. Automated release checks passed, but the real iOS/Android/Web parity smoke still needs a signed-in operator/device pass because this terminal session cannot complete real media-picker, native-device, or authenticated browser journeys.

## Actions Completed

| Gate | Result | Evidence |
|------|--------|----------|
| Update `Seth` to latest code | PASS | `Seth`, `origin/Seth`, and `origin/main` at `a6cb084a`. |
| Keep provider key file out of Git | PASS | Added `pexels_giphy_values.md` to `.gitignore`; file remains ignored and untracked. |
| Configure GIPHY public env names | PASS | `EXPO_PUBLIC_GIPHY_API_KEY` and `EXPO_PUBLIC_GIPHY_KEY` set in ignored `mingla-business/.env` and EAS production env. Values were not printed. |
| Configure Pexels Supabase secret | PASS | `supabase secrets set PEXELS_API_KEY` completed for project `gqnoajqerqhnvulmnyvv`. Value was not printed. |
| Apply migration `20260515000018` | PASS after repair | Initial push failed because view columns were inserted before existing `visibility`; migration repaired to append view columns, then `supabase db push --linked` finished. |
| Deploy `event-cover-pexels-search` | PASS | Supabase function `event-cover-pexels-search` ACTIVE version 3, updated `2026-05-11 08:08:47 UTC`. |
| Verify unauthenticated function route | PASS expected 401 | POST without auth returned 401 from Supabase gateway, confirming route exists and `verify_jwt = true`. |
| Delete stale remote branches | PASS | Deleted `orch/0777-ticket-checkout-production`, `orch/0781-clean-tree-stripe-web-import-regression`, `orch-0750e-link-burndown`, and `feat/b1-business-schema-rls`; `git ls-remote --heads` returns no rows for them. |

## Fixes Made During Release Gate

| File | Why |
|------|-----|
| `.gitignore` | Prevent `pexels_giphy_values.md` from being accidentally committed. |
| `supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql` | Preserve Postgres view column order by appending new cover-provider columns after existing columns. |
| `mingla-business/src/components/ui/IconChrome.tsx` | Fix TypeScript failure by passing the required `hovered` field to `PressableStateCallbackType`. |

## Verification Passed

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-pexels-search/index.ts
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts
cd mingla-business && npm run test:orch-0783
cd mingla-business && npx tsc --noEmit
cd mingla-business && npx expo export --platform web --output-dir dist-orch-0783-smoke
```

Results:

- Deno check passed.
- Deno tests passed: 5 tests.
- ORCH-0783 strict-grep + Jest gate passed: 8 suites, 68 tests.
- TypeScript passed after the `IconChrome` fix.
- Expo web export passed; static routes included checkout, order, public event, edit event, and event card surfaces.

## Not Completed

The iOS/Android/Web parity smoke was not fully completed in this terminal session. Required manual/authenticated checks still need a real signed-in organizer/buyer flow and devices or browser session:

- Local image/GIF upload.
- GIPHY selection.
- Pexels selection through authenticated Edge Function call.
- Published cover replacement.
- Public attribution display.
- Checkout/order/card rendering.
- Legacy video rendering.
- `coverHue` fallback.

## EAS Update Attempt

An iOS EAS update was attempted with production env loaded. The bundle/upload phase succeeded, but publish failed with Expo manifest validation errors:

- `ios/associatedDomains`: duplicate items.
- `android/intentFilters`: duplicate items.

EAS also tried to auto-install/configure `expo-updates`, creating native/package changes. Those generated local changes were reverted because they were broader than this release gate and the update did not publish. No EAS update was completed for iOS or Android.

## Commit / Deploy Evidence

- `Seth` release-gate commit: `89c8ece7` (`Stabilize ORCH-0783 release gates`).
- `main` promotion commit: `a6cb084a` (`Promote Seth: stabilize ORCH-0783 release gates`).
- Supabase migration remote state includes `20260515000018`.
- Supabase function `event-cover-pexels-search` is ACTIVE version 3.
