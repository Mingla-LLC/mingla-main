# IMPLEMENTATION — ORCH-1271 [Admin authorization & audit FOUNDATION]

**Phase:** IMPLEMENT (built + self-verified; NOT deployed/merged/closed).
**Worktree:** `~/Desktop/mingla-orchs/1271-[admin-authz-foundation]/` on branch `1271-admin-authz-foundation`.
**Spec (binding contract):** `Mingla_Artifacts/reports/SPEC_ORCH-1271_ADMIN_AUTHZ_FOUNDATION.md`.
**Commit:** `2b91e1e6c` (all scoped work) + this report.
**Status:** implemented and self-verified (JS/lint/build/strict-grep/deno gates green; SQL live-fire is the tester's job post-deploy).

---

## 1. Summary (plain English)

Built the admin console FOUNDATION per spec — nothing user-facing that touches real business data yet. Three things landed:
1. **One admin gate everywhere.** The two partner-money read policies that used the old `profiles.account_type='admin'` check now use the canonical `is_admin_user()` — so a new admin can't silently lose partner-money visibility.
2. **A safe "audited write" primitive.** A shared DB helper + one proven demo RPC + a service-role edge function that force every admin write to be guarded (admin-only) and logged (who/what/why) before it happens. Built and unit-proven, but wired to nothing except a harmless self-test.
3. **Reusable admin UI shells + a new "Business" nav tab** with a placeholder Business Console page that proves the shells + the audited-write round-trip render end-to-end.

Plus 3 CI guard scripts, 3 DRAFT invariants, and 2 decision-log records.

---

## 2. SPEC acceptance-criteria coverage

| AC | What | Status | Evidence (commit `2b91e1e6c`) |
|---|---|---|---|
| AC-1.1/1.2 | Both partner SELECT policies flip to `is_admin_user()`, self-branches preserved, `account_type` gone | ✓ code | `20261204000000_orch_1271_single_admin_gate.sql`; happy-path test 2 assertions; prod probe = 2 account_type policies (both are these) |
| AC-1.3 | `i-admin-single-gate.mjs` FAILS on revert; migration `DO $$` self-assert | ✓ | strict-grep `--self-test` 3/3 PASS; fails-on-revert proven (§6) |
| AC-2.1 | `admin_audit_log` gains `actor_uid`/`reason` (nullable) + `idx_audit_log_target`; legacy insert still works | ✓ code | `20261204000001_orch_1271_audit_log_extend.sql` (ADD COLUMN IF NOT EXISTS, nullable); `logAdminAction` untouched |
| AC-2.2 | `admin_audit_probe` returns uuid + writes audit row | ✓ code (live-fire deferred) | `20261204000002_...` §2c verbatim; runtime proof = tester post-deploy |
| AC-2.3/2.4 | blank/whitespace reason → `reason_required`; non-admin → `not_authorized`; no row | ✓ code (live-fire deferred) | helper guard-first + reason gate verbatim; tester live-fires |
| AC-2.5 | edge fn 401/403/400/200 matrix | ✓ code (live-fire deferred) | `admin-write-primitive/index.ts` mirrors `careers-cv-signed-url`; `deno check` PASS; tester curls post-deploy |
| AC-2.6 | `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` FAIL on revert | ✓ | both `--self-test` PASS (3/3, 4/4); helper/probe absence → FAIL |
| AC-3.1 | READ-authz convention doc | ✓ (spec §3) | contract inherited by 1272/1273/1274 (no live read added here) |
| AC-4.1 | admin builds clean; "Business" group renders w/ non-fallback `Building2`; `#/business-console` loads page | ✓ | `npm run build` PASS (2962 modules); `Building2` in Sidebar ICON_MAP; App.jsx PAGES entry |
| AC-4.2 | list search/sort/pagination/CSV/empty | ✓ | `EntityListView` + `BusinessConsolePage` demo dataset (pageSize 3 → pagination visible) |
| AC-4.3 | row click → detail + back | ✓ | `onRowClick` → `EntityDetailView` w/ back breadcrumb |
| AC-4.4 | self-test → modal; confirm disabled empty; enabled w/ reason; calls `runAuditProbe` + shows audit_id + toast | ✓ code | `HighRiskActionModal` disabled-until-reason; page shows `lastAuditId` + success toast |
| AC-4.5 | modal never fires `onConfirm` empty; close preserves no partial write | ✓ | hard guard `if (requireReason && reason.trim().length===0) return;`; reset-on-close |
| AC-4.6 | scope held — no domain tables in `BusinessConsolePage.jsx` | ✓ | happy-path test greps 0 hits for creator_accounts/events/orders/stripe_connect_accounts |
| AC-5.1 | 3 DRAFT invariants + 3 strict-grep scripts + `--self-test` + 3 workflow steps; all PASS | ✓ | INVARIANT_REGISTRY DRAFT section; workflow job `orch-1271-admin-authz-foundation` |
| AC-5.2 | 2 DEC records | ✓ | DEC-194 (brands.kind alive) + DEC-195 (single gate) |

---

## 3. Files changed (20 files, +1834 / −1)

**Migrations (author only — DO NOT apply here):**
- `supabase/migrations/20261204000000_orch_1271_single_admin_gate.sql` (+79) — DROP+CREATE the two partner SELECT policies with `is_admin_user()` (self-branches preserved verbatim) + `DO $$` self-assert.
- `supabase/migrations/20261204000001_orch_1271_audit_log_extend.sql` (+60) — `ADD COLUMN actor_uid uuid, reason text` (nullable) + `idx_audit_log_target` + column comments + self-assert.
- `supabase/migrations/20261204000002_orch_1271_admin_write_primitive.sql` (+96) — `admin_write_audit(...)` helper + `admin_audit_probe(...)` golden RPC (spec §2b/§2c verbatim) + self-assert.

**Edge fn:**
- `supabase/functions/admin-write-primitive/index.ts` (+95) — guarded no-op prover.
- `supabase/config.toml` (+9) — `[functions.admin-write-primitive] verify_jwt = true`.

**Admin UI (`mingla-admin/src/`):**
- `components/entity/EntityListView.jsx` (+247) · `EntityDetailView.jsx` (+136) · `HighRiskActionModal.jsx` (+157)
- `services/adminWriteService.js` (+41) · `pages/BusinessConsolePage.jsx` (+203)
- `lib/constants.js` (+11, Business group) · `components/layout/Sidebar.jsx` (+4, `Building2`) · `App.jsx` (+4, PAGES entry)

**CI + invariants + DEC:**
- `.github/scripts/strict-grep/i-admin-single-gate.mjs` (+141) · `i-admin-write-audited.mjs` (+139) · `i-admin-gate-first-statement.mjs` (+149)
- `.github/workflows/strict-grep-mingla-business.yml` (+24, one job = 6 steps)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+28/−1) · `Mingla_Artifacts/DECISION_LOG.md` (+31)

