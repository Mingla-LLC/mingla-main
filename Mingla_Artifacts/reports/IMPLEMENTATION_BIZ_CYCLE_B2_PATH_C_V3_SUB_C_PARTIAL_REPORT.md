# IMPLEMENTATION REPORT — B2a Path C V3 Sub-dispatch C (Phase 8 + 14 + 14b — PARTIAL)

**ORCH-ID:** B2A-PATH-C-V3-SUB-C (partial — phases 8 + 14 + 14b only)
**Cycle:** B2a Path C V3 (Stripe Connect marketplace integration)
**Pass type:** Partial Sub-dispatch C — pure-logic phases (services, hooks, constants, CI workflows, runbooks, RLS migration). Visible-UI phases (9-13) + verification (15) deferred to fresh implementor session per Pre-Flight realistic-scope plan.
**Status:** `implemented, partially verified`
**Predecessors:** Sub-dispatch B + B-completion APPROVED at REVIEW (2026-05-07); SPEC v3 §13 amendments A1-A5 patched.
**Dispatch source:** `Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_C_DISPATCH.md`
**Author:** /mingla-implementor
**Date:** 2026-05-07

---

## 1. Summary

In plain English: this partial pass landed the **non-visible** half of Sub-dispatch C — the foundation that Phases 9-13 (visible UI) build on top of. Specifically: (a) the multi-currency / multi-country data layer (3 services + 4 hooks + 3 constants files); (b) two new CI workflows that run a multi-country happy-path smoke against Stripe sandbox + apply migrations cleanly + run Deno tests on the Stripe shared modules; (c) three operator runbooks for webhook secret rotation, GDPR erasure, and go-live; (d) explicit RLS deny policies on the `mingla_revenue_log` table per amendment A5 follow-up. UI phases (country picker, multi-currency dashboard, bank verification, KYC remediation cards, deadline banner, ToS gate) are deferred to a fresh implementor session because each requires a `/ui-ux-pro-max` design preflight that's better done with full session context.

Brand-admin-visible impact today: zero (no UI changes shipped). Foundation impact: significant — Phases 9-13 components have ready-to-use hooks/services/constants and don't need to invent their data layer.

---

## 2. SPEC traceability

Mapped to `outputs/SPEC_B2_PATH_C_V3.md` §13 amendments + IMPL_DISPATCH §5 + dispatch §"NEW additions":

| SPEC item | Where it landed | Verified |
|---|---|---|
| §13 A1 — `STRIPE_WEBHOOK_SECRET_PLATFORM` env var | (Sub-B already shipped; this pass adds the rotation runbook covering all 3 secrets) | ✅ runbook present |
| §13 A5 — `mingla_revenue_log` RLS | Migration `20260512000001` extended with explicit deny policies for `authenticated` + `anon`; service_role bypass preserved | ✅ migration patched |
| Dispatch N1 — publishable key wire-in | `mingla-business/app.config.ts` `extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` reads env or test fallback | ✅ committed to `app.config.ts` |
| Dispatch N3 — migration apply ordering | Migration is now apply-safe (RLS in place); operator can `supabase db push` whenever | ✅ |
| Dispatch N4 — RLS for revenue log | Implemented in migration `20260512000001` per Section 1 above | ✅ |
| Dispatch N5 — Phase 15 verifies 9 gates not 8 | (Phase 15 deferred but the new strict-grep workflow already includes all 9 jobs from Sub-B completion) | ✅ |
| §5 Phase 8 — services + hooks + constants | 3 services, 4 hooks, 3 constants files written | ✅ |
| §5 Phase 14 — 2 CI workflows + smoke + 3 runbooks | All present | ✅ |
| §5 Phase 14 — strict-grep gates T/U/V | (Sub-B completion shipped these; Sub-C did NOT redo, per dispatch §"What's already done") | ✅ correctly skipped |
| §5 Phase 8 — `useStartBrandStripeOnboarding` accepts country | Optional `country` field on input; service signature already supported it | ✅ |
| §5 Phase 8 — `formatCurrency` helper | Added to `mingla-business/src/utils/currency.ts` with multi-currency locale lookup + minor-unit awareness for ISO 4217 zero-decimal currencies | ✅ |
| §5 Phase 9-13 (UI) | **DEFERRED** to next implementor session (with `/ui-ux-pro-max` preflights) | ⏳ |
| §5 Phase 15 (final verification) | **DEFERRED** until 9-13 complete | ⏳ |

---

