# IMPLEMENTATION — ORCH-0909 Collab Positional Shared Deck

**Status:** implemented, partially verified  
**Implementor:** Codex `implementor-mingla`  
**Date:** 2026-05-21  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Base commit during implementation:** `7e3fec45`  

## Scope Implemented

Implemented the ORCH-0909 positional shared-deck rewrite across DB migration, `discover-cards`, mobile deck fetch wiring, invite accept flow, No-GPS banner UX, regression tests, strict-grep CI jobs, and this report.

## Required Pre-Flight

PostGIS availability was verified before migration write via `mcp__supabase__list_extensions`: `postgis` is available with `default_version=3.3.7` and `installed_version=null`. The migration includes `CREATE EXTENSION IF NOT EXISTS postgis;`.

## Migration Filename Deviation

The binding spec requested `supabase/migrations/20260628000000_orch_0909_positional_shared_deck.sql`, but the live checkout already had `20260628000000_orch_0908_hotfix_calendar_trigger_dead_ref.sql` and later local migrations through `20260630000000_orch_0908_card_payload_flatten.sql`. To preserve Supabase monotonic migration safety, the implemented file is:

`supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql`

Operator should run the normal DB push after review; do not use MCP migration apply.

## Old → New Receipts

| File | Old | New |
|---|---|---|
| `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql` | No positional table, no participant cursor, union query with 50-circle cap | Adds PostGIS, `session_deck_cards`, `session_participants.current_position`, intersection query, no-GPS aggregation, atomic accept RPC, trigger preservation, single-shot cursor reset |
| `supabase/functions/discover-cards/index.ts` | Collab returned full version-pinned decks | Collab returns one positional card per `{ session_id, current_position }`, inserts with conflict handling, returns 410 for old collab payloads |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Version pinning state machine and deck-version query key | Server cursor-backed `currentPosition`, collab query key by position, collab pref refresh no longer runs old refresh machinery |
| `app-mobile/src/hooks/useDeckCards.ts` | Collab key used deck version | Collab key uses `currentPosition` |
| `app-mobile/src/services/deckService.ts` | Collab request sent retired version param | Collab request sends `current_position`, accepts single-card/dead-end response |
| `app-mobile/src/services/collaborationInviteService.ts` | Mark invite + participant upsert + prefs RPC as separate writes | Calls `accept_session_with_prefs` once, then preserves board activation/collaborator logic |
| `app-mobile/src/components/collab/NoGpsBanner.tsx` + `SwipeableCards.tsx` | No deck-level no-GPS banner | Renders required copy until user prefs gain `custom_lat/custom_lng` |
| `app-mobile/scripts/ci/orch-0909-*.mjs` and Deno tests | No ORCH-0909 regression gates | Adds 9 implementor checks + 8 adversarial checks |
| `app-mobile/package.json` | No npm wrappers for ORCH-0909 gates | Adds `test:orch-0909` and `test:orch-0909-adv` |
| `.github/workflows/strict-grep-mingla-business.yml` | No ORCH-0909 CI jobs | Registers ORCH-0909 regression + adversarial strict-grep jobs |

## Verification

Passed:

- `node app-mobile/scripts/ci/orch-0909-regression-check.mjs` — 9/9 PASS
- `node app-mobile/scripts/ci/orch-0909-adversarial-check.mjs` — 8/8 PASS
- `cd app-mobile && npm run test:orch-0909` — 9/9 PASS
- `cd app-mobile && npm run test:orch-0909-adv` — 8/8 PASS
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/discover-cards/index.ts` — PASS
- `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/discover-cards/__tests__/orch_0909_positional_shared_deck.test.ts supabase/functions/discover-cards/__tests__/orch_0909_adversarial.test.ts` — 17/17 PASS
- `git diff --check` on scoped files — PASS

Blocked / partial:

- `cd app-mobile && npx tsc --noEmit` fails on pre-existing repo errors outside ORCH-0909, including `LockedPlanBanner.tsx`, `BoardDiscussion.tsx`, `ConnectionsPage.tsx`, `nativeCheckoutFlow.ts`, and shared `packages/*` type-resolution errors. No reported errors pointed at the new ORCH-0909 files.
- No Supabase DB push was run, per hard guard.
- No edge function deploy was run, per hard guard.
- No simulator parity run was performed; next mandatory tester phase owns 2 iOS sim + Android emulator parity.

## Regression Test Receipts

Commit hash caveat: no scoped commit was created because the shared `Seth` checkout already contains many unrelated dirty/untracked ORCH-0908 and artifact changes. The tests below passed in the working tree over base commit `7e3fec45`; the exact fails-on-revert commit hash must be filled by CLOSE after staging only scoped ORCH-0909 files.

| Test | Gate | Result | Fails-on-revert receipt |
|---|---|---:|---|
| T-IMP-01 positional table | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-02 joiner frontier | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-03 intersection/no cap | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-04 live dead-end no row | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-05 atomic accept | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-06 no-GPS banner | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-07 single-shot reset | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-08 old pinning absent | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-IMP-09 old request param absent | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-01 concurrent race | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-02 replay cursor | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-03 late GPS resolution | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-04 51st participant | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-05 old client 410 | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-06 forbidden access | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-07 inactive place retention | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |
| T-ADV-08 live dead-end revival | Deno + Node | PASS | working tree over `7e3fec45`; commit pending |

## Deploy Notes

Operator next applies the migration with `supabase db push --linked`. After that succeeds, Codex `orchestrator-mingla` deploys `discover-cards` with the local Supabase CLI and verifies the edge-function version. Do not deploy before the DB migration is live because the edge function now depends on `session_deck_cards`, `session_participants.current_position`, and `query_servable_places_by_signal_intersection`.

## Risks / Follow-Ups

- The implementation intentionally uses the monotonic migration prefix `20260701000000`; reviewer should confirm this is accepted as a spec-safe filename correction.
- The edge path uses live dead-end retry semantics and does not advance the server cursor on dead-end. This preserves the investigation contract that the same dead-end position can later fill with a real card.
- `accept_session_with_prefs` suppresses the legacy participant-touch trigger via transaction-local `orch_0909.accept_with_prefs`, then lets the final participant_prefs update fire the full recompute once.
- Match quorum remains card-id based through existing `collabSaveCard` / board swipe helpers. If a future audit requires position-aware match rows, that is a follow-up schema/RPC change.
