# QA Report: Native Stripe Tax QA Fixes Retest 2 (ORCH-0955)

> Date: 2026-05-25
> Mode: RETEST
> Verdict: PASS
> Findings: P0:0 P1:0 P2:0 P3:0 P4:1

## 1. Layman Summary

The remaining ORCH-0955 retest blocker is fixed locally. ORCH-0863 C7 now passes in the restored branch, and an in-memory remove/restore proof shows that the specific `shell.test.ts` allowlist line is active: without it, C7 fails exactly on `supabase/functions/_shared/email/__tests__/shell.test.ts`; with the real branch restored, C7 passes again. The held live-deploy gate remains separate and was not exercised per Seth's hard guard.

## 2. Inputs Reviewed

- Prior retest report: `Mingla_Artifacts/reports/QA_ORCH-0955_NATIVE_STRIPE_TAX_RETEST_REPORT.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0955_NATIVE_STRIPE_TAX_QA_FIXES.md`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/`
- Branch / HEAD: `ORCH-0955-native-stripe-tax` at `122000e6e5abc6f31b862152422e68d7a81a10d8`
- Comms ledger: `COMMS-0001`, `COMMS-0002`, and `COMMS-0003` reviewed and factored into the retest.
- Hard guards: no migrations applied, no edge functions deployed, no Stripe Dashboard mutation, no secrets touched.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| CI / Strict grep | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | ORCH-0955 backend allowlist includes the email shell regression file and C7 passes restored state. |
| Tests / Email | `supabase/functions/_shared/email/__tests__/shell.test.ts` | Jurisdiction-label regression test still runs and proves the modified file is real QA scope. |
| Edge / Native Tax | `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts`; checked edge functions | Native Tax regression and Deno edge typecheck still pass. |
| Production deploy | Prompt hard guard | Confirmed not exercised; still separate pending Seth authorization. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| ORCH-0863 C7 restored pass is fixed | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Verified | C7 reports zero forbidden backend touches across 52 changed files. |
| `shell.test.ts` is explicitly allowlisted | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:725-742` | Verified | `shell.test.ts` is present at line 728 inside the ORCH-0955 backend allowlist. |
| Remove proof fails on the intended file | In-memory run of the strict-grep script with only the `shell.test.ts` allowlist line removed | Verified | C7 fails exactly on `supabase/functions/_shared/email/__tests__/shell.test.ts`. |
| Restore proof passes | Re-ran the real branch script after the in-memory negative check | Verified | C7 passes again; no product file was mutated for the negative proof. |
| Email shell regression remains runnable | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/email/__tests__/shell.test.ts` | Verified | 10 passed, 0 failed. |
| ORCH-0955 native tax regression remains runnable | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | Verified | 17 passed, 0 failed. |
| Held live-deploy gate is resolved | Prompt hard guard | Not tested by design | Separate release gate remains pending Seth authorization. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Worktree identity | `pwd`, `git branch --show-current`, `git rev-parse HEAD` | PASS | Expected ORCH-0955 worktree and branch; HEAD `122000e6e5abc6f31b862152422e68d7a81a10d8`. |
| ORCH-0863 C7 restored state | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | `OK [C7: no-new-backend-files] ... (52 files changed total)` and `# All checks PASS`. |
| ORCH-0863 C7 remove proof | Ran an in-memory copy of the script with `const REPO_ROOT = process.cwd();` and only `supabase/functions/_shared/email/__tests__/shell.test.ts` removed from `ORCH_0955_BACKEND_ALLOWLIST` | PASS negative | Exit 1 with `FAIL [C7: no-new-backend-files] ... offenders: supabase/functions/_shared/email/__tests__/shell.test.ts`. |
| ORCH-0863 C7 restore proof | Re-ran the real script after the in-memory negative proof | PASS | C7 passes again with the real branch file restored. |
| Email jurisdiction regression | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/email/__tests__/shell.test.ts` | PASS | 10 passed, 0 failed. |
| ORCH-0955 regression suite | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | PASS | 17 passed, 0 failed. |
| Deno edge typecheck | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/refund-order/index.ts supabase/functions/brand-stripe-tax-account-session/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts` | PASS | Exit 0. |
| ORCH-0804 strict-grep | `node .github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` | PASS | `ORCH-0804 strict-grep PASS - 6/6 checks.` |
| ORCH-0955 strict-grep bundle | Ran all five ORCH-0955 strict-grep scripts | PASS | Native tax coverage, tax commit, tax reversal, embedded Tax UI, and region-gate-deleted scripts all pass. |
| Diff hygiene | `git diff --check` | PASS | Exit 0 before this report write. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS | Prior local UI checks remain covered by the ORCH-0955 regression suite; not reworked in this cycle. |
| One owner per truth | PASS | C7 fix only scopes CI allowlist; no product truth owner changed. |
| No silent failures | PASS local | C7 now catches the shell test if its allowlist protection is removed. |
| One key per entity | N/A | No entity-key behavior changed. |
| Server state server-side | PASS | No client/server ownership change in this retest. |
| Logout clears everything | N/A | No auth persistence changed. |
| Label temporary | N/A | No temporary user-facing state added. |
| Subtract before adding | PASS local | Regression suite and strict-grep bundle still pass; live deploy remains held separately. |
| No fabricated data | PASS local | Native tax regression still passes. |
| Currency-aware | PASS local | Native tax regression still passes. |
| One auth instance | N/A | No auth-client change. |
| Validate at right time | PASS local | Native tax regression still passes. |
| Exclusion consistency | N/A | No exclusion behavior changed. |
| Persisted-state startup | N/A | No persisted client-state change. |

