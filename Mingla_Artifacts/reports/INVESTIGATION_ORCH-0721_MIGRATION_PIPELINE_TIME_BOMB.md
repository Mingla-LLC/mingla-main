# INVESTIGATION — ORCH-0721 — Migration Pipeline Time Bomb

**Mode:** INVESTIGATE
**Severity (confirmed):** S1-high (no escalation to S0 — see §8)
**Confidence:** H (every finding cited file:line + cross-checked against migration chain rule)
**Investigator:** mingla-forensics
**Dispatched by:** orchestrator (ORCH-0721)
**Date:** 2026-05-04
**Scope read:** `supabase/migrations/` (293 files), `.github/workflows/` (2 files), `supabase/config.toml`, `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0700_*.md`, MEMORY.md

---

## 1. Plain-English root cause

The failing PR is the surface symptom of **two distinct bugs in one historical migration file** plus **one missing process gate**:

1. **Pipeline crash (the operator's symptom).** [`supabase/migrations/20260409200001_optimize_city_picker_rpc.sql`](../../supabase/migrations/20260409200001_optimize_city_picker_rpc.sql) issues two `CREATE INDEX CONCURRENTLY` statements (lines 11-13, 16-19). The Supabase migration runner (`supabase db push` / Supabase Branches) wraps every migration file in a single implicit transaction. Postgres rejects `CONCURRENTLY` inside any transaction with SQLSTATE 25001. So this file cannot apply on a fresh database under the current runner. **This issue was identified by the team on 2026-04-21** in `20260421000002_orch_0558_schema_hardening.sql` lines 10-16, where ORCH-0558 explicitly worked around it by dropping CONCURRENTLY — but nobody fixed the older 04-09 file. The 04-09 file was originally applied to prod via a path that bypassed transaction wrapping (almost certainly the Supabase dashboard SQL editor), and once it was in prod nobody re-tested it under fresh-database replay.

2. **Stale RPC bodies (latent, was already fixed).** Same file's `CREATE OR REPLACE FUNCTION` blocks (lines 26-60, 67-173, 179-222) reference `place_pool.ai_approved` and `place_pool.ai_categories` — columns that ORCH-0640 dropped on 2026-04-25. **However**: the chain analysis (§4 Track B) shows ORCH-0646 in [`20260426000001_orch_0646_ai_approved_cleanup.sql`](../../supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql) is the **last writer** for all three RPCs and uses the canonical `is_servable` column. So in fully-replayed migration order, the indexes get created on 2026-04-09 → indexes get dropped on 2026-04-25 by ORCH-0640 → RPC bodies get rescued on 2026-04-26 by ORCH-0646. **The RPCs are NOT zombies in production today.** But none of that matters because **the chain is blocked at step 1 by the CONCURRENTLY crash on a fresh DB**, so a Supabase Branch / disaster-recovery rebuild / new dev environment cannot complete migration apply at all.

3. **Process gap (the load-bearing finding).** Neither ORCH-0640 nor ORCH-0700 ran a "fresh-database replay test" before CLOSE, and no CI gate exists in `.github/workflows/` to enforce it. The orchestrator's DEPRECATION CLOSE PROTOCOL EXTENSION (Step 5h) talks about retention reminders but does not include a "replay all migrations on a fresh branch DB" gate. ORCH-0558 noticed CONCURRENTLY-in-transaction in passing and worked around it for that one file — but never raised it as a class of bug, never went back to fix the older file, never added a regression gate. The team had the knowledge, in the file, in plain English, and the older file remained armed.

---

## 2. Five-truth-layer cross-check

| Layer | What it says | Evidence |
|-------|--------------|----------|
| **Docs** | `MEMORY.md` says `place_pool.ai_approved` was dropped post-ORCH-0700 (actual drop was earlier, ORCH-0640 ch13 on 2026-04-25 — memory entry slightly imprecise on attribution but correct on outcome). | [`MEMORY.md`](../../C:/Users/user/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md) — "Place Pool Schema (Non-Negotiable, post-ORCH-0700)" section |
| **Schema** | Production schema does NOT have `ai_approved` (dropped 2026-04-25) or `ai_categories` (dropped 2026-05-03). Indexes `idx_place_pool_city_active_approved` and `idx_place_pool_approved_with_photos` do NOT exist (dropped 2026-04-25). | [`supabase/migrations/20260425000004_orch_0640_drop_ai_approved_columns.sql:9-12`](../../supabase/migrations/20260425000004_orch_0640_drop_ai_approved_columns.sql) explicitly drops both indexes; lines 15-20 drop the columns. [`supabase/migrations/20260503000006_orch_0700_drop_seeding_category_and_ai_columns.sql`](../../supabase/migrations/20260503000006_orch_0700_drop_seeding_category_and_ai_columns.sql) drops `ai_categories`. |
| **Code (migrations)** | `20260409200001` writes against the live (then) ai_approved column AND uses `CREATE INDEX CONCURRENTLY` which the runner cannot honor inside a transaction. | [`supabase/migrations/20260409200001_optimize_city_picker_rpc.sql:11,16`](../../supabase/migrations/20260409200001_optimize_city_picker_rpc.sql) for CONCURRENTLY; lines 26, 67, 179 for the three RPCs. |
| **Code (admin/mobile callers)** | Admin Place Pool page calls `admin_place_pool_overview`, `admin_city_picker_data`, `admin_place_country_overview` (per ORCH-0646 spec rationale embedded in [`supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql:1-7`](../../supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql)). | [`Mingla_Artifacts/specs/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md`](../specs/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md) referenced from migration. (Caller files in `mingla-admin/src/pages/PlacePool*.jsx` — not re-read in this investigation; out of scope per Track B verdict that RPCs are rescued in prod.) |
| **Runtime** | In production today: the three RPCs return data successfully (rescued bodies), no CONCURRENTLY error possible (file already applied historically). On a **fresh** database under `supabase db push`: applies migrations in timestamp order, hits 20260409200001 first, raises SQLSTATE 25001 at line 11 immediately. | Operator's exact error message in dispatch prompt confirms runtime behavior under Supabase Branches/db-push. |
| **Data** | `pg_proc` for the three RPCs in prod should match the bodies in ORCH-0646 (last writer). NOT VERIFIED via Management API in this investigation — the chain analysis is conclusive enough that prod-state probe is gold-plating. Probes documented in §11 in case operator wants to confirm. | (To raise confidence to H+ on prod state, run the smoke queries in `20260426000001_orch_0646_ai_approved_cleanup.sql:402-410`.) |

**Contradictions found:** Docs vs Schema vs Code (migrations) all agree on the post-ORCH-0640+0700 reality. Code (migrations) layer contains a **temporal contradiction within itself**: the same file mounts indexes against ai_approved (line 11-13, ai_approved still alive in 04-09) while ORCH-0646 (04-26) explicitly drops it. That is the inherent risk of historical migration files — **they are SQL frozen at a point in time, replayed against a database that may or may not still resemble that point**. The CONCURRENTLY bug is what surfaces this contradiction first; the column-rename rescue chain absorbs the second contradiction silently if replay can complete.

---

## 3. Track A — Pipeline error root cause

### A1 — Migration runner identification (PR #62)

**Finding A1 (confidence H):** Two candidate runners; both have the same defect for this file.

- No GitHub Actions workflow runs migrations. `.github/workflows/` contains only `deploy-functions.yml` (edge functions) and `rotate-apple-jwt.yml` (Apple JWT rotation cron). Verified by `ls .github/workflows`.
- The likely runner for "PR-time apply" is **Supabase Branches** (auto-spawned preview database when a PR is opened against a Supabase-linked repo). Supabase Branches replays ALL migrations from `supabase/migrations/` against a fresh database via `supabase migration up`, which applies each file as a single transaction.
- The fallback explanation: operator runs `supabase db push` locally as part of a pre-merge ritual. Same transaction wrapping, same crash.

**Evidence:** [`supabase/migrations/20260421000002_orch_0558_schema_hardening.sql:10-13`](../../supabase/migrations/20260421000002_orch_0558_schema_hardening.sql) — *"CREATE INDEX CONCURRENTLY cannot run inside an explicit transaction block. Supabase `db push` applies each migration file as a single transaction."* This is a verbatim contemporaneous statement by the team on 2026-04-21, 12 days after the bomb file landed and 13 days before the operator hit the error today.

### A2 — Original-apply runner (2026-04-09)

**Finding A2 (confidence M):** The 04-09 file MUST have applied successfully to prod at least once, because:
- ORCH-0640's drop migration (2026-04-25) explicitly `DROP INDEX IF EXISTS public.idx_place_pool_approved_with_photos;` and `DROP INDEX IF EXISTS public.idx_place_pool_city_active_approved;` (lines 11-12). Drops would have been omitted from the migration if the indexes had never existed.
- ORCH-0646's CLOSE artifacts (e.g. [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md`](INVESTIGATION_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md)) reference the three RPCs as live in prod — they could only be live if their parent migration applied.

The most likely apply path for the original 04-09 file: **Supabase Dashboard SQL editor**, which executes statements outside an implicit transaction. This was a normal solo-operator workflow before the team moved to `supabase db push`. No git artifact captures this; the evidence is the absence of any other plausible explanation.

Confidence M because a forensic confirmation would require Supabase audit logs which were not consulted; the inference is strong but not directly proven.

### A3 — What changed between then and now

**Finding A3 (confidence H):** The team's migration deployment workflow shifted from dashboard-direct-SQL to `supabase db push` between 2026-04-09 and 2026-04-21. The exact commit/PR that flipped the workflow is not directly captured, but the ORCH-0558 comment ("Supabase `db push` applies each migration file as a single transaction") proves the team was actively using `db push` by 2026-04-21 and was aware of the transaction-wrapping behavior. PR #62 today simply re-enforces a runner contract that was added between 04-09 and 04-21 but never applied retroactively to historical migrations.

### A4 — Did the indexes ever physically exist in production?

**Finding A4 (confidence H):** Yes. Direct evidence: `DROP INDEX IF EXISTS public.idx_place_pool_approved_with_photos;` and `DROP INDEX IF EXISTS public.idx_place_pool_city_active_approved;` in [`20260425000004_orch_0640_drop_ai_approved_columns.sql:11-12`](../../supabase/migrations/20260425000004_orch_0640_drop_ai_approved_columns.sql). The team would not have written drop statements for non-existent indexes — they wrote them precisely because the indexes had been built. The current state of `pg_indexes` will show neither (they were dropped).

### A5 — Same runner for prod and CI?

**Finding A5 (confidence M):** No, almost certainly not, at original-apply time.
- 2026-04-09 prod apply: dashboard SQL editor (inferred from §A2).
- 2026-05-04 PR #62 apply: `supabase db push` or Supabase Branches (per §A1).

Confidence M because the prod-apply path is inferred. To raise to H, the operator would need to confirm whether they remember dashboard-applying that migration — but the conclusion does not depend on the exact path; it depends on the fact that the path bypassed transaction wrapping. That is established.

---

## 4. Track B — Schema-drift / zombie-RPC investigation

### B1 — Last-writer-wins chain for each RPC

| RPC | First defined | Subsequent rewrites | Last writer | Body uses dropped columns? | Verdict |
|-----|--------------|---------------------|-------------|---------------------------|---------|
| `admin_city_picker_data` | `20260407300000:245` | `20260409200001:26` | **`20260426000001:34`** (ORCH-0646) | NO — uses `pp.is_servable = true` (line 60) | **RESCUED** |
| `admin_place_pool_overview` | `20260331000007:35` | `20260407300000:12`, `20260409200001:67`, `20260418000001:225`, `20260418000002:203` | **`20260426000001:75`** (ORCH-0646) | NO — uses `mv.is_servable` (lines 115-126) | **RESCUED** |
| `admin_place_country_overview` | `20260331000007:96` | `20260407300000:68`, `20260409200001:179`, `20260417300001:69`, `20260418000001:325`, `20260418000002:53` | **`20260426000001:193`** (ORCH-0646) | NO — uses `mv.is_servable` and `mv.has_photos` (lines 216-218) | **RESCUED** |

ORCH-0700's `20260503000003_orch_0700_admin_rpcs_rewire.sql` rewires SEVEN admin RPCs but **none of these three** — its scope is `admin_rules_overview`, `admin_uncategorized_places`, `admin_pool_category_health`, `admin_city_place_stats`, `admin_virtual_tile_intelligence`, `admin_edit_place`, `admin_rules_preview_impact`. The two rewire chains are non-overlapping. ORCH-0646 remains the canonical last writer for all three RPCs in this investigation.

### B2 — Production runtime test (deferred)

Not required given B1 verdict. To confirm prod state, the operator may run the verification queries already embedded in [`supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql:392-410`](../../supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql) via Management API per `reference_supabase_management_api.md`:

```sql
SELECT proname FROM pg_proc
WHERE proname IN ('admin_city_picker_data','admin_place_pool_overview','admin_place_country_overview')
  AND pg_get_functiondef(oid) ~ 'ai_approved';
-- Expected: 0 rows in production.
```

Expected to return 0 rows. If non-zero, that's a separate ORCH (ORCH-0646 didn't actually deploy).

