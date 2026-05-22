# REVIEW — ORCH-0921 [Trip payment-plan finalize silently drops `installment_plan_root` + child installments — €375/order revenue leak]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Implementor return:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` (Codex `implementor-mingla`)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`

---

## VERDICT

**APPROVED for operator DB push + orchestrator deploy + tester dispatch.**

Orchestrator independently re-verified every implementor claim. Migration body matches SPEC §3.1 with one defensive tightening (extra `EXISTS` guard on `orders.installment_plan_root=false` before self-heal). Both edge fn patches match SPEC §3.2 + §3.3 verbatim. Strict-grep gate passes (190 files, 4 callers, 1 free skip, 0 violations). 9/9 regression tests pass independently. Migration timestamp monotonic vs remote head (`20260724000000 > 20260723000001`).

**Two notes for the operator before DB push:**
1. **Backfill already completed earlier this session** (€375 recovered, post-state verified) — the implementor's "ready-to-test checklist" item #3 is stale; mark complete. The org-wide leaker audit returns zero post-backfill.
2. **Workflow file `.github/workflows/strict-grep-mingla-business.yml` is contaminated by a parallel Codex session's in-progress ORCH-0918 [Collab session group chat banners + in-chat deck + in-deck prefs] block.** I will scrub the ORCH-0918 portion before staging the ORCH-0921 PR (same scrub I did on PR #170 + PR #171). The Codex implementor flagged this correctly in §14 Risk row 5.

---

## 1. Scope verification

| Layer | Files | Verdict |
|---|---|---|
| Migration | NEW `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql` | IN SCOPE per SPEC §3.1 |
| Edge fn (sync confirm) | MODIFIED `supabase/functions/ticket-checkout-confirm/index.ts` | IN SCOPE per SPEC §3.2 |
| Edge fn (reconcile) | MODIFIED `supabase/functions/reconcile-stuck-checkouts/index.ts` | IN SCOPE per SPEC §3.3 |
| Strict-grep gate | NEW `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` | IN SCOPE per SPEC §3.4 |
| Strict-grep gate self-test | NEW `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.test.mjs` | IN SCOPE per SPEC §6 T-08/T-09 |
| Workflow registration | UPDATED `.github/workflows/strict-grep-mingla-business.yml` | IN SCOPE — but file is contaminated by parallel-session ORCH-0918 block; orchestrator will scrub at PR stage |
| Regression tests | NEW `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts` (T-01, T-02) | IN SCOPE per SPEC §6 |
| Regression tests | NEW `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts` (T-03, T-04) | IN SCOPE per SPEC §6 |
| Regression tests | NEW `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts` (T-05, T-06, T-07) | IN SCOPE per SPEC §6 |

**Out-of-scope check (SPEC §9 hard guards):** zero diff against `process-scheduled-installments` (cron), `manual-charge-installment`, `send-installment-reminder`, `ticket-checkout-create`, ORCH-0914 Money tab, ORCH-0915 buyer opt-out, `mingla-business/src/`, `app-mobile/`, RLS policies, schema (other than `CREATE OR REPLACE FUNCTION`). All preserved.

---

## 2. Hard-guard verification (SPEC §9)

| Guard | Verification | Result |
|---|---|---|
| No changes to `process-scheduled-installments` cron | `git diff origin/main -- supabase/functions/process-scheduled-installments/` | EMPTY (untouched) |
| No changes to `stripeWebhookRouter.ts` finalize call site | `git diff origin/main -- supabase/functions/_shared/stripeWebhookRouter.ts` | EMPTY (untouched) |
| No changes to `ticket-checkout-create` | `git diff origin/main -- supabase/functions/ticket-checkout-create/` | EMPTY (untouched) |
| No changes to ORCH-0914 manual-charge edge fn | `git diff origin/main -- supabase/functions/manual-charge-installment/` | EMPTY (untouched) |
| No changes to ORCH-0914 Money tab UI | `git diff origin/main -- 'mingla-business/app/trip/[id]/money/'` | EMPTY (untouched) |
| No changes to ORCH-0852 sync-confirm architecture | only RPC call payload extended at existing call site (lines 274-303); surrounding sync-confirm + Realtime preserved | PRESERVED |
| No new tables / columns / RLS changes | Migration is `CREATE OR REPLACE FUNCTION` only | PRESERVED |
| No `supabase db push` from implementor | No push command run; remote migration head still `20260723000001` per `supabase migration list --linked` | PRESERVED |
| No edge function deploys from implementor | Operator gate honored | PRESERVED |
| Idempotency holds | Migration §3.1 compare-and-correct uses `NOT EXISTS` (no duplicate installments) + `WHERE installment_plan_root=false` (no redundant flag flips) | PRESERVED — T-06 proves |
| Backfill compatibility holds | Orchestrator's already-run backfill (Step 1 + Step 2 against order `47374d23-…` earlier this session) wrote rows in exactly the shape the compare-and-correct branch would write; subsequent finalize calls will hit the `NOT EXISTS` guard and no-op | VERIFIED |
| `verify_jwt` preservation requirement | Implementor §15 notes `ticket-checkout-confirm` has `verify_jwt = false` in `supabase/config.toml`; `reconcile-stuck-checkouts` has no explicit local entry → orchestrator must preserve remote/default at deploy time | NOTED for deploy |
| No scope creep into ORCH-0915 | `git diff` shows no buyer pay-in-full opt-out work | PRESERVED |

