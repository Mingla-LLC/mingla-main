---
id: ORCH-0700 Phase 1 implementation
type: IMPLEMENTATION REPORT
created: 2026-05-02
implementor: /mingla-implementor
mode: Path B (Phase 1 standalone — operator authorized 2026-05-02)
spec: Mingla_Artifacts/specs/SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md (§3.A.A1)
status: implemented, unverified (DB-side migration awaits operator apply via `supabase db push`)
phase_scope: 1 of 6 (signal v1.10.0 + flip + scorer re-run)
---

# 1. Layman summary

The Movies signal config has been authored at v1.10.0 with theatre weights stripped to zero. Once you apply this migration and re-run the signal scorer for `movies`, the Movies pill becomes cinemas-only. Theatre venues stop scoring above the 80-point gate. The deck will go thin/empty when local cinemas exhaust — that's the intent, not a bug. **No code edits this pass — pure DB migration.**

# 2. Status

- **Status:** implemented, unverified
- **Verification:** pending operator apply + scorer re-run
- **Files written:** 1 (SQL migration)
- **Files modified:** 0

# 3. Files changed

### `supabase/migrations/20260502000001_orch_0700_movies_signal_v1_10_0_cinemas_only.sql`

**What it did before:** N/A — new file.

**What it does now:** When applied via `supabase db push`:
1. INSERTs a new `signal_definition_versions` row with:
   - `signal_id = 'movies'`
   - `version_label = 'v1.10.0'`
   - `config` = v1.9.0 config with 5 theatre keys stripped from `field_weights`:
     - `types_includes_performing_arts_theater` (was +35)
     - `types_includes_concert_hall` (was +25)
     - `types_includes_opera_house` (was +25)
     - `types_includes_amphitheatre` (was +20)
     - `types_includes_auditorium` (was +18)
   - `notes` = full Path 1 reversal documentation citing operator decision 2026-05-02
2. Flips `signal_definitions.current_version_id` for `movies` to point at v1.10.0
3. Runs 4 inline DO-block safety checks before committing:
   - **Step 2:** v1.10.0 row exists post-INSERT (catches silent insert failure)
   - **Step 4:** current_version_id flip succeeded
   - **Step 5:** the 5 theatre keys are absent from new field_weights (strip succeeded)
   - **Step 6:** `movie_theater` + `drive_in` weights are present + positive (cinemas preserved)

If any check fails → migration aborts with `RAISE EXCEPTION` and rolls back the entire transaction. The DB returns to pre-migration state.

**Why:** Spec §3.A.A1 (Movies signal v1.10.0 cinemas-only). Path 1 reversal per operator decision 2026-05-02 ("Movies should only show movies even though the deck may be thin"). Reverses the v1.2.0+ deliberate theatre padding documented in v1.9.0 notes ("restore theatre padding for Martin Marietta/Raleigh Memorial/Burning Coal/A.J. Fletcher").

**Lines changed:** 130 lines (new file).

# 4. Spec traceability

| Spec section | Implementation status |
|--------------|----------------------|
| §3.A.A1.1 — Insert v1.10.0 inheriting v1.9.0 with theatre weights zeroed | ✅ Implemented (Step 1 of migration; jsonb `-` operator chain strips 5 keys) |
| §3.A.A1.2 — Flip current_version_id | ✅ Implemented (Step 3 of migration) |
| §3.A.A1.3 — Run signal-scorer post-migration | ⏸️ DEFERRED to operator (per implementor protocol — do not invoke edge functions directly; provided exact curl command in migration header comment) |
| §3.A.A1 — preserve everything else from v1.9.0 | ✅ Implemented (jsonb_set replaces only field_weights subkey set; cap, min_rating, scaling, text_patterns all inherit verbatim) |
| §3.A.A1 — Notes field documents reversal | ✅ Implemented (notes string includes ORCH ID + operator decision date + before-weights + after-state explanation) |

# 5. Invariant verification

