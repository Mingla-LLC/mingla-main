# QA — ORCH-0843 [Charge-Shape Reconciliation] (Path B — direct charges + platform-liable)

**Mode:** mingla-forensics TEST (TARGETED sub-mode)
**Tester:** Claude `mingla-forensics`, 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Verdict:** **FAIL**
**Severity counts:** P0: 1 | P1: 2 | P2: 1 | P3: 0 | P4: 2
**Inputs:**
- SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`
- Implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`
- Investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`
- DEC-154 + DEC-155 (`Mingla_Artifacts/DECISION_LOG.md`)

---

## 0. Headline

The static gates pass, the regression test passes, the probe edge function works against a real connected account, and the **native** PaymentIntent surface (`surface: "native"`) creates live direct-charge PIs successfully (`stripe_application_fee_amount_cents = 75` populated on session row, real `pi_*` returned). HOWEVER — **both** of the production buyer surfaces shipped to real users today (`surface: "web"` from the Vercel buyer site and `surface: "mobile-web"` from the mingla-business app per ORCH-0839-B) are **BROKEN in production**. Every Stripe Checkout Session create call returns `400 StripeInvalidRequestError` and the buyer sees an error toast.

**Root cause of the failure** (independently traced + corroborated by Stripe Tax for Platforms docs): SPEC §3.1.3 claimed `automatic_tax: { liability: { type: "account", account: stripeAccountId } }` is "PRESERVED VERBATIM" under direct charges and works identically to destination charges. Stripe documentation (`https://docs.stripe.com/tax/connect/direct-charges`) contradicts this directly — under direct charges (Stripe-Account header set) the `automatic_tax.liability` block is NOT supported in the form the code emits; for direct charges Stripe uses the Stripe-Account header alone to designate the connected account as merchant of record, and the legacy `liability.type: "account"` + explicit `account: ...` shape is treated as an invalid request.

The implementor honored the SPEC verbatim. The SPEC was wrong on this one paragraph. The implementor also did not catch it because the regression test only checks the source string `automatic_tax` is present (not whether the runtime Stripe API accepts the combined body).

This is a P0 production-blocker for the **Path B live-sales unblock** ORCH-0843 was created to deliver. It must be fixed before CLOSE. The fix is well-scoped (one block in `ticket-checkout-create/index.ts`; analogous tweak in SPEC §3.1.3 / regression test if the contract changes shape).

Also P1: `charge.dispute.created` is absent from `STRIPE_ROUTED_EVENT_TYPES` (implementor flagged in Discovery 2, but under Path B platform-liable this is THE primary loss-realisation event — Mingla is the financial backstop and disputes are silently ignored). The implementor's recommendation to file a follow-up ORCH is correct, BUT under Path B + DEC-154 amendment text, "live sales open immediately on charges-enabled brands" + zero dispute handling is operationally unsafe even for test stubs. Strongly recommend the orchestrator either (a) gate live-sales lift on dispute routing, or (b) explicitly accept the risk in writing for test-stub volume and commit a hard date for the dispute-routing follow-up ORCH.

---

