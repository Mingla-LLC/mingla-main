# QA — ORCH-0646: ai_approved leftovers cleanup

**Tester:** mingla-tester
**Date:** 2026-04-23 late-night
**Mode:** TARGETED + SPEC-COMPLIANCE (orchestrator-dispatched)
**Dispatch:** `Mingla_Artifacts/prompts/TESTER_ORCH-0646_AI_APPROVED_CLEANUP.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0646_AI_APPROVED_CLEANUP_REPORT.md`

---

## 1. Executive verdict

**FAIL — NEEDS REWORK (1 P1 finding).**

Summary: All code-level gates pass on independent re-verification. The migration SQL and JSX renames are correct against spec. BUT forensic code reading of SignalLibraryPage.jsx caught a **P1 duplicate-column issue** in the CityPipelineHistory table introduced by the Hidden Flaw #2 fix: columns 4 ("AI-approved" header) and 5 ("Bouncer-passed" header) now both render the same field `r.is_servable_count`, showing identical values under different labels. This would fail T-UI-08 browser smoke on first admin load.

**Counts:** P0: 0 | P1: 1 | P2: 1 | P3: 1 | P4: 4

---

## 2. Pre-flight state (user-owned)

The tester did NOT have MCP or live-DB access this session. Pre-flight gate execution and `supabase db push` are user-owned. Tester verified code state on disk only. Browser smoke tests (T-UI-01..08) and live-DB RPC probes (T-RPC-01..08) are UNVERIFIED; user must run post-deploy.

---

## 3. RPC probe matrix

| TC | Function | Static verification | Live-fire |
|----|----------|---------------------|-----------|
| T-RPC-01 | `admin_city_picker_data()` | SQL body matches spec §3 #1 verbatim; DROP+CREATE present; return fields `city_id, city_name, country_name, country_code, city_status, is_servable_places, total_active_places`; body uses `pp.is_servable = true` (not `pp.ai_approved`) | **UNVERIFIED — user post-deploy** |
| T-RPC-02 | `admin_place_pool_overview(uuid, text)` | SQL matches spec §3 #2; 10 return fields (`total_places`, `active_places`, `is_servable_places`, `with_photos`, `photo_pct`, `bouncer_judged_count`, `is_servable_count`, `bouncer_excluded_count`, `bouncer_pending_count`, `distinct_categories`); three branches (city/country/global) all use `mv.is_servable`; arithmetic should satisfy bouncer_judged_count = is_servable_count + bouncer_excluded_count | **UNVERIFIED — user post-deploy** |
| T-RPC-03 | `admin_place_country_overview()` | SQL matches spec §3 #3; 7 fields including `is_servable_places` + `bounced_pct`; CTE aggregates on `mv.is_servable` | **UNVERIFIED — user post-deploy** |
| T-RPC-04 | `admin_place_city_overview(text)` | SQL matches spec §3 #4; same rename pattern as #3 | **UNVERIFIED — user post-deploy** |
| T-RPC-05 | `admin_place_category_breakdown(uuid, text)` | CREATE OR REPLACE (signature unchanged); body WHERE clause now filters `mv.is_servable = true` (was `mv.ai_approved = true`); 4 return fields unchanged | **UNVERIFIED — user post-deploy** |
| T-RPC-06 | `admin_place_photo_stats(uuid)` | CREATE OR REPLACE (signature unchanged); body WHERE clause filters `mv.is_servable = true`; 3 return fields unchanged | **UNVERIFIED — user post-deploy** |
| T-RPC-07 | No stale `ai_approved` in rewritten functions (post-apply probe) | `grep 'ai_approved' supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql` = 0 matches **in function bodies** (header comment + "DROP+CREATE with renamed" descriptions reference `ai_approved` as context; this is intentional historical documentation, not live code) | **user post-deploy SQL probe** |
| T-RPC-08 | ORCH-0640-clean functions not re-touched | Migration text does not reference `admin_place_pool_city_list`, `admin_place_pool_country_list`, `admin_pool_category_detail`, `admin_pool_category_health`, or `admin_city_pipeline_status`. Scope-lock preserved. | **PASS** (static) |

