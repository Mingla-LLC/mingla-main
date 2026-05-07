# SPEC v3 — Cycle B2a Path C (battle-tested; multi-country + full B2 cycle)

**Supersedes:** [outputs/SPEC_B2_PATH_C_AMENDMENT.md](SPEC_B2_PATH_C_AMENDMENT.md) (V1) + [outputs/SPEC_B2_PATH_C_V2.md](SPEC_B2_PATH_C_V2.md) (V2)
**Effective:** 2026-05-06
**Status:** DRAFT — pending operator review; flips ACTIVE on dispatch
**Author:** mingla-forensics in IA mode (per [outputs/FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md](FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md))
**Investigation companion:** [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md)
**Cycle ID:** B2a (expanded scope per DEC-122; B2b dissolved into B2a; this is the FULL B2 close)

---

## §1 — Why V3 exists

V1 was orchestrator-authored with multiple SPEC contradictions (caught by V2 forensics). V2 fixed those but didn't cover multi-country, KYC UI, deadline warnings, bank verification, monitoring, secret rotation, GDPR, RAKs, IP allowlist, T&Cs. Operator's directive: **"one battle tested spec so we can implement"** — close B2 fully so future cycles (B3 Checkout, B4 Scanner) build on a complete foundation, not retrofit gaps.

**Phase 0 commits stay** (`cf3969bf` + `cfb121e8` — strict-grep gates, migrations, B2a audit-log gap fix, INVARIANT_REGISTRY append).

V3 builds Phase 0' + 0'' + 0''' + 1-15.

**SPEC v3 is the SINGLE source of truth.** V1 + V2 marked SUPERSEDED.

---

## §2 — Locked decisions

### Carried from B2a + V1 + V2 (no change in V3)

