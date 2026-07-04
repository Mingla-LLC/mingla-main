# INVESTIGATION — META-ORCH-1237 (Admin full-visibility console) — MONEY LAYER

**Domain:** Stripe Connect status · orders/payments · subscriptions · disputes/refunds · claims-as-they-touch-money.
**Phase:** INVESTIGATE (read-only, evidence-backed). No fix proposed.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. All DB reads via MCP `execute_sql` (SELECT-only). No Stripe API calls made (schema + code evidence only).
**COMMS ledger:** scanned on entry. No BLOCK/OPEN row addressed to META-ORCH-1237 or mingla-forensics. COMMS-0061 (WARN, ALL): `gqnoajqerqhnvulmnyvv` is LIVE PROD, DR drills clone-only — no risk here (read-only investigation).

---

## Headline findings

1. **Only ONE money surface is actually built into the admin console today: consumer subscriptions.** `SubscriptionManagementPage.jsx` can grant/revoke a tier **override** and flip a **Global Plus** switch. There is **no admin page** for per-brand Stripe Connect status, orders/payments, refunds, disputes, or payouts. `StripeModePage.jsx` is a *global* test/live env diagnostic (not per-brand, no data). `ClaimsPage.jsx` is venue vetting and touches **zero** money (grep of `pages/ClaimsPage.jsx` for stripe/charges/payout/refund/paystack/orders/payment_status → 0 hits).

2. **Stripe Connect status IS stored and synced, but the admin can only see a thin slice of it.** Full status (`charges_enabled`, `payouts_enabled`, `requirements` jsonb, `detached_at`, `country`, `default_currency`) lives in `public.stripe_connect_accounts` — which has **no platform-admin RLS policy** (only `biz_can_manage_payments_for_brand_for_caller`). A DB trigger mirrors a subset onto `brands` (`stripe_connect_id`, `stripe_charges_enabled`, `stripe_payouts_enabled`, `paystack_subaccount_code`), and `brands` **does** grant admin read via `is_admin_user()`. So an admin can read the two boolean flags + connect id + paystack subaccount code, but **cannot** see *what is blocking onboarding* (`requirements`), the derived status, detached state, or currency without a service-role path.

3. **No admin path exists to refresh, re-onboard, refund, or resolve anything in the money layer.** Every money edge function (`brand-stripe-refresh-status`, `refund-order`, `brand-stripe-onboard`, `brand-stripe-account-session`, `brand-stripe-balances`) authenticates the *caller's JWT* and gates on `biz_can_manage_payments_for_brand(brand_id, user_id)` — which resolves to **brand-admin-plus OR finance_manager only**, with **no `is_admin_user()` bypass**. An admin who is not a team member of that brand gets 403.

4. **Orders, refunds, disputes, payouts, external accounts all lack any platform-admin RLS.** `orders` → `biz_can_read_order_for_caller` (buyer or brand member); `refunds`/`payouts`/`refund_line_items` → `biz_can_manage_payments_for_brand_for_caller`; `stripe_disputes` → service_role + brand payment managers. None grant admin. The admin browser (anon key + authed admin session) reads **nothing** from these tables today.

5. **Inconsistent admin-identity model across money tables.** `brands` uses `is_admin_user()` (email ∈ `admin_users` where status='active'). But `partner_splits` and `partner_stripe_connect_accounts` use `profiles.account_type = 'admin'`. These are two different admin checks; any new admin money RLS must pick one deliberately.

6. **The webhook pipeline is the source of truth and it is complete.** `stripe-webhook` → `routeStripeEvent` (idempotent inbox `payment_webhook_events`, 576 rows) fans 14 Connect + 2 platform events: `account.updated`→syncAccount (writes `stripe_connect_accounts`, mirrors to `brands`), `charge.dispute.*`→persists `stripe_disputes` + reverses partner split, refund family→`refunds`, `application_fee.*`→`mingla_revenue_log` (49 rows), `payout.*`→`payouts`. So the DATA an admin console would surface already exists and is kept fresh — the gap is purely *read/act authorization + UI*, not data capture.

7. **Stripe "mode" is an env var, not a DB toggle — the admin cannot flip it.** `stripe-mode` edge fn returns `resolveStripeMode()`/`resolvePublishablePrefix()` read from `MINGLA_STRIPE_MODE` env (`stripe-mode/index.ts:72-73`). `StripeModePage.jsx` is read-only and points to a manual runbook (lines 249-264). Per project memory, Mingla-side Stripe is currently TEST end-to-end; Paystack is LIVE in prod.