## 3. Old → New receipts

### 3.1 New files

#### `mingla-business/src/constants/stripeSupportedCountries.ts` (NEW, 88 lines)

- **What it does:** Exports the canonical 34-country allowlist (US/UK/CA/CH + 30 EEA), each with `country`, `displayName`, `defaultCurrency`, `bankAccountLabel` fields. Plus three helpers: `isStripeSupportedCountry`, `getStripeSupportedCountry`, `defaultCurrencyForCountry`.
- **Why:** Frontend mirror of `supabase/functions/_shared/stripeSupportedCountries.ts`. The dispatch's I-PROPOSED-T strict-grep gate exempts this exact path. UI consumers (Phase 9 country picker, Phase 10 currency formatting, Phase 10 bank-section labels) all read from here.

#### `mingla-business/src/constants/stripeKycRemediationMessages.ts` (NEW, 248 lines)

- **What it does:** Maps ~30 Stripe `disabled_reason` + `requirements.currently_due` codes to user-facing copy (`title`, `body`, `ctaLabel`, `severity`). Includes a `FALLBACK` for unknown codes that still nudges the user to the secure onboarding flow without exposing Stripe's raw enum strings.
- **Why:** Phase 10 KYC remediation cards need to render specific, actionable copy per Stripe code, not raw strings. ~30 codes covers the 90th-percentile real-world cases per investigation Thread 18.

#### `mingla-business/src/constants/stripeNotificationTemplates.ts` (NEW, 188 lines)

- **What it does:** Defines 9 notification types (`stripe.kyc_deadline_warning_{7d,3d,1d}`, `stripe.payout_failed`, `stripe.account_deauthorized`, `stripe.bank_verification_required`, `stripe.account_restricted`, `stripe.reactivation_complete`, `stripe.refund_processed`) each with email subject + email body + push title + push body + in-app title + in-app body + severity. Plus a `renderTemplate(template, vars)` helper for `{key}` placeholder substitution with safe fallbacks for missing variables.
- **Why:** Phase 13 notify-dispatch extension reads these templates to render per-channel content. I-PROPOSED-V (notifications via shared dispatcher) is automatic via this surface — UI never directly calls send/push.

#### `mingla-business/src/services/brandStripeBalancesService.ts` (NEW, 60 lines)

- **What it does:** `fetchBrandStripeBalances(brandId)` — invokes `brand-stripe-balances` edge fn (Sub-B), validates response shape, returns `{currency, availableMinor, pendingMinor, retrievedAt}`. Throws on edge-fn error or malformed payload.
- **Why:** Sub-B shipped the edge fn; this gives the UI a stable typed wrapper.

#### `mingla-business/src/services/brandStripeDetachService.ts` (NEW, 52 lines)

- **What it does:** `detachBrandStripe(brandId)` — invokes `brand-stripe-detach` edge fn (Sub-B), returns `{detachedAt, stripeDeleteStatus, rejectionReason}`. Throws on edge-fn error.
- **Why:** Sub-B shipped the edge fn; this gives the UI a stable typed wrapper.

#### `mingla-business/src/services/brandStripeCountriesService.ts` (NEW, 30 lines)

- **What it does:** `fetchBrandStripeCountries()` — returns the 34-country list as a Promise (synchronous read of the constants module wrapped in Promise for React Query uniformity). Future remote-config swap can replace internals without changing call sites.
- **Why:** Phase 9 country picker reads via React Query for cache-uniformity with other Stripe hooks.

#### `mingla-business/src/hooks/useBrandStripeBalances.ts` (NEW, 58 lines)

- **What it does:** React Query wrapper around `fetchBrandStripeBalances`. Query keys factory `brandStripeBalancesKeys` (`all`, `detail(brandId)`). `staleTime` 30s, `refetchInterval` 60s. Enabled only when `brandId !== null && stripeStatus === "active"` to avoid hitting the edge fn before the connected account is live.
- **Why:** Phase 10 multi-currency balance UI consumes this. Const #4 query keys factory + Const #5 server state via React Query.

#### `mingla-business/src/hooks/useBrandStripeDetach.ts` (NEW, 57 lines)

- **What it does:** React Query mutation wrapper. On success: invalidates brand-stripe-status + brand-stripe-balances + brand detail. `onError` logs structured error for caller to surface.
- **Why:** Phase 10 UI dispatches detach via this hook; cache invalidations keep the dashboard fresh.

