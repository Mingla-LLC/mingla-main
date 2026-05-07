# Handoff Brief — B2a Path C V3 — Post Phase 0''

**Context:** Mingla Business Cycle B2a Path C V3 (Stripe Connect marketplace integration). Sub-dispatch A (foundation: 12 migrations + invariants T/U/V/W + DEC-121/122/123 + RAK runbook) is committed (`d7159d39`). Phase 0'' (operator-side Stripe + Supabase env config) is now also complete. Ready to dispatch Sub-dispatch B.

## What's done

- ✅ Sub-dispatch A — foundation work committed + pushed (commit `d7159d39`)
- ✅ 12 V3 migrations applied to remote sandbox DB
- ✅ Stripe Connect activated on **`acct_1TTnt1PjlZyAYA40` (MINGLA LLC sandbox)** — note: NOT the original `acct_1TU23tIAdZKekynz`; we cut over to a new sandbox where Connect provisioning succeeded. Original account still has dormant artifacts (harmless).
- ✅ 6 RAKs created + scoped per `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- ✅ 2 webhook endpoints created in new account:
  - `we_1TUJa7PjlZyAYA40tgzJdvto` — Connect-context, 14 events
  - `we_1TUJaAPjlZyAYA40JfrGOZzW` — Platform-context, 2 events (`application_fee.created/refunded`)
- ✅ All 10 Supabase secrets set: `STRIPE_RAK_*` (6), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_PLATFORM` (NEW), `STRIPE_WEBHOOK_SECRET_PREVIOUS` (empty)
- ✅ Connect smoke test passed: `accounts.create` with controller properties returned valid connected account
- ✅ `stripe-values.md` gitignored (test-mode keys live there; never commit)

## SPEC amendments discovered this session (not yet applied)

Apply these to `outputs/SPEC_B2_PATH_C_V3.md` §6 before final CLOSE:

1. **NEW env var `STRIPE_WEBHOOK_SECRET_PLATFORM`** required — Connect platforms need TWO webhook endpoints (one for connected-account events, one for platform-account events like `application_fee.*`); each has its own signing secret. Sub-dispatch B's webhook handler must try BOTH `STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET_PLATFORM` (in addition to `_PREVIOUS` for rotation).
2. **Platform account ID = `acct_1TTnt1PjlZyAYA40`** (test mode). Production ID will be different — operator establishes during go-live.
3. **`account.requirements.updated` is NOT a real Stripe event name** — requirement changes propagate via `account.updated`. SPEC §7 event list should drop this entry; webhook router should detect requirement changes from `account.updated` event payload.
4. **Total subscribed events = 16** (not 14): 14 on Connect endpoint + 2 on Platform endpoint.

## Next action: dispatch Sub-dispatch B

In a fresh `/mingla-implementor` session, run:

> Take over. Read `outputs/IMPL_DISPATCH_B2_PATH_C_V3.md` §4 "Sub-dispatch B" and execute it. Apply the 4 SPEC amendments noted in `outputs/HANDOFF_B2a_PATH_C_V3_POST_PHASE_0PP.md` as you implement (don't wait for orchestrator to patch SPEC first — fold them in).

Sub-dispatch B scope (~12-18 hr): webhook router with 14+2 events + IP allowlist + dual-secret rotation (now triple-secret with PLATFORM) + RAK factory in `_shared/stripe.ts` + 4 new edge fns (brand-stripe-detach, brand-stripe-balances, stripe-kyc-stall-reminder extended, stripe-webhook-health-check) + multi-country onboard refactor for 34-country list.

## After Sub-dispatch B

Then Sub-dispatch C (~9-16 hr) — frontend + 3 new strict-grep gates T/U/V/W + 2 CI workflows + 3 runbooks. Then Phase 16-18: smoke + `/mingla-tester` + CLOSE protocol + EAS OTA dual-platform.

## Files to read first in new chat

1. This file — `outputs/HANDOFF_B2a_PATH_C_V3_POST_PHASE_0PP.md`
2. `outputs/SPEC_B2_PATH_C_V3.md` — binding contract; 18 V3 decisions; 34-country list; 16 webhook events
3. `outputs/IMPL_DISPATCH_B2_PATH_C_V3.md` — 3 sub-dispatch prompts; §4 = B
4. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — invariants T/U/V/W (DRAFT, flip ACTIVE on V3 CLOSE)
5. `Mingla_Artifacts/DECISION_LOG.md` — DEC-121/122/123
6. `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md` — for context on RAK scoping
7. `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_REPORT.md` — Sub-dispatch A IMPL report

## Operator (Seth) constraints to know

- Sequential pace: one step at a time, no parallel dispatches, wait for approval
- Diagnose-first: investigate + present in plain English before writing code
- No Co-Authored-By lines in commits
- Always offer commit message after implementation
- /ui-ux-pro-max preflight required for any visible UI work
- AskUserQuestion is strategic — reserve for path forks / blockers
- Detail in `outputs/` files; chat = ≤20 lines summary