## 1. SC-01..SC-12 traceability

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-01 | Hosted Checkout Session direct charge | **FAIL — live** | Probe call against `acct_1TUNLtB5v00XfDTX` succeeded (returns valid `cs_test_*` URL + `application_fee_amount = 75¢` + `statement_descriptor_suffix: "MINGLA"`) — BUT the probe omits `automatic_tax`. Real `ticket-checkout-create v46` calls against the same connected account fail with 400 `StripeInvalidRequestError`. DB rows `086113c8-1212-41d7-a89e-83223876883d` + `ef56aa2f-adb8-4c4a-ab5f-106e9d0b2dda` confirm: `status=failed`, `failure_reason=stripe_checkout_session_create_failed:400:stripe_request_or_account_config:StripeInvalidRequestError`, `stripe_application_fee_amount_cents=75` (so the fee plumbing fired, but the Stripe call body was rejected by Stripe). |
| SC-02 | Native PaymentIntent direct charge | **PASS — live** | `surface: "native"` call against same account succeeded. DB row `eb319853-c12b-4fc0-a5cc-25f72f4512b3`: `status=processing_payment`, `stripe_payment_intent_id=pi_3TXG0AB5v00XfDTX1NYcI4h4`, `stripe_application_fee_amount_cents=75`. PI was created on the connected account (PI id is on the `acct_1TUNLtB5v00XfDTX` account namespace per the `_B5v00XfDTX1NYcI4h4` shard suffix). PI path has no `automatic_tax` block, so it sidesteps the SC-01 failure. |
| SC-03 | `application_fee_amount` plumbed through | **PASS — live** | Live DB rows above show `stripe_application_fee_amount_cents = 75` populated by `Math.round(5000 × 0.015)`. UPDATE writes the fee back to `ticket_checkout_sessions` before the Stripe call so the refund flow can read it. Fee-math probe: $0.30 → 0¢ (omitted), $0.50 → 1¢, $50 → 75¢, $100 → 150¢, $9,999.99 → 15000¢ — all correct. Conditional-omit threshold is `totalCents <= 33`, NOT `< 67` as the code comment claims (P3 cosmetic). |
| SC-04 | Refund flow direct-charge compatible | **PASS by code; UNVERIFIED live** | Source review of `refund-order/index.ts`: `reverse_transfer:` removed, `stripeAccount: connectedAccountId` added to `stripe.refunds.create` options. JOIN `orders → events → brands.stripe_connect_id` lookup with defensive array/object normalisation. Defensive `missing_connected_account` 422 if the brand has no `stripe_connect_id`. Live refund test (T-06) **deferred** because SC-01 / SC-05 / SC-06 failure means no Checkout Session can complete to produce a chargeable order for refund. |
| SC-05 | Backward compat: `surface: "web"` | **FAIL — live** | Same as SC-01. Response shape change is moot when Stripe rejects the call. Existing buyers attempting `/checkout/<eventId>` on the Vercel site post-deploy would see an error toast and no Stripe redirect. |
| SC-06 | Backward compat: `surface: "mobile-web"` | **FAIL — live** | Same as SC-01 — confirmed by independent live curl returning 400 `StripeInvalidRequestError`. Real mingla-business mobile buyer flow (ORCH-0839-B custom-scheme path) is broken. |
| SC-07 | Backward compat: `surface: "native"` | **PASS — live** | See SC-02. The `app-mobile` consumer PaymentSheet path returns identical `{ kind: "requires_payment", clientSecret, paymentIntentId, ... }` shape. Live PI created against connected account. |
| SC-08 | Statement descriptor renders "MINGLA*" prefix | **PARTIAL — needs eyeball on receipt** | Live Stripe API accepted `statement_descriptor_suffix: "MINGLA"` (probe response confirmed). The new `_suffix` shape appends "MINGLA" to the creator's default descriptor (not the "MINGLA*" prefix DEC-154 (1) originally targeted; the true "MINGLA*" prefix requires a one-time Stripe Dashboard config on the platform account, not the per-call API). This is a CONSCIOUS contract delta from SPEC's original intent — `_prefix` was rejected by Stripe at PI level so the orchestrator switched to `_suffix` pre-test. Acceptable per DEC-154 (1) intent, but the operator should add the platform-level prefix in Stripe Dashboard to truly get "MINGLA*". |
| SC-09 | Tax for Platforms preserved | **FAIL** | SPEC §3.1.3 claimed Tax for Platforms config is "PRESERVED VERBATIM" under direct charges. Stripe docs disagree: `automatic_tax.liability.type: "account"` is for destination/separate-transfer charges, NOT direct charges. For direct charges the Stripe-Account header alone identifies the connected account as merchant of record; the `liability.account` block is rejected. This is the direct cause of SC-01 / SC-05 / SC-06 failure. |
| SC-10 | Webhook events flow correctly | **PARTIAL** | Routing code reads `event.account` correctly (`stripeWebhookRouter.ts:76-79`). Signature verification unchanged. However the routed event set is INCOMPLETE per DEC-154 (9)(c): missing `charge.dispute.created` — see §4 below. Live event flow not exercised because SC-01 failure means no `checkout.session.completed` event can fire from a real Mingla session. |
| SC-11 | CI gate `orch-0843-stripe-direct-charges-only.mjs` ACTIVE | **PASS** | Gate green locally on the deployed code. Adversarial trip test: re-introduced `transfer_data: { destination: stripeAccountId }` on the Checkout Session call site → gate exits 1 with named failures on BOTH T-G1 (string-match) AND T-G4 (directory-walk). Defense-in-depth confirmed. Restored file → gate exits 0. Workflow YAML correctly registers a new job at line 879-888. |
| SC-12 | DEC-154 amended | **DRAFTED** | Amendment text drafted in IMPLEMENTATION report §11. Not yet applied to `DECISION_LOG.md` (orchestrator owns at CLOSE per implementor hard guards). Acceptable for now; will be verified at CLOSE. |

