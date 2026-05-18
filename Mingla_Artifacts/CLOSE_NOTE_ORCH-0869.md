# CLOSE NOTE — ORCH-0869 [Tr3 Installment Payments]

**Closed:** 2026-05-18
**Closer:** Claude `mingla-orchestrator`
**Verdict:** PASS Grade A (backend Stages 1 + 1b)
**Pipeline:** Claude orchestrator INTAKE → Claude forensics INVESTIGATE+SPEC → Claude implementor Stage 1 → Claude orchestrator deploys → Claude implementor Stage 1b → Claude orchestrator deploys → Claude tester TARGETED → Claude orchestrator CLOSE

---

## Layman summary

Trips on Mingla can now collect money in installments — buyer pays a deposit at booking, future installments auto-charge on schedule. The full engine (database, cron, webhooks, dunning emails, paid-in-full emails, deposit-saves-card flow, ledger persistence) is live in production. The buyer-facing UI to *configure* a plan does not exist yet (Stage 2 follow-up); for now operators can populate `trip_pricing_tiers.tier_metadata.installments` via direct SQL on any trip. The non-installment ticket purchase path is regression-clean — verified end-to-end via a live $50 Stripe-test-mode purchase that completed successfully and matched all expected DB invariants.

---

## What shipped

### 3 migrations (applied to production Supabase `gqnoajqerqhnvulmnyvv`)
| Filename | Purpose |
|---|---|
| `supabase/migrations/20260610000000_tr3_installments.sql` | `order_installments` ledger table + 5 new `orders` columns + `biz_retry_installment` RPC + pg_cron schedule `orch-0869-process-scheduled-installments` (`0 */6 * * *`) |
| `supabase/migrations/20260610000001_tr3_cron_use_vault_secrets.sql` | Patch — re-schedule cron with `vault.decrypted_secrets` reads (the standard Supabase `app.settings.*` GUC pattern is not configured on this project) |
| `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` | Adds `ticket_checkout_sessions.installment_schedule jsonb` + `CREATE OR REPLACE biz_ticket_checkout_create_session` (installment validation + late-booking rejection + deposit-only total override) + `DROP` 5-arg finalize → `CREATE OR REPLACE` 8-arg finalize (installment-plan-root branch INSERTs `order_installments` rows) |

All self-verification probes PASS post-apply. Live-verified post-CLOSE: exactly 1 finalize overload with `pronargs=8`, both RLS policies on `order_installments`, all 5 new `orders` columns + 1 new `ticket_checkout_sessions` column present with correct types/defaults.

### 4 edge functions deployed
| Function | Status | What changed |
|---|---|---|
| `process-scheduled-installments` | NEW (Stage 1) | Cron handler. Service-role-gated. Queries due `scheduled` installments + retry-eligible `failed` installments. Creates off-session PIs on connected account with idempotency-key `installment:${order_id}:${ordinal}:${retry_count}`. Flips status; fires dunning email on fail; flags at_risk after 3 retries. |
| `stripe-webhook` | MODIFIED (Stage 1 + Stage 1b) | Router gained installment-PI discriminator (Stage 1). Finalize call site now passes `p_stripe_customer_id_on_connected_account`, `p_saved_payment_method_id`, `p_installment_plan_root` from the deposit PI metadata (Stage 1b). |
| `ticket-confirmation-dispatch` | MODIFIED (Stage 1b) | New `body.kind` branches `installment_dunning` (routed to `renderInstallmentDunningEmail`) + `installment_plan_paid_in_full` (routed to `renderInstallmentPlanPaidInFullEmail`). Legacy `kind=null` path byte-identical; unknown kinds return HTTP 400. |
| `ticket-checkout-create` | MODIFIED (Stage 1) | Conditional `setup_future_usage: 'off_session'` + `payment_method_types: ['card']` + metadata `mingla_installment_plan_root: 'true'` when `session.installmentSchedule != null`. NO-OP until Stage 1b RPC populated `installmentSchedule` on the session. |

