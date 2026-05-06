# Investigation — Cycle B2 (Stripe Connect wired live) — current-state map + decision queue

**Mode:** INVESTIGATE (no SPEC, no code, no implementation suggestions)
**Date:** 2026-05-06
**Investigator:** Mingla Forensics
**Dispatch:** [`Mingla_Artifacts/prompts/FORENSICS_CYCLE_B2_STRIPE_CONNECT_STUB.md`](../prompts/FORENSICS_CYCLE_B2_STRIPE_CONNECT_STUB.md)
**Source-of-truth refs:** `BUSINESS_PROJECT_PLAN.md §B.6 + §C.1`, `BUSINESS_PRD.md §2.3`, `BUSINESS_STRATEGIC_PLAN.md §6 R2/R3 + Q3/Q5`, `Mingla_Artifacts/github/epics/cycle-b2.md`, DEC-112, DEC-113

---

## 0. Executive Summary (Layman first)

**The schema is more complete than expected. The code is even more empty than expected. Both DECs already reflected in DB. Zero Stripe edge functions exist. Frontend Stripe state is entirely fictional.**

When a brand admin clicks "Set up payments" today, they hit a 1.5-second simulated loading spinner that auto-advances to a fake "Onboarding submitted" screen. That click never reaches Stripe. It never reaches an edge function. It never even reaches the database — `brand.stripeStatus` lives only in client-side Zustand and is updated by a stub mutation that pretends the brand is "verifying." The entire Connect flow is a Potemkin village.

The good news: the database is mostly ready. All 5 §B.6 tables exist with correct columns, RLS is wired through the existing `biz_can_manage_payments_for_brand_for_caller` permission helper, the `account_type` column already defaults to `'express'` (DEC-112 baked in pre-emptively), and a unique index on `brand_id` already enforces one Connect account per brand at the DB level (DEC-113 baked in pre-emptively). Permission gating is already correctly configured for the `account_owner` + `brand_admin` + `finance_manager` triad.

The bad news: zero Stripe-related code exists below the UI layer. No edge functions, no shared Stripe helper, no audit-log writer pattern, no idempotency-key pattern, no webhook signature verifier, no Resend transactional email helper, no `_shared/` infrastructure of any kind for B2 to build on. The 58 existing edge functions cover discovery, places, notifications, scoring, and OTP — none touch payments. B2 must establish all of this from scratch.

The trickiest non-obvious gap: **Stripe state is denormalized across two tables**. The `brands` table carries `stripe_connect_id` + `stripe_payouts_enabled` + `stripe_charges_enabled` directly (used by `useBrandCascadePreview` for "is connected" boolean), AND `stripe_connect_accounts` carries the same conceptual data normalized via `brand_id` FK. This is a Constitutional #2 candidate — two sources of truth. B2 must resolve which side wins before writing webhook handlers, or webhooks will produce inconsistent state.

The biggest blocker for SPEC writing: there is no Stripe Connect SDK on the frontend that supports embedded onboarding. `@stripe/stripe-react-native@0.50.3` is in `mingla-business/package.json` but it covers Stripe Elements (B3 checkout), not Connect Embedded Components. Connect's `@stripe/connect-js` (web) is missing. For React Native + Expo Web embedded Connect, current Stripe support is thin — this needs decision/research before SPEC writing.

**Findings:** 4 root-cause-class gaps · 7 contributing factors · 9 hidden flaws · 6 observations
**Surfaced decisions:** 23 architectural decisions for operator lock pre-SPEC (D-B2-1 through D-B2-23)
**Confidence:** **High** on schema state and edge function inventory (read every file). **Medium-High** on UI gap analysis (read primary surfaces; assumed siblings follow same pattern). **Medium** on Stripe SDK ecosystem (relied on package.json + dispatch context, no live SDK probing).

---

## 1. Investigation Manifest (every file read, in trace order)