**Summary:** 5 PASS by live evidence (SC-02, SC-03, SC-07, SC-11) + 1 PASS-by-code (SC-04) + 2 PARTIAL (SC-08, SC-10) + 1 DRAFTED (SC-12) + **3 FAIL on production live-fire** (SC-01, SC-05, SC-06) + **1 FAIL on contract** (SC-09 — the root cause of the 3 live-fire fails).

---

## 2. T-01..T-12 test matrix

| Test | Scenario | Verdict | Notes |
|---|---|---|---|
| T-01 | `surface: "web"` direct charge | **FAIL** | Live POST to deployed v46 returned 400; DB row `086113c8-1212-41d7-a89e-83223876883d` shows `status=failed`. |
| T-02 | `surface: "mobile-web"` direct charge | **FAIL** | Live POST returned 400. Same root cause. |
| T-03 | `surface: "native"` direct charge | **PASS** | Live PI `pi_3TXG0AB5v00XfDTX1NYcI4h4` created on `acct_1TUNLtB5v00XfDTX`; `stripe_application_fee_amount_cents=75`. |
| T-04 | `application_fee_amount` recorded when > 0 | **PASS** | DB rows show `stripe_application_fee_amount_cents = 75` for $50 orders. The session row UPDATE fires before the Stripe call so the value is present regardless of Stripe's accept/reject (even on failed rows, the fee is captured). |
| T-05 | `application_fee_amount` omitted when 0 | **PASS by code** | Conditional `if (applicationFeeAmountCents > 0)` gates the key assignment in both call sites; verified by Deno regression test #3. Not exercised live because real orders are all ≥$1. Boundary: $0.30 → 0¢ correctly omits. |
| T-06 | Statement descriptor renders "MINGLA*" prefix | **CANNOT EXECUTE** | Cannot complete a $0.50 test purchase because the Checkout Session creates fails before the buyer reaches Stripe's hosted page. Probe verified Stripe API accepts the `statement_descriptor_suffix: "MINGLA"` field; live receipt rendering deferred until T-01/T-02 fixed. |
| T-07 | Refund via direct charge | **CANNOT EXECUTE** | Same blocker as T-06; no order to refund. Source review confirms refund-order shape is correct. |
| T-08 | Dispute event flows to webhook | **CANNOT EXECUTE** | `charge.dispute.created` is missing from `STRIPE_ROUTED_EVENT_TYPES` — even if a dispute were dispatched, the router would not process it. |
| T-09 | Historical destination-charge order DB-queryable | **PASS** | 12 historical `orders` rows pre-flip still queryable (read-only DB check); query through admin / scanner unchanged. Refund path against these would fail per SPEC §3.2.3 by design (one-way cutover acceptance). |
| T-10 | CI gate trips on re-introduced `transfer_data` | **PASS** | Adversarial: injected `transfer_data: { destination: stripeAccountId }` → gate exits 1 with both T-G1 + T-G4 named failures. Restored → exits 0. |
| T-11 | Gate trips on missing `application_fee_amount` | **PASS-by-implementor-claim** | Implementor §9.2 captured the named-failure output; I did not independently re-run T-11 since T-10 + T-12 sufficed to prove the gate's defense-in-depth. |
| T-12 | Gate trips on missing `stripeAccount` header | **PASS-by-implementor-claim** | Same as T-11. |

---

## 3. Static gates + Deno + type checks

| Check | Result |
|---|---|
| `node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs` | EXIT 0 — gate passed (T-G1..T-G5 green) |
| Adversarial: inject `transfer_data: { destination: stripeAccountId }`, rerun | EXIT 1 — both T-G1 + T-G4 named failures with exact strings cited |
| Adversarial: restore file, rerun | EXIT 0 — re-passes; file `diff` exit 0 confirms byte-identical restore |
| `deno test --allow-read --no-check supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts` | 7/7 tests PASS in 6ms |
| `deno check supabase/functions/ticket-checkout-create/index.ts` | clean |
| `deno check supabase/functions/refund-order/index.ts` | clean |
| `deno check supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` | clean |
| Neighbouring gates — `orch-0777-ticket-checkout-production` | passed |
| Neighbouring gates — `orch-0789-error-toast-dismissible` | passed |
| Neighbouring gates — `orch-0804-stripe-tax-enabled-on-checkout` | **passed 6/6 — but this gate is now misleading** (see §6 below) |
| Neighbouring gates — `orch-0839-b-mingla-business-no-native-stripe` | passed |
| Workflow registration — `.github/workflows/strict-grep-mingla-business.yml` | new job `orch-0843-stripe-direct-charges-only` registered at line 879-888; registry comment at line 83. YAML valid. |

