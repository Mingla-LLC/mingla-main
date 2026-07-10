# INVESTIGATION — ORCH-1331: "Run scorer for a whole city" reports complete but persists ~0 place_scores rows (New York + Paris)

- **Phase:** INVESTIGATE (no fix proposed)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1331-[signal-scoring-city-run]/` on branch `ORCH-1331-signal-scoring-city-run` (rebased onto `origin/main` @ 898e403aa)
- **Date:** 2026-07-10 (investigation run 05:34–05:45 UTC)
- **DB:** Supabase prod `gqnoajqerqhnvulmnyvv` (read-only SQL + read-only edge-fn source fetch)
- **Comms ledger:** read on entry; no `BLOCK`/`WARN` row is addressed to `mingla-forensics`, `ORCH-1331`, or `ALL` that requires action this turn (COMMS-0087 is a RESOLVED CI-pin FYI).

---

## 1. Layman outcome (what Seth experiences and the proven cause)

When Seth clicks "Run scorer" for New York or Paris, the button finishes and looks done, but **not a single new place gets scored** — those two cities are stuck at 35 and 15 scored places out of 9,903 and 4,464 that are ready to score. The scoring run is **failing on the server before it saves anything**, and the only thing keeping those cities on life-support is a slow 15-minute background job that adds ~2–3 places per city every 10 days — so it will effectively never catch up. Cities that were scored **before 2026-05-30** (London, Washington, Brussels, Raleigh) are fine because they were filled by the old, cheap version of the scorer; New York and Paris only became scorable **after** that date and have never had a working bulk run.

**PROVEN:** the manual city run persists 0 rows and the cities cannot be filled by the current path.
**SUSPECTED (needs one re-run with a diag line to seal):** the exact server-side failure locus is the post-2026-05-30 AI-blend read/compute path exceeding the edge function's resource budget at large-city scale, terminating the run before its UPSERT.

---

## 2. Symptom summary (expected vs actual)

| | Expected | Actual |
|---|---|---|
| Admin clicks "Run scorer for New York" | ~9,903 `place_scores` rows written for that signal (or `scored_count` reported) | Button completes; `place_scores` coverage stays at **35 distinct places / 411 rows** |
| Admin clicks "Run scorer for Paris" | ~4,464 rows written | Stays at **15 distinct places / 176 rows** |
| DB after the run | distinct scored places jumps toward servable count | **Zero** new NY/Paris rows in the 05:10–05:29 UTC window around Seth's 05:15–05:17 runs |

Reproduced live twice by Seth (2026-07-10 ~05:15–05:17 UTC).

---

## 3. Investigation manifest (files read, in trace order)

1. `supabase/functions/run-signal-scorer/index.ts` — city-mode paging loop (L242–269), sticky pre-read (L295–341), UPSERT (L343–374), success/log line (L397–404). **Verified byte-identical to the DEPLOYED v268 source** via `mcp__supabase__get_edge_function` (`ezbr_sha256 1405b6c0…`).
2. `supabase/functions/_shared/signalScorer.ts` — `computeScore` (rating/reviews gate → score 0 written; AI blend/veto).
3. `supabase/functions/_shared/stickyOverride.ts` — `isAdminOverridden` marker predicate.
4. `mingla-admin/src/pages/SignalLibraryPage.jsx` — `RunScorerButton`, `ScoreAllSignalsButton`, `TopPlacesPreview`, `CityPipelineHistory`, city pickers.
5. `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql` — 15-min rescore cron (`tg_meta_orch_1009_sub_d_kick_rescores`, per-place mode, 500 pairs/tick global).
6. Git history of `run-signal-scorer/index.ts` (Sub-B/Sub-D/ORCH-1066 landing dates).
7. Prod DB: coverage, timing, EXPLAIN ANALYZE, constraints, AI-entry shape, city_id uniqueness (queries pasted below).

---

## 4. Q-scorecard

- **Q1 — Did Seth's manual city runs persist any NY/Paris rows?**
  **Verdict: NO — PROVEN.** Zero rows written in 05:10–05:29 UTC (empty result). Coverage unchanged (NY 35, Paris 15). The only NY/Paris writes in the last 3h were the 05:30 cron tick (2 NY + 3 Paris places).

- **Q2 — Is the city_id the admin passes wrong / mismatched to `place_pool.city_id`?**
  **Verdict: NO — RULED OUT.** Exactly one "New York" (`72cd3c91…`, 9,903 servable / 35 scored) and one "Paris" (`13d9113a…`, 4,464 / 15). All 9,903 NY servable rows carry that single city_id. `TopPlacesPreview` and the scorer both consume the SAME `selectedCityId`; the preview rendering 35 NY rows proves that id equals `place_pool.city_id`.

- **Q3 — Is it a scale / timeout of NY specifically?**
  **Verdict: NO to "NY-scale" — RULED OUT by London.** **London has 10,706 servable → 10,706 scored (100%)** — LARGER than NY and fully covered. First-page read 353ms; deep page (OFFSET 9400) 69ms; no DB statement timeout at 05:15–05:17. So a naive size/DB-timeout theory is dead.

- **Q4 — Is the failure "all AI-vetoed" or a bad AI-entry shape?**
  **Verdict: NO — RULED OUT.** For signal `lively`: NY 9,835 v4 entries (109 inappropriate=true, **9,726 false**); Paris 4,438 (76 true, **4,362 false**); London 10,656 (148 true, 10,508 false). NY/Paris shapes are essentially identical to London's; the vast majority are `inappropriate_for=false` → they blend-and-write, not veto.

- **Q5 — What actually distinguishes NY/Paris from the covered cities?**
  **Verdict: TIMING — PROVEN correlation.** Covered cities were first scored **2026-04-21…04-25** (before the AI-blend heavy path). **NY/Paris first appear in `place_scores` 2026-06-03**, after Sub-B (2026-05-30) added the per-row `ai_signal_scores` read + blend. They never got a cheap pre-Sub-B bulk score and became servable into the heavy path.

- **Q6 — Could the run have returned a clean HTTP-200 "success" with 0 writes?**
  **Verdict: NO — the run FAILED (non-2xx). PROVEN by elimination.** A 200-success with `written=0` requires `writes.length==0`, which requires either 0 rows read (ruled out, Q2) or all-veto (ruled out, Q4). There are also no partial writes (DB shows 0, not N×500). Therefore the run terminated server-side **before the first UPSERT batch committed.** ("Complete" is Seth's UI perception — see defect A.)

- **Q7 — Is the 15-min cron advancing the backlog?**
  **Verdict: NO — PROVEN.** NY gained **2** distinct scored places on 2026-07-10 and **1** on 2026-07-04 (≈3 in 10 days); Paris +3 in 10 days. At that rate the 9,903 / 4,464 backlog is never filled. The cron is a refresh trickle (500 pairs/tick GLOBAL, per-place mode), not a backfill.

- **Q8 — Where exactly does the server-side failure occur, and why?**
  **Verdict: SUSPECTED (leading), needs runtime seal.** Highest-probability locus: the post-Sub-B AI-blend read/parse (heavy `ai_signal_scores`+`reviews` JSONB per row) + compute for a large previously-unscored city exceeds the edge function's resource budget (CPU soft limit / wall), terminating the isolate before the post-loop UPSERT. Could not be sealed because (a) `console.log scored=/written=` is not exposed by MCP `get_logs`, and (b) `verify_jwt:true` blocks a `dry_run` without an admin JWT.

---

## 5. Findings (six-field evidence)

### F-1 — Manual city-mode run persists ZERO NY/Paris rows (the symptom, proven). CONFIRMED ROOT-CAUSE SURFACE.
- **Symptom:** Coverage unchanged after Seth's runs; "Scored" count doesn't move.
- **Layer:** Data / Runtime.
- **Probe:**
  ```sql
  SELECT ps.scored_at, pp.city_id, ps.signal_id, ps.place_id
  FROM place_scores ps JOIN place_pool pp ON pp.id=ps.place_id
  WHERE pp.city_id IN ('72cd3c91-7a32-470b-8e59-a57af654d07f','13d9113a-4796-499e-9544-ae4d17c678db')
    AND ps.scored_at >= '2026-07-10 05:10:00+00' AND ps.scored_at < '2026-07-10 05:29:00+00';
  ```
- **Evidence:** `[]` (empty). Full-table: NY 411 rows / 35 distinct places; Paris 176 / 15. Only writes in last 3h were `2026-07-10 05:30` (NY 2 places, Paris 3) = the :30 cron tick.
- **Mechanism:** Seth's 05:15–05:17 manual runs wrote nothing → cities remain unscored regardless of UI toast.
- **Severity:** CONFIRMED (this is the proven outcome).

### F-2 — The failure is city-DATA-vintage-specific, not scale: London (10,706, larger) is 100%; NY/Paris ~0%. CONFIRMED ROOT CAUSE (locus).
- **Symptom:** Coverage cliff isolated to NY + Paris.
- **Layer:** Data.
- **Probe:** per-city servable vs distinct-scored, ordered by servable desc (see §7 SQL).
- **Evidence:**
  ```
  London     10,706 servable → 10,706 scored (100.0%)
  New York    9,903          →     35        (0.4%)
  Paris       4,464          →     15        (0.3%)
  Washington  2,298          →  2,298        (100%)
  Brussels    1,858          →  1,858        (100%)
  Raleigh     1,540          →  1,533        (99.5%)
  Baltimore/Fort Lauderdale/Lagos/Cary/Durham … all 99–100%
  ```
- **Mechanism:** If this were size/CPU/DB-timeout by absolute scale, London (biggest) would fail worst — it is perfect. So coverage tracks *when* a city was first bulk-scored, not its size.
- **Severity:** CONFIRMED ROOT CAUSE (rules out the scale/timeout theory; isolates the real axis = vintage).

### F-3 — Temporal regression boundary = Sub-B (2026-05-30). CONFIRMED ROOT CAUSE (mechanism axis).
- **Symptom:** Covered cities predate 05-30; NY/Paris postdate it.
- **Layer:** Code (git) × Data (scored_at).
- **Probe:** `git log -S "ai_signal_scores" -- supabase/functions/run-signal-scorer/index.ts`; per-city min(scored_at).
- **Evidence:**
  - Sub-B (added heavy per-row `ai_signal_scores` read + blend to the scorer) = **2026-05-30** (commit `81cf0325c` / Sub-D `6374a27c6`). ORCH-1066 sticky pre-read = **2026-06-03** (`4385f57d4`).
  - first_scored: London 2026-04-24, Washington 04-25, Brussels 04-22, Raleigh 04-21 (**all pre-Sub-B**); **New York 2026-06-03, Paris 2026-06-03** (**post-Sub-B**).
- **Mechanism:** Cities filled before 05-30 got the cheap rule-only scorer and retain coverage (cron refreshes in place). NY/Paris only ever faced the post-05-30 heavy AI-blend path and have never persisted a bulk run.
- **Severity:** CONFIRMED ROOT CAUSE (the axis that separates working vs broken).

### F-4 — The run FAILS before its UPSERT (not a clean success). SECONDARY ROOT CAUSE (failure mode).
- **Symptom:** 0 writes yet Seth reports "complete."
- **Layer:** Code × Runtime (by elimination).
- **Probe:** code path analysis + Q2/Q4/Q6 eliminations + Postgres logs at 05:15–05:17.
- **Evidence:** In `index.ts`, `written` at the success return equals `writes.length` (minus admin-protected). `writes.length==0` requires 0-rows-read (ruled out: city_id `72cd3c91…` matches 9,903 in SQL) or all-veto (ruled out: 9,726 `inappropriate_for=false`). No partial writes exist (0, not N×500). Postgres logs show **no** statement-timeout/error at 05:15–05:17 (the lone timeout at ~05:42 + `make_interval`/`country_name` errors are unrelated other-session noise). Reads are fast (353ms first page; 69ms deep page).
- **Mechanism:** The run reads (some/all) rows, then terminates in the edge isolate before completing the first `place_scores` UPSERT batch → 0 persisted. Since the DB reads don't time out, the termination is edge-side.
- **Severity:** SECONDARY ROOT CAUSE.

### F-5 — Leading termination cause: post-Sub-B heavy read/compute exceeds edge resource budget at large-city scale. SUSPECTED CONTRIBUTOR (needs seal).
- **Symptom:** Large post-Sub-B cities (Paris 4,464, NY 9,903) fail; Washington (2,298) and smaller succeeded (pre-Sub-B, but also under any budget); London would also fail a fresh run today but doesn't need one.
- **Layer:** Runtime (edge isolate) — NOT DB.
- **Probe:** `SELECT_FIELDS` now includes `reviews` + `ai_signal_scores`; payload weight query; edge CPU limit reasoning.
- **Evidence:** NY servable rows: `avg_ai_bytes 1765` (max 2407), `avg_reviews_bytes 3252` (max 10458), `avg ai_signal_scores text length 4793`. A single-signal NY run streams ~9,903 rows × ~5 KB heavy JSONB (~50 MB), `JSON.parse`s every page, runs regex over ~3.2 KB reviews text per row, and builds a ~9,726-element `writes[]`. The read is I/O (fast, no DB timeout), but the parse+regex+object-build is CPU; at this scale it plausibly breaches the Supabase edge CPU soft limit, terminating the isolate before the post-loop UPSERT. The per-place cron survives because each call handles only ~27 places (trivial CPU) — which is exactly why the cron writes (F-1) and city-mode does not.
- **Mechanism:** heavy per-row AI-blend read/compute × large row count → isolate terminated pre-UPSERT → 0 writes.
- **Severity:** SUSPECTED CONTRIBUTOR (leading hypothesis; not sealed — see §9).

### F-6 (secondary, CONFIRMED, cheap) — `onComplete` does not refresh the "Scored" counter. CONFIRMED CONTRIBUTOR (defect A).
- **Symptom:** Even a working run would leave the visible "Scored" count frozen.
- **Layer:** Code (admin UI).
- **Probe / Evidence:** In `SignalLibraryPage.jsx`, all scorer buttons' `onComplete` do only `setPreviewKey((k)=>k+1)` (`RunScorerButton` L1197, `ScoreAllSignalsButton` L1157, Bouncer L1143). `previewKey` re-keys **only** `TopPlacesPreview` (L1203). `CityPipelineHistory` (the "Scored" column, L547–661) loads its data from `admin_city_pipeline_status()` **on mount / manual Refresh only** (`useEffect(()=>{refresh();},[refresh])`, L567) and is never re-fetched by `onComplete`.
- **Mechanism:** The counter Seth watches is decoupled from the scorer completion → it stays frozen regardless of whether the write succeeded, reinforcing the "nothing happened / it's complete but count didn't move" perception.
- **Severity:** CONFIRMED CONTRIBUTOR (real, independent, must be fixed in the SPEC; does NOT by itself cause the 0-write — F-1 proves the DB truly has 0 new rows).

### F-7 — The 15-min cron is a glacial trickle, not a backfill. CONFIRMED CONTRIBUTOR.
- **Probe:** distinct scored places per day, last 10 days (see §7).
- **Evidence:** NY +2 (07-10) +1 (07-04); Paris +3 (07-10). The cron (`tg_meta_orch_1009_sub_d_kick_rescores`) selects **500 (place,signal) pairs GLOBALLY per tick**, per-place mode, ordered oldest-stale-first, split across all lagging cities. NY/Paris's ~9,835/4,438 never-scored pairs compete with the whole global backlog for 500 slots/tick.
- **Mechanism:** Even though the cron *can* write NY/Paris (per-place mode works), its global 500/tick budget makes filling 9,903/4,464 effectively impossible; this is why coverage looks permanently pinned at 35/15.
- **Severity:** CONFIRMED CONTRIBUTOR (explains why the broken bulk path isn't silently rescued).

---

## 6. Five-Truth-Layer reconciliation (the 0-rows-written contradiction)

| Layer | What it says | Contradiction / truth |
|---|---|---|
| **Docs** | Admin UI + Signal Library: "Run scorer for <city>" populates `place_scores` for all servable places. | Matches expectation; the feature is supposed to bulk-score. |
| **Schema** | `place_scores` UNIQUE(place_id,signal_id) (valid upsert target), score CHECK [0,200], FK→place_pool, **no triggers**. Upsert path is sound (cron proves writes land). | No schema-level blocker. Rules out a constraint/trigger cause. |
| **Code** | Deployed v268 == repo. City-mode reads all servable rows for the city, blends, then UPSERTs. For NY it SHOULD write ~9,726. | **Code says it should write; data says it wrote 0.** This gap is the bug. Given city_id correct + all-veto ruled out, the only reconciliation is: the run TERMINATES before the UPSERT (F-4). |
| **Runtime** | No DB statement-timeout at 05:15–05:17; reads are fast; edge access-logs in the window show only the :15/:30 **cron** bursts (18 concurrent per-place calls, 590–730 ms) — no clean multi-second manual city run. `console.log scored=/written=` not exposed by MCP; `verify_jwt` blocks dry_run. | Runtime confirms the failure is edge-side, not DB-side. The exact edge termination signal is the ONE unproven link (F-5). |
| **Data** | NY 9,903 servable / 35 scored; Paris 4,464 / 15; London (10,706) 100%; covered cities first-scored pre-2026-05-30; NY/Paris post-05-30; 0 writes in Seth's window; cron adds ~3/city/10-days. | Data is the anchor of truth: outcome proven, scale/city_id/veto theories killed, temporal boundary established. |

**Flagged contradiction:** Code (should write ~9,726) vs Data (wrote 0). Truth held by **Data + Runtime**: the run does not reach a committing UPSERT. The precise reason it doesn't is the only item still at SUSPECTED (F-5).

---

## 7. Key probes & raw evidence (copy-pasteable)

```sql
-- Coverage cliff (decisive scale killer): London 100% > NY 0.4%
WITH serv AS (SELECT city_id,count(*) servable FROM place_pool WHERE is_active AND is_servable GROUP BY city_id),
scored AS (SELECT pp.city_id,count(DISTINCT ps.place_id) scored_places FROM place_scores ps JOIN place_pool pp ON pp.id=ps.place_id WHERE pp.is_active AND pp.is_servable GROUP BY pp.city_id)
SELECT sc.name,s.servable,COALESCE(x.scored_places,0) scored,round(100.0*COALESCE(x.scored_places,0)/NULLIF(s.servable,0),1) pct
FROM serv s LEFT JOIN scored x ON x.city_id=s.city_id LEFT JOIN seeding_cities sc ON sc.id=s.city_id ORDER BY s.servable DESC LIMIT 30;
--> London 10706/10706 100.0 | New York 9903/35 0.4 | Paris 4464/15 0.3 | Washington 2298/2298 100 | Brussels 1858/1858 100 ...

