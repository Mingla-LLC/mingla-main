# Implementation Report: Trip Payment-Plan Finalize Drops Installments (ORCH-0921)

> Date: 2026-05-22
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`
> Status: implemented and verified locally; operator DB push, orchestrator deploy, tester live-fire still pending

## 1. Layman Summary

Trip payment-plan orders were losing their future installments when the buyer-side confirm path finalized the order before the webhook. The fix makes both non-webhook finalize callers pass the same installment metadata the webhook already passes, adds a database self-heal branch for half-finalized orders, and adds a CI strict-grep gate so future finalize callers cannot silently omit `p_installment_plan_root`.

Business outcome: prevents future 75% installment revenue leakage on payment-plan trip bookings. The known production leaker still requires the operator-gated one-off backfill from SPEC §3.6.

## 2. Request And Context

- **Request:** Implement ORCH-0921 exactly per SPEC §7 order.
- **Source:** User-dispatched `$implementor` prompt with evidence-backed spec and investigation.
- **Affected surfaces:** Shared Supabase RPC, buyer-web/business native confirm edge path, reconcile recovery edge path, CI.
- **Related issues/artifacts:** ORCH-0869, ORCH-0914, ORCH-0915 dependency, `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`.

## 3. Scope

- **In scope:** migration, strict-grep gate + workflow job, two edge finalize caller patches, T-01..T-09 implementor tests, implementation report.
- **Out of scope:** `supabase db push`, edge deploys, cron changes, manual-charge-installment changes, Money tab UI changes, ORCH-0915 UX, production backfill execution.
- **Assumptions:** Stripe PI metadata remains `mingla_installment_plan_root="true"` for payment-plan deposits; existing cron will process correctly written `order_installments`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` | Contract | Locked order and hard guards. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` | Root-cause evidence | Two broken callers passed 5/8 params; webhook passed 8/8. |
| `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql` | Latest RPC body | Early return skipped compare-and-correct. |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | Correct pattern | Reads PI metadata/customer/PM and passes 8 params. |
| `supabase/functions/ticket-checkout-confirm/index.ts` | Broken primary caller | Missing three installment params. |
| `supabase/functions/reconcile-stuck-checkouts/index.ts` | Broken recovery caller | Missing same three params. |
| `.github/workflows/strict-grep-mingla-business.yml` | CI registration | Already dirty with ORCH-0918 job; added only ORCH-0921 job/comment. |
| `supabase/config.toml` | Deploy handoff | `ticket-checkout-confirm` has `verify_jwt = false`; `reconcile-stuck-checkouts` has no explicit entry in this file, so deploy must preserve its current/default remote setting. |

## 5. Blast Radius

- **Direct changes:** One function migration, two edge RPC payloads, one CI gate/job, four regression test files.
- **Cascade changes:** Correct `orders.installment_plan_root`, Customer/PM columns, and `order_installments` rows allow the existing cron and Money tab to work from honest DB state.
- **Parity surfaces:** Buyer anonymous web and business iOS/Android/web all share `ticket-checkout-confirm`; reconcile path is backend-only recovery.
- **Cache impact:** None. No query keys, invalidations, Zustand, or AsyncStorage touched.
- **State boundaries:** DB owns persisted truth; edge functions now pass source Stripe PI metadata into DB finalization.
- **Auth/RLS/security:** No RLS changes. Edge function auth architecture unchanged. Service-role RPC grant preserved.
- **Deploy path:** Operator runs migration; orchestrator deploys `ticket-checkout-confirm` and `reconcile-stuck-checkouts`; tester runs live-fire.

## 6. Old To New Receipts

### `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql`

- **Before:** Latest finalize RPC returned immediately when `ticket_checkout_sessions.order_id` existed, so the webhook could not correct a half-finalized order.
- **After:** Existing-order branch self-heals only when `p_installment_plan_root=true`, session schedule exists, Customer/PM are present, existing order is still `installment_plan_root=false`, and zero installments exist. It writes scheduled installments, flips the order flag, stores Customer/PM, returns `installmentPlanRoot`, and includes an 8-param overload self-verify probe.
- **Why:** Defense in depth for the buyer-confirm/webhook race.
- **Approx lines changed:** New migration, `CREATE OR REPLACE FUNCTION` only; no tables, columns, or RLS.

### `supabase/functions/ticket-checkout-confirm/index.ts`

- **Before:** Primary sync-confirm caller invoked `biz_ticket_checkout_finalize` with 5 params.
- **After:** Reads `paymentIntent.metadata["mingla_installment_plan_root"]`, gates `customer` and `payment_method`, and passes all 8 params.
- **Why:** Payment-plan confirm path now schedules installments on the first finalize call.
- **Approx lines changed:** Added PI metadata derivation and 3 RPC keys.

### `supabase/functions/reconcile-stuck-checkouts/index.ts`

- **Before:** Recovery caller invoked finalize with 5 params.
- **After:** Reads `pi.metadata`, gates `pi.customer` and `pi.payment_method`, and passes all 8 params.
- **Why:** Stuck payment-plan session recovery no longer creates non-installment orders.
- **Approx lines changed:** Added PI metadata derivation and 3 RPC keys.

### `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs`

- **Before:** No CI invariant prevented future finalize caller drift.
- **After:** Scans `supabase/functions` for paid `biz_ticket_checkout_finalize` RPC callers missing `p_installment_plan_root`; supports explicit allowlist comments and skips the existing zero-cost `ticket-checkout-create` finalize shape.
- **Why:** Converts the ORCH-0921 failure mode into a CI failure.
- **Approx lines changed:** New gate script.

### `.github/workflows/strict-grep-mingla-business.yml`

- **Before:** No ORCH-0921 job. File already had an uncommitted ORCH-0918 job before this work began.
- **After:** Registered `i-proposed-finalize-callers-pass-installment-params` job and registry comment.
- **Why:** Runs the invariant in PR/push CI.
- **Approx lines changed:** One job plus comment.

### Tests

- **Before:** No tests pinned the two caller payloads, compare-and-correct branch, or strict-grep behavior.
- **After:** Added T-01..T-09 across:
  - `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts`
  - `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts`
  - `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts`
  - `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.test.mjs`
- **Why:** Regression tests fail on the old contract and pass on the new one.

## 7. Implementation Details

- **Architecture decisions:** Kept the webhook router as the source pattern; fixed the two drifting callers instead of changing checkout creation, cron, or UI.
- **Data flow:** Stripe PI metadata/customer/PM now flow from confirm/reconcile into `biz_ticket_checkout_finalize`; DB writes installments from persisted `ticket_checkout_sessions.installment_schedule`.
- **Mutation/query behavior:** No client query or cache changes.
- **State handling:** Existing finalize idempotency preserved; compare-and-correct only runs for half-finalized, no-installment orders.
- **Error handling:** First-call `installment_plan_finalize_missing_customer_or_pm` guard is unchanged. Compare-and-correct requires non-null Customer/PM before repair.
- **Copy/accessibility:** No UI/copy changes.
- **Analytics/notifications/realtime:** Notifications and Realtime architecture untouched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| §3.1 migration compare-and-correct | Yes | T-05..T-07; migration read | PASS |
| §3.1 8-param self probe | Yes | T-07 asserts probe | PASS |
| §3.2 confirm caller passes 8 params | Yes | T-01/T-02; strict-grep | PASS |
| §3.3 reconcile caller passes 8 params | Yes | T-03/T-04; strict-grep | PASS |
| §3.4 strict-grep gate + workflow | Yes | local pre-fix FAIL, post-fix PASS, T-08/T-09 | PASS |
| §6 T-01..T-09 | Yes | Deno/Node tests pass | PASS |
| §7 order | Yes | Migration first, gate second with pre-fix fail, edge fixes third, tests/report after | PASS |
| §9 no db push/deploy | Preserved | No push/deploy commands run | PASS |
| §9 no cron/manual-charge/Money tab/ORCH-0915 scope creep | Preserved | Files untouched | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` | Yes | Yes | New gate exits 0 post-fix; exits 1 on pre-fix and bad fixture. |
| `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` | Yes | Yes | No PaymentIntent creation added. |
| `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` | Yes | Yes | Manual-charge function untouched; tests still pass. |
| Finalize idempotency | Yes | Yes | Compare-and-correct has order flag + NOT EXISTS guards. |
| No RLS/schema expansion | Yes | Yes | Migration is function replacement only. |

