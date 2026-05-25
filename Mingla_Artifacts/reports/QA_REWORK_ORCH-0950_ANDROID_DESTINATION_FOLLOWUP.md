# QA Rework Report: ORCH-0950 Android + Destination Follow-Up

> Date: 2026-05-25
> Mode: RETEST + TARGETED + SPEC-COMPLIANCE
> Verdict: FAIL
> Findings: P0:0 P1:2 P2:1 P3:0 P4:5
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`

## 1. Layman Summary

The shared dashboard fix is behaving correctly on iOS and business-web for the current live DC Adventure data: both surfaces proved they were running the ORCH-0950 branch and showed `Aug 17-22`, Spots `78 / 102`, and Standard tier `78 / 102`.

QA still cannot pass this ORCH. The live database still has `events.destination_text = null` for DC Adventure, so the requested post-reentry destination check is refuted, and Android live-fire remains blocked because the attached emulator is still `RUNNING_LOCKED`.

## 2. Inputs Reviewed

- Implementation rework: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0950_ANDROID_DESTINATION_FOLLOWUP.md`
- Prior QA fail: `Mingla_Artifacts/reports/QA_REWORK_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Prior implementation rework: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Runtime evidence:
  - `Mingla_Artifacts/evidence/orch-0950-runtime/qa-android-destination-followup-ios.yaml`
  - `Mingla_Artifacts/evidence/orch-0950-runtime/qa-android-destination-followup-ios-dashboard-coherence.png`
  - `Mingla_Artifacts/evidence/orch-0950-runtime/web-dashboard-coherence-current.spec.js`
  - `Mingla_Artifacts/evidence/orch-0950-runtime/qa-android-destination-followup-web-dashboard-coherence.png`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | Live Supabase read-only SQL; `events`, `event_dates`, `ticket_types`, `tickets` | DC Adventure destination, canonical dates, canonical capacity, current sold count |
| Edge/RPC/Webhooks | `supabase/functions/_test/orch_0950_*.test.ts`; expanded migration source from prior reports | Deno check/test gates preserved; no new backend product scope in this follow-up |
| Services | `mingla-business/src/services/tripsService.ts` | Dashboard trip mapping reads `event_dates`, `events.destination_text`, `ticket_types.quantity_total`, and per-tier RPC |
| Hooks/State/Cache | `mingla-business/src/hooks/useTrips.ts` | Sold-count-by-tier query key and invalidation still present |
| Components/Screens | `mingla-business/app/trip/[id]/index.tsx`, dashboard helper, KPI/tier rows | Hero subline, Spots label, branch proof testID, tier sold/cap assertions |
| Business/Admin/Public | Business iOS, business-web, Android device state/build/install | iOS + web pass current canonical values; Android build/install pass but runtime launch blocked |
| Tests/Build | strict-grep, Deno, Jest, Gradle, Playwright, Maestro, TypeScript, whitespace | Focused release gates green; full TypeScript remains red in unrelated repo areas |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---:|---|
| `events.destination_text IS NOT NULL` for DC Adventure before retest | Supabase MCP read-only SQL on `060d0483-50db-48d1-840b-73d9fc59356a` | REFUTED | Query returned `destination_text = null`. |
| Current live DC Adventure capacity/date/sold truth is coherent | Same SQL query | VERIFIED | `start_at=2026-08-17 00:00:00+00`, `end_at=2026-08-22 23:59:59+00`, Standard capacity `102`, sold tickets `78`. |
| Branch bundle proof exists on dashboard route | iOS Maestro and web Playwright testID assertions | VERIFIED iOS + web | Both asserted `orch-0950-trip-dashboard-branch-bundle-060d0483-50db-48d1-840b-73d9fc59356a`. |
| iOS dashboard renders canonical date, Spots, and tier values | Maestro current-value flow | VERIFIED | Asserted `Aug 17-22`, Spots `78 / 102`, Standard tier `78 / 102`. |
| Business-web dashboard renders canonical date, Spots, and tier values | Playwright current-value spec | VERIFIED | `1 passed`; screenshot captured. |
| Android CMake build blocker is fixed | Expo prebuild + Gradle debug build | VERIFIED | Generated CMake explicitly lists `autolinking.cpp`; `app:assembleDebug` passed. |
| Android APK installs | ADB install | VERIFIED | `adb install -r .../app-debug.apk` returned `Success`. |
| Android live-fire dashboard can be launched on unlocked hardware | ADB user state + activity launch attempts | FAIL/BLOCKED | Device still `RUNNING_LOCKED`; `cmd package resolve-activity` returned `No activity found`; `am start` returned type 3 despite package dump listing `.MainActivity` filters. |
| Hard guards held: no migrations, no ORCH-0960/ORCH-0946/event-side RPC scope, no weakened gates | Diff review + gates | VERIFIED | Follow-up touched only business app tracked files/artifacts; backend guard passed. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---:|---|
| Comms ledger | Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry | PASS | COMMS-0002 already acknowledged for `tester+codex (ORCH-0950)`; ORCH-0863 guard rerun and passed. |
| Branch/worktree | `git status --short --branch` | PASS with existing residue | Branch is `ORCH-0950-trip-capacity-single-source`; product/report residue remains in the worktree. |
| Live DC Adventure SQL | Supabase MCP read-only SQL | FAIL for destination; PASS for current date/capacity/sold | `destination_text=null`; date Aug 17-22 2026; capacity 102; sold tickets 78. |
| RPC probe | Supabase MCP SQL including `biz_trip_tickets_sold` | BLOCKED for MCP role | Permission denied for `biz_trip_tickets_sold`; direct ticket count used. |
| iOS runtime | `CI=1 npx expo start --dev-client --port 8098 --clear`; `xcrun simctl openurl`; Maestro flow | PASS current values | Metro bundled `iOS ./index.js`; Maestro asserted branch proof, `Aug 17-22`, and `78 / 102` values. |
| iOS screenshot | `xcrun simctl io ... screenshot` | PASS | `qa-android-destination-followup-ios-dashboard-coherence.png`, 1320x2868 PNG. |
| Business-web runtime | `CI=1 npx expo start --web --port 8099 --clear`; Playwright current-value spec | PASS current values | `1 passed (3.4s)`; screenshot captured. |
| Android unlock state | `adb -s emulator-5554 shell dumpsys user` after wake/dismiss-keyguard attempts | FAIL/BLOCKED | User 0 remains `State: RUNNING_LOCKED`, `Unlock time: <unknown>`. |
| Android native prebuild | `npx expo prebuild --platform android --no-install` | PASS | Generated native project; bracket-safe CMake plugin applied. |
| Android CMake contract | `rg "src/main/jni/CMakeLists.txt|autolinking.cpp|file\\(GLOB" android/app/build.gradle android/app/src/main/jni/CMakeLists.txt` | PASS | Build Gradle points at app-owned CMake; CMake lists `autolinking.cpp`; only `file(GLOB...)` text is explanatory comment. |
| Android native build | `./gradlew app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8098 -PreactNativeArchitectures=arm64-v8a` | PASS | `BUILD SUCCESSFUL in 6s`. |
| Android install | `adb -s emulator-5554 install -r mingla-business/android/app/build/outputs/apk/debug/app-debug.apk` | PASS | `Success`. |
| Android launch | `adb shell cmd package resolve-activity --brief ...`; `adb shell am start -W -n .../.MainActivity`; deep link start | FAIL/BLOCKED | Resolver reported no activity; explicit component returned error type 3; deep link unable to resolve while user locked. |
| Focused Jest | `npx jest --runInBand src/native/__tests__/androidCmakeBracketPath.test.ts src/utils/__tests__/tripDashboardDisplay.test.ts src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts src/hooks/__tests__/useTrips.test.ts src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts` | PASS | 5 suites / 20 tests. |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS | 11/11. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check ...` | PASS | Exit code 0. |
| Canonical trip strict-grep | `node .github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` | PASS | `files=1472 violations=0`. |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-trip-canonical-columns.test.mjs` | PASS | 6/6. |
| ORCH-0863 backend-touch guard | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C1-C7 pass; C7 zero backend touches. |
| Whitespace | `git diff --check` | PASS | Exit code 0. |
| Full TypeScript | `npx tsc --noEmit --pretty false` | FAIL residual | Existing checkout buyer implicit anys, ComposerV2, `@mingla/payments-native`, DraftEvent fixture shape, and package dependency typing; no ORCH-0950 dashboard touched-file failure observed. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PARTIAL | Dashboard assertions pass on iOS/web; Android cannot launch while locked. |
| One owner per truth | PASS | `tripsService.ts` maps dates/destination/capacity from canonical SQL fields; strict-grep passed. |
| No silent failures | PASS source / PARTIAL runtime | iOS/web surfaced correct current values; Android runtime unavailable. |
| One key per entity | PASS | `tripKeys.soldCountsByTier(eventId)` present and invalidated on successful live patch. |
| Server state server-side | PASS | Sold counts remain server-derived; tester used DB ticket count for live truth. |
| Logout clears everything | N/A | No auth/session clearing code changed. |
| Label temporary | PASS | ORCH proof hook is testID-only and not visible copy. |
| Subtract before adding | PASS | No backend scope added in this follow-up. |
| No fabricated data | PASS | Current sold count changed from 75 to 78 and assertions were updated to live truth. |
| Currency-aware | N/A | No currency behavior changed. |
| One auth instance | PASS | No new Supabase client introduced. |
| Validate at right time | PASS source | RPC validation coverage remains in Deno tests. |
| Exclusion consistency | N/A | No exclusion/deck code changed. |
| Persisted-state startup | PARTIAL | iOS/web launch; Android locked before runtime. |

## 7. Findings

### P0 Critical

None.

### P1 High

**P1-001: Destination post-reentry precondition is refuted in live data**
- **Evidence:** Supabase MCP read-only SQL for DC Adventure returned `destination_text = null`.
- **What is wrong:** The dispatch asked for retest after confirming `events.destination_text IS NOT NULL`, but the live row visible to QA is still null.
- **Impact:** QA cannot verify the required `Aug 17-22 · <destination>` dashboard state on iOS, web, or Android.
- **Required fix:** Re-enter DC Adventure destination through the business edit flow, then rerun a read-only SQL probe that returns a non-null `events.destination_text` for `060d0483-50db-48d1-840b-73d9fc59356a`.
- **Retest:** Assert hero subline contains both `Aug 17-22` and the re-entered destination on iOS, business-web, and Android.

**P1-002: Android required live-fire remains blocked by locked emulator state**
- **Evidence:** `adb shell dumpsys user` reports `State: RUNNING_LOCKED`; normal ADB wake/dismiss-keyguard attempts did not unlock it. After APK install, `cmd package resolve-activity --brief com.sethogieva.minglabusiness` returned `No activity found`, `am start -W -n com.sethogieva.minglabusiness/.MainActivity` returned error type 3, and deep-link start could not resolve.
- **What is wrong:** Android build/install now work, but the required Android dashboard runtime assertions cannot run on the attached device.
- **Impact:** Android is a required surface for ORCH-0950 close; shared RN behavior is inferred from iOS/web but not proven on Android.
- **Required fix:** Provide an unlocked Android emulator/physical device or manually unlock `emulator-5554`, then launch this branch's dev build and run the same branch proof/date/Spots/tier assertions.
- **Retest:** Use `adb shell dumpsys user` to prove the user is unlocked, launch `com.sethogieva.minglabusiness`, open the DC Adventure trip route, and assert branch proof, `Aug 17-22 · <destination>`, Spots current sold `/ 102`, and Standard tier current sold `/ 102`.

### P2 Medium

**P2-001: Full TypeScript remains red outside the ORCH-0950 dashboard files**
- **Evidence:** `npx tsc --noEmit --pretty false` failed on checkout buyer implicit anys, ComposerV2 rich editor typing, `@mingla/payments-native` resolution, DraftEvent fixture shape, and package dependency typing.
- **What is wrong:** The full typecheck cannot be used as a green close signal for this branch.
- **Impact:** Focused ORCH-0950 tests are green, but repo-wide type health remains a known residual release risk.
- **Required fix:** Orchestrator should keep this as broader repo debt unless full TypeScript green is required for this PR.
- **Retest:** Rerun full TypeScript after the broader type debt is assigned/fixed.

### P3 Low

None.

### P4 Notes

- **P4-001:** iOS and business-web now pass current live values, and the previous stale `75 / 102` assertions were correctly replaced with `78 / 102`.
- **P4-002:** Android CMake rework is verified: `expo prebuild` regenerates the app-owned CMake file and Gradle `app:assembleDebug` passes.
- **P4-003:** The APK installs successfully on `emulator-5554`; launch is blocked after install by locked user/activity resolution, not by compilation.
- **P4-004:** COMMS-0002 strict-grep risk remains accounted for; the ORCH-0863 backend-touch guard passed with zero backend touches.
- **P4-005:** No new cross-ORCH comms-ledger entry is required; blockers are ORCH-0950 data/runtime prerequisites.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Branch bundle proof on dashboard route | PASS iOS + web | Maestro and Playwright testID assertions | None |
| Canonical dates render | PASS iOS + web; Android unverified | `Aug 17-22` asserted | P1-002 |
| Spots uses current sold/capacity | PASS iOS + web; Android unverified | `78 / 102` asserted | P1-002 |
| Tier card uses current sold/capacity | PASS iOS + web; Android unverified | Standard tier `78 / 102` asserted | P1-002 |
| Destination after re-entry | FAIL | Live `destination_text=null` | P1-001 |
| Android live-fire | FAIL/BLOCKED | Locked emulator blocks launch | P1-002 |
| No migrations in follow-up | PASS | Diff review and ORCH-0863 C7 | None |
| No ORCH-0960/ORCH-0946/event-side RPC scope | PASS | Diff/gate review | None |
| Strict-grep/Deno/Jest gates not weakened | PASS | Gates rerun as-is and passed | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No new migrations or edge functions in follow-up | P4 | Diff review; ORCH-0863 C7 | PASS |
| Supabase MCP role cannot execute sold-count RPC | P4 | Permission denied for `biz_trip_tickets_sold` | Not a product failure; direct count used for QA truth |
| No auth/RLS/product backend edits in Android follow-up | P4 | Changed tracked product paths are business app only | PASS |
| Client bundle uses existing auth/session state for iOS/web | P4 | Runtime iOS/web dashboards loaded authenticated trip route | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---:|---|
| Trip dashboard hero | Shows current date-only `Aug 17-22` while destination is null | P1 | PASS for date; FAIL for requested destination post-reentry state |
| Spots KPI | Shows current `78 / 102` | P4 | PASS iOS + web |
| Standard tier row | Shows current `78 / 102` | P4 | PASS iOS + web |
| Android trip dashboard | Required surface cannot launch | P1 | FAIL/BLOCKED |
| Runtime proof hook | Non-visible testID proves branch bundle | P4 | PASS iOS + web |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---:|---|
| Mobile | Yes | PARTIAL | iOS pass; Android blocked. |
| Business | Yes | PARTIAL | Business iOS/web pass current values; Android no live-fire. |
| Admin | Scope review only | N/A | Not touched. |
| Public/web | Scope review only | N/A | Buyer/public trip path out of follow-up scope. |
| Solo | N/A | N/A | Planner trip dashboard only. |
| Collab | N/A | N/A | Planner trip dashboard only. |
| iOS | Yes | PASS current values / FAIL destination criterion | Destination missing in live data. |
| Android | Attempted | FAIL/BLOCKED | Build/install pass; locked emulator prevents launch/assertions. |
| Business-web | Yes | PASS current values / FAIL destination criterion | Destination missing in live data. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Dashboard display helpers | iOS PASS, Android unverified | Web PASS | Not touched | Not touched | Reads canonical service data | Current live sold count is 78. |
| Android bracket-safe CMake plugin | Android build PASS | Business app native build PASS | Not touched | Not touched | N/A | Runtime still blocked by locked device. |
| Destination re-entry | iOS/web cannot verify destination | Business edit precondition still unmet | Not touched | Existing live-edit RPC only | `destination_text=null` | Requires operator/business edit flow action. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---:|---|
| Live data current truth | Supabase MCP read-only SQL | FAIL destination; PASS date/cap/sold | Re-enter destination and re-probe. |
| iOS dashboard | Maestro + screenshot | PASS current date/sold/cap | Re-run after destination is non-null and assert destination. |
| Business-web dashboard | Playwright + screenshot | PASS current date/sold/cap | Re-run after destination is non-null and assert destination. |
| Android build/install | Expo prebuild, Gradle, ADB install | PASS | Unlock device and run dashboard assertions. |
| Android dashboard | ADB launch/deep-link attempt | FAIL/BLOCKED | Needs unlocked device/emulator. |

## 14. Required Actions

1. **P1-001:** Re-enter DC Adventure destination through the business edit flow and prove `events.destination_text IS NOT NULL` with a read-only SQL probe.
2. **P1-002:** Unlock the Android emulator/device or provide an unlocked Android target, then rerun branch proof, hero, Spots, and tier assertions on Android.

## 15. Conditional / Recommended Actions

1. Keep full TypeScript red as a broader repo gate item unless orchestrator requires it for this PR.
2. Update any durable runtime scripts that still expect `75 / 102`; the live sold count is now `78 / 102`.

## 16. Discoveries For Orchestrator

- None requiring a new COMMS ledger entry. The failures are ORCH-0950 close blockers, not cross-ORCH discoveries.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| iOS stale/noncanonical dashboard values | Yes for current date/sold/cap | Maestro current-value assertions pass | None found on iOS. |
| Business-web runtime matrix blocked | Yes for current date/sold/cap | Playwright current-value spec passes | None found on web. |
| Android CMake build failure | Yes | Prebuild generated bracket-safe CMake; Gradle build passes | None found in build. |
| Android launch/live-fire blocked | No | Device still `RUNNING_LOCKED`; launch/deep link fail | Still blocks close. |
| Destination post-reentry missing | No | Live SQL still `destination_text=null` | Still blocks close. |

Retest cycle: 2; stuck on live data precondition + Android device state.
