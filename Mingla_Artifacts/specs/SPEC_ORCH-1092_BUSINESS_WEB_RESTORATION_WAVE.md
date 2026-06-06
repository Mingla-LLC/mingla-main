# SPEC - ORCH-1092 Business Web Restoration Wave

Date: 2026-06-06
Mode: Implementation spec
Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]`
Branch: `ORCH-1092-business-web-restoration-wave`

## 1. Goal

Restore the next set of Business Web phone-browser handoffs from static Home without replacing Expo Web, weakening cache guards, or creating a stripped-down web app. The implementation must reopen useful Hub, Account/Payout, and Marketing Composer entry points only after automated and manual phone-browser proof.

## 2. Non-Goals

- Do not rewrite Business Web outside Expo Web.
- Do not deploy, merge, reap, OTA, mutate Supabase, run migrations, or change provider/backend payloads in this implementation unless a separately approved spec adds that scope.
- Do not weaken ORCH-1091 cache/header/script guards.
- Do not reopen Ari, Scanner, buyer checkout, full creator wizards beyond existing Create preservation, group chat image attachments, or Hub Experiences file-ingestion parity unless explicitly proven and approved in this ORCH's review.
- Do not change seller-facing copy back to provider-specific language such as `Stripe account`, `Connect Stripe`, or `Payments & Stripe`.

## 3. External Docs And Provider Constraints

No new Stripe endpoint, enum, payload shape, or Account Session component configuration is authorized by this spec. If implementation touches the Stripe session generation path or embedded account-management options, it must cite and conform to:

- Stripe Account Sessions API: https://docs.stripe.com/api/account_sessions
- Stripe Connect embedded components overview: https://docs.stripe.com/connect/get-started-connect-embedded-components
- Stripe account-management embedded component: https://docs.stripe.com/connect/supported-embedded-components/account-management
- Stripe supported embedded components: https://docs.stripe.com/connect/supported-embedded-components

Current docs evidence to preserve: Account Sessions return a `client_secret` for embedded components, Stripe recommends creating an Account Session each time a component is displayed, and account management is enabled through the `account_management` component. Account management can use `collectionOptions` with `fields: "eventually_due"` and future requirements included, matching the existing client-side component shape. Do not expose account-management as a sessionless static URL.

## 4. Implementation Contract

### A. Guard Extension Comes First

Add a new repo-running guard, tentatively:

- `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`
- `mingla-business/package.json` script: `test:orch-1092`

`test:orch-1092` must run:

1. `npm run test:orch-1089`
2. ORCH-1091 cache/header/injection coverage, either by reusing the existing ORCH-1085/1091 test or adding a direct check for `orch1091-js-cache-bust`, `?v=orch1091`, `mingla-mobile-web-chunk-recovery`, and Vercel header precedence.
3. The new ORCH-1092 static Home and route-family guard.

The new guard must fail if:

- Static Home has any unmarked direct non-Create route href.
- A reopened ORCH-1092 href lacks a `data-orch-1092-...` marker.
- `Payout account` links directly to `/connect-account-management` without generated-session proof.
- Static Home contains `Stripe account`, `Connect Stripe`, or `Payments & Stripe`.
- ORCH-1091 script/cache/header markers are absent.
- Reopened route-family source imports forbidden native-only modules without a platform split or explicit ORCH-1092 allow reason.

Forbidden modules for reopened phone-browser route families include at minimum:

- `react-native-keyboard-controller`
- `expo-camera`
- `expo-image-picker`
- `expo-file-system`
- `expo-file-system/legacy`
- `@react-native-community/datetimepicker`
- native Stripe SDK imports in web entry or route chunks
- `react-native-video-trim`
- `react-native-compressor`

Allowed patterns:

- `.web.tsx` web-only implementation files for web SDKs, such as Stripe embedded Connect pages.
- Dynamic/lazy imports that are already proven not to enter initial or reopened route chunks.
- Native-only `.native.tsx` or non-web imports that Metro does not resolve for web.

### B. Static Home Reopen Map

Update `mingla-business/public/home.html` only after each route passes source/export/local browser proof:

| Static Home action | Target contract | Marker |
|---|---|---|
| Hub > Events | Reopen to `/hub/events` or the Expo Router canonical equivalent if phone Chrome/Safari proof passes. | `data-orch-1092-hub-events-reopened="true"` |
| Hub > Experiences | Keep shelled unless native file-ingestion imports are quarantined and phone proof passes. | Only if approved: `data-orch-1092-hub-experiences-reopened="true"` |
| Hub > Trips | Keep shelled unless route/list/detail/manage/share proof passes. | Only if approved: `data-orch-1092-hub-trips-reopened="true"` |
| Marketing overview | Reopen to `/marketing` after overview boot proof. | `data-orch-1092-marketing-overview-reopened="true"` |
| Compose blast | Reopen to `/marketing/campaigns/compose` after Composer shell proof. | `data-orch-1092-compose-shell-reopened="true"` |
| Account settings | Reopen to `/account` after Account tab boot proof. | `data-orch-1092-account-reopened="true"` |
| Payout account | Keep shell unless implementation routes through an authenticated generated-session action. | `data-orch-1092-payout-session-reopened="true"` only if generated-session proof exists |

Create must remain exactly ORCH-1089-preserved unless an active regression is proven.

### C. Hub Route Contract

Minimum implementation for this wave:

- Reopen Hub Events first.
- Ensure `/hub/events` reaches loading, empty, error, populated, filter, share, and manage-menu states without native-module page errors.
- Verify `ShareModal` keeps QR lazy-loaded and does not pull `react-native-qrcode-svg` into the first route boot.
- Ensure web exits/back paths from event details do not use native tab-only routes that strand phone-browser users; where needed, use static-safe `/home#hub-events`.

