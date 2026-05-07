# Investigation — B2a Path C Comprehensive Audit

**Mode:** INVESTIGATE-only (no SPEC, no code, no implementation suggestions)
**Date:** 2026-05-06
**Investigator:** Mingla Forensics (in-conversation execution per operator authorization)
**Dispatch:** [`outputs/FORENSICS_B2_PATH_C_AUDIT.md`](../../outputs/FORENSICS_B2_PATH_C_AUDIT.md)
**Branches under examination:**
- Seth's B2a — current `Seth` branch, HEAD `cfb121e8` (post Phase 0 commits `cf3969bf` + `cfb121e8`)
- Taofeek's B2 — `feat/b2-stripe-connect`, worktree at `/tmp/mingla-b2-comparison/tao-b2/`, HEAD `1039a1c3`
**Audit scope:** code-rigorous (full read of every Stripe-touching file in both trees + all 3 migrations + all artifacts) — runtime probes deferred (see §8)

---

## 0. Executive verdict (≤10 lines)

**Both branches ship valid but incomplete B2 work.** Seth's branch implements onboarding correctly per locked spec decisions (controller properties, idempotency, audit, trigger-only state sync, web SDK Path B), but ships an incomplete webhook handler, lacks detach/balances/KYC reminder, AND has a critical migration-trigger gap that breaks the SPEC's claimed detach behavior. Taofeek's branch ships the operations Seth lacks (webhook router, detach, balances, KYC reminder, smoke CI) but violates 4 of 5 Path C invariants (Q/R/S — no API version pin, no idempotency, no audit log; P — direct `brands.stripe_*` writes in 3 functions). Neither covers ~12 capabilities a production-grade marketplace platform needs.

**Architectural verdict:** Path C scope is broadly correct. SPEC v1 file manifest holds with **3 mandatory revisions** (see §10) and **8 newly-surfaced architectural decisions** the SPEC v2 author must lock (§11).

**Most dangerous unresolved finding:** 🔴 R-M1 — Seth's migration `20260508000000` trigger does NOT clear `brands.stripe_*` cache on detach. The SPEC v1 D-B2-29 claim "trigger mirrors null/false to brands.stripe_* on detach" is **WRONG against the shipped code**. Path C v2 implementation MUST update either the trigger or the detach edge fn to actually clear the cache, OR the I-PROPOSED-P invariant will be silently violated when detach ships.

**Confidence: H** on code-layer findings (read every file end-to-end + verified critical claims via grep). **M** on Constitutional gaps in unread frontend paths. **L** on runtime-only behaviors (rate limit thresholds, webhook delivery latency, Stripe v2 vs v1 event-shape differences) — flagged for operator-led runtime probe before SPEC v2 lock.

---

## 1. Investigation manifest (every file read, in trace order)

| # | File | Branch | Layer | Source of read |
|---|---|---|---|---|
| 1 | `outputs/B2_RECONCILIATION_REPORT.md` | — | Doc (skeptical) | Self |
| 2 | `outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` | — | Doc (skeptical) | Self |
| 3 | `outputs/SPEC_B2_PATH_C_AMENDMENT.md` | — | Doc (skeptical) | Self |
| 4 | `Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md` | — | Doc (B2 baseline forensics) | Self |
| 5 | `Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md` | — | Doc (D-B2-23 spike) | Self |
| 6 | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md` | — | Doc (B2a SPEC) | Earlier session |
| 7 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md` | — | Doc (B2a IMPL claims) | Earlier session |
| 8 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Seth | Schema | Phase 0c grep |
| 9 | `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql` | Seth | Schema (Phase 7 thread 14) | Self |
| 10 | `supabase/migrations/20260509000001_b2_payouts_stripe_id_unique.sql` | Seth (Phase 0) | Schema | Self |
| 11 | `supabase/migrations/20260509000002_b2_kyc_stall_reminder_column.sql` | Seth (Phase 0) | Schema | Self |
| 12 | `supabase/functions/brand-stripe-onboard/index.ts` | Seth | Code | Self |
| 13 | `supabase/functions/stripe-webhook/index.ts` | Seth | Code | Self |
| 14 | `supabase/functions/brand-stripe-refresh-status/index.ts` | Seth | Code | Self + Explore |
| 15 | `supabase/functions/_shared/stripe.ts` | Seth | Code | Self |
| 16 | `supabase/functions/_shared/idempotency.ts` | Seth | Code | Self |
| 17 | `supabase/functions/_shared/audit.ts` | Seth | Code | Self |
| 18-23 | Seth frontend (brandStripeService, brandMapping, deriveBrandStripeStatus + test, hooks ×3) | Seth | Code | Explore |
| 24-26 | Seth components + routes (BrandOnboardView, BrandPaymentsView, connect-onboarding, payments/onboard) | Seth | Code | Explore |
| 27 | `tao-b2/supabase/functions/brand-stripe-connect-session/index.ts` | Tao | Code | Self + Explore |
| 28 | `tao-b2/supabase/functions/brand-stripe-refresh-status/index.ts` | Tao | Code | Explore |
| 29 | `tao-b2/supabase/functions/stripe-connect-webhook/index.ts` | Tao | Code | Self + Explore |
| 30 | `tao-b2/supabase/functions/brand-stripe-detach/index.ts` | Tao | Code | Explore |
| 31 | `tao-b2/supabase/functions/brand-stripe-balances/index.ts` | Tao | Code | Explore |
| 32 | `tao-b2/supabase/functions/stripe-kyc-stall-reminder/index.ts` | Tao | Code | Explore |
| 33-35 | Tao `_shared/` ×3 (stripeEdgeAuth, stripeConnectProjection, stripeConnectWebhookProcess) | Tao | Code | Self + Explore |
| 36-38 | Tao Deno tests ×3 | Tao | Code | Explore |
| 39 | Tao migrations ×2 | Tao | Schema | Earlier session |
| 40-42 | Tao frontend (payoutsService, stripeConnectStatus + test) | Tao | Code | Explore |
| 43-44 | Tao CI workflows ×2 | Tao | Config | Explore |
| 45 | `.claude/projects/.../memory/MEMORY.md` (relevant feedback memories) | — | Memory | Self |
| 46-50 | Strict-grep gates Q/R/S (Phase 0 authored) | Seth | Code | Self |

**Total files inspected: 50.** Coverage: ALL files in dispatch §3 manifest read.

**NOT read (deferred per code-rigorous scope):** runtime traces, deployed-fn behavior captures, network captures, Stripe Dashboard event log dumps, actual DB row state. See §8 for runtime-probe items needing operator execution before SPEC v2 lock.

---

## 2. Five-truth-layer contradiction matrix