#### `mingla-business/src/hooks/useBrandStripeCountries.ts` (NEW, 31 lines)

- **What it does:** React Query wrapper around `fetchBrandStripeCountries`. `staleTime: Infinity` (the list only changes via SPEC amendment in a coordinated cycle).
- **Why:** Phase 9 country picker.

#### `mingla-business/src/hooks/useBrandStripeBankVerification.ts` (NEW, 142 lines)

- **What it does:** Reads `stripe_external_accounts` table (Sub-A migration `20260511000002`) for the brand. Subscribes to Realtime UPDATE/INSERT/DELETE on that table for live invalidation. Returns derived UI state: `{state: "verified" | "pending" | "errored" | "missing", lastFour, bankAccountLabel, errorReason}`. `bankAccountLabel` is derived from country (e.g., "IBAN" for EEA, "Sort code + account" for GB).
- **Why:** Phase 10 BrandStripeBankSection component needs a structured, UI-ready summary of bank verification — not the raw row.

#### `.github/workflows/stripe-connect-smoke.yml` (NEW, 50 lines)

- **What it does:** GitHub Actions workflow running `scripts/e2e/stripe-connect-smoke.mjs` against Stripe sandbox. Triggered by `workflow_dispatch` (operator-initiated) and on push to `Seth`/`main` if Stripe-related code paths change. Gated on `github.actor == 'sethogieva'` to prevent unauthorised pulls from running against the operator's Stripe key.
- **Why:** SPEC §9 — multi-country happy-path smoke. The workflow is operator-triggered for safety (uses real Stripe API key from secrets).

#### `.github/workflows/supabase-migrations-and-stripe-deno.yml` (NEW, 80 lines)

- **What it does:** Two jobs. Job 1: spins up postgres:15 service, applies all migrations in timestamp order via `psql -f`, fails on error. Job 2: runs `deno test` against `supabase/functions/_shared/__tests__/`. Triggered on every push to `Seth`/`main` if migrations or shared modules change.
- **Why:** SPEC §9 — catch migration ordering issues + Deno-side regressions before they reach a deploy.

#### `scripts/e2e/stripe-connect-smoke.mjs` (NEW, 136 lines)

- **What it does:** Iterates Tier 1 (US/GB/DE) + Tier 2 (CA/CH/FR) + Tier 3 (NL/IE/SE) countries, creates connected account with V3 controller properties, calls `accountSessions.create`, calls `accounts.retrieve` to verify shape + country round-trip, best-effort `accounts.del` cleanup at the end. Refuses to run against live mode (asserts `sk_test_` prefix). Exit 1 on any country failure.
- **Why:** SPEC §9 + DEC-122 — proves multi-country works against the real Stripe API, not just unit tests.

#### `docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md` (NEW, 126 lines)

- **What it does:** Step-by-step procedure for rotating either `STRIPE_WEBHOOK_SECRET` (Connect endpoint) or `STRIPE_WEBHOOK_SECRET_PLATFORM` (Platform endpoint) with zero delivery loss using the dual-secret fallback pattern. Covers pre-flight, the 6-step rotation, verification, and rollback.
- **Why:** SPEC §3 + I-PROPOSED-V/W (rotation discipline). Annual rotation is a Stripe security best practice; without a runbook, rotation will be skipped or done unsafely.

#### `docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md` (NEW, 156 lines)

- **What it does:** Procedure for handling GDPR Article 17 erasure requests for users with Stripe Connect accounts. Covers retention-window overrides per jurisdiction (US 7y / UK 6y / EU 5y / DE+IT 10y), Mingla-side anonymization via `anonymize_user_audit_log()` SQL fn, Stripe-side redaction via `privacy@stripe.com`, user confirmation email, and the compliance log entry.
- **Why:** SPEC §3 + DEC-V3-4 + Sub-A migration `20260511000004`. GDPR Art. 17 obligation is real; without a runbook, the 30-day clock is missed and Mingla is exposed.

#### `docs/runbooks/B2_GO_LIVE_CHECKLIST.md` (NEW, 151 lines)

- **What it does:** 8-section checklist (A-H) covering Stripe Connect platform readiness, Supabase production env, compliance/legal, 1099-K, disputes, monitoring, deploy choreography, post-launch first-week. Sequential — all prior sections must check before moving forward.
- **Why:** SPEC §11 + Stripe's official Go Live checklist. Without this checklist, go-live will skip a step (live RAKs / live webhook secrets / DPA / etc.) and break in production.

### 3.2 Modified files

