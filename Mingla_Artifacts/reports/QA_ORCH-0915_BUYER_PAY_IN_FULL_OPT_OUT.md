# QA Report - ORCH-0915 Buyer Pay-In-Full Opt-Out

**Date:** 2026-05-24  
**Tester:** Codex `tester`  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]`  
**Branch:** `orch-0915-buyer-pay-in-full-opt-out`  
**Verdict:** CONDITIONAL PASS

## Executive Verdict

ORCH-0915 is conditionally approved for CLOSE after the remaining parity gates below are completed. The implemented buyer pay-in-full opt-out contract is covered by focused Jest, Deno, strict-grep, live remote invalid-choice checks, and RN-Web browser smoke in Chrome plus WebKit/Safari-compatible automation. No P0/P1 product blockers were found.

The conditional status is driven by test coverage, not an observed product defect: mandatory native iOS and Android PaymentSheet live-fire could not be completed because port `8081` was already occupied by an existing non-worktree Metro process. The iOS simulator and Android emulator were available, but this tester did not kill the unrelated process and did not run native PaymentSheet from the ORCH worktree.

## Inputs Read

| Artifact | Status |
|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Read |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Read |
| `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Read |

Review note: the report file in this worktree still contains the original blocked review text, but current branch evidence shows the rebase, migration-prefix bump, and source-reconcile commits are present. The implementation commit cited as `041d81d2` in the report is now `385a84d2` post-rebase, matching the dispatch note.

## Environment / Deploy State Verified

| Check | Result |
|---|---|
| Branch ahead/behind | `orch-0915-buyer-pay-in-full-opt-out`, 4 commits ahead of `origin/main`, 0 behind |
| Remote migration | `20260724000007_orch_0915_pay_in_full_opt_out` present via Supabase migration list |
| Edge function | `ticket-checkout-create` version `92`, `verify_jwt: true` preserved |
| Edge function source hash | `ezbr_sha256=594beeb5...` from Supabase function list |
| No forbidden deploy action | No `supabase db push`, edge redeploy, PR push, or merge run by tester |

## Findings

| ID | Severity | Status | Finding | Required Action |
|---|---|---|---|---|
| QA-0915-001 | P2 | Open | Native iOS and Android PaymentSheet live-fire parity was not completed from this worktree. Port `8081` was already listening from a separate Metro process under `/Users/sethogieva/Desktop/mingla-main/app-mobile`, while the required gate specified Metro on `8081` from this ORCH worktree. | Before full PASS/CLOSE, free or reassign the conflicting Metro process, start Metro from this worktree on the required port, and capture iOS + Android PaymentSheet evidence under `Mingla_Artifacts/evidence/orch-0915-live-fire/`. |
| QA-0915-002 | P2 | Open | SC-15 is not yet fully satisfied because the newly authored adversarial regression tests are currently local worktree files. | CLOSE commit must include the new adversarial test files in the same scoped commit/push as ORCH-0915 before merge. |
| QA-0915-003 | P3 | Open | Broad `npx tsc --noEmit --pretty false` attempts in `mingla-business` and `app-mobile` produced no output for more than 30 seconds and were aborted. Focused tests and gates passed. | Treat broad typecheck as an existing manual gate for CLOSE if required by the orchestrator. |
| QA-0915-004 | P4 | Noted | Safari browser parity was exercised with Playwright WebKit automation rather than manual Safari.app. | Accept WebKit as Safari-compatible evidence or run an additional manual Safari.app smoke before full PASS. |

## Severity Counts

| Severity | Count |
|---|---:|
| P0 | 0 |
| P1 | 0 |
| P2 | 2 |
| P3 | 1 |
| P4 | 1 |

## Adversarial Regression Tests Authored

| Path | Distinct Angles Covered |
|---|---|
| `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0915_pay_in_full_choice_adversarial.test.tsx` | rapid full/installment toggles preserve cart/buyer/intake/session state; refresh restore defaults to full while preserving resume data; multi-tier mixed cart keeps `ticket_lines_mixed_with_installments`; Money tab mixed full-pay/installment row model; full branch does not leak installment UI after toggle-back |
| `supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice_adversarial.test.ts` | invalid `payment_plan_choice:"banana"` rejected at edge and RPC; idempotency key separates explicit full/installment branches; `auto` preserves legacy key; mixed cart guard cannot be bypassed by full; full branch stays non-installment because Stripe fields are schedule-derived |

## Automated Test Results