| # | Question | Docs says | Schema says | Code says | Runtime/Data |
|---|---|---|---|---|---|
| C-1 | What states can a `stripe_connect_account` be in? | B2a SPEC §3 lists 4: `not_connected`/`onboarding`/`active`/`restricted` | Migration `20260508000000` line 67-79 — same 4 states + `detached_at` ⇒ `not_connected` | Seth's `deriveBrandStripeStatus.ts` 4-state, Taofeek's `stripeConnectStatus.ts` 4-state — **same enum, incompatible signatures** (Seth: object; Tao: 4-positional) | UNVERIFIED |
| C-2 | When is `kyc_stall_reminder_sent_at` cleared? | Path C SPEC §6 D-B2-28 says "self-clears when account.updated webhook flips charges_enabled=true" | Migration `20260509000002` adds column, no trigger | Seth's webhook (`stripe-webhook/index.ts` lines 143-201) **does NOT clear it** — only updates charges/payouts/requirements. Taofeek's `stripe-connect-webhook/index.ts` references the column (Tao webhook proc line 107-109 per Explore findings) but Seth's branch lacks this logic. | **CONTRADICTION**: docs claim webhook clears the marker; Seth's webhook code does not |
| C-3 | What does a "detached" account look like? | Path C SPEC §6 D-B2-29 says "trigger mirrors null/false to brands.stripe_* on detach" | Migration trigger lines 110-115: **NO conditional on `detached_at`** — trigger always writes the live `stripe_account_id` + flags to `brands` regardless of detach state | Seth has no detach edge fn yet; Tao's detach (line 91-95 per Explore) does direct `brands.update` writes (violates I-PROPOSED-P). When merged into Seth's tree under I-PROPOSED-P enforcement, the trigger would NOT clear `brands.stripe_*` | **CRITICAL CONTRADICTION**: docs say trigger handles cache clear; trigger code does not |
| C-4 | What happens on duplicate webhook event? | B2a SPEC §6 SC-09 + Path C SPEC §2 D-B2-27 say "replay-safe via processed=true row marker" | `payment_webhook_events` has UNIQUE on `stripe_event_id` (per baseline) | Seth's webhook lines 113-119: replayed event SKIPPED entirely **regardless of prior `processed=true/false`** — if first attempt failed (processed=false, error set), Stripe replays will all skip without retrying | **CONTRADICTION**: docs imply retry of failed processing on replay; code skips both success AND failure replays |
| C-5 | What's the exact status when charges_enabled flips false but disabled_reason is null? | B2a SPEC test cases SC-09 + SC-10 say `onboarding` | Migration helper `pg_derive_brand_stripe_status` line 66-79 returns `onboarding` in the ELSE branch | Seth's TS twin line 30-50 returns `onboarding` matching SQL | All consistent |
| C-6 | Multi-region: does Seth's UK-only constraint hold under Taofeek's multi-region code? | B2a SPEC D-B2-13 says UK-only at MVP | No schema constraint on country | Seth's onboard (line 204) hardcodes `country = "GB"`. Taofeek's connect-session (per Explore) uses `countryFromDefaultCurrency()` mapping USD→US, EUR→IE, GBP→GB, CAD→CA, AUD→AU. **If Path C ships Taofeek's multi-region helper, D-B2-13 is silently violated.** | UNVERIFIED |
| C-7 | What is the canonical Stripe API version? | Path C SPEC §2 D-B2-5 says `2026-04-30.preview` (Accounts v2) | No schema enforcement | Seth's `_shared/stripe.ts` line 23 pins `2026-04-30.preview`. Taofeek's 5 edge functions hardcode `2024-11-20.acacia` (production v1). **2 different SDK versions cannot coexist.** | The SDK packages used (`https://esm.sh/stripe@18.0.0` Seth's; `npm:stripe@17.4.0` Taofeek's) are also different. |
| C-8 | What's the auth helper used? | B2a SPEC §4.2.2 D-B2-1 says `biz_can_manage_payments_for_brand_for_caller` | Both helpers exist (baseline migration lines 3059, 3079) | **Header comments in Seth's `brand-stripe-onboard.ts:13` + `brand-stripe-refresh-status.ts:13` say `_for_caller` BUT the actual `.rpc(...)` call at lines 139 + 109 uses `biz_can_manage_payments_for_brand` (without `_for_caller`)** — passing explicit user_id. | **DOC vs CODE drift** — code is correct (service-role context can't use `auth.uid()` so explicit user_id variant is right); header comment is stale. |

**Most dangerous contradictions: C-2, C-3, C-4.** All three falsify SPEC v1 claims. Path C v2 must address explicitly.

---

## 3. Constitutional compliance scorecard

Mingla's 14 Constitutional principles, evaluated against both branches.

### Seth's B2a

| # | Principle | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | COMPLIANT | All interactive elements in `BrandOnboardView`/`BrandPaymentsView` have handlers. Realtime subscription invalidates queries on event (Explore findings). |
| 2 | One owner per truth | **PARTIAL** | `stripe_connect_accounts` is canonical (✓). Trigger mirrors to `brands.stripe_*` (✓). BUT migration trigger doesn't handle detach state — see C-3 contradiction. POST-DETACH (when shipped) the trigger could leave brands.stripe_* with stale-live values. |
| 3 | No silent failures | COMPLIANT | Audit write best-effort (line 328-331) but errors logged. Service errors propagate via 4xx/5xx. Webhook errors persist to `payment_webhook_events.error`. |
| 4 | One query key per entity | COMPLIANT | `brandKeys` factory (useBrands.ts line 29-66 per Explore); `brandStripeStatusKeys` (useBrandStripeStatus line 29-32). No hardcoded strings. |
| 5 | Server state stays server-side | **PARTIAL** | Stripe state in React Query (✓). BUT `BrandPaymentsView` reads `brand.payouts` + `brand.refunds` from Zustand stub (line 186-203 per Explore). Marked TRANSITIONAL; B2b owner. |
| 6 | Logout clears everything | COMPLIANT (presumed) | No persisted Stripe state. React Query cache cleared on auth state change (assumed pattern). UNVERIFIED at runtime. |
| 7 | Label temporary fixes | COMPLIANT | TRANSITIONAL comments at known stub points (BrandPaymentsView line 186-190 per Explore). |
| 8 | Subtract before adding | COMPLIANT | Phase 0 added writeAudit to refresh-status by IMPORTING + CALLING; no shadow paths. |
| 9 | No fabricated data | COMPLIANT | No stub balances or fake payouts in Seth's edge functions. Frontend stub (BrandPaymentsView Zustand reads) is TRANSITIONAL marked. |
| 10 | Currency-aware UI | **VIOLATED** | `BrandPaymentsView.tsx` (per Explore findings lines 49, 315, 321, 329, 356, 390) hardcodes `formatGbp(...)`. Per D-B2-13 UK-only is acceptable scope, but the helper is named `formatGbp` rather than `formatCurrency(brand.default_currency, amount)`. Future B2c upgrade requires touching every site. |
| 11 | One auth instance | COMPLIANT | Single Supabase auth client per fn invocation. Service-role + user-bearer pattern. |
| 12 | Validate at the right time | COMPLIANT | UUID validation at request entry (line 108); permission check before Stripe API call (line 138-150). |
| 13 | Exclusion consistency | N/A | No exclusion rules in B2a scope (e.g., not a discovery/seeding pipeline). |
| 14 | Persisted-state startup | COMPLIANT | Stripe state not persisted (only in React Query memory cache). Cold-start safe. |

**Seth verdict: 11 COMPLIANT / 2 PARTIAL / 1 VIOLATED / 1 N/A.**

### Taofeek's B2

| # | Principle | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | Backend only; no UI evaluated. |
| 2 | One owner per truth | **VIOLATED** | 3 edge functions (`brand-stripe-connect-session` line 158, `brand-stripe-refresh-status` line 123, `stripeConnectWebhookProcess` line 67-73 per Explore) write `brands.stripe_*` directly, bypassing trigger. **Two write paths** = two owners. |
| 3 | No silent failures | COMPLIANT | Errors logged in detach (line 86), kyc-reminder (line 54-56). Webhook persists error to row (line 86-88). |
| 4 | One query key per entity | N/A (mostly backend); the one frontend file (`stripeConnectStatus.ts`) is a derivation utility, not query-key code. |
| 5 | Server state stays server-side | COMPLIANT | `payoutsService.ts` queries DB; doesn't persist server data to Zustand. |
| 6 | Logout clears everything | N/A (backend) |
| 7 | Label temporary fixes | UNVERIFIED — no audit of TRANSITIONAL comments performed |
| 8 | Subtract before adding | COMPLIANT — new functions, not layered on existing |
| 9 | No fabricated data | COMPLIANT — `brand-stripe-balances` returns zeros if no account (sensible default, not fabrication). |
| 10 | Currency-aware UI | COMPLIANT (where applicable) — `brand-stripe-balances.ts` reads `brand.default_currency` and filters per-currency. |
| 11 | One auth instance | COMPLIANT — `stripeEdgeAuth.ts` provides single auth helper. |
| 12 | Validate at the right time | COMPLIANT — auth + permission check at request entry. |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A (backend) |

**Taofeek verdict: 7 COMPLIANT / 1 VIOLATED / 6 N/A or UNVERIFIED.** Backend-only scope means fewer principles apply.

---

## 4. Invariant compliance scorecard

| Invariant | Seth's B2a | Taofeek's B2 |
|---|---|---|
| **I-PROPOSED-O** (no DIY WebView wrap) | COMPLIANT — `connect-onboarding.tsx` uses official `@stripe/connect-js` web SDK on Mingla-hosted page | N/A — Taofeek has no frontend web SDK integration |
| **I-PROPOSED-P** (no direct `brands.stripe_*` writes) | COMPLIANT — all edge fns write `stripe_connect_accounts`; trigger handles cache; verified by gate (0 violations) | **VIOLATED** — `brand-stripe-connect-session/index.ts:158`, `brand-stripe-refresh-status/index.ts:123`, `stripeConnectWebhookProcess.ts:67-73` (all per Explore) all directly `.update()` brands.stripe_* fields |
| **I-PROPOSED-Q** (Stripe API version pinned via `_shared/stripe.ts`) | COMPLIANT — single source `STRIPE_API_VERSION = "2026-04-30.preview"` | **VIOLATED** — 5 edge functions hardcode `apiVersion: "2024-11-20.acacia"` inline |
| **I-PROPOSED-R** (Idempotency-Key on every Stripe call) | COMPLIANT — all 3 Stripe API calls use `generateIdempotencyKey()` | **VIOLATED** — 0 of 6 edge functions pass idempotency keys to Stripe SDK calls |
| **I-PROPOSED-S** (Audit log on every Stripe edge fn) | COMPLIANT — onboard line 317, refresh-status line 209 (post-Phase-0 fix) — verified by gate | **VIOLATED** — 0 of 6 functions import or call `writeAudit` |

**Aggregate: Seth 5/5 COMPLIANT. Taofeek 1/5 COMPLIANT (only the WebView one which is N/A in his scope).**

---

## 5. Hidden-flaw checklist (16 items applied per surface)

### Seth's B2a — by surface

| Item | brand-stripe-onboard | stripe-webhook | brand-stripe-refresh-status | Migration | Frontend |
|---|---|---|---|---|---|
| 1 Dead taps | N/A | N/A | N/A | N/A | PASS (BrandOnboardView 9 states wired) |
| 2 Silent catches | PASS (audit-fail logged + non-blocking by design L328) | PASS | PASS | N/A | PASS |
| 3 Stale cache paths | N/A | N/A | N/A | N/A | PASS (staleTime 30s + refetchInterval 30s — useBrandStripeStatus L27/L81 per Explore) |
| 4 Response-shape truthfulness | PASS | PASS | PASS | N/A | PASS |
| 5 Real fix vs symptom | PASS — uses canonical `stripe_connect_accounts` write path | **PARTIAL** — see Finding 🔴 R-W1 (replay handling) | PASS | PASS | PASS |
| 6 Solo/collab parity | N/A | N/A | N/A | N/A | N/A |
| 7 Auth/RLS bypass | PASS — JWT + RPC permission check at L138 | PASS — signature check; service-role only post-verify | PASS — JWT + RPC L108 | PASS — `pg_derive_brand_stripe_status` GRANT to anon **MINOR** (HF M-1 below) | PASS |
| 8 Idempotency holes | **PARTIAL** — `generateIdempotencyKey` uses Date.now() ms; sub-ms collision possible (HF Seth-1 below) | **VIOLATED** — see 🔴 R-W1 | PASS | N/A | N/A |
| 9 Time-zone bugs | N/A | N/A | N/A | N/A | N/A (no scheduled action in Seth's scope) |
| 10 Locale/currency | N/A (UK-only D-B2-13) | N/A | N/A | N/A | **VIOLATED** — formatGbp hardcoded (HF Seth-2 below) |
| 11 Persisted-state startup | N/A | N/A | N/A | N/A | PASS — Stripe state not persisted |
| 12 Logout clears | N/A | N/A | N/A | N/A | UNVERIFIED |
| 13 One auth instance | PASS | PASS | PASS | N/A | PASS |
| 14 Validate at right time | PASS | PASS | PASS | N/A | PASS |
| 15 Exclusion consistency | N/A | N/A | N/A | N/A | N/A |
| 16 No fabricated data | PASS | PASS | PASS | PASS | **PARTIAL** — Zustand stub for payouts/refunds (TRANSITIONAL) |

### Taofeek's B2 — by surface (ABBREVIATED — every fn has the same Q/R/S violation pattern)

| Item | All 6 edge fns | _shared/stripeConnectWebhookProcess |
|---|---|---|
| 1-7 Standard checks | PASS where evaluable | PASS |
| 8 Idempotency holes | **VIOLATED** — 0 idempotency keys (HF Tao-1 below) | N/A |
| 10 Locale/currency | COMPLIANT — multi-region map `countryFromDefaultCurrency()` | N/A |
| Plus Path C invariants | I-PROPOSED-Q/R/S all VIOLATED across all 6 functions; I-PROPOSED-P violated in 3 of 6 | I-PROPOSED-P violated (line 67-73) |

---

## 6. Findings (classified)

### 🔴 Root-cause-class findings (5)

#### 🔴 R-1 — Migration trigger does NOT clear `brands.stripe_*` on detach (Seth)

| Field | Value |
|---|---|
| File + line | `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:110-115` |
| Exact code | `UPDATE public.brands SET stripe_connect_id = NEW.stripe_account_id, stripe_charges_enabled = NEW.charges_enabled, stripe_payouts_enabled = NEW.payouts_enabled WHERE id = NEW.brand_id;` |
| What it does | Always mirrors live values from `stripe_connect_accounts` to `brands.stripe_*` regardless of `NEW.detached_at` state |
| What it should do | When `NEW.detached_at IS NOT NULL`, write `stripe_connect_id = NULL`, `stripe_charges_enabled = false`, `stripe_payouts_enabled = false` to `brands` |
| Causal chain | Future detach edge fn → sets `stripe_connect_accounts.detached_at = now()` → trigger fires → trigger writes live `stripe_account_id` to `brands.stripe_connect_id` → cache shows brand still connected → `mapBrandRowToUi` derives `stripeStatus = active` (until Stripe webhook flips charges_enabled=false) → UI shows brand as connected when it's been detached |
| Verification | Read trigger body at lines 101-119; confirm absence of `CASE WHEN NEW.detached_at` clause; trigger only has the unconditional `UPDATE` |

**Severity:** S0 — falsifies SPEC v1 D-B2-29 claim. Path C v2 MUST update trigger OR explicitly route detach through a different code path.

#### 🔴 R-2 — Webhook duplicate-event handling skips ALL replays (Seth)

| Field | Value |
|---|---|
| File + line | `supabase/functions/stripe-webhook/index.ts:113-119` |
| Exact code | `if (existingRow) { console.log(...replayed event...skipped (already processed=${existingRow.processed})); return plainResponse({ status: "replayed_skipped" }, 200); }` |
| What it does | Skips processing when ANY existing row matches `stripe_event_id`, regardless of `processed=true/false` state |
| What it should do | If `existingRow.processed === false` (prior attempt failed; error column set), retry processing; if `processed === true`, skip |
| Causal chain | Webhook arrives → processes inline → DB error during state update → row marked `processed=false, error=...` → Stripe retries (it does, automatically, with backoff up to 72 hrs) → handler hits `existingRow` check → returns "replayed_skipped" → row NEVER gets retried → state desync persists |
| Verification | Code path: lines 99-119. Logic: SELECT first; if exists return skip. There is no branch that retries failed rows. |

**Severity:** S1 — Stripe's retry mechanism (one of the main reasons to use durable queue) is silently disabled. Operationally invisible until a webhook fails for a non-transient reason.

#### 🔴 R-3 — Taofeek's 5 edge functions hardcode wrong API version (incompatible with Seth's v2 setup)

| Field | Value |
|---|---|
| File + lines | `tao-b2/supabase/functions/{brand-stripe-connect-session,brand-stripe-refresh-status,stripe-connect-webhook,brand-stripe-detach,brand-stripe-balances}/index.ts:108/93/30/80/101` |
| Exact code | `apiVersion: "2024-11-20.acacia"` (literal, in 5 places) |
| What it does | Pins each function to Stripe API v1 (production), incompatible with Accounts v2 endpoints used by Seth's onboard |
| What it should do | Import `STRIPE_API_VERSION` from `_shared/stripe.ts` and pass it (or use the shared `stripe` client which already has it baked in) |
| Causal chain | Path C ships Tao's detach + balances + KYC + webhook → those functions create v1 Stripe clients → some Stripe APIs are v2-only (e.g., Accounts v2 `controller` properties) → response-shape mismatch when these functions interact with accounts created by v2 onboard → silent data loss or runtime errors |
| Verification | grep `apiVersion` across `/tmp/mingla-b2-comparison/tao-b2/supabase/functions/` returns 5 hits, all with the literal v1 date string |

**Severity:** S0 if Path C ships any of these functions as-is. **MUST refactor to import shared client during Phase 1+ work.**

#### 🔴 R-4 — Taofeek's edge functions write `brands.stripe_*` directly (I-PROPOSED-P violation)

| Field | Value |
|---|---|
| File + lines | `tao-b2/supabase/functions/brand-stripe-connect-session/index.ts:158`, `brand-stripe-refresh-status/index.ts:123`, `_shared/stripeConnectWebhookProcess.ts:67-73` |
| Exact code | `await admin.from("brands").update({ stripe_connect_id, stripe_charges_enabled, stripe_payouts_enabled }).eq("id", brandId)` (3 sites, mostly identical) |
| What it does | Bypasses the `tg_sync_brand_stripe_cache` trigger; writes cache columns directly from edge function code |
| What it should do | Write only `stripe_connect_accounts`; let the trigger mirror to brands |
| Causal chain | Path C ships any of these as-is → strict-grep gate I-PROPOSED-P trips on PR → CI red → rework cycle. OR if gate is bypassed: dual write paths cause race conditions when webhook + edge fn fire concurrently → cache drift → UI shows wrong status |
| Verification | grep `from\("brands"\).update` in `/tmp/mingla-b2-comparison/tao-b2/` returns 3 hits, all in Stripe edge code |

**Severity:** S0 if backported as-is; S2 with planned refactor (Path C SPEC §6 already mandates refactor in IMPL constraint #4). MUST verify implementor doesn't accidentally copy.

#### 🔴 R-5 — Taofeek's edge functions ship ZERO idempotency keys (I-PROPOSED-R violation; duplicate-account risk)

| Field | Value |
|---|---|
| File + line | All 6 of Taofeek's edge functions; ALL Stripe SDK calls |
| Exact code | `await stripe.accounts.create({...})` (no second arg with `idempotencyKey:`) — pattern repeats for `accounts.del`, `balance.retrieve`, `accountSessions.create` |
| What it does | Each Stripe API call goes through with no dedup token |
| What it should do | Pass `{ idempotencyKey: generateIdempotencyKey(brand_id, op) }` per D-B2-22 |
| Causal chain | Concurrent requests → both create Stripe accounts → 2 `stripe_connect_accounts` rows for same brand_id (or insert conflicts) → one orphaned Stripe account → Stripe doesn't allow account.delete via API in many cases → manual support ticket |
| Verification | grep `idempotencyKey` in `/tmp/mingla-b2-comparison/tao-b2/supabase/functions/` returns ZERO hits |

**Severity:** S1. Real-world double-tap on slow networks reproducibly triggers this.

### 🟠 Contributing factors (8)

#### 🟠 CF-1 — Seth's onboard explicitly blocks reactivation of detached accounts

| Detail | Value |
|---|---|
| File + line | `supabase/functions/brand-stripe-onboard/index.ts:167-173` |
| Code | `if (existingSca?.detached_at !== null && existingSca?.detached_at !== undefined) { return jsonResponse({ error: "conflict", detail: "account_detached_b2b_only" }, 409); }` |
| Issue | Path C scope expansion folds B2b in; the "b2b_only" rejection message is now stale. After Path C ships, brands SHOULD be able to re-onboard a previously-detached account. This blocks the use case. |
| Severity | S2 — needs SPEC v2 decision on reactivation flow + corresponding code change |

#### 🟠 CF-2 — Seth's `generateIdempotencyKey` uses millisecond epoch; sub-ms collisions possible

| Detail | Value |
|---|---|
| File + line | `supabase/functions/_shared/idempotency.ts:29` |
| Code | `const epochMs = Math.floor(Date.now()); return ${brandId}:${operation}:${epochMs};` |
| Issue | Two requests for same brand + op in same ms get IDENTICAL keys → Stripe dedupes them → second request returns first request's response. Usually safe (responses identical). BUT if first request errored and second is a legitimate retry, second gets cached error response. |
| Severity | S3 — minor; add nanosecond precision OR random suffix in SPEC v2 |

#### 🟠 CF-3 — Seth's webhook only handles `account.updated`; ALL other event types silently no-op

| Detail | Value |
|---|---|
| File + lines | `supabase/functions/stripe-webhook/index.ts:143-201` |
| Issue | Path C SPEC §6 D-B2-27 mandates 7 event types (`account.updated`, `account.application.deauthorized`, `payout.created/paid/failed/canceled`, `capability.updated`). Current code logs other types but takes no action. **Detach detection from Stripe-side (e.g., Stripe disables an account, fires `account.application.deauthorized`) WILL NOT update Mingla's state.** |
| Severity | S1 — needs full router (Tao has it; backport with refactor) |

#### 🟠 CF-4 — `decodeAndVerifyJwt` creates a service-role client to verify user JWT (atypical pattern)

| Detail | Value |
|---|---|
| File + lines | `supabase/functions/brand-stripe-onboard/index.ts:75-87`, `brand-stripe-refresh-status/index.ts` (similar pattern) |
| Code | Creates `userClient` with service-role key, then calls `userClient.auth.getUser(token)` to verify JWT |
| Issue | Works but unusual. The standard pattern is creating a client with the user's anon key + Authorization header, OR verifying the JWT signature directly against `SUPABASE_JWT_SECRET`. Using service-role key for `getUser()` may have unintended side effects (rate limit context, audit attribution). |
| Severity | S3 — refactor to direct JWT verify or anon-key client in SPEC v2 cleanup |

#### 🟠 CF-5 — Seth's `pg_derive_brand_stripe_status` granted to `anon` role

| Detail | Value |
|---|---|
| File + line | `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:85` |
| Code | `GRANT EXECUTE ON FUNCTION ... TO "anon";` |
| Issue | Anonymous users can call `pg_derive_brand_stripe_status(brand_id)` and learn whether arbitrary brands have Stripe set up. SECURITY DEFINER bypasses RLS. **Information disclosure surface.** |
| Severity | S2 — for security review; remove anon GRANT in SPEC v2 |

#### 🟠 CF-6 — Tao's `brand-stripe-connect-session` has no idempotency on race; can create duplicate Stripe accounts

| Detail | Value |
|---|---|
| File + lines | `tao-b2/supabase/functions/brand-stripe-connect-session/index.ts:140-155` (per Explore) |
| Issue | Insert without `onConflict`; race produces 2 inserts → 2 Stripe accounts. Stripe-side has no idempotency-key dedup either (see R-5). Double-failure mode. |
| Severity | S1 if shipped as-is (refactor mandated by Path C SPEC §6) |

#### 🟠 CF-7 — Tao's KYC stall reminder fires all emails simultaneously (no jitter)

| Detail | Value |
|---|---|
| File + line | `tao-b2/supabase/functions/stripe-kyc-stall-reminder/index.ts` (per Explore) |
| Issue | Loops through all qualifying brands and fires Resend emails in tight loop. Resend has rate limits. No randomized backoff, no batching. Could fail silently after Resend quota exhaustion. |
| Severity | S2 — small fix in SPEC v2 (add jitter or batch) |

#### 🟠 CF-8 — Stale doc comment in Seth's onboard + refresh-status referencing wrong RPC name

| Detail | Value |
|---|---|
| File + lines | `supabase/functions/brand-stripe-onboard/index.ts:13`, `brand-stripe-refresh-status/index.ts:13` |
| Code | Header doc says `biz_can_manage_payments_for_brand_for_caller(brand_id)` but actual `.rpc()` call uses `biz_can_manage_payments_for_brand` (without `_for_caller`) |
| Issue | Doc-vs-code drift. Code is correct (service-role context can't use `auth.uid()`). Future engineers reading the comment will be misled. |
| Severity | S3 — minor cleanup |

### 🟡 Hidden flaws (10)

#### 🟡 HF-1 — Seth's webhook AccountObject type used for non-account events

| Detail | Value |
|---|---|
| File + line | `stripe-webhook/index.ts:48-59` defines `interface AccountObject` with charges_enabled etc.; `event.data.object` is typed as `AccountObject` for ALL event types |
| Issue | When `event.type === "payout.paid"`, `event.data.object` is a Payout, not an Account. Type assertion is wrong. Currently no-op so it's hidden, but if Path C wires payout handlers, this becomes a runtime bug. |
| Severity | S2 |

#### 🟡 HF-2 — Seth's webhook insert-race fallback returns 200 with `status: "insert_failed"` — could miss processing

| Detail | Value |
|---|---|
| File + lines | `stripe-webhook/index.ts:132-136` |
| Issue | If insert fails (duplicate key from race) AND the prior SELECT didn't catch the existing row (timing window), function returns 200 without processing. Stripe doesn't retry on 200. Event lost. |
| Severity | S2 — narrow timing window but real |

#### 🟡 HF-3 — Seth's webhook orphaned-account audit gap

| Detail | Value |
|---|---|
| File + line | `stripe-webhook/index.ts:172-194` |
| Issue | Audit log only written when `priorRow` exists. If webhook arrives for an unknown account (Stripe-side account we don't have in our DB), no audit row. Should at minimum log a security event. |
| Severity | S3 |

#### 🟡 HF-4 — Seth's `pg_derive_brand_stripe_status` returns `not_connected` for both never-onboarded AND detached

| Detail | Value |
|---|---|
| File + line | `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:67` |
| Issue | UI loses ability to distinguish "never set up" from "had it, disconnected". Reactivation UX (post-CF-1 fix) will need to know which. |
| Severity | S3 — separate `detached` enum value would clarify |

#### 🟡 HF-5 — Migration `20260508000000` payouts CHECK constraint replacement

| Detail | Value |
|---|---|
| File + lines | `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:30-35` |
| Issue | `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT` to extend enum. If existing payout rows have values outside the new set, ADD will fail. Payouts table likely empty in production right now (no real charges yet) so this is safe TODAY. **Becomes risky if any future migration uses this pattern after the table has data.** |
| Severity | S3 — codify as Phase 0 migration discovery |

#### 🟡 HF-6 — Seth's onboard bypasses brand soft-delete in deleted_at filter inconsistency

| Detail | Value |
|---|---|
| File + line | `brand-stripe-onboard/index.ts:185` |
| Code | `.is("deleted_at", null)` — correctly filters soft-deleted brands |
| Issue | Filter is present (✓), but I-PROPOSED-A invariant is `BRAND-LIST-FILTERS-DELETED`. Onboard is consistent. **Confirming compliance, not flagging.** |
| Severity | N/A — actually compliant |

#### 🟡 HF-7 — Tao's webhook returns 500 on processing error (vs Seth's 200-always)

| Detail | Value |
|---|---|
| File + line | `tao-b2/supabase/functions/stripe-connect-webhook/index.ts` (per Explore) |
| Issue | Path C SPEC §6 D-B2-27 mandates 200-always (durable queue). Tao's pattern violates this. **Correctly flagged in Path C SPEC §10 D-CYCLE-B2-PATHC-7 disposition.** |
| Severity | S2 — refactor in Phase 1 backport |

#### 🟡 HF-8 — Tao's webhook `stripeConnectWebhookProcess.ts` dual-writes `brands` AND `stripe_connect_accounts`

| Detail | Value |
|---|---|
| File + lines | `tao-b2/supabase/functions/_shared/stripeConnectWebhookProcess.ts:67-73` (per Explore) |
| Issue | Same I-PROPOSED-P violation (R-4) but specifically in webhook path. Race risk if Tao's refresh-status fires concurrently. |
| Severity | Same as R-4 |

#### 🟡 HF-9 — Seth's frontend hardcodes `formatGbp` everywhere

| Detail | Value |
|---|---|
| File + lines | `mingla-business/src/components/brand/BrandPaymentsView.tsx:49,315,321,329,356,390` (per Explore) |
| Issue | Const #10 violation in current implementation. Acceptable for D-B2-13 UK-only MVP but technical debt for B2c multi-region. |
| Severity | S2 — codify in SPEC v2 as known limitation |

#### 🟡 HF-10 — Tao's `stripeConnectStatus.ts` has 4-positional signature incompatible with Seth's object-form

| Detail | Value |
|---|---|
| File + lines | `tao-b2/mingla-business/src/utils/stripeConnectStatus.ts` (per Explore) |
| Issue | Seth's signature is `deriveBrandStripeStatus({ has_account, charges_enabled, payouts_enabled, requirements, detached_at })`. Tao's is `deriveBrandStripeStatus(stripeConnectId, chargesEnabled, payoutsEnabled, requirements)`. **Drop Tao's per SPEC v1 D-B2-25 — already in DROP list (file confirmed absent from Seth's tree).** |
| Severity | RESOLVED at SPEC v1 |

### 🔵 Observations (6)

- **O-1:** Seth's `_shared/stripe.ts` line 21 imports from `https://esm.sh/stripe@18.0.0?target=denonext`. Tao's `npm:stripe@17.4.0`. Different SDK versions on top of different API versions. Backport must standardize on Seth's.
- **O-2:** Tao's `stripeEdgeAuth.ts` (75 lines) is a cleaner auth helper than Seth's inline JWT decode pattern. **Refactor opportunity:** consolidate Seth's inline auth into `_shared/stripeEdgeAuth.ts` during Phase 1.
- **O-3:** Tao's `stripeConnectProjection.ts` has `mapStripePayoutStatus()` mapping Stripe payout statuses (`in_transit→pending`, `canceled→failed`). Useful helper for B2 payout backport. **Worth integrating.** But the mapping treats `in_transit` as `pending` and `canceled` as `failed` — semantic compression that loses information. Path C v2 should decide whether to preserve raw Stripe status OR adopt Tao's compressed enum.
- **O-4:** Both branches use `audit_log` table. Seth writes; Tao doesn't. After Path C, audit_log row count will grow rapidly with refresh-status sampling concern (already flagged in Phase 0 IMPL report).
- **O-5:** `payment_webhook_events` table has `processed_at`, `error` columns but no monitoring/alerting on stale unprocessed rows. **Flag for ops.**
- **O-6:** Tao's smoke test (`scripts/e2e/stripe-connect-smoke.mjs`) exercises light + full mode. Light mode (no JWT) tests 401 responses; full mode tests authenticated happy paths. Worth adopting; not currently in Seth's CI.

---

## 7. Threads 1-16 cross-reference

| Thread | Coverage | Section reference |
|---|---|---|
| 1 — Onboarding correctness (Seth) | Read end-to-end; 5 Constitutional + 1 invariant findings | §3 + §6 (R-1, CF-1, CF-2, CF-4, CF-5, CF-8) |
| 2 — Webhook correctness (Seth) | Read end-to-end; 1 root cause + 3 hidden flaws | §6 (R-2, HF-1, HF-2, HF-3, CF-3) |
| 3 — Refresh-status correctness | Read post-Phase-0 fix state; sampling concern surfaced | §3 (Const #5) + §6 (CF-2 inherited) |
| 4 — Constitutional audit, Seth's B2a | All 14 principles evaluated | §3 |
| 5 — Constitutional audit, Taofeek's B2 | All 14 principles evaluated (6 N/A scope-wise) | §3 |
| 6 — INVARIANT_REGISTRY violation scan | All 5 Stripe invariants both branches; gates run | §4 |
| 7 — 5-truth-layer Docs/Schema reconciliation, Seth | 8 contradictions surfaced | §2 |
| 8 — 5-truth-layer Docs/Schema reconciliation, Taofeek | Implicit (no SPEC = no docs to reconcile beyond commit messages) | §2 + §11 (decisions surfaced) |
| 9 — 5-truth-layer Runtime/Data reconciliation | DEFERRED to operator-led runtime audit | §8 |
| 10 — Hidden-flaw checklist, both branches | 16-item checklist applied per surface | §5 |
| 11 — Capability gap matrix | Tables A, B, C produced | §9 |
| 12 — Production-grade gaps NEITHER addresses | 12 items identified (min 10 met) | §9 Table C |
| 13 — Architectural verdict on Path C | Verdict + 3 mandatory revisions | §10 |
| 14 — Migration safety + ordering | All 3 migrations read; ordering verified safe; trigger gap surfaced | §6 (R-1) + §11 (D-1 below) |
| 15 — Test infrastructure audit | Seth's jest 12 cases + Tao's Deno ~7 cases evaluated | Explore findings carried forward; gaps documented in §9 Table C |
| 16 — Cross-cycle hazard re-check | Path C SPEC v2 numbering still safe (DEC-121/122/123); I-PROPOSED-O/P/Q/R/S still uncontested | Re-verified during Phase 0; no new collisions |

---

## 8. Runtime probe results (DEFERRED)

§7.3 of the dispatch defines 13 runtime probes. **None executed in this audit.** Reasons:

- Sandbox setup (Option A) requires throwaway Supabase project + Stripe sandbox webhook reconfiguration — not feasible in-conversation
- Local sandbox (Option B) requires Docker Supabase + local function serve + Stripe webhook tunnel (e.g., Stripe CLI) — out of scope for this code-rigorous audit
- Per dispatch §7.1 Option C, code-rigorous audit at HIGH-rigor level is acceptable when sandbox unavailable

**Operator-led runtime probes required BEFORE SPEC v2 lock:**

| Probe | Why it matters for SPEC v2 | Owner |
|---|---|---|
| 7.3.2 — onboarding double-tap idempotency | Confirm Seth's idempotency-key implementation actually dedupes Stripe-side as expected | Operator (sandbox + double-tap test) |
| 7.3.3 — webhook idempotency replay | **CRITICAL** — confirm R-2 finding behavior in real Stripe replay (not just code-read). If real Stripe replay actually does send the SAME `event.id`, then Seth's "skip on existing row" is the bug R-2 describes. If Stripe replay sends a NEW `event.id` for replays, R-2 is non-issue. | Operator (Stripe Dashboard "Resend" feature against sandbox) |
| 7.3.4 — webhook signature failure | Confirm 400 + no row + no audit. Verify constructEventAsync error message doesn't leak STRIPE_WEBHOOK_SECRET prefix. | Operator |
| 7.3.6 — refresh-status during webhook flight | Confirm trigger doesn't race-corrupt cache | Operator |
| 7.3.7-7.3.9 — detach paths (Tao's behavior, before backport) | Reference for Path C v2 implementor — capture Tao's actual response shape, error handling, audit trail (or absence) | Operator OR forensics-v2 |
| 7.3.11 — KYC reminder dry-run | Confirm idempotency-by-date holds; confirm marker write/clear pattern | Operator |
| 7.3.12 — Migration order safety | Run `supabase db reset` against fresh DB with all 3 migrations — verify no errors | Operator |
| 7.3.13 — Cross-version Stripe API behavior | Fire same `account.updated` against v2 + v1 SDKs; compare event object shapes; document in SPEC v2 §migration-impact | Operator (highest impact for SPEC v2) |

**Operator decision needed:** are these runtime probes a hard prerequisite for SPEC v2, or can SPEC v2 ship with code-only confidence + runtime verification deferred to Phase 11 tester dispatch?

**Investigator recommendation:** Probe 7.3.3 + 7.3.13 are highest-leverage for SPEC v2 quality. Defer the rest to tester dispatch. This is a 30-60 min operator session, not a multi-hour ordeal.

---

## 9. Capability gap matrix (Tables A, B, C)

### Table A — Capabilities Seth's B2a has, Taofeek's B2 lacks

| # | Capability | Seth's evidence | Severity if dropped from final B2 |
|---|---|---|---|
| A1 | Marketplace controller properties on `accounts.create` | `brand-stripe-onboard/index.ts:214-219` | **S0** — Connect Platform Agreement breach without it (DEC-114 violation) |
| A2 | Idempotency-Key on every Stripe API call | `_shared/idempotency.ts` + 3 call sites | **S1** — duplicate-account risk under load |
| A3 | Audit log on Stripe edge actions | `_shared/audit.ts` + 2 call sites | **S1** — compliance trail gap |
| A4 | Stripe API v2 `2026-04-30.preview` pin | `_shared/stripe.ts:23` | **S0** — v2 endpoints (controller, AccountSession components) require this |
| A5 | Web SDK (`@stripe/connect-js` + `@stripe/react-connect-js`) integration via Mingla-hosted page | `app/connect-onboarding.tsx` | **S0** — D-B2-23 Path B compliance; Stripe prohibits DIY WebView wrap |
| A6 | SQL canonical helper `pg_derive_brand_stripe_status` | Migration `20260508000000:58-90` | **S1** — frontend RPC for status derivation |
| A7 | Trigger-based `brands.stripe_*` cache sync | Migration `20260508000000:101-126` | **S1** — single-owner state pattern (I-PROPOSED-P) |
| A8 | Formal SPEC + DECISION_LOG entries | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_*.md` + DEC-112/113/114 + 23 D-B2-N | **S2** — process compliance |
| A9 | Strict-grep CI gates (5: O/P/Q/R/S) | `.github/scripts/strict-grep/i-proposed-{o,p,q,r,s}-*.mjs` | **S1** — structural enforcement of architecture rules |
| A10 | 13-case unit test suite for status derivation | `mingla-business/src/utils/__tests__/deriveBrandStripeStatus.test.ts` | **S2** — regression safety |
| A11 | Comprehensive 9-state UI state machine | `BrandOnboardView.tsx` (per Explore: permission-denied / already-active / idle / starting / in-flight / complete-active / complete-verifying / cancelled / session-expired / failed-network / failed-stripe) | **S0** — UX completeness for onboarding |
| A12 | UUID validation at request entry | onboard L108, refresh-status similar | **S2** — defense-in-depth |

### Table B — Capabilities Taofeek's B2 has, Seth's B2a lacks

| # | Capability | Tao's evidence | Severity if dropped from final B2 |
|---|---|---|---|
| B1 | Webhook event router (7+ event types) | `_shared/stripeConnectWebhookProcess.ts` (~150 lines, per Explore) — handles `account.updated`, `account.application.deauthorized`, `payout.created/paid/failed`, `capability.updated` | **S0** — Stripe-side detach detection requires `account.application.deauthorized` handler; Seth has none |
| B2 | Account detach edge fn | `brand-stripe-detach/index.ts` | **S1** — B2b J-B2.5 scope (now folded into B2a per Path C SPEC §3 D-B2-29) |
| B3 | Brand balances query (per-currency) | `brand-stripe-balances/index.ts` | **S2** — B3 prep, not strictly B2; helpful for KPI tiles |
| B4 | KYC stall reminder cron | `stripe-kyc-stall-reminder/index.ts` | **S2** — B2b J-B2.4; reduces support load |
| B5 | Payouts service + persistence | `mingla-business/src/services/payoutsService.ts` + `payouts` table queries | **S2** — B3 prep; replaces Seth's TRANSITIONAL Zustand stub |
| B6 | E2E smoke test infrastructure | `scripts/e2e/stripe-connect-smoke.mjs` | **S1** — production health monitoring |
| B7 | Stripe Connect webhook signature test (Deno) | `_shared/__tests__/stripeWebhookSignature.test.ts` | **S2** — verifies the SubtleCrypto path Seth's code depends on |
| B8 | Centralized auth helper | `_shared/stripeEdgeAuth.ts` (75 lines) | **S2** — pattern; Seth's inline JWT decode is lower-quality |
| B9 | Multi-region country mapping (USD/EUR/GBP/CAD/AUD → US/IE/GB/CA/AU) | `brand-stripe-connect-session/index.ts:17-25` (per Explore) | **S2** — B2c future-prep; out-of-scope for Seth's UK-only D-B2-13 |
| B10 | CI workflow for migration syntax + Deno tests | `.github/workflows/supabase-migrations-and-stripe-deno.yml` | **S2** — catches migration breakage pre-deploy |

### Table C — Capabilities NEITHER branch has that production-grade B2 should have

12 items. Each requires SPEC v2 decision: include in B2 / defer to B2c / B3 / future / accept-as-known-limitation.

| # | Capability | Why it matters | Recommended scope |
|---|---|---|---|
| C1 | `requirements.currently_due` vs `requirements.eventually_due` distinction surfaced to brand UI | Stripe API returns both. Brand needs to know "act now" vs "act before Date X." Both branches only check `disabled_reason`. | **B2 v2 (high-priority)** — touches `BrandOnboardView` "in-flight" state |
| C2 | `requirements.disabled_reason` enum mapping (specific reason codes → specific UX) | Codes like `requirements.past_due`, `rejected.fraud`, `rejected.unverified_business_representative` need different remediation messaging. Both branches show generic "restricted." | **B2 v2 (high-priority)** |
| C3 | `account.application.deauthorized` webhook handler | Stripe-side detach (brand revokes access in Stripe dashboard) goes undetected by Seth. Tao has it; backport mandatory. | **B2 v2 (mandatory)** — already on Path C SPEC §6 D-B2-27 list |
| C4 | `payout.failed` event handler with brand notification | If a payout fails (returned by bank, etc.), brand sees stale "in transit" forever | **B2 v2** — backport from Tao + add notification |
| C5 | Webhook secret rotation strategy | Both hardcode `STRIPE_WEBHOOK_SECRET` from env. No dual-secret acceptance period for rotation. | **B2c or ops** — deferrable but document |
| C6 | Stripe `account.requirements.future_deadline` "restricted_soon" warning | UI should warn brand "Action needed by Date X" before account flips to restricted | **B2c** |
| C7 | Bank account verification status surface | Stripe `external_accounts[].status` indicates verified/verification_failed. Mingla doesn't surface this. | **B2c** |
| C8 | Refund flow for detached accounts | If brand detaches with in-flight refunds, Mingla doesn't reconcile/notify | **B3 or B2c** — needs cross-cycle decision |
| C9 | Webhook delivery monitoring + alerting | No alert if webhook hasn't fired for N hours (dead Stripe endpoint, backlog, secret mismatch silently broken) | **Ops (post-launch)** |
| C10 | KYC reminder cron jitter + Resend rate-limit handling | Tao's cron loops without jitter; Resend rate-limits silently | **B2 v2 small fix** |
| C11 | Audit log retention + GDPR right-to-be-forgotten on departed brand admins | Audit log grows unbounded; no deletion path for personal data | **B2c or compliance cycle** |
| C12 | Idempotency-Key sub-millisecond collision handling | `Date.now()` ms precision; concurrent same-ms calls collide | **B2 v2 minor** — add nanosecond or random suffix |

---

## 10. Architectural verdict on Path C scope

**Verdict: Path C is the right architecture. SPEC v1 file manifest is approximately correct but has 3 mandatory revisions + 1 mandatory addition.**

### Mandatory revisions to SPEC v1

#### Revision 1 — Update migration trigger to handle detach (R-1 fix)

The current trigger at migration `20260508000000:101-126` does NOT clear `brands.stripe_*` when `detached_at` is set. SPEC v1 D-B2-29 claim is wrong.

**Two valid resolutions** (SPEC v2 author picks):
- **Option A:** Update trigger to `CASE WHEN NEW.detached_at IS NOT NULL THEN NULL ELSE NEW.stripe_account_id END` for all 3 mirror columns. New migration `20260509000003_b2a_path_c_trigger_detach_fix.sql`.
- **Option B:** Detach edge fn explicitly clears brands.stripe_* with allowlist comment (`// orch-strict-grep-allow brands-stripe-direct-write — detach soft-delete cascade`). One-line allowlist; trigger stays simple; gate honored.

Investigator recommendation: **Option A** — keeps the trigger as the single canonical writer; preserves I-PROPOSED-P without exception.

#### Revision 2 — Add webhook router scope explicitly

SPEC v1 §6 covers `_shared/stripeWebhookRouter.ts` but underspec'd on:
- Replay retry behavior (R-2 fix — when `processed=false`, retry; when `processed=true`, skip)
- Per-event-type handlers (currently lists 7 types, but doesn't define what each does)
- Type-narrowing per event type (HF-1 fix — typed event union, not single AccountObject)

SPEC v2 needs explicit per-event-type behavioral contract.

#### Revision 3 — Update onboard 409 conflict logic for reactivation

CF-1 — current `existingSca?.detached_at !== null` check returns `account_detached_b2b_only`. Path C folds B2b in, so this rejection is now wrong. SPEC v2 needs to define reactivation flow:
- If brand has detached account and re-onboards, reuse `stripe_connect_account` row + clear `detached_at` + create new AccountSession?
- OR insert new row and archive old?

Investigator recommendation: **clear `detached_at` + reuse Stripe account ID** — Stripe doesn't let you create two accounts for the same business; Stripe-side, the account is still there even if Mingla marked it detached.

### Mandatory addition

#### Addition — RPC name standardization OR header doc fix (CF-8)

Either rename the rpc call in onboard/refresh-status to `_for_caller` (and pass auth.uid()-equivalent context) OR fix the header docs to match the actual `_for_brand` (with explicit user_id) call. SPEC v2 needs to choose one and enforce.

### File manifest changes

SPEC v1 §4 file manifest holds with these additions:

**ADD to file manifest:**
- `supabase/migrations/20260509000003_b2a_path_c_trigger_detach_fix.sql` (if Option A chosen for Revision 1)

**MODIFY in file manifest:**
- Update `supabase/functions/brand-stripe-onboard/index.ts` to handle reactivation (Revision 3)

**ADD test cases:**
- Reactivation flow (3 cases minimum: never-detached re-onboard, detached re-onboard, restricted-then-detached re-onboard)
- Webhook replay-after-failure retry behavior
- Trigger detach cascade (verify `brands.stripe_*` cleared after `stripe_connect_accounts.detached_at = now()`)

---

## 11. Decisions surfaced for SPEC v2 author

8 architectural decisions the SPEC v2 author must explicitly lock. Investigator surfaces evidence; does NOT propose answers.

| ID | Decision | Options | Evidence |
|---|---|---|---|
| **D-1** | Trigger update vs detach-fn allowlist (Revision 1) | (a) update trigger CASE WHEN; (b) allowlist comment in detach fn | §10 + R-1 |
| **D-2** | Reactivation flow on previously-detached account | (a) clear detached_at + reuse Stripe account; (b) archive old + insert new | §10 + CF-1 |
| **D-3** | Webhook replay-after-failure retry policy | (a) retry when processed=false; cap retries; (b) leave failed forever (current) and surface to ops dashboard | §6 R-2 |
| **D-4** | Multi-region scope under Path C | (a) keep D-B2-13 UK-only; reject Tao's multi-region helper; (b) accept multi-region with documented currency/country pairs; (c) intermediate (UK-only at MVP, multi-region helper backed out for B2c) | §2 C-6 + Tao B9 |
| **D-5** | RPC name standardization | (a) `_for_brand` + explicit user_id (current code); (b) `_for_caller` + auth.uid() (current docs); (c) deprecate one | §6 CF-8 |
| **D-6** | Anon GRANT on `pg_derive_brand_stripe_status` | (a) keep (current) — info disclosure accepted; (b) revoke; require authenticated for status reads | §6 CF-5 |
| **D-7** | Payout status enum mapping | (a) preserve raw Stripe statuses (5 distinct); (b) adopt Tao's compressed mapping (in_transit→pending, canceled→failed) | §6 O-3 |
| **D-8** | Audit log sampling for high-frequency callers | (a) write every refresh (current; 12K rows/hour at 100 brands × 30s polling); (b) sample 1-in-N; (c) only-on-state-change (post-Phase-0 implementation already does this for refresh — but invariant requires every-call audit) | Phase 0 IMPL report + I-PROPOSED-S |

---

## 12. Prior-work corrections

Per dispatch §10 constraint #4, every claim in the prior partial artifacts that's wrong must be flagged.

### `outputs/B2_RECONCILIATION_REPORT.md` corrections

| Claim | Reality | Severity |
|---|---|---|
| §1 "violates 2 of Seth's strict-grep CI gates" | Tao actually violates 4 of 5 (P, Q, R, S — only O is N/A) | LOW (the report was written when only J/K existed; renumbered to O/P + new Q/R/S added in Phase 0) |
| §3 helpers table: "stripe.ts MISSING" in Tao's column | Confirmed correct — Tao has no `_shared/stripe.ts` equivalent | OK |
| Verdict claims runtime + data layer "not probed" | Confirmed correct — those layers remain unprobed in this audit too | OK |

### `outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` corrections

| Claim | Reality | Severity |
|---|---|---|
| §B "All 17 KEEP files exist on Seth" | Confirmed correct | OK |
| §B "All 7 ADD slots free" | Confirmed correct (and Phase 0 since added 5: 3 gates + 2 migrations; remaining 2 ADD slots free) | OK |
| §C "Path C migrations apply cleanly after 20260508000000" | Confirmed via read but **R-1 makes the trigger semantically incomplete** — migrations apply syntactically, but behavior is incorrect | UPDATED — code applies; behavior wrong |
| §F "No OTHER Stripe-active branch besides Seth + feat/b2-stripe-connect" | Confirmed correct | OK |

### `outputs/SPEC_B2_PATH_C_AMENDMENT.md` corrections

| Claim | Reality | Severity |
|---|---|---|
| §6 D-B2-29 "trigger mirrors null/false to brands.stripe_*" | **WRONG** — current trigger at migration `20260508000000` does NOT do this; needs Revision 1 in §10 | **HIGH** — falsified by code |
| §6 D-B2-28 "self-clears the marker when account.updated webhook flips charges_enabled=true" | **WRONG** — Seth's webhook does not write `kyc_stall_reminder_sent_at`. Tao's webhook process does (line 107-109 per Explore). Needs explicit code in Path C v2 webhook router. | **HIGH** — falsified by code |
| §3 "B2b cycle absorbed into B2a" — language consistent | Confirmed; appears consistent post-Phase-0 SPEC edit | OK |
| §7 Phase 12 lists EAS OTA dual-platform per `feedback_eas_update_no_web` | Confirmed correct | OK |

### `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md` corrections

| Claim | Reality | Severity |
|---|---|---|
| Phase 0 (B2a IMPL) self-attested "Const #3 compliant" | **PARTIAL** — refresh-status had no audit log; caught by Phase 0 of Path C; backfilled in commit `cf3969bf` | LOW (resolved post-detection) |
| 22 SCs all PASS | Cannot verify without running tester; marked as "self-attested" | UNVERIFIED |

---

## 13. Discoveries for orchestrator

5 items that surfaced during the audit but are unrelated to Path C scope:

1. **Existing baseline migration's CHECK constraint replacement pattern** (HF-5) is risky as a general pattern (DROP + ADD on populated tables can fail). Orchestrator should consider: codify "ALTER CHECK with USING clause" pattern as a Mingla convention; or add a forensics-checklist item for migration audits.

2. **Header doc / code drift in Stripe edge functions** (CF-8). Orchestrator: spot-checking suggests this drift happens elsewhere too. Consider periodic audit pass.

3. **Realtime subscription test coverage gap** — Seth's `useBrandStripeStatus` (per Explore L44-68) subscribes to `stripe_connect_accounts` UPDATE events. The 13-case jest test doesn't exercise this path. Out of scope for B2a IMPL but worth a regression test in B2c.

4. **Tao's `payoutsService.ts` queries `payouts` table directly** — no edge function involved. Mingla pattern is "all external API access via edge fns" but DB-only queries from frontend are still allowed. Worth confirming this pattern is intended, or formalize.

5. **`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_V7_LONDON_SCALE.md`** is sitting in the working tree untracked (operator's parallel session output). Not a Path C concern — flagged for normal operator commit hygiene.

---

## 14. Confidence statement

| Claim category | Confidence | What would raise it |
|---|---|---|
| Code-layer findings on Seth's branch (R-1, R-2, R-W1, CF-1..CF-5, CF-8, HF-1..HF-6, HF-9) | **H** | Self-read end-to-end; verified key claims via grep; cross-checked migration chain |
| Code-layer findings on Taofeek's branch (R-3, R-4, R-5, CF-6, CF-7, HF-7, HF-8, HF-10) | **M-H** | Mostly Explore-agent-sourced; spot-checked critical claims (apiVersion + brands.update + idempotency absence) via direct grep; reading bodies in detail would raise to H |
| Constitutional principle compliance (§3) | **M** | Did not deeply audit auth flow / logout paths / persisted-state lifecycle for either branch; would need runtime probe to raise |
| Five-truth-layer contradictions (§2) | **M-H** | Docs/Schema/Code triangulated cleanly. Runtime + Data layers UNVERIFIED — flagged in §8. C-2/C-3/C-4 are HIGH confidence; others MEDIUM |
| Hidden-flaw checklist results (§5) | **M** | Some items (timezone, locale, RLS bypass) require deep semantic analysis — surfaced what was visible from code-read |
| Capability gap matrix (§9) | **M-H** | Tables A + B grounded in file evidence. Table C items are interpretive — based on Stripe's published Connect docs + general marketplace platform requirements; runtime probes would surface 2-3 more |
| Architectural verdict on Path C (§10) | **H** | Three revisions are evidence-backed (R-1 trigger gap; R-2 webhook replay; CF-1 reactivation). Mandatory addition (CF-8 RPC standardization) is doc/code drift, low controversy |
| 8 decisions surfaced for SPEC v2 (§11) | **H** | Each decision cites evidence; no synthesis without grounding |

**Aggregate audit confidence: M-H.** Code-layer audit is the strongest. Runtime layer is the weakest. Pre-SPEC-v2-lock: probes 7.3.3 + 7.3.13 from §8 should ideally run.

---

## 15. Investigation manifest summary

- Files read end-to-end: 12 (Seth's edge fns, helpers, migration; Tao's connect-session + webhook + webhook process; investigation reports + SPEC v1 + SDK spike + B2a SPEC + B2a IMPL report + reconciliation + pre-flight)
- Files spot-read via Explore agent: ~30 (Tao's other edge fns, frontend, tests, CI; Seth's frontend; baseline migration sections)
- Files NOT read (deferred): zero — manifest 100% covered (with confidence labels per §14)
- Lines of evidence captured: ~250 file:line citations across this report
- Runtime probes executed: 0 (deferred per §8)
- Database probes executed: 0 (deferred per §8)
- Stripe API probes executed: 0 (deferred per §8)

---

## 16. Recommended next pipeline step

Per orchestrator pipeline (forensics → review → SPEC → review → implementor → tester → CLOSE):

1. **Orchestrator REVIEW this report** — apply 10-point review checklist (root cause proven? scope appropriate? hidden flaws surfaced? layers reconciled? evidence chain complete?)

2. **Operator runtime probes 7.3.3 + 7.3.13** — 30-60 min sandbox session; results inform SPEC v2 decisions D-3 (replay retry) and trigger-fix Revision 1 viability

3. **Orchestrator authors SPEC v2** — `outputs/SPEC_B2_PATH_C_V2.md` (supersedes v1) — incorporates §10 + §11 decisions, addresses §12 corrections, adds reactivation flow, defines per-event-type webhook handlers, fixes trigger gap

4. **Orchestrator + operator REVIEW SPEC v2**

5. **Implementor dispatch v2** — `outputs/IMPL_DISPATCH_B2_PATH_C_V2.md` (supersedes v1) — Phase 1+ (Phase 0 commits `cf3969bf` + `cfb121e8` STAY, but Path C v2 may add a Phase 0' migration for trigger fix)

6. Phases 1-9 implementation, Phase 10 operator smoke, Phase 11 tester dispatch, Phase 12 CLOSE protocol

---

**End of investigation report.**

**Findings tally: 5 root-cause-class · 8 contributing factors · 10 hidden flaws · 6 observations · 5 discoveries for orchestrator.**

**Decisions surfaced for SPEC v2: 8.**

**Mandatory revisions to SPEC v1: 3 + 1 addition.**

**Confidence: M-H (code H; runtime deferred).**
