# Implementation Report: Trip Dashboard Spots Count Tickets, Not Orders (ORCH-0947)

> Date: 2026-05-24
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md`
> Status: implemented, partially verified

## 1. Layman Summary

The trip dashboard now reads its Spots and Travelers numerator from ticket rows that actually occupy seats, instead of counting buyer orders. This aligns the planner dashboard with the checkout capacity gate, so a 4-ticket order counts as 4 travelers/spots sold, not 1.

## 2. Request And Context

- **Request:** Implement ORCH-0947 in `~/Desktop/mingla-orchs/ORCH-0947-[trip-spots-counts-tickets]/` on branch `ORCH-0947-trip-spots-counts-tickets`.
- **Source:** User-dispatched spec implementation prompt.
- **Affected surfaces:** Business trip dashboard shared by iOS, Android, and web preview; SQL helper used by `getTrip()`.
- **Related issues/artifacts:** Spec above; `Mingla_Artifacts/WORLD_MAP.md` 2026-05-24 investigation entry.

## 3. Scope

- **In scope:** New RPC migration, local migration apply, `Trip.ticketsSoldCount`, `getTrip()` RPC plumbing, dashboard numerator swap, existing parity test updates, new regression tests, strict-grep guard.
- **Out of scope:** Capacity storage, checkout RPC capacity gate, `biz_trip_sold_count_by_tier`, Travelers tab order-list semantics, Money tab.
- **Assumptions:** `viewer` is not a valid `biz_role_rank` value in the baseline helper, so the migration uses the spec fallback `event_manager` for read authorization.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md` | Contract | Required 7-layer implementation and hard guards. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Role helper | `biz_role_rank` supports scanner/marketing/finance/event_manager/brand_admin/account_owner; no viewer. |
| `mingla-business/src/services/tripsService.ts` | Trip detail owner | `getTrip()` already had a 4-call `Promise.all`; `mapTrip()` had three callsites. |
| `mingla-business/app/trip/[id]/index.tsx` | Dashboard UI | Spots and Travelers subtitle used `travelersCount` derived from orders. |
| `mingla-business/app/trip/[id]/__tests__/dashboard-parity*.test.tsx` | Existing parity tests | T-07/T-08 pinned old order-count string templates; T-A09 remains valid. |
| `.github/workflows/strict-grep-mingla-business.yml` | CI guard wiring | Modular strict-grep jobs are registered in this workflow. |

## 5. Blast Radius

- **Direct changes:** SQL RPC, trip service data shape, dashboard display lines, tests, strict-grep CI.
- **Cascade changes:** Public trip mappers and Trip test fixtures now carry `ticketsSoldCount: 0` to satisfy the expanded `Trip` interface.
- **Parity surfaces:** One shared dashboard source feeds business iOS, business Android, and business web preview.
- **Cache impact:** No new React Query key; `ticketsSoldCount` rides the existing `useTrip(eventId)` payload.
- **State boundaries:** React Query remains server-state owner; no Zustand/AsyncStorage writes added.
- **Auth/RLS/security:** SECURITY DEFINER helper performs auth, trip lookup/type check, soft-delete check, and brand rank check before reading ticket rows.
- **Deploy path:** Operator must run `supabase db push --linked`; no edge deploy.

## 6. Old To New Receipts

### `supabase/migrations/20260725000000_orch_0947_biz_trip_tickets_sold.sql`

- **Before:** No canonical business-readable RPC for tickets-sold count.
- **After:** Added `public.biz_trip_tickets_sold(uuid)` counting `tickets` joined through `ticket_types` with status `valid`, `used`, or `transferred`.
- **Why:** Mirrors checkout capacity gate without reusing order-count or tier-sold helper semantics.
- **Approx lines changed:** New file.

### `mingla-business/src/services/tripsService.ts`

- **Before:** `Trip` had no sold-ticket field; `getTrip()` fetched days/tiers/inclusions/ticket_types only.
- **After:** Added `ticketsSoldCount`, a fifth `Promise.all` RPC call, error propagation for `soldResp.error`, and mapper plumbing.
- **Why:** Dashboard needs server-derived seat count and must not silently zero on RPC failure.
- **Approx lines changed:** ~23.

### `mingla-business/app/trip/[id]/index.tsx`