| ID | Decision |
|---|---|
| DEC-112 | Connect type intent: Express (controller properties) |
| DEC-113 | Routing: brand-level (`stripe_connect_accounts.brand_id` FK) |
| DEC-114 | Charge model: Marketplace (Mingla absorbs losses + pays fees) |
| DEC-121 | Path C executed |
| DEC-122 | B2a expanded scope (J-B2.1 + J-B2.4 + J-B2.5 + balances + multi-country in V3) |
| DEC-123 | Single webhook handler (`stripe-webhook/`) routes via shared router |
| D-B2-3 | DB-trigger-synced cache |
| D-B2-5 | Stripe API version pin = `2026-04-30.preview` (Accounts v2) |
| D-B2-22 | Idempotency-Key on every Stripe API call |
| D-B2-23 | SDK strategy: Path B (Mingla-hosted page + `@stripe/connect-js`) |
| D-V2-1 | Trigger detach cascade fix (Phase 0' migration) |
| D-V2-2 | Reactivation flow: clear `detached_at` + reuse Stripe account |
| D-V2-3 | Webhook replay-after-failure: retry max 5 attempts |
| D-V2-5 | RPC name: `_for_brand` + explicit user_id |
| D-V2-6 | Revoke anon GRANT on `pg_derive_brand_stripe_status` |
| D-V2-7 | Payout status enum: preserve raw 5 Stripe statuses |
| D-V2-8 | Audit-log sampling: only-on-state-change for refresh-status |

### V3 new decisions (operator-overridable defaults)

| ID | Decision | Default | Alternative |
|---|---|---|---|
| **D-V3-1** | Country list scope | **All 34 self-serve countries** (US/UK/CA/CH + 30 EEA) | Tier 1 only (US/UK/CA + 5 major EU); custom subset |
| **D-V3-2** | Notification subsystem | **EXTEND existing `notify-dispatch` + `push-utils.ts` + Resend** | Build new dedicated `stripe-notifications/` |
| **D-V3-3** | Audit log retention | **7 years** (covers strictest US IRS) | 5 (UK/EU AML); 10 (DE/IT VAT) |
| **D-V3-4** | GDPR right-to-be-forgotten | **Anonymization** (hash user_id, redact PII fields, KEEP rows) | Soft-delete with cold-storage archival |
| **D-V3-5** | Webhook replay retry | **Max 5 attempts; mark `retries_exhausted=true`** (carries V2 D-V2-3) | No retry; retry forever |
| **D-V3-6** | External_account state storage | **Separate table** `stripe_external_accounts` (1 row per bank account) | JSONB column on `stripe_connect_accounts` |
| **D-V3-7** | Detached refund visibility | **Read-only "Orphaned Refunds" section** in BrandPaymentsView | Hide entirely (audit_log only) |
| **D-V3-8** | Webhook silence alert threshold | **6 hours** | 1h (aggressive); 24h (lax) |
| **D-V3-9** | Webhook secret rotation cadence | **Quarterly + on personnel departure** | Annual; on-demand only |
| **D-V3-10** | Deadline warning thresholds | **7d / 3d / 1d before Stripe `current_deadline`** | 14d/7d/1d; 30d/7d/1d |
| **D-V3-11** | Deadline warning channels | **Email + Push + In-app** | Email only |
| **D-V3-12** | Bank verification UI surface | **"Bank: verified" / "Re-verify your bank" CTA** in BrandPaymentsView | Hide; rely on Stripe email |
| **D-V3-13** | Idempotency-Key sub-ms collision fix | **Nanosecond precision** `{brand_id}:{op}:{epoch_ns}` | UUID suffix; hash request body |
| **D-V3-14** | `stripe_connect_accounts.account_type` column | **Rename to `controller_dashboard_type`** | Drop (derivable from Stripe API) |
| **D-V3-15** | RAK migration phasing | **Phase 0'' (isolated; before V3 functional work)** | Per-fn migration as each phase ships |
| **D-V3-16** | IP allowlist enforcement | **Soft-fail** (log + audit; don't reject if signature valid) | Hard-fail (reject if IP not allowlisted) |
| **D-V3-17** | Mingla Business ToS acceptance gate | **Add gate in mingla-business onboarding pre-Stripe** | Defer; rely on T&Cs page link only |
| **D-V3-18** | Country-specific currency display | **Per-brand `default_currency` (multi-currency-aware)** | Display all currencies returned by Stripe |

---

## §3 — Scope

### In scope (V3)

**J-B2.1 — Stripe Connect onboarding** (V2 baseline + multi-country)
- 34 countries supported (D-V3-1)
- Country picker UI on first onboarding
- Per-country currency, bank format, KYC requirements
- Reactivation flow per D-V2-2

**J-B2.4 — KYC stall recovery** (V2 baseline + V3 expanded)
- Cron-based reminder (existing)
- Deadline warning system (D-V3-10): 7d/3d/1d notifications
- Multi-channel (D-V3-11): email + push + in-app

**J-B2.5 — Account detach + reactivation** (V2 baseline)

**Brand balances endpoint** (V2 baseline + V3 multi-currency)
- `balance.retrieve` per connected account
- Display per-brand `default_currency` (D-V3-18)
- Multi-currency response shape preserved server-side

**Webhook router with full event-type coverage** (V2 baseline + V3 expanded)

V3 webhook router handles **14 event types** (V2 had 7):

V2 carry-forward (7):
- `account.updated`
- `account.application.deauthorized`
- `payout.created` / `payout.paid` / `payout.failed` / `payout.canceled`
- `capability.updated`

V3 new (7):
- `account.external_account.created` (D-V3-6)
- `account.external_account.updated`
- `account.external_account.deleted`
- `account.requirements.updated` (deadline warnings + KYC UI surface)
- `charge.refund.updated` (D-V3-7 detached refund reconciliation)
- `person.created` / `person.updated` / `person.deleted` (KYC remediation per-person surface)
- `application_fee.created` / `application_fee.refunded` (revenue tracking)

**KYC remediation messaging** (D-V3-2)
- 30+ Stripe codes mapped to plain-English UI copy
- Constants file `mingla-business/src/constants/stripeKycRemediationMessages.ts`
- Surfaced in `BrandOnboardView` "in-flight" + "restricted" + "failed-stripe" states

**Bank verification UI** (D-V3-12)
- New section in `BrandPaymentsView` settings
- States: verified / verification-pending / verification-failed / no-bank
- "Re-verify your bank" CTA opens Stripe-hosted re-verification flow

**Detached refund visibility** (D-V3-7)
- "Orphaned Refunds" read-only section in `BrandPaymentsView` for detached brands
- Sourced from `audit_log` rows where `target_type='detached_refund'`

**Webhook delivery monitoring** (D-V3-8)
- New cron edge fn `stripe-webhook-health-check` runs every 1 hour
- 6-hour silence threshold default
- Alerts: email ops@mingla.app + audit log row

**Webhook secret rotation** (D-V3-9)
- Dual-secret acceptance pattern (current + previous env vars)
- Rotation runbook (operator-side)
- Quarterly cadence default

**Audit log retention + GDPR** (D-V3-3 + D-V3-4)
- 7-year retention default
- New table `gdpr_erasure_log`
- New SQL function `anonymize_user_audit_log(user_id, salt)` (service_role only)
- Anonymization-not-deletion pattern

**Payout failure brand notifications**
- Webhook router handles `payout.failed`
- Failure code → user-friendly remediation message mapping
- Multi-channel notification

**Notification subsystem extension** (D-V3-2)
- Reuse existing `notify-dispatch` + `push-utils.ts` + Resend
- New tables: `notifications`, `notification_preferences`
- 7+ Stripe-specific notification types

**RAK migration** (D-V3-15)
- 6 RAKs (one per Stripe edge fn)
- Migration runbook + verification

**Webhook IP allowlist** (D-V3-16)
- Stripe IP ranges hardcoded; soft-fail pattern

**Mingla Business ToS acceptance gate** (D-V3-17)
- Pre-Stripe onboarding gate
- `brand_team_members.mingla_tos_accepted_at` column

**Idempotency-Key collision fix** (D-V3-13)
- Nanosecond precision

**`account_type` column rename** (D-V3-14)
- `controller_dashboard_type` — clearer semantics

**CI workflow expansion**
- All V2 strict-grep gates (O/P/Q/R/S)
- New gates per V3 invariants (T/U/V — see §5)
- Smoke CI (Tao's, adapted)
- Migrations + Deno test CI

**Test coverage** — estimated 70-90 SCs across:
- Status derivation (12 SCs carry-forward)
- Onboarding API contracts (6 SCs carry-forward + 4 new for multi-country)
- Webhook idempotency + replay (4 SCs carry-forward + 6 new for V3 events)
- Detach flow (4 SCs carry-forward)
- Balances endpoint (3 SCs carry-forward + 4 new for multi-currency)
- KYC stall reminder (1 SC carry-forward)
- Reactivation flow (3 SCs carry-forward)
- Multi-country onboarding (~10 SCs — 1 per major country tier)
- KYC remediation messaging (~5 SCs)
- Deadline warnings (~5 SCs)
- Bank verification surface (~4 SCs)
- Detached refund visibility (~3 SCs)
- Webhook delivery monitoring (~3 SCs)
- Webhook secret rotation (~2 SCs)
- Audit log retention + GDPR erasure (~5 SCs)
- Payout failure notifications (~3 SCs)
- RAK migration verification (~6 SCs — 1 per RAK)
- IP allowlist (~2 SCs)
- ToS acceptance gate (~2 SCs)

**Total estimate: 84 SCs.** SPEC v3 author should produce final SC list at IMPL dispatch authoring time.

### Out of scope (deferred)

- **B2c — Native React Native SDK upgrade** (Stripe RN preview gated)
- **B2d — Australia + LatAm + Asia expansion** (requires separate Stripe platform entities — not self-serve)
- **B3 — Checkout UI + dispute handling** (`charge.dispute.*` events flagged but deferred)
- **B4 — Scanner / door-tickets**
- **Multi-currency UI beyond per-brand default** (display all currencies — D-V3-18 alternative)
- **Hard-delete GDPR erasure** (anonymization is V3 default)
- **Live-mode launch** (gated on Stripe Marketplace approval + sandbox stability)

---

## §4 — File manifest

### KEEP (Phase 0 + V2 baseline; no V3 change)

```
supabase/functions/_shared/{stripe,idempotency,audit}.ts        (Phase 0 added; idempotency.ts modified per D-V3-13)
supabase/functions/{brand-stripe-onboard,stripe-webhook,brand-stripe-refresh-status}/index.ts  (modified per V3)
supabase/migrations/20260508000000 + 20260509000001 + 20260509000002  (Phase 0)
mingla-business/src/services/brandStripeService.ts
mingla-business/src/services/brandMapping.ts
mingla-business/src/utils/deriveBrandStripeStatus.ts + tests
mingla-business/src/hooks/useBrandStripe* (3 files)
mingla-business/src/hooks/useBrands.ts
mingla-business/src/components/brand/BrandOnboardView.tsx (modified for multi-country + KYC remediation)
mingla-business/src/components/brand/BrandPaymentsView.tsx (modified for bank verification + orphaned refunds + multi-currency)
mingla-business/app/connect-onboarding.tsx
mingla-business/app/brand/[id]/payments/onboard.tsx
.github/workflows/strict-grep-mingla-business.yml (extended for V3 gates T/U/V)
.github/scripts/strict-grep/i-proposed-{o,p,q,r,s}-*.mjs       (Phase 0)
supabase/functions/_shared/push-utils.ts                       (existing OneSignal integration)
supabase/functions/notify-dispatch/index.ts                    (existing dispatcher; extended for Stripe types)
supabase/functions/admin-send-email/index.ts                   (existing Resend integration; reused)
```

### ADD (V3 new — ~30+ files)

**Phase 0' (V2 trigger fix + revoke anon GRANT):**
```
supabase/migrations/20260510000001_b2a_path_c_trigger_detach_cascade.sql
supabase/migrations/20260510000002_b2a_path_c_revoke_anon_status_grant.sql
```

**Phase 0'' (RAK migration — operator-side; no code changes; runbook only):**
```
docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md   (NEW — operator runbook)
```

**Phase 0''' (multi-country foundation):**
```
supabase/migrations/20260511000001_b2a_v3_country_support.sql      (adds country + default_currency cols + country_specs reference table)
supabase/migrations/20260511000002_b2a_v3_external_accounts.sql    (D-V3-6 separate table)
supabase/migrations/20260511000003_b2a_v3_notifications.sql        (notifications + notification_preferences tables)
supabase/migrations/20260511000004_b2a_v3_gdpr_erasure.sql         (gdpr_erasure_log table + anonymize_user_audit_log fn)
supabase/migrations/20260511000005_b2a_v3_tos_acceptance.sql       (mingla_tos_accepted_at column)
supabase/migrations/20260511000006_b2a_v3_account_type_rename.sql  (D-V3-14 rename column)
supabase/migrations/20260511000007_b2a_v3_webhook_retry_count.sql  (V2 carry-forward retry_count column)
supabase/migrations/20260511000008_b2a_v3_payments_webhook_secrets.sql (dual-secret support env config; no schema change)
```

**Phase 1-15 (sequential implementor work):**
```
supabase/functions/_shared/stripeWebhookRouter.ts                    (V2 carry-forward; Phase 1)
supabase/functions/_shared/stripeIpAllowlist.ts                       (V3 IP allowlist; Phase 1)
supabase/functions/_shared/stripeKycRemediation.ts                    (V3 server-side remediation helper; Phase 1)
supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts      (Deno; Phase 1)
supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts   (Deno; Phase 1)
supabase/functions/_shared/__tests__/stripeIpAllowlist.test.ts        (Deno; Phase 1)
supabase/functions/brand-stripe-detach/index.ts                       (Phase 2; refactored from Tao)
supabase/functions/brand-stripe-balances/index.ts                     (Phase 3)
supabase/functions/stripe-kyc-stall-reminder/index.ts                 (Phase 4; extended for deadline warnings)
supabase/functions/stripe-webhook-health-check/index.ts               (Phase 5; D-V3-8)
supabase/functions/stripe-payout-failed-notify/index.ts               (Phase 6; or inline in webhook router)
supabase/functions/stripe-deadline-warning-cron/index.ts              (Phase 7; or extended kyc-stall-reminder)
mingla-business/src/services/brandStripeBalancesService.ts            (Phase 8)
mingla-business/src/services/brandStripeDetachService.ts              (Phase 8)
mingla-business/src/services/brandStripeCountriesService.ts           (Phase 8; lists supported countries)
mingla-business/src/hooks/useBrandStripeBalances.ts                   (Phase 9)
mingla-business/src/hooks/useBrandStripeDetach.ts                     (Phase 9)
mingla-business/src/hooks/useBrandStripeCountries.ts                  (Phase 9)
mingla-business/src/hooks/useBrandStripeBankVerification.ts           (Phase 9; D-V3-12)
mingla-business/src/components/brand/BrandStripeCountryPicker.tsx     (Phase 10)
mingla-business/src/components/brand/BrandStripeBankSection.tsx       (Phase 10; bank verification surface)
mingla-business/src/components/brand/BrandStripeOrphanedRefundsSection.tsx  (Phase 10; D-V3-7)
mingla-business/src/components/brand/BrandStripeDeadlineBanner.tsx    (Phase 10; deadline warnings UI)
mingla-business/src/components/brand/BrandStripeKycRemediationCard.tsx (Phase 10; specific KYC messaging)
mingla-business/src/components/onboarding/MinglaToSAcceptanceGate.tsx  (Phase 11; D-V3-17)
mingla-business/src/constants/stripeKycRemediationMessages.ts          (Phase 11; 30+ codes mapped)
mingla-business/src/constants/stripeNotificationTemplates.ts           (Phase 11; 7+ types)
mingla-business/src/constants/stripeSupportedCountries.ts              (Phase 11; 34-country list with metadata)
mingla-business/src/utils/__tests__/* (~20 jest test files for services/hooks/utils)
.github/workflows/stripe-connect-smoke.yml                              (Phase 12; ported from Tao)
.github/workflows/supabase-migrations-and-stripe-deno.yml               (Phase 12; ported from Tao)
.github/scripts/strict-grep/i-proposed-t-stripe-country-allowlist.mjs   (Phase 12; new gate)
.github/scripts/strict-grep/i-proposed-u-mingla-tos-gate.mjs            (Phase 12; new gate)
.github/scripts/strict-grep/i-proposed-v-stripe-notification-via-shared.mjs (Phase 12; new gate)
docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md                     (Phase 13; D-V3-9)
docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md                                (Phase 13; D-V3-4)
docs/runbooks/B2_GO_LIVE_CHECKLIST.md                                   (Phase 14; per Stripe Go Live + Mingla operational gates)
```

### MODIFY (V3 changes existing files)

```
supabase/functions/_shared/idempotency.ts          (D-V3-13 nanosecond precision; extend StripeOperation union)
supabase/functions/brand-stripe-onboard/index.ts   (V2 reactivation; V3 country param; KYC remediation lookup)
supabase/functions/stripe-webhook/index.ts         (V2 retry-on-failure; V3 router delegation; IP allowlist; dual-secret; 14 event handlers)
supabase/functions/brand-stripe-refresh-status/index.ts (V3 surface external_accounts state; deadline tracking)
mingla-business/src/components/brand/BrandOnboardView.tsx (multi-country picker; KYC remediation card; deadline banner)
mingla-business/src/components/brand/BrandPaymentsView.tsx (multi-currency display; bank verification section; orphaned refunds section)
Mingla_Artifacts/INVARIANT_REGISTRY.md             (add I-PROPOSED-T/U/V; flip O/P/Q/R/S to ACTIVE on V3 CLOSE)
Mingla_Artifacts/DECISION_LOG.md                   (DEC-121/122/123 + D-B2-24..30 + D-V2-1..8 + D-V3-1..18 entries)
clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md  (V3 supersession note)
outputs/SPEC_B2_PATH_C_AMENDMENT.md                (mark SUPERSEDED by V3)
outputs/SPEC_B2_PATH_C_V2.md                       (mark SUPERSEDED by V3)
```

### DROP (defensive — Tao files; should not be present in working tree)

```
(no files actually present to drop)
```

---

## §5 — Invariants

### Carried from V2 (no change)

- I-PROPOSED-O — Stripe Connect Embedded Components via official SDK only (DRAFT → ACTIVE on V3 CLOSE)
- I-PROPOSED-P — `stripe_connect_accounts` canonical; `brands.stripe_*` mirror via DB trigger only (DRAFT → ACTIVE)
- I-PROPOSED-Q — Stripe API version pinned via `_shared/stripe.ts` only (DRAFT → ACTIVE)
- I-PROPOSED-R — Idempotency-Key on every Stripe API call (DRAFT → ACTIVE)
- I-PROPOSED-S — Audit log on every Stripe edge fn (DRAFT → ACTIVE)

### V3 NEW invariants (DRAFT → ACTIVE on V3 CLOSE)

#### I-PROPOSED-T — Stripe country code from canonical allowlist only

**Statement:** Every `country` value passed to `stripe.accounts.create()` MUST be from the canonical allowlist defined in `mingla-business/src/constants/stripeSupportedCountries.ts`. Edge function MUST validate against this list. CHECK constraint on `stripe_connect_accounts.country` enforces at DB level.

**Why:** Stripe self-serve cross-border payouts only work to US/UK/EEA/CA/CH per [Stripe docs](https://docs.stripe.com/connect/cross-border-payouts). Accepting an out-of-list country produces account creation that can't actually pay out.

**Enforcement:** CI gate `i-proposed-t-stripe-country-allowlist.mjs` scans `mingla-business/` + `supabase/functions/` for hardcoded country code literals; flags any not in the allowlist. CHECK constraint on `stripe_connect_accounts.country` enforces at DB level.

#### I-PROPOSED-U — Mingla Business ToS acceptance gate

**Statement:** Every brand admin MUST have `brand_team_members.mingla_tos_accepted_at IS NOT NULL` before any Stripe Connect operation can proceed for their brand. Edge function MUST check this gate; returns 403 if not accepted.

**Why:** Connect Platform Agreement requires platform-level ToS acceptance separate from Stripe's own ToS (handled by Embedded Components). This gate enforces Mingla's compliance posture.

**Enforcement:** CI gate `i-proposed-u-mingla-tos-gate.mjs` scans `supabase/functions/{brand-stripe-*,stripe-*}/` for direct `accounts.create` / `accountSessions.create` calls and verifies the function checks `mingla_tos_accepted_at` before the Stripe API call.

#### I-PROPOSED-V — Stripe notifications via shared dispatcher

**Statement:** Every Stripe-triggered user notification MUST go through `supabase/functions/notify-dispatch/index.ts` using a `type` value from the `STRIPE_NOTIFICATION_TYPES` constants. Direct `sendPush` or `sendEmail` calls from Stripe edge functions are FORBIDDEN.

**Why:** Centralized notification dispatch ensures consistent multi-channel delivery (email + push + in-app), respects user preferences, and provides a single surface for analytics/quiet-hours/unsubscribe flows.

**Enforcement:** CI gate `i-proposed-v-stripe-notification-via-shared.mjs` scans Stripe edge functions for direct calls to `sendPush`, `sendEmail`, or Resend API; flags as violation unless wrapped via notify-dispatch.

---

## §6 — Behavioral contracts (per surface, abbreviated)

[Full per-file behavioral contracts in V2 SPEC §6 carry forward. V3 additions:]

### `_shared/stripeWebhookRouter.ts` (V2 carry-forward; V3 expanded)

V3 handles **14 event types** (V2 had 7). Per-event behavior:

| Event | Update target | Side effects |
|---|---|---|
| account.updated | `stripe_connect_accounts` | Clear `kyc_stall_reminder_sent_at` if `charges_enabled` flipped true; trigger mirrors `brands.stripe_*`; check `current_deadline` for warning eligibility |
| account.application.deauthorized | `stripe_connect_accounts.detached_at = now()` | Trigger clears `brands.stripe_*`; notify brand admin via notify-dispatch |
| account.requirements.updated | `stripe_connect_accounts.requirements` JSONB | Recompute KYC remediation messaging; update deadline warning state |
| account.external_account.created | INSERT into `stripe_external_accounts` | Audit row |
| account.external_account.updated | UPDATE `stripe_external_accounts` | If verification_failed, notify brand admin |
| account.external_account.deleted | DELETE from `stripe_external_accounts` | Warn admin if no remaining external account |
| capability.updated | `stripe_connect_accounts.requirements` JSONB | Audit row |
| payout.created | UPSERT `payouts` | Audit row |
| payout.paid | UPDATE `payouts` (status='paid') | Audit row |
| payout.failed | UPDATE `payouts` (status='failed') | **Notify brand admin** via notify-dispatch (`type='stripe.payout_failed'`) with `failure_code` mapped to remediation copy |
| payout.canceled | UPDATE `payouts` (status='canceled') | Audit row |
| charge.refund.updated | If detached account: audit_log entry with `target_type='detached_refund'` | Surface in BrandPaymentsView orphaned refunds |
| application_fee.created | INSERT `mingla_revenue_log` | Audit row |
| application_fee.refunded | UPDATE `mingla_revenue_log` | Reverse revenue row |

### `_shared/stripeIpAllowlist.ts` (V3 NEW)

Exports `verifyStripeSourceIp(req: Request): boolean`. Stripe IP ranges hardcoded; updated via maintenance migration when Stripe rotates. Soft-fail per D-V3-16.

### `brand-stripe-onboard/index.ts` (V3 MODIFIED for multi-country)

New required body field: `country` (ISO 3166-1 alpha-2; validated against I-PROPOSED-T allowlist). New validation: `mingla_tos_accepted_at IS NOT NULL` per I-PROPOSED-U.

V2 reactivation flow + V3 KYC remediation lookup on response.

### `notify-dispatch` extension

7+ new Stripe notification types:
- `stripe.deadline_warning_7d`
- `stripe.deadline_warning_3d`
- `stripe.deadline_warning_1d`
- `stripe.bank_verification_failed`
- `stripe.payout_failed`
- `stripe.account_deauthorized`
- `stripe.kyc_stall_reminder`
- `stripe.account_restricted`
- `stripe.reactivation_complete`

Each has email + push + in-app templates in `mingla-business/src/constants/stripeNotificationTemplates.ts`.

### Frontend additions

- `BrandStripeCountryPicker` — 34-country dropdown with currency hint per country
- `BrandStripeBankSection` — bank account display + verification status + re-verify CTA
- `BrandStripeOrphanedRefundsSection` — read-only history for detached brands
- `BrandStripeDeadlineBanner` — "Action needed by [date]" warning with CTA
- `BrandStripeKycRemediationCard` — specific copy per Stripe disabled_reason / currently_due
- `MinglaToSAcceptanceGate` — pre-onboarding gate

---

## §7 — Implementation phasing (revised)

**Phase 0 — COMPLETE** (commits `cf3969bf` + `cfb121e8`)

**Phase 0' — Trigger detach fix + revoke anon (V2 carry-forward, MUST run before V3 work)**
- Migration 20260510000001 (trigger detach cascade)
- Migration 20260510000002 (revoke anon GRANT)
- INVARIANT_REGISTRY sampling note update
- DECISION_LOG D-V3-1..18 + D-V2-1..8 + DEC-121/122/123 + D-B2-24..30 entries
- Doc fix: header RPC name in onboard + refresh-status

**Phase 0'' — RAK migration (operator-side runbook + env config; isolated)**
- Create 6 RAKs in Stripe test mode → verify scope sufficiency → create live RAKs
- Update Supabase env vars per fn (`STRIPE_RAK_<purpose>`)
- Update each fn's `_shared/stripe.ts` import to use fn-specific RAK
- Rotate full secret key out

**Phase 0''' — Multi-country + V3 schema foundation**
- Migrations 20260511000001-20260511000008 (8 migrations)
- Country specs reference table seeded
- `notifications` + `notification_preferences` tables created
- `gdpr_erasure_log` + `anonymize_user_audit_log` SQL fn

**Phase 1 — Webhook router + IP allowlist + signature dual-secret**
- `_shared/stripeWebhookRouter.ts` (14 event types)
- `_shared/stripeIpAllowlist.ts`
- `stripe-webhook/index.ts` modified (delegation + dual-secret + retry-on-failure + IP allowlist)
- Deno tests for router + signature + IP allowlist

**Phase 2 — `brand-stripe-detach/`** (V2 carry-forward)

**Phase 3 — `brand-stripe-balances/`** (V2 carry-forward + V3 multi-currency)

**Phase 4 — `stripe-kyc-stall-reminder/` extended for deadline warnings** (V2 carry-forward + V3 expansion)

**Phase 5 — `stripe-webhook-health-check/`** (V3 NEW)

**Phase 6 — Notification subsystem extension** (notify-dispatch types + templates)

**Phase 7 — Country picker UI + onboard country param**

**Phase 8 — Multi-currency balance UI**

**Phase 9 — Bank verification UI + external_account events**

**Phase 10 — KYC remediation messaging UI**

**Phase 11 — Deadline warning UI + cron**

**Phase 12 — Detached refund visibility + orphaned refunds UI**

**Phase 13 — Mingla ToS acceptance gate**

**Phase 14 — CI: V3 strict-grep gates T/U/V + smoke + migrations-and-Deno**

**Phase 15 — Cleanup + verification**
- All 8 strict-grep gates: 0 violations
- `npx tsc --noEmit`: exit 0
- `npx jest`: all pass
- `deno test`: all pass
- `supabase db reset`: all 11 migrations apply cleanly
- No orphan imports, no Co-Authored-By, no stale doc references

**Phase 16 — Operator smoke** (sandbox; multi-country happy paths; deadline warning; bank verification fail; payout failure)

**Phase 17 — Tester dispatch** (verify all 84 SCs + all 8 invariants)

**Phase 18 — Operator CLOSE** (DEC-121 lock + I-PROPOSED-O/P/Q/R/S/T/U/V flip ACTIVE + 7-artifact SYNC + EAS OTA dual-platform per `feedback_eas_update_no_web`)

**Estimated total effort: 25-40 implementor hours** (split across multiple sessions recommended).

---

## §8 — Migration ordering

| Order | File |
|---|---|
| 1 | 20260508000000_b2a_stripe_connect_onboarding.sql (Phase 0) |
| 2 | 20260509000001_b2_payouts_stripe_id_unique.sql (Phase 0) |
| 3 | 20260509000002_b2_kyc_stall_reminder_column.sql (Phase 0) |
| 4 | 20260510000001_b2a_path_c_trigger_detach_cascade.sql (Phase 0') |
| 5 | 20260510000002_b2a_path_c_revoke_anon_status_grant.sql (Phase 0') |
| 6 | 20260511000001_b2a_v3_country_support.sql (Phase 0''') |
| 7 | 20260511000002_b2a_v3_external_accounts.sql (Phase 0''') |
| 8 | 20260511000003_b2a_v3_notifications.sql (Phase 0''') |
| 9 | 20260511000004_b2a_v3_gdpr_erasure.sql (Phase 0''') |
| 10 | 20260511000005_b2a_v3_tos_acceptance.sql (Phase 0''') |
| 11 | 20260511000006_b2a_v3_account_type_rename.sql (Phase 0''') |
| 12 | 20260511000007_b2a_v3_webhook_retry_count.sql (Phase 0''') |

---

## §9 — Test plan summary

**Total estimated SCs: 84.** Detailed per-SC mapping deferred to IMPL dispatch authoring per orchestrator standard.

**Unit tests** (~40 jest files): every new service + hook + util + constants helper

**Deno tests** (~6 files): webhook router + signature + IP allowlist + KYC remediation + GDPR erasure SQL fn + retry behavior

**Integration tests** (~15 cases): multi-country onboarding (1 per Tier 1 country); reactivation; deadline warning trigger; bank verification fail; payout failure; orphaned refund; ToS gate; webhook silence detection

**E2E smoke** (~5 happy paths): UK happy; US happy; deadline warning fires; bank verification fail surfaces; reactivation succeeds

**Constitutional compliance test suite** (~14 tests; one per principle)

---

## §10 — Discoveries to disposition at CLOSE

V1+V2+V3 carry-forward + V3-specific:

| ID | Description | Disposition |
|---|---|---|
| D-CYCLE-B2-PATHC-1..8 (V1) | Process discoveries (parallel implementation, etc.) | CLOSED at V3 |
| D-CYCLE-B2-PATHC-V2-1..9 | V2 SPEC corrections + deferred items | ALL FOLDED INTO V3 |
| D-CYCLE-B2-PATHC-V3-1 | Stripe self-serve constraint (US/UK/EEA/CA/CH) — operator's "as many as possible" capped at 34 | CLOSED at V3 |
| D-CYCLE-B2-PATHC-V3-2 | AU + LatAm + Asia require separate platform entities — flag for founder business decision | DEFER to B2d (post-V3) |
| D-CYCLE-B2-PATHC-V3-3 | Per-country `country_specs` API probe — needed at Phase 0''' to seed reference table | OPERATOR ACTION at Phase 0''' |
| D-CYCLE-B2-PATHC-V3-4 | Mingla Business ToS legal review — Connect Platform Agreement disclosure requirements | LEGAL_REVIEW_NEEDED pre-launch |
| D-CYCLE-B2-PATHC-V3-5 | Audit log retention growth = storage cost; flag for ops monitoring | OPS MONITORING task |

---

## §11 — Risk register (V3)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration order conflict | Low | Medium | Phase 15 includes `supabase db reset` validation |
| Stripe rate-limit on multi-country probe | Medium | Low | Phase 0''' probe is one-time setup; cache results |
| RAK insufficient scope discovered post-deploy | Medium | Low | Phase 0'' verification step; rollback to full key if needed |
| Notification subsystem extension breaks existing notify flows | Low | High | Per-type isolation; existing flows unaffected |
| GDPR erasure pattern mis-anonymizes audit history | Low | High | Phase 0''' migration includes anonymize fn unit tests; legal review pre-launch |
| Multi-country onboarding fails for specific country (e.g., Iceland API quirk) | Medium | Medium | Phase 16 smoke covers Tier 1 happy paths; Tier 2 covered at tester dispatch |
| Webhook IP allowlist false-rejects valid Stripe traffic | Low | High | D-V3-16 SOFT-FAIL pattern; signature is primary defense |
| ToS acceptance gate breaks brand admin onboarding flow | Low | High | Phase 13 includes gate-bypass for existing brands (grandfather clause) |
| Stripe API version `2026-04-30.preview` GA migration | Medium (in 6-12 mo) | Medium | V3 risk register tracks; migration runbook deferred to post-GA |
| Connect Platform Agreement T&Cs disclosure non-compliance | Medium | High | Legal review pre-launch (out of forensics scope) |

---

## §12 — Confidence statement

| Section | Confidence | Why |
|---|---|---|
| §2 V2+V3 locked decisions | M-H | Defaults grounded in Stripe docs; operator may override D-V3-1..18 |
| §3 scope | H | 34-country list verified; 84 SC estimate |
| §4 file manifest | H | ~30 new files mapped |
| §5 invariants | H | New T/U/V have clear enforcement |
| §6 behavioral contracts | M-H | Abbreviated; full per-file contracts in implementor dispatch |
| §7 phasing | H | 18 phases covering all V3 scope |
| §8 migration order | H | Verified clean from baseline + Phase 0 + Phase 0' + Phase 0''' |
| §9 test plan | M | SC count is estimate; final list at IMPL dispatch |
| §11 risk register | M-H | Operational risks identified; legal review for T&Cs |

---

**End of SPEC v3 base content.**

For implementor dispatch instructions, see `outputs/IMPL_DISPATCH_B2_PATH_C_V3.md` (to be authored post-V3 lock by orchestrator).

For background, see [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md).

---

## §13 — Amendments (post-Phase-0'' + Sub-dispatch B discoveries)

**Authored:** 2026-05-07 by orchestrator after Sub-dispatch B IMPL REVIEW.
**Status:** ACTIVE amendments to the SPEC base. Apply as binding contracts. To be inlined into the appropriate base sections at V3 CLOSE.

### Amendment A1 — `STRIPE_WEBHOOK_SECRET_PLATFORM` env var (binds §3 + §6)

Connect platforms require **two distinct webhook endpoints**, one per account context: connected-account events ("Connect" endpoint) and platform-account events ("Your account" endpoint). Each endpoint has its own Stripe-issued signing secret. The webhook handler MUST verify against both, plus a rotation fallback.

**Required env vars** (3 total — supersedes the earlier 2-var pattern):

| Env var | Purpose |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | Connect endpoint signing secret (primary) — events from connected accounts (14 events: account.*, payout.*, capability.updated, charge.refund.updated, person.*) |
| `STRIPE_WEBHOOK_SECRET_PLATFORM` | Platform endpoint signing secret — events from your platform account (2 events: application_fee.created, application_fee.refunded) |
| `STRIPE_WEBHOOK_SECRET_PREVIOUS` | Previous Connect signing secret during rotation (set to empty string when not rotating) |

**Implementation:** `supabase/functions/_shared/stripeWebhookSignature.ts:20-22` reads all three; `verifyStripeWebhookSignature` iterates and returns the first secret that successfully verifies.

### Amendment A2 — Platform account ID is `acct_1TTnt1PjlZyAYA40` (test mode); production TBD

Sub-dispatch A SPEC referenced `acct_1TU23tIAdZKekynz` (original sandbox), but Connect platform activation provisioned cleanly only on `acct_1TTnt1PjlZyAYA40` (MINGLA LLC sandbox). All Phase 0'' RAKs, webhook endpoints, and signing secrets are now bound to the new account. The production account ID will be established at go-live (out of V3 scope).

**No code hardcoding:** account ID is purely env-driven (verified — zero hits in `supabase/functions/`).

### Amendment A3 — `account.requirements.updated` is NOT a real Stripe event

The original SPEC §6 listed `account.requirements.updated` as a webhook event to subscribe to. **This event does not exist in Stripe's event catalog.** Stripe's `accounts.create` API rejects subscription requests that include it. Requirement changes are propagated via the `account.updated` event payload (the `requirements` field in the account object).

**Implementation:** `supabase/functions/_shared/stripeWebhookRouter.ts` `STRIPE_ROUTED_EVENT_TYPES` does NOT include this event. The router derives requirement changes from `account.updated` payload deltas. Test asserts the exclusion (`stripeWebhookRouter.test.ts:100`).

### Amendment A4 — 16 webhook events total (14 Connect + 2 Platform), not 14

Original SPEC §6 named 14 events but didn't split by account context. Correct split:

**Connect endpoint (14 events):**
- `account.updated`, `account.application.deauthorized`
- `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`
- `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`
- `capability.updated`
- `charge.refund.updated`
- `person.created`, `person.updated`, `person.deleted`

**Platform endpoint (2 events):**
- `application_fee.created`
- `application_fee.refunded`

### Amendment A5 — `mingla_revenue_log` table is part of Sub-dispatch B scope (new file in §4)

**File added to §4 manifest:** `supabase/migrations/20260512000001_b2a_v3_mingla_revenue_log.sql`

**Why:** Webhook router's `application_fee.created` and `application_fee.refunded` handlers (per §6) need a queryable destination to persist Mingla platform revenue rows. Without this table, those events get persisted only to `payment_webhook_events` (durable queue) but never reconciled into a structured revenue surface, defeating the purpose of subscribing to the Platform endpoint.

**Schema (per migration file):**

```sql
CREATE TABLE public.mingla_revenue_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_application_fee_id text NOT NULL UNIQUE,
  stripe_account_id text NULL,
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'GBP',
  refunded_amount_cents integer NOT NULL DEFAULT 0,
  refunded boolean NOT NULL DEFAULT false,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mingla_revenue_log_brand_id ON ...
CREATE INDEX idx_mingla_revenue_log_stripe_account_id ON ...
```

**Origin:** Discovered during Sub-dispatch B IMPL REVIEW (2026-05-07). Written by prior implementor session but not disclosed in IMPL report. Orchestrator accepted at REVIEW per "functionally necessary for §6 webhook contracts to be meaningful" rationale.

**Open follow-up at CLOSE:** add an RLS policy + service-role-only INSERT contract to this table; current migration has no RLS. Track as **C-13** in §10 discoveries.

### Amendment summary table

| Amendment | Section impacted | Type | Origin |
|---|---|---|---|
| A1 — `STRIPE_WEBHOOK_SECRET_PLATFORM` | §3, §6 | New env var | Phase 0'' Connect setup |
| A2 — Platform account = `acct_1TTnt1PjlZyAYA40` | §3 | Account migration | Phase 0'' Connect activation gating |
| A3 — `account.requirements.updated` is fictional | §6 | Event removal | Phase 0'' Stripe API rejection |
| A4 — 16 events, split 14+2 | §6 | Event list correction | Phase 0'' Connect endpoint config |
| A5 — `mingla_revenue_log` table | §4 (file manifest) | New file | Sub-dispatch B IMPL REVIEW discovery |

At V3 CLOSE, these amendments are inlined into §3, §4, §6 base text and this §13 appendix is collapsed into a one-paragraph "Amendment history" block.
