# Spec: ORCH-1094 Business Web Core Parity Wave

Date: 2026-06-07
Skill: forensic-mingla
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`
Branch: `ORCH-1094-business-web-core-parity-wave`

## Decision

Implement Event Creator, Hub, Marketing, and Account business-web core parity together as one bundled wave. Do not send any one route family to independent tester until the full 1-4 implementation is complete and internally verified.

## Goal

Restore the core signed-in business web experience on phone and desktop without reopening the ORCH-1093 signed-in route OOM. Users landing on business web should be able to move from static home into the real app for:

- Event creation.
- Hub core views.
- Marketing overview and campaign compose.
- Account and payout-readiness entry.

The implementation must preserve fail-closed protection for non-core high-risk routes.

## Non-Goals

Do not implement:

- Product code in the forensic phase.
- Supabase schema, RLS, migration, RPC, or edge-function changes.
- Provider payload changes.
- Static direct payout account-management sessions.
- Hub Experiences restoration.
- Ari restoration.
- Full native/file ingestion remediation.
- A piecemeal tester pass for only Event Creator, only Hub, only Marketing, or only Account.
- Deploy, merge, OTA, reap, or production promotion from this worktree.

## Required User Directive

Event Creator, Hub, Marketing, and Account are implemented together first. One combined independent tester pass happens only after the full 1-4 implementation is complete.

## Evidence Trace

Investigation file:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`

Current source facts:

- `/event/create` is currently approved.
- `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` are currently `pending-proof`.
- `/hub/experiences`, `/ari`, and `/connect-account-management` are blocked.
- Static home exposes direct links for Create, Hub Events, Marketing, Compose, and Account.
- The pre-boot injector blocks non-approved phone routes before Expo JS loads.
- Current fresh export measured `phoneBoot=2884933` and `__common=1881778`.

External docs factored:

- Expo Router async route behavior supports deferred route bundles but does not remove common-runtime OOM risk.
- Stripe account-management requires generated authenticated account sessions.
- Web date/schedule UI should avoid unguarded native-only picker behavior.

## Success Criteria

The implementation is successful when all are true:

1. Event Creator remains reachable from static home and signed-in phone web.
2. Hub core routes are restored for signed-in phone web without OOM.
3. Marketing overview and campaign compose are restored for signed-in phone web without OOM.
4. Account is restored for signed-in phone web and payout readiness enters through authenticated account/session behavior only.
5. Static home route links, root route statuses, and injector route statuses agree.
6. Non-core routes remain blocked: `/hub/experiences`, `/ari`, and `/connect-account-management`.
7. A new repo-running regression test fails against the current protected state and passes after implementation.
8. The implementation report includes fresh export evidence and physical-device smoke evidence.
9. Independent tester receives one combined tester handoff only after the full implementation is complete.

## Invariants

Maintain:

- `I-COMMS-LEDGER-ENTRY-STANZA`
- `I-COMMS-LEDGER-WRITE-ON-DISCOVERY`
- `QUERY_KEY_REGISTRY` discipline.
- ORCH-1088 direct Event Create behavior.
- ORCH-1089 static shell safety.
- ORCH-1092 route inventory context.
- ORCH-1093 fail-closed phone OOM protection for routes that are not proven.
- Deploy-only-from-merged-main discipline from COMMS-0015.
- Provider-neutral seller copy from COMMS-0021.

## Database, RLS, Edge, and Provider Scope

No DB/RLS/edge/provider changes are authorized by this spec.

If implementation discovers a required schema, RLS, edge function, Stripe payload, or Supabase behavior change:

1. Stop product-code implementation for that sub-scope.
2. Document the finding with source-file proof.
3. Check current official provider docs if an external API is involved.
4. Request spec amendment before changing backend/provider behavior.

## Required Surface Scope

### 1. Event Creator

Files to inspect/update as needed:

