# Spec - ORCH-1095 Business Web Interactive Parity Wave

Date: 2026-06-07

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1095-[business-web-interactive-parity-wave]`

Branch: `ORCH-1095-business-web-interactive-parity-wave`

Base: `7a1e1d74fe2c00383af715e94273c798497524f4`

## 1. Goal

Restore real signed-in phone-browser interactivity for exactly these Mingla Business web routes:

1. `/hub/events`
2. `/hub/trips`
3. `/marketing`
4. `/marketing/campaigns/compose`
5. `/account`

Success means a signed-in phone-browser user reaches the real route-owned screen and can complete one route-specific interaction without being redirected to static Home, crashing, looping, or waiting indefinitely. ORCH-1094's static-section redirects are safety fallback behavior, not parity.

## 2. Non-Goals And Hard Guards

Do not implement, approve, or advertise:

- Hub Experiences interactive parity.
- Ari interactive parity.
- Sessionless `/connect-account-management`.
- Experience checkout.
- Backend changes.
- Supabase migrations/RLS/RPC changes.
- Provider payload changes.
- Stripe/Paystack account-session changes.
- Deploy, merge, OTA, reap, or release from the ORCH worktree.

Preserve:

- Static `/home` as the phone-browser post-auth launcher and crash fallback.
- ORCH-1091 cache/chunk recovery markers and Vercel web-JS `must-revalidate` behavior.
- ORCH-1093 fail-closed route protection for any route not proven interactive.
- Provider-neutral payout language: no `Connect Stripe`, `Payments & Stripe`, or `Stripe account` copy regression in seller-facing surfaces touched by this ORCH.
- `/hub/experiences`, `/ari`, and `/connect-account-management` as blocked in root and injector maps.

## 3. Required Implementation Order

1. Add failing ORCH-1095 regression guard first.
2. Add a route status model that distinguishes `interactive`, `static-section`, and `blocked` phone-browser behavior.
3. Remove the signed-in preboot `/home#...` redirect for only the five ORCH-1095 target routes.
4. Keep post-auth landing on static `/home` for `/`, `/auth`, and `/auth/callback` on mobile web unless the user explicitly navigates to an ORCH-1095 target route.
5. Slim parent route-entry chunks as needed.
6. Harden each target route's auth/current-brand/data terminal states.
7. Add route-specific automated interaction smoke.
8. Run fresh export/inject/tests.
9. Run Android Chrome physical validation.
10. Run iPhone Safari validation.
11. Write implementation report with route evidence and unresolved conditions.

If any target route cannot pass Android Chrome plus iPhone Safari proof, keep that route in `static-section` or `blocked` and return a rework report. Do not call partial static behavior "interactive parity."

## 4. Files And Layers To Change

### Static Home

Likely files:

- `mingla-business/public/home.html`

Requirements:

- Keep visible Home tabs and all current static fallback panels.
- Keep direct links to the five target routes only if those links now reach the real route on phone browsers.
- Add ORCH-1095 markers to each target link after proof, for example:
  - `data-orch-1095-interactive-route="hub-events"`
  - `data-orch-1095-interactive-route="hub-trips"`
  - `data-orch-1095-interactive-route="marketing-overview"`
  - `data-orch-1095-interactive-route="marketing-compose"`
  - `data-orch-1095-interactive-route="account"`
- Keep Hub Experiences, Ari, and Payout Account as shell targets.
- Static Home must remain Expo-free: no `/_expo/static` scripts and no app-bundle tokens.

### Preboot Injector

Likely file:

- `mingla-business/scripts/inject-mobile-blur-css.mjs`

Requirements:

- Preserve `mingla-mobile-web-chunk-recovery`, `mingla-mobile-web-home-preboot`, `mingla-mobile-web-no-blur`, `orch1091-js-cache-bust`, and `orch1093-mobile-route-script-deferral`.
- Replace the current behavior where signed-in phone users on the five target routes are redirected to `/home#...`.
- Introduce an explicit map for route behavior:
  - ORCH-1095 target routes: `interactive`.
  - `/event/create`: keep current approved interactive behavior.
  - `/hub/experiences`, `/ari`, `/connect-account-management`: `blocked`.
  - any future unsafe route: `static-section` or `blocked`, not implicit approved.
- Continue rendering preboot recovery before app JS for blocked routes.
- Continue redirecting stale chunk failure to `/home?recovered=chunk`.

### Root Layout

Likely file:

- `mingla-business/app/_layout.tsx`

Requirements:

- Keep signed-out recovery for the five target routes.
- Keep blocked recovery for `/hub/experiences`, `/ari`, and `/connect-account-management`.
- Align root route statuses with injector statuses.
- Do not let a route be `interactive` in one map and `static-section` or `blocked` in the other.
- Add route-specific recovery copy only if a target remains unproven.

### Post-Auth Redirect Utility

Likely files:

- `mingla-business/src/utils/mobileWebStaticHomeRedirect.ts`
- `mingla-business/app/index.tsx`
- `mingla-business/app/auth/index.tsx`
- `mingla-business/app/auth/callback.tsx`

