# Implementor Dispatch — B2a Path C V3 (battle-tested; multi-country full B2 cycle)

**Skill to invoke:** `/mingla-implementor`
**Spec:** [outputs/SPEC_B2_PATH_C_V3.md](SPEC_B2_PATH_C_V3.md) — binding contract
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md) — evidence
**Supersedes:** `outputs/IMPL_DISPATCH_B2_PATH_C.md` (V1) + `outputs/IMPL_DISPATCH_B2_PATH_C_V2.md` (V2 — was authored but not dispatched; SPEC V3 supersedes V2 SPEC)
**Branch:** `Seth` (current; HEAD `cfb121e8`)
**Reference branch (read-only):** `feat/b2-stripe-connect` worktree at `/tmp/mingla-b2-comparison/tao-b2/` — do NOT cherry-pick; rewrite per Seth's patterns
**Estimated total effort:** 25-40 implementor hours
**Recommended dispatch shape:** 3 sub-dispatches (A, B, C) — operator runs sequentially in fresh sessions for clean context

---

## §0 — Pipeline status snapshot

**Already complete:**
- Phase 0 (commits `cf3969bf` + `cfb121e8`): 5 strict-grep gates O/P/Q/R/S; migrations `20260509000001` + `20260509000002`; INVARIANT_REGISTRY append; B2a refresh-status audit-log gap fix

**Ahead (this dispatch):**
- Phase 0' (Sub-dispatch A) — V2 carry-forward: trigger detach fix + revoke anon GRANT + DECISION_LOG entries
- Phase 0'' (Sub-dispatch A) — RAK migration (operator runbook + env config; no code)
- Phase 0''' (Sub-dispatch A) — V3 schema foundation: 8 migrations (multi-country, external_accounts, notifications, GDPR, ToS, account_type rename, retry_count, dual-secret config)
- Phase 1 (Sub-dispatch B) — Webhook router + IP allowlist + dual-secret + 14 event handlers
- Phase 2-4 (Sub-dispatch B) — `brand-stripe-detach`, `brand-stripe-balances`, `stripe-kyc-stall-reminder` (extended for deadline warnings)
- Phase 5-6 (Sub-dispatch B) — `stripe-webhook-health-check` + payout failure notify integration
- Phase 7 (Sub-dispatch B) — Country picker UI + onboard country param
- Phase 8-12 (Sub-dispatch C) — Frontend: multi-currency UI + bank verification + KYC remediation cards + deadline banners + orphaned refunds + ToS gate
- Phase 13 (Sub-dispatch C) — Notification subsystem extension (notify-dispatch + templates + 3 new tables)
- Phase 14 (Sub-dispatch C) — CI: 3 new strict-grep gates T/U/V + smoke + migrations-and-Deno workflows
- Phase 15 (Sub-dispatch C) — Final cleanup + verification

**Operator-side (post-implementor):**
- Phase 16: smoke (sandbox; multi-country happy paths)
- Phase 17: `/mingla-tester` dispatch
- Phase 18: CLOSE protocol (DEC-121 lock + 8 invariants ACTIVE + 7-artifact SYNC + EAS OTA dual-platform)

---

## §1 — Pre-flight operator actions (BEFORE Sub-dispatch A)

These are operator-side; implementor doesn't run them. **Required before Phase 0'' RAK migration.**

### 1a — Probe Stripe `country_specs` API (Phase 0''' seed data)

For each of the 34 supported countries (US, GB, CA, CH + 30 EEA), fetch `GET /v1/country_specs/{country}` and save responses. The implementor will use these to seed the `stripe_country_specs` reference table.

**Quick approach:** operator runs a one-off Node.js script (or via Stripe CLI) that hits all 34 country specs in test mode and writes JSON to `supabase/seed/stripe_country_specs.json`. Implementor's Phase 0''' migration reads this seed.

**If you don't want to do this manually:** Phase 0''' migration can include a deferred operator-action note: "After migration applies, run `supabase functions invoke seed-stripe-country-specs` to populate the table." Either way works.

### 1b — Stripe Dashboard webhook endpoint config

Per [SPEC v3 §3 webhook events list](SPEC_B2_PATH_C_V3.md), update your Stripe sandbox webhook endpoint to subscribe to all **14 event types** (V2 had 7; V3 adds 7 more). The new ones to add:

