# Forensics Dispatch — Cycle B2a Path C Comprehensive Audit

**Skill to invoke:** `/mingla-forensics`
**Mode:** INVESTIGATE-only (NO spec authoring; NO implementation; NO code changes)
**Estimated effort:** 4-6 hours (code: 2-3 hr; runtime: 2-3 hr)
**Branch under examination:** `Seth` (current) AND `feat/b2-stripe-connect` (worktree at `/tmp/mingla-b2-comparison/tao-b2/`, HEAD `1039a1c3`)
**Operator's goal:** an airtight, evidence-backed gap inventory and architectural verdict on Path C scope BEFORE any new SPEC or implementor work runs.
**Output file:** `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md`

---

## §0 — Why this dispatch exists

Tonight's session caught **two SPEC contradictions** AFTER an initial reconciliation report and a 7-thread pre-flight investigation had already been written. Both contradictions (DEC-numbering collision with ORCH-0737 v6 lineage; I-PROPOSED-J letter collision with ORCH-0742 Zustand-J) survived the prior reviews. Phase 0 implementation also surfaced a real B2a IMPL gap (missing audit log on `brand-stripe-refresh-status`) that nobody caught in the original B2a IMPL review.

Pattern: **the existing reconciliation + pre-flight artifacts are partial and unproven.** They worked at code-reading depth on the surfaces I knew to inspect. They missed contradictions across cycles, missed Constitutional gaps in shipped B2a code, and made claims about Taofeek's runtime behavior that have not been verified against an actual deployed function.

Operator instruction (verbatim, 2026-05-06): *"we need a comprehensive forensics dispatch, then an airtight spec, then we have implementor implement it ... code + runtime, and yes, the forensics agent should know the existing reconciliation report + pre-flight investigation + current SPEC v1 exist — but explicitly read with skepticism (treat as starting hypotheses, not ground truth)."*

**This is a do-not-trust-anything-without-verifying audit.**

---

## §1 — Mission

Produce an investigation report that answers, with file-and-line evidence and runtime traces:

1. **Constitutional + invariant compliance** — every active Mingla Constitutional principle and every existing INVARIANT_REGISTRY entry, evaluated against BOTH implementations, with verdicts: COMPLIANT / VIOLATED / N/A. No N/A verdicts without explicit reasoning.

2. **Five-truth-layer reconciliation** — Docs / Schema / Code / Runtime / Data — for both branches. Where layers disagree, flag the contradiction with evidence from each layer.

3. **Brutal hidden-flaw checklist** — applied to every Stripe-touching surface (UI, hook, service, edge fn, helper, migration, RLS policy) on both branches.

4. **Complete gap inventory** — three matrices:
   - What Seth's B2a has that Taofeek's B2 lacks
   - What Taofeek's B2 has that Seth's B2a lacks
   - **What NEITHER has that a production-grade B2 must have** (this is the most important matrix — it surfaces things both engineers missed)

5. **Runtime evidence** — deployed-and-tested behavior of Taofeek's edge functions in a throwaway sandbox, with captured DB row state, network traces, error responses on edge cases, concurrent-call behavior. Stripe API responses inspected directly, not inferred from code.

6. **Architectural verdict on Path C** — does the file manifest in `outputs/SPEC_B2_PATH_C_AMENDMENT.md` §4 reflect the right merge, or does the evidence support a different scope? If a different scope is warranted, propose Path C' (refined) with reasoning. **Do not write the SPEC** — surface the architectural decisions the SPEC author needs to lock down.

---

## §2 — Prior partial work (read SKEPTICALLY — treat as hypotheses, not ground truth)

These artifacts exist from earlier in tonight's session. They were authored under context pressure with documented gaps. Read them, but **independently re-verify every load-bearing claim** before incorporating into your investigation. Where you find a claim wrong, flag it explicitly in your report under a "Prior-work corrections" subsection.

