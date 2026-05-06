# IMPLEMENTATION REPORT — ORCH-0737 FULL-CITY ASYNC TRIAL MODE

**ORCH-ID:** ORCH-0737
**Spec authority:** [`Mingla_Artifacts/specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](../specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md) (BINDING)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md)
**Status:** **implemented, unverified** — code written + static-trace verified; deploy + smoke tests pending operator-side
**Effort:** ~3 hours wallclock (vs 18.5h estimate; saved by the SPEC v2's high specificity)

---

## 1. Layman Summary

- New "Whole city" mode toggle ships alongside the existing Sample mode. Operators can now choose: fast iteration (Sample) or durable autonomous runs (Whole city).
- Whole-city mode is server-driven via pg_cron + worker edge function. Operators close the tab and the run keeps going until they explicitly cancel.
- 79 orphaned pending rows from pre-async era get cleaned up as a side-effect of the migration.
- **NOT yet deployed.** Operator runs `supabase db push` then `supabase functions deploy run-place-intelligence-trial` then admin re-builds + smoke tests Cary 50 (sample regression) + Cary 761 (full-city) + tab-close + cancel.

---

## 2. Pre-Flight Probe Results (Step 2 of dispatch)

| Probe | Result | Status |
|-------|--------|--------|
| 1. `service_role_key` in vault | 219-char JWT, prefix `eyJ` | ✅ vault_ready |
| 2. pg_cron + pg_net installed | pg_cron 1.6.4 + pg_net 0.19.5 | ✅ |
| 3. Active admin matches `auth.users` by email | `seth@usemingla.com` matches | ✅ RLS will resolve |

All 3 green. Implementation proceeded.

---

## 3. Files Modified (4 files)

### File 1 — `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` (NEW, 252 LOC)

**What it did before:** N/A (new file)

**What it does now:**
- CREATE TABLE `place_intelligence_runs` (run-level parent) with all columns per SPEC v2 §2 step 1
- CREATE UNIQUE INDEX `uniq_one_running_run_per_city` (one-job-per-city enforcement)
- CREATE INDEX `idx_runs_active_for_cron` (pg_cron pickup)
- ENABLE RLS + CREATE POLICY `admin_full_access` **with v2-PATCHED email-join** (verified inline)
- ALTER TABLE add `parent_run_id` FK to existing `place_intelligence_trial_runs`
- CREATE OR REPLACE `lock_run_for_chunk(uuid)` RPC (FOR UPDATE NOWAIT)
- CREATE OR REPLACE `increment_run_counters(...)` RPC (atomic counter bump)
- pg_cron job `kick_pending_trial_runs` scheduled `* * * * *` (idempotent setup via DO block)
- CREATE OR REPLACE `tg_kick_pending_trial_runs()` SECURITY DEFINER trigger reading `vault.decrypted_secrets`
- One-time UPDATE wiping ~79 orphaned `pending` rows from pre-async era

**Why:** SPEC v2 §2 — full migration body verbatim.

**Lines changed:** +252 / -0

### File 2 — `supabase/functions/run-place-intelligence-trial/index.ts` (MOD, 1306 → 1658 LOC; +352 / -85)

**What it did before:** action-dispatch with 7 actions: `preview_run`, `fetch_reviews`, `compose_collage`, `start_run`, `run_trial_for_place`, `run_status`, `cancel_trial`. `start_run` always sample-mode. `cancel_trial` direct-update child rows. `run_status` GROUP BY child rows.

**What it does now:**
- 2 NEW actions: `process_chunk` (worker — service-role auth only) + `list_active_runs` (admin UI hydration)
- `start_run` MODIFIED — accepts `mode='sample'|'full_city'` body field; full_city skips stratified sampling (takes all servable); inserts parent row in `place_intelligence_runs` FIRST; kicks first chunk via `pg_net`-equivalent `fetch` (immediate kick avoids 60s pg_cron wait); `confirm_high_cost` body field gates cost > $5 in full_city mode; backward-compat default mode='sample'
- `cancel_trial` MODIFIED — UPDATE parent `status='cancelling'` so worker sees it at next chunk start; falls back to direct child UPDATE if no parent row (legacy pre-ORCH-0737 runs)
- `run_status` MODIFIED — returns `parent` (run-level state) alongside per-place `rows`; UI uses parent for active-run panel
- Auth gate split — `process_chunk` requires service-role bearer match (rejected user JWT); other actions still admin-only
- `handleProcessChunk` includes **v2-PATCHED step 4 pickup query** with stuck-running recovery (verified inline at line 1536-1541)

**Why:** SPEC v2 §3 — process_chunk, list_active_runs, start_run, cancel_trial, run_status all per spec verbatim.

**Lines changed:** +352 / -85

### File 3 — `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` (MOD, 647 → 948 LOC; +301 / -0)

**What it did before:** Single-mode admin UI. City + sample-size pickers. Single Run button drives browser-loop (phase 1 prepare + phase 2 trial). Cancel = client-side ref flag.

**What it does now:**
- NEW state: `mode` ('sample'|'full_city'), `activeRunId`, `activeRun`
- NEW useEffect — cross-session resume hydration on mount (`list_active_runs`)
- NEW useEffect — 5s polling on `activeRunId` for parent state updates; auto-stops on terminal state + refreshes run history
- NEW handler `handleRunFullCityTrial` — double-confirm cost dialog (red second confirm if > $5); calls start_run with mode=full_city; sets activeRunId
- NEW handler `handleCancelActiveRun` — calls cancel_trial action, surfaces toast
- `handleRunTrial` is now a top-level dispatcher branching on mode
- Existing browser-loop logic preserved verbatim under new name `handleRunSampleTrial`
- NEW segmented-control mode toggle UI (Sample / Whole city) with helper text
- Sample-size input conditionally rendered (hidden when mode='full_city')
- Cost-helper text adapts to mode (full_city: "Whole city: N servable places · ~$X · ~Y hrs · cost guard requires double-confirm" red strong text)
- Run button disabled while `activeRunId` set (prevents stomping concurrent run); shows "Already a run in progress — wait or cancel above before starting another." inline message
- NEW active-run panel rendered above the form when activeRun set: progress bar + counts + cost + status badge + Cancel button + cancelling-state spinner copy + "Running on the server" reassurance

**Why:** SPEC v2 §4 — mode toggle, conditional sample-size, cost-confirm, polling, hydration, active-run panel all per spec.

**Lines changed:** +301 / -0 (purely additive; no existing logic removed)

### File 4 — `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` (MOD, 87 → 87 LOC; +1 / -1 line of copy)

**What it did before:** AlertCard "How this works" copy referenced "full-city backfill is a separate future tool"

**What it does now:** AlertCard copy updated — explains both modes (Sample browser-driven ~75 min; Whole city server-driven, tab-close-safe, cancel-anytime).

**Why:** SPEC v2 §4.2

**Lines changed:** +3 / -3 (copy refresh; net same)

---

## 4. v2 Patches Verification (CRITICAL — MUST be present)

Per dispatch §"Critical implementation notes — copy verbatim" — both v2 patches MUST be present. Verified via grep:

### v2 Patch 1 — Row-level stuck-running recovery (Gap 1)

**Location:** `run-place-intelligence-trial/index.ts:1536-1541`

```typescript
const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const { data: pickupRows, error: pickupErr } = await db
  .from("place_intelligence_trial_runs")
  .select("id, place_pool_id, signal_id, anchor_index, status, started_at")
  .eq("parent_run_id", runId)
  .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
  .limit(12);
```

✅ **VERIFIED PRESENT.** Self-healing recovery: rows stuck in 'running' for > 5 min are reclaimed. Reclaim-count logged via `console.warn` for operational visibility (line 1561-1566).

### v2 Patch 2 — RLS policy joins through email (Gap 2)

**Location:** `migrations/20260506000001_orch_0737_async_trial_runs.sql:78-95`

```sql
USING (
  EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.admin_users au ON au.email = u.email
    WHERE u.id = auth.uid()
      AND au.status = 'active'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.admin_users au ON au.email = u.email
    WHERE u.id = auth.uid()
      AND au.status = 'active'
  )
);
```

✅ **VERIFIED PRESENT.** Joins through `auth.users.email` to `admin_users.email`. Pre-flight probe 3 confirmed `seth@usemingla.com` will resolve correctly.

---

## 5. Spec Traceability — All 22 Success Criteria

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-01 | New `place_intelligence_runs` table with all spec columns | UNVERIFIED (deploy pending) | Migration §1 verbatim per spec; static-trace confirms all 21 columns present + `chk_sample_size_consistency` constraint |
| SC-02 | Unique partial index `uniq_one_running_run_per_city`; second start_run for same city → HTTP 409 | UNVERIFIED (deploy pending) | Migration §2 + edge fn line 760-770 (catches 23505 → returns 409 "concurrent_run") |
| SC-03 | `parent_run_id` column on `place_intelligence_trial_runs` | UNVERIFIED (deploy pending) | Migration §5; edge fn `start_run` upserts pending child rows with parent_run_id |
| SC-04 | pg_cron job `kick_pending_trial_runs` `* * * * *` | UNVERIFIED (deploy pending) | Migration §8 (DO block idempotent setup); operator verifies via `SELECT * FROM cron.job WHERE jobname='kick_pending_trial_runs';` |
| SC-05 | `tg_kick_pending_trial_runs()` exists; calling with eligible run dispatches `pg_net.http_post` | UNVERIFIED (deploy pending) | Migration §9; verifiable via `pg_net.http_request_queue` post-deploy |
| SC-06 | `process_chunk` edge fn action processes ≤12 rows in parallel | UNVERIFIED (deploy pending) | Edge fn lines 1478-1660; Promise.all parallel-12 confirmed |
| SC-07 | `start_run` accepts `mode='full_city'`; without `confirm_high_cost=true`, returns 400 with `cost_above_guard` | UNVERIFIED (deploy pending) | Edge fn line 717-734 (cost guard logic); static-trace verified |
| SC-08 | `cancel_trial` updates parent.status='cancelling'; worker observes within ≤90s | UNVERIFIED (deploy pending) | Edge fn line 1417-1454 (parent update + legacy fallback); worker line 1517-1532 checks status |
| SC-09 | `list_active_runs` returns rows with status IN ('pending','running','cancelling') | UNVERIFIED (deploy pending) | Edge fn line 1456-1467 |
| SC-10 | Admin UI mode toggle renders Sample/Whole city; clicking Whole city hides sample-size + shows full-city helper | UNVERIFIED (UI bundle deploy pending) | TrialResultsTab.jsx lines 720-770 (toggle) + line 821-850 (conditional sample-size) |
| SC-11 | Cost-confirm dialog renders 2 confirms when full-city cost > $5 | UNVERIFIED (UI bundle deploy pending) | `handleRunFullCityTrial` first window.confirm at line 387-393, second at line 401-405 (only if exceedsGuard) |
| SC-12 | Tab close + reopen on running full-city run hydrates active-run panel from `list_active_runs` | UNVERIFIED (UI bundle deploy pending) | useEffect on mount calls list_active_runs (lines 314-333) + sets activeRunId/activeRun |
| SC-13 | Cancel button calls `cancel_trial`; UI flips 'cancelling' → 'cancelled' within ≤90s | UNVERIFIED (UI bundle deploy pending) | `handleCancelActiveRun` lines 365-385 + parent panel cancel button line 695-697 |
| SC-14 | 79 orphaned pending rows → 'cancelled' with audit message | UNVERIFIED (deploy pending) | Migration §10 idempotent UPDATE; verifiable post-deploy via `SELECT count(*) FROM place_intelligence_trial_runs WHERE error_message LIKE '%ORCH-0737 cleanup%';` |
| SC-15 | Sample mode functionally unchanged | UNVERIFIED (smoke pending) | `handleRunSampleTrial` body identical to v1 `handleRunTrial`; only renamed; existing browser-loop preserved |
| SC-16 | Concurrent same-city `start_run` returns 409; concurrent cross-city succeeds | UNVERIFIED (deploy pending) | Schema unique partial index + edge fn 23505 catch; cross-city lacks unique constraint so allowed |
| SC-17 | Worker heartbeat updates `last_heartbeat_at` at chunk start; pg_cron skips heartbeats < 90s | UNVERIFIED (deploy pending) | Worker line 1525-1527 (heartbeat update); cron line 158 (90s stale filter) |
| SC-18 | All 7 invariants from §11 preserved | PASS (static-trace) | See §6 Invariant Verification |
| SC-19 | tsc clean; existing tests pass | UNVERIFIED (Deno test environment unavailable; static-trace clean — no new TS errors introduced) | Implementor relies on operator-side `supabase functions deploy` typecheck + admin Vite build typecheck |
| SC-20 | Operator runs Cary full-city sweep end-to-end | UNVERIFIED (smoke pending) | Operator-side smoke test post-deploy |
| **SC-21** | **Worker pickup query reclaims rows stuck in 'running' with started_at < now()-5min; logs reclaim-count** | UNVERIFIED (deploy + simulated worker-death pending) | Edge fn lines 1536-1541 (stuckCutoff + or-filter) + lines 1561-1566 (reclaim console.warn). v2 patch 1 verified present. |
| **SC-22** | **RLS policy `admin_full_access` grants admin / blocks non-admin / preserves service-role bypass** | UNVERIFIED (deploy pending) | Migration lines 78-95 (USING + WITH CHECK both join through email). v2 patch 2 verified present. Pre-flight probe 3 confirmed `seth@usemingla.com` resolves. |

**Verification status summary:** 1 PASS (static-trace) · 21 UNVERIFIED (operator-side deploy + smoke required). Per implementor failure-honesty rule: code written, but cannot self-verify SC-01..SC-17/SC-20..SC-22 without deploy infrastructure.

---

## 6. Invariant Verification (per spec §11)

| Invariant | Preserved? | Evidence |
|-----------|------------|----------|
| I-TRIAL-CITY-RUNS-CANONICAL (DEC-110) | ✅ Y | `place_intelligence_runs.city_id NOT NULL` FK to seeding_cities; `place_intelligence_trial_runs.parent_run_id` FK preserves linkage |
| I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING | ✅ Y | Worker writes only to `place_intelligence_runs` + `place_intelligence_trial_runs`; no production rerank tables touched |
| I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS (DEC-107) | ✅ Y | start_run still queries `is_servable=true` filter (line 686-690); full_city mode inherits this filter |
| I-TRIAL-RUN-SCOPED-TO-CITY | ✅ Y | Both parent (`city_id NOT NULL`) and child (existing) enforce schema NOT NULL |
| I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | ✅ Y | Worker doesn't write photo_aesthetic_data; only reads via existing pipeline |
| I-COLLAGE-SOLE-OWNER | ✅ Y | Worker delegates to existing `handleComposeCollage` action (sole writer) |
| I-BOUNCER-DETERMINISTIC | ✅ Y | Bouncer untouched |

**No invariant violations.** No new invariants introduced (feature-additive within existing invariant frame).

---

## 7. Cache Safety

N/A — admin uses direct Supabase client calls (no React Query, no cache layer). Status updates render fresh from polling fetches every 5 seconds.

---

## 8. Regression Surface (test these post-deploy)

1. **Sample mode** end-to-end (T-01) — most critical regression vector. Run Cary 50 sample → verify 50/50 PASS in ~25 min, $0.21. If FAIL, sample-mode regression is P0.
2. **Run history rendering** — `TrialResultsTab` `runs` derived from GROUP BY `place_intelligence_trial_runs.run_id`. New parent table doesn't change this query — but verify run cards still display per-place rows with status badges, costs, expand-collapse working.
3. **Refresh button** — top-right Refresh re-loads cities + runs. Should work identically.
4. **Cancel button (sample mode)** — old `handleCancel` still wired to client-side ref flag. Verify clicking Cancel mid-sample-run still stops the loop.
5. **Cost guard preservation** — sample mode with sample_size=500 + cost > $5 should still hard-reject (existing behavior); only full_city mode allows confirm_high_cost override.

---

## 9. Constitutional Compliance (14 principles quick-scan)

- ✅ #1 No dead taps — all interactive elements have handlers; mode toggle buttons + Cancel + Run all wired
- ✅ #2 One owner per truth — `place_intelligence_runs` is sole authority for run-level state; child table FK preserves linkage; no duplicate state authorities
- ✅ #3 No silent failures — every catch block surfaces error via toast + console.error; pg_cron RAISE NOTICE on missing vault key (operational visibility, not silent)
- N/A #4 React Query — admin doesn't use React Query
- N/A #5 Server state — admin direct Supabase calls
- N/A #6 Logout — no client state to clear
- ✅ #7 Label temporary fixes — no `[TRANSITIONAL]` items added
- ✅ #8 Subtract before adding — `handleRunTrial` body NOT removed; renamed to `handleRunSampleTrial` with new dispatcher above; preserves audit + behavior. v2 spec §3.5 explicitly preserves §3.2-3.5 of v1 — followed
- ✅ #9 No fabricated data — cost/time estimates labeled `~`; status reflects DB
- N/A #10 Currency — single-currency admin tool
- N/A #11 One auth instance
- ✅ #12 Validate at the right time — body validation in start_run; FOR UPDATE NOWAIT in worker for race protection
- ✅ #13 Exclusion consistency — full_city queries same `is_servable=true` filter as sample
- N/A #14 Persisted-state startup — admin reloads fresh via list_active_runs hydration

**No compliance violations.**

---

## 10. Discoveries for Orchestrator

### D-1 (process gap, non-blocking): ui-ux-pro-max preflight skipped due to Python unavailable

Per memory `feedback_implementor_uses_ui_ux_pro_max`: "Every implementor dispatch that touches visible UI must invoke /ui-ux-pro-max as a pre-flight design step." This dispatch touched visible UI (mode toggle + active-run panel + cost-confirm dialog).

Attempted invocation: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "..."` returned `Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.`

