# REVIEW — ORCH-0955 [Native Stripe Tax for Platforms]

**Reviewer:** Claude `mingla-orchestrator`.
**Date:** 2026-05-25.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/` on branch `ORCH-0955-native-stripe-tax` (HEAD `cec1472e`).
**Inputs reviewed:** Implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0955_NATIVE_STRIPE_TAX.md`; implementation commit `d2106b21` (41 files, +4612/-1214); spec `Mingla_Artifacts/specs/SPEC_ORCH-0955_NATIVE_STRIPE_TAX.md`; investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0955_NATIVE_STRIPE_TAX.md`.

## Verdict: APPROVED

Implementation honors the binding SPEC verbatim. All locked decisions (Q2..Q14) preserved. All four deferred-to-SPEC items (Q1 RPC line items, Q11 email template, Q13 4 gate test files, migration prefix) resolved as the SPEC instructed. ORCH-0840 happy-path gate satisfied (T-IH-01..T-IH-13 PASS + fails-on-revert verified at `d2106b21`). Cleared to advance to DEPLOY → TEST.

## Review checklist

| Check | Result | Evidence |
|---|---|---|
| Root cause addressed (not symptom-mask) | PASS | F-1..F-11 all wired: tax calc → PI tax-inclusive → webhook commit → refund reversal → embedded UI replacement → region-gate fully deleted |
| Scope appropriate, not widened | PASS | 41 files, all named in SPEC §7 implementation order. ORCH-0950 migration reconciled (legit per orchestrator migration-apply backstop rule), not an out-of-scope edit |
| Hidden fallback paths | PASS | Tax-calc failure → 502 with detail; reversal failure → 502 + refund marked `failed`; webhook commit is non-fatal (order already finalized, recoverable via Stripe Tax dashboard); webhook backstop is idempotent |
| Stale cache paths | PASS | No React Query keys touched; CartContext extension is additive; no AsyncStorage/Zustand impact |
| Response shape truthful in all states | PASS | Address-missing path (mode='preview' returns `{ addressMissing: true }`; mode='create' returns 400); zero-tax jurisdiction returns explicit `taxCents: 0` (Constitution #9 honoured); reversal failure exposes `stripe_tax_reversal_failed` + `refund_id` for operator reconciliation |
| Real fix or symptom mask | PASS — real fix, root-cause level |
| Cross-domain / cross-surface parity | PASS | Consumer + business native code paths mirrored (`CartTaxPreview.tsx` × 2, `nativeCheckoutFlow*.ts` × 2); web Checkout Session path correctly left untouched (already tax-enabled via ORCH-0804) |
| Constitutional compliance (14 rules) | PASS — verified #9 (no fabricated data — $0 tax shown explicitly), #8 (subtract before adding — region gate deleted), #12 (validate at right time — address required before PI create) |
| Evidence chain complete | PASS — fails-on-revert verified at `d2106b21` for all 13 happy-path tests; scoped Deno typecheck PASS; strict-grep bundle PASS; legacy-token scan returns empty; remote invariant probe ran (`orders_with_null_tax_amount=0`, `total_refunds=7`); migration list confirms no remote-only rows |
| Documents updated | PASS for scoped artifacts (investigation + spec + implementation report + this review); WORLD_MAP/COVERAGE_MAP/PRODUCT_SNAPSHOT/PRIORITY_BOARD updates deferred to CLOSE per protocol |
| DIAG markers reaped (Step 1.5 anticipation) | PASS — zero `[ORCH-0955-DIAG]` matches across all source dirs |

## Spot-checked items

1. **Cross-ORCH gate touch (`orch-0804-stripe-tax-enabled-on-checkout.mjs`):** legitimate update — old gate required existence of `brand-stripe-tax-dashboard-link` + `useBrandStripeTaxDashboardLink`. ORCH-0955 deletes both, which would have broken the gate. Implementor correctly renamed to require the new `brand-stripe-tax-account-session` + `useBrandStripeTaxAccountSession`. All 6 original ORCH-0804 checks preserved; only identifiers renamed. Not a weakening.
2. **ORCH-0863 C7 allowlist:** added per SPEC Amendment A in the SAME commit as the new edge function and migration. Contains the 14 expected files (2 new + 12 modifications + the reconciled ORCH-0950 migration).
3. **ORCH-0950 migration source-reconcile:** 1103-line file present in commit but not on `origin/main`. Implementor cites `supabase migration list --linked` returned no remote-only versions, confirming the file is the exact already-applied SQL. Correct application of the orchestrator's 2026-05-24 migration-apply backstop.
4. **Migration content (575 lines):** scope matches SPEC §3.1 — column adds (orders × 2, refunds × 1, ticket_checkout_sessions × 2), comment refreshes, DROP+RECREATE of `biz_ticket_checkout_create_session` (return shape extended with `lineItems`/`subtotalCents`), DROP+RECREATE of `biz_refund_order_commit` (new `p_stripe_tax_transaction_id text` param). No out-of-scope changes.
5. **DROP FUNCTION safety:** live `pg_depend` query confirmed ZERO dependents on either function. DROP+RECREATE will not break dependent objects.
6. **SC-9 (BrandPaymentsView CTA):** `useBrandStripeTaxAccountSession` imported and invoked at line 173. Confirmed.
7. **SC-12 (email tax row):** `taxAmountCents > 0` conditional renders "Tax" row in HTML + text bodies. Confirmed at `ticketBody.ts` lines 87-93 + 216-219.
8. **SC-11 (region gate deleted):** `ls supabase/functions/_shared/stripeTax.ts supabase/functions/brand-stripe-tax-dashboard-link/` returns "No such file or directory" for both. Confirmed.

## Risks acknowledged (carry-forward)

| Risk | Treatment | Owner |
|---|---|---|
| Broad app typechecks fail (mingla-business, app-mobile) | Implementor verified ORCH-0955-touched files are clean; remaining failures are pre-existing unrelated repo debt. NOT a CLOSE blocker for ORCH-0955. Future cleanup ORCH may address. | Carried forward |
| Live-fire brand test blocked on ORCH-0954 | Code-level test gates pass independently. TEST phase may run code-level adversarial tests now; live-fire phase waits for first live brand. Tester report should mark conditionally. | Tester (Claude `mingla-forensics` TEST mode) + future operator-assisted smoke |
| Operator RAK scope additions required pre-deploy | Implementor flagged in §"Pre-deploy Operator Prerequisites" (3 RAKs + secret rotation if Stripe rotates on edit). Relayed in chat to operator before edge deploy. | Operator |

## Deploy routing

1. **Operator: apply migration.** From the worktree, run:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Implementor pre-verified no remote-only rows; `db push` (without `--include-all`) should apply only `20260727000000_orch_0955_native_stripe_tax.sql` + the reconciled `20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` if it isn't already on remote. If push complains about remote-only, escalate; do NOT use `--include-all` without orchestrator confirmation.
2. **Operator: confirm RAK scopes** per implementation report §"Pre-deploy Operator Prerequisites":
   - `STRIPE_RAK_TICKET_CHECKOUT`: add `Tax > Tax Calculations Write` + `Tax > Tax Transactions Write`.
   - `STRIPE_RAK_TICKET_REFUND`: add `Tax > Tax Transactions Write`.
   - `STRIPE_RAK_ONBOARD`: confirm `account_sessions:write` (likely set by ORCH-0954 plan; verify).
   - Confirm Stripe Tax for Platforms is enabled on the platform account (already verified in ORCH-0953 §Connect Platform Setup; re-confirm).
   - If Stripe rotates any key on edit, run `supabase secrets set <NAME>=...` for each affected secret.
3. **Orchestrator: deploy 5 edge functions** via local CLI (in this order; webhook last so handlers exist on the platform side before they're invoked):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]"
   /Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
   /Users/sethogieva/bin/supabase functions deploy refund-order --project-ref gqnoajqerqhnvulmnyvv
   /Users/sethogieva/bin/supabase functions deploy brand-stripe-tax-account-session --project-ref gqnoajqerqhnvulmnyvv
   /Users/sethogieva/bin/supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
   /Users/sethogieva/bin/supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv
   ```
   Verify versions bump via `mcp__supabase__list_edge_functions`. Confirm `verify_jwt` preserved on `stripe-webhook` (must remain `false`).
4. **Dispatch TEST** to Claude `mingla-forensics` TEST mode (TARGETED sub-mode + RETEST tooling if any P1 surfaces). Code-level adversarial tests may run independently of ORCH-0954; full live-fire tax-flow validation conditionally PASSES until ORCH-0954 ships a live brand.

## Next phase

DEPLOY (operator DB push + orchestrator edge deploy) → TEST (Claude `mingla-forensics` TEST mode) → CLOSE.