- `account.external_account.created`
- `account.external_account.updated`
- `account.external_account.deleted`
- `account.requirements.updated`
- `charge.refund.updated`
- `person.created` / `person.updated` / `person.deleted` (3 events)
- `application_fee.created` / `application_fee.refunded` (2 events)

### 1c — Confirm publishable key still valid

`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` already set per V2 handoff. No change needed for V3.

### 1d — Legal review hold

D-V3-17 (Mingla Business ToS acceptance gate) ships in Sub-dispatch C Phase 12. **Before live launch**, legal team must review the ToS copy. This does NOT block implementor work — Phase 12 ships the gate mechanism with placeholder copy; operator/legal swap final copy pre-launch.

---

## §2 — Hard constraints (apply to ALL three sub-dispatches)

Non-negotiable. Each is enforced by either an invariant CI gate or a behavioral contract.

1. **Stripe SDK ALWAYS imports from `_shared/stripe.ts`** (I-PROPOSED-Q). API version pinned to `2026-04-30.preview`.
2. **Idempotency-Key on every Stripe call** (I-PROPOSED-R). Format: `{brand_id}:{operation}:{epoch_ns}` per D-V3-13 nanosecond precision.
3. **`writeAudit` import + call in every Stripe edge function** (I-PROPOSED-S).
4. **NEVER write directly to `brands.stripe_*`** (I-PROPOSED-P). Trigger handles cache; updated in Phase 0' migration to handle detach cascade per D-V3-5.
5. **Frontend Stripe SDK only via `@stripe/connect-js`** rendered on Mingla-hosted page, opened via `expo-web-browser.openAuthSessionAsync` (I-PROPOSED-O).
6. **Country code from canonical allowlist only** (I-PROPOSED-T NEW). 34 countries per D-V3-1.
7. **`mingla_tos_accepted_at` checked before any Stripe Connect operation** (I-PROPOSED-U NEW).
8. **Stripe-triggered notifications via shared `notify-dispatch`** (I-PROPOSED-V NEW). No direct `sendPush`/Resend in Stripe edge fns.
9. **Webhook handler returns HTTP 200 to Stripe** for ALL signature-verified events; retry-on-failure logic in code, max 5 attempts (D-V2-3 + D-V3-5).
10. **Soft-delete on detach** (D-B2-29): `UPDATE detached_at = now()`, never `DELETE FROM`.
11. **GDPR erasure = anonymization, not deletion** (D-V3-4): hash user_id, redact PII fields, KEEP audit_log rows.
12. **No `Co-Authored-By:` in commits** (`feedback_no_coauthored_by`).
13. **Reuse existing notification infrastructure** (`notify-dispatch` + `push-utils.ts` + Resend; D-V3-2). Don't rebuild.
14. **No cherry-picking from Tao's branch.** Read-only reference at `/tmp/mingla-b2-comparison/tao-b2/`. Rewrite every backported function per Seth's patterns.

---

## §3 — SUB-DISPATCH A: Foundation (Phase 0' + 0'' + 0''')

**Estimated effort:** 4-6 hours
**Single dispatch context. Operator runs `/mingla-implementor` with the prompt below.**