#### `supabase/migrations/20260512000001_b2a_v3_mingla_revenue_log.sql` (modified, +30 lines)

- **What it did before:** Created the table + 2 indexes + `ALTER TABLE ENABLE ROW LEVEL SECURITY` + COMMENT. No explicit policies (relies on Supabase service-role bypass).
- **What it does now:** Same plus 3 explicit policies: `mingla_revenue_log_no_authenticated_read` (authenticated SELECT denied), `mingla_revenue_log_no_authenticated_write` (authenticated ALL denied), `mingla_revenue_log_no_anon` (anon ALL denied). service_role bypass preserved (Supabase contract).
- **Why:** Sub-B IMPL REVIEW discovery (amendment A5) noted RLS was enabled but no explicit policies — relies on default behaviour. Explicit deny-by-default is hardened against future role escalations or accidental policy permissive-by-default flips.

#### `mingla-business/src/utils/currency.ts` (modified, +95 lines)

- **What it did before:** Exported `formatGbp`, `formatGbpRound`, `formatCount` — GBP-only.
- **What it does now:** Same plus `formatCurrency(value, currency, minor=false)` and `formatCurrencyRound(value, currency, minor=false)` — multi-currency formatters with locale-by-currency lookup table (en-US for USD, de-CH for CHF, etc.) and ISO 4217 zero-decimal currency awareness (BIF/JPY/KRW/etc.). Minor-unit conversion: pass `minor=true` if value is in pence/cents, function divides by `minorUnitFactor(currency)`.
- **Why:** Constitution #10 (currency-aware UI). V3 multi-country balance UI operates in 12+ currencies; without this helper, every component would inline `Intl.NumberFormat` calls and drift apart.

#### `mingla-business/app.config.ts` (modified, +9 lines)

- **What it did before:** Exposed Supabase, Google client IDs in `extra`. No Stripe publishable key.
- **What it does now:** Same plus `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` reading env-first with the test-mode `pk_test_51TTnt1PjlZyAYA40...` fallback (per amendment A2 — MINGLA LLC sandbox account).
- **Why:** Dispatch N1 — `@stripe/connect-js` on the Mingla-hosted onboarding page needs the publishable key. Public-by-design, ships in client bundle.

#### `mingla-business/src/hooks/useStartBrandStripeOnboarding.ts` (modified, +6 lines)

- **What it did before:** Mutation took `{brandId, returnUrl}`. Country was hardcoded to `"GB"` at the service layer.
- **What it does now:** Mutation takes `{brandId, returnUrl, country?}`. `country` is optional; falls back to `"GB"` at service if not provided. Phase 9 country picker passes the user's selection through.
- **Why:** SPEC §3 multi-country support. Hook input now matches the service's pre-existing capability.

---

## 4. Invariant preservation

| Invariant | Status | How preserved |
|---|---|---|
| I-PROPOSED-O (no DIY WebView wrap) | ACTIVE — preserved | No imports of `react-native-webview` adjacent to `@stripe/connect-js` (no UI shipped this pass) |
| I-PROPOSED-P (state canonical) | ACTIVE — preserved | No direct `brands.stripe_*` writes from new services; all reads via existing Sub-B canonical surface |
| I-PROPOSED-Q (API version pinned) | ACTIVE — preserved | New CI smoke pins `2026-04-30.preview` via env, defers to `_shared/stripe.ts` for in-app usage |
| I-PROPOSED-R (idempotency on every call) | ACTIVE — preserved | Smoke script generates per-call idempotency keys |
| I-PROPOSED-S (audit log on every Stripe edge fn) | ACTIVE — preserved | No new edge fns this pass; existing Sub-B fns preserved |
| I-PROPOSED-T (country allowlist) | DRAFT — newly enforced | `stripeSupportedCountries.ts` mirror is the canonical UI source; gate T exempts the path |
| I-PROPOSED-U (ToS gate) | DRAFT — preserved | No new Stripe state-creating calls in Sub-C; gate U exit 0 |
| I-PROPOSED-V (notify-dispatch) | DRAFT — preserved | New constants define templates only; no direct `sendPush`/Resend calls in services |
| I-PROPOSED-W (notifications app-type-prefix) | DRAFT — preserved | No new `.from('notifications')` queries in this pass; gate W exit 0 |

All 9 strict-grep gates exit 0 against the post-change tree.

---

## 5. Cache safety

