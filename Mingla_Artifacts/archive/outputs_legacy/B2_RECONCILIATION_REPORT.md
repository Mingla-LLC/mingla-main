# B2 Stripe Connect — Reconciliation Report

**Date:** 2026-05-06
**Status:** Pre-decision. B2a smoke setup HALTED on operator request pending strategic decision.
**Branches compared:**
- **A — Seth's B2a** — `Seth` (HEAD `26e0a147`). Built via orchestrator pipeline (forensics → SPEC → IMPL).
- **B — Taofeek's B2** — `feat/b2-stripe-connect` (HEAD `1039a1c3`). Built independently by Taofeek F. Obafemi-Babatunde with Cursor AI co-author. PR #47 NOT merged to `main`.

Both branches shipped on **2026-05-06**, hours apart, with no coordination. Common merge-base: `25818f5b "Seth (#62)"`.

---

## TL;DR — what's actually going on

Two engineers shipped competing Stripe Connect implementations on the same day. They have **overlapping function names**, **incompatible Stripe API versions**, and **violate each other's architectural invariants**. The two branches **cannot be deployed simultaneously** without breakage.

- **Seth's B2a** — narrow, spec-compliant, locked to onboarding-only. Marketplace charge model fully wired. Idempotency + audit + trigger-only state sync enforced. 13 unit tests. 2 strict-grep CI gates. Formal SPEC + DECISION_LOG entries.
- **Taofeek's B2** — broader: onboarding + detach + balances + KYC reminder + payout tracking. Has Deno tests + smoke E2E + 2 CI workflows. **But** lacks marketplace controller properties, idempotency, audit logging, and SQL canonical status helper. Bypasses trigger-only invariant by writing `brands.stripe_*` directly. **No SPEC artifact, no DECISION_LOG entries** — operates outside orchestrator discipline.

