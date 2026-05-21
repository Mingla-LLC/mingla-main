# IMPLEMENTATION — ORCH-0909 + ORCH-0906 Collab Positional Shared Deck + Single/Intent Interleave

**Status:** implemented, partially verified  
**Implementor:** Codex `implementor-mingla`  
**Date:** 2026-05-21  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Parent shipped commit:** `2a9478eda05fe8ab06465dbfd9db00d3eeda59b3`
**Parent fails-on-revert receipts commit:** `a4193f5c`
**Amendment bundle commit:** pending orchestrator CLOSE staging because the shared `Seth` checkout contains unrelated dirty ORCH-0908 / artifact work in files also touched by this amendment.

## Scope Implemented

Implemented the ORCH-0906 amendment on top of the already-shipped ORCH-0909 positional shared-deck rewrite.

| Layer | Implemented |
|---|---|
| DB | New monotonic migration `supabase/migrations/20260703000000_orch_0906_session_deck_cards_mixed_type.sql`; did not edit live `20260701000000_orch_0909_positional_shared_deck.sql`. Adds nullable `card_id`, `card_type`, `curated_payload`, `pill_label`, `degraded_from`, exact-payload CHECK, `session_curated_cache`, RLS, index, comments, schema reload. |
| Shared helper | New `supabase/functions/_shared/mixedTypeInterleave.ts` with deterministic odd=single/even=curated and independent per-pill round-robin. |
| Curated generator | `generate-curated-experiences` accepts `excludePlacePoolIds` and threads it through `generateCardsForType` into `fetchSinglesForSignalRank`; `signalRankFetch.ts` now honors optional `excludePlaceIds`. |
| Discover cards | `handleDeterministicV2` now decides type per position, restricts singles to the chosen category pill, invokes curated generation with caller JWT, persists curated rows as `curated_payload`, hydrates from row type, reads/writes `session_curated_cache`, and implements D7 graceful degrade with response flags. |
| Client | Deleted the stale “no curated parallel path / solo-only” comments in `app-mobile/src/services/deckService.ts`. Verified existing `SwipeableCards.tsx` routes `card.cardType === 'curated'` to `CuratedExperienceSwipeCard`; no renderer change needed. |
| CI/tests | Extended `test:orch-0909` to 11 checks and `test:orch-0909-adv` to 10 checks; added Deno helper tests and strict-grep resurrection gate `app-mobile/scripts/ci/orch-0906-no-resurrected-solo-only-comment-check.mjs`; registered the workflow job. |

## Locked Decisions Traceability

| Decision | Implementation |
|---|---|
| A1 strict 1:1 | `decideTypeAndPill`: odd positions single, even positions curated. |
| A2-i curated multi-stop only | Curated branch invokes `generate-curated-experiences`; no place-pool faux intent cards. |
| A3 strict per-pill rotation | Singles rotate over `agg.categories`; intents rotate over `agg.intents`; Deno test reproduces the D4 20-card example. |
| A4 F1 server-side merge | Merge is inside `discover-cards/handleDeterministicV2`; client still makes one collab deck call. |
| D7 graceful degrade | Curated exhaustion falls through to next single pill; single exhaustion falls through to next curated intent; full dead-end only when both sides cannot fill. Rows carry `degraded_from`; responses carry `degraded_from_intent` / `degraded_from_single`. |

## Migration Safety

Local chain confirms:

```text
20260701000000_orch_0909_positional_shared_deck.sql
20260702000000_orch_0908_chat_card_tags.sql
20260703000000_orch_0906_session_deck_cards_mixed_type.sql
```

Remote migration list confirms `20260703000000` is local-only and not yet pushed. Operator owns `supabase db push --linked`; no DB push was run by implementor.

## Verification

Passed:

- `cd app-mobile && npm run test:orch-0909` — 11/11 PASS.
- `cd app-mobile && npm run test:orch-0909-adv` — 10/10 PASS.
- `node app-mobile/scripts/ci/orch-0906-no-resurrected-solo-only-comment-check.mjs` — PASS.
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/discover-cards/index.ts` — PASS.
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/generate-curated-experiences/index.ts` — PASS.
- `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/discover-cards/__tests__/orch_0909_positional_shared_deck.test.ts supabase/functions/discover-cards/__tests__/orch_0909_adversarial.test.ts supabase/functions/discover-cards/__tests__/orch_0906_mixed_type_interleave.test.ts` — 23/23 assertions PASS (21 named ORCH-0909/0906 regression tests plus 2 pure-helper guard tests).
- `git diff --check` on scoped files — PASS.
- Strict grep for retired symbols/comments: zero matches for `pinnedDeckVersion`, `expected_deck_version`, `no curated parallel path`, `that pattern is solo-only` in the guarded files.

Not run:

- No `supabase db push --linked` per hard guard.
- No edge-function deploy per hard guard; downstream orchestrator deploys `discover-cards` and `generate-curated-experiences` after operator DB push.
- No simulator/Maestro live-fire; downstream tester owns SC-01..SC-18 across the named iOS/Android devices.
- No commit-level amendment fails-on-revert receipts yet. The working tree has unrelated dirty files, and `.github/workflows/strict-grep-mingla-business.yml` plus `generate-curated-experiences/index.ts` had pre-existing ORCH-0908 changes before this amendment. A safe scoped bundle commit/receipt pass belongs to orchestrator CLOSE after reviewing/staging hunks.

## Regression Test Receipts

Parent ORCH-0909 receipts are unchanged and remain valid: all 17 tests were fails-on-revert verified at `2a9478ed` with receipts recorded at `a4193f5c`.

| Test | Scope | Receipt |
|---|---|---|
| T-IMP-01..T-IMP-09 | ORCH-0909 parent | fails-on-revert verified at `2a9478ed` |
| T-ADV-01..T-ADV-08 | ORCH-0909 parent | fails-on-revert verified at `2a9478ed` |
| T-IMP-10 mixed deck payload | ORCH-0906 amendment | PASS in working tree; fails-on-revert pending bundle SHA |
| T-IMP-11 deterministic round-robin | ORCH-0906 amendment | PASS in working tree; fails-on-revert pending bundle SHA |
| T-ADV-09 graceful degrade | ORCH-0906 amendment | PASS in working tree; fails-on-revert pending bundle SHA |
| T-ADV-10 curated internal failure | ORCH-0906 amendment | PASS in working tree; fails-on-revert pending bundle SHA |

## Risks / Review Notes

- `generate-curated-experiences/index.ts` already contained an ORCH-0908 hotfix rewrite from `board_session_preferences` to `pg_aggregate_collab_prefs`; this implementation preserved it and added the ORCH-0906 exclude threading on top.
- `.github/workflows/strict-grep-mingla-business.yml` already contained an ORCH-0908 job in the working tree. This amendment adds the ORCH-0906 comment gate below the ORCH-0909 jobs; reviewer should stage only the intended bundle scope.
- D7 banner data is returned by the edge response. Existing mobile renderer support for curated cards is present; no new visible banner component was added in this implementation cycle because the amendment’s client section said no renderer change was expected.

## Deploy Notes

1. Operator runs `supabase db push --linked` for `20260703000000_orch_0906_session_deck_cards_mixed_type.sql`.
2. Orchestrator deploys both touched edge functions: `discover-cards` and `generate-curated-experiences`.
3. Tester runs SC-01..SC-18, including SC-14..SC-18 amendment coverage and the previously deferred D1 sim repro.
