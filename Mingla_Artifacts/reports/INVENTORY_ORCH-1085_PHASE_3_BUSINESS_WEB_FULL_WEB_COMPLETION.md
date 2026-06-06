# ORCH-1085 Phase 3 Inventory - Business Web Full-Web Completion

Date: 2026-06-05
Mode: Forensics inventory only
Scope: `mingla-business` business web and shared web-reachable route families
Worktree used: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1085-[business-web-code-splitting]` on `ORCH-1085-business-web-code-splitting`, plus later static-home evidence from `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1085-[mobile-web-home-tabs]`.
Hard guard: no product-code edit, no deploy, no OTA, no merge, no reap. Deploy/OTA only from merged `main` per COMMS-0015/0018.

## Executive Result

Seth cannot yet call the business-web version complete. ORCH-1085 reduced the boot problem and static `/home` protects the signed-in phone-browser entry path, but many real business actions still route from static Home into the full Expo/RN-web app. Prior runtime evidence proves that full signed-in Expo web can OOM a physical Android Chrome renderer, so every deep route family that static Home links to needs either a web-optimized route path, an explicit browser-safe degraded contract, or physical phone-browser proof.

This inventory separates confirmed source gaps from route families that are already split/shimmed but still need parity proof before launch.

## Evidence Base

### Prior ORCH evidence read

| Evidence | What it proves |
|---|---|
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1083_BUSINESS_WEB_LOAD_PERF.md:30,66-77` | Business web previously served one 9,237,629 byte JS bundle, one shell, same bundle for all routes, 4,262 modules. Root cause was `web.output:"single"` plus no async routes. |
| `Mingla_Artifacts/specs/SPEC_ORCH-1085_BUSINESS_WEB_CODE_SPLITTING.md:12-14,151-154,513-516` | ORCH-1085 is the architecture cure contract: web-only `asyncRoutes:{web:true}` first, preserve rewrites/deep links/OG/blur-kill, no deploy until merged main. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1085_BUSINESS_WEB_MOBILE_SIGNIN_HOME.md:7-15,26-28,46,64-71,89-91` | Physical Samsung SM-A725F Chrome killed signed-in `/home` with V8 OOM / `CrRendererMain`; static `/home.html` bypassed Expo bootstrap and was verified with zero OOM/crash lines. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1085_MOBILE_WEB_HOME_TABS.md` in the mobile-home-tabs worktree | Later static `/home.html` adds Home/Hub/Ari/Blast/Account tabs, but deeper actions still link into full Expo routes. |
| `Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_E2E_PIPELINE.md:97-106,185-205,243-253` | Android App Links capture every `business.usemingla.com` path when the native app is installed; `/auth/callback` can be stolen from Chrome and drop web OAuth tokens. |
| COMMS-0003, COMMS-0013, COMMS-0015, COMMS-0018, COMMS-0021 | External API docs in future specs, web checkout tax divergence is open, deploy only after merged main, seller payout copy must stay provider-neutral. |

### Current code evidence read

| Evidence | What it proves |
|---|---|
| `mingla-business/app.json:55-69,87-100` | Current branch has web asyncRoutes enabled, but Android intent filter remains host-only for all `https://business.usemingla.com` paths. |
| `mingla-business/vercel.json:9-49` | OG rewrites, bot social-preview rewrites, `/auth/callback`, `/home`, and final SPA fallback are all order-sensitive. |
| `mingla-business/public/auth/callback.html:167-223` | Static callback persists Supabase tokens into localStorage and redirects to `/home`. |
| `mingla-business/public/home.html` in mobile-home-tabs worktree, lines 430-532,541-624 | Static Home now includes five tabs and links to full Expo routes: `/event/create`, `/hub/events`, `/hub/experiences`, `/hub/trips`, `/ari`, `/marketing`, `/marketing/campaigns/compose`, `/account`, `/connect-account-management`. |
| `mingla-business/scripts/inject-mobile-blur-css.mjs:1-23` | Mobile web has a known compositor crash class from blur surfaces; post-export script injects blur-kill and signed-in preboot redirect. |
| `mingla-business/src/diagnostics/chunkReloadGuard.ts:1-16,43-55` | Async chunks are now load-bearing; app auto-reloads once for chunk fetch failures. |

## Priority Classes

- **P0 blocker:** Can break sign-in, route entry, or full-page boot on phone browsers.
- **P1 launch blocker:** Core business workflow can crash, be unusable, or lose data on web.
- **P2 parity blocker:** Important workflow works on native but has missing/untested web UX, degraded controls, or route-specific performance risk.
- **P3 hardening:** Already mitigated, but needs regression gates or proof before "full web complete."