**Regression test:**
- `mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` (+180, 21 assertions).

---

## 4. Data-model changes (authored, NOT applied)

- `admin_audit_log`: `+ actor_uid uuid` (nullable), `+ reason text` (nullable), `+ idx_audit_log_target (target_type, target_id)`. Backward-compatible with client `logAdminAction` (no NOT-NULL churn).
- New fn `public.admin_write_audit(...)` SECURITY DEFINER, `SET search_path public`, guard-first.
- New fn `public.admin_audit_probe(p_reason text, p_note text DEFAULT NULL)` SECURITY DEFINER, guard-first, no business mutation.
- RLS: `partner_stripe_self_select` + `partner_splits_partner_self_select` split-gate branch replaced by `is_admin_user()` (self/brand-team branches preserved).

**Read-only prod probe (COMMS-0061 compliant — SELECT only, no mutation), 2026-07-03:**
```
account_type_admin_policies              = 2   (both are the two target policies)
target_policies_present                  = partner_stripe_connect_accounts/partner_stripe_self_select, partner_splits/partner_splits_partner_self_select
admin_audit_log_new_cols_already_present = (none)   → ADD COLUMN safe
idx_audit_log_target_present             = (none)   → CREATE INDEX safe
admin_write_audit_exists                 = (none)   → CREATE FUNCTION safe
```
No unexpected third `account_type='admin'` policy → the migration's post-flip `DO $$` self-assert will PASS. No pre-flight guard can abort against existing rows.

---

## 5. Edge functions touched (deploy from MERGED main — orchestrator/operator-owned)

