# REVIEW — ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-24
**Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/` on branch `orch-0915-buyer-pay-in-full-opt-out`
**Inputs reviewed:**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` (253 lines)
- `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` (428 lines)
**Repo HEAD spot-verified:** `4c0bd2d28e71001f603c03e4c395272a84890f58` ✓
**Latest local migration spot-verified:** `20260724000005_profile_circle_relationship_source.sql` → SPEC's `20260724000006` is monotonic-correct ✓
**Strict-grep gates spot-verified:** `i-proposed-finalize-callers-pass-installment-params.mjs` ✓ + `i-proposed-orch-0925-installment-plan-attaches-customer.mjs` ✓ exist on disk

---

## Verdict: APPROVED with operator-decision gating

Both artifacts pass the 10-item REVIEW protocol. Five minor observations are noted below for the implementor (none blocking). Implementation cannot start until operator answers the §12 Decision Register (4 live questions — §12 Q5 is a scope confirmation, not a decision).

---

## REVIEW Protocol — 10-item checklist

| Check | Verdict | Notes |
|---|---|---|
| Root cause proven or just plausible? | **PROVEN** | F-1 + F-2 cite exact file:line in current HEAD `4c0bd2d2`. UI lockout (`payment.tsx:503-599` has no choice state) + server lockout (`20260610000002...sql:262-381` auto-overrides `v_total` to deposit) are both source-cited. |
| Scope appropriate — could be narrower? | **TIGHT** | Pay-in-full opt-out on `payment.tsx` only + single new optional RPC parameter + no confirm/reconcile changes + no refund math + no tier-creator UI + no consumer app + no admin. Out-of-scope list (§1.2) is explicit and accurate. |
| Hidden fallback paths that mask failure? | **NONE** | §3.2 returns structured HTTP 400 for invalid choice; §3.3 RPC `RAISE EXCEPTION`; §3.4 explicitly forbids `{ installments: [] }` for opt-out to avoid edge code mistakenly treating it as a plan. |
| Stale cache paths serving old data? | **N/A** | Server-contract change; no existing React Query key shape affected. |
| Response shape truthful in ALL states? | **YES** | §3.4 + §3.5 enumerate all 3 states (no-plan / plan+full / plan+installments) with explicit `total_cents`, `installment_plan_root`, `installment_schedule`, `order_installments` per branch. §2.4 enumerates UI state transitions. |
| Real fix or symptom mask? | **REAL FIX** | Choice propagates through UI → service → edge → RPC → Stripe → finalize → cron, with explicit contract at each layer. |
| Solo/collab parity checked? | **N/A** | Buyer checkout has no solo/collab dimension. |
| Constitutional compliance? | **PASS** | #1 explicit segmented control with selected state + CTA; #3 structured 400 + RAISE EXCEPTION (no silent fallback); #9 amounts come from real `tier_metadata`; #12 validation at edge + RPC, not client-only. Others N/A. |
| Evidence chain complete? | **COMPLETE** | Investigation Manifest §3 lists 12 source files read. F-5 cites real strict-grep command run (4 callers, 1 free skip, 0 violations). SPEC §9 names 6 new test files + 5 existing test files to re-run. SC table (§8) spans 15 criteria across UI, state, service, edge, RPC, Stripe, DB, finalize, end-to-end, invariant, business UI, cross-surface, process layers. |
| Documents updated? | **PENDING** | WORLD_MAP.md ORCH-0915 banner needs phase update to SPEC_READY. Operator decisions captured below in §3. |

---

## Observations for implementor (non-blocking)

1. **F-5 drift acknowledged correctly.** ORCH-0921 close text claimed strict 8-param callers shipped, but ORCH-0924 rolled `ticket-checkout-confirm` and `reconcile-stuck-checkouts` back to 5-param allowlisted calls; the strict-grep gate accepts the rollback. SPEC §4.3 + §5.2 + §5.3 correctly say "no change in ORCH-0915" and defer 8-param re-ship to ORCH-0927. Implementor must NOT remove ORCH-0924 rollback allowlist comments.

2. **§3.3 migration filename is correct as of HEAD `4c0bd2d2`.** Latest local is `20260724000005`. SPEC §11.11 already covers the defensive case ("if remote head exceeds, choose higher prefix"). Implementor should re-check immediately before writing the migration in case anything else lands first.

3. **§4.1 native PaymentIntent guest-mode fallback** is referenced as "existing full-pay guest-mode fallback remains" but not fully specified. Implementor should source-read the current native PaymentIntent branch in `ticket-checkout-create/index.ts` lines 788-821 and confirm the existing fallback before writing the full-pay branch — do not invent a new fallback shape.