## Phase 3 Inventory

| Priority | Route/component/function family | Risk class | Affected surfaces | Evidence | Required Phase 3 outcome | Recommended sub-ORCH |
|---|---|---|---|---|---|---|
| P0 | Static Home to full Expo deep-route handoff | Crash/load | Business Web phone browsers, signed-in Home, Hub, Ari, Blast, Account | ORCH-1085 implementation proves full signed-in `/home` OOMed Android Chrome until static `/home.html` bypassed Expo. Later `public/home.html` links every tab/action to full Expo routes: `/event/create`, `/hub/events`, `/ari`, `/marketing`, `/marketing/campaigns/compose`, `/account`, `/connect-account-management`. | Define which deep routes must be true full web, which stay lightweight shell, and which may intentionally degrade on phone browsers. Prove each chosen route on physical Android Chrome and mobile Safari. | **ORCH-1085-P3A Full-route phone-browser gate** |
| P0 | Auth/session restore and Android App Link capture | Auth/deep-link | Business Web Android Chrome, Google/Apple web OAuth, native app installed | Current `app.json:55-69` still has host-only Android App Link for all paths. Prior B2A forensics prove `/auth/callback` can be captured and web tokens dropped. Static callback now exists at `public/auth/callback.html:167-223`, but Android capture can prevent Chrome from reaching it. | Restrict Android App Links to approved paths, keep browser-only auth callbacks in browser, and add CI parity gate against AASA. Requires native config/build path, not OTA-only. | **ORCH-1085-P3B Auth and App-Link path parity** |
| P0 | OG/deep-link rewrites and SPA fallback | Routing/share | Public brand/event/trip pages, bot previews, human browser routes | `vercel.json:9-49` depends on ordered OG PNG rewrites, bot UA rewrites, static `/auth/callback`, static `/home`, then `/(.*)->/`. ORCH-1085 spec calls these hazards out before any output/routing change. | Prove bot previews and human routes still resolve after code splitting/static Home, including `/b`, `/e`, `/t`, `/exp`, checkout, Stripe return, and `/o/:orderId`. | **ORCH-1085-P3C Rewrite and public-route proof** |
| P1 | Cover picker and media upload | Native picker/web file parity | Event/trip/experience/brand cover authoring, account avatars, experience stop photos | `CoverPicker.tsx:39-51,352-390,474-516` imports `expo-image-picker` and `expo-file-system/legacy`; video trim has web split but raw image/video picker paths still run. `ExperienceStopPhotoSheet.tsx:45-49,265-281` imports/calls `ImagePicker` directly. `BrandAvatarPickerSheet.tsx:36-37,89-117` calls native picker/haptics without web branch. | Centralize web file input behavior, keep native modules out of boot-critical chunks, and prove device upload, GIF, Pexels, video fallback, avatar crop, and stop-photo multi-add on desktop and phone browsers. | **ORCH-1085-P3D Media picker web parity** |
| P1 | Experience generation file inputs | Native picker/file read | Creator wizards, experience/importer flows | `ActivitiesSnapInput.tsx:7-9,39-45,80-123` imports document picker, file-system, and image picker; reads with Expo FileSystem. `MenuSnapInput.tsx` follows same import pattern by search. | Add browser-safe `File`/`Blob` ingestion for activities/menu snap inputs and prove size/mime/error handling without native FileSystem dependency. | Fold into **P3D Media picker web parity** or separate **P3E Creator file ingestion** |
| P1 | Marketing Composer rich editor and schedule controls | Editor/date/web keyboard | `/marketing/campaigns/compose`, mobile browser Blast tab | Composer route imports `ComposerCanvas`, `ComposerV2Editor`, Tiptap web editor, keyboard shortcuts, and sheets. `richEditor.tsx` web imports Tiptap. `ComposerV2Editor.tsx` injects DOM CSS/selection handling. `SchedulePickerSheet.tsx:16-18,178-186` mounts `@react-native-community/datetimepicker` on web with no HTML input branch. Legacy `ComposerStepWhen.tsx:201-210` has same DateTimePicker-on-web pattern. | Make schedule date/time browser-native, prove rich-editor typing, chip insertion/deletion, templates, preview drawer, scheduling, and keyboard behavior on phone browser and desktop. | **ORCH-1085-P3F Marketing Composer web parity** |
| P1 | Date/time picker family beyond event/trip core | Date/time parity | Event wizard, ticket tiers, trips, venue hours, checkout intake, marketing scheduling | Some components already have web HTML inputs: `CreatorStep2When.tsx:161-198` and `TripCreatorStep1Basics.tsx:267-333`. Confirmed gaps: `BookingDeadlinePicker.tsx:247-263`, `PaymentPlanEditor.tsx:660-671`, `VenueStep4Hours.tsx:303-334`, `IntakeQuestionRenderers.tsx:487-533`, `SchedulePickerSheet.tsx:178-186`. | Replace or web-branch every native DateTimePicker route reachable in browser; add source gates and route-level tests. | **ORCH-1085-P3G Date-time web controls** |
| P1 | Stripe Connect, tax, payout settings, Paystack-neutral seller copy | External integration/web session | Account tab, brand payments, Connect onboarding, account management, tax registrations, partner onboarding | Connect routes lazy-load web SDK bodies: `app/connect-onboarding.web.tsx:1-26`, `StripeConnectPages.web.tsx:1-15`, `ConnectOnboardingBody.web.tsx:25-32,66-98,205-230`. Brand payments opens web sessions via `BrandPaymentsView.tsx:193-210`; tax hook opens `connect-tax-registrations` using public base URL at `useBrandStripeTaxAccountSession.ts:9-31`. Static home still says "Stripe account" at `public/home.html` mobile-home-tabs lines 526-529, which conflicts with COMMS-0021 neutral seller copy. | Prove seller payout/account/tax flows in browser and native-to-web session, preserve lazy SDK import, and rebase copy to provider-neutral "Connect bank" language. Specs must cite Stripe docs per COMMS-0003. | **ORCH-1085-P3H Seller payouts and Stripe web sessions** |
| P1 | Buyer/anonymous checkout and tax divergence | Money/web checkout | `/checkout/*`, `/checkout-trip/*`, `/checkout-experience/*`, `/o/:orderId`, ticket QR confirmation | COMMS-0013 registers web buyer checkout tax divergence. Checkout routes still have browser-specific keyboard listeners by search (`app/checkout*/buyer.tsx`, `payment.tsx`, intake). `TicketQrCarousel.tsx:67-79` documents that client-side SVG QR failed on web and server PNG is required. | Decide whether business "full web" includes buyer checkout. If yes, fix/accept tax divergence, prove payment, intake, QR, confirm, order preview, and cancel paths on phone browsers. | **ORCH-1085-P3I Buyer checkout web parity** |
| P1 | QR/share/public link family | Share/QR/web APIs | Hub share buttons, public event/brand/trip/experience pages, checkout QR | `ShareModal.tsx:30-34` lazy-loads `react-native-qrcode-svg`; `sharePublicUrl.ts:66-98` uses `navigator.clipboard` and `navigator.share` on web; `TicketQrCarousel.tsx:67-79` documents prior web QR SVG failure and server-PNG solution. | Prove clipboard/share fallbacks, lazy QR chunk, public share URLs, and server-rendered QR behavior on Chrome/Safari phone browsers. | Fold into **P3C Rewrite/public-route proof** plus **P3I Checkout web parity** |
| P1 | Scanner/door operations | Camera/native module | `/event/[id]/scanner`, event operations web | `app/event/[id]/scanner/index.tsx:36-41,205-206` imports `expo-camera` and calls `useCameraPermissions`; no web-specific camera/no-op branch in the route evidence read. | Decide browser contract: real web camera scanner, manual check-in fallback, or explicit unsupported state. Prove no crash when opened in web. | **ORCH-1085-P3J Door ops web contract** |
| P1 | Native SDK and native module quarantine | Crash/build | All business web routes | Web shims exist for AppsFlyer, Mixpanel, OneSignal, RevenueCat (`*.web.ts` files). Root layout imports services and `KeyboardRoot`; prior ORCH-1085 added shims for Reanimated/lucide/lottie/video compressor per report. Remaining direct web-reachable native imports include `GroupChatPanel.tsx:16-18` importing `react-native-keyboard-controller` and `expo-image-picker`. | Add automated source/bundle gates that fail if forbidden native-only modules enter web chunks, especially route chunks after async routes. | **ORCH-1085-P3K Native-module quarantine CI** |
| P2 | Ari full assistant | Phone-browser UX/perf | `/ari`, static Home Ari tab | Static Home Ari panel links to `/ari`. `AriChatScreen.tsx:70-83` manually listens for RN keyboard events and controls input padding; route also loads chat hooks, drawer, streaming, quick replies, disclosure modal. | Prove Ari in phone browsers for initial empty state, typing, streaming, tool proposals, drawer, settings, and keyboard overlap; or define lightweight Ari browser contract. | **ORCH-1085-P3L Ari browser parity** |
| P2 | Hub list/detail routes | Deep-route performance and share parity | `/hub/events`, `/hub/experiences`, `/hub/trips`, event/trip/experience details | Static Home links Hub directly into these routes. Hub index redirects to events at `app/(tabs)/hub/index.tsx:1-17`. Hub route search shows ShareModal mounts in events/experiences/trips and detail pages. | Prove list load, filters, share modals, cards, manage menus, and detail navigation on phone browsers without OOM. | **ORCH-1085-P3M Hub browser parity** |
| P2 | Creator wizards | Form/map/media/date/sheet parity | `/event/create`, trip/experience/venue creator routes, edit routes | Static Home primary CTA links `/event/create`. Creator route families combine CoverPicker, DateTimePicker, MapboxAddressInput, Sheet, media uploads, and validation. Event/trip core dates have web input branches, but related deadline/payment/venue/intake gaps remain. | End-to-end browser proof for create/edit event, trip, experience, and venue wizards; either fix or explicitly exclude unsupported native-only steps. | **ORCH-1085-P3N Creator wizard web completion** |
| P2 | Mapbox/location inputs | Web UX/integration | Event where step, brand creation, venue address, trip departure/destination, experience stop cards | Business wrapper injects shared Mapbox input at `MapboxAddressInput.tsx:1-24,115-143`; shared package owns debounce/suggest/retrieve states at `packages/location-input/src/MapboxAddressInput.tsx:15-28,185-236`. Used by `CreatorStep3Where`, `VenueStep1Address`, `BrandCreationFlow`, `TripCreatorStep1Basics`, and `ExperienceStopCard` by search. | Prove phone-browser keyboard, suggestion list placement, pick/retry/offline states, and Mapbox edge function behavior across all creator contexts. | Fold into **P3N Creator wizard web completion** |
| P2 | Modals/sheets/overlays | Prior crash/UX overlap | All browser routes using `Sheet`, ShareModal, editor drawers, onboarding sheets, intake sheets, group chat moderation | `Sheet.tsx:1-20` and `Sheet.web.tsx:18-22,70-81,102-110` document a previous mobile-web recursive Sheet OOM and current neutral `SheetMobile` fix. ShareModal dynamically sizes sheet to avoid QR clipping (`ShareModal.tsx:116-131`). | Build route-family overlay QA: nested sheets, scrim, keyboard, reduced motion, scroll lock, viewport height, and sub-sheet invariant across desktop and mobile browsers. | **ORCH-1085-P3O Overlay and sheet browser QA** |
| P2 | Group chat and image attachments | Native keyboard/image picker | Event group chat routes/panels | `GroupChatPanel.tsx:12-18,74-98` imports `react-native-keyboard-controller` and `expo-image-picker`; web shims do not apply if this route chunk imports the library directly. | Either make group chat web-safe or gate it as unsupported on business web; prove attachment and composer behavior. | Fold into **P3K Native quarantine** plus **P3M Hub/detail parity** |
| P2 | Auth/session restore after static Home | Session/cache | `/`, `/home`, `/account`, brand/currentBrand restore | Static callback writes Supabase token to localStorage and `/home.html` reads the same storage key for email. Root layout still gates splash/auth/brand recovery (`app/_layout.tsx:119-148`). | Prove cold start after OAuth, refresh token, expired token, sign-out, localStorage blocked/private mode, and switching from static Home to Expo routes. | Fold into **P3B Auth and App-Link path parity** |
| P3 | Blur-kill and glass performance | Mobile compositor | Public and signed-in mobile browser routes | `inject-mobile-blur-css.mjs:1-23` documents previous phone-browser crash from stacked `backdrop-filter`; script injects before app JS. ORCH-1083 says output-mode changes must preserve this. | Add deploy/build proof that every served HTML route has blur-kill before JS, and screenshot/canvas proof that visual quality remains acceptable. | Fold into **P3C Rewrite/public-route proof** |
| P3 | Async chunk recovery | Resilience | All code-split routes | `chunkReloadGuard.ts:1-16,43-55` reloads once on chunk load failure; now load-bearing because async routes produce route chunks. | Add deterministic chunk-miss test and verify stale-index/CDN failure recovers once without loops. | Fold into **P3K Native-module quarantine CI** or **P3C Rewrite proof** |