- **Before:** `travelersCount` counted non-failed/non-cancelled orders and drove Spots plus Travelers subtitle.
- **After:** `ticketsSold = trip.ticketsSoldCount` drives both display strings.
- **Why:** Orders undercount multi-ticket purchases.
- **Approx lines changed:** ~13.

### Tests, fixtures, and guards

- **Before:** Existing parity tests pinned `travelersCount`; older service mock expected one RPC; Trip literals lacked `ticketsSoldCount`; no strict-grep guard.
- **After:** Updated parity tests T-03/T-07/T-08, added service and migration regressions, updated fixtures/mappers, and wired `orch-0947-trip-spots-tickets-not-orders.mjs`.
- **Why:** Keep behavior and type contract covered after the data-shape change.
- **Approx lines changed:** New/updated focused test and CI files.

## 7. Implementation Details

- **Architecture decisions:** `ticketsSoldCount` is top-level on `Trip`, not `TripBusinessTrip`, because it is runtime derived truth, not stored trip configuration.
- **Data flow:** `getTrip(eventId)` fetches trip sidecars and `biz_trip_tickets_sold` in parallel; `mapTrip()` receives the count and returns it with the `Trip`.
- **Mutation/query behavior:** No mutation path changed. No query key changed.
- **State handling:** No local state persistence added.
- **Error handling:** RPC errors throw exactly like the sibling sidecar reads; no silent-zero fallback on error.
- **Copy/accessibility:** Existing labels remain; only numeric values changed.
- **Analytics/notifications/realtime:** None changed. Realtime ticket invalidation remains a follow-up gap.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| New monotonic migration | `20260725000000_orch_0947_biz_trip_tickets_sold.sql` | Local/origin max was `20260724000005`; `supabase migration up` says up to date | Pass |
| Mirror canonical ticket statuses | RPC counts `valid`, `used`, `transferred` ticket rows | Deno T-01/T-02/T-03 | Pass |
| No capacity storage/checkout changes | No edits to capacity fields or checkout RPC | Diff review | Pass |
| Do not reuse `biz_trip_sold_count_by_tier` | New independent RPC | Deno T-01 forbids helper | Pass |
| No silent-zero on RPC error | `if (soldResp.error) throw soldResp.error` | Service test asserts reject | Pass |
| Dashboard Spots uses tickets sold | `spotsLabel` uses `ticketsSold` | Dashboard parity T-07/T-08 | Pass |
| Travelers subtitle uses tickets sold | Action tile subtitle uses `ticketsSold` | Dashboard parity T-03 | Pass |
| Strict-grep prevention | New ORCH-0947 gate wired | Node gate passes | Pass |
| Full typecheck clean | Attempted | Blocked by existing repo errors outside ORCH scope and missing root pnpm workspace | Partial |
| Full test suite clean | Attempted package-local Jest | Existing unrelated failures remain; focused ORCH tests pass | Partial |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-RQ-KEY-FACTORY | Yes | Yes | No new query key. |
| I-NO-SILENT-FAILURE | Yes | Yes | RPC errors throw. |
| I-NO-FABRICATED-DATA | Yes | Yes | Dashboard reads server RPC value. |
| I-SECURITY-DEFINER-OWNERSHIP-CHECK | Yes | Yes | Auth + event + rank checks before ticket read. |
| I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE | Yes | Established | Strict-grep forbids `travelersCount` regression. |

## 10. Parity Check

