# QA REPORT — ORCH-0921 [Trip payment-plan finalize silently drops `installment_plan_root` + child installments — €375/order revenue leak]

**Tester:** Claude `mingla-tester`
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** TARGETED (orchestrator-dispatched, ORCH-ID bound)
**Implementor return:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` (Codex `implementor-mingla`)
**Orchestrator REVIEW:** `Mingla_Artifacts/reports/REVIEW_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` (Claude `mingla-orchestrator` APPROVED)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`

---

## VERDICT

**CONDITIONAL PASS** — P0:0 / P1:0 / P2:0 / P3:1 / P4:3.

CONDITIONAL because: the runtime live-fire smoke against a real new payment-plan trip booking on Vercel preview (SC-18) was NOT executed by the tester — it requires the operator to run a Stripe test-mode purchase against The DC Adventure (or similar) on the Vercel preview URL with a real card flow + buyer email + browser-side Stripe redirect. Tester's evidence on the LIVE fix correctness is otherwise complete: deployed RPC body inspected via `pg_proc`, both deployed edge function sources fetched via Supabase MCP and verified line-by-line against the SPEC, implementor's 9 tests independently re-run + 20 tester adversarial tests written and passed, backfilled order state probed live, org-wide leaker audit returns 0.

The CONDITIONAL gate clears automatically when either (a) operator runs the 5-tap smoke documented in §"Operator post-close smoke" and confirms in chat, OR (b) operator explicitly accepts the deferral per the standard CONDITIONAL PASS pattern (precedent: ORCH-0914 Money tab same-day close where Money-tab sim-drive was deferred to operator).

---

## 1. Sim evidence + live-fire gate

**Live-fire gate per Phase 0.A:** ORCH-0921 is a backend-only fix (migration + 2 edge function parameter changes + CI gate + tests). No UI changes, no React Native bundle changes, no client-side cache changes. Per the forensics + tester skill's Phase 0.A exemption clause ("Exemptions: backend-only / SQL-only / RLS / edge-function-only / CI / build-config / lint / type-only / pure refactor with zero behavior change"), source-only reasoning is sufficient for the FIX itself — backed by direct DB probes and remote edge fn source fetch.

**However, the SPEC's SC-18 explicitly demands** runtime parity verification on (a) buyer-anonymous web via Vercel preview, (b) business iOS sim, (c) business Android emu. This is the RIGHT bar for a S0 revenue-integrity bug — backend-only exemption applies to PROVING CORRECTNESS of the fix shape, not to PROVING RUNTIME PARITY of the deployed surfaces against real Stripe traffic.

**Sim attempts this turn:**

| Surface | Attempt | Result | Confidence |
|---|---|---|---|
| **Vercel preview / buyer-anonymous web** | Not attempted by tester — requires operator-owned actions: navigate to a live Vercel preview URL for `mingla-business`, select The DC Adventure (or another payment-plan trip), choose payment plan, pay €125 deposit with Stripe test card `4242 4242 4242 4242`, watch the DB after | DEFERRED to operator | `probable` per Phase 0.A — deployed RPC + edge fn source verified live, the runtime sequence is deterministic from those two; sim attempt blocked by lack of operator-owned Vercel preview credentials + Stripe test-mode browser session in this tester session |
| **Business iOS sim** | Not attempted by tester — same reason (no operator-owned planner login state, native PaymentSheet deep-link return state) | DEFERRED to operator | `probable` |
| **Business Android emu** | Not attempted by tester — same reason | DEFERRED to operator | `probable` |

**Source-only proofs this tester DID complete (proven-level for the fix shape):**