-- Temporal boundary: covered cities first-scored April; NY/Paris June-03
SELECT sc.name, min(ps.scored_at) first_scored, max(ps.scored_at) last_scored, count(DISTINCT ps.place_id) distinct_places
FROM place_scores ps JOIN place_pool pp ON pp.id=ps.place_id JOIN seeding_cities sc ON sc.id=pp.city_id
WHERE sc.name IN ('London','New York','Paris','Washington','Brussels','Raleigh') GROUP BY sc.name;
--> London first 2026-04-24 | Washington 04-25 | Brussels 04-22 | Raleigh 04-21 | New York 2026-06-03 (35) | Paris 2026-06-03 (15)

-- 0 writes in Seth's window
SELECT ps.scored_at FROM place_scores ps JOIN place_pool pp ON pp.id=ps.place_id
WHERE pp.city_id IN ('72cd3c91-7a32-470b-8e59-a57af654d07f','13d9113a-4796-499e-9544-ae4d17c678db')
  AND ps.scored_at >= '2026-07-10 05:10:00+00' AND ps.scored_at < '2026-07-10 05:29:00+00';   --> []

-- AI-entry shape ~identical NY vs London (all-veto ruled out)
--> London 10656 v4 / 148 true / 10508 false | NY 9835 v4 / 109 true / 9726 false | Paris 4438 v4 / 76 true / 4362 false

