# IMPLEMENTATION — META-ORCH-1076 Phase 1 [Paystack buyer checkout, Nigeria/NGN]

- **ORCH:** META-ORCH-1076 Phase 1 (renumbered off 1072 per COMMS-0019)
- **Worktree:** `~/Desktop/mingla-orchs/meta-orch-1076-[paystack-nigeria]/` on branch `meta-orch-1076-paystack-nigeria`
- **Commit:** `dee2c2b6a`
- **Status:** implemented and verified (deno type-check + tests green; SC-1/SC-12 diff proofs captured; remote pre-flight probes run). Migration apply + edge deploy + live device test remain (orchestrator/tester).
- **Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1076_PHASE_1_PAYSTACK_BUYER_CHECKOUT.md` (APPROVED) — implemented in §10 order.
- **Comms acks:** COMMS-0002 (allowlist same-commit — done, C7 green), COMMS-0003 (Paystack docs URLs inline — done throughout), COMMS-0019 (WARN, on the renumbered 1076 branch — acked). COMMS-0004 factored: migration timestamp chosen strictly above all worktree+remote maxes.

---

## Files changed (Old → New receipts)

### supabase/migrations/20260908000000_meta_orch_1076_p1_payment_provider.sql (NEW)
**Before:** none. **Now:** additive, non-destructive migration:
- `brands.payment_provider` (NOT NULL DEFAULT 'stripe' + allowlist CHECK), `payment_country`, `paystack_subaccount_code`.
- Widens `brands_pricing_region_allowlist`/`brands_pricing_currency_allowlist` to the **union of the live remote set + NG/NGN** (see "Migration filename + remote reconciliation" below).
- `country_vat_config` table (PK country, vat_rate_bps CHECK 0..10000), seeds NG=750, service-role-only RLS policy.
- `resolve_event_pricing_inputs` re-declared `CREATE OR REPLACE` with the existing 10 output columns **byte-identical** + 4 appended (`payment_provider, payment_country, paystack_subaccount_code, vat_rate_bps`), LEFT JOIN `country_vat_config` on `payment_country`.
- `biz_ticket_checkout_create_session` re-declared as a **byte-faithful copy** of the ORCH-0955 body with ONLY the provider-aware gate + the `b.payment_provider` select changed (SC-12 diff below).
- `DO $$` self-verify: create-session=11 overloads, finalize=8 overloads (untouched).
**Why:** SPEC §3.1 (a–f). **Lines:** ~430.

### supabase/functions/_shared/paymentProvider.ts (NEW)
`resolveProviderRouting` (default-stripe fail-safe) + `paystackChannelsForCountry` (NG = card|bank|ussd|bank_transfer, never mobile_money). **Why:** SPEC §3.2/§2.2. ~75 lines.

### supabase/functions/_shared/allInPricingEngine.ts (EDIT, additive)
Added `"NG"` to `PricingRegion`; `"config_vat"` to `TaxBasis`; `NG: 1.0` to `INCLUSIVE_VAT_DIVISOR`; `case "NG": return "exclusive"` to `taxBehaviorForRegion`; new pure `computeConfigVat(subtotal, vatRateBps, passTax)`. **GB/US/EU/CH paths untouched** (verified by the existing ORCH-1006 regression staying 8/8 green). **Why:** SPEC §3.2. ~30 lines.

### supabase/functions/ticket-checkout-create/index.ts (EDIT, additive)
Imports `resolveProviderRouting/paystackChannelsForCountry/paystackInitializeTransaction/computeConfigVat`. Inserts the Paystack arm immediately after the free-path block and **before** the Stripe `stripe_account_not_ready` gate (a Paystack brand has no connected account). The arm: resolves provider, computes all-in via the shared engine (`computeBuyerSubtotal` + `computeConfigVat`), persists a unique reference into `stripe_payment_intent_id` + `awaiting_web_redirect` + the kobo total, calls Paystack `initialize`, returns `kind:"requires_paystack_redirect"`. Stripe brands fall through to the **byte-for-byte unchanged** Stripe arm. **Why:** SPEC §3.3. +204 lines, **0 deletions** (SC-1).

### supabase/functions/paystack-webhook/index.ts (EDIT — proof-slice → full)
Added the idempotent `payment_webhook_events` inbox (key `paystack:<event>:<reference>`), routing on top-level `event`, `charge.success → handlePaystackChargeSuccess`, confirmation dispatch, processed/retry bookkeeping (mirrors stripe-webhook). Kept the proof-slice signature verify + soft IP. `verify_jwt:false` already in config.toml. **Why:** SPEC §3.4. ~180 lines net.

### supabase/functions/_shared/paystackWebhookRouter.ts (NEW)
`handlePaystackChargeSuccess(supabase, data, verify)`: verify-by-reference (`status==='success'`), session lookup by reference, idempotent order_id early-return, amount==total_cents + currency=='NGN' gate (mismatch → session failed + audit, no finalize), then the **existing** `biz_ticket_checkout_finalize` (no parallel finalize). Verifier injected for deterministic tests. **Why:** SPEC §3.4. ~167 lines.

### app-mobile/src/payments/nativeCheckoutFlow.ts + mingla-business/src/payments/nativeCheckoutFlow.native.ts (EDIT, additive)
Each gains the `requires_paystack_redirect` response type, a `pollPaystackOrder` helper (~25s budget, 1.5s interval), and the arm: `WebBrowser.openAuthSessionAsync(authorizationUrl, callback)` → poll `ticket-checkout-status` → succeed only when `order_id != null`; timeout → explicit "couldn't confirm yet" (never fabricated success). **Why:** SPEC §3.5. ~50 lines each.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs (EDIT)
Added `META_ORCH_1076_BACKEND_ALLOWLIST` (migration + paymentProvider + paystack + paystackWebhookRouter + allInPricingEngine + ticket-checkout-create + paystack-checkout-create + paystack-webhook + 3 test files) and spread it into the C7 ALLOWLIST. Same commit as the backend diff (COMMS-0002). **Why:** SPEC §7.3. ~25 lines.

### 3 NEW Deno test files
`_shared/__tests__/allInPricingEngineNgVat.test.ts` (8), `_shared/__tests__/paymentProvider.test.ts` (6), `paystack-webhook/__tests__/paystackWebhook.test.ts` (7).

---

## Diff proof #1 — SC-1 (Stripe arm byte-for-byte unchanged)

`git diff origin/main...HEAD -- supabase/functions/ticket-checkout-create/index.ts` → **204 insertions, 0 deletions**. `git diff … | grep '^-'` yields only the `--- a/…` header (zero content deletions). The entire existing Stripe block (web hosted Checkout + native PaymentIntent + Stripe Tax) is untouched; the Paystack arm is a self-contained additive intercept.

## Diff proof #2 — SC-12 (session-create RPC body)

Extracted the `CREATE OR REPLACE FUNCTION biz_ticket_checkout_create_session` body from the prior ORCH-0955 migration vs the new migration and diffed. The ONLY changes:
1. SELECT INTO `v_event` adds `b.payment_provider` + promotes the brands join to an explicit `JOIN public.brands b`.
2. Gate gains `AND v_event.payment_provider = 'stripe'`.
3. `v_stripe_account_id` assignment gains the same provider guard.
(plus explanatory comments). For `payment_provider='stripe'` the gate is logically identical → Stripe path unchanged. **Verified live:** remote probe shows the live 11-param RPC has the original gate + original assignment + no `payment_provider` yet, i.e. my byte-faithful source matches what is actually deployed.

---

## Test results

`deno test --allow-env --allow-net` on the 3 new files → **21 passed | 0 failed**. Existing `allInPricingEngine.test.ts` (ORCH-1006 GB regression) → **8 passed | 0 failed** (NG addition disturbed nothing). `deno check` on all 5 touched edge files → clean. Both client flow files → zero new TS errors (the pre-existing app-mobile `applePay` PaymentSheetInitInput type artifact at the Stripe block is unrelated and present before this change).

### Regression test — fails-on-revert (verified at `7ac1e378c`)
Surgically reverted two load-bearing guards and re-ran:
- Removed `case "NG"` from `taxBehaviorForRegion` → `Error: unsupported_pricing_region:NG`; the 3 NG engine tests FAIL.
- Removed the amount-match gate from `handlePaystackChargeSuccess` → the "amount mismatch" test FAILs (it finalizes instead of rejecting).
Result with both reverted: **11 passed | 4 failed**. Restored from backup → **21 passed | 0 failed** again. The tests genuinely exercise the bug surface.

---

## Migration filename + remote reconciliation (IMPORTANT for the orchestrator)

**Chosen filename:** `20260908000000_meta_orch_1076_p1_payment_provider.sql`. The SPEC suggested `20260818000000`, but `ls`/scan showed the max migration prefix across sibling worktrees is `20260907000000` and this worktree's local max is `20260826000001`. `20260908000000` is strictly greater than all → monotonic (COMMS-0004).

**Remote-state reconciliation (resolved at IMPLEMENT via read-only probes):** the SPEC §3.1.b assumed the ORCH-1006 GB-only CHECKs. The linked remote is **already ORCH-1034-ahead** — `brands_pricing_region_allowlist` is live as `('GB','US','EU','CH')` with **15 US + 2 EU + 1 CH brands** (currencies USD/EUR/CHF). A narrow `IN ('GB','NG')` CHECK would have rejected those 18 rows and **aborted db push**. I widened to the UNION `('GB','US','EU','CH','NG')` / `('GBP','USD','EUR','CHF','NGN')`. Re-probed: **0 region violations, 0 currency violations** against the union. The ORCH-1034 migration (`20260816000000_orch_1034_currency_de_gbp.sql`) IS present in this branch's history, so the chain is consistent and no remote-only migration is introduced by this branch. The remote `resolve_event_pricing_inputs` returns exactly the 10-column base (append-only widening is legal). This is the COMMS-0004/ORCH-1034 coordination point the spec flagged — resolved by union, documented inline in the migration.

---

## Apply + deploy commands (orchestrator — DO NOT run from this worktree until linked)

1. **Verify no remote-only migrations** (from the linked anchor, since this worktree isn't linked):
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main && /Users/sethogieva/bin/supabase migration list --linked
   ```