Optional if bounded and proven in the same implementation:

- Reopen Hub Trips after list/filter/share/manage proof.

Do not reopen Hub Experiences unless:

- `ActivitiesSnapInput` and `MenuSnapInput` are web-safe or gated out of phone-browser boot.
- `expo-image-picker` and `expo-file-system/legacy` do not appear in the reopened route chunk.
- Web copy honestly degrades snap/menu generation if file ingestion remains native/desktop-only.

### D. Account And Payout Contract

Account:

- Reopen static Home Account settings to `/account` after route boot proof.
- Account must show bounded loading/error/empty states for brand list, partner rows, settings rows, sign-out, and brand switcher trigger.
- Account route must not regress provider-neutral copy.

Payout:

- Do not link static Home directly to `/connect-account-management`.
- Acceptable path A: leave Payout account as shell with copy explaining that payout management needs a generated secure session.
- Acceptable path B: add an authenticated app-route handoff from Account/Brand payments that creates a fresh account-management session using the existing hook/service path and then opens the hosted Connect page.
- If path B touches Stripe payloads, update this spec or create an amendment with provider docs citations and tests for the exact Account Session request shape.

Embedded Connect page:

- Preserve lazy import shape in `connect-account-management.web.tsx` and `StripeConnectPages.web.tsx`; do not statically import `@stripe/connect-js` or `@stripe/react-connect-js` into Home, Account, or eager web entry chunks.
- Invalid sessionless links must render a clear error and a return action; they are not a successful payout reopen.

### E. Marketing Overview And Composer Shell Contract

Marketing overview:

- Reopen `/marketing` after boot proof for loading, error, empty, and populated overview states.
- FAB to new campaign may point to Composer only after Composer shell passes.

Composer shell:

- Replace or web-branch `SchedulePickerSheet` so web uses browser-native date/time inputs and no `@react-native-community/datetimepicker` enters the web composer route chunk.
- Leave native picker behavior unchanged for native iOS/Android.
- Preserve Tiptap web editor split and do not import Tiptap into native files.
- Composer shell acceptance means:
  - route boots on phone Chrome/Safari,
  - subject typing works,
  - body typing works,
  - template drawer opens/closes or is explicitly disabled with honest copy,
  - event/personalization insertion bar does not crash,
  - schedule action opens web-native date/time controls,
  - review/preview shell opens without hidden keyboard/footer overlap,
  - save errors are visible and do not trap the user.

Full send/delivery analytics parity can remain a later wave unless the implementor proves it here without backend/provider changes.

### F. Cache, Export, And Vercel Contract

