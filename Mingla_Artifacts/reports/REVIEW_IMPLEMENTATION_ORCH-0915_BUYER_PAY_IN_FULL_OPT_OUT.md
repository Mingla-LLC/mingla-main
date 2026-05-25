# REVIEW IMPLEMENTATION — ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-24
**Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/`
**Branch:** `orch-0915-buyer-pay-in-full-opt-out`
**Branch base (merge-base with main):** `4c0bd2d2`
**Current `main` HEAD:** `e8892fec`
**Branch is BEHIND main by 4 commits** — see §1 verdict.

**Inputs reviewed:**
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` (239 lines)
- `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`

---

## 1. Verdict: **BLOCKED**

The ORCH-0915 feature implementation itself is correct and ready — code, tests, migration, strict-grep gate, and constitutional posture all pass review. But the branch base is stale: Codex cut from `4c0bd2d2` (the HEAD when SPEC was written) and never rebased. Between `4c0bd2d2` and current `main` HEAD `e8892fec`, four commits landed — most importantly **ORCH-0949 [Intake form clarity for organisers] CLOSED Grade A** (PR #196). The current diff against `main` therefore **deletes** four ORCH-0949 files that shipped 2026-05-24:

1. `mingla-business/src/components/trip/IntakeSchemaBuilder.tsx` — 40 lines removed (upfront-clarity banner JSX + styles)
2. `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` — 14 lines removed (buyer-side one-line context)
3. `mingla-business/src/components/trip/__tests__/IntakeClarityCopy_orch_0949_adversarial.test.ts` — DELETED (141 lines, immutable per `tests-append-only.yml`)
4. `mingla-business/src/components/trip/__tests__/IntakeClarityCopy_orch_0949_regression.test.ts` — DELETED (93 lines, immutable per `tests-append-only.yml`)

If this branch merges as-is, it ships a **silent ORCH-0949 regression** and violates the append-only-tests CI invariant. The implementation report does NOT disclose any of these touches — they appear nowhere in §4 Files Read, §6 Old To New Receipts, or §17 Open Items, which means the implementor was unaware the deletions were happening (the branch was simply behind main).

**Block status applies until §3 remediation completes.** Migration push and edge deploy are paused. The ORCH-0915 feature work itself is sound and survives the rebase verbatim — only the diff frame needs correcting.

---

## 2. REVIEW protocol — 10-item checklist (feature work)

| Check | Verdict | Notes |
|---|---|---|
| Root cause proven or just plausible? | **PROVEN** (carried from SPEC review) | UI lockout fix + server lockout fix both delivered with matching tests. |
| Scope appropriate — could be narrower? | **TIGHT (ORCH-0915 itself)** + **VIOLATED (stale base regressing ORCH-0949)** | The ORCH-0915 product code is in scope; the ORCH-0949 deletions are an out-of-scope regression introduced by branch staleness, not by implementor design choice. |
| Hidden fallback paths that mask failure? | **NONE in ORCH-0915 work** | Edge returns structured `payment_plan_choice_invalid` 400; RPC `RAISE EXCEPTION`; full branch produces `installment_schedule = NULL` per SPEC §3.4 — no `{ installments: [] }` mis-shape. |
| Stale cache paths serving old data? | **NONE** | No React Query key changes. Idempotency-key change (`supabase/functions/_shared/ticketCheckout.ts`) is correct — adds `full`/`installments` suffix only when explicitly chosen, preventing cross-branch session reuse. |
| Response shape truthful in ALL states? | **YES** | SC-07/SC-09 covered by RPC + finalize tests; SC-08 covered by edge Deno test; SC-12 covered by Money tab test. |
| Real fix or symptom mask? | **REAL FIX** | Choice propagates through UI → service → native bridge → edge → RPC → Stripe → finalize → cron exactly as SPEC required. |
| Solo/collab parity checked? | **N/A** | Buyer checkout has no solo/collab dimension. |
| Constitutional compliance? | **PASS** | Rules #1, #3, #9, #12 verified in implementor report §15 + reviewer spot-check of payment.tsx + edge index.ts. |
| Evidence chain complete? | **MOSTLY** | Fails-on-revert evidence at `041d81d2` cited correctly (§13). 3 strict-grep gates re-run cleanly by reviewer: ORCH-0921 (191 files, 0 violations), ORCH-0925 (191 files, 0 violations), new ORCH-0915 (4 files, 0 violations). One gap: implementor §17 mentions ORCH-0882 stale test + broad TS errors but does not isolate them to a pre-existing-on-main baseline — see §4 below. |
| Documents updated? | **MOSTLY** | INVESTIGATION/SPEC/REVIEW artifacts still untracked in this worktree's `git status` (implementor never `git add`'d them); will need to be committed before the CLOSE PR. WORLD_MAP/PRIORITY_BOARD/MASTER_BUG_LIST/WORKTREE_REGISTRY index diffs touched — must be re-checked post-rebase since they may also be stale-base relics. |