---

## 4. Webhook handler audit

### 4.1 — STRIPE_ROUTED_EVENT_TYPES dump

From `supabase/functions/_shared/stripeWebhookRouter.ts:23-54`:

```
account.updated
account.application.deauthorized
account.external_account.created
account.external_account.updated
account.external_account.deleted
capability.updated
payout.created
payout.paid
payout.failed
payout.canceled
charge.refund.updated
charge.refunded
refund.created
refund.updated
person.created
person.updated
person.deleted
application_fee.created
application_fee.refunded
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
checkout.session.completed
```

### 4.2 — Cross-reference vs DEC-154 (9)(c) required + Path B disputes

| Required event | Present? | Severity |
|---|---|---|
| `account.updated` | YES | — |
| `account.application.authorized` | **NO** | P2 (less critical — `deauthorized` IS present + `account.updated` covers most state changes) |
| `checkout.session.completed` | YES | — |
| `charge.refunded` | YES | — |
| **`charge.dispute.created`** | **NO** | **P1 — Path B platform-liable means Mingla absorbs chargeback losses; missing dispute routing = silent loss accumulation** |
| `payout.failed` | YES | — |

Recommended additions for Path B safety (file as follow-up ORCH):
- `charge.dispute.created` (P1 — fire on dispute open)
- `charge.dispute.updated` / `charge.dispute.funds_withdrawn` / `charge.dispute.funds_reinstated` / `charge.dispute.closed`
- `account.application.authorized`

### 4.3 — `event.account` routing

`accountIdForEvent(event)` reads `event.account` directly when present. Direct-charge events arrive with `event.account = <connected_acct>`, so routing works correctly by code. Connect-webhook registration in Stripe Dashboard is operator-side (G-3) and unverifiable from code.

### 4.4 — Signature verification

`verifyStripeWebhookSignature` runs on every event in `stripe-webhook/index.ts:56`. Mechanism unchanged under direct charges. PASS.

---

## 5. Fee math correctness

```
$0.30                ->  0¢ fee   (omit ✓)
$0.50                ->  1¢ fee
$0.67 (boundary)     ->  1¢ fee
$1.00                ->  2¢ fee
$50.00 (probe)       -> 75¢ fee   (matches live probe response)
$100.00              -> 150¢ fee
$9,999.99            -> 15000¢ fee
```

`Math.round(totalCents * 0.015)` produces 0 only when `totalCents <= 33` (since `34×0.015 = 0.51 → round to 1`). Implementor's source-comment at line 199 claims `totalCents < ~67` triggers omit; actual boundary is 33. **P3** cosmetic comment inaccuracy; the runtime behavior is correct (just wider safety margin than the comment claims). No functional issue.

Integer math safety: confirmed — `totalCents` is `integer NOT NULL` per DB schema; `Math.round(int × 0.015)` precision-safe up to ~$9×10^13.

---

## 6. Cross-domain regression check

| Surface | Affected | Live status |
|---|---|---|
| Vercel buyer site (`surface: "web"`) | YES | **BROKEN** (P0) |
| mingla-business mobile (`surface: "mobile-web"`) | YES | **BROKEN** (P0) |
| app-mobile consumer (`surface: "native"`) | YES | working live (T-03 PASS) |
| Admin dashboard | NO | no Stripe surface |
| Free orders (`totalCents === 0`) | NO | short-circuits before any Stripe call (line 151) — verified by reading code; no DB rows in failed status for free orders |
| Solo vs collab | N/A | anon buyer flow |

**Cross-cutting concern:** the `orch-0804-stripe-tax-enabled-on-checkout.mjs` gate still passes because it only checks the SOURCE STRING `automatic_tax` + `liability.type: "account"` + `liability.account:` are present in `ticket-checkout-create/index.ts` — which they are. The gate has not been updated for the direct-charge contract. After the fix lands, the orchestrator should consider whether to retire that gate or update it to allow direct-charge-compatible Tax for Platforms shape (i.e., `automatic_tax: { enabled: true }` with NO liability block under direct charges). **P2 — gate-drift maintenance.**

---

