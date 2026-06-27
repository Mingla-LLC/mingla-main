# TEST — META-ORCH-1236: brands.pricing_currency tracks default_currency

**Date:** 2026-06-27
**Tester:** mingla-tester (Claude)
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1236_CURRENCY_TRACKS_DEFAULT.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1236_CURRENCY_TRACKS_DEFAULT.md`
**Working tree:** `~/Desktop/mingla-orchs/META-ORCH-1236-[live-currency-fix]/` branch `META-ORCH-1236-live-currency-fix`
**Branch HEAD at test:** `d2d282d99` (impl `6fa0d8a4d` + tester adversarial test commit)
**Mode:** TARGETED (backend-only: SQL migration/trigger + 2 edge fns + CI guard — Phase 0.A sim gate EXEMPT, no UI/runtime client code).

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2

Zero P0, zero unaccepted P1. Regression gate satisfied (implementor happy-path + tester
adversarial, both fails-on-revert, both in the closing diff). All gating SC met with independent
runtime/live-fire evidence. Live PROD read-only probe confirms the hotfix aligns the drifted rows.
SC-7 (USD native PI accepted) and SC-8 (web `$` session) proven against live Stripe with the exact
production charge shape. OQ-2 remains `suspected` (non-blocking by spec).

---

## 2. SC-by-SC matrix

| SC | Description | Result | Evidence |
|----|-------------|--------|----------|
| SC-1 | drift count = 0 after migration | PASS | Independent PG15 (docker): post-migration `SELECT count(*) ... IS DISTINCT FROM` = 0. |
| SC-2 | region mapped for GBP/USD/EUR/CHF/NGN | PASS | Adversarial AV-4 (SCA CAD→region valid) + impl T-05 (NGN→NG); migration A.2 ran. |
| SC-3 | Smoke & Rhythm → USD/US | PASS | Fixture row (default USD/pricing GBP) → USD/USD/US after migration; LIVE PROD probe confirms the live row is exactly USD/GBP/GB and the hotfix UPDATE is `IS DISTINCT FROM`-gated → would set USD/US. |
| SC-4 | SCA trigger derives in same txn; detach preserves | PASS | Impl T-03 (EUR lockstep) + T-06 (detach preserves), re-run independently. AV-1 adds reattach convergence. |
| SC-5 | brand-direct insert/update derives | PASS | Impl T-01/T-04; AV-3 (BEFORE trigger overrides attacker pricing). |
| SC-6 | idempotent re-run = 0 rows | PASS | Independent re-run of A.1 on migrated DB = 0 rows; full migration re-apply exit 0. |
| SC-7 | native PI built in `usd`, accepted (no 400) | PASS (proven) | LIVE Stripe test key, exact prod shape (direct charge via `stripeAccount` header, `payment_method_types:[card,link]`, `application_fee_amount`) on a US connected acct → `pi_3TmnPQ...` ACCEPTED, currency=usd, status=requires_payment_method. No `payment_intent_invalid_parameter`. |
| SC-8 | web Checkout renders `$` not `£` | PASS (proven) | Edge code L851/875/1122: session `line_items[].price_data.currency` = `pricing.pricing_currency`. LIVE Stripe: USD session created currency=usd (renders `$`), GBP→gbp (`£`). Post-hotfix Smoke & Rhythm pricing_currency=USD → `$`. |
| SC-9 | no money-row mutation | PASS | Impl T-09 + adversarial AV-5: `events.currency` md5 byte-identical across brand+SCA writes. Migration touches only brands config columns. |
| SC-10 | CI guard catches direct write + passes clean | PASS | `--self-test` exit 0 (flags `.from("brands").update({pricing_currency})` + raw `UPDATE brands SET pricing_region`; ignores reads/types/allowlisted/other tables). Real-tree scan: 0 violations / 1977 files. Workflow job registered. |

---

## 3. Findings

### P3-1 — Implementor under-counted live drift (2 rows, not 1)
- **Evidence:** LIVE PROD (gqno) read-only probe. Currency drift = 1 (smokerhythm `1ce63bf4`: USD/GBP/GB). Region-only drift = a SECOND row `mingla-demo-party-block` (`655ba0ef`): USD/USD/**GB** (currency correct, region wrong). The impl report + migration comment both say "exactly 1 row."
- **Impact:** None to correctness — the migration's A.2 region UPDATE is independently `IS DISTINCT FROM`-gated and realigns `655ba0ef` GB→US too. Cosmetic inaccuracy in the report/comment.
- **Required fix:** None blocking. Optionally update the migration comment/report to "1 currency drift + 1 region-only drift = 2 rows touched."
- **Retest:** Re-run the prod region-drift probe after deploy → expect 0.

### P4-1 — Clean trigger single-owner design (praise)
The fix correctly extends the EXISTING canonical owner `tg_sync_brand_stripe_cache` rather than adding a second writer, and adds a BEFORE trigger for the brand-direct path. Constitution #2 satisfied. Detach semantics (ORCH-0769) preserved exactly.

### P4-2 — Edge cross-check is genuinely warn-only + hot-path-safe (praise)
Both edge fns read the already-synced `brands.default_currency` (no extra `stripe.accounts.retrieve`), log-only, positioned AFTER the preserved `pricing_currency_missing` fail-close. No false-positive outage risk.

---

## 4. Step 0.5 — independent re-run of implementor's fails-on-revert proof

Re-ran on a fresh PG15 container with an independently-built fixture (real column shapes/defaults/CHECK + verbatim pre-fix `tg_sync_brand_stripe_cache` from `20260515000009`/`20260510000001`).

- **Fix present (HEAD `d2d282d99`):** implementor test 10/10 PASS, exit 0 (`[META-ORCH-1236 ...] ALL TESTS PASSED`).
- **Revert (true line-deletion of pricing derivation from SCA trigger + removal of `tg_brands_derive_pricing_from_default`):** implementor test FAILS at `T-01 FAIL: setting default_currency=USD did not track pricing (pricing_currency=GBP, pricing_region=GB; ... trigger reverted?)` (non-zero exit). Confirms fails-on-revert.
- **Idempotency / DDL re-apply:** SC-6 re-run touched 0 rows; full migration re-applied exit 0.

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `supabase/migrations/__tests__/meta_orch_1236_pricing_currency.adversarial.test.sql`
- **Commit:** `d2d282d99` (on-branch, in `origin/main...HEAD` diff alongside the implementor test).
- **Angle (SPEC §9 vectors):** AV-1 detach→reattach with a DIFFERENT currency (USD→detach→EUR converges to EUR/EU — the implementor only proved detach *preserves*); AV-2 rapid USD→EUR→USD flip final convergence; AV-3 attacker brand UPDATE setting `pricing_currency=USD` on a EUR brand → BEFORE trigger overrides to EUR/EU; AV-3b OBSERVED that a pure `pricing_currency`-only UPDATE (default_currency untouched) is NOT caught by the column-scoped DB trigger (by design — the CI strict-grep guard owns the app/edge layer; documented, not failed); AV-4 unmapped CAD on the SCA path keeps region in the allowlist (no CHECK violation); AV-5 checkout-shaped flow proves `events.currency` byte-identical.
- **Result:** 6/6 attack vectors PASS on the migrated DB (`[META-ORCH-1236 ADVERSARIAL] ALL ATTACK VECTORS PASSED`).
- **fails-on-revert verified at `d2d282d99`:** on the reverted migration the adversarial test FAILS at `AV-1 setup FAIL: attach USD -> pricing=GBP (expected USD)` (the SCA-trigger pricing derivation is gone) — a different failing assertion than the implementor's T-01.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No UI. |
| 2 | One owner per truth | PASS | pricing_currency/region derived ONLY by the two DB triggers; CI guard blocks any app/edge direct write. |
| 3 | No silent failures | PASS | Edge cross-check is intentional warn-only; the `pricing_currency_missing` fail-close (409) is preserved; migration `IS DISTINCT FROM`-gated, cannot abort/fabricate. |
| 4 | One query key per entity | N/A | No client query keys. |
| 5 | Server state server-side | N/A | No Zustand. |
| 6 | Logout clears all | N/A | No auth/session change. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Reuses existing trigger; adds only the brand-direct trigger needed for coverage. |
| 9 | No fabricated data | PASS | NULL-default brands left at floor (not faked); hotfix only realigns real default_currency. |
| 10 | Currency-aware | PASS | The entire fix IS currency-correctness; charge currency now tracks settlement currency. |
| 11 | One auth instance | N/A | No auth. |
| 12 | Validate at right time | PASS | BEFORE trigger derives at write time; charge-time cross-check at charge. |
| 13 | Exclusion consistency | N/A | n/a. |
| 14 | Persisted-state startup gate | N/A | No client hydration. |

No violations.

---

## 7. Gates run

- `deno check supabase/functions/ticket-checkout-create/index.ts` → exit 0.
- `deno check supabase/functions/venue-reservation-create/index.ts` → exit 0.
- strict-grep `--self-test` → PASS (exit 0); real-tree scan → 0 violations / 1977 files.
- Migration applied clean on PG15 (exit 0); idempotent re-apply (exit 0).
- Both SQL tests PASS on migrated DB; both FAIL on reverted DB.
- Append-only: implementor test = `A` (unmodified); adversarial test = new file. Neither modifies an existing test.
- `tsc` (mingla-business): 725 PRE-EXISTING errors, ALL in unrelated files (packages/phone-input, react-dom/server test type-decls). This branch changes ZERO mingla-business/admin TS — backend-only. Not a regression. The relevant type gate (`deno check` on the two edge fns) is clean.

---

## 8. Live-fire findings (SC-7 / SC-8 / OQ-2)

- **SC-7 (PASS, proven):** USD direct-charge PaymentIntent in the exact prod shape on a US connected account → ACCEPTED (`pi_3TmnPQId9IFRdv64...`, currency=usd, no 400). Live Stripe (MINGLA LLC sandbox/test key).
- **SC-8 (PASS, proven):** web Checkout Session built from `pricing.pricing_currency`; USD→`currency=usd` (`$`), GBP→`gbp` (`£`). Live Stripe session create. Post-hotfix Smoke & Rhythm = USD → renders `$`.
- **OQ-2 (suspected — non-blocking by spec):** I could NOT pin the EXACT historical rejected parameter. Counter-evidence: a generic GBP direct charge on a US connected account is ACCEPTED at create AND succeeds at confirm in test mode (`pi_3TmnPz... GBP CONFIRM: status=succeeded`). So the historical `400 payment_intent_invalid_parameter` was NOT a blanket GBP-on-US rejection. The original failed PI lived on the live connected account `acct_1Tml2YI4pBxuXrhh`; its request log is unreachable with the available keys (live key redacted in CLI config; credential read classifier-blocked). Most likely a Link-presentment-currency / capability / Radar interaction specific to that session. Does NOT gate PASS — the fix charges in USD, which I proved is unconditionally accepted (SC-7).

LIVE PROD (gqno) read-only probes performed (NO writes): drifted-row list (1 currency + 1 region drift), region-drift detail, Smoke & Rhythm SCA/connected-account state (USD, charges_enabled, not detached). Confirmed `trg_brands_derive_pricing_from_default` NOT yet present in prod (migration not applied — correct).

---

## 9. Device / parity matrix

All paid surfaces resolve currency from the same `resolve_event_pricing_inputs() → b.pricing_currency`; parity is automatic once the column is correct (verified at the source: one `currency` const feeds both web session and native PI). No client code changed.

| Surface | Result |
|---------|--------|
| Consumer iOS / Android (native PI) | PASS (backend) — SC-7 live-fire. |
| Buyer/anonymous Web (Checkout Session) | PASS (backend) — SC-8 live-fire. |
| Business iOS/Android, Admin Web, Business Web preview | N/A — no charge / no brand-currency write path. |

Physical-iPhone HITL: not required (backend-only fix; the charge-currency change is server-resolved and proven at the Stripe API).

---

## 10. Discoveries for orchestrator

- **D-P3-1:** prod has 2 drifted rows, not 1 (smokerhythm currency+region; mingla-demo-party-block region-only). Both handled by the migration. Update the "exactly 1 row" claim at CLOSE.
- **D-1 (carried):** `ENABLED_PRICING_REGIONS` omits NG — benign (NGN→Paystack). Low-priority follow-up.
- **D-2 (carried):** memory `project_orch_1034_currency_de_gbp_scope` "not started" is STALE — correct at CLOSE.
- **OQ-1 (carried):** the settled GBP overcharge on smokerhythm — operator refund decision.
- **OQ-2:** exact historical rejected PI param unconfirmed; recommend pulling the live connected-account Stripe request log (`acct_1Tml2Y...`) post-deploy if a definitive answer is wanted. Non-blocking.
- **I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT** is DRAFT → flip ACTIVE + register the guard at CLOSE.

---

## 11. Routing

PASS → CLOSE (orchestrator). Apply the migration to prod via `supabase db push --linked` (verify `migration list` first — drift probe shows the expected 2 rows), deploy both edge fns from MERGED main (preserve `verify_jwt`), one-curl verify each, then CLOSE.