4. **§9 test file #4 location** — `supabase/functions/_shared/__tests__/orch_0915_create_session_choice_sql.test.ts` sits under `_shared` but tests SQL behavior, not a shared TS helper. Implementor may choose a more accurate path (e.g., a migrations test fixture or a dedicated `supabase/functions/ticket-checkout-create/__tests__/orch_0915_rpc_behavior.test.ts`). Pick what's natural; the gate cares about behavior coverage, not path purity.

5. **Tester adversarial direction (forward-looking — for the test-handoff prompt, not the implementor).** When this reaches `mingla-tester`, adversarial angles should attack: (a) invalid `payment_plan_choice` value rejection on both edge + RPC, (b) rapid toggle full↔installments mid-flight (state restore correctness), (c) multi-tier cart with mixed plan/non-plan tiers (current `ticket_lines_mixed_with_installments` guard must still fire), (d) browser refresh on `payment.tsx` re-hydrates choice, (e) Money tab renders correctly when one order is full-pay and another in the same trip is installment-plan (mixed-mode trip), (f) ORCH-0921 compare-and-correct still runs cleanly when buyer chose installments.

---

## Hard-guard verification table

| Hard guard from dispatch | SPEC honors it? |
|---|---|
| Preserve ORCH-0921/0925 installment behavior | ✅ §4.2 + §4.3 + §5.2/§5.3 explicitly leave confirm/reconcile and webhook router untouched; §10 SC-10/SC-11 enforce. |
| Do not re-ship ORCH-0927 confirm/reconcile changes inside ORCH-0915 | ✅ §1.2 out-of-scope explicit. §11.1 + §11.2 hard guard. |
| No refund UX/tier-creator/admin/consumer scope widening | ✅ §1.2 + §11.6 + §11.7 + §11.8 + §11.9. |
| Capture operator answers to decision register before IMPLEMENT | ⚠️ Pending — addressed in §3 below. |

---

## §3 Operator Decision Register — CAPTURED 2026-05-24

Operator confirmed all 4 SPEC-recommended defaults via `AskUserQuestion` this turn. These answers are binding on IMPLEMENT — any deviation by the implementor must come back through orchestrator REVIEW.

| # | Question | Operator answer | Effect on IMPLEMENT |
|---|---|---|---|
| 1 | Default selection when both options are available | **Pay full now** | `payment.tsx` initial state: `paymentPlanChoice = "full"` when a plan-active tier is selected. |
| 2 | Eligibility — which plan-active tiers offer opt-out | **All plan-active tiers** | No `tier_metadata.allow_pay_in_full` flag. No tier-creator UI change. RPC accepts `payment_plan_choice='full'` for any tier whose `tier_metadata.installments` would otherwise produce a valid schedule. |
| 3 | Refund-policy copy diff between branches | **Branch-specific copy only; no math changes** | Two copy blocks in `payment.tsx` per SPEC §2.5. No changes to refund endpoints, refund calculation, or cancellation routes. |
| 4 | Organiser-controlled disable toggle in this ORCH | **Defer to follow-up ORCH** | No tier_metadata flag, no organiser UI, no server validation gating opt-out by tier. If dogfooding later surfaces a need, register as new ORCH. |
| 5 | Native business checkout coverage | Scope confirmation only — covered by shared `payment.tsx` (SPEC §1.1 + §7) | No additional consumer-app or separate native checkout work required. |

---

## Downstream routing

After operator answers land:

1. Orchestrator amends this REVIEW §3 with the captured answers.
2. Orchestrator writes the IMPLEMENT dispatch prompt at `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`.
3. **Default IMPLEMENT owner:** Codex `implementor-mingla`.
4. After IMPLEMENT returns, orchestrator REVIEW + operator-gated `supabase db push` for migration + orchestrator deploys `ticket-checkout-create` edge function (preserve `verify_jwt` setting) + Vercel `[deploy]` decision (YES — `mingla-business/` UI touched) + EAS OTA decision (NO — no `app-mobile/` touched).
5. **Default TEST owner:** Claude `mingla-tester` with mandatory parity matrix: buyer-anon-web + business iOS + business Android + business web preview.
6. CLOSE per standard protocol with regression-test gate (Step 0.5) + DIAG reap (Step 1.5) + 1-PR-per-CLOSE on branch `orch-0915-buyer-pay-in-full-opt-out` → `main`.