- `mingla-business/app/event/create.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/public/home.html`
- `mingla-business/app/_layout.tsx`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`

Requirements:

- Preserve `/event/create` as an approved route.
- Preserve static home Create direct link.
- Preserve ORCH-1088 recovery semantics.
- Add ORCH-1094 regression coverage proving Create was not demoted.
- Do not broaden Event Creator refactors unless needed for route-map/test alignment.

Acceptance:

- Static home Create link reaches the real signed-in route.
- `/event/create` remains approved in root and injector maps.
- Existing ORCH-1088/1089/1093 tests still pass.

### 2. Hub Core

Files to inspect/update as needed:

- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/app/(tabs)/hub/experiences.tsx`
- `mingla-business/public/home.html`
- `mingla-business/app/_layout.tsx`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`

Requirements:

- Restore Hub Events for signed-in phone web.
- Restore Hub Trips for signed-in phone web or formally document why Hub Trips cannot be included before implementation proceeds.
- Keep Hub Experiences blocked for this wave.
- Avoid importing native/file-heavy Experiences code into the approved Hub core path.
- Add static and runtime guard tests that prove Hub core statuses are approved and non-core Hub Experiences remains blocked.

Acceptance:

- `/hub/events` is approved in root and injector maps.
- `/hub/trips` is approved in root and injector maps if included as Hub core.
- `/hub/experiences` remains blocked.
- Physical Android Chrome signed-in smoke reaches Hub core without OOM.

### 3. Marketing Core

Files to inspect/update as needed:

- `mingla-business/app/(tabs)/marketing/index.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/src/components/marketing/ComposerV2/SchedulePickerSheet.tsx`
- `mingla-business/public/home.html`
- `mingla-business/app/_layout.tsx`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`

Requirements:

- Restore Marketing overview for signed-in phone web.
- Restore Marketing Compose for signed-in phone web.
- Ensure schedule/date controls use web-safe behavior and avoid unguarded native picker assumptions.
- Keep route chunks deferred.
- Avoid adding provider-specific seller claims.

Acceptance:

- `/marketing` and `/marketing/campaigns/compose` are approved in root and injector maps.
- Static home Marketing links reflect restored routes.
- Compose route can open on phone web without OOM.
- A basic schedule/date interaction smoke is documented in implementation evidence.

### 4. Account and Payout Readiness

Files to inspect/update as needed:

- `mingla-business/app/(tabs)/account.tsx`
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- `mingla-business/src/utils/brandPayout.ts`
- `mingla-business/public/home.html`
- `mingla-business/app/_layout.tsx`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`

Requirements:

- Restore `/account` for signed-in phone web.
- Keep payout-management entry authenticated and session-generated.
- Do not approve `/connect-account-management`.
- Do not create static payout-management links.
- Keep seller copy provider-neutral and avoid unsupported payout claims.

Acceptance:

- `/account` is approved in root and injector maps.
- `/connect-account-management` remains blocked.
- Static home Account link enters Account, not a sessionless provider URL.
- Brand Payments entry behavior remains inside authenticated Account/Brand Payments flow.

## Static Home Contract

Update `public/home.html` so the user-facing business web entrypoint reflects ORCH-1094 state.

Required:

- Add/update ORCH-1094 markers around restored route metadata.
- Keep Create direct link.
- Keep restored Hub, Marketing, Compose, and Account links.
- Keep blocked/shelled copy for `/hub/experiences`, `/ari`, and `/connect-account-management`.
- Avoid copy that promises payout activation, provider-specific guarantees, or unsupported operational state.

## Route Guard Contract

Update both:

- `app/_layout.tsx`
- `scripts/inject-mobile-blur-css.mjs`

Required final statuses:

- `/event/create`: `approved`
- `/hub/events`: `approved`
- `/hub/trips`: `approved` if included in Hub core
- `/marketing`: `approved`
- `/marketing/campaigns/compose`: `approved`
- `/account`: `approved`
- `/hub/experiences`: `blocked`
- `/ari`: `blocked`
- `/connect-account-management`: `blocked`

If `/hub/trips` cannot be safely approved, stop and request a scope amendment because Hub core parity would otherwise be ambiguous against the user directive.

## Bundle and Export Contract

Implementation must run a fresh export and injector pass:

```bash
cd mingla-business
rm -rf dist
npx expo export -p web --output-dir dist
node scripts/inject-mobile-blur-css.mjs
```

Then run ORCH-1094 and prior web safety tests.

The implementation report must record:

- Whether deferred route bundles are present.
- Phone boot size.
- `__common` size.
- Route chunk sizes for approved route family.
- Which routes are approved and which remain blocked.
- Whether any budget was exceeded.
- Exact command results.

## Required Regression Test

Add a new test script, expected name:

- `mingla-business/scripts/ci/orch-1094-business-web-core-parity-wave.mjs`

Add package script:

- `test:orch-1094`

The new test must fail before implementation and pass after implementation.

Minimum assertions:

- Static home includes ORCH-1094 route markers.
- Static home links include `/event/create`, `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` where those are approved.
- Static home does not advertise `/connect-account-management` as a restored direct route.
- Root layout status map approves only proven core routes.
- Injector status map matches root layout status map for the same routes.
- `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked.
- Export exists and shows deferred route chunks.
- Prior ORCH-1088/1089/1092/1093 safety gates still pass.