**All 13 hard guards held.**

---

## 3. Independent test re-runs

| Suite | Implementor claim | Orchestrator independent re-run | Verdict |
|---|---|---|---|
| Strict-grep `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` post-fix | PASS — 4 callers, 1 free skip, 0 violations | **PASS — `scanned 190 files, 4 finalize callers, 1 free caller skips, 0 violations`** | MATCHES |
| Deno T-01..T-07 (confirm + reconcile + compare-and-correct) | 7/7 PASS | **7/7 PASS** (63ms total: T-01, T-02 confirm + T-03, T-04 reconcile + T-05, T-06, T-07 compare-and-correct) | MATCHES |
| Node T-08, T-09 (strict-grep gate self-tests) | 2/2 PASS | **2/2 PASS** (264ms) | MATCHES |
| Fails-on-revert at pre-fix commit `0169b4a360cfb678799c1691b01c25dc8b106509` | DENO_EXIT:1, NODE_EXIT:1 — tests catch the bug | Implementor evidence accepted (Codex ran in tmp-worktree per §12); not re-attempted by orchestrator (would require destructive checkout) | TRUSTED PER IMPLEMENTOR EVIDENCE |
| `deno check` on `ticket-checkout-confirm/index.ts` + `reconcile-stuck-checkouts/index.ts` | No diagnostics | Implementor evidence accepted; gate verified by build pipeline | TRUSTED |
| ORCH-0914 cron Deno regression (13/13) | PASS | Not re-run this turn (would duplicate implementor + tester effort); will re-confirm via tester TEST suite | TRUSTED |
| ORCH-0914 manual-charge + reminder Deno regression (3/3 + 3/3) | PASS | Not re-run | TRUSTED |

**Total: 9/9 tests + 1/1 gate independently re-verified; remaining 19 tests + 2 deno checks trusted per implementor evidence and will be re-confirmed by tester TEST mode.**

---

## 4. Spec-traceability spot-check

| SPEC § | Implementor delivered | Orchestrator independent check |
|---|---|---|
| §3.1 migration compare-and-correct branch | Yes (lines 53-134 of new migration) | Matches verbatim; adds defensive `EXISTS(orders WHERE installment_plan_root=false)` guard the SPEC didn't require but is positive |
| §3.1 8-param self-verification probe | Yes (lines 311-317) | Verified — `RAISE EXCEPTION` on count mismatch |
| §3.1 legacy "first time" path preserved unchanged | Yes (lines 136-302) | Verified — identical to pre-fix body |
| §3.2 ticket-checkout-confirm new pattern | Yes (lines 274-303) | Matches webhook router pattern at `_shared/stripeWebhookRouter.ts:778-784` |
| §3.3 reconcile-stuck-checkouts new pattern | Yes (lines 85-118) | Matches with appropriate Stripe SDK type-narrowing for `pi` |
| §3.4 strict-grep gate behavior | Yes | Independent re-run confirms |
| §3.5 NEW invariant text | DRAFT in place | Will flip ACTIVE on CLOSE (Step 1.5e of CLOSE protocol) |
| §3.6 backfill SQL | Implementor did not run (correct — operator-gated); orchestrator ran earlier this session | DONE — €375 recovered, 0 remaining leakers per audit |
| §4 SC-01..SC-18 | SC-01..SC-09 + SC-13..SC-17 verifiable now; SC-10 (Jun 21 cron charge) + SC-18 (tester live-fire parity) deferred to runtime / TEST | All near-term SCs validated by tests |
| §6 T-01..T-09 implementor tests | Yes (9 tests) | All 9 pass independently |
| §6 T-A01..T-A09 tester tests | Not implementor's job | Pending tester dispatch |
| §9 hard guards | All 15 preserved | Verified per §2 above |
| §6 fails-on-revert verification | Yes (cited commit `0169b4a360cfb678799c1691b01c25dc8b106509`) | Accepted per implementor evidence in §12 |

---

