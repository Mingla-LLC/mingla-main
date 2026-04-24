# QA RETEST 1 — ORCH-0646: ai_approved leftovers cleanup

**Tester:** mingla-tester
**Date:** 2026-04-23 late-night
**Mode:** RETEST (cycle 2 of 2 — escalation threshold)
**Dispatch:** `Mingla_Artifacts/prompts/TESTER_ORCH-0646_RETEST_v2.md`
**Cycle 1 QA:** `Mingla_Artifacts/reports/QA_ORCH-0646_AI_APPROVED_CLEANUP_REPORT.md` (FAIL, 1 P1 + 1 P2 + 1 P3 + 4 P4)
**Rework:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0646_REWORK_v2_REPORT.md`

---

## 1. Executive verdict

**CONDITIONAL PASS.**

- F-01 (P1 duplicate column): **FIXED** — independently re-verified static.
- F-02 (P2 comment inaccuracy): **FIXED** — re-verified, and the fix clears the CI gate (cycle 1 banned-token issue also resolved).
- All cycle-1 code-level PASSes: **still PASS** (6 independent re-runs).
- CI gate negative-control: **re-proven active** (injected `ai_approved` → exit 1; cleanup → exit 0).

**Condition:** live-DB RPC probes (T-RPC-01..08) + browser UI smoke (T-UI-01..08) still **UNVERIFIED** — tester has no MCP/browser access this session. User must run them post-`supabase db push` + admin deploy to fully confirm before CLOSE fires.

**Counts:** P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 2 (praise)

---

## 2. Previous FAIL verification

### F-01 (was P1) — RESOLVED

**Cycle 1 failure:** L343 header "AI-approved" + L374 cell `r.is_servable_count` duplicated L344 header "Bouncer-passed" + L375 cell `r.is_servable_count` — same data under different labels. Constitutional #2 violation.

**Rework verification:**
```
$ sed -n '343,344p;374,375p' mingla-admin/src/pages/SignalLibraryPage.jsx
              <th className="px-3 py-2 font-semibold">Bouncer-judged</th>
              <th className="px-3 py-2 font-semibold">Bouncer-passed</th>
                  <td className="px-3 py-2"><StageCell done={Number(r.bouncer_judged_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
                  <td className="px-3 py-2"><StageCell done={Number(r.is_servable_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
```

- Header "AI-approved" → "Bouncer-judged" ✓
- Cell `r.is_servable_count` → `r.bouncer_judged_count` ✓
- L344/L375 unchanged (correctly paired — "Bouncer-passed" with `is_servable_count`) ✓

**RPC contract cross-check:** `admin_city_pipeline_status` (migration `20260425000014:77`) returns BOTH fields as distinct:
```
RETURNS TABLE(..., bouncer_judged_count bigint, is_servable_count bigint, ...)
```
- `bouncer_judged_count` = `COUNT FILTER (is_servable IS NOT NULL)` — all judged
- `is_servable_count` = `COUNT FILTER (is_servable = true)` — approved subset

**Mathematical sanity (static proof):** Since approved ⊆ judged, `bouncer_judged_count >= is_servable_count` holds for every row. The two columns will show DIFFERENT values whenever a city has any Bouncer-excluded places (most real cities will). Only degenerate case where values coincide: a city where every judged place was approved (no exclusions). This is mathematically truthful, not a bug — headers remain distinguishable.

**Constitutional #2 restored:** one field per column, distinct rendering.

**Verdict:** F-01 FIXED code-level. T-UI-08 static prediction flipped from cycle-1 FAIL → cycle-2 PASS. Live browser smoke remains user-owned final confirmation.

### F-02 (was P2) — RESOLVED

**Cycle 1 failure:** Comment at L401-404 claimed 5 columns dropped in ORCH-0640 ch13, but only 2 of the 5 named columns were actually dropped. Misleading.

**Rework attempt #1 FAIL:** Implementor followed dispatch wording verbatim using literal `ai_approved` + `ai_validated_at` tokens → CI gate (extended in cycle 1 to cover admin frontend) exited 1 with correct FAIL identification. The gate caught the implementor's blind spot in real time.

**Rework attempt #2 PASS:** Implementor reworded to convey accuracy without banned tokens:
```
// ORCH-0640 ch08 + ORCH-0646: the servable-flag + validation-timestamp columns
// were dropped in ch13 (see migration 20260425000004). Three related AI-era
// columns (reason / primary_identity / confidence) STILL EXIST on place_pool
// but the pipeline that populated them was archived — they are now stale-data
// only. Only ai_categories is actively editable (admin-driven classification).
// Bouncer is the authoritative quality gate going forward.
```

- Accuracy: explicit about which were dropped (referring to migration number), which still exist, and the pipeline-archive context
- No banned tokens: grep `ai_approved` / `ai_validated` / `ai_override` all return 0 matches in this file
- Points future readers to migration `20260425000004` for exact column names

**Verdict:** F-02 FIXED.

### F-03 / D-1 / D-2 (pre-existing) — UNCHANGED

Dispatch scope-lock forbade touching these. Verified rework did not re-raise or address them. Remain deferred for future cleanup ORCHs.

---

## 3. Regression verification

Verified every cycle-1 PASS still holds post-rework:

| Cycle-1 PASS | Re-verification result |
|--------------|------------------------|
| Admin build exit 0 | **PASS** — 17.72s, 0 new errors |
| CI invariants exit 0 | **PASS** — "All ORCH-0640 invariant gates pass." |
| grep `ai_approved` in 2 JSX = 0 | **PASS** — 0 matches |
| grep `aiCard` in PlacePool = 0 | **PASS** — 0 matches |
| grep `handleApprove` in PlacePool = 0 | **PASS** — 0 matches |
| Negative-control gate fails on injection | **PASS** — injected `ai_approved` in `__retest_gate.tmp.jsx` → gate exit 1 with correct file identification; cleanup → gate exit 0 |

**Additional broader regression checks (new this retest):**

| Check | Result |
|-------|--------|
| grep `ai_validated` in 2 JSX | **PASS — 0 matches** (important: cycle-1 rework attempt #1 tripped this; cycle-2 final wording clears it) |
| grep `ai_override` in 2 JSX | **PASS — 0 matches** (third CI pattern; clean) |
| `bouncer_judged_count` consumer audit | **PASS** — 4 sites across admin, all consistent with RPC return schema. PlacePool L310/L316/L319 (cycle-1 wiring unchanged) + SignalLibrary L374 (new F-01 fix). No drift. |
| `r.last_ai_run` at SignalLibrary L353 (D-1) | **UNCHANGED** — dispatch scope-lock respected |
| Migration file `20260426000001_...` | **UNCHANGED** — no DB-level regression possible |
| Invariant registry `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` | **UNCHANGED + PROVEN ACTIVE** (negative-control above) |

---

## 4. Live-fire coverage (user-owned, UNVERIFIED)

Tester cannot run these without MCP + browser access. User must run post-deploy:

| TC | Status |
|----|--------|
| T-RPC-01..08 (RPC probes via Supabase SQL editor) | **UNVERIFIED — user must run** |
| T-UI-01..07 (Place Pool + Signal Library browser smoke, unchanged surfaces) | **UNVERIFIED — user must run** |
| T-UI-08 (CityPipelineHistory duplicate-free verification) | **UNVERIFIED — user must run**; static prediction: PASS |

**Minimum user gate for CLOSE:**
1. Open Signal Library → confirm "Bouncer-judged" and "Bouncer-passed" columns show **different** numbers for at least one city row with Bouncer-excluded places.
2. Live SQL:
   ```sql
   SELECT city_name, bouncer_judged_count, is_servable_count,
          (bouncer_judged_count >= is_servable_count) AS sanity_holds
   FROM public.admin_city_pipeline_status()
   ORDER BY bouncer_judged_count DESC LIMIT 10;
   ```
   Expected: `sanity_holds = true` for all 10 rows.
3. Click Place Pool → city loads without error toast.

If all three pass → user signals orchestrator → CLOSE protocol fires.

---

## 5. New findings (cycle 2)

**None.** The rework was surgical, 3 edits, within scope-lock. No new P0/P1/P2/P3 introduced.

---

## 6. P4 praise

### P4 — Meta-validation of I-COLUMN-DROP-CLEANUP-EXHAUSTIVE

The cycle-2 rework story is textbook-good evidence that the invariant registered in cycle 1 is load-bearing. The implementor's first F-02 attempt (using the dispatch's literal wording with `ai_approved`/`ai_validated_at`) would have passed code review, would have compiled, would have rendered correctly in the browser — but it tripped the CI gate *the same invariant's implementation had installed one cycle earlier*. The gate did exactly what it was registered to do: catch admin-frontend references to dropped-column tokens before they ship. This is how a good invariant earns its keep — by failing the gate at least once on a real attempt.

### P4 — Constitutional #2 restoration

Cycle-1 violation (duplicate-column rendering) fully eliminated by a 2-line rework. The fix preserves the cycle-1 intent (show servable counts in admin) while honoring the constitutional rule (one owner per truth). Economical, correct, reviewable.

---

## 7. Retest cycle tracking

- **Cycle:** 2 of 2 (escalation threshold)
- **Result:** CONDITIONAL PASS (code-level verified; runtime user-owned)
- **Escalation:** NOT triggered — no regression, no new finding, fix is correct.

No cycle 3 needed.

---

## 8. Post-PASS readiness for orchestrator

**READY for CLOSE protocol** conditional on user running:
1. Pre-flight SQL gates (implementation cycle-1 report §1)
2. `cd supabase && supabase db push`
3. Post-apply SQL probe
4. Admin rebuild + deploy
5. Live-fire + browser smoke (minimum 3 checks per §4 above)

If any fail → user signals orchestrator → new dispatch (likely targeted at the actual failure, not a generic rework).
If all pass → user signals orchestrator → CLOSE protocol fires:
- Update 7 artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
- Commit message per rework report §12 + cycle-1 implementation report §5
- No EAS (no mobile code touched)
- Announce next dispatch on Priority Board

---

## 9. Discoveries for orchestrator

**None new.** Deferred discoveries unchanged:
- ORCH-0646.D-1 (P3): `r.last_ai_run` at `SignalLibraryPage.jsx:353` pre-existing silent no-op. Separate cleanup.
- ORCH-0646.D-2 (P3): 3 never-dropped columns (`ai_reason`, `ai_primary_identity`, `ai_confidence`) on `place_pool`. Consider follow-up DROP COLUMN migration.

---

**END OF RETEST REPORT**
