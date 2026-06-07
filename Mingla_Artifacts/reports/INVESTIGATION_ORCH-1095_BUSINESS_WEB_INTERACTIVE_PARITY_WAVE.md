# Investigation - ORCH-1095 Business Web Interactive Parity Wave

Date: 2026-06-07

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]`

Branch: `ORCH-1095-business-web-interactive-parity-wave`

Base: `7a1e1d74fe2c00383af715e94273c798497524f4`

## Executive Result

ORCH-1095 is a valid follow-up because ORCH-1094 deliberately restored safety, not true interaction, for Hub Events, Hub Trips, Marketing overview, Campaign Compose, and Account. Current signed-in phone-browser entry to those five paths is intercepted before Expo app JavaScript loads and redirected into static Home anchors such as `/home#hub`, `/home#marketing`, `/home#compose-blast`, and `/home#account`. That is crash-safe, but it is not interactive route parity.

The route code for the five target screens still exists and is mostly functional on desktop/native-style app surfaces. The current blockers are route ownership, phone-browser boot cost, parent layout weight, auth/current-brand waits, and incomplete route-specific mobile-browser proof. Implementation should be a bounded route graduation wave: remove the signed-in static-section redirect only for these five routes after adding a new ORCH-1095 guard and proving each route reaches a useful interactive state on Android Chrome and iPhone Safari.

## Comms Ledger And Hard Guards

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. Open ALL warnings factored:

- COMMS-0003: external API specs must cite provider docs when changing provider contracts. ORCH-1095 should not change provider payloads; if payout/Stripe work is accidentally pulled in, it must stop and rescope.
- COMMS-0015 and COMMS-0018: deploy only from merged `main`; no worktree deploy, no OTA, no merge, no reap in forensics/spec.
- COMMS-0016: experience checkout constraints remain outside this ORCH.
- COMMS-0021: preserve provider-neutral seller/payout copy.
- ORCH-1094-related ledger context: do not approve Hub Experiences, Ari, or sessionless `/connect-account-management`.

This investigation made no product-code, backend, provider, Supabase, deploy, merge, or OTA changes.

## Phase 0 Evidence Ingest

