# Implementation Rework Report: ORCH-0950 Android Destination Follow-Up

> Date: 2026-05-25
> Mode: QA FAIL rework
> Status: READY FOR TESTER FINAL PASS/FAIL
> QA source of truth: `Mingla_Artifacts/reports/QA_REWORK_ORCH-0950_ANDROID_DESTINATION_FOLLOWUP.md`
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`

## 1. Outcome

The two close blockers from the returned FAIL are cleared.

1. DC Adventure destination was re-entered through the Mingla Business edit flow, not patched by direct SQL.
2. Android live-fire was rerun on a wiped, booted, actually unlocked `Pixel_8_Pro` emulator.

No migrations were created or modified. No ORCH-0960, ORCH-0946, or event-side RPC scope was added. Strict-grep, Deno, Jest, and whitespace gates were rerun without weakening.

## 2. Destination Re-Entry Evidence

### Business edit flow

Destination was entered in the app as `Washington DC, USA` through the published trip edit flow.

Evidence files:

| Evidence | Path |
|---|---|
| Share sheet cleared before edit | `Mingla_Artifacts/evidence/orch-0950-runtime/ios-after-close-share-sheet.png` |
| Destination save flow | `Mingla_Artifacts/evidence/orch-0950-runtime/ios-destination-reentry-current-save.yaml` |
| Review modal showing destination change | `Mingla_Artifacts/evidence/orch-0950-runtime/ios-destination-reentry-modal-stuck.png` |
| Review modal confirmation flow | `Mingla_Artifacts/evidence/orch-0950-runtime/ios-destination-reentry-confirm-modal.yaml` |

Review reason used: `ORCH0950 destination reentry proof`.

### Post-edit SQL probe

Command source: Supabase MCP read-only SQL, 2026-05-25.

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
  tt.quantity_total
from public.events e
left join public.event_dates d on d.event_id = e.id
left join public.ticket_types tt on tt.event_id = e.id
where e.id = '060d0483-50db-48d1-840b-73d9fc59356a'
order by d.start_at, tt.name;
```

Result:

```json
[
  {
    "id": "060d0483-50db-48d1-840b-73d9fc59356a",
    "title": "The DC Adventure",
    "destination_text": "Washington DC, USA",
    "destination_text_is_not_null": true,
    "start_at": "2026-08-17 00:00:00+00",
    "end_at": "2026-08-22 23:59:59+00",
    "ticket_type_id": "d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e",
    "ticket_type_name": "Standard",
    "quantity_total": 102
  }
]
```

## 3. Android Unlock And Launch Evidence

The first attached emulator was locked. I killed it and launched the existing `Pixel_8_Pro` AVD with a data wipe:

```bash
/Users/sethogieva/Library/Android/sdk/emulator/emulator \
  -avd Pixel_8_Pro \
  -wipe-data \
  -no-snapshot-load \
  -no-snapshot-save
```

Unlock probe after boot:

```text
List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:6

Current user: 0
State: RUNNING_UNLOCKED
Unlock time: +7m4s573ms ago
mInputRestricted=false
mCurrentFocus=Window{5cad050 u0 com.sethogieva.minglabusiness/com.sethogieva.minglabusiness.MainActivity}
mAwake=true mScreenOnEarly=true mScreenOnFully=true
mDreamingLockscreen=false
isKeyguardShowing=false
```

Launch/install evidence:

```text
adb install -r mingla-business/android/app/build/outputs/apk/debug/app-debug.apk
Success

adb reverse tcp:8098 tcp:8098
8098

adb shell cmd package resolve-activity --brief com.sethogieva.minglabusiness
com.sethogieva.minglabusiness/.MainActivity
```

Dev client was connected to Metro on port `8098`; Android bundled successfully and the app launched into `com.sethogieva.minglabusiness/.MainActivity`.

Evidence files:

| Evidence | Path |
|---|---|
| Previous locked target screenshot | `Mingla_Artifacts/evidence/orch-0950-runtime/android-locked-state.png` |
| Initial Android dev launcher | `Mingla_Artifacts/evidence/orch-0950-runtime/android-launch-initial.png` |
| Dev URL/bundling screen | `Mingla_Artifacts/evidence/orch-0950-runtime/android-after-dev-url.png` |
| Post-bundle dev client | `Mingla_Artifacts/evidence/orch-0950-runtime/android-after-bundle.png` |
| Authenticated Android home after seed | `Mingla_Artifacts/evidence/orch-0950-runtime/android-current-after-seed.png` |
| Final Android dashboard screenshot | `Mingla_Artifacts/evidence/orch-0950-runtime/android-trip-route-after-seed.png` |
| Final Android UIAutomator dump | `Mingla_Artifacts/evidence/orch-0950-runtime/android-trip-route-after-seed.uiautomator.xml` |

## 4. Android Live-Fire Assertions

Maestro proof file:

`Mingla_Artifacts/evidence/orch-0950-runtime/qa-android-destination-followup.yaml`

Command:

```bash
maestro test Mingla_Artifacts/evidence/orch-0950-runtime/qa-android-destination-followup.yaml
```

Result:

```text
Running on Pixel_8_Pro
> Flow qa-android-destination-followup
Open mingla-business://trip/060d0483-50db-48d1-840b-73d9fc59356a... COMPLETED
Wait for animation to end... COMPLETED
Assert that id: orch-0950-trip-dashboard-branch-bundle-060d0483-50db-48d1-840b-73d9fc59356a is visible... COMPLETED
Assert that id: orch-0950-trip-dashboard-hero-subline is visible... COMPLETED
Assert that "Aug 17-22 · Washington DC, USA" is visible... COMPLETED
Assert that id: orch-0950-trip-dashboard-spots-value is visible... COMPLETED
Assert that "78 / 102" is visible... COMPLETED
Assert that id: orch-0950-trip-dashboard-tier-capacity-d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e is visible... COMPLETED
```

UIAutomator text/resource-id proof from the final screen:

```text
The DC Adventure
Aug 17-22 · Washington DC, USA
SPOTS
78 / 102
Standard
78 / 102
RID:orch-0950-trip-dashboard-branch-bundle-060d0483-50db-48d1-840b-73d9fc59356a
RID:orch-0950-trip-dashboard-hero-subline
RID:orch-0950-trip-dashboard-spots-value
RID:orch-0950-trip-dashboard-tier-capacity-d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e
```

## 5. Rerun Gates

| Gate | Command | Result |
|---|---|---:|
| Focused Jest | `cd mingla-business && npx jest --runInBand src/native/__tests__/androidCmakeBracketPath.test.ts src/utils/__tests__/tripDashboardDisplay.test.ts src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts src/hooks/__tests__/useTrips.test.ts src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts` | PASS; 5 suites / 20 tests |
| Strict-grep canonical trip columns | `node .github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` | PASS; `files=1472 violations=0` |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-trip-canonical-columns.test.mjs` | PASS; 6/6 |
| ORCH-0863 backend-touch guard | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS; C1-C7 pass; C7 reports zero backend touches |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS; 11/11 |
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS; exit 0 |
| Whitespace | `git diff --check` | PASS; exit 0 |

## 6. Guardrail Audit

| Guard | Result |
|---|---:|
| No migrations | PASS |
| No direct SQL data patch for destination | PASS; destination was entered through business edit flow |
| No ORCH-0960 scope | PASS |
| No ORCH-0946/event-side RPC scope | PASS |
| No strict-grep weakening | PASS |
| Android target actually unlocked | PASS |

## 7. Tester Routing

Route back to tester for final PASS/FAIL on ORCH-0950. Tester should use this report as the rework source, with `QA_REWORK_ORCH-0950_ANDROID_DESTINATION_FOLLOWUP.md` as the returned FAIL contract.
