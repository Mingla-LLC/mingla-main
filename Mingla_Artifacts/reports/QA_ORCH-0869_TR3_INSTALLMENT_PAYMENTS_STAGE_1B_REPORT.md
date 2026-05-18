# QA — ORCH-0869 [Tr3 Installment Payments] Stage 1b

**Skill:** Claude `mingla-tester` (canonical TEST owner per DEC-133 reversal 2026-05-10)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_STAGE_1B.md`
**Mode:** TARGETED

---

## Verdict: PASS

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 2 |
| P4 — NOTE | 2 |

**Regression-test gate (ORCH-0840 [Regression-test enforcement + append-only CI]):**
- Implementor happy-path test: `supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts` — 12/12 PASS — fails-on-revert verified by implementor at HEAD `e17ca8db`.
- Tester adversarial test: `supabase/functions/_shared/__tests__/installment_handoff_adversarial.test.ts` — 11/11 PASS — fails-on-revert verified per-assertion via 4 representative mutations (this report §5).
- Different angle confirmed: implementor's tests pin dispatcher kind-routing; tester's tests pin webhook-router → finalize-RPC handoff + migration signature invariants. Zero overlap.
- Both files appear in `git diff origin/main...HEAD --name-only` as fresh additions.

**Live-fire sim gate (Phase 0.A):** EXEMPT — Stage 1b is backend-only (DB migration + 2 edge functions + 2 email helpers). No UI / runtime / interaction surface touched. SPEC §2.5 Cross-Surface Impact declares 7/7 surfaces NOT touched by Stage 1b (UI work is Stage 2). The web preview path was nonetheless exercised end-to-end during the implementor turn (real Stripe-test-mode $50 ticket purchase → DB row verified) as a regression smoke; this is recorded in §3 below as additional `proven`-level evidence.

---

## 1. Scope

This is the TARGETED-mode QA for Stage 1b of ORCH-0869. Stage 1 (ledger table + cron + Stage 1 dispatcher email + Stripe webhook handlers + ticket-checkout-create `setup_future_usage`) was previously deployed and probed clean. Stage 1b is the keystone that wires the existing checkout pipeline into the Stage 1 infrastructure:

1. NEW migration `20260610000002_tr3_ticket_checkout_session_installment_aware.sql` — adds `ticket_checkout_sessions.installment_schedule jsonb`; CREATE OR REPLACE on `biz_ticket_checkout_create_session` (installment validation + deposit-only total + late-booking rejection); DROP + CREATE OR REPLACE on `biz_ticket_checkout_finalize` (now 8 params; installment-plan-root branch populates 5 new orders columns + inserts `order_installments` ledger rows).
2. `supabase/functions/_shared/stripeWebhookRouter.ts` — extracts customer + saved-PM IDs from succeeded PI metadata + passes them through to the new finalize params.
3. `supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts` (NEW) + `installmentDunningEmail.ts` (Stage 1 SenderIdentity type fix) + `tripConfirmationEmail.ts` (carryover Tr2 SenderIdentity fix).
4. `supabase/functions/ticket-confirmation-dispatch/index.ts` — adds `installment_dunning` + `installment_plan_paid_in_full` body.kind branches.

Stage 1c (update `reconcile-stuck-checkouts/index.ts` + `ticket-checkout-confirm/index.ts` finalize callers) is explicitly DEFERRED by the implementor and is the leading Discovery for orchestrator. Stage 2 (UI) is not in scope for any QA cycle yet.

---

## 2. Blast radius mapping (TARGETED step 1)

| Direct change | Cascade |
|---|---|
| Migration `20260610000002_*.sql` | `biz_ticket_checkout_finalize` rpc resolution (PostgREST) — every caller of the RPC routes through the new 8-arg form |
| `stripeWebhookRouter.ts:763-797` (single rpc call site) | Every `payment_intent.succeeded` event hitting `stripe-webhook` edge function for ticket-checkout PIs |
| `ticket-confirmation-dispatch/index.ts` (NEW kind branches + 2 helpers) | Only invoked when caller sets `body.kind` to one of the new strings; legacy `body.kind = null` path fully preserved |
| `installmentDunningEmail.ts` SenderIdentity fix | Stage 1 webhook handler `installmentWebhookHandlers.ts` (dispatches `kind: "installment_dunning"`) |
| `tripConfirmationEmail.ts` SenderIdentity fix | Tr2 dispatcher `isTrip` branch in `ticket-confirmation-dispatch/index.ts:386` (Tr2 trip-shaped confirmation email) |

**Adjacent callsites verified safe (NOT modified, still call finalize with 5 params):**
- `supabase/functions/ticket-checkout-create/index.ts:170-179` — free-finalize path. Calls with 5 named params; the 3 new params default to NULL/false; legacy free-checkout path is byte-identical. ✅ verified by inspection.
- `supabase/functions/reconcile-stuck-checkouts/index.ts:74-83` — stuck-session recovery path. Calls with 5 named params; non-installment recovery is safe; installment-plan PI hitting this path would silently create an order WITHOUT ledger rows. **Implementor Discovery #1** explicitly flags this as Stage 1c follow-up.
- `supabase/functions/ticket-checkout-confirm/index.ts:263-272` — alternative confirm path. Same shape as reconcile. Same Stage 1c follow-up.

---

## 3. Independent live-DB verification (TARGETED step 5: behavioral contract)

Tester re-queried the live production Supabase project `gqnoajqerqhnvulmnyvv` after the implementor's smoke completed, with zero trust in implementor claims.

### A — Finalize overload count post-migration
```sql
SELECT proname, pronargs FROM pg_proc WHERE proname = 'biz_ticket_checkout_finalize';
-- [{ proname: "biz_ticket_checkout_finalize", pronargs: 8 }]
```
**PASS** — exactly 1 overload with 8 params. The DROP FUNCTION IF EXISTS on the 5-arg form (added by `20260515000016_orch_0777_qr_pepper_service_role_rpc.sql`) successfully removed the prior overload. No rpc() resolution ambiguity risk.

### B — Finalize signature DDL match
```
p_checkout_session_id uuid,
p_stripe_payment_intent_id text,
p_stripe_charge_id text,
p_stripe_payment_method_type text,
p_qr_token_pepper text,
p_stripe_customer_id_on_connected_account text DEFAULT NULL,
p_saved_payment_method_id text DEFAULT NULL,
p_installment_plan_root boolean DEFAULT false
```
**PASS** — signature byte-matches what `stripeWebhookRouter.ts` passes as named keys.

### C — Session column + 5 orders columns exist
- `ticket_checkout_sessions.installment_schedule jsonb NULL` — present.
- `orders.at_risk boolean NOT NULL DEFAULT false` — present.
- `orders.at_risk_since timestamptz NULL` — present.
- `orders.installment_plan_root boolean NOT NULL DEFAULT false` — present.
- `orders.stripe_customer_id_on_connected_account text NULL` — present.
- `orders.saved_payment_method_id text NULL` — present.
**PASS** — all 6 schema additions present + nullability/default correct.

### D — RLS policies on order_installments
```
order_installments_read_brand_member  | SELECT | EXISTS(orders o JOIN events e WHERE o.id = order_installments.order_id AND biz_is_brand_member_for_read_for_caller(e.brand_id))
order_installments_read_buyer         | SELECT | EXISTS(orders o WHERE o.id = order_installments.order_id AND o.buyer_user_id IS NOT NULL AND o.buyer_user_id = auth.uid())
```
**PASS** — 2 SELECT policies (brand-member + buyer). NO INSERT/UPDATE/DELETE policies → RLS denies by default for non-service-role contexts. Cron + finalize RPC run as SECURITY DEFINER with service-role grants. Buyer-anon (no `auth.uid()`) cannot read; they use the existing checkout-session token path. Correct per SPEC §3.1.

### E — Smoke order re-verification (implementor's live-purchase artifact)
```sql
SELECT id, total_cents, installment_plan_root, stripe_customer_id_on_connected_account,
       saved_payment_method_id, at_risk, payment_status,
       (SELECT count(*) FROM order_installments WHERE order_id = orders.id) AS installments_count,
       (SELECT count(*) FROM tickets WHERE order_id = orders.id) AS tickets_count
