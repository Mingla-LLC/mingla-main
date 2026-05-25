# Implementation Report: Dashboard None Persistence Rework (ORCH-0954)

> Date: 2026-05-25
> Mode: Rework
> Spec: `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` rerun section
> Status: implemented and verified

## 1. Layman Summary

Fresh Stripe embedded-onboarding no longer gets blocked by Mingla's own database check when Stripe returns a `dashboard:none` connected account. The database migration replaces the old `standard|express|custom` account-type rule with Stripe Accounts v2 dashboard values `full|express|none`, and the regression test pins that `none` remains allowed. I also included the tester's adversarial business-web-origin test in the ORCH-0863 backend allowlist so the PR should not be blocked by that unrelated marketing guard.

## 2. Request And Context

- **Request:** Fix the P1 retest blocker for ORCH-0954 by adding a monotonic migration, regression coverage for `controller_dashboard_type='none'`, and ORCH-0863 C7 routing for the new adversarial origin test.
- **Source:** Tester rerun in `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`.
- **Affected surfaces:** Supabase migration chain, Stripe connected-account persistence, strict-grep CI.
- **Related artifacts:** `Mingla_Artifacts/tests/evidence/orch-0954-edge-brand-stripe-onboard.json`, `Mingla_Artifacts/tests/evidence/orch-0954-edge-brand-stripe-account-session.json`.

## 3. Scope

- **In scope:** `stripe_connect_accounts_type_check`, source-reconciled remote-only migration files, migration regression test, ORCH-0863 C7 allowlist for scoped ORCH-0954 backend/test files.
- **Out of scope:** `brand-stripe-tax-dashboard-link/`, edge function deploys, Supabase secret writes, Stripe/Vercel Production key changes, live-fire rerun.
- **Assumptions:** Legacy `standard` maps to controller dashboard `full`; legacy `custom` maps to controller dashboard `none`; existing `express` rows remain `express`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | `COMMS-0003` and `COMMS-0002` WARN entries already acknowledged for ORCH-0954; `COMMS-0001` kept as tax-dashboard scope guard. |
| `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` | Rework contract | Rerun failed because `controller_dashboard_type='none'` could not persist under the legacy CHECK. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Original table constraint | `stripe_connect_accounts_type_check` still admitted only `standard|express|custom`. |
| `supabase/migrations/20260511000006_b2a_v3_account_type_rename.sql` | Rename context | Column was renamed to `controller_dashboard_type` and documented as `full|express|none`, but the CHECK was not replaced. |
| `supabase/functions/brand-stripe-onboard/index.ts` | Runtime write path | Edge upsert writes `controller_dashboard_type: "none"`. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | CI blocker | ORCH-0954 allowlist lacked the tester adversarial test and the new migration/test paths. |
| `stripe-best-practices/references/connect.md` | Stripe controller terminology | Connect should be described by controller/dashboard values, not legacy account types. |

## 5. Blast Radius

- **Direct changes:** One new ORCH-0954 migration, one migration source-regression test, one strict-grep allowlist update.
- **Cascade changes:** Source-reconciled three already-remote migration files so the ORCH-0954 migration can be pushed without remote-only drift.
- **Parity surfaces:** Business onboarding and account-management both depend on the same `stripe_connect_accounts` row becoming persistable.
- **Cache impact:** None.
- **State boundaries:** DB remains the persisted source of truth for connected-account status; edge function already writes the intended value.
- **Auth/RLS/security:** No policy change; read-only remote probe only.
- **Deploy path:** Operator applies migration; tester reruns SPEC §6 live-fire after DB push.

## 6. Old To New Receipts

### `supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql`

- **Before:** Existing remote CHECK allowed only legacy `standard|express|custom`, so `controller_dashboard_type='none'` failed.
- **After:** Drops the old constraint, converts any legacy `standard` rows to `full` and legacy `custom` rows to `none`, then adds `full|express|none`.
- **Why:** Stripe Accounts v2 uses dashboard controller values; embedded onboarding requires `dashboard:none`.
- **Approx lines changed:** 23 new lines.

### `supabase/migrations/__tests__/orch_0954_controller_dashboard_type_check.test.ts`

- **Before:** No repo-running regression pinned that the DB permits `controller_dashboard_type='none'`.
- **After:** Deno test asserts the migration's final CHECK is exactly `full|express|none`, legacy values are excluded, legacy values are migrated, and onboard source writes `"none"`.
- **Why:** Prevents a repeat where edge code writes a value the DB rejects.
- **Approx lines changed:** 57 new lines.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

- **Before:** ORCH-0863 C7 would block the new tester adversarial test and the ORCH-0954 migration/test once committed.
- **After:** Allowlist includes `businessWebOrigin.adversarial.test.ts`, the ORCH-0954 migration/test, and source-reconciled remote-only migration files from ORCH-0950/0955/0957.
- **Why:** Keeps the unrelated ORCH-0863 marketing guard from blocking this backend Stripe rework.
- **Approx lines changed:** 17.

### Source-Reconciled Migration Files

- **Before:** `supabase migration list --linked` showed remote-only versions `20260725000002`, `20260727000000`, and `20260727000001`.
- **After:** The exact migration files were copied from their owning active worktrees into this worktree.
- **Why:** Implementor migration handoff rules forbid asking for `db push` while remote-only migrations remain unreconciled.
- **Approx lines changed:** 1692 source-reconciled lines.

## 7. Implementation Details

