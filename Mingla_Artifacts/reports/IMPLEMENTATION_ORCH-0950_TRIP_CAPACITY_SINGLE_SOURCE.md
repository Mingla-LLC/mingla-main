# Implementation Report: Trip Capacity Single Source (ORCH-0950)

> Date: 2026-05-24
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_TRIP_CAPACITY_DUAL_SOURCE.md`
> Status: implemented, partially verified
> Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
> Branch: `ORCH-0950-trip-capacity-single-source`
> Implementation commit: `14e532fa`
> Fails-on-revert verified at `14e532fa`

## 1. Layman Summary

Trip capacity now has one canonical storage location: `ticket_types.quantity_total`. The migration reconciles existing drift, strips legacy JSONB capacity, and reroutes trip live-edit/publish RPCs so planner capacity changes are immediately enforced by buyer checkout. Business draft editing now autosaves Step 1 capacity through the pricing/ticket writer, and a service guard + CI strict-grep gate prevents the old JSONB path from returning.

## 2. Request And Context

- **Request:** Implement ORCH-0950 exactly from the spec and investigation.
- **Source:** Operator-dispatched Codex `implementor-mingla`.
- **Affected surfaces:** Business iOS/Android/web-preview shared RN trip creator/edit flows; buyer-web checkout gate via unchanged checkout RPC; Postgres trip publish/live-edit RPCs.
- **Related artifacts:** Spec and investigation above. Out-of-scope ORCH-0946 and ORCH-0947 were not touched.

## 3. Scope

- **In scope:** Atomic migration; strict-grep gate + self-test + workflow; service reader/guard; wizard autosave reroute; migration contract regression; client guard regression; invariant + decision log entries; ORCH-0863 backend allowlist.
- **Out of scope:** `supabase db push`, edge function deploys, checkout RPC edits, ORCH-0946, ORCH-0947, UI redesign.
- **Assumptions:** Trip model remains single tier; pre-flight migration probe aborts if current data violates that assumption.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` | Contract | §13 12-step order and §12 criteria. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_TRIP_CAPACITY_DUAL_SOURCE.md` | Root cause | Live edits wrote JSONB; checkout read `ticket_types.quantity_total`. |
| `supabase/migrations/20260620000000_orch_0880_tr5_traveler_intake_forms.sql` | Latest `biz_update_live_trip` body | ORCH-0880 intake schema extension had to be preserved. |
| `supabase/migrations/20260609000000_orch_0859_trip_publish_slug_flag.sql` | Latest trip publish body | Dual slug-trigger flags had to be preserved. |
| `mingla-business/src/services/tripsService.ts` | Reader/writers | `readBusinessTrip` read JSONB capacity; `updateTripPricing` already owned `quantity_total`. |
| `mingla-business/src/components/trip/TripCreatorWizard.tsx` | Draft autosave | Step 1 was sending capacity through `updateTripBasics`. |
| `mingla-business/src/utils/tripAdapter.ts` | Diff labels | Capacity diff key still named legacy JSONB path. |

## 5. Blast Radius

- **Direct changes:** Migration, trip service, trip creator wizard, trip adapter, strict-grep CI, tests, registry/docs.
- **Cascade changes:** `TripBusinessTrip.capacity` remains the TS alias but now maps from `ticket_types.quantity_total`.
- **Parity surfaces:** Business iOS/Android/web-preview share the same RN code path.
- **Cache impact:** No query keys changed. Existing trip invalidations remain.
- **State boundaries:** No Zustand/AsyncStorage changes.
- **Auth/RLS/security:** RPC auth/permission gates preserved; no new grants beyond existing function grants.
- **Deploy path:** Operator applies migration with `supabase db push --linked`; no edge deploy.

## 6. Old To New Receipts

### `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`

- **Before:** Capacity could exist in both JSONB and ticket type integer columns. `biz_update_live_trip` wrote only JSONB; `business_publish_trip_draft` validated JSONB.
- **After:** Pre-flight invariant probe, drift notice, MAX backfill, JSONB strip, post-strip verification, live-edit capacity write to `ticket_types.quantity_total`, publish validation from ticket type, comments updated.
- **Why:** Make checkout and planner edits share one canonical column.

### `mingla-business/src/services/tripsService.ts`

- **Before:** `readBusinessTrip` sourced `capacity` from `theme.business_trip.capacity`; `updateTripBasics` accepted capacity in `businessTrip`.
- **After:** `mapTrip` passes `ticketTypes[0]?.quantity_total ?? null`; `readBusinessTrip` uses that value; `updateTripBasics` throws the ORCH-0950 error before network calls if capacity is present.
- **Why:** Preserve UI field shape while moving truth to ticket types.

### `mingla-business/src/components/trip/TripCreatorWizard.tsx`

- **Before:** Step 1 autosave wrote capacity through `updateTripBasics` JSONB merge.
- **After:** Step 1 autosave omits capacity from basics and calls `updateTripPricing` with current tier fields + capacity.
- **Why:** Keep Step 1 as the visible input while using the canonical writer.

### `mingla-business/src/utils/tripAdapter.ts`

- **Before:** Capacity diff label/key used `theme.business_trip.capacity`.
- **After:** Capacity diffs use `ticket_types.quantity_total`.
- **Why:** Prevent legacy key leakage in trip-edit summaries/notifications.

### Strict-Grep / CI

- **Before:** No invariant gate blocked reintroduction.
- **After:** Added `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs`, self-test, workflow job, and ORCH-0863 backend allowlist entry.
- **Why:** Keep the retired JSONB capacity path out of new code.

### Tests

- **Before:** No ORCH-0950 regression coverage.
- **After:** Added Deno migration-contract test and Jest client guard test.
- **Why:** Fail if the SQL reroute or client guard regresses.

## 7. Implementation Details

- **Architecture decisions:** Kept `TripBusinessTrip.capacity` as a compatibility alias; only its source changed.
- **Data flow:** Create/edit Step 1 capacity now writes via `updateTripPricing`; published-trip live edits still send the existing RPC patch shape, and the RPC strips/reroutes it.
- **Mutation/query behavior:** No new query keys. Existing `useUpdateLiveTripFields` invalidation verified and left unchanged.
- **Error handling:** `updateTripBasics` throws a clear ORCH-0950 error before Supabase is called.
- **Analytics/notifications/realtime:** No analytics changes. Trip diff label updated to canonical field key for downstream summaries.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-01 strip JSONB capacity | Yes | Migration strip + post-strip probe; Deno T-01 | Verified statically |
| SC-02 MAX backfill | Yes | Migration backfill; Deno T-01 | Verified statically |
| SC-03 live edit writes ticket type and strips patch | Yes | Deno T-02/T-03 | Verified |
| SC-04 buyer checkout succeeds after planner edit | Code path ready | Requires operator DB push + tester live-fire | Manual gate |
| SC-05 publish validates ticket type capacity | Yes | Deno T-04 | Verified statically |
| SC-06 `updateTripBasics` capacity throws | Yes | Jest guard test | Verified |
| SC-07 strict-grep fixture fails/passes allowlist | Yes | Node self-test | Verified |
| SC-08 KPI resolves current ticket capacity | Yes via service mapper | Requires tester dashboard live-fire | Manual gate |
| SC-09 Step 1 autosaves via pricing writer | Yes | Code review + targeted TS/Jest coverage | Partially verified |
| SC-10 non-capacity trip CRUD preserved | Intended; no unrelated logic changed | Requires tester sweep | Manual gate |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE | Yes | Added as DRAFT | Strict-grep + service guard + migration. |
| One owner per truth | Yes | Yes | DB truth is `ticket_types.quantity_total`; TS alias derives from it. |
| No silent failures | Yes | Yes | Wrong service path throws; migration aborts on bad invariants/residue. |
| Regression test habit | Yes | Yes | Deno + Jest regressions added in implementation commit. |

## 10. Parity Check

- **Mobile:** Business iOS/Android share `TripCreatorWizard` and `tripsService`; code path updated.
- **Business app:** Draft and live edit paths updated/preserved.
- **Admin:** Not in scope.
- **Public/web:** Checkout RPC unchanged and still reads ticket capacity.
- **Solo/collab:** Not applicable.
- **Gaps:** iOS sim, Android emu, buyer-web parity, and DC-Adventure-style live-fire remain tester/operator gates after DB push.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None; existing live-edit invalidations preserved.
- **Data shape changes:** `TripBusinessTrip.capacity` remains `number | null`; source changes to first ticket type quantity.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** After migration, rows no longer carry JSONB capacity; service reads ticket rows already fetched by current queries.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| New strict-grep gate | `node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` | PASS | `files=1434 violations=0` |
| Strict-grep self-test | `node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.test.mjs` | PASS | 4/4 |
| ORCH-0863 backend allowlist gate | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | Existing script reports C1-C7 pass. |
| Deno regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts` | PASS | 5/5 |
| Jest guard | `npx jest src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts --runInBand` from `mingla-business/` | PASS | 1/1 |
| Diff whitespace | `git diff --check` | PASS | No whitespace errors. |
| Full TS typecheck | `npx tsc --noEmit --pretty false` from `mingla-business/` | FAIL unrelated | Existing errors in checkout buyer pages, ComposerV2, IconChrome, native payments package resolution, shared packages, and older tests. |
| Touched-file TS attempt | `npx tsc --noEmit ... src/services/tripsService.ts src/components/trip/TripCreatorWizard.tsx src/utils/tripAdapter.ts` | FAIL unrelated transitive | Errors came from imported existing files (`IconChrome`, `liveEventStore`, `eventCoverMediaRules`). |
| Remote migration head check | `/Users/sethogieva/bin/supabase migration list --linked` | BLOCKED | CLI says project is not linked in this worktree. Local + `origin/main` heads are `20260724000005`, so `20260725000000` is monotonic. |
| Fails-on-revert | Temporarily changed migration `SET quantity_total = v_new_capacity` to `v_old_capacity`, reran Deno test, restored | FAIL proved | Deno T-02 failed, then passed again after restore. Fails-on-revert verified at `14e532fa`. |

