# INVESTIGATION — ORCH-1077 [prod↔main Supabase migration-drift reconciliation]

**Mode:** mingla-forensics INVESTIGATE (READ-ONLY). Zero schema/history writes performed.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1077-[prod-main-migration-drift-reconcile]/` on branch `ORCH-1077-prod-main-migration-drift-reconcile` (HEAD `08b6184651`, base `f60b580ac`, **5 commits behind `origin/main` `d18f03ca1`**).
**Reconciliation target = `origin/main`** (NOT the worktree's stale checkout). This distinction is load-bearing — see Finding F-0.
**Date:** 2026-06-04.
**Confidence:** root cause **PROVEN** (six-field; objects probed live on remote; `schema_migrations` PK confirmed; CLI behavior cited against Supabase docs).

**Comms ledger:** Read on entry. No BLOCK/WARN addressed to ORCH-1077 / mingla-forensics / ALL is OPEN-actionable beyond COMMS-0003 (external-API-docs-cited — honored: Supabase doc URLs inline). This investigation is the forensic backbone for the drift first surfaced by COMMS-0008, COMMS-0009, COMMS-0010, COMMS-0012, COMMS-0018, COMMS-0019 (all WARN/FYI, all about out-of-band-applied-but-unrecorded migrations). It does not itself require a new COMMS entry (read-only, no cross-ORCH side effect), but it RESOLVES the open question those entries raised.

---

## 0. Layman summary

The production database and the `main` branch's migration files disagree about *which migrations have run* — but **not** about *what's actually in the database*. Every single drifted migration's effect (columns, functions, policies, constraints) is **already live in production** — proven by direct read-only probes. The mismatch is purely a **bookkeeping gap** in Supabase's `schema_migrations` ledger, caused by three habits this program already documented: (a) applying migrations out-of-band via the Management API during launch-blocker fixes without recording them (COMMS-0009/0010/0018), (b) two different ORCHs independently writing migration files with the **same timestamp** (three such collisions), and (c) this worktree branched before the two newest migrations merged to main, which makes the CLI dry-run *look* worse than it is.

Because the database state is already correct, the right tool is **`supabase migration repair --status applied`** (which edits only the ledger, never re-runs SQL) for the unrecorded versions, plus **renumbering** the three collision "loser" files so each gets its own ledger row, plus **committing one orphaned source file** (`orch_1047`) that lives only as an untracked file in the anchor working tree. **No `db push` of the drifted set, no double-apply, no drop.** After reconciliation, ORCH-1075's `20260911000000` appends cleanly.

---

## 1. Symptom (as dispatched)

`supabase db push --linked --dry-run` fails with two error families:
1. **"Remote migration versions not found in local migrations directory":** `20260602000000`, `20260908000000`, `20260910000000`.
2. **"Found local migration files to be inserted before the last migration on remote":** `20260803000000`, `20260803000001`, `20260805000001`, `20260816000000`, `20260820000000`, `20260906000000`.

Remote `schema_migrations` head = `20260910000000`. Remote row count = **186**. `origin/main` ships **203 migration files** across **190 distinct version timestamps**.

---

## 2. Root cause (PROVEN — six fields)

| Field | Evidence |
|---|---|
| **File + line** | `supabase_migrations.schema_migrations` (remote ledger). PK = `version` (single column) — proven: `pg_index.indisprimary` → `pk_cols = "version"`. |
| **Exact state** | 186 ledger rows vs 190 distinct main file-versions vs 203 main files. Three main versions carry **two files each** (collisions). Three main file-versions + one anchor-only file are missing from / mismatched against the ledger. |
| **What it does** | The CLI compares `supabase/migrations/*` filenames against ledger `version` rows. A version present on remote but with no matching local file → "remote not found in local". A local file whose version is < remote head but not recorded → "to be inserted before the last migration on remote". Because `version` is the PK, **two files at one timestamp can never both be recorded** — exactly one name occupies the slot. |
| **What it should do** | Ledger versions and main file-versions should be 1:1, with unique timestamps, so `db push` finds zero pending and zero orphaned. |
| **Causal chain** | Out-of-band Management-API applies (COMMS-0009/0010/0018) wrote DB objects but never inserted ledger rows → orch_1016 ×3 + orch_1073 unrecorded. Two ORCH pairs picked identical timestamps independently → 3 collisions, each recording only the lexicographically-first file. One source (orch_1047) was applied + ledger-recorded out-of-band but its file was never committed to any branch → "remote not found in local". This worktree branched 5 commits early → the two newest already-on-main files (`20260908`, `20260910`) appear absent *from the worktree*, inflating error family 1. |
| **Verification** | Every drifted object probed live on remote (§4) → **all present**. Doc-confirmed `migration repair --status applied` edits ledger only, no SQL (https://supabase.com/docs/guides/deployment/database-migrations, https://supabase.com/docs/reference/cli/supabase-migration-repair). |

**Two candidate causes considered and the non-cause disproven:** (H1) "local-only migrations are genuinely unapplied and must be pushed" — **DISPROVEN**: all four main-only versions' objects already exist on remote (§4 probes return true/YES). (H2) "ledger is correct, DB is missing objects" — **DISPROVEN** by the same probes. The surviving cause is **ledger-recording drift with three timestamp collisions**, not a pending-apply state.

---

## 3. The drift is measured against `origin/main`, not the worktree (Finding F-0)

The dispatch's "remote-only" list included `20260908000000` and `20260910000000`. Those files **are on `origin/main`** (added by merged PRs after this worktree branched):

- `6ece55242` ORCH-1072 (#353) → `20260908000000_orch_1072_experience_detail_cover_availability.sql`
- `158068f3b` META-ORCH-1074 Sub-A (#354) → `20260910000000_meta_orch_1074_new_review_notify.sql`
- (`bc6c1e538` ORCH-1073 #355 also added `20260909000000_orch_1073_admin_suspend_delete_listing.sql`.)

`git ls-tree origin/main` confirms `20260908000000` and `20260910000000` present on main. They are **only** missing from the worktree's older checkout. **Therefore, against `origin/main`, the genuine set differences are:**

```
REMOTE-recorded, NO file-version on origin/main  (comm -23):  20260602000000      [1]
File-version on origin/main, NOT in remote ledger (comm -13): 20260803000000      [4]
                                                              20260803000001
                                                              20260805000001
                                                              20260909000000  ← NOT in dispatch (new discovery)
```

`20260816000000`, `20260820000000`, `20260906000000` are **recorded on remote AND have a file-version on main** — the version is reconciled; the *unrecorded sibling file at each version* is the residual issue (the collision).

---

## 4. Five-layer cross-check — every drifted object is APPLIED on remote (LIVE PROBES)

| Version | Migration (file) | Object the migration creates | Live remote probe | Verdict |
|---|---|---|---|---|
| 20260602000000 | orch_1047_schedule_change_with_sales | `business_patch_event_when` raises `schedule_change_with_sales` on time-only change | `prosrc ILIKE '%schedule_change_with_sales%'` → **true** | APPLIED |
| 20260803000000 | orch_1016_events_departure_text | `events.departure_text` + `events.departure_geo` | both columns exist → **true/true** | APPLIED |
| 20260803000001 | orch_1016_pg_published_trips_public | `pg_published_trips_public()` | function exists → **true** | APPLIED |
| 20260805000001 | orch_1016_trip_intake_schemas_buyer_select | policy `trip_intake_schemas_buyer_select` | policy exists → **true** | APPLIED |
| 20260816000000 (rec) | orch_1034_currency_de_gbp | drop `brands_pricing_currency_allowlist`; widen region CHECK | currency check gone → **true**; region def = `CHECK ((pricing_region = ANY (ARRAY['GB','US','EU','CH'])))` | APPLIED (recorded) |
| 20260816000000 (sibling) | orch_1043_auto_run_triggered_by_nullable | `photo_backfill_runs.triggered_by` DROP NOT NULL | `is_nullable = YES` → **applied** | APPLIED but **NOT recorded under its own name** |
| 20260820000000 (rec) | orch_1050_brand_invite_flow | `brand_invitations.status` + `accept_invite_and_transfer_brand_ownership()` | column exists + fn exists → **true/true** | APPLIED (recorded) |
| 20260820000000 (sibling) | schedule_change_buyer_protection_refund_all | `business_patch_event_when` `acknowledgeSoldImpact` bypass | `prosrc ILIKE '%acknowledgeSoldImpact%'` → **true** | APPLIED but **NOT recorded under its own name** |
| 20260906000000 (rec) | orch_1069_live_edit_persists_experience_intents | `biz_update_live_experience` persists `experience_intents` | `prosrc ILIKE '%experience_intents%'` → **true** | APPLIED (recorded) |
| 20260906000000 (sibling) | orch_1072_brand_experiences_for_place | `pg_brand_experiences_for_place()` | function exists → **true** | APPLIED but **NOT recorded under its own name** |
| 20260908000000 | orch_1072_experience_detail_cover_availability | `pg_eligible_experiences_for_deck` gains `upcoming_occurrences` | `prosrc ILIKE '%upcoming_occurrences%'` → **true** | APPLIED (recorded; on main) |
| 20260909000000 | orch_1073_admin_suspend_delete_listing | `admin_suspend_listing` / `admin_soft_delete_listing` / `admin_restore_listing` | all three fns exist → **true** | APPLIED but **NOT recorded** (on main) |
| 20260910000000 | meta_orch_1074_new_review_notify | `meta_orch_1074_notify_new_review()` | function exists → **true** | APPLIED (recorded; on main) |

**Layer agreement:** Schema (objects) = present everywhere; Ledger (history) = incomplete; Code (main files) = present except orch_1047; Runtime = consistent with applied objects. The only contradicting layer is the **history ledger**. That is the bug.

---

## 5. Source provenance (where each drifted file actually lives)

| Version | Source location | git-tracked? |
|---|---|---|
| 20260602000000 orch_1047_schedule_change_with_sales | **Untracked file in anchor working tree** `~/Desktop/mingla-main/supabase/migrations/20260602000000_orch_1047_schedule_change_with_sales.sql` (sha `86e5640935…`, 279 lines). `git log --all` for this version = empty → **not committed on any branch**. | NO |
| 20260803000000 / 803001 / 805001 orch_1016 | On `origin/main` (committed). | YES |
| 20260816000000 ×2 (orch_1034 + orch_1043) | Both on `origin/main` (collision pair). sha `7e7c69…` / `76417a…`. | YES |
| 20260820000000 ×2 (orch_1050 + schedule_change_refund_all) | Both on `origin/main` (collision pair). sha `a6591a…` / `b4e098…`. | YES |
| 20260906000000 ×2 (orch_1069 + orch_1072_brand_experiences_for_place) | Both on `origin/main` (collision pair). sha `8fd547…` / `66deba…`. | YES |
| 20260908000000 orch_1072 / 20260909000000 orch_1073 / 20260910000000 meta_orch_1074 | On `origin/main` (merged after worktree branched). Also present in `META-ORCH-1074` worktree. | YES |

---

## 6. THE COLLISION VERDICT (riskiest item — exhaustive)

The dispatch asked specifically about `20260816000000`. **The premise — "remote records orch_1034 but the local file is orch_1043" — is half the story. Reality: `origin/main` ships TWO files at version `20260816000000`** (and likewise at `20260820000000` and `20260906000000`). This was confirmed by `git ls-tree origin/main`:

```
20260816000000_orch_1034_currency_de_gbp.sql
20260816000000_orch_1043_auto_run_triggered_by_nullable.sql
20260820000000_orch_1050_brand_invite_flow.sql
20260820000000_schedule_change_buyer_protection_refund_all.sql
20260906000000_orch_1069_live_edit_persists_experience_intents.sql
20260906000000_orch_1072_brand_experiences_for_place.sql
```

**Why only one name is recorded per version:** `schema_migrations.version` is the PRIMARY KEY (proven). One row per timestamp, full stop. When `db push` ran (historically) for these versions, the CLI applied files in **filename-lexicographic order** and inserted ONE ledger row whose `name` = the version's recorded label. The recorded "winner" at each collision is the lexicographically-first filename:

- `20260816000000`: recorded `orch_1034_currency_de_gbp` (`orch_1034…` < `orch_1043…`). orch_1043 is the **loser**.
- `20260820000000`: recorded `orch_1050_brand_invite_flow` (`orch_1050…` < `schedule_change…`, since `o`=0x6f < `s`=0x73). schedule_change_refund_all is the **loser**.
- `20260906000000`: recorded `orch_1069_live_edit…` (`orch_1069…` < `orch_1072…`). orch_1072_brand_experiences_for_place is the **loser**.

**Both files in each pair are APPLIED on remote** (§4 — orch_1043 nullable=YES; refund_all `acknowledgeSoldImpact` present; pg_brand_experiences_for_place exists). The loser's SQL ran during the same out-of-order push (or via Management API) — it just never got its own ledger row because the version slot was taken.

**Specific answers to the dispatch's four collision questions:**
1. *What does `schema_migrations` say?* `20260816000000` → name `orch_1034_currency_de_gbp`, `statements` NULL (not stored).
2. *Local file at 20260816 creates vs recorded orch_1034?* The recorded `orch_1034` file drops the currency CHECK + widens the region CHECK (both live on remote). The **sibling** local file `orch_1043_auto_run_triggered_by_nullable` makes `photo_backfill_runs.triggered_by` nullable (also live on remote). They are two unrelated changes that collided on the same timestamp.
3. *Is orch_1034 on main under another version, or only at 20260816?* orch_1034's file lives ONLY at `20260816000000` on main (no other version), and it IS the recorded name → orch_1034 is fully reconciled. orch_1043 is the unreconciled loser.
4. *Is orch_1043 applied?* **YES** (`triggered_by` is nullable on remote). It is applied but unrecorded-under-its-own-name. It is NOT "genuinely unapplied."

**Collision risk going forward:** as long as two files share a timestamp, `db push` will keep flagging the loser. The durable fix is to **renumber each loser to a unique, later, still-applied-equivalent timestamp** and `migration repair --status applied` that new timestamp. Renumbering is safe because each loser is `CREATE OR REPLACE` / `ALTER … IF [NOT] EXISTS` / additive-policy idempotent (verified by reading every file header — all declare idempotency), so the new version row asserts a state already true on remote.

---

## 7. Supersession check (per local-only migration)

None of the unrecorded migrations are superseded-and-safe-to-drop; each owns a distinct live object that is the current truth:

- **orch_1016 ×3** — `events.departure_text`/`departure_geo`, `pg_published_trips_public`, `trip_intake_schemas_buyer_select` policy: all unique, all live, no later migration replaces them. KEEP + record.
- **orch_1043** — `photo_backfill_runs.triggered_by` nullable: no later migration re-adds NOT NULL (probe = YES nullable). KEEP + record (renumber).
- **schedule_change_refund_all** — `business_patch_event_when` is `CREATE OR REPLACE`; the LIVE function has BOTH the orch_1047 time-block AND the `acknowledgeSoldImpact` bypass (both `prosrc` probes true), so the latest replace wins and carries both. The file is the current definition source. KEEP + record (renumber). *Note: orch_1047 (20260602000000) and this file BOTH `CREATE OR REPLACE business_patch_event_when` — the function's live body is the union; whichever migration ran last is the on-disk truth. Bringing orch_1047's file onto main + recording both versions documents the full lineage.*
- **orch_1072_brand_experiences_for_place** — `pg_brand_experiences_for_place`: unique live function. KEEP + record (renumber).
- **orch_1073** — `admin_suspend/soft_delete/restore_listing`: unique live functions. KEEP + record.
- **orch_1047** — time-block in `business_patch_event_when`: live. Source must be brought onto main; version already recorded on remote → repair not needed for it, only the file-commit.

---

## 8. Per-version classification table (version → class → action → risk)

Legend: **MERGE-SOURCE-TO-MAIN** = remote-recorded+applied, source must land on main; **REPAIR-RECORD** = applied on remote but ledger row missing → `migration repair --status applied`; **RENUMBER** = collision loser → give unique timestamp then repair-record.

| # | Version | File (name) | Applied on remote? | In remote ledger? | On origin/main? | Class | Action | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | 20260602000000 | orch_1047_schedule_change_with_sales | YES | YES (recorded) | **NO** (untracked anchor) | MERGE-SOURCE-TO-MAIN | Commit the anchor source onto main at this version. No ledger op (already recorded). | LOW (doc-only; touches MONEY path `business_patch_event_when` — see §10). |
| 2 | 20260803000000 | orch_1016_events_departure_text | YES | **NO** | YES | REPAIR-RECORD | `migration repair --status applied 20260803000000` | LOW (additive columns already live). |
| 3 | 20260803000001 | orch_1016_pg_published_trips_public | YES | **NO** | YES | REPAIR-RECORD | `migration repair --status applied 20260803000001` | LOW (anon RPC already live). |
| 4 | 20260805000001 | orch_1016_trip_intake_schemas_buyer_select | YES | **NO** | YES | REPAIR-RECORD | `migration repair --status applied 20260805000001` | LOW (RLS policy already live). |
| 5 | 20260816000000 | orch_1034_currency_de_gbp | YES | YES (recorded) | YES | (reconciled) | none | n/a |
| 6 | 20260816000000 | orch_1043_auto_run_triggered_by_nullable | YES | **NO** (slot taken) | YES (collision) | RENUMBER | Renumber file → e.g. `20260816000001_…`; `migration repair --status applied 20260816000001` | MEDIUM (collision; renumber + record). No data path. |
| 7 | 20260820000000 | orch_1050_brand_invite_flow | YES | YES (recorded) | YES | (reconciled) | none | n/a |
| 8 | 20260820000000 | schedule_change_buyer_protection_refund_all | YES | **NO** (slot taken) | YES (collision) | RENUMBER | Renumber file → e.g. `20260820000001_…`; repair-record | MEDIUM (collision; touches MONEY path — §10). |
| 9 | 20260906000000 | orch_1069_live_edit_persists_experience_intents | YES | YES (recorded) | YES | (reconciled) | none | n/a |
| 10 | 20260906000000 | orch_1072_brand_experiences_for_place | YES | **NO** (slot taken) | YES (collision) | RENUMBER | Renumber file → e.g. `20260906000001_…`; repair-record | MEDIUM (collision). No data path. |
| 11 | 20260908000000 | orch_1072_experience_detail_cover_availability | YES | YES (recorded) | YES | (reconciled) | none | n/a |
| 12 | 20260909000000 | orch_1073_admin_suspend_delete_listing | YES | **NO** | YES | REPAIR-RECORD | `migration repair --status applied 20260909000000` | LOW (admin fns already live). NEW discovery — not in dispatch. |
| 13 | 20260910000000 | meta_orch_1074_new_review_notify | YES | YES (recorded) | YES | (reconciled) | none | n/a |

**Net actions:** 1 file-commit (orch_1047), 4 repair-record (`20260803000000`, `20260803000001`, `20260805000001`, `20260909000000`), 3 renumber+repair-record (the collision losers). **Zero `db push` of drifted versions. Zero drops. Zero double-applies.** (`migration repair` does not run SQL — doc-confirmed.)

---

## 9. Why `migration repair --status applied` IS the right tool here (justified)

The mingla-forensics standard normally forbids defaulting to `repair`. This case is the documented exception: **the objects are provably already applied** (§4 live probes), and Supabase's own docs state repair is exactly for "a migration that's actually already there (for example, it was applied manually) — you can mark it as applied without re-running it … `migration repair` updates the tracking table only — it does not apply or revert any SQL. Use it to correct the history record when you know the actual database state is correct." (https://supabase.com/docs/guides/deployment/database-migrations; https://supabase.com/docs/reference/cli/supabase-migration-repair). We KNOW the DB state is correct (probed). `db push` would attempt to RUN the unrecorded files; even though each is idempotent, running them is unnecessary risk on a money/RLS-bearing schema, and would not solve the collision (the loser would still fail to get a row at a taken version). Repair is surgical, SQL-free, and collision-aware once the loser is renumbered.

---

## 10. Production data / money-path callouts (extra care)

- **`business_patch_event_when`** (orch_1047 #1 + schedule_change_refund_all #8) is the BUYER-PROTECTION money path (blocks/permits date/time changes on sold events; `acknowledgeSoldImpact` triggers refund-all). Its live body already contains both behaviors. Committing the orch_1047 source + renumber-recording the refund_all loser are **history-only** — they do NOT re-run the function or touch orders. **Do not** "fix" by `db push`-ing a `CREATE OR REPLACE` blindly; confirm the on-disk file body equals the live `prosrc` before any push (out of scope here — repair avoids the push entirely).
- **`brands` currency/region** (orch_1034 #5) is reconciled; no action — but it gates checkout currency, so do not reopen it.
- **orch_1050 brand-invite / accept-and-transfer-ownership** (#7) is reconciled; transfers brand ownership atomically — do not reopen.
- All RENUMBER ops assert a state already true; the only failure mode is a typo'd timestamp colliding again — verify uniqueness before committing (runbook Step R-2).

---

## 11. How ORCH-1075's `20260911000000` lands after reconciliation

`ORCH-1075-[paid-publish-integrity-guards]` carries `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql`. It is **above** the remote head `20260910000000` and above every collision version. Once Steps M/R (commit orch_1047 + renumber the 3 losers + repair-record the 4 unrecorded + 3 renumbered) make ledger and main file-versions 1:1, `supabase migration list --linked` will show ZERO drift, and `supabase db push --linked` will find exactly one pending file (`20260911000000`) and apply + record it normally. No special handling — it is a clean append. (If ORCH-1075 merges to main BEFORE reconciliation, it simply becomes one more "local file to insert," still above head, applied last — but reconcile first to keep the push output clean and auditable.)

---

## 12. Blast radius

- **Deployment pipeline:** every future `db push` is blocked/noisy until reconciled — affects ALL backend ORCHs (ORCH-1075 queued; META-ORCH-1074 backend; paystack-nigeria future).
- **No runtime blast:** because all objects are applied, consumer/business/admin runtime is unaffected today. This is a developer-pipeline-only defect.
- **Invariant touch:** reinforces `[[ship-verify-merge-before-reap]]` + COMMS-0015 (deploy-from-worktree / apply-without-record). Recommend the orchestrator add a CLOSE-gate: after any out-of-band Management-API apply, immediately `migration repair --status applied <version>` so the ledger never drifts again.

---

## 13. Discoveries for orchestrator

- **D-1 (NEW):** `20260909000000_orch_1073_admin_suspend_delete_listing` is applied on remote but **absent from `schema_migrations`** — not listed in the dispatch. Add to the repair set.
- **D-2:** Three same-timestamp collision PAIRS exist on `origin/main` (`20260816`, `20260820`, `20260906`). The PK constraint means this WILL recur on every push until the losers are renumbered. Consider a CI strict-grep gate that fails when two migration files share a version prefix.
- **D-3:** `20260602000000_orch_1047_schedule_change_with_sales` exists ONLY as an **untracked file in the shared anchor working tree** — at risk of accidental loss (anchor staging hazard, `feedback_shared_anchor_checkout_staging_hazard.md`). Commit it onto main promptly.
- **D-4:** Root-cause class = out-of-band Management-API applies (COMMS-0009/0010/0018) never followed by a `migration repair --status applied`. Codify the repair-immediately rule into the deploy carve-out.

---

# RECONCILIATION RUNBOOK (DO NOT EXECUTE — AWAITING APPROVAL)

> **Every command below is marked DO-NOT-RUN-YET.** Run only after Seth approves, from a checkout that is **on `main` and up to date** (NOT this 5-behind worktree). `migration repair` writes the remote ledger — it is a history WRITE, explicitly out of scope for this read-only investigation. Verify on a fresh `git pull origin main` first.

### Pre-flight (read-only, safe to run anytime)
```bash
# DO-NOT-RUN-YET (these are read-only and confirm the plan)
cd ~/Desktop/mingla-main && git checkout main && git pull origin main
/Users/sethogieva/bin/supabase migration list --linked   # confirm Local/Remote columns match §8
git ls-tree -r --name-only main -- supabase/migrations | sed -E 's#.*/##' | cut -d_ -f1 | sort | uniq -d   # must list the 3 collision versions
```

### Step M-1 — Commit the orphaned orch_1047 source onto main (file-only; no ledger op)
*Class: MERGE-SOURCE-TO-MAIN. Risk: LOW (doc-only). Money path — do NOT push/run it.*
```bash
# DO-NOT-RUN-YET
cd ~/Desktop/mingla-main
git checkout -b orch-1077-reconcile-migrations
git add supabase/migrations/20260602000000_orch_1047_schedule_change_with_sales.sql
git commit -m "ORCH-1077: commit orphaned orch_1047 migration source (already applied+recorded on remote)"
```
**Risk/why-safe:** the version is ALREADY in the remote ledger (recorded). This only puts the source under version control so the CLI stops reporting "remote not found in local." `migration repair` is NOT needed for this version. **Do not `db push` — the function is already live.**
**Rollback:** `git revert` the commit (file removal does not touch the DB).

### Step R-1 — Renumber the 3 collision LOSER files to unique timestamps
*Class: RENUMBER. Risk: MEDIUM (collision). Verify each loser's object is live BEFORE renaming (already done §4).*
```bash
# DO-NOT-RUN-YET — choose +1-second-granularity unique versions just after the taken slot
git mv supabase/migrations/20260816000000_orch_1043_auto_run_triggered_by_nullable.sql \
       supabase/migrations/20260816000001_orch_1043_auto_run_triggered_by_nullable.sql