Implementation must preserve:

- `vercel.json` `/home -> /home.html` before `/(.*) -> /`.
- `/_expo/static/js/web/*` cache header as `public, max-age=0, must-revalidate`.
- Post-export script injection of chunk recovery, Home preboot, blur-kill CSS, and `?v=orch1091`.
- Expo Web async routes.

No change to `web.output`, `asyncRoutes`, or rewrites is allowed unless reviewed as a separate routing/cache amendment.

## 5. Automated Tests Required

Required in the same scoped commit/push as the implementation:

- `npm run test:orch-1092`
- Export proof:
  - `rm -rf dist`
  - `npx expo export -p web --output-dir dist`
  - `node scripts/inject-mobile-blur-css.mjs`
  - `npm run test:orch-1092`
- Jest or source tests that fail on the old behavior:
  - static Home non-Create links remain shelled unless ORCH-1092 markers exist;
  - Account direct link marker is required before `/account` relink;
  - Payout direct `/connect-account-management` is forbidden unless generated-session marker and proof fixture exist;
  - Composer web schedule control does not import/render native DateTimePicker on web;
  - forbidden native modules are absent from reopened route chunks;
  - provider-neutral copy is preserved.

If `ts-jest` or dependencies are missing in the worktree, the implementor must repair/install dependencies before claiming test completion. A source-guard-only pass is not enough.

## 6. Manual Gates Required Before Home Relink Is Accepted

Use a clean merged-main preview or local export server; final production deploy still occurs only after merge to `main`.

Phone Chrome:

1. Open `https://business.usemingla.com/home` or the Vercel preview Home from a signed-in phone browser.
2. Tap every ORCH-1092 reopened Home action.
3. Confirm each reaches a useful first screen within a reasonable load window.
4. Refresh the route, go Back to Home, reopen it, and verify no blank screen, stale chunk loop, infinite spinner, or native-module error.
5. Exercise one core interaction per reopened route:
   - Hub Events: filter + share or manage-menu open/close.
   - Account: open Account and one settings/brand-switcher row, then return.
   - Marketing overview: open overview and tap New campaign if composer is reopened.
   - Composer shell: type subject/body, open schedule, choose date/time, open preview/review shell.
   - Payout generated session if reopened: create session, load embedded page, handle Done/return.

Safari:

Repeat the same smoke on iPhone Safari or Playwright WebKit mobile as fallback. Real iPhone Safari is preferred before production release.

Android crash/log gate when a device is available:

- During Chrome smoke, grep logcat for `V8 javascript OOM`, `CrRendererMain`, `onServiceDisconnected`, `Aw, Snap`, `fatal exception`, `SIGSEGV`, and `Render process`.
- Expected: zero new fatal route-window lines.

## 7. Cross-Surface Impact

Touched:

- Business Web phone browsers.
- Business Web desktop compatibility for the same routes.

Not touched:

- Consumer iOS/Android.
- Business native iOS/Android behavior, except platform-split files must preserve existing native route behavior.
- Admin Web.
- Buyer checkout.
- Scanner.
- Supabase schema/RLS/edge functions.
- Provider API payloads unless separately approved.

## 8. Implementation Report Requirements

The implementor report must include:

- Changed-file table.
- Old-to-new static Home reopen map with markers.
- Native-module quarantine evidence.
- Export/chunk evidence naming the reopened route chunks inspected.
- Full command output summaries.
- Phone Chrome/Safari proof with URLs.
- Explicit statement that no deploy, OTA, merge, reap, Supabase mutation, or provider/backend change was performed from the worktree.
- Deploy instruction: merge PR to `main`, verify `origin/main` contains the squash commit and changed files, then deploy web from merged `main` only.

## 9. Acceptance Verdict

The implementation is acceptable only if:

- Static Home reopens Account, Hub Events, Marketing overview, and Composer shell only after proof.
- Payout account is either honestly shelled or generated-session based; never direct sessionless `/connect-account-management`.
- ORCH-1091 cache guards pass unchanged.
- Provider-neutral seller/payout copy remains.
- Automated route-family guard and manual phone Chrome/Safari gates pass.

Anything less is a conditional pass at most and must not be described as restored Business Web.