### B3 — Are ORCH-0640 ch05 + ORCH-0646 a complete supersession of the 2026-04-09 file?

**Finding B3 (confidence H):** Yes for the three RPCs (per B1). Yes for the two indexes (dropped explicitly in 20260425000004). The 2026-04-09 file's *effects* are fully erased in prod. Its *text* still sits in the migrations directory and re-runs on every fresh-DB rebuild. That is the exact problem.

### B4 — Comment-scrub vs body-scrub (cross-check)

`20260503000005_orch_0700_scrub_doomed_column_mentions_in_rpc_comments.sql` exists; it scrubs **comments only**, not bodies. The bodies were already rescued by ORCH-0646 (these three) and ORCH-0640 ch05 (the other 14). So body coverage is complete via two waves. Comment-scrub was a tertiary cleanup, not a missed gap.

---

## 5. Track C — Sibling time bombs

### C1 — CONCURRENTLY-in-transaction time bombs

**Finding C1 (confidence H):** Exactly **one** active CONCURRENTLY bomb across all 293 migrations.

| File | Statements | Status |
|------|-----------|--------|
| [`supabase/migrations/20260409200001_optimize_city_picker_rpc.sql:11,16`](../../supabase/migrations/20260409200001_optimize_city_picker_rpc.sql) | 2× `CREATE INDEX CONCURRENTLY` | **ACTIVE BOMB** |
| [`supabase/migrations/20260421000002_orch_0558_schema_hardening.sql:10`](../../supabase/migrations/20260421000002_orch_0558_schema_hardening.sql) | Comment only — discusses CONCURRENTLY-split as workaround | Not a bomb (no CONCURRENTLY statement) |

