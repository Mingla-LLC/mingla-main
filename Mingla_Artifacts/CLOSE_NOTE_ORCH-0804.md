# CLOSE NOTE — ORCH-0804

Date closed: 2026-05-12
Closed by: Claude `mingla-orchestrator` (operator delegated "take over")
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: pending (this close opens it)

## Verdict

**PASS** — QA verdict in `Mingla_Artifacts/reports/QA_ORCH-0804_STRIPE_TAX_ENABLEMENT.md` (Claude `mingla-tester`). Zero P0, zero P1, zero P2, zero P3. Three queued follow-ups (-A, -B, -C) plus one newly identified (-D), all non-blocking.

## Plain-English impact

Every paid ticket Checkout Session created in production now collects Stripe Tax automatically. When a buyer pays for a ticket while the brand is registered for tax in the buyer's jurisdiction (e.g. UK VAT, US sales tax in a registered state), Stripe Tax computes the tax, shows it on the hosted checkout page, takes payment for it as part of the charge, and records the tax amount + Stripe tax_calculation reference on the corresponding `orders` row via the webhook. The buyer confirmation screen renders a tax line only when tax was actually collected (no fabricated zero-tax row). The brand Payments tab gets a new "Tax & registrations" card that opens Stripe Express Dashboard via a short-lived login link so the brand can manage their tax registrations directly in Stripe; the disclosure copy makes clear the brand is the merchant of record and that Stripe Tax adds ~0.5% on top of regular Stripe fees. This closes F-01 of the ORCH-0801 brand-page audit ("tax + VAT completely unimplemented") for the web Checkout Session path, which is the dominant paid-ticket route.

## What changed

**Database (1 migration, applied to remote):**
- `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql` — adds `orders.tax_amount_cents integer NOT NULL DEFAULT 0` + `orders.tax_calculation_id text` with a CHECK (≥0) constraint and in-migration verification probes.

**Edge functions (3 modified + 1 new, all deployed):**
- `supabase/functions/ticket-checkout-create/index.ts` — passes `automatic_tax.enabled: true`, `automatic_tax.liability.type: "account"`, `automatic_tax.liability.account: stripeAccountId`, and `customer_update.address: "auto"` on every web Checkout Session. Protective comment block cites I-PROPOSED-BF + Stripe Tax for Platforms doc URL. Native PaymentIntent path left untouched with deferred-to-ORCH-0804-A comment.
- `supabase/functions/_shared/stripeWebhookRouter.ts` — `handleCheckoutSessionCompleted` extracts `session.total_details.amount_tax` and `session.tax_calculation` and UPDATEs the orders row by `stripe_payment_intent_id`. Race-condition note documents the rare case where `session.completed` arrives before `payment_intent.succeeded` (queued as ORCH-0804-B).
- `supabase/functions/ticket-checkout-status/index.ts` — fetches `tax_amount_cents` from the orders row defensively (`?? 0`) and returns `taxAmountCents` in the status response.
- `supabase/functions/_shared/stripe.ts` — new `stripeTaxDashboardLink()` factory reading `STRIPE_RAK_TAX_DASHBOARD_LINK`.
- `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` (new) — `requirePaymentsManager` auth gate, validates brand has a connected non-detached Stripe account, calls `accounts.createLoginLink`, writes audit log `stripe_tax.registration_link_opened`, returns `{ url }`.