## 7. Constitutional audit (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | buyer flow unchanged client-side |
| 2 | One owner per truth | PASS | server owns the fee value; one canonical column |
| 3 | No silent failures | **PARTIAL** | the SC-01/05/06 failure DOES surface as an error toast (good), but the implementor's "non-fatal" fee-persist failure path (lines 226-231 of `ticket-checkout-create/index.ts`) logs and continues — if persistence fails, the refund flow will read `0` and skip `refund_application_fee: true`. Acceptable degrade per implementor's own SPEC comment, but worth highlighting as a small surface for divergence under load. P3. |
| 4 | One key per entity | PASS | no React Query keys changed |
| 5 | Server state server-side | PASS | no Zustand churn |
| 6 | Logout clears everything | N/A | anonymous buyer |
| 7 | Label temporary | PASS | the hardcoded 1.5% has Discovery #1 in the implementor report as the exit condition; the probe edge function is correctly marked as transient |
| 8 | Subtract before adding | PASS | `transfer_data` and `reverse_transfer` are REMOVED in the same hunk that adds the direct-charge shape |
| 9 | No fabricated data | PASS | computed values, not invented |
| 10 | Currency-aware | PASS | `currency` from session row, lowercased |
| 11 | One auth instance | PASS | unchanged |
| 12 | Validate at right time | N/A | no datetime in this change |
| 13 | Exclusion consistency | N/A | not a generation-vs-serving change |
| 14 | Persisted-state startup | N/A | no client state hydration changed |

---

## 8. P0 / P1 / P2 / P3 / P4 findings

### P0-001 — Tax for Platforms config incompatible with direct charges

**Layer:** Edge function (`supabase/functions/ticket-checkout-create/index.ts`)
**Lines:** 345-351

**Exact code (current):**
```ts
automatic_tax: {
  enabled: true,
  liability: {
    type: "account",
    account: stripeAccountId,
  },
},
```

**What it does:** designates the connected account as merchant of record via the destination-charge-era Tax for Platforms config. Worked under destination charges (where the Charge object lived on the platform). Under direct charges (Stripe-Account header set), Stripe rejects the body with `400 StripeInvalidRequestError`.

**What it should do (Stripe-doc-corroborated):** under direct charges the Stripe-Account header alone designates the connected account as merchant of record. The fix is one of:
- **(preferred)** Drop the `liability` block entirely: `automatic_tax: { enabled: true }`. Tax is calculated on the connected account's registered tax origin; `liability` is implicit (the account in the Stripe-Account header).
- (alternative) `liability: { type: "self" }` — explicitly says "the account making the API request" (i.e., the connected account scoped via header). Stripe accepts this on direct charges.

Both shapes work; (preferred) matches Stripe's Tax-for-Platforms direct-charges doc verbatim.

**Causal chain:**
1. Operator activates Path B (direct charges) per DEC-154 amendment.
2. Implementor flips Charge body to direct-charge shape per SPEC.
3. SPEC §3.1.3 incorrectly claims `liability.account` is "PRESERVED VERBATIM" under direct charges.
4. Stripe API rejects every Checkout Session create from `surface: "web"` and `surface: "mobile-web"` with 400.
5. Every buyer attempting hosted Checkout sees an error toast and cannot complete a purchase.

**Verification:**
- Probe edge function (which omits `automatic_tax` entirely) succeeded against `acct_1TUNLtB5v00XfDTX` (returns valid `cs_test_*` URL).
- Real `ticket-checkout-create v46` against the same account fails with `400 StripeInvalidRequestError` on both `web` and `mobile-web` surfaces.
- `surface: "native"` succeeds because the PI path has no `automatic_tax` block.
- Stripe docs (`https://docs.stripe.com/tax/connect/direct-charges`) confirm: do NOT include `automatic_tax.liability` on direct charges.

**Fix instructions (cited file:line):**
- `supabase/functions/ticket-checkout-create/index.ts:345-351` — replace the `automatic_tax` block with `automatic_tax: { enabled: true },` (drop the entire `liability` object).
- Update `supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts:112-126` (the "Tax for Platforms config preserved" test) — change the assertion from `liability.type: "account"` presence to: assert `automatic_tax: { enabled: true }` is present AND assert `liability` block is ABSENT (or `type: "self"` only). Mirror the new direct-charge contract.
- Re-run the probe edge function with `automatic_tax: { enabled: true }` (no liability block) added to its body, to confirm Stripe still accepts the combined tax-enabled-direct-charge shape against a real connected account. This step is non-optional — it proves the FIX before the live deploy.
- Update SPEC §3.1.3 with an addendum / strikethrough noting the original "PRESERVED VERBATIM" claim was incorrect, and the corrected contract.
- Re-deploy `ticket-checkout-create` v47 (orchestrator owns) AFTER the probe confirms acceptance.
- Add the corrected contract to `orch-0843-stripe-direct-charges-only.mjs` as a new T-G6 sub-check: assert `automatic_tax.liability.type: "account"` is NOT present in `ticket-checkout-create/index.ts`. This is the regression-prevention bar for this specific bug class.