FROM orders WHERE id = '90b9308a-1c3a-4269-bb13-0f61cb133597';
-- id: 90b9308a-1c3a-4269-bb13-0f61cb133597
-- total_cents: 5000
-- installment_plan_root: false           ← gated correctly, non-installment purchase
-- stripe_customer_id_on_connected_account: null  ← gated correctly
-- saved_payment_method_id: null          ← gated correctly
-- at_risk: false                         ← default
-- payment_status: paid
-- installments_count: 0                  ← no ledger rows, correct for non-installment
-- tickets_count: 1                       ← ticket-issuance loop ran correctly
```
**PASS** — every implementor claim about the smoke purchase matches the live DB. This is `proven`-level live-fire evidence on the web surface that the modified webhook-router → finalize handoff did NOT regress the non-installment path.

### F — Cron probe post-smoke + post-deploy
```
POST /functions/v1/process-scheduled-installments {"dryRun": true}
HTTP 200 {"processed":0,"collected":0,"failed":0,"at_risk_flagged":0,"errors":[]}
```
**PASS** — Stage 1 cron unaffected by Stage 1b deploys.

---

## 4. Forensic code reading (TARGETED step 3)

### 4.1 `supabase/functions/_shared/stripeWebhookRouter.ts:763-797`
- Metadata extraction uses STRICT equality `=== "true"` (line 778). Stripe boolean `true` or string `"True"` would NOT match → safe fallback to non-installment path. ✅
- `stripeCustomerId` + `savedPaymentMethodId` ternary-gated on `isInstallmentPlanRoot` (lines 779-784). Non-installment PIs pass `null/null/false` → finalize legacy branch runs identically. ✅
- `objectString()` type-narrowing helper safely returns `null` for non-string PI fields. ✅
- Single `supabase.rpc("biz_ticket_checkout_finalize", {...})` call site (only one). New tester invariant: any duplicate would create drift risk (caught by adversarial test A4). ✅
- **POTENTIAL concern (analyzed, dismissed):** `paymentIntent.customer` could be an expanded object if Stripe API expand option was set somewhere. Stripe webhook payloads do NOT expand by default; `objectString` would return null on an unexpected object value; finalize would RAISE `installment_plan_finalize_missing_customer_or_pm` (loud failure, not silent). Acceptable.

### 4.2 Migration `20260610000002_*.sql`

**create_session installment branch (lines 262-384):**
- Gated on `v_is_trip AND v_first_ticket_type_id IS NOT NULL` — non-trips skip entirely. ✅
- `jsonb_typeof(v_installments_input) = 'object'` guard prevents accidental array/scalar values from triggering the validation path. ✅
- Multi-line cart with installments → `ticket_lines_mixed_with_installments`. ✅
- Deposit % validation: `<= 0 OR > 100` → reject. ✅
- Installment count: `< 1 OR > 11` → reject. ✅
- Per-installment first pass validates ordinal monotonicity (line 307 `<> v_i + 1`), pct in (0, 100) exclusive (line 311), exactly one of `days_after_booking | fixed_date` (line 315). ✅
- Sum-check tolerance 0.01 (line 326) — see §6 P3-1 for an edge case.
- Last-installment-absorbs-rounding correctly handled (line 364), zero-amount guard (line 365). ✅
- `v_total` overridden to `v_deposit_cents` (line 381) — what Stripe charges at booking. ✅
- session row INSERT carries the JSONB schedule conditionally (lines 406-415). ✅

**finalize installment branch (lines 599-636):**
- Gated on BOTH `p_installment_plan_root AND v_schedule IS NOT NULL` — adversarial test B4 pins this. ✅
- Defensive guard: customer + PM both required, else `installment_plan_finalize_missing_customer_or_pm` (adversarial test B3 pins). ✅
- Loop iterates `v_schedule->'installments'` array, INSERTs one `order_installments` row per ordinal, status='scheduled'. ✅
- Zero-amount guard inside the loop (line 621). ✅
- Currency pinned to schedule.currency with fallback to session.currency (line 613). ✅
- order_installments INSERT uses the bulk session-level currency only — does NOT vary across rows in the same order. This matches `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH`. ✅

**Self-verification probe (lines 776-820):**
- Asserts `pronargs = 8` AND `count(overloads) = 1`. Both adversarial test B7 and runtime DB query confirm this is live. ✅

### 4.3 `ticket-confirmation-dispatch/index.ts` (Stage 1b kind branches)
- Service-role auth check (line 286) PRECEDES kind routing (line 292). Implementor adversarial test #12 pins this; tester re-verified by reading. ✅
- Unknown `kind` returns HTTP 400 with `{error: "unknown_kind", kind}` — caller logs make the misroute obvious. ✅
- `null` kind falls through to legacy ticket-confirmation flow (byte-identical to pre-Stage-1b dispatcher behaviour for the legacy caller path). ✅
- New `handleInstallmentDunning` reads `body.installmentId`, `body.installmentOrdinal`, `body.failureReason` from request body (matches Stage 1 webhook handler's dispatch shape in `installmentWebhookHandlers.ts:286-303`). ✅
- New `handleInstallmentPaidInFull` reads `orderId` only (matches Stage 1 webhook handler's dispatch shape at `installmentWebhookHandlers.ts:166-181`). ✅
- Both new branches send via Resend with `attachments: []` (notification emails, not ticket emails — buyer already has ticket PDF + .ics from original confirmation). ✅

### 4.4 Email renderers
- `installmentPlanPaidInFullEmail.ts` (NEW, 108 lines) — uses canonical `SenderIdentity` from `_shared/email/senders.ts` from the start. HTML escaping on every interpolated field. Defaults `support@usemingla.com` when brand has no contact_email. ✅
- `installmentDunningEmail.ts` (Stage 1 carryover fix) — local `SenderIdentity { email, name }` swapped to canonical `{ name, address }`. Returns `from.address` (not `from.email`). Runtime behaviour identical (Resend reads `formatSenderHeader(sender)` which extracts `sender.address`). ✅
- `tripConfirmationEmail.ts` (Tr2 carryover fix) — same one-line `SenderIdentity` correction. Unblocked the 2 pre-existing TS18047 narrowing errors in the dispatcher's `renderedEmail` union, getting Stage 1b to a fully clean `deno check`. ✅

---

## 5. Independent regression test (TARGETED step 6)

**Path:** `supabase/functions/_shared/__tests__/installment_handoff_adversarial.test.ts`
**Count:** 11 tests, all source-assertion against `stripeWebhookRouter.ts` + migration `20260610000002` + dispatcher.
**Different angle from implementor:** implementor's 12 tests target dispatcher kind-routing; tester's 11 target webhook-router → finalize-RPC handoff + migration signature invariants. Zero overlap, complementary coverage.

### Run on fixed code
```
$ deno test --allow-read supabase/functions/_shared/__tests__/installment_handoff_adversarial.test.ts
running 11 tests
ORCH-0869 Stage 1b ADVERSARIAL: webhook router uses STRICT string equality on installment-plan-root metadata ... ok
ORCH-0869 Stage 1b ADVERSARIAL: customer + saved PM extraction is GATED on installment-plan-root flag ... ok
ORCH-0869 Stage 1b ADVERSARIAL: all 3 new finalize params passed in single rpc() call ... ok
ORCH-0869 Stage 1b ADVERSARIAL: webhook router has ONLY ONE finalize rpc call site (no drift via copy-paste) ... ok
ORCH-0869 Stage 1b ADVERSARIAL: migration DROPs the 5-arg finalize overload before CREATE OR REPLACE ... ok
ORCH-0869 Stage 1b ADVERSARIAL: new finalize signature has 8 params with last 3 defaulting ... ok
ORCH-0869 Stage 1b ADVERSARIAL: finalize installment branch defensively guards against null customer or PM ... ok
ORCH-0869 Stage 1b ADVERSARIAL: finalize installment branch gated on BOTH plan_root flag AND non-null schedule ... ok
ORCH-0869 Stage 1b ADVERSARIAL: orders columns populated only on installment-plan-root finalize ... ok
ORCH-0869 Stage 1b ADVERSARIAL: self-verification probe asserts 8 params + 1 overload ... ok
ORCH-0869 Stage 1b ADVERSARIAL: ticket-confirmation-dispatch (Stage 1b dispatcher) does NOT touch finalize RPC ... ok
ok | 11 passed | 0 failed (16ms)
```

### Fails-on-revert (verified per-assertion, not just per-file)

Four representative mutations were applied one at a time. Each mutation broke ONE assertion (proving the tests are non-trivial and exercise the specific bug each pins), and restoration returned to 11/11 PASS.

| # | Mutation | Mutated file | Expected failing assertion | Result |
|---|---|---|---|---|
| 1 | `=== "true"` → `== "true"` | `stripeWebhookRouter.ts:778` | A1 (strict equality) | **1 failed, 10 passed** ✅ |
| 2 | Remove `DROP FUNCTION IF EXISTS biz_ticket_checkout_finalize(uuid, text, text, text, text);` | migration line 488 | B1 (drop-overload) | **1 failed, 10 passed** ✅ |
| 3 | Remove the `IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN RAISE EXCEPTION ...` block | migration lines 603-610 | B3 (defensive guard) | **1 failed, 10 passed** ✅ |
| 4 | `const stripeCustomerId = isInstallmentPlanRoot ? ... : null;` → unconditional `objectString(...)` | `stripeWebhookRouter.ts:779` | A2 (gating) | **1 failed, 10 passed** ✅ |

Restoration: `cp` from backup files → 11/11 PASS again. No `.bak` artifacts left in the working tree (verified clean via `git status`).

**Fails-on-revert verified at HEAD:** prior to Stage 1b modifications. The implementor's commit hash `e17ca8db` is the same baseline used for the implementor's happy-path test fails-on-revert.

---

## 6. Findings

### P3-1 — Late-booking validation only checks FIRST installment, not all
**File:** `supabase/migrations/20260610000002_*.sql:354`
**What:** `IF v_i = 0 AND v_inst_due <= v_now THEN RAISE EXCEPTION 'installment_schedule_past_due_at_booking';` — only the first installment's `due_at` is checked. If installment 2 has a `fixed_date` in the past while installment 1 is in the future, validation passes.
**Impact:** A schedule like `[{ordinal:1, fixed_date:"2026-12-01"}, {ordinal:2, fixed_date:"2025-01-01"}]` would create `order_installments` rows where ordinal-2 is already past-due. The cron would attempt to charge it immediately on next run, which is probably the buyer's intent if they configured it that way — but it diverges from SPEC §3.5.1 which says "due dates monotonically increasing if fixed_date used".
**Fix recommendation:** Extend the check to `IF v_inst_due <= v_now THEN ...` for every iteration, OR add a separate monotonicity check `IF v_i > 0 AND v_inst_due <= v_prev_due THEN RAISE 'installment_due_at_not_monotonic'`. P3 because operator-facing tooling (Stage 2 PaymentPlanEditor) will likely prevent this, and the cron's predicate-bound UPDATE makes immediate-charge safe.
**Disposition:** flag to orchestrator for Stage 1c or Stage 2 spec follow-up.

### P3-2 — Pct sum tolerance 0.01 may reject some valid edge cases
**File:** `supabase/migrations/20260610000002_*.sql:326`
**What:** `IF abs(v_pct_sum - 100) > 0.01 THEN RAISE EXCEPTION 'installment_pct_sum_mismatch'`. For schedules with three 33.33% installments and deposit, sum = 33.33 × 3 + 0.01 deposit = 99.99 + .01 doesn't quite work; the more general case is something like `[deposit_pct: 25.005, installments: [37.4975, 37.4975]]` = 99.9999... → rejected.
**Impact:** Highly unlikely in practice — operator UI will use integer or 0.5%-step pcts. P3 because no practical user input reaches this edge.
**Fix recommendation:** Loosen tolerance to 0.1 OR document the resolution requirement explicitly in the Stage 2 PaymentPlanEditor.

### P4-1 — Stage 1c follow-up: reconcile + confirm finalize callers not yet migrated
**Files:** `supabase/functions/reconcile-stuck-checkouts/index.ts:74-83`, `supabase/functions/ticket-checkout-confirm/index.ts:263-272`
**What:** Both still pass 5 named params to `biz_ticket_checkout_finalize`. For non-installment recoveries this is safe (the 3 new params default to NULL/false → legacy behaviour). For an installment-plan PI that hits one of these secondary paths, an order would be created WITHOUT `order_installments` rows. The cron has nothing to charge; buyer paid deposit and shows up on the trip but the planner's Money tab would never see scheduled installments.
**Likelihood:** Low — webhook is the authoritative success path and these are recovery paths used only when webhooks fail.
**Disposition:** **Implementor Discovery #1** explicitly registers this as Stage 1c follow-up. Orchestrator should track. Tester aligns with implementor.

### P4-2 — Praise: defensive `installment_plan_finalize_missing_customer_or_pm` guard
**File:** `supabase/migrations/20260610000002_*.sql:603-610`
**What:** The migration's finalize installment branch RAISES EXCEPTION rather than silently creating ledger rows that can never be charged. This is exactly the right pattern: loud failure at the boundary, not silent state drift downstream.
**Disposition:** Replicate this pattern in Stage 2 components when they accept the schedule from create_session — guard at every entry point.

---

## 7. Constitutional compliance (TARGETED step 4)

| # | Principle | Stage 1b status | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A backend |  |
| 2 | One owner per truth | PASS | Schedule lives on `ticket_checkout_sessions.installment_schedule`; copied into `order_installments` at finalize. No duplication. |
| 3 | No silent failures | PASS | `installment_plan_finalize_missing_customer_or_pm` + `unknown_kind` 400 + adversarial test enforces both. |
| 4 | One key per entity | N/A no client query keys touched | |
| 5 | Server state server-side | PASS | No client state changes. |
| 6 | Logout clears everything | N/A | |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` markers added; Stage 1c follow-ups documented in implementor + tester reports. |
| 8 | Subtract before adding | PASS | DROPped the 5-arg finalize overload before adding the 8-arg form. |
| 9 | No fabricated data | PASS | Schedule read from DB, validated, never invented. |
| 10-14 | UI/locale/auth/etc. | N/A backend | |