```
DISPATCH PROMPT (copy-paste):

Execute B2a Path C V3 Sub-dispatch A — foundation work.

READ THESE FILES IN ORDER (mandatory pre-flight):
1. outputs/SPEC_B2_PATH_C_V3.md (binding contract)
2. Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md (forensics evidence)
3. outputs/IMPL_DISPATCH_B2_PATH_C_V3.md §2 (hard constraints) + §3 (this section)
4. supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql (existing trigger to be replaced)
5. supabase/functions/_shared/{stripe,idempotency,audit}.ts (existing patterns)
6. Mingla_Artifacts/INVARIANT_REGISTRY.md lines 2069+ (Stripe invariants O/P/Q/R/S)
7. Mingla_Artifacts/DECISION_LOG.md head + last 100 lines (latest DEC numbers)

DELIVERABLES (Phase 0' + 0'' + 0'''):

Phase 0' — V2 carry-forward (trigger fix + revoke anon GRANT):
- supabase/migrations/20260510000001_b2a_path_c_trigger_detach_cascade.sql
  Per SPEC v3 §6 D-V3-5 — replaces tg_sync_brand_stripe_cache trigger function with CASE WHEN NEW.detached_at IS NOT NULL → NULL/false ELSE live values. Adds payment_webhook_events.retry_count column. EXACT SQL provided in V2 SPEC §6.
- supabase/migrations/20260510000002_b2a_path_c_revoke_anon_status_grant.sql
  REVOKE EXECUTE ON FUNCTION pg_derive_brand_stripe_status FROM anon (D-V3-6 / V2 D-V2-6).

Phase 0'' — RAK migration runbook (no code; documentation only):
- docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md
  Step-by-step for operator to: create 6 RAKs in Stripe test mode → verify scopes → create live RAKs → swap env vars per fn → rotate full secret out.
  Include scope-per-fn table from SPEC v3 §6.

Phase 0''' — V3 schema foundation (8 migrations):
- supabase/migrations/20260511000001_b2a_v3_country_support.sql
  Adds stripe_connect_accounts.country (CHAR(2)) + default_currency (CHAR(3)). Adds stripe_country_specs reference table (country_code PK, default_currency, supported_currencies JSONB, bank_format TEXT, business_types JSONB, kyc_form TEXT). CHECK constraint on stripe_connect_accounts.country IN canonical allowlist (34 countries). Backfill existing rows: country='GB', default_currency='GBP'.
- supabase/migrations/20260511000002_b2a_v3_external_accounts.sql
  Per D-V3-6 — separate table stripe_external_accounts (id PK, stripe_account_id FK, stripe_external_account_id UNIQUE, type 'bank_account'|'card', last4, currency, country, status 'verified'|'verification_pending'|'verification_failed'|'errored', default_for_currency BOOL, raw_payload JSONB, created_at, updated_at). RLS: service_role write only; payments_manager read on own brand.
- supabase/migrations/20260511000003_b2a_v3_notifications.sql
  Tables: notifications (id, user_id, brand_id, channel 'email'|'push'|'in_app', type, title, body, deep_link, read_at, created_at) + notification_preferences (user_id, channel, type, opt_in, updated_at). RLS: user reads own.
- supabase/migrations/20260511000004_b2a_v3_gdpr_erasure.sql
  Table gdpr_erasure_log (id, original_user_id, hashed_user_id, erasure_initiated_at, erasure_completed_at, dpo_user_id, scope JSONB) + SQL function anonymize_user_audit_log(p_user_id UUID, p_salt TEXT) SECURITY DEFINER service_role only. RLS: service_role + DPO role read.
- supabase/migrations/20260511000005_b2a_v3_tos_acceptance.sql
  ALTER TABLE brand_team_members ADD COLUMN mingla_tos_accepted_at TIMESTAMPTZ NULL + mingla_tos_version_accepted TEXT NULL.
- supabase/migrations/20260511000006_b2a_v3_account_type_rename.sql
  ALTER TABLE stripe_connect_accounts RENAME COLUMN account_type TO controller_dashboard_type. Update column COMMENT.
- supabase/migrations/20260511000007_b2a_v3_webhook_retry_count.sql
  (No-op if 20260510000001 already added retry_count; otherwise: ALTER TABLE payment_webhook_events ADD COLUMN retry_count INT NOT NULL DEFAULT 0 + retries_exhausted BOOLEAN NOT NULL DEFAULT false.)
- supabase/migrations/20260511000008_b2a_v3_payments_webhook_secrets.sql
  No schema change — placeholder migration with COMMENT documenting that STRIPE_WEBHOOK_SECRET + STRIPE_WEBHOOK_SECRET_PREVIOUS env vars are used for dual-secret rotation per D-V3-9.

Plus DECISION_LOG.md update — append entries for DEC-121, DEC-122, DEC-123, D-B2-24..30, D-V2-1..8, D-V3-1..18 (use the running-header pattern; one big paragraph at top + per-DEC entries below).

Plus INVARIANT_REGISTRY.md update — pre-write I-PROPOSED-T (country allowlist), I-PROPOSED-U (Mingla ToS gate), I-PROPOSED-V (notification dispatcher discipline) as DRAFT entries; flips ACTIVE on V3 CLOSE.

Plus mark V1 + V2 SPECs SUPERSEDED if not already (already done at SPEC v3 lock).

Plus header-doc fix in onboard + refresh-status: line 13 reference to RPC name should match actual call (`_for_brand` not `_for_caller`) per D-V2-5.

VERIFICATION (run after each phase):
- supabase db reset (verify all 11 migrations apply cleanly)
- npx tsc --noEmit (mingla-business — exit 0)
- All 5 existing strict-grep gates O/P/Q/R/S report 0 violations
- INVARIANT_REGISTRY.md grep finds 8 invariant entries (O/P/Q/R/S/T/U/V) at expected line ranges
- DECISION_LOG.md grep finds DEC-121, DEC-122, DEC-123 entries (latest); D-V3-* entries

OUTPUT: Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_REPORT.md (Sub-dispatch A section).
Per feedback_no_summary_paragraph: report = artifact, no narrative.

DO NOT:
- Touch any frontend code (Sub-dispatch C scope)
- Author new edge functions (Sub-dispatch B scope)
- Cherry-pick from Tao's branch
- Skip verification steps
- Use Co-Authored-By in commits

SUGGESTED COMMIT MESSAGE (after Phase 0' + 0' + 0''' complete):
"feat(business): B2a Path C V3 Sub-dispatch A — foundation (trigger fix + 8 V3 migrations + RAK runbook + DECISION_LOG)"

Begin Phase 0' now.
```