8. **"Subscriptions" here = consumer Mingla+ entitlement, NOT brand/business billing.** `subscriptions.user_id` is a consumer; tiers are `free`/`mingla_plus` (`SubscriptionManagementPage.jsx:40-43`); real billing is RevenueCat ("RC Tier", `raw_tier`). The admin action is a DB entitlement **override** (`admin_subscription_overrides`), not a Stripe/RevenueCat billing action — admin cannot cancel/refund a real paid subscription. Business monetization is take-rate (`platform_pricing_config.default_take_rate_bps` + application fees), which has no admin surface at all.

---

## Stripe Connect status model (with proof)

**Primary table — `public.stripe_connect_accounts`** (1 row live; comment: "Stripe Connect account per brand (B1 §B.6)"). Columns (verified via `information_schema.columns`):
`id, brand_id, stripe_account_id, controller_dashboard_type, charges_enabled (bool), payouts_enabled (bool), requirements (jsonb), country (char), default_currency (char), detached_at, kyc_stall_reminder_sent_at, created_at, updated_at`.

**Derived status** — `pg_derive_brand_stripe_status(p_brand_id)` (SECURITY DEFINER) returns:
- `not_connected` when `detached_at IS NOT NULL` (or no row)
- `restricted` when `requirements->>'disabled_reason'` is non-empty
- `active` when `charges_enabled = true`
- `onboarding` otherwise.

**Mirror — `public.brands`** (admin-readable): `stripe_connect_id (text)`, `stripe_charges_enabled (bool)`, `stripe_payouts_enabled (bool)`, `default_currency (char)`, `pricing_currency (text)`, `paystack_subaccount_code (text)`. A trigger populates these from `stripe_connect_accounts` on update (noted in `brand-stripe-refresh-status/index.ts:183-184`: "trigger mirrors to brands.stripe_* and active SCA default_currency to brands.default_currency"). **NOT mirrored:** `requirements`, `detached_at`, `country`, derived status → these are admin-invisible.

**Related Connect tables:**
- `stripe_external_accounts` (0 rows) — bank accounts/debit cards, `last4`, `status`, `default_for_currency`; populated by `account.external_account.*` webhooks. RLS: brand payment managers SELECT only.
- `partner_stripe_connect_accounts` (0 rows) — per-partner mirror keyed on `creator_accounts.id`; **has** `account_type='admin'` SELECT policy.
- `stripe_country_specs` (0 rows) — reference metadata per Connect country.

**How status is synced (two paths):**
1. **Primary — webhook.** `stripe-webhook/index.ts` verifies signature (`verifyStripeWebhookSignature`, lines 86-105) + IP allowlist (soft-fail, 110-136) + idempotent inbox (`payment_webhook_events`, 138-197), then `routeStripeEvent` (line 201). Router `_shared/stripeWebhookRouter.ts`: `account.updated`→`syncAccount` (case at line 1382; writes SCA charges/payouts/requirements, mirrors brands), `account.external_account.*`→`handleExternalAccount`, `payout.*`→`handlePayout`, `account.application.deauthorized`→`handleDeauthorized`.
2. **Fallback — poll.** `brand-stripe-refresh-status/index.ts` (30s poll-fallback per D-B2-11): auth JWT → `biz_can_manage_payments_for_brand` gate (113-129) → read SCA (132-136) → `stripe.accounts.retrieve` (164) → UPDATE SCA (185-198) → `pg_derive_brand_stripe_status` (209) → audit-log (225). **Gated to brand payment managers — no admin bypass.**

---

## Stripe-mode (with proof)

- `stripe-mode/index.ts` — public, anonymous, read-only. Returns `{ mode, publishablePrefix }` from `resolveStripeMode()`/`resolvePublishablePrefix()` (`_shared/stripeMode.ts`), which read the `MINGLA_STRIPE_MODE` env var. **No DB state, no toggle.** CORS-restricted to business/marketing/vercel/localhost origins.
- `StripeModePage.jsx` — admin diagnostic that (a) fetches backend mode via the public `stripe-mode` fn (33-79), (b) best-effort probes the business web bundle (81-99, always "unverifiable" due to CORS), (c) marks Vercel env "unverifiable client-side" (243-246). Shows green banner when backend resolves; links to `STRIPE_MODE_FLIP_RUNBOOK.md`. **It cannot flip mode** — flip is a manual env/Vercel + new-build operation (250-255). This is the "stripe status" page that exists today, but it is a *global environment* check, not per-brand Connect status.