The *technically broader* implementation (Taofeek's) ships with **architectural debt** that violates 2 of Seth's strict-grep CI gates (I-PROPOSED-P) and skips locked decisions (controller properties, API version pin, idempotency).

---

## §1 — Architecture decision compliance

| Decision | Seth's B2a | Taofeek's B2 | Match? |
|---|---|---|---|
| Account type = Express (DEC-112) | `type: "express"` | `type: "express"` (line 127) | ✅ |
| Routing = brand-level (DEC-113) | `stripe_connect_accounts.brand_id` FK | Same | ✅ |
| Charge model = Marketplace (DEC-114) | controller properties on account.create | **Missing entirely.** Generic `accounts.create({type, country, email, capabilities, metadata})` at lines 126-135 — NO `controller: { ... }` block. **VERIFIED.** | ❌ **CRITICAL** |
| API version = `2026-04-30.preview` (D-B2-5, Accounts v2) | `STRIPE_API_VERSION = "2026-04-30.preview"` | `apiVersion: "2024-11-20.acacia"` (line 108). Production v1. **VERIFIED.** | ❌ **CRITICAL** |
| SDK strategy = Path B (D-B2-23) — in-app browser → Mingla page → connect-js | Implemented per spec | Path B implied; same general approach | ✅ approximately |
| Idempotency-Key on every Stripe call (D-B2-22) | `_shared/idempotency.ts` enforces format `{brand_id}:{op}:{epoch_ms}` | **Zero** Idempotency-Keys on Stripe API calls in any of his 6 edge functions. **VERIFIED.** | ❌ **SAFETY RISK** |
| Region = UK only (D-B2-13) | UK/GBP wired | Multi-region via `countryFromDefaultCurrency()` (USD→US, EUR→IE, etc.) | ❌ scope expansion |

**Summary:** Taofeek implements the high-level decisions (Express + brand-level + Path B) but skips three load-bearing locked decisions: marketplace controller properties, the Accounts v2 API version, and idempotency keys. Without controller properties, "Mingla = merchant of record" (DEC-114) is not actually configured in Stripe — Mingla would receive 100% of charges and have to manually transfer to brands.

---

## §2 — Edge functions

### Seth's 3 functions (B2a scope only)

| Function | Path | Lines | Behaviour |
|---|---|---|---|
| `brand-stripe-onboard` | `supabase/functions/brand-stripe-onboard/index.ts` | 345 | Creates Stripe v2 account WITH controller properties. Creates AccountSession for embedded onboarding. Idempotency-Key on both calls. Audit-log on success. JWT auth. Inserts into `stripe_connect_accounts`; trigger mirrors to `brands`. |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | 230 | Verifies signature via `constructEventAsync` (Deno SubtleCrypto safe). Durable-queue: insert to `payment_webhook_events` first, return 200 to Stripe, then process inline. Currently handles only `account.updated` (B3/B4 deferred). |
| `brand-stripe-refresh-status` | `supabase/functions/brand-stripe-refresh-status/index.ts` | 217 | 30s polling fallback. Pulls fresh state from Stripe, updates `stripe_connect_accounts`, calls SQL `pg_derive_brand_stripe_status()`, returns derived status + raw flags. |

### Taofeek's 6 functions (B2 + B2b + bits of B3)

| Function | Lines | Notes |
|---|---|---|
| `brand-stripe-connect-session` | 195 | Onboarding session creator. **No controller props.** No idempotency key. Multi-region. **Writes `brands.stripe_*` directly** (line 158) — violates I-PROPOSED-P. |
| `brand-stripe-refresh-status` | 152 | ⚠️ **SAME FILENAME AS SETH's** — different code. |
| `stripe-connect-webhook` | 102 | Different name from Seth's. Returns 500 on processing error (vs Seth's 200-always durable-queue). Routes to `processConnectEvent()` helper. |
| `brand-stripe-detach` | 117 | NEW — B2b feature, not in Seth's spec. `stripe.accounts.del()` + DB cleanup. |
| `brand-stripe-balances` | 122 | NEW — B3 territory. `stripe.balance.retrieve()` per connected account. |
| `stripe-kyc-stall-reminder` | 153 | NEW — B2b J-B2.4. Resend email when `charges_enabled=false` and reminder not yet sent. |

### Filename collision: `brand-stripe-refresh-status`

Both implementations have a function with this filename. Whichever is deployed second clobbers the other.

| Aspect | Seth | Taofeek |
|---|---|---|
| Input shape | `{ brand_id }` (snake_case) | `{ brandId }` (camelCase) |
| Output shape | `{ status, charges_enabled, payouts_enabled, requirements, detached_at }` | `{ stripeAccountId, chargesEnabled, payoutsEnabled, requirements }` (camelCase, no `status`, no `detached_at`) |
| Calls SQL helper `pg_derive_brand_stripe_status()` | YES (line 192) | NO — returns raw flags only |
| Direct `brands.update` | NO (trigger handles it) | YES (line 123) — **violates I-PROPOSED-P** |
| Idempotency-Key | YES (line 157) | NO |
| Side effect: clears `kyc_stall_reminder_sent_at` | NO (column doesn't exist on Seth's branch) | YES (line 108) |

**Frontend impact if swapped:** any client written for one will break on the other. snake_case vs camelCase and the `status` field disappearing both cause silent UI failures.

---

## §3 — Shared helpers

