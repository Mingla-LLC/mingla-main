# IMPLEMENTATION — ORCH-0843 [Charge-Shape Reconciliation] (Path B — platform-liable, direct charges)

**Status:** completed
**Verification:** partial — local gates (ORCH-0843 strict-grep) + Deno check + Deno regression test pass. Stripe-API live verification (pre-flight probe) gated on operator deploy of the probe edge function. iOS/Android/Web live-fire owned by next agent (Claude `mingla-forensics` TEST mode TARGETED).
**Implementor:** Claude `mingla-implementor` (parity mirror).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-15.

**Authoritative inputs:**
- SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`
- Investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`
- DEC-154 + DEC-155 (`Mingla_Artifacts/DECISION_LOG.md`)
- Predecessor `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md`

---

## 0. EXECUTIVE SUMMARY

ORCH-0843 flips Mingla's ticket payment path from destination charges (`transfer_data.destination`) to direct charges (Stripe-Account header via the third-arg `stripeAccount` request option, plus `application_fee_amount` for Mingla's platform cut, plus `statement_descriptor_prefix: "MINGLA"` on the Checkout Session path). Two edge functions touched (`ticket-checkout-create`, `refund-order`); one audited and confirmed no-op (`cancel-order` is RPC-only — no connected-account-scoped Stripe call). One new CI strict-grep gate added (5 sub-checks T-G1..T-G5). One Deno regression test added (7 assertions). One transitional probe edge function added for SPEC §10.1 G-1 pre-flight verification (orchestrator deletes at CLOSE).

The Mingla platform application fee is **hardcoded at 1.5%** per operator decision G-2 (2026-05-15). Computed in the edge function via `Math.round(totalCents * 0.015)`, conditionally omitted when the rounded amount is zero (`totalCents < 67`). The RPC plumbing path (extending `biz_ticket_checkout_create_session` to return `application_fee_amount_cents`) is intentionally skipped for this iteration — fewer moving parts, no migration, faster ship. **Discovery for orchestrator:** a future ORCH should plumb the fee % through the `brands` table or env config for dynamic adjustment without an edge-function redeploy.

Zero DB migrations. Zero changes to Connect-account provisioning (`stripeBlueprintClient.ts` untouched per Path B). Zero changes to mobile/business/admin client code. Zero changes to webhook handler beyond read-only audit. Atomic edge-function deploy at CLOSE.

---

## 1. PROBE RESULT — DECISION GATE G-1

**Implementation status:** the transitional probe edge function `supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` is written and Deno-check clean (200 LOC). It mirrors the ORCH-0839-B probe pattern.

**Live Stripe response:** NOT YET CAPTURED — operator must deploy via `supabase functions deploy orch-0843-stripe-direct-charge-probe --project-ref gqnoajqerqhnvulmnyvv` and execute:

```bash
curl -X POST \
  https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/orch-0843-stripe-direct-charge-probe \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"stripeAccount":"<test_acct_id>","totalCents":5000,"currency":"gbp"}'
```

Expected `decision: "direct-charge-accepted"` with `hostedCheckoutUrl` populated, `raw_stripe_body.status === "open"`, `raw_stripe_body.livemode === false`. The expected fee for $50 input is 75¢ (1.5%), so `application_fee_amount` is set on the underlying PI. **Operator captures the JSON response and appends it verbatim to this report under §1.A before CLOSE.**

Under Path B the probe is purely a confidence gate — the Stripe direct-charge API is well-documented and the Deno-check-clean edge function exactly matches the documented contract. The probe exists to catch any environment-specific gotcha (e.g., a specific Restricted API Key scope missing) before the atomic flip of the live `ticket-checkout-create`.

---

## 2. PRE-FLIGHT INVENTORY (READ-ONLY)

