# IMPLEMENTATION — ORCH-0914 Trip Money Tab Redesign

**Status:** implemented, partially verified  
**Date:** 2026-05-22  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md`

## Summary

ORCH-0914 is implemented through the locked dependency order: additive migrations, shared installment PI helper extraction, two new edge functions, dedicated reminder email template, business app services/hooks, responsive Money route redesign, strict-grep gate, happy-path tests, Deno tests, and this report.

Partial verification label is because operator-owned `supabase db push` and post-push edge deploys were not run in this implementation turn, and repo-wide `tsc` / `expo lint` still fail on pre-existing unrelated files. Focused ORCH-0914 checks pass.

## Phase Receipts

| Phase | Receipt |
|---|---|
| 1 | Added `supabase/migrations/20260723000000_orch_0914_manual_buyer_reminders.sql` with `manual_buyer_reminders`, RLS read policy, advisory-lock 24h rate-limit RPC `biz_send_installment_reminder`, and `INSTALLMENT_REMINDER_SENT` audit action. |
| 2 | Added `supabase/migrations/20260723000001_orch_0914_manual_charge_installment.sql` with `biz_manual_charge_installment`, at-risk override guard, no Stripe PI creation, and `INSTALLMENT_CHARGED_MANUALLY` audit action. Added both slugs to `mingla-business/src/utils/auditActionLabels.ts`. |
| 3 | Extracted Stripe PI owner to `supabase/functions/_shared/installments/createInstallmentPI.ts`. `process-scheduled-installments` now calls the helper with the same row context it previously processed inline. |
| 4 | Added `supabase/functions/manual-charge-installment/index.ts`, JWT-gated, RPC-first, helper-second. |
| 5 | Added `supabase/functions/_shared/email/installmentReminderEmail.ts`. |
| 6 | Added `supabase/functions/send-installment-reminder/index.ts`, JWT-gated, RPC rate-limit first, Resend email primary, notify-dispatch push best-effort, ledger `delivery_results` update. |
| 7 | Added `manualInstallmentChargeService.ts` and `installmentReminderService.ts`. |
| 8 | Added `useManualInstallmentActions.ts` with `useChargeInstallmentNow`, `useSendInstallmentReminder`, and `useRecentReminderForOrder`. |
| 9-13 | Rebuilt `mingla-business/app/trip/[id]/money/index.tsx` as responsive phone card / tablet-web table with Buyer, Plan, Paid-to-date, Outstanding, Next installment, Last status, actions, at-risk confirm, reminder gating, pay-in-full rows, and unchanged expanded Retry-now / Cancel & refund path. Added `InstallmentScheduleDisplay variant="cell"`. |
| 14 | Added `.github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs` and workflow registration. Updated older Tr3 gate to recognize the shared helper as the superseding owner. |
| 15 | Added happy-path source regression tests at `mingla-business/app/trip/[id]/money/__tests__/money-redesign.test.tsx` covering T-01..T-18 plus in-memory fails-on-revert simulation. |
| 17 | Ran focused TypeScript/Deno/Jest/strict-grep/lint checks; details below. |
| 18 | This report. |

## Old → New Receipts

| Old | New |
|---|---|
| Money route rendered expandable stacked traveller cards. | Route renders phone cards at `width <= 480` and table rows otherwise via `useResponsiveLayout().width`. |
| Row showed combined paid count and next due date only. | Row exposes Plan, Paid-to-date, Outstanding, Next installment date + amount, Last status. |
| Retry-now only queued failed installments for cron. | Retry-now remains unchanged in the expanded ledger; new row-level Charge now invokes the manual charge edge function. |
| No manual reminder action. | Row-level Send reminder invokes rate-limited edge function; UI disables when `manual_buyer_reminders` has a recent row. |
| Cron owned installment PI creation inline. | Shared helper owns PI creation; cron and manual charge both call it. |
| No pay-in-full row handling. | Paid orders without installment rows render `Plan = "Paid in full"`, zero outstanding, no charge button, reminder disabled copy. |

## Verification

| Gate | Result |
|---|---|
| `node .github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs` | PASS — 190 files, 0 violations |
| `node .github/scripts/strict-grep/i-proposed-tr3-installment-pi-via-cron-owner.mjs` | PASS — 190 files, 0 violations |
| `node .github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` | PASS |
| `node .github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` | PASS — 8/8 checks |
| `npx jest --runTestsByPath 'app/trip/[id]/money/__tests__/money-redesign.test.tsx' --runInBand` | PASS — 19/19 |
| `/Users/sethogieva/.deno/bin/deno check supabase/functions/manual-charge-installment/index.ts supabase/functions/send-installment-reminder/index.ts supabase/functions/process-scheduled-installments/index.ts` | PASS |
| `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/process-scheduled-installments/__tests__/ supabase/functions/manual-charge-installment/__tests__/ supabase/functions/send-installment-reminder/__tests__/` | PASS — 19/19 |
| `npx eslint app/trip/[id]/money/index.tsx src/hooks/useManualInstallmentActions.ts src/services/manualInstallmentChargeService.ts src/services/installmentReminderService.ts src/components/trip/InstallmentScheduleDisplay.tsx` | PASS |
| `npm run typecheck` from `mingla-business` | FAIL — pre-existing unrelated errors remain; no ORCH-0914 file appears after the `IconName` fix. |
| `npm run lint` from `mingla-business` | FAIL — pre-existing repo-wide lint errors remain; focused ORCH-0914 lint passes. |

## Invariants / Guards

- `order_installments` schema and RLS unchanged.
- `orders` schema and RLS unchanged.
- No new DB table beyond `manual_buyer_reminders`.
- Existing Retry-now and Cancel & refund behavior preserved in expanded ledger.
- Cron per-installment Stripe behavior extracted into helper; the cron still passes existing installment/order/brand/stripe-account context into the helper.
- Send-reminder cannot deliver before `biz_send_installment_reminder` rate-limit ledger insert succeeds.
- Charge-now at-risk path requires explicit `atRiskOverride: true`; UI confirms and RPC rejects missing override.
- No admin-web, consumer iOS/Android, or buyer-anon-web files touched.

## Deviations / Notes

- The spec’s SQL snippets used illustrative `audit_log.action_slug` / `metadata` column names, but live schema has `audit_log.action`, `target_type`, `target_id`, and `after`. Implementation emits the locked slugs through the live ORCH-0806 resolver contract.
- PostgreSQL cannot create a partial unique index with `sent_at > now() - interval '24 hours'` because `now()` is not immutable. The RPC enforces the same rate-limit with `pg_advisory_xact_lock` + recent-row lookup.
- Edge functions are not deployed here. Per standing deploy split, operator runs `supabase db push`; deploy remains orchestrator-owned after approval.

## Next Required Gates

1. Operator: run `supabase db push` for the two new migrations.
2. Orchestrator after approval / promotion: deploy `manual-charge-installment` and `send-installment-reminder`.
3. Tester: live-fire sim on rebuilt dev binary per ORCH-0914 dispatch, including at-risk confirm, no-override rejection, reminder rate-limit, and phone/tablet layout.
