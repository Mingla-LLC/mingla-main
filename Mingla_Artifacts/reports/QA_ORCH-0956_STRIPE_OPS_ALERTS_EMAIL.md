# QA Report: Stripe ops alerts to email (ORCH-0956)

> Date: 2026-05-25
> Mode: TARGETED + SPEC-COMPLIANCE
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:0 P4:2

## 1. Layman Summary

ORCH-0956 correctly moves the targeted Stripe operator alerts from push notifications to Resend email and the tester-owned adversarial tests T-05 through T-08 pass locally. I did not find a product-code blocker in the dispute, webhook-signature, or email helper paths. The release is conditional because PR #202 is currently blocked by two GitHub checks: the append-only test gate needs the requested `[TEST-MOD-APPROVED ORCH-0956]` token on the latest close commit, and the ORCH-0863 strict-grep gate is incorrectly blocking this backend ORCH for adding a `supabase/functions/` file.

No migrations were applied, no edge functions were deployed, no Supabase secrets were written, and no Stripe Dashboard settings were changed.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md`
- PR: #202, `ORCH-0956-stripe-ops-alerts-email` into `main`
- Changed implementation files:
  - `supabase/functions/_shared/stripeOpsAlertEmail.ts`
  - `supabase/functions/_shared/stripeDisputeHandlers.ts`
  - `supabase/functions/stripe-webhook/index.ts`
- Changed / added tests:
  - `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts`
  - `supabase/functions/_shared/__tests__/stripeOpsAlertEmailRecipients.test.ts`
  - `supabase/functions/_shared/__tests__/stripeOpsAlertEmailSandbox.test.ts`
  - `supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `stripe_disputes` migration referenced by existing tests | No ORCH-0956 migration; dispute upsert behavior still covered by existing ORCH-0953 tests. |
| Edge/RPC/Webhooks | `stripe-webhook/index.ts`, `stripeDisputeHandlers.ts` | Invalid signature still returns 400; dispute created/lost alerts are email-only; updated remains quiet. |
| Services/helpers | `stripeOpsAlertEmail.ts`, shared email renderer | Resend POST fan-out, recipient normalization, missing API key handling, sandbox sender guard. |
| Hooks/State/Cache | N/A | Backend-only ORCH. |
| Components/Screens | N/A | Backend-only ORCH. |
| Business/Admin/Public | N/A | No client/admin UI touched. |
| Tests/Build | Deno fmt/check/lint/test | ORCH-0956 targeted tests and Stripe-scoped gate pass locally. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| `charge.dispute.created` sends operator email using `STRIPE_DISPUTE_ALERT_EMAILS`. | `stripeDisputeHandlers.ts:73-75`, `137-204`, `339-349`; T-01 passing. | Verified | Uses `sendOpsAlertEmail`; no legacy user-id env in this path. |
| `charge.dispute.closed` with `status: "lost"` sends operator email and keeps AppsFlyer. | `stripeDisputeHandlers.ts:206-249`, `359-375`; T-02 passing. | Verified | Alert happens before existing `dispute_lost` AppsFlyer event. |
| `charge.dispute.updated` sends no alert. | `stripeDisputeHandlers.ts:339-376`; T-03 passing. | Verified | No updated branch alert exists. |
| Missing `STRIPE_DISPUTE_ALERT_EMAILS` does not block persistence or AppsFlyer. | T-05 at `stripeDisputeHandlers.test.ts:306`; local test pass. | Verified | Warns and returns before email call. |
| Malformed amount degrades without throwing. | T-06 at `stripeDisputeHandlers.test.ts:351`; local test pass. | Verified | Current implementation degrades missing amount to `USD 0.00`. |
| Recipient normalization trims, lowercases, dedupes, and drops malformed values. | `stripeOpsAlertEmail.ts:27-34`; T-07 at `stripeOpsAlertEmailRecipients.test.ts:3`; local test pass. | Verified | One POST attempted to `seth@usemingla.com`. |
| Resend sandbox sender guard prevents send and does not break dispute upsert. | `stripeOpsAlertEmail.ts:57-68`; T-08 at `stripeOpsAlertEmailSandbox.test.ts:67`; local test pass. | Verified | Direct helper rejects; dispute alert envelope catches; no fetch call. |
| Signature-failure alert emails `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` and preserves HTTP 400. | `stripe-webhook/index.ts:33-58`, `91-102`; T-04 passing. | Verified | Alert failure is caught and invalid-signature response still returns. |
| Legacy `*_USERS` env vars removed from the two target paths. | `rg "STRIPE_DISPUTE_ALERT_USERS|STRIPE_WEBHOOK_FAILURE_ALERT_USERS" supabase/functions` | Verified | No legacy env hits remain. |
| Out-of-scope `dispatchNotification` callers remain untouched. | `rg "dispatchNotification" supabase/functions` | Verified | Remaining callers are brand detach, webhook health, KYC/remediation/settlement, and KYC stall reminder paths. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Tester-owned adversarial tests T-05 through T-08 | `DENO_TESTING=1 deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/_shared/__tests__/stripeOpsAlertEmailRecipients.test.ts supabase/functions/_shared/__tests__/stripeOpsAlertEmailSandbox.test.ts` | PASS | `9 passed | 0 failed` |
| ORCH-0956 targeted suite including T-01 through T-08 and webhook T-04 | `DENO_TESTING=1 deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts supabase/functions/_shared/__tests__/stripeOpsAlertEmailRecipients.test.ts supabase/functions/_shared/__tests__/stripeOpsAlertEmailSandbox.test.ts supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts` | PASS | `12 passed | 0 failed` |
| Stripe-scoped workflow gate with ORCH-0956 tests | `DENO_TESTING=1 SUPABASE_URL=https://example-test.supabase.co SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real STRIPE_WEBHOOK_SECRET=whsec_test STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_test_platform STRIPE_WEBHOOK_SECRET_PREVIOUS= deno test --allow-env --allow-net --allow-read --no-check ...` | PASS | `26 passed | 0 failed` |
| Deno check | `deno check supabase/functions/stripe-webhook/index.ts supabase/functions/_shared/stripeDisputeHandlers.ts supabase/functions/_shared/stripeOpsAlertEmail.ts supabase/functions/_shared/__tests__/stripeOpsAlertEmailRecipients.test.ts supabase/functions/_shared/__tests__/stripeOpsAlertEmailSandbox.test.ts` | PASS | Typecheck completed. |
| Deno format | `deno fmt --check ...` on touched ORCH-0956 files | PASS | `Checked 7 files` |
| Deno lint | `deno lint ...` on touched ORCH-0956 files | PASS | `Checked 7 files` |
| PR required checks | `gh pr view 202 --json ...` + failed run logs | CONDITIONAL | PR #202 is `OPEN`, `mergeStateStatus: BLOCKED`; see P2 findings. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | N/A | Backend-only. |
| One owner per truth | PASS | Email allowlists are env-owned; no `notifications` dual-write added. |
| No silent failures | PASS | Missing alert env/API key warn; Resend non-2xx and send exceptions log; webhook invalid-signature still returns 400. |
| One key per entity | N/A | No app cache/query keys. |
| Server state server-side | PASS | Stripe dispute persistence remains server-side in edge handler. |
| Logout clears everything | N/A | No client state. |
| Label temporary | N/A | No transitional labels added. |
| Subtract before adding | PASS | Replaced the two push alert paths; did not add parallel notification rows. |
| No fabricated data | PASS | Subjects/bodies derive from Stripe payload and brand lookup, with explicit `unknown brand` fallback. |
| Currency-aware | PASS | `formatCurrencyAmount` handles zero-decimal currencies and default USD fallback. |
| One auth instance | N/A | No auth client surface changed. |
| Validate at right time | PASS | Webhook signature failure handling remains before routing/persistence. |
| Exclusion consistency | PASS | `charge.dispute.updated` stays alert-free and covered by T-03. |
| Persisted-state startup | N/A | No persisted client state. |