| Invariant | Preserved? | How |
|-----------|-----------|-----|
| **I-RULES-VERSIONING-APPEND-ONLY** | ✅ Y | INSERT new row, no UPDATE on existing version. v1.9.0 stays intact in history. Only `signal_definitions.current_version_id` pointer flips. |
| **I-SIGNAL-CONTINUOUS** (score 0-200 numeric) | ✅ Y | `cap=200` and `clamp_min=0` inherit from v1.9.0 verbatim (only `field_weights` subkey modified) |
| **I-SCORE-NON-NEGATIVE** (clamps at 0) | ✅ Y | clamp_min=0 preserved |
| **Constitution #2 (one-owner-per-truth)** | ✅ Y | Movies signal has single canonical config; current_version_id is the single pointer |
| **Constitution #8 (subtract-before-adding)** | ✅ Y | The 5 theatre weights are SUBTRACTED from v1.9.0 to produce v1.10.0; nothing layered on top |
| **Constitution #9 (no-fabricated-data)** | ✅ Y | Theatre venues will honestly score below filter_min and disappear from Movies deck — no fabrication |

# 6. Parity check

**N/A** — backend SQL migration. Solo/collab modes both consume the same `signal_definitions` row through the same `query_servable_places_by_signal` RPC. No mode-specific code path.

# 7. Cache safety

**N/A** — DB-side change only. No React Query keys, no Zustand state, no AsyncStorage shape change.

After scorer re-run, `place_scores` rows for movies signal will have new scores. Mobile clients reading via `query_servable_places_by_signal` will see the new behavior on next deck fetch (no client-side cache invalidation needed — the data flows through the live RPC each time).

# 8. Regression surface (tester focus areas)

The following adjacent features should be smoke-tested after operator applies migration + runs scorer:

