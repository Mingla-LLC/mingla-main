# Retest Report: Business Active Brand Runtime Smoke (ORCH-0756A)

> Date: 2026-05-08
> Mode: RETEST + TARGETED RUNTIME SMOKE
> Verdict: BLOCKED/UNVERIFIED
> Findings: P0:0 P1:0 P2:1 P3:0 P4:2

## 1. Layman Summary

The code-level fix still looks healthy: the active-brand recovery guard, resolver tests, ORCH-0754 Home regression tests, and TypeScript all pass in the current workspace.

But this retest was specifically supposed to prove the real sign-out/sign-in experience with a credentialed business account. I could not complete that runtime smoke because no safe test credentials or prepared runtime account/data were provided. The local `mingla-business/.env` contains app boot configuration after redaction, but no usable account credentials for signing in and checking real brand recovery.

So this is **not a PASS**. It is **BLOCKED/UNVERIFIED** for the runtime smoke gate. No implementor rework is indicated from this retest; the missing item is runtime access/evidence.

## 2. Inputs Reviewed

- Retest prompt: `Mingla_Artifacts/prompts/RETEST_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RUNTIME_SMOKE.md`
- Prior QA report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0756_BUSINESS_DRAFT_AND_BRAND_PERSISTENCE.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
- Code evidence:
  - `mingla-business/src/utils/currentBrandResolver.ts`
  - `mingla-business/src/hooks/useCurrentBrandRecovery.ts`
  - `mingla-business/app/(tabs)/home.tsx`
  - `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`
  - `mingla-business/package.json`

## 3. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| ORCH-0756A guard + resolver | `PATH=/opt/homebrew/bin:$PATH npm run test:orch-0756a` from `mingla-business` | PASS | Strict guard passed 22 checks; `currentBrandResolver.test.ts` 6/6 PASS. |
| ORCH-0754 Home regression | `PATH=/opt/homebrew/bin:$PATH npm run test:orch-0754` from `mingla-business` | PASS | I-PROPOSED-Z guard PASS; `brandEventSummary.test.ts` 5/5 PASS. |
| TypeScript | `PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit` from `mingla-business` | PASS | Exit 0. |
| Runtime credential availability | Redacted review of `mingla-business/.env` / `.env.example`; no values printed | BLOCKED | Boot config exists, but no sign-in account credentials or prepared test account data were provided. |
| Product-code status check | `git diff --name-only -- mingla-business` | INFO | ORCH-0756A business files remain dirty/uncommitted in the current workspace; focused gates above still pass. |

## 4. Runtime Smoke Matrix

| Required runtime check | Result | Evidence / blocker |
|---|---|---|
| Existing account with one brand and no local selected brand recovers after sign-out/sign-in | UNVERIFIED | No credentialed business account provided. |
| Multiple brands with valid `creator_accounts.default_brand_id` selects default after sign-out/sign-in | UNVERIFIED | No credentialed business account with known multiple-brand fixture provided. |
| Existing brands with invalid/missing default falls back to newest and persists replacement | UNVERIFIED | Would require safe data mutation or a prepared test account; tester mode did not mutate live data. |
| Account with no brands shows true `No brands yet` only after load | UNVERIFIED | No no-brand test account provided. |
| Pick/create brand, sign out/in, selected brand recovers | UNVERIFIED | Would require credentialed runtime access and safe brand creation/mutation authority. |

## 5. Code Evidence Reconfirmed

| Claim | Status | Evidence |
|---|---|---|
| Resolver keeps valid local, then valid server default, then newest brand, then none | VERIFIED code/test | `currentBrandResolver.ts:24-42`; `test:orch-0756a` PASS. |
| Recovery waits for fetched brands/account before resolving | VERIFIED code | `useCurrentBrandRecovery.ts:40-52`. |
| Newest fallback writes `creator_accounts.default_brand_id` and exposes failure | VERIFIED code | `useCurrentBrandRecovery.ts:74-87`. |
| Home separates true no-brands, choose-brand, and loading/recovery states | VERIFIED code | `home.tsx:230-240`, `home.tsx:287-326`. |
| Brand pick/create updates local selection and attempts default persistence | VERIFIED code | `BrandSwitcherSheet.tsx:114-124`, `BrandSwitcherSheet.tsx:135-152`. |

## 6. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: ORCH-0756A runtime sign-out/sign-in proof remains blocked**
- **Evidence:** Retest prompt required credentialed business-app runtime checks. No safe test credentials, prepared business account, or account fixture instructions were provided. Redacted env review showed runtime boot keys only, not usable account credentials.
- **Impact:** The exact user-visible repair is still not runtime-proven. Automated and static evidence reduce code risk, but they do not exercise Supabase auth session bootstrap, store cleanup, React Query refetch, AsyncStorage persistence, and Home render together.
- **Required action:** Provide or run a safe credentialed business-app smoke with known account fixtures:
  1. one-brand account,
  2. multi-brand valid default account,
  3. invalid/missing default fallback account,
  4. no-brand account,
  5. pick/create brand then sign-out/sign-in account.
- **Rework needed:** None indicated from this retest.

### P3 Low

None.

### P4 Notes

- **P4-001:** Focused automated gates remain green in the current workspace.
- **P4-002:** Jest emitted a Watchman recrawl warning during both Jest runs. Tests still passed; this is local dev-environment hygiene, not ORCH-0756A behavior.

## 7. Verdict

**BLOCKED/UNVERIFIED.**

ORCH-0756A remains code-verified and has no new P0/P1 blocker from this retest, but the specific runtime smoke requested by orchestrator could not be completed without credentialed business-app access and safe test data.

## 8. Orchestrator Notes

Do not close ORCH-0756A as runtime-proven from this report alone. The next close path is either:

1. operator/tester performs the credentialed smoke and records PASS evidence, or
2. orchestrator explicitly accepts conditional close/manual deferral with the runtime gate still unverified.

ORCH-0756B draft persistence remains separate and was not tested here.