---

## 3. Required remediation (before migration push or edge deploy)

The implementor (or the operator, whichever is faster) must run these steps in order, inside the same worktree:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]"

# 1) Sync the anchor's view of main, then rebase this branch onto it.
git fetch origin main
git rebase origin/main

# 2) Expected conflicts: NONE on ORCH-0915 files (Codex's edits are in payment.tsx,
#    ticketCheckoutService.ts, nativeCheckoutFlow*, ticket-checkout-create/, _shared/ticketCheckout.ts,
#    new migration, new strict-grep gate, new test files, money-redesign.test.tsx —
#    none of which ORCH-0949 touched). If a conflict appears, STOP and report;
#    do not "resolve" by deleting either side.

# 3) After rebase completes, the 4 ORCH-0949 files must be present and unchanged
#    from origin/main. Verify:
git diff origin/main -- \
  mingla-business/src/components/trip/IntakeSchemaBuilder.tsx \
  mingla-business/app/checkout-trip/[tripEventId]/intake.tsx \
  mingla-business/src/components/trip/__tests__/IntakeClarityCopy_orch_0949_adversarial.test.ts \
  mingla-business/src/components/trip/__tests__/IntakeClarityCopy_orch_0949_regression.test.ts
# Expected output: empty (no diff).

# 4) Re-run the 3 strict-grep gates to confirm rebase didn't break them.
node .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs
node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs
node .github/scripts/strict-grep/i-proposed-pay-in-full-opt-out-no-installment-rows.mjs
# All 3 must print "0 violations".

# 5) Re-run the ORCH-0915 jest + deno tests to confirm rebase didn't break them.
cd mingla-business
npx jest 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice.test.tsx' \
         'src/services/__tests__/ticketCheckoutService.orch0915.test.ts' \
         'app/trip/\[id\]/money/__tests__/money-redesign.test.tsx' --runInBand
cd ..
/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts
/Users/sethogieva/.deno/bin/deno test --allow-read \
  supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice.test.ts \
  supabase/functions/ticket-checkout-create/__tests__/orch_0915_rpc_behavior.test.ts

# 6) Re-confirm migration filename monotonicity post-rebase.
ls supabase/migrations/ | tail -5
# Expected: 20260724000006_orch_0915_pay_in_full_opt_out.sql is still the highest after origin/main's 20260724000005.

# 7) Add and amend the SPEC/INVESTIGATION/REVIEW artifacts (still untracked).
git add Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md \
        Mingla_Artifacts/reports/INVESTIGATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md \
        Mingla_Artifacts/reports/REVIEW_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md \
        Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md
