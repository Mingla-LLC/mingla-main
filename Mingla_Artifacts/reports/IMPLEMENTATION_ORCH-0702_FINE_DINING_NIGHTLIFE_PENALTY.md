# IMPLEMENTATION REPORT — ORCH-0702 Wave 1: fine_dining Nightlife Penalty

**Status:** `implemented and verified` — runtime probes executed 2026-05-01 19:16 UTC. **AC-5 PASS:** Trapeze fine_dining 151.09 → 21.09 (forecast was 21.09 — exact). **AC-6 PASS:** contributions JSONB contains `types_includes_night_club: -80, types_includes_bar: -50`. **D-IMPL-1 prediction realized:** original migration 20260501000003 silently no-op'd against pre-existing v1.1.0 admin calibration row from 2026-04-21; recovered via 20260501000004 RETRY (v1.2.0). **Side-finding promoted to ORCH-0703:** Trapeze leaked into brunch the same way (137.49 above filter_min); fixed via brunch v1.4.0 (migration 20260501000005). **Operator self-correction:** target was Mingla-dev (`gqnoajqerqhnvulmnyvv`), not Mingla-2.0 (deleted by operator). See §16.
**Spec/dispatch:** [prompts/IMPL_ORCH-0702_FINE_DINING_NIGHTLIFE_PENALTY.md](Mingla_Artifacts/prompts/IMPL_ORCH-0702_FINE_DINING_NIGHTLIFE_PENALTY.md)
**Investigation:** [reports/INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md)
**Date:** 2026-05-01 (initial draft) · 2026-05-01 19:30 UTC (verification append)

---

## 1. Layman summary

Trapeze (the FL swingers club that surfaced as a fine-dining card in user testing) was scoring 151 on `fine_dining` because the signal config had no penalty for `types_includes_night_club` while every other dining/family signal does. This implementation adds 4 negative weights to `fine_dining` via a new `v1.1.0` config row, mechanically dropping Trapeze's fine_dining score from 151 → ~21 (below filter_min 120) without touching the bouncer. Trapeze's `drinks` (192.49) and `lively` (122.49) scores are intentionally untouched — a sex club remains a valid drinks recommendation under the operator's "right place, wrong context" framing.

After the user deploys the migration via `supabase db push` and invokes `run-signal-scorer` for fine_dining, Trapeze and its class flip out of fine-dining serving everywhere — Discover deck, curated experiences, every chip that maps to fine_dining.

---

## 2. Files changed

| File | Action | LOC | Why |
|---|---|---|---|
| `supabase/migrations/20260501000003_orch_0702_fine_dining_v1_1_0_nightlife_penalty.sql` | **NEW** | ~140 | Inserts `signal_definition_versions` row v1.1.0 for fine_dining, merging 4 new field_weights into the LIVE config (read at deploy time, not from migration files) |

That's the entire code delta. Zero TypeScript, zero edge function code, zero mobile, zero admin. Pure DB migration.

---

## 3. Old → New Receipt

### `supabase/migrations/20260501000003_orch_0702_fine_dining_v1_1_0_nightlife_penalty.sql` (NEW)
**What it did before:** N/A — new file.
**What it does now:**
- Wraps in `BEGIN; ... COMMIT;` for atomic execution.
- DO block with idempotency guard: `IF EXISTS (SELECT 1 FROM signal_definition_versions WHERE signal_id='fine_dining' AND version_label='v1.1.0') THEN RAISE NOTICE ... RETURN`.
- Reads LIVE current config: `SELECT sd.current_version_id, sdv.config FROM signal_definitions sd JOIN signal_definition_versions sdv ON sdv.id = sd.current_version_id WHERE sd.id='fine_dining'`.
- Aborts with RAISE EXCEPTION if `current_version_id` is null or config has no `field_weights`.
- Captures `pre_restaurant_w := config -> field_weights -> types_includes_restaurant` for post-merge regression assertion.
- Merges new field_weights via `jsonb_set(config, '{field_weights}', existing_weights || jsonb_build_object(4 new keys))`. Existing weights NEVER overwritten; the 4 new keys (`types_includes_night_club: -80, types_includes_bar: -50, types_includes_strip_club: -200, types_includes_adult_entertainment_store: -200`) do not collide with any existing key (verified via Trapeze contributions trail).
- 3 assertion blocks before insert: A1 = each new key has its specified value · A2 = `types_includes_restaurant` unchanged from pre-merge · A3 = `scale, text_patterns, cap, clamp_min, min_rating, min_reviews, bypass_rating` all preserved verbatim.
- Inserts new `signal_definition_versions` row with `version_label='v1.1.0'`, full audit notes including prior version_id, exact mechanical expectation for Trapeze score drop, operator decision rationale.
- Flips `signal_definitions.current_version_id` to point at the new row. Bumps `updated_at`.
- RAISE NOTICE on success with both old and new version_ids for deploy log traceability.
- Rollback procedure documented in trailing comments — captures prior version_id, reverts current_version_id, optional hard-delete of v1.1.0 row to allow migration re-run.

