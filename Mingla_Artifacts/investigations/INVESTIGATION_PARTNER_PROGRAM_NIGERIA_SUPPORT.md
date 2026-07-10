# INVESTIGATION — Does the Mingla partner program work for a Nigerian partner + Nigerian (NGN) brand?

**Date:** 2026-07-10
**Mode:** INVESTIGATE (read-only; no code proposed)
**Scope question:** Does the partner program — the partner "add a bank" step and the money flow — actually work when the **partner is in Nigeria** AND they set up a **Nigerian brand (NGN)**?

---

## BOTTOM LINE

**No. The partner program is fundamentally non-functional for a Nigerian partner and/or a Nigerian (NGN) brand.** It is a **Stripe-only rail** bolted onto a codebase where Nigeria settles exclusively through **Paystack**. The two never meet. A Nigerian partner cannot connect a bank (Stripe Connect has no Nigeria), and even if one somehow could, a Nigerian brand's sales run through Paystack and **never emit the Stripe `charge.succeeded` event that is the sole trigger for a partner split**. The brand owner still gets paid (via Paystack); the **partner earns nothing and the lifecycle never advances past `awaiting_stripe`**.

Two failure modes matter for Seth: some legs **hard-error** (good — visible), but the money leg **fails silently** (bad — the partner just never gets paid, with no error anywhere).

---

## Investigation manifest (files read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `supabase/functions/_shared/stripeSupportedCountries.ts` | shared | Stripe country allowlist (NG present?) |
| 2 | `mingla-business/src/constants/stripeSupportedCountries.ts` | client | Frontend mirror feeding the picker |
| 3 | `supabase/functions/partner-stripe-onboard/index.ts` | edge | Partner bank-add entry; country validation |
| 4 | `supabase/functions/partner-stripe-account-session/index.ts` | edge | Re-mint session (no re-validation) |
| 5 | `supabase/functions/_shared/partnerSplits.ts` | shared | The split engine (Stripe Transfer) |
| 6 | `supabase/functions/_shared/stripeWebhookRouter.ts` | shared | Where `charge.succeeded` → split is wired |
| 7 | `supabase/functions/accept-brand-invitation/index.ts` | edge | Owner accept; P0006 currency-mismatch mapping |
| 8 | `supabase/migrations/20260822000000_orch_1052_partner_identity_stripe.sql` | schema | `partner_can_accept_brand` + accept-gate (as added) |
| 9 | `supabase/migrations/20260920000000_orch_1081_partner_brand_links.sql` | schema | `partner_brand_links` + triggers + accept RPC re-create |
| 10 | `supabase/migrations/20260920000001_orch_1081_unblock_brand_owner_transfer.sql` | schema | Accept RPC hotfix (latest-but-one) |
| 11 | `supabase/migrations/20260924000000` + `20260926000000` (ORCH-1111) | schema | **LATEST** accept RPC definitions |
| 12 | `supabase/functions/_shared/paymentProvider.ts` | shared | NGN → Paystack routing spine |
| 13 | `supabase/functions/brand-paystack-onboard/index.ts` | edge | NGN owner payout onboarding (subaccount) |
| 14 | `supabase/functions/_shared/paystackWebhookRouter.ts` + `paystack-webhook` + `paystack-checkout-create` | edge | NGN sale path (`charge.success`, no split) |
| 15 | `mingla-business/app/partner/earnings.tsx` | client | Partner onboarding UI / country picker usage |
| 16 | `mingla-business/src/components/brand/BrandStripeCountryPicker.tsx` | client | Picker options source |
| 17 | `mingla-business/src/services/brandStripeCountriesService.ts`, `partnerStripeService.ts`, `usePartnerStripe.ts` | client | Country list source + onboard call |
| 18 | `mingla-business/src/components/brand/BrandCreationFlow.tsx` | client | `partner_setup=true` brand creation |
| 19 | migration `20260915000000_meta_orch_1076_p1_payment_provider.sql` | schema | NGN brand columns + the "no NG on Stripe" constraint |

---

## Q-scorecard

### Q1 — Can a Nigerian partner connect their own bank to receive splits?
**Verdict: NO — hard-blocked at TWO layers (client picker + edge validation). `proven` (source-traced, both layers).**