Required historical inputs read:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md`
- ORCH-1087 investigation/spec/implementation/QA/close artifacts
- ORCH-1088 investigation/spec/implementation/QA/close artifacts
- ORCH-1089 investigation/spec/implementation/QA artifacts
- ORCH-1092 investigation/spec/implementation/QA/close artifacts
- ORCH-1093 investigation/spec/implementation/QA/review/runtime/close artifacts
- ORCH-1094 investigation/spec/design/implementation/QA/close artifacts
- `Mingla_Artifacts/AGENT_HANDOFFS.md`, `ARTIFACT_MANIFEST.md`, `WORLD_MAP.md`, `INVARIANT_REGISTRY.md`, and `PRODUCT_SNAPSHOT.md` references for this route family

Required current source inputs read:

- `mingla-business/public/home.html`
- `mingla-business/app/_layout.tsx`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/scripts/ci/orch-1087-static-route-firewall.mjs`
- `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`
- `mingla-business/scripts/ci/orch-1094-business-web-core-parity-wave.mjs`
- `mingla-business/src/context/AuthContext.tsx`
- `mingla-business/src/utils/mobileWebStaticHomeRedirect.ts`
- `mingla-business/app/index.tsx`
- `mingla-business/app/auth/index.tsx`
- `mingla-business/app/auth/callback.tsx`
- `mingla-business/app/(tabs)/_layout.tsx`
- `mingla-business/app/(tabs)/hub/_layout.tsx`
- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/app/(tabs)/marketing/_layout.tsx`
- `mingla-business/app/(tabs)/marketing/index.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/app/(tabs)/account.tsx`

## Intended User Outcome

A signed-in business user on a phone browser should be able to enter these routes and use their real controls:

1. Hub Events: view event filters/lists, open card actions, and navigate to event detail/edit/share paths safely.
2. Hub Trips: view trip filters/lists, open at least one trip card/manage path safely.
3. Marketing overview: view real metrics/empty state and tap New campaign.
4. Campaign Compose: pick/fill the core campaign fields, use the browser-safe schedule picker, save/review/send gate without route crash.
5. Account: view brands/settings, use brand switcher/profile rows/sign-out flows, and preserve provider-neutral payout paths without static sessionless payout-management.

Static-section redirects do not deliver this outcome. They are acceptable only as a fail-closed safety fallback.

## Current Execution Path

### Static Home

`public/home.html` links to the five target paths:

- `/hub/events` at lines 482-488.
- `/hub/trips` at lines 496-502.
- `/marketing` at lines 528-534.
- `/marketing/campaigns/compose` at lines 535-541.
- `/account` at lines 549-555.

The same static file still contains blocked/shelled copy for Ari, Hub Experiences, and payout account. Lines 681-686 explicitly say payout account management needs a generated secure session link. This preserves the COMMS/provider-neutral constraint.

### Root Route Status

`app/_layout.tsx` currently marks all five ORCH-1095 target routes as `approved` in `ORCH_1093_SIGNED_IN_ROUTE_STATUS` at lines 124-130, while `/hub/experiences`, `/ari`, and `/connect-account-management` remain `blocked` at lines 131-133. React-level recovery only blocks routes whose status is not approved, so these five are allowed once app JavaScript runs.

### Preboot Redirect

`scripts/inject-mobile-blur-css.mjs` is the effective phone-browser gate before app JavaScript. Its generated loader at line 111 defines:

- `blockedStatus`: the five target routes and `/event/create` are `approved`.
- `staticTarget`: the five target routes map to static Home anchors.
- redirect condition: `if(isPhone()&&status==="approved"&&target&&hasSession()){location.replace("/home#"+target);return}`.

This means signed-in phone browsers never reach the real route for these five paths. They are sent to static Home before Expo scripts load. This is the direct cause of missing interactive parity.

### Post-Auth Static Home Redirect

`src/utils/mobileWebStaticHomeRedirect.ts` redirects any signed-in mobile business web user to `/home`. `app/index.tsx`, `app/auth/index.tsx`, and `app/auth/callback.tsx` call it after auth. This is correct for post-login safety after ORCH-1094, but ORCH-1095 must avoid turning it into a global permanent blocker for direct interactive route entry.

### Auth And Brand Readiness

`AuthContext.tsx` has a 3000ms bootstrap timeout and can recover a stored web session after timeout. `app/_layout.tsx` waits for auth, current brand, brand recovery, or a 2000ms brand-fetch timeout before hiding splash. That prevents indefinite splash in many cases, but route-specific first-screen contracts still need to distinguish:

- signed out,
- stored valid session,
- stale/expired stored session,
- no current brand,
- brand query loading,
- brand query error,
- no data for the current brand.

## Route-By-Route Findings

### F-1 - Confirmed bug: static redirect prevents all five target routes from being interactive

Classification: confirmed bug / UX gap.

Evidence: `scripts/inject-mobile-blur-css.mjs` line 111 redirects signed-in phone requests for `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` to `/home#...`. ORCH-1094 close confirms this was intentional: Hub/Marketing/Account/Compose render stable static Home sections, not full interactive parity.

Expected behavior for ORCH-1095: those five routes should load app JavaScript and render the route-owned screen on signed-in phone browsers. Static Home should remain a fallback only when route proof fails or when the user opens intentionally blocked surfaces.

User impact: users can see safe static summaries but cannot manage events/trips, campaign metrics, campaign composition, or account settings from phone browsers.

Fix direction: replace the binary `approved -> staticTarget redirect` preboot contract with an explicit interactive route allowlist for ORCH-1095 routes, leaving static redirects/recovery for `/`, post-auth landing, stale chunk recovery, and blocked surfaces.

### F-2 - Confirmed blocker: parent layouts can still dominate route-entry cost

Classification: production-hardening gap.

Evidence:

- ORCH-1093 proved `/hub/trips` leaf chunk was small while signed-in route entry OOMed because shared root/tab shell boot was too large.
- Current `(tabs)/_layout.tsx` mounts `DesktopCanvas`, `BottomNav`, global search host, command host, and rank-based tab gating.
- `hub/_layout.tsx` mounts TopBar, BusinessTodoToggle, HubSubNav, visible-tab/current-brand hooks, venue claim refresh, and lazy brand/delete/universal creator hosts.
- `marketing/_layout.tsx` mounts TopBar, MarketingSubNav, and lazy brand/universal creator hosts.
- `account.tsx` mounts TopBar, brand list, partner status, partner links, and lazy brand/delete/universal creator hosts.

Expected behavior: phone route entry should render the needed route chrome and first interactive screen without loading action bodies or desktop-only/global bodies in eager/route-entry chunks.

Fix direction: keep ORCH-1093 lazy-host posture, but add ORCH-1095 route-entry budgets and route-body interaction checks. Do not rely on leaf route chunk size alone.

### F-3 - Confirmed blocker: Hub Events is real but must prove list actions and modal laziness

Classification: production-hardening gap.

Evidence: `hub/events.tsx` uses real event hooks, filters, server/local drafts, lifecycle mutations, lazy `EventManageMenu`, lazy `EndSalesSheet`, and lazy `ShareModal`. It can render real event list functionality, but it depends on `currentBrand`, `businessEventsQuery`, `offeringCounts`, and role permissions. ORCH-1094 did not prove the route can be used interactively on phone browsers; it proved only static-section safety.

Expected behavior: route renders filters/list/empty state within 8 seconds on a signed-in phone browser, supports filter tap, card open, manage menu open/close, and safe share/edit navigation without OOM or static fallback.

Fix direction: preserve lazy action bodies, add mobile-browser first-screen and one-action proof, and add route guard checks that fail if Event manage/share bodies enter eager phone boot.

### F-4 - Confirmed blocker: Hub Trips has direct OOM history and needs stricter proof than Hub Events

Classification: confirmed historical bug / production-hardening gap.

Evidence: ORCH-1093 runtime proof tied signed-in `/hub/trips` on physical Android Chrome to `Aw, Snap!` and `V8 javascript OOM` in `CrRendererMain`. Current `hub/trips.tsx` uses real trips data and lazy `OfferingManageSheet` and `ShareModal`, and ORCH-1094 now redirects signed-in phone entry back to static Home. The leaf route is not the only risk; shared shell and parent layout must be counted.

Expected behavior: signed-in direct `/hub/trips` and static Home -> Trips should render the actual trips route, not `/home#hub`, and no OOM markers should appear in Android logcat.

Fix direction: make Hub Trips the Android Chrome canary for this ORCH. If it fails physical proof, stop and keep it static-shelled rather than approving partial Hub parity.

### F-5 - Confirmed blocker: Marketing overview is small but auth/account waits need terminal states

Classification: likely bug / production-hardening gap.

Evidence: `marketing/index.tsx` uses `useAuth` to derive `accountId`, then `useMarketingOverview(accountId)`. It already treats unresolved disabled-query state as a skeleton and errors as an empty state. ORCH-1094 route chunk evidence showed Marketing overview was small, but signed-in phone proof was redirected to static Home.

Expected behavior: signed-in phone browser shows skeleton, metrics, or clear empty/error state; New campaign navigates to the compose route without static redirect loop.

Fix direction: add a route-specific test/harness for `accountId=null`, `hasResolved=false`, error, empty, and populated states; runtime smoke should tap New campaign and confirm compose route starts.

### F-6 - Confirmed blocker: Campaign Compose is the heaviest target and must prove editor/schedule controls

Classification: production-hardening gap.

Evidence: ORCH-1094 bundle evidence showed `/marketing/campaigns/compose` around 570KB route chunk, far larger than the other target route chunks. `compose.tsx` imports the V2 composer, preview panes, schedule picker, audience picker, review sheet, templates, keyboard shortcuts, and campaign services. The current web schedule picker is split from the native DateTimePicker in `SchedulePickerSheet.tsx`, which ORCH-1092 guards, but full signed-in interaction was not proven.

Expected behavior: signed-in phone browser opens compose, focuses subject/body, opens audience or schedule sheet, uses browser-safe date/time controls, saves draft or shows an actionable validation gate, and returns safely.