| Helper | Seth | Taofeek | Compatible? |
|---|---|---|---|
| `_shared/stripe.ts` | Stripe client + `STRIPE_API_VERSION = "2026-04-30.preview"`. Throws on missing secret. | MISSING. Each function instantiates its own client inline with `2024-11-20.acacia`. | ❌ Two API versions in one repo would create unpredictable webhook + account behaviour |
| `_shared/idempotency.ts` | `{brand_id}:{op}:{epoch_ms}` format. Mandatory per D-B2-22. | MISSING. **Zero** idempotency keys on Stripe calls (verified across all 6 functions). | ❌ Concurrent calls risk duplicate accounts |
| `_shared/audit.ts` | Mandatory audit-log writes per Const #3. | MISSING. **Zero** audit log writes in Stripe edge functions. | ❌ No compliance trail |
| `_shared/stripeEdgeAuth.ts` | MISSING — Seth inlines auth checks. | NEW — `requireUser()`, `requirePaymentsManager()`, `serviceRoleClient()` helpers. | ✅ Complementary, could backport to Seth's tree |
| `_shared/stripeConnectProjection.ts` | MISSING — uses SQL `pg_derive_brand_stripe_status()` instead. | NEW — TS-only `deriveBrandStripeStatus(stripeConnectId, ...)` (4 positional args, NOT object). | ⚠️ Different API signature than Seth's `deriveBrandStripeStatus({...})` TS twin. Not interchangeable. |
| `_shared/stripeConnectWebhookProcess.ts` | MISSING — Seth handles `account.updated` inline. | NEW — handles `account.updated`, `account.application.deauthorized`, `payout.*` (paid/created/failed), `capability.updated`, `person.*` etc. | ✅ Complementary; Taofeek's router is a generalization of Seth's inline logic |

---

## §4 — Schema / migrations

| Migration | Seth's `20260508000000_b2a_stripe_connect_onboarding.sql` | Taofeek's two migrations | Conflict? |
|---|---|---|---|
| `stripe_connect_accounts.detached_at` | ADDED (B2b prep) | MISSING. **VERIFIED.** | ⚠️ B2b detach work would need this column on Taofeek's branch too |
| `payouts.status_check` enum extension | Adds `'in_transit'`, `'canceled'` | MISSING — but Taofeek's `mapStripePayoutStatus()` writes `'in_transit'` and `'canceled'` to the column | ❌ **SCHEMA BREAKAGE** if Taofeek's webhook fires before Seth's migration runs |
| `idx_payment_webhook_events_created_at` | ADDED (cron perf) | MISSING | Additive, safe |
| `pg_derive_brand_stripe_status()` SQL helper | CREATED (canonical, SECURITY DEFINER, callable by anon/auth/service_role) | MISSING. Frontend RPC call would 404. | ❌ Frontend can't derive canonical status without this |
| `tg_sync_brand_stripe_cache` trigger | CREATED — one-way sync `stripe_connect_accounts` → `brands.stripe_*` | MISSING. Taofeek bypasses trigger pattern by writing `brands` directly. | ❌ **Architectural violation** of I-PROPOSED-P |
| `b2_payouts_stripe_id_unique` | NOT INCLUDED | UNIQUE constraint on payouts.stripe_payout_id | Additive, useful |
| `b2_kyc_stall_reminder` (column) | NOT INCLUDED | `stripe_connect_accounts.kyc_stall_reminder_sent_at` | Additive |

**Key conflict:** Taofeek's edge functions assume schema state that only Seth's migration provides (the extended payouts enum). Seth's migration assumes nothing of Taofeek's schema. **Migration order matters and is not symmetric.**

---

## §5 — Frontend

| Aspect | Seth | Taofeek |
|---|---|---|
| Service file | `src/services/brandStripeService.ts` | `src/services/payoutsService.ts` (different name) |
| Status derivation function signature | `deriveBrandStripeStatus({ has_account, charges_enabled, payouts_enabled, requirements, detached_at })` (object) | `deriveBrandStripeStatus(stripeConnectId, chargesEnabled, payoutsEnabled, requirements)` (4 positional) |
| Detached_at handling | Tested explicitly (3 cases) | Not handled |
| Test count | 13 jest cases | 4 vitest cases (frontend) + 6 Deno cases (backend) |

**Frontend code written for Seth's signature CANNOT call Taofeek's function without rewrite.**

---

## §6 — Tests

