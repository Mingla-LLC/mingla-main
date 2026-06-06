# INVESTIGATION - ORCH-1092 Business Web Restoration Wave

Date: 2026-06-06
Mode: Forensics investigate-then-spec
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1092-[business-web-restoration-wave]`
Branch: `ORCH-1092-business-web-restoration-wave`
Scope: Business Web phone-browser handoffs from static Home into Hub, Account/Payouts, and Marketing Composer shell.

## Executive Result

Static Home is still doing its protective job: only Create is reopened, and Hub, Marketing, Account, and payout actions still stay on hash shells. The next restoration wave can be larger than one-off Create patches, but it must reopen routes in a gated order:

1. Reopen **Account settings** to the real Account tab after phone Chrome/Safari boot proof.
2. Reopen **Hub Events** as the first Hub route; keep Hub Experiences and any group-chat/detail native attachment surfaces gated until native-import quarantine is in place.
3. Reopen **Marketing overview** and a **Marketing Composer shell** only after replacing web DateTimePicker scheduling with browser-native controls and proving editor boot/typing.
4. Keep **Payout account** static-shell unless the action is changed to generate a secure account-management session first; do not link static Home directly to `/connect-account-management`.

This is not a scratch web rebuild. Expo Web remains the runtime, ORCH-1091 cache guards stay intact, and provider-neutral seller/payout copy remains mandatory.

## Comms Ledger Acknowledgement

Active ALL warnings factored:

- COMMS-0003: Stripe/provider specs must cite canonical provider docs if they introduce or modify provider parameters, enums, payloads, or endpoints.
- COMMS-0015 and COMMS-0018: deploy only from merged `main`; no worktree deploy, OTA, merge, reap, or orphaned provider/backend deploy.
- COMMS-0021: seller and payout copy must stay provider-neutral (`Connect bank`, `Payments & Bank`, `Payout account`) even when Stripe identifiers remain internal.
- Stale-main warning from COMMS-0020 was factored: source conclusions are from this ORCH-1092 worktree and prior merged/close artifacts, not the dirty anchor checkout.

## Evidence Read

Prior artifacts:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/reports/CLOSE_ORCH-1087_BUSINESS_WEB_STATIC_ROUTE_FIREWALL.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1087_BUSINESS_WEB_STATIC_ROUTE_FIREWALL.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
- `Mingla_Artifacts/reports/QA_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
- `Mingla_Artifacts/reports/CLOSE_ORCH-1091_BUSINESS_WEB_MOBILE_CACHE_INVALIDATION.md`
- `Mingla_Artifacts/AGENT_HANDOFFS.md`

Current source read:

- `mingla-business/public/home.html`
- `mingla-business/vercel.json`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/scripts/ci/orch-1085-mobile-web-signin-home.mjs`
- `mingla-business/scripts/ci/orch-1087-static-route-firewall.mjs`
- `mingla-business/scripts/ci/orch-1088-event-creator-phone-parity.mjs`
- `mingla-business/scripts/ci/orch-1089-signedin-event-creator-wizard.mjs`
- `mingla-business/app/(tabs)/hub/index.tsx`
- `mingla-business/app/(tabs)/hub/events.tsx`
- `mingla-business/app/(tabs)/hub/experiences.tsx`
- `mingla-business/app/(tabs)/hub/trips.tsx`
- `mingla-business/app/(tabs)/account.tsx`
- `mingla-business/app/connect-account-management.tsx`
- `mingla-business/app/connect-account-management.web.tsx`
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- `mingla-business/src/utils/brandPayout.ts`
- `mingla-business/src/components/stripe/connect-pages/StripeConnectPages.web.tsx`
- `mingla-business/src/components/stripe/connect-pages/ConnectAccountManagementBody.web.tsx`
- `mingla-business/app/(tabs)/marketing/index.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/src/components/marketing/ComposerV2/SchedulePickerSheet.tsx`
- `mingla-business/src/components/marketing/ComposerStepWhen.tsx`
- `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx`
- `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx`
- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/components/groupChat/GroupChatPanel.tsx`

## Current Route Truth

Static Home:

- `public/home.html:461` reopens only Create with ORCH-1088 and ORCH-1089 markers.
- `public/home.html:482-496` keeps Hub Events, Experiences, and Trips as hash shells.
- `public/home.html:528-535` keeps Marketing overview and Compose blast as hash shells.
- `public/home.html:549-556` keeps Account settings and Payout account as hash shells.
- `public/home.html:556-559` uses provider-neutral `Payout account` copy.

Cache/deploy safety:

- `vercel.json` still rewrites `/home` to `/home.html` before the SPA catch-all.
- `vercel.json` still gives `/_expo/static/js/web/*` `Cache-Control: public, max-age=0, must-revalidate`, preserving ORCH-1091's stale-entry fix.
- `scripts/inject-mobile-blur-css.mjs` still injects mobile chunk recovery, static Home preboot, blur-kill CSS, and `?v=orch1091` on eager Expo web JS.

## Findings

### F-1 - Confirmed gate: non-Create static Home links are still closed

Classification: confirmed current behavior / safety gate.

Evidence: `public/home.html:482-556` uses hash-shell links for Hub, Marketing, Account, and payout actions. ORCH-1087/1088/1089 guards also reject forbidden non-Create direct Home hrefs.

Impact: The current user path is safe but incomplete. Reopening is an implementation task, not a current shipped fact.

Fix direction: Add ORCH-1092 explicit reopen markers and update the existing CI guards so each reopened link is allowed only when its route-family proof exists.

### F-2 - Account tab is the best first reopen candidate, but payout management is not a direct static link

Classification: confirmed route contract gap.

Evidence: `app/(tabs)/account.tsx` is mostly account/brand/settings rows and partner rows. `BrandPaymentsView.tsx:442-474` generates account-management through `useBrandStripeAccountSession()` and `WebBrowser.openAuthSessionAsync`, while `connect-account-management.web.tsx` requires a `session` param and lazy-loads the Stripe body. Directly opening `/connect-account-management` from static Home would render an invalid management link rather than a usable payout tool.

User impact: Static Home can probably reopen Account settings with bounded proof, but reopening Payout account as a direct route would create a broken payments experience.

Fix direction: Reopen `/account` first. Keep Payout account shell, or change it to a generated-session handoff from a real authenticated app route/button. If the session path is touched, require Stripe docs evidence for Account Sessions and account-management embedded components.

### F-3 - Hub Events can be reopened before the full Hub family; Experiences has native file-picker imports

Classification: likely route-family blocker.

Evidence: Hub Events/Trips mount list, filters, share modal, and manage sheet surfaces. Hub Experiences imports `ActivitiesSnapInput` and `MenuSnapInput`; those import `expo-file-system/legacy` and `expo-image-picker`. The Phase 3 inventory already identified this family as a native picker/file-ingestion risk.

User impact: Reopening every Hub subroute at once would risk repeating the route-wide native-module crash pattern. Events is lower risk than Experiences because Experiences pulls AI snap/file input surfaces.

Fix direction: Reopen `/hub/events` first with phone-browser proof. Keep `/hub/experiences` and `/hub/trips` closed unless the implementor adds route-level native import quarantine plus phone proof for list, share, manage sheet, and detail navigation.

### F-4 - Marketing Composer shell needs a web scheduling fix before Home relink

Classification: confirmed web-control bug / likely route blocker.

Evidence: `SchedulePickerSheet.tsx` imports `@react-native-community/datetimepicker` and renders `<DateTimePicker>` unconditionally. The legacy `ComposerStepWhen.tsx` has the same pattern. The rich editor is already web-split through Tiptap in `richEditor.tsx`, which is good, but scheduling still uses a native picker path in a phone-browser route.

User impact: A phone-browser organiser could boot the composer and then hit unsupported scheduling UI, or the native picker module could enter a web chunk unexpectedly.

Fix direction: Define ORCH-1092 Marketing Composer as a shell-plus-core-editing reopen: overview loads, compose route boots, audience/template hydration is bounded, subject/body typing works, preview/review shells render, and scheduling uses browser-native date/time controls on web. Full send parity can remain a later gate unless proven in this wave.

### F-5 - Native-module quarantine is the missing automated regression guard for this route-family wave

Classification: production-hardening gap.

Evidence: Current source search found direct risky imports in web-reachable families:

- `ActivitiesSnapInput.tsx` and `MenuSnapInput.tsx`: `expo-file-system/legacy`, `expo-image-picker`
- `GroupChatPanel.tsx`: `react-native-keyboard-controller`, `expo-image-picker`
- `SchedulePickerSheet.tsx` and `ComposerStepWhen.tsx`: `@react-native-community/datetimepicker`
- `ShareModal.tsx`: QR code renderer is already lazy-loaded, which is the desired pattern.

Impact: Without a route-family source/bundle gate, a future patch can reintroduce a native-only module into a reopened phone-browser route and crash before recovery UI renders.

Fix direction: Add an ORCH-1092 CI guard that scans static Home, source imports, and exported route chunks for forbidden web-route modules unless they are platform-split, lazy-loaded behind a proven interaction, or explicitly allowed with a reason.

### F-6 - Verification limitation: local full ORCH-1089 chain stopped at missing Jest preset

Classification: verification limitation.

Evidence: `npm run test:orch-1089` passed `test:orch-1085`, `test:orch-1087`, and the ORCH-1088 source guard, then failed at Jest startup with `Preset ts-jest not found relative to rootDir .../mingla-business`.

Impact: This worktree could not produce a full green test-chain receipt without dependency repair. It does not disprove ORCH-1089 because close/QA artifacts already recorded green runs on the implementation worktree, and Seth later confirmed real Create opens in Chrome/Safari after ORCH-1091.

Fix direction: Implementor/tester must run the full ORCH-1092 chain after dependency installation or lockfile repair. The spec should not accept a partial source-guard-only pass.

## Answers To Dispatch Questions

1. Which static Home handoffs can be reopened in this wave without a stripped-down replacement?
   - Account settings and Hub Events are the strongest candidates.
   - Marketing overview plus Composer shell can reopen if schedule controls and route guardrails are fixed.
   - Payout account should not be a direct sessionless route; it needs generated-session handling or remains shelled.

2. Which routes already boot on phone Chrome/Safari after ORCH-1091?
   - Proven by prior close/user smoke: static Home and signed-in Create route-open gate.
   - Not proven in this investigation: Hub, Account, payout management, Marketing overview, or Composer on real phone Chrome/Safari.

3. Which routes fail or are at risk?
   - At risk from native modules: Hub Experiences, event group chat/detail paths, Marketing scheduling.
   - At risk from invalid direct route: `/connect-account-management` without session query params.
   - At risk from route payload/overlays: Hub detail share/manage sheets and Composer editor drawers.

4. Which native-only features need degraded web copy?
   - Experience snap/menu file ingestion can stay unavailable or desktop/app-only until file-input parity lands.
   - Group chat image attachment can stay unavailable on business web until keyboard/image-picker quarantine lands.
   - Payout account direct static link needs copy explaining generated secure session if not reopened.

5. What implementation chunks restore the most value with least churn?
   - ORCH-1092 guard extension first.
   - Account route boot and Home Account relink.
   - Hub Events route boot and Home Events relink.
   - Marketing overview and composer shell with web-native scheduling.
   - Payout generated-session proof from authenticated app, not direct static Home.

6. What automated regression guard catches the route-family pattern?
   - `test:orch-1092` should compose prior ORCH-1085/1087/1088/1089/1091 guards, assert explicit Home reopen markers, reject unmarked direct hrefs, scan forbidden imports in reopened route families, and inspect exported route chunks for native-only module strings and ORCH-1091 cache markers.

7. What manual Chrome/Safari proof is mandatory?
   - Phone Chrome and Safari must open each newly relinked Home action, reach a useful first screen, survive refresh/back/re-entry, exercise one core interaction, and show no blank screen, infinite spinner, stale chunk loop, or native-module page error.

## Cross-Surface Impact

Touched in future implementation:

- Business Web phone browsers.
- Business Web desktop only as a compatibility surface for the same Expo Web routes.

Not in scope:

- Consumer iOS/Android.
- Business native iOS/Android feature behavior.
- Admin Web.
- Buyer checkout.
- Scanner/door ops.
- Full Event Creator internals beyond preserving ORCH-1089 Create.
- Supabase migrations/RLS/edge functions.
- Provider/backend mutations.

## Readiness Conclusion

ORCH-1092 is ready for a bounded implementation spec. It is not ready for immediate product-code reopen of every static Home action. The spec must require route-by-route proof before relinking, preserve ORCH-1091 cache guards, and keep payout/provider copy neutral.
