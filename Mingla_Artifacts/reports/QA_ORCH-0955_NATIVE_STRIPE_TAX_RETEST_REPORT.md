# QA Report: Native Stripe Tax QA Fixes Retest (ORCH-0955)

> Date: 2026-05-25
> Mode: RETEST
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:1 P3:0 P4:2

## 1. Layman Summary

The main product-code fixes for ORCH-0955 were verified locally: installment deposit tax now uses the current deposit charge as the Stripe Tax base, embedded Stripe Tax load failures show a recoverable error, unsupported-country tax errors render specific buyer copy, and ticket emails can show jurisdiction labels.

The retest still fails because the ORCH-0863 C7 strict-grep allowlist is incomplete. The QA fix added the ORCH-0955 edge test to the backend allowlist, but the same PR also changes `supabase/functions/_shared/email/__tests__/shell.test.ts`, and C7 still rejects that file. The live edge-function deploy gate remains intentionally held per Seth's instruction and is not counted as implementor failure in this retest.

## 2. Inputs Reviewed

- Prior QA report: `Mingla_Artifacts/reports/QA_ORCH-0955_NATIVE_STRIPE_TAX_REPORT.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0955_NATIVE_STRIPE_TAX_QA_FIXES.md`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/`
- Branch / commit: `ORCH-0955-native-stripe-tax` at `122000e6e5abc6f31b862152422e68d7a81a10d8`
- Comms ledger: `COMMS-0001`, `COMMS-0002`, and `COMMS-0003` reviewed; `COMMS-0003` was newly acknowledged by `tester+codex (ORCH-0955)`.
- Stripe docs checked:
  - https://docs.stripe.com/connect/supported-embedded-components/tax-registrations
  - https://docs.stripe.com/connect/supported-embedded-components/tax-settings
  - https://docs.stripe.com/api/tax/calculations/create

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Edge/RPC/Webhooks | `supabase/functions/ticket-checkout-create/index.ts`, `refund-order`, `stripe-webhook`, account-session function | Tax-before-PI order, installment deposit normalization, Stripe Tax error classification, Deno check |
| Components/Screens | `mingla-business/app/connect-tax-registrations/index.tsx` | Embedded `ConnectTaxRegistrations` and `ConnectTaxSettings` load-error handling |
| Mobile / Business buyer UI | Both `CartTaxPreview.tsx` files | Unsupported-country edge error copy and targeted TS compilation |
| Email | `supabase/functions/_shared/email/ticketBody.ts`, `shell.test.ts` | Jurisdiction label rendering in HTML/text receipts |
| CI / Strict grep | ORCH-0863, ORCH-0804, ORCH-0955 strict-grep scripts | Backend allowlist and native Tax invariants |
| External provider docs | Stripe official docs | Embedded component names, account-session component enablement, Tax Calculation `line_items.amount` contract |
| Production deploy | Held by prompt | No migrations applied, no edge deploy, no Stripe Dashboard/secrets mutation |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Installment deposit Stripe Tax and PaymentIntent use current charge, not full order | `ticket-checkout-create/index.ts:161-184`, `997-1005`, `1033-1041`, `1135-1180`; Deno test `T-IH-01b` | Verified locally | Source normalizes mismatched installment line items to a one-line deposit amount and disables client tax-calculation reuse for installment plans. |
| ORCH-0863 C7 allowlist remove/restore behavior is fixed | `orch-0863-marketing-hub-phase-b.mjs:725-742`; command output from C7 | Refuted | Current restored state still fails on `supabase/functions/_shared/email/__tests__/shell.test.ts`, so remove/restore acceptance cannot pass. |
| Embedded Tax load-error handling works in source | `connect-tax-registrations/index.tsx:21-78`, `97-105`; Deno test `T-IH-07b`; targeted TS | Verified locally | Both embedded Tax components wire `onLoadError` to the required error shell. |
| Unsupported-country cart copy renders in consumer and business | `ticket-checkout-create/index.ts:140-158`, both `CartTaxPreview.tsx:50-70`; Deno tests `T-IH-01c`, `T-IH-09`, `T-IH-10`; targeted TS | Verified locally | Edge returns `tax_country_unsupported` with HTTP 422; both clients map it to the required copy. |
| Ticket email renders tax jurisdictions | `ticketBody.ts:87-150`, `255-267`; `shell.test.ts:81-98` | Verified locally | HTML and text render `Tax (New York State, New York City)` when breakdown has jurisdiction labels. |
| Held live-deploy gate is resolved | Prompt constraints and implementation deploy notes | Not verified by design | No function deploy was authorized or performed. This remains a post-fix live gate. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Worktree identity | `git status --short --branch && git rev-parse HEAD && git branch --show-current` | PASS | Expected branch and commit; only untracked `node_modules` directories present before report write. |
| Stripe docs cross-check | Official docs listed in section 2 | PASS | Docs confirm Tax registrations/settings embedded components and Tax Calculation line-item amount semantics. |
| Edge typecheck | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/refund-order/index.ts supabase/functions/brand-stripe-tax-account-session/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts` | PASS | Exit 0. |
| ORCH-0955 Deno regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | PASS | 17 passed, 0 failed. |
| Email jurisdiction regression | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/email/__tests__/shell.test.ts` | PASS | 10 passed, 0 failed. |
| ORCH-0863 C7 restored state | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | FAIL | C7 rejects `supabase/functions/_shared/email/__tests__/shell.test.ts`. |
| ORCH-0863 remove/restore behavior | Required by QA-fix report | FAIL / not meaningful | Baseline restored state is not green, so a remove/restore proof would not prove the allowlist is complete. |
| ORCH-0804 strict grep | `node .github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` | PASS | 6/6 checks. |
| ORCH-0955 strict grep | All five ORCH-0955 scripts | PASS | Native tax coverage, commit, reversal, embedded UI, region-gate deleted all pass. |
| Legacy region/dashboard token scan | `rg "brand-stripe-tax-dashboard-link|stripeTaxDashboardLink|native_paid_not_allowed_in_region|isNativePaidAllowedForBrand|NATIVE_PAID_ALLOWED_REGIONS|useBrandStripeTaxDashboardLink|brandStripeTaxDashboard" --glob '!Mingla_Artifacts/**' --glob '!COMMS_LEDGER.md' --glob '!node_modules/**' .` | PASS | Exit 1 with no matches. |
| Business targeted TS | `npx tsc --noEmit --jsx react-jsx --esModuleInterop --moduleResolution node --module esnext --target esnext --lib dom,esnext --skipLibCheck app/connect-tax-registrations/index.tsx src/components/checkout/CartTaxPreview.tsx` in `mingla-business` | PASS | Exit 0. |
| Mobile targeted TS | `npx tsc --noEmit --jsx react-jsx --esModuleInterop --moduleResolution node --module esnext --target esnext --lib dom,esnext --skipLibCheck src/components/checkout/CartTaxPreview.tsx` in `app-mobile` | PASS | Exit 0. |
| Full business typecheck | `npm run typecheck -- --noEmit` in `mingla-business` | FAIL baseline | Existing unrelated errors; no new conclusion needed for this FAIL verdict. |
| Full mobile typecheck | `npx tsc --noEmit` in `app-mobile` | FAIL baseline | Existing unrelated errors; targeted changed-file TS passed. |
| Diff hygiene | `git diff --check` | PASS | Exit 0 before report write. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS | Embedded Tax load errors now render actionable close/retry copy. |
| One owner per truth | PASS | Tax calculation and persisted checkout state remain server-owned. |
| No silent failures | PASS local / CONDITIONAL live | Source surfaces Stripe Tax failures; live deploy still held. |
| One key per entity | PASS | Existing tax transaction/idempotency patterns unchanged. |
| Server state server-side | PASS | Stripe Tax calculation, transaction commit, and account sessions remain edge/server-side. |
| Logout clears everything | N/A | No auth persistence change. |
| Label temporary | PASS | Error states and preview states are labeled. |
| Subtract before adding | PASS local / CONDITIONAL live | Local region gate scan passes; remote deploy not authorized. |
| No fabricated data | PASS local | Installment tax line items now match the current deposit charge. |
| Currency-aware | PASS | Integer cents flow preserved. |
| One auth instance | PASS | No auth-client change. |
| Validate at right time | PASS local | Source validates buyer address and classifies tax-country failure before PI creation. |
| Exclusion consistency | N/A | No exclusion-list behavior changed. |
| Persisted-state startup | N/A | No persisted client-state change. |

## 7. Findings

### P0 Critical

None in local source retest. The former P0 installment overcharge source defect is fixed locally.

### P1 High

**P1-001: ORCH-0863 C7 still blocks the PR because the email shell test is not allowlisted**

- **Evidence:** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:725-742` allowlists ORCH-0955 backend files, including `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts`, but not `supabase/functions/_shared/email/__tests__/shell.test.ts`.
- **Command evidence:** `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` fails C7 with offender `supabase/functions/_shared/email/__tests__/shell.test.ts`.
- **What is wrong:** The QA fix solved the previous offender but missed the modified email regression test file.
- **Impact:** GitHub close checks can still fail even though product source fixes are otherwise locally verified.
- **Required fix:** Add `supabase/functions/_shared/email/__tests__/shell.test.ts` to the ORCH-0955 backend allowlist in the ORCH-0863 strict-grep script, then rerun C7. After C7 passes, perform the required remove/restore validation by temporarily removing that allowlist line, confirming C7 fails on the shell test, restoring it, and confirming C7 passes.
- **Retest:** Rerun `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, the remove/restore check, and the full strict-grep bundle.

### P2 Medium

**P2-001: Live deploy verification remains held and must not be treated as closed**

- **Evidence:** User prompt forbids applying migrations, deploying edge functions, mutating Stripe Dashboard, or touching secrets in this phase.
- **What is wrong:** Nothing new in implementor code; this is an explicit release gate.
- **Impact:** Source can be approved only as local branch behavior. Production `ticket-checkout-create` behavior remains unverified until Seth authorizes the deploy phase.
- **Required action:** After code rework passes, Seth must authorize the held deploy phase before any live checkout closeout.
- **Retest:** Deploy `ticket-checkout-create` from the ORCH-0955 branch only after authorization, inspect remote function body for ORCH-0955 tax code and absence of legacy region-gate tokens, then run the live/manual checkout acceptance plan.

### P3 Low

None.

### P4 Notes

- **P4-001:** The ORCH-0955 payment-integrity regression is repo-running and would have failed against the old source because the normalization function and installment tax-calculation guard did not exist. It is still primarily a source-structure test, so a future stronger runtime/mock test would improve confidence before broad payment launch.
- **P4-002:** Full app typechecks still fail on unrelated baseline issues, while targeted changed-file TypeScript checks pass for the touched cart and embedded Tax UI files.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| P0 installment deposit tax / PaymentIntent contract | PASS local | `ticket-checkout-create/index.ts:161-184`, `997-1005`, `1033-1041`, `1135-1180`; Deno `T-IH-01b` | None. |
| ORCH-0863 C7 allowlist remove/restore behavior | FAIL | C7 restored state still fails on `shell.test.ts` | P1-001. |
| Embedded Tax load-error handling | PASS local | `connect-tax-registrations/index.tsx:21-78`, `97-105`; Deno `T-IH-07b`; targeted TS | None. |
| Unsupported-country cart copy | PASS local | Edge classifier and both cart preview files; Deno `T-IH-01c`, `T-IH-09`, `T-IH-10`; targeted TS | None. |
| Ticket email jurisdiction rendering | PASS local | `ticketBody.ts:87-150`, `255-267`; `shell.test.ts:81-98`; Deno email test | None. |
| Held live-deploy gate | CONDITIONAL / held | Prompt constraints | P2-001. |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No secret/dashboard mutation | P4 | No Stripe Dashboard, secrets, migrations, or edge deploy commands were run. | PASS |
| Stripe Tax error body exposed to clients | P4 | Edge returns stable error code plus detail; existing generic failure remains for other tax errors. | PASS local |
| Payment/order integrity | P0 scope | Tax calculation precedes PI creation and installment line items are normalized to current charge. | PASS local |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Embedded Tax page | Expired/invalid component load now renders `Tax tools temporarily unavailable` plus close instruction. | P2 prior | PASS local |
| Cart tax preview | Unsupported country now renders country-specific copy instead of generic retry. | P2 prior | PASS local |
| Ticket email | Tax row includes jurisdiction labels when breakdown is present. | P2 prior | PASS local |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Yes | PASS local | Consumer cart unsupported-country mapping targeted TS passes. |
| Business | Yes | PASS local | Business cart mapping and embedded Tax route targeted TS passes. |
| Admin | N/A | N/A | Not touched. |
| Public/web | Partial | PASS local | Business buyer-web cart component mirrors consumer behavior. |
| Solo | N/A | N/A | Not relevant. |
| Collab | N/A | N/A | Not relevant. |
| iOS | Source only | CONDITIONAL | No device run in this phase. |
| Android | Source only | CONDITIONAL | No device run in this phase. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Installment tax normalization | Checkout amount integrity | Checkout amount integrity | N/A | `ticket-checkout-create` | No schema change | Local source verified; live deploy held. |
| Unsupported-country copy | Buyer copy fixed | Buyer copy fixed | N/A | Stable edge code | None | Both clients pass targeted TS. |
| Embedded Tax load error | N/A | Tax setup page fixed | N/A | Account-session path unchanged | None | Stripe docs confirm component names. |
| Email jurisdiction row | Email receipt | Email receipt | N/A | Dispatch renderer | No schema change | Regression test passes. |
| ORCH-0863 allowlist | PR gate blocked | PR gate blocked | PR gate blocked | CI | None | Incomplete allowlist is the current blocker. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Migrations | Not run by instruction | HELD | None in this retest; do not apply unless separately authorized. |
| Edge deploy | Not run by instruction | HELD | Deploy `ticket-checkout-create` only after Seth authorizes that phase. |
| Stripe Dashboard/secrets | Not touched by instruction | HELD | Tax RAK/live-brand setup remains external. |
| Live checkout | Not live-fired | HELD | After deploy and Stripe setup, run deposit checkout and verify PaymentIntent amount equals deposit plus deposit tax. |

## 14. Required Actions

1. **P1-001:** Add `supabase/functions/_shared/email/__tests__/shell.test.ts` to the ORCH-0955 backend allowlist in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, then rerun C7 and the remove/restore proof.

## 15. Conditional / Recommended Actions

1. **P2-001:** Keep the live deploy gate open until Seth separately authorizes `ticket-checkout-create` deployment and remote verification.
2. Consider strengthening `T-IH-01b` into a runtime/mock test that asserts full-order line items plus deposit subtotal produce a deposit-only Tax calculation payload.

## 16. Discoveries For Orchestrator

- No new cross-ORCH comms-ledger entry was created. COMMS-0002 already covers the C7 class of backend PR blocker, and this finding is specific to ORCH-0955 rework.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| P0 live checkout deploy stale | Held, not retested | Prompt forbids deploy; no deploy command run | No new source regression; gate remains open. |
| P0 installment-plan overcharge | Yes locally | Source normalization and Deno `T-IH-01b` pass | No. |
| P1 ORCH-0863 C7 allowlist | No | C7 now fails on `supabase/functions/_shared/email/__tests__/shell.test.ts` | Yes, gate still blocked. |
| P2 embedded Tax load error | Yes locally | `onLoadError` on both embedded components; Deno and targeted TS pass | No. |
| P2 unsupported-country copy | Yes locally | Edge code + both cart previews + Deno and targeted TS pass | No. |
| P2 ticket email jurisdiction names | Yes locally | Email renderer and `shell.test.ts` pass | No. |

Retest cycle: 1