**Severity rationale:** Live-sales path is the entire ORCH-0843 deliverable. With this failure mode in production, the ORCH has not actually delivered the live-sales unblocker — it broke live sales further. The Vercel buyer site and the mingla-business mobile buyer flow both go through `surface: "web"` and `surface: "mobile-web"` respectively, and both fail. Only the `app-mobile` consumer app's `surface: "native"` PaymentSheet works (and that surface is not the operator's primary live-sales channel).

**Note for orchestrator:** the SPEC author (myself, mingla-forensics) made this mistake; the implementor honored the SPEC. SPEC §3.1.3's "Stripe Tax for Platforms accepts both charge shapes" claim was based on a Stripe doc fetch of `https://docs.stripe.com/tax/tax-for-platforms` which is the generic doc; the direct-charge specifics live at `https://docs.stripe.com/tax/connect/direct-charges` which was NOT pulled during investigation. This is an investigation-phase ingest gap, not an implementor error. Future Stripe-API ORCHs should always probe the actual API behavior (the probe edge fn pattern is exactly the right tool — but the probe must mirror the FULL production body, not a stripped-down body).

### P1-001 — `charge.dispute.created` missing from STRIPE_ROUTED_EVENT_TYPES

**Layer:** Webhook router (`supabase/functions/_shared/stripeWebhookRouter.ts`)
**Lines:** 23-54

**What it does:** the routed event set covers payouts, refunds, capabilities, payment intents, and checkout sessions — but NOT disputes. Under Path B platform-liable (`losses_collector: "application"` per `stripeBlueprintClient.ts:135-136`), Mingla is the financial backstop for chargebacks; the absence of dispute routing means Mingla has no early-warning system when a dispute opens.

**Why it matters:** the DEC-154 amendment text says "live sales open immediately on charges-enabled test brands once the operator confirms post-deploy monitoring." Live sales without dispute event handling means Stripe will deduct the platform balance silently on chargeback close (T+~30 days from dispute open) with no Mingla-side audit trail or operator notification. Even on test stubs, this is the wrong default — and at the moment Mingla onboards a real merchant, it becomes a financial risk surface.

**Fix instructions:**
- File a follow-up ORCH-0843-B (or fold into the P0-001 re-deploy if the operator wants atomic): add the following events to `STRIPE_ROUTED_EVENT_TYPES`: `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `account.application.authorized`. Write the corresponding handler in `stripeWebhookRouter.ts` that at minimum (a) inserts into `payment_webhook_events` (already idempotent via existing route), and (b) flags the order with a `disputed` payment_status so the operator dashboard surfaces it.
- Operator-side: add the same event types to the Stripe Dashboard webhook subscription.

**Severity rationale:** P1 because the implementor flagged it as P1 in their own report (Discovery 2) AND the orchestrator's dispatch text flagged this as a P1 candidate for follow-up. Path B platform-liable + zero dispute routing = silent loss accumulation. CONDITIONAL PASS is possible only if the operator explicitly accepts this for the test-stub era + commits a hard date for the follow-up ORCH.

### P1-002 — Live `surface: "web"` and `surface: "mobile-web"` are BROKEN in production right now

**Layer:** Edge function `ticket-checkout-create v46` (currently deployed)

**Symptom:** any real buyer attempting a paid checkout via the Vercel buyer site or the mingla-business mobile app gets `400 StripeInvalidRequestError` with a session row that flips to `status='failed'` and `stripe_application_fee_amount_cents=75`. No Stripe Checkout Session created. No buyer redirect.

**Production impact assessment:** zero real charges exist on the platform per investigation §10 ("stripe_charge_id populated on 0 of 27 orders"). No paying customers are blocked TODAY. But the live-sales open-gate of DEC-154 amendment was meant to be lifted at this CLOSE — that gate must remain CLOSED until P0-001 is fixed.

This is P1 (not P0) on its own because (a) it is the direct symptom of P0-001 + will be fixed with the same one-line edit, and (b) no real revenue is currently being lost (zero live merchants).

**Action:** rollback to v45 (which still has destination-charge shape) is technically possible while P0-001 is being fixed, but a rollback re-introduces the DEC-154 hard-stop condition. A faster path is the P0-001 fix + re-deploy (one-line edit + probe re-run + deploy). Orchestrator's call.

### P2-001 — `orch-0804-stripe-tax-enabled-on-checkout.mjs` gate is now misleading

**Layer:** CI (`.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs`)

**Symptom:** the gate currently asserts `automatic_tax + liability.type: "account" + liability.account` are present in `ticket-checkout-create/index.ts`. With the P0-001 fix (drop `liability` block entirely), the gate will TRIP — which means it will block the fix.

**Fix instructions:** as part of P0-001 fix, update `orch-0804-stripe-tax-enabled-on-checkout.mjs` to allow either (a) the destination-charge contract (legacy, for any non-Connect non-direct-charge usage) OR (b) the direct-charge contract: `automatic_tax: { enabled: true }` without `liability` block. The simplest fix is to relax the gate to only assert `automatic_tax + enabled: true` are present and drop the `liability.account` strict-grep.

### P3-001 — Code-comment inaccuracy about zero-omit threshold

**Layer:** `ticket-checkout-create/index.ts:198`

**What it says:** `// fee is zero (totalCents < ~67)`
**What it should say:** `// fee is zero (totalCents <= 33)` — `Math.round(33×0.015) = Math.round(0.495) = 0`; `Math.round(34×0.015) = Math.round(0.51) = 1`.

