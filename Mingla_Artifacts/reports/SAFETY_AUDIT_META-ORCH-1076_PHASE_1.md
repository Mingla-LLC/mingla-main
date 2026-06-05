# Safety Audit — META-ORCH-1076 Phase 1 (pre-apply / pre-deploy)

- **Date:** 2026-06-04
- **Trigger:** operator asked for a real safety investigation before applying the money-path migration + deploying.
- **Method:** live read-only DB probes (Supabase MCP `execute_sql`), git history analysis (origin/main vs our base `03e2145bb`), deployed edge-fn version inspection.
- **VERDICT: 🔴 NOT SAFE TO APPLY/DEPLOY AS-IS. Two required fixes before proceeding. After both, the change is additive-safe.**

## What is SAFE (verified)

1. **No orphaned migration drift.** All "remote-only" migrations (`20260820`–`20260910`) are present on `origin/main`. It is our **local anchor checkout** that is 24 commits stale — `origin/main` == the remote database. (Earlier "main is 20 migrations behind remote" framing was wrong; corrected.)
2. **No function clobber via migration.** No migration after our base (`20260803`+) redefines `biz_ticket_checkout_create_session` or `resolve_event_pricing_inputs`. Live signatures match our CREATE-OR-REPLACE copies exactly: create-session = 11 params, resolve = 1 param, finalize = 8 params (untouched). Our replacements won't revert anyone's work.
3. **No column/table collision.** `payment_provider` / `payment_country` / `paystack_subaccount_code` / `country_vat_config` exist nowhere on remote. Safe additive.
4. **Region CHECK widening is correct + safe.** Live `brands_pricing_region_allowlist` = `IN ('GB','US','EU','CH')`; all 52 brands are within it; widening to add `'NG'` rejects nothing.
5. **Deployed paystack-webhook/checkout-create are our Phase-0 proof versions** (v2, from the old worktree path) — harmless; Phase 1 redeploys from main after merge.

## What must be FIXED (two real problems)

### 🔴 FIX 1 — Drop the currency-CHECK re-add (it fights ORCH-1034)
- ORCH-1034 (de-GBP, `20260816000000`) **deliberately DROPPED** `brands_pricing_currency_allowlist` entirely — currency is intentionally NOT DB-validated (the whole point of "charge each seller in their own currency"). Confirmed live: that constraint **does not exist**.
- Our migration **re-adds** `brands_pricing_currency_allowlist CHECK (pricing_currency IN ('GBP','USD','EUR','CHF','NGN'))`.
- It won't abort (all 52 brands are GBP/USD/EUR/CHF ⊂ the union), BUT it **re-imposes a constraint ORCH-1034 removed by design** and would **block any future brand in a currency outside the 5** (CAD, AUD, JPY, etc.) — a silent regression of ORCH-1034.
- **Fix:** remove the `DROP/ADD brands_pricing_currency_allowlist` block from the migration. NGN is **already** allowed (no currency CHECK exists). Keep only the region-CHECK widening.

### 🔴 FIX 2 — Rebase the branch (stale base → clobber risk)
- Our branch was cut from `03e2145bb`, now **24 commits behind origin/main**.
- Two touched files were changed on main by **`6ece55242` ORCH-1072 [deploy]: experience detail — Book Experience + availability (#353)`**:
  - `supabase/functions/ticket-checkout-create/index.ts` (1 commit)
  - `app-mobile/src/payments/nativeCheckoutFlow.ts` (1 commit)
- The **live deployed** `ticket-checkout-create` (v188, updated from current main) already contains #353. **Deploying our stale version would REVERT #353's experience-booking changes.** The strict-grep script (`orch-0863-marketing-hub-phase-b.mjs`) changed **15×** on main — heavy merge conflict, and our allowlist must sit on top of main's current version.
- **Fix:** rebase `meta-orch-1076-paystack-nigeria` onto current `origin/main`; reconcile the Paystack arm onto the **#353 version** of `ticket-checkout-create` + `nativeCheckoutFlow.ts`; take main's strict-grep script and re-add our allowlist block. Re-run the test suite after rebase.

## Recommended remediation order
1. Edit the migration: delete the currency-CHECK DROP/ADD block (keep region widening). (~2 lines.)
2. Rebase the branch onto `origin/main`; resolve `ticket-checkout-create` + `nativeCheckoutFlow.ts` + strict-grep conflicts (preserve BOTH #353 and our Paystack arm).
3. Re-run deno tests + the C7 gate + the Stripe-arm diff proof against the rebased base.
4. THEN: `supabase db push --linked` (additive-only), invariant probes, deploy `ticket-checkout-create` + `paystack-webhook` **from the rebased/merged main**, run SPEC §8 tests.

No production change has been made. Phase 0 (proof slice) remains deployed + working in test mode.
