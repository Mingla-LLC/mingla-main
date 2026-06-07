# Close Report: ORCH-1094 Business Web Core Parity Wave

Date: 2026-06-07
Skill: orchestrator-mingla (Codex)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`
Branch: `ORCH-1094-business-web-core-parity-wave`
Close verdict: CONDITIONAL PASS Grade A for the signed-in phone-browser safety contract.

## Outcome

ORCH-1094 closes the immediate signed-in mobile-browser failure Seth reported after ORCH-1085-1093: phone browser Google sign-in no longer falls into the full Expo tabs Home crash path, and signed-in Android Chrome can open the real Event Create wizard without a white screen or browser error.

The close is intentionally scoped. This is not a claim that Hub, Marketing, Account, or Campaign Compose have full interactive phone-browser parity. Those heavy signed-in routes now route to stable static Home sections on phone browsers, so they are safe and fast instead of blank/crashy, but deeper route functionality remains follow-up web-parity work.

## What Changed For Users

- Google sign-in on a phone browser lands on static `/home` instead of the heavy Expo tabs Home.
- Signed-in Android Chrome opens the real Event Create wizard from `/event/create`.
- Hub Events, Hub Trips, Marketing overview, Campaign Compose, and Account no longer load the heavy route shell directly on phone browsers when signed in; they redirect to static Home sections.
- `/hub/experiences`, `/ari`, and `/connect-account-management` remain protected.
- Desktop web and native business apps are not intentionally changed.

## Evidence

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`
- QA report and retest addendum: `Mingla_Artifacts/reports/QA_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`
- Design direction: `Mingla_Artifacts/reports/DESIGN_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`
- Physical Android evidence: `Mingla_Artifacts/reports/orch-1094-physical-confirmation/`

## Verification

Commands run from `mingla-business`:

```bash
npx jest src/context/__tests__/AuthContext.timeout.test.ts src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts --runInBand
```

Result: PASS, 2 suites and 26 tests.

```bash
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1094
```

Result: PASS. The chained gate passed ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093, and ORCH-1094. Final bundle evidence included `phoneBoot=2885700`, `__common=1882545`, `deferred=true`, and route chunks for `/event/create`, `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account`.

## Test Modification Approval

[TEST-MOD-APPROVED ORCH-1094]

Two existing test assertions were intentionally replaced because this ORCH changed the guarded behavior:

- `AuthContext.timeout.test.ts`: the old timeout contract required `getSession()` timeout to fall through as anonymous. ORCH-1094 changes that contract for web by recovering a stored browser session when present, because physical Android Chrome proved Supabase `getSession()` can hang behind the browser lock even while a valid Supabase session is stored.
- `orch_1092_business_web_restoration_wave.test.ts`: the old ORCH-1092 contract required `/hub/trips` to remain shelled. ORCH-1094 moves `/hub/trips` into the approved core route set and guards it through the signed-in phone static-section redirect contract.

Physical Android Chrome on Samsung A72 `R58R54YV7JT`:

- Google sign-in with `sethpgieva@gmail.com` reached static signed-in `/home`.
- `/event/create?storedbrand=1` opened the real Step 1 Event Creator wizard and minted a draft edit route.
- `/hub/events?storedbrand=1`, `/hub/trips?storedbrand=1`, `/marketing?storedbrand=1`, `/marketing/campaigns/compose?storedbrand=1`, and `/account?storedbrand=1` rendered stable static Home sections instead of blanking or crashing.

## Residual Conditions

- Physical iPhone Safari signed-in proof was not run in this session. Prior Playwright iPhone-equivalent smoke remains the iPhone browser coverage for the branch.
- Full interactive phone-browser parity for Hub, Marketing, Account, and Campaign Compose is not complete. This close turns those routes into safe static launch sections on phones; a follow-up ORCH should restore deeper per-route functionality.

## Deploy Notes

This is a business web change and requires a `[deploy]` PR/title path. Deploy must run only from merged `main` per COMMS-0015 and COMMS-0018. No Supabase migration, edge deploy, native rebuild, or OTA is required for this ORCH.