| File | What it claims | What's known to be partial |
|---|---|---|
| [outputs/B2_RECONCILIATION_REPORT.md](B2_RECONCILIATION_REPORT.md) | Side-by-side comparison of both implementations across 8 surfaces; lists 5 architectural divergences in Taofeek's branch (no controller properties, wrong API version, no idempotency, no audit, direct `brands.update`, etc.) | Authored via Explore subagent with selective reads. Spot-checked 5 critical claims via grep. NOT five-truth-layer. NO runtime verification. RLS posture, webhook duplicate handling, edge-state correctness all UNVERIFIED. |
| [outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md](B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md) | 7-thread audit (DEC numbers, file existence, migrations, branch drift, invariant inventory, concurrent work, git state); claims SPEC §4 file manifest 17/17 KEEP files exist + 7/7 ADD slots free + 4/4 DROP confirmed absent | Audited only what was known to look for. Missed I-PROPOSED-J letter collision with ORCH-0742 (caught later during Phase 0 INVARIANT_REGISTRY append). Missed B2a `brand-stripe-refresh-status` audit-log gap (caught by new I-PROPOSED-S gate during Phase 0 verification). May have missed others. |
| [outputs/SPEC_B2_PATH_C_AMENDMENT.md](SPEC_B2_PATH_C_AMENDMENT.md) | Path C SPEC v1 — locked decisions DEC-121/122/123 + D-B2-24..30, file manifest, 12-phase IMPL order, 30 SCs, 5 invariants (now O/P/Q/R/S after letter-collision fix) | Authored without a forensics-grade gap inventory. Phase numbers and SC count derived from B2a SPEC convention without independent verification that 30 SCs is the right number. File manifest may be incomplete (e.g., does every backported function need its own DECISION_LOG entry? does the SPEC under-spec or over-spec?). To be SUPERSEDED post-forensics. |
| [outputs/IMPL_DISPATCH_B2_PATH_C.md](IMPL_DISPATCH_B2_PATH_C.md) | Implementor dispatch for Path C v1 | To be REGENERATED post-forensics + new SPEC. |
| [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md](../../reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md) | Phase 0 IMPL report — what was done in commits `cf3969bf` + `cfb121e8` | Phase 0 only. Phases 1-9 deliberately deferred pending this forensics. |
| [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md](../../specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md) | Original B2a SPEC (now superseded by Path C v1, will be re-superseded by SPEC v2) | Was the basis for Seth's IMPL. NOT independently verified that every SC was actually tested at IMPL time. |
| [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md](../../reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md) | Seth's B2a IMPL report (claimed all 22 SCs PASS) | Audit-log gap on refresh-status proves the report's "Const #3 compliant" claim was overstated. Treat ALL self-attested compliance claims with skepticism. |
| [Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md](../../reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md) | The original B2 forensics done at the start of B2 cycle (before B2a was even named) — 4 root causes + 7 contributing + 9 hidden + 6 obs | Pre-dates Taofeek's branch. Did not contemplate parallel-implementation scenario. Useful for original-state baseline but not for current-state gap analysis. |
| [Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md](../../reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md) | D-B2-23 SDK strategy spike — recommended Path B (in-app browser → Mingla web page → connect-js) over Path A (RN preview) | Architectural decision basis. May still be correct; verify Stripe's RN preview eligibility hasn't moved since the spike. |
| `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` | Operator-side smoke checklist + setup instructions | Operationally relevant; not architecturally load-bearing. |

**Skepticism principle:** if a claim in any of the above contradicts what you find in the code or runtime, **the code/runtime wins**. Update the artifact later (orchestrator owns artifact updates; you flag the contradiction).

---

## §3 — Mandatory reads (no exceptions; not bound by §2's skepticism)

These are the actual code surfaces. Read every one before forming any conclusion.

### Seth's B2a (current `Seth` branch, working tree)

**Edge functions** (`supabase/functions/`):
- `brand-stripe-onboard/index.ts` (~345 lines)
- `stripe-webhook/index.ts` (~230 lines)
- `brand-stripe-refresh-status/index.ts` (~217 lines, **modified in Phase 0** to add audit log — read post-fix state)

**Shared helpers** (`supabase/functions/_shared/`):
- `stripe.ts`
- `idempotency.ts`
- `audit.ts`

**Migration:**
- `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql`

**Frontend** (`mingla-business/`):
- `src/services/brandStripeService.ts`
- `src/services/brandMapping.ts`
- `src/utils/deriveBrandStripeStatus.ts` + `__tests__/deriveBrandStripeStatus.test.ts`
- `src/hooks/useBrandStripeStatus.ts`
- `src/hooks/useStartBrandStripeOnboarding.ts`
- `src/hooks/useBrands.ts`
- `src/components/brand/BrandOnboardView.tsx`
- `src/components/brand/BrandPaymentsView.tsx`
- `app/connect-onboarding.tsx`
- `app/brand/[id]/payments/onboard.tsx`