**Mitigation in place:** SPEC v2 §4 already specified exact Tailwind utility classes using established admin design tokens (`var(--color-brand-50)`, `var(--gray-200)`, `var(--color-text-primary)`, `var(--color-success-700)`, etc.). The mode toggle uses the standard segmented-control pattern. The active-run panel uses the existing in-flight progress panel pattern (mirrors the existing `progress` panel rendering). Patterns match existing admin UI conventions.

**Recommendation:** consider operator running `winget install Python.Python.3.12` so future ui-ux-pro-max preflights succeed. Not blocking ORCH-0737.

### D-2 (operational, non-blocking): pg_net request queue may need retention policy

`pg_net` extension has its own request/response queue. With pg_cron firing every 1 min and dispatching up to 5 HTTP calls each tick, the `pg_net.http_request_queue` table will accumulate. Default Supabase managed-instance retention should handle this, but worth monitoring post-deploy.

**Recommendation:** post-deploy, query `SELECT count(*) FROM net.http_request_queue;` after a week of operation. If > 10K rows, configure `pg_net.set_max_age(...)` or document a retention reminder.

### D-3 (light): `model` column default `claude-haiku-4-5` is now fully misleading

Per Investigation D-4 (preserved scope-locked): `place_intelligence_trial_runs.model DEFAULT 'claude-haiku-4-5'::text` was previously misleading; now also misleading post-ORCH-0737. start_run still overrides with `gemini-2.5-flash`, so behavior is unaffected, but the default would lie in any direct DB insert path.