1. **Movies chip in Discover deck (T-04)** — primary verification: only cinema venues appear; deck goes thin/empty when cinemas exhaust
2. **Theatre chip in Discover deck (T-05)** — should be unchanged (theatre signal config wasn't touched)
3. **Curated experiences with movies/theatre stops** — should still work (the curated pipeline filters by signal score; theatre still scores fine on theatre signal; movies still scores fine on movies signal)
4. **Person-hero cards using `movies` or `theatre` intent** — should still work
5. **Other signal-driven chips** (brunch, casual_food, fine_dining, etc.) — should be completely unaffected (no other signal touched)

# 9. Constitutional compliance

| Principle | Touched? | Result |
|-----------|----------|--------|
| #1 No dead taps | No (DB only) | N/A |
| #2 One owner per truth | Yes | ✅ current_version_id is single pointer |
| #3 No silent failures | Yes | ✅ 4 inline DO-block RAISE EXCEPTION checks fail-fast |
| #4-7, #10-12, #14 | No | N/A |
| #8 Subtract before adding | Yes | ✅ theatre weights subtracted to produce v1.10.0 |
| #9 No fabricated data | Yes | ✅ honest empty deck on cinema exhaust |
| #13 Exclusion consistency | Yes | ✅ same scoring rules in scorer + serving (both read v1.10.0 via current_version_id) |

# 10. Operator action items

## Action 1 — Apply the migration

```bash
supabase db push
```

This applies `20260502000001_orch_0700_movies_signal_v1_10_0_cinemas_only.sql` to staging/production (whichever env your CLI is pointed at). The 4 inline DO-block checks will fail-fast if anything is amiss; on success, the entire transaction commits atomically.

## Action 2 — Re-run the signal scorer for `movies`

After the migration applies cleanly, invoke the signal scorer to repopulate `place_scores` against the new v1.10.0 config:

```bash
curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-signal-scorer" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"signal_id": "movies"}'
```

Expected duration: ~30-60 seconds for ~14,412 places.

## Action 3 — Run the verification probes

### Verification probe 1 — confirm v1.10.0 is current

```sql
SELECT sd.id AS signal, sdv.version_label AS current_version, sdv.created_at
FROM public.signal_definitions sd
JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
WHERE sd.id = 'movies';
```

Expected: 1 row, `version_label = 'v1.10.0'`, `created_at` ≈ now.

### Verification probe 2 — confirm theatre keys absent in v1.10.0 config

```sql
SELECT
  jsonb_object_keys(config->'field_weights') AS field_weight_key
FROM public.signal_definition_versions
WHERE signal_id = 'movies' AND version_label = 'v1.10.0'
ORDER BY field_weight_key;
```

Expected: returned key list does NOT include `types_includes_performing_arts_theater`, `types_includes_concert_hall`, `types_includes_opera_house`, `types_includes_amphitheatre`, `types_includes_auditorium`. SHOULD include `types_includes_movie_theater` and `types_includes_drive_in`.

### Verification probe 3 — primary success criterion (T-01 from spec)

```sql
SELECT pp.primary_type, COUNT(*) AS cnt, ROUND(AVG(ps.score)::numeric, 1) AS avg_score
FROM public.place_pool pp
JOIN public.place_scores ps ON ps.place_id = pp.id
WHERE pp.is_servable = true
  AND ps.signal_id = 'movies'
  AND ps.score >= 80
GROUP BY pp.primary_type
ORDER BY cnt DESC;
```

**Expected (post scorer re-run):** Only `movie_theater`, `drive_in`, and (rarely) NULL primary_type rows where `types[]` contains those values appear. **ZERO `performing_arts_theater`, `concert_hall`, `opera_house`, `amphitheatre`, `auditorium`.**

If theatre primary_types still appear with score ≥80 → scorer hasn't been re-run yet (Action 2). Re-run and re-probe.

### Verification probe 4 — Theatre chip unchanged (T-05 spec)

```sql
SELECT COUNT(*) AS theatre_above_filter_min
FROM public.place_pool pp
JOIN public.place_scores ps ON ps.place_id = pp.id
WHERE pp.is_servable = true
  AND ps.signal_id = 'theatre'
  AND ps.score >= 120;
```

**Expected:** count is approximately the same as pre-migration (theatre signal config wasn't touched). If it differs significantly → unexpected side effect; investigate.

## Action 4 — Manual smoke test in Discover deck

Open mobile app, tap Movies chip in Discover. Confirm:
- Only cinema-style venues appear (Alamo Drafthouse, Regal, AMC, drive-in cinemas, IMAX museums)
- ZERO performing_arts_theater venues, opera houses, concert halls, amphitheatres, auditoriums
- When local cinemas exhaust (typically ~7 in Raleigh-area), deck shows thin/empty state correctly (no fabrication)

Open Theatre chip — verify the same theatres that appeared yesterday still appear today (theatre signal unchanged).

# 11. Rollback procedure

If Verification probe 3 shows theatre venues STILL scoring ≥80 after scorer re-run, OR mobile smoke shows incorrect behavior, OR you want to revert for any other reason:

```sql
BEGIN;

-- Flip current_version_id back to v1.9.0
UPDATE public.signal_definitions
SET
  current_version_id = (
    SELECT id FROM public.signal_definition_versions
    WHERE signal_id = 'movies' AND version_label = 'v1.9.0'
  ),
  updated_at = now()
WHERE id = 'movies';

COMMIT;
```

Then re-run `run-signal-scorer` for `movies`. Theatre padding restored. v1.10.0 row stays in history (append-only invariant) for future reference.

# 12. Discoveries for orchestrator

**None.** This was a pure spec execution — the spec template was clear, the v1.9.0 config was readable in a single SQL probe, and no unexpected blockers surfaced.

# 13. Transition items

**None.** This phase is complete in itself; no `[TRANSITIONAL]` markers added.

# 14. Phases 2-6 status

NOT STARTED — awaiting operator authorization after Phase 1 is verified live.

When ready: dispatch `/mingla-implementor take over` with directive "Phase 2 onward, per spec §3.A.A2-A6 + §3.B-H" or similar. The implementor will:
- Read live `pg_proc.prosrc` for the 4 admin RPCs (per spec §3.A.A4 directive)
- Write 4 more SQL migrations (helper fn, rules SPLIT, RPC rewires, matview rebuild, column drop)
- Edit ~95 source files across backend / admin / mobile / i18n
- Coordinate the sunset cleanup commit (Phase 5) so it ships atomically

# 15. Confidence

- **Migration SQL correctness:** H (spec template followed verbatim; 4 inline safety checks; jsonb `-` operator is standard Postgres).
- **v1.10.0 produces cinemas-only behavior:** H (theatre venues max non-cinema score with no type weights = `rating_cap 35 + reviews_cap 25 = 60`, well below filter_min 80; verified arithmetically against v1.9.0 config inspected at spec-write time).
- **Migration applies without error:** M-H (cannot verify until operator runs `supabase db push`; the inline checks are safety nets, but DB connection / permission issues remain unverified).
- **Theatre chip unchanged:** H (no change to theatre signal config or current_version_id).