git mv supabase/migrations/20260820000000_schedule_change_buyer_protection_refund_all.sql \
       supabase/migrations/20260820000001_schedule_change_buyer_protection_refund_all.sql
git mv supabase/migrations/20260906000000_orch_1072_brand_experiences_for_place.sql \
       supabase/migrations/20260906000001_orch_1072_brand_experiences_for_place.sql
git commit -am "ORCH-1077: renumber 3 collision-loser migrations to unique timestamps (objects already live on remote)"
```
**Risk/why-safe:** each loser is idempotent (`ALTER … DROP NOT NULL`, `CREATE OR REPLACE`, additive — verified in §6/§7). The new version is recorded as applied in Step R-2 WITHOUT running SQL, so no re-execution. Confirm new timestamps are unique: `cut -d_ -f1 ... | sort | uniq -d` returns nothing.
**Rollback:** `git mv` back to the original names; if R-2 already ran, also `migration repair --status reverted <new-version>` then `--status applied <original-version>` is NOT possible (slot taken) — so do R-1 and R-2 together and only after approval.

### Step R-2 — Repair-record the unrecorded + renumbered versions (LEDGER WRITE — needs approval)
*Class: REPAIR-RECORD. Tool justified §9. `migration repair` edits ledger only, runs no SQL (https://supabase.com/docs/reference/cli/supabase-migration-repair).*
```bash
# DO-NOT-RUN-YET — one command (CLI accepts multiple versions)
/Users/sethogieva/bin/supabase migration repair --status applied \
  20260803000000 20260803000001 20260805000001 20260909000000 \
  20260816000001 20260820000001 20260906000001