| Gate | Command | Result |
|---|---|---|
| New Jest adversarial suite | `npx jest 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice_adversarial.test.tsx' --runInBand` | PASS, 1 suite / 5 tests |
| New Deno adversarial suite | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice_adversarial.test.ts` | PASS, 5 tests |
| Focused Jest ORCH-0915 + Money + disclosure set | `npx jest ... --runInBand` across ORCH-0915 happy/adversarial, service, Money, and installment disclosure tests | PASS, 6 suites / 75 tests |
| Focused Deno edge/RPC set | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts && deno test --allow-read ...` | PASS, 23 tests |
| Strict-grep gates | ORCH-0915, ORCH-0921, ORCH-0925 strict-grep commands | PASS, 0 violations |
| Whitespace | `git diff --check` | PASS |
| Consumer-app diff guard | `git diff -- app-mobile --stat && git diff -- app-mobile --name-only` | PASS, empty output |
| Broad business typecheck | `npx tsc --noEmit --pretty false` in `mingla-business` | Unverified, aborted after no output for >30s |
| Broad app-mobile typecheck | `npx tsc --noEmit --pretty false` in `app-mobile` | Unverified, aborted after no output for >30s |

Focused Jest command expanded:

```text
npx jest 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice.test.tsx' 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice_adversarial.test.tsx' 'src/services/__tests__/ticketCheckoutService.orch0915.test.ts' 'app/trip/\[id\]/money/__tests__/money-redesign.test.tsx' 'app/trip/\[id\]/money/__tests__/money-redesign-adversarial.test.tsx' 'src/components/trip/__tests__/InstallmentScheduleDisplay_wiring_adversarial.test.ts' --runInBand
PASS: 6 suites, 75 tests
```

Focused Deno command expanded:

```text
/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts
/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice.test.ts supabase/functions/ticket-checkout-create/__tests__/orch_0915_rpc_behavior.test.ts supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice_adversarial.test.ts supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.adversarial.test.ts
PASS: 23 tests
```

## Live-Fire Evidence

Evidence directory: `Mingla_Artifacts/evidence/orch-0915-live-fire/`

| Surface / Gate | Status | Evidence |
|---|---|---|
| Buyer-anon-web, Chrome | PASS | `chrome-checkout-index.png`, `chrome-payment-full.png`, `chrome-payment-installments.png`, `chrome-payment-refresh-default-full.png`, matching `*-text.txt`, `chrome-browser-console.log` |
| Buyer-anon-web, Safari-compatible WebKit | PASS with P4 note | `webkit-checkout-index.png`, `webkit-payment-full.png`, `webkit-payment-installments.png`, `webkit-payment-refresh-default-full.png`, matching `*-text.txt`, `webkit-browser-console.log` |
| Business web preview / RN-Web | PASS | Expo web preview from this worktree on `http://localhost:19092`; Chrome and WebKit screenshots listed above |
| Business iOS PaymentSheet | BLOCKED | `native-parity-blockers.txt` shows booted iOS simulator and port `8081` conflict from non-worktree Metro |
| Business Android PaymentSheet | BLOCKED | `native-parity-blockers.txt` shows Android emulator available and same port `8081` conflict |
| Remote edge invalid choice | PASS | `live-curl-invalid-choice-status.txt` = `HTTP 400`; `live-curl-invalid-choice-response.json` = `{"error":"payment_plan_choice_invalid"}` |
| Remote RPC invalid choice | PASS | `live-rpc-invalid-choice.txt` shows `P0001` / `payment_plan_choice_invalid` |
| Environment capture | RECORDED | `environment.txt`, `native-parity-blockers.txt` |

Browser fixture used for live checkout smoke:

| Field | Value |
|---|---|
| Trip id | `060d0483-50db-48d1-840b-73d9fc59356a` |
| Trip title | `The DC Adventure` |
| Brand | `travelbrand` |
| Tier id | `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` |
| Tier | `Standard`, EUR 500.00 |
| Plan | 25% deposit + 2 future installments |

Observed browser behavior:

- Checkout route rendered and allowed selecting one Standard ticket.
- Buyer details form accepted name, email, and phone.
- Payment page defaulted to full pay: `Pay full €500.00 now`, `Paid in full today`, CTA `Pay €500.00`.
- Toggling to installments showed `Payment plan active`, CTA `Pay €125.00 deposit`, and schedule copy.
- Direct refresh/restore of `/payment` rehydrated cart/buyer state and defaulted choice back to full.

## SC-01..SC-15 Coverage

