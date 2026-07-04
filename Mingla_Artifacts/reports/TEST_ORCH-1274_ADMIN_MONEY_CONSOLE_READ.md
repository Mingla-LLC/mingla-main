# TEST — ORCH-1274 [Admin Money console — READ-ONLY]

**Verdict:** CONDITIONAL PASS — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 2 P4.
**Conditions (all dispatch-anticipated, none a defect):** (1) UI runtime capped at *suspected* — authed admin-web unreachable headlessly (dispatch-directed cap); source-review clean. (2) Empty money surfaces (refunds/disputes/payouts/installments/external_accounts/partner_splits) are *mechanism-proven* against 0 live rows (dispatch: "prove the MECHANISM … mark CONDITIONAL"). (3) Migration file-prefix vs recorded-version drift → Discovery for the orchestrator at CLOSE.
**THE invariant (money-containment) is PROVEN with live prod evidence.** Regression gate satisfied (implementor happy-path + tester adversarial, both on-branch/in-diff, both fails-on-revert).

Backend leg is SQL/RLS/RPC → source-only exemption lifted by live-fire on prod `gqnoajqerqhnvulmnyvv` (role-simulated admin/non-admin/anon). Admin uid `63835860-56bc-4ac9-a643-630558e111b5`. All probes READ-ONLY (SELECT / function-call, every mutation-shaped block in a rolled-back tx). COMMS-0052 (business OTA freeze) complied by construction — this ORCH touches only `mingla-admin` + `supabase`, no `mingla-business`, no `eas update`.

---

## 1. Per-AC verdict matrix (live evidence)

| AC | Verdict | Live evidence |
|----|---------|---------------|
| **AC-1 Money-containment (THE invariant)** | **PASS (proven)** | As authenticated + admin JWT (`is_admin_user()`=true): every DIRECT money-table `SELECT` returns **0 rows** — orders 0, order_line_items 0, mingla_revenue_log 0, stripe_connect_accounts 0, stripe_external_accounts 0, refunds 0, stripe_disputes 0, payouts 0, order_installments 0 — while the matching definer RPC returns the data: `admin_list_orders`→total 2, `admin_list_revenue_log`→total 49, `admin_list_brand_stripe_status`→total 1. `pg_policies`: NO `is_admin_user()` SELECT policy on ANY money table (orders/order_line_items/order_installments/refunds/refund_line_items/payouts/stripe_disputes/stripe_connect_accounts/mingla_revenue_log/stripe_external_accounts). RLS is ENABLED on all (relrowsecurity=true; partner_splits also relforcerowsecurity=true). `partner_splits` is the ONE `is_admin_user()`-bearing policy (`partner_splits_partner_self_select … OR is_admin_user()`) — the documented ORCH-1271 foundation exception (D-1), NOT flagged. |
| **AC-2 Cross-brand + silent-empty parity** | **PASS (data-bearing) / CONDITIONAL (multi-brand demo, data gap)** | RPC `total` == true service-role count for every list surface: orders 2==2, revenue_log 49==49, connect 1==1, refunds 0==0, disputes 0==0, payouts 0==0. Admin-direct-select=0 (AC-1) proves the RPC total is NOT the caller's membership subset → admin sees ALL brands' money by mechanism (base CTE carries no membership filter). Multi-brand cross-brand cannot be demonstrated with 2+ brands: only 1 brand (Smoke & Rhythm) currently holds money. NON-ADMIN (fake uid): all 10 RPCs raise `not_authorized`, `is_admin_user()`=false, zero leaks. ANON (role anon): all RPCs → `permission denied for function …` (EXECUTE revoked); direct anon table reads = 0 (RLS). |
| **AC-3 Correctness** | **PASS (proven)** | `admin_get_brand_stripe_status` returns keys {brand,status,account,provider,**requirements**,external_accounts}; derived status=`active`, provider=`stripe`, `requirements` key present, `account.charges_enabled`=true, external_accounts=[] (0 on file). `admin_get_order` bundle has all 7 keys {order,event,brand,line_items,installments,refunds,partner_split}; line_items count=1; brand="Smoke & Rhythm"; event="FIFA Grill Night"; installments/refunds = empty arrays. **Cents-not-formatted:** `order.total_cents` = JSON **number** `1000`; `revenue.amount_cents` = JSON number; migration carries no `to_char(`/`'$'`. **Guard-first:** all 10 RPCs proven guard-first behaviorally (non-admin → not_authorized as first action) + CI gate `i-admin-gate-first-statement.mjs`. **Least-privilege:** pg_proc ACL = `authenticated=X \| service_role=X` (no anon/PUBLIC); `has_function_privilege('anon',…,'EXECUTE')`=false, `('authenticated',…)`=true on ALL 10; all SECURITY DEFINER + STABLE. `admin_get_subscription_detail` under real admin JWT returns {subscription,effective_tier,raw_tier,override,override_history} and the nested admin-gated `admin_get_override_history` did NOT raise (closes impl D-3). |
| **AC-4 UI source review** | **CONDITIONAL (source clean; runtime *suspected*)** | 3 pages + card + `adminMoneyService.js` read: money read ONLY via `supabase.rpc(<10 names>)`, zero `.from(<money table>)` (happy-path 32/32 + manual read). Money formatted ONLY at the view layer (`formatMoney(cents,currency)` = cents/100 → Intl.NumberFormat, try/catch never throws). WAVE-2 act buttons ("Refresh from Stripe" / "Generate onboarding link" / "Issue refund") render `disabled` + `WAVE-2` Badge + tooltip, no onClick handlers. Empty/error(not_authorized·not_found·generic)/loading/retry states on every surface; per-section empty rows. "View subscriber" gated on `buyer_user_id`. No `brands.kind`. Nav wired (constants 3 items + Sidebar Receipt+Landmark in ICON_MAP + App 3 routes). Authed admin-web runtime unreachable headlessly → UI verdict capped at *suspected* per dispatch + `feedback_biz_web_authed_runtime_unreachable_cap_claims`. |
| **AC-5 Adversarial regression test** | **PASS** | New file `mingla-admin/src/__tests__/orch1274_money_containment_adversarial.test.js` (82 assertions, 6 suites), committed `b6d6b2750`, on-branch, in `origin/main...HEAD` diff, wired into CI job `orch-1274-money-read-authz`. Fails-on-revert verified (§4). |

