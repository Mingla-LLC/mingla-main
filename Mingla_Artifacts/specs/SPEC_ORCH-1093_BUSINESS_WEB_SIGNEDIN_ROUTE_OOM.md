# SPEC - ORCH-1093 Business Web Signed-In Route OOM

Date: 2026-06-06
Skill: forensic-mingla
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1093-[business-web-signedin-route-oom]`
Branch: `ORCH-1093-business-web-signedin-route-oom`

## Objective

Make signed-in Mingla Business mobile-browser route entry fast and stable without stripping the app, abandoning Expo Web, weakening ORCH-1091 cache/chunk recovery, or reversing ORCH-1092 provider-neutral/native-module safeguards. The user outcome is simple: a signed-in phone user can open business routes directly and either see the real first screen quickly or a deliberate fail-closed recovery, never a blank crash.

## Non-Negotiable Guards

- Do not change `web.output` away from the approved Expo Web path in this ORCH unless orchestrator explicitly amends the scope.
- Keep Expo Router `asyncRoutes.web === true`.
- Preserve `scripts/inject-mobile-blur-css.mjs` markers and behavior:
  - `orch1091-js-cache-bust`
  - `?v=${JS_CACHE_BUST_PARAM}`
  - `mingla-mobile-web-chunk-recovery`
  - `mingla-mobile-web-home-preboot`
  - `mingla-mobile-web-no-blur`
- Preserve Vercel web JS cache override: `/_expo/static/js/web/(.*)` must remain `public, max-age=0, must-revalidate`.
- Preserve ORCH-1092 provider-neutral payout copy. Do not introduce "Stripe account", "Connect Stripe", or provider-specific payout restoration copy.
- Preserve native-module quarantine for web eager and restored chunks.
- Do not call static Home shells the final fix.
- Any restored route must require physical Android Chrome proof plus mobile Safari proof before being reopened or labeled safe.

## Scope

Implement in the same branch/worktree after orchestrator approval:

- Signed-in mobile-browser boot diet for business web root/tab routes.
- Lazy boundaries for global search, desktop command palette, account destructive/switcher/create sheets, Hub offering manage/share sheets, QR, media picker/file-system/native shims, Stripe/Paystack/connect surfaces, and marketing composer heavy bodies where they are not first-paint requirements.
- Route restoration gates and budgets for:
  - `/hub/trips`
  - `/hub/events`
  - `/marketing`
  - `/marketing/campaigns/compose`
  - `/account`
  - `/event/create`
- CI guard and local runtime smoke additions.
- Manual physical browser proof requirements.

Do not implement:

- Backend/RLS/provider API changes.
- Deploy/merge/OTA/reap.
- `/hub/experiences`, `/ari`, payout management restoration.
- Static output final migration.

## Success Thresholds

All thresholds are measured after `npx expo export -p web` and ORCH-1091 injection has run.

| Metric | Required threshold |
| --- | ---: |
| Direct-route eager raw JS total from `dist/index.html` | <= 2,100,000 bytes |
| Eager `__common` raw bytes | <= 1,200,000 bytes |
| `/hub/trips` leaf route chunk | <= 80,000 bytes |
| `/hub/events` leaf route chunk | <= 120,000 bytes |
| `/account` leaf route chunk | <= 120,000 bytes |
| `/marketing` overview leaf route chunk | <= 150,000 bytes |
| `/event/create` entry leaf route chunk | <= 80,000 bytes |
| `/marketing/campaigns/compose` route chunk | <= 600,000 bytes until deeper composer split is approved |
| Physical Android Chrome direct route first useful screen or deliberate recovery | <= 8 seconds |
| Mobile Safari direct route first useful screen or deliberate recovery | <= 8 seconds |

Failure definition: any `Aw, Snap!`, blank screen after 8 seconds, infinite spinner after 8 seconds, `V8 javascript OOM`, renderer death, missing chunk loop, stale chunk repeated reload, or route that requires multiple manual reloads.

## Implementation Phases

### Phase 0 - Add failing guards first

Files to change:

- `mingla-business/package.json`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs` (new)
- Optional if cleaner: `mingla-business/playwright/orch-1093-signedin-route-entry.config.ts` (new)
- Optional if cleaner: `mingla-business/playwright/orch-1093-signedin-route-entry.spec.ts` (new)

Requirements:

1. Add `test:orch-1093` to `package.json`:
   - It must run `npm run test:orch-1092`.
   - It must run `node scripts/ci/orch-1093-signedin-route-oom.mjs`.
   - It may run a Playwright route-entry smoke when `dist/index.html` exists.