Requirements:

- Keep signed-in mobile web post-auth landing to static `/home` from root/auth pages.
- Do not redirect a direct ORCH-1095 target route request back to `/home` after auth has already completed.
- Add tests or guard logic proving direct `/hub/events`, `/hub/trips`, `/marketing`, `/marketing/campaigns/compose`, and `/account` are exempt from static-home post-auth redirects when intentionally requested.

### Tab And Parent Layouts

Likely files:

- `mingla-business/app/(tabs)/_layout.tsx`
- `mingla-business/app/(tabs)/hub/_layout.tsx`
- `mingla-business/app/(tabs)/marketing/_layout.tsx`

Requirements:

- Keep global search and command palette lazy enough that their bodies do not enter phone route-entry chunks.
- Keep brand switcher, brand delete, universal creator, share, manage, and action sheets lazy.
- Do not mount desktop-only bodies on phone web.
- Hub parent layout must not redirect out of target routes because visible-tabs data is loading.
- Marketing parent layout must not load composer-only bodies before target route interaction.

### Route Screens

Likely files:

- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/app/(tabs)/marketing/index.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/app/(tabs)/account.tsx`

Requirements by route:

- Hub Events:
  - Render filters/list/empty/error states from real data hooks.
  - Filter tap works.
  - One card open or manage-menu open/close works when fixture data exists.
  - Lazy event manage/share/end-sales bodies do not enter phone first paint.
- Hub Trips:
  - Render filters/list/empty/error states from real data hooks.
  - Filter tap works.
  - One trip card open or manage-menu open/close works when fixture data exists.
  - This route must receive extra Android OOM scrutiny because it was the ORCH-1093 crash route.
- Marketing overview:
  - Render skeleton, empty, error, or populated metrics without infinite spinner.
  - New Campaign tap reaches real compose route, not static Home.
- Campaign Compose:
  - Render subject/body/audience shell on phone web.
  - Focus subject/body without keyboard overlap or route crash.
  - Open schedule picker and show browser-safe date/time controls.
  - Validation gate gives actionable missing-field copy.
  - Save/review path does not require unsupported native picker modules.
- Account:
  - Render brand/settings states.
  - Brand row/profile navigation or brand switcher open/close works.
  - Sign-out action remains reachable and clears session as before.
  - Payout management remains generated-session only; no direct static `/connect-account-management` link.

## 5. Bundle And Native/Web-Shim Requirements

Keep or strengthen existing ORCH-1093 route budgets unless implementation evidence justifies a smaller/larger threshold:

| Route | Maximum route chunk raw bytes |
|---|---:|
| `/hub/events` | 120,000 |
| `/hub/trips` | 80,000 |
| `/marketing` | 150,000 |
| `/marketing/campaigns/compose` | 600,000 until deeper composer split is approved |
| `/account` | 120,000 |

Phone boot/common budget must be reported in the implementation output. If boot/common remains above ORCH-1093 limits, physical Android and Safari proof is mandatory and must be treated as acceptance evidence, not optional smoke.

Forbidden in eager phone boot and restored route-entry chunks unless platform-split/lazy and proven absent from first paint:

- `expo-image-picker`
- `expo-file-system`
- `expo-file-system/legacy`
- `react-native-compressor`
- `react-native-video-trim`
- `@react-native-community/datetimepicker`
- `@stripe/connect-js`
- `@stripe/react-connect-js`
- `react-native-qrcode-svg` body
- `BrandSwitcherSheet` body
- `BrandDeleteSheet` body
- `UniversalCreatorSheet` body
- `OfferingManageSheet` body
- `ShareModal` body
- `GlobalSearchSheet` body
- `CommandPalette` body

Lazy hosts are allowed if the heavy body is not in the phone first-entry or target route-entry chunk.

## 6. Auth, Current Brand, And Data-State Contract

Every target route must handle:

- signed out,
- valid stored web session,
- stale/expired stored web session,
- auth bootstrap timeout with recoverable stored session,
- auth bootstrap timeout without session,
- current brand missing,
- current brand recovery in progress,
- current brand recovery error,
- query disabled while waiting for auth/brand,
- query loading,
- query error,
- empty data,
- populated data.

No target route may show an infinite spinner beyond 8 seconds on phone browsers. Acceptable terminal states are a route-owned skeleton, empty state, error state, signed-out recovery, or explicit protected recovery.

## 7. Regression Tests Required In Same Commit

Add:

- `mingla-business/scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs`
- `mingla-business/src/utils/__tests__/orch_1095_business_web_interactive_parity_wave.test.ts` or route-specific Jest tests if more appropriate
- `test:orch-1095` in `mingla-business/package.json`, chained after `test:orch-1094`

The guard must fail before implementation and pass after implementation. It must assert:

1. Static Home contains ORCH-1095 markers for the five target routes.
2. Static Home keeps Hub Experiences, Ari, and Payout Account shelled.
3. Root layout and injector route maps agree.
4. The injector does not redirect signed-in phone requests for the five target routes to `/home#...`.
5. `/event/create` remains interactive.
6. `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked.
7. Fresh export includes ORCH-1091/1093 recovery markers.
8. Route chunks resolve for all five target routes.
9. Route chunk budgets are enforced.
10. Forbidden native/provider modules are absent from phone first-entry and target route-entry chunks.
11. Playwright mobile signed-in harness reaches route-owned text, not static Home text, for all five target routes.
12. Campaign Compose web schedule picker remains browser-native and does not import native DateTimePicker.
13. Provider-neutral copy remains intact.

If automated signed-in harnessing cannot use a real Supabase session, the test may use a deterministic localStorage/session stub only for route-load proof, but physical browser validation remains mandatory before acceptance.

## 8. Manual Validation Gates

### Android Chrome Physical

Use a physical Android phone. Samsung A72-class hardware or weaker is preferred because ORCH-1093 failed there.

Steps:

1. Start from clean merged-main-derived local export or production after merge, not a dirty anchor.
2. Sign in with an approved business test account.
3. Confirm `/home` still renders static Home.
4. Open `/hub/events`; expected: real Hub Events route, filters visible, one filter tap works.
5. Open `/hub/trips`; expected: real Hub Trips route, filters visible, one filter tap works.
6. Open `/marketing`; expected: real Marketing overview route, New Campaign tap reaches compose.
7. Open `/marketing/campaigns/compose`; expected: real composer route, subject/body focus works, schedule picker opens browser-safe controls or validation gate.
8. Open `/account`; expected: real Account route, one settings/brand interaction works.
9. Open `/hub/experiences`, `/ari`, and `/connect-account-management`; expected: protected recovery/static-safe behavior, not interactive approval.
10. Refresh each target route once.
11. Back/forward between static Home and each target route.
12. Grep logcat for `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, `Aw, Snap`, `fatal exception`, `SIGSEGV`, and `Render process`; expected zero new fatal lines.