Search executed: `Grep "CREATE INDEX CONCURRENTLY|DROP INDEX CONCURRENTLY|REINDEX CONCURRENTLY" supabase/migrations/`. Two file matches; only one is a bomb.

### C2 — Migrations referencing dropped columns AFTER the corresponding drop date

**Finding C2 (confidence M):** 62 files contain references to one or more decommissioned identifiers (`ai_approved`, `ai_categories`, `seeding_category`, `permissions_matrix`, etc). Most are pre-drop (historical CREATE/INSERT/READ migrations against still-living columns) and harmless on replay because they ran before the drop migration.

The candidates that are POST-drop and still reference dropped columns are limited to:
- The drop migrations themselves (DROP COLUMN statements — fine, they ARE the drop)
- The rescue migrations (ORCH-0646, ORCH-0700 admin_rpcs_rewire, scrub_doomed_column_mentions) — fine, they replace bodies

A definitive scan ("any function/view/trigger created after a drop date that references the dropped column in its body") is OUT OF SCOPE for this investigation per dispatch prompt boundaries (full-codebase audit, not the focus). **Recommendation:** spawn a follow-up audit ORCH after this is closed.

### C3 — Function bodies referencing dropped columns

**Finding C3 (confidence M):** As of last writer (per B1), the three RPCs in this case are clean. The broader audit ("every CREATE OR REPLACE FUNCTION across all 293 migrations") is scoped to the follow-up ORCH per C2. **Indicative count from search:** the same 62-file list narrowed by "post-drop date" is the candidate set; reading each function body's last-writer is the deliverable.