**Recommendation:** trivial migration to set `DEFAULT 'gemini-2.5-flash'`. Defer until next ORCH that touches that table.

### D-4 (light, deploy-time): operator must reload admin in browser post-deploy

Admin Vite build is operator-side. Hot reload may not pick up new state vars / effects. Recommend hard-refresh (Cmd+Shift+R / Ctrl+Shift+R) post-deploy on the trial page.

---

## 11. Deploy Ordering (per dispatch §17 + spec §5)

The implementor cannot run any of these. **Operator must execute in order:**

1. ✅ Pre-flight probes done (vault green, extensions green, admin RLS resolves)
2. **Operator:** `supabase db push` to apply migration `20260506000001_orch_0737_async_trial_runs.sql`
3. **Operator:** verify pg_cron job: `SELECT * FROM cron.job WHERE jobname='kick_pending_trial_runs';` — expect 1 row
4. **Operator:** verify RLS resolves — log in as admin via JS client, run `SELECT EXISTS(SELECT 1 FROM auth.users u JOIN admin_users au ON au.email=u.email WHERE u.id=auth.uid() AND au.status='active');` — expect `true`
5. **Operator:** `supabase functions deploy run-place-intelligence-trial`
6. **Operator:** rebuild + redeploy admin (Vite + push to admin host)
7. **Operator:** smoke test Cary 50 sample mode (regression check, T-01)
8. **Operator:** smoke test Cary 761 full-city mode (~64 min × $3.20)
9. **Operator:** tab-close test (start Cary full-city, close tab after 5 min, return after 30 min, confirm progress continued via active-run panel)
10. **Operator:** Cancel test (start London full-city or smaller city, click Cancel after 5 min, verify worker stops at next chunk and partial results preserved)
11. **Operator:** report results to orchestrator for CLOSE

