# QA Report: Expanded Trip Capacity + Dashboard Coherence (ORCH-0950)

> Date: 2026-05-25
> Mode: TARGETED + SPEC-COMPLIANCE
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:3 P3:0 P4:4
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`

## 1. Layman Summary

The code and automated regression gates for ORCH-0950's expanded dashboard coherence pass, but user-provided iOS runtime evidence fails the dashboard contract. Capacity, trip dates, and destination are wired to canonical database fields in source, yet the visible app still renders `Date TBD`, Spots `75` without `/ 102`, and tier card `0 / 102`.

QA cannot close this. The live DC Adventure row still has no destination re-entered (`events.destination_text IS NULL`), and the screenshot proves the running iOS app is either on a stale bundle or still reading stale/noncanonical dashboard data. Android cannot launch the installed business package, and business-web failed at Metro resolution before an authenticated dashboard could load.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
- Prior QA context: `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`, `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RETEST.md`, `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RUNTIME_RETEST.md`
- Changed implementation files: `supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql`, `supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts`, `.github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs`, `mingla-business/src/services/tripsService.ts`, `mingla-business/src/hooks/useTrips.ts`, `mingla-business/app/trip/[id]/index.tsx`, `mingla-business/src/utils/tripAdapter.ts`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql`; live Supabase read-only probe | Canonical destination column, date/capacity strip, per-tier sold RPC shape, live DC Adventure canonical row state |
| Edge/RPC/Webhooks | `biz_update_live_trip`, `business_publish_trip_draft`, `biz_trip_tickets_sold_by_tier` in migration | Auth gate preserved, canonical writes, deep merge for residual `business_trip`, no event-side RPC scope |
| Services | `tripsService.ts` | `readBusinessTrip` uses canonical capacity/date/destination inputs; `getTrip` fetches master `event_dates`; sold-count service uses new RPC |
| Hooks/State/Cache | `useTrips.ts` | New `tripKeys.soldCountsByTier(eventId)` key and invalidation after successful live edit |
| Components/Screens | `app/trip/[id]/index.tsx`, `EventDetailTicketTypeRow.tsx`, `TripDetailHeroStatusPill.tsx` | Spots label, hero subtitle, lifecycle pill, tier-card sold/cap sources |
| Business/Admin/Public | business iOS, Android, web attempted; admin/public source scope reviewed | Mandatory business runtime matrix blocked; no admin/public product scope touched |
| Tests/Build | strict-grep, Deno, Jest, git diff | Focused regression gates green; full runtime blocked |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| `events.destination_text` exists post-migration | Live SQL read returned the column for DC Adventure | Verified | DC row returned `destination_text = null`, proving column exists but re-entry has not happened. |
| DC Adventure post-migration has capacity 102 and sold tickets 75 | Live SQL read of `ticket_types` + direct `tickets` count | Verified | `quantity_total=102`, `direct_tickets_sold=75`, ticket type `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e`. Count changed from the implementation report's earlier 71 because live tickets moved. |
| DC Adventure destination was re-entered before live-fire | Live SQL read | Refuted | `events.destination_text = NULL`; mandatory post-re-entry precondition is not met. |
| Canonical date source is `event_dates` | `tripsService.ts:353-405`, `getTrip` master date fetch, live SQL row | Verified | DC Adventure master date is `2026-08-17 00:00:00+00` to `2026-08-22 23:59:59+00`. |
| Hero subtitle should render Aug 17-22 plus destination after re-entry | `index.tsx:384-407`, `tripsService.ts:399-405`, live DB | Partial | Date side verified; destination side blocked by null live data. |
| Lifecycle pill derives from canonical dates | `index.tsx:310-314`, `TripDetailHeroStatusPill.tsx:25-40` | Verified in source | Given current date before 2026-08-17 and status scheduled, expected pill is `Upcoming`. Runtime visual unverified. |
| Tier card sold/cap uses ticket count and canonical cap | `index.tsx:201-210`, `tripsService.ts:902-918`, `EventDetailTicketTypeRow.tsx:31-39`, user screenshot | Refuted at runtime / verified in source | Expected current DC text is `75 / 102`; screenshot shows `0 / 102`. |
| Partial-edit siblings preserved | Deno migration-contract test + migration source | Verified structurally | Deno test pins deep merge and canonical strip/write blocks. Live mutation not executed by tester. |
| No ORCH-0960/ORCH-0946/event-side RPC edits | Diff + migration scope review | Verified for product code | Diff includes historical/prior ORCH-0950 reports but no ORCH-0960 product work and no event-side RPC mutation in expanded migration. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Comms ledger entry scan | Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` | PASS | No active `tester`, `ORCH-0950`, or `ALL` rows. |
| Branch/worktree check | `git status --short --branch` | PASS with residue | Branch is `ORCH-0950-trip-capacity-single-source`; pre-existing artifact index changes and node_modules symlink residue present. |
| Strict-grep canonical columns | `node .github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` | PASS | `I-PROPOSED-TRIP-CANONICAL-COLUMNS: PASS files=1469 violations=0`. |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-trip-canonical-columns.test.mjs` | PASS | 6/6 tests passed. |
| Deno migration regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS | 11/11 tests passed. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check ...` | PASS | Exit code 0. |
| Focused Jest | `npx jest --runInBand src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts src/hooks/__tests__/useTrips.test.ts` | PASS | 3 suites, 11 tests passed. |
| `npm test` script probe | `npm test -- --runInBand ...` | FAIL/non-product | `mingla-business` has no `test` script; reran with `npx jest` successfully. |
| ORCH-0863 allowlist gate | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C1-C7 pass. |
| Whitespace check | `git diff --check` | PASS | Exit code 0. |
| Live DC Adventure SQL | Supabase MCP `execute_sql` read-only query | PASS for canonical data; BLOCKED for destination | DC row: `destination_text=null`, `business_trip={}`, dates Aug 17-22 2026, `quantity_total=102`, `direct_tickets_sold=75`. |
| RPC privilege probe through MCP | Supabase MCP `execute_sql` with `public.biz_trip_tickets_sold(...)` | BLOCKED for MCP role | MCP role returned `permission denied for function biz_trip_tickets_sold`; direct tickets count used instead. |
| iOS simulator live-fire | Maestro against `17091E60-C3B6-4167-980D-60C348E177F6`; user screenshot from iPhone 17 Pro Max | FAIL | Maestro first hit Expo dev launcher, but Seth's simulator screenshot reaches the DC dashboard and shows `Date TBD`, Spots `75`, and tier `0 / 102` while DB truth is dates Aug 17-22, sold 75, capacity 102. Screenshot path: `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro Max - 2026-05-24 at 23.27.33.png`. |
| Business-web live-fire | `env CI=1 npx expo start --web --port 8095 --non-interactive` | BLOCKED | Expo started but Metro failed resolving `expo-router/entry` through the worktree `node_modules` symlink. |
| Android live-fire | `adb shell pm list packages`; `adb shell monkey -p com.sethogieva.minglabusiness 1`; `adb shell am start ...` | BLOCKED | Package is listed, but launcher resolution fails: `No activities found to run` / `Activity class ...MainActivity does not exist`; screenshots remain black. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | UNVERIFIED | Runtime matrix did not reach dashboard controls. |
| One owner per truth | PASS | `tripsService.ts:399-405` sources capacity/date/destination from canonical columns; strict-grep forbids JSONB read drift. |
| No silent failures | PASS source / UNVERIFIED runtime | Service/RPC errors are thrown; live edit UI not reached. |
| One key per entity | PASS | `tripKeys.soldCountsByTier(eventId)` added at `useTrips.ts:64-65`; invalidated at `useTrips.ts:353-357`. |
| Server state server-side | PASS | New RPC counts tickets server-side; capacity/date/destination writes route through SQL columns. |
| Logout clears everything | N/A | No auth/session code changed. |
| Label temporary | PASS | No untracked transitional code introduced in reviewed files. |
| Subtract before adding | PASS | Implementation broadens existing ORCH-0950 gate rather than adding a second overlapping truth owner. |
| No fabricated data | PASS | Live DC probe used real `The DC Adventure` row; report distinguishes source proof from blocked runtime. |
| Currency-aware | N/A | No money formatting contract changed beyond existing tier price display. |
| One auth instance | PASS | No new Supabase client introduced. |
| Validate at right time | PASS source | RPC validates auth/status/permission and patch gates server-side. |
| Exclusion consistency | N/A | No deck/exclusion code changed. |
| Persisted-state startup | UNVERIFIED | iOS/Android startup/runtime matrix blocked. |

## 7. Findings

### P0 Critical

None.

### P1 High

**P1-001: iOS runtime dashboard still renders stale/noncanonical DC Adventure data**
- **Evidence:** User-provided iPhone 17 Pro Max screenshot at `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro Max - 2026-05-24 at 23.27.33.png` shows hero subline `Date TBD`, Spots `75`, and pricing tier `0 / 102`; live SQL at the same QA pass shows `event_dates` Aug 17-22 2026, `quantity_total=102`, and `direct_tickets_sold=75`.
- **What is wrong:** The visible dashboard does not satisfy the expanded ORCH-0950 contract. If the screenshot is from the current ORCH branch bundle, the service/query/runtime path is still wrong; if it is from a stale bundle, runtime QA is attached to the wrong app bundle and cannot close.
- **Impact:** Seth cannot trust the dashboard: date, Spots denominator, and tier sold count are misleading on the core DC Adventure planner screen.
- **Required fix:** First prove the iOS app is running the ORCH-0950 branch bundle. Then fix whichever path is stale: `getTrip` canonical date/capacity mapping, `biz_trip_tickets_sold_by_tier` query/permissions/invalidation, or the dev-client bundle attachment.
- **Retest:** On iOS, open DC Adventure after destination re-entry and verify hero shows `Aug 17-22 · <destination>`, Spots shows `75 / 102` or the current live ticket count `/ 102`, tier card shows the same sold/cap, and lifecycle pill remains `Upcoming`.

### P2 Medium

**P2-001: Mandatory live-fire precondition is not met: DC Adventure destination has not been re-entered**
- **Evidence:** Live Supabase read-only query returned `destination_text = null` for `060d0483-50db-48d1-840b-73d9fc59356a` while `business_trip = {}`.
- **What is wrong:** The dispatch requires live-fire after destination re-entry, but the live row still lacks destination text.
- **Impact:** SC-10 and SC-15 cannot be verified; the dashboard can at best show Aug 17-22 without destination, or `Date TBD` if runtime reader fails.
- **Required fix:** Re-enter the DC Adventure destination through the fixed business edit screen using an authenticated planner account.
- **Retest:** Re-run SQL read to confirm `events.destination_text IS NOT NULL`, then run iOS + business-web + Android dashboard checks for hero subtitle.

**P2-002: Android and business-web runtime matrix is blocked on app/runtime environment**
- **Evidence:** iOS Maestro launched `com.sethogieva.minglabusiness` but landed in Expo dev launcher, not the app; Android package is installed but cannot resolve a launchable activity; business-web Metro failed resolving `expo-router/entry`.
- **What is wrong:** Required surfaces were available only as shells, not authenticated dashboard sessions.
- **Impact:** Cannot independently verify user-visible Spots `75 / 102`, hero subtitle, lifecycle pill, or tier card on Android and business-web.
- **Required fix:** Provide working iOS/Android business dev-client sessions attached to this worktree's Metro server and a business-web session that can load this branch.
- **Retest:** Open `/trip/060d0483-50db-48d1-840b-73d9fc59356a` on all three surfaces after destination re-entry and capture screenshots.

**P2-003: Implementor adversarial reader test is structural, not behavioral**
- **Evidence:** `tripsService.dashboard_reader_canonical.adversarial.test.ts` reads source text and regex-matches canonical identifiers rather than importing/mocking `getTrip` behavior.
- **What is wrong:** It catches obvious source drift but would miss several runtime mapping failures, such as wrong event-date row selection caused by a malformed mocked Supabase response.
- **Impact:** Automated regression coverage is acceptable as a scaffold but weaker than the spec's requested mocked-reader behavior.
- **Required fix:** Tester or implementor should add a real mocked service behavior test when the harness can safely mock `supabase`/Expo modules, or keep this as a known manual runtime gate.
- **Retest:** Add/run a behavior-level test or explicitly satisfy the gap with the live-fire screenshots.

### P3 Low

None.

### P4 Notes

- **P4-001:** Source wiring for canonical dashboard state is clean: capacity from `ticket_types.quantity_total`, dates from `event_dates`, destination from `events.destination_text`, and per-tier sold counts from `biz_trip_tickets_sold_by_tier`.
- **P4-002:** The tier row component already renders `${sold} / ${cap}` from parent-provided sold count and ticket capacity; no separate "remaining" field is required for the current display contract.
- **P4-003:** The strict-grep gate now catches both stale JSONB reader literals and future shallow `theme || (p_patch->'theme')` trip-RPC merges.
- **P4-004:** The current branch diff still includes prior ORCH-0950 implementation/QA artifacts; this is artifact history, not new product scope.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-01 destination column exists | PASS | Live query selected `destination_text` | None |
| SC-02 backfill where legacy destination existed | PASS structural | Migration backfill at `20260725000002` lines 135-140 and strip verify lines 180-199 | None |
| SC-03 DC Adventure destination null post-migration until re-entry | PASS | Live query returned `destination_text=null` | P2-001 |
| SC-04 capacity-only patch writes ticket type | PASS structural | Deno T-02 and migration source | None |
| SC-05 destination-only patch writes destination column | PASS structural | Deno T-02 and migration source | None |
| SC-06 combined patch canonicalizes all fields | PASS structural | Deno T-03 | None |
| SC-07 publish writes destination and strips JSONB | PASS structural | Deno T-05 | None |
| SC-08 per-tier RPC counts tickets | PASS structural + live direct count | Deno T-04; direct tickets count 75 | Runtime RPC call blocked under MCP role |
| SC-09 reader sources canonical fields | PASS source | `tripsService.ts:353-405`; focused Jest | P2-003 |
| SC-10 hero subtitle Aug 17-22 plus destination | FAIL | Screenshot shows `Date TBD`; destination remains null | P1-001, P2-001 |
| SC-11 tier card sold/cap | FAIL | Screenshot shows `0 / 102`; DB says sold 75, capacity 102 | P1-001 |
| SC-12 lifecycle pill correct | PASS iOS screenshot | Screenshot shows `UPCOMING`, matching current date before Aug 17, 2026 | None |
| SC-13 strict-grep | PASS | Gate + self-test green | None |
| SC-14 soldCountsByTier invalidation | PASS | `useTrips.ts:64-65`, `useTrips.ts:353-357`; Jest green | None |
| SC-15 post-re-entry destination live-fire | BLOCKED | `destination_text=null`; runtime blocked | P2-001, P2-002 |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| `biz_update_live_trip` auth gate preserved | P4 | Migration lines 277-310 include `auth.uid()` and permission/type/status gates | PASS source |
| New per-tier RPC search path | P4 | Migration lines 203-209 use `SECURITY DEFINER SET search_path = public, pg_temp` | PASS source |
| RPC execute grant | P4 | Migration line 225 grants `biz_trip_tickets_sold_by_tier(uuid)` to authenticated | PASS source |
| MCP function call permission | P4 | MCP role denied `biz_trip_tickets_sold`; direct count fallback used | Not product failure |
| ORCH-0960 / event-side RPC hard guard | P4 | Expanded migration touches trip RPCs only; no Stripe account_invalid work | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Trip dashboard hero | Should show `Upcoming`, `The DC Adventure`, `Aug 17-22 · <destination>` | P2 | BLOCKED by missing destination + runtime access |
| Spots KPI | Should show current sold/cap, now `75 / 102` | P1 | FAIL: screenshot shows `75` only. |
| Pricing tier card | Should show current sold/cap, now `75 / 102` from RPC sold count + canonical cap | P1 | FAIL: screenshot shows `0 / 102`. |
| Runtime iOS | App should launch into business app on current branch | P2 | BLOCKED in Expo dev launcher |
| Runtime Android | App should launch into business app on current branch | P2 | BLOCKED by launcher resolution |
| Runtime web | App should load branch web bundle and authenticated dashboard | P2 | BLOCKED by Metro resolution |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Attempted | FAIL/PARTIAL | iOS reached dashboard and failed data contract; Android launch blocked. |
| Business | Source + attempted runtime | FAIL/PARTIAL | Shared RN source verified; visible iOS business runtime failed. |
| Admin | Source scope only | N/A/PASS | No admin product scope touched. |
| Public/web | Source scope only | N/A | Buyer/public trip path out of expanded scope. |
| Solo | N/A | N/A | Planner trip dashboard only. |
| Collab | N/A | N/A | Planner trip dashboard only. |
| iOS | Attempted | FAIL | User screenshot reached dashboard and showed stale/noncanonical values. |
| Android | Attempted | BLOCKED | Business package cannot launch. |
| Business-web | Attempted | BLOCKED | Metro cannot resolve `expo-router/entry` from worktree symlink path. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Canonical destination/date/capacity reader | Shared RN source | In scope | Not touched | Reads SQL columns | Live DC data has capacity/date but null destination | Destination re-entry remains outside code fix. |
| Per-tier sold-count RPC | Shared RN source | In scope | Not touched | New `biz_trip_tickets_sold_by_tier` | Counts tickets statuses valid/used/transferred | Direct live count confirms 75 sold tickets; visible iOS tier query still renders 0. |
| Deep merge/strip in live edit RPC | Shared edit client | In scope | Not touched | `biz_update_live_trip` only | Prevents partial-edit sibling wipe | Structural Deno proof only; live mutation not run. |
| Business-web launch | In scope | In scope | N/A | N/A | N/A | Environment blocked before app render. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Remote migration state | Implementation report + live column/data probe | PARTIAL PASS | Optional: orchestrator can re-check migration ledger before close. |
| DC Adventure canonical data | Live read-only SQL | PASS for capacity/date/sold count; destination not re-entered | Re-enter destination and re-probe. |
| iOS visual | Maestro + user screenshot | FAIL | Prove branch bundle, then fix stale/noncanonical dashboard render and retest. |
| Android visual | ADB launch + screenshot | BLOCKED | Install/repair launchable business dev build and open DC dashboard. |
| Business-web visual | Expo web start | BLOCKED | Fix Metro symlink resolution or run from a non-symlinked install; authenticate and open DC dashboard. |

## 14. Required Actions

1. **P1-001:** Fix or disprove the iOS stale/noncanonical dashboard runtime: prove branch bundle, then make hero dates, Spots denominator, and tier sold count match live database truth.
2. **P2-001:** Re-enter DC Adventure destination through the fixed business edit screen, then prove `events.destination_text IS NOT NULL`.
3. **P2-002:** Restore working Android and business-web sessions for this ORCH branch and rerun the dashboard matrix.
4. **P2-003:** Either add behavior-level mocked service coverage for `readBusinessTrip` canonical precedence or mark the current source-grep scaffold as paired with mandatory runtime screenshots.

## 15. Conditional / Recommended Actions

1. Capture screenshots for all three runtime surfaces after re-entry: hero subtitle, Spots KPI, lifecycle pill, pricing tier card.
2. Consider adding a dedicated ORCH-0950 Maestro/Playwright runtime script once a stable business test account/session is available.

## 16. Discoveries For Orchestrator

- None requiring a new cross-ORCH comms-ledger entry. The blockers are ORCH-0950 QA prerequisites/runtime environment issues, not discoveries affecting another active ORCH.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| Original capacity dual-source bug | Yes structurally | Deno, strict-grep, service source, live `quantity_total=102` and no JSONB capacity | None found |
| Expanded shallow `business_trip` partial-patch wipe | Yes structurally | Deno T-03 + strict-grep shallow merge ban | Live mutation unverified |
| Dashboard hero `Date TBD` from JSONB dates | Yes structurally | Service maps `event_dates` to dashboard fields | Destination side blocked by missing re-entry |
| Tier-card order-count sold map | Yes structurally | Dashboard uses `readTripSoldCountsByTier` query | Runtime visual unverified |

Retest cycle: 1 for expanded scope; runtime matrix remains blocked.