- **Architecture decisions:** Keep the existing constraint name so dependent diagnostics still point to `stripe_connect_accounts_type_check`.
- **Data flow:** `brand-stripe-onboard` already writes `controller_dashboard_type: "none"`; the migration now allows it to persist.
- **Mutation/query behavior:** Existing rows are backfilled before the new CHECK is added.
- **State handling:** No frontend or cache changes.
- **Error handling:** DB-level failure is removed; no edge catch behavior was changed.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Add monotonic migration replacing legacy values with controller-dashboard values including `none` | `20260727000002_orch_0954_controller_dashboard_type_check.sql` | Migration prefix is greater than local, remote, and active worktree heads; `migration list --linked` shows it local-only pending. | PASS |
| Add repo-running regression proving `none` persists | `orch_0954_controller_dashboard_type_check.test.ts` | Deno test passed and asserts onboard source writes `"none"` while DB CHECK admits `"none"`. | PASS |
| Include/reroute tester adversarial test for ORCH-0863 C7 | C7 allowlist now includes `supabase/functions/_shared/__tests__/businessWebOrigin.adversarial.test.ts` | Scoped Deno suite including that test passed; strict-grep script passed on tracked branch diff. | PASS |
| Hard guards | No edge deploys, no secrets, no Production key changes, no tax-dashboard touch | Git diff/path review. | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Worktree-per-ORCH | Yes | Yes | Work ran in `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/` on branch `ORCH-0954-embedded-onboarding-cutover`. |
| Migration monotonicity | Yes | Yes | New prefix `20260727000002` is greater than local/remote `20260727000001`; active worktrees were scanned. |
| Remote-only migration reconciliation | Yes | Yes | Worktree was linked locally and `migration list --linked` showed no blank-Local remote rows after reconciliation. |
| External API docs verified | Yes | Yes | Used `stripe-best-practices` Connect reference for controller-dashboard terminology. |
| TEST mode only | Yes | Yes | No Stripe live calls, no Supabase mutations, no edge deploys, no secret writes. |

## 10. Parity Check

- **Mobile:** No change.
- **Business app:** Runtime unblocked after DB push because existing edge upsert value becomes valid.
- **Admin:** No change.
- **Public/web:** No change.
- **Solo/collab:** No change.
- **Gaps:** Tester still owns the SPEC §6 live-fire rerun after DB push.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** `controller_dashboard_type` allowed values become `full|express|none`; legacy `standard/custom` rows are converted if present.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No change.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Remote data probe | Supabase MCP read-only SQL for current CHECK + values | PASS | Remote has legacy CHECK, 11 `express` rows, 0 incompatible rows. |
| Migration list | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | No remote-only rows after source reconciliation; `20260727000002` is local-only pending. |
| Migration regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/migrations/__tests__/orch_0954_controller_dashboard_type_check.test.ts` | PASS | 2 tests. |
| Scoped edge tests | `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-run supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts supabase/functions/_shared/__tests__/businessWebOrigin.adversarial.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts` | PASS | 6 tests. |
| Edge check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-onboard/index.ts supabase/functions/brand-stripe-account-session/index.ts` | PASS | No output, exit 0. |
| Strict grep | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs && node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs` | PASS | C7 passes on tracked branch diff; allowlist now includes new ORCH-0954 files for commit/PR diff. |

## 13. Regression Surface

1. Stripe embedded onboarding can now save `dashboard:none` rows instead of returning `sca_upsert_failed`.
2. Older connected-account rows with `express` remain valid.
3. Any unexpected lingering `standard/custom` row is converted before the new CHECK lands.
4. ORCH-0863 C7 remains strict for unrelated backend files while permitting this ORCH's backend work.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| DB migration pending | Deployed edge will still fail with `sca_upsert_failed` until the migration is applied. | Operator runs the exact DB push command below. | Supabase remote |
| Live-fire not rerun | SPEC §6 still unproven after this code-only fix. | Tester reruns live-fire after DB push. | `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` |
| Supabase advisor warning | Existing RLS-disabled backup/archive tables and `spatial_ref_sys` remain outside this ORCH. | Separate security triage decides whether/how to enable RLS and policies. | Supabase advisor |

## 15. Discoveries For Orchestrator

- Supabase MCP `list_tables` surfaced an existing security advisor warning for 11 RLS-disabled tables: `_backup_user_sessions`, `_backup_profiles`, `_backup_friends`, `_backup_messages`, `used_trial_phones`, `seed_map_presence`, `_orch_0588_dead_cards_backup`, `_orch_0588_dead_stops_backup`, `_archive_orch_0700_doomed_columns`, `_archive_orch_0734_signal_anchors`, and `spatial_ref_sys`. I did not remediate because it is outside ORCH-0954 and would need policy design.

## 16. Deploy Notes

- **Migrations:** Apply after this branch is committed/PR-ready:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]" && /Users/sethogieva/bin/supabase db push --linked
```

- **Edge functions:** Do not deploy edge functions from this rework. Existing deployed functions should be retested only after DB push.
- **Mobile OTA/native:** None.
- **Business/admin web:** None from this rework.
- **Env vars/secrets:** No secret writes; do not alter Stripe or Vercel Production keys.

## Suggested Commit Message

```text
fix(stripe-connect): allow dashboard none account persistence

Resolves: ORCH-0954
Evidence: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_DASHBOARD_NONE_PERSISTENCE.md
Deploy: supabase db push --linked required before SPEC §6 live-fire rerun
```

## Ready-To-Test Checklist

1. Run the DB push command above.
2. Ask tester to rerun SPEC §6 live-fire from `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`.
3. Expect `brand-stripe-onboard` to return a client secret instead of `internal_error:sca_upsert_failed` for a fresh TEST brand.
