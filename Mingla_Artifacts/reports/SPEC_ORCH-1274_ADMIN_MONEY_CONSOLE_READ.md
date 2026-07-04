# SPEC — ORCH-1274 [Admin Money console — READ-ONLY (visibility-first)]

**Parent:** META-ORCH-1237 (Admin full-visibility console). **Depends on:** ORCH-1271 (Admin authz & audit FOUNDATION — must ship first).
**Phase:** SPEC (build contract). **Author:** mingla-forensics.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surface:** Admin Web (`mingla-admin/`) + backend (read-only migrations/RPCs). No shipping-app surface. No Stripe API call in this wave.
**Inputs consumed (in full):** `SPEC_ORCH-1271_ADMIN_AUTHZ_FOUNDATION.md`, `INVESTIGATION_META-ORCH-1237_MONEY_STRIPE_ORDERS_SUBS.md`, `INVESTIGATION_META-ORCH-1237_MASTER_SYNTHESIS.md`, `mingla-admin/src/pages/{StripeModePage,SubscriptionManagementPage}.jsx`.
**COMMS ledger:** scanned on entry. Only OPEN row touching scope = COMMS-0061 (WARN, ALL): `gqnoajqerqhnvulmnyvv` is LIVE PROD, DR drills clone-only. Honored by construction — this spec ran read-only `execute_sql` SELECT probes only, mutated nothing. Two BLOCK rows (COMMS-0052, COMMS-0006) are ACKNOWLEDGED / addressed to other ORCHs — not in scope. Factored, no ack write needed (WARN, not BLOCK).

> Every schema/column/function/policy name below was verified against live PROD via read-only `execute_sql` on 2026-07-03. Citations: `[verified]` = confirmed this session; `[report]` = sealed by the cited investigation; `[1271]` = defined by the foundation spec.

---

## 1. Scope & non-goals (READ-ONLY)

### In scope (this wave ships READ visibility only)
Admin READ surfaces for the money layer, each backed by an `admin_*` SECURITY DEFINER read-RPC (never a money-table RLS grant) and rendered with the ORCH-1271 `EntityListView`/`EntityDetailView` shells:

1. **Per-brand Stripe Connect status** — list + per-brand detail: derived status via `pg_derive_brand_stripe_status()`, `charges_enabled`/`payouts_enabled`, `requirements` (what's blocking KYC) + a derived next-steps list, `detached_at`, `country`, `default_currency`, external bank accounts, and a **Paystack-vs-Stripe-by-region** provider indicator. This is the "stripe status" Seth explicitly wants visible.
2. **Orders** — search/list (buyer email/phone/name, PI id, order id, brand, status) + detail (linked event/offering + brand + buyer + amount + status + line items + installments + refunds + partner split).
3. **Refunds / disputes / payouts / platform-revenue** — read lists over `refunds`, `stripe_disputes` (+ dispute detail), `payouts`, `mingla_revenue_log`.
4. **Subscriptions (support context)** — reuse the existing `SubscriptionManagementPage` list read as-is; add one read-RPC (`admin_get_subscription_detail`) that returns a user's tier/override/status/history in one bundle for support lookup.

### Non-goals (HARD — do NOT build in 1274; each is designed as a WAVE-2 note only)
- **NO admin write/act on money.** No admin refund, no Connect refresh/re-onboarding-link, no dispute submit/resolve, no subscription cancel/comp. All four are **designed in §9 as WAVE-2 (deferred)** edge-fn shapes on the ORCH-1271 `admin-write-primitive` skeleton — NOT buildable in this wave.
- **NO new money-table RLS policy** (no admin SELECT grant on `orders`/`refunds`/`payouts`/`stripe_disputes`/`stripe_connect_accounts`/`mingla_revenue_log`/`stripe_external_accounts`). Reads are DEFINER RPCs (see §7). This is a positive invariant (I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC).
- **NO Stripe API call** of any kind in this wave (schema + existing-edge-fn evidence only).
- **NO change** to `StripeModePage` (global env diagnostic — stays), `SubscriptionManagementPage` write actions (grant/revoke override + Global Plus already shipped — untouched), the webhook pipeline, or any `biz_*` money edge fn / RPC.
- **NO rebuild** of the subscriptions list (already an admin read surface).
- **NO foundation redefinition** — reuse 1271's `is_admin_user()` gate, §2d write-RPC template (wave-2 only), §3 read convention, §4 shells, `adminWriteService.js`. Do not re-implement any of them.

### Assumptions
- ORCH-1271 has shipped: `is_admin_user()` is the single gate; `admin_write_audit()`, `admin_audit_probe()`, `admin-write-primitive` edge fn, `EntityListView`/`EntityDetailView`/`HighRiskActionModal`, `adminWriteService.js`, and the "Business" nav group all exist. **If 1271 has NOT merged, 1274 is BLOCKED** (it consumes those primitives).
- Stripe is TEST end-to-end on the Mingla side; Paystack LIVE for NG `[report]`. Live data is tiny (`orders`=2, `refunds`/`payouts`/`disputes`=0, `stripe_connect_accounts`=1 (0 detached), `mingla_revenue_log`=49, `subscriptions`=46) `[verified]` — so the "prove against a cross-brand/non-owned row" acceptance rule REQUIRES the tester to seed rows (§8).

---

## 2. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched | Parity |
|---|---------|----------|-----------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | n/a — admin-only feature |
| 2 | Consumer Android (`app-mobile/`) | NO | — | none | n/a |
| 3 | Buyer/anon Web (`mingla-business/` public) | NO | — | none | n/a |
| 4 | Business iOS (`mingla-business/`) | NO | — | none | n/a |
| 5 | Business Android (`mingla-business/`) | NO | — | none | n/a |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | New "Payments", "Orders", "Money ledger" pages under the "Business" nav group; a subscriber-context read. All READ-ONLY. | `mingla-admin/src/pages/*`, `services/adminMoneyService.js`, `lib/constants.js`, `Sidebar.jsx`, `App.jsx`; `supabase/migrations/*` (read RPCs) | Manual (admin-only, single surface) |
| 7 | Business Web preview (adjacent) | NO | — | none | n/a |

All money data is admin-only. There is no consumer/business/buyer parity obligation. Backend read-RPCs are shared by definition (one DB).

---

## 3. Foundation-contract dependencies (from ORCH-1271 — consume, do not redefine)

- **Gate:** `public.is_admin_user()` — `auth.uid()` → `auth.users.email` → `admin_users` status='active' `[1271 §6]`. Every 1274 read-RPC's FIRST executable statement is `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;` (I-ADMIN-GATE-FIRST-STATEMENT).
- **Read convention `[1271 §3]`:** money reads are **derived / joined / cross-brand-aggregated / cross a sensitive money table** → therefore **read via `admin_*` SECURITY DEFINER RPC**, NOT an RLS SELECT policy. All 1274 reads follow this branch. Naming: `admin_list_<entities>(...)` / `admin_get_<entity>(p_id ...)` / `admin_<entity>_stats(...)`.
- **Return-shape `[1271 §3]`:** list RPCs return a single `jsonb` object **`{ "rows": <jsonb[]>, "total": <int> }`**; detail RPCs return one `jsonb` bundle. Money is **integer cents + a currency code** (never pre-formatted); timestamps serialize ISO-8601 (timestamptz→jsonb is ISO by default). (Note: the pre-1271 `admin_list_subscriptions` returns a flat `TABLE` with no total `[verified]`; 1274's NEW list RPCs use the `{rows,total}` object shape so `EntityListView.fetchPage` gets a true total.)
- **"Prove against a known non-public / cross-brand row" acceptance rule `[1271 §3]`:** every read path MUST be proven at TEST to return a row the admin does NOT own — an order/refund/dispute/payout/connect-status under a brand the admin is not a team member of. This catches the silent-empty-read failure mode (a missing admin policy makes a list quietly return only owned/empty and *looks* like it works). Enforced in §8.
- **UI shells `[1271 §4b–4c]`:** `EntityListView` props `{ title, columns, fetchPage:async({search,sortKey,sortDir,filters,page,pageSize})=>{rows,total}, filters, pageSize, onRowClick, csv, emptyMessage, rowKey }`; `EntityDetailView` props `{ header:{title,subtitle,badges,backLabel,onBack}, sections:[{label,fields:[{label,value,render}]}], actions, loading, error, onRetry }`. Reuse both — do NOT re-implement.
- **Service pattern `[verified]`:** thin `services/*.js` wrappers over `supabase.rpc(...)` returning `{ data, error }` (mirrors `adminClaimsService.js`); edge calls via `invokeWithRefresh(fnName,{body})` from `lib/supabase.js`. `adminWriteService.js` (`callAdminWriteRpc`, `invokeAdminWriteEdge`) is reused by wave-2 only.
- **Wave-2 write seam `[1271 §2e]`:** the `admin-write-primitive` edge-fn skeleton (`verify_jwt=true` → `getUser(token)` → `admin_users` active-check → 403 → work → `admin_write_audit(...)` inside the fn, `p_actor_email`/`p_actor_uid` set because service-role has no JWT uid) is the template every wave-2 Stripe action copies. `HighRiskActionModal` (typed reason + confirm) is the wave-2 UI.

---

## 4. Connect-status READ spec (Seth's explicit ask)

### 4.1 Data model (verified)
- **`public.stripe_connect_accounts`** (1 row) `[verified]`: `id, brand_id, stripe_account_id, controller_dashboard_type, charges_enabled bool, payouts_enabled bool, requirements jsonb NOT NULL, country char, default_currency char, detached_at, kyc_stall_reminder_sent_at, created_at, updated_at`. RLS: only `biz_can_manage_payments_for_brand_for_caller(brand_id)` (ALL) — **no admin read** `[verified]`.
- **Derived status** `pg_derive_brand_stripe_status(p_brand_id uuid) RETURNS text` (SQL, STABLE, SECURITY DEFINER, `search_path=public,pg_temp`) `[verified]` — exact branch order: `detached_at IS NOT NULL → 'not_connected'` · `requirements ? 'disabled_reason' AND NULLIF(requirements->>'disabled_reason','') IS NOT NULL → 'restricted'` · `charges_enabled = true → 'active'` · else `'onboarding'`; COALESCE default `'not_connected'`.
- **Admin-readable mirror on `brands`** `[verified]`: `stripe_connect_id, stripe_charges_enabled, stripe_payouts_enabled, default_currency, pricing_currency, paystack_subaccount_code, kind, name, slug`. NOT mirrored (admin-invisible today): `requirements`, `detached_at`, `country`, derived status.
- **`public.stripe_external_accounts`** (0 rows) `[verified]`: `brand_id, stripe_account_id, stripe_external_account_id, type, last4, currency, country, status, default_for_currency, raw_payload`. RLS: brand payment managers SELECT only.
- **Provider derivation:** `stripe` when `brands.stripe_connect_id IS NOT NULL`; `paystack` when `brands.paystack_subaccount_code IS NOT NULL`; else `none`. NG uses Paystack, US/UK use Stripe `[report]`.

### 4.2 Read-RPC — `admin_list_brand_stripe_status`
`supabase/migrations/<ts>_orch_1274_money_read_rpcs.sql`. This IS the contract (implementor ships verbatim, adjusting only formatting). Guard-first per I-ADMIN-GATE-FIRST-STATEMENT.

```sql
CREATE OR REPLACE FUNCTION public.admin_list_brand_stripe_status(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_provider_filter text DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
      b.stripe_connect_id, b.paystack_subaccount_code,
      public.pg_derive_brand_stripe_status(b.id) AS derived_status,
      sca.charges_enabled, sca.payouts_enabled, sca.country, sca.default_currency,
      sca.detached_at, sca.updated_at,
      NULLIF(sca.requirements->>'disabled_reason','') AS disabled_reason,
      (CASE WHEN b.stripe_connect_id IS NOT NULL THEN 'stripe'
            WHEN b.paystack_subaccount_code IS NOT NULL THEN 'paystack'
            ELSE 'none' END) AS provider
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = b.id
    WHERE b.deleted_at IS NULL
      AND (b.stripe_connect_id IS NOT NULL OR b.paystack_subaccount_code IS NOT NULL
           OR sca.id IS NOT NULL)
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL OR brand_name ILIKE '%'||p_search||'%' OR brand_slug ILIKE '%'||p_search||'%'
           OR stripe_connect_id ILIKE '%'||p_search||'%')
      AND (p_status_filter IS NULL OR derived_status = p_status_filter)
      AND (p_provider_filter IS NULL OR provider = p_provider_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.updated_at DESC NULLS LAST), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY updated_at DESC NULLS LAST
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;
```
Row shape: `{brand_id, brand_name, brand_slug, stripe_connect_id, paystack_subaccount_code, derived_status, charges_enabled, payouts_enabled, country, default_currency, detached_at, updated_at, disabled_reason, provider}`.

### 4.3 Read-RPC — `admin_get_brand_stripe_status(p_brand_id uuid) RETURNS jsonb`
Guard-first, then return one bundle:
```
jsonb_build_object(
  'brand',    (name, slug, pricing_currency, default_currency, paystack_subaccount_code, stripe_connect_id),
  'status',   pg_derive_brand_stripe_status(p_brand_id),
  'account',  to_jsonb(sca)   -- full stripe_connect_accounts row incl requirements jsonb, country, detached_at, controller_dashboard_type
  'requirements', sca.requirements,      -- surfaced separately for the next-steps renderer
  'external_accounts', (SELECT jsonb_agg(jsonb_build_object('type',type,'last4',last4,'currency',currency,
                          'status',status,'default_for_currency',default_for_currency))
                        FROM stripe_external_accounts WHERE brand_id = p_brand_id))
```
The UI derives **next-steps** client-side from `requirements` keys (`currently_due`, `eventually_due`, `past_due`, `pending_verification`, `disabled_reason`) — see 4.5. No Stripe call; `requirements` is already synced by the webhook `[report]`.

### 4.4 UI — `pages/BusinessPaymentsPage.jsx`
- Nav: new item under the 1271 "Business" group — `{ id:"business-payments", label:"Payments", icon:"CreditCard" }` (`CreditCard` already in `ICON_MAP` `[verified]` — used by Subscriptions).
- **List** via `EntityListView`, `fetchPage → adminMoneyService.listBrandStripeStatus({search,filters,page,pageSize})`. Columns: Brand (name+slug), Provider (badge: Stripe/Paystack/None), Status (badge: active=success, onboarding=warning, restricted=danger, not_connected=muted), Charges (✓/✗), Payouts (✓/✗), Country, Currency, "Blocked by" (`disabled_reason` truncated or "—"). Filters: `status` dropdown (`active/onboarding/restricted/not_connected`), `provider` dropdown (`stripe/paystack/none`). Search placeholder "Search brand, slug, or acct id". CSV columns = brand_name, slug, provider, derived_status, charges_enabled, payouts_enabled, country, default_currency, disabled_reason, stripe_connect_id.
- **Row click →** `EntityDetailView` via `admin_get_brand_stripe_status`. Header: brand name + status badge + provider badge. Sections: **Status** (derived status, charges/payouts enabled, country, currency, detached_at, dashboard type) · **Requirements / next steps** (rendered list from `requirements`; see 4.5) · **Bank / external accounts** (type, last4, currency, status, default_for_currency; empty → "No external accounts on file") · **Paystack** (subaccount code when provider=paystack). A `HighRiskActionModal`-backed "Refresh from Stripe" / "Generate onboarding link" button is **rendered disabled with a `WAVE-2` tag** (see §9) — no live action.

### 4.5 Next-steps renderer (client-side, pure)
From `requirements` jsonb, show: `disabled_reason` (if set) as a red banner "Charges disabled: <reason>"; then bulleted lists for `past_due` (red), `currently_due` (amber), `eventually_due` (muted), `pending_verification` (blue). If all empty and `charges_enabled` → green "Fully onboarded — no outstanding requirements". Keys are Stripe's standard `requirements` hash `[report; brand-stripe-refresh-status]`.

### 4.6 States
Loading → `EntityListView`/`EntityDetailView` skeleton. Error → AlertCard + retry (`onRetry`). Empty list → "No brands with a payment provider yet." **Silent-empty guard:** the list intentionally includes brands with `sca.id IS NOT NULL` even if the `brands` mirror is stale, so a connected-but-unmirrored brand still appears.

---

## 5. Orders READ spec

### 5.1 Data model (verified)
- **`public.orders`** (2 rows) `[verified]`: NO direct `brand_id` — brand resolves via `event_id → events.brand_id` (helper `biz_order_brand_id(p_order_id uuid) RETURNS uuid` exists `[verified]`). Money cols: `total_cents, currency, payment_method, payment_status, refunded_amount_cents, tax_amount_cents, stripe_payment_intent_id, stripe_charge_id, stripe_payment_intent_status, stripe_application_fee_amount_cents, is_door_sale, at_risk, at_risk_since, installment_plan_root, source, buyer_user_id, buyer_email, buyer_name, buyer_phone, pricing_breakdown jsonb, tax_breakdown jsonb, cancelled_at/by/reason, confirmed_at, failed_at, event_id, event_date_id, created_at`.
- **Children:** `order_line_items` (`ticket_type_id, quantity, unit_price_cents, total_cents`) `[verified]`; `order_installments` (`ordinal, amount_cents, currency, due_at, status, collected_at, failed_at, failure_reason, retry_count`) `[verified]`; `refunds` (per §6); `partner_splits` (`mingla_fee_cents, partner_share_cents, transfer_currency, status`) `[verified]`.
- **Offering join:** `events` (`id, brand_id, title, event_type, status, visibility, city`) → `brands` (`name, slug`); `ticket_types` (`name, price_cents, currency`) for line-item labels `[verified]`. (Note: `events`/`event_dates` expose no `starts_at` column in the current schema `[verified]` — the money detail shows offering title/type/city, not event datetime.)

### 5.2 Read-RPCs
- **`admin_list_orders(p_search text, p_status_filter text, p_brand_id uuid DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0) RETURNS jsonb`** — guard-first; join `orders o → events e ON e.id=o.event_id → brands b ON b.id=e.brand_id`. `{rows,total}`. Row: `{order_id, created_at, buyer_name, buyer_email, buyer_phone, buyer_user_id, event_id, event_title, event_type, brand_id, brand_name, total_cents, currency, payment_method, payment_status, stripe_payment_intent_id, stripe_charge_id, refunded_amount_cents, is_door_sale, at_risk, installment_plan_root, source}`. Search matches `buyer_email/buyer_phone/buyer_name/stripe_payment_intent_id ILIKE` OR `order_id::text = p_search`. `p_status_filter` on `payment_status`. `p_brand_id` filters via `e.brand_id`. Order by `created_at DESC`.
- **`admin_get_order(p_order_id uuid) RETURNS jsonb`** — guard-first; bundle:
  ```
  { order: to_jsonb(o),                    -- full row incl pricing_breakdown, tax_breakdown
    event: { id, title, event_type, city, status, visibility },
    brand: { id, name, slug },
    line_items: [{ ticket_type_name, quantity, unit_price_cents, total_cents }],
    installments: [{ ordinal, amount_cents, currency, due_at, status, collected_at, failed_at, failure_reason }],
    refunds: [{ id, amount_cents, currency, status, reason, stripe_refund_id, created_at, processed_at }],
    partner_split: { mingla_fee_cents, partner_share_cents, transfer_currency, status } }
  ```

### 5.3 UI — `pages/BusinessOrdersPage.jsx`
- Nav: `{ id:"business-orders", label:"Orders", icon:"Receipt" }` — **`Receipt` MUST be imported from `lucide-react` and added to `Sidebar.jsx` `ICON_MAP`** or it silently falls back to `LayoutDashboard` (the documented Careers/Support footgun `[1271 §4a]`).
- **List** via `EntityListView` → `adminMoneyService.listOrders`. Columns: Created, Buyer (name + email/phone), Offering (event_title + type badge), Brand, Amount (`total_cents`+`currency` formatted client-side), Status (badge: paid=success, refunded=muted, disputed=danger, pending/failed=warning), Flags (door-sale / at-risk / installment chips). Filters: `payment_status` dropdown. Search placeholder "Buyer email, phone, name, PI id, or order id". CSV = order_id, created_at, buyer_email, buyer_phone, brand_name, event_title, total_cents, currency, payment_status, stripe_payment_intent_id, refunded_amount_cents.
- **Row click →** `EntityDetailView` via `admin_get_order`. Sections: **Order** (id, status, amount, currency, payment_method, PI id, charge id, app-fee, refunded amount, created/confirmed/failed) · **Buyer** (name, email, phone, buyer_user_id → if present, a "View subscriber" link opening the §7.4 subscriber-context modal) · **Offering** (event title, type, city, brand) · **Line items** (table) · **Installments** (table; empty → "No installment plan") · **Refunds** (table; empty → "No refunds") · **Partner split** (mingla_fee, partner_share, status) · **Pricing/tax breakdown** (rendered from `pricing_breakdown`/`tax_breakdown` jsonb; collapsible). A disabled `WAVE-2`-tagged "Issue refund" button (see §9) — no live action.

---

## 6. Refunds / disputes / payouts / platform-revenue READ spec

Single page with in-page tabs to minimize nav items. Each tab is an independent `EntityListView`.

### 6.1 Data model (verified)
- **`refunds`** (0 rows): `id, order_id, stripe_refund_id, amount_cents, currency, reason, initiated_by, status, application_fee_refunded_cents, stripe_payment_intent_id, stripe_charge_id, stripe_tax_transaction_id, processed_at, metadata jsonb, created_at`. Brand via `biz_order_brand_id(order_id)`.
- **`stripe_disputes`** (0 rows): `id, stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, stripe_account_id, brand_id (nullable), order_id (nullable), amount int, currency text, status, reason, evidence_due_by, is_charge_refundable bool, raw_event jsonb, created_at, updated_at`.
- **`payouts`** (0 rows): `id, brand_id, stripe_payout_id, amount_cents, currency, status, arrival_date date, created_at`.
- **`mingla_revenue_log`** (49 rows): `id, stripe_application_fee_id, stripe_account_id, brand_id (nullable), amount_cents, currency, refunded_amount_cents, refunded bool, raw_payload jsonb, created_at, updated_at`. RLS enabled, **no policy → service_role only** `[verified]`.

### 6.2 Read-RPCs (all guard-first, `{rows,total}`)
- **`admin_list_refunds(p_search, p_status_filter, p_limit, p_offset) RETURNS jsonb`** — row `{id, order_id, brand_id, brand_name, amount_cents, currency, reason, status, stripe_refund_id, application_fee_refunded_cents, initiated_by, created_at, processed_at}`; `brand_id := biz_order_brand_id(r.order_id)`, `brand_name` via join. Search on `stripe_refund_id/order_id/stripe_charge_id`. Order by `created_at DESC`.
- **`admin_list_disputes(p_search, p_status_filter, p_limit, p_offset) RETURNS jsonb`** — row `{id, stripe_dispute_id, brand_id, brand_name, order_id, amount, currency, status, reason, evidence_due_by, is_charge_refundable, stripe_charge_id, created_at, updated_at}`; left-join `brands` on `brand_id`. Search on `stripe_dispute_id/stripe_charge_id`. Order by `evidence_due_by ASC NULLS LAST, created_at DESC` (surface soonest-due first).
- **`admin_get_dispute(p_dispute_id uuid) RETURNS jsonb`** — bundle: dispute row + linked `order` (via `order_id`, reuse the §5.2 order shape or a trimmed `{order_id, total_cents, currency, payment_status, buyer_email}`) + `brand {id,name,slug}` + `raw_event` (returned whole; UI shows structured fields + a collapsible raw JSON viewer). Note `raw_event` can be large — acceptable for a detail view.
- **`admin_list_payouts(p_search, p_status_filter, p_brand_id, p_limit, p_offset) RETURNS jsonb`** — row `{id, brand_id, brand_name, stripe_payout_id, amount_cents, currency, status, arrival_date, created_at}`. Order by `created_at DESC`.
- **`admin_list_revenue_log(p_search, p_limit, p_offset) RETURNS jsonb`** — row `{id, stripe_application_fee_id, stripe_account_id, brand_id, brand_name, amount_cents, currency, refunded_amount_cents, refunded, created_at}`. Order by `created_at DESC`. (Platform-fee ledger — the only current money surface with real rows.)

### 6.3 UI — `pages/BusinessMoneyLedgerPage.jsx`
- Nav: `{ id:"business-money-ledger", label:"Money ledger", icon:"Landmark" }` — **`Landmark` MUST be added to `ICON_MAP`.**
- In-page tab bar (reuse the existing tab pattern in `SubscriptionManagementPage`/support desk filters): **Refunds · Disputes · Payouts · Platform revenue**. Each tab renders an `EntityListView` bound to the matching service call. The active tab persists in the hash query (`#/business-money-ledger?tab=disputes`) or local state (implementor's choice — local state is acceptable).
  - **Refunds tab:** columns Created, Brand, Order, Amount, Status (badge), Reason, App-fee refunded. CSV enabled.
  - **Disputes tab:** columns Created, Brand, Charge id, Amount, Status (badge: needs_response/warning_needs_response=danger, won=success, lost=muted, under_review=warning), Reason, **Evidence due** (relative countdown; red if <72h) — row click → dispute detail (`EntityDetailView` via `admin_get_dispute`). CSV enabled.
  - **Payouts tab:** columns Created, Brand, Amount, Status, Arrival date. CSV enabled.
  - **Platform revenue tab:** columns Created, Brand, Amount (app fee), Currency, Refunded (bool badge), App-fee id. CSV enabled.
- States per tab: loading skeleton, error+retry, empty ("No refunds/disputes/payouts/revenue rows yet"). Empty is a legitimate state (0 rows live) — the tab MUST render the empty state cleanly, not a spinner or crash.

---

## 7. Subscriptions READ spec (support context — reuse, don't rebuild)

### 7.1 Existing surface (untouched)
`SubscriptionManagementPage.jsx` already provides the admin read: list/search/paginate via `admin_list_subscriptions` (flat TABLE: `user_id, display_name, phone, effective_tier, raw_tier, is_active, trial_ends_at, current_period_end, referral_bonus_months, has_admin_override, admin_override_tier, admin_override_expires_at, created_at`) `[verified]`, stats via `admin_subscription_stats`, history via `admin_get_override_history`. **1274 does NOT modify this page or its write actions.**

### 7.2 New read-RPC — `admin_get_subscription_detail(p_user_id uuid) RETURNS jsonb`
Guard-first. One bundle for support lookup (money context on a single user):
```
{ subscription: { tier, is_active, current_period_start, current_period_end, trial_ends_at,
                  referral_bonus_months, referral_bonus_started_at, stripe_customer_id,
                  stripe_subscription_id, cancelled_at, created_at },   -- from public.subscriptions, may be null
  effective_tier: <text>,          -- reuse get_effective_tier(p_user_id) if present; else derive
  raw_tier: <text>,
  override: { active: bool, tier, reason, starts_at, expires_at, granted_by },  -- current active override or null
  override_history: [ ... same shape as admin_get_override_history rows ... ] }
```
Implementor: reuse `admin_get_override_history(p_user_id)` internally for `override_history`; read `subscriptions` by `user_id`. If a `get_effective_tier(uuid)` function exists, call it; otherwise mirror the tier logic already in `admin_list_subscriptions`. Verify the effective-tier helper name during implementation; if absent, return `raw_tier` from `subscriptions.tier` and the override as the effective override.

### 7.3 UI surface (minimal)
No new full page. Surface the subscriber context as a **`components/entity/SubscriberContextCard.jsx`** (small) shown inside the **order detail** (§5.3) when `order.buyer_user_id` is present, via a "View subscriber" link that opens a `Modal` calling `adminMoneyService.getSubscriptionDetail(buyerUserId)`. Renders tier badge, override state, trial/period end, and history list (read-only). This delivers "show a user's tier/override/status" for support without duplicating the subscriptions list.

### 7.4 Non-goal reminder
Comp (`admin_grant_override`) already exists on the subscriptions page — that is the only "comp" today and is NOT re-exposed here. Real cancel/refund of a paid subscription is RevenueCat/Stripe-billing owned and is a **WAVE-2** design note (§9) with a product decision flag `[report G-9]`.

---

## 8. Read-authz per table (expect RPCs) + acceptance evidence rule

**Decision (uniform):** ALL money reads in 1274 go through `admin_*` SECURITY DEFINER RPCs gated `is_admin_user()` first-statement. **NO admin RLS SELECT policy is added to any money table** — every money read is derived/joined/cross-brand/cross-sensitive, matching the 1271 §3 "read-RPC" branch, and avoids a broad grant on sensitive financial rows.

| Table group | Read path (1274) | New RLS? | Cross-brand acceptance target |
|---|---|---|---|
| `stripe_connect_accounts` + `brands` mirror + `stripe_external_accounts` | `admin_list_brand_stripe_status`, `admin_get_brand_stripe_status` | **NO** | a brand with a Connect acct where admin (Seth) is **not** a team member |
| `orders` + `order_line_items` + `order_installments` + `partner_splits` | `admin_list_orders`, `admin_get_order` | **NO** | ≥1 order under a brand admin is not a member of, incl. an event with `visibility='private'`/non-public `status` |
| `refunds` | `admin_list_refunds` | **NO** | ≥1 refund on a cross-brand order |
| `stripe_disputes` | `admin_list_disputes`, `admin_get_dispute` | **NO** | ≥1 dispute on a cross-brand order |
| `payouts` | `admin_list_payouts` | **NO** | ≥1 payout for a cross-brand |
| `mingla_revenue_log` | `admin_list_revenue_log` | **NO** | already 49 live rows across brands (no seed needed) |
| `subscriptions` + `admin_subscription_overrides` | existing `admin_list_subscriptions` + new `admin_get_subscription_detail` | **NO** | a user other than the admin |

**Silent-empty-read rule (HARD, from 1271 §3):** because `refunds`/`disputes`/`payouts` have 0 live rows and `orders` has only 2, a DEFINER RPC that (wrongly) filtered to the caller's brands would return empty and *look* correct. The tester MUST (a) seed ≥1 row in each of `orders`, `refunds`, `stripe_disputes`, `payouts` under a brand where Seth is NOT a `brand_team_members` row, and (b) prove each admin read returns that seeded non-owned row AND that the returned `total` equals a service-role `SELECT count(*)` over the same filter (no silent brand filter). For `orders`, at least one seeded order's event MUST be `visibility='private'` (not public-published) to prove the read is not limited to public offerings.

---

## 9. WAVE-2 deferred-action notes (edge-fn shapes — DESIGN ONLY, NOT buildable in 1274)

Each acts on money via Stripe and therefore rides the ORCH-1271 `admin-write-primitive` skeleton (`verify_jwt` → `getUser(token)` → `admin_users` active-check → 403 → work → `admin_write_audit(...)` inside the fn with `p_actor_email`/`p_actor_uid`) + a `HighRiskActionModal` (typed reason + confirm). **Blocker noted:** the existing money edge fns/RPCs gate on `biz_can_manage_payments_for_brand(brand_id, user_id)` with **no admin bypass** `[report §3]` — so each wave-2 action needs an **admin twin** RPC (or an added `is_admin_user()` branch), never a reuse of the brand-gated path as-is.

- **W2-A — Admin refund.** New edge fn `admin-refund-order` → calls a NEW `admin_refund_order(p_order_id, p_lines jsonb, p_reason text)` RPC = admin twin of `biz_refund_order(p_order_id, p_lines, p_reason, p_idempotency_key)` `[verified]` **minus** the brand-membership gate, **plus** `admin_write_audit('order.refund','order',order_id,reason,{before,after})`. Then Stripe refund (mirror `refund-order/index.ts`: `stripe.refunds.create` on the connected charge) → `biz_refund_order_commit`. Modal reason required; confirm-phrase optional for large refunds. Register `admin_refund_order` in the 1271 write-RPC strict-grep registry.
- **W2-B — Admin Connect refresh / re-onboarding link.** New edge fn `admin-stripe-connect-action` (mode: `refresh` | `onboarding_link` | `account_session`). `refresh` mirrors `brand-stripe-refresh-status` (`stripe.accounts.retrieve` → UPDATE `stripe_connect_accounts` → `pg_derive_brand_stripe_status`) with an admin branch; `onboarding_link` = `stripe.accountLinks.create`; `account_session` = `stripe.accountSessions.create` (mirror `brand-stripe-account-session`). Audit `connect.refresh` / `connect.onboarding_link` via `admin_write_audit`. Wire the disabled buttons in §4.4.
- **W2-C — Dispute view→resolve.** New edge fn `admin-stripe-dispute-action` (mode: `submit_evidence` | `accept`) → `stripe.disputes.update` / `stripe.disputes.close` → reconcile `stripe_disputes.status` → audit `dispute.submit_evidence` / `dispute.accept`. The read detail (§6.2 `admin_get_dispute`) is the input surface; evidence upload UI is wave-2.
- **W2-D — Subscription cancel/comp.** Comp already exists (`admin_grant_override`). Real cancel/refund of a paid subscription is RevenueCat/Stripe-billing owned → **product decision first** `[report G-9]`: likely a RevenueCat API edge fn or explicit "managed in RevenueCat" note. Do NOT assume a Stripe subscription object exists (billing is RevenueCat). Design deferred pending that decision.

Each wave-2 write RPC must (per 1271 invariants) guard `is_admin_user()` first + `admin_write_audit(...)` + be appended to the 1271 `i-admin-write-audited.mjs` registry.

---

## 10. Invariants (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip)

| ID | Rule | Enforcement | Regression-test (fails-on-revert) |
|---|---|---|---|
| `I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC` | Every admin money read goes through an `admin_*` SECURITY DEFINER RPC; **NO** `is_admin_user()` SELECT RLS policy exists on `orders`/`order_line_items`/`order_installments`/`refunds`/`refund_line_items`/`payouts`/`stripe_disputes`/`stripe_connect_accounts`/`mingla_revenue_log`/`stripe_external_accounts`/`partner_splits`. | New strict-grep `i-money-no-admin-rls.mjs` + append 1274 read-RPC names to the 1271 `i-admin-gate-first-statement.mjs` registry. | `i-money-no-admin-rls.mjs`: FAIL if any migration adds `CREATE POLICY ... FOR SELECT ... is_admin_user()` on a listed money table; AND assert the 7 read-RPC definitions are present in migrations. Reverting the read-RPC migration removes the definitions → FAIL. |
| `I-PROPOSED-1274-MONEY-READ-CENTS-CONTRACT` | Money read-RPCs return integer cents + a currency code, never pre-formatted currency strings. | strict-grep over the 1274 migration: the read-RPC bodies select `*_cents`/`amount` + `currency`, and contain no `to_char(`/`'$'` formatting. | Fold into `i-money-no-admin-rls.mjs` (assert no `to_char(` in the money read-RPC migration). Reverting to a formatted-string return → FAIL. |

Append both to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as DRAFT. Add the read-RPC names (`admin_list_brand_stripe_status`, `admin_get_brand_stripe_status`, `admin_list_orders`, `admin_get_order`, `admin_list_refunds`, `admin_list_disputes`, `admin_get_dispute`, `admin_list_payouts`, `admin_list_revenue_log`, `admin_get_subscription_detail`) to the 1271 `i-admin-gate-first-statement.mjs` registry (append-only pattern `[1271 §5]`). Register the new `i-money-no-admin-rls.mjs` job step in `.github/workflows/strict-grep-mingla-business.yml` with a fixture under `__tests__/`.

---

## 11. Layered specification summary + allowlist

### Database (read-only migrations)
- `supabase/migrations/<ts>_orch_1274_money_read_rpcs.sql` — the 9 money read-RPCs (§4.2, §4.3, §5.2, §6.2) + `admin_get_subscription_detail` (§7.2). ALL `SECURITY DEFINER`, `STABLE`, `SET search_path TO 'public'`, guard-first `is_admin_user()`, `{rows,total}` (lists) / `jsonb` bundle (details). **No DDL on any table. No RLS policy. No column add.**

### Service — `mingla-admin/src/services/adminMoneyService.js`
Thin wrappers (mirror `adminClaimsService.js`), each returns `{ data, error }`:
```
listBrandStripeStatus({search,filters,page,pageSize}) -> supabase.rpc('admin_list_brand_stripe_status',{...})  // returns {rows,total}
getBrandStripeStatus(brandId)                         -> supabase.rpc('admin_get_brand_stripe_status',{p_brand_id})
listOrders(...)        -> 'admin_list_orders'          getOrder(orderId)   -> 'admin_get_order'
listRefunds(...)       -> 'admin_list_refunds'
listDisputes(...)      -> 'admin_list_disputes'        getDispute(id)      -> 'admin_get_dispute'
listPayouts(...)       -> 'admin_list_payouts'         listRevenueLog(...) -> 'admin_list_revenue_log'
getSubscriptionDetail(userId) -> 'admin_get_subscription_detail'
```
Each `list*` maps `EntityListView.fetchPage` args → RPC params (`p_search`, `p_status_filter`/`p_provider_filter`, `p_brand_id`, `p_limit=pageSize`, `p_offset=page*pageSize`) and returns the RPC's `{rows,total}` (default `{rows:[],total:0}` on null).

### Components (reuse 1271; one new small card)
Reuse `components/entity/EntityListView.jsx`, `EntityDetailView.jsx`. New: `components/entity/SubscriberContextCard.jsx` (§7.3, read-only). No new table/modal/badge primitives — reuse `components/ui/*`.

### Pages
`pages/BusinessPaymentsPage.jsx` (§4.4), `pages/BusinessOrdersPage.jsx` (§5.3), `pages/BusinessMoneyLedgerPage.jsx` (§6.3).

### Nav wiring
- `lib/constants.js`: append 3 items to the 1271 "Business" `NAV_GROUPS` group — `business-payments` (CreditCard), `business-orders` (Receipt), `business-money-ledger` (Landmark).
- `Sidebar.jsx`: import `Receipt`, `Landmark` from `lucide-react` and add to `ICON_MAP` (`CreditCard` already present). **Skipping this = silent `LayoutDashboard` fallback.**
- `App.jsx`: import the 3 pages, add to `PAGES` map (`"business-payments"/"business-orders"/"business-money-ledger"`). Hash routes work via `getTabFromHash`.

### Allowlist (implementor may create/modify ONLY these)
`supabase/migrations/<ts>_orch_1274_money_read_rpcs.sql` · `mingla-admin/src/services/adminMoneyService.js` · `mingla-admin/src/pages/{BusinessPaymentsPage,BusinessOrdersPage,BusinessMoneyLedgerPage}.jsx` · `mingla-admin/src/components/entity/SubscriberContextCard.jsx` · `mingla-admin/src/lib/constants.js` · `mingla-admin/src/components/layout/Sidebar.jsx` · `mingla-admin/src/App.jsx` · `.github/scripts/strict-grep/i-money-no-admin-rls.mjs` (+ `__tests__/` fixture) · `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (append RPC names to registry only) · `.github/workflows/strict-grep-mingla-business.yml` (one job step) · `Mingla_Artifacts/INVARIANT_REGISTRY.md` (2 DRAFT rows).

### DO-NOT-TOUCH (stop-and-amend before touching)
`StripeModePage.jsx` · `SubscriptionManagementPage.jsx` (incl. its write actions) · any `biz_*` RPC/edge fn (`biz_refund_order`, `biz_can_manage_payments_for_brand`, `refund-order`, `brand-stripe-*`) · the webhook pipeline (`stripe-webhook`, `stripeWebhookRouter.ts`) · `pg_derive_brand_stripe_status` / `biz_order_brand_id` / `is_admin_user()` definitions (call, never alter) · `admin_write_audit` / `admin_audit_probe` / `admin-write-primitive` (1271-owned) · ANY money-table RLS · any shipping-app code (`app-mobile/`, `mingla-business/`) · the existing `admin_list_subscriptions` / `admin_grant_override` / `admin_revoke_override` RPCs.

---

## 12. Success criteria (testable) — HP = happy-path (implementor), ADV = adversarial (tester)

**SC-1 Connect status (§4)**
- SC-1.1 [HP] `#/business-payments` renders under "Business" with a non-fallback icon; the list shows the 1 live Connect brand with `derived_status`, charges/payouts flags, country, currency, provider badge.
- SC-1.2 [HP] Row click opens the detail with `requirements`-derived next-steps and the external-accounts section (empty state when none).
- SC-1.3 [HP] Status filter + provider filter narrow the list; search matches brand name/slug/acct id; CSV downloads.
- SC-1.4 [ADV] `admin_list_brand_stripe_status` returns a Connect brand where Seth is NOT a `brand_team_members` row; `admin_get_brand_stripe_status` returns that brand's full `requirements` jsonb (proving it reads `stripe_connect_accounts`, not just the `brands` mirror).
- SC-1.5 [ADV] A non-admin authed session calling `admin_list_brand_stripe_status` RAISES `not_authorized` (guard-first).

**SC-2 Orders (§5)**
- SC-2.1 [HP] `#/business-orders` list shows both live orders with buyer, offering, brand, amount (`total_cents`→formatted), status badge.
- SC-2.2 [HP] Detail bundle shows line items, installments (empty ok), refunds (empty ok), partner split, pricing/tax breakdown; "View subscriber" link appears only when `buyer_user_id` is set.
- SC-2.3 [HP] Search by buyer email/phone/PI id/order id filters; status filter works; CSV downloads.
- SC-2.4 [ADV] Seeded cross-brand order (brand Seth is not a member of) with a **private** event appears in `admin_list_orders`, and `admin_get_order` returns it; returned `total` equals a service-role `count(*)` (no silent brand filter, no public-only filter).
- SC-2.5 [ADV] Non-admin calling `admin_list_orders`/`admin_get_order` RAISES `not_authorized`.

**SC-3 Refunds/disputes/payouts/revenue (§6)**
- SC-3.1 [HP] `#/business-money-ledger` renders 4 tabs; each shows a clean **empty state** on live data (0 rows) except Platform revenue (49 rows) which lists app-fee entries.
- SC-3.2 [HP] Disputes tab shows evidence-due countdown; row click opens dispute detail with linked order + collapsible raw event.
- SC-3.3 [ADV] Seeded cross-brand refund, dispute, and payout each appear in their list RPC and match a service-role `count(*)`; disputes ordered soonest-evidence-due first.
- SC-3.4 [ADV] Non-admin calling any of `admin_list_refunds/_disputes/_payouts/_revenue_log`/`admin_get_dispute` RAISES `not_authorized`.

**SC-4 Subscriptions (§7)**
- SC-4.1 [HP] `admin_get_subscription_detail(user_id)` returns tier/effective_tier/override/history for a user; the `SubscriberContextCard` renders it from the order detail.
- SC-4.2 [HP] `SubscriptionManagementPage` is unchanged (grant/revoke/Global Plus still work; no regressions).
- SC-4.3 [ADV] Non-admin calling `admin_get_subscription_detail` RAISES `not_authorized`.

**SC-5 Scope + authz invariants (§8,§10)**
- SC-5.1 [HP] `mingla-admin` builds (`npm run build`) with zero new lint/type errors.
- SC-5.2 [ADV] `i-money-no-admin-rls.mjs` FAILS if an admin SELECT RLS policy is added to any money table OR a money read-RPC returns `to_char`-formatted money; PASSES on the shipped tree.
- SC-5.3 [ADV] `i-admin-gate-first-statement.mjs` (1271, extended registry) PASSES for all 10 new RPCs (guard is the first statement) and FAILS if any guard is moved below a query.
- SC-5.4 [ADV] Grep the 3 new pages for any `.from('orders'|'refunds'|'stripe_disputes'|'stripe_connect_accounts'|'payouts')` direct table read → **0 hits** (proves all reads go through the DEFINER RPCs, no anon-key table read).

---

## 13. Test cases (min happy + error + edge per surface)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 | Connect list as admin | admin session | `{rows,total}`; live brand present with derived_status | DB/RPC |
| T2 | Connect list as non-admin | non-admin JWT | RAISES `not_authorized` | DB/RPC |
| T3 | Connect detail reads requirements | cross-brand brand_id | bundle includes full `requirements` jsonb | DB/RPC |
| T4 | Orders search by PI id | `p_search=<pi_id>` | matching order only | DB/RPC |
| T5 | Orders cross-brand + private event | seeded row | appears; `total`==service-role count | DB/RPC |
| T6 | Order detail with no installments | order w/ 0 installments | `installments:[]`, UI empty state | RPC/UI |
| T7 | Refunds empty | 0 live refunds | list `{rows:[],total:0}`; UI empty state, no crash | RPC/UI |
| T8 | Disputes ordering | 2 seeded, diff due dates | soonest evidence_due first | DB/RPC |
| T9 | Dispute detail large raw_event | seeded dispute | bundle returns; UI collapses raw JSON | RPC/UI |
| T10 | Payouts cross-brand | seeded payout | appears; matches count | DB/RPC |
| T11 | Revenue log live | 49 rows | paginated; cents+currency, no formatted strings | DB/RPC |
| T12 | Subscriber detail | user with override | tier/override/history bundle | DB/RPC |
| T13 | Subscriber card gating | order w/ null buyer_user_id | no "View subscriber" link | UI |
| T14 | Direct table read audit | grep pages | 0 `.from('orders'...)` hits | Static |
| T15 | Build clean | `npm run build` | 0 new errors | Build |
| T16 | Revert read-RPC migration | strict-grep | `i-money-no-admin-rls.mjs` FAILS | CI |

---

## 14. Implementor task list (ordered)

1. **DB — read RPCs.** Write `<ts>_orch_1274_money_read_rpcs.sql`: the 9 money read-RPCs (§4.2/§4.3/§5.2/§6.2) + `admin_get_subscription_detail` (§7.2). All guard-first, `SECURITY DEFINER STABLE search_path=public`, `{rows,total}`/`jsonb` bundle. Verify `get_effective_tier` name before use; fall back per §7.2. (SC-1..SC-4)
2. **Service.** `services/adminMoneyService.js` (§11). (SC-1.3, SC-2.3)
3. **Components.** `components/entity/SubscriberContextCard.jsx` (§7.3).
4. **Pages.** `BusinessPaymentsPage.jsx`, `BusinessOrdersPage.jsx`, `BusinessMoneyLedgerPage.jsx` (reuse `EntityListView`/`EntityDetailView`). Wave-2 buttons rendered **disabled + `WAVE-2` tag**, no handlers.
5. **Nav wiring.** `lib/constants.js` (3 items), `Sidebar.jsx` (import `Receipt`+`Landmark` → ICON_MAP), `App.jsx` (3 PAGES entries). (SC-1.1)
6. **Invariants + gate.** Add 2 DRAFT invariants to `INVARIANT_REGISTRY.md`; append 10 RPC names to `i-admin-gate-first-statement.mjs` registry; create `i-money-no-admin-rls.mjs` + `__tests__` fixture; register 1 job step in `strict-grep-mingla-business.yml`. (SC-5.2/5.3)
7. **Self-verify.** `npm run build` clean; run the strict-grep scripts locally (PASS) + prove fails-on-revert; hand DB migration deploy to the orchestrator. Provide the SC-1.5/2.5/3.4/4.3 `not_authorized` proof (a non-admin `execute_sql` call — tester will re-run).

---

## 15. Open questions (with defaults)

- **Q1 (non-blocking).** Money-ledger tabs (Refunds/Disputes/Payouts/Revenue) as ONE page with in-page tabs vs 4 nav items. **Default: one page + in-page tabs** (fewer nav items; already spec'd). Revisit if Seth wants each top-level.
- **Q2 (non-blocking).** `admin_get_dispute` returns the whole `raw_event` jsonb (can be multi-KB). **Default: return whole + UI collapses it** (detail view, single row — size is fine). Alternative: return selected keys only.
- **Q3 (non-blocking).** Subscriber context is surfaced only from the order detail (§7.3), not as a standalone page. **Default: order-detail-only** for this wave (support-driven); a standalone "Subscriber lookup" can be a 1275 polish item.
- **Q4 (non-blocking, routed to 1272).** `admin_get_order` returns brand `{id,name,slug}` — deep-linking to a Brand admin view belongs to ORCH-1272 (identity console). **Default: show brand name as text now; wire the link when 1272 ships.**
- **No BLOCKING open questions.** Every table/column/RPC/policy verified against live PROD; the only hard dependency is ORCH-1271 having shipped (§1 assumption).

---

## 16. Downstream routing

Next = **mingla-implementor** (build per §14, in the ORCH-1274 per-ORCH worktree; `git fetch origin && git rebase origin/main` first). Then **mingla-tester** (the SC matrix — esp. every ADV row, the §8 cross-brand/silent-empty seeding proof, and fails-on-revert on `i-money-no-admin-rls.mjs`). Then **orchestrator CLOSE** (flip 2 invariants DRAFT→ACTIVE, deploy the read-RPC migration, merge one PR, update WORLD_MAP). **Wave-2** (admin refund / Connect refresh+onboarding / dispute resolve / sub cancel, §9) is a SEPARATE later dispatch that consumes the 1271 `admin-write-primitive` skeleton + admin-twin RPCs — do NOT build it in 1274.

> **Blocking prerequisite:** ORCH-1271 must be merged before 1274 implement starts (1274 consumes `EntityListView`/`EntityDetailView`, the "Business" nav group, the read convention, and — for wave-2 — the write primitive). If 1271 is not on `origin/main`, STOP and report to the orchestrator.