---

## Orders / payments + refunds (with proof)

**`public.orders`** (2 rows; "Ticket / door orders (B1 §B.4)"). Money-relevant columns: `event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone, total_cents, currency, payment_method, payment_status, stripe_payment_intent_id, stripe_charge_id, stripe_payment_intent_status, stripe_application_fee_amount_cents, stripe_transfer_destination, is_door_sale, source, refunded_amount_cents, tax_amount_cents, tax_calculation_id, at_risk, installment_plan_root, cancelled_at/by/reason, confirmed_at, failed_at, pricing_breakdown (jsonb), tax_breakdown (jsonb)`. Linkage: `event_id`→events→brand; `buyer_user_id`/`buyer_email`; `checkout_session_id`→`ticket_checkout_sessions`.
**Children:** `order_line_items` (2 rows, ticket_type_id/quantity/unit_price), `order_installments` (0 rows; scheduled/collected/failed status machine, ORCH-0869).

**Refund path:**
- `refund-order/index.ts` (561 lines): JWT-context (`supabaseAsUser`, line 154-165) → `biz_refund_order` RPC (165; creates pending refund + line items + **caller permission gate** + stamps `initiated_by`) → Stripe refund → `biz_refund_order_commit` (443; flips `refund.status`, advances `orders.payment_status`). **No admin path; no `is_admin_user()`.** Errors map `permission_denied`→403 (78-79).
- **`public.refunds`** (0 rows; "Refunds linked to orders (B1 §B.6)"): `order_id, stripe_refund_id, amount_cents, currency, reason, initiated_by, status, application_fee_refunded_cents, stripe_charge_id, stripe_payment_intent_id, stripe_tax_transaction_id, processed_at, metadata`. Plus `refund_line_items` (line-level, ORCH-0787 cumulative-quantity guard).
- Webhook side: refund family (`charge.refunded`/`refund.updated`, router 1430-1440) → `handleRefundEvent` reconciles; `application_fee.refunded`→`mingla_revenue_log.refunded`.

**`cancel-order/index.ts`** (176 lines) — buyer/brand order cancellation (separate from refund).

---

## Subscriptions (with proof)

**`public.subscriptions`** (46 rows): `user_id, tier, stripe_customer_id, stripe_subscription_id, current_period_start/end, trial_ends_at, referral_bonus_months, is_active, cancelled_at, referral_bonus_started_at`. **Consumer entitlement** (tiers `free`/`mingla_plus`). RLS: user self read + self update only — **no admin RLS**; admin reads via `admin_list_subscriptions` RPC (SECURITY DEFINER, `SubscriptionManagementPage.jsx:136`).

**`public.admin_subscription_overrides`** (0 rows): `user_id, tier, reason, granted_by, starts_at, expires_at, revoked_at`. RLS: user self read only; admin writes via RPCs.

**What admin can see/do today (`SubscriptionManagementPage.jsx`):**
- List/search/paginate users with `effective_tier` vs `raw_tier` (RC), override state, trial end (via `admin_list_subscriptions`, 125-156).
- Stats via `admin_subscription_stats` (160-209).
- **Grant override** → `admin_grant_override(p_user_id, p_tier, p_reason, p_granted_by, p_duration_days)` (298-306); reason required.
- **Revoke override** → `admin_get_override_history` + `admin_revoke_override` (327-341).
- **Global Plus toggle** → writes `app_config.global_plus_access` (253-256) — grants *all* users Mingla+.
- Override history modal (363), CSV export (378-392).

**What admin CANNOT do:** cancel/refund a real paid subscription (no Stripe/RevenueCat action — override is a DB entitlement shim only); see brand/business billing (none exists as a subscription).

---

## Disputes (with proof)

**`public.stripe_disputes`** (0 rows): `stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, stripe_account_id, brand_id, order_id, amount, currency, status, reason, evidence_due_by, is_charge_refundable, raw_event (jsonb)`.
**Webhook routing (confirms memory "dispute events routed + persisted"):** `charge.dispute.created/updated/closed` (router cases 1490-1494) → `_shared/stripeDisputeHandlers.ts` persists to `stripe_disputes`; ORCH-1054 also reverses the partner split (TransferReversal) on dispute.
**RLS:** `service_role ALL` + `brand_payment_managers_select_stripe_disputes` (owner/admin/finance_manager SELECT). **No platform-admin policy → admin cannot see any dispute.** No admin UI, no evidence-submission path.