---

## 2. Findings

**No P0 / P1 / P2.** The money-containment, least-privilege, guard-first, and correctness invariants all hold under live prod evidence.

### P3-1 — Migration file-prefix ≠ recorded prod version (provenance drift; orchestrator/CLOSE domain)
- **Evidence:** `list_migrations` (prod `gqnoajqerqhnvulmnyvv`) records `orch_1274_money_read_rpcs` under version **`20260703130017`** (siblings: 1271=`20260703102955/103006/103020/111413`, 1272=`20260703112932/112950`, 1273=`20260703125122/125302`). The branch migration FILE is named **`20261207000000_orch_1274_money_read_rpcs.sql`**. Deployed function CONTENT matches the branch (guard-first, cents, bundle shapes, total-full-count all behaviorally identical).
- **Impact:** When the operator runs `supabase db push` from merged main, the file `20261207000000_…` is not in `schema_migrations` (only `20260703130017` is), so db push will RE-APPLY it. It is idempotent (`CREATE OR REPLACE FUNCTION` + a `DO` self-assert that only reads `has_function_privilege`), and `20261207000000 > 20261202000000` (current max) so it applies monotonically — **safe**, but leaves the same functions recorded under two versions (history drift; cf. `project_migration_history_drift_db_push_unsafe`).
- **Required fix (orchestrator at CLOSE, NOT this ORCH):** reconcile — either re-stamp the branch file to match the applied `20260703130017` (and 1271/1272/1273 likewise) before merge, or accept the idempotent re-apply and confirm the post-merge db push is a no-op. Do NOT blind-push without the pre-flight monotonicity/drift check.
- **Retest:** after reconciliation, `supabase migration list` (or a dry-run) shows no duplicate-content pending migration.