Zero constitutional violations.

---

## 8. Parity (TARGETED step 7)

Backend-only — no UI surface ships to any platform in Stage 1b.
- iOS Simulator: N/A (no iOS code touched)
- Android Emulator: N/A (no Android code touched)
- Web preview: **proven** — implementor's Playwright purchase flow exercised the modified `stripeWebhookRouter.ts:768-797` end-to-end against the live deployed `stripe-webhook` edge function. Smoke order row independently re-verified in DB by tester (§3 above).

Solo/collab parity: N/A (consumer trips/events not in scope for Stage 1b).

---

## 9. Cross-domain impact verified (TARGETED step 9)

- **`ticket-checkout-create/index.ts`** — free-finalize call site still works; 3 new params default; verified by inspection.
- **`reconcile-stuck-checkouts/index.ts`** — same; non-installment recovery safe; installment recovery flagged as P4-1 / Stage 1c.
- **`ticket-checkout-confirm/index.ts`** — same as above.
- **`installmentWebhookHandlers.ts` (Stage 1)** — already dispatches `kind: "installment_dunning"` + `kind: "installment_plan_paid_in_full"` to dispatcher. Dispatcher's new branches match this dispatch shape exactly (verified by implementor adversarial test #11 + tester source-read).
- **`stripeWebhookRouter.ts:isInstallmentPaymentIntentEvent` (Stage 1)** — Stage 1b did NOT modify this discriminator; the installment-PI branch (`handleInstallmentPaymentSucceeded` / `Failed`) continues to route correctly.

