# Implementation Report: ORCH-0950 Expanded Scope Dashboard Coherence Rework

> Date: 2026-05-25
> Mode: Rework
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
> QA input: `Mingla_Artifacts/reports/QA_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
> Status: implemented and verified on iOS; pending independent iOS/business-web/Android live-fire
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`

## 1. Layman Summary

The visible DC Adventure dashboard now renders the same truth as the live database. The iOS branch bundle was proven from this ORCH-0950 worktree, the hero date renders `Aug 17-22`, Spots renders `75 / 102`, and the tier card renders `75 / 102`.

Destination is still intentionally absent because live `events.destination_text` remains `NULL`; Seth still needs to re-enter it through the business edit flow before tester verifies destination text.

## 2. Request And Context

- **Request:** Rework failed QA by proving iOS is running the ORCH-0950 branch bundle, then fixing visible DC Adventure dashboard dates, Spots, and tier sold/cap coherence.
- **Source:** Tester FAIL report `QA_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`.
- **Affected surfaces:** Mingla Business iOS now runtime-verified; shared RN code affects Business Android and business-web preview.
- **Related artifacts:** Prior implementation report, expanded spec, QA report, live Supabase read-only probes, iOS screenshot evidence.

## 3. Scope

- **In scope:** Dashboard display math, branch-bundle proof hook, Metro entry resolution for per-ORCH worktree runtime, focused regression tests, iOS proof.
- **Out of scope:** Migrations, ORCH-0960, ORCH-0946, event-side RPCs, destination data repair, Android install repair.
- **Assumptions:** Current live DB truth is authoritative: sold `75`, capacity `102`, destination `NULL`, dates `2026-08-17` to `2026-08-22`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | COMMS-0002 WARN applies to ALL; acknowledged and no backend files were touched. |
| `QA_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` | Rework contract | Runtime showed `Date TBD`, Spots `75`, tier `0 / 102`; required branch-bundle proof first. |
| `mingla-business/app/trip/[id]/index.tsx` | Dashboard render owner | Spots was already canonical, but tier sold count fell to `0` while per-tier query was unavailable and dates used local-time formatting inline. |
| `mingla-business/src/services/tripsService.ts` | Canonical data source | `getTrip` already reads `event_dates`, `destination_text`, `ticket_types.quantity_total`, and `biz_trip_tickets_sold`. |
| `mingla-business/package.json` / `metro.config.js` | Runtime proof blocker | Per-ORCH symlinked `node_modules` caused Metro to misresolve `expo-router/entry`; explicit local `index.js` entry fixes this. |

## 5. Blast Radius

- **Direct changes:** Business trip dashboard display helper, trip route render path, test IDs, Expo entry file.
- **Cascade changes:** Optional testID props added to shared event ticket row and trip KPI card.
- **Parity surfaces:** Shared RN dashboard logic now applies to iOS, Android, and web preview.
- **Cache impact:** No query key or invalidation changes beyond prior ORCH-0950 work.
- **State boundaries:** React Query remains server-state owner; fallback only uses already-loaded trip-level `ticketsSoldCount` for the single-tier dashboard while the tier RPC is pending.
- **Auth/RLS/security:** No auth, RLS, migrations, RPC, or edge-function changes.
- **Deploy path:** JS bundle/OTA or native dev-client rebuild path only; no DB push and no edge deploy.

## 6. Old To New Receipts

### `mingla-business/app/trip/[id]/index.tsx`

- **Before:** Hero date was formatted inline with device timezone; tier card defaulted to `0` when `soldCountsByTierQuery.data` was absent; no branch-bundle proof testID.
- **After:** Route uses `formatTripHeroSubline`, `formatTripSpotsLabel`, `resolveTripTierSoldCount`, and `tripDashboardBundleProofTestID`.
- **Why:** Avoid timezone date drift, prevent single-tier `0 / 102` while the RPC loads/fails, and give tester a non-visible hook to prove the branch bundle is running.
- **Approx lines changed:** Imports around 69-74, display logic around 312-323, hero around 390-399, KPI/tier card around 459-483.

### `mingla-business/src/utils/tripDashboardDisplay.ts`

- **Before:** No isolated/tested dashboard display contract.
- **After:** New helpers render UTC date ranges, Spots labels, single-tier sold fallback, and the ORCH-0950 branch proof testID.
- **Why:** Behavior-level regression coverage for the exact visible QA failure.
- **Approx lines changed:** New file, lines 1-90.