- **Mobile:** Shared business dashboard code changed; simulator parity not run by Codex.
- **Business app:** Focused dashboard source parity tests passed.
- **Admin:** Out of scope.
- **Public/web:** Business web preview needs deploy after close; no live browser smoke run.
- **Solo/collab:** Not applicable.
- **Gaps:** Tester must run business iOS, Android, and web preview live sim parity per downstream prompt.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** `Trip` now includes `ticketsSoldCount`.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Existing `useTrip` fetch path hydrates the count on detail load.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Migration chain monotonic | `ls supabase/migrations | tail -10`; `git ls-tree origin/main supabase/migrations/ | tail -10` | Pass | Both tails ended at `20260724000005`. |
| Local apply | `/Users/sethogieva/bin/supabase start`; `/Users/sethogieva/bin/supabase migration up` | Pass | Startup applied ORCH-0947 migration; explicit migration up returned “Local database is up to date.” |
| Role rank | Read baseline `biz_role_rank` | Pass with spec fallback | `viewer` invalid; used `event_manager`. |
| Typecheck requested command | `pnpm -F mingla-business tsc --noEmit` | Blocked | `pnpm` absent on PATH; Corepack pnpm then failed because worktree root has no `package.json`/workspace manifest. |
| Package-local typecheck | `npx tsc --noEmit` from `mingla-business` | Fail, pre-existing | Errors in checkout buyer files, marketing editor, native payments module resolution, DraftEvent category fixtures, shared packages. |
| Touched-file typecheck filter | `npx tsc --noEmit --pretty false 2>&1 | rg "tripsService|usePublicTripBySlug|publicEventsService|dashboard-parity|trip/\\[id\\]/index|ORCH-0876|publishedTripEditGuards"` | Pass | No output for touched ORCH-0947 files. |
| Existing + new service tests | `npx jest src/services/__tests__/tripsService.test.ts src/services/__tests__/tripsService.ticketsSoldCount.test.ts --runInBand` | Pass | 2 suites, 5 tests. |
| Existing dashboard parity tests | `npx jest --runTestsByPath 'app/trip/[id]/__tests__/dashboard-parity.test.tsx' 'app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx' --runInBand` | Pass | 2 suites, 31 tests. |
| New migration regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/migrations/__tests__/biz_trip_tickets_sold.test.ts` | Pass | 3 tests. |
| Strict-grep gate | `node .github/scripts/strict-grep/orch-0947-trip-spots-tickets-not-orders.mjs` | Pass | No `travelersCount` in dashboard. |
| Full package Jest | `npx jest --runInBand` from `mingla-business` | Fail | Attempted before the final `tripsService.test.ts` mock patch; output included that in-scope mock fallout plus unrelated existing failures. Focused service retest now passes; full sweep was not rerun. |
| Fails-on-revert proof | Temporarily changed RPC body to `orders` count and reran Deno migration test | Pass as negative proof | T-01 and T-02 failed; restored fixed SQL and Deno test passed. Fix commit hash is pending because implementor does not own CLOSE commit in this workflow; current pre-implementation HEAD was `4b734b1c`. |

## 13. Regression Surface

1. Trip dashboard Spots KPI and Travelers tile subtitle.
2. `Trip` interface consumers constructing literals or public trip adapters.
3. `publishTrip()` tests that refresh through `getTrip()`.
4. Strict-grep workflow runtime.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| RPC read gate uses `event_manager` | More restrictive than intended viewer-or-higher read semantics | Add/confirm viewer rank in a future auth model ORCH | Migration comment + §3 |
| No realtime ticket invalidation | Dashboard count updates on existing refetch cadence only | Future ORCH adds ticket subscription/invalidation | Existing `useTrip` cache |
| Full type/test suite not clean | Existing repo failures obscure green global gate | Separate cleanup ORCHs or baseline update | Verification §12 |
| Commit-hash proof pending | Implementor did not create CLOSE commit per downstream routing | Orchestrator CLOSE creates commit and can rerun fails-on-revert against that hash | Verification §12 |

## 15. Discoveries For Orchestrator

- `biz_role_rank('viewer')` is not valid in the baseline. This ORCH used the spec fallback `event_manager`; a future auth/read-rank cleanup may be needed if planner viewers should see ticket counts.
- `WORKTREE_REGISTRY.md` and the spec file were already dirty/untracked in this worktree; this implementation did not edit them.
- Full `mingla-business` typecheck and Jest have unrelated pre-existing failures; the one in-scope service mock failure seen during the full sweep was fixed and retested with the focused service command.

## 16. Deploy Notes

- **Migrations:** Operator must run `supabase db push --linked`; Codex did not run remote push.
- **Edge functions:** None.
- **Mobile OTA/native:** Shared JS change; tester should verify business iOS + Android.
- **Business/admin web:** Business web preview requires `[deploy]` on CLOSE commit.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(trips): count dashboard spots from tickets

Resolves: ORCH-0947
Evidence: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md
[TEST-MOD-APPROVED ORCH-0947]
[deploy]
```

## Ready-To-Test Checklist

1. Operator runs `supabase db push --linked`.
2. Tester verifies RPC returns the live ticket count for DC Adventure and rejects non-members/anon callers.
3. Tester runs partial-refund adversarial T-A03: one 4-ticket order with one ticket set to `refunded` returns `3`, not `4`.
4. Tester verifies business iOS, Android, and web preview show `ticketsSoldCount / capacity` and matching Travelers subtitle after React Query refetch.