| Suite | Cases | Coverage |
|---|---|---|
| Seth: `deriveBrandStripeStatus.test.ts` (jest) | 13 | All 4 status branches; cache shapes; payouts-not-gating-active; restricted-overrides-charges; null charges_enabled. **Maps to SC-01..SC-12** (12 of 22 SCs). |
| Taofeek: `stripeConnectStatus.test.ts` (vitest) | 4 | 4 branches lightly. Missing: detached, cache shapes, edge cases. |
| Taofeek: `stripeConnectProjection.test.ts` (Deno) | 6 | Same 4 branches + payout status mapping + Stripe→DB projection. |
| Taofeek: `stripeConnectWebhookProcess.test.ts` (Deno) | ~4 | `connectedAccountId`, payout.paid upsert, deauthorize, account.updated. |
| Taofeek: `stripeWebhookSignature.test.ts` (Deno) | 1 | `generateTestHeaderStringAsync` + `constructEventAsync` contract. |
| Taofeek: `scripts/e2e/stripe-connect-smoke.mjs` | E2E | Light (401 without JWT) + full (refresh + balances + brands read). |

**Verdict:** Seth's tests are deeper on state machine; Taofeek's are broader on webhook + integration. **Combinable** — no overlap that creates conflict.

---

## §7 — CI workflows

| Workflow | Seth | Taofeek |
|---|---|---|
| Architecture-invariant gates | `i-proposed-o-stripe-no-webview-wrap.mjs` (Embedded SDK only — no DIY WebView wrap) + `i-proposed-p-stripe-state-canonical.mjs` (no direct `brands.stripe_*` writes) | NONE |
| Functional regression | NONE | `stripe-connect-smoke.yml` (light + full smoke, daily + workflow_dispatch) |
| Migration safety | NONE | `supabase-migrations-and-stripe-deno.yml` (`supabase db reset` syntax check + Deno test runner) |

⚠️ **Taofeek's code FAILS Seth's I-PROPOSED-P gate.** Direct `brands.update({ stripe_connect_id, ... })` in 2 edge functions (verified line 158 + line 123). The strict-grep gate already caught zero violations on Seth's tree; merging Taofeek would surface them.

**Verdict:** **Complementary, not redundant.** Final state should keep all 4 workflows.

---

## §8 — Orchestrator artifact discipline

| Artifact | Seth | Taofeek |
|---|---|---|
| SPEC file | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md` (~870 lines) | NONE |
| IMPL report | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md` (~870 lines) | NONE |
| DECISION_LOG entries | DEC-112 / DEC-113 / DEC-114 + 23 D-B2-N decisions | None |
| INVARIANT_REGISTRY entries | I-PROPOSED-O + I-PROPOSED-P (DRAFT, ratify on CLOSE) | None |
| WORLD_MAP / PRIORITY_BOARD updates | Yes | None |

**Verdict:** Taofeek's branch operates entirely outside the orchestrator artifact system. PR #47 was issued and merged into a feature branch without spec, decision log, invariant registry, or report. This is a **process-level finding** — Mingla's orchestrator pipeline did not see this work.

---

## §9 — Cross-cutting observations

1. **API version mismatch is irreconcilable in a single repo** — Accounts v2 (`/v2/core/accounts`) only exists in `.preview` API versions. Production v1 (`2024-11-20.acacia`) does not have the v2 controller properties endpoint. The two cannot coexist.
2. **Marketplace setup is a Stripe Dashboard config + code config** — without controller properties on `accounts.create`, the platform must be manually configured in Stripe Dashboard for marketplace mode. Taofeek's path means operators rely on dashboard config alone, harder to audit + can drift.
3. **I-PROPOSED-P violation is provable** — verified `from("brands").update({ stripe_connect_id, ... })` at `brand-stripe-connect-session/index.ts:158` and `brand-stripe-refresh-status/index.ts:123`. The strict-grep gate on Seth's branch would block merging Taofeek's code into a tree that has the gate.
4. **Webhook event coverage is asymmetric** — Seth's `stripe-webhook` handles ONLY `account.updated`. Taofeek's `stripe-connect-webhook` handles 8+ event types, including all the payout.* events Mingla needs for B3 KPIs.
5. **No durable-queue protection in Taofeek's webhook** — returns 500 on processing error. Stripe will retry, but in the meantime the operator has no `payment_webhook_events` row to reconcile from.
6. **Detached account handling is incomplete in Taofeek** — adds reminder column but not detached_at. Means full B2b cycle still needs schema work even if Taofeek's branch wins.

