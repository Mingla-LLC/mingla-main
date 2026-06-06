# FORENSICS DISPATCH - ORCH-1092 Business Web Restoration Wave

Use Codex `forensic-mingla`.

## Goal

Investigate and write the implementation spec for the next larger business-web restoration wave: Hub, Account/Payouts, and Marketing Composer shell from static Home on phone browsers. This is not a scratch rewrite and not another Create patch. Keep Expo Web as the core runtime.

## Context

ORCH-1085 made mobile browser sign-in land on static Home. ORCH-1087 added the static route firewall. ORCH-1088 made Event Creator no-session recovery bounded. ORCH-1089 reopened Create to the real route. ORCH-1090 added invalid-session/chunk recovery. ORCH-1091 proved and fixed the stale immutable JS entry/cache route-map failure. Seth then confirmed signed-in Create opens instantly on both Chrome and Safari phone browsers, and the iOS Business dev build passes from merged-main Metro.

The proven recurring pattern is:

1. Phone browsers are less tolerant of large Expo/RN route payloads than desktop.
2. Native-only imports can crash route-wide before useful recovery UI renders.
3. Stale cached Expo entry JS can keep pointing at deleted route chunks after deploy.
4. Static Home must not link to a route until that route has phone-browser proof.

## Worktree

`~/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]/`

Branch:

`ORCH-1092-business-web-restoration-wave`

## Required Inputs

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/reports/CLOSE_ORCH-1091_BUSINESS_WEB_MOBILE_CACHE_INVALIDATION.md`
- ORCH-1087/1088/1089 implementation + QA reports
- `mingla-business/public/home.html`
- Hub route files under `mingla-business/app/(tabs)/hub` and related components/services
- Account/Payout route files under `mingla-business/app/(tabs)/account`, `app/connect-account-management`, and payment/payout components
- Marketing/Blast/composer route files under `mingla-business/app/(tabs)/marketing` and composer components
- `mingla-business/vercel.json`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- Existing ORCH-1085/1087/1088/1089/1091 CI guards

## Questions To Answer

1. Which static Home handoffs can be reopened in this wave without a stripped-down replacement?
2. Which routes already boot on phone Chrome/Safari after ORCH-1091?
3. Which routes fail due to route payload, native-only imports, auth/session/current-brand loading, stale chunks, or feature-specific unsupported web APIs?
4. Which native-only features need honest degraded web copy rather than full support in this wave?
5. What exact implementation chunks can restore the most value with the least code churn?
6. What automated regression guard catches the route-family pattern before deploy?
7. What manual Chrome/Safari proof is mandatory before Home links are reopened?

## Hard Guards

- No scratch web rebuild.
- No abandoning Expo Web.
- No deploy, merge, reap, OTA, migration, Supabase, or provider changes in forensics/spec.
- Do not weaken ORCH-1091 cache guards.
- Preserve provider-neutral seller/payout copy from COMMS-0021.
- Do not reopen a static Home link in the spec unless the implementation acceptance criteria require phone Chrome + Safari proof.
- Keep Create preservation-only unless investigation proves an active regression.

## Expected Outputs

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`

Downstream routing: orchestrator review -> implementor only after approval -> tester -> deploy from merged main only.