1. `pg_proc` confirms exactly 1 overload of `biz_ticket_checkout_finalize` at `pronargs=8`, `prosecdef=true` (SECURITY DEFINER), function body length 10,192 chars, contains the ORCH-0921 comment, contains `installment_plan_root = false` self-heal guard, contains `NOT EXISTS order_installments` idempotency guard, contains the first-call `installment_plan_finalize_missing_customer_or_pm` guard.
2. Deployed `ticket-checkout-confirm` v32 source fetched via Supabase MCP `get_edge_function` and verified: contains the `ORCH-0921: pass installment-plan params through...` comment, contains `piMetadata["mingla_installment_plan_root"] === "true"` derivation, contains `typeof paymentIntent.customer === "string"` + `typeof paymentIntent.payment_method === "string"` type guards, contains all 8 RPC params in the call payload including the 3 new ones.
3. Deployed `reconcile-stuck-checkouts` v23 source fetched via Supabase MCP and verified: same shape with appropriate `(pi as unknown as { customer?: unknown }).customer` Stripe SDK type narrowing.
4. Backfilled order `47374d23-…` post-state via live SELECT: `total_cents=12500`, `installment_plan_root=true`, `has_customer=true`, `has_pm=true`, `inst_count=2`, `inst_total=37500`. Org-wide leaker audit returns 0.
5. `supabase migration list --linked` confirms `20260724000000_orch_0921_finalize_compare_and_correct.sql` is on remote (Local + Remote columns both populated).

The runtime gap is narrow: any real payment-plan booking made on the deployed stack will now correctly route through the patched edge fn → correctly-shaped RPC call → migration's first-call branch (since the order doesn't exist yet) → installments scheduled. The compare-and-correct branch only fires if a buggy first call somehow leaves a half-finalized state, which the patched edge fns now never produce.

---

## 2. Tests run independently this turn

### Implementor's 9 regression tests + strict-grep gate re-run (verifying implementor's claim)

| Suite | Path | Result |
|---|---|---|
| T-01, T-02 — confirm caller payload shape | `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts` | **2/2 PASS** |
| T-03, T-04 — reconcile caller payload shape | `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts` | **2/2 PASS** |
| T-05, T-06, T-07 — compare-and-correct + idempotency + legacy path preservation | `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts` | **3/3 PASS** |
| T-08, T-09 — strict-grep gate functional + allowlist | `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.test.mjs` | **2/2 PASS** |
| Strict-grep gate (production scan) | `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` | **PASS** — scanned 190 files, 4 finalize callers, 1 free caller skips, 0 violations |

**Implementor's fails-on-revert** verified by implementor against pre-fix commit `0169b4a360cfb678799c1691b01c25dc8b106509` (implementation report §12) — accepted per orchestrator REVIEW.

### Tester adversarial tests (20 new tests, different angles from implementor's 9)

| File | Tests | Result |
|---|---|---|
| `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct_adversarial.test.ts` | TA-S01..TA-S09 — 4 self-heal NEGATIVE guards (must NOT fire when customer NULL / PM NULL / order already correct / installments already exist), self-verify probe non-bypassability, first-call missing-customer-or-PM guard preservation, SECURITY DEFINER + service_role grant intact, cross-table source correctness (reads from session not orders.metadata), response payload `installmentPlanRoot` computed from live row post-self-heal | **9/9 PASS** |
| `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params_adversarial.test.ts` | TA-C01..TA-C06 — strict-grep gate detects this specific call site, metadata key string exactness, metadata value string-vs-boolean comparison correctness, typeof-string type narrowing on customer + PM, explicit-pass not-relying-on-RPC-defaults, exactly-one-invocation no-double-call | **6/6 PASS** |
| `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params_adversarial.test.ts` | TA-R01..TA-R05 — webhook-router pattern parity, Stripe SDK union type narrowing, service-role-only auth gate preserved, per-session try/catch partial-success preservation, exactly-one-invocation no-double-call | **5/5 PASS** |

**Adversarial differentiation:** the implementor's tests prove the HAPPY PATHs work. The tester's tests prove the BAD-CONDITION paths reject correctly, the SECURITY surface is preserved, the source patches match the deployed live code (not just local files), and the migration guards are not bypassable. Different angles per ORCH-0840 discipline.

### Independent live data probes via Supabase MCP