2. **Apply the migration** (additive only — safe):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1076-[paystack-nigeria]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   If the worktree can't link, apply from the anchor after merging the branch, or use the Management API for the single file. (No `--include-all` needed — strictly monotonic.)
3. **Run the §7.2 read-only invariant probes** (already partially run via MCP; full set in SPEC §7.2) to confirm `payment_provider` default 'stripe', NGN admitted, NG VAT=750, both RPCs single-overload.
4. **Deploy edge functions** (after the DB push succeeds), from MERGED main (per COMMS-0015 — never deploy from a stale worktree):
   ```bash
   supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy paystack-webhook --project-ref gqnoajqerqhnvulmnyvv
   ```
   `paystack-webhook` MUST stay `verify_jwt:false` (config.toml already set). `_shared` changes ride both deploys.
5. **Verify-first-call:** `curl` paystack-webhook with no signature → expect 401 (not 404).
6. **Seed + E2E** per SPEC §8 (set `PAYSTACK_MODE=test` + `PAYSTACK_SECRET_KEY_TEST`, a NG brand + NGN event), then route to **tester** for T-01..T-10.

---

## Invariant verification
- I-STRIPE-PATH-UNCHANGED: ✅ (SC-1 0-deletions diff; SC-12 gate-only RPC diff; remote-matches-source probe).
- I-ALLIN-ENGINE-SINGLE-OWNER: ✅ (Paystack arm adds only `computeConfigVat`; no parallel math).
- I-FINALIZE-RPC-REUSED: ✅ (router calls the existing `biz_ticket_checkout_finalize`).
- I-PAYSTACK-WEBHOOK-VERIFY-FIRST: ✅ (signature → 401; verify status+amount+currency before finalize — tested).
- I-PAYSTACK-NG-NO-MOBILE-MONEY: ✅ (channel allowlist + test).
- I-1076-BACKEND-ALLOWLIST-SAME-COMMIT: ✅ (C7 green vs origin/main, 19 files).
- I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED: ✅ (every Paystack endpoint/param/enum/event carries its docs URL inline).

## Cross-surface
Consumer iOS/Android (shared `nativeCheckoutFlow.ts`) + Business iOS/Android (`nativeCheckoutFlow.native.ts`) covered; parity is manual across the two files (mirrored). Buyer/anon WEB Paystack, Admin, Business-web-preview deferred (SPEC §5/§6).

## Discoveries for orchestrator
- **Remote was ORCH-1034-ahead of the spec's CHECK assumption** — handled by union-widening (above). No action needed beyond awareness; the migration is self-correcting and idempotent.
- This worktree is **not `supabase link`-ed** — the migration-list pre-flight must run from the linked anchor.
- Phase 2 (subaccount onboarding/splits), Phase 3 (refunds), Phase 4 (disputes), Ghana/mobile-money, and buyer-anon-web Paystack remain deferred per SPEC §6.