- **New query keys factories:** `brandStripeBalancesKeys`, `brandStripeBankVerificationKeys`, `brandStripeCountriesKeys`. All inline-defined in their respective hooks (matches existing `brandStripeStatusKeys` pattern).
- **Mutation invalidations:** `useBrandStripeDetach` invalidates 3 keys: brand-stripe-status, brand-stripe-balances, brand detail. Verified the keys it invalidates match the keys the hooks use.
- **Realtime subscriptions:** `useBrandStripeBankVerification` subscribes to `stripe_external_accounts` for the brand and triggers query invalidation on any UPDATE/INSERT/DELETE.
- **Persisted Zustand:** none touched.
- **AsyncStorage shape changes:** none.

---

## 6. Regression surface

5 features most likely to surface a regression (tester to verify in Phase 17):

1. **Existing Phase 0 onboarding flow** — `useStartBrandStripeOnboarding` mutation input now optionally takes `country`; existing callers (BrandOnboardView) pass only `{brandId, returnUrl}` so default behaviour preserved. Verify a US/GB onboard still works.
2. **`mingla-business/src/utils/currency.ts` consumers** — `formatGbp` and `formatGbpRound` are unchanged; new helpers are additive. Verify no existing component accidentally imported a now-renamed helper (no renames done).
3. **GitHub Actions runtime** — 2 new workflow files added; verify they don't conflict with existing workflows on the same triggers.
4. **`mingla_revenue_log` policy semantics** — new explicit policies are deny-by-default for non-service roles. If anything was relying on default-allow for `authenticated`, it would now break (audit: nothing currently reads this table).
5. **`app.config.ts` extra block** — added new entry; verify Expo build still completes (test build in operator's local env before deploy).

---

## 7. Constitutional compliance

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | N/A (no UI this pass) |
| 2 | One owner per truth | ✅ — `stripeSupportedCountries.ts` is the canonical UI source; backend has its own canonical |
| 3 | No silent failures | ✅ — every service throws on error; every hook has structured error log + onError surface |
| 4 | One query key per entity | ✅ — 3 new factories follow existing pattern |
| 5 | Server state via React Query | ✅ — new hooks use React Query; Zustand untouched |
| 6 | Logout clears everything | N/A (no auth changes) |
| 7 | Label temporary fixes | ✅ — no `[TRANSITIONAL]` markers added; nothing fragile |
| 8 | Subtract before adding | ✅ — modified files are surgical extensions, not layers on broken code |
| 9 | No fabricated data | ✅ — services return Stripe's actual values; no synthetic fallbacks |
| 10 | Currency-aware UI | ✅ — `formatCurrency` is the foundation Phase 10 will use |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | ✅ — services validate edge fn response shape before returning |
| 13 | Exclusion consistency | ✅ — country list mirrors backend exactly (verified by Gate T at edge + DB CHECK + UI) |
| 14 | Persisted-state startup | N/A |

No violations.

---

## 8. Discoveries for orchestrator

1. **Working-tree `cd` quirk in Bash sessions.** During this pass I discovered that an earlier `cd mingla-business` left my shell in `mingla-business/` for several subsequent commands, which made `ls docs/` look empty (it was looking at `mingla-business/docs/`, not the repo's `docs/`). Caused brief confusion before reset to repo root. Not a code issue; flag for orchestrator awareness in case future implementor sessions hit the same pattern. Suggested mitigation: implementor sessions should `cd /path/to/repo` explicitly at the start of every Bash invocation that involves directory-relative paths.
2. **README.md gate registry table still missing entries for H/I/O/P/Q/R/S** (per Sub-B REVIEW discovery #1). T/U/V/W are now registered (Sub-B completion pass) but the historical gap persists. Suggested: a one-off cleanup ORCH cycle to backfill the README registry.
3. **Phase 9-13 implementor session prerequisites.** When dispatching the next implementor session for the visible-UI phases, the dispatch should remind it that:
   - All hooks/services/constants from THIS pass are ready to use; no need to re-create.
   - `/ui-ux-pro-max` preflight is required for each visible component (BrandStripeCountryPicker, BrandStripeBankSection, BrandStripeOrphanedRefundsSection, BrandStripeKycRemediationCard, BrandStripeDeadlineBanner, MinglaToSAcceptanceGate).
   - The notify-dispatch frontend hook (Phase 13 — Mingla Business inbox) must include the `.or('type.like.stripe.%,type.like.business.%')` filter per Gate W; otherwise CI will block the PR.
   - The publishable key is now in `app.config.ts.extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` — the connect-onboarding page reads it via `Constants.expoConfig.extra` (not `process.env` directly).

None of the above is a launch blocker.

---

## 9. Verification matrix

| Item | Verified how | Result |
|---|---|---|
| All 9 strict-grep gates exit 0 | Run from repo root post-changes | ✅ all 9 pass |
| `tsc --noEmit` clean | `cd mingla-business && npx tsc --noEmit` post-changes | ✅ clean (no new errors) |
| 16 new files present + 4 modified | `ls -la` per file path | ✅ all present |
| Migration syntax valid | Migration file inspected; SQL is standard | ⏳ runtime verification at operator's `supabase db push` |
| CI workflow YAML syntax | Patterns mirror existing workflows; not yet validated by yamllint | ⏳ CI itself will surface any issue on next push |
| Smoke script runs against Stripe sandbox | Not yet run (requires GitHub Actions env or operator-local STRIPE_SECRET_KEY) | ⏳ deferred to Phase 16 |
| Runbook procedural correctness | Self-reviewed for sequencing + safety; expert review (legal/ops) recommended pre-launch | ⏳ deferred |
| Hooks integrate cleanly with React Query | Pattern matches existing `useBrandStripeStatus` | ✅ structurally correct |
| Phases 9-13 (UI) | NOT STARTED — deferred per Pre-Flight scope | ⏳ next session |
| Phase 15 (verification) | DEFERRED until 9-13 complete | ⏳ |

---

## 10. Status label

**`implemented, partially verified`** for the scope of this pass (Phases 8 + 14 + 14b).

For Sub-dispatch C overall: **partial**. Phases 9-13 + 15 are pending in a separate implementor session.

---

## 11. Operator next-step list

1. **Hand back to orchestrator** for REVIEW of this partial pass.
2. **If APPROVED:** dispatch a fresh `/mingla-implementor` session for Phases 9-13 (the visible-UI phases) using the next dispatch prompt the orchestrator will write. That session reads this report's §8 discoveries first, then executes Phases 9-13 with `/ui-ux-pro-max` preflights, then completes Phase 15 verification.
3. **Operator-side: do NOT commit the Sub-C partial yet.** Wait until Phases 9-13 + 15 complete so the entire Sub-C lands in one commit (or two — implementor's call at that time).
4. **Operator-side: do NOT apply the migration yet.** `supabase/migrations/20260512000001_b2a_v3_mingla_revenue_log.sql` is now RLS-safe but applies will be done after Sub-C is complete and just before Phase 16 smoke deploy.
5. **Optional now: review the runbooks** (`B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md`, `B2_GDPR_ERASURE_RUNBOOK.md`, `B2_GO_LIVE_CHECKLIST.md`). Legal/compliance review especially welcome on the GDPR runbook before V3 ships.

---

## 12. Files changed (final tally for this pass)

**New files (16):**

Constants (3):
- `mingla-business/src/constants/stripeSupportedCountries.ts`
- `mingla-business/src/constants/stripeKycRemediationMessages.ts`
- `mingla-business/src/constants/stripeNotificationTemplates.ts`

Services (3):
- `mingla-business/src/services/brandStripeBalancesService.ts`
- `mingla-business/src/services/brandStripeDetachService.ts`
- `mingla-business/src/services/brandStripeCountriesService.ts`

Hooks (4):
- `mingla-business/src/hooks/useBrandStripeBalances.ts`
- `mingla-business/src/hooks/useBrandStripeDetach.ts`
- `mingla-business/src/hooks/useBrandStripeCountries.ts`
- `mingla-business/src/hooks/useBrandStripeBankVerification.ts`

CI workflows + smoke (3):
- `.github/workflows/stripe-connect-smoke.yml`
- `.github/workflows/supabase-migrations-and-stripe-deno.yml`
- `scripts/e2e/stripe-connect-smoke.mjs`

Runbooks (3):
- `docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md`
- `docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md`
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`

**Modified files (4):**

- `supabase/migrations/20260512000001_b2a_v3_mingla_revenue_log.sql` (RLS deny policies added)
- `mingla-business/src/utils/currency.ts` (formatCurrency + formatCurrencyRound + locale lookup table + zero-decimal currency set)
- `mingla-business/app.config.ts` (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY)
- `mingla-business/src/hooks/useStartBrandStripeOnboarding.ts` (optional country input)

**Total surface this pass:** 20 files touched, ~1,653 lines net new.