| # | File | Why |
|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_CYCLE_B2_STRIPE_CONNECT_STUB.md` | Re-confirm dispatch scope |
| 2 | Glob: `Mingla_Artifacts/reports/INVESTIGATION_*STRIPE*.md` (+ PAYMENT, CONNECT, B2) | Phase 0a — prior investigations |
| 3 | Grep `supabase/migrations/` for §B.6 table names | Phase 0c — locate authoritative migrations |
| 4 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (lines 8145, 8619, 8639, 9231, 9745) | Schema definitions for all 5 §B.6 tables |
| 5 | Same migration, lines 14098–14110 (RLS policies) | RLS policy state for §B.6 |
| 6 | Same migration, lines 11591–12227 (indexes) | Index state including unique idx_stripe_connect_accounts_brand_id |
| 7 | Same migration, lines 13310–13865 (FKs) | FK state for §B.6 |
| 8 | Same migration, lines 3059–3084 (`biz_can_manage_payments_for_brand` + `_for_caller`) | Permission helper definition |
| 9 | Same migration, lines 7775–7776 (`brands` Stripe columns) | Confirms `brands.stripe_*` denormalized state |
| 10 | `ls supabase/migrations/` | Confirm no later migration supersedes (Migration Chain Rule) |
| 11 | `mingla-business/app/brand/[id]/payments/onboard.tsx` | Onboarding entry route — confirms it's stub |
| 12 | `mingla-business/src/components/brand/BrandOnboardView.tsx` (327 lines, full file) | The onboarding state machine — fake |
| 13 | `mingla-business/src/components/brand/BrandPaymentsView.tsx` (587 lines, full file) | Payments dashboard — driven by `brand.stripeStatus` |
| 14 | `mingla-business/src/store/currentBrandStore.ts` (lines 1–120) | `BrandStripeStatus` enum + `BrandPayout` + `BrandRefund` types |
| 15 | `mingla-business/src/hooks/useBrands.ts` (full file, 399 lines) | React Query layer; `useBrandCascadePreview` reads `brands.stripe_connect_id` |
| 16 | `mingla-business/src/services/brandsService.ts` (full file, 253 lines) | Brand CRUD service — does NOT touch Stripe state |
| 17 | `mingla-business/src/services/brandMapping.ts` (full file, 336 lines) | Maps `BrandRow` ↔ `Brand` — Stripe columns IGNORED in mapBrandRowToUi |
| 18 | `mingla-business/src/components/checkout/PaymentElementStub.tsx` (lines 1–80) | B3 stub — confirms `@stripe/stripe-react-native` available but unused |
| 19 | `mingla-business/src/components/orders/RefundSheet.tsx` (lines 1–100) | Refund flow — Zustand-only, no DB writes |
| 20 | `mingla-business/src/components/brand/BrandFinanceReportsView.tsx` (lines 1–80) | Finance reports — hard-coded fee constants flagged TRANSITIONAL B2 |
| 21 | `ls supabase/functions/` (all 58 entries) | Edge function inventory — zero Stripe |
| 22 | `find supabase/functions/_shared/` | Shared utilities inventory — zero Stripe/payment helpers |
| 23 | Grep `audit_log\|writeAudit` in `supabase/functions/` | No edge function writes audit_log today |
| 24 | Grep `Idempotency-Key\|idempotency_key` in `supabase/functions/` | No idempotency-key pattern exists |
| 25 | Grep `Resend\|sendEmail` in `supabase/functions/_shared/` | No transactional email helper exists |
| 26 | Grep `stripeStatus\|deriveStripeStatus` in `mingla-business/src/` | No derivation logic exists |
| 27 | Grep `stripe_charges_enabled\|stripe_payouts_enabled\|stripe_connect_id` in `mingla-business/src/` | Only 2 files reference these — useBrands.ts + brandMapping.ts |
| 28 | `mingla-business/package.json` + `app-mobile/package.json` | Stripe package inventory: 1 in business (B3), 0 in mobile |

---

## 2. Five-Layer Cross-Check

| Layer | What it says | Evidence |
|---|---|---|
| **Docs** | B2 ships embedded Stripe Connect Express onboarding (DEC-112), brand-level routing (DEC-113), per cycle-b2.md scope. PRD §2.3 + Project Plan §B.6 list expected tables. R2 mandates embedded (not redirect). R3 mandates idempotency + webhook durable queue + hourly reconciliation. | `cycle-b2.md` lines 9–18; `BUSINESS_PRD.md` 161–175; `BUSINESS_PROJECT_PLAN.md` 412–432; `BUSINESS_STRATEGIC_PLAN.md` 163–164 |
| **Schema** | All 5 §B.6 tables exist in baseline-squash. `account_type` defaults to `'express'`. Unique index on `brand_id` enforces one-per-brand. RLS uses `biz_can_manage_payments_for_brand_for_caller`. `payment_webhook_events` is service-role-only (no policy). `brands` carries DUPLICATED Stripe state via `stripe_connect_id`/`stripe_payouts_enabled`/`stripe_charges_enabled`. | `20260505000000_baseline_squash_orch_0729.sql` lines 7775–7776 (brands), 8145, 8619, 8639, 9231, 9745 (§B.6 tables), 12223 (unique idx), 14098–14110 (RLS), 15783 (RLS-enabled, no policy) |
| **Code** | Zero Stripe edge functions. Zero `_shared/` Stripe utilities. UI is fully stubbed. Brand mapping IGNORES Stripe columns. `useBrandCascadePreview` reads `stripe_connect_id` for an approximate "hasStripeConnect" boolean. `@stripe/stripe-react-native` installed but only referenced in B3 PaymentElementStub.tsx (also stubbed). | `BrandOnboardView.tsx` lines 47–51 + 78–83; `BrandPaymentsView.tsx` lines 161–166; `brandMapping.ts` lines 189–222 (no Stripe mapping); `useBrands.ts` lines 364–368 + 382–384; edge function inventory |
| **Runtime** | Not probed (this is a code-forensic pass). The dispatch explicitly forbids invoking Stripe APIs. Runtime layer carries assumption: dev-seed flow populates `brand.stripeStatus` to demo states; user-side Stripe never called. | Confirmed via static traces of `currentBrandStore.ts` v8 schema doc + `BrandOnboardView` `setState("complete")` path |
| **Data** | Not probed (read-only investigation; Supabase MCP not invoked per dispatch §5 constraint). Inferred: `stripe_connect_accounts` likely empty in production. `brands.stripe_connect_id` likely null for all brands. `payment_webhook_events` likely empty. | Inference only — not verified against live DB |

**Contradictions found:**

- **C-1 (Doc vs Code):** Docs say B2 will deliver embedded Connect onboarding using Stripe Embedded Components. Code has no Stripe SDK that supports embedded Connect Components — only `@stripe/stripe-react-native@0.50.3` which targets Elements (checkout) not Connect. **Gap to surface as decision D-B2-23 below.**
- **C-2 (Schema vs Code):** Schema treats `stripe_connect_accounts` as the canonical Connect record with `charges_enabled` + `payouts_enabled` + `requirements` JSONB. Code reads `brands.stripe_connect_id` (denormalized column on parent table) instead. Two sources of truth, both populated. **Constitutional #2 violation candidate.**
- **C-3 (Schema vs Code):** Frontend `BrandStripeStatus` enum (`not_connected | onboarding | active | restricted`) is a derived 4-state. DB has no enum column — only `charges_enabled` + `payouts_enabled` booleans + `requirements` JSONB. Derivation logic does not exist anywhere. **Gap surfaced as D-B2-15.**

---

## 3. Findings (classified)

### 3.1 Root-Cause-Class Gaps (🔴)

#### 🔴 R-1 — Zero Stripe edge functions exist; B2 must establish from scratch

| Field | Value |
|---|---|
| File + line | None — files do not exist |
| Exact code | N/A (absence) |
| What it does | Frontend "Set up payments" CTA wires to local Zustand mutation only |
| What it should do | POST to `brand-stripe-onboard` edge fn → Stripe `accounts.create` → returns `account_session_client_secret` for embedded onboarding |
| Causal chain | UI button → `useUpdateBrand.mutate({ stripeStatus: "onboarding" })` → patches `brands` row only (no Stripe call) → no `stripe_connect_accounts` insert → no Stripe account created → real money flow never enabled |
| Verification | Confirmed via `ls supabase/functions/` (58 functions, none Stripe-related) + `Glob brand-stripe-*` returns empty + no `stripe-webhook` handler |

#### 🔴 R-2 — No `_shared/` Stripe SDK helper; no idempotency key pattern; no signed-webhook receiver pattern

| Field | Value |
|---|---|
| File + line | `supabase/functions/_shared/` — 25 files, none Stripe-related |
| Exact code | N/A (absence of expected helpers) |
| What it does | No reusable Stripe client, no `Idempotency-Key` generator, no `stripe.webhooks.constructEvent` wrapper |
| What it should do | Provide a single Stripe client wrapper, one-shot idempotency-key helper, signed-webhook verifier, reusable across all B2 + B3 + B4 edge functions |
| Causal chain | Each future Stripe-touching edge fn would re-instantiate Stripe + reinvent idempotency → drift across B2/B3/B4 → R3 risk (financial discrepancy) materializes |
| Verification | `find supabase/functions/_shared/ -type f` lists 25 files: bouncer, place types, signal scoring, photo storage, push utils — zero Stripe, zero payments, zero Resend |

#### 🔴 R-3 — `mapBrandRowToUi` does not map Stripe columns into `Brand`; client `stripeStatus` is purely fictional

| Field | Value |
|---|---|
| File + line | `mingla-business/src/services/brandMapping.ts:189-222` |
| Exact code | `mapBrandRowToUi` returns object containing `id, displayName, slug, kind, address, coverHue, coverMediaUrl, photo, role, stats, currentLiveEvent, bio, tagline, contact, links, displayAttendeeCount` — NO stripe* fields |
| What it does | Even though `BrandRow` type at lines 26–53 includes `stripe_connect_id`, `stripe_payouts_enabled`, `stripe_charges_enabled` from the DB, mapper drops them. Client `Brand.stripeStatus` is never derived from server data. |
| What it should do | Map DB Stripe state (canonical source TBD per D-B2-1) into a derived `Brand.stripeStatus` enum value via a deterministic helper |
| Causal chain | Frontend reads `brand.stripeStatus` from Zustand → never invalidated by server data → user can have a fully Stripe-active brand and still see "Connect Stripe" banner (or vice versa) |
| Verification | Read full file `brandMapping.ts:189-222` — return statement enumerates fields explicitly; grep for `stripeStatus|stripe_status|deriveStripeStatus` in `mingla-business/src/` returns zero matches |

#### 🔴 R-4 — Stripe state denormalized across `brands` AND `stripe_connect_accounts` (Constitutional #2 candidate)

| Field | Value |
|---|---|
| File + line | `20260505000000_baseline_squash_orch_0729.sql:7775-7776` (brands) + `:9745-9757` (stripe_connect_accounts) |
| Exact code | `brands.stripe_connect_id text` + `brands.stripe_payouts_enabled boolean` + `brands.stripe_charges_enabled boolean` (line 7775–7776 + brandMapping line 42) — AND — `stripe_connect_accounts.brand_id uuid` + `.stripe_account_id text` + `.charges_enabled boolean` + `.payouts_enabled boolean` + `.requirements jsonb` |
| What it does | Both tables can hold conceptually identical state for the same brand. `useBrandCascadePreview.hasStripeConnect` reads `brands.stripe_connect_id !== null` (line 382–384 of useBrands.ts), bypassing the canonical `stripe_connect_accounts` row entirely |
| What it should do | One source of truth. Either `stripe_connect_accounts` is canonical and `brands.stripe_*` columns are dropped/deprecated, or `brands.stripe_*` is a denormalized cache kept in sync via trigger from `stripe_connect_accounts` updates |
| Causal chain | Webhook arrives → handler updates `stripe_connect_accounts.charges_enabled=true` → cache miss on `brands.stripe_charges_enabled` (still false) → `useBrandCascadePreview` returns wrong "isConnected" → cascading UI bugs |
| Verification | Read both schema definitions; read `useBrands.ts:364-368` for the `brands.stripe_connect_id` read pattern; read `brandMapping.ts:40-42` confirming `brands` carries all 3 redundant columns |

### 3.2 Contributing Factors (🟠)

#### 🟠 CF-1 — `@stripe/stripe-react-native@0.50.3` covers Elements (B3 checkout), not Connect Embedded Components

`@stripe/connect-js` (web) and `@stripe/react-stripe-js` are absent. For React Native + Expo Web, embedded Connect onboarding requires either a WebView wrapping `@stripe/connect-js` OR Stripe's hosted Account Link redirect (which violates R2 "embedded, not redirect"). This is a load-bearing decision (D-B2-23). Verified in `mingla-business/package.json`.

#### 🟠 CF-2 — `BrandOnboardView` is structurally a state machine — easy to wrap real Stripe calls into the existing shape

The 3-state machine (`loading → complete | failed`) maps cleanly to a real Stripe Connect Embedded Components lifecycle. Failure mode: the long-press dev-gesture for QA still works in production. Verified via `BrandOnboardView.tsx:78-83`.

#### 🟠 CF-3 — `BrandPaymentsView` reads from Zustand `brand.payouts` + `brand.refunds` + `brand.availableBalanceGbp`

These fields populate from the dev-seed button only. B2 must wire them to React Query reads from `payouts` + `refunds` tables OR derive from Stripe API directly. Verified via `BrandPaymentsView.tsx:175-187` + `currentBrandStore.ts:32-37` schema-version comments.

#### 🟠 CF-4 — `RefundSheet` writes to local Zustand `useOrderStore.recordRefund` only; no DB write

A "successful" stub refund creates a fictional record that never lands in the `refunds` table. Comment line 16-18: "NO Stripe-fee-retained line in stub mode (Const #9 — would fabricate fee data). Wires when B-cycle adds real Stripe." Verified via `RefundSheet.tsx:42-44 + 63-66`.

#### 🟠 CF-5 — `BrandFinanceReportsView` hard-codes Mingla fee 2% + £0.30 / Stripe 1.5% + £0.20

Lines 27–30: "[TRANSITIONAL] Mingla fee + Stripe processing rates are hard-coded... Real Stripe rates land in B2 — replace the constants below with brand-config or a global config table." Without B2 replacing these, finance-report numbers will misalign with actual Stripe-deducted fees (Stripe Connect Express is typically 2.9% + £0.30, not the placeholder 1.5%). Verified at `BrandFinanceReportsView.tsx:27-30`.

#### 🟠 CF-6 — No transactional email helper in `_shared/`; only `notify-dispatch` references Resend

KYC stall recovery (J-B2.4) requires sending email. Currently there is no reusable Resend wrapper in `_shared/`. `notify-dispatch` is push-notification-focused, not transactional email. B2 must build a transactional email pattern for stall recovery + payout notifications + receipt emails (the latter spans into B3). Verified via `Grep Resend|sendEmail` in `_shared/` returns zero matches; only `notify-dispatch/index.ts` matches.

#### 🟠 CF-7 — No `audit_log` writer pattern in any edge function

§B.7 specifies `audit_log` should record every Connect state transition. Zero edge functions write to it today. B2 must establish the pattern. Verified via `Grep audit_log|writeAudit` in `supabase/functions/` returns zero files.

### 3.3 Hidden Flaws (🟡)

#### 🟡 HF-1 — `payment_webhook_events` table has RLS enabled but no policies

`ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;` (line 15783) but no `CREATE POLICY` exists for it. Default deny: only service-role can read/write. This is intentionally correct per §B.6 spec ("service role only from clients") but B2 must NOT add a policy here even if a future hand thinks it's missing. **Add a comment in the migration explaining the absence is intentional** — otherwise a future audit will flag this as a missing-policy bug.

#### 🟡 HF-2 — `brands.stripe_payouts_enabled` defaults to FALSE NOT NULL

If a B2 webhook handler tries to UPDATE this column to `null` (which Stripe will never do, but defensive code might), the column constraint will reject. Inverse hidden flaw: if any future code tries to "clear" the Stripe state via setting null, it will silently fail. Verified at line 7776.

#### 🟡 HF-3 — `payouts.amount_cents > 0` CHECK constraint blocks zero-amount payouts

Stripe occasionally generates zero-amount payouts in edge cases (fee adjustments). The current CHECK rejects them outright. Webhook handler will throw on these; the durable-queue pattern means the row will sit `processed=false` forever. Verified at line 8648.

#### 🟡 HF-4 — `refunds.amount_cents > 0` CHECK constraint blocks zero-amount refund records

Same hidden flaw class as HF-3. A "refund attempt that ultimately processed zero" still needs a record to exist for audit. Verified at line 9240.

#### 🟡 HF-5 — `door_sales_ledger.amount_cents >= 0` allows zero (different from payouts/refunds)

Inconsistency: zero-cent door sale rows are allowed; zero-cent payout/refund rows are blocked. May be intentional for door comp tickets, but B2 SPEC should explicitly note the asymmetry to prevent future "consistency fix" that breaks comp ticketing. Verified at line 8157.

#### 🟡 HF-6 — `brands.stripe_connect_id` is `text` (no length cap or format validation)

Stripe account IDs are `acct_*` 20-char strings. The column accepts arbitrary text. A bug in B2 setting an unrelated Stripe ID (e.g., `pi_*` payment-intent ID) would silently corrupt the column. Verified at line 7775.

#### 🟡 HF-7 — `currentBrandStore` schema-version migration v7→v8 silently strips Stripe fields with no fallback

Schema v8 (Cycle 2 J-A10/J-A11) adds Stripe fields as optional; v12 (DEC-092) drops `members`/`pendingInvitations`. If B2 changes the Brand shape's `stripeStatus` enum — say adding a new `pending_kyc` value — old persisted Zustand state would have `undefined` resolved at read sites to `not_connected`, which may not be correct. Verified via `currentBrandStore.ts:31-37` schema history.

#### 🟡 HF-8 — `useBrandCascadePreview.hasStripeConnect` is approximate (existence-only)

Returns `true` if `stripe_connect_id !== null`. But a brand can have a `stripe_connect_id` and be in `restricted` state (charges_enabled=false). The cascade-preview-driven detach flow (J-B2.5) will wrongly report "Stripe is connected" for a brand in restricted state. Verified via `useBrands.ts:382-384`.

#### 🟡 HF-9 — `RefundSheet` mode='partial' computes refund total client-side only

Without B2 wiring, the partial refund total is computed in JS from local order data. Once B2 adds real Stripe refund calls, the trusted total must be computed server-side (DB JOIN to `tickets` + `orders`) to prevent client tampering. Verified via `RefundSheet.tsx:80-84` (PartialLineState).

### 3.4 Observations (🔵)

- 🔵 **OBS-1** — `currentBrandStore.ts` has 12 schema versions; v8 was the J-A10/J-A11 Stripe-fields addition. The persist migration tradition is well-established (lines 18–69), so adding new Stripe fields in B2 follows known patterns.
- 🔵 **OBS-2** — The `biz_can_manage_payments_for_brand` helper at line 3059 allows `account_owner` + `brand_admin` (via `biz_is_brand_admin_plus`) + `finance_manager` (via explicit equality check). This already implements the recommended D-B2-1 default with no changes needed. Permission gating is "free" for B2.
- 🔵 **OBS-3** — `payouts.currency` defaults to `'GBP'` (line 8644) — matches Q9's UK-baseline resolution. International expansion in B2 will require this default to be overridden per-brand based on `brands.default_currency`.
- 🔵 **OBS-4** — No indexes exist on `payment_webhook_events.created_at` — a `WHERE processed=false ORDER BY created_at` query (cron retry pattern) would full-scan over time. Consider adding in B2 migration.
- 🔵 **OBS-5** — `stripe_connect_accounts.requirements` is `jsonb DEFAULT '{}'` — Stripe's `requirements.currently_due` array typically contains 5–15 ID strings. Index on JSONB path could help "find all stalled brands" queries; defer until query-pattern emerges.
- 🔵 **OBS-6** — `payouts.status_check` allows `'pending' | 'paid' | 'failed'` (line 8649). Stripe webhooks emit `paid` + `pending` + `failed` + `in_transit` + `canceled`. Mismatch: `in_transit` and `canceled` are Stripe-emitted but not in our enum. Webhook handler will need to map (e.g., `in_transit → pending`) or migration must extend the constraint.

---

## 4. Schema-State Matrix

Status legend: 🟢 = exists & B2-ready | 🟡 = exists but missing pieces | 🔴 = missing entirely

| Table | Status | Columns | RLS | Indexes | FKs | Notes |
|---|---|---|---|---|---|---|
| `stripe_connect_accounts` | 🟢 | id, brand_id, stripe_account_id, account_type DEFAULT 'express', charges_enabled, payouts_enabled, requirements JSONB, created_at, updated_at | "Brand admin plus can manage" via `biz_can_manage_payments_for_brand_for_caller` | unique idx_brand_id (DEC-113 ✓), idx_stripe_account_id, updated_at trigger | brand_id → brands(id) ON DELETE CASCADE | DEC-112 + DEC-113 already encoded. No `detached_at` column for soft-detach (D-B2-19). |
| `payouts` | 🟢 | id, brand_id, stripe_payout_id, amount_cents, currency 'GBP', status, arrival_date, created_at | "Brand admin plus can manage" | idx_brand_id | brand_id → brands(id) ON DELETE CASCADE | HF-3: amount_cents>0 CHECK blocks zero-amount. OBS-6: status enum missing `in_transit`+`canceled`. |
| `refunds` | 🟢 | id, order_id, stripe_refund_id (nullable!), amount_cents, reason, initiated_by, status, created_at | "Brand admin plus can manage" via `biz_order_brand_id` | idx_order_id | order_id → orders(id) CASCADE; initiated_by → auth.users(id) | HF-4: amount_cents>0 CHECK. status_check has `cancelled` (UK spelling). |
| `door_sales_ledger` | 🟢 | id, event_id, order_id, scanner_user_id, payment_method, amount_cents, currency, reconciled, reconciled_at, notes, created_at | "Brand admin plus can manage" via `biz_event_brand_id` | idx_event_id, idx_order_id | event_id → events(id) CASCADE; order_id → orders(id) SET NULL; scanner_user_id → auth.users(id) SET NULL | HF-5: amount_cents>=0 (allows zero, asymmetric with payouts/refunds). Append-only intent per comment. |
| `payment_webhook_events` | 🟡 | id, stripe_event_id, type, payload JSONB, processed, processed_at, error, created_at | RLS enabled, NO POLICY (intentional service-role-only) | unique idx_stripe_event_id (replay protection ✓), idx_processed | None | HF-1: RLS-without-policy pattern needs migration comment. OBS-4: missing idx_created_at for cron retry queries. |
| `brands.stripe_connect_id` (denorm) | 🟡 | text, nullable, no validation | inherits brands RLS | none | none | R-4 redundancy. HF-6: no length/format validation. |
| `brands.stripe_payouts_enabled` (denorm) | 🟡 | boolean DEFAULT false NOT NULL | inherits brands RLS | none | none | R-4 redundancy. HF-2: NOT NULL blocks null reset. |
| `brands.stripe_charges_enabled` (denorm) | 🟡 | boolean (per `BrandRow` type, schema not directly read) | inherits brands RLS | none | none | R-4 redundancy. Need to confirm exact CREATE TABLE definition. |
| `audit_log` | 🟡 | (per §B.7 spec — schema not yet read in this pass) | per §B.7 | per §B.7 | per §B.7 | CF-7: No edge function writes to it today. B2 must establish pattern. |

---

## 5. Edge-Function-State Matrix

| Function | Status | Body | Notes |
|---|---|---|---|
| `brand-stripe-onboard` | 🔴 missing | n/a | §C.1 reserves the name; B2 must build from scratch |
| `brand-stripe-refresh-status` | 🔴 missing | n/a | §C.1 reserves the name; B2 must build |
| `brand-stripe-detach` (J-B2.5) | 🔴 missing | n/a | NOT in §C.1 list — name needs reservation (D-B2-22) |
| `stripe-webhook` (or similar) | 🔴 missing | n/a | Critical — durable queue pattern (R3) requires this |
| `brand-stripe-stalled-cron` (J-B2.4) | 🔴 missing | n/a | Cron-driven; alternative: pg_cron-only — D-B2-13 |
| `brand-export-finance-report` | 🔴 missing | n/a | §C.1 reserves the name; ties to B5 marketing analytics |
| `_shared/stripe.ts` | 🔴 missing | n/a | No Stripe client wrapper exists |
| `_shared/idempotency.ts` | 🔴 missing | n/a | No idempotency-key generator exists |
| `_shared/audit.ts` | 🔴 missing | n/a | No audit-log writer exists (CF-7) |
| `_shared/resend.ts` | 🔴 missing | n/a | No transactional email helper exists (CF-6) |

**Net:** B2 establishes 6 net-new edge functions + 4 net-new `_shared/` modules. None can build on existing infrastructure.

---

## 6. Decision Queue (D-B2-1 through D-B2-23)

Operator must lock these before SPEC writing. Each has a **recommended default** and reasoning. Decisions in **bold** are load-bearing — a different choice changes large sections of the SPEC.

### Permission + identity

- **D-B2-1** — Permission rank for `brand-stripe-onboard`: **already locked by existing `biz_can_manage_payments_for_brand` helper — accepts `account_owner` + `brand_admin` + `finance_manager`.** No change needed; this decision is closed. Tag in SPEC for awareness only.
- **D-B2-2** — Stub deletion strategy: **delete** the `BrandOnboardView` simulated state machine entirely once B2 wiring lands; do NOT keep behind feature flag. Reason: live + stub are visually identical UX; flag-gated stub creates two test paths. Recommended.

### Schema decisions

- **D-B2-3** — Reconcile R-4 dual Stripe state: **keep `stripe_connect_accounts` canonical**; demote `brands.stripe_connect_id` + `stripe_payouts_enabled` + `stripe_charges_enabled` to a denormalized read-cache kept in sync via DB trigger that reflects from `stripe_connect_accounts` AFTER UPDATE. Alternative: drop the `brands.stripe_*` columns entirely (requires app code refactor — `useBrandCascadePreview` must change query). Recommend **trigger-synced cache** to minimize app-code churn.
- **D-B2-4** — `account_type` default behavior: **already DEFAULT 'express' NOT NULL** per migration line 9749. No change.
- **D-B2-5** — Stripe API version pinning: pin to a specific dated version (e.g., `2025-10-29.acacia`). Recommend pinning at SDK-default-latest at B2 ship time + adding to a constant in `_shared/stripe.ts` so B3 + B4 share the same pin.
- **D-B2-6** — Edge function naming for J-B2.5 detach: **`brand-stripe-detach`** (matches "detach" verb in §B.6 spirit, parallels `brand-stripe-onboard` + `brand-stripe-refresh-status`).
- **D-B2-7** — Add `idx_payment_webhook_events_created_at` for cron retry queries (OBS-4). Recommend yes.
- **D-B2-8** — Extend `payouts.status_check` to include `'in_transit'` + `'canceled'` (OBS-6). Recommend yes — Stripe emits these. Migration must `DROP CONSTRAINT` + `ADD CONSTRAINT` with extended enum.
- **D-B2-9** — Add `detached_at timestamptz NULL` column to `stripe_connect_accounts` for soft-detach (HF-flagged, J-B2.5). Recommend yes.

### Onboarding flow (J-B2.1 + J-B2.3)

- **D-B2-10** — Embedded onboarding wrapper UI: **dedicated full-page route `/brand/[id]/payments/onboard`** (already exists for the stub at `mingla-business/app/brand/[id]/payments/onboard.tsx`) — keep the route, replace the body. Reason: state machine UX needs full screen; partial drawer is too narrow for the Stripe Embedded Component frame.
- **D-B2-11** — Status refresh strategy: **webhook-driven invalidate via Supabase Realtime broadcast** + 30s poll fallback for the `/onboard` page only. Reason: webhook is the truth source; poll fallback covers Realtime-disconnected edge cases (Expo Web with stale tab).
- **D-B2-12** — What blocks event publish: **`charges_enabled=true`** on the brand's `stripe_connect_accounts` row. Do NOT additionally require `payouts_enabled` — events can sell tickets while Stripe is still verifying payout-bank-routing details. Per R2 mitigation: "Allow event creation in draft before Connect is live; only block at publish."
- **D-B2-13** — Currency/region scope at MVP: **UK-only at B2 ship**, then operator-driven country expansion in subsequent ORCH (set Stripe Connect Express country list to `['GB']` at edge-fn level; expand via constant flip when expansion approved). Reason: Q9 already locks UK-baseline.
- **D-B2-14** — Concurrent-onboard lock-out: rely on **DB unique index on `stripe_connect_accounts.brand_id`** (line 12223) to fail second-writer with 23505. Frontend handles via friendly error message. No app-level lock needed — DB constraint is sufficient.

### Status surfacing (R-3 fix)

- **D-B2-15** — `brand.stripeStatus` derivation: **server-side derivation via SQL helper** (e.g., `pg_derive_brand_stripe_status(brand_id)` returning the 4-value enum) rather than client-side derivation. Reason: keeps derivation logic single-sourced; mirrors the `pg_map_primary_type_to_mingla_category` pattern from ORCH-0700. SPEC must define exact mapping rules.
- **D-B2-16** — `mapBrandRowToUi` Stripe field mapping: read denormalized `brands.stripe_*` cache (per D-B2-3) for fast list rendering; React Query separately fetches full `stripe_connect_accounts` row for the payments page. Reason: list views never need full JSONB requirements — would over-fetch.

### Stall recovery (J-B2.4)

- **D-B2-17** — Stall detection mechanism: **pg_cron job** scanning `stripe_connect_accounts WHERE charges_enabled=false AND created_at < now() - interval '24 hours'` daily at 09:00 UTC. Reason: simpler than webhook-driven; Stripe doesn't emit a "stalled" event.
- **D-B2-18** — Stall email cadence: **single follow-up at 24h, second at 72h, then stop**. Reason: 7d+ users have abandoned; further emails harm sender reputation.
- **D-B2-19** — Stall email template: Resend template with `resume_link` deep link; resume link reaches `/brand/[id]/payments/onboard?resume=1` which calls `account_links.create` (not `accounts.create`) to continue the same Stripe account. Recommend.

### Detach flow (J-B2.5)

- **D-B2-20** — Detach: **soft-detach** (set `stripe_connect_accounts.detached_at = now()` + flip `charges_enabled = false` locally + SYNC to `brands.stripe_*` cache + DO NOT delete the Stripe account). Hard-delete via `accounts.del()` is destructive and irreversible — preserve historical records. Per Constitution #6 (logout clears) — NOT applicable here; this is brand-level not user-level. Per §B.6 schema intent — soft-detach is the only audit-compatible pattern.
- **D-B2-21** — Detach when active events exist: **block** detach if any non-deleted event with `status IN ('upcoming', 'live')` references this brand. UI shows a Cycle-13a-style cascade-preview modal listing affected events. Reason: detach mid-event would break ticket sales.

### Cross-cutting

- **D-B2-22** — Idempotency-Key generation: **`{brand_id}:{operation}:{epoch_ms}`** deterministic format stored in a new `_shared/idempotency.ts`. Reason: traceable; surviving server restarts; works for retry detection.
- **D-B2-23 (LOAD-BEARING)** — Stripe Connect Embedded Components SDK strategy: **add `@stripe/connect-js` as a web-only dependency** + **wrap in a WebView component for native iOS/Android** (since Stripe does not yet ship a React Native Connect Embedded Components SDK as of 2026). Alternative: redirect via Account Link — REJECTED because R2 mandates "embedded, not redirect." Alternative: build a custom in-app form against Stripe's REST API — REJECTED because we'd be re-implementing what Embedded Components provides. **This is the biggest unknown; benefits from a small tech-spike before SPEC writing locks the approach.**

---

## 7. Risks Discovered (not in original §6 risk register)

- **R-NEW-1** — `BrandFinanceReportsView` hard-coded fee constants (Mingla 2%+£0.30, Stripe 1.5%+£0.20) will become factually wrong the moment B2 ships. Stripe Connect Express UK is 2.9%+£0.30 (or higher for cards from EEA). Customer-facing reports will misalign with actual deductions until these constants are replaced (CF-5).
- **R-NEW-2** — `RefundSheet` writes to local Zustand only; if a brand admin issues a "refund" via the stub today, the UI shows it but no DB row exists. If B2 ships and these fictional Zustand-refunds are still in users' caches, B2 must include a one-time migration to flush stale refund Zustand state OR the user sees ghost refunds that don't appear in their Stripe ledger (CF-4 + HF-9).
- **R-NEW-3** — `useBrandCascadePreview.hasStripeConnect` returning `true` when `stripe_connect_id IS NOT NULL` will allow the BrandDeleteSheet to claim Stripe is "connected" even for restricted-state brands. After B2, the cascade preview must use the derived `brand.stripeStatus = 'active'` check instead (HF-8).
- **R-NEW-4** — `payment_webhook_events` table has RLS enabled but no policy. This is intentionally correct (service-role-only) but invisible to a future auditor. A migration comment should explicitly document this as intentional, otherwise future "missing policy" audits will flag it as a security gap (HF-1).
- **R-NEW-5** — `app-mobile/package.json` has zero Stripe packages. If B2 + B3 add Stripe to `mingla-business` only, the consumer app can never accept payment for any tickets purchased through the app (only through Expo Web). Per Cycle 8a anon-buyer invariant, anon checkout routes work — but if/when consumer-app-side ticket purchase is wired, it'll need its own Stripe SDK install. Flag as a dependency for B3 / future ticket purchase cycles.
- **R-NEW-6** — `BrandOnboardView` long-press dev gesture (`handleHeaderLongPress`) flips into "failed" state for QA. If B2 keeps this gesture in the live flow, an end-user discovering the long-press could intentionally fake a "failed" state to dispute Stripe behavior. Must be removed at B2 ship (D-B2-2 covers this implicitly — full delete kills the gesture).

---

## 8. Recommendations for SPEC scope (single B2 vs split B2a + B2b)

Cycle epic estimates 48hr IMPL. Based on the gap surface:

**Recommendation: split B2 into B2a + B2b.**

- **B2a — Onboarding + Status (~28 hrs):** J-B2.1 + J-B2.2 + J-B2.3. Wire embedded Connect Express, status refresh via webhook+poll, brand-level routing, derivation helper, mapper updates, idempotency + audit + Stripe-shared infrastructure. Establishes the foundation other cycles depend on.
- **B2b — Stall recovery + Detach (~20 hrs):** J-B2.4 + J-B2.5. Adds pg_cron stall detection, Resend email template, soft-detach flow, cascade-preview modal. Builds on B2a's webhook + audit infrastructure.

**Reasoning:**
- B3 (checkout) is gated on B2a only. Split lets B3 forensics start in parallel once B2a's interfaces are locked.
- D-B2-23 (SDK strategy) is load-bearing for B2a. A small 1-day tech-spike before B2a SPEC reduces risk of mid-cycle pivot.
- B2b can absorb learnings from B2a's webhook handling (refunds, payouts) into its detach + stall flows.

**If split rejected** and the operator wants single B2: SPEC must explicitly call out that the 48hr estimate is optimistic given the load-bearing SDK decision (D-B2-23), the dual schema reconciliation (D-B2-3 trigger work), and the four net-new `_shared/` modules. Realistic single-cycle estimate: 64–80 hrs.

---

## 9. Confidence Summary

| Area | Confidence | What would raise it |
|---|---|---|
| Schema state (5 tables, RLS, indexes, FKs, helpers) | **High** | N/A — read every authoritative migration line |
| Migration Chain Rule satisfied (no later migration supersedes Stripe schema) | **High** | Confirmed via `ls migrations/` + targeted greps across all migration files |
| Edge function inventory (zero Stripe, zero `_shared/` Stripe utilities) | **High** | Confirmed via `ls supabase/functions/` + `find _shared/` |
| UI stub state (`BrandOnboardView`, `BrandPaymentsView`, `RefundSheet`, `PaymentElementStub`) | **High** | Read full files; confirmed TRANSITIONAL markers and B2-exit comments inline |
| Mapper layer gap (`mapBrandRowToUi` ignores Stripe) | **High** | Read full `brandMapping.ts` + `brandsService.ts`; grep confirms no derivation logic anywhere |
| Permission helper accuracy (`biz_can_manage_payments_for_brand`) | **High** | Read full function body + `biz_is_brand_admin_plus` + `biz_role_rank` referenced at line 3041 (rank-gte pattern verified) |
| `app-mobile` Stripe absence | **High** | Confirmed via `package.json` grep |
| Cycle 17e-A migration chain interactions (kind/address/cover_hue) | **Medium-High** | Read `brandMapping.ts` BrandRow type confirming new columns; did not read migration `20260506000000_brand_kind_address_cover_hue_media.sql` body |
| Stripe Connect Embedded Components SDK status (D-B2-23) | **Medium** | Relied on dispatch context + `package.json` evidence; did not consult Stripe docs or SDK release notes directly |
| `audit_log` table exact schema | **Medium** | Confirmed §B.7 spec exists in Project Plan; did not read the migration definition. SPEC writer must read it before writing audit-helper signatures |
| Live DB state (counts, populated rows) | **Low** | Not probed per dispatch §5 constraint. SPEC writer should verify `stripe_connect_accounts` row count = 0 + `brands.stripe_connect_id IS NOT NULL` count = 0 to confirm no production data already exists pre-B2 |

**Overall confidence: High** for findings that drive D-B2-1 through D-B2-22. **Medium** for D-B2-23 (load-bearing). **Medium** for the 48-hr-vs-split estimate (depends on D-B2-23 outcome).

---

## 10. Discoveries for Orchestrator (side issues)

These are unrelated to B2 directly but surfaced during this investigation and should be registered in the World Map / Priority Board:

- **DISC-1** — `BrandFinanceReportsView` Stripe-fee constants will be wrong post-B2 ship (R-NEW-1). Should be wired to a config table or brand-config in B2b OR a fast-follow ORCH.
- **DISC-2** — `RefundSheet` writes to Zustand only — refund stub creates fictional records (CF-4). Should be flushed in B2 ship migration OR B3 should explicitly include a Zustand-clear step.
- **DISC-3** — `payouts.status_check` enum missing `in_transit` + `canceled` values (OBS-6). Will block legit Stripe webhooks. B2 migration must extend.
- **DISC-4** — `app-mobile` has zero Stripe packages (R-NEW-5). Future consumer-app ticket purchases need their own Stripe SDK install. Flag for B3 forensics dispatch.
- **DISC-5** — `brand-export-finance-report` edge fn exists in §C.1 but is missing from the implementation. Tied to B5 marketing analytics; not a B2 dependency but worth registering.
- **DISC-6** — `BrandOnboardView` long-press dev gesture exists for QA (R-NEW-6). Will become a production back-door if not deleted at B2 ship. SPEC must explicitly call out gesture deletion.
- **DISC-7** — `currentBrandStore` Zustand has `payouts: BrandPayout[]` + `refunds: BrandRefund[]` arrays at the Brand level (per v8 schema). Once B2 ships React Query reads from `payouts` table, these Zustand fields become orphan storage that could go stale. Persistent migration v12 → v13 should drop them OR repurpose as cache.

---

## 11. Layman summary (for chat output)

- **What's there today:** all 5 §B.6 database tables exist with the right columns, RLS, and FK chain. The `account_type='express'` default and the unique-per-brand index already encode DEC-112 + DEC-113. The permission helper that decides who can set up payments already correctly allows account_owner + brand_admin + finance_manager. The frontend has a fully-built status banner + onboarding state-machine UI that just needs its plumbing wired.
- **What's not there:** zero Stripe edge functions exist out of 58 total; zero shared Stripe / idempotency / webhook / Resend / audit-log helpers exist; the brand mapper completely ignores Stripe columns from the database; a redundant copy of Stripe state lives on the `brands` table and creates a Constitutional #2 candidate; and there's no decision yet on which Stripe SDK supports embedded Connect onboarding for React Native + Expo Web.
- **Recommendation:** split B2 into B2a (onboarding + status, 28hrs) + B2b (stall recovery + detach, 20hrs). Run a 1-day tech-spike on the embedded-Connect SDK strategy (D-B2-23) before B2a SPEC writing. Lock the other 22 decisions, then the SPEC writer can produce two clean specs that B3 can build against in parallel.
- **Confidence:** High on schema + edge function inventory + UI gap. Medium on the SDK question. Live DB state not probed (per dispatch).

**Findings:** 4 root-cause-class · 7 contributing factors · 9 hidden flaws · 6 observations
**Decisions to lock:** 23 (D-B2-1 through D-B2-23) — most have recommended defaults.
**Discoveries for orchestrator:** 7 side issues registered above.
