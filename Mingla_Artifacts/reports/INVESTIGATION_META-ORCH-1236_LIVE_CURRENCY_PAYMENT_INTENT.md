# INVESTIGATION — META-ORCH-1236: Live-keys currency mismatch + PaymentIntent failure

**Date:** 2026-06-26
**Investigator:** mingla-orchestrator (live-data forensics)
**Severity:** S0-critical — live buyers charged the WRONG currency (real overcharge confirmed) + paid checkout broken on consumer native.
**Affected Surfaces:** iOS-consumer, Android-consumer, buyer-web. (Business app surfaces NOT in scope — they author, they don't buy.)
**Status:** ROOT CAUSE PROVEN. Awaiting fix-scope steering.

---

## 1. Plain-English summary

A brand (Smoke & Rhythm) is set to **US Dollars** everywhere a human can see — the brand, the event (FIFA Grill Night), the cart. But the actual money charge is built in **British Pounds**. On the buyer **web** flow that produced the "£ at the last step" you saw — and a real **£10 charge completed** instead of the intended $10 (an overcharge). On the **consumer native** app the same wrong-currency charge is rejected by Stripe with a 400 error → the "payment intent error."

It is **one root cause with two faces**. It did not exist with test keys because the test connected account's currency happened to line up; the live account is USD and exposed the gap.

---

## 2. The single root cause

`brands.pricing_currency` (and `brands.pricing_region`) is the **authoritative charge currency** — `resolve_event_pricing_inputs()` returns it, and BOTH the web Checkout Session and the native PaymentIntent are built from it (`ticket-checkout-create/index.ts` L862–875, L1042–1149 web, L1565–1627 native).

That column:
- has a hard SQL **default of `'GBP'`** (`pricing_region` defaults to `'GB'`) — `20260802000000_orch_1006_pricing_switches.sql` L40.
- is set from `default_currency` **only once**, by the one-time backfill UPDATE in `20260816000000_orch_1034_currency_de_gbp.sql` L55–59.
- is **never written by any forward code path** — not by brand creation, and critically not by `brand-stripe-refresh-status` (which DOES sync `default_currency` + `country` from the live Stripe account, L184–250, but leaves `pricing_currency`/`pricing_region` untouched).

So any brand **created or Stripe-onboarded after the one-time backfill** keeps `pricing_currency='GBP'` regardless of its real `default_currency`. ORCH-1034 fixed the *existing rows* and dropped the GBP-only CHECK constraint, but never closed the *forward* hole (column default + missing sync). This is a one-owner-per-truth (Constitution #2) + currency-aware (Constitution #10) violation: two columns claim "the brand's currency" and only one is kept correct.

---

## 3. Live evidence (production DB `gqnoajqerqhnvulmnyvv`, 2026-06-26)

Brand `1ce63bf4-1a33-4309-ab0b-ec23343e3569` (Smoke & Rhythm):

| field | value |
|---|---|
| default_currency | **USD** (synced from live Stripe account) |
| pricing_currency | **GBP** ← charge currency |
| pricing_region | GB |
| stripe_charges_enabled | true (account fully onboarded — NOT an onboarding gap) |
| stripe_connect_id | acct_1Tml2YI4pBxuXrhh |
| created_at | 2026-06-27 (after the ORCH-1034 backfill) |

Event `de1211d0-…` (FIFA Grill Night): `event_currency=USD`, charges resolve to brand `pricing_currency=GBP`.

Checkout sessions for this brand:
- `failed` — `failure_reason = stripe_payment_intent_create_failed:400:stripe_request_or_account_config:payment_intent_invalid_parameter:StripeInvalidRequestError` (the native PI error).
- `paid_completed` — `total_cents=1000` → **a £10.00 charge actually settled** (intended $10.00 → overcharge ≈ +27%).

Migration state: `schema_migrations` shows `20260816000000 orch_1034_currency_de_gbp` IS applied. The GBP-only `brands_pricing_currency_allowlist` CHECK is dropped; `brands_pricing_region_allowlist` now allows GB/US/EU/CH/NG. **Column defaults remain `'GBP'`/`'GB'`.**

> NOTE: memory `project_orch_1034_currency_de_gbp_scope` says ORCH-1034 "not started" — that is STALE. The migration + edge-function de-GBP logic shipped; what was missed is the forward sync. Memory to be corrected on close.

---

## 4. Why native errors but web "only" shows pounds

Same wrong currency (GBP), two Stripe call shapes:
- **Web** = `checkout.sessions.create` (Stripe-hosted, auto-selects payment methods) → accepted, rendered the GBP page, charge completed.
- **Native** = `paymentIntents.create` with an explicit `payment_method_types` allowlist (`card` + `link`) + `application_fee_amount` direct-charge on the US account → Stripe 400 `payment_intent_invalid_parameter`. (Exact rejecting parameter — likely the GBP×Link or GBP×US-direct-charge combo — to be confirmed against live Stripe logs in SPEC via the stripe skill; it is secondary, because the fix is to charge in USD, which is unconditionally valid on a US account.)

Fixing `pricing_currency=USD` resolves BOTH: stops the overcharge AND makes the native PI valid.

---

## 5. Latent blast radius — CONFIRMED universal across paid surfaces

Every paid flow resolves currency from the same `pricing.pricing_currency`:

| Surface | Path | Status |
|---|---|---|
| Events / tickets | `ticket-checkout-create` | BROKEN for non-GBP brand |
| Trips | `ticket-checkout-create` (event_type='trip') | BROKEN (same fn) |
| Experiences | `ticket-checkout-create` (experiences are events) | BROKEN (same fn) |
| Reservations | `venue-reservation-create` L303 reads same `pricing.pricing_currency` | BROKEN (same source) |

Consumer **native AND** buyer **web** both affected (both read the resolver).

**Brand-level blast radius (live):** of 9 brands, exactly **1 has a Stripe account — and that 1 is the mismatched one → 100% of transactable brands are currently broken.** Every future non-GBP brand will hit this the moment it onboards Stripe.

---

## 6. Recommended fix (for SPEC/IMPLEMENT)

**A. Immediate data hotfix (stops the live overcharge now):** re-run the ORCH-1034 alignment for drifted rows —
`UPDATE brands SET pricing_currency=upper(trim(default_currency::text)), pricing_region=<derived> WHERE default_currency IS NOT NULL AND upper(trim(default_currency::text)) IS DISTINCT FROM pricing_currency;`
(idempotent; safe-migration protocol; one row affected today.)

**B. Structural root fix (closes the forward hole — the real fix):**
1. In `brand-stripe-refresh-status`, set `pricing_currency` + `pricing_region` in lockstep wherever it writes `default_currency` from the Stripe account.
2. Make the DB enforce single-owner: a `BEFORE INSERT/UPDATE` trigger on `brands` that derives `pricing_currency`/`pricing_region` from `default_currency` (or drop the misleading `'GBP'` column default). One owner per truth.
3. CI guard (strict-grep) so no future code can write `default_currency` without the paired currency/region sync.

**C. Refund/remediation:** the completed £10 charge needs an operator decision (refund the FX delta or full refund + re-charge in USD).

---

## 7. Five-truth-layer reconciliation

- **Docs/registry:** said ORCH-1034 "not started" → STALE; partially shipped.
- **Schema:** GBP-only CHECK dropped ✓, but column default still GBP ✗.
- **Code:** edge fns charge in pricing_currency ✓; refresh-status syncs default_currency but NOT pricing_currency ✗ (the hole).
- **Runtime:** native PI 400 invalid_parameter; web GBP page rendered.
- **Data:** Smoke & Rhythm default=USD / pricing=GBP; one £10 overcharge settled.
All five now agree on the mechanism.
