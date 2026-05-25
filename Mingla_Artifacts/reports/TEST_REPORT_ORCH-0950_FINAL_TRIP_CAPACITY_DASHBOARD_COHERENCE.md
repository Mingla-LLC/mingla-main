# TEST REPORT: ORCH-0950 Final Trip Capacity + Dashboard Coherence

> Date: 2026-05-25
> Mode: RETEST + TARGETED + SPEC-COMPLIANCE
> Verdict: PASS
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`
> Source report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0950_ANDROID_DESTINATION_FOLLOWUP.md`

## 1. Layman Summary

ORCH-0950 is ready for orchestrator close decision. The prior close blockers are cleared: DC Adventure now has a canonical destination in live data, Android was tested on an unlocked Pixel_8_Pro emulator, and the trip dashboard renders the current canonical date, destination, sold/capacity, and tier sold/capacity values from this branch bundle.

The live sold count moved after the implementation report. The report captured `78 / 102`; current read-only SQL and fresh Android runtime both show `81 / 102`, which is the correct current truth.

## 2. Inputs Reviewed

| Input | Result |
|---|---|
| `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0950_ANDROID_DESTINATION_FOLLOWUP.md` | Reviewed; destination and Android claims retested independently. |
| `Mingla_Artifacts/reports/QA_REWORK_ORCH-0950_ANDROID_DESTINATION_FOLLOWUP.md` | Reviewed as returned FAIL contract. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` | Reviewed for expanded dashboard background. |
| `Mingla_Artifacts/reports/QA_REWORK_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` | Reviewed for earlier iOS/web/Android failure context. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` | Reviewed for dashboard coherence criteria. |
| `COMMS_LEDGER.md` | Read on entry; COMMS-0003 was acknowledged for `tester+codex (ORCH-0950)`, and COMMS-0002 was already acknowledged for this ORCH. |

## 3. Live Data Probe

Read-only Supabase SQL was run for DC Adventure:

```sql
select
  e.id,
  e.title,
  e.destination_text,
  (e.destination_text is not null) as destination_text_is_not_null,
  d.start_at,
  d.end_at,
  tt.id as ticket_type_id,
  tt.name as ticket_type_name,
  tt.quantity_total,
  count(t.id) filter (where t.status in ('valid','used','transferred'))::int as sold_tickets
from public.events e
left join public.event_dates d on d.event_id = e.id
left join public.ticket_types tt on tt.event_id = e.id
left join public.tickets t on t.event_id = e.id and t.ticket_type_id = tt.id
where e.id = '060d0483-50db-48d1-840b-73d9fc59356a'
group by e.id, e.title, e.destination_text, d.start_at, d.end_at, tt.id, tt.name, tt.quantity_total
order by d.start_at, tt.name;
```

Result:

| Field | Current value |
|---|---|
| Event | `060d0483-50db-48d1-840b-73d9fc59356a` / `The DC Adventure` |
| Destination | `Washington DC, USA` |
| Destination non-null | `true` |
| Dates | `2026-08-17 00:00:00+00` to `2026-08-22 23:59:59+00` |
| Ticket type | `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` / `Standard` |
| Capacity | `102` |
| Sold tickets | `81` |

## 4. Claim Verification

| Claim / criterion | Status | Evidence |
|---|---:|---|
| `events.destination_text IS NOT NULL` for DC Adventure | PASS | Supabase read-only SQL returned `destination_text='Washington DC, USA'` and `destination_text_is_not_null=true`. |
| Dashboard date + destination renders correctly | PASS | Android UIAutomator and Maestro asserted `Aug 17-22 · Washington DC, USA`. Helper test also covers this formatter contract. |
| Dashboard Spots uses canonical sold/capacity | PASS | Current SQL returned sold `81`, capacity `102`; Android UIAutomator and Maestro asserted `81 / 102` on `orch-0950-trip-dashboard-spots-value`. |
| Tier row uses canonical sold/capacity | PASS | Android UIAutomator and Maestro asserted `81 / 102` on `orch-0950-trip-dashboard-tier-capacity-d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e`. |
| Android device was unlocked and launchable | PASS | `adb shell dumpsys user` returned `State: RUNNING_UNLOCKED`; app installed, resolved `.MainActivity`, launched, and bundled `Android ./index.js` from this worktree. |
| Branch bundle proof exists on Android dashboard route | PASS | UIAutomator and Maestro asserted `orch-0950-trip-dashboard-branch-bundle-060d0483-50db-48d1-840b-73d9fc59356a`. |
| Android CMake bracket-path blocker is fixed | PASS | `./gradlew app:assembleDebug ...` passed; generated app CMake uses explicit `autolinking.cpp` instead of the bracket-unsafe generated-source glob. |
| No migrations in follow-up | PASS | `git diff --name-only` for current follow-up returned no `supabase/migrations` or `supabase/functions` product paths. |
| No ORCH-0960 / ORCH-0946 / event-side RPC scope added in follow-up | PASS | Current follow-up diff is business app UI/config/test artifact scope; ORCH-0863 backend-touch guard passed with zero backend touches. |
| Strict-grep / Deno / Jest gates were not weakened | PASS | Gates were rerun as-is and passed. |

## 5. Runtime Verification

