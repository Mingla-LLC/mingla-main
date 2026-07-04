# SPEC — ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT (audited money actions)]

**Parent:** META-ORCH-1237 (Admin full-visibility + act console). **Children-of:** ORCH-1271 (authz & audit FOUNDATION) + ORCH-1274 (money READ wave).
**Phase:** SPEC (build contract). **Author:** mingla-forensics. **Domain:** HIGHEST-RISK wave-2 (real money).
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surface:** Admin Web (`mingla-admin/`) + backend (edge fns + audited write RPCs). No shipping-app surface.
**Seth's rule (binding):** every money ACT is HIGH-risk → **typed REASON + CONFIRM + AUDIT**. No exceptions in this wave.

**Inputs consumed in full:** `SPEC_ORCH-1274_ADMIN_MONEY_CONSOLE_READ.md` (its §9 WAVE-2 deferred-action notes are this spec's starting scope), `INVESTIGATION_META-ORCH-1237_MONEY_STRIPE_ORDERS_SUBS.md`, `SPEC_ORCH-1271_ADMIN_AUTHZ_FOUNDATION.md` + the 1271 branch source. **Stripe shapes:** taken verbatim from the proven in-repo edge fns (`refund-order`, `brand-stripe-refresh-status`, `brand-stripe-onboard`) — no new Stripe integration logic is invented, and NO Stripe API was called by this spec.

**COMMS ledger:** scanned on entry. Only OPEN row touching scope = **COMMS-0061** (WARN, ALL): `gqnoajqerqhnvulmnyvv` is LIVE PROD; DR drills clone-only. Honored by construction — this spec ran only read-only source/schema inspection, mutated nothing, called no Stripe/DB write. Factored (WARN, no ack-write needed). No BLOCK row addressed to `mingla-forensics` / ORCH-1278 / ALL is OPEN.

> **Evidence tags:** `[src]` = read verbatim from repo source this session; `[1271]` = defined by the 1271 foundation branch (`origin/1271-admin-authz-foundation`, read this session); `[1274]` = sealed by the 1274 read spec (schema verified vs live PROD 2026-07-03); `[report]` = sealed by the META-1237 money investigation.

---

## 0. BLOCKING PREREQUISITE (read first)

**1278 IMPLEMENT is BLOCKED until BOTH 1271 and 1274 are merged to `origin/main`.** As of this spec neither is on `main` `[src]`:
- ORCH-1271 lives only on branch `origin/1271-admin-authz-foundation` (has `admin-write-primitive/index.ts`, `admin_write_audit`, `admin_audit_probe`, `is_admin_user` single-gate, `EntityListView`/`EntityDetailView`/`HighRiskActionModal`, `adminWriteService.js`) — NOT merged.
- ORCH-1274 has **no branch and no worktree** yet — spec'd, not built. 1278 modifies 1274's pages (`BusinessOrdersPage`, `BusinessPaymentsPage`, `BusinessMoneyLedgerPage`, `SubscriberContextCard`) and reuses `adminMoneyService.js`.

1278 consumes: the `admin-write-primitive` edge skeleton + `admin_write_audit` + `is_admin_user()` (1271); the money read-RPCs, the three pages, the disabled `WAVE-2`-tagged buttons, and `SubscriberContextCard` (1274). If either parent is not on `main` at dispatch → STOP and report to the orchestrator. All schema/fn/RPC facts below were nonetheless verified this session against live source so the contract is build-ready the moment the parents land.

---

## 1. Scope & risk table

Four money ACT actions. Each is delivered as **(A) a service_role edge fn re-checking `admin_users` + calling Stripe** (for Stripe-touching acts) **OR (B) a guard-first audited write RPC** (for DB-only state), plus the reason+confirm+audit flow and UI wiring on the 1274 pages.

| # | Action | Mechanism | Moves REAL money? | Risk | Live-fire gate |
|---|--------|-----------|-------------------|------|----------------|
| **W2-A** | **Refund an order** (full / partial) | Edge fn `admin-refund-order` → **2 new RPCs** `admin_refund_order` + `admin_refund_order_commit` (admin twins of `biz_refund_order`/`biz_refund_order_commit`, brand-gate stripped) → Stripe `refunds.create` | **YES (LIVE only)** | **CRITICAL** | TEST-mode build/test pre-authorized; **any LIVE-mode refund needs Seth's explicit go** |
| **W2-B** | **Connect refresh / onboarding link** | Edge fn `admin-stripe-connect-action` (mode `refresh` \| `onboarding_link`) → Stripe `accounts.retrieve` / `accountSessions.create` | NO | HIGH (rule) | Safe to live-fire (read-through / session mint only) |
| **W2-C** | **Dispute internal note / mark-reviewed** | **DB-only** RPC `admin_annotate_dispute` (+ 3 nullable annotation cols on `stripe_disputes`) | NO | HIGH (rule) | Safe (no Stripe, no money) |
| **W2-D** | **Subscription comp / extend / revoke override** | **REUSE** `admin_grant_override` / `admin_revoke_override` behind thin audited wrappers `admin_grant_override_audited` / `admin_revoke_override_audited` | NO (DB entitlement) | MEDIUM | Safe (DB shim; **real cancel/refund is OUT OF SCOPE** — G-9 product decision) |

**Only W2-A moves real money** (and only in Stripe LIVE mode; Mingla is TEST end-to-end today `[report][1274]`, so build + test is safe). W2-B/C/D never move money. All four still carry reason+confirm+audit per Seth's rule.

---

## 2. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched | Parity |
|---|---------|----------|-----------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | n/a — admin-only |
| 2 | Consumer Android (`app-mobile/`) | NO | — | none | n/a |
| 3 | Buyer/anon Web (`mingla-business/` public) | NO | — | none | n/a |
| 4 | Business iOS (`mingla-business/`) | NO | — | none | n/a |
| 5 | Business Android (`mingla-business/`) | NO | — | none | n/a |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | Wave-2 buttons on 1274 pages become live, each behind a typed-reason + confirm modal: refund on Orders detail; refresh/onboarding-link on Payments detail; note/mark-reviewed on Disputes detail; comp/revoke on SubscriberContextCard. | `mingla-admin/src/pages/{BusinessOrdersPage,BusinessPaymentsPage,BusinessMoneyLedgerPage}.jsx`, `components/entity/SubscriberContextCard.jsx`, `services/adminMoneyActService.js`; `supabase/functions/{admin-refund-order,admin-stripe-connect-action}/`; `supabase/migrations/*`; `supabase/config.toml` | Manual (single admin surface) |
| 7 | Business Web preview (adjacent) | NO | — | none | n/a |

Backend edge fns/RPCs are shared by definition (one DB). No consumer/business/buyer parity obligation — all four acts are admin-only.

---

## 3. Foundation contracts consumed (do NOT redefine)

- **Gate `[1271]`:** `public.is_admin_user()` — `auth.uid()` → `auth.users.email` → `admin_users` (STABLE, SECURITY DEFINER). Returns FALSE when `auth.uid()` IS NULL (service_role context) `[src]`.
- **Audited-write helper `[1271]`:** `admin_write_audit(p_action, p_entity_type, p_entity_id, p_reason, p_metadata DEFAULT '{}', p_require_reason DEFAULT true, p_actor_email DEFAULT NULL, p_actor_uid DEFAULT NULL) RETURNS uuid`. Guard: `IF auth.uid() IS NOT NULL AND NOT is_admin_user() THEN RAISE 'not_authorized'`. Requires non-blank reason when `p_require_reason`. Resolves actor via `COALESCE(p_actor_*, auth.uid()/email)` → **service_role callers MUST pass `p_actor_email` + `p_actor_uid`** (auth.uid() is NULL). Inserts `admin_audit_log(admin_email, actor_uid, action, target_type, target_id, reason, metadata)` (append-only: INSERT+SELECT RLS, no UPDATE/DELETE) `[src]`.
- **Golden write-RPC template `[1271]`** (`admin_audit_probe`): `SECURITY DEFINER SET search_path TO 'public'`; **first executable statement** `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;` → business mutation → `admin_write_audit(...)`. Every DB-only act (W2-C, W2-D wrappers) copies this spine `[src]`.
- **Edge-fn skeleton `[1271]`** (`admin-write-primitive/index.ts`, `verify_jwt = true` in config.toml `[src]`): `authorization` header → `supabase.auth.getUser(token)` → 401 if no user → `admin_users` `.eq('email',user.email).eq('status','active').maybeSingle()` → **403 if not an active admin** → require non-blank `reason` → 400 → do work (service_role) → `admin_write_audit(..., p_actor_email:user.email, p_actor_uid:user.id)` → `{ ok, audit_id }`. Every Stripe-touching act (W2-A, W2-B) copies this spine `[src]`.
- **UI primitives `[1271]`:** `HighRiskActionModal` (typed reason + confirm — the wave-2 UI), `EntityDetailView` (`actions` prop hosts the buttons), `adminWriteService.js` exports `callAdminWriteRpc(rpcName, params)` (authed-JWT RPC path) + `invokeAdminWriteEdge(fnName, body, opts)` (edge path). Reuse; do not re-implement.
- **1274 seams consumed:** `adminMoneyService.js` (read wrappers), the disabled `WAVE-2`-tagged buttons on the three pages + `SubscriberContextCard`, `admin_get_order`/`admin_get_dispute`/`admin_get_brand_stripe_status`/`admin_get_subscription_detail` read bundles (used to hydrate the modals) `[1274]`.

---

## 4. Existing money infrastructure the acts mirror / twin (verified this session)

| Object | Signature / shape | Gate (why an admin twin is needed) | Ref |
|---|---|---|---|
| `refund-order` edge fn | `Idempotency-Key` header (8–128) → `biz_refund_order` (as-user JWT) → resolve connected acct (`orders.event_id → events.brand_id → brands.stripe_connect_id`) → `stripe.refunds.create({payment_intent, amount, reason:'requested_by_customer', refund_application_fee, metadata}, {idempotencyKey:'ticket_refund:<refundId>', stripeAccount})` → `tax.transactions.createReversal` → `biz_refund_order_commit` → notify → `writeAudit` | JWT + brand role (as-user RPCs). No admin path. | `[src]` |
| `biz_refund_order(p_order_id, p_lines jsonb, p_reason, p_idempotency_key) → jsonb` | idempotency precheck on `refunds.metadata->>'idempotency_key' + order_id + status='pending'`; **brand gate `biz_can_manage_payments_for_brand(brand_id, auth.uid())`**; order `payment_status IN ('paid','partial_refund')`; reason 10–200; **per-line bound: `existing_refunded_qty + req_qty ≤ line.quantity`** (over refunds in `('pending','succeeded')`); sum(amount)>0; INSERT `refunds`(pending) + `refund_line_items`; returns `{refund_id, amount_cents, currency, stripe_payment_intent_id, stripe_charge_id, application_fee_amount_cents, proposed_new_payment_status, is_full_refund, idempotent_replay}` | **auth.uid()-based brand gate** → admin (service_role) fails → **twin required** | `[src]` |
| `biz_refund_order_commit(p_refund_id, p_stripe_refund_id, p_application_fee_refunded_cents int, p_status, p_stripe_tax_transaction_id DEFAULT NULL) → jsonb` | idempotent (non-`pending` → replay); status `IN ('succeeded','failed')`; **brand gate at line 497 `biz_can_manage_payments_for_brand(brand_id, auth.uid())`**; on success UPDATE `refunds`(succeeded, stripe_refund_id, app_fee, tax, processed_at), recompute `orders.refunded_amount_cents` = Σ succeeded, set `payment_status` = `refunded`\|`partial_refund`, void `tickets`→`refunded` | **auth.uid()-based brand gate (line 497)** → admin (service_role) fails → **twin required (corrects 1274 §9 W2-A "reuse commit" note)** | `[src]` |
| `brand-stripe-refresh-status` edge fn | POST `{brand_id}` → getUser → `biz_can_manage_payments_for_brand` → read `stripe_connect_accounts` → `stripe.accounts.retrieve(acct,{apiVersion, idempotencyKey})` → UPDATE sca (charges/payouts/requirements/country/currency) → `pg_derive_brand_stripe_status` → `writeAudit` → `{status, charges_enabled, payouts_enabled, requirements, detached_at, …}` | brand gate, no admin bypass | `[src]` |
| `brand-stripe-onboard` edge fn | POST `{brand_id, return_url, country}` → getUser → brand gate → ToS → `createRecipientAccount` (Accounts v2, may **create/replace** an account) → `createAccountSession({accountId, components:{account_onboarding}, idempotencyKey})` → `{client_secret, account_id, onboarding_url}` | brand gate | `[src]` |
| `stripe_disputes` table | `id, stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, stripe_account_id, brand_id, order_id, amount int, currency, status, reason, evidence_due_by, is_charge_refundable, raw_event jsonb, created_at, updated_at`. RLS: `service_role ALL` + brand payment managers SELECT (**no admin, no authenticated UPDATE**). Populated by webhook `charge.dispute.*` | service_role only for writes | `[src]` |
| `admin_grant_override(p_user_id, p_tier, p_reason, p_granted_by uuid, p_starts_at DEFAULT now(), p_expires_at DEFAULT NULL, p_duration_days DEFAULT 30) → uuid` | **`is_admin_user()`-gated**; `p_tier IN ('free','mingla_plus')`; user must exist; `expires > starts`. Audited **client-side** via `logAdminAction` (not `admin_write_audit`) | already admin-gated → **reuse** | `[src]` |
| `admin_revoke_override(p_override_id, p_revoked_by uuid) → boolean` | **`is_admin_user()`-gated** | already admin-gated → **reuse** | `[src]` |
| `admin_get_override_history(p_user_id)` | returns override rows | reuse (read; already in 1274 subscriber card) | `[src]` |

**Design decision (uniform):** follow the 1274 §9 chosen mechanism — **admin TWIN RPCs / admin edge fns**, NOT an `is_admin_user()` OR-branch bolted onto the brand-gated `biz_*` fns. Rationale: the `biz_*` refund/connect fns are DO-NOT-TOUCH (webhook-reconciled, CI-guarded, brand-liability logic) and the brand gate reads `auth.uid()` which is NULL under service_role. Twins are least-privilege and keep the brand path untouched.

**Money is integer cents throughout.** No pre-formatted currency strings cross any boundary (I-1274-MONEY-READ-CENTS-CONTRACT extends to acts).

---

## 5. Per-action specification

### W2-A — Refund an order (full / partial) — CRITICAL

**Mechanism: edge fn `admin-refund-order` (service_role, admin twin of `refund-order`) + 2 twin RPCs.**

#### 5A.1 RPC `admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text) RETURNS jsonb`
Exact copy of `biz_refund_order` (`20260520000000` lines 200–362 `[src]`) with these deltas:
- **Remove** the brand gate (`biz_can_manage_payments_for_brand`, lines 254–257).
- **Replace** with the twin guard as first executable statement: `IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;` (blocks a direct JWT non-admin; passes for service_role where `auth.uid()` IS NULL — the real gate is the edge fn's `admin_users` check + the grant below).
- **ADD amount-bound guard** (defense-in-depth the biz fn lacks — it bounds only per-line quantity): after computing `v_refund_amount_cents`, assert `v_refund_amount_cents ≤ (v_order.total_cents - COALESCE(v_order.refunded_amount_cents,0))` else `RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%' USING ERRCODE='P0009'`. (`orders.total_cents`/`refunded_amount_cents` verified `[1274]`.)
- Keep verbatim: idempotency precheck (returns existing pending row keyed on `metadata->>'idempotency_key'`), order-state check (`paid`/`partial_refund`), reason 10–200, per-line quantity bound, INSERT `refunds`(pending, `metadata={'idempotency_key':p_idempotency_key}`) + `refund_line_items`, the returned manifest.
- `SECURITY DEFINER SET search_path TO 'public','pg_temp'`. **`REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO service_role;`** (never `authenticated`).

#### 5A.2 RPC `admin_refund_order_commit(p_refund_id uuid, p_stripe_refund_id text, p_application_fee_refunded_cents int, p_status text, p_stripe_tax_transaction_id text DEFAULT NULL) RETURNS jsonb`
Exact copy of `biz_refund_order_commit` (`20260727000000` lines 456–571 `[src]`) with:
- **Remove** the brand gate (lines 496–499). **Replace** with the same twin guard as 5A.1 as the first executable statement after loading the refund.
- Keep verbatim: idempotent replay (non-`pending` → return current state), status `IN ('succeeded','failed')`, refund UPDATE, `orders.refunded_amount_cents`/`payment_status` recompute, ticket voiding.
- `SECURITY DEFINER SET search_path TO 'public','pg_temp'`. **`REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO service_role;`**

#### 5A.3 Edge fn `supabase/functions/admin-refund-order/index.ts` (copy `refund-order` structure, swap the gate)
`verify_jwt = true` (config.toml). Flow:
1. OPTIONS/CORS; POST-only (405).
2. `Idempotency-Key` header required, 8–128 chars → 400 `idempotency_key_required` (verbatim from `refund-order`).
3. Parse body `{ order_id, lines:[{order_line_item_id, quantity, amount_cents}], reason }`; validate line shape (`isRefundLine`), `lines.length ≥ 1`, reason 10–200 (verbatim).
4. **Admin gate (the real gate)** — copy `admin-write-primitive`: `getUser(token)` → 401; `admin_users` `email + status='active'` → 403.
5. `admin_refund_order(...)` via **service_role** client (not as-user) → maps RPC errors to HTTP exactly as `refund-order`'s `mapRpcErrorToHttp` **plus** `refund_exceeds_remaining → 422`. Idempotent-replay short-circuit identical to `refund-order`.
6. Resolve connected account (`orders → events → brands.stripe_connect_id`) via service_role — verbatim.
7. `stripe.refunds.create({payment_intent, amount, reason:'requested_by_customer', refund_application_fee: appFee>0, metadata:{mingla_refund_id, mingla_order_id, mingla_idempotency_key}}, {idempotencyKey:'admin_refund:<refundId>', stripeAccount: connectedAccountId})` via `_shared/stripe.ts` `stripeTicketRefund()` (never inline apiVersion — I-PROPOSED-Q) — verbatim except the idempotency-key prefix (`admin_refund:` distinguishes admin refunds in Stripe).
8. Tax reversal (`tax.transactions.createReversal`) — verbatim.
9. `admin_refund_order_commit(...)` via service_role.
10. **Audit** (post-commit, mirroring `refund-order`'s final `writeAudit`, but via the 1271 helper): `admin_write_audit('order.refund','order', order_id, reason, { before:{payment_status, refunded_amount_cents}, after:{amount_cents, stripe_refund_id, new_payment_status} }, true, user.email, user.id)`.
11. Buyer refund notification: **do NOT enqueue here** — the `stripe-webhook` refund path (`handleRefundEvent`) already fires the buyer PUSH+in-app(+SMS) exactly once, idempotent on refundId `[src, refund-order §META-1161 note]`. (Admin refunds produce a Stripe refund event → the webhook reconciles + notifies. Avoids a double push.)
12. Return `{ refund_id, order_id, amount_cents, currency, status, stripe_refund_id, new_payment_status, processed_at, idempotent_replay }`.

config.toml: `[functions.admin-refund-order]\nverify_jwt = true`.

#### 5A.4 UI — `BusinessOrdersPage.jsx` order detail
Replace the disabled `WAVE-2` "Issue refund" button `[1274]` with a live button (visible only when `order.payment_status IN ('paid','partial_refund')`) → `RefundModal` (a `HighRiskActionModal` typed-confirm variant):
- Hydrate line rows from the `admin_get_order` bundle (`line_items` + `refunds` `[1274]`). Per line: ticket type, purchased qty, already-refunded qty (Σ `refund_line_items.quantity` where refund `succeeded|pending`), **remaining refundable qty**, unit price.
- Admin picks qty per line (0…remaining); `amount_cents` auto-computes (unit_price × qty), read-only. **"Full refund" toggle** = all lines at remaining qty. Running total shown as cents→formatted client-side.
- **Typed-amount confirm:** the admin must type the exact computed refund total (e.g. `45.00`) into the confirm field; Confirm stays disabled until it matches (the HighRiskActionModal `confirmPhrase` = the formatted amount). Plus required typed **reason** (10–200, wired to `p_reason`).
- On confirm → `adminMoneyActService.refundOrder({ order_id, lines, reason })` → `invokeAdminWriteEdge('admin-refund-order', body, { idempotencyKey: <crypto.randomUUID()> })` (a stable per-attempt key → retries dedupe). Success → toast + React-Query invalidate the order detail + orders list. Error → map codes to copy (`refund_exceeds_remaining` → "Amount exceeds what's left to refund"; `stripe_declined` → "Stripe declined — no money moved"; `order_not_refundable` → "This order can't be refunded"; 403 → "Admin access required").

---

### W2-B — Connect refresh / onboarding link — HIGH (no money movement)

**Mechanism: edge fn `admin-stripe-connect-action` (service_role, admin twin of `brand-stripe-refresh-status` / `brand-stripe-onboard`). No DB twin RPC needed — it writes `stripe_connect_accounts` via service_role and calls the existing SECURITY DEFINER `pg_derive_brand_stripe_status`.**

`verify_jwt = true`. Body `{ brand_id: uuid, mode: 'refresh' | 'onboarding_link', reason: text }`. Flow:
1. POST-only; validate `brand_id` UUID + `mode` enum + non-blank `reason` (400).
2. Admin gate (copy `admin-write-primitive`): getUser → 401; `admin_users` active → 403.
3. Read `stripe_connect_accounts` by `brand_id` (service_role). If none → 422 `no_connect_account` (admin does not create fresh accounts — see below).
4. **`mode:'refresh'`** — mirror `brand-stripe-refresh-status` body verbatim minus the brand gate: `stripe.accounts.retrieve(sca.stripe_account_id, {apiVersion, idempotencyKey: generateIdempotencyKey(brand_id,'admin_refresh_status')})` → UPDATE sca (charges/payouts/requirements/country/currency/updated_at) → `pg_derive_brand_stripe_status(brand_id)` → audit `admin_write_audit('connect.refresh','stripe_connect_account', sca.stripe_account_id, reason, {before:{charges_enabled,payouts_enabled}, after:{…, derived_status}}, true, user.email, user.id)` → return `{status, charges_enabled, payouts_enabled, requirements, detached_at, country, default_currency}`.
5. **`mode:'onboarding_link'`** — mint a fresh embedded onboarding session for the **existing** account only: `createAccountSession({ accountId: sca.stripe_account_id, components:{ account_onboarding:{ enabled:true, features:{ external_account_collection:true } } }, idempotencyKey: generateIdempotencyKey(brand_id,'admin_onboarding_link') })` (via `_shared/stripeBlueprintClient.ts` `[src]`) → build the `<BUSINESS_WEB_ORIGIN>/connect-onboarding?session=…&brand_id=…` URL → audit `admin_write_audit('connect.onboarding_link', …)` → return `{ onboarding_url, client_secret, account_id }`.
6. **HARD out-of-scope:** admin MUST NOT create or replace a Stripe account (`createRecipientAccount` / `accounts.del`). If `sca.stripe_account_id` is null → 422; fresh onboarding stays the brand's own `brand-stripe-onboard` flow. This keeps admin action to read-through + session-mint (no account lifecycle, no country replacement, no money).

config.toml: `[functions.admin-stripe-connect-action]\nverify_jwt = true`.

**UI — `BusinessPaymentsPage.jsx` brand-Connect detail `[1274]`:** replace the two disabled `WAVE-2` buttons with live ones → `HighRiskActionModal` (typed reason + simple confirm — no typed-amount, no money). "Refresh from Stripe" → `adminMoneyActService.connectAction({brand_id, mode:'refresh', reason})`; "Generate onboarding link" → `mode:'onboarding_link'` → on success show the URL with a copy-to-clipboard control (admin sends it to the brand out-of-band). Both invalidate the payments detail query on success.

---

### W2-C — Dispute internal note / mark-reviewed — HIGH (no Stripe, no money)

**Mechanism: DB-only audited write RPC `admin_annotate_dispute` (golden template) + a small additive migration.** Stripe dispute *resolution* (`disputes.update` submit-evidence / `disputes.close` accept) is **OUT OF SCOPE** (real money — accepting forfeits funds; evidence submission is Stripe-dashboard territory) → deferred, listed in §11.

Migration (additive, nullable — no NOT NULL, no default churn, backward-compatible with the webhook that owns the row):
```
ALTER TABLE public.stripe_disputes
  ADD COLUMN IF NOT EXISTS admin_internal_note text,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by   uuid;   -- actor auth.uid()
```
RPC (golden template `[1271]`):
```
admin_annotate_dispute(p_dispute_id uuid, p_note text, p_mark_reviewed boolean, p_reason text) RETURNS jsonb
  -- guard-first: IF NOT is_admin_user() THEN RAISE 'not_authorized';
  -- reason required (btrim <> '');
  -- UPDATE stripe_disputes SET admin_internal_note = COALESCE(p_note, admin_internal_note),
  --   admin_reviewed_at = CASE WHEN p_mark_reviewed THEN now() ELSE admin_reviewed_at END,
  --   admin_reviewed_by = CASE WHEN p_mark_reviewed THEN auth.uid() ELSE admin_reviewed_by END,
  --   updated_at = now() WHERE id = p_dispute_id;  (RAISE 'dispute_not_found' if 0 rows)
  -- admin_write_audit('dispute.annotate','stripe_dispute', p_dispute_id::text, p_reason,
  --   {note_set: p_note IS NOT NULL, marked_reviewed: p_mark_reviewed}, true);
  -- SECURITY DEFINER SET search_path='public'; GRANT EXECUTE TO authenticated (JWT admin path).
```
This does **not** touch `status`/`amount`/`raw_event`/`evidence_due_by` — only admin-annotation columns. It is a DB-only act, so it uses the authed-JWT RPC path (`callAdminWriteRpc`), not an edge fn.

**UI — `BusinessMoneyLedgerPage.jsx` Disputes-tab detail (`admin_get_dispute` `[1274]`):** add an "Add internal note / Mark reviewed" action → `HighRiskActionModal` (typed reason + confirm; a note textarea + a "mark reviewed" checkbox) → `adminMoneyActService.annotateDispute({dispute_id, note, mark_reviewed, reason})` → `callAdminWriteRpc('admin_annotate_dispute', {...})`. Show `admin_reviewed_at`/`admin_internal_note` in the detail once set. (The `admin_get_dispute` read bundle must also SELECT the 3 new columns — a 1-line additive change inside the 1274 read RPC, allowlisted.)

---

### W2-D — Subscription comp / extend / revoke override — MEDIUM (DB entitlement only)

**Mechanism: REUSE the existing admin-gated `admin_grant_override` / `admin_revoke_override` behind thin audited wrappers** (so every money-console act writes a server-side `admin_write_audit` row, unifying the audit trail with W2-A/B/C). The existing RPCs stay untouched (DO-NOT-TOUCH); the wrappers CALL them.

```
admin_grant_override_audited(p_user_id uuid, p_tier text, p_reason text,
                             p_duration_days int DEFAULT 30, p_expires_at timestamptz DEFAULT NULL) RETURNS uuid
  -- guard-first: IF NOT is_admin_user() THEN RAISE 'not_authorized';
  -- v_id := admin_grant_override(p_user_id, p_tier, p_reason, auth.uid(), now(), p_expires_at, p_duration_days);
  -- admin_write_audit('subscription.override_grant','subscription', p_user_id::text, p_reason,
  --   {tier:p_tier, duration_days:p_duration_days, override_id:v_id}, true);
  -- RETURN v_id;  SECURITY DEFINER search_path='public'; GRANT EXECUTE TO authenticated.

admin_revoke_override_audited(p_override_id uuid, p_user_id uuid, p_reason text) RETURNS boolean
  -- guard-first is_admin_user; v_ok := admin_revoke_override(p_override_id, auth.uid());
  -- admin_write_audit('subscription.override_revoke','subscription', p_user_id::text, p_reason,
  --   {override_id:p_override_id}, true); RETURN v_ok.
```
"Comp" = grant (tier `mingla_plus`, duration). "Extend" = grant with a later `p_expires_at` (same RPC). "Revoke" = revoke. **Real cancel/refund of a paid subscription is NOT built** — billing is RevenueCat-owned (G-9 `[report]`); admin overrides are a DB entitlement shim only. Flagged for product decision in §11.

**UI — `SubscriberContextCard.jsx` `[1274]`** (shown in the Orders detail when `order.buyer_user_id` is set): add "Comp / extend Plus" + "Revoke override" actions → `HighRiskActionModal` (typed reason + confirm; tier + duration inputs for grant) → `adminMoneyActService.grantOverrideAudited(...)` / `revokeOverrideAudited(...)` → `callAdminWriteRpc(...)`. Re-fetch `admin_get_subscription_detail` on success. **Do NOT duplicate the `SubscriptionManagementPage` full grant/revoke UI** — this is the in-context support surface only.

---

## 6. Refund idempotency + bounds (W2-A deep detail)

**Two independent idempotency layers (both mirror `refund-order` exactly):**
1. **DB layer** — `admin_refund_order` prechecks `refunds.metadata->>'idempotency_key' = p_idempotency_key AND order_id = p_order_id AND status = 'pending'` and, if found, returns the existing pending row with `idempotent_replay:true` (no second `refunds` row) `[src]`. The client generates one `crypto.randomUUID()` per refund attempt and reuses it on retry (edge fn requires the `Idempotency-Key` header, 8–128 chars).
2. **Stripe layer** — `stripe.refunds.create(..., { idempotencyKey: 'admin_refund:<refundId>' })`. Stripe dedupes on this key, so a retried edge call after a network blip does not double-refund at Stripe `[src]`.

Ordering (crash-safe, verbatim from `refund-order`): pending `refunds` row is written **before** the Stripe call; on Stripe failure the commit RPC marks the refund `failed` (no money moved); if Stripe succeeds but the commit RPC fails, the row keeps `stripe_refund_id` and the **webhook reconciles** it — the refund is never silently lost.

**Bounds (three, layered):**
- **Per-line quantity** (inherited): `existing_refunded_qty + requested_qty ≤ order_line_item.quantity`, counting refunds in `('pending','succeeded')` → cannot over-refund a line `[src]`.
- **Order state**: `payment_status IN ('paid','partial_refund')` → cannot refund an unpaid/failed/already-fully-refunded order `[src]`.
- **NEW total-amount ceiling** (§5A.1): `Σ line.amount_cents ≤ order.total_cents − refunded_amount_cents` → the free-form per-line `amount_cents` cannot exceed what remains refundable, even if quantities technically fit. This is the guard the biz fn lacks and the reason W2-A is CRITICAL.

**TEST-mode note:** Mingla Stripe is TEST end-to-end `[report][1274]`; `refunds.create` in TEST moves no real money — build + full live-fire test are pre-authorized. The **first LIVE-mode admin refund requires Seth's explicit go** (§11).

---

## 7. Invariants (DRAFT — orchestrator flips ACTIVE on CLOSE)

| ID | Rule | Enforcement | Regression-test (fails-on-revert) |
|---|---|---|---|
| `I-PROPOSED-1278-MONEY-ACT-AUDITED` | Every admin money-act path (RPC or edge fn) is admin-gated **and** writes exactly one `admin_write_audit` row per successful act. | Append `admin_refund_order`, `admin_refund_order_commit`, `admin_annotate_dispute`, `admin_grant_override_audited`, `admin_revoke_override_audited` to the 1271 `i-admin-write-audited.mjs` registry; the two edge fns audit post-commit. | Registry test FAILS if any listed fn lacks an `admin_write_audit(` call; reverting the audit line → FAIL. |
| `I-PROPOSED-1278-ADMIN-GATE-FIRST` | Every 1278 write RPC's first executable statement is the admin guard; the two twin RPCs additionally carry the `auth.uid() IS NOT NULL AND NOT is_admin_user()` service_role-safe form and are `GRANT EXECUTE … TO service_role` only (revoked from PUBLIC/authenticated). | Append the 5 RPC names to the 1271 `i-admin-gate-first-statement.mjs` registry; extend it to assert the twin RPCs' `GRANT … TO service_role` + `REVOKE … FROM PUBLIC`. | FAILS if a guard is moved below a mutation, or a twin RPC is granted to `authenticated`. |
| `I-PROPOSED-1278-ADMIN-REFUND-BOUNDED` | `admin_refund_order` enforces the total-amount ceiling (`Σ amount ≤ total − refunded`) and requires an idempotency key; the edge fn requires the `Idempotency-Key` header. | New `i-admin-refund-bounded.mjs` strict-grep over the 1278 migration + edge fn. | FAILS if the ceiling guard or the header check is removed. |

Add all three to `INVARIANT_REGISTRY.md` as DRAFT. Register the new strict-grep step in `.github/workflows/strict-grep-mingla-business.yml` with a `__tests__/` fixture.

---

## 8. Acceptance criteria (HP = implementor happy-path; ADV = tester adversarial)

**W2-A refund**
- A-1 [HP] TEST-mode full refund of a paid order → Stripe TEST refund created; `orders.payment_status='refunded'`, `refunded_amount_cents=total_cents`; one `admin_audit_log` row `action='order.refund'` with reason.
- A-2 [HP] Partial refund (subset of lines) → `payment_status='partial_refund'`; `refunded_amount_cents` = Σ; typed-amount confirm required in the modal.
- A-3 [ADV] **Idempotency:** same `Idempotency-Key` twice → exactly ONE `refunds` row, ONE Stripe refund; second call returns `idempotent_replay:true`.
- A-4 [ADV] **Amount ceiling:** lines whose Σ amount > `total − refunded` → RPC RAISES `refund_exceeds_remaining`; edge fn returns 422; no `refunds` row committed.
- A-5 [ADV] **Over-refund by qty:** a line already fully refunded → `line_overrefund`; 422.
- A-6 [ADV] **Non-admin / anon:** a non-admin JWT (and an anon call) to `admin-refund-order` → 403 / 401; direct RPC call by a non-admin authenticated user → `not_authorized` (twin guard) AND `admin_refund_order`/`_commit` are not EXECUTE-granted to `authenticated` (grant check).
- A-7 [ADV] **Fails-on-revert:** reverting the amount-ceiling guard → `i-admin-refund-bounded.mjs` FAILS.

**W2-B connect**
- B-1 [HP] `mode:'refresh'` on the live Connect brand → sca updated to Stripe truth, derived status returned; audit `connect.refresh`.
- B-2 [HP] `mode:'onboarding_link'` for an existing account → valid `onboarding_url`; audit `connect.onboarding_link`.
- B-3 [ADV] brand with no `stripe_connect_accounts` row → 422 `no_connect_account` (admin does NOT create/replace an account).
- B-4 [ADV] non-admin / anon → 403 / 401.

**W2-C dispute**
- C-1 [HP] `admin_annotate_dispute(note, mark_reviewed:true, reason)` → note + `admin_reviewed_at`/`_by` set; `status`/`amount`/`raw_event` unchanged; audit `dispute.annotate`.
- C-2 [ADV] non-admin → `not_authorized`; blank reason → `reason_required`; unknown dispute id → `dispute_not_found`.
- C-3 [ADV] proves NO Stripe call is made (source grep: `admin_annotate_dispute` path has zero Stripe references).

**W2-D subscription**
- D-1 [HP] `admin_grant_override_audited(user, 'mingla_plus', reason, 30)` → override created (existing RPC), audit `subscription.override_grant`; `admin_get_subscription_detail` reflects it.
- D-2 [HP] `admin_revoke_override_audited` → override revoked; audit `subscription.override_revoke`.
- D-3 [ADV] non-admin → `not_authorized`; invalid tier (not `free`/`mingla_plus`) → existing RPC RAISE surfaces.
- D-4 [ADV] confirms NO RevenueCat/Stripe billing call (source grep) — override is a DB shim only.

**Cross-cutting**
- X-1 [HP] `mingla-admin` builds clean (`npm run build`, 0 new lint/type errors); all four modals are `HighRiskActionModal` (typed reason + confirm).
- X-2 [ADV] grep the 3 pages + `SubscriberContextCard` for any direct `.from('refunds'|'stripe_disputes'|'stripe_connect_accounts'|'orders').update/insert` → 0 hits (all writes go through edge fns / audited RPCs).
- X-3 [ADV] `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` PASS for all 5 new RPCs; each FAILS on the corresponding revert.

**Silent-empty / cross-brand seeding (inherited from 1274 §8):** because live counts are tiny (`orders`=2, `disputes`/`refunds`=0 `[1274]`), the tester MUST seed ≥1 order + ≥1 dispute under a brand where Seth is NOT a `brand_team_members` row, then prove W2-A refunds that cross-brand order and W2-C annotates that cross-brand dispute (an admin acting on non-owned rows is the whole point).

---

## 9. Test cases (min happy + error + edge per act)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 | Admin full refund (TEST) | admin session, all lines | Stripe TEST refund; order `refunded`; audit row | Edge/DB |
| T2 | Admin partial refund | subset lines + typed amount | `partial_refund`; Σ cached | Edge/DB |
| T3 | Refund idempotent replay | same Idempotency-Key ×2 | 1 refund, 1 Stripe call, replay flag | Edge |
| T4 | Refund exceeds remaining | Σ amount > total−refunded | 422 `refund_exceeds_remaining`, no commit | DB |
| T5 | Refund over-refunded line | fully-refunded line | 422 `line_overrefund` | DB |
| T6 | Refund as non-admin / anon | non-admin JWT / no JWT | 403 / 401 | Edge |
| T7 | Twin RPC grant | `admin_refund_order` EXECUTE grants | service_role only; not authenticated | DB |
| T8 | Connect refresh | admin, live brand | sca synced, derived status, audit | Edge |
| T9 | Connect onboarding link | admin, existing acct | valid url, audit | Edge |
| T10 | Connect no account | brand w/o sca | 422 `no_connect_account` | Edge |
| T11 | Dispute annotate | note + mark_reviewed | cols set; status untouched; audit | DB |
| T12 | Dispute annotate blank reason | reason='' | `reason_required` | DB |
| T13 | Override grant audited | user + tier + duration | override + audit `override_grant` | DB |
| T14 | Override revoke audited | override id | revoked + audit | DB |
| T15 | Any act non-admin | non-admin JWT on each RPC | `not_authorized` | DB |
| T16 | Build clean | `npm run build` | 0 new errors | Build |
| T17 | Revert refund-ceiling guard | strict-grep | `i-admin-refund-bounded.mjs` FAILS | CI |

---

## 10. Implementor task list (ordered)

1. **DB migration `<ts>_orch_1278_money_act.sql`.** In order: `admin_refund_order` (§5A.1, copy `biz_refund_order` minus brand gate + add ceiling guard + service_role grant); `admin_refund_order_commit` (§5A.2, copy `biz_refund_order_commit` minus brand gate + service_role grant); the 3 additive `stripe_disputes` columns + `admin_annotate_dispute` (§5C); `admin_grant_override_audited` + `admin_revoke_override_audited` (§5D). All `SECURITY DEFINER SET search_path`, guard-first. Self-assert `DO $$` blocks per 1271 convention. **Extend the 1274 `admin_get_dispute` read RPC by 3 columns** (allowlisted 1-liner).
2. **Edge fns.** `admin-refund-order/index.ts` (§5A.3, copy `refund-order`, swap gate to `admin_users`, service_role RPC calls, audit via `admin_write_audit`); `admin-stripe-connect-action/index.ts` (§5B). Add both to `config.toml` with `verify_jwt = true`.
3. **Service.** `services/adminMoneyActService.js`: `refundOrder`, `connectAction`, `annotateDispute`, `grantOverrideAudited`, `revokeOverrideAudited` — thin wrappers over `invokeAdminWriteEdge` / `callAdminWriteRpc` (`adminWriteService.js`, 1271).
4. **UI.** Wire the four `HighRiskActionModal` flows: `RefundModal` (§5A.4, line-picker + typed-amount confirm) on `BusinessOrdersPage`; refresh/onboarding on `BusinessPaymentsPage`; annotate on `BusinessMoneyLedgerPage` disputes detail; comp/revoke on `SubscriberContextCard`. Replace the disabled `WAVE-2` buttons.
5. **Invariants + CI.** 3 DRAFT rows in `INVARIANT_REGISTRY.md`; append 5 RPC names to `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` registries; create `i-admin-refund-bounded.mjs` + `__tests__/` fixture; register 1 job step in `strict-grep-mingla-business.yml`.
6. **Self-verify.** `npm run build` clean; run the strict-greps locally (PASS + prove fails-on-revert); provide TEST-mode refund/connect/annotate/override live-fire evidence + the non-admin `not_authorized`/403 proofs. **Hand migration deploy + edge-fn deploy to the orchestrator.** DO NOT fire a LIVE-mode refund.

**Allowlist (create/modify ONLY):** `supabase/migrations/<ts>_orch_1278_money_act.sql` · `supabase/functions/admin-refund-order/index.ts` · `supabase/functions/admin-stripe-connect-action/index.ts` · `supabase/config.toml` (2 verify_jwt entries) · `mingla-admin/src/services/adminMoneyActService.js` · `mingla-admin/src/pages/{BusinessOrdersPage,BusinessPaymentsPage,BusinessMoneyLedgerPage}.jsx` · `mingla-admin/src/components/entity/SubscriberContextCard.jsx` · the 1274 `admin_get_dispute` RPC (3-column extend, within the 1278 migration) · `.github/scripts/strict-grep/{i-admin-refund-bounded.mjs, i-admin-write-audited.mjs (append), i-admin-gate-first-statement.mjs (append)}` + `__tests__/` fixture · `.github/workflows/strict-grep-mingla-business.yml` (one step) · `Mingla_Artifacts/INVARIANT_REGISTRY.md` (3 DRAFT rows).

**DO-NOT-TOUCH (stop-and-amend first):** `refund-order` · `biz_refund_order` / `biz_refund_order_commit` (copy their bodies into twins; never edit the originals) · `biz_can_manage_payments_for_brand` · `brand-stripe-refresh-status` / `brand-stripe-onboard` / `brand-stripe-account-session` · the webhook pipeline (`stripe-webhook`, `stripeWebhookRouter.ts`, `stripeDisputeHandlers.ts`) · `admin_grant_override` / `admin_revoke_override` / `admin_get_override_history` (call, never modify) · `is_admin_user` / `admin_write_audit` / `admin_audit_probe` / `admin-write-primitive` / `pg_derive_brand_stripe_status` (1271/1274-owned; call, never alter) · `StripeModePage` / `SubscriptionManagementPage` · any money-table RLS · `_shared/stripe.ts` (use its exported clients, never inline apiVersion) · any shipping-app code (`app-mobile/`, `mingla-business/`).

---

## 11. "Needs Seth's explicit GO before live-fire" list

1. **W2-A admin refund in Stripe LIVE mode** — the only action that moves real money. TEST-mode build/test is pre-authorized (Mingla is TEST end-to-end today `[report][1274]`); the **first LIVE-mode refund** must not fire without Seth's explicit go.
2. **W2-C dispute EVIDENCE SUBMISSION / ACCEPT** (`stripe.disputes.update` / `stripe.disputes.close`) — OUT OF SCOPE this wave. Accepting a dispute forfeits funds (real money); evidence submission is complex + Stripe-dashboard-native. Only the DB-only note/mark-reviewed ships now. If ever built → needs Seth go + a fresh spec.
3. **W2-D real subscription cancel / refund** (RevenueCat / Stripe billing) — OUT OF SCOPE (G-9 product decision `[report]`; billing is RevenueCat-owned). Only the DB entitlement override ships. Needs a product decision before any build.
4. **W2-B account creation / replacement** — admin is scoped to refresh + session-mint for an EXISTING account only. Creating/replacing a Stripe account (country change, `accounts.del`) stays the brand's own flow; not exposed to admin.

---

## 12. Open questions (with defaults)

- **Q1 (BLOCKING-adjacent — dependency, not content).** 1278 IMPLEMENT is blocked on 1271 + 1274 merging to `main` (§0). This is the one hard gate; there is no unresolved *design* question that blocks writing/building the contract. **Default/ask:** confirm 1271 then 1274 land before dispatching implement.
- **Q2 (non-blocking).** Refund scope: full-only (simplest, safest) vs full + partial line-picker. **Default: full + partial** (line-based, mirrors `biz_refund_order` + the business refund UX). Revisit only if Seth wants admin refunds restricted to full-order.
- **Q3 (non-blocking).** W2-D audit path: thin audited wrapper RPCs (atomic server-side audit) vs UI calling the existing RPC + `admin_write_audit` as two calls. **Default: wrappers** (atomic, satisfies I-1278-MONEY-ACT-AUDITED cleanly).
- **Q4 (non-blocking).** Dispute annotation stored as new nullable columns vs an audit-only record with no table mutation. **Default: nullable columns** (so "reviewed" state is queryable/visible in the detail, not just in the audit log).
- **Q5 (non-blocking).** Admin onboarding-link delivery: show URL + copy-to-clipboard (admin sends out-of-band) vs auto-email the brand. **Default: copy-to-clipboard** (no new email surface this wave).

---

## 13. Downstream routing

Next = **mingla-implementor** (build per §10, in the ORCH-1278 per-ORCH worktree; `git fetch origin && git rebase origin/main` first — **only after 1271 + 1274 are on `main`**). Then **mingla-tester** (the §8 acceptance matrix — every ADV row, the cross-brand seeding, idempotency A-3, the amount-ceiling A-4, non-admin/anon A-6/B-4/C-2/D-3, and fails-on-revert on `i-admin-refund-bounded.mjs`; TEST-mode live-fire only — NO live-mode refund). Then **orchestrator CLOSE** (flip 3 invariants DRAFT→ACTIVE, deploy the migration + 2 edge fns + verify with one curl each, merge one PR, update WORLD_MAP). **Live-fire of a real (LIVE-mode) refund is a separate, Seth-gated step after CLOSE** (§11).

> **Worktree note:** this spec was written from the anchor read-only (no 1278 worktree exists yet). The orchestrator spawns `~/Desktop/mingla-orchs/1278-[admin-money-act]/` on branch `1278-admin-money-act` at INTAKE; all implement/test artifacts land there.