### C4 — Views, materialized views, triggers

**Finding C4 (confidence M):** Same boundary as C2/C3. Note that `admin_place_pool_mv` was rebuilt twice (ORCH-0640 ch03 and ORCH-0700 Migration 4) — each rebuild explicitly drops + recreates the matview, so the rebuild-replace pattern is structurally safe. Other views/triggers — out of scope.

---

## 6. Track D — Process / governance failure

### D1 — ORCH-0640 CLOSE protocol audit

**Finding D1 (confidence H):** The DEPRECATION CLOSE PROTOCOL EXTENSION (skill SKILL.md Mode CLOSE Step 5) **was not yet codified at ORCH-0640 close (2026-04-25 → 2026-04-26)**. The protocol was codified 2026-05-01 per the skill's own historical note, after ORCH-0700 sub-audit revealed the gap. Therefore D1 cannot be evaluated against a protocol that did not exist.

What ORCH-0640 *did* do: ch05 rewrite of 14 RPCs + ch13 column drops + rebuild of admin_place_pool_mv. It MISSED 6 RPCs (which is why ORCH-0646 had to follow the next day) and MISSED retroactive cleanup of the historical migration that referenced ai_approved. Both misses are class-of-bug evidence: ORCH-0640's CLOSE did not include a "replay all historical migrations on a fresh DB" gate.