## 10. Parity Check

- **Mobile:** Backend shared confirm path fixed; no app-mobile code touched. Tester must live-fire business iOS and Android per SPEC SC-18.
- **Business app:** Shared `ticket-checkout-confirm` fixed for web/native return flow.
- **Admin:** No admin changes.
- **Public/web:** Buyer anonymous web confirm fixed.
- **Solo/collab:** Not applicable.
- **Gaps:** Live-fire on Vercel preview, business iOS sim, and Android emu remains tester-owned.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** Existing RPC response gains `installmentPlanRoot` on existing-order return path; first-call response already had it.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Edge functions still use existing env and service client paths.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Local migration monotonicity | `ls supabase/migrations | tail -10`; `git ls-tree origin/main supabase/migrations/ | tail -10`; `/Users/sethogieva/bin/supabase migration list --linked` | PASS | Local, origin/main, and linked remote max were `20260723000001`; new prefix `20260724000000` is greater. |
| Strict-grep pre-fix failure | Ran gate before edge patches | PASS/expected FAIL | Exit 1; violations at `ticket-checkout-confirm/index.ts:263` and `reconcile-stuck-checkouts/index.ts:74`; 1 free caller skipped. |
| Strict-grep allowlist fixture | Temp fixture with allow comment | PASS | Exit 0. |
| Strict-grep post-fix | `node .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` | PASS | `scanned 190 files, 4 finalize callers, 1 free caller skips, 0 violations`. |
| T-01..T-07 | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts` | PASS | 7/7. |
| T-08..T-09 | `node --test .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.test.mjs` | PASS | 2/2. |
| Fails-on-revert | Temp worktree at pre-fix `0169b4a360cfb678799c1691b01c25dc8b106509`, copied new tests/gate, ran same suites | PASS/expected FAIL | `DENO_EXIT:1`, `NODE_EXIT:1`; tests caught missing caller params and absent migration. |
| Edge check: confirm | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-confirm/index.ts` | PASS | No diagnostics. |
| Edge check: reconcile | `/Users/sethogieva/.deno/bin/deno check supabase/functions/reconcile-stuck-checkouts/index.ts` | PASS | No diagnostics. |
| ORCH-0914 cron suite | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/process-scheduled-installments/__tests__/` | PASS | 13/13. |
| ORCH-0914 manual-charge suite | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/manual-charge-installment/__tests__/` | PASS | 3/3. |
| ORCH-0914 reminder suite | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/send-installment-reminder/__tests__/` | PASS | 3/3. |
| Touched confirm test dir | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-confirm/__tests__/` | PASS | 2/2. |
| Touched reconcile test dir | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/reconcile-stuck-checkouts/__tests__/` | PASS | 2/2. |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors. |

## 13. Regression Surface

1. **Buyer sync-confirm race:** now passes installment params on first call.
2. **Webhook second-call repair:** migration can repair half-finalized state if webhook arrives after a broken caller.
3. **Recovery reconcile:** now preserves payment-plan state.
4. **Free checkout finalize:** strict-grep intentionally skips the existing zero-cost finalize path so no `ticket-checkout-create` behavior changed.
5. **ORCH-0914 installment operations:** cron/manual/reminder tests still pass.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Production migration not applied by implementor | DB self-heal unavailable until operator runs push | Operator runs `supabase db push --linked` | Deploy notes |
| Edge functions not deployed by implementor | Remote confirm/reconcile still old until orchestrator deploys | Orchestrator deploys both functions preserving `verify_jwt` | Deploy notes |
| Known leaker not backfilled by implementor | Existing order `47374d23-...` still needs recovery | Orchestrator/operator runs SPEC §3.6 SQL with real Customer/PM | SPEC §3.6 |
| Full live-fire parity pending | Local tests do not charge real preview Stripe flow | Tester SC-18 PASS | Tester handoff |
| Workflow file already dirty | ORCH-0918 job was present before this implementation | Orchestrator stages scoped files carefully | `.github/workflows/strict-grep-mingla-business.yml` |

## 15. Discoveries For Orchestrator

- The live code has a fourth `biz_ticket_checkout_finalize` caller in `ticket-checkout-create` for zero-cost checkouts. To preserve SPEC hard guard 3, the new strict-grep gate explicitly skips only that free-finalize shape instead of changing `ticket-checkout-create`.
- `supabase/config.toml` confirms `ticket-checkout-confirm` is registered with `verify_jwt = false`. `reconcile-stuck-checkouts` is not explicitly registered in the local config, so orchestrator/operator should preserve the remote/default setting during deploy; no config edits were made.

## 16. Deploy Notes

- **Migrations:** Operator-only: run `supabase db push --linked`. Implementor did not run it.
- **Edge functions:** Orchestrator-only: deploy `ticket-checkout-confirm` and `reconcile-stuck-checkouts`; preserve existing `verify_jwt` settings. Local config explicitly shows `ticket-checkout-confirm = false`; reconcile has no local explicit entry.
- **Mobile OTA/native:** Not needed from this implementation; no app-mobile/mingla-business client files changed.
- **Business/admin web:** No Vercel rebuild required from this implementation.
- **Env vars/secrets:** No new env vars/secrets.
- **Backfill:** Orchestrator/operator must run SPEC §3.6 one-shot SQL for order `47374d23-2547-4709-a967-cee172fb877c` after looking up the real Stripe `cus_xxx` and `pm_xxx`.

## Suggested Commit Message

```text
fix(trip-payments): preserve installment params during checkout finalize

Resolves: ORCH-0921
Evidence: ORCH-0921 Deno/Node regression tests; strict-grep pre-fix fail and post-fix pass
Deploy: operator runs supabase db push --linked; orchestrator deploys ticket-checkout-confirm and reconcile-stuck-checkouts
```

## Ready-To-Test Checklist

1. Operator runs `supabase db push --linked`; migration self-verify passes.
2. Orchestrator deploys `ticket-checkout-confirm` and `reconcile-stuck-checkouts`, preserving existing `verify_jwt`.
3. Orchestrator/operator runs SPEC §3.6 backfill for order `47374d23-2547-4709-a967-cee172fb877c`.
4. Tester runs T-A01..T-A09, including live-fire on Vercel preview, business iOS sim, and Android emu.
5. Operator re-runs DB-wide leaker audit; expected zero after backfill.