| Fn | `verify_jwt` (preserve) | Deploy note |
|---|---|---|
| `admin-write-primitive` | **true** | New. Verify curls: anon → 401; non-admin authed → 403; admin + blank/whitespace reason → 400; admin + reason → 200 `{ok:true, audit_id}` + matching `admin_audit_log` row with `actor_uid`=user.id. |

`deno check supabase/functions/admin-write-primitive/index.ts` → PASS (exit 0).

---

## 6. Regression test + fails-on-revert proof

- **Happy-path test:** `mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` (21 assertions, `node:test` + `fs` source-assertion, node_modules-free). `node --test` → **21 pass / 0 fail**.
- **Fails-on-revert verified at commit `7e58a7400`:** true LINE DELETION (not comment-out) of both `OR public.is_admin_user()` lines in `20261204000000_orch_1271_single_admin_gate.sql`:
  - happy-path test → **19 pass / 2 fail** (the two single-gate assertions fail).
  - `i-admin-single-gate.mjs` (real tree) → **FAIL, exit 1** ("latest partner_stripe_self_select / partner_splits_partner_self_select definer does not gate on is_admin_user()").
  - `git checkout` restore → happy-path **21/21 PASS**, `i-admin-single-gate.mjs` **exit 0**, tree clean.
- **Strict-grep gates (each embeds GOOD/BAD `--self-test` fixtures — inherent fails-on-revert):**
  - `i-admin-single-gate.mjs --self-test` → PASS (3/3) · real tree → PASS
  - `i-admin-write-audited.mjs --self-test` → PASS (3/3) · real tree → PASS
  - `i-admin-gate-first-statement.mjs --self-test` → PASS (4/4) · real tree → PASS

Both the happy-path test AND all 3 strict-grep scripts are in the closing diff (`git diff origin/main...HEAD --name-only`).

---

## 7. Old → New receipts

**`partner_stripe_self_select` / `partner_splits_partner_self_select` (RLS):** before → admin branch = `EXISTS(profiles WHERE id=auth.uid() AND account_type='admin')`; now → `public.is_admin_user()`. Self-access + brand-team branches preserved verbatim. Why: AC-1 / single-gate standardization (removes the account_type drift). ~10 lines each.

**`admin_audit_log` (schema):** before → 7 columns, 4 indexes; now → `+actor_uid`, `+reason`, `+idx_audit_log_target`. Why: AC-2.1 (actor PK + typed reason + entity-trail index). +3.

**`admin_write_audit` / `admin_audit_probe` (new fns):** before → no shared audited-write helper existed; now → guard-first (`is_admin_user()`) + reason gate + `admin_audit_log` insert; probe calls the helper with no business mutation. Why: AC-2.2–2.4 (the primitive). +~40.

**`admin-write-primitive/index.ts` (new edge fn):** before → n/a; now → `getUser` → `admin_users` active → 403 → audited no-op via `admin_write_audit` (explicit `p_actor_*`) → 400 on blank reason. Why: AC-2.5. +95.

**`EntityListView`/`EntityDetailView`/`HighRiskActionModal` (new shells):** before → n/a; now → server-driven list (debounced search/server sort+pagination/CSV/empty/error/loading), detail (breadcrumbs/sections/action row), typed-reason+confirm modal (disabled-until-reason, reset-on-close, inline error). Reuse `ui/*` — no fork of `Table.jsx`/`Modal.jsx`. Why: AC-4.2–4.5.

**`BusinessConsolePage` + nav (`constants.js`/`Sidebar.jsx`/`App.jsx`):** before → n/a; now → "Business" group + `Building2` in ICON_MAP + `#/business-console` route; static demo dataset proves the shells; one live `runAuditProbe` self-test. Why: AC-4.1/4.4/4.6.

---

## 8. Cross-surface impact

| Surface | Affected? | Note |
|---|---|---|
| Consumer iOS / Android | No | no shipping-app code touched |
| Buyer/anonymous Web | No | no buyer route touched |
| Business iOS / Android | No | no `mingla-business/` code touched |
| **Admin Web** (adjacent) | **Yes** | new "Business" nav + Business Console scaffolding; builds clean; parity is automatic (single Vite app) |
| Business Web preview (adjacent) | No | unaffected |
| **Backend** (migrations/RPC/edge) | **Yes (authored, not applied)** | RLS flip + audit-log extend + primitive + edge fn — orchestrator deploys |