---

## §4 — SUB-DISPATCH B: Backend implementation (Phase 1-7)

**Estimated effort:** 12-18 hours
**Pre-requisite:** Sub-dispatch A landed + RAK migration completed by operator (Phase 0'' env vars in place).

```
DISPATCH PROMPT (copy-paste):

Execute B2a Path C V3 Sub-dispatch B — backend implementation.

PRE-REQUISITE: Sub-dispatch A committed + operator's Phase 0'' RAK migration done (6 RAKs created, env vars per fn set).

READ THESE FILES (mandatory pre-flight):
1. outputs/SPEC_B2_PATH_C_V3.md (full SPEC; especially §6 behavioral contracts)
2. outputs/IMPL_DISPATCH_B2_PATH_C_V3.md §2 + §4
3. supabase/functions/brand-stripe-onboard/index.ts (existing pattern; modify per V3 multi-country)
4. supabase/functions/stripe-webhook/index.ts (existing pattern; rewrite per V3 router delegation)
5. supabase/functions/brand-stripe-refresh-status/index.ts (existing; minor V3 modifications)
6. supabase/functions/notify-dispatch/index.ts (existing dispatcher; extend for Stripe types)
7. supabase/functions/_shared/push-utils.ts (existing OneSignal integration)
8. supabase/functions/_shared/{stripe,idempotency,audit}.ts (existing patterns)
9. /tmp/mingla-b2-comparison/tao-b2/supabase/functions/_shared/stripeConnectWebhookProcess.ts (REFERENCE ONLY — rewrite per Seth's patterns; do not copy)
10. /tmp/mingla-b2-comparison/tao-b2/supabase/functions/{brand-stripe-detach,brand-stripe-balances,stripe-kyc-stall-reminder}/index.ts (REFERENCE ONLY)

DELIVERABLES:

Phase 1 — Webhook router + IP allowlist + dual-secret + retry-on-failure:
- supabase/functions/_shared/stripeWebhookRouter.ts (NEW; 14 event types per SPEC v3 §6 table)
- supabase/functions/_shared/stripeIpAllowlist.ts (NEW; verifyStripeSourceIp; soft-fail per D-V3-16)
- supabase/functions/_shared/stripeKycRemediation.ts (NEW; server-side mapping helper for currently_due field names + disabled_reason codes; 30+ codes from investigation Thread 18)
- Modify supabase/functions/stripe-webhook/index.ts:
  - Replace replay-skip-all logic with retry-when-processed=false (max 5 per D-V3-5)
  - Delegate event processing to routeStripeEvent()
  - Dual-secret signature verification: try STRIPE_WEBHOOK_SECRET first; on fail, retry with STRIPE_WEBHOOK_SECRET_PREVIOUS if set; if neither, 400
  - IP allowlist check after signature (soft-fail; log + audit; don't reject if signature valid)
- supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts (Deno; 14 event types × ~3 cases = ~40 cases)
- supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts (Deno; signature verify + dual-secret + invalid)
- supabase/functions/_shared/__tests__/stripeIpAllowlist.test.ts (Deno; allowed/denied IPs + edge cases)
- supabase/functions/_shared/__tests__/stripeKycRemediation.test.ts (Deno; mapping correctness)

Phase 2 — brand-stripe-detach (V3 carry-forward + soft-delete only):
- supabase/functions/brand-stripe-detach/index.ts per SPEC v3 §6
  - Idempotency-Key on stripe.accounts.del (treat as best-effort)
  - Soft-delete: UPDATE stripe_connect_accounts SET detached_at = now()
  - Trigger handles brands.stripe_* clear (D-V3-5 trigger updated in Phase 0')
  - Audit log on success + Stripe-rejection-but-local-success
  - Notify brand admin via notify-dispatch (type='stripe.account_deauthorized' only if external — internal detach uses 'stripe.detach_completed')
- Deno test (~5 cases)

Phase 3 — brand-stripe-balances (V3 multi-currency aware):
- supabase/functions/brand-stripe-balances/index.ts per SPEC v3 §6
  - stripe.balance.retrieve with Stripe-Account header
  - Filter to brand.default_currency (multi-currency-aware per D-V3-18)
  - Idempotency + audit + payments_manager auth
- Deno test (~4 cases)

Phase 4 — stripe-kyc-stall-reminder + deadline warnings (V3 expanded):
- supabase/functions/stripe-kyc-stall-reminder/index.ts per SPEC v3 §6
  - Existing 24-hour stall reminder logic (V2 carry-forward)
  - V3 ADDITION: deadline check — for any account with current_deadline < (now + 7 days, 3 days, 1 day), trigger notify-dispatch with type='stripe.deadline_warning_7d'/3d/1d. Idempotent by date-tier-brand_id key.
  - Cron jitter (CF-7 fix): randomize start time within 60 min window to avoid Resend rate limits
  - Resend rate-limit circuit-breaker (CF-7 fix)
- Deno test (~6 cases)

Phase 5 — stripe-webhook-health-check (V3 NEW — D-V3-8):
- supabase/functions/stripe-webhook-health-check/index.ts
  - Cron edge fn (operator schedules hourly)
  - SELECT MAX(created_at) FROM payment_webhook_events
  - If MAX < (now - 6 hours) per D-V3-8 default: alert via notify-dispatch (type='ops.webhook_silence_alert') to ops@mingla.app
  - Audit row 'ops.webhook_silence_check_fired'
- Deno test (~3 cases)

Phase 6 — Payout failure notify + KYC-stall-clear in webhook router:
- (Already covered in Phase 1 router; this phase is ensure the integration is complete)
- Integration test: simulate payout.failed event → verify notification fired with correct failure_code → remediation message
- Integration test: simulate account.updated with charges_enabled flip false→true → verify kyc_stall_reminder_sent_at cleared

Phase 7 — brand-stripe-onboard V3 modifications (multi-country + KYC remediation + reactivation):
- Modify supabase/functions/brand-stripe-onboard/index.ts:
  - Accept `country` body param (validated against canonical allowlist per I-PROPOSED-T)
  - Validate brand_team_members.mingla_tos_accepted_at IS NOT NULL (returns 403 if not; per I-PROPOSED-U)
  - V2 reactivation flow per D-V2-2: detached account = clear detached_at + reuse stripe_account_id + new AccountSession (already specified V2; carry forward)
  - V3 ADDITION: pass country + default_currency to stripe.accounts.create (controller properties unchanged; just country variable now from body not hardcoded "GB")
  - Accept-Language header from request → pass to Stripe AccountSession for localized onboarding UI
  - Audit log: action='stripe_connect.onboard_initiated' or 'stripe_connect.reactivated' (distinct)
- Update jest test mingla-business/src/utils/__tests__/onboardReactivation.test.ts (add country variant cases)

VERIFICATION:
- All Phase 1-7 Deno tests pass
- npx tsc --noEmit clean
- All 5 existing strict-grep gates pass
- supabase functions list shows new fns: stripe-webhook-health-check (others modified, not added)

OUTPUT: append Sub-dispatch B section to Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_REPORT.md.

DO NOT:
- Touch frontend code (Sub-dispatch C)
- Cherry-pick from Tao's branch (rewrite all backports)
- Skip Idempotency-Key on any Stripe call
- Skip writeAudit in any Stripe edge fn
- Use Co-Authored-By

SUGGESTED COMMIT MESSAGE:
"feat(business): B2a Path C V3 Sub-dispatch B — webhook router + 14 event types + multi-country onboard + 4 new edge fns"

Begin Phase 1 now.
```