| SC | Criterion Summary | QA Status | Evidence |
|---|---|---|---|
| SC-01 | Plan-active trip tier renders exactly two payment options | PASS | Focused Jest, Chrome/WebKit screenshots |
| SC-02 | Default follows operator answer, recommended full | PASS | Focused Jest; browser default full on load and refresh |
| SC-03 | Switching updates terms/banner/CTA without clearing state | PASS | New Jest adversarial toggle preservation test; Chrome/WebKit toggle smoke |
| SC-04 | Full branch sends `payment_plan_choice:"full"` | PASS | Service Jest, UI source tests, Deno payload coverage |
| SC-05 | Installment branch sends `payment_plan_choice:"installments"` | PASS | Service Jest, UI source tests, Deno payload coverage |
| SC-06 | Omitted choice preserves legacy `auto` behavior | PASS | Service/Deno tests; idempotency helper test keeps legacy key |
| SC-07 | Full branch stores `installment_schedule=NULL`, full total | PASS | RPC source/Deno coverage, strict-grep invariant |
| SC-08 | Full Stripe hosted/native request is single-charge without installment metadata/setup/customer forcing | PASS-source, native live blocked | Deno/source tests prove schedule-derived Stripe branch; native PaymentSheet live-fire still blocked by QA-0915-001 |
| SC-09 | Full final order is non-installment, full-price, zero child rows | PASS-source | RPC/finalize invariant and strict-grep coverage |
| SC-10 | Installment branch still creates deposit checkout, metadata, Customer/PM attachment, child rows | PASS-source, native live blocked | ORCH-0925 tests/gate pass; native live-fire still blocked by QA-0915-001 |
| SC-11 | ORCH-0921 compare-and-correct gate still passes | PASS | Strict-grep ORCH-0921: 0 violations |
| SC-12 | Money tab renders full opt-out as paid in full | PASS-automated | Money tests plus new mixed-mode adversarial model test |
| SC-13 | No consumer app trip UI change; app-mobile event checkout unaffected | PASS with typecheck caveat | Empty `git diff -- app-mobile`; broad app-mobile typecheck unverified after no output |
| SC-14 | Invalid `payment_plan_choice` returns structured 400 and creates no session | PASS | Live curl HTTP 400, live RPC `P0001`, Deno adversarial edge/RPC test |
| SC-15 | Regression tests ship in same scoped commit/push | CONDITIONAL | Tests authored locally; CLOSE must include them in scoped commit/push |

## Parity Matrix

| Required Surface | Verdict | Notes |
|---|---|---|
| Buyer-anon-web, Chrome | PASS | RN-Web preview exercised route through full/default, installment toggle, and refresh/restore |
| Buyer-anon-web, Safari | PASS with P4 note | WebKit automation exercised same flow; Safari.app manual smoke not run |
| Business iOS | BLOCKED | Required worktree Metro on `8081` could not start due existing unrelated listener |
| Business Android | BLOCKED | Same blocker as iOS |
| Business web preview / RN-Web | PASS | Expo web preview from worktree on `19092`; Chrome/WebKit evidence captured |
| Remote edge/RPC validation | PASS | Invalid-choice live edge and RPC checks returned structured failures |

## Risk Assessment

| Risk | Level | Assessment |
|---|---|---|
| Buyer can accidentally enter installment branch after selecting full | Low | UI/source/adversarial tests confirm branch copy and CTA swap cleanly |
| Full branch reuses an installment Stripe session after cancel/toggle | Low to Medium | New Deno adversarial test proves idempotency keys split explicit full/installment branches; no live Stripe session was created during QA |
| Payment plan branch regression | Low | ORCH-0925 tests/gate pass; installment branch browser smoke shows deposit CTA/copy |
| Native PaymentSheet parity | Medium until live-fire completed | Source path forwards choice, but required native runtime proof remains open |
| Process risk: adversarial tests not committed | Medium until CLOSE | Tests are authored but untracked at QA time |

## CLOSE Conditions For Full PASS

1. Add the two new adversarial test files to the scoped ORCH-0915 commit/push.
2. Free or reassign the existing Metro process on `8081`, then start Metro from this worktree as required.
3. Run business iOS PaymentSheet live-fire for full and installment choices and save screenshots/logs under `Mingla_Artifacts/evidence/orch-0915-live-fire/`.
4. Run business Android PaymentSheet live-fire for full and installment choices and save screenshots/logs under the same evidence directory.
5. Optional but recommended: run manual Safari.app checkout smoke or explicitly accept Playwright WebKit as Safari-compatible evidence.

## Final QA Decision

CONDITIONAL PASS. The ORCH-0915 implementation is behaviorally sound under focused automated tests, live edge/RPC invalid-input checks, and RN-Web browser parity. It should not be treated as a full PASS until native iOS/Android PaymentSheet parity and SC-15 commit inclusion are completed.

## Next Handoff

Orchestrator should run CLOSE only after satisfying the open conditions above: include the adversarial regression tests in the scoped commit, complete native iOS/Android live-fire from this ORCH worktree, update evidence, then proceed with the CLOSE protocol, PR creation, pre-merge gate, and deploy-tag decision ownership.