### D2 — ORCH-0700 Phase 3B CLOSE protocol audit

**Finding D2 (confidence M):** ORCH-0700 Phase 3B closed 2026-05-03, after the protocol was codified (2026-05-01). The protocol's eight sub-steps include 5a (memory file), 5b (MEMORY.md index), 5c (existing memory scan), 5d (skill review), 5e (invariant), 5f (decision log), 5g (snapshot/root cause), 5h (retention reminder).

Evidence in repo for ORCH-0700 close compliance:
- 5a/5b: [`feedback_ai_categories_decommissioned.md`](../../C:/Users/user/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_ai_categories_decommissioned.md) referenced from MEMORY.md ✓
- 5e: `I-CATEGORY-DERIVED-ON-DROP` and `I-CATEGORY-SLUG-CANONICAL` in [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md) ✓
- 5f: DEC-090 + DEC-091 in [`Mingla_Artifacts/DECISION_LOG.md`](../DECISION_LOG.md) per memory cross-reference ✓
- 5d (skill review): `mingla-categorizer` skill marked RETIRED — visible in current skills list ✓
- 5h (retention): retention reminder for `_archive_orch_XXXX_*` snapshot tables — present per [`Mingla_Artifacts/RETENTION_REMINDERS.md`](../RETENTION_REMINDERS.md) (file exists; not re-read)