-- Read is fast; not a DB timeout
EXPLAIN ANALYZE first page (heavy cols, LIMIT 500 OFFSET 0) --> 353 ms; deep page OFFSET 9400 --> 69 ms.
-- Payload weight (NY servable): avg_ai_bytes 1765 / avg_reviews_bytes 3252 / avg ai text len 4793.

-- Cron trickle (10 days): NY +2 (07-10) +1 (07-04); Paris +3 (07-10).
```

Deployed source verification: `mcp__supabase__get_edge_function('run-signal-scorer')` → `version 268`, `verify_jwt: true`, files identical to worktree (`ezbr_sha256 1405b6c00b…`). Edge access logs: run-signal-scorer at 1783660507 (=05:15:07) and 1783661410 (=05:30:10) = the :15/:30 cron ticks (18 concurrent per-place calls, 243ms span), NOT sequential admin clicks.

---

## 8. Blast radius / cross-surface map

- **Primary (broken):** Admin Web `mingla-admin` Signal Library → any market that became servable AFTER 2026-05-30 and needs a bulk score. Confirmed NY + Paris. **Likely any other large post-Sub-B city** (in-scope to verify at fix time: run the coverage query and treat every "large servable, ~0 scored" city the same).
- **Downstream (consumer impact, in-scope to note, OUT for fix here):** `discover-cards` / collab decks / any RPC that `ORDER BY place_scores.score` will show **empty or near-empty** NY/Paris signal results — those two live markets effectively have no ranked venue supply. This is the real user-facing cost; flag to orchestrator.
- **Edge fn `run-signal-scorer`:** city-mode + all_cities mode share the paged heavy read; **per-place mode (cron / admin re-eval button) is NOT affected** (small batches). Any future "score all cities" quarterly backstop (`tg_meta_orch_1009_sub_d_quarterly_sweep`, all_cities=true per signal) would hit the SAME wall for large cities — flag.
- **NOT affected:** consumer/business mobile, buyer web, Stripe/payments, all pre-Sub-B covered cities (coasting on April data).

---

## 9. What would SEAL the mechanism (F-5) — decisive next diagnostic

Exactly one of the following (do NOT deploy product changes in INVESTIGATE; these are for the SPEC/implementor or an operator-run):
1. **One-shot `[ORCH-1331-DIAG]` log line** (proposed, not deployed): the fn ALREADY logs `scored=/ineligible=/written=/elapsed_ms=` at L399. Have Seth re-run one NY single-signal scorer, then read the `function_edge_logs` (console) stream for that invocation. Three outcomes fully disambiguate:
   - a `[run-signal-scorer] … scored=~9726 … written=0` success line → a write-skip/veto path (re-open Q4/Q6);
   - **no success line + a WORKER_LIMIT / CPU-time / 546 platform event → confirms F-5 (resource kill before UPSERT);**
   - a `sticky override pre-read failed` / upsert-batch 500 → a specific pre-UPSERT error to target.
2. **`dry_run` repro** (read-only; body `{signal_id:'lively', city_id:'72cd3c91…', dry_run:true}`) run with an admin JWT (blocked for this investigator — `verify_jwt:true`). `dry_run` computes and returns `scored/ineligible` **without writing** and its `console.log` reports `elapsed_ms`; if it also fails/times out for NY, that isolates read+compute as the cost center (supports F-5) with zero write risk.

Both were attempted-and-blocked here: MCP `get_logs` returns only request/access logs (no `console.log`), and `verify_jwt:true` bars invocation without a credential this investigator must not read.

---

## 10. Invariant impact (flagged, not resolved)

- **I-AI-SCORE-STALENESS-AUTO-RECOVERED** (Sub-D) assumes the 15-min cron converges cities to fresh scores. F-7 shows it CANNOT converge a large never-scored backlog (500 pairs/tick global). The invariant's "auto-recovered" promise is effectively false for post-Sub-B large cities until the bulk path works. Flag for the SPEC to reconcile.
- **Constitutional #2** (`place_scores.score` owned solely by `run-signal-scorer`) is intact — no rogue writer; the issue is the owner failing to write.
- No invariant is violated by defect A; it is a UI freshness gap only.

---

## 11. Discoveries for Orchestrator (do not fix here)

- **D-1 (consumer supply):** NY + Paris (live markets) currently have ~0 ranked venue supply via `place_scores` for the consumer deck. Product/growth impact independent of this fix — register/track.
- **D-2 (quarterly backstop shares the wall):** `tg_meta_orch_1009_sub_d_quarterly_sweep` (all_cities=true) would hit the same large-city termination. Candidate for the same fix or a NEW ORCH.
- **D-3 (edge access-log attribution):** the orchestrator's earlier "05:15:07 burst = cron" reading is correct; that burst is the :15 cron tick (18 concurrent per-place calls), and the 05:30 tick wrote the 2 NY / 3 Paris rows. Seth's manual runs do not appear as clean 200s in the window — consistent with F-4 (non-2xx).

---

## 12. Confidence

- **Outcome (manual city bulk-score persists 0; NY/Paris unfillable by current paths): PROVEN** (data-confirmed, multiple independent queries).
- **Scale/timeout theory: RULED OUT** (London 10,706 = 100%; reads fast; no DB timeout).
- **city_id mismatch / all-veto / data-shape: RULED OUT.**
- **Run failed server-side before UPSERT (F-4): PROVEN by elimination.**
- **Exact failure locus = post-Sub-B heavy AI-blend read/compute exceeding edge resource budget (F-5): PROBABLE/SUSPECTED** — the one link not sealable from source+DB (needs the §9 diag/dry_run). Source-only per Prime Directive 7 → capped below "confirmed."
- **Defect A (counter never refreshed): CONFIRMED.**

---

## 13. Recommended next phase + scope (direction only — NOT a fix)

**Next = SPEC** (mingla-forensics SPEC mode or as dispatched), scoped to:
1. Make city-mode / all_cities bulk scoring survive large post-Sub-B cities (the F-4/F-5 server-side failure) — the SPEC must choose the mechanism after the §9 diagnostic seals whether it's a resource kill (→ chunked/streamed writes, smaller read pages, write-as-you-go instead of accumulate-then-write, or server-side set-based scoring) vs a specific pre-UPSERT error.
2. Wire the scorer buttons' `onComplete` to ALSO refresh `CityPipelineHistory` (defect A, F-6) — cheap, in-scope.
3. Confirm the fix backfills NY + Paris to full coverage and add a fails-on-revert guard (e.g., a coverage assertion / a test that a large-city run persists > N rows).

**Do NOT** widen beyond the scorer bulk-persist bug + the counter-refresh. D-1/D-2 are separate ORCHs. The exact resource-fix design is deferred until the §9 diagnostic confirms the termination signal.