### iPhone Safari

Use physical iPhone Safari before production release. If unavailable, implementation may record a simulator/WebKit fallback, but the report must label physical iPhone Safari as an unresolved manual gate.

Repeat the same route sequence as Android Chrome. Expected: no blank screen, no reload loop, no Safari crash, no static Home redirect for target routes, and blocked recovery for non-goal routes.

### Desktop Sanity

Run desktop Chromium or Safari against the same export/deploy:

- `/home`
- `/hub/events`
- `/hub/trips`
- `/marketing`
- `/marketing/campaigns/compose`
- `/account`
- `/hub/experiences`
- `/ari`
- `/connect-account-management`

Expected: desktop routes keep normal behavior; blocked phone-only preboot logic must not incorrectly block desktop.

## 9. Success Criteria

ORCH-1095 passes only when:

- The five target routes load real interactive screens on signed-in phone browsers.
- None of the five target routes redirects to static Home anchors as the main signed-in behavior.
- Each route completes at least one route-specific interaction on Android Chrome and iPhone Safari or records a hard manual gate if physical iPhone is unavailable.
- No target route shows blank screen, route error boundary, stale chunk loop, infinite spinner over 8 seconds, or phone renderer crash.
- Android logcat shows zero new OOM/render-process fatal markers during the route matrix.
- `/hub/experiences`, `/ari`, and `/connect-account-management` remain blocked/protected.
- Static Home remains Expo-free.
- Provider-neutral payout copy remains intact.
- Regression tests are committed with the implementation and would fail on the current ORCH-1094 static-section redirect behavior.
- No backend/provider/Supabase mutation occurs.

## 10. Implementation Report Requirements

Write:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1095_BUSINESS_WEB_INTERACTIVE_PARITY_WAVE.md`

Include:

- Old/new route behavior table.
- Files changed.
- Static Home marker table.
- Root/injector route status table.
- Export command and output.
- Route chunk table.
- Phone boot/common chunk byte table.
- Automated test output.
- Android Chrome physical route evidence and logcat grep summary.
- iPhone Safari physical evidence or explicit unresolved gate.
- Desktop sanity evidence.
- Confirmation that Hub Experiences, Ari, and sessionless payout account stayed blocked.
- Confirmation of no backend/provider/Supabase/deploy/OTA/merge/reap.

## 11. Deploy Discipline

No deploy from this ORCH worktree.

If the implementation is approved:

1. Open PR from `ORCH-1095-business-web-interactive-parity-wave`.
2. Let required GitHub checks pass.
3. Merge through PR to `main`.
4. Verify `origin/main` contains the squash commit and changed source/static files.
5. Start the web test surface from clean merged `main`.
6. Deploy only from merged `main` if release is approved.
7. Run production Android Chrome and iPhone Safari smoke after deploy.

This preserves COMMS-0015/0018.

## 12. Downstream Handoff

After orchestrator review, route to Codex `implementor-mingla` for implementation in the ORCH-1095 worktree. After implementation, route to tester for independent QA with special focus on signed-in Android Chrome, iPhone Safari, route chunk budgets, and proving the old static-section redirect no longer masks missing interactive parity.