## Suggested Sub-ORCH Slicing

### Wave 1 - Cannot call web complete without these

1. **ORCH-1085-P3A Full-route phone-browser gate**
   - Goal: map every static Home link to either lightweight static shell, full Expo route with runtime proof, or explicit unsupported browser contract.
   - Hard proof: physical Android Chrome and mobile Safari smoke for `/event/create`, `/hub/events`, `/ari`, `/marketing`, `/marketing/campaigns/compose`, `/account`, `/connect-account-management`.

2. **ORCH-1085-P3B Auth and App-Link path parity**
   - Goal: stop Android from capturing `/auth/callback`, preserve intended public/Stripe App Links, and prove browser OAuth when the native app is installed.
   - Note: native config/build path likely required; OTA alone is not enough.

3. **ORCH-1085-P3D Media picker web parity**
   - Goal: create web-safe file picker/upload contract across cover picker, experience stop photos, avatar, activities/menu snaps, intake file upload, and group chat attachments.

4. **ORCH-1085-P3G Date-time web controls**
   - Goal: replace scattered native DateTimePicker-on-web paths with browser-native controls and tests.

5. **ORCH-1085-P3F Marketing Composer web parity**
   - Goal: prove rich editor, schedule picker, keyboard, preview, template, audience, and send/review flows.

