# INVESTIGATION — ORCH-0646: ai_approved leftovers blocking admin Place Pool + Signal Library

**Date:** 2026-04-23 late-night
**Investigator:** mingla-forensics
**Severity:** S1 (admin core flows broken — cannot load Place Pool or Signal Library cities)
**Classification:** regression · ORCH-0640 cleanup gap (DB-side missing-migration + JSX-side incomplete scrub)
**Confidence:** HIGH on root causes (six-field evidence proven from disk); MEDIUM on live-DB application status (inferred from World Map narrative — verification SQL provided for implementor to confirm before fix).

---

## 1. Layman impact

When you click into Place Pool or Signal Library in the admin, the page errors out. Both errors trace to the same root: ORCH-0640 (the "Great Demolition") dropped the `ai_approved` column from the database on 2026-04-23 and rewrote the 14 admin functions that touched it — but **six other admin functions and dozens of admin frontend lines still reference the dropped column**. The earlier "fix" was the column drop itself; the cleanup was incomplete on two surfaces.

- **Surface A (DB side):** 6 admin RPCs still in production reference either `pp.ai_approved` (the dropped column) or `mv.ai_approved` (the dropped projection on the rebuilt MV). Each one throws `column ... does not exist` when called.
- **Surface B (JSX side):** `PlacePoolManagementPage.jsx` and `SignalLibraryPage.jsx` still query `place_pool.ai_approved` directly via `.select()`, `.eq()`, `.is()` — and write `ai_approved: true` in the "Approve" handler. The page's inline editor was scrubbed (proven by the existing `ORCH-0640 ch08` comment at line 409); other surfaces were missed.

Both surfaces are in production right now (column drop + MV rebuild + 14 RPC rewrites are all applied per World Map cutover narrative). User is hitting live errors, not local-only artifacts.

---

## 2. Symptom Summary

**Reported by user:** "Whenever I try to access Place Pool or Signal Library, I see an error. It seems we already fixed it but I don't know why I keep seeing it."

**Errors observed (verbatim):**
1. `Couldn't load cities` / `column pp.ai_approved does not exist`
2. `column "ai_approved" does not exist`

**Expected behavior:** Place Pool and Signal Library load cities + place data.
**Actual behavior:** Both pages 500 on city load.

**Reproduction:** Open admin → click Place Pool tab OR click Signal Library tab → both fail at first network round-trip (city picker or pool overview).

---

## 3. Investigation Manifest

Files read in trace order (symptom → component → service → DB → migration chain):

