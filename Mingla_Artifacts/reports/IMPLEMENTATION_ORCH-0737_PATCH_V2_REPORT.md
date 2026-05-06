# IMPLEMENTATION REPORT — ORCH-0737 v2 PATCH (chunk-size tuning + cancel-cleanup fix)

**ORCH-ID:** ORCH-0737 v2 patch (post-smoke tune-up; not a re-implementation)
**Dispatch:** [`prompts/IMPLEMENTOR_ORCH-0737_PATCH_V2_CHUNK_SIZE_TUNING.md`](../prompts/IMPLEMENTOR_ORCH-0737_PATCH_V2_CHUNK_SIZE_TUNING.md)
**Predecessor:** [`reports/IMPLEMENTATION_ORCH-0737_REPORT.md`](IMPLEMENTATION_ORCH-0737_REPORT.md) (v1)
**Status:** **implemented, unverified** — code written + grep-verified; runtime smoke pending operator
**Effort:** ~5 min wallclock (vs ~10 min estimate)

---

## 1. Layman Summary

Three mechanical fixes applied to address the Cary smoke stall (24 done / 81 stuck after 17 min):
1. Worker grabs **6 places per chunk instead of 12** — chunk now fits comfortably under edge fn timeout
2. Edge fn wallclock limit **bumped to 200s** (from 150s default) — belt+suspenders
3. **Cancel cleanup defect fixed** — Cancel button now also marks 'running' rows cancelled (was only marking 'pending')

After redeploy + restart, expected throughput: ~6 rows/min steady-state. Cary 761 in ~2 hours instead of stalling.

---

## 2. Pre-Flight Probes

| Probe | Result |
|-------|--------|
| `supabase/config.toml` exists at expected path | ✅ 18 lines, simple format with one block per fn |
| Existing `[functions.run-place-intelligence-trial]` block | ❌ none — adding new block (no conflict per failure-mode rule) |
| `.limit(12)` location in worker | ✅ exactly 1 occurrence at the v2-patched stuck-running pickup query (no other match in file) |
| Cancel-cleanup `.in("status", ["pending"])` | ✅ exactly 1 occurrence in `handleProcessChunk` cancellation branch (the legacy fallback path at line 1443 already uses `["pending","running"]`, kept consistent) |

---

## 3. Old → New Receipts

### File 1 — `supabase/functions/run-place-intelligence-trial/index.ts`

**What it did before:**
- Worker pickup query had `.limit(12)` — chunks of 12 places processed in parallel via `Promise.all`. Each row 30-80s; 12 in parallel often exceeded edge fn 150s timeout, leaving rows stuck in 'running' until 5-min stale-recovery reclaimed.
- Cancel-cleanup branch (when worker observes `parent.status='cancelling'`) only marked `pending` child rows cancelled — `running` rows stayed orphaned.

**What it does now:**
- Worker pickup query `.limit(6)` — chunks of 6 places. 30-50s wallclock per chunk fits comfortably in 150s timeout (and 200s with new config).
- Cancel-cleanup now marks BOTH `pending` AND `running` rows cancelled when worker observes `cancelling`. Mirrors the legacy fallback path which already had `["pending","running"]`.
- Audit-trail comments added above both edits explaining the post-smoke v2 patch reasoning.

**Why:** ORCH-0737 dispatch v2 patch §"Fix 1" (chunk size) + §"Fix 3" (cancel-cleanup defect).

**Lines changed:** ~+12 / -2 (net +10; mostly comment additions for audit trail)

### File 2 — `supabase/config.toml`

**What it did before:** `run-place-intelligence-trial` had no explicit `[functions.<name>]` block — used Supabase's default 150s wall-clock limit + default JWT verify behavior (which is true by default).

**What it does now:** Explicit `[functions.run-place-intelligence-trial]` block at end of file with `verify_jwt = true` (matches existing default behavior used by other functions) and `max_request_duration_seconds = 200`. Audit-trail comment above explains why.

**Why:** ORCH-0737 dispatch v2 patch §"Fix 2" (edge fn timeout bump as belt+suspenders).

**Lines changed:** +6 / -0 (3 lines toml + 3 lines comment, all appended)

---

## 4. Spec Traceability

This is a tuning patch — no SC additions. All 22 SCs from SPEC v2 stand. Patch fixes the implementation under those SCs.

The v1 implementor report's UNVERIFIED SCs (SC-01..SC-17 + SC-20..SC-22) remain UNVERIFIED until operator runs the post-patch smoke. SC-21 (worker pickup query reclaims stuck rows) and SC-22 (RLS correctness) are unaffected by this patch. **Critical SCs this patch indirectly enables:** SC-02 (full-city run completes; throughput unblocked), SC-13 (Cancel works on running rows too — was buggy in v1), SC-20 (operator end-to-end smoke).

---

## 5. Invariant Verification

All 7 ORCH-0737 invariants from SPEC v2 §11: **PRESERVED.** Patch only tunes parameters + fixes one cleanup bug; no architectural change. No new invariants introduced.

---

## 6. Cache Safety

N/A — admin uses direct Supabase calls, no cache layer.

---

## 7. Regression Surface (post-redeploy smoke)