## 13. Regression Surface

1. Published trip edits: capacity, dates, days, inclusions, pricing, intake schemas.
2. Trip draft wizard Step 1/Step 4 autosave ordering.
3. Trip dashboard/list capacity display via `TripBusinessTrip.capacity`.
4. Buyer checkout capacity enforcement via unchanged checkout RPC.
5. Trip publish validation and stale draft payload stripping.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Migration not applied by implementor | DB still has old function/data until operator pushes | Operator runs `supabase db push --linked` | Deploy notes |
| Full TS typecheck red before ORCH-0950 | Cannot claim full TS green | Separate owners fix pre-existing errors | Verification |
| Live-fire unverified | UI/device parity not proven in this pass | Tester runs mandatory iOS/Android/buyer-web/DC-style gates | Downstream QA |
| Remote migration list unavailable | Worktree not linked to Supabase project | Operator/orchestrator verifies via MCP after push | Deploy notes |

## 15. Discoveries For Orchestrator

- `mingla-business/src/utils/tripAdapter.ts` still exposed the legacy JSONB capacity key in diff labels; fixed in scope because the new gate caught it and it is the same capacity contract.
- No new ORCH-0946 or ORCH-0947 work was performed.

## 16. Deploy Notes

- **Migrations:** Operator applies `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql` via `supabase db push --linked`. Do not use Codex for DB push.
- **Edge functions:** None touched; no deploy.
- **Mobile OTA/native:** Business app code changed; ship through normal close/PR pipeline.
- **Business/admin web:** Business web preview receives shared RN changes. Admin not touched.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
ORCH-0950 canonicalize trip capacity

Resolves: ORCH-0950
Evidence: Deno ORCH-0950 migration test, Jest updateTripBasics guard, strict-grep gate/self-test
Deploy: operator runs supabase db push --linked; no edge deploy
```

## Ready-To-Test Checklist

1. Apply migration via `supabase db push --linked`; verify migration appears in Supabase migration list.
2. SQL probe returns 0: `SELECT count(*) FROM events WHERE event_type='trip' AND deleted_at IS NULL AND (theme->'business_trip') ? 'capacity';`
3. Create draft trip, edit Step 1 capacity, verify `ticket_types.quantity_total` changes.
4. Publish trip, edit live capacity upward, verify `ticket_types.quantity_total` changes and JSONB capacity is absent.
5. Buyer-web checkout for quantity within new remaining capacity succeeds.
6. Repeat on iOS sim, Android emu, and business web preview.