### `mingla-business/src/utils/__tests__/tripDashboardDisplay.test.ts`

- **Before:** No focused behavior test for the dashboard display contract.
- **After:** Tests assert `Aug 17-22`, post-reentry destination string, `75 / 102`, single-tier fallback, multi-tier no-smear, RPC precedence, and branch-bundle testID.
- **Why:** This test would fail on the old date/tier-card behavior.
- **Approx lines changed:** New file, lines 1-72.

### `mingla-business/package.json` and `mingla-business/index.js`

- **Before:** `"main": "expo-router/entry"` triggered Metro's symlink path bug from the per-ORCH worktree.
- **After:** `"main": "index.js"` and `index.js` imports `expo-router/entry`.
- **Why:** The iOS simulator and web preview can bundle the ORCH worktree instead of failing before runtime proof.
- **Approx lines changed:** `package.json:3`, `index.js:1`.

### `TripDetailKpiCard.tsx` / `EventDetailTicketTypeRow.tsx`

- **Before:** No stable IDs for live-fire assertions on Spots or tier capacity text.
- **After:** Optional testID props reach the exact visible value nodes.
- **Why:** Tester can assert the runtime values without relying only on screenshots.
- **Approx lines changed:** 6 lines each.

## 7. Implementation Details

- **Architecture decisions:** Kept canonical reads in `tripsService`; display-only logic moved to a small helper to keep the route readable and testable.
- **Data flow:** `getTrip` supplies canonical `ticketsSoldCount`, capacity, and dates; `readTripSoldCountsByTier` still wins when available; single-tier fallback uses trip-level `ticketsSoldCount`.
- **Mutation/query behavior:** No mutations changed. No query keys changed.
- **State handling:** No Zustand/AsyncStorage changes.
- **Error handling:** Per-tier RPC errors still surface through React Query; dashboard no longer fabricates visible zero for the common single-tier trip while the query is pending.
- **Copy/accessibility:** No visible QA/proof copy added; proof is testID-only.
- **Analytics/notifications/realtime:** Unchanged.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Prove iOS app is running ORCH-0950 branch bundle | Added explicit Expo entry and route-level ORCH-0950 testID | Metro bundled `iOS ./index.js` from this worktree; Maestro asserted proof testID | PASS |
| Canonical dates render | UTC date helper renders `Aug 17-22` | Jest + iOS screenshot + Maestro text assertion | PASS |
| Spots shows current sold/cap | `formatTripSpotsLabel(75, 102)` renders `75 / 102` | Live SQL, iOS screenshot, Maestro text assertion | PASS |
| Tier card sold count matches ticket count | Single-tier fallback renders trip ticket count until per-tier RPC data is present | Jest + iOS screenshot + Maestro text assertion | PASS |
| Destination remains absent until re-entry | Helper renders date-only when `destination_text` is null | Live SQL confirms null; iOS screenshot shows date-only | PASS |
| Do not apply migrations / touch guarded backend scope | No migrations, edge functions, ORCH-0960/0946/event RPC edits | Git diff and strict-grep C7 | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per truth | Yes | Yes | Canonical DB/service truth remains owner; UI display helper only formats loaded truth. |
| No fabricated data | Yes | Yes | Single-tier fallback uses canonical trip-level ticket count already returned by `biz_trip_tickets_sold`. |
| Server state server-side | Yes | Yes | No client-side order counting introduced. |
| Query key discipline | Yes | Yes | No key changes; existing `soldCountsByTier` key remains. |
| COMMS ledger discipline | Yes | Yes | COMMS-0002 acknowledged; no backend guarded files changed. |

## 10. Parity Check