| Path | Lines | Purpose |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md` | 661 | spec |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md` | full | investigation |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` | 394 | predecessor pattern (probe, CI gate, deploy split) |
| `supabase/functions/ticket-checkout-create/index.ts` | 462 (pre-edit) | edge fn flip target |
| `supabase/functions/refund-order/index.ts` | 357 (pre-edit) | edge fn flip target |
| `supabase/functions/cancel-order/index.ts` | 163 | audit only — no Stripe calls |
| `supabase/functions/_shared/stripe.ts` | 84 | shared factories (untouched) |
| `supabase/functions/_shared/stripeBlueprintClient.ts` | reviewed (NOT touched per Path B) | Connect-account provisioning |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | reviewed (lines 23-54, 76-79) | STRIPE_ROUTED_EVENT_TYPES audit |
| `supabase/migrations/20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` | full | RPC return shape (does NOT include applicationFeeAmountCents) |
| `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` | lines 28-110, 555-568 | `ticket_checkout_sessions.stripe_application_fee_amount_cents` column + finalize copy chain |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | line 8525 | `orders` schema (`event_id` FK) |
| `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql` | line 112-113 | `brands.stripe_connect_id` denormalised cache |
| `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` | 225 | gate pattern to mirror |
| `.github/workflows/strict-grep-mingla-business.yml` | 889 | registry + job wiring |
| `supabase/functions/brand-mingla-tos-accept/index.test.ts` | 33 | Deno source-string test pattern |

---

## 3. OLD → NEW RECEIPTS

### 3.1 — `supabase/functions/ticket-checkout-create/index.ts`

**Before:**
- Line 120: `p_application_fee_amount_cents: 0` (hardwired zero).
- Lines 192-199: comment block describes destination-charge flow ("destination-charge platform model").
- Lines 267-278 (Checkout Session payment_intent_data): `transfer_data: { destination: stripeAccountId }`, no `application_fee_amount`, no `statement_descriptor_prefix`.
- Line 300: request-options only carry `idempotencyKey`, no `stripeAccount`.
- Lines 374-402 (native PaymentIntent): same `transfer_data.destination`, no `application_fee_amount`, no `stripeAccount` in request-options.

**After:**
- After line 190 (`stripeAccountId` resolved): new block computes Mingla's 1.5% application fee via `Math.round(totalCents * 0.015)` and persists it back to `ticket_checkout_sessions.stripe_application_fee_amount_cents` (UPDATE; non-fatal on failure — defensive). Rationale comment block calls out the hardcoded rate as a future-ORCH Discovery.
- Comment block updated: "direct-charge platform model — ORCH-0843" replaces "destination-charge platform model" reference (around line 251).
- Hosted Checkout Session call site (`payment_intent_data: piData`): destination-charge `transfer_data` GONE. `payment_intent_data` built as a mutable `Record<string, unknown>` named `piData` holding `metadata` + `statement_descriptor_prefix: "MINGLA"`; `application_fee_amount` conditionally added when `applicationFeeAmountCents > 0`. Request-options third arg gains `stripeAccount: stripeAccountId` alongside the existing `idempotencyKey`.
- Native PaymentIntent call site: destination-charge `transfer_data` GONE. Body built as a mutable `piCreateBody: Record<string, unknown>` holding `amount`, `currency`, `payment_method_types: ["card"]`, `metadata`; `application_fee_amount` conditionally added. Request-options gain `stripeAccount: stripeAccountId`.

**Why:** SPEC §3.1 — direct-charge shape per DEC-154 amended Path B. Statement descriptor prefix per DEC-154 (1). Application fee plumbing per operator decision G-2 (hardcoded 1.5%, computed in edge fn).

**Lines changed:** ~80 inserted / ~10 modified / 2 removed (the two `transfer_data: { destination: stripeAccountId }` lines).

**Gates verified:** Deno check clean. ORCH-0843 strict-grep gate (5 sub-checks T-G1..T-G5) PASS. Regression test (7 Deno assertions) PASS. ORCH-0837 regression check still applies (`payment_method_types: ["card"]` preserved verbatim on the PI path).

### 3.2 — `supabase/functions/refund-order/index.ts`

**Before:**
- File header (lines 1-21) describes destination-charge refund flow: "Stripe Refunds API on the PLATFORM key with reverse_transfer=true ... No Stripe-Account header."
- Lines 201-220: `stripe.refunds.create` body includes `reverse_transfer: true`; request-options only carry `idempotencyKey`.

**After:**
- File header rewritten to describe direct-charge flow: step 3 adds the connected-account lookup; step 4 documents that `reverse_transfer` is gone but `refund_application_fee` semantics preserved (Stripe still refunds Mingla's 1.5% cut when refund_application_fee:true).
- New block before the Stripe call: JOIN-style lookup `orders → events → brands.stripe_connect_id` via service-role client. Defensive normalisation of the Supabase JS joined shape (handles both single-row-object and single-element-array forms per cardinality of the inferred relationship). Returns 422 `missing_connected_account` if either `brands.stripe_connect_id` or the join target row is missing.
- Stripe call: `reverse_transfer: true` REMOVED. `refund_application_fee: applicationFeeAmountCents > 0` PRESERVED VERBATIM (semantics unchanged — Stripe still refunds the platform's cut when it was taken). Request-options gain `stripeAccount: connectedAccountId` alongside `idempotencyKey`.

**Why:** SPEC §3.2. Direct-charge refunds run against the connected account; `reverse_transfer` is destination-charge syntax and is no longer meaningful.

**Lines changed:** ~50 inserted / ~5 modified / 1 removed.

**Gates verified:** Deno check clean.

### 3.3 — `supabase/functions/cancel-order/index.ts`

**Audit result:** NO Stripe API calls anywhere in the file. The cancel flow is exclusively (a) RPC `biz_cancel_order`, (b) buyer notification enqueue, (c) `dispatchTicketConfirmation` inline dispatch, (d) audit log row. Per SPEC Q-1 (operator-locked: paid orders cannot be cancelled — they must be refunded), there is no Stripe-side cancellation to issue; free orders never hit Stripe in the first place.

**Action taken:** none (no code change). T-G4 of the new CI gate will catch any future drift if a Stripe call is ever added here.

### 3.4 — `.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs` (NEW)

182 lines. Five sub-checks per SPEC §5.1:

- **T-G1:** `supabase/functions/ticket-checkout-create/index.ts` contains NO `transfer_data:` key in active code (comments stripped before testing).
- **T-G2:** every `checkout.sessions.create` AND `paymentIntents.create` call in the file has a `stripeAccount:` within 4000-char lookahead (covers the request-options block).
- **T-G3:** the file references `application_fee_amount` somewhere (conditional zero-omit form is allowed).
- **T-G4:** no `.ts` file under `supabase/functions/` (excluding `_shared/stripeBlueprintClient.ts`) contains `transfer_data: { destination` in active code.
- **T-G5:** the file contains the literal `statement_descriptor_prefix: "MINGLA"` on the Checkout Session path.

Pattern mirrors `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` (same comment-stripping, same path resolution, same exit-1-on-fail style). Excludes `stripeBlueprintClient.ts` per SPEC §3.6.1.

### 3.5 — `.github/workflows/strict-grep-mingla-business.yml`

**Before:** registry comment block ended at ORCH-0839-B; jobs block ended with `orch-0839-b-mingla-business-no-native-stripe` and `regression-test-backfill-warning`.

**After:**
- One new registry comment line added between ORCH-0839-B and the I-REGRESSION-TEST-BACKFILL-WARN entry (line 83).
- One new job `orch-0843-stripe-direct-charges-only` added after `orch-0839-b-mingla-business-no-native-stripe` (and before `regression-test-backfill-warning`), mirroring the surrounding pattern exactly.

YAML validity confirmed via Deno `@std/yaml` parse.

### 3.6 — `supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts` (NEW)

131 lines. Seven Deno tests (source-string assertion pattern, matches `brand-mingla-tos-accept/index.test.ts`):

1. destination-charge syntax (`transfer_data:`) is removed
2. Stripe-Account header is set on BOTH `checkout.sessions.create` AND `paymentIntents.create`
3. `application_fee_amount` plumbing (1.5% rate + Math.round + conditional-omit) is present
4. `statement_descriptor_prefix: "MINGLA"` on Checkout Session
5. Tax for Platforms config preserved (`automatic_tax` + `liability.type: "account"`)
6. Fee math sanity: `Math.round(5000 * 0.015) === 75` (guards against 0.15 / 0.0015 rate typos)
7. `stripe_application_fee_amount_cents` persisted on session row before Stripe call (so refund flow can read it back)

Run: `deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts`. **All 7 tests PASS.**

### 3.7 — `supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` (NEW, transient)

145 lines. One-shot probe edge function mirroring the ORCH-0839-B pattern. Accepts a test connected-account id, builds the direct-charge Checkout Session body identical to the live shape, returns the raw Stripe response sanitised for operator inspection. Lifecycle: deployed for SPEC §10.1 G-1 verification only; orchestrator deletes both the source folder and the deployed function at CLOSE.

---

## 4. SPEC TRACEABILITY (SC-01..SC-12)

| SC | Status | Evidence |
|---|---|---|
| SC-01 Hosted Checkout Session direct charge | PASS by code | Regression test #2 + CI gate T-G1 + T-G2 + T-G5 all green. Live verification deferred to operator probe + tester. |
| SC-02 Native PaymentIntent direct charge | PASS by code | Regression test #2 (covers both call sites) + CI gate T-G1 + T-G2 green. Live verification deferred. |
| SC-03 `application_fee_amount` plumbed through | PASS | Hardcoded 1.5% per operator G-2; computed in edge fn (not RPC). Regression tests #3 + #6 green. CI gate T-G3 green. |
| SC-04 Refund flow direct-charge compatible | PASS by code | Source review: `reverse_transfer` removed from active code; `stripeAccount: connectedAccountId` added to request-options. Deno check clean. Live verification deferred. |
| SC-05 Backward compat: `surface: "web"` | PASS by code | Response shape unchanged (`kind: "requires_web_redirect"`); `success_url`/`cancel_url` derivation byte-identical to pre-pivot. |
| SC-06 Backward compat: `surface: "mobile-web"` | PASS by code | ORCH-0839-B custom-scheme `mingla-business://checkout/return` URLs preserved verbatim. |
| SC-07 Backward compat: `surface: "native"` | PASS by code | Response shape unchanged (`kind: "requires_payment"`); only the Stripe API call body differs internally. |
| SC-08 Statement descriptor renders "MINGLA*" | UNVERIFIED | Code is correct (regression test #4 + CI gate T-G5 green) but only the operator probe + live test purchase can confirm Stripe renders "MINGLA*" on the actual receipt. Operator captures evidence at probe execution time. |
| SC-09 Tax for Platforms preserved | PASS | Regression test #5 verifies `automatic_tax` + `liability.type: "account"` block present unchanged. Per Stripe docs, Tax for Platforms supports direct charges identically. |
| SC-10 Webhook events flow correctly | UNVERIFIED (high confidence) | Webhook handler audit confirms `event.account` routing already correct (`stripeWebhookRouter.ts:76-79`). Required event types audit below in §6. |
| SC-11 CI gate ACTIVE | PASS | New gate `.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs` green locally. Adversarial T-10/T-11/T-12 evidence in §9 below. Workflow job wired into `strict-grep-mingla-business.yml`. |
| SC-12 DEC-154 amended | DRAFTED | Amendment text drafted in §11 below for orchestrator to apply to `Mingla_Artifacts/DECISION_LOG.md` at CLOSE. |

---

## 5. INVARIANT VERIFICATION (4 new + preserved set)

### 5.1 — NEW invariants (PROPOSED → ACTIVE on CLOSE)

| Invariant ID | Verification |
|---|---|
| **I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT** | PASS — CI gate T-G1 + T-G4 (positive run green; adversarial T-10 trips correctly with named failure on both T-G1 AND T-G4). |
| **I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT** | PASS — CI gate T-G3 (positive run green; adversarial T-11 trips correctly with named failure). Regression test #3 + #6 also green. |
| **I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS** | PASS — CI gate T-G2 (positive run green; adversarial T-12 trips correctly, catching BOTH `checkout.sessions.create` AND `paymentIntents.create` call sites). Regression test #2 also green. |
| **I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-PREFIX-MINGLA** | PASS — CI gate T-G5 (positive run green). Regression test #4 also green. Note: this invariant applies to the Checkout Session path only; the PaymentIntent path's "MINGLA*" prefixing is configured at the connected-account level in Stripe Dashboard per SPEC §3.1.2. |

### 5.2 — PRESERVED invariants

| Invariant | Status |
|---|---|
| I-PROPOSED-O (Stripe no DIY WebView wrap) | PRESERVED — unchanged |
| I-PROPOSED-P (`stripe_connect_accounts` canonical) | PRESERVED — refund flow now reads `brands.stripe_connect_id` (the denormalised cache mirrored by the sync trigger from `stripe_connect_accounts`); canonical source still `stripe_connect_accounts` |
| I-PROPOSED-Q (Stripe API version via shared client only) | PRESERVED — `stripeTicketCheckout()` + `stripeTicketRefund()` factories unchanged; API version still pinned in `_shared/stripe.ts:29` |
| I-PROPOSED-R (Idempotency-Key on every Stripe call) | PRESERVED — `idempotencyKey` retained on every flipped call; values unchanged (`ticket_checkout_web:${id}` + `ticket_checkout:${id}` + `ticket_refund:${id}`) |
| I-PROPOSED-S (Audit log on every Stripe edge fn) | PRESERVED — refund-order still emits `writeAudit` |
| I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE (ORCH-0829-B) | PRESERVED — RPC `biz_ticket_checkout_create_session` unchanged |
| I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837) | PRESERVED — `payment_method_types: ["card"]` retained verbatim on PI path |
| I-PROPOSED-STRIPE-CALLBACK-WIRED (ORCH-0837) | PRESERVED — app-mobile path unaffected |
| I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME (ORCH-0839-B) | PRESERVED — `mingla-business://checkout/return` URLs unchanged |
| I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (ORCH-0839-B) | PRESERVED — no client-side changes |
| ORCH-0804 Tax for Platforms gate | PRESERVED — `automatic_tax` block byte-identical |

### 5.3 — REJECTED / DEFERRED (per SPEC §6.3)

- ~~I-PROPOSED-CONNECT-ACCOUNTS-STRIPE-MANAGED-RISK~~ — rejected under Path B (operator decision)
- ~~I-PROPOSED-PLATFORM-LIABLE-RISK-ACCEPTED-UNTIL-08XX~~ — superseded by DEC-154 amendment

---

## 6. WEBHOOK HANDLER AUDIT (read-only — no code changes)

### 6.1 — STRIPE_ROUTED_EVENT_TYPES dump

From `supabase/functions/_shared/stripeWebhookRouter.ts:23-54`:

```
"account.updated",
"account.application.deauthorized",
"account.external_account.created",
"account.external_account.updated",
"account.external_account.deleted",
"capability.updated",
"payout.created",
"payout.paid",
"payout.failed",
"payout.canceled",
"charge.refund.updated",
"charge.refunded",
"refund.created",
"refund.updated",
"person.created",
"person.updated",
"person.deleted",
"application_fee.created",
"application_fee.refunded",
"payment_intent.succeeded",
"payment_intent.payment_failed",
"payment_intent.canceled",
"checkout.session.completed",
```

**Cross-reference vs SPEC §3.4.2 required types:**

| Required | Present? | Notes |
|---|---|---|
| `account.updated` | YES | line 24 |
| `account.application.authorized` | NO | the related `account.application.deauthorized` (line 25) IS present, but `authorized` is absent. Discovery 1 below. |
| `checkout.session.completed` | YES | line 53 |
| `charge.refunded` | YES | line 38 |
| `charge.dispute.created` | **NO — MISSING** | Discovery 2 below. This is non-trivial under Path B platform-liable: disputes are the primary loss-realisation event. |
| `payout.failed` | YES | line 32 |

`event.account` routing: `accountIdForEvent(event)` at line 76-79 reads `event.account` directly; works correctly under direct charges. No code change needed.

### 6.2 — Signature verification

`verifyStripeWebhookSignature` (line 56 of `stripe-webhook/index.ts`) runs on every event; mechanism identical under direct charges. PASS by code.

### 6.3 — Connect-webhook registration (operator-verifiable)

Operator must confirm via Stripe Dashboard → Developers → Webhooks that the endpoint is registered as a **Connect** webhook (not account-restricted) so events with `event.account` set are delivered. This is operator gate G-3 per SPEC §10.2.

---

## 7. CANCEL-ORDER AUDIT RESULT

**Finding:** `supabase/functions/cancel-order/index.ts` contains ZERO Stripe API calls. The flow is exclusively:

1. Validate request + JWT
2. RPC `biz_cancel_order` (DB-only — flips `payment_status='cancelled'`, voids tickets)
3. Buyer notification enqueue + inline dispatch (`dispatchTicketConfirmation`)
4. Audit log row

Paid orders cannot be cancelled (operator-locked Q-1: must be refunded instead, error code `paid_orders_must_be_refunded_not_cancelled`). Free orders never hit Stripe in the first place.

**Action taken:** none. No code changes to `cancel-order/index.ts`. T-G4 of the new CI gate enforces this remains the case (any future Stripe call introduced here without `stripeAccount:` would trip T-G2; any future `transfer_data.destination` would trip T-G4).

---

## 8. APPLICATION FEE FORMULA (hardcoded 1.5%)

Per operator decision G-2 (2026-05-15), the Mingla platform application fee is **hardcoded at 1.5%** of the order's unit amount, computed in the edge function.

**Code path (verbatim):**

```ts
// supabase/functions/ticket-checkout-create/index.ts (post-edit, around line 205)
const MINGLA_APPLICATION_FEE_RATE = 0.015 as const;
const applicationFeeAmountCents = Math.round(
  totalCents * MINGLA_APPLICATION_FEE_RATE,
);
```

**Per-session basis:** `totalCents` is the order's total (RPC output `session.totalCents`), which is `Σ(unit_price_cents × quantity)` across all lines for the session. So a $50 ticket × 2 quantity = $100 order → fee = `Math.round(10000 × 0.015) = 150¢` = $1.50.

**Persistence:** the computed `applicationFeeAmountCents` is written back to `ticket_checkout_sessions.stripe_application_fee_amount_cents` via UPDATE before the Stripe call. The finalize RPC (`biz_ticket_checkout_finalize`, migrations `20260515000013` lines 555-568 + `20260515000016` line 137-150) copies this into `orders.stripe_application_fee_amount_cents`. The refund flow reads it back via `biz_refund_order` and decides whether to pass `refund_application_fee: true` to Stripe.

**Conditional omission:** when `applicationFeeAmountCents === 0` (i.e., `totalCents < 67` — a sub-67¢ purchase, which is below most ticket price floors), the `application_fee_amount` key is omitted from the Stripe call body entirely. Stripe accepts both omitting and passing zero; omitting is the cleaner contract and avoids any future "application_fee_amount must be > 0" edge-case errors.

**Integer-math safety:** `totalCents` is always an integer (DB column is `integer NOT NULL`). `Math.round(integer × 0.015)` is precision-safe within JavaScript's Number type for any realistic order amount (max safe-integer cents ≈ 9.0×10^15).

**Future ORCH (Discovery 1):** the hardcoded 1.5% means changing the rate requires an edge-function redeploy. A future ORCH should plumb the fee percentage through one of:
- (a) a `brands` table column (`brands.platform_fee_bps` → per-brand fee tiers)
- (b) an env variable (`MINGLA_PLATFORM_FEE_BPS` → global, env-driven)
- (c) the `biz_ticket_checkout_create_session` RPC's already-existing `p_application_fee_amount_cents` parameter (computed in the RPC from a config table)

Option (a) gives the most flexibility (different fees per brand based on tier/promo); option (c) gives the cleanest separation (RPC owns pricing config, edge fn just passes through). Either way, the v1 hardcode is a deliberate ship-faster tradeoff.

---

## 9. ADVERSARIAL GATE-TRIP EVIDENCE

All three adversarial revert tests were executed locally against the new CI gate. Each test reintroduces the violation in source, runs `node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs`, captures the failure, then restores the file and re-runs to confirm the gate passes.

### 9.1 — T-10 (re-introduce `transfer_data: { destination: stripeAccountId }`)

```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate failed:
  - T-G1 supabase/functions/ticket-checkout-create/index.ts must NOT use transfer_data: (ORCH-0843 direct-charge shape forbids the destination-charge syntax — see DEC-154 amended Path B).
  - T-G4 supabase/functions/ticket-checkout-create/index.ts: contains transfer_data: { destination ... — ORCH-0843 direct-charge shape forbids destination-charge syntax in any charge-creating edge function. If this file legitimately needs transfer_data for a non-charge use case, add it to T_G4_EXCLUDED_RELATIVE_PATHS with justification.
EXIT=1
```

Gate trips on **two** independent sub-checks (T-G1 string-match + T-G4 directory-walk). Defense in depth confirmed.

### 9.2 — T-11 (remove `application_fee_amount` plumbing)

```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate failed:
  - T-G3 supabase/functions/ticket-checkout-create/index.ts must reference application_fee_amount (ORCH-0843 plumbing). Conditional-omit pattern is allowed; outright absence is forbidden.
EXIT=1
```

### 9.3 — T-12 (remove `stripeAccount` from request-options)

```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate failed:
  - T-G2 supabase/functions/ticket-checkout-create/index.ts call #1 (checkout.sessions.create() is missing stripeAccount: in its request-options (ORCH-0843 direct-charge requires Stripe-Account header on every connected-account-scoped call).
  - T-G2 supabase/functions/ticket-checkout-create/index.ts call #2 (paymentIntents.create() is missing stripeAccount: in its request-options (ORCH-0843 direct-charge requires Stripe-Account header on every connected-account-scoped call).
EXIT=1
```

Gate correctly catches **both** call sites independently (#1 = Checkout Session, #2 = PaymentIntent).

### 9.4 — Post-restore verification

After each adversarial test the file was restored and the gate re-run; in every case the gate returned `ORCH-0843 Stripe direct-charge gate passed.` with EXIT=0. The regression test (Deno) was also re-run after the final restore; all 7 tests PASS.

---

## 10. CACHE SAFETY

- No React Query keys changed (no client-side code touched).
- No Zustand persisted shape changed.
- No DB shape changed (no migration).
- `sessionStorage` payload schema unchanged (mobile-web flow byte-identical to ORCH-0839-B).

The `ticket_checkout_sessions.stripe_application_fee_amount_cents` column already exists (default 0); the new UPDATE writes a non-zero value for non-trivially-small orders. Historical session rows pre-deploy with `stripe_application_fee_amount_cents = 0` remain valid (no data migration needed; they correspond to orders that already paid without a platform fee).

---

## 11. DEC-154 AMENDMENT (drafted for orchestrator to apply at CLOSE)

The following amendment entry must be added at the top of `Mingla_Artifacts/DECISION_LOG.md` by the orchestrator at CLOSE (not committed by this implementor per hard-guard instructions):

```
> **2026-05-15 - DEC-154 AMENDMENT logged - ORCH-0843 [Charge-Shape Reconciliation] CLOSE — Path B selected. DEC-154 (1) PRESERVED; DEC-154 (5) AMENDED to platform-managed risk.**
> Amendment: ORCH-0843 amends DEC-154 (5) from "Stripe-managed loss liability" to "Platform-managed loss liability." Funds flow per DEC-154 (1) remains direct charges on the connected account with `application_fee_amount` for Mingla's platform cut (UNCHANGED from DEC-154 (1); this ORCH delivers the implementation). Risk/loss liability per DEC-154 (5) is now **platform-managed**: Mingla (the platform / `losses_collector: "application"`) absorbs negative-balance losses on connected accounts, including fraud-driven losses, chargebacks on the 120-day post-event tail, and event-cancellation-driven mass-refund balance gaps. Mingla is the financial backstop. This REVERSES DEC-154 (5)'s original "Stripe-managed risk" stance. Rationale: at the time of the amendment, Mingla had 9 sandbox-test connected accounts (all `losses_collector: "application"` per `stripeBlueprintClient.ts:135-136`) and 0 real charges (`stripe_charge_id` populated on 0 of 27 `orders` rows). Re-onboarding the 9 test stubs to claim Stripe-managed-risk shield is busy work that delayed the live-sales unblocker. The 5 charges-enabled test brands are stubs, not real merchants. Operator accepts platform-liable chargeback risk as the conscious tradeoff to ship faster. This amendment locks Mingla into platform-liable for the existing 9 accounts AND for all new accounts provisioned through the unchanged `stripeBlueprintClient.ts` until a future ORCH (TBD) re-evaluates. Sticky-controller-properties per DEC-154 (6): re-evaluation will require detach + re-onboard of all platform-liable accounts under new controller shape — a campaign that the operator chose NOT to run today on the basis of test-stub volume. DEC-154 (2) (embedded onboarding) and DEC-154 (3) (embedded account management) become OPTIONAL under Path B — brand-continuity benefits still apply but are no longer load-bearing for the risk model; queued as deferred-priority future ORCHs, not blockers for live sales. DEC-154 (1) statement-descriptor-prefix `"MINGLA"` IS shipped by this ORCH (CI gate T-G5; live verification at probe gate G-4). DEC-154 (4) Stripe-owns-pricing IS unchanged (the application_fee_amount mechanism is Stripe-managed; Mingla just specifies the cents value). DEC-154 (7) hard-stop on live sales IS LIFTED by this ORCH's CLOSE; live sales open immediately on charges-enabled test brands once the operator confirms post-deploy monitoring (Phase 10.4 of the SPEC). DEC-154 (9) security baselines (a-d) remain enforced: (a) restricted API keys still queued in a separate sub-ORCH (Discovery 4 below); (b) webhook signature verification VERIFIED (`stripe-webhook/index.ts:56` uses `verifyStripeWebhookSignature` on every event); (c) event subscription set verified against Stripe Dashboard at operator gate G-3 (Discoveries 2 + 3 below flag a missing `charge.dispute.created` subscription that the operator should add); (d) creator-facing disclosure copy unchanged (no UI change in this ORCH). Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`. Cross-references: SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`; investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`; new invariants I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT + I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT + I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS + I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-PREFIX-MINGLA. Operator sign-off: chat instructions Path B selection + acceptance of platform-liable risk 2026-05-15. Operator G-2 decision: 1.5% application fee hardcoded in edge function (Discovery 1 — future ORCH should plumb through env/brands config for dynamic adjustment).
```

---

## 12. PARITY CHECK

| Surface | Affected | Outcome |
|---|---|---|
| `surface: "web"` (Vercel buyer flow) | INTERNALLY YES (Stripe call body); EXTERNALLY NO | Response shape unchanged. Buyer experience: now sees "MINGLA*" prefix on receipt + card statement (was just the creator's brand name). |
| `surface: "mobile-web"` (mingla-business iOS + Android via in-app browser) | Same as web | Same. |
| `surface: "native"` (app-mobile consumer PaymentSheet) | INTERNALLY YES (Stripe call body); EXTERNALLY NO | Response shape unchanged. Buyer experience: depends on connected account's Dashboard-level statement-descriptor-prefix config (operator action); the PI body does NOT set a per-call prefix. |
| Admin dashboard | NO | No Stripe surface in admin. |
| Solo vs collab | NO | Anon buyer flow — no fork. |
| Free orders (`totalCents === 0`) | NO | Free path short-circuits before any Stripe call (line 151). |

---

## 13. REGRESSION SURFACE (for TEST mode)

1. **Pre-flight probe** — operator deploys + executes per §1. Must return `decision: "direct-charge-accepted"` and `raw_stripe_body.status: "open"`. If Stripe rejects (e.g., specific RAK scope missing) the live cutover is BLOCKED — escalate back to forensics SPEC mode for the fix.
2. **Live $0.50 test purchase via `surface: "web"`** — verify on Stripe Dashboard: charge object lives on the connected account (`Stripe-Account: acct_*` header recorded), `application_fee_amount` = 1¢ (Math.round(50 × 0.015) = 1), `transfer_data` absent, statement descriptor renders `MINGLA* <creator name>` on the buyer's receipt email.
3. **Live $0.50 test purchase via `surface: "mobile-web"`** — same dashboard checks; verify the in-app browser closes correctly via `mingla-business://checkout/return?status=success`.
4. **Live $0.50 test refund via `refund-order`** — verify Stripe Dashboard shows the refund issued against the connected account; `orders.payment_status` advances to `refunded`; `orders.stripe_application_fee_amount_cents` matches the 1¢ that was charged; the refund (with `refund_application_fee: true` since fee > 0) also refunds the 1¢ platform cut.
5. **Webhook event arrival** — verify on Stripe Dashboard → Webhooks that `checkout.session.completed` + `charge.refunded` events arrived at the platform endpoint with `event.account = <acct_*>` set, and that `payment_webhook_events` table received corresponding rows.

---

## 14. DISCOVERIES FOR ORCHESTRATOR

1. **Hardcoded 1.5% application fee — future ORCH should plumb fee % through env/brands config.** The current implementation ties Mingla to a redeploy whenever the platform fee changes. A clean refactor uses either `brands.platform_fee_bps` (per-brand override), `MINGLA_PLATFORM_FEE_BPS` env var (global), or the RPC's existing `p_application_fee_amount_cents` parameter wired to a config table. Priority: P2 (no immediate impact at $0 fee era; matters once Mingla goes live with a real fee).

2. **`charge.dispute.created` is missing from STRIPE_ROUTED_EVENT_TYPES.** Per SPEC §3.4.2 this is a DEC-154 (9)(c) required event. Under Path B platform-liable, disputes are THE primary loss-realisation event Mingla must react to. Without it routed, disputed-charge state changes are silently ignored. Priority: P1 (Path B's primary risk-monitoring surface). Recommendation: file a small follow-up ORCH to add `charge.dispute.created`, `charge.dispute.closed`, and `charge.dispute.funds_withdrawn` / `funds_reinstated` to the router's array + write the corresponding handlers.

3. **`account.application.authorized` is missing from STRIPE_ROUTED_EVENT_TYPES.** Less critical than #2 — the `account.updated` event captures most of what we'd want from `authorized`. Recommendation: include in the follow-up ORCH for completeness.

4. **Restricted API keys (DEC-154 (9)(a)) per edge function — still deferred.** Mentioned in SPEC §"Non-goals (E)" and DEC-154 (9)(a). Orthogonal to charge shape; separate sub-ORCH.

5. **Embedded onboarding (DEC-154 (2)) and embedded account management (DEC-154 (3)) — deferred under Path B.** Per SPEC §"Non-goals (C, D)". Queue as deferred-priority.

6. **`p_application_fee_amount_cents: 0` is still hardcoded at the RPC call site** (line 120 of `ticket-checkout-create/index.ts`). I left this unchanged to avoid an RPC migration; the actual fee is computed in the edge fn and persisted via a separate UPDATE to the same column. Cleaner long-term: pass the computed fee into the RPC at call time AND remove the separate UPDATE. Out of ORCH-0843 scope.

7. **Probe edge function deletion.** `supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` is transient. Orchestrator must delete (a) the local source folder and (b) the deployed function at CLOSE, mirroring DEC-155 (4) cleanup pattern.

8. **`PaymentElementStub.tsx` in mingla-business** — pre-existing stub from Cycle 8 that never wired up; flagged as Discovery 5 by ORCH-0839-B. Still outstanding. Not blocking; queue for cleanup.

---

## 15. CONSTITUTIONAL COMPLIANCE

| Principle | Outcome |
|---|---|
| #1 No dead taps | PRESERVED — buyer flow unchanged |
| #2 One owner per truth | PRESERVED — order/session state still server-owned; the edge fn writes the fee back to its single canonical column |
| #3 No silent failures | PRESERVED — every Stripe failure surfaces through existing `classifyStripe*Failure` + 502 response; fee persistence failure is logged but non-fatal (intentional — refund flow degrade behavior documented) |
| #6 Logout clears everything | PRESERVED — anonymous buyer flow |
| #8 Subtract before adding | OBEYED — `transfer_data` / `reverse_transfer` REMOVED in same hunk that adds the direct-charge shape |
| #11 One auth instance | PRESERVED — no auth changes |

---

## 16. TRANSITION ITEMS

- None. The hardcoded 1.5% is not a `[TRANSITIONAL]` per the canonical macro (no defined exit condition; just a future-ORCH Discovery). The historical destination-charge orders in `orders` are not transition items either — they sit as final-state records that can't be refunded against the new code path, which is the accepted SPEC §3.2.3 one-way cutover.

---

## 17. VERIFICATION MATRIX

| Criterion | Status | Reason |
|---|---|---|
| Pre-flight read of SPEC + grounding docs + every modified file | PASS | Inventory in §2 |
| Probe edge function written + Deno-check clean | PASS | `orch-0843-stripe-direct-charge-probe/index.ts` deno-check exit 0 |
| Probe live Stripe response captured | UNVERIFIED | Operator deploy + execute required (operator gate G-1 per §1) |
| `ticket-checkout-create` Checkout Session direct-charge flip | PASS by code | Regression test #2, CI gate T-G1+T-G2+T-G5 |
| `ticket-checkout-create` PaymentIntent direct-charge flip | PASS by code | Regression test #2, CI gate T-G1+T-G2 |
| Application fee plumbing (1.5% hardcoded) | PASS | Regression tests #3, #6; CI gate T-G3 |
| Statement descriptor prefix "MINGLA" | PASS by code; UNVERIFIED live | Regression test #4, CI gate T-G5; needs live receipt inspection |
| `refund-order` direct-charge refund flip | PASS by code | Deno check clean; no `reverse_transfer:` in active code |
| `cancel-order` audit | PASS | No Stripe calls — no code change needed |
| Webhook handler audit | PARTIAL | Routing logic PASS by code; required event subscription set INCOMPLETE (Discoveries 2 + 3) |
| New CI gate file + 5 sub-checks | PASS | Local gate green; adversarial T-10/T-11/T-12 all trip correctly |
| CI gate workflow registration | PASS | YAML validity confirmed |
| Regression test (7 Deno assertions) | PASS | `deno test` returns 7/7 ok |
| Deno check on 3 modified/new edge fns | PASS | exit 0 on all three |
| Adversarial revert tests T-10/T-11/T-12 | PASS | All three trip the gate with the expected named failures (§9) |
| DEC-154 amendment drafted | PASS | §11 — orchestrator commits at CLOSE |
| Edge-function deploy | DEFERRED | Orchestrator-owned per `feedback_orchestrator_deploys_edge_functions.md` |
| iOS/Android/Web live-fire | DEFERRED | Owned by Claude `mingla-forensics` TEST mode |

---

## 18. CONFIDENCE LEVEL

**HIGH on source-code correctness.** All static gates green; Deno check clean across all 3 edge-fn files; regression test green; adversarial gate-trip tests all behave correctly. Pattern reuses proven primitives from ORCH-0839-B (probe pattern, CI gate structure, comment-stripping logic).

**MEDIUM on live behavior.** Three operator-gated verifications remain:
- The pre-flight probe must confirm Stripe accepts the new body shape against a real test connected account.
- The live "MINGLA*" statement descriptor render requires an actual test purchase + receipt inspection.
- The webhook subscription gap (`charge.dispute.created` missing) is a real Path B platform-liable risk surface that should be closed by a follow-up ORCH before Mingla takes meaningful real-charge volume.

Status: **implemented, partially verified** — all statically-verifiable layers ARE verified; live-fire deferred to operator probe + tester TARGETED mode.
