# QA Rework Report: ORCH-0950 Expanded Trip Capacity + Dashboard Coherence

> Date: 2026-05-25
> Mode: RETEST + TARGETED + SPEC-COMPLIANCE
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:2 P3:0 P4:4
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`

## 1. Layman Summary

The rework fixed the visible dashboard coherence on iOS and business-web for the live DC Adventure data that currently exists. Both verified surfaces are running the ORCH-0950 branch bundle and show `Aug 17-22`, Spots `75 / 102`, and the Standard tier `75 / 102`.

QA still cannot pass the ORCH because Android remains unverified and the required destination post-re-entry state is not present in live data. The live DC Adventure row still has `events.destination_text = null`, so the required "date plus destination after Seth re-enters it" check cannot be completed.

## 2. Inputs Reviewed

- Implementation rework: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Prior failed QA: `Mingla_Artifacts/reports/QA_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Target output requested: `Mingla_Artifacts/reports/QA_REWORK_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Runtime evidence produced in this pass:
  - `Mingla_Artifacts/evidence/orch-0950-runtime/qa-rework-dashboard-coherence.yaml`
  - `Mingla_Artifacts/evidence/orch-0950-runtime/qa-rework-ios-dashboard-coherence.png`
  - `Mingla_Artifacts/evidence/orch-0950-runtime/web-dashboard-coherence.spec.js`
  - `Mingla_Artifacts/evidence/orch-0950-runtime/qa-rework-web-dashboard-coherence.png`

## 3. Scope And Hard Guards

| Guard | Result | Evidence |
|---|---:|---|
| No migrations | PASS | `git diff --name-only \| rg '^(supabase/migrations|supabase/functions)'` returned no product backend paths. |
| No edge/function scope | PASS | Same backend-path diff check returned no touched Supabase function files. |
| No ORCH-0960 / ORCH-0946 / event-side RPC product scope | PASS | `git diff -- mingla-business app-mobile mingla-admin packages \| rg 'ORCH-0960|ORCH-0946|biz_update_event|event-side|event RPC|supabase/functions|supabase/migrations'` returned no matches. |
| Do not weaken strict-grep/Deno/Jest gates | PASS | All focused gates below were run as-is and passed. |
| COMMS ledger WARN carried forward | PASS | COMMS-0002 acknowledged for `tester+codex (ORCH-0950)`; ORCH-0863 backend-touch guard was run and passed. |

## 4. Live Data Probe

Read-only Supabase SQL for DC Adventure returned:

| Field | Value |
|---|---|
| Event ID | `060d0483-50db-48d1-840b-73d9fc59356a` |
| Title | `The DC Adventure` |
| Destination | `null` |
| Start | `2026-08-17 00:00:00+00` |
| End | `2026-08-22 23:59:59+00` |
| Ticket type | `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` / `Standard` |
| Capacity | `102` |
| Sold tickets | `75` |

This verifies the expected canonical date/capacity/sold truth, but refutes the post-re-entry destination precondition.

## 5. Claim Verification

| Claim / criterion | Status | Evidence |
|---|---:|---|
| Branch bundle proof exists on dashboard route | PASS iOS + web | iOS Maestro asserted `orch-0950-trip-dashboard-branch-bundle-060d0483-50db-48d1-840b-73d9fc59356a`; web Playwright asserted the same testID. Metro logs showed `iOS ./index.js` and `Web ./index.js` bundled from this worktree. |
| Canonical date renders | PASS iOS + web | iOS Maestro and web Playwright asserted `Aug 17-22`. Screenshot evidence captured both. |
| Spots sold/cap renders | PASS iOS + web | iOS Maestro and web Playwright asserted `orch-0950-trip-dashboard-spots-value` with `75 / 102`. |
| Tier sold/cap renders | PASS iOS + web | iOS Maestro asserted tier capacity testID; web Playwright asserted `orch-0950-trip-dashboard-tier-capacity-d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` with `75 / 102`. |
| Destination renders after re-entry | BLOCKED | Live row still has `destination_text = null`; the required state does not exist. |
| Android live-fire passes | FAIL/BLOCKED | Installed package could not resolve a launcher activity; branch-local `npx expo run:android --port 8098` failed at `:app:buildCMakeDebug` with missing React Native autolinking symbols. |

## 6. Runtime Verification

| Surface | Method | Result | Notes |
|---|---|---:|---|
| iOS | `CI=1 npx expo start --dev-client --port 8098 --clear`; `xcrun simctl openurl`; `maestro test --device 2C3312D9-EE52-4EBD-9704-15811D49A2EC Mingla_Artifacts/evidence/orch-0950-runtime/qa-rework-dashboard-coherence.yaml` | PASS for branch proof/date/Spots/tier | Metro bundled `iOS ./index.js`; screenshot saved at `qa-rework-ios-dashboard-coherence.png`. Destination was not expected to render because live destination is null. |
| Business-web | `CI=1 npx expo start --web --port 8099 --clear`; temp-installed `@playwright/test` under `/tmp/orch0950-playwright`; `NODE_PATH=/tmp/orch0950-playwright/node_modules /tmp/orch0950-playwright/node_modules/.bin/playwright test --config Mingla_Artifacts/evidence/orch-0950-runtime/playwright.config.js web-dashboard-coherence.spec.js --reporter=line` | PASS for branch proof/date/Spots/tier | `1 passed (3.1s)`; screenshot saved at `qa-rework-web-dashboard-coherence.png`. |
| Android | Existing package launch, deep-link launch, branch-local native rebuild | FAIL/BLOCKED | ADB listed `com.sethogieva.minglabusiness`, but `monkey`, `am start`, and deep links could not resolve a runnable activity. `npx expo run:android --port 8098` failed with `ld.lld: error: undefined symbol: facebook::react::autolinking_registerProviders`, `autolinking_cxxModuleProvider`, and `autolinking_ModuleProvider`. |

## 7. Automated Gates

| Gate | Command | Result |
|---|---|---:|
| Canonical trip columns strict-grep | `node .github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` | PASS, `files=1471 violations=0` |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-trip-canonical-columns.test.mjs` | PASS, 6/6 |
| ORCH-0863 backend-touch guard | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS, C1-C7 pass and zero backend touches |
| Deno regression tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS, 11/11 |
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS |
| Focused Jest | `npx jest --runInBand src/utils/__tests__/tripDashboardDisplay.test.ts src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts src/hooks/__tests__/useTrips.test.ts src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts` | PASS, 4 suites / 19 tests |
| Whitespace | `git diff --check` | PASS |
| Full TypeScript | `npx tsc --noEmit --pretty false` | FAIL, broad pre-existing debt in checkout buyer implicit anys, ComposerV2, `@mingla/payments-native`, DraftEvent fixtures, and package dependency resolution; no ORCH-0950 touched-file errors observed. |