### Wave 2 - Core business functionality

6. **ORCH-1085-P3H Seller payouts and Stripe web sessions**
   - Goal: prove Connect onboarding/account management/tax registrations and copy neutrality.
   - Hard constraint: invoke `stripe-best-practices` and cite Stripe docs in any implementation spec per COMMS-0003.

7. **ORCH-1085-P3N Creator wizard web completion**
   - Goal: event/trip/experience/venue create/edit flows across forms, Mapbox, cover, dates, sheets, validation, publish guards.

8. **ORCH-1085-P3M Hub browser parity**
   - Goal: Hub lists/details, share, manage menus, route redirects, data states, and phone-browser load.

9. **ORCH-1085-P3L Ari browser parity**
   - Goal: mobile browser assistant contract, streaming/chat/drawer/settings/tool proposal UX.

### Wave 3 - Operations, public/buyer, and hardening

10. **ORCH-1085-P3I Buyer checkout web parity**
    - Goal: decide and resolve buyer/anonymous checkout, tax divergence, intake, QR, confirmation, and order routes.

11. **ORCH-1085-P3J Door ops web contract**
    - Goal: camera scanner browser path or explicit manual fallback/unsupported copy.

12. **ORCH-1085-P3C Rewrite and public-route proof**
    - Goal: OG/social preview, bot rewrites, static callback/home rewrites, SPA fallback, blur-kill, public route human loads.