git commit -m "ORCH-0915 spec + investigation + reviews"
```

After step 7, return to the orchestrator with the post-rebase HEAD hash so the orchestrator can spot-verify the 4 ORCH-0949 files are restored, then issue an APPROVED follow-up and proceed to migration push + edge deploy.

---

## 4. Observations carried forward from implementor §17

### 4.1 ORCH-0882 stale test (`InstallmentScheduleDisplay_wiring.test.ts`)

Implementor §17 reports this test still expects `InstallmentScheduleDisplay` in `app/trip/[id]/index.tsx` MoneyTabBody, but ORCH-0913 moved Money to its own route. **Verdict: pre-existing-on-main, not ORCH-0915's regression.** Confirm by running the test against current `origin/main` (post-rebase) and showing it ALSO fails there. If it does fail on main, this is its own follow-up cleanup ORCH (likely `[TEST-MOD-APPROVED ORCH-NNNN]` after register). If it does NOT fail on main, then ORCH-0915 broke it and we have a new P1. Reviewer cannot determine which without the comparison run — implementor must capture and include this in the post-rebase report.

### 4.2 Broad `tsc --noEmit` failures in `mingla-business` and `app-mobile`

Implementor §17 says these are pre-existing. **Verdict: plausible but unproved in the report.** Same diagnosis pattern: run `tsc --noEmit` against `origin/main` post-rebase and compare error counts. If counts match, the failures are unrelated and ORCH-0915 ships. If ORCH-0915 introduced new TS errors, those become P1 and block again. Implementor must include this comparison in the post-rebase report — single-line "passed at main HEAD vs at HEAD" is sufficient.

### 4.3 Supabase CLI not linked from this worktree

Implementor §17 reports `supabase migration list --linked` failed with `Cannot find project ref. Have you run supabase link?`. This is a tooling gap, not a code gap. Reviewer re-ran from anchor `/Users/sethogieva/Desktop/mingla-main` and got the same result — the project ref is missing from BOTH checkouts' `supabase/config.toml` link metadata. **Verdict: not blocking; orchestrator can re-confirm migration list at deploy time via `mcp__supabase__list_migrations` (project ref hardcoded) instead.**

---

## 5. Hard-guard verification table

| Hard guard from dispatch | Implementation honors it? |
|---|---|
| Preserve ORCH-0921 invariant + gate passing | ✅ Gate re-run by reviewer: 191 files, 4 finalize callers, 1 free skip, 0 violations. |
| Preserve ORCH-0925 invariant + gate passing | ✅ Gate re-run by reviewer: 191 files, 1 Checkout caller, 2 PI callers, 0 violations. |
| Do not re-ship ORCH-0927 confirm/reconcile changes | ✅ `git diff main..HEAD -- supabase/functions/ticket-checkout-confirm supabase/functions/reconcile-stuck-checkouts supabase/functions/_shared/stripeWebhookRouter.ts` produces empty output. |
| No refund UX/math/tier-creator/admin/consumer scope widening | ✅ Diff scope clean on those dimensions. |
| No refund UX changes in `payment.tsx` | ✅ Spot-checked — only copy additions per SPEC §2.5. |
| Legacy `auto` behavior for omitted choice | ✅ Edge defaults to `'auto'`; RPC migration has `DEFAULT 'auto'`; service omits the field when undefined. |
| No `supabase db push` from implementor | ✅ Implementor §17 explicitly notes BLOCKED status. |
| No edge-function deploy from implementor | ✅ §18 defers to orchestrator. |
| Scoped commits only | ❌ **VIOLATED** — see §1 verdict. Branch is behind main and ships an ORCH-0949 regression. |

---

## 6. Documents updated — pending post-rebase

After the rebase + restore, the orchestrator will:

1. Update `Mingla_Artifacts/WORLD_MAP.md` ORCH-0915 banner from `SPEC ready` → `IMPLEMENTATION APPROVED, awaiting migration push + edge deploy`.
2. Update `Mingla_Artifacts/WORKTREE_REGISTRY.md` ORCH-0915 row phase column → `IMPLEMENT APPROVED + post-rebase`.
3. Append a row to `Mingla_Artifacts/AGENT_HANDOFFS.md` for the Codex implementor return + reviewer verdict.
4. Confirm `Mingla_Artifacts/PRIORITY_BOARD.md` ORCH-0915 entry still names ORCH-0915 as the next active item.

All four edits ship in the same per-ORCH worktree, committed alongside the SPEC/INVESTIGATION/REVIEW artifacts in step 7 of §3.

---

## 7. Downstream routing — POST-REBASE only

Once §3 remediation is complete and reviewer spot-verifies the 4 ORCH-0949 files are restored, the path forward is:

1. **Operator** runs `cd "/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]" && /Users/sethogieva/bin/supabase db push --linked` to apply migration `20260724000006_orch_0915_pay_in_full_opt_out.sql`. (Orchestrator notes: the worktree's Supabase CLI may need a `supabase link --project-ref gqnoajqerqhnvulmnyvv` first; the anchor's link state appears missing too.)
2. **Orchestrator** confirms remote migration list via `mcp__supabase__list_migrations` and deploys `ticket-checkout-create` via `/Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` from the worktree. Verify version bump via `mcp__supabase__list_edge_functions` and confirm `verify_jwt` setting preserved (this fn is currently `verify_jwt: true` since it's user-initiated checkout; do not change).
3. **Claude `mingla-tester`** runs the parity matrix: buyer-anon-web (`mingla-business` `/checkout-trip/{tripEventId}/payment`) + business iOS (PaymentSheet branch) + business Android (PaymentSheet branch) + business web preview. Adversarial angles per the previous REVIEW §1.5: invalid-choice rejection at both edge + RPC, rapid toggle full↔installments, multi-tier mixed cart still hits `ticket_lines_mixed_with_installments`, browser refresh re-hydrates choice, Money tab mixed-mode trip, ORCH-0921 compare-and-correct still cleans plan orders.
4. **CLOSE** per standard protocol — Step 0.5 regression-test gate is satisfied (happy-path + fails-on-revert at `041d81d2` exist; tester adds adversarial), Step 1.5 DIAG reap (zero `[ORCH-0915-DIAG]` matches expected), Step 1.7 worktree reap. `[deploy]` tag REQUIRED (`mingla-business/` touched). 1 PR per CLOSE from `orch-0915-buyer-pay-in-full-opt-out` → `main`.

---

## 8. Summary

- **ORCH-0915 feature work: APPROVED on the merits.**
- **Branch state: BLOCKED on stale base.**
- **Action: rebase onto `origin/main` (`e8892fec`), verify 4 ORCH-0949 files restored, re-run gates + tests, then return for APPROVED follow-up.**
- **No migration push, no edge deploy, no tester handoff until BLOCKED → APPROVED.**
