# CLOSE ORCH-0754 — Business Home Upcoming Stub Data

Date: 2026-05-08
Verdict: CLOSED CONDITIONAL PASS
Decision: DEC-132

## Plain-English Outcome

Business organisers should no longer see fake upcoming events or made-up live-event metrics on the Home dashboard. Home now derives its event story from the selected brand's real local draft/live event stores and order-store metrics.

## Evidence Chain

- Investigation: `reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`
- Spec: `specs/SPEC_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`
- Implementation: `reports/IMPLEMENTATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`
- Rework: `reports/IMPLEMENTATION_REWORK_ORCH-0754_BUSINESS_HOME_UPCOMING_SPEC_ALIGNMENT.md`
- Tester: `reports/TEST_REPORT_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`

## Accepted Verification

- `cd mingla-business && npm run test:orch-0754` PASS
- `cd mingla-business && npx jest brandEventSummary.test` PASS
- `node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs` PASS
- Direct fake-signature grep against `home.tsx` returned no matches
- `cd mingla-business && npx tsc --noEmit` PASS

## Accepted Condition

`cd mingla-business && npm run lint` remains red from unrelated repo-wide lint debt. Tester verified ORCH-0754 files are not named in the lint output, so this blocks broader release hygiene but does not block ORCH-0754 close.

## Lock-In

`I-PROPOSED-Z HOME-NO-FABRICATED-EVENTS` is ratified ACTIVE at close. The strict-grep gate is registered in the business strict-grep workflow and in `mingla-business/package.json` as part of `test:orch-0754`.

## Deploy Notes

Business app JS/web release path only. No Supabase migration, RLS, edge function, RPC, server read, native dependency/config, env var, Stripe, mobile, admin, public, checkout, scanner, finance, or backend deploy belongs to ORCH-0754.

## Follow-Ups Outside This Close

- Brand Profile fake recent events remain separate.
- Finance Reports brand-level event stubs remain separate.
- Supabase/client event-status vocabulary drift remains separate.
- Repo-wide business-app lint debt remains separate release hygiene.