## 7. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: PR #202 is blocked by append-only test gate until the latest close commit carries the approval token**
- **Evidence:** GitHub Actions run `26381105638`, `Test files: append-only`; log reports deleted lines in `stripeDisputeHandlers.test.ts` and `signatureFailureAlert.test.ts` and says the latest commit body lacks `[TEST-MOD-APPROVED ORCH-NNNN]`.
- **What is wrong:** The implementation intentionally modified existing tests per spec, but CI only accepts this when the latest commit body includes `[TEST-MOD-APPROVED ORCH-0956]`. Seth also requested that token in the close commit subject.
- **Impact:** PR cannot merge until a new close/report commit carries the token.
- **Required fix:** Orchestrator CLOSE commit should include `[TEST-MOD-APPROVED ORCH-0956]` in the subject and body so the CI parser and Seth's requested convention are both satisfied.
- **Retest:** Re-run PR checks and confirm `Test files: append-only` passes.

**P2-002: ORCH-0863 strict-grep gate is incorrectly blocking this backend ORCH**
- **Evidence:** GitHub Actions run `26381105657`, job `ORCH-0863: Marketing Hub Phase B invariants`; failure `C7: no-new-backend-files` flags `supabase/functions/_shared/stripeOpsAlertEmail.ts`.
- **What is wrong:** ORCH-0956 is a legitimate backend-only Stripe ORCH, but the marketing-hub gate is globally rejecting `supabase/functions/` changes in this PR.
- **Impact:** PR #202 cannot merge even though the ORCH-0956 local Stripe tests pass. This may also block other backend Stripe/tax ORCHs.
- **Required fix:** Orchestrator should either scope/allowlist the ORCH-0863 gate for non-marketing backend ORCHs or explicitly waive/reroute this CI failure before close.
- **Retest:** Re-run PR checks and confirm `ORCH-0863: Marketing Hub Phase B invariants` passes or is no longer required for this backend PR.