---

## §5 — SUB-DISPATCH C: Frontend + CI + cleanup (Phase 8-15)

**Estimated effort:** 9-16 hours
**Pre-requisite:** Sub-dispatch B landed.

```
DISPATCH PROMPT (copy-paste):

Execute B2a Path C V3 Sub-dispatch C — frontend + CI + cleanup.

PRE-REQUISITE: Sub-dispatch B committed (all backend edge functions deployed).

READ THESE FILES (mandatory pre-flight):
1. outputs/SPEC_B2_PATH_C_V3.md (especially §6 frontend additions + §7 phasing)
2. outputs/IMPL_DISPATCH_B2_PATH_C_V3.md §2 + §5
3. mingla-business/src/components/brand/BrandOnboardView.tsx (existing 9-state machine; extend for V3)
4. mingla-business/src/components/brand/BrandPaymentsView.tsx (existing payments dashboard; extend for V3)
5. mingla-business/src/services/brandStripeService.ts (existing pattern)
6. mingla-business/src/store/currentBrandStore.ts (ORCH-0742 ID-only persistence — Phase 8/9 hooks must respect this)
7. mingla-business/src/hooks/useBrands.ts (existing query key factory pattern)
8. .github/workflows/strict-grep-mingla-business.yml (existing 5 gates registered; ADD T/U/V)
9. /tmp/mingla-b2-comparison/tao-b2/.github/workflows/{stripe-connect-smoke,supabase-migrations-and-stripe-deno}.yml (REFERENCE; adapt to Seth's edge fn names)
10. /tmp/mingla-b2-comparison/tao-b2/scripts/e2e/stripe-connect-smoke.mjs (REFERENCE)

DELIVERABLES:

Phase 8 — Frontend services + hooks:
- mingla-business/src/services/brandStripeBalancesService.ts (NEW)
- mingla-business/src/services/brandStripeDetachService.ts (NEW)
- mingla-business/src/services/brandStripeCountriesService.ts (NEW; lists 34 supported countries from constants)
- mingla-business/src/hooks/useBrandStripeBalances.ts (NEW; React Query; staleTime 30s; refetchInterval 60s)
- mingla-business/src/hooks/useBrandStripeDetach.ts (NEW; React Query mutation; invalidates brand + status queries on success)
- mingla-business/src/hooks/useBrandStripeCountries.ts (NEW)
- mingla-business/src/hooks/useBrandStripeBankVerification.ts (NEW; D-V3-12)
- mingla-business/src/constants/stripeSupportedCountries.ts (NEW; 34-country list with metadata: ISO, default_currency, bank format, supported business types)
- mingla-business/src/constants/stripeKycRemediationMessages.ts (NEW; 30+ Stripe codes mapped to Mingla copy per investigation Thread 18)
- mingla-business/src/constants/stripeNotificationTemplates.ts (NEW; 9 notification types with email + push + in-app templates)
- jest tests (~8 files, ~30 cases total)

Phase 9 — Country picker UI on onboard:
- mingla-business/src/components/brand/BrandStripeCountryPicker.tsx (NEW; dropdown with currency hint; default = brand's billing country if available)
- Modify mingla-business/src/components/brand/BrandOnboardView.tsx:
  - Show country picker as new initial step (before existing 9-state machine)
  - Validate selected country against canonical list
  - Pass country + default_currency to onboard service
- Update mingla-business/app/brand/[id]/payments/onboard.tsx if route params changed

Phase 10 — Multi-currency balance UI + bank verification + KYC remediation cards:
- Modify mingla-business/src/components/brand/BrandPaymentsView.tsx:
  - KPI tiles use useBrandStripeBalances + brand.default_currency for formatting
  - REPLACE formatGbp() calls with formatCurrency(amount, brand.default_currency)
  - NEW: BrandStripeBankSection — bank account display + verification status states + "Re-verify your bank" CTA
  - NEW: BrandStripeOrphanedRefundsSection — read-only history for detached brands (D-V3-7)
- mingla-business/src/components/brand/BrandStripeBankSection.tsx (NEW)
- mingla-business/src/components/brand/BrandStripeOrphanedRefundsSection.tsx (NEW)
- mingla-business/src/components/brand/BrandStripeKycRemediationCard.tsx (NEW; specific copy per Stripe disabled_reason / currently_due using stripeKycRemediationMessages.ts)

Phase 11 — Deadline warning banner:
- mingla-business/src/components/brand/BrandStripeDeadlineBanner.tsx (NEW; "Action needed by [date]" with CTA to onboarding flow)
- Wire into BrandPaymentsView at top when stripeStatus !== 'active' AND current_deadline within 7 days

Phase 12 — Mingla Business ToS acceptance gate:
- mingla-business/src/components/onboarding/MinglaToSAcceptanceGate.tsx (NEW; D-V3-17)
- Wire as pre-Stripe gate in onboarding flow
- Calls API to set brand_team_members.mingla_tos_accepted_at (NEW edge fn or modify existing brand member service)
- Placeholder ToS copy — operator/legal swap pre-launch
- Grandfather clause: existing brand admins (created before V3 ToS effective date) get implicit acceptance

Phase 13 — Notification subsystem extension:
- Extend supabase/functions/notify-dispatch/index.ts:
  - Accept new types from STRIPE_NOTIFICATION_TYPES list (9 types)
  - Route to email (Resend) + push (existing push-utils.ts) + in-app (INSERT into notifications table)
  - Respect notification_preferences table (opt-in/out per channel × per type)
- Add notification template strings (server-side lookup table OR import from frontend constants — implementor decides)
- Mingla mobile app: hook useNotifications (new) reads from notifications table + Realtime subscription for new rows

Phase 14 — CI workflows + 3 new strict-grep gates:
- .github/scripts/strict-grep/i-proposed-t-stripe-country-allowlist.mjs (NEW)
- .github/scripts/strict-grep/i-proposed-u-mingla-tos-gate.mjs (NEW)
- .github/scripts/strict-grep/i-proposed-v-stripe-notification-via-shared.mjs (NEW)
- Update .github/workflows/strict-grep-mingla-business.yml to register T, U, V (per feedback_strict_grep_registry_pattern: one script + one job per gate; never parallel files)
- .github/workflows/stripe-connect-smoke.yml (NEW; ported from Tao's; adapted to Seth's fn names + 14 event types)
- .github/workflows/supabase-migrations-and-stripe-deno.yml (NEW; ported from Tao's; updated test paths)
- scripts/e2e/stripe-connect-smoke.mjs (NEW; ported + extended for V3 multi-country happy paths)
- docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md (NEW; D-V3-9)
- docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md (NEW; D-V3-4)
- docs/runbooks/B2_GO_LIVE_CHECKLIST.md (NEW; per Stripe Go Live + Mingla operational gates)

Phase 15 — Final cleanup + verification:
- Verify no orphan imports referencing dropped Tao files
- Verify no Co-Authored-By lines anywhere
- Verify all 84 SCs (or final count) mapped to at least one test
- Run full test suite: cd mingla-business && npm test — all pass
- Run all 8 strict-grep gates — 0 violations each
- Run npm run lint — no NEW errors in V3-touched files
- Run cd mingla-business && npx tsc --noEmit — exit 0
- Run deno test (Deno tests) — all pass
- Run supabase db reset — all 12 migrations apply cleanly
- Append final Sub-dispatch C section to IMPL report

VERIFICATION (mandatory at Phase 15 close):
- [ ] All 8 strict-grep gates O/P/Q/R/S/T/U/V report 0 violations
- [ ] tsc --noEmit clean
- [ ] All jest tests pass (estimated ~80+ cases)
- [ ] All Deno tests pass
- [ ] supabase db reset clean
- [ ] No Co-Authored-By
- [ ] Final IMPL report at Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_REPORT.md

OUTPUT: complete Sub-dispatch C section in IMPL report. Include final verification matrix.

DO NOT:
- Cherry-pick from Tao's branch
- Skip writeAudit, idempotency, or country allowlist checks
- Use Co-Authored-By

SUGGESTED COMMIT MESSAGE:
"feat(business): B2a Path C V3 Sub-dispatch C — frontend + 3 new strict-grep gates + CI + runbooks"

Begin Phase 8 now.
```

