# Implementation Report: ORCH-1094 Business Web Core Parity Wave

Date: 2026-06-07
Skill: implementor-mingla (Codex)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`
Branch: `ORCH-1094-business-web-core-parity-wave`
Status: implemented, partially verified (automated export/browser gates passed; signed-in physical phone smoke blocked by unavailable authenticated phone sessions)

## Summary

ORCH-1094 restored the core Mingla Business web route family as one bundled implementation: Event Creator stayed approved, Hub Events and Hub Trips are now approved, Marketing overview and Campaign Compose are now approved, and Account is now approved. Non-core routes remain protected: Hub Experiences, Ari, and sessionless Connect Account Management.

No backend, Supabase, RLS, migration, edge function, Stripe/provider payload, deploy, merge, OTA, or reap action was performed. No independent tester pass was dispatched before the full 1-4 implementation.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first. Applicable ALL/ORCH-1094 WARN entries were acknowledged and factored in anchor commit `bf65b9ad4` (`COMMS-1094: ack business web implementation warnings`).

Factored constraints:

- Preserve provider-neutral seller payout copy.
- Do not mutate backend/provider/Supabase.
- Do not deploy, merge, OTA, or reap.
- Keep ORCH-1091 cache/chunk recovery, ORCH-1092 static route protections, and ORCH-1093 fail-closed behavior for non-approved routes.
- Do not approve `/hub/experiences`, `/ari`, or `/connect-account-management`.

## Files Changed

- `mingla-business/app/_layout.tsx`
- `mingla-business/public/home.html`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/scripts/ci/orch-1087-static-route-firewall.mjs`
- `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs`
- `mingla-business/scripts/ci/orch-1089-signedin-event-creator-wizard.mjs`
- `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`
- `mingla-business/scripts/ci/orch-1094-business-web-core-parity-wave.mjs`
- `mingla-business/src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts`
- `mingla-business/package.json`
- `Mingla_Artifacts/reports/orch-1094-evidence/android-home.png`
- `Mingla_Artifacts/reports/orch-1094-evidence/android-hub-events.png`
- `Mingla_Artifacts/reports/orch-1094-evidence/android-hub-experiences.png`

## End-User Behavior

Business web users can now enter the real signed-in app route family for:

- Create Event.
- Hub Events.
- Hub Trips.
- Marketing overview.
- Campaign Compose.
- Account.

Signed-out users on those restored routes see a bounded sign-in recovery card instead of the protected route card. Phone users who hit non-core routes still get the protected route recovery before heavy app code opens.

Payout account management remains session-generated only. Static Home still points users to Account and keeps the Payout Account action shelled with generated secure session copy; it does not link directly to `/connect-account-management`.

## Route Status Before/After

| Route | Before | After | Notes |
|---|---:|---:|---|
| `/event/create` | approved | approved | Preserved ORCH-1088/1089 behavior. |
| `/hub/events` | pending-proof | approved | Restored as Hub core. |
| `/hub/trips` | pending-proof | approved | Restored as Hub core; static Home now links directly. |
| `/marketing` | pending-proof | approved | Restored as Marketing core. |
| `/marketing/campaigns/compose` | pending-proof | approved | Restored as Marketing core with web schedule picker guard preserved. |
| `/account` | pending-proof | approved | Restored as Account core. |
| `/hub/experiences` | blocked | blocked | Not approved in this wave. |
| `/ari` | blocked | blocked | Not approved in this wave. |
| `/connect-account-management` | blocked | blocked | Sessionless payout management remains blocked. |

Root route status map and injector route status map now match for every route above.

## Static Home Links Before/After

| Static Home action | Before | After |
|---|---|---|
| Create Event | `/event/create` | `/event/create` plus `data-orch-1094-core-route="event-create"` |
| Hub Events | `/hub/events` | `/hub/events` plus `data-orch-1094-core-route="hub-events"` |
| Hub Trips | `#hub-trips` shell | `/hub/trips` plus `data-orch-1094-core-route="hub-trips"` |
| Marketing Overview | `/marketing` | `/marketing` plus `data-orch-1094-core-route="marketing-overview"` |
| Compose Blast | `/marketing/campaigns/compose` | `/marketing/campaigns/compose` plus `data-orch-1094-core-route="marketing-compose"` |
| Account | `/account` | `/account` plus `data-orch-1094-core-route="account"` |
| Hub Experiences | `#hub-experiences` shell | unchanged shell |
| Ari | `#ari-assistant` shell | unchanged shell |
| Payout Account | `#payout-account` shell | unchanged shell |
| Connect Account Management | no direct static link | no direct static link |

## Export and Bundle Evidence

Required export command run from `mingla-business`:

```bash
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs
```

Result: PASS. Sentry config warning appeared because org/project env is not configured; export still completed.

Injector result:

```text
[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.
```

Bundle evidence from `npm run test:orch-1094`:

```text
phoneBoot=2884933
__common=1881778
deferred=true
approved=/hub/trips,/hub/events,/marketing,/marketing/campaigns/compose,/account,/event/create
/hub/trips trips-16ecc294365aad13f1001aa0c491ddda.js 12661
/hub/events events-539a600e4d9dbe46e145238db5723687.js 18954
/marketing index-140ddfb8fd743bc1ed14962475948c9c.js 11952
/marketing/campaigns/compose compose-a82fe361c1d11bff755c71dc21b2a8bc.js 570122
/account account-4d3134140304fd405f5982d94f4524f1.js 9055
/event/create create-285c84b67ccbda12c0b293d15a34f037.js 4522
```

Export hardening added:

- Injector now normalizes an Expo export artifact where an entry chunk can appear on disk as `index-... 2.js` while HTML points to `index-....js`.
- Injector now repairs missing tiny duplicated `_layout` chunks referenced by the route map so approved routes do not fall through to `index.html` and throw `Unexpected token '<'`.

## Regression Test Evidence

Old-failure proof during implementation:

- First source gate failed because ORCH-1087 still forbade `/hub/trips`: `ORCH-1087 static route firewall FAIL: public/home.html must not include forbidden token: href="/hub/trips"`.
- After export, runtime smoke initially exposed missing chunk failures: `Unexpected token '<'` and `Requiring unknown module`. The injector was hardened and the smoke was rerun.

Final commands/results:

```bash
npm run test:orch-1094
```

Result: PASS. This chains ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093 self-test, ORCH-1093 bundle check, and the new ORCH-1094 gate.

Additional browser smoke against local Vercel-like rewrite server:

```text
PASS Android Chrome /home
PASS Android Chrome /event/create
PASS Android Chrome /hub/events
PASS Android Chrome /hub/trips
PASS Android Chrome /marketing
PASS Android Chrome /marketing/campaigns/compose
PASS Android Chrome /account
PASS Android Chrome /hub/experiences
PASS Android Chrome /ari
PASS Android Chrome /connect-account-management
PASS iPhone Safari equivalent /home
PASS iPhone Safari equivalent /event/create
PASS iPhone Safari equivalent /hub/events
PASS iPhone Safari equivalent /hub/trips
PASS iPhone Safari equivalent /marketing
PASS iPhone Safari equivalent /marketing/campaigns/compose
PASS iPhone Safari equivalent /account
PASS iPhone Safari equivalent /hub/experiences
PASS iPhone Safari equivalent /ari
PASS iPhone Safari equivalent /connect-account-management
PASS Desktop Chromium /home
PASS Desktop Chromium /event/create
PASS Desktop Chromium /hub/events
PASS Desktop Chromium /hub/trips
PASS Desktop Chromium /marketing
PASS Desktop Chromium /marketing/campaigns/compose
PASS Desktop Chromium /account
```

## Physical Smoke URLs and Outcomes

Local smoke server:

- Local: `http://127.0.0.1:51094`
- LAN/physical Android: `http://172.20.17.113:51094`

Physical Android device:

- Device: Samsung Galaxy A72, adb serial `R58R54YV7JT`
- Browser: Chrome
- Session state: signed out

Physical Android outcomes:

- `http://172.20.17.113:51094/home`: rendered static Home without crash. Evidence: `Mingla_Artifacts/reports/orch-1094-evidence/android-home.png`
- `http://172.20.17.113:51094/hub/events`: rendered restored route signed-out recovery without crash. Evidence: `Mingla_Artifacts/reports/orch-1094-evidence/android-hub-events.png`
- `http://172.20.17.113:51094/hub/experiences`: rendered protected recovery without crash. Evidence: `Mingla_Artifacts/reports/orch-1094-evidence/android-hub-experiences.png`

Physical signed-in Android smoke blocker:

- The connected phone browser was signed out and no safe authenticated business web session/credentials were available in this implementation turn. Signed-in data flows therefore remain a tester/manual gate.

iPhone Safari physical smoke blocker:

- No physical iPhone was connected. Safari-equivalent Playwright mobile smoke passed for the core route set and blocked mobile routes.

Schedule/date interaction smoke:

- Automated source and bundle guards verified the web composer schedule picker still uses browser-native date/time controls and does not import `@react-native-community/datetimepicker` in the web route.
- Full interactive signed-in schedule selection was not performed because no authenticated phone browser session was available.

## Remaining Blocked Routes

Still blocked in both root and injector maps:

- `/hub/experiences`
- `/ari`
- `/connect-account-management`

These were intentionally not approved and should not be routed to tester as restored parity.

## Tester Dispatch Confirmation

No independent tester pass happened before the full 1-4 implementation. This report is the first implementation output after the bundled Event Creator, Hub core, Marketing core, and Account core work was completed and internally verified.

## Deploy and Backend Notes