Recommended chaining:

```bash
npm run test:orch-1093
npm run test:orch-1094
```

or make `test:orch-1094` invoke prior gates itself if that matches local script patterns.

## Physical Smoke Requirement

Internal verification before tester handoff must include:

1. Physical Android Chrome signed-in business web smoke.
2. iPhone Safari or Safari-equivalent signed-in business web smoke.

Smoke routes:

- Static home.
- Create.
- Hub Events.
- Hub Trips.
- Marketing.
- Marketing Compose.
- Account.
- Confirm blocked recovery remains for Hub Experiences, Ari, and sessionless Connect Account Management.

The implementation report must include the concrete local or deployed test URL used. If a running surface exists or can be started safely, provide that link next to the smoke steps.

## Combined Tester Acceptance Matrix

Tester gets one combined pass only after the full 1-4 implementation is complete.

Tester should verify:

- Static home direct links.
- Event Create loads.
- Hub Events and Hub Trips load.
- Marketing overview loads.
- Campaign Compose loads and basic schedule/date interaction is sane.
- Account loads.
- Payout readiness path does not expose a sessionless static provider link.
- Hub Experiences remains blocked/shelled.
- Ari remains blocked/shelled.
- `/connect-account-management` remains blocked/shelled.
- No phone OOM or blank-screen regression on Android Chrome.
- No phone OOM or blank-screen regression on iPhone Safari/Safari-equivalent.

## Implementation Order

1. Re-read this spec and investigation.
2. Inspect route-map/state in `home.html`, `_layout.tsx`, and injector before edits.
3. Make the smallest route family changes required for Event Creator preservation, Hub core, Marketing core, and Account core.
4. Keep non-core routes blocked.
5. Add ORCH-1094 test script and package script.
6. Run fresh export and injector.
7. Run prior and new tests.
8. Perform physical-device smoke proof.
9. Write implementation report.
10. Hand off once to tester only after all four route families are implemented.

## Rollback and Deploy Safety

- Do not deploy from this ORCH worktree.
- Do not merge from this ORCH worktree without orchestration approval.
- Any eventual deploy commit must use `[deploy]` in the title.
- Deploy web only from merged `origin/main`, never from a dirty or behind anchor checkout.
- If implementation discovers backend/provider production divergence, stop and route back to orchestrator.

## Common Mistakes to Avoid

- Approving a route in `_layout.tsx` but forgetting the injector.
- Updating static home links without changing runtime approval.
- Treating route chunk size as full OOM proof.
- Sending Hub Events to tester while Hub Trips remains unresolved.
- Approving Hub Experiences accidentally through broad Hub matching.
- Exposing `/connect-account-management` as a static payout route.
- Running independent tester pass before Event Creator, Hub, Marketing, and Account are all done.
- Writing ORCH-1094 tests that pass while routes remain pending-proof.

## Required Implementation Output

Write:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`

Minimum implementation report contents:

- Files changed.
- End-user behavior changed.
- Route status table before/after.
- Static home link table before/after.
- Export and bundle evidence.
- Test commands and results.
- Physical smoke URLs and outcomes.
- Remaining blocked routes.
- Explicit confirmation that no independent tester pass occurred before the full 1-4 implementation.

## Handoff

Proceed to implementor only. The implementor must work in `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]` on branch `ORCH-1094-business-web-core-parity-wave`, implement the full bundled route-family restoration, write the implementation report named above, and then route to one combined independent tester pass.