### P3 Low

None.

### P4 Notes

- **P4-001:** Wrote COMMS-0002 to the comms ledger for the cross-ORCH CI-gate discovery; committed directly to anchor `main` as `63d33645`.
- **P4-002:** Existing broad `_shared` suite failures from the implementation report (`bouncer.test.ts`, `scorer.test.ts`) were not re-investigated because the dispatch scoped tester-owned adversarial tests to T-05 through T-08 only.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-1 dispute.created email alert | Implemented | T-01 pass; code `stripeDisputeHandlers.ts:137-204`, `339-349` | None |
| SC-2 dispute.closed lost email alert | Implemented | T-02 pass; code `stripeDisputeHandlers.ts:206-249`, `359-375` | None |
| SC-3 dispute.updated no alert | Implemented | T-03 pass | None |
| SC-4 missing dispute email env | Implemented | T-05 pass | None |
| SC-5 signature failure email + 400 | Implemented | T-04 pass; `stripe-webhook/index.ts:91-102` | None |
| SC-6 missing `RESEND_API_KEY` no throw | Implemented | `stripeOpsAlertEmail.ts:45-52`; implementation evidence accepted; not one of requested T-05..T-08 | None |
| SC-7 legacy env names removed | Implemented | `rg` shows no `STRIPE_*_ALERT_USERS` hits | None |
| SC-8 no `notifications` dual-write | Implemented | No `dispatchNotification` call in target paths; helper only posts to Resend | None |
| SC-9 no deploy/migration/secret/Stripe mutation | Implemented | Command history and diff review | None |
| SC-10 sandbox sender guard | Implemented | T-08 pass | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No secret logging | P4 | Helper logs subject/count/status/detail, not API key; webhook logs signature prefix only. | PASS |
| Sandbox sender blocked | P4 | T-08; `assertNotResendSandbox` before POST. | PASS |
| Alert failure cannot break webhook invalid-signature response | P4 | `stripe-webhook/index.ts:94-102`; T-04. | PASS |
| Alert failure cannot break dispute upsert | P4 | `stripeDisputeHandlers.ts:184-203`, `230-249`; T-08. | PASS |

## 10. UX / Accessibility

Backend-only. No user-facing UI or accessibility surface changed.

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | N/A | N/A | Backend-only. |
| Business | N/A | N/A | Backend-only. |
| Admin | N/A | N/A | Existing admin disputes surface not touched. |
| Public/web | N/A | N/A | Backend-only. |
| Solo | N/A | N/A | Backend-only. |
| Collab | N/A | N/A | Backend-only. |
| iOS | N/A | N/A | Backend-only. |
| Android | N/A | N/A | Backend-only. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Replace Stripe ops push alerts with email | None | None | None | `stripe-webhook`, dispute handler shared module | Existing `stripe_disputes` upsert unchanged | Backend deploy required after merge. |
| Add shared Resend helper | None | None | None | `_shared/stripeOpsAlertEmail.ts` | None | Uses existing email shell and Resend API key. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Local edge-function behavior | Deno unit tests and static code review | PASS | None before merge. |
| Production secret presence | Not mutated by tester | CONDITIONAL | Seth sets `STRIPE_DISPUTE_ALERT_EMAILS` and `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` after deploy. |
| Edge deploy | Not performed by tester | CONDITIONAL | Orchestrator deploys `stripe-webhook` after close/merge. |
| Real Resend delivery | Not performed to avoid live email mutation | CONDITIONAL | After deploy + env vars, trigger a safe Stripe test-mode webhook or monitor first live alert. |

## 14. Required Actions

1. **P2-001:** Orchestrator CLOSE commit must include `[TEST-MOD-APPROVED ORCH-0956]` in the subject and body, then push so the append-only CI gate can re-evaluate.
2. **P2-002:** Orchestrator must resolve or waive the ORCH-0863 strict-grep backend-file blocker for PR #202 before merge.

## 15. Conditional / Recommended Actions

1. After merge, orchestrator deploys `stripe-webhook`; no `[deploy]` tag is needed in the close commit.
2. Seth sets `STRIPE_DISPUTE_ALERT_EMAILS` and `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` in Supabase project secrets.
3. Seth removes legacy `STRIPE_DISPUTE_ALERT_USERS` and `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` at his pace after the new env vars are live.

## 16. Discoveries For Orchestrator

- COMMS-0002 recorded the ORCH-0863 gate issue because it can affect other backend ORCHs, including Stripe/tax work.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| T-05 missing dispute alert env | Verified | Local Deno test pass | No regression found. |
| T-06 malformed amount | Verified | Local Deno test pass | No regression found. |
| T-07 recipient normalization | Verified | Local Deno test pass | No regression found. |
| T-08 sandbox sender rejection | Verified | Local Deno test pass | No regression found. |

Retest cycle: N/A