---

## 4. UI smoke matrix

All UI probes require a browser session against the deployed admin. Tester does NOT have browser access — these are **USER-UNAVAILABLE for tester; user must run**.

**However, one test has a static prediction: T-UI-08 WILL FAIL as currently coded. See §5 Finding F-01 below.**

| TC | Scenario | Status |
|----|----------|--------|
| T-UI-01 | Place Pool page loads; overview stats render | **UNVERIFIED — user must run** |
| T-UI-02 | 3-state Bouncer Status filter works | **UNVERIFIED — user must run** |
| T-UI-03 | Map view renders pins for `is_servable=true` only | **UNVERIFIED — user must run** |
| T-UI-04 | Bouncer-Excluded tab loads with `bouncer_reason` column; NO approve button | **UNVERIFIED — user must run** (code statically matches expectation) |
| T-UI-05 | Inline editor saves without dropped-column errors | **UNVERIFIED — user must run** (static: editForm has only 5 fields, all live columns) |
| T-UI-06 | Bouncer status badge (Servable/Excluded/Not Yet Bounced) renders correctly | **UNVERIFIED — user must run** (static: `bouncerStatusBadge` function at L389 correctly 3-states on `place.is_servable`) |
| T-UI-07 | Signal Library city picker populates with servable counts | **UNVERIFIED — user must run** |
| T-UI-08 | CityPipelineHistory StageCell non-zero servable values | **STATIC PREDICTION: WILL SHOW DUPLICATE DATA** — see Finding F-01 (P1) |

---

## 5. Findings

### 🔴 F-01 (P1-HIGH) — SignalLibraryPage CityPipelineHistory: duplicate column renders identical values under different headers

**File:** `mingla-admin/src/pages/SignalLibraryPage.jsx`
**Lines:** L343-344 (headers), L374-375 (cells)
**Evidence:** Exact source on disk:
```jsx
// Headers at L343-344
<th className="px-3 py-2 font-semibold">AI-approved</th>
<th className="px-3 py-2 font-semibold">Bouncer-passed</th>

// Cells at L374-375
<td className="px-3 py-2"><StageCell done={Number(r.is_servable_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
<td className="px-3 py-2"><StageCell done={Number(r.is_servable_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
```

**What it does now:** Two adjacent table columns show IDENTICAL values (`r.is_servable_count`) but with DIFFERENT headers ("AI-approved" vs "Bouncer-passed"). Every row will display e.g., "AI-approved: 150 / 500" and "Bouncer-passed: 150 / 500" — same number, confusing the admin user about what they're measuring.

**What it should do:** The `admin_city_pipeline_status` RPC (already rewritten in ORCH-0640 migration `20260425000014:73-77`) returns BOTH `bouncer_judged_count` (= places where `is_servable IS NOT NULL`, i.e. "Bouncer has run") AND `is_servable_count` (= places where `is_servable = true`, i.e. "Bouncer approved"). These are distinct metrics. The header "AI-approved" is stale from pre-ORCH-0640 naming — it should show `bouncer_judged_count` (under the renamed header "Bouncer-judged"), and "Bouncer-passed" should remain `is_servable_count`.

