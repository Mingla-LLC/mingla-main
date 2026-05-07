> **⚠️ SUPERSEDED 2026-05-06 by [outputs/SPEC_B2_PATH_C_V3.md](SPEC_B2_PATH_C_V3.md).** V2 fixed V1 SPEC contradictions but did not cover multi-country, KYC remediation messaging, deadline warnings, bank verification surface, detached refund reconciliation, webhook delivery monitoring, secret rotation, GDPR erasure pattern, RAK migration, IP allowlist, or Mingla ToS gate. V3 closes B2 fully.


# SPEC v2 — Cycle B2a Path C (Stripe Connect onboarding + B2b fold-in + B3 prep)

**Supersedes:** [outputs/SPEC_B2_PATH_C_AMENDMENT.md](SPEC_B2_PATH_C_AMENDMENT.md) (v1) — to be marked SUPERSEDED at SPEC v2 lock
**Amends:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md` (original B2a SPEC)
**Effective:** 2026-05-06
**Status:** DRAFT — pending operator review; flips ACTIVE on dispatch
**Author:** orchestrator (post-forensics, per [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_AUDIT.md))
**Cycle ID:** B2a (expanded scope — J-B2.4 + J-B2.5 fold in; balances endpoint advances B3 prep)

---

## §1 — Why this version exists

SPEC v1 was authored under context pressure with documented gaps. The forensics audit at `INVESTIGATION_B2_PATH_C_AUDIT.md` proved 3 SPEC v1 claims false against actual code, surfaced 5 root-cause-class findings, and identified 8 architectural decisions left unspecified. SPEC v2:

1. **Falsified-claim fixes** — corrects D-B2-29 (trigger doesn't actually clear cache on detach) and D-B2-28 (webhook doesn't actually clear KYC reminder marker).
2. **Webhook retry policy** — defines how `payment_webhook_events.processed=false` rows get reprocessed (R-2 fix).
3. **Reactivation flow** — defines how a detached brand re-onboards (CF-1 fix).
4. **8 architectural decisions locked** — D-V2-1 through D-V2-8 (see §2 below) with operator-overridable defaults.
5. **Phase 0' inserted** — trigger-fix migration as a new phase between Phase 0 (committed in `cf3969bf`+`cfb121e8`) and Phase 1 webhook router refactor.

**Phase 0 commits stay.** The foundation (5 strict-grep gates O/P/Q/R/S, 2 migrations, INVARIANT_REGISTRY append, B2a refresh-status audit-log gap fix) is sound and verified by the new gates.

---

## §2 — Locked decisions

### Carried from B2a (no change)

| ID | Decision | Source |
|---|---|---|
| DEC-112 | Stripe Connect type = EXPRESS | B2a SPEC §2 |
| DEC-113 | Routing = BRAND-LEVEL | B2a SPEC §2 |
| DEC-114 | Charge model = MARKETPLACE (controller properties on `accounts.create`) | B2a SPEC §2 |
| D-B2-3 | DB-trigger-synced cache | B2a SPEC §2.2 |
| D-B2-5 | Stripe API version pin = `2026-04-30.preview` | B2a SPEC §2.2 |
| D-B2-13 | Region scope = UK only at MVP | B2a SPEC §2.2 |
| D-B2-22 | Idempotency-Key on every Stripe API call | B2a SPEC §2.2 |
| D-B2-23 | SDK strategy = Path B (Mingla-hosted page + `@stripe/connect-js`) | B2a SPEC §2.2 + spike |
| DEC-121 | Path C executed (per SPEC v1 §2 §10 + V2 supersession) | SPEC v1 §2 |
| DEC-122 | B2a expanded scope (J-B2.1 + J-B2.4 + J-B2.5 + balances API; B2b dissolved into B2a) | SPEC v1 §2 |
| DEC-123 | Single webhook handler (`stripe-webhook/`) routes via shared `_shared/stripeWebhookRouter.ts` | SPEC v1 §2 |

### V2 newly-locked decisions (orchestrator defaults; operator can override)

| ID | Decision | Default | Alternative considered | Rationale |
|---|---|---|---|---|
| **D-V2-1** | Trigger detach handling | **Update trigger** with `CASE WHEN NEW.detached_at IS NOT NULL THEN NULL ELSE ... END` for all 3 mirror columns | Allowlist comment in detach fn; fn writes `brands.stripe_*` directly | Trigger keeps single canonical writer; preserves I-PROPOSED-P without exception. Clean strict-grep PASS. |
| **D-V2-2** | Reactivation flow | **Clear `detached_at` + reuse Stripe account ID** | Archive old + insert new | Stripe doesn't allow duplicate accounts for the same business. The Stripe-side account persists post-detach unless explicitly deleted. Reactivation = un-soft-delete locally + new AccountSession on the same account. |
| **D-V2-3** | Webhook replay-after-failure | **Retry when `processed=false`, max 5 attempts** | Skip all replays (current); retry forever | Honors Stripe's 72-hour retry contract. Cap prevents runaway retries on permanent errors (e.g., schema constraint violations). After 5 fails: row marked `error=true, retries_exhausted=true`; ops notified. |
| **D-V2-4** | Multi-region scope under Path C | **Keep UK-only**; reject Tao's multi-region helper | Adopt multi-region; intermediate flag-gated | D-B2-13 unchanged. Multi-region is B2c future work. Implementor MUST NOT carry over `countryFromDefaultCurrency()` from Tao's branch. |
| **D-V2-5** | RPC name standardization | **Keep `_for_brand` + explicit user_id** (matches code); fix header docs | Switch to `_for_caller` + auth.uid(); deprecate one | Service-role context can't reliably use `auth.uid()`. Code is correct; docs are stale. Header doc fix only. |
| **D-V2-6** | Anon GRANT on `pg_derive_brand_stripe_status` | **Revoke anon GRANT**; require authenticated | Keep current (info disclosure accepted) | Information disclosure surface is gratuitous for anon users; no caller actually needs it. New migration revokes. |
| **D-V2-7** | Payout status enum mapping | **Preserve raw Stripe statuses** (`pending`/`paid`/`failed`/`in_transit`/`canceled`) | Adopt Tao's compressed mapping (in_transit→pending, canceled→failed) | No information loss. Frontend can group display states later. |
| **D-V2-8** | Audit-log sampling for refresh-status | **Only-on-state-change** (current Phase 0 implementation) with explicit invariant carve-out | Every-call audit; fixed-rate sampling | At 100 brands × 30s polling = 12K rows/hr if every call audited. State-change-only is operationally pragmatic. I-PROPOSED-S registry entry already permits this per its sampling note. |

---

## §3 — Scope

### In scope (this cycle)

**J-B2.1 — Stripe Connect onboarding (embedded)** — unchanged from B2a SPEC §3.

**J-B2.4 — KYC stall recovery** — Resend email cron, idempotent by date, marker cleared by webhook router on `account.updated` → `charges_enabled=true` (now correctly specified per D-V2-3 + R-2 fix).

**J-B2.5 — Account detach + reactivation** — soft-delete via `detached_at`. **Reactivation flow now in scope** (per D-V2-2): re-onboarding a detached brand clears `detached_at` and creates a new AccountSession on the same Stripe account.

**Brand balances endpoint** (B3 prep) — unchanged.

**Webhook router with full event-type coverage** — `account.updated`, `account.application.deauthorized`, `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`, `capability.updated`. Per-event-type behavioral contracts now explicitly defined (§6).

**CI workflow expansion** — strict-grep with all 5 gates O/P/Q/R/S, smoke CI, migrations-and-Deno-tests CI.

**Test coverage** — Seth's 13-case jest + new jest tests for detach (~6) + balances (~4) + KYC stall (~5) + reactivation (~3) + Tao's ported Deno tests (3 files).

### Out of scope (deferred)

- Native React Native `<ConnectAccountOnboarding>` (Path A) — Cycle B2c, gated on Stripe RN private preview approval
- Live mode launch — gated on Stripe Marketplace review approval + sandbox stability
- B3 (Checkout) UI — only balances endpoint ships now
- Multi-region beyond UK (D-V2-4)
- Custom KBA workflows / Issuing / Treasury

### Newly out of scope (post-forensics)

Per forensics §9 Table C — these are deferred but recorded for SPEC v3 / B2c / B3:

- C1 `requirements.currently_due` vs `eventually_due` UI distinction → B2 v3 follow-up (high priority)
- C2 `disabled_reason` enum → specific UX mapping → B2 v3 follow-up
- C5 Webhook secret rotation strategy → ops/compliance cycle
- C6 `restricted_soon` warning → B2c
- C7 Bank verification status surface → B2c
- C8 Refund flow on detach → B3 cross-cycle decision
- C9 Webhook delivery monitoring → ops post-launch
- C11 Audit log retention + GDPR → compliance cycle

---

## §4 — File manifest (revised)

### KEEP (no change)

```
supabase/functions/brand-stripe-onboard/index.ts             (modified per §6 reactivation)
supabase/functions/stripe-webhook/index.ts                   (modified per §6 router delegation)
supabase/functions/brand-stripe-refresh-status/index.ts      (already modified Phase 0 audit-log fix)
supabase/functions/_shared/stripe.ts                          (Stripe client + version pin)
supabase/functions/_shared/idempotency.ts                     (key generator)
supabase/functions/_shared/audit.ts                           (audit_log writer)
supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql
supabase/migrations/20260509000001_b2_payouts_stripe_id_unique.sql      (Phase 0 added)
supabase/migrations/20260509000002_b2_kyc_stall_reminder_column.sql     (Phase 0 added)
mingla-business/src/services/brandStripeService.ts
mingla-business/src/services/brandMapping.ts
mingla-business/src/utils/deriveBrandStripeStatus.ts
mingla-business/src/utils/__tests__/deriveBrandStripeStatus.test.ts
mingla-business/src/hooks/useBrandStripeStatus.ts
mingla-business/src/hooks/useStartBrandStripeOnboarding.ts
mingla-business/src/hooks/useBrands.ts
mingla-business/src/components/brand/BrandOnboardView.tsx
mingla-business/src/components/brand/BrandPaymentsView.tsx
mingla-business/app/connect-onboarding.tsx
mingla-business/app/brand/[id]/payments/onboard.tsx
.github/workflows/strict-grep-mingla-business.yml
.github/scripts/strict-grep/i-proposed-{o,p,q,r,s}-*.mjs     (Phase 0 added/renamed)
```

### ADD (new in V2 vs V1)

```
supabase/migrations/20260510000001_b2a_path_c_trigger_detach_cascade.sql       (NEW — D-V2-1 fix; Phase 0')
supabase/migrations/20260510000002_b2a_path_c_revoke_anon_status_grant.sql     (NEW — D-V2-6 fix; Phase 0')
```

### ADD (carried from V1)

```
supabase/functions/_shared/stripeWebhookRouter.ts                              (Phase 1)
supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts               (Phase 1)
supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts            (Phase 1)
supabase/functions/brand-stripe-detach/index.ts                                (Phase 2)
supabase/functions/brand-stripe-balances/index.ts                              (Phase 3)
supabase/functions/stripe-kyc-stall-reminder/index.ts                          (Phase 4)
mingla-business/src/services/brandStripeBalancesService.ts                      (Phase 5)
mingla-business/src/services/brandStripeDetachService.ts                        (Phase 6)
mingla-business/src/hooks/useBrandStripeBalances.ts                             (Phase 5)
mingla-business/src/hooks/useBrandStripeDetach.ts                               (Phase 6)
mingla-business/src/utils/__tests__/brandStripeDetach.test.ts                   (Phase 6)
mingla-business/src/utils/__tests__/brandStripeBalances.test.ts                 (Phase 5)
mingla-business/src/utils/__tests__/kycStallReminder.test.ts                    (Phase 4)
mingla-business/src/utils/__tests__/onboardReactivation.test.ts                 (Phase 1; NEW IN V2 — covers reactivation flow)
.github/workflows/stripe-connect-smoke.yml                                      (Phase 7)
.github/workflows/supabase-migrations-and-stripe-deno.yml                       (Phase 8)
```

### MODIFY

```
supabase/functions/brand-stripe-onboard/index.ts:
  - Lines 167-173: replace 409 "account_detached_b2b_only" rejection with reactivation flow
    (clear detached_at + create new AccountSession on existing stripe_account_id)
  - Lines 13: header doc fix RPC name to `_for_brand` (matches actual call)
  - NEW: handle restricted state distinct from detached state (preserved for B2 v3)

supabase/functions/stripe-webhook/index.ts:
  - Lines 113-119: replace skip-all-replays logic with retry-when-processed=false (max 5 attempts)
  - Lines 143-201: delegate to _shared/stripeWebhookRouter.ts (Phase 1)
  - NEW: clear `kyc_stall_reminder_sent_at` when account.updated flips charges_enabled=true (per D-B2-28 fix)

supabase/functions/brand-stripe-refresh-status/index.ts:
  - Lines 13: header doc fix RPC name (same as onboard)

supabase/functions/_shared/idempotency.ts:
  - Extend StripeOperation union to include "detach", "balance", "kyc_reminder", "webhook_account_retrieve", "reactivate"
  - (Optional) bump epoch precision from ms to ns or add random suffix per CF-2

mingla-business/src/components/brand/BrandPaymentsView.tsx:
  - KPI tiles bind to useBrandStripeBalances (Phase 5)
  - Settings section adds "Disconnect Stripe" CTA + ConfirmDialog (Phase 6)

Mingla_Artifacts/INVARIANT_REGISTRY.md:
  - I-PROPOSED-S: extend "Sampling note" to explicitly approve only-on-state-change pattern (D-V2-8)
  - I-PROPOSED-O/P/Q/R: NO change

Mingla_Artifacts/DECISION_LOG.md:
  - Append DEC-121/122/123 entries (V2 supersedes V1's claim numbers — same numbers since V1 wasn't yet committed to log)
  - Append D-B2-24 through D-B2-30 (cycle-scoped sub-decisions)
  - Append D-V2-1 through D-V2-8 (V2-specific decisions)

clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md:
  - Header note: B2a Path C V2 supersedes V1; smoke checklist still valid + 4 new stages (detach + balances + KYC + reactivation)
```

### DROP (no Tao file actually present in working tree; defensive list per V1 §4)

```
(no files actually present to drop — Tao's competing files are ONLY in worktree at /tmp/mingla-b2-comparison/tao-b2/, not in Seth's working tree)
```

---

## §5 — Invariants (no change from V1)

All 5 Stripe invariants O/P/Q/R/S already DRAFT in INVARIANT_REGISTRY (Phase 0 added Q/R/S; renamed J→O, K→P).

V2-specific update: **I-PROPOSED-S sampling note extended** to explicitly approve only-on-state-change pattern for high-frequency callers (refresh-status, balances polling).

No new invariants in V2.

---

## §6 — Behavioural contracts (revised per forensics findings)

### `_shared/stripeWebhookRouter.ts` (NEW; Phase 1)

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

export const HANDLED_EVENT_TYPES: ReadonlyArray<StripeWebhookEventType>;

export type RouteResult =
  | { ok: true; effects: ReadonlyArray<string> }
  | { ok: false; error: string; retryable: boolean };

export async function routeStripeEvent(
  event: Stripe.Event,
  ctx: { supabase: SupabaseClient; stripe: Stripe }
): Promise<RouteResult>;
```

**Per-event-type behaviors (V2 explicit):**

| Event type | Update target | Side effects | Retryable on error? |
|---|---|---|---|
| `account.updated` | `stripe_connect_accounts` (charges_enabled, payouts_enabled, requirements) | Clear `kyc_stall_reminder_sent_at` if `charges_enabled` flipped to true; trigger mirrors to `brands.stripe_*` | YES (network/Stripe 5xx); NO (constraint failure) |
| `account.application.deauthorized` | `stripe_connect_accounts.detached_at = now()` | Trigger clears `brands.stripe_*` per D-V2-1 | YES |
| `payout.created` | `payouts` UPSERT by `stripe_payout_id` (status, amount, currency, arrival_date) | Audit row | YES |
| `payout.paid` | `payouts` UPDATE WHERE stripe_payout_id (status='paid', paid_at) | Audit row | YES |
| `payout.failed` | `payouts` UPDATE (status='failed', failure_reason) | Audit row + (future) brand notification (B3) | YES |
| `payout.canceled` | `payouts` UPDATE (status='canceled') | Audit row | YES |
| `capability.updated` | `stripe_connect_accounts.requirements` (capability state changed) | Audit row | YES |
| Unknown event type | (no DB change) | Log + audit `action='stripe_connect.unknown_event'` (per HF-3 fix) | N/A |

**Per-event-type type-narrowing:** event union types must be properly narrowed; no `AccountObject` cast across all events (HF-1 fix).

### `stripe-webhook/index.ts` (MODIFY)

**Replace** lines 113-119 (replay-skip-all logic) with:

```
if (existingRow) {
  if (existingRow.processed === true) {
    // Already processed — idempotent skip
    return plainResponse({ status: "replayed_already_processed" }, 200);
  }
  // Prior attempt failed; retry if under cap
  const retryCount = existingRow.retry_count ?? 0;
  if (retryCount >= 5) {
    return plainResponse({ status: "retries_exhausted" }, 200);
  }
  // Continue to Step 7 (process inline) using existingRow.id
  // Increment retry_count on Step 8 mark
}
```

**Schema change (in trigger-fix migration §7 Phase 0'):** add `payment_webhook_events.retry_count int NOT NULL DEFAULT 0` column.

**Add `kyc_stall_reminder_sent_at` clear logic** in `account.updated` handler when `charges_enabled` flips false→true.

### `brand-stripe-onboard/index.ts` (MODIFY — reactivation flow)

**Replace** lines 167-173 (409 b2b_only rejection) with:

```
if (existingSca?.detached_at !== null && existingSca?.detached_at !== undefined) {
  // Reactivation flow per D-V2-2:
  // - existingSca.stripe_account_id is still valid Stripe-side
  // - Clear detached_at (un-soft-delete)
  // - Trigger fires; brands.stripe_* mirrors NEW values (charges/payouts as Stripe sees them today)
  // - Skip Step 8 (account creation) — go straight to Step 10 (AccountSession create)
  // - Audit log: action='stripe_connect.reactivated'
  const { error: reactivateError } = await supabase
    .from("stripe_connect_accounts")
    .update({ detached_at: null, updated_at: new Date().toISOString() })
    .eq("id", existingSca.id);
  if (reactivateError) {
    return jsonResponse({ error: "internal_error", detail: "reactivate_failed" }, 500);
  }
  stripeAccountId = existingSca.stripe_account_id;
  scaRowId = existingSca.id;
  // Note: charges_enabled state on Stripe-side may have changed during detach period;
  // refresh-status fallback (or next webhook) will reconcile
}
```

**Test cases (Phase 1 add to onboardReactivation.test.ts):**
- Reactivate brand with previously detached + still-active Stripe account → success, AccountSession returned
- Reactivate brand with detached + Stripe-side restricted account → success, but UI surfaces restricted state on next refresh
- Reactivate brand with detached + Stripe-side deleted account (rare; Stripe rejected it) → error, surface "account permanently removed; contact support"

### `brand-stripe-detach/index.ts` (NEW; Phase 2)

Same contract as V1 §6 but with V2 additions:

- **Idempotency-Key:** `generateIdempotencyKey(brand_id, "detach")` on `stripe.accounts.del` call
- **Audit log:** `action='stripe_connect.detach'` with metadata `{stripe_delete_status: 'deleted' | 'rejected' | 'unknown', reason}`
- **Soft-delete only:** `UPDATE stripe_connect_accounts SET detached_at = now()` — never `DELETE FROM`
- **Trigger handles cache clear** (per D-V2-1 trigger update; no direct `brands.stripe_*` write in fn)
- **HTTP 200** on Stripe API rejection of `accounts.del` (local detach succeeds anyway per D-B2-29)

### `brand-stripe-balances/index.ts` (NEW; Phase 3)

Same as V1 §6 contract.

### `stripe-kyc-stall-reminder/index.ts` (NEW; Phase 4)

V2 additions:

- **Cron jitter:** loop yields `setTimeout(0)` between sends; OR explicit `Math.random() * 100ms` jitter to avoid Resend rate-limit storms (CF-7 fix)
- **Resend rate-limit handling:** circuit-break after N consecutive failures within 60s; surface to ops via audit log

### `mingla-business/src/components/brand/BrandPaymentsView.tsx` (MODIFY)

V2 additions to V1 §6 contract:

- **Disconnect CTA reactivation hint:** when `stripeStatus === 'not_connected'` AND `brand.stripe_connect_id !== null` (i.e., previously-detached), show "Reconnect Stripe" CTA instead of "Set up payments"
- **Reactivation deep link:** route `/brand/[id]/payments/onboard?reactivate=1` re-uses the existing onboard flow

### Migration `20260510000001_b2a_path_c_trigger_detach_cascade.sql` (NEW; Phase 0')

```sql
-- B2a Path C V2 — trigger fix for detach cascade per D-V2-1.
-- Replaces the 20260508000000-defined tg_sync_brand_stripe_cache trigger function
-- to handle the detach case (NEW.detached_at IS NOT NULL → mirror NULL/false to brands).
--
-- Why: forensics R-1 surfaced that the original trigger always mirrors live values
-- regardless of detach state, falsifying SPEC v1 D-B2-29 claim.
-- Per I-PROPOSED-P: brands.stripe_* still mirrored ONLY by trigger (no exception).

CREATE OR REPLACE FUNCTION "public"."tg_sync_brand_stripe_cache"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.brands
  SET
    stripe_connect_id =
      CASE WHEN NEW.detached_at IS NOT NULL THEN NULL ELSE NEW.stripe_account_id END,
    stripe_charges_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.charges_enabled END,
    stripe_payouts_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.payouts_enabled END
  WHERE id = NEW.brand_id;

  RETURN NEW;
END;
$$;

-- ALTER FUNCTION + GRANT statements unchanged from baseline; OR REPLACE preserves them.

-- Add retry_count column to payment_webhook_events for D-V2-3 webhook retry policy.
ALTER TABLE "public"."payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "retry_count" int NOT NULL DEFAULT 0;

COMMENT ON COLUMN "public"."payment_webhook_events"."retry_count" IS
  'Number of processing attempts. Webhook router increments on each retry; caps at 5 per D-V2-3 policy.';
```

### Migration `20260510000002_b2a_path_c_revoke_anon_status_grant.sql` (NEW; Phase 0')

```sql
-- B2a Path C V2 — revoke anon GRANT on pg_derive_brand_stripe_status per D-V2-6.
-- Information-disclosure surface for anon users; no caller actually needs anon access.
-- Authenticated + service_role grants preserved.

REVOKE EXECUTE ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") FROM "anon";
```

---

## §7 — Implementation phasing (revised)

**Phase 0 already complete** (commits `cf3969bf` + `cfb121e8`):
- 5 strict-grep gates O/P/Q/R/S
- 2 migrations (20260509000001 + 20260509000002)
- INVARIANT_REGISTRY append (O/P renamed; Q/R/S added DRAFT)
- B2a refresh-status audit-log gap fix

**Phase 0' (NEW — must run before Phase 1):**

| Phase | Scope | Evidence |
|---|---|---|
| **0'a** | Migration `20260510000001` (trigger detach cascade fix + payment_webhook_events.retry_count) | `supabase db reset` clean; new test verifies trigger clears brands on detach |
| **0'b** | Migration `20260510000002` (revoke anon GRANT) | `supabase db reset` clean |
| **0'c** | Update I-PROPOSED-S sampling note in INVARIANT_REGISTRY (D-V2-8 codified) | Diff shows extended sampling clause |
| **0'd** | Append DEC-121/122/123 + D-B2-24..30 + D-V2-1..8 to DECISION_LOG.md | Visible at top of file |
| **0'e** | Doc fix: header comments in onboard + refresh-status point at correct RPC name (D-V2-5) | grep verifies |
| **0'f** | Mark SPEC v1 (`outputs/SPEC_B2_PATH_C_AMENDMENT.md`) as SUPERSEDED with header note pointing at v2 | Visible at top |

**Phase 1 — Webhook router refactor (per V2 §6):**
- Create `_shared/stripeWebhookRouter.ts` with 7 event-type handlers + unknown-event audit
- Modify `stripe-webhook/index.ts` for retry-on-failure (D-V2-3) + delegation to router + KYC reminder marker clear
- Author Deno tests for router + signature
- Author jest test `onboardReactivation.test.ts`

**Phase 2 — `brand-stripe-detach/` per V2 §6** (idempotency + audit + trigger-only)

**Phase 3 — `brand-stripe-balances/` per V2 §6** (UK-only per D-V2-4 — no multi-region helper)

**Phase 4 — `stripe-kyc-stall-reminder/` per V2 §6** (with jitter + circuit-breaker per CF-7 fix)

**Phase 5 — Frontend balances** (service + hook + KPI tile wiring; UK-only `formatGbp` acceptable per D-B2-13 + HF-9 documented limitation)

**Phase 6 — Frontend detach + reactivation** (CTA + ConfirmDialog + reactivation hint when prior `stripe_connect_id` exists)

**Phase 7 — Smoke CI** (port Tao's `stripe-connect-smoke.yml`; UK-only happy path)

**Phase 8 — Migrations + Deno test CI** (port Tao's `supabase-migrations-and-stripe-deno.yml`)

**Phase 9 — Cleanup + verification:**
- All 5 gates: 0 violations
- `npx tsc --noEmit`: exit 0
- `npx jest`: all pass (Seth's 13 + new ~20)
- `deno test` (Deno tests): all pass
- `supabase db reset`: all 5 migrations apply cleanly
- No orphan imports, no Co-Authored-By, no stale doc references

**Phase 10 — Operator smoke** (sandbox; per `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` + 4 new stages: detach + balances + KYC reminder + reactivation)

**Phase 11 — Tester dispatch** (verify all 33 SCs + all 5 invariants + all V2 decisions honored)

**Phase 12 — Operator CLOSE** (DEC-121 lock + I-PROPOSED-O/P/Q/R/S flip ACTIVE + 7-artifact SYNC + EAS OTA dual-platform per `feedback_eas_update_no_web`)

---

## §8 — Migration ordering (revised)

| Order | File | Owner |
|---|---|---|
| 1 | `20260508000000_b2a_stripe_connect_onboarding.sql` | Original B2a |
| 2 | `20260509000001_b2_payouts_stripe_id_unique.sql` | Path C Phase 0 (committed `cf3969bf`) |
| 3 | `20260509000002_b2_kyc_stall_reminder_column.sql` | Path C Phase 0 (committed `cf3969bf`) |
| 4 | `20260510000001_b2a_path_c_trigger_detach_cascade.sql` | Path C V2 Phase 0' |
| 5 | `20260510000002_b2a_path_c_revoke_anon_status_grant.sql` | Path C V2 Phase 0' |

Implementor verifies with `supabase db reset` (Docker) that all 5 apply in order without error.

---

## §9 — Test plan summary (revised)

### Total SCs: 33 (22 B2a + 8 V1 new + 3 V2 new)

| Category | SC count | New in V2? | Files |
|---|---|---|---|
| Status derivation | SC-01..SC-12 (12) | No | `deriveBrandStripeStatus.test.ts` |
| Onboarding API contracts | SC-13..SC-18 (6) | No | jest tests on services |
| Webhook idempotency + replay | SC-19..SC-22 (4) | No | Deno tests |
| Detach flow | SC-23..SC-26 (4) | No | jest + Deno |
| Balances endpoint | SC-27..SC-29 (3) | No | jest |
| KYC stall reminder | SC-30 (1) | No | jest |
| **Reactivation flow** | **SC-31..SC-33 (3)** | **YES** | `onboardReactivation.test.ts` |

### V2-specific new test cases (SC-31..SC-33)

- **SC-31:** Reactivate detached brand (Stripe-side active) → 200, AccountSession returned, `detached_at = NULL`, audit row written
- **SC-32:** Reactivate detached brand (Stripe-side restricted) → 200, AccountSession returned, restricted state surfaced on next refresh
- **SC-33:** Reactivate detached brand (Stripe-side permanently deleted) → 4xx error with "account permanently removed; contact support" message

### V2-specific new behavioral tests

- **Trigger detach cascade test** — Insert SCA with `detached_at = NULL`; verify `brands.stripe_connect_id` set. UPDATE `detached_at = now()`; verify `brands.stripe_connect_id` cleared to NULL.
- **Webhook retry-on-failure test** — Insert `payment_webhook_events` row with `processed=false, error=...`; replay event; verify retry attempt; verify `retry_count++`; verify cap at 5.
- **KYC marker clear test** — Set `kyc_stall_reminder_sent_at`; fire `account.updated` with `charges_enabled=true`; verify marker cleared.

---

## §10 — Discoveries to disposition at CLOSE

Carries over from V1 + new from V2:

| ID | Description | Disposition |
|---|---|---|
| D-CYCLE-B2-PATHC-1..8 (V1) | Process discoveries (parallel implementation, AI agent dispatch coordination, etc.) | Carry forward to CLOSE |
| **D-CYCLE-B2-PATHC-V2-1** | SPEC v1 D-B2-29 trigger claim was falsified by code; fixed in V2 D-V2-1 + Phase 0' migration | CLOSED at SPEC v2 lock |
| **D-CYCLE-B2-PATHC-V2-2** | SPEC v1 D-B2-28 KYC marker clear claim was falsified; fixed in V2 webhook router | CLOSED at SPEC v2 lock |
| **D-CYCLE-B2-PATHC-V2-3** | Webhook replay-skip-all defect existed in shipped B2a code; fixed in V2 D-V2-3 + retry_count column | CLOSED at SPEC v2 lock |
| **D-CYCLE-B2-PATHC-V2-4** | Reactivation flow undefined in V1; defined in V2 D-V2-2 + onboard modify | CLOSED at SPEC v2 lock |
| **D-CYCLE-B2-PATHC-V2-5** | RPC name doc/code drift in 2 files; fixed in V2 Phase 0'e | CLOSED at SPEC v2 lock |
| **D-CYCLE-B2-PATHC-V2-6** | Anon GRANT info disclosure surface; fixed in V2 D-V2-6 + Phase 0'b migration | CLOSED at SPEC v2 lock |
| **D-CYCLE-B2-PATHC-V2-7** | Idempotency-Key sub-ms collision risk (CF-2); minor — track as B2c follow-up | DEFER to B2c |
| **D-CYCLE-B2-PATHC-V2-8** | `formatGbp` hardcoded in BrandPaymentsView (HF-9); acceptable for UK-only MVP | DEFER to B2c |
| **D-CYCLE-B2-PATHC-V2-9** | 12 production-grade gaps in §3 "newly out of scope" — track for B2 v3 / B2c / B3 | TRACK for follow-up cycles |

---

## §11 — Risk register (revised)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration order conflict on existing dev DBs | Low | Medium | Phase 9 includes `supabase db reset` validation |
| `stripe.balance.retrieve()` rate-limited | Medium | Low | KPI tiles cache 30s; React Query staleTime; show stale UI |
| Stripe rejects `accounts.del()` | Medium | Low | Local detach still succeeds per D-B2-29 |
| Cron duplicate emails on idempotency-key collision | Low | Low | Idempotency by `{brand_id}:{Y-M-D}` ensures at-most-once-per-day |
| Implementor introduces direct `brands.stripe_*` writes | Medium | Medium | I-PROPOSED-P strict-grep gate catches at PR |
| Tao's branch additional ORCH work conflicts | Low | High | Explicit DROP list in V2 §4; implementor must not pull anything else |
| **Reactivation flow has unforeseen Stripe-side state edge cases** | Medium | Medium | SC-31..SC-33 cover 3 cases; tester probes Stripe sandbox at Phase 11 |
| **Trigger fix migration breaks existing test fixtures** | Low | Low | Migration is OR REPLACE; idempotent re-apply; rollback = re-apply original 20260508000000 |
| **Webhook retry policy creates infinite-retry loop on permanent error** | Low | Low | Hard cap at 5 per D-V2-3; marked `retries_exhausted=true` after cap |

---

## §12 — Confidence statement

| Section | Confidence | Why |
|---|---|---|
| §2 V2-locked decisions | M-H | Defaults are reasonable but operator may override D-V2-1 (trigger vs allowlist) or D-V2-7 (payout enum mapping) |
| §6 behavioral contracts | H | Forensics-grounded; all R-1/R-2/CF-1 fixes encoded |
| §7 phasing | H | Phase 0' + Phase 1-9 maps cleanly to forensics findings |
| §9 test plan | M | SC-31..SC-33 are reactivation-only; could add more behavioral tests at Phase 11 |
| Migration order | H | Verified clean from baseline + 2026-05-08 + 2026-05-09 + 2026-05-10 |

---

**End of SPEC v2.**

For implementor dispatch instructions, see `outputs/IMPL_DISPATCH_B2_PATH_C_V2.md` (to be authored post-V2 lock).

For background, see [outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md](B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md), [outputs/B2_RECONCILIATION_REPORT.md](B2_RECONCILIATION_REPORT.md), and [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_AUDIT.md).
