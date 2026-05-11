# CLOSE NOTE ORCH-0784 - Event List Sales Summary Visibility

> Date: 2026-05-11
> Owner: Codex `orchestrator-mingla`
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> Verdict: CLOSED PASS / Grade A

## Evidence

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
- QA: `Mingla_Artifacts/reports/QA_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
- QA verdict: PASS, P0=0 / P1=0 / P2=0 / P3=2 / P4=2

## Closed Contract

Mingla Business Home and Events now show server-backed tickets-sold and online amount-made summaries for every non-draft event row/card. Limited-capacity, unlimited/no-finite-capacity, zero-sale, nonzero-sale, refunded, and currency-review states are covered by the shared `buildEventSalesSummary` contract and ORCH-0784 regression gates.

## Verification

- `cd mingla-business && npm run test:orch-0784` - PASS
- `cd mingla-business && npx jest moneySummary.test eventOrdersService.test` - PASS
- `cd mingla-business && npx tsc --noEmit` - PASS
- `cd mingla-business && npm run test:orch-0754` - PASS
- `cd mingla-business && npm run test:orch-0777` - PASS
- `git diff --check` - PASS
- DIAG-marker reap for `[ORCH-0784-DIAG]` - zero matches

## Deploy Notes

Mingla Business JS OTA only. No Supabase migration, Edge Function deploy, native module change, env var, provider secret, checkout, Stripe, QR, notification, ORCH-0777, or ORCH-0782 deploy belongs to this close.

EAS update commands executed as two separate invocations:

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0784: keep event list sales summaries visible"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0784: keep event list sales summaries visible"
```

## Accepted Follow-Ups

- ORCH-0784-A candidate: Home row error path can render `Unable to load sold` for finite-capacity events when the summary query errors. Cosmetic P3; registered for later polishing, no immediate dispatch.
- Product decision: mixed finite + unlimited ticket configurations currently follow the spec literally by showing finite progress such as `10 / 5` when unlimited tickets also exist. This is spec-compliant but may need product copy/design direction; surfaced in DEC-144, no immediate dispatch.

## Scoped Exclusions

`Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md` and unrelated ORCH-0785/ORCH-0786/ORCH-0787 worktree files are intentionally excluded from the ORCH-0784 close commit. ORCH-0784 did not reopen ORCH-0777 and did not absorb ORCH-0782.