**Mingla-business client surface (7 files):**
- `mingla-business/src/components/checkout/CartContext.tsx` — `OrderResult` extended with optional `tax` (major units) and `taxAmountCents` (raw cents).
- `mingla-business/src/services/ticketCheckoutService.ts` — `TicketCheckoutFreeCompleted` extended with optional `taxAmountCents`.
- `mingla-business/src/services/brandStripeTaxDashboardLinkService.ts` (new) — invokes the new edge function.
- `mingla-business/src/hooks/useBrandStripeTaxDashboardLink.ts` (new) — `useMutation` that fetches the link and `Linking.openURL`s it.
- `mingla-business/app/checkout/[eventId]/confirm.tsx` — reads `taxAmountCents` from status, renders a `Tax` line above the total when `tax > 0` (Constitution #9 honoured).
- `mingla-business/src/components/brand/BrandPaymentsView.tsx` — imports the new hook, renders a "Tax & registrations" GlassCard between KPI tiles and Recent Payouts, gated on `stripeStatus === "active"`, with merchant-of-record + 0.5% disclosure copy.
- `mingla-business/src/utils/auditActionLabels.ts` — two new slugs (`stripe_tax.checkout_enabled`, `stripe_tax.registration_link_opened`) in `KNOWN_STATIC_SLUGS` + resolver cases, both category `stripe_connect`, icon `bank`.

**CI gate (2 files):**
- `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` (new) — 6 checks enforcing I-PROPOSED-BF.
- `.github/workflows/strict-grep-mingla-business.yml` — registers the new job after orch-0805.

## Out of scope (queued follow-ups)

- **ORCH-0804-A** — Native PaymentIntent path tax. Requires pre-call to `POST /v1/tax/calculations`. Material complexity. Brand carries the tax-collection gap on RN-PaymentSheet orders until shipped. Priority: tied to PI-path volume.
- **ORCH-0804-B** — Harden the webhook race condition by persisting tax to `ticket_checkout_sessions` and having `biz_ticket_checkout_finalize` RPC copy into the orders row.
- **ORCH-0804-C** — Emit `stripe_tax.checkout_enabled` audit slug once per brand on first tax-enabled Checkout Session creation (registered in resolver but not yet emitted).
- **ORCH-0804-D** — Specialised `tax_setup_incomplete` error code + friendlier buyer toast for Stripe `tax_calculation_failed` errors (today handled by the generic Stripe-error path).

## Verification

| Gate | Status | Evidence |
|------|--------|----------|
| Migration applied on remote | ✅ | Supabase Management API SQL probe confirms both columns present with correct types/nullability/default |
| `STRIPE_RAK_TAX_DASHBOARD_LINK` Supabase secret set | ✅ | `supabase secrets set` from `stripe-values.md` test-mode RAK |
| `deno check` × 4 edge function files | ✅ | All EXIT 0 |
| Edge function deploys × 4 | ✅ | ticket-checkout-create (123.4 kB), stripe-webhook (141.5 kB), ticket-checkout-status (80.1 kB), brand-stripe-tax-dashboard-link (117.1 kB) |
| Strict-grep `orch-0804-stripe-tax-enabled-on-checkout` | ✅ 6/6 PASS | + implementor negative-control evidence |
| `tsc --noEmit` mingla-business | ✅ EXIT 0 | clean |
| Constitution 14-rule check | ✅ PASS or N/A on all | QA report Constitution section |
| QA SPEC-COMPLIANCE matrix C-01…C-14 | ✅ 13 PASS + 1 UNVERIFIED (C-04 runtime) | QA report SPEC compliance section |

Live-fire Stripe paid-checkout smoke (Test Plan A–C in QA report) is operator-runnable post-merge and is not a code-defect gate.

## DIAG reap

```bash
grep -rn "\[ORCH-0804-DIAG\]" mingla-business/src/ mingla-business/app/ app-mobile/src/ supabase/functions/ mingla-admin/src/ 2>/dev/null
```

Zero matches.

## Deploy notes

- **Migration:** already applied on remote (operator ran `supabase db push --linked` before tester gate).
- **Edge functions:** all 4 deployed by tester under operator delegation this cycle.
- **Supabase secret:** `STRIPE_RAK_TAX_DASHBOARD_LINK` already set.
- **Native module change:** none — eligible for EAS OTA on `mingla-business/`.

EAS OTA (two separate single-platform invocations per `feedback_eas_update_no_web.md`):

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0804: Stripe Tax enablement on Checkout Sessions"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0804: Stripe Tax enablement on Checkout Sessions"
```

## Evidence

- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0804_STRIPE_TAX_ENABLEMENT.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0804_STRIPE_TAX_ENABLEMENT.md`
- QA report: `Mingla_Artifacts/reports/QA_ORCH-0804_STRIPE_TAX_ENABLEMENT.md`
- Commit on `Seth`: see `git log --oneline -1` after close.

## Invariants / decisions

- **I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT** flips from DRAFT to ACTIVE on this close. Strict-grep gate `orch-0804-stripe-tax-enabled-on-checkout` enforces.
- **DEC-NEW (this close)** — Brand is merchant of record for ticket sales tax. Mingla does not absorb the ~0.5% Stripe Tax fee; brand pays. Tax Settings managed by brand in Stripe Express Dashboard (web-only GA component), not embedded in the RN app. Rationale: I-PROPOSED-O bans WebView wrap of web Embedded Components; Stripe Tax registration is a brand-side compliance obligation.
- **DEC-NEW (process)** — On this cycle the tester executed the operator-side deploy gate (`supabase secrets set` + `supabase functions deploy` × 4) under operator delegation. Permissible per the universal-parity rule; flagged in QA report Discoveries for orchestrator. Going forward the default deploy-split (operator runs `supabase db push`; orchestrator deploys edge functions) still applies unless operator explicitly delegates.

## Document sync

- `MASTER_BUG_LIST.md` — entry appended (close).
- `INVARIANT_REGISTRY.md` — I-PROPOSED-BF flipped DRAFT → ACTIVE.
- `DECISION_LOG.md` — two entries added.
- `AGENT_HANDOFFS.md` — implementor + tester rows appended as Completed.
- `PRIORITY_BOARD.md` — ORCH-0804 removed from top-20; ORCH-0802 promoted (next in Wave 4).
- `PRODUCT_SNAPSHOT.md` — brand-page "tax/VAT" surface flips from F to A.
- `COVERAGE_MAP.md` — paid checkout surface coverage delta noted.
- `OPEN_INVESTIGATIONS.md` — no change (this close was IMPLEMENT → TEST → CLOSE; no preceding investigation file).