---

## 10. Pattern compliance (TARGETED step 10)

- Migration pattern: monotonic timestamp (`20260610000002` > `20260610000001`), `BEGIN; ... COMMIT;`, `DO $$ ... END $$;` self-verification probe matches existing conventions (`20260610000000_tr3_installments.sql`).
- RPC pattern: `SECURITY DEFINER`, `SET search_path = public, auth`, `REVOKE FROM PUBLIC` + `GRANT EXECUTE TO service_role` — matches existing `biz_*` RPCs.
- Edge-function pattern: `serve(async (req) => ...)`, `OPTIONS` short-circuit, `POST`-only, service-role auth check, `jsonResponse({error: ...}, status)` — matches existing dispatchers.
- Email-helper pattern: HTML escape, ASCII-safe templates, single exported `render*` function returning `{subject, html, text, from}` — matches `tripConfirmationEmail.ts` + `installmentDunningEmail.ts`.

Zero pattern deviations.

---

## 11. Spec criterion mapping (only Stage 1b-coverable items)

| SC | Spec criterion | Verdict | Evidence |
|---|---|---|---|
| SC-3 | Trip publish validates schedule via RPC | PARTIAL | Validation happens at CHECKOUT (`biz_ticket_checkout_create_session`), NOT publish. SPEC §3.1 implies publish-time validation; deferred to Stage 2 publish-RPC follow-up. |
| SC-6 | Deposit saves PM via setup_future_usage + finalize writes the 2 new columns | PASS | Verified by code read + adversarial tests A1-A3 + migration §595-596 CASE-gating. |
| SC-15 | Failed deposit at booking does NOT write order_installments rows | PASS | Failed PI never reaches finalize; finalize installment branch additionally gated on `p_installment_plan_root` + non-null schedule (adversarial B4). |
| SC-17 | Late-booking rejection: first installment past due → reject | PASS | Migration §354 raises `installment_schedule_past_due_at_booking`. See §6 P3-1 for the only-first-installment caveat. |
| SC-13 | Existing non-installment event checkout unchanged | PASS | Live smoke (§3 E) proves order created with all new columns at defaults, no installment rows, ticket issued. |
| SC-14 | Existing non-installment trip checkout unchanged | PASS by construction | trip branch in create_session gated on `tier_metadata->'installments' IS NOT NULL`; finalize branch gated on `p_installment_plan_root`. No trip with installments could be exercised live (Stage 2 UI pending), but the gate is verified by adversarial B4. |

