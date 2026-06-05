# META-ORCH-1076 — Paystack for Africa (Nigeria + Ghana) — Shared Understanding Brief

- **Status:** REGISTERED (not spawned — registration/compliance prerequisites precede technical setup, per operator)
- **Registered:** 2026-06-04
- **Owner:** mingla-orchestrator+claude
- **Type:** META-ORCH (multi-surface, multi-phase payments program)
- **ID provenance:** next-free above max observed (ORCH-1071); 1072 confirmed unused across WORLD_MAP / MASTER_BUG_LIST / OPEN_INVESTIGATIONS / COMMS_LEDGER / memory / active worktrees per COMMS-0004.

## Goal (operator's words, restated)

Stand up **Paystack as the payments provider for Mingla's Africa operations**, delivering **all the same functionality we have today on Stripe**, adapted to African operations and African payment methods. **Launch markets: Nigeria and Ghana.** Operator will complete **business/Paystack registration first**; technical build begins only after registration is in hand.

## Affected Surfaces

In scope (all 5 primary + 1 adjacent — this is a like-for-like provider replication for Africa):
1. Consumer iOS (`app-mobile/` iOS) — buyer checkout for NG/GH events/trips/experiences
2. Consumer Android (`app-mobile/` Android) — same
3. Buyer/anonymous Web (`mingla-business/` `/checkout/*`, `/e/*`, `/b/*`) — buyer checkout
4. Business iOS (`mingla-business/` iOS) — brand payout onboarding + money dashboard
5. Business Android (`mingla-business/` Android) — same
6. Admin Web (`mingla-admin/`) — adjacent: disputes/payout ops visibility for NG/GH

Not in scope: Business Web preview is incidental (rides the same `mingla-business/` build, no Paystack-specific preview surface).

## The spine: provider abstraction by (provider, country)

Today money is keyed by **mode** (`MINGLA_STRIPE_MODE` + `resolveStripeKey(role)`). Africa adds a second axis: **provider × country**. Paystack accounts are **country-specific** — a Nigeria Paystack account and a Ghana Paystack account are separate dashboards, separate keys, separate settlement. The architectural spine is therefore a **payment-provider resolver**: a brand's country/currency selects `{provider: stripe|paystack, country: NG|GH|…}` → keys + client + capabilities. Stripe keeps every Stripe-supported country; Paystack takes NG + GH. The all-in pricing engine, orders schema, refunds, disputes, and webhooks become **provider-agnostic at the contract layer** with a Paystack implementation behind it — NOT a forked parallel money path.

## Current Stripe surface → Paystack equivalent → delta (the 8 dimensions)