Fix direction: ORCH-1095 must either keep compose in scope with a reduced route-entry/interaction proof or explicitly fail the ORCH until compose is split further. Static shell is not parity.

### F-7 - Confirmed blocker: Account is real, but payout/account-management must stay generated-session only

Classification: confirmed route contract / security gap if violated.

Evidence: `account.tsx` renders real brand rows, settings rows, sign-out, partner rows, and lazy brand switcher/delete/universal creator. Static Home's payout action is a shell with generated secure session copy, and `/connect-account-management` remains blocked in root and injector maps. ORCH-1092 and ORCH-1094 both state direct static payout-management is invalid because account management requires an authenticated generated session.

Expected behavior: Account route itself can be interactive on phone browsers, but it must not expose or approve sessionless `/connect-account-management`.

Fix direction: restore Account first-screen and basic settings/brand interactions; keep payout management accessible only through existing authenticated generated-session surfaces, not static Home.

### F-8 - Confirmed test gap: existing ORCH-1094 guard can pass while parity is absent

Classification: regression-test gap.

Evidence: `test:orch-1094` passes when approved target routes redirect to static Home anchors for signed-in phone browsers. ORCH-1094 close explicitly says that is not full interactive parity.

Expected behavior: ORCH-1095 guard should fail if the injector still contains `location.replace("/home#"+target)` for any ORCH-1095 target route marked interactive, and should pass only when direct route chunks load and route smoke proves useful interactive screens.

Fix direction: add `test:orch-1095` chained after `test:orch-1094`, rewrite guard assertions around an `interactiveRouteStatus` map or equivalent, and include Playwright mobile signed-in runtime smoke.

## Non-Causes Disproved

- Not missing route files: all five target route files exist and contain real screen implementations.
- Not a static Home link omission: static Home already links to the five target paths.
- Not a backend/Supabase schema blocker for this spec: the target work is route access, route boot, and existing client data states. No migration or RLS change is required by the current evidence.
- Not a provider-copy regression: static Home and account/payout copy remain provider-neutral and do not expose direct Stripe/account-management static links.
- Not an Ari/Experiences problem: those routes remain intentionally out of scope and blocked.

## Cross-Surface Impact

Touched surfaces:

- Business Web phone browsers: in scope and primary.
- Business Web desktop: sanity surface; must not regress.

Explicitly out of scope:

- Consumer iOS.
- Consumer Android.
- Buyer/anonymous Web.
- Business iOS native.
- Business Android native.
- Admin Web.
- Hub Experiences.
- Ari.
- Sessionless `/connect-account-management`.
- Backend/provider/Supabase mutations.

## Validation Plan

Automated:

1. Add `mingla-business/scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs`.
2. Add `npm run test:orch-1095` chained after `test:orch-1094`.
3. Require a fresh `npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs`.
4. Assert ORCH-1091 cache/chunk recovery markers remain.
5. Assert non-goal routes remain blocked.
6. Assert ORCH-1095 target routes no longer preboot-redirect signed-in phone users to `/home#...`.
7. Resolve route chunks and enforce budgets at least as strict as ORCH-1093/1094 unless spec-approved.
8. Playwright mobile signed-in fixture or mocked localStorage/session harness verifies target routes reach route-owned text, not static Home text.

Manual:

1. Physical Android Chrome signed-in route smoke for all five target routes.
2. Android logcat grep for `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, `Aw, Snap`, `fatal exception`, `SIGSEGV`, and `Render process`.
3. Physical iPhone Safari signed-in route smoke for all five target routes.
4. Desktop Chromium/Safari sanity for the same route set.

## Readiness Conclusion

ORCH-1095 is ready for a bounded implementation spec, not immediate implementation by forensics. The route code exists, but the current shipped behavior intentionally routes signed-in phone users to static Home for safety. The implementation contract must graduate only the five named routes from static-section safety into real interactive route ownership, while preserving the static launcher, ORCH-1091/1093 guards, provider-neutral payout copy, and blocked status for Hub Experiences, Ari, and sessionless payout management.