**CI gates** (`.github/scripts/strict-grep/` + workflow):
- `i-proposed-o-stripe-no-webview-wrap.mjs` (was J)
- `i-proposed-p-stripe-state-canonical.mjs` (was K)
- `i-proposed-q-stripe-api-version.mjs` (NEW Phase 0)
- `i-proposed-r-stripe-idempotency-key.mjs` (NEW Phase 0)
- `i-proposed-s-stripe-audit-log.mjs` (NEW Phase 0)
- `.github/workflows/strict-grep-mingla-business.yml`

### Taofeek's B2 (worktree `/tmp/mingla-b2-comparison/tao-b2/`)

**Edge functions** (`/tmp/mingla-b2-comparison/tao-b2/supabase/functions/`):
- `brand-stripe-connect-session/index.ts` (~195 lines)
- `brand-stripe-refresh-status/index.ts` (~152 lines — same filename as Seth's, different code)
- `stripe-connect-webhook/index.ts` (~102 lines)
- `brand-stripe-detach/index.ts` (~117 lines)
- `brand-stripe-balances/index.ts` (~122 lines)
- `stripe-kyc-stall-reminder/index.ts` (~153 lines)

**Shared helpers** (`/tmp/mingla-b2-comparison/tao-b2/supabase/functions/_shared/`):
- `stripeEdgeAuth.ts` (~74 lines)
- `stripeConnectProjection.ts` (~111 lines)
- `stripeConnectWebhookProcess.ts` (~174 lines)

**Migrations:**
- `supabase/migrations/20260506120000_b2_payouts_stripe_id_unique.sql`
- `supabase/migrations/20260506130000_b2_kyc_stall_reminder.sql`

**Tests:**
- `supabase/functions/_shared/__tests__/stripeConnectProjection.test.ts`
- `supabase/functions/_shared/__tests__/stripeConnectWebhookProcess.test.ts`
- `supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts`
- `mingla-business/src/utils/stripeConnectStatus.ts` + `.test.ts`
- `scripts/e2e/stripe-connect-smoke.mjs`

**Frontend (Taofeek's):**
- `mingla-business/src/services/payoutsService.ts`
- Any modified `src/components/brand/` files (`git diff 25818f5b..origin/feat/b2-stripe-connect -- 'mingla-business/src/components/brand/'` — read each diff)

**CI workflows (Taofeek's):**
- `.github/workflows/stripe-connect-smoke.yml`
- `.github/workflows/supabase-migrations-and-stripe-deno.yml`

### Cross-cycle context (must understand to avoid future collisions)

- `Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md` — to understand why I-PROPOSED-J was used for Zustand
- `mingla-business/src/store/currentBrandStore.ts` — Phase 5/6 frontend hooks must respect this
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` lines 12-50 (Zustand-J entry) AND lines 2069+ (Stripe O/P/Q/R/S entries)

---

## §4 — Investigation threads (16 mandatory)

Each thread produces a report subsection with H/M/L confidence labels per finding and citations to file paths + line numbers OR runtime trace IDs.

### Thread 1 — Onboarding flow correctness (Seth's `brand-stripe-onboard`)

- Verify the v2 Accounts API call shape against current Stripe Accounts v2 preview docs
- Verify controller properties produce a true marketplace setup (Mingla = merchant of record, automatic transfer to brand on charge)
- Verify AccountSession creation grants the correct components (`account_onboarding`)
- Verify Idempotency-Key format + scope is correct (won't dedup legitimate retries; will dedup duplicate-create attempts)
- Verify the JWT auth + RLS gate (caller must be `payments_manager`-rank+ on the brand)
- Verify error paths: 401 / 403 / 404 / 409 / 502 — what does each return; is the message safe (no stripe key leakage)
- **Edge cases:** what happens if (a) brand already has an active `stripe_connect_accounts` row when create is called? (b) Stripe rate-limits during create? (c) brand is soft-deleted? (d) caller is a brand member but not payments_manager? (e) JWT is expired? (f) `default_currency` is missing or invalid?

### Thread 2 — Webhook correctness (Seth's `stripe-webhook`)

- Signature verification via `constructEventAsync` — is the SubtleCrypto path actually exercised? Construct a test signature manually + verify
- Durable-queue pattern: insert to `payment_webhook_events` BEFORE processing — verify order of operations under failure (DB write fails: do we still 200? Stripe replays: do we dedup?)
- 200-always behavior — verify under processing error, the row is marked `processed=false` AND `error=...` AND Stripe still gets 200 — so Stripe doesn't replay forever
- `account.updated` handler — what fields does it update? Are there fields it should but doesn't? (E.g., `requirements.currently_due`, `requirements.eventually_due`, `capabilities.card_payments.status`?)
- **Replay safety probe:** fire the same event twice; verify ONE row in `payment_webhook_events`, ONE row in `audit_log`, no duplicate state mutation
- **Out-of-order delivery:** Stripe doesn't guarantee event ordering. If `account.updated` arrives before `account.application.deauthorized`, what happens? Test it.
- **Unknown event types** — what does the handler do? Should be silent skip. Verify it doesn't throw.

### Thread 3 — Refresh-status correctness (Seth's, post-Phase-0 audit-log fix)

- Verify the new `writeAudit` call doesn't fail if `scaRow` is missing fields (e.g., on a brand that's never been onboarded)
- Verify the audit log row is written EXACTLY ONCE per refresh — not on error paths
- Sampling concern: 30s polling × N brands = audit log spam. Quantify: at 100 active brands × 1 refresh / 30s × 1 audit row = 12K rows/hour. Is that operationally acceptable? Surface for SPEC v2 decision.
- The `idempotencyKey: generateIdempotencyKey(brand_id, "refresh_status")` — does the epoch-ms scoping mean every poll has a unique key (good for retry safety) or are concurrent polls deduped (bad if one fails)?

### Thread 4 — Constitutional audit, Seth's B2a (every principle)

For each of Mingla's 14 Constitutional principles, verdict:
- COMPLIANT (with evidence)
- VIOLATED (with evidence + severity)
- N/A (with explicit reasoning why)

**No silent N/A.** Every principle must be exercised against onboarding + webhook + refresh-status.

### Thread 5 — Constitutional audit, Taofeek's B2 (every principle)

Same as Thread 4 but for all 6 of Taofeek's edge functions + 3 helpers + 2 migrations + frontend changes.

### Thread 6 — INVARIANT_REGISTRY violation scan, both branches

- I-PROPOSED-A through I-PROPOSED-S applied to both branches (where applicable)
- Run all 5 strict-grep gates against Taofeek's worktree: report violations with line numbers
- For each existing ACTIVE invariant (not just Stripe ones), check whether either branch's code path is exercised + compliant
- Flag any HIDDEN invariant violations not caught by strict-grep (semantic violations the gate doesn't detect because they require human reasoning)

### Thread 7 — Five-truth-layer Docs / Schema reconciliation, Seth's B2a

- **Docs:** what does B2a SPEC §3-6 promise? what does the IMPL report claim was delivered?
- **Schema:** what does migration `20260508000000` actually create? Read the SQL line-by-line.
- **Code:** what does the deployed code actually do? read every fn end-to-end
- Where do these three layers DISAGREE? List every contradiction.

### Thread 8 — Five-truth-layer Docs / Schema reconciliation, Taofeek's B2

Same as Thread 7 but for Taofeek's branch + the absent-SPEC reality (he has no SPEC; the docs layer is just commit messages + issue #47 — verify those are accurate).

### Thread 9 — Five-truth-layer Runtime / Data reconciliation (REQUIRES SANDBOX)

This is the runtime audit. Use the runtime plan in §7 below.

### Thread 10 — Hidden-flaw checklist, both branches (every item from `references/failure-patterns.md`)

For each pattern in failure-patterns.md, check both branches:
- Dead taps
- Silent catches
- Stale cache paths
- Response shape lies (e.g., returns `{success: true}` on a partial failure)
- Race conditions on concurrent-call paths
- Missing loading/error/empty/populated states
- Boundary errors (off-by-one, undefined-vs-null, etc.)
- Time-zone bugs (especially relevant for KYC stall reminder)
- Locale/currency assumptions (Taofeek's multi-region path; Seth's UK-only)
- Auth/RLS bypass paths
- Idempotency holes
- Persisted-state startup paths
- Test fixture vs production mismatches

### Thread 11 — Capability gap matrix

Three columns:

| Capability | Seth has | Taofeek has | Neither has but production B2 needs |
|---|---|---|---|

Examples to seed (verify all):
- Onboarding session creation
- AccountSession refresh on session expiry
- Webhook signature verification
- Webhook event handlers per type (account.updated / capability.updated / person.* / payout.* / charge.* / application_fee.* / transfer.* / account.application.deauthorized)
- Status derivation function (TS + SQL)
- KYC stall reminder
- Detach (soft delete; hard delete; partial detach)
- Balances retrieval (single-currency; multi-currency)
- Payout listing
- Payout reconciliation
- Refund handling
- Dispute handling
- Application fee handling
- Frontend onboard view + states (idle / loading / restricted / active / failed / detached)
- Frontend payments dashboard + KPI tiles
- Frontend disconnect CTA
- Frontend stall-recovery deep-link landing
- Tests (unit jest, unit Deno, integration, E2E smoke)
- CI gates (architecture, functional, migration syntax, secret scanning)

### Thread 12 — Production-grade gaps NEITHER branch addresses

Brutal: what should B2 ship that NEITHER engineer thought of? Examples to consider:

- Stripe webhook secret rotation strategy
- Stripe API key rotation strategy
- Connect Platform Agreement compliance (Mingla as marketplace must surface certain things to brands)
- 1099-K reporting handoff (Stripe owns this on Express; verify Mingla's UI doesn't claim otherwise)
- Brand offboarding when a brand member is removed but is the only payments_manager
- Stripe account in `restricted_soon` state — surfaced to brand?
- KYC currently_due vs eventually_due distinction — surfaced to brand?
- Stripe-side disable (account suspended) — what does Mingla's UI show?
- Multi-brand-per-user handling — does the UI clearly scope brand actions?
- Audit log retention + GDPR (right-to-be-forgotten on a brand admin who left)
- Webhook delivery monitoring + alerting (operator notification when webhooks haven't arrived in N minutes)
- Cron health monitoring for KYC reminder
- Test coverage for malicious webhook payloads (signature-valid but body-malformed)
- Currency conversion (brand has GBP account, customer pays USD — fee handling)
- Refund flow when brand has detached
- Payout failure recovery flow

Be exhaustive. Don't stop at "looks good." Identify everything a production-grade marketplace platform would need that's absent.

### Thread 13 — Architectural verdict on Path C scope

After Threads 1-12, answer:
- Is the file manifest in `outputs/SPEC_B2_PATH_C_AMENDMENT.md` §4 the right merge?
- Are there files in the DROP list that should actually be KEPT?
- Are there files in the KEEP list that should be DROPPED?
- Are there capabilities NEITHER has that the SPEC v2 should ADD?
- What is the right phasing? (current SPEC v1 has 12 phases — verify or propose alternative)
- What's the right SC count + coverage? (current SPEC v1 has 30 SCs — verify or propose alternative)

**Do not write the SPEC.** Surface the architectural decisions the SPEC author needs to lock down.

### Thread 14 — Migration safety + ordering audit

- Read all 3 Stripe-related migrations in their planned order (20260508000000, 20260509000001, 20260509000002)
- Verify no DROP COLUMN / RENAME / ALTER conflicts on a fresh DB
- Verify on an EXISTING DB (rolled forward from B1 baseline) the order applies cleanly
- Are there any TRIGGER conflicts? (B2a creates `tg_sync_brand_stripe_cache`; does any of Taofeek's planned forward-port re-create or shadow it?)
- Are there any RLS policy gaps? (e.g., a new column that lacks RLS)
- What's the rollback story per migration? Document.

### Thread 15 — Test infrastructure audit

- Verify Seth's `deriveBrandStripeStatus.test.ts` actually catches the regressions it claims (read each case + reason about what mutation would break it)
- Verify Taofeek's Deno tests run cleanly (`deno test` in his worktree — actually run them and capture output)
- Verify Taofeek's E2E smoke script (`scripts/e2e/stripe-connect-smoke.mjs`) — does it actually exercise the API contracts or is it a happy-path stub?
- What test categories are MISSING from both branches? (integration tests against deployed sandbox, contract tests, fuzz tests on webhook signatures, etc.)

### Thread 16 — Cross-cycle hazard re-check

- Re-verify all 5 audit threads from `outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` (DEC numbers, file existence, migrations, branch drift, invariants, concurrent work, git state) on the CURRENT repo state (post-Phase-0 commits `cf3969bf` + `cfb121e8`)
- Add a 6th: are there ORCHs landed since Phase 0 commit (commit `bbd28eed` was right after) that further muddy the picture?
- Confirm the renumbered DEC-121/122/123 are still free
- Confirm I-PROPOSED-O/P/Q/R/S are still uncontested

---

## §5 — Five-truth-layer inspection (must produce a contradiction matrix)

For each of the following questions, answer at all 5 layers and surface contradictions:

| Question | Docs says | Schema says | Code says | Runtime says | Data says |
|---|---|---|---|---|---|
| What states can a stripe_connect_account be in? | (per SPEC) | (per CHECK constraints + helper fn) | (per `deriveBrandStripeStatus`) | (per actual `account.updated` events fired) | (per actual rows in DB) |
| When is `kyc_stall_reminder_sent_at` cleared? | | | | | |
| What does a "detached" account look like? | | | | | |
| What happens on duplicate webhook event? | | | | | |
| What's the exact status of a brand when charges_enabled flips false but disabled_reason is null? | | | | | |
| Multi-region: does Seth's UK-only constraint hold under Taofeek's multi-region code? | | | | | |
| (add more questions you discover during the audit) | | | | | |

---

## §6 — Hidden-flaw checklist (apply to every Stripe-touching surface)

Mandatory items. Mark each as PASS / FAIL / N/A per surface, with citation:

1. **Dead taps** — Every interactive element responds. Disconnect CTA disabled in correct states.
2. **Silent catches** — `catch (e) {}` patterns. Errors must surface.
3. **Stale cache paths** — React Query staleTime / invalidation correctness.
4. **Response shape truthfulness** — In every state (loading / error / empty / partial / populated / submitting / offline), does the response shape match the type contract?
5. **Real fix vs symptom mask** — Is the fix at root cause or just suppressing symptoms?
6. **Solo/collab parity** — N/A here (Stripe Connect is single-context per brand).
7. **Auth/RLS bypass paths** — Service role calls; SECURITY DEFINER functions; RLS-bypassing patterns.
8. **Idempotency holes** — Concurrent-call duplication risks.
9. **Time-zone bugs** — KYC reminder day boundary; webhook event ordering.
10. **Currency-aware UI** — Per Constitutional #10.
11. **Persisted-state startup** — Brand selection survives restart correctly post-ORCH-0742 (currentBrand ID-only).
12. **Logout clears everything** — Per Constitutional #6.
13. **One auth instance** — Per Constitutional #11.
14. **Validate at right time** — Not too early (e.g., before user has typed) not too late (e.g., after submission).
15. **Exclusion consistency** — Same rules in generation and serving (does the `payments_manager` rank check happen consistently?)
16. **No fabricated data** — Per Constitutional #9 (do balances ever show stub/fake values?)

---

## §7 — Runtime audit plan (REQUIRED — code-only is insufficient)

The operator authorized runtime testing. This is the heart of the dispatch.

### 7.1 — Sandbox setup

**Option A (preferred):** spin up a throwaway Supabase project from the operator's existing Supabase org. Apply baseline + B1 + B2a + Path C planned migrations in order. Deploy BOTH Seth's edge functions AND Taofeek's edge functions to this sandbox under namespaced names so they don't collide (e.g., `seth-brand-stripe-onboard` vs `tao-brand-stripe-connect-session`).

**Option B (if 7.1A is blocked):** use local Supabase via Docker (`supabase db reset` + `supabase functions serve`). Apply migrations locally. Run edge functions locally with mock Stripe + sandbox webhooks.

**Option C (if 7.1A and 7.1B are blocked):** flag in the report under "Runtime audit limited" and proceed with code-only at HIGH-rigor level for the runtime threads.

Document which option was used and why.

### 7.2 — Stripe Connect sandbox setup

- Use the existing Mingla LLC Stripe sandbox (per `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md`)
- Confirm Connect is activated in sandbox; capture the platform settings; verify branding
- Set up webhook endpoint pointing to sandbox URL; capture `whsec_` secret
- Configure `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in sandbox env

### 7.3 — Behavioral probes (run against deployed sandbox)

For each probe, capture: HTTP request body, HTTP response body + status, DB row state before/after, audit_log rows produced, console logs, time taken.

#### Probe 7.3.1 — Onboarding happy path
- Create a Connect account via `brand-stripe-onboard`
- Open the AccountSession URL in a real browser
- Complete onboarding with Stripe test data (UK bank routing 108800, account 00012345)
- Capture the redirect; verify deep link
- Verify `stripe_connect_accounts` row state at each step
- Verify `audit_log` rows at each step
- Verify trigger mirrored fields to `brands.stripe_*`

#### Probe 7.3.2 — Onboarding with rapid double-tap (idempotency stress)
- Fire 10 concurrent `brand-stripe-onboard` calls for the SAME brand
- Verify Stripe creates exactly ONE account (idempotency holds)
- Verify exactly ONE `stripe_connect_accounts` row exists post-test
- Capture the Stripe API request log to confirm dedup behavior

#### Probe 7.3.3 — Account.updated webhook idempotency
- Trigger `account.updated` from Stripe Dashboard
- Verify ONE row in `payment_webhook_events`
- Resend the same event 5 times via "Resend" button
- Verify still ONE state mutation (audit_log shows replay-skipped)
- Verify all 5 deliveries returned 200

#### Probe 7.3.4 — Webhook signature failure
- Send a webhook payload with corrupted signature
- Verify 400 / 401 (whichever is the contract)
- Verify NO row in `payment_webhook_events`
- Verify NO state mutation
- Verify error logged

#### Probe 7.3.5 — Webhook with malformed body but valid signature
- Send a syntactically valid signature over a body that doesn't match Stripe's event shape
- Verify graceful rejection without crash
- Verify no state mutation

#### Probe 7.3.6 — Refresh-status during webhook flight
- Trigger an `account.updated` (still in flight)
- Concurrently call `brand-stripe-refresh-status` 5 times
- Verify final state is consistent (no last-writer-wins corruption)
- Verify audit log records both webhook-driven update AND refresh-driven updates without conflict

#### Probe 7.3.7 — Detach happy path (Taofeek's `brand-stripe-detach`)
- Create a brand with active stripe_connect_account
- Call `brand-stripe-detach` with valid JWT + payments_manager
- Verify Stripe API receives `accounts.del()` call
- Verify `stripe_connect_accounts` row remains (not deleted) but `detached_at` set
- Verify `brands.stripe_*` mirrored to null/false via trigger

#### Probe 7.3.8 — Detach when Stripe rejects del()
- Force a Stripe error (e.g., account in active payouts state may reject del)
- Verify local detach still succeeds (per D-B2-29)
- Verify audit log captures Stripe rejection reason

#### Probe 7.3.9 — Detach as marketing_manager (RLS gate)
- Try to detach as a brand member with rank < payments_manager
- Verify 403
- Verify NO state mutation
- Verify audit log records the attempt (security event)

#### Probe 7.3.10 — Balances retrieval
- Call `brand-stripe-balances` for a brand with charges/payouts
- Verify response shape matches contract (minor units, currency)
- Verify multi-currency case (if Stripe returns multi-currency balance)
- Verify rate-limit handling (loop the call 100x; observe Stripe rate-limit response)

#### Probe 7.3.11 — KYC stall reminder dry-run
- Set a brand to `charges_enabled=false` with `created_at < now() - 24h`
- Trigger the cron function manually
- Verify Resend email goes out (or dry-run flag)
- Verify `kyc_stall_reminder_sent_at` set
- Verify second invocation doesn't re-send (idempotency by date)
- Verify `account.updated` flipping `charges_enabled=true` clears the marker

#### Probe 7.3.12 — Migration order safety
- Roll back to B1 baseline; apply in order: 20260508000000, 20260509000001, 20260509000002
- Capture any errors
- Roll back differently: 20260508000000, 20260509000002, 20260509000001
- Verify same result (no order dependency between the two new ones)

#### Probe 7.3.13 — Cross-version Stripe API behavior
- Fire the same `account.updated` event against:
  - A Stripe client pinned to `2026-04-30.preview` (Seth's)
  - A Stripe client pinned to `2024-11-20.acacia` (Taofeek's reference)
- Capture the parsed event objects
- Document any field shape differences (this confirms the API-version-pin invariant value)

### 7.4 — Frontend runtime probes (Expo Web; iOS sim if accessible)

- Open `mingla-business` in browser
- Sign in as a brand admin
- Navigate to /brand/[id]/payments
- Observe state transitions through onboarding flow
- Capture screenshots / DOM state at each transition
- Verify Realtime banner update fires within ~5s of webhook
- Verify back-button + deep-link return paths

---

## §8 — Gap inventory framework

Produce three ranked tables (highest impact first):

### Table A — Capabilities Seth's B2a has that Taofeek's B2 lacks

| Capability | Why it matters | Severity if dropped |
|---|---|---|
| (e.g., marketplace controller properties) | DEC-114 compliance; Mingla = merchant of record | S0 (Connect Platform Agreement breach without it) |

### Table B — Capabilities Taofeek's B2 has that Seth's B2a lacks

| Capability | Why it matters | Severity if dropped |
|---|---|---|

### Table C — Capabilities NEITHER branch has that production B2 must have

| Capability | Why it matters | Severity if dropped | Recommended scope (B2 / B2c / B3 / future) |
|---|---|---|---|

This third table is the most important. Include MINIMUM 10 items.

---

## §9 — Output structure (the actual investigation report)

Write a single artifact: `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md`.

Mandatory sections:

1. **Header** — date, branches, commits, sandbox setup option used (7.1A/B/C)
2. **Executive verdict** — 5-line summary suitable for the operator to read first; what's the architectural recommendation, what's the most dangerous unresolved finding, what's the SPEC v2 author's most consequential decision
3. **Five-truth-layer contradiction matrix** (per §5)
4. **Constitutional compliance scorecard** — both branches, all 14 principles, with verdicts + evidence
5. **Invariant compliance scorecard** — both branches, all I-* invariants
6. **Hidden-flaw checklist results** — both branches, every item from §6
7. **Thread 1-16 findings** — each thread per §4 with H/M/L confidence + evidence per claim
8. **Runtime probe results** — each probe per §7 with captured evidence
9. **Gap inventory** — Tables A, B, C per §8
10. **Architectural verdict on Path C** — does the current SPEC v1 file manifest hold? what should change?
11. **Decisions surfaced for SPEC v2 author** — list of architectural decisions the SPEC writer needs to lock; do NOT write the SPEC, just surface the decisions
12. **Prior-work corrections** — every claim in the prior partial artifacts (§2) that turned out to be wrong, with citation to the wrong claim AND citation to the correct evidence
13. **Discoveries for orchestrator** — anything unrelated-but-found during the audit
14. **Confidence statement** — for every load-bearing claim in the report, declare H/M/L confidence; for every L-confidence claim, state what would raise it to M or H

---

## §10 — Constraints (non-negotiable)

1. **Investigate ONLY.** No SPEC writing. No code changes. No artifact updates beyond the investigation report. The SPEC v2 author will incorporate your findings later.
2. **No invocation of other agents.** Don't dispatch implementor, tester, or designer.
3. **No silent claims.** Every load-bearing assertion has a citation: file path + line number, OR runtime trace (with timestamp + DB row ID), OR explicit "INFERRED — confidence L because ___."
4. **Skepticism toward §2 prior artifacts.** Re-verify every claim. Where the artifacts are wrong, flag it.
5. **No N/A without reasoning.** Every checklist item must explicitly say PASS / FAIL / N/A WITH REASON.
6. **No padding.** The report should be dense evidence, not narrative. Tables + bullet lists preferred.
7. **No summary paragraphs.** Per `feedback_no_summary_paragraph` — the report IS the artifact.
8. **No "looks good" verdicts.** Either it's COMPLIANT with evidence, or it's a finding.
9. **Don't run destructive operations on the production DB.** Sandbox only. If sandbox isn't available, document the limitation in the report — don't risk prod.
10. **Don't burn the operator's Stripe live-mode quota.** Sandbox keys only.
11. **No new memory files.** If you find new patterns worth memorializing, surface them under "Discoveries for orchestrator" — orchestrator owns memory updates.
12. **No SPEC authoring of any kind.** Even partial. Even "here's what the SPEC should say." Surface decisions, don't draft language.

---

## §11 — Cross-references

- Reconciliation report: [outputs/B2_RECONCILIATION_REPORT.md](B2_RECONCILIATION_REPORT.md) — read with skepticism per §2
- Pre-flight investigation: [outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md](B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md) — read with skepticism per §2
- Path C SPEC v1 (to be SUPERSEDED): [outputs/SPEC_B2_PATH_C_AMENDMENT.md](SPEC_B2_PATH_C_AMENDMENT.md)
- Phase 0 IMPL report: [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md](../../reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md)
- Original B2a SPEC: [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md](../../specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md)
- Original B2 forensics: [Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md](../../reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md)
- D-B2-23 SDK spike: [Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md](../../reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md)
- ORCH-0742 SPEC (cross-cycle context): [Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md](../../specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md)
- INVARIANT_REGISTRY: [Mingla_Artifacts/INVARIANT_REGISTRY.md](../../INVARIANT_REGISTRY.md)
- Operator handoff (smoke checklist): `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md`
- Reference tree: `/tmp/mingla-b2-comparison/tao-b2/` (worktree at HEAD `1039a1c3`; verify drift at start of dispatch)

---

**End of forensics dispatch.**

When the operator dispatches this prompt, the agent's output goes to `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md`. Orchestrator will then:

1. REVIEW the investigation per the 10-point review checklist
2. If APPROVED → author SPEC v2 to `outputs/SPEC_B2_PATH_C_V2.md` (supersedes v1)
3. REVIEW SPEC v2
4. Author Implementor dispatch v2 to `outputs/IMPL_DISPATCH_B2_PATH_C_V2.md` (supersedes v1)
5. Operator dispatches `/mingla-implementor` against the new dispatch
6. Phases 1-9 (or revised phasing per the new SPEC) run

Phase 0 commits `cf3969bf` + `cfb121e8` STAY (foundation work is sound, verified by the new strict-grep gates). SPEC v2 may revise the phasing OR file manifest — but Phase 0 deliverables don't get unwound.