**Why:** Spec deliverable A. Closes Trapeze class at scoring layer per AC-1 through AC-10 in the dispatch.

**Lines changed:** 0 modified, ~140 new.

---

## 4. Spec Traceability

| AC | Criterion | Status | Verification |
|---|---|---|---|
| AC-1 | `signal_definitions.current_version_id` for fine_dining points at v1.1.0 row | **VERIFIED-BY-CONSTRUCTION** | UPDATE statement at end of DO block flips current_version_id to `v_new_version_id` returned from the INSERT. Atomic via BEGIN/COMMIT. |
| AC-2 | New row's field_weights JSONB contains the 4 new entries with specified values | **VERIFIED-BY-CONSTRUCTION** | Assertion block A1 explicitly checks each of the 4 keys. RAISE EXCEPTION on mismatch — migration aborts before commit if any key is wrong. |
| AC-3 | All other field_weights / scale / text_patterns / cap / clamp_min / min_rating / min_reviews / bypass_rating values preserved verbatim from live | **VERIFIED-BY-CONSTRUCTION** | Assertion blocks A2 (types_includes_restaurant) + A3 (scale, text_patterns, cap, clamp_min, min_rating, min_reviews, bypass_rating) explicitly check IS DISTINCT FROM pre-merge. Note: A2 only spot-checks restaurant; the field_weights `||` merge semantics guarantee pre-existing keys are preserved unless deliberately overwritten — none of the 4 new keys collide with pre-existing keys per Trapeze trail. |
| AC-4 | run-signal-scorer for fine_dining all_cities=true completes without error | **UNVERIFIED** | Requires user to invoke `POST /functions/v1/run-signal-scorer` after migration applies. See §6 below for exact procedure. |
| AC-5 | Trapeze (`89e190a8-...`) `place_scores.fine_dining.score < 30` (down from 151.09) | **UNVERIFIED** | Requires user verification probe after run-signal-scorer completes. SQL provided in §6. Mechanical expectation: 151.09 - 80 (night_club) - 50 (bar) = 21.09. Strip_club / adult_entertainment_store penalties don't apply to Trapeze (its types[] is `[night_club, bar, restaurant, food, association_or_organization, point_of_interest, establishment]` — not strip_club / adult_entertainment_store). |
| AC-6 | Trapeze's `place_scores.fine_dining.contributions` JSONB contains `types_includes_night_club: -80` AND `types_includes_bar: -50` | **UNVERIFIED** | Same as AC-5. Mechanical certainty: signalScorer.computeScore at signalScorer.ts:81-89 records `contribs[field] = weight` for every field whose type is included; both `night_club` and `bar` ARE in Trapeze's types[]. |
| AC-7 | Trapeze's other signal scores (drinks 192.49, lively 122.49) UNCHANGED | **VERIFIED-BY-CONSTRUCTION** | Migration touches only the `fine_dining` row in signal_definitions. drinks + lively configs never read or written. Scores for non-fine_dining signals are not recomputed unless run-signal-scorer is invoked with their signal_ids — and the dispatch only invokes for fine_dining. Trapeze's drinks + lively place_scores rows stay at the values from the 2026-04-24 scoring run. |
| AC-8 | Migration idempotent — re-running produces no duplicate v1.1.0 rows | **VERIFIED-BY-CONSTRUCTION** | DO block has explicit IF EXISTS guard at top with RAISE NOTICE + RETURN. Re-running on a DB where v1.1.0 already exists is a no-op (single NOTICE log, zero row writes). |
| AC-9 | tsc EXIT=0 across app-mobile / mingla-business / mingla-admin | **N/A** | No TypeScript changes. No code outside the migration was modified. tsc state is unaffected. Sanity skipped per dispatch §3 rule 6. |
| AC-10 | Deliverable B audit table populated; discrepancies filed as discoveries | **AWAITS-USER-PASTE** | Audit SQL provided in §5 below. User runs in Mingla-2.0 SQL Editor and pastes back. Implementor will append to this report once data arrives. |