## 7. Findings

### P0 Critical

None.

### P1 High

None. The prior P1 C7 blocker is fixed.

### P2 Medium

None in this retest. The live deploy gate remains explicitly held outside this pass/fail decision.

### P3 Low

None.

### P4 Notes

- **P4-001:** The negative remove proof used an in-memory transformed copy of the strict-grep script instead of editing the branch file. This preserves tester no-repair discipline while proving the same C7 failure path.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| ORCH-0863 C7 restored pass | PASS | Restored script exits 0; C7 reports 52 changed files and no forbidden backend offenders. | None. |
| `shell.test.ts` remove proof | PASS | In-memory removal of line 728 exits 1 and names only `supabase/functions/_shared/email/__tests__/shell.test.ts`. | None. |
| `shell.test.ts` restore proof | PASS | Real branch script exits 0 immediately after negative proof. | None. |
| Email jurisdiction regression still passes | PASS | `shell.test.ts:81-98`; Deno test 10/10 passing. | None. |
| Held live-deploy gate | HELD | Prompt forbids deploy/secrets/Dashboard/migration mutation. | Separate Seth authorization gate. |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No secrets/Dashboard mutation | P0 scope | No Stripe Dashboard, secret, migration apply, or edge deploy commands were run. | PASS |
| CI guard integrity | P1 prior | Remove proof fails exactly on the protected backend test path; restore passes. | PASS |
| Payment/order integrity regression | P0 prior | ORCH-0955 Deno regression suite still passes 17/17. | PASS local |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Embedded Tax UI | Not reworked in this cycle; covered by ORCH-0955 regression suite and prior retest. | P2 prior | PASS local |
| Cart unsupported-country copy | Not reworked in this cycle; covered by ORCH-0955 regression suite and prior retest. | P2 prior | PASS local |
| Ticket email jurisdiction labels | `shell.test.ts:81-98` asserts HTML and text include jurisdiction labels. | P2 prior | PASS local |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Partial | PASS local | Covered by ORCH-0955 Deno source regression; no device run in this retest. |
| Business | Partial | PASS local | Embedded/cart source regression covered; no browser run in this retest. |
| Admin | N/A | N/A | Not touched. |
| Public/web | Partial | PASS local | Business buyer-web source regression covered. |
| Solo | N/A | N/A | Not relevant. |
| Collab | N/A | N/A | Not relevant. |
| iOS | Source only | PASS local | No device run. |
| Android | Source only | PASS local | No device run. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| C7 allowlists `shell.test.ts` | No runtime impact | No runtime impact | No runtime impact | CI gate impact only | None | Restores PR close path while keeping C7 strict for unallowlisted backend files. |
| Email shell regression test | Email receipt proof | Email receipt proof | N/A | Shared renderer test | None | Confirms jurisdiction label rendering remains covered. |
| Held deploy | Runtime not changed | Runtime not changed | Runtime not changed | Edge deploy not performed | None | Separate pending Seth authorization. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Migrations | Not run by instruction | HELD | None for this C7 retest; do not apply unless separately authorized. |
| Edge deploy | Not run by instruction | HELD | Deploy `ticket-checkout-create` only after Seth authorizes the live-deploy phase. |
| Stripe Dashboard/secrets | Not touched by instruction | HELD | Tax RAK/live-brand setup remains external. |
| Live checkout | Not live-fired | HELD | After authorized deploy, verify installment PaymentIntent amount equals deposit plus deposit tax. |

## 14. Required Actions

None for this retest. ORCH-0955 is ready to route to orchestrator for CLOSE handling, with the live deploy gate kept separate pending Seth authorization.

## 15. Conditional / Recommended Actions

1. Keep the live deploy gate open until Seth separately authorizes `ticket-checkout-create` deployment and remote verification.
2. Do not remove the ORCH-0955 C7 allowlist lines until ORCH-0863's strict-grep scope is redesigned or the relevant backend files are merged into `main`.

## 16. Discoveries For Orchestrator

- No new cross-ORCH comms-ledger entry was created. COMMS-0002 already covers the general C7 backend PR blocker class, and this retest confirms the ORCH-0955-specific instance is resolved.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| P1-001: ORCH-0863 C7 still blocks because `shell.test.ts` is not allowlisted | Yes | `orch-0863-marketing-hub-phase-b.mjs:728`; restored C7 PASS; in-memory remove proof FAILS exactly on `shell.test.ts`; restored C7 PASS | No. |
| P2-001: Live deploy verification remains held | Separate gate | Prompt forbids deploy/migrations/secrets/Dashboard mutation | No new code regression; still pending Seth authorization. |

Retest cycle: 2