---

## Claims-money (with proof)

**Verdict: claims are NOT money-adjacent.** `adminClaimsService.js` operates entirely on `brands.claim_status` (pending_review/verified/rejected) + linked `place_pool` vetting/scoring. Admin actions: `mark_called`, `approve`, `reject`, `need_more_info`, `tweak_fields`, `score_override`, `score_place_preview`, `set_place_score`, `pin_place_score` — all routed through the `admin-review-venue-claim` service-role edge fn (`is_admin`-gated + audit-logged) or direct SECURITY DEFINER RPCs (`admin_get_claim_review_bundle`, `admin_place_deck_rank`). **Zero** references to stripe/charges/payouts/refund/payment/paystack (grep of both `ClaimsPage.jsx` and `adminClaimsService.js`). Approving a claim makes a venue **servable in the deck** — it does **not** enable Stripe charges or touch any payment table. (Note: per project memory META-ORCH-1255 moved venue identity/claim to `venue_listings`; the current `ClaimsPage` still queries `brands.claim_status`.)

---

## RLS / authz per money table

| Table | Admin can read? | Admin can write? | Policy (evidence) |
|---|---|---|---|
| `stripe_connect_accounts` | **NO** | **NO** | only `biz_can_manage_payments_for_brand_for_caller(brand_id)` (ALL) |
| `brands` (stripe mirror cols) | **YES** | **YES** | `is_admin_user()` SELECT + UPDATE ("Admins can read/update brands…") |
| `orders` | **NO** | **NO** | SELECT `biz_can_read_order_for_caller`; write `biz_can_manage_orders_for_event_for_caller` |
| `order_line_items` | **NO** | **NO** | inherits order (finance-plus) |
| `order_installments` | **NO** | **NO** | brand member OR buyer SELECT |
| `refunds` | **NO** | **NO** | `biz_can_manage_payments_for_brand_for_caller` (ALL) + owner SELECT |
| `refund_line_items` | **NO** | **NO** | inherits refund |
| `payouts` | **NO** | **NO** | `biz_can_manage_payments_for_brand_for_caller` (ALL) |
| `stripe_disputes` | **NO** | **NO** (svc only) | service_role ALL + brand payment managers SELECT |
| `stripe_external_accounts` | **NO** | **NO** | brand payment managers SELECT |
| `partner_splits` | **YES** | NO (SELECT) | `profiles.account_type='admin'` SELECT |
| `partner_stripe_connect_accounts` | **YES** | NO (SELECT) | `profiles.account_type='admin'` SELECT |
| `subscriptions` | via RPC | via RPC | user self only; admin_* SECURITY DEFINER RPCs |
| `admin_subscription_overrides` | via RPC | via RPC | user self read; admin_* RPCs |
| `mingla_revenue_log` | (not checked for admin policy; app-fee mirror) | — | webhook-written |
| `payment_webhook_events` | **NO** | **NO** | RLS enabled, NO policy = service_role only (by design) |
| `platform_pricing_config` | **NO** | **NO** | `service_role ALL` only |

**How the 3 existing admin money-pages authorize:**
- **StripeMode:** none — hits public `stripe-mode` edge fn (anon).
- **Subscription:** SECURITY DEFINER RPCs (`admin_list_subscriptions`, `admin_grant_override`, `admin_revoke_override`) that self-gate on admin; `app_config` written directly (relies on `app_config` RLS).
- **Claims:** `admin-review-venue-claim` service-role edge fn (`is_admin`-gated) + `is_admin_user()`-gated SECURITY DEFINER RPCs.

Pattern: **privileged admin money reads/writes go through a service-role edge fn or an `is_admin`-gated SECURITY DEFINER RPC — never a direct admin RLS grant on the money table** (except brands + the two partner_* tables). This is the established, safe path and the model any new money surface should follow.

---

## Gap list — for admin "see stripe status + help & support" (money)

