> **⚠️ SUPERSEDED 2026-05-06 by [outputs/SPEC_B2_PATH_C_V3.md](SPEC_B2_PATH_C_V3.md).** This V1 contained SPEC contradictions caught by V2 forensics + Stripe best-practices audit. Refer to V3 for the authoritative B2a Path C contract.


# SPEC Amendment — Cycle B2 (Path C: merge Seth's B2a + Taofeek's B2 backport)

**Amends:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`
**Effective:** 2026-05-06
**Status:** DRAFT — pending operator approval; flips ACTIVE on dispatch
**Author:** orchestrator (per Path C decision in `outputs/B2_RECONCILIATION_REPORT.md`)
**Cycle ID:** B2a (expanded scope — J-B2.4 + J-B2.5 from B2b fold in; balances endpoint advances B3 prep)

---

## §1 — Why this amendment exists

Two engineers shipped competing B2 implementations on 2026-05-06 (see `outputs/B2_RECONCILIATION_REPORT.md`). Operator chose Path C: keep Seth's compliant core, backport Taofeek's complementary additions, refactored to honor the locked decisions. This amendment binds the merged implementation to a single contract.

Effects:
1. **B2a scope expands** from J-B2.1 only to J-B2.1 + J-B2.4 + J-B2.5 + balances endpoint for B3 prep.
2. **B2b cycle absorbed** into B2a. There is no separate B2b cycle anymore.
3. **B3 prep partially advanced** — `brand-stripe-balances` endpoint ships now, ready for B3 KPI tiles.
4. **All locked decisions stand** — DEC-112 / DEC-113 / DEC-114 / D-B2-3 / D-B2-5 / D-B2-22 / D-B2-23 unchanged. Taofeek's divergences from these are backported with corrections, not honored as-is.
5. **Two new invariants drafted** — I-PROPOSED-Q (Stripe API v2 only), I-PROPOSED-R (Idempotency-Key on every Stripe call), I-PROPOSED-S (audit log on every Stripe edge action).

---

## §2 — Locked decisions (carry over from B2a SPEC §2 + new ones)

### Carried from B2a (no change)

| ID | Decision | Source |
|---|---|---|
| DEC-112 | Stripe Connect type = EXPRESS | B2a SPEC §2 |
| DEC-113 | Routing = BRAND-LEVEL (`stripe_connect_accounts.brand_id` FK) | B2a SPEC §2 |
| DEC-114 | Charge model = MARKETPLACE (Mingla = merchant of record; controller properties on `accounts.create`) | B2a SPEC §2 |
| D-B2-3 | DB-trigger-synced cache (`stripe_connect_accounts` canonical; `brands.stripe_*` mirrored via trigger) | B2a SPEC §2.2 |
| D-B2-5 | Stripe API version pin = `2026-04-30.preview` (Accounts v2) | B2a SPEC §2.2 |
| D-B2-22 | Idempotency-Key on every Stripe API call; format `{brand_id}:{op}:{epoch_ms}` | B2a SPEC §2.2 |
| D-B2-23 | SDK strategy = Path B (in-app browser → Mingla web page → `@stripe/connect-js`) | B2a SPEC §2.2 |

### New (this amendment)

| ID | Decision |
|---|---|
| **DEC-121** | Path C executed — merge Seth's B2a core + Taofeek's complementary additions into branch `Seth`. Drop Taofeek's competing files. Refactor Taofeek's backported functions to comply with DEC-112/113/114 + D-B2-3/5/22 + I-PROPOSED-O/P/Q/R/S. (DEC-115/116/117/118 were already taken by ORCH-0737 v6 lineage; renumbered post-investigation per `outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` §A.) |
| **DEC-122** | B2a expanded scope = J-B2.1 (onboarding) + J-B2.4 (KYC stall recovery) + J-B2.5 (account detach) + brand balances API. B2b cycle dissolved into B2a. |
| **DEC-123** | Stripe webhook handler = ONE function (`supabase/functions/stripe-webhook/`). Routes events through a shared `_shared/stripeWebhookRouter.ts` that handles `account.updated`, `account.application.deauthorized`, `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`, `capability.updated`. (Backports Taofeek's `processConnectEvent` logic.) |
| **D-B2-24** | Function naming in merged tree:<br>**KEEP** Seth's `brand-stripe-onboard/`, `brand-stripe-refresh-status/`, `stripe-webhook/`<br>**ADD** `brand-stripe-detach/`, `brand-stripe-balances/`, `stripe-kyc-stall-reminder/` (refactored from Taofeek's)<br>**DROP** Taofeek's `brand-stripe-connect-session/`, `stripe-connect-webhook/`, his `brand-stripe-refresh-status/`. |
| **D-B2-25** | Frontend status derivation function signature is **Seth's** object form: `deriveBrandStripeStatus({ has_account, charges_enabled, payouts_enabled, requirements, detached_at })`. Taofeek's 4-positional-param form is dropped. SQL helper `pg_derive_brand_stripe_status` is the canonical source; TS twin is for tests + caching only. |
| **D-B2-26** | Schema migrations — Seth's `20260508000000_b2a_stripe_connect_onboarding.sql` stays. Taofeek's `20260506120000_b2_payouts_stripe_id_unique.sql` and `20260506130000_b2_kyc_stall_reminder.sql` are PORTED forward as `20260509000001_b2_payouts_stripe_id_unique.sql` and `20260509000002_b2_kyc_stall_reminder_column.sql` to maintain chronological order on the merged tree. |
| **D-B2-27** | Webhook event handling: idempotency by `payment_webhook_events.stripe_event_id` UNIQUE + replay-safe via `processed=true` row marker. Each event handler must complete inside the durable-queue transaction OR write its own audit-log row + retry-safe error. Seth's 200-always pattern wins over Taofeek's 500-on-error pattern. |
| **D-B2-28** | KYC stall reminder = Resend email (re-uses existing Mingla Resend integration), triggered by cron, gated on (a) account exists, (b) `charges_enabled=false`, (c) `kyc_stall_reminder_sent_at IS NULL`, (d) account created > 24 hours ago. Does NOT block onboarding completion. |
| **D-B2-29** | Detach flow = `stripe.accounts.del()` (best-effort) → mark `stripe_connect_accounts.detached_at = now()` (do NOT hard-delete the row; preserve audit history) → trigger mirrors null/false to `brands.stripe_*`. Failure of `stripe.accounts.del()` does NOT block local detach (Stripe occasionally rejects deletes; user should still see UI confirm). Audit log records both Stripe API result and local mutation. |
| **D-B2-30** | Brand balances endpoint returns `{ available, pending, currency }` in **minor units** (matches Stripe's native shape). Frontend formatters convert to display units. RLS gate: caller must be `payments_manager`-rank or above on the brand. |

---

## §3 — Scope (replaces B2a SPEC §3)

### In scope (this cycle)

**J-B2.1 — Stripe Connect onboarding (embedded)** — unchanged from B2a.

**J-B2.4 — KYC stall recovery (NEW for this cycle)**
- Edge function `stripe-kyc-stall-reminder/` runs on a schedule (cron/scheduled function)
- Detects accounts in onboarding state past 24 hours with no progress
- Sends Resend email with a deep link back into the embedded onboarding flow
- Marks `stripe_connect_accounts.kyc_stall_reminder_sent_at`
- Self-clears the marker when a future `account.updated` webhook flips `charges_enabled=true` (handled in webhook router)

**J-B2.5 — Account detach (NEW for this cycle)**
- Edge function `brand-stripe-detach/` accepts `{ brand_id, reason }` from `payments_manager`-rank+ caller
- Calls `stripe.accounts.del(stripe_account_id)` (best-effort)
- Sets `stripe_connect_accounts.detached_at = now()` (soft delete; preserves audit history)
- Trigger mirrors null/false to `brands.stripe_*`
- Returns `{ success, stripe_delete_result, detached_at }`
- Frontend: new "Disconnect Stripe" CTA in `BrandPaymentsView.tsx`'s settings area, behind a `ConfirmDialog`

**Brand balances endpoint (NEW for this cycle, B3 prep)**
- Edge function `brand-stripe-balances/` accepts `{ brand_id }`
- Calls `stripe.balance.retrieve({ stripeAccount })`
- Returns `{ available_minor, pending_minor, currency }`
- Frontend: WIRED into `BrandPaymentsView.tsx`'s existing KPI tiles (replaces stub data)

**CI workflow expansion**
- KEEP Seth's `strict-grep-mingla-business.yml` (gates O + P + new Q + R + S)
- ADD adapted version of Taofeek's `stripe-connect-smoke.yml` — runs against deployed sandbox, light + full mode, daily + manual dispatch
- ADD adapted version of Taofeek's `supabase-migrations-and-stripe-deno.yml` — runs `supabase db reset` (Docker) + Deno test suite

**Test coverage**
- KEEP Seth's `deriveBrandStripeStatus.test.ts` (jest, 13 cases)
- ADD ported versions of Taofeek's Deno tests: `stripeConnectProjection.test.ts`, `stripeConnectWebhookProcess.test.ts`, `stripeWebhookSignature.test.ts`
- NEW: `brandStripeDetach.test.ts` (jest, ~6 cases)
- NEW: `brandStripeBalances.test.ts` (jest, ~4 cases)
- NEW: `kycStallReminder.test.ts` (jest, ~5 cases)

### Out of scope (deferred)

- Native React Native `<ConnectAccountOnboarding>` — gated on Stripe RN private preview approval (Cycle B2c)
- Live mode launch — gated on Stripe Marketplace review approval + sandbox stability
- B3 (Checkout) UI — only the balances endpoint ships now; checkout is its own cycle
- Multi-region beyond UK — D-B2-13 unchanged; UK/GBP only for now
- Custom KBA workflows / Issuing / Treasury — future B-cycles

---

## §4 — File manifest (binding)

### DROP from `Seth` branch (Taofeek's competing files; not in working tree yet — would be added then dropped, OR never added if implementor is told to skip them)

```
supabase/functions/brand-stripe-connect-session/index.ts
supabase/functions/stripe-connect-webhook/index.ts
supabase/functions/brand-stripe-refresh-status/index.ts  (Taofeek's version — Seth's stays)
mingla-business/src/services/payoutsService.ts
mingla-business/src/utils/stripeConnectStatus.ts
mingla-business/src/utils/stripeConnectStatus.test.ts
```

### KEEP existing on `Seth` (no change)

```
supabase/functions/brand-stripe-onboard/index.ts
supabase/functions/stripe-webhook/index.ts                              (router added in §6)
supabase/functions/brand-stripe-refresh-status/index.ts                  (Seth's)
supabase/functions/_shared/stripe.ts                                     (Stripe client + API version)
supabase/functions/_shared/idempotency.ts                                (Idempotency-Key generator)
supabase/functions/_shared/audit.ts                                      (audit_log writer)
supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql
mingla-business/src/services/brandStripeService.ts
mingla-business/src/services/brandMapping.ts                             (mod from B2a)
mingla-business/src/utils/deriveBrandStripeStatus.ts                     (Seth's object signature)
mingla-business/src/utils/__tests__/deriveBrandStripeStatus.test.ts
mingla-business/src/hooks/useBrandStripeStatus.ts
mingla-business/src/hooks/useStartBrandStripeOnboarding.ts
mingla-business/src/hooks/useBrands.ts
mingla-business/src/components/brand/BrandOnboardView.tsx
mingla-business/src/components/brand/BrandPaymentsView.tsx               (modified per below)
mingla-business/app/connect-onboarding.tsx
mingla-business/app/brand/[id]/payments/onboard.tsx
.github/workflows/strict-grep-mingla-business.yml
.github/scripts/strict-grep/i-proposed-o-stripe-no-webview-wrap.mjs
.github/scripts/strict-grep/i-proposed-p-stripe-state-canonical.mjs
```

### ADD new (refactored from Taofeek's branch — not direct copies)

```
supabase/functions/brand-stripe-detach/index.ts                          (refactored — adds idempotency + audit + trigger-only writes)
supabase/functions/brand-stripe-balances/index.ts                         (refactored — adds idempotency + audit; uses _shared/stripe.ts client)
supabase/functions/stripe-kyc-stall-reminder/index.ts                     (refactored — adds idempotency on Resend + audit; uses _shared/stripe.ts client; uses pg_derive_brand_stripe_status to gate)
supabase/functions/_shared/stripeWebhookRouter.ts                         (NEW — refactor of Taofeek's stripeConnectWebhookProcess.ts; routes 7 event types; called by Seth's stripe-webhook/index.ts)
supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts           (Deno; ported from Taofeek's stripeConnectWebhookProcess.test.ts; expanded)
supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts        (Deno; ported from Taofeek's stripeWebhookSignature.test.ts)
supabase/migrations/20260509000001_b2_payouts_stripe_id_unique.sql        (port of Taofeek's 20260506120000)
supabase/migrations/20260509000002_b2_kyc_stall_reminder_column.sql       (port of Taofeek's 20260506130000)
mingla-business/src/services/brandStripeBalancesService.ts                (NEW)
mingla-business/src/services/brandStripeDetachService.ts                  (NEW)
mingla-business/src/hooks/useBrandStripeBalances.ts                       (NEW)
mingla-business/src/hooks/useBrandStripeDetach.ts                         (NEW)
mingla-business/src/utils/__tests__/brandStripeDetach.test.ts              (jest; new ~6 cases)
mingla-business/src/utils/__tests__/brandStripeBalances.test.ts            (jest; new ~4 cases)
mingla-business/src/utils/__tests__/kycStallReminder.test.ts               (jest; new ~5 cases)
.github/workflows/stripe-connect-smoke.yml                                (port of Taofeek's; adapted to Seth's edge function names)
.github/workflows/supabase-migrations-and-stripe-deno.yml                 (port of Taofeek's; updated test paths)
.github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs            (NEW gate)
.github/scripts/strict-grep/i-proposed-r-stripe-idempotency-key.mjs        (NEW gate)
.github/scripts/strict-grep/i-proposed-s-stripe-audit-log.mjs              (NEW gate)
```

### MODIFY

```
mingla-business/src/components/brand/BrandPaymentsView.tsx                (KPI tiles wire to useBrandStripeBalances; settings area gains "Disconnect Stripe" CTA → ConfirmDialog)
supabase/functions/stripe-webhook/index.ts                                (delegates event handling to _shared/stripeWebhookRouter; expanded event-type allowlist)
.github/workflows/strict-grep-mingla-business.yml                          (registers I-PROPOSED-Q + M + N gates per existing pattern in feedback_strict_grep_registry_pattern)
Mingla_Artifacts/INVARIANT_REGISTRY.md                                     (J + K flip DRAFT → ACTIVE; L + M + N added as DRAFT)
Mingla_Artifacts/DECISION_LOG.md                                           (DEC-121 / DEC-122 / DEC-123 + D-B2-24..30 logged)
Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md     (header note: superseded by this amendment)
clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md                    (header note: B2a expanded scope via Path C; smoke checklist still valid + 3 new stages for detach/balances/KYC)
```

---

## §5 — New invariants (DRAFT → ACTIVE on B2 CLOSE)

### I-PROPOSED-Q: Stripe API v2 only

> Every Stripe SDK instantiation in `supabase/functions/` uses the API version from `_shared/stripe.ts`'s `STRIPE_API_VERSION` constant. Inline overrides forbidden.

**CI gate:** `i-proposed-q-stripe-api-version.mjs` — strict-grep across `supabase/functions/`:
- BLOCK any literal `apiVersion:` outside `_shared/stripe.ts`
- BLOCK any `apiVersion: "20[0-9][0-9]-` regex outside `_shared/stripe.ts`

### I-PROPOSED-R: Idempotency-Key on every Stripe API call

> Every `stripe.<resource>.<method>(...)` call in edge functions uses `{ idempotencyKey: makeIdempotencyKey(brand_id, op) }` (from `_shared/idempotency.ts`).

**CI gate:** `i-proposed-r-stripe-idempotency-key.mjs` — strict-grep:
- For each `stripe.X.Y(` call site, check the same call has `idempotencyKey:` within 5 lines
- BLOCK if missing

### I-PROPOSED-S: Audit log on every Stripe edge function

> Every edge function in `supabase/functions/{brand-stripe-*,stripe-*}/` writes at least one `audit_log` row per invocation (success OR error). Uses `writeAudit` from `_shared/audit.ts`.

**CI gate:** `i-proposed-s-stripe-audit-log.mjs` — strict-grep:
- Each function's `index.ts` MUST import `writeAudit`
- Each function's `index.ts` MUST call `writeAudit(` at least once
- BLOCK on either failure

(Note: I-PROPOSED-O and I-PROPOSED-P already exist on Seth's branch as DRAFT; this amendment ratifies them ACTIVE on B2 CLOSE per the original B2a SPEC plan.)

---

## §6 — Behavioural contracts per new file

### `supabase/functions/_shared/stripeWebhookRouter.ts` (NEW)

**Exports:**

```ts
export type StripeWebhookEventType =
  | 'account.updated'
  | 'account.application.deauthorized'
  | 'payout.created'
  | 'payout.paid'
  | 'payout.failed'
  | 'payout.canceled'
  | 'capability.updated';

export const HANDLED_EVENT_TYPES: ReadonlyArray<StripeWebhookEventType> = [...]; // exhaustive

export type RouteResult =
  | { ok: true; effects: ReadonlyArray<string> } // human-readable list of mutations
  | { ok: false; error: string; retryable: boolean };

export async function routeStripeEvent(
  event: Stripe.Event,
  client: SupabaseClient,
  ctx: { stripe: Stripe; admin: SupabaseClient },
): Promise<RouteResult>;
```

**Behaviour:**
- Switch on `event.type`; dispatch to `handleAccountUpdated`, `handlePayoutPaid`, etc.
- Each handler must:
  - Use Idempotency-Key on outbound Stripe API calls
  - Write `audit_log` row on completion
  - Update `stripe_connect_accounts` (NOT `brands` directly) — trigger mirrors
  - Return `RouteResult` with effects list for caller's audit row
- Unknown event types → return `{ ok: true, effects: ['skipped:unknown-event-type'] }`
- Errors classified as retryable (network/Stripe 5xx) or terminal (Stripe 4xx, schema constraint failure)

**Tests (Deno, in `_shared/__tests__/stripeWebhookRouter.test.ts`):**
- `account.updated` flips charges_enabled true → updates row + clears `kyc_stall_reminder_sent_at`
- `account.updated` flips charges_enabled false → updates row, does NOT clear reminder marker
- `payout.paid` upserts `payouts` row by `stripe_payout_id`
- `payout.failed` updates existing payouts row with `status='failed'`
- `account.application.deauthorized` sets `detached_at`
- Unknown event type → `{ ok: true, effects: ['skipped:unknown-event-type'] }`
- Stripe 5xx during retrieval → `{ ok: false, retryable: true }`

### `supabase/functions/brand-stripe-detach/index.ts` (refactored from Taofeek's)

**Contract:**
- Method: POST
- Auth: Bearer JWT from `payments_manager`-rank or above
- Body: `{ brand_id: string, reason?: string }`
- Behaviour:
  1. Look up `stripe_account_id` from `stripe_connect_accounts` WHERE `brand_id = $1 AND detached_at IS NULL`
  2. Call `stripe.accounts.del(stripe_account_id, { idempotencyKey: makeIdempotencyKey(brand_id, 'detach', epoch) })`
  3. Soft-delete: `UPDATE stripe_connect_accounts SET detached_at = now() WHERE brand_id = $1 AND stripe_account_id = $2`
  4. Trigger mirrors null/false to `brands.stripe_*`
  5. Write audit log: `action='stripe_connect.detach', target_type='brand', target_id=brand_id, before={stripe_account_id, charges_enabled}, after={detached_at}, metadata={reason, stripe_delete_status}`
  6. Return `{ success: true, stripe_delete_status: 'deleted' | 'rejected' | 'unknown', detached_at: ISO }`
- Errors:
  - 401 if no JWT
  - 403 if rank < `payments_manager`
  - 404 if no active stripe_connect_account for brand
  - 500 on local DB write failure (Stripe del failure does NOT cause 500 — log + still succeed locally)

**SCs (new):**
- SC-23: detach with valid JWT + payments_manager → 200, detached_at set, trigger mirrored to brands
- SC-24: detach when Stripe API rejects `accounts.del` → 200, local detach succeeds, audit captures rejection
- SC-25: detach when account already detached → 404 (idempotent at HTTP level)
- SC-26: detach as marketing_manager → 403

### `supabase/functions/brand-stripe-balances/index.ts` (refactored from Taofeek's)

**Contract:**
- Method: POST (or GET — implementor decides; POST per consistency with other Stripe edge fns)
- Auth: Bearer JWT, `payments_manager`-rank+
- Body: `{ brand_id: string }`
- Behaviour:
  1. Look up `stripe_account_id` from `stripe_connect_accounts` WHERE `brand_id = $1 AND detached_at IS NULL`
  2. Call `stripe.balance.retrieve({ stripeAccount: stripe_account_id }, { idempotencyKey: makeIdempotencyKey(brand_id, 'balance', epoch) })`
  3. Sum `available[]` and `pending[]` arrays per currency (Stripe returns array per currency for multi-currency accounts)
  4. Filter to single currency = brand's `default_currency`
  5. Write audit log on successful read (lightweight; consider sampling 1 in N if call is high-frequency)
  6. Return `{ available_minor: number, pending_minor: number, currency: string, refreshed_at: ISO }`
- Errors:
  - 401 / 403 / 404 same as detach
  - 503 + retry-after if Stripe rate limits

**SCs (new):**
- SC-27: balance retrieved successfully → returns minor units
- SC-28: balance for detached account → 404
- SC-29: caller without rank → 403

### `supabase/functions/stripe-kyc-stall-reminder/index.ts` (refactored from Taofeek's)

**Contract:**
- Trigger: Supabase scheduled function (cron via `pg_cron` if available, else Supabase scheduled trigger). Run hourly.
- Auth: service_role only (no public invocation)
- Behaviour:
  1. SELECT `(brand_id, stripe_account_id, brand_admin_email)` FROM `stripe_connect_accounts` JOIN `brands` JOIN `brand_members`
     WHERE `charges_enabled = false`
       AND `kyc_stall_reminder_sent_at IS NULL`
       AND `created_at < now() - interval '24 hours'`
       AND `detached_at IS NULL`
       AND `brand_members.role = 'payments_manager'` (one-per-brand, lowest user_id)
  2. For each row: send Resend email with deep link to `mingla-business://onboarding-resume?brand_id={id}` (or web equivalent). Idempotency on Resend by `kyc_reminder:{brand_id}:{Y-M-D}`
  3. Mark `kyc_stall_reminder_sent_at = now()` post-send
  4. Write audit log per send: `action='stripe_connect.kyc_reminder_sent'`
- Errors:
  - Per-row failures don't stop loop; logged + retried next hour

**SCs (new):**
- SC-30: stalled account (>24h, not connected, no prior reminder) → email sent, marker set, audit row written
- (When `account.updated` later flips charges_enabled=true, webhook router clears marker — see §6 above)

### `mingla-business/src/components/brand/BrandPaymentsView.tsx` (modify)

**Changes:**
1. KPI tiles bind to `useBrandStripeBalances(brand_id)` — replaces stub data
2. Settings section gains "Disconnect Stripe" CTA — opens `ConfirmDialog` ("Are you sure? This stops payouts and removes the brand from Stripe. Audit log will preserve a record.") → calls `useBrandStripeDetach()` mutation
3. Disabled states: balances tile shows skeleton on loading, "—" on error; detach CTA disabled when `stripeStatus === 'not_connected'` or `'onboarding'`
4. **MUST NOT** call `useAuth` in this component if it's already on a route inside `(tabs)/` — already covered by Seth's existing implementation; preserve

---

## §7 — Implementation phasing (binding for implementor)

12-phase order, similar to B2a but extended:

| Phase | Scope | Evidence |
|---|---|---|
| **0** | Foundation: register I-PROPOSED-Q/R/S gates in CI; add migrations 20260509000001 + 20260509000002; update DECISION_LOG with DEC-121/122/123 + D-B2-24..30; update INVARIANT_REGISTRY with Q/R/S DRAFT entries | `npm test` passes; gates run; migrations apply on `supabase db reset` |
| **1** | Refactor: extract `_shared/stripeWebhookRouter.ts` from existing Seth `stripe-webhook/index.ts` inline logic; expand to handle 7 event types per D-B2-27 | Deno tests pass; `stripe-webhook/index.ts` slimmed to delegate |
| **2** | Add `brand-stripe-detach/` edge function per §6 contract; ensure Idempotency-Key + audit; soft-delete only | Deno test for detach happy + Stripe-rejects-del; jest test on frontend service |
| **3** | Add `brand-stripe-balances/` edge function per §6 contract | Deno test; jest test |
| **4** | Add `stripe-kyc-stall-reminder/` edge function per §6 contract | Deno test for select query + send + mark; idempotency by date verified |
| **5** | Frontend: add `brandStripeBalancesService.ts` + `useBrandStripeBalances.ts`; wire KPI tiles in `BrandPaymentsView.tsx` | jest tests; tsc --noEmit clean |
| **6** | Frontend: add `brandStripeDetachService.ts` + `useBrandStripeDetach.ts`; wire "Disconnect Stripe" CTA + ConfirmDialog | jest tests; tsc --noEmit clean |
| **7** | CI: port `stripe-connect-smoke.yml` from Taofeek's branch, adapt edge function names + secrets to Seth's set | workflow validates locally with `act` if possible; spot-deploy and run `workflow_dispatch` |
| **8** | CI: port `supabase-migrations-and-stripe-deno.yml` from Taofeek's branch | same |
| **9** | Drop Taofeek's competing files: `brand-stripe-connect-session/`, `stripe-connect-webhook/`, his `brand-stripe-refresh-status/`, `payoutsService.ts`, `stripeConnectStatus.ts` + test | Files deleted; tsc + lint clean; no orphan imports |
| **10** | Operator-side: deploy edge functions to sandbox; run smoke tests across 7 stages of original B2a smoke + 3 new stages (detach + balances + KYC reminder) | Smoke evidence per stage |
| **11** | Tester dispatch verifies all 30 SCs (22 from B2a + 8 new) and all 5 invariants (J+K+L+M+N) | tester PASS verdict |
| **12** | Operator-side: CLOSE protocol — DEC-121 lock + I-PROPOSED-O/P/Q/R/S flip ACTIVE + 7-artifact SYNC + EAS OTA dual-platform per `feedback_eas_update_no_web` | World map + tracker updates; OTA dispatched |

---

## §8 — Migration ordering decision

Both Seth's `20260508000000_b2a_stripe_connect_onboarding.sql` and Taofeek's two ported migrations (`20260509000001` + `20260509000002`) must apply cleanly on a fresh DB.

**Order:**
1. `20260508000000_b2a_stripe_connect_onboarding.sql` — adds `detached_at`, payouts enum extension, idx, SQL helper, trigger
2. `20260509000001_b2_payouts_stripe_id_unique.sql` — adds UNIQUE on `payouts.stripe_payout_id` (or PARTIAL UNIQUE excluding NULLs)
3. `20260509000002_b2_kyc_stall_reminder_column.sql` — adds `stripe_connect_accounts.kyc_stall_reminder_sent_at` TIMESTAMPTZ NULL

The implementor must verify with `supabase db reset` (Docker) that all 3 apply in order without error.

---

## §9 — Test plan summary (replaces B2a SPEC §6)

### Total SCs: 30 (22 B2a + 8 new)

| Category | SC count | Files |
|---|---|---|
| Status derivation correctness | SC-01..SC-12 (12) | `deriveBrandStripeStatus.test.ts` (jest) |
| Onboarding API contracts | SC-13..SC-18 (6) | new jest tests on services + smoke |
| Webhook idempotency + replay | SC-19..SC-22 (4) | Deno tests on `stripeWebhookRouter` |
| Detach flow | SC-23..SC-26 (4) | jest + Deno |
| Balances endpoint | SC-27..SC-29 (3) | jest |
| KYC stall reminder | SC-30 (1) | jest + cron simulation |

### Total invariants: 5
- I-PROPOSED-O — Stripe Embedded SDK only (no DIY WebView)
- I-PROPOSED-P — `stripe_connect_accounts` canonical; `brands.stripe_*` mirror via trigger only
- I-PROPOSED-Q — Stripe API v2 (`2026-04-30.preview`) only; no v1 inline
- I-PROPOSED-R — Idempotency-Key on every Stripe API call
- I-PROPOSED-S — Audit log on every Stripe edge function

### CI workflows running: 3
- `strict-grep-mingla-business.yml` — gates O/P/Q/R/S
- `stripe-connect-smoke.yml` — daily + on-demand functional regression
- `supabase-migrations-and-stripe-deno.yml` — on PR migration syntax + Deno tests

---

## §10 — Discoveries to disposition at CLOSE

(In addition to D-CYCLE-B2A-IMPL-1..7 from Seth's IMPL report and D-CYCLE-B2A-FOR-1..10 from Seth's SPEC §17.)

| ID | Description | Disposition |
|---|---|---|
| D-CYCLE-B2-PATHC-1 | Two engineers shipped overlapping work simultaneously without coordination | Process discovery — write to operator memory; address at team-process layer |
| D-CYCLE-B2-PATHC-2 | Taofeek's branch had Cursor agent co-author tag — implies AI-assisted parallel implementation outside orchestrator | Process discovery — orchestrator should add a "before-you-build" check for any AI agent dispatching against the codebase |
| D-CYCLE-B2-PATHC-3 | Taofeek used `2024-11-20.acacia` (production v1) which doesn't support Accounts v2 controller properties | Closed at amendment; v2 is canonical per D-B2-5 |
| D-CYCLE-B2-PATHC-4 | I-PROPOSED-P violated by Taofeek's direct `brands.update` writes | Closed at amendment; gate enforces during implementor work |
| D-CYCLE-B2-PATHC-5 | Idempotency missing in Taofeek's branch — would have caused duplicate-account risk under load | Closed at amendment; I-PROPOSED-R added |
| D-CYCLE-B2-PATHC-6 | Audit logging absent in Taofeek's branch | Closed at amendment; I-PROPOSED-S added |
| D-CYCLE-B2-PATHC-7 | Taofeek's webhook returns 500 on processing error vs Seth's durable-queue 200-always | Closed at amendment per D-B2-27 — Seth's pattern wins |
| D-CYCLE-B2-PATHC-8 | Taofeek's frontend `deriveBrandStripeStatus` 4-positional signature vs Seth's object signature | Closed at amendment per D-B2-25 — Seth's wins |

---

## §11 — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration order conflict on existing dev DBs that have applied Taofeek's migrations | Low (only Taofeek's machine likely has them) | Medium | Implementor's Phase 0 includes a `supabase db reset` (clean slate); all dev DBs re-apply ordered set |
| `stripe.balance.retrieve()` rate-limited on high-traffic brands during balances polling | Medium | Low (degrades gracefully) | KPI tiles cache for 30s; React Query staleTime; show stale UI while refreshing |
| Stripe rejects `accounts.del()` on account in poor standing | Medium | Low (D-B2-29 — local detach still succeeds) | Audit log captures Stripe response; UI shows successful local detach with note "Stripe will retain a record" |
| Cron for KYC stall reminder fires duplicate emails if Resend idempotency key collides | Low | Low | Idempotency by `{brand_id}:{Y-M-D}` ensures at-most-once-per-day |
| Implementor accidentally re-introduces direct `brands.stripe_*` writes during Tao backport | Medium | Medium | I-PROPOSED-P strict-grep gate catches at PR time |
| Taofeek's branch has additional ORCH-0734/0737 work that would conflict with main if dragged in | Low (we're cherry-picking, not merging) | High | Explicit DROP list in §4; implementor must not pull anything else from Taofeek |

---

**End of amendment.**

For implementor dispatch instructions, see `outputs/IMPL_DISPATCH_B2_PATH_C.md`.

For background, see `outputs/B2_RECONCILIATION_REPORT.md` and `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md` (which this supersedes).