- No deploy performed.
- No merge performed.
- No OTA performed.
- No worktree reap performed.
- No backend/provider/Supabase mutation performed.
- No migration created.

Future deploy must happen only from merged main per COMMS-0015.

## Rework Addendum: Signed-In Physical Android Confirmation

Date: 2026-06-07
Status after rework: implemented and Android-verified for the current phone-browser safety contract.

After the first conditional QA pass, Seth provided a signed-in Google path on the physical Android device. Chrome was driven through Google sign-in using the available `sethpgieva@gmail.com` account, then the route set was retested against a fresh local export.

### Root Causes Found After QA

1. Signed-in mobile web was still navigating into the full Expo tabs home route after auth callback. That route can load the heavy signed-in app shell on phone browsers and produced the white screen / browser crash path Seth reported. The fix sends signed-in mobile business web users to the static `/home` launcher from `app/index.tsx`, `app/auth/index.tsx`, and `app/auth/callback.tsx` via `src/utils/mobileWebStaticHomeRedirect.ts`.
2. Approved heavy signed-in routes could still start the full Expo route on phone browsers before the safe static shell took over. The preboot injector now redirects signed-in phone-browser requests for `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` to static Home sections before Expo JS loads.
3. Supabase `getSession()` can hang behind the GoTrue browser lock on mobile Chrome. `AuthContext` now falls back to the stored web session on bootstrap timeout when a usable business session exists, instead of treating the user as anonymous.
4. Event Create could wait forever on brand recovery even when the browser already had a stored `currentBrandId`. `app/event/create.tsx` now allows the signed-in web wizard to mint from the stored brand and has a bounded `brand_timeout` recovery state.

### Current End-User Contract

- Phone browser Google sign-in lands on fast static `/home`, not the full Expo tabs home.
- Signed-in physical Android Chrome opens the real Event Create wizard.
- Signed-in physical Android Chrome routes Hub Events, Hub Trips, Marketing overview, Campaign Compose, and Account to the static Home section/deep-link shell instead of a blank page or crash.
- Campaign Compose on phone browser is intentionally static-shell only in this wave; full interactive mobile-web composer parity is still future work.
- `/hub/experiences`, `/ari`, and `/connect-account-management` remain protected.
- Desktop web and native app routing were not intentionally changed.

### Additional Files Changed In Rework

- `mingla-business/app/auth/callback.tsx`
- `mingla-business/app/auth/index.tsx`
- `mingla-business/app/event/create.tsx`
- `mingla-business/app/index.tsx`
- `mingla-business/src/context/AuthContext.tsx`
- `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts`
- `mingla-business/src/utils/mobileWebStaticHomeRedirect.ts`
- `mingla-business/src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`
- `mingla-business/scripts/ci/orch-1094-business-web-core-parity-wave.mjs`
- `Mingla_Artifacts/reports/orch-1094-physical-confirmation/`

### Additional Verification

Commands rerun after rework:

```bash
npx jest src/context/__tests__/AuthContext.timeout.test.ts src/utils/__tests__/orch_1088_event_creator_phone_parity.test.ts --runInBand
```

Result: PASS, 2 suites and 26 tests.

```bash
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1094
```

Result: PASS. The chained gate again passed ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093, and ORCH-1094. Final bundle evidence included `phoneBoot=2885700`, `__common=1882545`, `deferred=true`, and approved route chunks for `/event/create`, `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account`.

Physical Android Chrome evidence, device `R58R54YV7JT`, after Google sign-in:

- `/auth` with Google account selection redirected to `/home`; static Home rendered and showed the signed-in email. Evidence: `Mingla_Artifacts/reports/orch-1094-physical-confirmation/android-authfallback-home.png` and `.xml`.
- `/event/create?storedbrand=1` opened the real 7-step wizard on Step 1 and minted a draft edit route. Evidence: `android-storedbrand-event_create.png` and `.xml`.
- `/hub/events?storedbrand=1` redirected to `/home#hub` and rendered the static Hub section. Evidence: `android-storedbrand-hub_events.png` and `.xml`.
- `/hub/trips?storedbrand=1` redirected to `/home#hub` and rendered the static Hub section. Evidence: `android-storedbrand-hub_trips.png` and `.xml`.
- `/marketing?storedbrand=1` redirected to `/home#marketing` and rendered the static Blast section. Evidence: `android-storedbrand-marketing.png` and `.xml`.
- `/marketing/campaigns/compose?storedbrand=1` redirected to `/home#compose-blast` and rendered the static Compose Blast shell. Evidence: `android-storedbrand-marketing_campaigns_compose.png` and `.xml`.
- `/account?storedbrand=1` redirected to `/home#account` and rendered the static Account section. Evidence: `android-storedbrand-account.png` and `.xml`.

Residual manual gate: physical iPhone Safari was not connected in this rework pass. Playwright iPhone-equivalent evidence remains the available iPhone coverage for this branch.