### P4-1 — Praise: least-privilege golden template + apply-time self-assert
The tail `DO` block loops all 10 signatures asserting `has_function_privilege('anon',…)`=false and `('authenticated',…)`=true so apply FAILS if the lockdown breaks — verified live (anon EXECUTE denied on all 10). Clean defense-in-depth behind the guard-first check.

### P4-2 — Praise: view-layer-only currency formatting
`formatMoney` lives in the pages (never the service/RPC), divides integer cents by 100, and the `Intl.NumberFormat` is wrapped in try/catch (falls back to `amount.toFixed(2)` + code) — honors the cents-contract AND the I-1152 never-throw lesson.

---

## 3. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | openBrand/openOrder/openDispute/View-subscriber have real handlers; WAVE-2 buttons intentionally `disabled` (tooltip), not dead. |
| 2 | One owner per truth | PASS | `adminMoneyService` is the single money-read authority (RPC-only). |
| 3 | No silent failures | PASS | list fns throw → EntityListView error+retry; detail fns branch not_authorized/not_found/generic. |
| 4 | One query key per entity | N/A | Admin uses hash-router + local state, no React-Query key factory here. |
| 5 | Server state stays server-side | PASS | No Zustand; page-local useState only. |
| 6 | Logout clears everything | N/A | No new persisted client state. |
| 7 | Label temporary `[TRANSITIONAL]` + exit | PASS | WAVE-2 act buttons tagged + disabled; deferred to a later wave (SPEC §9). |
| 8 | Subtract before adding | N/A | Additive read-only console. |
| 9 | No fabricated data | PASS | Missing values render `—`; no faked amounts; cents from DB. |
| 10 | Currency-aware | PASS | Amounts always carry `currency`; `formatMoney(cents,currency)`. |
| 11 | One auth instance | PASS | Uses shared `../lib/supabase`. |
| 12 | Validate at right time | N/A | No datetime input. |
| 13 | Exclusion consistency | PASS | `deleted_at IS NULL` in the Connect-status base CTE. |
| 14 | Persisted-state startup gate | N/A | No hydration-gated store added. |

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert + tester's own

Worktree `~/Desktop/mingla-orchs/1274-[admin-money-console]`, branch `1274-admin-money-console`, HEAD `b6d6b2750`.

- **HEAD (guard intact):** implementor `orch1274_money_console_read.test.js` = **32/32 pass**; tester `orch1274_money_containment_adversarial.test.js` = **82/82 pass** (combined 114/114).
- **True line-deletion** of the `admin_list_orders` guard (line 128: `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;`) → first stmt becomes `WITH base AS (`:
  - Implementor happy-path → **31/32**, failing `admin_list_orders: is guard-first on is_admin_user()` ("guard must be the first statement after BEGIN").
  - Tester adversarial → **81/82**, failing suite **E** `admin_list_orders: no query precedes the is_admin_user() guard` ("a query precedes the is_admin_user() guard — fail-open window (found: \"WITH base AS ( SELECT o.id…\")").
  - CI gate `i-admin-gate-first-statement.mjs` → **FAIL** ("first executable statement is NOT an is_admin_user() guard").
- **Restore** (`cp` backup) → 114/114 green; `git status` shows only the new adversarial test.

`fails-on-revert verified at b6d6b2750` (both suites, independently re-run).

---

## 5. Adversarial test added