- **Mobile:** iOS simulator runtime proof PASS on iPhone 17 Pro Max.
- **Business app:** Shared RN route fixed; Android still requires tester live-fire because prior Android package launch was broken outside this code path.
- **Admin:** Not touched.
- **Public/web:** Not touched as buyer surface. Business-web preview should benefit from the explicit `index.js` entry that fixed the same Metro resolver class on iOS; tester should still verify authenticated web.
- **Solo/collab:** N/A.
- **Gaps:** Destination text still requires Seth re-entry; Android and business-web need independent live-fire.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Explicit Expo entry resolves the worktree bundle; branch proof testID is present only on the trip dashboard route.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Live DC Adventure SQL | Supabase MCP read-only SQL | PASS | `destination_text=null`, start `2026-08-17`, end `2026-08-22`, capacity `102`, sold `75`. |
| Per-tier RPC live read | Supabase MCP `select public.biz_trip_tickets_sold_by_tier(...)` | PASS | Returned `{"d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e":75}`. |
| iOS branch bundle | `CI=1 npx expo start --dev-client --port 8098 --clear`; `xcrun simctl openurl ...` | PASS | Metro bundled `iOS ./index.js` from this worktree. |
| iOS visual | Screenshot `Mingla_Artifacts/evidence/orch-0950-runtime/rework-ios-dashboard-coherence.png` | PASS | Shows `Aug 17-22`, Spots `75 / 102`, tier `75 / 102`. |
| iOS assertions | `maestro test --device 2C3312D9-EE52-4EBD-9704-15811D49A2EC Mingla_Artifacts/evidence/orch-0950-runtime/rework-ios-dashboard-coherence.yaml` | PASS | Asserted branch proof testID, hero subline testID, `Aug 17-22`, and `75 / 102`. |
| Strict-grep canonical columns | `node .github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` | PASS | `files=1471 violations=0`. |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-trip-canonical-columns.test.mjs` | PASS | 6/6. |
| ORCH-0863 backend gate | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C1-C7 pass; C7 reports zero backend touches. |
| Deno regressions | `/Users/sethogieva/.deno/bin/deno test --allow-read ...` | PASS | 11/11. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check ...` | PASS | Exit code 0. |
| Focused Jest | `npx jest --runInBand src/utils/__tests__/tripDashboardDisplay.test.ts src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts src/hooks/__tests__/useTrips.test.ts src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts` | PASS | 4 suites, 19 tests. |
| Whitespace | `git diff --check` | PASS | Exit code 0. |
| Full TypeScript | `npx tsc --noEmit --pretty false` | FAIL pre-existing | Same broad debt class as prior report: checkout buyer implicit anys, ComposerV2, `@mingla/payments-native` resolution, DraftEvent test fixture shape, package type resolution; no ORCH-0950 touched-file errors observed. |

## 13. Regression Surface

1. **Trip dashboard date formatting:** UTC all-day formatting prevents Aug 17 from rendering as Aug 16 on US devices.
2. **Single-tier trip dashboard sold count:** The tier card cannot show `0 / 102` while trip-level canonical ticket count is already loaded as `75`.
3. **Multi-tier future trips:** Helper deliberately returns `0` when per-tier data is missing for multi-tier trips, avoiding duplicated total sold across tiers.
4. **Per-ORCH worktree runtime:** Explicit entry file avoids Metro resolving `expo-router/entry` through the anchor checkout symlink.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Destination null | Hero remains date-only until Seth re-enters destination | `events.destination_text IS NOT NULL` for DC Adventure | Live DB |
| Android runtime | Prior QA could not launch Android business package | Tester installs/repairs a launchable business dev build and asserts same values | Tester live-fire |
| Business-web runtime | Prior QA hit Metro resolver failure before auth dashboard | Tester verifies explicit `index.js` entry fixes web preview and asserts same values | Tester live-fire |
| Stripe native warning | iOS Metro logged a `forwardRef` warning/error in payments-native import, but the dashboard rendered | Separate owner if it becomes fatal; not ORCH-0950 dashboard path | Runtime logs |

## 15. Discoveries For Orchestrator

- No new cross-ORCH comms-ledger entry required. COMMS-0002 already covers backend strict-grep risk, and this rework avoided backend files.

## 16. Deploy Notes

- **Migrations:** None created or modified; do not run `supabase db push` for this rework.
- **Edge functions:** None touched; no deploy.
- **Mobile OTA/native:** JS bundle change. The explicit `mingla-business/index.js` entry must be included in the business bundle.
- **Business/admin web:** Business-web should be retested because `package.json` now points to `index.js`; admin untouched.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
trip-dashboard: fix ORCH-0950 runtime coherence

Resolves: ORCH-0950
Evidence: strict-grep, Deno, focused Jest, iOS Maestro branch-bundle proof
Deploy: JS bundle only; no DB push or edge deploy
```

## Ready-To-Test Checklist

1. Re-enter DC Adventure destination through business edit, then confirm `events.destination_text IS NOT NULL`.
2. On iOS, open `mingla-business://trip/060d0483-50db-48d1-840b-73d9fc59356a`; verify hero shows `Aug 17-22 · <destination>`, Spots `75 / 102`, tier `75 / 102`, status `UPCOMING`.
3. On business-web, open the same trip route in an authenticated session and verify the same values.
4. On Android, launch the business dev build and verify the same values.