| Probe | Query | Result |
|---|---|---|
| Migration on remote | `supabase migration list --linked` | `20260724000000` present in Local + Remote columns |
| RPC overload count | `SELECT COUNT(*) FROM pg_proc WHERE proname='biz_ticket_checkout_finalize' AND pronargs=8` | **1** ✓ |
| RPC SECURITY DEFINER | `SELECT prosecdef FROM pg_proc WHERE proname='biz_ticket_checkout_finalize'` | **true** ✓ |
| RPC body has ORCH-0921 comment | `prosrc LIKE '%ORCH-0921%'` | **true** ✓ |
| RPC body has compare-and-correct guard | `prosrc LIKE '%installment_plan_root = false%'` | **true** ✓ |
| RPC body has idempotency guard | `prosrc LIKE '%NOT EXISTS%order_installments%'` | **true** ✓ |
| RPC body has first-call missing-customer-or-PM guard | `prosrc LIKE '%installment_plan_finalize_missing_customer_or_pm%'` | **true** ✓ |
| Backfilled order state | live SELECT | `total_cents=12500, installment_plan_root=true, has_customer=true, has_pm=true, inst_count=2, inst_total=37500` ✓ |
| Org-wide leaker audit (re-run after backfill) | live tier-vs-order JOIN | **0 leakers, €0 outstanding** ✓ |
| Deployed `ticket-checkout-confirm` source via MCP | `mcp__supabase__get_edge_function` v32 | Source matches local patch exactly (ORCH-0921 comment, 3 new params present) ✓ |
| Deployed `reconcile-stuck-checkouts` source via MCP | `mcp__supabase__get_edge_function` v23 | Source matches local patch exactly (ORCH-0921 comment, 3 new params present) ✓ |
| `verify_jwt` preservation | `mcp__supabase__list_edge_functions` | `ticket-checkout-confirm: false` (per local config) + `reconcile-stuck-checkouts: true` (remote default preserved) ✓ |

### Combined test totals

- **9/9 implementor regression tests PASS** (T-01..T-09)
- **20/20 tester adversarial tests PASS** (TA-S01..TA-S09 + TA-C01..TA-C06 + TA-R01..TA-R05)
- **4/4 strict-grep gates PASS** (new ORCH-0921 gate + Tr3 cron-owner gate + ORCH-0914 manual-helper gate + ORCH-0913 no-tabs-on-dashboards)
- **11/11 live data probes PASS** (migration + RPC introspection + deployed edge fn source + verify_jwt settings + backfilled state + leaker audit)

---

## 3. SPEC compliance matrix (SC-01..SC-18)

| SC | Description | Status | Evidence |
|---|---|---|---|
| SC-01 | confirm caller passes 8 params | **PASS** | TA-C05 + T-01 + live `ticket-checkout-confirm` v32 source |
| SC-02 | reconcile caller passes 8 params | **PASS** | TA-R01 + T-03 + live `reconcile-stuck-checkouts` v23 source |
| SC-03 | New payment-plan order has correct flags post-finalize (live behavior) | **DEFERRED** | Source-only proves the fix produces the right RPC call shape; runtime confirmation against a new Stripe purchase deferred to operator per SC-18 |
| SC-04 | Order_installments rows match session.installment_schedule | **DEFERRED** (same as SC-03) | First-call branch verified intact at TA-S06; runtime against new purchase deferred |
| SC-05 | Reconcile produces SC-03+SC-04 state | **PASS source-only** | TA-R01..TA-R05 + T-03/T-04 |
| SC-06 | Compare-and-correct self-heals half-finalized order | **PASS** | T-05 + TA-S08 (live RPC body verified contains the branch) |
| SC-07 | Compare-and-correct is idempotent on second call | **PASS** | T-06 + TA-S04 (NOT EXISTS guard live) |
| SC-08 | Strict-grep gate scan PASSES post-fix | **PASS** | Independent re-run: 190 files, 0 violations |
| SC-09 | Strict-grep gate FAILS on synthetic violator | **PASS** | T-09 + TA-C01 |
| SC-10 | Cron auto-charges Jun 21 + Jul 21 backfilled installments | **DEFERRED (time-gated)** | Cannot verify until Jun 22; backfilled state + cron source unchanged confirms the rows ARE visible to the cron query |
| SC-11 | DB-wide audit returns ZERO leakers post-fix | **PASS** | Independent live SELECT returns `remaining_org_wide_leakers: 0` |
| SC-12 | Backfill compatibility (SQL safe before/after code fix) | **PASS** | Orchestrator already ran backfill before tester turn; subsequent finalize calls hit NOT EXISTS guard and no-op |
| SC-13 | Non-installment checkouts still work (legacy fall-through) | **PASS** | TA-S06 + T-02 + T-04 + T-07 |
| SC-14 | 13/13 ORCH-0914 cron Deno regression PASS | **PASS** (implementor-verified §12) | Trusted per implementor evidence |
| SC-15 | 33/33 ORCH-0914 + 41/41 ORCH-0919 + 19/19 ORCH-0914-edge-fn tests PASS | **PASS** (implementor-verified) | Trusted per implementor evidence |
| SC-16 | Migration self-verify probe passes on push | **PASS** | Operator ran `supabase db push --linked` successfully — probe would have RAISE EXCEPTION'd if violated |
| SC-17 | New invariant `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` flips DRAFT→ACTIVE on close | **PENDING** | Orchestrator Step 1.5e on CLOSE |
| SC-18 | Live-fire parity: Vercel preview + business iOS sim + business Android emu | **DEFERRED to operator** | Source-only `probable` confidence; sim attempts blocked per §1 |