1. **Sample mode** still works — patches only touch worker (full-city path) and config (no impact on sample browser-loop). Run a quick Cary 50 sample as regression spot-check.
2. **Existing in-flight Cary run** — operator should Cancel via UI before redeploy. Old worker may be mid-chunk when redeploy lands; new code takes over on next pg_cron tick (~60s).
3. **First-chunk kick from start_run** — also uses the worker (`process_chunk` action). Now picks up 6 rows on first kick instead of 12.
4. **pg_cron job** — unchanged; trigger function unchanged. Worker action signature unchanged.
5. **Tab-close + reopen hydration** — unchanged.

---

## 8. Constitutional Compliance

- ✅ #2 One owner per truth — patch doesn't change ownership boundaries
- ✅ #3 No silent failures — added audit comments, not removing observability
- ✅ #7 Label temporary fixes — these are permanent fixes, not transitions; no `[TRANSITIONAL]` markers
- ✅ #8 Subtract before adding — `.limit(12)` removed before `.limit(6)` written; old comment context replaced with new audit-trail comment
- ✅ #13 Exclusion consistency — cancel-cleanup now has consistent `["pending","running"]` filter across BOTH async path (line 1514) AND legacy fallback path (line 1443)

No violations.

---

## 9. Discoveries for Orchestrator

### D-1 (light, future tuning consideration): pg_cron 1-minute granularity is the real throughput ceiling

With chunk size 6 and ~30-50s per chunk, the worker exits well before the next pg_cron tick (60s away). **Effective throughput is capped at 6 rows/min** because we only process one chunk per cron tick.

If post-patch throughput proves operator-painful at scale (e.g., London 3495 rows would take ~10 hours at 6/min), a future ORCH-0737-followup could add a **budget-loop pattern**: worker processes chunks back-to-back until ~120s elapsed, then exits. This gets ~3-4 chunks per tick = 18-24 rows/min, cutting Cary to ~30 min and London to ~3 hours.

**Out of scope for this patch.** Defer to ORCH-0737-followup if operator surfaces pain.

### D-2 (light, behavior consistency): legacy fallback cancel-cleanup vs new cancel-cleanup were inconsistent

The patched-in-this-patch line 1514 (worker observes `cancelling`) now matches the legacy fallback at line 1443 (`handleCancelTrial` direct child UPDATE). Pre-patch they diverged silently. Worth a unit-test fixture in a future cycle to lock-in the parity.

### D-3 (operational): operator cleanup SQL note

The dispatch prompt §"Operator-side post-deploy action sequence" step 3 includes optional one-time SQL to clean leftover stuck `running` rows from the cancelled Cary run. This SQL is **only needed if the v3 fix doesn't auto-clean within 5 min after cancel**. Per Fix 3, the new worker should clean them on next tick when it observes `parent.status='cancelled'`... wait actually that's not quite right.

**Important nuance:** Fix 3 only triggers when worker is on `parent.status='cancelling'` (still active). After parent flips to `cancelled` (terminal), pg_cron filter (`WHERE status='running' AND processed_count < total_count`) won't re-pick the run — so worker never runs again for that cancelled run. **The 81 stuck-running rows from the cancelled Cary run will stay stuck forever unless operator runs the cleanup SQL.**

**Recommendation:** operator MUST run the cleanup SQL from dispatch §"Operator-side post-deploy action sequence" step 3 after cancelling the current Cary run — this is no longer optional, it's required. Updating the action sequence to mandatory.

---

## 10. Verification Status

**implemented, unverified.** All 3 patches verified landed via grep:
- `.limit(6)` at line 1551 with audit comment ✅
- `["pending", "running"]` at line 1514 (and matching legacy line 1443 unchanged) ✅
- `[functions.run-place-intelligence-trial]` block in config.toml with `max_request_duration_seconds = 200` ✅
- Zero stale `.limit(12)` in worker file ✅

**Runtime verification pending operator-side:**
- Operator: Cancel current Cary run via UI
- Operator: run cleanup SQL (per D-3 — now mandatory not optional) to wipe leftover stuck rows
- Operator: `supabase functions deploy run-place-intelligence-trial`
- Operator: restart Cary full-city smoke
- Observe: throughput ~6 rows/min steady-state, no stuck rows accumulating, run completes in ~2 hours

---

## 11. Out-of-Scope (untouched)

- SPEC v2 contract — preserved verbatim
- Architecture (pg_cron + worker via pg_net) — preserved
- DB schema — no migration
- Admin UI — no changes
- Sample mode — unchanged
- Worker budget-loop pattern (D-1) — deferred to ORCH-0737-followup

---

## 12. Failure Mode Tripwires

None tripped. All 3 fixes applied cleanly. No conflicting blocks in supabase/config.toml. No surprising `.limit(12)` matches.

---

## 13. Sign-Off

**Status:** implemented, unverified
**Verification method available:** static-trace + grep
**Verification method NOT available:** runtime smoke (operator-side)

**Code is complete. Operator next action:**
1. Cancel current Cary run via UI
2. Run cleanup SQL from dispatch §"Operator-side post-deploy action sequence" step 3 (now MANDATORY per D-3)
3. `supabase functions deploy run-place-intelligence-trial`
4. Restart Cary full-city smoke via admin UI
5. Observe throughput; expect ~6 rows/min and Cary 761 completing in ~2 hours