---

## §6 — Operator post-implementor actions (Phase 16-18)

After Sub-dispatch C lands:

### Phase 16 — Operator-side smoke (~1-2 hours)

Multi-country happy paths in Stripe sandbox:
1. **UK (GB) onboarding** — full flow from country picker through Stripe-hosted form to active state. Verify deadline warnings + bank verification UI states render correctly.
2. **US onboarding** — same flow; verify USD currency display in balances.
3. **Germany (DE) onboarding** — verify EUR currency + German address validation.
4. **Detach + reactivation** — disconnect on UK brand → verify orphaned refunds section shows; reconnect → verify same Stripe account reused.
5. **Webhook event probes** — fire `account.updated`, `payout.failed`, `account.application.deauthorized`, `account.external_account.updated` from Stripe Dashboard → verify notifications fire (email + push + in-app row).
6. **Webhook silence alert** — temporarily disable Stripe Dashboard webhook delivery → verify health-check fires alert after 6 hours (or use a shorter dev threshold).

Document smoke results in operator's local notes; reference at tester dispatch.

### Phase 17 — `/mingla-tester` dispatch

Orchestrator authors tester dispatch prompt at `outputs/TESTER_DISPATCH_B2_PATH_C_V3.md` covering:
- All 84 SCs
- All 8 invariants (O/P/Q/R/S/T/U/V)
- Multi-country verification (sample: UK + US + DE + 1 EU edge case e.g., Iceland)
- GDPR erasure dry-run on test brand
- Webhook signature rotation runbook validation
- RAK scope verification (each fn fails 403 if granted insufficient scope)
- Production go-live checklist verification