| Check | Command / method | Result |
|---|---|---:|
| Android emulator present/unlocked | `adb devices -l`; `adb shell dumpsys user`; `adb shell dumpsys window` | PASS; `Pixel_8_Pro`, `RUNNING_UNLOCKED`, keyguard not blocking. |
| Android APK install + activity resolution | `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`; `adb shell cmd package resolve-activity --brief com.sethogieva.minglabusiness` | PASS; install `Success`, `.MainActivity` resolved. |
| Metro branch bundle | `CI=1 npx expo start --dev-client --port 8098 --clear`; Android dev-client URL open | PASS; Metro bundled `Android ./index.js` from this ORCH worktree. |
| Android deep link route | `adb shell am start -W -a android.intent.action.VIEW -d 'mingla-business://trip/060d0483-50db-48d1-840b-73d9fc59356a' com.sethogieva.minglabusiness` | PASS; route opened in `.MainActivity`. |
| Android UIAutomator current screen | `adb shell uiautomator dump`; XML inspected with node splitting | PASS; branch proof, `Aug 17-22 · Washington DC, USA`, `81 / 102` Spots, and `81 / 102` tier text present. |
| Android Maestro live-fire | `maestro test Mingla_Artifacts/evidence/orch-0950-runtime/qa-final-android-current-live-values.yaml` | PASS; all assertions completed. |

Fresh Android Maestro proof file:

`Mingla_Artifacts/evidence/orch-0950-runtime/qa-final-android-current-live-values.yaml`

## 6. Automated Gates

| Gate | Command | Result |
|---|---|---:|
| Focused Jest | `cd mingla-business && npx jest --runInBand src/native/__tests__/androidCmakeBracketPath.test.ts src/utils/__tests__/tripDashboardDisplay.test.ts src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts src/hooks/__tests__/useTrips.test.ts src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts` | PASS; 5 suites / 20 tests. |
| Canonical trip columns strict-grep | `node .github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` | PASS; `files=1472 violations=0`. |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-trip-canonical-columns.test.mjs` | PASS; 6/6. |
| ORCH-0863 backend-touch guard | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS; C1-C7 pass, C7 zero backend touches. |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS; 11/11. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS; exit 0. |
| Whitespace | `git diff --check` | PASS; exit 0. |
| Android Gradle build | `cd mingla-business/android && ./gradlew app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8098 -PreactNativeArchitectures=arm64-v8a` | PASS; `BUILD SUCCESSFUL`. |
| Full TypeScript | `cd mingla-business && npx tsc --noEmit --pretty false` | FAIL; known repo-wide residual in checkout buyer implicit anys, ComposerV2 typing, `@mingla/payments-native`, DraftEvent fixtures, and local package dependency typing. No ORCH-0950 touched file errors observed. |

## 7. Regression Coverage

| Contract | Automated coverage | Result |
|---|---|---:|
| Dashboard UTC date range and destination formatting | `src/utils/__tests__/tripDashboardDisplay.test.ts` | PASS |
| Spots label from current sold count and canonical capacity | `src/utils/__tests__/tripDashboardDisplay.test.ts` | PASS |
| Single-tier fallback while per-tier RPC loads | `src/utils/__tests__/tripDashboardDisplay.test.ts` | PASS |
| Multi-tier dashboards do not smear total sold across tiers | `src/utils/__tests__/tripDashboardDisplay.test.ts` | PASS |
| Branch bundle proof hook | `src/utils/__tests__/tripDashboardDisplay.test.ts`; Android Maestro | PASS |
| Dashboard reader uses canonical `event_dates`, `events.destination_text`, `ticket_types.quantity_total`, and per-tier RPC | `src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts`; strict-grep gate | PASS |
| Live capacity mutation rejects lower-than-sold capacity and routes through canonical source | `src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts`; Deno migration tests | PASS |

## 8. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

None blocking ORCH-0950 close. Full TypeScript remains red, but the failures are the same broader repo debt called out in prior QA and are not in ORCH-0950 touched dashboard/capacity files.

### P3 Low

None.

### P4 Notes

- The implementation report's Android `78 / 102` evidence is now historical. Current live truth is `81 / 102`, and the fresh final Android Maestro proof uses `81 / 102`.
- Metro logs still show known non-fatal warnings, including the Stripe native `forwardRef` warning from `packages/payments-native`; the trip dashboard rendered and Maestro passed.
- No new cross-ORCH comms-ledger entry is required. COMMS-0002 and COMMS-0003 were factored into this pass.

## 9. Security / Scope

| Guard | Result | Evidence |
|---|---:|---|
| No auth/RLS changes in follow-up | PASS | Current follow-up diff does not touch auth, RLS, Supabase function product code, or migrations. |
| No direct SQL data patch by tester | PASS | Tester only ran read-only SQL. Destination was already present by the time final QA queried live data. |
| No event-side RPC scope | PASS | No current follow-up product diff in event RPC files; ORCH-0863 backend-touch guard passed. |
| No external API payload changes | PASS | No Stripe/Supabase external API integration change was introduced in this final follow-up. |

## 10. Verdict

PASS. ORCH-0950 [Trip capacity + dashboard coherence] now has live SQL proof, Android branch-bundle runtime proof, Android Maestro proof, focused regression coverage, and green scoped gates. Route to orchestrator for close decision; do not treat full repo TypeScript as an ORCH-0950 blocker unless the orchestrator separately decides to make broad repo type health a close gate for this PR.
