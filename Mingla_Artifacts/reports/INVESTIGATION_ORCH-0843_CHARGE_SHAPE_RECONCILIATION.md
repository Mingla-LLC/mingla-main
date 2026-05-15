# INVESTIGATION — ORCH-0843 Charge-Shape Reconciliation against Locked Stripe-Managed-Risk Model

**Mode:** mingla-forensics (INVESTIGATE)
**Status:** PRODUCED — actionable; recommend SPEC dispatch with **operator-decision gate first**
**Confidence:** High (proven across docs + schema + code + DB data + Stripe docs)
**Author:** Claude `mingla-forensics`, 2026-05-15
**Parent decisions:** DEC-154 (locked Stripe Connect activation), DEC-155 (ORCH-0839-B CLOSE)
**Predecessor:** ORCH-0839-B [Stripe Hosted Checkout pivot for mingla-business mobile] — landed but does NOT change charge shape

---

## TL;DR (read before anything else)

DEC-154 says Mingla's live Stripe Connect platform is locked on **Stripe-managed loss liability** (controller-properties asserted as `controller.losses.payments = "stripe"`), and that `transfer_data.destination` (destination charges) is therefore incompatible.

The Stripe Managed Risk doc (`https://docs.stripe.com/connect/risk-management/managed-risk`) **confirms** DEC-154's compatibility claim: under Managed Risk, **"You must use direct charges"** (verbatim). Destination charges are forbidden.

But: **independent verification of the code that actually provisions Mingla's connected accounts contradicts DEC-154's premise.** `supabase/functions/_shared/stripeBlueprintClient.ts` lines 134–136 send `defaults.responsibilities.losses_collector = "application"` + `fees_collector = "application"` on every `POST /v2/core/accounts` call. Per Stripe's Accounts v2 API docs, that value means **"the platform (Mingla) is responsible for negative balances on the Account"** — i.e., **platform-managed risk, NOT Stripe-managed risk**.

There are **9 existing connected accounts** in `stripe_connect_accounts` (5 with `charges_enabled = true`, 0 detached). All were provisioned under platform-liable controller-properties. Per DEC-154 (6), controller properties are **sticky** after first connected-account creation — you cannot flip an existing account's loss-liability controller without re-onboarding it.

This produces a three-way contradiction that must be resolved by the operator before SPEC:

| Layer | What it says |
|---|---|
| **DEC-154 (operator decision 2026-05-15)** | "Platform activated with Stripe-managed loss liability (Stripe-managed risk). Hard stop on live sales until charge shape flips to direct charges." |
| **Stripe Connect activation dashboard** | Per DEC-154's verbatim summary, operator selected "Risk and loss liability = Stripe-managed" at the platform level. |
| **`stripeBlueprintClient.ts` code (live, deployed)** | Every Connect account provisioned with `losses_collector = "application"` (platform-liable). 9 accounts already exist under this shape. |

**The 9 existing accounts cannot run direct charges under Managed Risk.** Stripe's Managed Risk doc says onboarding must use Stripe-hosted onboarding OR embedded onboarding (Mingla uses Stripe-hosted Account Link — OK on this axis), but **the loss-liability controller of the existing accounts is platform-managed** because `losses_collector: "application"` was sent at create time. Flipping to direct charges with `Stripe-Account: acct_*` against these accounts will work as a Stripe API call (direct charges are valid on any Connect account), but it will NOT give Mingla the Stripe-managed-risk benefits DEC-154 was meant to lock in. Mingla will still be liable for chargebacks/negative balances on every existing account.

**This is the operator-decision-required STOP** the dispatch named. Two paths:

- **Path A: Honor DEC-154 verbatim.** All 9 brands re-onboard under a NEW controller-properties shape (`losses_collector = "stripe"`, `fees_collector = "stripe"`, `controller.stripe_dashboard.type = "none"`, embedded components). New `acct_*` IDs. Old accounts soft-detached. Charge shape flips to direct + application_fee_amount + Stripe-Account header. Higher implementor cost (embedded components wiring per DEC-154 (2)+(3); re-onboarding emails to 9 brands; brand-side downtime).
- **Path B: Amend DEC-154 to match current code shape.** Keep platform-liable controller-properties (matches what's already provisioned). Keep destination charges as-is, OR optionally flip to direct charges purely for buyer-statement-descriptor / brand-continuity reasons (direct charges work fine under platform-liable too, just without the Stripe-absorbs-losses safety net). Lower implementor cost (no re-onboarding); higher business risk (Mingla on the hook for negative balances + fraud).

The orchestrator needs operator input on this before SPEC. No SPEC can be written that satisfies DEC-154 verbatim without re-onboarding all 9 brands. The investigation is otherwise actionable — every charge-shape touchpoint is mapped, the flip is small (3 files), and rollout is hot-flippable once the operator chooses a path.

---

## Phase 0 ingest — what was read

1. `Mingla_Artifacts/DECISION_LOG.md` DEC-154 + DEC-155 (full text, top of file)
2. `Mingla_Artifacts/WORLD_MAP.md` ORCH-0841 + ORCH-0839-B + ORCH-0840 closing/registration banners
3. `supabase/functions/ticket-checkout-create/index.ts` (full, 461 lines)
4. `supabase/functions/brand-stripe-onboard/index.ts` (full, 754 lines)
5. `supabase/functions/stripe-webhook/index.ts` (full, 168 lines)
6. `supabase/functions/refund-order/index.ts` (full, 357 lines)
7. `supabase/functions/_shared/stripeBlueprintClient.ts` (the v2/core/accounts client — full)
8. `supabase/functions/_shared/stripeWebhookRouter.ts` (event-routing scope + STRIPE_ROUTED_EVENT_TYPES, partial top 80 lines + grep verification)
9. `supabase/functions/_shared/stripe.ts` (API version pin: `STRIPE_API_VERSION = "2026-04-22.dahlia"`)
10. Migration chain for `stripe_connect_accounts`:
    - `20260508000000_b2a_stripe_connect_onboarding.sql` (initial)
    - `20260511000001_b2a_v3_country_support.sql`, `_000002_external_accounts.sql`, `_000004_gdpr_erasure.sql`, `_000006_account_type_rename.sql` (renamed `account_type` → `controller_dashboard_type` per D-V3-14)
    - `20260515000007_orch_0764b_stripe_status_derivation_parity.sql` (LATEST touching this table)
11. Migration chain for `biz_ticket_checkout_create_session` RPC:
    - `20260515000013_orch_0777_ticket_checkout_core.sql` (initial)
    - `20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` (LATEST — `p_application_fee_amount_cents` param already wired through to `ticket_checkout_sessions` row)
12. Stripe doc verification via WebFetch:
    - `https://docs.stripe.com/connect/charges` (charge type overview)
    - `https://docs.stripe.com/connect/destination-charges` (destination charges API shape; does NOT mention loss-liability compatibility)
    - `https://docs.stripe.com/connect/direct-charges` (direct charges + Stripe-Account header + application_fee_amount semantics)
    - `https://docs.stripe.com/connect/risk-management/managed-risk` — **AUTHORITATIVE: "You must use direct charges" + onboarding via Stripe-hosted OR embedded + connected accounts need access to Stripe Dashboard OR embedded Notification Banner + Account Management components**
    - `https://docs.stripe.com/api/v2/core/accounts/create` — `defaults.responsibilities.losses_collector` values: `"application"` = platform liable, `"stripe"` = Stripe liable
13. Live DB state via `mcp__supabase__execute_sql` (READ-ONLY):
    - 9 rows in `stripe_connect_accounts`, all `controller_dashboard_type = "express"`, 0 detached
    - 5 of 9 with `charges_enabled = true` + `payouts_enabled = true` (production-active brands)
    - Countries: 5×US, 2×GB, 1×BE, 1×CH (mixed jurisdictions — operator must validate Managed Risk availability per-country if Path A)
    - 27 rows in `orders`, 12 with `stripe_payment_intent_id` set, 0 with `stripe_charge_id` populated (test data only — no live money yet)

Migration chain rule applied: latest definition of every Connect-related table + function read; no stale-schema reasoning.

---

## Symptom Summary

**Reported symptom:** DEC-154 imposes a hard stop on live ticket sales because `supabase/functions/ticket-checkout-create/index.ts` uses `transfer_data: { destination: stripeAccountId }` (destination charges) at lines 268 (web/mobile-web hosted Checkout Session) and 394 (native PaymentIntent path), and DEC-154 asserts this is incompatible with the locked Stripe-managed-risk model.

**Expected behavior per DEC-154:** Direct charges via `Stripe-Account: acct_*` header + `application_fee_amount` for Mingla's platform cut. Buyer's statement descriptor shows the creator's business name. Refunds debit the connected account's balance first; Stripe absorbs any resulting negative balance.

**Actual behavior in code today:** Platform makes the API call (no `Stripe-Account` header), `transfer_data.destination` automatically transfers full minus Stripe fees to the connected account, no `application_fee_amount` is set (so Mingla collects $0 platform revenue on every sale — separate issue), statement descriptor shows MINGLA's name (platform), Mingla bears chargeback/dispute risk because the charge object lives on the platform.

**Reproduction:** Source code reading + verified live with the deployed `ticket-checkout-create` v43 (per DEC-155).

**When it started:** This shape has been in place since ORCH-0790 (Stripe Checkout Sessions for web buyer) and ORCH-0777 (initial ticket-checkout). ORCH-0837 (card-only PI) modified payment_method_types but kept `transfer_data.destination`. ORCH-0839-B (this week) widened surface discriminator but explicitly did NOT change charge shape.

---

## Investigation Manifest

| # | File | Layer | Why read |
|---|---|---|---|
| 1 | `Mingla_Artifacts/DECISION_LOG.md` DEC-154 | Docs | Locked controller-properties + hard-stop conditions |
| 2 | `Mingla_Artifacts/DECISION_LOG.md` DEC-155 | Docs | ORCH-0839-B CLOSE scope, confirm charge shape unchanged |
| 3 | `Mingla_Artifacts/WORLD_MAP.md` banners | Docs | ORCH-0841 sub-(a) queued; hard-stop language |
| 4 | `supabase/functions/ticket-checkout-create/index.ts` | Edge fn | The offending function |
| 5 | `supabase/functions/brand-stripe-onboard/index.ts` | Edge fn | Connect account create shape |
| 6 | `supabase/functions/_shared/stripeBlueprintClient.ts` | Shared | Actual v2/core/accounts body |
| 7 | `supabase/functions/stripe-webhook/index.ts` | Edge fn | Webhook verification + event-row write |
| 8 | `supabase/functions/_shared/stripeWebhookRouter.ts` | Shared | Routed event types; account-scope handling |
| 9 | `supabase/functions/refund-order/index.ts` | Edge fn | Refund flow — destination vs direct semantics |
| 10 | `supabase/functions/_shared/stripe.ts` | Shared | API version pin + client factory |
| 11 | Migrations touching `stripe_connect_accounts` | Schema | Storage shape; no `losses_collector` column |
| 12 | Migrations defining `biz_ticket_checkout_create_session` | Schema | `p_application_fee_amount_cents` already wired |
| 13 | Stripe Managed Risk doc | External | Authoritative compatibility statement |
| 14 | Stripe Accounts v2 create doc | External | `defaults.responsibilities.losses_collector` enum values |
| 15 | DB rows: `stripe_connect_accounts`, `orders` | Data | Existing-account count + production state |

---

## Findings (classified)

### 🔴 Root Cause — RC-1: `transfer_data.destination` violates DEC-154's locked charge-shape contract

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/ticket-checkout-create/index.ts:268` (hosted Checkout Session, `payment_intent_data.transfer_data.destination`) AND `supabase/functions/ticket-checkout-create/index.ts:394` (native PaymentIntent path, top-level `transfer_data.destination`) |
| **Exact code** | Line 268: `transfer_data: { destination: stripeAccountId },` inside `payment_intent_data` block of `stripe.checkout.sessions.create(...)`. Line 394: `transfer_data: { destination: stripeAccountId },` inside `stripe.paymentIntents.create(...)`. Both calls run against the **platform** Stripe key (no `Stripe-Account` request option). |
| **What it does** | Creates a destination charge: platform account owns the Charge / PaymentIntent object, Stripe atomically transfers (`gross − Stripe fee`) to the connected account's pending balance. Platform bears chargeback/dispute risk and is the merchant of record. |
| **What it should do per DEC-154** | Create a direct charge: pass `{ stripeAccount: connectedAcctId }` as the third-arg request-options to `stripe.checkout.sessions.create()` (and the same on `paymentIntents.create()` for native), set `payment_intent_data.application_fee_amount = <mingla_platform_fee_cents>` on the Checkout Session (or top-level `application_fee_amount` on PaymentIntent), drop `transfer_data` entirely. Charge object then lives on the connected account; buyer sees creator's statement descriptor; Stripe is merchant of record; under Stripe-managed-risk Stripe absorbs negative balances. |
| **Causal chain** | (1) DEC-154 locks Mingla on Stripe-managed loss liability (operator activation dashboard 2026-05-15). (2) Stripe Managed Risk doc requires direct charges. (3) Current code uses destination charges. (4) Stripe will not invoke Managed Risk protections on destination-charge transactions. (5) Live sale on current code = Mingla on the hook for chargebacks despite operator believing Stripe absorbs them → operator-stated hard stop. |
| **Verification** | (a) `grep -rn "transfer_data" supabase/functions/` returns exactly two hits, both in `ticket-checkout-create/index.ts:268,394`. (b) Stripe Managed Risk doc verbatim: "You must use direct charges." (c) Deployed edge fn version v43 per DEC-155 — current production behavior. |

**Classification:** 🔴 Root Cause. **Confidence:** High (proven).

### 🔴 Root Cause — RC-2: Connect accounts provisioned with platform-liable controller-properties contradict DEC-154's premise

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/_shared/stripeBlueprintClient.ts:134-136` |
| **Exact code** | ```defaults: { responsibilities: { losses_collector: "application", fees_collector: "application", }, }, dashboard: "express",``` (inside the `POST /v2/core/accounts` body builder in `createRecipientAccount(...)`) |
| **What it does** | Tells Stripe: "Mingla (the platform / application) is responsible for negative balances on this Account, and Mingla collects fees." Plus `dashboard: "express"` (creator gets Stripe-hosted Express Dashboard, not embedded). This provisions every new connected account as **platform-liable**. |
| **What it should do per DEC-154** | Per DEC-154 (5): Stripe-managed loss liability ⇒ `losses_collector: "stripe"`. Per DEC-154 (3): embedded account management ⇒ `dashboard` likely should be `"none"` (or its v2 equivalent for embedded). Per DEC-154 (2): embedded onboarding (currently `brand-stripe-onboard/index.ts` redirects to hosted Account Link — separate sub-ORCH (b) in DEC-154's queue). |
| **Causal chain** | (1) Every brand that onboarded since `brand-stripe-onboard` shipped was provisioned with `losses_collector = "application"`. (2) Controller-properties are **sticky** after first creation (DEC-154 (6) verbatim). (3) Even if we flip `ticket-checkout-create` to direct charges + `Stripe-Account: acct_*` header, the existing 9 accounts are still platform-liable — Stripe will NOT activate Managed Risk on them. (4) Live sales on these accounts under direct charges = Mingla still liable for chargebacks despite DEC-154 intent. (5) The only way to honor DEC-154 verbatim is to detach + re-onboard all 9 brands under new controller-properties (`losses_collector: "stripe"`, `dashboard: "none"` + embedded components). |
| **Verification** | (a) `grep -rn "losses_collector\|fees_collector" supabase/functions/` returns exactly the two lines in `stripeBlueprintClient.ts:135-136` plus their unit-test snapshot. (b) Stripe Accounts v2 docs (`/api/v2/core/accounts/create`) confirm `losses_collector` enum: `"application"` = platform liable, `"stripe"` = Stripe liable. (c) Live DB query: 9 rows in `stripe_connect_accounts`, all `controller_dashboard_type = "express"` (mirrors the `dashboard: "express"` create-time value), 0 detached. (d) DEC-154 (6) explicitly acknowledges stickiness and calls out re-onboarding as the migration path. |

**Classification:** 🔴 Root Cause. **Confidence:** High (proven via code + DB data + Stripe docs).

**This is the OPERATOR-DECISION-REQUIRED finding.** Per the dispatch's hard guard: "If you discover that existing connected accounts have controller-properties incompatible with direct charges (i.e., creator re-onboarding required), STOP and report — that fundamentally changes the SPEC scope and requires operator decision."

Slight correction to that framing: existing accounts CAN accept direct charges as a Stripe API call (any Connect account can — direct charges only need the `Stripe-Account` header). The incompatibility is with **Managed Risk benefits** (Stripe absorbing losses). The functional flip can ship without re-onboarding; only the loss-liability promise of DEC-154 requires it.

### 🟠 Contributing Factor — CF-1: `application_fee_amount` is hardwired to 0 across the entire codebase

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/ticket-checkout-create/index.ts:120` |
| **Exact code** | `p_application_fee_amount_cents: 0,` (param to `biz_ticket_checkout_create_session` RPC) |
| **What it does** | Mingla collects $0 platform revenue on every ticket sale today. The full ticket amount (minus Stripe processing fees) is transferred to the connected account. Mingla's revenue model is intentionally deferred until launch but the wiring exists end-to-end at the DB + RPC layer. |
| **What it should do** | Once live sales launch, `application_fee_amount` should be a function of ticket revenue (e.g., Mingla's % platform fee). DB layer (`biz_ticket_checkout_create_session` per migration `20260605000002`) already accepts the param and stores it in `ticket_checkout_sessions.application_fee_amount_cents`. Edge fn passes 0 by intent — the flip to direct charges is the natural moment to wire a real fee. |
| **Causal chain** | Not causing the live-sales hard stop. But: once we flip to direct charges, `application_fee_amount: 0` is technically valid (Mingla just collects nothing) — however, Stripe rejects direct-charge calls where `application_fee_amount` is set but equal to 0 in some contexts (see edge cases in Stripe docs). Need to confirm in SPEC whether to (a) omit `application_fee_amount` entirely when 0, or (b) require non-zero (i.e., set the real Mingla fee % now). |

**Classification:** 🟠 Contributing Factor (forces SPEC to make a pricing decision). **Confidence:** High.

### 🟠 Contributing Factor — CF-2: `automatic_tax.liability` already names the connected account as merchant of record

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/ticket-checkout-create/index.ts:279-285` |
| **Exact code** | `automatic_tax: { enabled: true, liability: { type: "account", account: stripeAccountId, } },` |
| **What it does** | Already designates the connected account (brand) as the merchant of record for tax purposes, even on destination charges. This is the Tax for Platforms model. |
| **Why it matters for the flip** | Under direct charges + `Stripe-Account` header, this `automatic_tax.liability` block stays valid — Stripe Tax for Platforms supports both shapes (`type: "self"` for platform MoR or `type: "account"` for connected-account MoR). The flip preserves tax compliance. The comment at line 251 referencing `https://docs.stripe.com/tax/tax-for-platforms (destination-charge platform model)` is misleading — Tax for Platforms is documented for both charge shapes; the comment hardcodes the destination-charge framing and should be updated in SPEC. |

**Classification:** 🟠 Contributing Factor. **Confidence:** High.

### 🟡 Hidden Flaw — HF-1: `refund-order/index.ts` uses `reverse_transfer: true` which is destination-charge syntax

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/refund-order/index.ts:211-212` |
| **Exact code** | `reverse_transfer: true, refund_application_fee: applicationFeeAmountCents > 0,` (inside `stripe.refunds.create(...)` on the platform key, no `Stripe-Account` header) |
| **What it does** | On destination charges, `reverse_transfer: true` tells Stripe to debit the connected account's balance to fund the refund; `refund_application_fee: true` reverses the platform fee. This is the correct destination-charge refund shape. |
| **What it should do post-flip** | On direct charges, the Refund must be created **on the connected account** via `stripe.refunds.create({...}, { stripeAccount: connectedAcctId })`. `reverse_transfer` is meaningless (no transfer to reverse — the charge already lives on the connected account). `refund_application_fee: true` still applies (refunds the platform's `application_fee_amount` cut). |
| **Causal chain** | Not causing today's symptom (no refunds on test data). Will cause silent failure on the first refund attempt against a direct-charge ticket sale. SPEC must include refund-flow update. |
| **Verification** | grep confirms `reverse_transfer` appears only here. The comment block on lines 1-21 explicitly says "PLATFORM key with reverse_transfer=true... No Stripe-Account header" — this is the destination-charge contract verbatim. |

**Classification:** 🟡 Hidden Flaw. **Confidence:** High.

### 🟡 Hidden Flaw — HF-2: `brand-stripe-onboard/index.ts` uses hosted Stripe Account Link, not embedded components

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/brand-stripe-onboard/index.ts:701-709`, audit action `stripe_connect.onboard_initiated` at line 734 records `onboarding_surface: "stripe_hosted_account_link"` |
| **Exact code** | `accountLink = await createRecipientAccountLink({ accountId: stripeAccountId, refreshUrl: ..., returnUrl: ..., idempotencyKey: ... });` — returns the Stripe-hosted onboarding URL the app opens via `expo-web-browser.openAuthSessionAsync` (`BrandOnboardView.tsx:362`). |
| **What it does** | Hosted Account Link onboarding: creator leaves the Mingla brand UI, lands on Stripe's hosted KYC page, completes onboarding, returns via Account Link. |
| **What DEC-154 mandates** | DEC-154 (2): embedded onboarding components (`@stripe/connect-js` or React Native equivalent) so creator never leaves the Mingla brand wrapper. DEC-154 (3): embedded account-management components, not Express Dashboard. |
| **Why it doesn't block charge-shape flip** | Embedded vs hosted onboarding is the **sub-ORCH (b)** in DEC-154's queue (separate from charge shape). The Stripe Managed Risk doc accepts BOTH hosted AND embedded onboarding ("You must onboard connected accounts using Stripe-hosted onboarding or the embedded onboarding component"), so this is NOT a Managed Risk blocker. It IS a DEC-154 (2)+(3) gap that needs its own ORCH. Out of scope for ORCH-0843 — surface as Discovery. |

**Classification:** 🟡 Hidden Flaw (relative to DEC-154 (2)+(3), not to charge-shape flip). **Confidence:** High.

### 🟡 Hidden Flaw — HF-3: Webhook handler routes events by `event.account` but does NOT explicitly verify direct-charge events arrive on the platform endpoint

| Field | Evidence |
|---|---|
| **File** | `supabase/functions/_shared/stripeWebhookRouter.ts` (top 80 lines + grep) |
| **Behavior** | `accountIdForEvent(event)` reads `event.account` (the Stripe-Account header on the webhook event payload). Stripe's webhook architecture: events created on a connected account include `event.account = "acct_*"` and arrive at the platform endpoint when the webhook is registered as a "Connect" webhook (not an account-restricted webhook). The router already handles this correctly. |
| **What needs verification at SPEC time** | (1) Confirm Mingla's Stripe Dashboard webhook endpoint is registered as a **Connect** webhook (not a platform-only webhook) — direct-charge events arrive with `event.account` set. (2) Confirm `checkout.session.completed` event firing under direct-charge mode still includes the `payment_intent` field the router uses. (3) Confirm webhook signing secret env var includes the Connect-webhook secret (the file uses multi-secret verification via `getStripeWebhookSecretsFromEnv` — likely OK but needs SPEC-time verification). |

**Classification:** 🟡 Hidden Flaw (pending SPEC-time verification, likely already correct). **Confidence:** Medium.

### 🔵 Observation — OB-1: `controller_dashboard_type` column doesn't store loss-liability — Stripe is the source of truth

The DB schema (`stripe_connect_accounts`) has `controller_dashboard_type text NOT NULL DEFAULT 'express'`, but no column for `losses_collector` or `fees_collector`. Loss-liability is recorded in Stripe's account object only (`/v1/accounts/{acct_id}` returns `controller.losses.payments`). If SPEC needs to enforce a per-account assertion that all live-sale targets are Stripe-managed-risk, that must be done at edge-fn check time via Stripe API (or by adding a column + sync). Out of scope unless operator picks Path A.

### 🔵 Observation — OB-2: Test data only, no real money at stake

27 `orders` rows; 0 have `stripe_charge_id` populated. 12 have `stripe_payment_intent_id` — all test mode. No production payments have flowed through. Rollback cost is effectively zero. This gives the operator unusual flexibility on the path choice.

---

## Five-Layer Cross-Check

| Layer | Statement | Source |
|---|---|---|
| **Docs (DEC-154)** | "Funds flow = direct charges on the connected account... `controller.losses.payments = stripe`... Risk and loss liability = Stripe-managed." | `DECISION_LOG.md` lines 5-6 (verbatim) |
| **Docs (Stripe Managed Risk)** | "You must use direct charges." + "You must onboard using Stripe-hosted onboarding or the embedded onboarding component." | `https://docs.stripe.com/connect/risk-management/managed-risk` |
| **Schema** | `stripe_connect_accounts` table has no `losses_collector` column. Only `controller_dashboard_type` (currently always `'express'`). Latest migration: `20260515000007_orch_0764b_stripe_status_derivation_parity.sql`. RPC `biz_ticket_checkout_create_session` already accepts `p_application_fee_amount_cents` and persists to `ticket_checkout_sessions.application_fee_amount_cents`. Direct-charge flip needs zero DB schema change. |
| **Code** | `ticket-checkout-create/index.ts:268,394` uses `transfer_data.destination` (destination charges, platform-account API call). `stripeBlueprintClient.ts:135-136` creates Connect accounts with `losses_collector: "application"` (platform-liable). `refund-order/index.ts:211` uses `reverse_transfer: true` (destination-charge refund shape). |
| **Runtime** | Edge fn `ticket-checkout-create` deployed at v43 (per DEC-155). 9 connected accounts in DB. 5 active (`charges_enabled=true`). No real charges yet (`stripe_charge_id` populated on 0 of 27 orders). |
| **Data** | 9 `acct_*` IDs in Stripe sandbox, all created via current code path → all platform-liable. |

**Contradictions found:**
- **DEC-154 ↔ Code (`stripeBlueprintClient.ts`)**: DEC-154 says Stripe-managed losses; code provisions platform-managed. Code is what Stripe sees → code wins for the existing 9 accounts.
- **DEC-154 ↔ Stripe Managed Risk doc**: DEC-154 implies destination charges are incompatible. Stripe doc CONFIRMS — "You must use direct charges." DEC-154 is right.
- **DEC-154 ↔ DEC-154**: DEC-154 (5) says Stripe-managed risk; DEC-154 (6) acknowledges controller-properties are sticky after first account creation. Read together: DEC-154 implicitly assumes existing accounts already have the locked shape, OR implicitly requires re-onboarding to achieve it. The DEC doesn't make this explicit — that's the gap this investigation surfaces.

---

## Blast Radius

### Files touched by a destination → direct charge flip (Path A or B)

| File | Change | Layer |
|---|---|---|
| `supabase/functions/ticket-checkout-create/index.ts` | Drop `transfer_data.destination`. Add `{ stripeAccount: stripeAccountId }` third-arg to `checkout.sessions.create` and `paymentIntents.create`. Add `application_fee_amount` (under `payment_intent_data` on Checkout Session, top-level on PaymentIntent). Update line 251 comment (Tax for Platforms applies to direct too, not only destination). | Edge fn |
| `supabase/functions/refund-order/index.ts` | Drop `reverse_transfer: true`. Add `{ stripeAccount: connectedAcctId }` third-arg on `refunds.create`. Look up `connectedAcctId` from `stripe_payment_intent_id`'s order row (already accessible via the order's brand → `stripe_connect_accounts.stripe_account_id`). Keep `refund_application_fee` semantics (still valid). Update line 1-21 doc block. | Edge fn |
| `supabase/functions/cancel-order/index.ts` | Verify — likely needs identical Stripe-Account header on any cancel-side PaymentIntent operation. Out of immediate scope but include in SPEC's cross-reference check. | Edge fn |

### Files touched by re-onboarding flip (Path A only)

| File | Change | Layer |
|---|---|---|
| `supabase/functions/_shared/stripeBlueprintClient.ts` | Change `losses_collector` to `"stripe"`, `fees_collector` to `"stripe"`, change `dashboard` to `"none"` (or v2 embedded-equivalent value — verify against Stripe Accounts v2 reference at SPEC time). | Shared |
| `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts` | Update snapshot. | Test |
| `supabase/functions/brand-stripe-onboard/index.ts` | Add detach + re-onboard helper for the 9 existing accounts (one-time migration script OR per-brand flow when they next log in). Update `controller_dashboard_type` value in DB upsert (currently hardcoded `"express"` at line 410 — needs to be `"none"` for embedded). | Edge fn |
| Mobile/business UI (`mingla-business/app/brand/onboarding`, etc.) | Wire embedded `@stripe/connect-js` (web) or React Native equivalent components for account onboarding, account management, notification banner, payouts. This is **DEC-154 sub-ORCH (b)** — separate from ORCH-0843. | UI |

### Webhook events affected

`checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.refund.updated`, `application_fee.created`, `application_fee.refunded` — all already in `STRIPE_ROUTED_EVENT_TYPES`. Under direct charges, these arrive on the platform Connect webhook endpoint with `event.account` set; router handles correctly. No event-type changes needed.

### DB columns / migrations affected

**None for the basic flip.** `ticket_checkout_sessions.application_fee_amount_cents` already exists per migration `20260605000002`. `orders.stripe_payment_intent_id` works the same way regardless of charge shape (the PI id is just stored). The `stripe_charge_id` column is populated by webhook on charge succeed — under direct charges, this is the connected-account-scoped charge id, but the schema accepts any text. No migration needed.

**If Path A (re-onboarding)**: optional new column `stripe_connect_accounts.losses_collector` (text) for ops visibility, plus migration to soft-detach + re-onboard the 9 existing rows.

### Invariant impact

| Invariant | Status | Change |
|---|---|---|
| I-PROPOSED-O [I-PROPOSED-O ACTIVE] | Unchanged | Stripe Connect onboarding gate — still enforced (account must exist before charge). |
| I-PROPOSED-R (Stripe idempotency keys per call) | Unchanged | Direct-charge calls still need idempotency keys; already wired (`ticket_checkout_web:${checkoutSessionId}` + `ticket_checkout:${checkoutSessionId}` + `ticket_refund:${refundId}`). |
| I-PROPOSED-Q (Stripe API version via shared client only) | Unchanged | API pin stays at `2026-04-22.dahlia`. |
| STRIPE-AUDIT-LOG-ON-EVERY-EDGE-FN | Unchanged | Audit calls remain; expand fields to include `application_fee_amount_cents` under direct-charge path. |
| **NEW: I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT** | New (PROPOSED) | After flip, no `transfer_data.destination` in any code path. Enforce via strict-grep gate. |
| **NEW: I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS** | New (PROPOSED) | Every `checkout.sessions.create`, `paymentIntents.create`, `refunds.create` against a connected account passes `{ stripeAccount }` request-options arg. Strict-grep can detect the absence of `stripeAccount` near these call sites. |
| **NEW: I-PROPOSED-CONNECT-ACCOUNTS-STRIPE-MANAGED-RISK** (Path A only) | New (PROPOSED) | All `stripeBlueprintClient.ts` create-account bodies use `losses_collector: "stripe"`, `fees_collector: "stripe"`. Strict-grep enforces. |
| I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME | Unchanged | ORCH-0839-B's invariant — orthogonal to charge shape. |
| I-PROPOSED-MINGLA-BUSINESS-NO-NATIVE-STRIPE | Unchanged | ORCH-0839-B's invariant — orthogonal. |

---

## Connected-Account Compatibility Audit

| acct id (test-mode) | brand_id | country | currency | charges_enabled | payouts_enabled | detached | controller_dashboard_type | losses (per code) |
|---|---|---|---|---|---|---|---|---|
| `acct_1TWUdgPjlZcNNVhg` | d221d8c5… | BE | EUR | ✅ | ✅ | — | express | application (platform-liable) |
| `acct_1TWJQEPjlZW8yM31` | 1f724f9e… | US | USD | ❌ | ❌ | — | express | application |
| `acct_1TV3n6PjlZ4Wxb81` | 69c03735… | US | USD | ✅ | ✅ | — | express | application |
| `acct_1TV3UXPjlZa64TWL` | 304f90b2… | CH | CHF | ✅ | ✅ | — | express | application |
| `acct_1TV06aPjlZ3e5YTo` | e2d49bd8… | US | USD | ❌ | ❌ | — | express | application |
| `acct_1TUzsvPjlZplCVEZ` | 81fd06bc… | US | USD | ❌ | ❌ | — | express | application |
| `acct_1TUvKxBWGYLKEAL8` | 8f989994… | GB | GBP | ✅ | ✅ | — | express | application |
| `acct_1TUNLtB5v00XfDTX` | 22a18413… | US | USD | ✅ | ✅ | — | express | application |
| `acct_1TULpSBWy2yPzdb4` | b42efd81… | GB | GBP | ❌ | ❌ | — | express | application |

**Direct-charge compatibility (Stripe API level):** All 9 accept direct charges right now — direct charges only require the connected account to have `card_payments` capability + a valid `Stripe-Account` header. The 5 with `charges_enabled = true` will accept the flip cleanly.

**Managed Risk eligibility:** All 9 are **NOT** Managed-Risk-eligible because `losses_collector = "application"`. Per Stripe docs, Managed Risk requires Stripe-liable controller-properties on the account itself (set at create time). Flipping the platform-level setting in the Stripe Dashboard does NOT retroactively change existing-account controller-properties.

**Country/jurisdiction validation:** Mixed (5×US, 2×GB, 1×BE, 1×CH). Stripe's Managed Risk availability list at `https://docs.stripe.com/connect/risk-management/managed-risk#availability` should be cross-referenced at SPEC time for these jurisdictions if Path A is chosen.

---

## Tax for Platforms verdict

- **Compatible with both destination AND direct charges** per Stripe Tax for Platforms docs.
- Current `automatic_tax: { enabled: true, liability: { type: "account", account: stripeAccountId } }` block (line 279) **survives the flip unchanged**.
- Code comment at line 251 `(destination-charge platform model)` is misleading and should be removed in SPEC; the API shape is identical for both charge types.
- Confidence: High.

---

## Statement Descriptor + Refund + Dispute Behavior — destination vs direct

| Behavior | Destination charges (today) | Direct charges (target) |
|---|---|---|
| Buyer card statement | Platform name (MINGLA*) | Creator's business name; optional `statement_descriptor_prefix: "MINGLA"` to prepend platform identifier per DEC-154 (1) |
| Charge object owner | Platform account | Connected account (queryable only via `Stripe-Account` header) |
| Refund target balance | Platform balance first, then `reverse_transfer: true` debits connected account | Connected account balance directly; under Managed Risk Stripe absorbs any resulting negative balance |
| Dispute notification recipient | Platform | Connected account (under embedded Notifications Banner per DEC-154 (3)) + platform via Connect webhook |
| Platform balance impact | Full charge minus Stripe fee transferred to connected account; platform fee via `application_fee_amount` (not set today) | Only `application_fee_amount` lands in platform balance |
| Merchant of record (Tax) | Connected account (already configured via `automatic_tax.liability.type: "account"`) | Connected account (same — config unchanged) |
| Visibility in Stripe Dashboard | Platform dashboard shows everything | Platform dashboard shows application fees + Connect activity; connected account dashboard shows the actual charges |

---

## Recommended SPEC scope (minimum-blast-radius)

**Files to change:**
1. `supabase/functions/ticket-checkout-create/index.ts` — drop `transfer_data.destination` (×2 call sites), add `{ stripeAccount }` request-options (×2), add `application_fee_amount` math (sourced from `biz_ticket_checkout_create_session.application_fee_amount_cents` already returned; pass to Stripe), update line 251 comment.
2. `supabase/functions/refund-order/index.ts` — drop `reverse_transfer: true`, add `{ stripeAccount }` to `refunds.create`, look up connected account from order/brand chain (one extra Supabase query: order → event_id → brand_id → stripe_connect_accounts.stripe_account_id).
3. `supabase/functions/cancel-order/index.ts` — audit + same pattern if any Stripe call against a connected-account-owned PI exists.

**Files to NOT change (in this SPEC):**
- `supabase/functions/_shared/stripeBlueprintClient.ts` — UNLESS operator picks Path A. Charge-shape flip works against the existing platform-liable accounts; only the Managed-Risk *benefit* is gated on this file changing.
- `supabase/functions/brand-stripe-onboard/index.ts` — UNLESS Path A. Embedded onboarding is DEC-154 sub-(b), separate ORCH.
- `supabase/functions/stripe-webhook/index.ts` — no changes; webhook router already handles `event.account` for connected-account events.
- DB migrations — none required.

**New strict-grep gates (CI):**
1. `orch-0843-no-transfer-data-destination.mjs` — fails build if any `transfer_data.destination` reappears in `supabase/functions/`.
2. `orch-0843-stripe-account-on-connected-calls.mjs` — fails build if `checkout.sessions.create` / `paymentIntents.create` / `refunds.create` call sites lack a `stripeAccount` request-options key within N lines.

**Two regression tests** (per ORCH-0840 enforcement):
1. Implementor-written happy-path: edge-fn test asserts the outbound Stripe API call body matches direct-charge shape (no `transfer_data.destination`, has `application_fee_amount`, has `Stripe-Account` header).
2. Tester-written adversarial: ensure a regression that adds back `transfer_data.destination` trips the gate; ensure missing `Stripe-Account` on a Connect-scoped call trips the gate.

---

## Recommended rollout shape

**Pre-flip probe (mandatory):** One-shot edge function `orch-0843-stripe-probe` that, against an operator-named test brand, creates a $0.50 Checkout Session under direct-charge shape (`stripeAccount` + `application_fee_amount`), completes it via Stripe-hosted test card, verifies (a) charge appears on the connected account in Stripe Dashboard, (b) statement descriptor renders creator's name, (c) webhook arrives with `event.account` set, (d) refund flow against this test charge works end-to-end. Tear down the probe function after a green pass. **Mirror the ORCH-0839-B custom-scheme probe pattern** (DEC-155 (4)).

**Hot flip:** After green probe, deploy the edge function update (`ticket-checkout-create` v44 + `refund-order` v_next). Atomic single-deploy. Older mingla-business builds calling `surface: "native"` still hit the same edge fn — backward-compat preserved by edge-fn behavior change being internal (the response shape is unchanged; only Stripe API call shape changed).

**Post-flight monitoring:** Operator watches the first 3 live charges + 1 live refund in Stripe Dashboard before declaring live sales open to all brands.

**NO feature flag.** Charge shape is mutually-exclusive (a single Stripe call is either destination OR direct — can't be both). A flag would just add risk of mis-routing during the transition window. Atomic deploy is safer.

**Operator gate (before any of the above):** Decide Path A vs Path B (Managed Risk goal vs platform-liable acceptance) — this is the SPEC-blocker.

---

## Discoveries for Orchestrator

1. **DEC-154 ↔ blueprint-client contradiction** — DEC-154 declares Stripe-managed risk locked but the code provisions platform-liable accounts. This investigation surfaces it; needs explicit operator-decision DEC entry (an amendment to DEC-154 OR a new DEC reconciling). Two paths captured above. Operator must choose before SPEC.
2. **`application_fee_amount = 0` everywhere** — Mingla collects no platform revenue today. SPEC needs explicit operator pricing decision (e.g., "Mingla takes X% per ticket"). Mingla revenue strategy is presumably a product-side ORCH (`mingla-product` skill). Surface as side issue.
3. **Embedded onboarding (DEC-154 sub-(b))** — `brand-stripe-onboard/index.ts` uses Stripe-hosted Account Link (line 701-720); DEC-154 (2) mandates embedded components. Separate ORCH, but parallel-ready with ORCH-0843.
4. **Embedded account management (DEC-154 sub-(b))** — `dashboard: "express"` provisions Express Dashboard redirect; DEC-154 (3) mandates embedded account-management components. Same ORCH as #3.
5. **Tax-for-Platforms comment is misleading** — Line 251 of `ticket-checkout-create` says `(destination-charge platform model)`. Tax for Platforms supports both shapes; comment should be corrected when SPEC updates the file.
6. **Webhook endpoint registration verification** — SPEC should verify (with operator) that Mingla's Stripe webhook endpoint is registered as a **Connect** webhook (not platform-only) so connected-account events arrive. Likely already correct (the router handles `event.account`) but operator-verifiable in Stripe Dashboard.
7. **Restricted API keys (DEC-154 (9)(a))** — Current shared client uses `STRIPE_SECRET_KEY` fallback per `stripeBlueprintClient.ts:107`. DEC-154 mandates per-edge-function `rk_live_*` restricted keys. Separate sub-ORCH (d). Out of ORCH-0843 scope but stack-adjacent.
8. **Statement descriptor prefix wiring** — DEC-154 (1) mentions optional `statement_descriptor_prefix: "MINGLA"` for "MINGLA*" prefix on direct-charge statements. SPEC should decide whether to include this in v1 of the flip.
9. **Test data only — no rollback risk** — DB shows 0 of 27 orders have a populated `stripe_charge_id`. Operator can flip without worrying about in-flight live payments. Surface this as part of the SPEC rationale.
10. **`controller_dashboard_type` column will need value update if Path A** — Currently `"express"` default; embedded model wants `"none"`. Migration + edge-fn upsert call (line 410) both need touch under Path A.

---

## Confidence Level

**Overall: High (proven)** — all six required root-cause fields filled for RC-1 and RC-2, with file:line + verbatim code + behavior + Stripe-docs citation + DB-data corroboration. The investigation crosses all five truth layers (docs/schema/code/runtime/data) and finds the docs ↔ code contradiction that's the heart of this dispatch. No source-only "suspected" reasoning was relied upon for any finding.

**Where confidence drops to Medium:**
- HF-3 webhook endpoint registration (cannot verify Stripe Dashboard config without operator-shown screen)
- Statement descriptor exact rendering (depends on Stripe runtime behavior; needs live probe at SPEC-time)
- Per-country Managed Risk availability (Stripe docs don't enumerate; needs operator verification with Stripe support if Path A)

**Live-fire status:** Exempt — this is a pure backend / SQL / migration / edge-function investigation. No UI/runtime reproducer. The Prime Directive's live-fire requirement applies to UI/UX/input/keyboard/gesture/animation/navigation/runtime bugs. The dispatch is a code-audit + decision-architecture investigation; source + Stripe-docs + live-DB verification is the correct evidence shape and was performed.

---

## Fix Strategy Direction (NOT A SPEC)

1. **Operator decision gate first** — Pick Path A (re-onboard for Managed Risk) or Path B (keep platform-liable, just fix charge shape). Amend DEC-154 accordingly.
2. **If Path A:** SPEC the charge-shape flip + the controller-properties flip + the migration script for the 9 existing accounts + the embedded-components UI wiring as **two parallel SPECs** (ORCH-0843 = charge shape, ORCH-08XX-B = onboarding flip). Charge-shape flip can land first against post-flip new accounts; existing 9 accounts are detached + re-onboarded in a campaign before live sales open.
3. **If Path B:** SPEC the charge-shape flip alone. Amend DEC-154 to acknowledge platform-liable risk is accepted (with explicit operator rationale that Mingla absorbs early-stage chargeback risk to ship faster). New invariant `I-PROPOSED-PLATFORM-LIABLE-RISK-ACCEPTED-UNTIL-08XX` with named exit ORCH.
4. **Either path:** Charge-shape flip is small (3 files, ~80 LOC delta, zero migrations). Pre-flip probe (one-shot edge fn) + hot deploy + 3-charge post-flight watch.

---

## Regression Prevention

1. Strict-grep gate 1: forbid `transfer_data.destination` anywhere under `supabase/functions/` (covers re-introduction).
2. Strict-grep gate 2: require `stripeAccount:` key in the request-options third arg within ±15 lines of every `checkout.sessions.create`, `paymentIntents.create`, `refunds.create` call site that references a `stripeAccountId` variable.
3. Comment block on every flipped call site: `// ORCH-0843 — direct-charge shape per DEC-154. DO NOT re-introduce transfer_data.destination. See INVESTIGATION_ORCH-0843.`
4. (Path A only) Strict-grep gate 3: require `losses_collector: "stripe"` literal in `stripeBlueprintClient.ts`.
5. Edge-fn regression test (per I-REGRESSION-TEST-MANDATORY): mock Stripe SDK, assert outbound body shape matches direct-charge contract.
6. Tester adversarial test: reverting the change should trip both strict-grep gates AND the regression test.

---

**Report ends.** Next step: operator decides Path A vs Path B; if either, hand to Claude `mingla-forensics` SPEC mode to author `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md` referencing this investigation.