### 5 new/touched edge-function source files
- `supabase/functions/process-scheduled-installments/index.ts` (NEW, 358 lines + Deno tests)
- `supabase/functions/_shared/installmentWebhookHandlers.ts` (NEW, 252 lines)
- `supabase/functions/_shared/email/installmentDunningEmail.ts` (NEW, 175 lines; Stage 1b SenderIdentity carryover fix)
- `supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts` (NEW Stage 1b, 108 lines)
- `supabase/functions/_shared/email/tripConfirmationEmail.ts` (Stage 1b carryover fix — Tr2 `SenderIdentity { email, name }` corrected to canonical `{ name, address }`; unblocked 2 pre-existing TS18047 narrowing errors in dispatcher)

### CI gates
- NEW `.github/scripts/strict-grep/i-proposed-tr3-installment-pi-via-cron-owner.mjs` enforcing `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` — only `process-scheduled-installments/index.ts` may create installment PaymentIntents. 164 files scanned, 0 violations. Wired into `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-tr3-installment-pi-via-cron-owner`.

### Regression tests (Step 0.5 gate)
- Implementor happy-path: `supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts` — 12/12 PASS. Pins dispatcher kind-routing AST. Fails-on-revert verified by implementor at HEAD `e17ca8db`.
- Tester adversarial: `supabase/functions/_shared/__tests__/installment_handoff_adversarial.test.ts` — 11/11 PASS. Pins webhook-router → finalize-RPC handoff + migration signature invariants on a DIFFERENT angle from implementor. Fails-on-revert verified per-assertion via 4 representative mutations: `===` → `==` failed strict-equality assertion; removing `DROP FUNCTION IF EXISTS biz_ticket_checkout_finalize(uuid,text,text,text,text)` failed overload-drop assertion; removing `installment_plan_finalize_missing_customer_or_pm` guard failed defensive-guard assertion; ungating customer extraction failed gating assertion. Restore → 11/11 PASS.

Combined **23/23 PASS** on closing tree.

---

## Live-fire evidence

Implementor (prior turn) drove a real end-to-end paid ticket purchase against production:
- Local mingla-business web preview (Expo web on port 8084, app.json `web.output: "single"` for SSR-bypass during the smoke; reverted post-smoke).
- Event: "The random" (`a84ad74d-c35b-4f2c-892c-72debb92c503`), ticket type "The Paid" $50 USD.
- Flow: pick ticket → fill buyer name/email/phone → Continue → Stripe Hosted Checkout (after unchecking Link enrollment + filling 4242 card + dismissing Google address autocomplete) → submit.
- Stripe redirected back to `https://business.usemingla.com/checkout/{eventId}/confirm?cs=cs_test_*`.

Tester (this CLOSE) independently re-queried the live production Supabase via Management API direct SQL (zero trust in implementor claims):
```
SELECT id, total_cents, installment_plan_root, stripe_customer_id_on_connected_account,
       saved_payment_method_id, at_risk, payment_status,
       (SELECT count(*) FROM order_installments WHERE order_id = orders.id) AS installments_count,
       (SELECT count(*) FROM tickets WHERE order_id = orders.id) AS tickets_count
FROM orders WHERE id = '90b9308a-1c3a-4269-bb13-0f61cb133597';
-- total_cents: 5000
-- installment_plan_root: false       (gated correctly, non-installment)
-- stripe_customer_id_on_connected_account: null  (gated correctly)
-- saved_payment_method_id: null      (gated correctly)
-- at_risk: false                     (default)
-- payment_status: paid
-- installments_count: 0              (correct for non-installment)
-- tickets_count: 1                   (issuance loop ran correctly)
```

Cron probes 3× post-deploy all returned HTTP 200 + `{processed:0, collected:0, failed:0, at_risk_flagged:0, errors:[]}` (no installment plans exist yet — Stage 2 UI not shipped).

---

## Invariants

| Invariant | Status |
|---|---|
| `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` | **DRAFT → ACTIVE** (CI gate live, 164 files scanned, 0 violations) |
| `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` | DRAFT (awaits Stage 2 enforcement layer) |
| `I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID` | DRAFT (enforced at SQL CHECK level live; CI mirror deferred to Stage 2) |
| `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` | DRAFT (awaits Stage 1c spec + tester regression) |

DRAFT statuses preserved in `INVARIANT_REGISTRY.md` (note: full registry update pending; canonical record is this CLOSE NOTE + the WORLD_MAP entry).

---

## Findings