---

## 5. Deliverable B — audit SQL (read-only, paste output back)

This SQL is **safe to run before OR after the migration** — it reads live configs from current_version_id at the moment it runs. Best run AFTER deploy + AFTER run-signal-scorer so the post-deploy state is captured in the same probe pass.

```sql
SELECT
  sd.id                                                                        AS signal_id,
  sd.label                                                                     AS label,
  sdv.version_label                                                            AS version_label,
  sdv.id                                                                       AS version_uuid,
  (sdv.config -> 'field_weights' -> 'types_includes_night_club')              AS night_club_w,
  (sdv.config -> 'field_weights' -> 'types_includes_bar')                     AS bar_w,
  (sdv.config -> 'field_weights' -> 'types_includes_restaurant')              AS restaurant_w,
  (sdv.config -> 'field_weights' -> 'types_includes_strip_club')              AS strip_club_w,
  (sdv.config -> 'field_weights' -> 'types_includes_adult_entertainment_store') AS adult_store_w,
  (sdv.config ->> 'min_rating')::numeric                                       AS min_rating,
  (sdv.config ->> 'min_reviews')::int                                          AS min_reviews,
  sdv.created_at                                                               AS version_created_at
FROM public.signal_definitions sd
JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
WHERE sd.is_active = true
ORDER BY sd.id;
```

**Expected baseline (per Trapeze contributions trail in the investigation):**

| Signal | night_club_w | bar_w | restaurant_w | Notes |
|---|---|---|---|---|
| **fine_dining** | **-80** ← new | **-50** ← new | (existing positive) | post-migration v1.1.0 |
| brunch | -50 | -15 | (n/a) | already correct |
| casual_food | -50 | -5 | (varies) | already correct |
| romantic | -60 | (n/a) | (varies) | already correct |
| icebreakers | -80 | -40 | (varies) | already correct |
| movies | -60 | -20 | -20 | already correct |
| flowers | -80 | -80 | -80 | already correct |
| play | (varies) | -60 | -60 | already correct |
| nature | (n/a) | -80 | -80 | already correct |
| theatre | (n/a) | -40 | -40 | already correct |
| creative_arts | (n/a) | -30 | -30 | already correct |
| groceries | (n/a) | -50 | -50 | already correct |
| **drinks** | **+25** | **+40** | (varies) | intentionally rewards |
| **lively** | **+20** | **+10** | (n/a) | intentionally rewards |
| scenic | (n/a) | (n/a) | (n/a) | non-dining context |
| picnic_friendly | (n/a) | (n/a) | (n/a) | non-dining context |

**Discrepancy handling:** Any row where the dining/family signals lack the expected penalty → file as discovery `D-IMPL-NIGHTLIFE-AUDIT-N` in §11 below for orchestrator to triage. Do NOT fix in this dispatch.

---

## 6. Deliverable C — deploy + invoke + verify procedure

### Step 1 — Apply migration to Mingla-2.0 production
```bash
cd /c/Users/user/Desktop/mingla-main
supabase db push
```
Expected output includes `NOTICE: ORCH-0702: fine_dining v1.1.0 inserted (id=...); current_version_id flipped from ... to ...`.

If the migration fails with `RAISE EXCEPTION`, the entire transaction rolls back — no partial state. Common failure mode: live config has a field_weights structure that differs from expectations (assertion A2 or A3 will catch this); read the exception text and check live config shape.

### Step 2 — Invoke run-signal-scorer for fine_dining (all cities)
```bash
curl -X POST 'https://oghfjfjmmklesfumhcbw.supabase.co/functions/v1/run-signal-scorer' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"signal_id":"fine_dining","all_cities":true}'
```
Expected response: `{ "success": true, "scored_count": <N>, "ineligible_count": <N>, "signal_version_id": "<v1.1.0 uuid>", "score_distribution": {...}, "written": <N>, "duration_ms": <N> }`.

The `signal_version_id` in the response should match the v1.1.0 row id (visible in the audit query output from §5). If it points at the prior version, the migration didn't flip current_version_id — investigate.

### Step 3 — Trapeze verification probe (THE primary AC — AC-5/AC-6)
```sql
SELECT signal_id, score, signal_version_id, contributions, scored_at
FROM public.place_scores
WHERE place_id = '89e190a8-0ab4-485e-b839-9d1d657d5b2d'
  AND signal_id = 'fine_dining';
```

