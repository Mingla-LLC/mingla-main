# IMPLEMENTATION — ORCH-0950 Expanded Scope Dashboard Coherence

**Status:** implemented, partially verified  
**Date:** 2026-05-25  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`  
**Branch:** `ORCH-0950-trip-capacity-single-source`  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`  
**Implementation commit:** `c920cb86`  
**Fails-on-revert verified at:** `c920cb86` — temporarily removed the `jsonb_set(... existing_business_trip || patch_business_trip ...)` deep-merge block and confirmed `orch_0950_expanded_partial_patch_preserves_siblings.test.ts` failed T-03, then restored and reran green.

## Layman Summary

The trip dashboard now reads the same database truth that checkout and publish use. Capacity stays in `ticket_types.quantity_total`, dates come from the master `event_dates` row, destination text gets a new `events.destination_text` column, and tier cards count actual tickets through a new RPC instead of counting orders.

DC Adventure's destination cannot be recovered automatically because the legacy JSONB value is already gone. The remote probe shows the new column is not applied yet, the old destination value is `NULL`, and the post-migration expected state is therefore `destination_text = NULL` until Seth re-enters it on the fixed edit screen.

## Files Changed

| File | Purpose |
|---|---|
| `supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` | Adds `events.destination_text`, backfills/strips legacy JSONB destination/date keys, creates `biz_trip_tickets_sold_by_tier`, rewrites trip live-edit/publish RPCs, and self-verifies. |
| `supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts` | Deno migration-contract regression for canonical writes, deep merge, and per-tier ticket sold RPC. |
| `.github/scripts/strict-grep/i-proposed-trip-canonical-columns.mjs` + `.test.mjs` | Broadened invariant gate for capacity JSONB, shallow trip-RPC merges, and JSONB date/destination reads. |
| `.github/workflows/strict-grep-mingla-business.yml` | Runs the renamed canonical-columns gate and self-test. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Adds the expanded migration/test to `ORCH_0950_BACKEND_ALLOWLIST`. |
| `mingla-business/src/services/tripsService.ts` | Threads `event_dates` + `events.destination_text` into `readBusinessTrip`, keeps draft wizard JSONB bridge intact, and adds `readTripSoldCountsByTier`. |
| `mingla-business/src/hooks/useTrips.ts` + `src/hooks/__tests__/useTrips.test.ts` | Adds `tripKeys.soldCountsByTier(eventId)` and invalidates it after successful live trip edits. |
| `mingla-business/app/trip/[id]/index.tsx` | Replaces order-count tier sold map with `biz_trip_tickets_sold_by_tier` RPC data. |
| `mingla-business/src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts` | Tester-facing scaffold asserting dashboard reader canonical source wiring. |
| `mingla-business/src/utils/tripAdapter.ts` | Updates diff/audit field keys to canonical date/destination columns. |
| `Mingla_Artifacts/DECISION_LOG.md`, `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Records expanded canonical-column and partial-patch sibling-preservation contracts. |

## Spec Traceability

| Spec item | Result |
|---|---|
| New `events.destination_text` column + backfill + strip | Implemented in migration. |
| `biz_trip_tickets_sold_by_tier` RPC | Implemented and granted to authenticated. |
| `biz_update_live_trip` capacity/date/destination canonical routing | Implemented; residual `business_trip` patch keys deep-merge before parent theme merge. |
| `business_publish_trip_draft` destination write + JSONB strip | Implemented. |
| Service reader canonical start/end/destination | Implemented via `event_dates` query and `destination_text` field. |
| Dashboard tier-card sold counts via RPC | Implemented with React Query key `tripKeys.soldCountsByTier(eventId)`. |
| Strict-grep rebroadened | Implemented as `i-proposed-trip-canonical-columns`. |
| Regression tests | Deno expanded test added; Jest adversarial scaffold added. |
| Hard guards | No `supabase db push`; no edge deploy; no checkout/event-side RPC edits; no ORCH-0946/ORCH-0960 product-code edits. |

## Verification

| Gate | Result | Notes |
|---|---|---|
| Rebase | PASS | `git rebase origin/main --autostash`; conflicts resolved by keeping mainline comms/ledger additions and ORCH-0950 capacity additions. |
| Migration ordering | WARNING | Spec-required `20260725000002` is lower than already-applied/local `20260726000000`; apply must use `--include-all`. |
| Supabase migration list | PASS with local-only migration | No remote-only rows; `20260725000002` is local-only, `20260726000000` is local+remote. |
| Strict-grep canonical columns | PASS | `I-PROPOSED-TRIP-CANONICAL-COLUMNS: PASS files=1469 violations=0`. |
| Strict-grep self-test | PASS | 6/6. |
| ORCH-0863 backend allowlist | PASS | C1-C7 pass. |
| Deno expanded regression | PASS | 5/5 in `orch_0950_expanded_partial_patch_preserves_siblings.test.ts`. |
| Existing ORCH-0950 Deno regression | PASS | 6/6 in `orch_0950_trip_capacity_canonical.test.ts`. |
| Deno check | PASS | `deno check` on both ORCH-0950 Deno tests. |
| Jest focused suite | PASS | 3 suites, 11 tests: capacity guard, dashboard reader scaffold, `useTrips` key factory. |
| `git diff --check` | PASS | No whitespace errors. |
| Full `mingla-business` TypeScript | FAIL pre-existing | Red in checkout buyer files, ComposerV2, native payments package resolution, shared packages, and legacy DraftEvent test fixtures; no ORCH-0950 touched-file errors appeared in the output. |

## Live DB Probe

Read-only Supabase probe before applying the new migration:

```text
DC Adventure event_id=060d0483-50db-48d1-840b-73d9fc59356a
destination_text_column_exists=false
theme.business_trip={}
legacy destinationLocationText=NULL
event_dates start_at=2026-08-17 00:00:00+00
event_dates end_at=2026-08-22 23:59:59+00
ticket_type_id=d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e
quantity_total=102
sold_tickets=71
```

Scheduled/live trip invariant probe:

```text
scheduled_live_trip_count=3
scheduled_live_trips_without_one_master_date=0
trips_with_legacy_destination_to_backfill=2
trips_missing_legacy_destination_after_wipe=1
```

Interpretation: once the migration runs, DC Adventure will still have `events.destination_text = NULL` because the legacy source value is already absent. That is expected data loss; Seth re-enters the destination on the post-fix edit screen.

## Deploy Notes

Codex did not apply the migration and did not deploy edge functions. Because the spec-required migration filename is intentionally out-of-order relative to remote/local `20260726000000`, Seth must apply with `--include-all`:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]" && /Users/sethogieva/bin/supabase db push --linked --include-all
```

After that, orchestrator should verify with `mcp__supabase__list_migrations`, Seth should re-enter DC Adventure destination, and tester should run the mandatory iOS Sim + business-web + Android live-fire matrix.