- **Client (picker cannot offer Nigeria).** `mingla-business/app/partner/earnings.tsx:756-761` renders `<BrandStripeCountryPicker>` with **no `extraOptions`** prop. The picker's option list is `useBrandStripeCountries()` → `fetchBrandStripeCountries()` → `STRIPE_SUPPORTED_COUNTRIES` (`brandStripeCountriesService.ts:24-30`), which is the **34-country US/GB/CA/CH + EU/EEA allowlist with no NG** (`mingla-business/src/constants/stripeSupportedCountries.ts:29-64`). The picker's `extraOptions` slot (the ONLY way Nigeria could appear, per `BrandStripeCountryPicker.tsx:61-71`) is left at its default `[]`. On-screen copy: *"Mingla pays partners through Stripe Connect"* (`earnings.tsx:751`). The CTA reads *"Pick a country first"* until a country is chosen (`earnings.tsx:772-774`). **A Nigerian partner literally cannot select Nigeria.**
- **Edge (defence-in-depth hard error).** Even if `country:"NG"` were POSTed, `partner-stripe-onboard/index.ts:152-158` calls `normalizeStripeCountry(body.country)`; `stripeSupportedCountries.ts:47-51` returns `null` for `"NG"` (not in `COUNTRY_BY_CODE`) → HTTP **400 `{error:"validation_error", detail:"country_unsupported"}`**. This surfaces as inline `startError` text (`earnings.tsx:257`). **Hard error, not silent.**
- There is **no Paystack path for partner identity**. `partnerStripeService.ts` only calls `partner-stripe-onboard` / `partner-stripe-account-session` (both Stripe). Grep across `supabase/functions/**` found **zero files coupling `partner` + `paystack`**, and no `partnerPaystackService` in the client.

### Q2 — For an NGN brand's sales, can a partner split ever fire?
**Verdict: NO — structural rail mismatch. An NGN sale never produces the Stripe event that triggers a split. `proven` (source-traced end-to-end).**