**A. Stripe Connect status (Seth's explicit ask):**
- G-1. No per-brand Connect status view in admin. Admin can read `brands.stripe_charges_enabled/stripe_payouts_enabled/stripe_connect_id` but **not** `requirements` (what's blocking KYC), derived status, `detached_at`, `country`, or `default_currency`. No page renders any of it.
- G-2. No admin ability to **refresh** a brand's status from Stripe (poll fn is brand-gated) or **view requirements/next-steps** to help a stuck onboarding.
- G-3. No admin ability to **re-trigger/link onboarding** (Account Session / onboarding link) for a brand — `brand-stripe-onboard` + `brand-stripe-account-session` are brand-JWT-gated.
- G-4. No **Paystack-vs-Stripe by region** view. Data exists (`brands.paystack_subaccount_code` vs `stripe_connect_id`; `stripe_connect_accounts.country`) but nothing surfaces it. NG uses Paystack, US/UK use Stripe.

**B. Orders / payments:**
- G-5. No admin order search/view (by buyer email/phone, brand, event, PI id). `orders` has rich buyer + payment_status + PI/charge columns but zero admin read.
- G-6. No admin visibility into installments/at-risk orders (`order_installments`, `orders.at_risk`).

**C. Refunds:**
- G-7. No admin refund capability. `refund-order` + `biz_refund_order` are brand-payment-manager-gated. Admin can't issue a support refund for a buyer.

**D. Disputes:**
- G-8. No admin dispute visibility or workflow. `stripe_disputes` has no admin RLS; no page; no evidence-due tracking / resolution surface. (Platform-liable direct-charge model per DEC-156 makes this operationally important.)

**E. Subscriptions:**
- G-9. Admin can comp via override + Global Plus, but **cannot cancel/refund a real paid subscription** nor see billing state beyond RC tier. (May be acceptable given RevenueCat ownership — flag for product decision, not necessarily a build.)

**F. Support integration ("help & support over the business app"):**
- G-10. `SupportDeskPage.jsx` (support tickets + live chat) shows `brand_id`→brand name but **no money context** — an agent helping a brand/buyer sees no order status, no Connect status, no refund/dispute state in the same console. The "help & support" half of ORCH-1237 has no money data wired in.

**G. Consistency / infra:**
- G-11. Split admin-identity model (`is_admin_user()` on brands vs `profiles.account_type='admin'` on partner_* tables) — new money authz must standardize.

---

## Candidate approaches (directional — NOT a spec)

1. **Service-role "admin money" edge fn(s) + `is_admin_user()`-gated SECURITY DEFINER RPCs**, mirroring the proven `admin-review-venue-claim` / `admin_list_subscriptions` pattern, rather than adding platform-admin RLS to money tables. Candidate reads: `admin_get_brand_stripe_status(brand_id)` (SCA row incl. `requirements` + `pg_derive_brand_stripe_status`), `admin_search_orders(...)`, `admin_list_disputes(...)`. Candidate actions (write): `admin_refresh_connect_status` (wrap existing Stripe retrieve), `admin_issue_refund` (wrap `biz_refund_order` with an admin-authorized branch), `admin_generate_onboarding_link`.
2. **Extend the money edge fns with an `is_admin_user()` OR-branch** (e.g. `brand-stripe-refresh-status`, `refund-order`) so an admin bypasses the brand-membership gate — smaller surface, reuses Stripe idempotency/audit already present, but must add admin audit-log entries + confirm-step to satisfy the Stripe/audit invariants.
3. **Admin console pages:** a per-brand "Payments" tab (Connect status + requirements + refresh + onboarding link + Paystack/Stripe region badge), an "Orders" search page, a "Disputes" queue (evidence-due countdown), and **money context injected into `SupportDeskPage`** (order/Connect/refund/dispute panel keyed off the ticket's `brand_id`/buyer).
4. **Reuse existing derived-status + mirror:** for a low-cost first cut, surface `brands.stripe_charges_enabled/payouts_enabled/stripe_connect_id/paystack_subaccount_code` (already admin-readable) as a status column in the existing brand/claims list, then layer the deeper `requirements`/refresh via a new admin RPC.

**Evidence caveat:** Stripe is TEST mode end-to-end on the Mingla side today (per memory); live counts are tiny (`orders`=2, `stripe_connect_accounts`=1, `refunds`/`stripe_disputes`=0, `subscriptions`=46, `mingla_revenue_log`=49). No live Stripe API was called in this investigation (hard guard honored) — all Connect-status behavior is proven from schema + edge-fn code, capped at source-verified.

---

## Confidence

**Source-verified (schema + code), high confidence** for the money-table schema, RLS authz matrix, edge-fn auth gates, webhook routing, and the enumerated admin gaps. No runtime/live-fire was required (backend/RLS/edge-fn audit; the reproducer-bound live-fire directive does not apply). No Stripe API called per hard guard. The one item I did not exhaustively confirm is whether `mingla_revenue_log` carries a platform-admin RLS policy (not queried); it is webhook-written and not central to the gap list.
