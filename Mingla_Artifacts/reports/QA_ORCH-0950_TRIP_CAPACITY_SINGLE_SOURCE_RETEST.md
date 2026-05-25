# QA Retest - ORCH-0950 Trip Capacity Single Source

Retest timestamp: 2026-05-24 17:26 EDT  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`  
Branch: `ORCH-0950-trip-capacity-single-source`  
Tester: Codex tester-mingla  
Verdict: FAIL

## Executive Summary

P1-001 is fixed. The ORCH-0950 branch diff no longer carries the prior ORCH-0946/ORCH-0947 migration/allowlist leak, and the product diff is scoped to ORCH-0950 trip capacity single-source behavior plus expected artifact/report updates.

Do not CLOSE yet. The mandatory runtime matrix is still incomplete: iOS loads the business app but did not prove the DC Adventure planner edit path; Android business runtime failed before install because the native debug build failed; business-web preview loaded only to the unauthenticated sign-in screen and did not prove planner edit/reload behavior.

The DC Adventure-style live-fire backend proof passed: live data shows canonical capacity in `ticket_types.quantity_total`, no JSONB `events.theme.business_trip.capacity`, and buyer checkout for quantity 6 returned a hosted checkout redirect instead of `ticket_capacity_exceeded`.

## Inputs Reviewed

- `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`

## Hard Guards Observed

- No migration apply was run.
- No edge function deploy was run.
- No checkout RPC changes were made.
- No ORCH-0946/ORCH-0947 implementation scope was modified.

## P1-001 Retest

Status: PASS

Evidence:

- `git diff --name-only origin/main...HEAD` contains only ORCH-0950 strict-grep, artifact/report, business trip capacity, and ORCH-0950 migration/test files.
- Forbidden-scope scan found no product diff files or symbols for `0946`, `0947`, `public_ticket_types_remaining`, or `pg_public_ticket_types_remaining`.
- The only ORCH-0946/ORCH-0947 matches in added diff text are implementation-report prose stating those items are out of scope.

Conclusion: the prior ORCH-0946 migration/allowlist leak that caused P1-001 is fixed.

## Static And Regression Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| ORCH-0950 strict grep | PASS | `I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE: PASS files=1437 violations=0` |
| ORCH-0950 strict grep self-test | PASS | 4/4 cases passed |
| Marketing hub strict grep | PASS | C1-C7 passed |
| Deno canonical capacity regression | PASS | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts`, 6/6 passed |
| Business Jest guard | PASS | `npx jest src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts --runInBand`, 1/1 passed |
| Whitespace check | PASS | `git diff --check` produced no output |

## Code Path Inspection

Status: PASS

Verified expected behavior in current code:

- `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql` strips legacy `theme.business_trip.capacity`, backfills capacity into `ticket_types.quantity_total`, routes `biz_update_live_trip` capacity updates into `ticket_types.quantity_total`, and validates publish capacity from ticket types.
- `mingla-business/src/services/tripsService.ts` reads trip capacity from `ticket_types.quantity_total`, throws before network for `updateTripBasics({ businessTrip: { capacity } })`, and writes capacity through pricing/ticket type update.
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` routes Step 1 autosave capacity through the pricing writer.
- `mingla-business/src/utils/tripAdapter.ts` diffs capacity from `ticket_types.quantity_total`.

## Live-Fire Backend Proof

Status: PASS

Read-only live proof for `The DC Adventure`:

```json
{
  "eventId": "060d0483-50db-48d1-840b-73d9fc59356a",
  "title": "The DC Adventure",
  "status": "scheduled",
  "eventType": "trip",
  "hasThemeCapacity": false,
  "ticketTypeId": "d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e",
  "ticketName": "Standard",
  "quantityTotal": 100,
  "priceCents": 50000,
  "currency": "EUR"
}
```

Buyer checkout proof for quantity 6:

```json
{
  "checkoutKind": "requires_web_redirect",
  "totalCents": 75000,
  "currency": "EUR",
  "hasHostedUrl": true,
  "checkoutSessionId": "f171a560-ec8d-4594-b9c2-e8302dd49add"
}
```

Conclusion: live checkout does not reject the DC Adventure purchase because of stale JSONB capacity, and canonical live capacity is in `ticket_types.quantity_total`.

## Mandatory Runtime Matrix

| Runtime Gate | Result | Evidence | Blocker |
| --- | --- | --- | --- |
| iOS simulator | FAIL | iPhone 17 Pro simulator booted, installed/launched `com.sethogieva.minglabusiness`, and rendered the business app Home screen for brand `A gloat`. Screenshot: `/tmp/orch0950-ios-current.png`. | Did not prove DC Adventure planner edit, save, reload, or canonical capacity write. Available session/brand was not the DC Adventure/travelbrand context. |
| Android emulator | FAIL | `Pixel_8_Pro` emulator booted. `adb shell pm list packages` showed only `com.mingla.app.v2`; business app was not installed. `npx expo run:android --variant debug` failed before install. | Native debug build failed in CMake: `react-native-worklets` target `worklets` had no sources and `expo-modules-core` targets had no sources; Gradle exited non-zero. |
| Business-web preview | FAIL | `curl -I http://localhost:8083` returned `HTTP/1.1 200 OK`. Playwright screenshot after 60s rendered the unauthenticated Mingla Business sign-in screen. Screenshot: `/tmp/orch0950-business-web-60s.png`. | Did not reach an authenticated planner/editor path or prove capacity edit/reload behavior. |
| DC Adventure-style live-fire | PASS | Live event read shows `ticket_types.quantity_total=100` and no `events.theme.business_trip.capacity`; buyer checkout for quantity 6 returned hosted checkout redirect. | None for backend/checkout proof. |

## Supabase Migration Ledger

Status: WARNING

Read-only command used: `/Users/sethogieva/bin/supabase migration list --linked`.

Observation: ORCH-0950 migration `20260725000000` appears present locally and remotely, but the remote ledger still shows unrelated remote-only rows `20260724000007`, `20260724000010`, and `20260725000001`. No remediation was attempted because migration apply is explicitly forbidden for this retest.

This is not a P1-001 regression, but it remains deploy/process risk to reconcile outside this hard-guarded retest.

## Local QA Residue

The temporary real `mingla-business/node_modules` install used for runtime testing was removed, and the original `mingla-business/node_modules` symlink was restored.

The following local runtime/build residue was created or touched during retest and should not be treated as ORCH-0950 product scope:

- generated/native Android build workspace under `mingla-business/android`
- screenshots under `/tmp/orch0950-*`

## Facts, Assumptions, Risks, Open Questions

Facts:

- P1-001 branch scope is fixed.
- Static, Deno, Jest, and checkout live-fire evidence pass.
- Mandatory runtime matrix is not complete enough for CLOSE.

Assumptions:

- The authenticated planner edit path requires an account/brand context that exposes DC Adventure or an equivalent trip fixture.
- The Android CMake failure is environment/build-chain related unless implementor proves otherwise.

Risks:

- Without authenticated iOS/Android/web planner edit proof, a UI autosave/regression could still write or display capacity incorrectly despite the static code path looking correct.
- Android business app runtime remains unproven because the app did not build or install.
- Business-web preview only proves the unauthenticated entry screen.

Open questions:

- What credentials/fixture should be used to access DC Adventure or an equivalent live trip in business-web and native apps?
- Should the Android debug build failure be fixed in this ORCH branch or handled as a shared environment/build readiness blocker before ORCH-0950 close?

## Routing

Route: FAIL back to Codex implementor-mingla.

Required before next tester pass:

- Prove authenticated planner capacity edit on iOS simulator, Android emulator, and business-web preview.
- Show capacity writes to `ticket_types.quantity_total`.
- Show `events.theme.business_trip.capacity` remains absent after save/reload.
- Show the dashboard/editor reload displays current capacity from the canonical ticket type source.
- Keep hard guards in force: no migration apply, no edge deploy, no checkout RPC changes, no ORCH-0946/ORCH-0947 scope.