13. **ORCH-1085-P3K Native-module quarantine CI**
    - Goal: keep native-only SDKs out of web entry and route chunks; fail on `react-native-keyboard-controller`, `expo-camera`, native Stripe, native video trim, native compressor, etc. unless platform-split/gated.

14. **ORCH-1085-P3O Overlay and sheet browser QA**
    - Goal: nested sheets/modals across desktop/narrow web with keyboard/viewport/reduced-motion proof.

## Explicit Non-Evidence / Do Not Rely On

- The dirty anchor checkout has untracked files such as `BrandCoverPickerSheet.tsx`, `VenueStep3Photos.tsx`, and new provider services. I did not treat those as merged/current evidence for this report because the anchor is dirty and behind, and the clean ORCH-1085 worktrees do not contain them.
- I did not run browser runtime tests in this inventory pass. Runtime claims here come only from prior ORCH-1083/1085 reports; new findings are source-evidence based unless marked as prior runtime proof.
- This report is not an implementation spec. Each sub-ORCH still needs a scoped forensic/spec pass with repo-running regression tests named before implementation.

## Launch Readiness Conclusion

Business web is no longer just a monolithic boot problem, but it is not complete. Static `/home` is a protective entry shell; the actual product still depends on many full Expo/RN-web deep routes with native picker, native camera, DateTimePicker, keyboard-controller, Stripe web-session, Mapbox, rich-editor, sheet, QR/share, and checkout/tax behaviors that need web-specific fixes or proof.

The Phase 3 completion bar should be: no static Home link leads to an unproven or crash-prone browser route; no web-reachable route imports native-only modules without a web-safe split; core create/manage/market/pay/assist/share/checkout flows either work in phone browsers or have an explicit launch-approved degraded contract.