- An NGN brand is `payment_provider='paystack'`, `pricing_currency='NGN'`, `payment_country='Nigeria'` (`paymentProvider.ts:43-55`; `brand-paystack-onboard/index.ts:17-19,132`).
- **NGN sale path:** `paystack-checkout-create` → Paystack transaction with `subaccount` split + `transaction_charge` + `bearer` (`paystack-checkout-create/index.ts:63-65`) → `paystack-webhook` → `paystackWebhookRouter` handles the Paystack event **`charge.success`** (note: NOT Stripe's `charge.succeeded`) → finalize via `biz_ticket_checkout_finalize` (`paystackWebhookRouter.ts:3-8`). The brand/owner gets paid; Mingla's fee is taken via the Paystack split.
- **The split engine is Stripe-only.** `partnerSplits.handleChargeSucceeded` is invoked from exactly ONE place: `stripeWebhookRouter.ts:1519-1521`, on the Stripe **`charge.succeeded`** event. It requires `charge.application_fee` + `application_fee_amount` (`partnerSplits.ts:227-233`) — a Stripe-Connect concept Paystack does not have — and then performs a **Stripe Transfer** (`partnerSplits.ts:326-344`).
- **Proof of no coupling:** `paystack-webhook/index.ts` contains **zero** references to `charge.succeeded`, `application_fee`, `partnerSplits`, `handleChargeSucceeded`, or `Transfer`. `paystackWebhookRouter.ts` has no partner/split logic (only a comment that it "mirrors the Stripe router").
- **Consequence:** an NGN Paystack sale **never** calls `handleChargeSucceeded`, so **no `partner_splits` row is ever created and `first_split_at` is never stamped** — even if the partner were fully Stripe-connected. **Fails silently: no error, the partner simply never gets paid.**

### Q3 — How does the invited Nigerian owner connect a bank, and does `owner_stripe_connected_at` ever get set?
**Verdict: Owner gets paid via Paystack, BUT the partner-lifecycle field `owner_stripe_connected_at` is NEVER stamped for a Paystack owner. `proven`.**

- The NGN owner's payout onboarding is `brand-paystack-onboard` (`action=create_subaccount`): it creates a Paystack subaccount and writes `brands.paystack_subaccount_code` + `payment_provider='paystack'` + `payment_country='Nigeria'` (`brand-paystack-onboard/index.ts:17-19,195-205`). It does **not** write `stripe_connect_accounts`.
- The ORCH-1081 trigger that stamps `partner_brand_links.owner_stripe_connected_at` fires **only** on `stripe_connect_accounts.charges_enabled` flipping to `true` (`20260920000000_orch_1081_partner_brand_links.sql:182-207`, `AFTER UPDATE OF charges_enabled ON public.stripe_connect_accounts`). A Paystack owner has **no** `stripe_connect_accounts` row, so the trigger never fires.
- **Consequence:** for a Paystack/NGN owner, `owner_stripe_connected_at` stays `NULL` forever. Per `partner_brand_link_status` (`…1081…:95-109`), with `accepted_at` set but `owner_stripe_connected_at` NULL the link is stuck at **`awaiting_stripe`** indefinitely.

### Q4 — What does the currency-match accept gate actually do for an NGN brand?
**Verdict: NOTHING — the partner currency-match gate is DEAD in the live accept RPC. It was silently removed after ORCH-1052. `proven` (full migration-chain trace).**

This **corrects a stated premise.** The orchestrator's "confirmed fact" that *"`partner_can_accept_brand` applies only when the accepting account is a flagged partner"* describes the **ORCH-1052 code, which is no longer live.**

Migration chain for `accept_invite_and_transfer_brand_ownership` (lexicographic apply order):

| Order | Migration | Calls `partner_can_accept_brand` / raises P0006? |
|-------|-----------|--------------------------------------------------|
| 1 | `20260820000000` ORCH-1050 | No (predates the gate) |
| 2 | `20260822000000` ORCH-1052 | **YES** — gate added (`:290-306`) |
| 3 | `20260920000000` ORCH-1081 links | **No** — re-created "byte-for-byte equivalent to the ORCH-1050 definition" (`:213-215`) → **gate dropped** |
| 4 | `20260920000001` ORCH-1081 hotfix | No |
| 5 | `20260924000000` ORCH-1111 declined | No |
| 6 | **`20260926000000` ORCH-1111 oauth (LATEST/LIVE)** | **No** |

Grep proof: across `supabase/migrations/*.sql`, the **only** file that calls `partner_can_accept_brand` OR raises `P0006 invite_currency_mismatch` is `20260822000000` (ORCH-1052). Every later re-creation of the RPC omits it. `partner_can_accept_brand()` still exists as a function but is **orphaned** — nothing calls it.

- **Therefore, for an NGN brand (or ANY brand), the accept RPC does NOT raise `invite_currency_mismatch` in any case** — not for a non-partner owner, not for a flagged partner. The accept simply succeeds (subject to the normal email/expiry/status guards).
- The edge function's P0006→409 mapping (`accept-brand-invitation/index.ts:111-112,280-291`) is now **unreachable via the RPC**. The regression test `orch-1052-currency-gate.test.ts` is **pure-logic** — it only asserts `mapRpcError` / `parsePartnerGateDetail` on a *hypothetical* P0006, and never exercises the RPC — so it could not catch the removal.
- **Net for the Nigerian scenario:** the realistic actor (a normal, non-partner Nigerian business owner) **can accept the brand** — this was true under both the old design and the current reality, so the accept leg itself **works**. The gate removal is orthogonal to the payment-rail break, but it is a genuine latent regression worth registering (see Discoveries).

### Q5 — Net verdict per sub-scenario
See the verdict table below.

### Q6 — What would it take to support NG?
**Verdict: This is NOT an allowlist tweak. The entire partner-split rail would need a Paystack-native equivalent that does not exist today. `proven` (architectural).**

- Adding `NG` to `STRIPE_SUPPORTED_COUNTRIES` would be actively wrong: Stripe Connect does not pay out to Nigeria (the codebase states this explicitly — `20260915000000_…payment_provider.sql:15`: *"There are no pre-existing NG/NGN brands (Stripe Connect does not pay out…)"*).
- To pay a Nigerian partner on a Nigerian brand, Mingla would need, net-new: (a) a **partner Paystack identity** (subaccount) parallel to `partner_stripe_connect_accounts`; (b) a **Paystack split/transfer mechanism** — Paystack "split payments" / multi-subaccount splits or a Transfer to the partner's subaccount — wired into `paystackWebhookRouter` on `charge.success`, mirroring `partnerSplits.handleChargeSucceeded`; (c) the `partner_brand_links` triggers rewired to also fire off the Paystack subaccount/settlement events; (d) the partner onboarding UI to offer Nigeria (`extraOptions`) and route to a Paystack partner-onboard function. None of this exists — grep confirms **zero** partner⇄Paystack coupling anywhere in `supabase/functions/`.

---

## Per-sub-scenario verdict table

| Sub-scenario | Verdict | Mechanism (file:line) |
|---|---|---|
| **(a) Nigerian partner adds their OWN bank** | **BROKEN — hard block** | Picker has no NG (`earnings.tsx:756-761` → `STRIPE_SUPPORTED_COUNTRIES`, no NG `stripeSupportedCountries.ts:29-64`); edge 400 `country_unsupported` (`partner-stripe-onboard/index.ts:152-158`). No Paystack partner path exists. |
| **(b) NGN brand's customer payments feed a split** | **BROKEN — fails silently** | NGN sale = Paystack `charge.success` → `biz_ticket_checkout_finalize` (`paystackWebhookRouter.ts:3-8`); split engine only runs on Stripe `charge.succeeded` needing `application_fee` (`stripeWebhookRouter.ts:1519-1521`, `partnerSplits.ts:227-233`). No `partner_splits` row ever created. |
| **(c) Nigerian invited owner adds their bank** | **PARTIALLY WORKS** — owner is paid (Paystack), but partner lifecycle stalls | Owner onboards Paystack subaccount (`brand-paystack-onboard/index.ts:195-205`), not `stripe_connect_accounts`; `owner_stripe_connected_at` trigger only fires on `stripe_connect_accounts.charges_enabled` (`…1081…:189-207`) → never stamped. |
| **(d) `partner_brand_links` reaches `first_split_at` for NG** | **BROKEN — never** | `first_split_at` set only by trigger on `partner_splits` transition to `transferred` (`…1081…:117-172`); no `partner_splits` row is ever created for an NGN Paystack sale (see (b)). Link is frozen at `awaiting_stripe`. |
| **(e) [bonus] Nigerian owner ACCEPTS the partner-built brand** | **WORKS** | Accept RPC succeeds; the ORCH-1052 currency gate is no longer wired in the live RPC (`20260926000000` is gate-free; only `20260822000000` ever called `partner_can_accept_brand`). |

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | Partner program spec (ORCH-1052/1054/1081) assumes Stripe Connect + `charge.succeeded` splits. `earnings.tsx` copy: "Mingla pays partners through Stripe Connect." | Consistent with code; blind to the Paystack/NGN arm. |
| **Schema** | `partner_stripe_connect_accounts` (Stripe-keyed); `partner_brand_links` triggers keyed on `stripe_connect_accounts` + `partner_splits`. `brands.payment_provider` allows `paystack`. | **The two schemas are disjoint** — no bridge between the Paystack brand columns and the partner-split tables. |
| **Code** | Split engine wired ONLY into `stripeWebhookRouter` on `charge.succeeded`; Paystack router has no split. Partner onboard hard-rejects non-Stripe countries. | **Gate contradiction:** ORCH-1052 code raises P0006; live RPC (ORCH-1111) does not. Latest migration wins → gate is dead. |
| **Runtime** | Not executed (backend/SQL/edge scope; no reproducer requiring sim). Source-traced end-to-end. | — |
| **Data** | Not queried (read-only static trace sufficient; no live NG partner/brand needed to prove the structural break). | — |

Confidence: **`proven` for the code/schema mechanism** (every leg traced to file:line across all layers, migration chain fully resolved). No live-fire needed — the breakage is structural (a missing rail), not a runtime/UI reproducer.

---

## Discoveries for Orchestrator (side issues — register these)

1. **[REGRESSION] The ORCH-1052 partner currency-match invite gate is DEAD in the live accept RPC.** ORCH-1081's re-creation of `accept_invite_and_transfer_brand_ownership` (`20260920000000`, then `…000001`, then ORCH-1111 `20260924/20260926`) silently dropped the `partner_can_accept_brand` call + `P0006` raise that ORCH-1052 added. The current live RPC (`20260926000000_orch_1111_oauth_null_email_accept.sql`) never calls the gate. `partner_can_accept_brand()` is now orphaned. Impact: a flagged partner can accept a brand whose currency their Stripe account can't settle (the exact case ORCH-1052 meant to block). The pinning test `orch-1052-currency-gate.test.ts` is pure-logic and cannot catch this. This is the ORCH-0410 migration-chain hazard recurring. **This is a cross-ORCH discovery (ORCH-1052/1081/1111 integrity); recommend an orchestrator COMMS-ledger entry** — I did not write it myself because this dispatch is read-only / no-commit.
2. **The partner program has no Nigeria strategy at all.** It is Stripe-only by construction; the Paystack/NGN arm (META-ORCH-1076) was built entirely separately with no partner hooks. Any "partner in Nigeria" or "Nigerian brand" is silently unpayable to the partner. Consider a product gate (hide/disable the partner CTA for NG accounts) so partners are not led into a dead flow.
3. **`partner-stripe-account-session` does not re-validate country** (`partner-stripe-account-session/index.ts` reads `country` from the existing row, `:153`); harmless because it only works after a successful onboard, but noted.

---

## Recommended next phase / scope (direction only — no fix proposed)

- **Product decision first (Seth):** is Nigeria in-scope for the partner program at all? If **no** → a small scoping change to disable/hide the partner onboarding + invite-in-client-mode surfaces for NG partners/brands (prevent the silent dead-end). If **yes** → a full META-ORCH to build a **Paystack partner-split rail** (partner subaccount identity + Paystack split/transfer on `charge.success` + rewired `partner_brand_links` triggers + NG in the partner picker). This is net-new architecture, not a config change.
- **Independently:** register + fix Discovery #1 (dead ORCH-1052 currency gate) — it is a live regression affecting non-NG partners too.