- **Path:** `mingla-admin/src/__tests__/orch1274_money_containment_adversarial.test.js` (commit `b6d6b2750`).
- **Different angle vs the implementor happy-path** (which asserts guard-present/adjacent + REVOKE/GRANT + no `.from`): this suite attacks the same money-containment + least-privilege + guard-first invariant from six angles the happy-path misses —
  - **A. READ-ONLY** — no `insert/update/delete` on any money table, no `admin_write_audit(` (a mutating money console = P0).
  - **B. SECURITY DEFINER preserved** — a definer→invoker regression would run the RPC with the caller's RLS and empty it for the admin.
  - **C. `total` = full filtered count** — asserts `(SELECT count(*) FROM filtered)`, forbids `jsonb_array_length(v_rows)` (silent under-count on page 2+ → admin loses cross-brand parity).
  - **D. No money-table SELECT grant broadening** — the migration hands anon/authenticated no fresh table-level `GRANT SELECT` (would bypass the RPC).
  - **E. Guard has NO query before it** — independent parse (comment-stripped): first exec stmt after BEGIN must be the `not_authorized` guard, no `WITH/SELECT/PERFORM/…` prefix (fail-open window). **← fails-on-revert anchor.**
  - **F. Cross-migration containment** — across ALL migrations, no money table carries an `is_admin_user()` policy except `partner_splits` (1271 foundation).
- Both tests present in `git diff origin/main...HEAD --name-only`; wired into CI job `orch-1274-money-read-authz` (step "Run ORCH-1274 money-containment TESTER adversarial regression"). `fails-on-revert verified at b6d6b2750`.

---

## 6. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS / Android (`app-mobile/`) | N/A | Admin-only; not touched. |
| Buyer/anon Web (`mingla-business/` public) | N/A | Not touched (COMMS-0052 compliance by construction). |
| Business iOS / Android (`mingla-business/`) | N/A | Not touched. |
| **Backend RPC/RLS (prod `gqnoajqerqhnvulmnyvv`)** | **PASS (proven, live-fire)** | Containment/authz/correctness proven via role-simulated SQL (admin/non-admin/anon). SQL-leg source-exemption lifted by live-fire. |
| **Admin Web (`mingla-admin/`)** | **CONDITIONAL (source clean; runtime *suspected*)** | Static + build clean; authed admin-web runtime unreachable headlessly (dispatch-directed cap). No sim applies (web-only surface). |
| Business Web preview (adjacent) | N/A | Not touched. |

Physical iPhone HITL: N/A (no consumer/business mobile surface). Edge-fn deploy: none (no edge fn touched). Migration live-deploy state: functions live + correct (proven); version-stamp provenance = P3-1.

---

## 7. Discoveries for Orchestrator

- **D-ORCH-1 (= P3-1):** 1271–1274 migrations are live under `20260703*` version stamps but their branch FILES use `2026120x` prefixes → reconcile at CLOSE before `supabase db push` (idempotent re-apply is safe but drifts history). Do the pre-flight monotonicity/drift check.
- **D-ORCH-2:** `partner_splits` correctly carries the sole `is_admin_user()` money-table policy (1271 foundation) and is excluded from `i-money-no-admin-rls` + the adversarial suite F. Confirmed by design — no action, flagged so the invariant-flip at CLOSE documents the single exception.
- **D-ORCH-3:** Multi-brand cross-brand parity is mechanism-proven only (1 brand holds all money today). When a 2nd brand accrues orders/revenue, a one-line re-probe (RPC total == service-role count) upgrades AC-2 to fully proven.
- **D-ORCH-4:** At CLOSE flip the 2 DRAFT invariants (`I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC`, `…-CENTS-CONTRACT`) ACTIVE and remove the registry row.

---

## 8. Accepted conditions (CONDITIONAL PASS)

Zero P0/P1. The CONDITIONAL tier is driven solely by dispatch-anticipated gaps, not defects:
1. **UI runtime = suspected** — authed admin-web unreachable headlessly (dispatch explicitly directed this cap). Source-review is clean. Unblock = Seth smoke-test (§ below) OR a follow-up authed-runtime pass.
2. **Empty money surfaces mechanism-proven** — refunds/disputes/payouts/installments/external_accounts/partner_splits have 0 live rows; RPC shape + containment + guard proven; upgrades to proven on real data.
3. **P3-1 migration provenance** — orchestrator reconciles at CLOSE.

**Report path:** `Mingla_Artifacts/reports/TEST_ORCH-1274_ADMIN_MONEY_CONSOLE_READ.md` (anchor + worktree copy).