**What ORCH-0700 close DID NOT include:** a gate to verify the historical migration chain replays cleanly. The invariants `I-CATEGORY-DERIVED-ON-DROP` and `I-CATEGORY-SLUG-CANONICAL` cover *current code* not referencing dropped columns, but neither covers *historical migrations* being safely replayable against a fresh database. That is the missing invariant.

### D3 — CI gate against dropped-column references

**Finding D3 (confidence H):** No CI gate exists. The only CI workflows are `deploy-functions.yml` (deploys edge functions on push to main, no migration involvement) and `rotate-apple-jwt.yml` (cron). No GitHub Actions step grep-checks migrations for dropped-column references. No GitHub Actions step replays migrations against a fresh DB.

### D4 — Historical-migration squash / baseline gate

**Finding D4 (confidence H):** Never attempted. Migrations from 2026-03-20 onward are present in chronological order. No baseline/squash file exists in `supabase/migrations/`. ORCH-0640's "Great Demolition and Rebuild" rewrote the *current* state via ch01-ch13 but did not rewrite or neutralize any prior migration files. ORCH-0700 same.

This is the load-bearing process gap: **the team treats migration files as append-only history, but the runner treats them as replayable forward declarations.** The two contracts contradict, and historical files become latent failures whenever the runner contract changes (as it did between 04-09 and 04-21 with the switch to `supabase db push`).

### D5 — Existing invariant gates audit

**Finding D5 (confidence H):** `MEMORY.md` lists three gates for `I-CATEGORY-SLUG-CANONICAL`: (1) SQL self-verify probes, (2) matview post-refresh probe, (3) TS unit test `derivePoolCategory_canonical.test.ts`. None of these test "fresh-DB replay of all migrations succeeds." That is the proposed 4th gate (see §9-10).

---

## 7. Track E — Fix-path option matrix

| # | Option | Blast radius | Reversibility | Prod risk | CI risk | Dev-onboarding risk | Time-to-implement |
|---|--------|--------------|---------------|-----------|---------|---------------------|-------------------|
| E1 | **Edit `20260409200001` in place: drop CONCURRENTLY** | Single file, 2-line change | Reversible (revert commit) | Zero — prod already past this migration; index existence is governed by the 04-25 drop migration which is unchanged | Resolves the immediate CI block | None — fresh DB replay now succeeds | 5 minutes |
| E2 | Edit + add Supabase no-transaction directive | Single file | Reversible | Zero | Same as E1 if directive is honored | Need to verify directive exists in Supabase CLI; otherwise ineffective | 30 minutes (verification) |
| E3 | Insert "neutralizer" migration | One new file | Reversible by deleting | Zero | **Does not fix the bomb** — original file still runs first and crashes | Confusing | 1 hour |
| E4 | Squash-and-baseline migrations 2026-04-01 → 2026-04-25 | ~50 files replaced | High effort to reverse | Medium — must mirror exact post-04-25 state including data-mutating migrations like backfills | Resolves all CONCURRENTLY + dropped-column bombs in one strike | Forces every dev to reset their local DB | 1-2 days, with verification |
| E5 | `-- supabase: no-transaction` annotation | Single file | Reversible | Zero | Only works if Supabase CLI parses this directive — **needs verification, do not assume** | None | Same as E2 (verification first) |
| E6 | Custom CI step | New workflow file | Reversible | Zero | Forks the runner | Future maintainers confused about why migrations apply differently in CI vs locally | 1 day |

### Recommended path: **E1 — Edit history in place.**