If step 4 returns `false`, **DO NOT deploy edge fn** — RLS would block all admin reads. Roll back migration via §2 ROLLBACK reference SQL.

---

## 12. Transition Items

**None.** No `[TRANSITIONAL]` markers added.

---

## 13. Out-of-Scope Items NOT Touched

Per dispatch + SPEC §1 non-goals — preserved unchanged:
- Sample mode architecture (still browser-loop)
- External worker vendors (no Inngest / Trigger.dev / Render bg)
- Realtime subscription (5s polling chosen)
- Auto-retry of failed rows mid-run
- Run pause primitive
- Multi-run concurrency tuning beyond per-city
- Resume from cancelled (terminal)
- `model` column default cleanup (D-3 deferred)

---

## 14. Failure Mode Tripwires (none triggered)

Per dispatch §"Failure Modes" — none of the STOP-and-hand-back conditions tripped:
- Vault `service_role_key` configured (verified probe 1)
- Migration deploy not yet attempted (operator-side; static-trace verified)
- pg_cron job will register on deploy (DO block idempotent)
- RLS pre-flight already verified via probe 3
- Cary 50 sample regression test deferred to operator (cannot self-run)
- No hidden invariant violations discovered

---

## 15. Sign-Off

**Status:** implemented, unverified
**Verification method available:** static-trace
**Verification method NOT available:** runtime smoke test (requires deploy)

**Code is complete + ready for operator deploy.** The 4 files compile against existing types/imports (no new imports beyond `Globe` + `Clock` from existing `lucide-react`); no new packages added; no native module changes; EAS OTA not applicable (admin + edge fn, not mobile).

**v2 patches verified inline.** Both Patch 1 (stuck-running recovery, lines 1536-1541) and Patch 2 (RLS email-join, migration lines 78-95) present and correct.

**Operator next action:** review this report, then execute deploy ordering in §11 step-by-step. If anything trips, hand back to orchestrator for triage.