Cosmetic; no functional impact.

### P4-001 — Probe pattern is good

The implementor's `orch-0843-stripe-direct-charge-probe/index.ts` is a clean reuse of the ORCH-0839-B probe pattern. Deployed cleanly, runs in under 2s, returns sanitized Stripe response. Should be retained as a reference for future Stripe-API ORCHs that need pre-deploy verification.

### P4-002 — Adversarial gate-trip test discipline

Implementor §9 captured the named-failure output of all three adversarial reverts (T-10/T-11/T-12) with verbatim CLI text. Easy to re-run by tester. Good discipline.

---

## 9. Discoveries for orchestrator

1. **P0-001 fix scope is small** — one line change in `ticket-checkout-create/index.ts` + one test update + one CI gate relaxation (P2-001). Likely under 20 LOC delta. Probe re-run + deploy + retest cycle ≤ 1 hour.

2. **Dispute routing follow-up ORCH** — recommend numbered ORCH-0843-B [Stripe-Connect dispute event routing for Path B platform-liable]. Scope: 6 new event types in `STRIPE_ROUTED_EVENT_TYPES`, corresponding handler, operator-side Stripe Dashboard subscription update. Priority: P1 (file pre-live-sales-lift).

3. **Investigation-phase gap: Stripe doc lookups missed the direct-charges-specific Tax for Platforms page.** The original investigation pulled `https://docs.stripe.com/tax/tax-for-platforms` (generic Tax for Platforms) but did NOT pull `https://docs.stripe.com/tax/connect/direct-charges` (direct-charges specifics). This was the missing context that would have caught P0-001 at SPEC time. **Process improvement** for future Stripe ORCHs: always pull BOTH the generic API page AND the connect-charge-type-specific page when investigating Stripe Connect API contract changes. The probe pattern alone isn't enough — the probe must mirror the FULL production body, otherwise it confirms a partial contract.

4. **The currently-deployed `ticket-checkout-create v46` should be considered "DEPLOYED-BUT-BROKEN."** Operator should be aware that any real buyer attempting `web` or `mobile-web` checkout right now gets 400. No real money is being lost (zero live merchants), but the live-sales gate must stay closed until P0-001 is fixed.

5. **Implementor's discipline was strong end-to-end.** The IMPLEMENTATION report flagged the missing dispute event proactively (Discovery 2), wrote a regression test, drafted the DEC-154 amendment, ran adversarial gate-trip tests, audited cancel-order/index.ts (rightly found no Stripe calls — no code change needed), and properly noted the hardcoded 1.5% fee as a future-ORCH Discovery. The P0-001 failure is not an implementation-discipline issue; it is a SPEC accuracy issue compounded by an investigation-doc-fetch gap. The implementor honored the SPEC.

6. **Probe edge function must be retained until the P0-001 fix is verified live.** Current SPEC §10 lifecycle says "orchestrator deletes the probe at CLOSE." On FAIL, the probe is needed to verify the P0-001 fix before re-deploying `ticket-checkout-create`. Recommend the orchestrator defer probe deletion to the RETEST PASS.