**18/18 SCs: 14 PASS + 4 DEFERRED (SC-03/SC-04/SC-10/SC-18) + 0 FAIL.**

---

## 4. Constitution audit (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No interactive elements |
| 2 | One owner per truth | **PASS** | Finalize RPC remains the single owner of `orders` + `order_installments` writes; compare-and-correct lives inside the same RPC, not a parallel writer |
| 3 | No silent failures | **IMPROVED** | The silent-discard failure mode at finalize's prior early-return is now closed by compare-and-correct + explicit response shape change |
| 4 | One key per entity | N/A | No React Query |
| 5 | Server state server-side | N/A | No Zustand |
| 6 | Logout clears everything | N/A | No client state |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers introduced |
| 8 | Subtract before adding | **PASS** | Migration's compare-and-correct REPLACES the prior silent early-return; prior silent return is gone, not layered |
| 9 | No fabricated data | **PASS** | Installments come from `session.installment_schedule` (real source), not invented; TA-S08 pins this |
| 10 | Currency-aware | **PASS** | Currency from `session.currency` + `tier_metadata.currency` (locale-correct) |
| 11 | One auth instance | **PASS** | Service-role RPC grant preserved; TA-S07 + TA-R03 |
| 12 | Validate at right time | **PASS** | Finalize called at post-deposit-charge moment, same as before |
| 13 | Exclusion consistency | N/A | No exclusion rules |
| 14 | Persisted-state startup | N/A | No persisted state |

**Constitution: 7 PASS + 7 N/A + 0 violations.** Rules #3 + #8 explicitly improved by this fix.

---

## 5. Findings

### P3 (low — fix when convenient)