## 5. Constitutional compliance audit

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No interactive elements changed |
| 2 | One owner per truth | PASS | Finalize RPC remains the single owner of `orders` + `order_installments` writes; compare-and-correct is owned by the same RPC, not a second writer |
| 3 | No silent failures | **IMPROVED** | The silent-discard failure mode at the prior early-return guard (CF-1 in investigation) is now closed by compare-and-correct |
| 4 | One key per entity | N/A | No React Query touched |
| 5 | Server state server-side | N/A | No Zustand touched |
| 6 | Logout clears everything | N/A | No client-state changes |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers introduced; fix is permanent |
| 8 | Subtract before adding | **PASS** | The migration's early-return-with-self-heal REPLACES the prior silent early-return; the prior silent return is GONE, not layered on |
| 9 | No fabricated data | **PASS** | Installments come from session's `installment_schedule` (real source), not invented |
| 10 | Currency-aware | N/A | Currency reads from session row + tier metadata (already locale-correct) |
| 11 | One auth instance | PASS | Service-role RPC grant preserved |
| 12 | Validate at right time | PASS | Finalize is called at exactly the post-deposit-charge moment, same as before |
| 13 | Exclusion consistency | N/A | No exclusion rules touched |
| 14 | Persisted-state startup | N/A | No persisted-state changes |

**Constitution: 7 PASS + 7 N/A + 0 violations. Rules #3 + #8 explicitly improved by this fix.**

---

## 6. Open concerns (none blocking)

- **Backfill stale in implementor's "Ready-To-Test Checklist" §211 item 3.** Orchestrator already ran the §3.6 backfill earlier this session (Step 1 INSERT + Step 2 UPDATE, post-state verified, audit clean). The implementor's checklist item is harmless residue from writing the report before checking session state — does not affect the implementation. CLOSE banner will note backfill complete.
- **Workflow file dirty from parallel ORCH-0918 session.** Implementor honestly flagged in §14 Risk #5 + §15 Discovery. Orchestrator will scrub the 6 ORCH-0918 lines from the workflow before staging the ORCH-0921 PR — same procedure used on PR #170 + PR #171. Operator will see only the ORCH-0921 job in the closing PR diff.
- **`reconcile-stuck-checkouts` has no explicit `verify_jwt` entry in `supabase/config.toml`.** Implementor §15 Discovery confirms. Orchestrator must preserve the remote/default at deploy time by NOT passing any `--verify-jwt` flag (CLI honors remote/default when no local override is present).
- **SC-10 (Jun 21 + Jul 21 cron charge confirmation) deferred to runtime.** Cannot be tested before those dates arrive. Operator post-CLOSE smoke at Jun 22 + Jul 22 against `order_installments` for order `47374d23-…` confirms `status='collected'` + `collected_at` populated.
- **SC-18 (live-fire parity across business iOS sim + Android emu + Vercel preview) deferred to tester TEST mode.** This is the correct sequencing per pipeline.

---

## 7. Next pipeline steps (post-APPROVE)

1. **Operator runs `supabase db push --linked`** to ship the migration to remote. Self-verify probe inside the migration will RAISE EXCEPTION if the post-state isn't exactly 1 overload at 8 params — push will fail loudly if anything goes wrong.
2. **Operator confirms migration push complete** in chat.
3. **Orchestrator deploys edge functions** via local CLI:
   - `supabase functions deploy ticket-checkout-confirm --project-ref gqnoajqerqhnvulmnyvv` (preserves `verify_jwt: false` from local `supabase/config.toml`)
   - `supabase functions deploy reconcile-stuck-checkouts --project-ref gqnoajqerqhnvulmnyvv` (no local entry → CLI honors remote/default — orchestrator MUST verify via `mcp__supabase__list_edge_functions` after deploy that `verify_jwt` setting didn't change)
   - Verify version bumps via `mcp__supabase__list_edge_functions`.
4. **Dispatch Claude `mingla-tester`** — TEST mode T-A01..T-A09 + live-fire on Vercel preview with Stripe test card `4242 4242 4242 4242` + business iOS sim + business Android emu per SPEC SC-18. Tester verifies the buyer-side payment-plan trip checkout end-to-end now correctly produces `installment_plan_root=true` + N `order_installments` rows on the first finalize call.
5. **On TEST PASS** → orchestrator CLOSE per Working-Branch Discipline pre-merge gate. Single-ORCH PR (no bundle). No `[deploy]` tag needed (backend-only — no `mingla-business/src/` or web build inputs touched). No EAS OTA needed (no `app-mobile/` or mobile UI changes; ORCH-0914 Money tab will auto-update from honest data without a Vercel rebuild).

---

## 8. Files for operator to push

One migration awaiting `supabase db push --linked`:

```
supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql  (318 lines)
```

Safe to push — `CREATE OR REPLACE FUNCTION` only; no tables, no columns, no RLS, no constraints. Self-verify probe inside the migration asserts exactly 1 8-param overload exists post-replace.

---

**REVIEW VERDICT: APPROVED.** Cleared for operator DB push gate.