---

## 10. Verdict + recommended next action

**Verdict: FAIL.**

The static layer is clean, the contract is internally consistent, the implementor's discipline was strong, but the production live-fire of two of the three buyer surfaces fails. The ORCH-0843 deliverable — "live sales open" — has not been achieved.

**Recommended next action:** **REWORK** dispatch back to `mingla-implementor` (parity mirror Claude) with the P0-001 fix scope cited above. After implementor returns, the orchestrator should:

1. Re-run probe with the updated body shape (drop `liability` from probe to keep contract identical).
2. Re-deploy `ticket-checkout-create` v47.
3. Hand back to Claude `mingla-forensics` TEST mode (RETEST sub-mode) — re-execute T-01, T-02, T-06, T-07 live against `acct_1TUNLtB5v00XfDTX`.
4. If RETEST PASS → CLOSE per existing post-PASS protocol.

P1-001 (dispute routing) can be deferred to follow-up ORCH-0843-B or rolled into the same RETEST cycle — orchestrator's call based on operator's risk tolerance for the test-stub era.

P2-001 (`orch-0804` gate update) MUST be part of the P0-001 fix hunk; the gate would otherwise block the fix.

---

## 11. Evidence appendix

### 11.1 Probe live response (success — direct-charge body without `automatic_tax`)

```
{
  "ok": true,
  "decision": "direct-charge-accepted",
  "stripeAccount": "acct_1TUNLtB5v00XfDTX",
  "applicationFeeAmountCents": 75,
  "statement_descriptor_suffix": "MINGLA",
  "hostedCheckoutUrl": "https://checkout.stripe.com/c/pay/cs_test_a12wwAmpELJhyHK2l7qlwSBjbLtTIgg2msoEO4GyPG06EC84jQWTPQHvoX#...",
  "raw_stripe_body": {
    "id": "cs_test_a12wwAmpELJhyHK2l7qlwSBjbLtTIgg2msoEO4GyPG06EC84jQWTPQHvoX",
    "amount_total": 5000,
    "currency": "gbp",
    "payment_status": "unpaid",
    "livemode": false,
    "status": "open"
  }
}
```

### 11.2 Live `ticket-checkout-create v46` failure on `web` surface

```
POST → 409
{
  "error": "checkout_session_create_failed",
  "detail": "stripe_checkout_session_create_failed:400:stripe_request_or_account_config:StripeInvalidRequestError"
}
```

### 11.3 Live `ticket-checkout-create v46` success on `native` surface

```
POST → 200
{
  "kind": "requires_payment",
  "checkoutSessionId": "eb319853-c12b-4fc0-a5cc-25f72f4512b3",
  "totalCents": 5000,
  "currency": "USD",
  "clientSecret": "pi_3TXG0AB5v00XfDTX1NYcI4h4_secret_IrEkzRZYpeKZZ7vb0z59U1PZz",
  "paymentIntentId": "pi_3TXG0AB5v00XfDTX1NYcI4h4",
  "publishableKey": "pk_test_..."
}
```

### 11.4 DB row evidence (post-deploy v46)

| Row id | Surface | Status | total_cents | stripe_application_fee_amount_cents | stripe_payment_intent_id | failure_reason |
|---|---|---|---|---|---|---|
| `eb319853-c12b-4fc0-a5cc-25f72f4512b3` | native | processing_payment | 5000 | 75 | `pi_3TXG0AB5v00XfDTX1NYcI4h4` | — |
| `086113c8-1212-41d7-a89e-83223876883d` | web | failed | 5000 | 75 | — | `stripe_checkout_session_create_failed:400:stripe_request_or_account_config:StripeInvalidRequestError` |
| `ef56aa2f-adb8-4c4a-ab5f-106e9d0b2dda` | web | failed | 5000 | 75 | — | (same) |

### 11.5 Adversarial gate-trip output

```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate failed:
  - T-G1 supabase/functions/ticket-checkout-create/index.ts must NOT use transfer_data: (ORCH-0843 direct-charge shape forbids the destination-charge syntax — see DEC-154 amended Path B).
  - T-G4 supabase/functions/ticket-checkout-create/index.ts: contains transfer_data: { destination ... — ORCH-0843 direct-charge shape forbids destination-charge syntax in any charge-creating edge function. ...
EXIT=1
```

After restore:
```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate passed.
EXIT=0
```

---

**End of QA report.**