---

## §10 — Risks per path

### Path A — KEEP_SETH_DROP_TAO

**Pros:**
- Spec-compliant, audit trail intact, marketplace controller properties wired correctly
- All architectural invariants enforced by CI gates
- B2a scope honored; B2b deferred decisions stand
- Decision log + spec readable by future engineers

**Cons (= deferred Taofeek work):**
- Detach flow (B2b J-B2.5) not built — must be done in B2b cycle
- KYC stall reminder (B2b J-B2.4) not built — same
- Account balances API not built — B3 work
- No payout webhook handling — B3 work
- No E2E smoke CI — lose Taofeek's regression net
- No Deno-side webhook contract test — lose Taofeek's `constructEventAsync` test
- ~4-6 hours of Taofeek's dev work goes to "reference branch" status

**Effort to ship:** continue current B2a smoke + CLOSE protocol. **0 extra dev work.**

### Path B — KEEP_TAO_DROP_SETH

**Pros:**
- Broader feature set immediately available (detach + balances + KYC reminder + payouts)
- Better webhook handler coverage (8+ event types)
- E2E smoke + Deno tests + migration syntax CI
- More complete payout tracking for future B3

**Cons:**
- ❌ Marketplace charge model (DEC-114) not actually implemented — controller properties absent
- ❌ Stripe API version mismatch — must downgrade Seth's locked decision (D-B2-5)
- ❌ I-PROPOSED-P invariant violated — direct `brands.stripe_*` writes
- ❌ Idempotency missing on all Stripe calls — duplicate-account risk under load
- ❌ Audit logging absent — compliance regression
- ❌ SQL canonical status helper absent — frontend RPC would 404
- ❌ No spec / no decision log — process compliance regression
- ❌ Strict-grep gates would need to be turned OFF or rewritten
- ❌ Locked decisions DEC-112/113/114 + D-B2-3/5/22/23 effectively unilaterally overruled by Taofeek without orchestrator review

**Effort to ship:** ~12-16 hours to fix architectural debt before this is safely shippable (add controller properties, upgrade API version, add idempotency, add audit, add SQL helper, add spec retroactively, fix strict-grep violations). **At which point Path C is cheaper.**

### Path C — REBASE_TAO_ONTO_SETH (merge best of both)

**Pros:**
- Keeps Seth's compliant core (controller properties, API v2, idempotency, audit, SQL helper, strict-grep)
- Backports Taofeek's complementary additions:
  - `brand-stripe-detach` (refactored to use idempotency + audit + trigger-only)
  - `brand-stripe-balances`
  - `stripe-kyc-stall-reminder`
  - `stripeConnectWebhookProcess.ts` (refactored as a router for `stripe-webhook`)
  - Taofeek's CI workflows (smoke + migrations + Deno tests)
  - Taofeek's Deno test files
- Result: **B2 + B2b shipped together** instead of split across two cycles

**Cons:**
- ~6-10 hours of careful integration work
- Naming reconciliation: drop `brand-stripe-connect-session`, keep Seth's `brand-stripe-onboard`. Drop `stripe-connect-webhook`, keep Seth's `stripe-webhook` (rebrand handler with Taofeek's router). Decide on one `brand-stripe-refresh-status` (Seth's signature wins per spec).
- Need new SPEC (or SPEC amendment) authorizing scope expansion to B2 + B2b
- New DECISION_LOG entries documenting why Taofeek's work was integrated
- Tester dispatch covers a wider surface area