### Phase 18 — Operator CLOSE

Per `feedback_post_pass_protocol`:
- Lock DEC-121 → ACTIVE in DECISION_LOG
- Flip I-PROPOSED-O/P/Q/R/S/T/U/V from DRAFT → ACTIVE in INVARIANT_REGISTRY
- 7-artifact SYNC: WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS
- Disposition all V3 D-CYCLE-B2-PATHC-V3-N discoveries
- **EAS OTA dual-platform** per `feedback_eas_update_no_web` (TWO separate commands, never `ios,android`):

```bash
cd mingla-business
eas update --branch production --platform ios --message "Cycle B2a Path C V3: full B2 close — multi-country + KYC UI + deadline warnings + monitoring + GDPR + RAKs"
eas update --branch production --platform android --message "Cycle B2a Path C V3: full B2 close"
```

- Operator-side legal review hold lifted: confirm Mingla Business ToS copy reviewed + final version deployed
- Apply Phase 0' through Phase 0''' migrations to production via `supabase db push`
- Live-mode launch follow-up cycle (gated on Stripe Marketplace approval + sandbox stability)

---

## §7 — Cross-references

- SPEC v3 (binding): [outputs/SPEC_B2_PATH_C_V3.md](SPEC_B2_PATH_C_V3.md)
- Investigation report: [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md)
- V1 SPEC (SUPERSEDED): [outputs/SPEC_B2_PATH_C_AMENDMENT.md](SPEC_B2_PATH_C_AMENDMENT.md)
- V2 SPEC (SUPERSEDED): [outputs/SPEC_B2_PATH_C_V2.md](SPEC_B2_PATH_C_V2.md)
- V1 forensics audit: [Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md](../../reports/INVESTIGATION_B2_PATH_C_AUDIT.md)
- Stripe best-practices audit: [Mingla_Artifacts/reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md](../../reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md)
- Phase 0 IMPL report: [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md](../../reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md)
- Original B2a SPEC (now superseded): [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md](../../specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md)
- Original B2 forensics: [Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md](../../reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md)
- D-B2-23 SDK spike: [Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md](../../reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md)
- INVARIANT_REGISTRY: [Mingla_Artifacts/INVARIANT_REGISTRY.md](../../INVARIANT_REGISTRY.md)
- DECISION_LOG: [Mingla_Artifacts/DECISION_LOG.md](../../DECISION_LOG.md)
- Operator handoff (smoke): `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md`
- Reference worktree (Tao's; read-only): `/tmp/mingla-b2-comparison/tao-b2/`

---

**End of dispatch.**

When operator dispatches Sub-dispatch A, agent's outputs go to:
- 11 migrations + DECISION_LOG + INVARIANT_REGISTRY append + 1 runbook + (optional) doc fixes
- Section "Sub-dispatch A" of `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_REPORT.md`

Sub-dispatches B + C build on A; cannot start until A is committed.

**Phase 0 commits stay** (`cf3969bf` + `cfb121e8`) — V3 builds Phase 0' + 0'' + 0''' + 1-15 on top.

**B2c (RN native SDK) + B2d (AU expansion) + B3 (Checkout) + B4 (Scanner) are EXPLICITLY out of V3 scope.**