Other SCs (SC-1, 2, 4, 5a/b/c, 7-12, 16, 18, 19, 20) are Stage 1 (already done) or Stage 2 (pending UI work).

---

## 12. Discoveries for orchestrator

1. **P4-1 / Stage 1c** — reconcile + confirm finalize callers need same 3-new-param plumbing as the webhook router. Implementor Discovery #1 already registers this; tester confirms with file/line. Low-likelihood race but worth closing before Stage 2 launches.
2. **P3-1 / Spec follow-up** — late-booking rejection should optionally extend to all installments + add due-date monotonicity check, OR Stage 2 PaymentPlanEditor enforces at UI layer with an invariant matching the SQL.
3. **Tr2 + Stage 1 TypeScript-debt cleanup** — `tripConfirmationEmail.ts` (Tr2) and `installmentDunningEmail.ts` (Stage 1) both shipped with `SenderIdentity { email, name }` that didn't match the canonical `senders.ts` `{ name, address }`. Stage 1b imported them which exposed the drift; one-line fixes per file got `deno check` clean for the first time since Tr2 shipped. Consider adding a CI strict-grep gate forbidding `from: { email: ...` in any `_shared/email/*.ts` file to prevent reintroduction.
4. **Stage 2 carryover from prior closes** — ORCH-0867 [Trip dashboard View public page button] and ORCH-0868 [forwardRef RedBox cleanup] still pending WORLD_MAP registration from ORCH-0859 [Tr2 Minimum Viable Trip] close. Stage 1b CLOSE should fold these in.

---

## 13. Final verdict

**PASS.**

- Stage 1b is regression-clean. Independent DB re-verification confirms every implementor claim about the live smoke order (5 new columns populated correctly per the gating logic; zero ledger rows on non-installment purchase).
- Adversarial test (11/11 PASS) covers a different angle from implementor's 12 dispatcher tests, and 4 per-assertion mutations prove fails-on-revert.
- Constitutional check clean (0 violations).
- Live-fire sim gate exempt (backend-only); web surface end-to-end proof from implementor smoke meets `proven`-level evidence.
- 0 P0, 0 P1, 0 P2. The 2 P3 findings are spec-clarification follow-ups (not blockers).
- Stage 1c follow-up (P4-1) is operator-deferred per implementor report and tester aligns.

**CLOSE-ready.** Codex `orchestrator-mingla` can promote Stage 1b to `main` via a single PR per the one-PR-per-CLOSE rule. The PR diff already contains both the implementor's happy-path test and the tester's adversarial test (verified via `git status` — both files appear in the closing diff).

---

End of QA report.