| # | File | Layer | Why read |
|---|------|-------|----------|
| 1 | `mingla-admin/src/pages/SignalLibraryPage.jsx` (L720-859) | Component | Find which RPC the failing "Couldn't load cities" path calls |
| 2 | `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (L125-414, L1070-1280, L2270-2310, L2425-2475) | Component | Find every `.rpc(…)` and direct `.from("place_pool")` query + ai_approved JSX site |
| 3 | `supabase/migrations/20260425000004_orch_0640_drop_ai_approved_columns.sql` | Schema | Confirm column drop |
| 4 | `supabase/migrations/20260425000003_orch_0640_rebuild_admin_place_pool_mv.sql` | Schema | Confirm MV rebuilt without ai_approved |
| 5 | `supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql` | Code (DB) | Inventory which RPCs were rewritten by ORCH-0640 |
| 6 | `supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql` (L170-475) | Code (DB) | Latest definition of `admin_place_category_breakdown`, `admin_place_photo_stats`, `admin_refresh_place_pool_mv` |
| 7 | `supabase/migrations/20260418000002_orch0481_rework_count_fix.sql` | Code (DB) | Latest definition of `admin_place_pool_overview`, `admin_place_country_overview`, `admin_place_city_overview` |
| 8 | `supabase/migrations/20260418000003_orch0481_cron_fix.sql` | Code (DB) | Confirm cron-fix did not redefine any of the suspect RPCs |
| 9 | `supabase/migrations/20260409200001_optimize_city_picker_rpc.sql` | Code (DB) | Latest definition of `admin_city_picker_data` (THE source of `pp.ai_approved` error) |
| 10 | `supabase/migrations/20260320200000_admin_pool_management.sql` (L170-225) | Code (DB) | Latest definition of `admin_city_place_stats` (verified clean) |
| 11 | `Mingla_Artifacts/WORLD_MAP.md` (L1-50) + `MASTER_BUG_LIST.md` (L1-25) | Docs | Confirm ORCH-0640 status = CUTOVER APPLIED in production |
| 12 | Grep across all migrations: `pp.ai_approved`, `admin_place_*`, `admin_city_*` | Code (DB) | Rule out any later-superseding migration |

**Migration chain rule applied:** for every suspect RPC, grepped ALL migrations for the function name, sorted chronologically, read the LATEST. No early-migration claims presented as current truth.

---

## 4. Findings (Five-Layer Cross-Check)

### Five-Layer Truth Map

| Layer | What it says |
|-------|--------------|
| **Docs** | World Map (2026-04-23 evening): "ORCH-0640 STATUS: CUTOVER APPLIED. DB + edge functions live. … place_pool.ai_approved dropped ✓ … admin_place_pool_mv rebuilt with is_servable+has_photos projections ✓" |
| **Schema** | `place_pool.ai_approved` DROPPED (migration `20260425000004`); `admin_place_pool_mv` rebuilt without `ai_approved` (migration `20260425000003`); replacement = `is_servable` + `bouncer_validated_at` + `bouncer_reason` |
| **Code (DB)** | Rewrite migration `20260425000014` covered 14 admin RPCs. **6 admin RPCs were not rewritten and still reference the dropped column / MV projection.** They remain in production unchanged from their April 18 definitions. |
| **Code (JSX)** | `PlacePoolManagementPage.jsx` was partially scrubbed (inline editor at L411 acknowledges drop with `ORCH-0640 ch08` comment). **22 grep-confirmed JSX sites still reference `ai_approved`** across selects, filters, renders, write paths, and useState init. |
| **Runtime** | User confirms live failure on both pages. Error strings match exactly what the broken RPCs and broken JSX queries would produce. |
| **Data** | (Not directly inspected — irrelevant to this bug class. The data exists; the code can't read it.) |

**Contradiction:** Docs say ORCH-0640 CLOSED Grade A. Code (DB + JSX) shows demolition-side complete but cleanup-side incomplete. The "Grade A" closure was based on **mobile serving path** verification (5/5 device smoke on swipe/save) and **38-TC tester report** focused on mobile. Admin Place Pool + Signal Library were not in the tester's scope (Mingla_Artifacts/reports/QA_ORCH-0640_DEMOLITION_AND_REBUILD_REPORT.md focused on serving). The CLOSE protocol's coverage gap is itself a process flaw — see Discovery D-9.

---

### 🔴 Root Cause #1: `admin_city_picker_data` RPC body still references `pp.ai_approved`

| Field | Value |
|-------|-------|
| **File + line** | `supabase/migrations/20260409200001_optimize_city_picker_rpc.sql:52` (latest definition; verified by grep across 36 ai_approved migrations + chain inspection) |
| **Exact code** | `(SELECT COUNT(*) FROM place_pool pp WHERE pp.city_id = sc.id AND pp.is_active AND pp.ai_approved = true) AS ai_approved_places` |
| **What it does** | Returns city picker rows aliased `pp` on `place_pool`, filters by `pp.ai_approved = true`. Postgres throws `column pp.ai_approved does not exist` because column was dropped on 2026-04-25. |
| **What it should do** | Either replace with `pp.is_servable = true` and rename returned column to `is_servable_places`, OR DROP the function and migrate callers to `admin_place_pool_country_list` / `admin_place_pool_city_list` (the new ORCH-0640 sibling functions). |
| **Causal chain** | User opens Signal Library → `useEffect` at `SignalLibraryPage.jsx:730` calls `supabase.rpc("admin_city_picker_data")` at L736 → RPC executes → SELECT inside RPC body references `pp.ai_approved` → Postgres errors → `rpcError` returned to JSX → `setCitiesError(err.message)` at L749 → `<AlertCard … title="Couldn't load cities">` renders at L834. Same RPC also called by `PlacePoolManagementPage.jsx:2431`. |
| **Verification step** | (a) On live DB: `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='admin_city_picker_data';` — confirm body contains `pp.ai_approved`. (b) Live: `SELECT * FROM admin_city_picker_data() LIMIT 1;` — confirm error matches user report verbatim. |

**Classification:** 🔴 Root Cause (direct cause of Error #1).

---

### 🔴 Root Cause #2: 5 admin RPCs reference `mv.ai_approved` on the rebuilt MV that no longer projects it

| RPC | Latest Definition | `mv.ai_approved` Refs | Called By |
|---|---|---|---|
| `admin_place_pool_overview` | `20260418000002_orch0481_rework_count_fix.sql:203-315` | 21 references (L243-301) | `PlacePoolManagementPage.jsx:176` |
| `admin_place_country_overview` | `20260418000002:53-117` | 7 references (L77-115) | `PlacePoolManagementPage.jsx:184` |
| `admin_place_city_overview` | `20260418000002:138-193` | 8 references (L162-191) | `PlacePoolManagementPage.jsx:182` |
| `admin_place_category_breakdown` | `20260418000001_orch0481_admin_mv_layer.sql:282-319` | 1 reference (L312: `mv.ai_approved = true`) | `PlacePoolManagementPage.jsx:177, 1996` |
| `admin_place_photo_stats` | `20260418000001:448-474` | 1 reference (L472: `mv.ai_approved = true`) | `PlacePoolManagementPage.jsx:1422` |

**What each does:** All five RPCs query `admin_place_pool_mv mv` and filter/aggregate on `mv.ai_approved`.

**What they should do:** Reference `mv.is_servable` (the ORCH-0640 replacement column added by `20260425000003:56`). Returned column names that include "ai_approved" (e.g., `ai_approved_places`, `ai_approved_count`) should rename to `is_servable_places` / `is_servable_count` for callsite clarity, or keep the legacy field names if minimizing JSX rename surface (decision belongs in the spec, not this investigation).

**Causal chain:** ORCH-0640 ch03 dropped+recreated `admin_place_pool_mv` with `is_servable` replacing `ai_approved`. `DROP MATERIALIZED VIEW … CASCADE` only drops dependent DB objects (views, rules) — **PL/pgSQL function bodies are NOT dropped by CASCADE**, they are left with stale references that error at next call. The 5 functions above were left with stale `mv.ai_approved` references because no migration in the ORCH-0640 cutover bundle rewrote them.

**Verification step:** On live DB, for each function: `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='<name>';` — confirm body contains `mv.ai_approved`. Then `SELECT * FROM <function>(<args>);` — confirm error `column mv.ai_approved does not exist`.

**Classification:** 🔴 Root Cause (Error #2 surfaces from these AND from the JSX direct queries below; both layers fail simultaneously).

---

### 🔴 Root Cause #3: `PlacePoolManagementPage.jsx` direct queries on `place_pool.ai_approved`

The JSX issues `.from("place_pool")` queries with explicit references to the dropped column. These are pure client-side Supabase JS calls; they do not go through any RPC and bypass the partial RPC rewrite entirely.

| File:Line | Type | Exact code | What breaks |
|---|---|---|---|
| `PlacePoolManagementPage.jsx:1077` | `.select(...)` | `.select("id, name, lat, lng, rating, ai_categories, seeding_category, is_active, stored_photo_urls, ai_approved")` | Postgrest 400: `column "ai_approved" does not exist` (Error #2 verbatim) |
| `PlacePoolManagementPage.jsx:1079` | `.eq()` | `.eq("ai_approved", true)` | Same error |
| `PlacePoolManagementPage.jsx:1229` | `.eq()` | `.eq("ai_approved", true)` (filters.aiStatus="validated" branch) | Same error |
| `PlacePoolManagementPage.jsx:1230` | `.eq()` | `.eq("ai_approved", false)` ("rejected" branch) | Same error |
| `PlacePoolManagementPage.jsx:1231` | `.is()` | `.is("ai_approved", null)` ("pending" branch) | Same error |
| `PlacePoolManagementPage.jsx:2280` | `.eq()` | `.eq("ai_approved", false)` (`fetchRejected`) | Same error |
| `PlacePoolManagementPage.jsx:2295-2298` | `.update()` | `.update({ ai_approved: true, ai_categories: […], ai_validated_at: new Date()… })` (`handleApprove`) | Postgrest 400 on TWO dropped columns (`ai_approved` + `ai_validated_at`) |

**Causal chain:** User opens PlacePoolManagementPage → list/map/rejected views all hit place_pool directly with the dropped column → Supabase JS receives Postgrest error → `addToast(error.message)` at L1236 surfaces verbatim → user sees Error #2.

**Why partially scrubbed already:** L411 inline editor was correctly rewritten under `ORCH-0640 ch08` to write only `ai_categories` (proof: comment at L409-410 explicitly names dropped columns). The author missed list/map/filter/rejected/handleApprove sites in the same file.

**Classification:** 🔴 Root Cause (direct cause of Error #2 instances triggered from the page list and filter paths).

---

### 🟠 Contributing Factor #1: ORCH-0640 cutover validation skipped admin pages

The ORCH-0640 tester report (per World Map narrative) verified mobile serving + 5/5 device smoke. Admin Place Pool + Signal Library were not in the tester's behavior matrix. The CLOSE protocol marked Grade A on Apr 23 night without an admin smoke test. This is why both pages were broken at CLOSE without anyone noticing for ~hours.

**Evidence:** World Map line 5 enumerates ORCH-0640 deliverables — every artifact mentioned is mobile-serving or DB-schema. No admin-page smoke test mentioned. Tester report at `outputs/QA_ORCH-0640_DEMOLITION_AND_REBUILD_REPORT.md` (referenced but not re-read here in scope) per narrative covered 38 TCs but admin-page specific TCs are not enumerated in the World Map summary.

**Classification:** 🟠 Contributing Factor (made the gap possible to ship undetected).

---

### 🟡 Hidden Flaw #1: `admin_place_pool_city_list` writes to archived `card_pool`

While verifying the rewrite migration, found `admin_place_pool_city_list` in `20260425000014:480-519` queries `public.card_pool` for `existing_cards` and `ready_to_generate` projections (L504-513). Per ORCH-0640 D-13 / archive schedule, `card_pool` was archived (renamed `_archive_card_pool`) on 2026-04-23. This RPC should fail when called — but it's not part of the user's reported error.

**Why this matters:** It will fail the next time PlacePoolManagementPage triggers a per-country card-generate workflow. May already be failing silently if an admin has tried to generate cards in the last few hours.

**Verification step:** On live DB: `SELECT * FROM admin_place_pool_city_list('US');` — expect `relation "card_pool" does not exist` OR `relation "_archive_card_pool" returned`. If it errors, file as **ORCH-0646.D-1** for inclusion in the same fix migration.

**Classification:** 🟡 Hidden Flaw (not causing today's reported symptom, will cause a future one).

---

### 🟡 Hidden Flaw #2: SignalLibraryPage renders `r.ai_approved_count` from a rewritten RPC that no longer returns it

`SignalLibraryPage.jsx:374` does `<StageCell done={Number(r.ai_approved_count ?? 0)} total={…} />`. The data source is `admin_city_pipeline_status` (called at L292). Per the rewrite migration `20260425000014:73-77`, this RPC's return type was changed: `ai_approved_count` was renamed to `is_servable_count`. The JSX still reads `r.ai_approved_count` → silently `undefined` → `Number(undefined ?? 0) = 0` → "0/N" rendered for every city.

**Not throwing**, just silently reporting zero approved places everywhere. Misleading admin dashboard.

**Classification:** 🟡 Hidden Flaw (silent data corruption, not error, not detected by the orchestrator's grep gate that only catches dropped-table writes).

---

### 🟡 Hidden Flaw #3: Dead `aiCard` branches in inline editor

`PlacePoolManagementPage.jsx:355` declares `aiCard` state. `L379` always sets `setAiCard(null)` (with comment "card_pool archived — aiCard lookup retired"). `L386, 390, 513` still reference `aiCard?.X` — these branches are now dead code (always null fallback). Not breaking anything but leaves stale logic that next reader will misinterpret.

**Classification:** 🟡 Hidden Flaw (pattern violation — incomplete cleanup).

---

### 🔵 Observation #1: 3 stale comments referencing `ai_approved`

`PlacePoolManagementPage.jsx:1495, 1799, 1809` are comments only. No runtime impact. Worth scrubbing for documentation hygiene but lowest priority.

**Classification:** 🔵 Observation.

---

## 5. Blast Radius Map

| Surface | Affected | Notes |
|---------|----------|-------|
| Admin: Place Pool Management page | YES — fully broken | List, map, rejected tab, filter dropdown, approve handler, country/city pickers — all error |
| Admin: Signal Library page | YES — city load broken | Cannot select a city; everything downstream (Bouncer run, scorer run) gated on city selection |
| Admin: Photo Pool Management page | UNKNOWN — out of scope | grep returned `PhotoPoolManagementPage.jsx` for `ai_approved` matches; not investigated. Recommend separate audit if user reports breakage. |
| Admin: AI Validation page | UNKNOWN — out of scope | `card_pool.ai_approved` was a sibling concept; ai-validation flow was archived per ORCH-0640. Page may be broken or intentionally retired. |
| Mobile serving path | NOT AFFECTED | ORCH-0640 mobile-side cutover verified by tester + 5/5 device smoke |
| Solo / collab parity | N/A | Admin only; no mobile mode involved |
| RLS / security | NOT AFFECTED | All affected RPCs preserve `is_admin_user()` auth check at top of body |
| Cache / query keys | N/A | Admin uses no React Query — direct Supabase JS calls |

**Invariant violations:**
- **I-POOL-ONLY-SERVING** (registered 2026-04-23 by ORCH-0640) — preserved (no impact)
- **I-BOUNCER-IS-QUALITY-GATE** (registered same day) — preserved at runtime; admin UI still labels things "AI Approved" instead of "Bouncer Approved" (cosmetic invariant drift)
- **I-THREE-GATE-SERVING** — preserved (no impact)
- **NEW invariant suggested:** `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` — every column drop migration must be paired with an exhaustive grep gate covering ALL admin frontend files + ALL RPC bodies, not just mobile services. (See Discovery D-9.)

---

## 6. Migration Application Status (D-3)

**Inferred from World Map narrative; live-DB verification SQL provided for implementor:**

| Migration | Cutover Status | Verification SQL |
|---|---|---|
| `20260425000003_orch_0640_rebuild_admin_place_pool_mv.sql` | APPLIED (per World Map "admin_place_pool_mv rebuilt with is_servable+has_photos projections ✓") | `SELECT column_name FROM information_schema.columns WHERE table_name='admin_place_pool_mv' AND table_schema='public';` — expect `is_servable` present, `ai_approved` absent. |
| `20260425000004_orch_0640_drop_ai_approved_columns.sql` | APPLIED (per World Map "place_pool.ai_approved dropped ✓") | `SELECT column_name FROM information_schema.columns WHERE table_name='place_pool' AND column_name='ai_approved';` — expect 0 rows. |
| `20260425000014_orch_0640_rewrite_place_admin_rpcs.sql` | APPLIED (the migration that's IN the cutover; would have failed cutover if not pushed since later migrations depend on its function rewrites) | `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='admin_city_pipeline_status';` — expect to find `is_servable_count`, no `ai_approved`. |

**Missing migration (the actual gap):** No migration in the codebase covers the 6 stale RPCs identified in §4 Root Cause #1 + #2. The fix requires authoring a new migration that either (a) `CREATE OR REPLACE`s each function with `is_servable` substitutions, or (b) `DROP`s the legacy functions and migrates JSX callers to the new ORCH-0640 sibling functions (`admin_place_pool_country_list`, `admin_place_pool_city_list`, `admin_pool_category_health`, `admin_pool_category_detail`).

**Implementor must verify on live DB before fix:** All three SQL probes above. If any contradicts the inferred state (e.g., column NOT actually dropped → cutover was rolled back or never applied), the fix scope changes.

---

## 7. Fix Strategy (direction only — not a spec, not code)

The implementor should produce ONE migration + ONE JSX scrub. Two clean directions exist; the orchestrator/user should pick before spec is written:

**Direction A — Rewrite to is_servable, preserve all callsites and field names:**
- New migration: `CREATE OR REPLACE FUNCTION` for each of the 6 broken RPCs. Substitute `pp.ai_approved` → `pp.is_servable`, `mv.ai_approved` → `mv.is_servable`. Keep return column names unchanged (e.g., `ai_approved_places` stays `ai_approved_places` but counts is_servable rows).
- JSX scrub: Replace `.eq("ai_approved", true)` → `.eq("is_servable", true)` etc. in all 7 direct query sites. Field names stay; only the underlying column changes.
- **Pro:** Smallest diff. JSX render code keeps working.
- **Con:** Misleading naming forever. Field labeled "AI Approved" actually means "Bouncer Approved." Constitutional drift.

**Direction B — Rename + DROP legacy, migrate callers:**
- New migration: `DROP FUNCTION` the 6 legacy RPCs (since their return signatures contain `ai_approved_*` field names). Migrate JSX callers to `admin_place_pool_country_list` / `admin_place_pool_city_list` / `admin_pool_category_*` (the ORCH-0640 sibling functions already in the rewrite migration).
- JSX scrub: Update all `r.ai_approved_*` → `r.is_servable_*` rename. Replace `.eq("ai_approved", X)` → `.eq("is_servable", X)`. Update column labels in the UI ("AI Approved" → "Bouncer Approved" or just "Approved").
- **Pro:** Naming aligns with reality. No legacy debt. Constitutional cleanliness.
- **Con:** Larger JSX diff. Risk of missing a site.

**Recommended:** Direction B. The reason ORCH-0640 happened was to demolish the parallel quality gates and unify on the Bouncer. Keeping field names that say "ai_approved" perpetuates the lie ORCH-0640 was meant to end. The JSX surface is bounded (~22 sites in 2 files); the diff is reviewable.

**Either direction must also handle:**
- The 3-state filter dropdown at `PlacePoolManagementPage.jsx:1229-1231`: `is_servable` is boolean nullable (TRUE/FALSE/NULL = "approved"/"rejected"/"not yet judged"). Three-state semantics survive the rename — see Discovery D-2.
- The "Rejected places" tab + "Approve" button at L2275-L2310: previously wrote `ai_approved: true`. With Bouncer as authoritative gate, admin override of Bouncer judgment is a product question. Recommend (a) keep tab as read-only "Bouncer-rejected viewer" OR (b) add `admin_override_servable(p_id, p_servable boolean, p_reason text)` RPC. Filed as Discovery D-3.
- Hidden Flaw #2 (SignalLibrary `r.ai_approved_count` → `r.is_servable_count` rename) must be in the same scrub pass.
- Hidden Flaw #1 (`admin_place_pool_city_list` writing to archived `card_pool`) should be addressed in the same migration (verify first via live DB; rewrite query body to use serving RPCs or drop the projection).

---

## 8. Regression Prevention Requirements

Whatever the spec author writes, it MUST include:

1. **Live-DB verification gate before CLOSE.** Run `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname IN ('admin_city_picker_data', 'admin_place_pool_overview', 'admin_place_country_overview', 'admin_place_city_overview', 'admin_place_category_breakdown', 'admin_place_photo_stats');` and grep output for `ai_approved` — expect zero matches.
2. **Admin-page smoke test added to ORCH-0640 retest checklist.** Click Place Pool. Click Signal Library. Both load without error. Both show non-zero counts. Add as new test cases in any future column-drop tester pass.
3. **CI grep gate extension.** `scripts/ci-check-invariants.sh` already exists (per ORCH-0640). Extend to grep `mingla-admin/src/pages/` for `ai_approved` AND for any other dropped column name. Exit non-zero if found.
4. **Constitutional invariant added:** `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` — column drops require admin-frontend grep + RPC body grep before the drop migration is considered ready.

---

## 9. Discoveries for Orchestrator

Side issues found during investigation, NOT in scope for this fix:

- **ORCH-0646.D-1:** `admin_place_pool_city_list` (in rewrite migration `20260425000014:480-519`) queries archived `card_pool` for `existing_cards` and `ready_to_generate` projections. Likely broken at runtime when called. Verify with `SELECT * FROM admin_place_pool_city_list('US');`. Bundle into the same fix migration if confirmed broken.
- **ORCH-0646.D-2:** Three-state `aiStatus` filter (`PlacePoolManagementPage.jsx:1229-1231`) needs explicit user-facing rename: "Validated/Rejected/Pending" → "Bouncer-Servable/Bouncer-Excluded/Not Yet Bounced." Pure UX copy decision, but should be made deliberately, not silently kept as "AI Approved."
- **ORCH-0646.D-3:** "Rejected places" tab + "Approve" handler (`PlacePoolManagementPage.jsx:2275-L2310`) needs product decision: (a) read-only viewer of Bouncer-rejected places, OR (b) add `admin_override_servable(p_id uuid, p_servable boolean, p_reason text)` RPC + audit trail in `place_admin_actions`. Affects spec scope materially.
- **ORCH-0646.D-4:** Dead `aiCard` branches at `PlacePoolManagementPage.jsx:355, 379, 386, 390, 513`. Always null per L379. Three render branches dead. Subtract before adding (constitutional #8) — should be deleted in the same scrub.
- **ORCH-0646.D-5:** Stale comments at `PlacePoolManagementPage.jsx:1495, 1799, 1809`. No runtime impact but documents wrong system. Cosmetic.
- **ORCH-0646.D-6:** `PhotoPoolManagementPage.jsx` appeared in grep for `ai_approved`. NOT investigated in this scope. May have parallel issues. Recommend separate quick scan.
- **ORCH-0646.D-7:** `admin_city_place_stats` (called at `PlacePoolManagementPage.jsx:2454`) is clean (no ai_approved reference, verified at `20260320200000:179-224`). No action needed; documenting verification for future investigators.
- **ORCH-0646.D-8:** `admin_refresh_place_pool_mv` (called at `PlacePoolManagementPage.jsx:214`) is clean (just refreshes MV, verified at `20260418000001:179-203`). No action needed.
- **ORCH-0646.D-9 (process gap):** ORCH-0640 CLOSE Grade A was awarded without admin-page smoke test. Tester behavior matrix focused on mobile serving. This gap allowed ORCH-0646 to ship-and-break for hours before the user noticed. Recommend post-mortem invariant: `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` registered, CI grep gate extended (see §8 item 3).

---

## 10. Confidence Levels per Finding

| Finding | Confidence | What would raise it |
|---|---|---|
| Root Cause #1 (`admin_city_picker_data`) | **HIGH** | Live `pg_get_functiondef` confirms the body — provided as verification step. Already six-field proven from disk. |
| Root Cause #2 (5 RPCs with `mv.ai_approved`) | **HIGH** | Same — disk-proven; live verification SQL provided. |
| Root Cause #3 (JSX direct queries) | **HIGH** | Grep + line-by-line read of all 22 sites. Disk-only proof but no live-DB ambiguity possible — the .from("place_pool") calls fire on every page render. |
| Migration application status (D-3) | **MEDIUM** | Inferred from World Map narrative; not personally verified against live DB. Implementor must run the 3 verification queries in §6 before applying any fix migration. If the inference is wrong (e.g., cutover was rolled back), scope changes. |
| Hidden Flaw #1 (`admin_place_pool_city_list` writes archived table) | **MEDIUM** | Disk-proven RPC body reads `card_pool`; World Map says card_pool was archived to `_archive_card_pool`. Live verification needed to confirm whether table was renamed (lookup fails) vs aliased (lookup succeeds via view). |
| Contributing Factor #1 (admin-page smoke gap) | **HIGH** | World Map narrative explicitly enumerates mobile + 5/5 device smoke; admin pages absent from CLOSE evidence. |
| Discovery D-3 (admin override RPC question) | **MEDIUM** | Pure product decision. No code evidence either way; the "right" answer depends on who in the org owns Bouncer override authority — not determinable from forensics. |

---

## 11. Recommended Next Step

Hand this report to the orchestrator. Orchestrator should:

1. Pick **Direction A** or **Direction B** from §7 (recommend B — clean rename).
2. Decide on **D-3** (admin override of Bouncer — keep tab read-only OR add override RPC).
3. Dispatch `/mingla-forensics` SPEC mode (or directly `/mingla-implementor` if scope is small enough) with:
   - The chosen direction
   - The chosen D-3 disposition
   - Scope boundaries (this report covers Place Pool + Signal Library only; PhotoPool deferred per D-6)
   - Hidden Flaw #1 + #2 must be in the same fix pass (preserves constitutional #8 "subtract before adding")
   - Regression Prevention requirements from §8 are non-negotiable

Implementor should NOT begin until the live-DB verification SQL in §6 has been run by user/orchestrator and results match assumptions.

---

**END OF INVESTIGATION REPORT**