- **P3-1.** Late-booking validation only checks FIRST installment's due_at (migration line 354). A schedule like `[ord-1: future, ord-2: past]` would pass validation and the cron would immediately try to charge ord-2. Either intended (auto-bill past-due immediately) or a gap relative to SPEC §3.5.1 "due dates monotonically increasing if fixed_date used". Stage 2 PaymentPlanEditor UI likely enforces; flag for Stage 1c spec follow-up if not.
- **P3-2.** Pct sum tolerance 0.01 (migration line 326) may reject some legitimate edge inputs like `33.333 × 3 + 0.001`. Unlikely in practice (operator UI will use integer % steps).
- **P4-1.** Stage 1c follow-up — registered as **ORCH-0872** in WORLD_MAP. Update `reconcile-stuck-checkouts/index.ts` and `ticket-checkout-confirm/index.ts` to mirror the `stripeWebhookRouter.ts` extraction pattern. Low-likelihood race (webhook is authoritative); high-impact when hit (silent state divergence between Stripe and Mingla).
- **P4-2.** Praise — defensive `installment_plan_finalize_missing_customer_or_pm` `RAISE EXCEPTION` at migration line 609 prevents silent ledger-without-charge state. Replicate this pattern in Stage 2 components.

---

## DIAG-marker reap

Step 1.5 grep:
```
grep -rn "\[ORCH-0869-DIAG\]" mingla-business/src/ mingla-business/app/ app-mobile/src/ supabase/functions/ mingla-admin/src/
```
**Zero matches.** Clean.

---

## Follow-up ORCHs registered this CLOSE

| ORCH | Title | Source |
|---|---|---|
| **ORCH-0872** | Tr3 Installment Payments Stage 1c — plumb 3 new finalize params through `reconcile-stuck-checkouts` + `ticket-checkout-confirm` | QA P4-1 + implementor Discovery #1 |
| **ORCH-0867** | Trip dashboard "View public page" button | Carryover from ORCH-0859 close 2026-05-17 (was deferred without WORLD_MAP registration) |
| **ORCH-0868** | Trip dashboard `forwardRef` RedBox dev-experience cleanup | Carryover from ORCH-0859 close 2026-05-17 |

---

## Stage 2 (deferred to future ORCH; not registered here)

The buyer-facing and planner-facing UI for installment plans was NOT shipped in this CLOSE. When the operator is ready to ship Stage 2, scope is per SPEC §3.5 + §3.6:
- `PaymentPlanEditor.tsx` (NEW) — operator UI for configuring deposit_pct + installments
- `InstallmentScheduleDisplay.tsx` (NEW) — read-only schedule render for buyer + checkout
- `orderInstallmentsService.ts` + `useOrderInstallments.ts` (NEW) — React Query layer
- `TripCreatorStep4Pricing.tsx` modification — Add Payment plan toggle
- `TripCheckoutFlow.tsx` + 3 buyer-anon-web routes (`index.tsx` + `buyer.tsx` + `payment.tsx`) — render schedule above line items
- `app/trip/[id]/index.tsx` — new "Money" tab with per-traveler installment list + Retry button
- 2 additional CI strict-grep gates (the other 2 DRAFT invariants)
- Tester adversarial test on Stripe test clock for full end-to-end installment auto-charge

SPEC §11 originally named Tr3 v1.1 auto-adjust as ORCH-0870 and Tr3 buyer self-update PM as ORCH-0871 — both ORCH-IDs are now taken by unrelated work (ORCH-0870 = icons replacement, ORCH-0871 unassigned but reserve range exhausted). At Stage 2 SPEC time renumber these follow-ups.

---

## Working tree + branch

- Path: `/Users/sethogieva/Desktop/mingla-main`
- Branch: `Seth`
- PR: opened Seth → main as `Close ORCH-0869 [Tr3 Installment Payments] backend Stages 1 + 1b` per one-PR-per-CLOSE rule
- Pre-merge gate: mandatory (checks green, mergeable CLEAN, not BEHIND, operator-confirmed)

## Deploys (post-CLOSE-commit)

EAS OTA: **NOT REQUIRED** — Stage 1 + Stage 1b are backend-only (3 migrations + 4 edge fns + 2 new email helpers + 1 CI gate). No mobile or web JS bundle change ships in this CLOSE.

Future Stage 2 will require EAS update (UI changes to `mingla-business/`).

---

End of CLOSE NOTE.
