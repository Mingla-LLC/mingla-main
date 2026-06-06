# IMPLEMENTOR ORCH-1089 - Business Web Signed-In Event Creator Wizard Parity

You are Codex `implementor-mingla` working in:

`/Users/sethogieva/Desktop/mingla-orchs/ORCH-1089-[business-web-event-creator-signedin-wizard]`

Branch:

`ORCH-1089-business-web-event-creator-signedin-wizard`

## Goal

Implement the approved ORCH-1089 spec so a signed-in organiser on a phone browser can use the real Event Creator wizard, not a stripped-down replacement. The safe static Home shell may reopen Create only after signed-in `/event/create -> /event/{draftId}/edit?step=0` and Step 1-7 mobile-browser proof passes.

## Required Inputs

Read first:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/QA_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `COMMS_LEDGER.md`

Factor COMMS-0015/0018: no deploy/OTA from this worktree. Factor COMMS-0021: seller/payout copy remains provider-neutral.

## Required Output

Write:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`

Commit and push the scoped implementation when verification is complete. Do not open/merge/deploy/OTA/close; route back to orchestrator for tester dispatch.

## Implementation Order

1. Add `mingla-business` script `test:orch-1089` and its guard/test files first.
2. Fix `mingla-business/app/event/[id]/edit.tsx` so web missing-draft paths never route to `/(tabs)/home`; use static-safe recovery / `safeEventsExitRoute()`.
3. Harden `mingla-business/src/hooks/useCurrentBrandRecovery.ts` so brands-query and creator-account query errors surface as retryable recovery errors, not false no-brand state.
4. Add/adjust route/unit tests for current-brand errors, missing-draft recovery, ORCH-1088 terminal states, Reanimated shim exports, and provider-neutral copy.
5. Prove signed-in route behavior with the strongest available fixture. If a real signed-in fixture is unavailable, build a deterministic Playwright/local-storage fixture that proves auth/current-brand/draft code paths as far as possible, and record the exact remaining manual tester gate.
6. Traverse Step 1-7 on Chromium mobile and WebKit mobile if possible. Keep the real wizard. Do not delete steps or replace the flow with a fake final screen.
7. Only after the signed-in proof passes, update `mingla-business/public/home.html` so Create can reach `/event/create`, with a clear ORCH-1089 marker such as `data-orch-1089-create-reopened`. Preserve other static Home shell links unless separately proven safe.

## Hard Guards

- No stripped-down final wizard.
- No `web.output`, `asyncRoutes`, or Vercel rewrite changes unless you stop and route back to orchestrator/ORCH-1085.
- No new Supabase migration unless you stop and route back for forensic/spec amendment.
- No user-facing `Stripe account` copy in seller/payout surfaces.
- No native-only module import added to the Step 1-7 web route chunk unless platform-split or shim-safe.
- No deploys, no PR merge, no worktree reap.

## Required Verification

Run at minimum:

```bash
cd mingla-business && npm run test:orch-1089
cd mingla-business && npm run test:orch-1088
cd mingla-business && npx expo export -p web --output-dir dist
cd mingla-business && node scripts/inject-mobile-blur-css.mjs
```

Also run targeted Playwright/mobile-browser proof for:

- `/home.html` Create link behavior after reopening.
- `/event/create` unsigned recovery still works.
- `/event/create` signed-in fixture reaches Step 1 or clearly documents the blocker.
- `/event/{missing}/edit?step=0` web recovery goes to static Home, not full tabs Home.
- Step 1-7 traversal on Chromium mobile and WebKit mobile when possible.

Re-check physical Android:

```bash
adb devices -l
```

If a device appears, use Android Chrome proof and record it. If no device appears, record the exact no-device output and leave physical Android as a tester/manual gate.

## Report Requirements

The implementation report must include:

- What changed for users.
- Spec traceability by section.
- Old-to-new receipts for Home Create, missing-draft exit, and current-brand recovery.
- Tests added and why they would catch the original failure.
- Exact commands run and pass/fail output summary.
- Browser/device proof and any honest unverified manual gates.
- Deploy notes for orchestrator: web PR requires `[deploy]`; deploy only from merged `main`; no native OTA unless shared native JS change requires it.