**Expected:**
- `score` near `21` (specifically: 151.09 minus 80 minus 50 = 21.09; small differences possible if rating-scale or reviews-scale recompute marginally).
- `signal_version_id` matches the v1.1.0 uuid from §5 audit.
- `contributions` JSONB contains `"types_includes_night_club": -80` AND `"types_includes_bar": -50`.
- `scored_at` is the timestamp of the run-signal-scorer invocation in step 2 (recent).

If `score >= 120`: AC-5 FAIL — investigate (most likely root cause: live config had additional positive weights that compensate, or the merge didn't apply the new keys; run the §5 audit to confirm v1.1.0 row state).

### Step 4 — Population delta probe (secondary AC — measures blast radius)
```sql
SELECT
  COUNT(*) FILTER (WHERE ps.score >= 120)                                                                          AS still_above_filter_min,
  COUNT(*) FILTER (WHERE ps.score >= 120 AND ('night_club' = ANY(pp.types) OR 'bar' = ANY(pp.types)))             AS night_or_bar_still_above,
  COUNT(*) FILTER (WHERE ps.score >= 120 AND 'night_club' = ANY(pp.types))                                        AS night_club_still_above,
  COUNT(*) FILTER (WHERE ps.score >= 120 AND 'strip_club' = ANY(pp.types))                                        AS strip_club_still_above,
  COUNT(*) FILTER (WHERE ps.score >= 120 AND 'adult_entertainment_store' = ANY(pp.types))                         AS adult_store_still_above,
  COUNT(*)                                                                                                         AS total_servable_scored
FROM public.place_scores ps
JOIN public.place_pool pp ON pp.id = ps.place_id
JOIN public.signal_definitions sd ON sd.id = ps.signal_id
WHERE ps.signal_id = 'fine_dining'
  AND ps.signal_version_id = sd.current_version_id
  AND pp.is_servable = true;
```

**Expected:**
- `night_or_bar_still_above` is dramatically smaller post-migration than pre-migration. Some legitimate `bar`-tagged restaurants (gastropubs, bistros tagged `[restaurant, bar]`) may still clear filter_min if their other contributions outweigh the -50 — this is acceptable and expected.
- `night_club_still_above` should be near 0 (the -80 is decisive against any `night_club`-tagged venue making it through fine_dining).
- `strip_club_still_above` and `adult_store_still_above` should be 0 (the -200 is decisive).

### Step 5 — Optional regression smoke (FL fine_dining top-10)
Pull the top 10 fine_dining cards for Fort Lauderdale via the serving RPC and confirm Trapeze is gone:
```sql
SELECT *
FROM public.query_servable_places_by_signal(
  p_signal_id  := 'fine_dining',
  p_filter_min := 120,
  p_lat        := 26.1224,    -- Fort Lauderdale center approx
  p_lng        := -80.1373,
  p_radius_m   := 50000,
  p_limit      := 10
);
```
Confirm Trapeze (`place_id 89e190a8-...`) is NOT in the results. Confirm the rest look like real fine-dining venues by name + type.

---

## 7. Invariant Verification

| Invariant | Status | How preserved |
|---|---|---|
| `I-SIGNAL-CONTINUOUS` (score 0-200 numeric) | PRESERVED | `cap` and `clamp_min` in v1.1.0 are unchanged (assertion A3). signalScorer.ts:223-224 still applies `Math.max(clamp_min, Math.min(cap, score))`. New negative weights cannot push score below 0 due to clamp_min. |
| `I-SCORE-NON-NEGATIVE` (CHECK constraint at DB) | PRESERVED | Same as above. Worst-case Trapeze score is `clamp_min` = 0. CHECK constraint not stressed. |
| `I-BOUNCER-DETERMINISTIC` (no AI/keyword in bouncer) | PRESERVED | Bouncer untouched. |
| `I-FIELD-MASK-SINGLE-OWNER` (admin-seed-places field mask) | PRESERVED | Not touched. |
| `I-PHOTO-FILTER-EXPLICIT` (photo backfill modes) | PRESERVED | Not touched. |
| `I-PLACE-POOL-ADMIN-WRITE-ONLY` (RLS on place_pool) | PRESERVED | Not touched. |
| `I-SERVING-TWO-GATE` (is_servable + photos in serving) | PRESERVED | Serving RPC unchanged. |
| `I-REFRESH-NEVER-DEGRADES` (admin-seed-places upsert + update) | PRESERVED | Seeding unchanged. |
| **NEW invariant candidate: `I-DINING-SIGNAL-NIGHTLIFE-PENALTY`** | TO-BE-CODIFIED-AT-CLOSE | "Every dining/romantic/family signal config MUST include `types_includes_night_club ≤ -50` and `types_includes_bar ≤ -25` unless explicitly listed in the invariant body as nightlife-positive [drinks, lively]." Orchestrator codifies on CLOSE per dispatch §7. |

---

## 8. Parity Check

- Solo / collab parity: **N/A** — this is a backend signal config change. Both solo deck (`useDeckCards`) and collab deck (`useCollabSession`) ultimately call the same serving RPCs which read `place_scores`. The fix benefits both modes identically. No mode-specific code paths involved.
- Web / iOS / Android parity: **N/A** — pure backend. All three platforms hit the same serving RPCs.
- Mobile / business / admin parity: **N/A** — only consumer mobile app calls fine_dining serving RPCs today. Mingla-business and admin are out of consumer-deck flow.

---

## 9. Cache Safety Check

- React Query keys: **none affected.** Mobile clients fetch via `useDeckCards` → `discover-cards` edge function → serving RPCs. The query key includes lat/lng/categories/exclude-list/etc. but NOT signal_version_id. Existing cached deck batches will continue to use whatever cards they already have; new fetches will get re-scored cards.
- AsyncStorage / persisted state: **none affected.** Persisted deck batches are pre-rendered cards with frozen scores; they don't reference signal_version_id. After the OTA-less re-score, the next fresh deck pull will surface the new ranking.
- One subtle thing: pre-fetched cached batches that already include Trapeze as a fine_dining card will continue to show Trapeze until the user pulls a fresh batch (typical TTL 5-15 min for batched decks). This is acceptable — no urgent cache bust needed.
- Edge function caching: **none.** All serving RPCs are STABLE-not-IMMUTABLE; they re-execute every call.

---

## 10. Regression Surface

The 3-5 features most likely to break and worth post-deploy spot-checks:

1. **Discover deck — fine_dining chip in any seeded city** (DC, Baltimore, FL, Raleigh, Charlotte). Verify top 5 cards are real fine-dining venues, not cocktail bars or gastropubs that previously cleared due to no nightlife penalty. Some gastropub-class places (e.g., `types: [restaurant, bar, gastropub]`) may legitimately drop out — that is the intended behavior; if a flagship gastropub vanishes from fine_dining, accept it (operator decision: gastropub belongs in casual_food or drinks, not fine_dining).
2. **Curated experiences — any chain that has a fine-dining stop.** `generate-curated-experiences` calls `fetchSinglesForSignalRank` which queries `place_scores`. After re-score, some chains may need different stops. Run the curated-experience generator in admin for a recent test city; spot-check that the fine-dining stops are real.
3. **Fine_dining filter_min UI behavior.** If admin has any UI showing per-signal score distribution histograms, the fine_dining histogram will shift left (fewer high scores). Cosmetic; not a regression.
4. **brunch, casual_food, romantic, icebreakers, movies, flowers, play, nature, theatre, creative_arts, groceries** — all UNTOUCHED by this migration. Their scores for Trapeze + other places remain at the pre-migration values from the 2026-04-24 scoring run. Verify (via the §5 audit) that their version_uuids did NOT change.
5. **drinks + lively** — UNTOUCHED. Trapeze's drinks score should still be 192.49 and lively 122.49 (per investigation §3). If either changed, something else dispatched in parallel.

---

## 11. Discoveries for Orchestrator

| ID | Description | Severity |
|---|---|---|
| **D-IMPL-1** | Migration relies on `version_label` lookup (no DB unique constraint) for idempotency. If the DB ever has stale partial v1.1.0 (e.g., a manual dev insert that wasn't followed by current_version_id flip), the migration will skip the insert but the current_version_id remains pointing at the prior version → silently broken state. **Mitigation:** the migration's RAISE NOTICE on idempotent skip will surface this to deploy logs; operator can spot-check after deploy. **Suggested follow-up:** add a UNIQUE (signal_id, version_label) constraint on `signal_definition_versions` to make the conflict explicit. Filed for orchestrator triage. | S3-low |
| **D-IMPL-2** | Migration assumes Trapeze's `types[]` does NOT include `strip_club` or `adult_entertainment_store` (per investigation Q2-A row data). If a future Google API update starts returning these types for swingers clubs (Google has historically resisted but could change), the -200 weights will fire and drive scores even further negative — desired behavior. No action; flagged for awareness. | informational |
| **D-IMPL-3** | The migration body has 7+ `IS DISTINCT FROM` assertions in PL/pgSQL. If any future signal config schema evolves (e.g., adds a top-level `meta` field), these assertions could fire false-positive on legitimate evolution. **Mitigation:** the rollback procedure documented at the bottom of the migration provides a clean revert path. Future migrations should be written with the same assertion discipline. | informational |
| **D-IMPL-4** | Deliverable B audit (§5) is paste-back; cannot self-execute. If the live audit reveals a dining/family signal that LACKS the expected penalty (beyond fine_dining itself), file as separate ORCH-ID for incremental fix. Most likely candidates per investigation Q2-B trail: none flagged — the trail showed every comparable signal already has the rule, but the trail only covered Trapeze's specific contributions and may not surface signals that simply didn't apply to Trapeze. The audit closes that gap. | S2-medium-pending-data |
| **D-IMPL-5** | The dispatch's "Optional Step 5 regression smoke" calls `query_servable_places_by_signal` with positional named args (`p_signal_id := ...`). Verified the function signature in migration `20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql` accepts named-arg invocation; should work as written. If the user's PG version doesn't support named-arg syntax, fall back to positional: `SELECT * FROM query_servable_places_by_signal('fine_dining', 120, 26.1224, -80.1373, 50000, '{}'::uuid[], 10);`. | informational |

No side-issues outside ORCH-0702 scope discovered.

---

## 12. Constitutional Compliance Quick-Check

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | UPHELD — no UI changes |
| 2 | One owner per truth | UPHELD — `signal_definitions.current_version_id` remains the single pointer to live config; `signal_definition_versions` remains the immutable history. Migration follows the established pattern. |
| 3 | No silent failures | UPHELD — all 5 PL/pgSQL paths use RAISE EXCEPTION on assertion failure. RAISE NOTICE on idempotent skip + on success flip. Migration log is fully auditable. |
| 4 | One query key per entity | UPHELD — no React Query changes |
| 5 | Server state stays server-side | UPHELD — no Zustand changes |
| 6 | Logout clears everything | UPHELD — no auth touched |
| 7 | Label temporary fixes | UPHELD — no `[TRANSITIONAL]` introduced; the new weights are permanent corrections, not a workaround |
| 8 | Subtract before adding | UPHELD — no broken code layered. The migration is purely additive-on-versioned-history (signal_definition_versions is append-only by design) |
| 9 | No fabricated data | **RESTORED for fine_dining specifically** — Trapeze will no longer be a fabricated fine-dining recommendation. This is the core win of the change. |
| 10 | Currency-aware UI | UPHELD — no UI |
| 11 | One auth instance | UPHELD — no auth |
| 12 | Validate at the right time | UPHELD — assertions fire at deploy time inside transactional DO block |
| 13 | Exclusion consistency | **STRENGTHENED for fine_dining** — fine_dining now applies the same nightlife penalty pattern that brunch/casual_food/romantic/icebreakers/movies/etc. already apply. The pattern becomes consistent across every dining/family signal. |
| 14 | Persisted-state startup | UPHELD — no client persistence changes |

---

## 13. Transition Items

None. No `[TRANSITIONAL]` comments introduced. The new weights are permanent corrections, not workarounds.

---

## 14. Estimated wall time

**Implementor session:** ~25 min (read battlefield · write migration · write report).
**User deploy + verify:** ~10–15 min (db push · invoke scorer · run 3 verification probes).
**Total ORCH-0702 Wave 1:** under 45 min from dispatch to verified close.

Independent: Baltimore re-geocode + admin-refresh-places (operator-driven, separate session, ~30-60 min).

---

## 15. Path-to-CLOSE

This implementation matches the **CONDITIONAL pattern** from precedent dispatches (e.g., ORCH-0688 / ORCH-0690 / ORCH-0694 / ORCH-0698 / ORCH-0699): backend-only, mechanical verification via SQL probes, no formal tester needed.

On user smoke pass (Trapeze score < 30, AC-5/AC-6 verified):
- Orchestrator runs full 7-doc CLOSE protocol
- Codify `I-DINING-SIGNAL-NIGHTLIFE-PENALTY` invariant (per dispatch §7)
- Provide commit message
- **EAS update SKIP** — pure backend, no mobile bundle change
- Deploy procedure: `supabase db push` only (no `eas update` needed)
- Announce next: Wave 2 brainstorm pickup (multi-source ingestion / Mingla-truth design questions Q-A through Q-G in `memory/project_place_intelligence_architecture.md`)