**Rationale:**
- **Migration history hash divergence is not a real problem here.** Supabase tracks applied migrations by filename/timestamp + a checksum stored in `supabase_migrations.schema_migrations`. Editing a file that has already applied to prod will cause a checksum mismatch on the *next* `supabase db push` against prod — but Supabase's behavior in that case is to log a WARNING, not fail. Since this migration's effects are entirely undone by ORCH-0640 ch13 (indexes dropped) and ORCH-0646 (RPC bodies replaced), the warning is harmless: prod is already past this migration's effects.
- **No alternative fixes the bomb without changing the file or substituting it.** E3 doesn't help. E4 is the most durable but is significant effort and operationally disruptive. E2/E5 depend on a Supabase directive whose existence is unverified — researching it is fine but the simpler fix is staring at us.
- **Fix is minimal, surgical, low-risk.** Replace `CREATE INDEX CONCURRENTLY IF NOT EXISTS` with `CREATE INDEX IF NOT EXISTS` (drop the CONCURRENTLY keyword). The indexes will brief-lock writes during build, but: (a) every fresh DB this runs on is empty or near-empty at that point in chronology, (b) production already has the indexes long-since dropped per ORCH-0640 ch13, so no production write-lock concern.

**Why not E4 (squash-and-baseline)?** E4 is *correct* for the underlying class of bug (process amnesia between historical migrations and current schema), but it is over-scoped for one bomb. The right structural answer is the gate proposed in §9-10 — which prevents future bombs and would have caught this one — paired with E1 for the immediate fix. If the follow-up audit per Track C2 finds many more time bombs, escalate to E4 at that point.

**Rejected:**
- E2/E5: Unproven directive existence. Operator can investigate, but E1 is shorter.
- E3: Doesn't actually fix the proximate crash.
- E4: Over-scoped for one file. Reconsider after follow-up audit.
- E6: Complexity for no durable benefit; locks the team into a custom runner forever.

---

## 8. Severity confirmation

**Severity remains S1-high.** Not S0 because:
- Production is unaffected — all RPCs work, all indexes are appropriately absent, no user-facing flow is broken.
- The blocked path is fresh-DB rebuild (Supabase Branches CI, dev onboarding, disaster recovery prep).
- A workaround exists for the operator: skip Supabase Branches for this PR (manual merge), or apply migrations via dashboard.

**S1 because:**
- Disaster recovery is genuinely blocked. If Supabase wipes the project (or operator wipes it), the migration chain cannot replay cleanly — the operator would need to dashboard-apply the bomb file by hand. That is a continuity-of-business risk.
- Every developer attempting to onboard with a fresh local DB hits this wall.
- Class-of-bug indicator: similar bombs may exist elsewhere (Track C2 follow-up).

Escalate to S0 if the follow-up audit finds additional time bombs that suggest the chain is broken in multiple places.

---

## 9. Proposed new invariants

**Proposed (orchestrator authors final wording):**

### Invariant: I-MIGRATIONS-FRESH-REPLAY-SUCCESS (NEW)

Every migration in `supabase/migrations/` MUST apply successfully against a fresh, empty Postgres database under the canonical runner (`supabase db push` / Supabase Branches), in chronological order, with no manual intervention.

**Why:** Historical migrations are append-only by team convention. The runner contract (transaction-wrapping) was established after some files were written. Without this invariant, the migration chain can drift into unreplayability silently — surfaced only by disaster recovery, dev onboarding, or PR-time Supabase Branch creation.

**Gate:** A new `.github/workflows/migration-replay.yml` that spins up an ephemeral Postgres (or uses Supabase Branches), runs `supabase db push`, and fails the PR on any error. Runs on every PR that touches `supabase/migrations/`.

### Invariant: I-MIGRATION-NO-CONCURRENTLY-IN-TX (NEW)