**Effort to ship:** ~6-10 hours integration + smoke + tester. **Best long-term outcome IF B2b features are wanted now.**

### Path D — KEEP_SETH_NOW + REBASE_TAO_LATER

**Pros:**
- Ship B2a now per current path. No delay.
- Treat Taofeek's branch as a "B2b/B3 spike" — review at B2b SPEC time, cherry-pick integrated then.
- Lowest risk, decision deferred, no scope creep.

**Cons:**
- B2b stays gated until B2a stable (per cycle gate chain)
- Wastes Taofeek's work for ~weeks
- May feel disrespectful to Taofeek's effort if not communicated

**Effort to ship:** **0 extra now.** B2b cycle later picks up the integration cost.

---

## §11 — Recommendation

**Path D — KEEP_SETH_NOW + REBASE_TAO_LATER.**

Reasoning:
1. B2a is mid-cycle and minutes away from smoke. Pivoting to Path B or Path C delays ship by days.
2. Taofeek's work is real and useful but operates outside orchestrator discipline. Bringing it in requires retroactive spec + decisions + invariant ratification — better done as a focused B2b cycle than as a panicked merge under B2a CLOSE pressure.
3. Path D preserves both: B2a ships compliant; Taofeek's code is preserved at branch tip for B2b dispatch to ingest.
4. Path C remains available later — Taofeek's branch doesn't expire, and the integration cost is the same whether paid now or in 1-2 weeks.

**This is the orchestrator's recommendation, not a fait accompli.** The operator may legitimately choose Path C if they want B2 + B2b shipped together in one cycle. Path B is not recommended unless the operator decides the architectural decisions DEC-112/113/114/D-B2-5/D-B2-22/I-PROPOSED-P are wrong (which would be a separate strategic conversation, not a merge decision).

---

## §12 — What needs to happen next (operator decisions)

1. **Pick a path** from §10 (A / B / C / D).
2. If Path A or D: resume B2a smoke setup checklist (Steps 4-9 of `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md`). Talk to Taofeek about timing for B2b ingest.
3. If Path C: orchestrator authors B2-merged SPEC amendment and integration prompt; operator dispatches `/mingla-implementor` against it; Taofeek's branch becomes input. ~6-10 hours integration.
4. If Path B: orchestrator + operator unwind DEC-112/113/114 + D-B2-5/22/23 + I-PROPOSED-O/P. This is a major strategic reset and not recommended without specific reasons.
5. **Communicate with Taofeek** regardless of path — he doesn't know B2a exists; this is also a coordination problem to fix at the team-process level (how does parallel engineering work get visibility before duplication?).

---

## Appendix — Verified evidence (spot-checked claims)

All 5 critical claims spot-checked against Taofeek's working tree at `/tmp/mingla-b2-comparison/tao-b2/`:

1. ✅ API version `"2024-11-20.acacia"` — verified at `supabase/functions/brand-stripe-connect-session/index.ts:108`
2. ✅ No controller properties on `accounts.create` — verified at lines 126-135 (no `controller:` key)
3. ✅ Direct `brands.update({stripe_connect_id, stripe_charges_enabled, stripe_payouts_enabled})` — verified at:
   - `brand-stripe-connect-session/index.ts:158`
   - `brand-stripe-refresh-status/index.ts:123`
4. ✅ Zero Idempotency-Keys on Stripe calls — `grep -rn "Idempotency-Key\|idempotencyKey" supabase/functions/` returns only Resend email idempotency, not Stripe
5. ✅ `detached_at` column not in Taofeek's migrations — `grep -in "detached_at" supabase/migrations/20260506*.sql` returns nothing

---

**Worktree for further inspection:** `/tmp/mingla-b2-comparison/tao-b2/` (detached HEAD on `1039a1c3`). Remove with `git worktree remove /tmp/mingla-b2-comparison/tao-b2` when no longer needed.