2. The new CI script must pass `--self-test`.
3. The new CI script must inspect source and exported `dist` when present.
4. The guard must fail on the current proven problem when run against a current production-equivalent export because current eager raw total is about 2,884,148 and `__common` is about 1,881,365.
5. The guard must explicitly chain-preserve ORCH-1091 and ORCH-1092 checks:
   - cache-bust/chunk recovery markers;
   - Vercel JS must-revalidate header;
   - provider-neutral payout copy;
   - static Home still shells `/hub/trips`, `/hub/experiences`, `/ari`, payout until proof marker is added.

Script checks to implement:

- Parse `dist/index.html` eager script refs under `/_expo/static/js/web/`.
- Sum raw bytes for eager scripts.
- Identify eager `__common`.
- Parse the Expo route module map from the main `index-*.js` and resolve chunks for route files:
  - `app/(tabs)/hub/trips.tsx`
  - `app/(tabs)/hub/events.tsx`
  - `app/(tabs)/marketing/index.tsx`
  - `app/(tabs)/marketing/campaigns/compose.tsx`
  - `app/(tabs)/account.tsx`
  - `app/event/create.tsx`
- Enforce the thresholds in this spec.
- Scan eager chunks for forbidden first-entry tokens:
  - `expo-image-picker`
  - `expo-file-system`
  - `expo-file-system/legacy`
  - `react-native-compressor`
  - `react-native-video-trim`
  - `@react-native-community/datetimepicker`
  - `@stripe/connect-js`
  - `@stripe/react-connect-js`
  - `react-native-qrcode-svg`
  - `GlobalSearchSheet`
  - `CommandPalette.web`
  - `BrandSwitcherSheet`
  - `BrandDeleteSheet`
  - `UniversalCreatorSheet`
  - `OfferingManageSheet`
  - `ShareModal`
- Scan specific route chunks with a looser rule: route chunks may reference a lazy host or action trigger, but heavy action body modules must live in separately requested chunks, not route-entry chunks.

### Phase 1 - Split tab-global UI from phone route entry

Files to change:

- `mingla-business/app/(tabs)/_layout.tsx`
- `mingla-business/src/components/ui/GlobalSearchSheet.tsx`
- New recommended file: `mingla-business/src/components/ui/GlobalSearchSheetHost.tsx`
- `mingla-business/src/components/ui/CommandPalette.tsx`
- `mingla-business/src/components/ui/CommandPalette.web.tsx`
- New recommended file: `mingla-business/src/components/ui/CommandPaletteHost.web.tsx`
- Optional native/web stubs if Metro needs platform-specific clean split.

Requirements:

1. Replace static `GlobalSearchSheet` import in `(tabs)/_layout.tsx` with a tiny host.
2. The host may subscribe to `useGlobalSearchSheet()` but must lazy-load the heavy `GlobalSearchSheet` body only after the sheet is opened.
3. On narrow/mobile web, the sheet body must not load at route entry.
4. Replace static `CommandPalette` import with a web-desktop-only lazy host.
5. On phone web, the command palette body and cmdk-related code must not be in eager scripts or phone route chunks.
6. Keep product behavior intact:
   - search button still opens search;
   - command palette still works on wide web;
   - native behavior remains unchanged or stubbed as before.

### Phase 2 - Split action sheets from route first paint

Files to change:

- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/account.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/app/(tabs)/marketing/index.tsx` if it statically imports composer-only or action-only bodies
- Shared components as needed:
  - `src/components/ui/ShareModal.tsx`
  - `src/components/offering/OfferingManageSheet.tsx`
  - `src/components/ui/BrandSwitcherSheet.tsx`
  - `src/components/ui/BrandDeleteSheet.tsx`
  - `src/components/ui/UniversalCreatorSheet.tsx`
  - marketing composer sheet bodies

Requirements:

1. In `/hub/trips`, keep list/filter/card first screen as the route-entry payload.
2. Lazy-load `OfferingManageSheet` only when `manageTrip !== null`.
3. Lazy-load `ShareModal` only when `shareTrip !== null`.
4. The action builders must not force the sheet body into the first route chunk. If `buildOfferingManageActions` causes hoisting, move it behind the same lazy boundary or create a light action descriptor helper that does not import the sheet component.
5. Apply the same pattern to `/hub/events` for event manage/share/end-sales bodies.
6. In `/account`, lazy-load switcher/delete/universal creator sheets only when visible.
7. In marketing, keep overview first screen light. Composer remains restored only with its existing large route budget and manual proof; any composer-only SDK/editor/scheduler bodies must be lazy if not needed for initial composer shell.
8. Preserve all existing product actions after the lazy component loads.

### Phase 3 - Add signed-in route-entry recovery/fail-closed behavior

Files to change:

- `mingla-business/app/_layout.tsx`
- `mingla-business/public/home.html`
- `mingla-business/scripts/ci/orch-1087-static-route-firewall.mjs`
- `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs`
- `mingla-business/scripts/ci/orch-1089-signedin-event-creator-wizard.mjs`
- `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`

Requirements:

1. Keep the existing ORCH-1092 signed-out recovery for its approved routes.
2. Add a separate ORCH-1093 concept for signed-in mobile-browser route safety:
   - routes can be `approved`, `blocked`, or `pending-proof`;
   - direct phone entry to a `blocked`/`pending-proof` route must show a deliberate recovery screen, not attempt full route boot if it is still known unsafe.
3. `/hub/trips` must remain shelled from static Home until the full proof gate passes.
4. If implementation restores `/hub/trips`, add an ORCH-1093 marker in `public/home.html`, update route-firewall guards, and document the physical Android Chrome plus mobile Safari evidence in the implementation report.
5. Do not reopen `/hub/experiences`, `/ari`, or payout management.

Important nuance:

- The signed-in recovery must not create a new static final app. It is a fail-closed route gate for unproven route families.
- The target restored state is a real Expo Web route first screen with lazy-loaded secondary surfaces.

### Phase 4 - Verification and report

Files to add:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`

Commands to run from `mingla-business`:

```bash
npm run test:orch-1093
npx expo export -p web
node scripts/inject-mobile-blur-css.mjs
node scripts/ci/orch-1093-signedin-route-oom.mjs
```

If local dependencies are missing, the implementor may install/use the existing repo dependency workflow, but must not treat "could not export locally" as passing evidence.

Report requirements:

- Before/after eager raw totals and `__common` size.
- Route chunk table for all in-scope routes.
- Exact lazy boundaries added.
- CI output summary.
- Physical Android Chrome evidence with device/browser, account, route list, screenshots/logcat summary.
- Mobile Safari evidence with device/browser and route list.
- Explicit statement that ORCH-1091 and ORCH-1092 guards were preserved.
- Any route not proven must remain shelled or fail-closed.

## Mobile Manual Gates

### Android Chrome

Device: physical Android phone, minimum proof includes Samsung A72 class hardware or weaker.
Browser: Chrome mobile.
Account: real business account with a stored Supabase session.

Steps:

1. Open `https://business.usemingla.com/home`.
2. Confirm the static signed-in Home state renders.
3. Direct-load `https://business.usemingla.com/hub/trips`.
4. Confirm Trips reaches list/empty/loading/error first screen or deliberate recovery within 8 seconds.
5. Direct-load `/hub/events`, `/marketing`, `/marketing/campaigns/compose`, `/account`, and `/event/create`.
6. For each route, confirm no blank screen, no infinite spinner, no multiple reload requirement.
7. Capture logcat during the run and confirm no `V8 javascript OOM`, `CrRendererMain` renderer death, or `Aw, Snap!`.
8. Tap representative lazy actions:
   - Trips manage/share;
   - Events manage/share/end sales if visible;
   - Account switcher/create/delete sheet entry;
   - Marketing composer schedule entry.
9. Confirm lazy surfaces open after user action without crashing.

### Mobile Safari

Device/browser: mobile Safari on iPhone hardware preferred. A simulator/WebKit harness is helpful but does not replace the proof gate for restored route labels.

Repeat the same direct route sequence:

- `/home`
- `/hub/trips`
- `/hub/events`
- `/marketing`
- `/marketing/campaigns/compose`
- `/account`
- `/event/create`

Required result: first useful screen or deliberate recovery within 8 seconds, no blank/crash/infinite spinner, and no route marked restored without evidence.

## Regression Tests and Guards to Commit with the Fix

Same commit as implementation must include:

- `test:orch-1093` package script.
- `scripts/ci/orch-1093-signedin-route-oom.mjs` with self-test.
- Source/static guard updates for any route restored from static Home.
- Tests preserving ORCH-1091 cache/chunk recovery.
- Tests preserving ORCH-1092 provider-neutral payout copy and native-module quarantine.
- A route-entry Playwright smoke if feasible against local exported `dist`.

Manual gates that cannot be automated must be recorded as tester gates in the implementation report and routed to tester/orchestrator.

## Downstream Routing

After this spec is reviewed by orchestrator, route to `implementor-mingla` for implementation in the same ORCH-1093 worktree/branch. After implementation, route to `tester-mingla` for independent verification, with special emphasis on physical Android Chrome and mobile Safari proof before any route is considered restored.