- **P3-1 Pre-existing grant audit:** `biz_ticket_checkout_finalize` has `EXECUTE` granted to `anon` + `authenticated` + `service_role` (not just `service_role` as the ORCH-0921 migration intent suggests). Verified via `pg_proc.proacl: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. **NOT introduced by ORCH-0921** — the grants pre-exist from an earlier migration (likely 20260515000013 ORCH-0777 ticket checkout core or 20260610000000 Tr3 installments). The new ORCH-0921 migration's `CREATE OR REPLACE FUNCTION` preserves existing grants because the function object isn't dropped; the `REVOKE FROM PUBLIC` doesn't remove explicit grants to anon/authenticated/service_role. **Exploit ceiling is low** because the function requires `p_qr_token_pepper` (an env-var secret only available to edge functions); a direct anon/authenticated call without the right pepper hits the `biz_ticket_checkout_assert_qr_pepper` guard and raises before doing anything. **Recommendation:** orchestrator opens a follow-up ORCH to add `REVOKE EXECUTE FROM anon, authenticated` in a tiny migration that runs after this one. Scope is 5 lines of SQL + a self-verify probe. Out of scope for ORCH-0921 per its hard guards (no scope creep).

### P4 (note — praise / informational)

- **P4-1 Praise — defensive `EXISTS` guard beyond SPEC.** The migration's compare-and-correct branch adds an `EXISTS (SELECT 1 FROM public.orders WHERE id = v_session.order_id AND installment_plan_root = false)` guard at lines 65-69. SPEC §3.1 didn't explicitly require this, but it's the right call: it prevents the self-heal branch from accidentally re-writing an already-correct order (e.g., if a buggy caller passes `p_installment_plan_root=true` against an order whose flag is already true). Defensive depth without behavior change.

- **P4-2 Praise — response payload's `installmentPlanRoot` recomputed from live order row.** Migration line 130 returns `(SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id)` rather than echoing the input flag — so the response shape is honest about the actual post-self-heal state. TA-S09 pins this.

- **P4-3 Praise — implementor's honest documentation of pre-existing dirty workflow file.** Implementor §14 Risk row 5 + §15 Discovery flagged the parallel-session ORCH-0918 contamination in `.github/workflows/strict-grep-mingla-business.yml` without trying to bury it. Orchestrator will scrub at PR stage (precedent set on PR #170 + PR #171). No tester action needed.

---

## 6. Regression-test gate (ORCH-0840 verification)

Per the ORCH-0840 mandatory regression-test gate, PASS additionally requires:

| Requirement | Status | Path | Evidence |
|---|---|---|---|
| (1) Implementor happy-path test committed with fails-on-revert | **SATISFIED** | `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts` + `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts` + `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts` + `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.test.mjs` | Fails-on-revert verified by implementor at pre-fix commit `0169b4a360cfb678799c1691b01c25dc8b106509` per implementation report §12 |
| (2) Tester adversarial test committed (different angle) | **SATISFIED** | `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct_adversarial.test.ts` (9 tests) + `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params_adversarial.test.ts` (6 tests) + `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params_adversarial.test.ts` (5 tests) | 20/20 PASS independently this turn; attacks DIFFERENT angles per the gate's discipline (NEGATIVE guard preservation, security surface, source-vs-deployed drift detection, schema invariant preservation) — explicitly NOT copies of implementor's happy-path tests |
| (3) Both tests appear in the closing PR's `git diff origin/main...HEAD --name-only` | **PENDING-PR** | Will be satisfied when orchestrator stages the PR — all test files are present on `Seth` and untracked/modified in `git status` | — |

**Regression-test gate: 2/3 satisfied now, 3/3 satisfied when orchestrator opens the closing PR.**

---

## 7. Discoveries for Orchestrator

1. **DISC-0921-QA-A — Follow-up ORCH for grant tightening.** P3-1 above: `biz_ticket_checkout_finalize` has anon/authenticated grants pre-existing from an earlier migration. Recommend register a tiny follow-up (e.g., ORCH-0922 [Trip checkout finalize RPC anon-grant tightening] — note: the ORCH-0920 ID collision already in flight makes ORCH-0922 the next free ID).

2. **DISC-0921-QA-B — Cron Jun 22 verification reminder.** SC-10 (cron charges €250 on Jun 21 + €125 on Jul 21 for the backfilled order) is time-gated. Add a calendar reminder for Jun 22 + Jul 22 to query `order_installments` for order `47374d23-…` and verify `status='collected'` + `collected_at` populated. If either fails, that's a SEPARATE issue (saved-PM expired, Stripe Customer detached, etc.) — not an ORCH-0921 regression.

3. **DISC-0921-QA-C — SC-18 live-fire deferral.** Buyer-anonymous web + business iOS sim + business Android emu live-fire deferred to operator per Phase 0.A. This is the standard CONDITIONAL PASS shape used on ORCH-0914 close. If operator wants `proven` PASS (not CONDITIONAL), run the 5-tap smoke in §"Operator post-close smoke" below before CLOSE.

4. **DISC-0921-QA-D — Process improvement (echoes investigation DISC-0921-A).** ORCH-0869 Stage 1B implementation report (line 244) flagged the exact gap that became ORCH-0921 as a "Stage 1c follow-up." The follow-up ORCH was never opened, and the gap shipped to production for 5 days. The investigation already recommended adding a CLOSE-time rule that "follow-up will update" language in implementation reports MUST become a tracked ORCH-ID. Tester re-emphasizes — this is a process gap that will keep producing ORCH-0921-class bugs if not addressed.

5. **DISC-0921-QA-E — Workflow contamination scrub at PR stage.** `.github/workflows/strict-grep-mingla-business.yml` contains a parallel Codex session's ORCH-0918 [Collab session group chat banners] job that is NOT part of ORCH-0921 scope. Orchestrator REVIEW §6 already noted this; tester confirms via `git diff origin/main`. Orchestrator must scrub at PR stage (precedent: PR #170 + PR #171 did this).

---

## 8. Operator post-close smoke (3 sequential steps)

To upgrade CONDITIONAL PASS → PASS, operator runs:

1. **Vercel preview buyer-web test purchase.** Open the Vercel preview URL for `mingla-business`. Navigate to a payment-plan trip (The DC Adventure with the Standard €500 tier qualifies). Choose payment plan at checkout. Pay €125 deposit with Stripe test card `4242 4242 4242 4242` (any future expiry, any 3-digit CVC, any 5-digit ZIP). Land on `/checkout-trip/{tripEventId}/confirm?cs=...`. Confirm screen shows ticket + "Confirming your reservation…" hero correctly. Then run this SQL probe via Supabase Dashboard:
   ```sql
   SELECT o.id, o.total_cents, o.installment_plan_root,
     (SELECT COUNT(*) FROM order_installments oi WHERE oi.order_id = o.id) AS inst_count,
     (SELECT SUM(amount_cents) FROM order_installments oi WHERE oi.order_id = o.id) AS inst_total
   FROM orders o
   WHERE o.event_id = '060d0483-50db-48d1-840b-73d9fc59356a'
     AND o.created_at > now() - interval '5 minutes'
   ORDER BY o.created_at DESC LIMIT 1;
   ```
   **Expected:** `total_cents=12500` (deposit), `installment_plan_root=true`, `inst_count=2`, `inst_total=37500`.

2. **Business iOS sim — planner view.** On the iOS sim with the business app installed (UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752` per memory), sign in as the planner for the test brand. Navigate to Hub → Trips → The DC Adventure → Payments tile. **Expected:** the just-created traveller (from Step 1) appears in the per-traveller table with Plan="3 installments: €125 / €250 / €125", Paid-to-date=€125, Outstanding=€375 (i.e., NOT "Paid in full"). The pre-existing buggy "Seth from Somethingelse" row now shows Paid-to-date=€125, Outstanding=€375 too (the backfill data).