| # | Capability (Stripe today) | Paystack equivalent | Material delta to design around |
|---|---|---|---|
| 1 | **Checkout / PaymentIntent** (`ticket-checkout-create/confirm/status`) | **Initialize Transaction** → hosted popup/redirect, then **Verify Transaction** by reference | Paystack's hosted popup fits Mingla's CURRENT pattern well — native `@stripe/stripe-react-native` was already removed (ORCH-0839-B); buyers already use hosted checkout via `expo-web-browser`. Paystack popup slots into the same shape. |
| 2 | **Marketplace split** (Connect direct-charge + `application_fee_amount`) | **Subaccounts + Transaction Splits** (platform cut as % or flat) | Subaccount settles directly to the brand's **bank account** on a settlement schedule (T+1 NG); platform's cut comes off the split. No held "balance" object per connected account like Stripe. Brand onboarding = bank account + name-resolve, far lighter than Stripe KYC. |
| 3 | **All-in pricing engine** (`allInPricingEngine.ts`: tax + Mingla fee + service fee, 3 pass/absorb switches, WYSIWYP) | Reused as-is for fee math; **tax component must change** | Fee/service-fee math is provider-neutral and survives. The **3 switches + WYSIWYP all-in promise stay**. The application-fee lever maps to the Paystack split percentage. |
| 4 | **Tax** (Stripe Tax: calc/commit/reverse, venue-based, GB inclusive) | **No Paystack-Tax equivalent exists** | Biggest delta. NG VAT 7.5%; GH VAT + NHIL/GETFund/COVID levies (effective ~15%+). Mingla must compute VAT itself (config-driven per country) or skip a tax line at launch. **Decision needed.** |
| 5 | **Connect onboarding** (embedded Stripe components, KYC, `/connect-*` pages) | **Create Subaccount API** (settlement bank + account number; `/bank/resolve` for name) | No embedded KYC UI to replicate. Brand onboarding becomes a simple bank-details form → subaccount. Platform-level compliance (CAC in NG, RGD in GH) is Mingla's, done once at registration. |
| 6 | **Refunds** (`refund-order`, partial, fee-refund, tax reversal) | **Paystack Refund API** (partial supported) | Maps cleanly; no tax-reversal call (tax handled by Mingla, see #4). Fee handling via split reversal. |
| 7 | **Disputes** (`stripe_disputes`, 3 `charge.dispute.*` events, ops alerts) | **Paystack Disputes/chargebacks API + webhook events** | Maps at capability level; exact event names + payload shapes to be doc-verified (COMMS-0003). |
| 8 | **Webhooks** (`stripe-webhook` router, signed, idempotent inbox) | **Paystack webhooks** (`charge.success`, `transfer.*`, `refund.*`, dispute events), HMAC-SHA512 signature | Same idempotent-inbox + signature-verify architecture reused; new signature scheme (Paystack signs body with secret key via `x-paystack-signature`), new event-name map. |

**Payment methods unlocked for Africa:** card, bank transfer, USSD, **mobile money** (esp. Ghana — MTN MoMo, Vodafone Cash, AirtelTigo), QR, Apple Pay (NG). Mobile money is a first-class African method with no Stripe analog — a genuine upgrade, not just parity.

**Currency:** NGN (kobo) + GHS (pesewas) — Paystack uses minor units exactly like Stripe cents, so the integer-cents money model carries over. Aligns with the de-GBP direction (ORCH-1034).

## Locked decisions (operator, 2026-06-04)

1. **Tax/VAT:** **Config-driven VAT per country.** The all-in engine computes a fixed VAT rate per country (NG 7.5%; GH ~15% incl. NHIL/GETFund/COVID levies — exact rates doc-verified at SPEC), keeps the pass/absorb toggle and the WYSIWYP all-in price. `taxBehaviorForRegion` extends with NG/GH config rates; no live jurisdiction engine.
2. **Parity bar:** **Full parity before go-live.** Nigeria does not transact until checkout + payout(split) + refunds + disputes + installments + KYC/ops are all replicated to Stripe-grade. No feature gap between Stripe brands and Paystack brands.
3. **Merchant model:** **Mingla account + brand subaccounts/splits.** One Mingla Paystack merchant account per country; brands are subaccounts; Mingla's take-rate is the transaction-split percentage (the `application_fee_amount` analog). Brand onboarding = settlement bank + `/bank/resolve`, no per-brand KYC.
4. **Scope: NIGERIA ONLY for now (Ghana DEFERRED — revised 2026-06-04).** Build to full Stripe parity on Nigeria (NGN). **Ghana is out of active scope** — no Ghana Paystack account, no GHS, no mobile money, no Ghana sellers yet. The `(provider, country)` resolver is still built so Ghana is later a config + account add, not a rewrite, but nothing Ghana-specific ships in this program until Seth re-opens it. The Paystack reference doc retains the Ghana/mobile-money detail for that future resumption.

**Synthesis of #2 + #4:** Nigeria is built to *full* Stripe parity and that is the entire deliverable for now. Ghana resumes as its own future sub-ORCH/META-ORCH when chosen — it inherits the finished Nigeria stack and adds only GHS + Ghana channels.

## Registration prerequisites (operator provides before technical setup)

- Mingla **Paystack business account(s)** — country-specific: a **Nigeria** account and (per sequencing decision) a **Ghana** account.
- Business-registration evidence each country requires (NG: CAC docs; GH: RGD/business cert) — whatever Paystack's onboarding form asks for.
- **Test + live API keys** per country account (public + secret) once approved — handled via Supabase secrets, never in code.
- Settlement bank details for Mingla's own account(s).
- Confirmation of which payment channels to enable per country (card / bank / USSD / mobile money / Apple Pay).

## Compliance with standing invariants

- **COMMS-0003 (external-API docs):** every Paystack endpoint, param, enum, event name, and signature scheme gets its canonical Paystack docs URL cited inline at SPEC time; regression tests hit Paystack TEST or mock with documented payload/error shapes. No Stripe-style "copied a string into the spec" failures.
- **COMMS-0002 (strict-grep backend gate):** any new `supabase/functions/**` or migration lands its `ORCH_1072_BACKEND_ALLOWLIST` entry in the same commit.
- **Secrets:** Paystack keys via Supabase secrets + a `resolvePaystackKey(country, mode)` helper mirroring `resolveStripeKey(role)`; fail-closed in production.

## Phasing (locked to decisions 1-4 — Nigeria to full parity, then Ghana)

- **Phase 0 — Registration + provider-resolver skeleton** (no money): Nigeria Paystack account approved; `resolvePaystackKey(country, mode)` + `(provider, country)` routing; capability flags; Supabase secrets plumbed.
- **Phase 1 — Buyer checkout** (NGN): initialize → popup → verify-by-reference → webhook `charge.success` → existing order-finalize RPC; all-in pricing with config-driven VAT.
- **Phase 2 — Brand payout** (subaccounts + splits): brand bank-details onboarding + `/bank/resolve`; split percentage = Mingla take-rate; settlement reporting.
- **Phase 3 — Refunds**: Paystack Refund API into the existing `refunds` schema + line-item shape.
- **Phase 4 — Disputes + KYC/ops + installments**: dispute webhook events → `stripe_disputes`-analog table; ops alerts; installment/off-session parity (Paystack recurring-charge model). **Nigeria full-parity go-live gate clears here.**
- **Phase 5 — Ghana**: GHS account + config replication of Phases 1-4; enable Ghana mobile money (MTN MoMo, Vodafone Cash, AirtelTigo). Ghana go-live.

Each phase runs the standard pipeline (INVESTIGATE/SPEC → IMPLEMENT → TEST → CLOSE) as its own sub-ORCH under META-ORCH-1076, in a per-ORCH worktree.

## Provider routing — how "Nigerians go through Paystack, not Stripe" is handled

**Provider is a property of the BRAND (seller), resolved from the brand's country. Buyers never choose — the app routes them based on whose event they are buying.**

- At brand onboarding, the brand's country is known. Country decides the provider:
  - Brand in **NG / GH** → **Paystack** (that country's account: NGN/GHS, local methods).
  - Brand in any **Stripe-supported** country → **Stripe** (the existing flow, untouched).
- We store on the brand: `payment_provider` (`stripe` | `paystack`) + the provider account ref (`stripe_connect_id` OR `paystack_subaccount_code`) + the country/currency.
- At checkout, `ticket-checkout-create` reads the brand's `payment_provider` and dispatches:
  - Paystack brand → Paystack `initialize` → hosted checkout → verify → `charge.success` webhook.
  - Stripe brand → existing PaymentIntent flow.
- **Routing is always seller-country-driven, never buyer-driven.** A Nigerian buyer purchasing a UK brand's event goes through Stripe (GBP, international card). A UK buyer purchasing a Nigerian brand's event goes through Paystack (NGN, international card). The buyer only sees the all-in price in the brand's currency and a native payment sheet — they never pick a processor.

**Why this is low-risk:** Stripe Connect does **not** support Nigeria or Ghana as payout countries — so there are **zero existing NG/GH brands on Stripe to migrate**. This is purely additive: the Paystack branch only ever activates for NG/GH brands that could not have existed before. Every existing (Stripe) brand keeps working byte-for-byte. The shared layer (all-in pricing engine, orders/tickets schema, receipts, the consumer cart UX) is provider-agnostic and reused; only mint-payment / verify / webhook / refund / payout-onboarding differ per provider, behind a thin provider-strategy interface.

## Execution plan — what we need + outcome per step

### Track A — Non-code prerequisites (operator-owned; registration is the long pole)

| # | What we need | Owner | Outcome when done |
|---|---|---|---|
| A1 | **Nigeria Paystack account** (DONE — registered, test keys in hand) | Seth | Sandbox build can start immediately |
| A2 | Paste Test Webhook + Callback URLs in NG dashboard | Seth | Test events + buyer return wired |
| A3 | **Nigeria live activation**: CAC docs + director BVN/iGree consent (+ SCUML if applicable) → live keys | Seth + Paystack | Real NGN money allowed (gates go-live only, not the build) |
| A4 | ~~Ghana Paystack account registration~~ — **OUT OF SCOPE (Ghana deferred 2026-06-04)** | — | Resumes only when Seth re-opens Ghana |
| A5 | Settlement bank account(s) — NG (and GH) for Mingla's own account | Seth | Mingla receives its platform cut |
| A6 | Confirm enabled channels per country (NG: card/bank/USSD/transfer/Apple Pay; GH: card/mobile-money/transfer/Apple Pay) | Seth | Checkout shows the right methods |
| A7 | Confirm VAT rates — NG 7.5%, GH effective rate (finance) | Seth + finance | All-in price shows correct tax |

### Track B — Build phases (each a sub-ORCH; standard pipeline in a worktree)

| Phase | What we build | Outcome |
|---|---|---|
| **0 — Provider foundation** | `payment_provider` on brands; `resolvePaystackKey(country, mode)`; `(provider, country)` resolver; Paystack keys in Supabase secrets; `paystack-webhook` skeleton (`verify_jwt:false`, HMAC-SHA512 verify, 3-IP allowlist, idempotent inbox reusing `payment_webhook_events`) | App knows each brand's provider; webhook endpoint live and verifying signatures. **No money yet.** |
| **1 — Buyer checkout (NGN)** | `ticket-checkout-create` branches to Paystack `initialize` → hosted checkout in in-app browser → `callback`/verify → `charge.success` finalizes the existing order RPC; all-in pricing with NG config VAT + NG fee model (1.5%+₦100 capped ₦2,000) | A buyer pays for a Nigerian brand's event in NGN, end-to-end, in test mode |
| **2 — Brand payout (subaccounts)** | Brand bank-details onboarding (List Banks → Resolve Account → Create Subaccount); store `paystack_subaccount_code`; split = Mingla take-rate (`transaction_charge`/`percentage_charge`) | A Nigerian brand connects its bank and receives payouts; Mingla takes its cut automatically |
| **3 — Refunds** | Paystack `POST /refund` into existing `refunds` schema; commit `pending` inline, finalize via `refund.processed`/`failed` webhook | Organizers can refund NG orders |
| **4 — Disputes + ops + installments** | Dispute table/webhooks (`charge.dispute.create`/`remind`/`resolve`); ops alerts; installment/off-session parity | **Nigeria reaches full Stripe parity → NG go-live gate clears. This is the final phase of the current program.** |
| ~~5 — Ghana~~ | **DEFERRED (out of scope 2026-06-04)** — GHS account + mobile money. Resumes as a future sub-ORCH/META-ORCH when Seth re-opens it; inherits Phases 0-4. | — |

The shared all-in pricing engine, orders/tickets schema, receipts, and consumer cart are reused across all phases — they don't fork per provider. **Current program = Phases 0-4 (Nigeria to full parity).**