Parity is automatic (single admin codebase; single backend). No manual multi-surface parity work.

---

## 9. Gate results (self-verify)

- `cd mingla-admin && npm run build` → **PASS** (vite, 2962 modules, 3.49s; chunk-size warning is pre-existing, not an error).
- `npm run lint` (`eslint .`) → **pre-existing RED baseline** (75 errors across files NOT in ORCH-1271 scope, e.g. SignalLibraryPage/StripeModePage/SubscriptionManagementPage/UserManagementPage + Sidebar:71 useCallback + App.jsx:2 motion). **Net-new lint errors from ORCH-1271 = 0**, proven per-file vs `origin/main` (stdin-lint): App.jsx 1=1, Sidebar 2=2, constants 0=0; all 8 newly-created files lint **clean** (0 errors) after the `HighRiskActionModal` reset-on-close refactor (removed the one `set-state-in-effect` I'd introduced).
- `node --test src/__tests__/orch1271_admin_authz_foundation.test.js` → **21 pass / 0 fail**.
- 3 strict-grep `--self-test` + real-tree runs → all **PASS**.
- `deno check` edge fn → **PASS**.
- `supabase/config.toml` TOML parse → OK (`verify_jwt = true`). Workflow YAML parse → OK.

---

## 10. Known issues / deferred

- **No `[TRANSITIONAL]` code.** None added.
- **Q1/Q2/Q3 (spec Open Questions) — defaults taken:** before/after stays in `metadata` (Q1); the edge fn ships as a deployed guarded prover (Q2, orchestrator deploys); `is_admin_user()` hardening (missing `SET search_path`) is OUT of scope — routed to a separate ORCH (Q3). New 1271 fns already set `search_path public`.
- **`admin_audit_probe` executability:** relies on the default Postgres PUBLIC EXECUTE grant (so a non-admin authed session can call it and hit the guard → `not_authorized`, per AC-2.4). No explicit GRANT added (spec §2c verbatim). Tester should confirm the guard fires at live-fire.

---

## 11. Operator action required (orchestrator DEPLOY, post-REVIEW)

1. **Apply migrations** (safe-migration protocol, from the worktree):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1271-[admin-authz-foundation]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Order is monotonic: `20261204000000` → `...01` → `...02`. Read-only probe (§4) confirms all three apply cleanly (no pre-flight abort). Max prior prefix on main = `20261202000000`. NOTE: renumbered from 20261203* → 20261204* after 1270-[sms-quiet-hours-defer] concurrently claimed `20261203000000` (renumber commit `7e58a7400`).
2. **Deploy edge fn** (from MERGED main): `admin-write-primitive` (preserve `verify_jwt=true`). Verify with the AC-2.5 curl matrix (401/403/400/200 + audit row).
3. **Flip 3 invariants** DRAFT → ACTIVE in `INVARIANT_REGISTRY.md` at CLOSE.
4. **Merge one PR** (all CI green incl. the new `orch-1271-admin-authz-foundation` strict-grep job).
5. **DEC numbering:** used DEC-194/195 (max referenced = DEC-193). Renumber at CLOSE if a parallel session claimed them.

---

## 12. Discoveries for Orchestrator

- **A-1 (spec-registered, DO-NOT-TOUCH here):** `admin_set_city_live` is a guard-less invoker-rights RPC — later ORCH. Untouched.
- **D-1/G-7 (spec-registered, DO-NOT-TOUCH here):** `delete-user` edge fn self-deletes the caller's own id; no safe admin arbitrary-user-delete path — later ORCH. Untouched.
- **Q3 (routed):** `is_admin_user()` lacks `SET search_path` (platform-wide fn) — recommend a dedicated hardening ORCH; out of 1271 blast radius.
- **Admin lint baseline is RED on `origin/main`** (75 pre-existing `eslint .` errors in files outside this ORCH). `npm run lint` cannot be green until a separate cleanup ORCH addresses them; ORCH-1271 adds ZERO net-new errors. Flagging so the CLOSE gate treats admin lint as a known-red baseline, not an ORCH-1271 regression.