3. **Business Android emu — same view as Step 2.** Confirm visual + numerical parity.

If all three steps produce the expected result, the verdict flips to PASS and orchestrator proceeds to CLOSE. If any step fails, file a regression on the SAME ORCH-0921 and route back to implementor.

---

## 9. Pre-close pipeline status

| Item | Status |
|---|---|
| Migration on remote (`20260724000000_orch_0921_finalize_compare_and_correct.sql`) | **LIVE** |
| Edge fn deploys (`ticket-checkout-confirm` v32 verify_jwt:false + `reconcile-stuck-checkouts` v23 verify_jwt:true) | **LIVE** with `verify_jwt` preserved |
| Backfill of known leaker order `47374d23-…` | **DONE** (€375 recovered; cron will auto-charge Jun 21 + Jul 21) |
| Org-wide leaker audit post-backfill | **0 leakers** |
| Implementor regression tests (T-01..T-09) | **9/9 PASS** independently re-run |
| Tester adversarial tests (TA-S01..TA-S09 + TA-C01..TA-C06 + TA-R01..TA-R05) | **20/20 PASS** independently authored + run |
| Strict-grep gate (`I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`) | **GREEN** — 190 files, 0 violations |
| Implementation report fails-on-revert | **Verified at commit `0169b4a360cfb678799c1691b01c25dc8b106509`** per implementor §12 |
| Orchestrator REVIEW | **APPROVED** at `Mingla_Artifacts/reports/REVIEW_ORCH-0921_*.md` |
| Workflow file ORCH-0918 contamination scrub | **PENDING** — orchestrator will scrub at PR stage |
| Tests appear in `git diff origin/main...HEAD --name-only` for closing PR | **PENDING-PR** |
| SC-18 live-fire parity | **DEFERRED to operator** per Phase 0.A (probable confidence, sim attempts blocked by lack of operator-owned web preview + planner login + Android emu state) |

---

**QA VERDICT: CONDITIONAL PASS** — P0:0 / P1:0 / P2:0 / P3:1 / P4:3. Cleared for orchestrator CLOSE on operator deferral acceptance OR on operator post-close smoke `proven` confirmation (whichever you prefer).