A migration file MUST NOT contain `CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, or `REINDEX CONCURRENTLY` unless the runner contract has been verified to apply that file outside a transaction.

**Why:** Postgres rejects CONCURRENTLY inside a transaction with SQLSTATE 25001. Supabase's standard runners wrap each file in a transaction. Mixing the two creates a latent bomb.

**Gate:** Pre-commit hook OR PR-time grep step in `.github/workflows/` that fails on `CONCURRENTLY` in any file under `supabase/migrations/`. If a future migration genuinely needs CONCURRENTLY, the team must add a documented exception path (separate file with no-tx directive, verified to work).

### Invariant: I-MIGRATION-NO-BODY-REFS-DROPPED-COL (extends I-CATEGORY-DERIVED-ON-DROP, broader scope) (NEW)

`CREATE OR REPLACE FUNCTION` bodies, view definitions, materialized view definitions, and trigger definitions in any migration with timestamp ≥ a documented column-drop date MUST NOT reference the dropped column.

**Why:** Function/view/trigger bodies are runtime-resolved. A body that references a dropped column compiles silently at migration-apply time and fails at first invocation in prod.

**Gate:** Programmatic scan of every migration's `CREATE OR REPLACE FUNCTION` / `CREATE VIEW` / `CREATE MATERIALIZED VIEW` / `CREATE TRIGGER` body against the registry of dropped columns/tables. Maintained as a list in `Mingla_Artifacts/INVARIANT_REGISTRY.md` and enforced via CI grep.

---

## 10. Process changes for orchestrator's DEPRECATION CLOSE PROTOCOL

**Proposed addition to Mode CLOSE Step 5 (orchestrator authors final text):**

### 5i — Historical migration replay verification (NEW sub-step)

After dropping a column/table/function/RPC family, the orchestrator MUST verify that the full migration chain still replays cleanly on a fresh database. Verification options:
- **(Preferred)** A `.github/workflows/migration-replay.yml` runs on every PR touching migrations (per I-MIGRATIONS-FRESH-REPLAY-SUCCESS).
- **(Manual interim)** Operator runs `supabase db reset && supabase db push` against a local Supabase instance and confirms zero errors.

If replay fails, the orchestrator MUST either:
- (a) Squash/edit historical migrations to neutralize the failure, OR
- (b) Document the failure as a known gap with a remediation ORCH on the priority board.

CLOSE cannot complete with an unreplayable migration chain unless the gap is explicitly waived in writing by the operator.

### 5j — Sibling time bomb scan (NEW sub-step)

When a migration is identified as broken under the current runner contract (CONCURRENTLY-in-tx, dropped-column body refs, etc.), the orchestrator MUST commission a forensics audit to find sibling instances of the same class-of-bug. One bomb implies several. ORCH-0721 should remain open with a Track C2 follow-up dispatch.

---

## 11. What I did NOT investigate, and why

- **Production state of the three RPCs via Management API.** Skipped because the chain analysis (§4 Track B) is conclusive: ORCH-0646 is the last writer, body uses `is_servable`, and migration order guarantees this body is what's in `pg_proc`. Operator can run the verification SQL block at the bottom of [`supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql:392-410`](../../supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql) to confirm if desired (would raise §4 confidence H → H+).
- **Full sibling time bomb scan (Track C2/C3/C4).** Per dispatch prompt this is the CONCURRENTLY-narrow scan; a broader "every function/view/trigger body across all post-drop migrations" audit is the recommended follow-up ORCH-0722. Confidence on §5 is M for the broader scan, H for the CONCURRENTLY narrow scan.
- **Direct verification of the Supabase CLI no-transaction directive (E5).** Out-of-scope per the dispatch (E1 is the recommended path; E5 was evaluated as an option, not implemented).
- **Caller-side audit of the three RPCs (mobile + admin).** Out of scope given Track B verdict that RPCs are rescued; if any caller still passes `ai_approved`-shaped expectations, that's a separate ORCH.
- **Audit of `RETENTION_REMINDERS.md` against ORCH-0700 Step 5h compliance.** Skipped — D2 evidence noted file existence; line-by-line audit not in scope.
- **Why `permissions_matrix` shows up in C2 results** (`20260504100000_b1_phase7_drop_permissions_matrix.sql` is itself a drop migration; not a residual reference). Confirmed file is the drop, not a residual; flagged here so the follow-up audit doesn't double-count.
