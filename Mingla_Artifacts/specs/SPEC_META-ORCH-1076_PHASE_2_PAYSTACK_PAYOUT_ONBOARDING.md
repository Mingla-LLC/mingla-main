# SPEC — META-ORCH-1076 Phase 2: Paystack Brand Payout Onboarding (Nigeria)

**Status:** APPROVED (operator: "phase 2 lets proceed", 2026-06-04)
**Builds on:** Phase 1 (PR #364, `ed3dd5732`) — buyer checkout shipped; the checkout
arm already carries a **deferred split** (ticket-checkout-create:763–771) that fires
ONLY when `brands.paystack_subaccount_code` is non-null. Phase 2 fills that column.
**Affected Surfaces:** Business iOS (payout onboarding form + readiness state) +
backend (edge function + `_shared/paystack.ts`). Explicitly NOT in scope: consumer
apps (no seller surface), admin-web (Phase 4 ops), buyer-web (unchanged).

---

## 1. Goal (plain English)

A Nigerian business connects its bank account inside Mingla Business and becomes able
to receive money: every paid sale then auto-settles to that bank (T+1), with Mingla's
cut skimmed at charge time. No Stripe brand is touched. After Phase 2, a real NG brand
can self-onboard — the manual `payment_provider='paystack'` flag from Phase 1 is gone.

## 2. What already exists (do NOT rebuild)

- `brands.payment_provider` ('stripe'|'paystack', default 'stripe'), `brands.payment_country`,
  `brands.paystack_subaccount_code` (nullable) — added in migration `20260915`.
- Checkout deferred split: when `paystack_subaccount_code` is set, `transaction/initialize`
  passes `subaccount` + `transactionChargeSubunits: psApplicationFeeCents` (= the engine's
  `miglaFeeCents`, flat kobo). This OVERRIDES the subaccount `percentage_charge` per txn.
- `_shared/paystack.ts`: mode/key resolver, initialize, verify, HMAC-SHA512 signature.
- All-in engine: `application_fee_amount_cents = miglaFeeCents` is the take-rate skim.

## 3. The provider-routing trigger (locked)

The **country picker at payout onboarding** decides the rail (already how Stripe works —
`BrandOnboardView` has a country picker; Stripe's allowlist excludes Nigeria). Rule:

- Brand selects **Nigeria** at payout setup → **Paystack** subaccount flow; on subaccount
  create, set `payment_provider='paystack'`, `payment_country='NG'`, store `paystack_subaccount_code`.
- Any other country → existing Stripe Connect flow, byte-for-byte unchanged.

This is purely additive: Stripe Connect cannot pay out to NG, so zero existing brands
can flip. A Stripe-active brand can never reach the Paystack branch.

## 4. Backend

### 4.1 `_shared/paystack.ts` additions (doc-cited)
- `paystackListBanks({ country, currency, type })` → `GET /bank?country=nigeria&currency=NGN&type=nuban`
  ([Miscellaneous API](https://paystack.com/docs/api/miscellaneous/#bank)). Returns `[{name, code, ...}]`.
- `paystackResolveAccount({ accountNumber, bankCode })` → `GET /bank/resolve?account_number=&bank_code=`
  ([Verification API](https://paystack.com/docs/api/verification/#resolve-account)). Returns `{account_name, account_number}`.
- `paystackCreateSubaccount({ businessName, settlementBank, accountNumber, percentageCharge })`
  → `POST /subaccount` ([Subaccount API](https://paystack.com/docs/api/subaccount/)). Returns `{subaccount_code, is_verified, ...}`.
- `paystackFetchSubaccount(codeOrId)` → `GET /subaccount/{id_or_code}` (readiness re-poll).

All send `Authorization: Bearer <resolvePaystackSecretKey()>`; secret stays server-side.

### 4.2 New edge function `brand-paystack-onboard` (verify_jwt = **true**)
Multiplexed by `action` (mirrors the tight Stripe family but one deploy/config surface):
- `action:"list_banks"` → returns the NG NUBAN bank list for the picker. Requires a valid
  JWT (any authenticated business user); not brand-scoped (static list).
- `action:"resolve_account"` `{ account_number, bank_code }` → verified `account_name`.
  Requires `biz_can_manage_payments_for_brand(brand_id, user_id)` (same gate as Stripe onboard).
- `action:"create_subaccount"` `{ brand_id, account_number, bank_code }` → resolves name,
  `POST /subaccount` with `business_name = brand.name`, `settlement_bank = bank_code`,
  `account_number`, `percentage_charge = <Mingla take-rate %>` (fallback only; per-txn flat
  `transaction_charge` overrides it). On success, UPDATE the brand:
  `paystack_subaccount_code`, `payment_provider='paystack'`, `payment_country='NG'`.
  `writeAudit('paystack.subaccount.created', ...)`. Gate: `biz_can_manage_payments_for_brand`.
- `action:"refresh_status"` `{ brand_id }` → `GET /subaccount/{code}`; returns
  `{ connected: bool, is_verified: bool, settlement_bank, account_number_masked }`.

`percentage_charge` value: set to the same take-rate the engine uses for `miglaFee`
(read the brand/config take-rate bps → percent). Because checkout always passes the flat
`transaction_charge`, this is a belt-and-suspenders default; never the live economics.

### 4.3 config.toml + secret
- Add `[functions.brand-paystack-onboard]` (verify_jwt default true). Reuses the existing
  `PAYSTACK_SECRET_KEY_TEST` secret (no new secret — 100-cap respected).

### 4.4 Migration
- None required for columns (Phase 1 added them). If a take-rate source column is needed
  it already exists on the brand/pricing config; no schema change anticipated. If any RPC
  is needed to read brand take-rate for the function, prefer reading columns directly via
  service-role select (no new migration). **Target: zero new migration.**

## 5. Business iOS UI

### 5.1 Brand type + query
- Add to the Brand type + `useBrand` select: `paymentProvider` ('stripe'|'paystack'),
  `paystackSubaccountCode` (string|null), `paymentCountry`.

### 5.2 `BrandPaymentsView` branch
- When `paymentProvider === 'paystack'` (or selected country = Nigeria at a fresh setup):
  render the Paystack onboarding banner + (when connected) a "Bank connected · settles to
  ****1234 · T+1" readiness card, instead of the Stripe Connect CTA. Stripe brands unchanged.

### 5.3 New `BrandPaystackOnboardView` (mirrors `BrandOnboardView` house style)
Bank-details form using shared `Input`/`Button`/`GlassCard`:
1. Bank picker (from `list_banks`) — searchable select.
2. Account-number input (10-digit NUBAN).
3. On blur/valid → `resolve_account` → show verified `account_name` (read-only confirm).
   Paystack disclaims wrong-account liability → name confirmation is mandatory before submit.
4. "Connect bank & get paid" → `create_subaccount` → success state → invalidate brand query.
- Loading/error states match `BrandOnboardView`. Android opaque-glass policy honored via
  existing GlassCard (no new translucent fills).

### 5.4 Service + hooks
- `brandPaystackService.ts` mirroring `brandStripeService.ts`: `listPaystackBanks()`,
  `resolvePaystackAccount()`, `createPaystackSubaccount()`, `refreshPaystackStatus()` —
  all via `supabase.functions.invoke("brand-paystack-onboard", { body: { action, ... }})`.
- `useBrandPaystackStatus(brandId)` (query) + `useCreatePaystackSubaccount()` (mutation,
  invalidates brand + status). `useBrandBanks(country)` for the picker list.

## 6. Sequencing (de-risk: prove the money rail before the UI)

**6A — Backend first.** Build §4, deploy, then via the function (service-role/manual call)
create a REAL test subaccount for the Phase-1 test NG brand, run a checkout, and confirm in
the Paystack dashboard that the charge split routed Mingla's cut to the main account and the
remainder to the subaccount. This proves Phase 2's core value at the API level.

**6B — UI second.** Build §5 once the rail is proven; hand Seth a dev-build link to onboard
a bank end-to-end on device.

## 7. Success criteria

1. A NG brand with no provider can complete the bank-details form and get a
   `paystack_subaccount_code`; `payment_provider` flips to 'paystack'.
2. A subsequent checkout for that brand splits: Mingla's flat cut → main account, remainder
   → brand subaccount (verified in Paystack test dashboard).
3. Every Stripe brand's payments tab + onboarding is byte-for-byte unchanged.
4. `biz_can_manage_payments_for_brand` gates resolve + create (no cross-brand onboarding).
5. Deno tests green; strict-grep C7 backend allowlist updated same-commit; docs URLs inline.

## 8. Out of scope (later phases)
- Refunds (Phase 3), disputes + installments + KYC ops (Phase 4), settlement/balance
  dashboard tiles (can be a Phase-2 follow-on; minimal readiness card only here), Ghana.