## 8. Findings

### P1-001: Android required live-fire remains blocked by launch/build failure

**Severity:** P1 High  
**Status:** FAIL/BLOCKED  
**Evidence:** Existing Android package is visible to ADB, but `monkey -p com.sethogieva.minglabusiness` and explicit `am start` cannot resolve a runnable activity. Branch-local `npx expo run:android --port 8098` fails during `:app:buildCMakeDebug` with missing React Native autolinking symbols: `facebook::react::autolinking_registerProviders`, `autolinking_cxxModuleProvider`, and `autolinking_ModuleProvider`.

**Impact:** The requested Android live-fire cannot be completed. Because Android is a required surface for this ORCH, QA cannot route to close even though the shared RN dashboard logic passed iOS and web.

**Required rework:** Fix the Android dev-client/build environment or native autolinking configuration enough for `mingla-business` to build/install/launch from this ORCH worktree. Then rerun the same dashboard branch proof, date, Spots, and tier assertions on Android.

### P2-001: Destination post-re-entry criterion is still blocked by live data

**Severity:** P2 Medium  
**Status:** BLOCKED  
**Evidence:** Read-only Supabase probe returned `destination_text = null` for DC Adventure after this dispatch requested verification "after Seth re-enters it."

**Impact:** The dashboard can only correctly render `Aug 17-22` today. It cannot prove `Aug 17-22 · <destination>` until the canonical destination field is populated through the business edit flow.

**Required action:** Re-enter DC Adventure destination through the business edit flow, then confirm `events.destination_text IS NOT NULL` before retest.

### P2-002: Full TypeScript remains red outside ORCH-0950 touched files

**Severity:** P2 Medium  
**Status:** KNOWN RESIDUAL RISK  
**Evidence:** `npx tsc --noEmit --pretty false` failed on existing checkout buyer implicit anys, ComposerV2 typing, `@mingla/payments-native` resolution, DraftEvent fixture shape, and package dependency typing. No failures were in the ORCH-0950 rework files.

**Impact:** This does not refute the focused ORCH-0950 fix, but full repo typecheck remains unavailable as a close signal.

**Required action:** Keep this as a broader repo gate item unless orchestrator requires full TypeScript green for this PR.

## 9. Passing Evidence Worth Preserving

- iOS branch-bundle proof and visible dashboard values are now direct Maestro assertions, not just screenshot interpretation.
- Business-web no longer hits the prior `expo-router/entry` Metro resolution failure; it bundled `Web ./index.js` from the worktree and passed the dashboard assertions.
- The single-tier fallback prevents `0 / 102` while per-tier RPC data is absent, and the helper test also protects against smearing total sold count across multi-tier trips.
- ORCH-0863 C7 backend-touch guard passed, directly addressing COMMS-0002.

## 10. Verdict

**FAIL.** iOS and business-web now satisfy the branch-bundle, date, Spots sold/cap, and tier sold/cap contracts against live DC Adventure data, but Android remains unverified due a native launch/build blocker, and destination cannot be verified because the live row has not been re-entered.

## 11. Retest Instructions

1. Re-enter DC Adventure destination through the business edit flow and verify live SQL returns `events.destination_text IS NOT NULL`.
2. Fix Android launch/build so `npx expo run:android --port 8098` or an equivalent branch-attached dev-client can launch `com.sethogieva.minglabusiness`.
3. Rerun iOS, business-web, and Android dashboard checks for:
   - branch proof testID `orch-0950-trip-dashboard-branch-bundle-060d0483-50db-48d1-840b-73d9fc59356a`
   - hero subline `Aug 17-22 · <destination>`
   - Spots `75 / 102` or current live sold count over `102`
   - Standard tier `75 / 102` or current live sold count over `102`
4. Rerun strict-grep, Deno check/test, focused Jest, ORCH-0863 guard, and `git diff --check`.