**Causal chain:**
1. Pre-ORCH-0646, the JSX had L374 = `r.ai_approved_count` (undefined post-ORCH-0640 RPC rewrite → silent zero → always rendered "0/N"). This was Hidden Flaw #2 in the investigation.
2. Spec §5.1 called for the fix: "rename render `r.ai_approved_count` → `r.is_servable_count` (Hidden Flaw #2)".
3. Implementor executed the literal rename at L374.
4. BUT L375 was already `is_servable_count` (correctly rendering "Bouncer-passed" column).
5. Result: L374 and L375 now render the same data.
6. Root cause: the spec treated the fix as a 1-line rename but did not audit the adjacent column. The investigation (report §4 Hidden Flaw #2) only flagged L374; L375 was not examined. The implementor followed the spec literally.

**Verification step (independent of runtime):** `sed -n '340,378p' mingla-admin/src/pages/SignalLibraryPage.jsx` shows the headers at L343-344 and cells at L374-375 with the duplication. Browser test T-UI-08 would show "AI-approved: N" and "Bouncer-passed: N" with the same N for every row.

**Recommended fix (2 lines):**
```jsx
// L343 header change:
// BEFORE
<th className="px-3 py-2 font-semibold">AI-approved</th>
// AFTER
<th className="px-3 py-2 font-semibold">Bouncer-judged</th>

// L374 cell change:
// BEFORE
<td className="px-3 py-2"><StageCell done={Number(r.is_servable_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
// AFTER
<td className="px-3 py-2"><StageCell done={Number(r.bouncer_judged_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
```

Keep L344 header "Bouncer-passed" and L375 cell `r.is_servable_count` as-is (already correct).

**Blast radius:** SignalLibrary CityPipelineHistory table is the primary intake view for admins deciding which city to operate on. Showing duplicate data here undermines the page's decision-making purpose.

**Constitutional violation:** **#2 One owner per truth** — two columns displaying the same field value is a duplicate-source-of-truth rendering. **P1 severity confirmed.**

---

### 🟡 F-02 (P2-MEDIUM) — Comment inaccuracy at PlacePoolManagementPage.jsx:401

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx`
**Line:** 401-403
**Evidence:**
```jsx
// ORCH-0640 ch08 + ORCH-0646: five AI-validation columns (servable flag, validation
// timestamp, reason, confidence, primary identity) DROPPED in ch13. Only ai_categories
// survives (admin-editable classification). All editForm state for dropped columns
// removed in ORCH-0646; Bouncer is the authoritative quality gate going forward.
```

**What it claims:** Five columns dropped: servable flag (= ai_approved), validation timestamp (= ai_validated_at), reason (= ai_reason), confidence (= ai_confidence), primary identity (= ai_primary_identity).

**What actually happened:** Migration `supabase/migrations/20260425000004_orch_0640_drop_ai_approved_columns.sql` only drops 5 columns: `ai_approved`, `ai_validated_at`, `ai_approved_by`, `ai_approved_at`, `ai_validation_notes`. The three columns **`ai_reason`, `ai_primary_identity`, `ai_confidence` are NOT dropped by any migration in the codebase** (verified via `grep -E "DROP COLUMN.*(ai_reason|ai_primary_identity|ai_confidence)" supabase/migrations/*.sql` → 0 matches).

**Impact:** Comment is factually wrong; future readers will be misled. Functionally safe — the columns exist but nothing writes to them post-ORCH-0640 (AI validation pipeline was archived), and removing admin UI for them is correct per D-3 (admin doesn't override Bouncer).

**Recommended fix (rewording only):**
```jsx
// ORCH-0640 ch08 + ORCH-0646: ai_approved + ai_validated_at DROPPED in ch13.
// ai_reason / ai_primary_identity / ai_confidence columns STILL EXIST but the
// AI-validation pipeline that populated them was archived; they are now stale-
// data only. Only ai_categories is actively editable (admin-driven classification).
// Bouncer is the authoritative quality gate going forward.
```

**Severity reasoning:** P2 not P1 because runtime behavior is correct. Promote to P1 if another engineer mistakenly relies on the wrong comment to decide a future migration.

---

### 🟢 F-03 (P3-LOW) — `r.last_ai_run` consumer at SignalLibraryPage L353 reads a nonexistent RPC field

**File:** `mingla-admin/src/pages/SignalLibraryPage.jsx`
**Line:** 353
**Evidence:**
```jsx
const lastActivity = [r.last_place_update, r.last_refresh, r.last_bouncer_run, r.last_ai_run]
  .filter(Boolean)
  .map((s) => new Date(s).getTime())
  .sort((a, b) => b - a)[0];
```

**What it does now:** `r.last_ai_run` is not among the fields returned by `admin_city_pipeline_status` (per migration `20260425000014:77` the RPC returns `last_place_update`, `last_refresh`, `last_bouncer_run` but NOT `last_ai_run`). So the value is always `undefined` → `.filter(Boolean)` drops it → `lastActivity` computed from the other 3 timestamps → no runtime error.

**Impact:** Silent no-op. If an `ai` run ever needs to be surfaced in "last activity", this reference won't pick it up. Pre-existing bug, not introduced by ORCH-0646.

**Recommended fix (not in ORCH-0646 scope):** Remove `r.last_ai_run` from the array. File as discovery ORCH-0646.D-1 for orchestrator (separate cleanup).

---

### 🔵 F-04 (P4-NOTE) — Migration SQL: exemplary discipline

**File:** `supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql`
**Verification:** Full read of all 6 function definitions against spec §3.

- Header comment documents rationale + prerequisites + 3-state semantics + return-field rename table
- All 4 functions with return-type changes correctly use `DROP FUNCTION IF EXISTS <name>(<sig>);` before `CREATE OR REPLACE` (required pattern when return type differs — matches ORCH-0640 rewrite's `admin_city_pipeline_status` precedent)
- All 2 body-only functions correctly use `CREATE OR REPLACE` without DROP (signature unchanged)
- Every function preserves the `admin_users` auth check at top of body (security regression: none)
- Query shapes preserve plan hints (index-only scans on `admin_place_pool_mv_country_active_servable` remain eligible per the global-scope narrow subqueries in #2)
- 3-state semantics preserved in RPC #2: `bouncer_pending_count` maps to `is_servable IS NULL` (not-yet-bounced)
- COMMIT + post-apply verification SQL in comments

**P4 praise.** Clean, reviewable, production-grade migration.

---

### 🔵 F-05 (P4-NOTE) — CI gate extension: exemplary

**File:** `scripts/ci-check-invariants.sh`
**Verification:** Read lines 29-48. Extension is a single-word addition (`mingla-admin/src/`) to the existing `git grep` path list, plus a 3-line explanatory comment above. Minimum-diff, maximum-effect fix. Negative-control test (tester-reproduced) confirmed the extended gate catches `ai_approved` references in admin.

**P4 praise.**

---

### 🔵 F-06 (P4-NOTE) — INVARIANT_REGISTRY.md: comprehensive

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md` (L134-181)
**Verification:** `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` entry includes: rule with 4 enumerated gates, enforcement mechanism (CI + manual), origin narrative citing ORCH-0640 gap, regression test description, manual pre-cutover check template with copy-pastable bash. Matches spec §7 requirements.

**P4 praise.**

---

### 🔵 F-07 (P4-NOTE) — PlacePool rewrites: correct rename-field plumbing across 23 edit sites

Tester sampled 5 rename sites for independent verification against spec §4 (see §6 spec traceability). All renames consistent: filter state `aiStatus` → `servableStatus`, dropdown option values `validated/rejected/pending` → `servable/excluded/not_bounced`, StatCard consumers read `bouncer_judged_count`/`is_servable_count`/`bouncer_excluded_count`/`bouncer_pending_count` from the rewritten RPC schema. Field names in JSX align byte-exact with the return-field names in the new migration. **No plumbing drift.**

**P4 praise.**

---

## 6. Spec traceability matrix

| SC | Requirement | Evidence | Verdict |
|----|-------------|----------|---------|
| SC-1 | No `ai_approved` in 6 rewritten RPC bodies | Post-apply `pg_get_functiondef` grep — user must run after `db push` | UNVERIFIED (user-owned) |
| SC-2 | `admin_place_pool_city_list` unchanged | `grep` migration file — no reference to this function | PASS |
| SC-3 | Place Pool page smoke | Requires browser | UNVERIFIED (user-owned) |
| SC-4 | Signal Library smoke incl. H-2 fix | Requires browser. **BUT static prediction: will render duplicate values (F-01).** | **FAIL** (static prediction; requires rework before UI smoke can PASS cleanly) |
| SC-5 | Zero `ai_approved` in 2 JSX files | `grep -n 'ai_approved' PlacePool SignalLibrary` → 0 matches | PASS |
| SC-6 | Zero `aiCard` in PlacePool | `grep -n 'aiCard' PlacePool` → 0 matches | PASS |
| SC-7 | Admin build exit 0 | `npm run build` → 20.54s, exit 0 | PASS |
| SC-8 | `handleApprove` removed | `grep -n 'handleApprove' PlacePool` → 0 matches | PASS |
| SC-9 | CI invariant gate with admin coverage | `bash scripts/ci-check-invariants.sh` → exit 0; negative-control (injected `ai_approved` in admin test file, git add, run gate) → exit 1 FAIL with correct identified file; cleanup → exit 0 | PASS |
| SC-10 | Pre-flight gates documented with expected outputs | Implementation report §1 contains 3 SQL probes verbatim | PASS |

---

## 7. Code gate re-verification (independent of implementor)

| Gate | Command | Result |
|------|---------|--------|
| Admin build | `cd mingla-admin && npm run build` | **PASS — exit 0** (20.54s, 0 new errors, pre-existing Leaflet chunk warning unchanged) |
| CI invariants | `bash scripts/ci-check-invariants.sh` | **PASS — exit 0** ("All ORCH-0640 invariant gates pass.") |
| Grep ai_approved (2 JSX) | `grep -n 'ai_approved' PlacePoolManagementPage.jsx SignalLibraryPage.jsx` | **PASS — 0 matches** |
| Grep aiCard (PlacePool) | `grep -n 'aiCard' PlacePoolManagementPage.jsx` | **PASS — 0 matches** |
| Grep handleApprove (PlacePool) | `grep -n 'handleApprove' PlacePoolManagementPage.jsx` | **PASS — 0 matches** |
| Negative-control T-CI-02 | Injected `ai_approved` in `mingla-admin/src/__tester_gate_check.tmp.jsx`, git add, run gate | **PASS — exit 1 with correct FAIL identification**; cleanup → exit 0 |

All 5 mandatory code gates PASS independently. Negative-control PROVES the extended CI gate catches admin-frontend dropped-column references.

---

## 8. Regression surface (5 checks per implementation report §11)

| Surface | Static status |
|---------|---------------|
| Browse Pool list view — place detail modal opens, Save succeeds, categories editable | **STATIC PASS** — editForm has 5 fields (name, price_tiers, seeding_category, is_active, ai_categories), all columns live; Save calls `admin_edit_place` RPC unchanged + a follow-up `.from("place_pool").update({ ai_categories })` — `ai_categories` column confirmed KEPT per drop migration header comment |
| Overview drill-down chain (country → city → category) | **STATIC PASS** — country RPC returns `is_servable_places/bounced_pct` (JSX consumes both); city RPC same; category RPC unchanged signature returning `place_count/photo_pct/avg_rating` (JSX L284 column label updated "AI Approved" → "Servable", cell renders `place_count`) |
| Map view 3-state filter | **STATIC PASS** — filter-state key `servableStatus`, 3 branches (servable/excluded/not_bounced) map to `.eq("is_servable", true/false)` / `.is("is_servable", null)` |
| Signal Library full workflow | **PARTIAL FAIL (F-01)** — city pick works, but CityPipelineHistory shows duplicate column data |
| Category coverage counts render as "X/13" | **STATIC PASS** — country drill-down column `category_coverage` returns INTEGER; JSX renders `${r.category_coverage \|\| 0}/13` — value bounded 0-13 per RPC logic |

---

## 9. Invariant preservation

| Invariant | Verdict | Evidence |
|-----------|---------|----------|
| I-POOL-ONLY-SERVING | **PRESERVED** | `grep card_pool mingla-admin/src/pages/{Place,Signal}*` → 0 matches; no new references introduced |
| I-BOUNCER-IS-QUALITY-GATE | **PRESERVED** | All 6 rewritten RPCs filter on `is_servable`; no admin-override RPC added (D-3 honored) |
| I-THREE-GATE-SERVING | **PRESERVED** | Serving path not touched |
| **I-COLUMN-DROP-CLEANUP-EXHAUSTIVE (NEW)** | **REGISTERED + ENFORCED** | Appended to registry at L134-181; CI script extension enforces gates 1-3; manual template documented |
| Constitutional #1 (no dead taps) | **PRESERVED** | "Approve" button removed entirely (not orphaned) |
| Constitutional #2 (one owner per truth) | **VIOLATED at F-01** | SignalLibrary duplicate column — REWORK REQUIRED |
| Constitutional #3 (no silent failures) | **IMPROVED** | Hidden Flaw #2 silent-zero fixed at L374 (but introduced F-01 duplicate — net improvement conditional on F-01 rework) |
| Constitutional #8 (subtract before adding) | **PRESERVED** | Net −65 JSX lines; aiCard state + handleApprove + approve modal + AI Classification Override block + AI Reason Input all deleted, not wrapped |

**One constitutional violation (#2) → automatic P1 finding F-01.**

---

## 10. Security scan

- All 6 rewritten RPCs preserve `IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active') THEN RAISE EXCEPTION` or equivalent at top of body. **No auth regression.**
- RLS policies not touched.
- No new external API calls.
- No frontend key exposure.
- No input validation changes.

**Security: no findings.**

---

## 11. Discoveries for orchestrator

- **ORCH-0646.D-1 (P3):** `r.last_ai_run` referenced at `SignalLibraryPage.jsx:353` but never returned by `admin_city_pipeline_status` RPC. Pre-existing silent no-op. Suggest deletion in a future cleanup pass. Not blocking ORCH-0646.
- **ORCH-0646.D-2 (P3):** `ai_reason`, `ai_primary_identity`, `ai_confidence` columns on `place_pool` are stale-data-only post-ORCH-0640 (no pipeline writes to them). They were NOT dropped by migration `20260425000004`. Consider a follow-up DROP COLUMN migration OR explicit documentation that they are soft-retired.

---

## 12. Post-PASS readiness

**NOT READY FOR CLOSE.**

F-01 (P1) must be fixed before CLOSE. Recommended rework: 2-line edit in `SignalLibraryPage.jsx` (see Finding §5 F-01 recommended fix). Estimated rework cycle: 5 minutes.

F-02 (P2 comment inaccuracy) and F-03 (P3 pre-existing silent no-op) are NON-BLOCKING for CLOSE; can be addressed in the F-01 rework pass for efficiency OR deferred to follow-up PRs.

**If user explicitly accepts the F-02 comment inaccuracy** (it's non-functional), CLOSE can fire with F-01 fixed only. Orchestrator decides.

---

## 13. Recommended next orchestrator action

1. Orchestrator writes implementor rework dispatch scoped to F-01 only (or F-01 + F-02 + D-1 if bundling).
2. Implementor applies 2-line SignalLibrary fix.
3. Tester RETEST (cycle 2 of 2 — at escalation threshold if this retest fails).
4. On RETEST PASS: user runs `supabase db push` + admin deploy + browser smoke T-UI-01..08 → orchestrator fires CLOSE protocol.

---

## 14. Retest cycle tracking

- **Cycle:** 1 (first QA pass on ORCH-0646)
- **Escalation threshold:** 2 retest cycles. If cycle 2 also fails, orchestrator should escalate to full architect review rather than a third implementor pass.

---

**END OF QA REPORT**
