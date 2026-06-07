# Investigation Report: ORCH-1094 Business Web Core Parity Wave

Date: 2026-06-07
Skill: forensic-mingla
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`
Branch: `ORCH-1094-business-web-core-parity-wave`

## Executive Summary

ORCH-1094 is ready for implementation as one bundled business-web parity wave across Event Creator, Hub, Marketing, and Account. The current codebase already contains most of the target screen code, but phone web access is still intentionally fail-closed for most signed-in business routes after the ORCH-1093 physical-device OOM incident. Event Create is the only signed-in route currently approved for direct phone boot; Hub Events, Marketing, Marketing Compose, Account, and Hub Trips still need controlled graduation with bundle proof, route-map alignment, and one combined tester pass after the full 1-4 implementation is complete.

No product code was changed during this investigation.

## Hard User Directive Applied

Event Creator, Hub, Marketing, and Account must be implemented together first. Independent tester validation happens once, only after the complete 1-4 implementation is done. The spec therefore rejects piecemeal tester handoffs for individual route families.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before investigation. No ORCH-1094-specific open BLOCK entry was present. Relevant open ALL WARN entries were acknowledged and factored:

- COMMS-0003: external API docs must be checked directly before provider/API assertions.
- COMMS-0004: feature work must scan for ID collisions and stale overlap.
- COMMS-0002: backend PR conclusions need strict-grep proof.
- COMMS-0011: ORCH-0990 ID double-booking warning.
- COMMS-0012: migration-production gap warning.
- COMMS-0013: web checkout tax divergence warning.
- COMMS-0015: deploy only from merged main.
- COMMS-0016: stale duplicate meta-orch re-homed warning.
- COMMS-0018: backend source deployed but not on main warning.
- COMMS-0019: ORCH-1072 triple-booked warning.
- COMMS-0021: provider-neutral seller copy warning.

Acknowledgement was committed directly on the anchor checkout:

- Commit: `27a6c230e`
- Message: `COMMS-1094: acknowledge business web parity warnings`

## Prompt and Prior Artifact Inputs

Primary prompt:

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`

Prior artifacts read and factored:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_BUSINESS_WEB_STATIC_HOME.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1088_BUSINESS_WEB_DIRECT_CREATE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1088_BUSINESS_WEB_DIRECT_CREATE.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1089_BUSINESS_WEB_SHELL_EXPANSION.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1089_BUSINESS_WEB_SHELL_EXPANSION.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1092_BUSINESS_WEB_HUB_MARKETING_ACCOUNT.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1092_BUSINESS_WEB_HUB_MARKETING_ACCOUNT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1092_BUSINESS_WEB_HUB_MARKETING_ACCOUNT.md`
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_HUB_MARKETING_ACCOUNT_RETEST2.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/reports/QA_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM_REWORK.md`
- `Mingla_Artifacts/README.md`
- `Mingla_Artifacts/IMPLEMENTATION_GATES.md`
- `Mingla_Artifacts/QUERY_KEY_REGISTRY.md`

Relevant memory read:

- `feedback_comms_ledger_direct_main_commits_fragile.md`
- `feedback_edge_deploy_and_migration_apply_hazards.md`
- `feedback_physical_device_first_testing.md`

## External Documentation Checked

External documentation was checked because this ORCH touches current Expo web routing behavior and Stripe embedded account-management/payout surfaces.

- Expo Router async routes: `https://docs.expo.dev/router/web/async-routes/`
- Expo Router API reference: `https://docs.expo.dev/versions/latest/sdk/router/`
- Stripe Connect embedded components overview: `https://docs.stripe.com/connect/get-started-connect-embedded-components`
- Stripe Account Sessions object: `https://docs.stripe.com/api/account_sessions/object`
- Stripe Account Sessions API: `https://docs.stripe.com/api/account_sessions`
- Stripe Account Management embedded component: `https://docs.stripe.com/connect/supported-embedded-components/account-management`
- MDN `<input type="date">`: `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/date`
- MDN `HTMLInputElement.showPicker()`: `https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker`

Documentation implications:

- Expo Router async routes and deferred route bundles are appropriate, but lazy chunks still share common runtime and can still create phone OOM risk if a route pulls large shared dependencies into `__common`.
- Stripe account-management and account-session flows require a generated authenticated session; a static direct link to account management is not a valid payout-management target.
- Native date picker behavior on web should prefer platform HTML date inputs or guarded picker calls; unguarded native picker imports remain a web risk.

## Current Source Inventory

Business web files inspected:

- `mingla-business/public/home.html`
- `mingla-business/app/_layout.tsx`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/vercel.json`
- `mingla-business/app.json`
- `mingla-business/package.json`
- `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`
- `mingla-business/app/event/create.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/app/(tabs)/hub/experiences.tsx`
- `mingla-business/app/(tabs)/marketing/index.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/src/components/marketing/ComposerV2/SchedulePickerSheet.tsx`
- `mingla-business/app/(tabs)/account.tsx`
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- `mingla-business/src/utils/brandPayout.ts`

## Current Route State

### Static Home

`public/home.html` currently exposes direct user-facing business web links for:

- Create: `/event/create`
- Hub Events: `/hub/events`
- Marketing: `/marketing`
- Marketing Compose: `/marketing/campaigns/compose`
- Account: `/account`

It also contains shelled or blocked routes from earlier waves:

- Hub Trips: `/hub/trips`
- Hub Experiences: `/hub/experiences`
- Ari: `/ari`
- Payout account management: `/connect-account-management`

The static home includes ORCH-1088/1089 markers and route metadata. This confirms the first-viewport static entrypoint is intentionally business-web specific, not an accidental default Expo surface.

### Root Layout and Mobile Guard

`app/_layout.tsx` contains the signed-in mobile route status map. Current statuses:

- `/event/create`: `approved`
- `/hub/events`: `pending-proof`
- `/hub/trips`: `pending-proof`
- `/marketing`: `pending-proof`
- `/marketing/campaigns/compose`: `pending-proof`
- `/account`: `pending-proof`
- `/hub/experiences`: `blocked`
- `/ari`: `blocked`
- `/connect-account-management`: `blocked`

The mobile guard blocks any status that is not `approved` before signed-in phone boot continues. This is the intended ORCH-1093 safety behavior and explains why most static home links still do not reach the real app screens on phone.

### Mobile Blur Injector

`scripts/inject-mobile-blur-css.mjs` mirrors the route status map and injects a phone pre-boot recovery screen before Expo scripts load for non-approved routes. This guard prevents phone OOM before React can initialize, but it also means static home links and root layout statuses must be changed together. Any mismatch between `home.html`, `_layout.tsx`, and the injector creates either false advertising on static home or unsafe route approval.

## Current Route Family Findings

### Event Creator

Files:

- `app/event/create.tsx`
- `app/event/[id]/edit.tsx`

Current finding:

- Event Create is already approved for signed-in phone boot and is the only currently graduated signed-in route.
- It must be preserved in ORCH-1094, not reworked broadly.
- Regression coverage must ensure ORCH-1094 does not demote `/event/create` or remove the ORCH-1088 direct-create recovery behavior.

Implementation implication:

- Treat Event Creator as the baseline route family in the combined parity wave.
- Keep route approval and static link behavior stable while adding combined ORCH-1094 proof.

### Hub

Files:

- `app/(tabs)/hub/events.tsx`
- `app/(tabs)/hub/trips.tsx`
- `app/(tabs)/hub/experiences.tsx`

Current finding:

- Hub Events has a lean direct route and is likely the safest Hub candidate.
- Hub Trips was the route involved in the ORCH-1093 signed-in physical Android Chrome OOM failure. It remains pending-proof and must be explicitly covered by ORCH-1094 if Hub core parity includes Trips.
- Hub Experiences remains blocked because it still imports high-risk native/file-heavy surfaces such as snap inputs, offering management sheets, and share/file flows.

Implementation implication:

- ORCH-1094 Hub core should include Hub Events and Hub Trips only unless the scope is formally amended.
- Hub Experiences should remain shelled/blocked for a later native/file-ingestion wave.
- Hub Trips must get special bundle and physical-device attention because it is the proven prior crash route.

### Marketing

Files:

- `app/(tabs)/marketing/index.tsx`
- `app/(tabs)/marketing/campaigns/compose.tsx`
- `src/components/marketing/ComposerV2/SchedulePickerSheet.tsx`

Current finding:

- Marketing overview has a small route chunk in the current deferred export.
- Marketing Compose has a much larger route chunk and uses scheduling UI that can intersect browser date-picker behavior.
- The composer route is still pending-proof and cannot be approved without export-size, guard, and physical smoke evidence.

Implementation implication:

- Marketing overview and composer must graduate together for core parity.
- Composer date/schedule UI must use web-safe behavior and avoid native-only picker assumptions.
- Any change to scheduling copy or provider behavior must remain provider-neutral and avoid unsupported claims.

### Account and Payout Readiness

Files:

- `app/(tabs)/account.tsx`
- `src/components/brand/BrandPaymentsView.tsx`
- `src/utils/brandPayout.ts`

Current finding:

- `/account` is pending-proof and currently blocked for phone signed-in boot.
- `BrandPaymentsView` already owns generated account-session behavior through `useBrandStripeAccountSession()` and `WebBrowser.openAuthSessionAsync`.
- `/connect-account-management` is blocked, and a static direct link is not a valid payout-management flow because Stripe account-management requires an authenticated generated session.

Implementation implication:

- ORCH-1094 should approve `/account` only after the authenticated account surface can load safely on phone web.
- Do not approve or advertise `/connect-account-management` as a static direct route.
- Keep seller-facing copy provider-neutral per COMMS-0021.

## Cross-Check: Five Layers

### Layer 1: Static Home

The static home presents a broader route set than the current phone runtime allows. This is acceptable only while those routes are explicitly protected; it becomes a launch issue once users expect direct access. ORCH-1094 must bring static links, route statuses, and proof into agreement.

### Layer 2: Root Layout

The root layout is currently the last React-level safety net. It correctly keeps pending routes blocked after ORCH-1093, but it must not be the only changed file during implementation. Any route status graduation must be paired with injector graduation and strict-grep regression coverage.

### Layer 3: Pre-Boot Injector

The injector is the real phone-OOM safety gate because it executes before Expo JS. It must remain fail-closed for non-approved routes and must expose no route as approved unless the combined implementation proves the route family can boot on physical mobile browsers.

### Layer 4: Route Chunks and Shared Runtime

Fresh export after current source produced:

- `phoneBoot=2884933`
- `__common=1881778`
- `deferred=true`
- approved route: `/event/create`
- `/hub/trips`: `12661`
- `/hub/events`: `18954`
- `/marketing`: `11952`
- `/marketing/campaigns/compose`: `570122`
- `/account`: `9055`
- `/event/create`: `4522`

These numbers prove deferred routing is active but also show a large phone boot and shared common payload. The route chunks alone are not enough proof; physical-device browser behavior remains mandatory.

### Layer 5: Tests and Gates

Current ORCH-1093 tests pass because they assert the fail-closed state after the OOM incident. ORCH-1094 needs new regression tests that would fail against the current protected state and pass only after the bundled route graduation.

## Verification Performed

Commands run from `mingla-business`:

```bash
npm run test:orch-1093
```

Result:

- PASS.
- The command chained ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, and ORCH-1093 checks.
- Bundle budgets were skipped because no `dist/index.html` existed at that moment.

Fresh export and guard verification:

```bash
rm -rf dist
npx expo export -p web --output-dir dist
node scripts/inject-mobile-blur-css.mjs
node scripts/ci/orch-1093-signedin-route-oom.mjs
```

Result:

- PASS.
- Deferred routes were present.
- `/event/create` remained the only approved signed-in route.
- Pending and blocked route protections remained active.

Important measured output:

```text
phoneBoot=2884933
__common=1881778
deferred=true
approved=/event/create
/hub/trips=12661
/hub/events=18954
/marketing=11952
/marketing/campaigns/compose=570122
/account=9055
/event/create=4522
```

## Root Cause and Current Blocker

The primary blocker is not missing screen code. The blocker is that ORCH-1093 intentionally left most signed-in phone business routes in `pending-proof` or `blocked` after a physical Android Chrome OOM. Static home now exposes useful direct links, but the runtime correctly prevents users from entering those signed-in app routes on phone until implementation produces combined bundle and device proof.

Root cause class:

- Route status and proof state have not yet been graduated from emergency OOM recovery to restored business-web parity.

Not root cause:

- Not a Supabase schema/RLS issue.
- Not a Stripe backend-session generation issue for the authenticated Account path, based on current source.
- Not a static-home-only issue.

## Findings

### F-1: Static direct links are ahead of phone route approval

Static home exposes Hub, Marketing, Compose, and Account links, but root and injector guards still block them on phone. This is intentional protection, but it is also the visible parity gap ORCH-1094 must close.

### F-2: Shared phone boot remains large

The current deferred export still reports a phone boot around 2.88 MB and `__common` around 1.88 MB. Route-level chunks look small for several surfaces, but common payload size means route approval cannot rely on route chunk size alone.

### F-3: Hub Trips is the high-risk Hub route

Hub Trips was implicated in the ORCH-1093 signed-in route OOM. Hub Events may be safe, but Hub parity is incomplete unless Trips is addressed or explicitly excluded. The user directive says Event Creator, Hub, Marketing, and Account are first-wave together; therefore Trips needs to be handled inside Hub core unless Seth amends scope.

### F-4: Hub Experiences should remain out of core parity

Hub Experiences still imports native/file-heavy flows and should remain blocked for this wave. Approving it would expand ORCH-1094 into a native file-ingestion and offering-management remediation effort.

### F-5: Payout account management cannot be a static direct route

Stripe account-management requires generated authenticated account sessions. The safe path is through the authenticated Account/Brand Payments surface, not a static `/connect-account-management` link.

### F-6: Existing tests prove safety, not restored parity

The current passing test suite verifies that dangerous routes remain blocked. ORCH-1094 requires a new test that encodes the restored route contract, while keeping non-core blocked surfaces blocked.

## Security and Privacy Notes

- No DB schema, RLS, edge function, or provider payload change is required by the evidence found.
- No seller payout copy should imply a provider-specific guarantee beyond what the existing authenticated account-session flow supports.
- Do not expose sessionless payout-management links in static HTML.
- Do not weaken fail-closed behavior for blocked routes.

## Production Readiness Assessment

Current state:

- Ready for scoped implementation.
- Not ready for tester handoff.
- Not ready for deploy.

Required before tester:

- One bundled implementation covering Event Creator preservation, Hub core, Marketing core, and Account core.
- New ORCH-1094 regression test.
- Fresh web export proof with injector applied.
- Physical Android Chrome signed-in smoke proof.
- iPhone Safari or Safari-equivalent signed-in smoke proof.

## Recommended Scope for Implementation

Implement together:

1. Event Creator preservation and combined regression coverage.
2. Hub Events and Hub Trips signed-in phone restoration.
3. Marketing overview and Marketing Compose signed-in phone restoration.
4. Account signed-in phone restoration with authenticated payout-management entry behavior.
5. Static home, root route map, and injector route map alignment.
6. New `test:orch-1094` gate chaining prior business-web safety tests and the new restored-parity contract.

Keep blocked:

- `/hub/experiences`
- `/ari`
- `/connect-account-management`

## Implementation Risks

Top risks:

1. Route-map drift between `home.html`, `_layout.tsx`, and `inject-mobile-blur-css.mjs`.
2. Reopening the ORCH-1093 phone OOM by approving routes before bundle/device proof.
3. Treating Hub Events as all of Hub while leaving Hub Trips in a protected or crash-prone state.
4. Accidentally approving Hub Experiences and pulling native/file-heavy code into phone web.
5. Linking static payout management instead of using authenticated generated account-session flow.
6. Writing tests that pass because routes are still blocked rather than because restored parity works.
7. Performing independent tester validation before the full 1-4 route-family implementation is complete.

## Final Forensic Recommendation

Proceed to implementor with the paired spec. The work should be implemented as one combined business-web core parity wave, not four separate mini-waves, and tester should receive exactly one combined pass after the full route family set is implemented and internally verified.