```
**Risk:** writes 7 rows to remote `schema_migrations`. Each asserts a state proven true in §4. **Production-data care:** none of these RUN SQL; `20260820000001` (refund_all, money path) is recorded, not executed. **Precise risk if mis-versioned:** repairing a version whose object is NOT actually applied would lie to the ledger and skip a real apply later — mitigated because every version here was probe-verified applied (§4).
**Rollback:** `supabase migration repair --status reverted <version>` for any row mistakenly added (ledger-only; reversible).

### Step R-3 — Verify clean state (read-only)
```bash
# DO-NOT-RUN-YET
/Users/sethogieva/bin/supabase migration list --linked   # Local and Remote columns must now be identical, no gaps
/Users/sethogieva/bin/supabase db push --linked --dry-run # must report ZERO pending (or only 20260911000000 if ORCH-1075 merged)
```

### Step R-4 — Merge the reconcile branch + land ORCH-1075
```bash
# DO-NOT-RUN-YET
gh pr create --base main --head orch-1077-reconcile-migrations --title "ORCH-1077: reconcile prod↔main migration drift" --body "..."
# After merge + ORCH-1075 merge:
/Users/sethogieva/bin/supabase db push --linked   # applies + records 20260911000000 cleanly
```

### Production / money-path extra-care summary
- **Steps M-1 and the `20260820000001` renumber touch `business_patch_event_when` (buyer-protection refund money path).** Both are history/source-only — they MUST NOT be `db push`-ed or re-run. The function body is already correct live. If anyone insists on a push instead of repair, FIRST diff the on-disk file against live `prosrc` and get explicit sign-off.
- **No order rows, brand rows, or ticket rows are read or written by any step.** All ops are ledger-or-file only.
- **Do all of R-1 + R-2 in one approved sitting** (a renumbered file with no ledger row would itself become a new "to insert" entry until R-2 records it).

### Recommended permanent guardrail (orchestrator)
Add the rule: *any Management-API / out-of-band apply MUST be immediately followed by `supabase migration repair --status applied <version>` and a source-file commit to main.* Add a CI strict-grep that fails when two `supabase/migrations/*.sql` files share a version prefix (kills the collision class — D-2).

---

**Completion (`/goal`) self-check:** (1) root cause six-field + 2 candidates with non-cause disproven ✔; (2) pipeline traced ledger↔files↔objects to terminal "push clean" outcome ✔; (3) outcome step-back = "db push runs clean without dropping/double-applying" mapped ✔; (4) external research = Supabase migration/repair docs cited inline ✔; (5) every pertinent migration file + headers read ✔; (6) latest-migration-truth confirmed via live object probes ✔; (7) no UI/runtime bug (pure backend/migration) → sim-exempt per Prime Directive exemption ✔.
