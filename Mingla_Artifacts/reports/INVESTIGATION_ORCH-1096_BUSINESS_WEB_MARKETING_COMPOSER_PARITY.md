# Investigation Report: Business Web Marketing Composer Parity (ORCH-1096)

> Date: 2026-06-07
> Source: Orchestrator dispatch
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]`
> Branch: `ORCH-1096-business-web-marketing-composer-parity`
> Registration commit: `3d85be25c`
> Confidence: High for source/export/current route behavior; Medium for physical iPhone Safari until implementation QA runs it.
> Status: Root cause proven; implementation spec ready.

## 1. Layman Summary

The phone-browser campaign compose route is reachable, but it is not the real Marketing Composer. ORCH-1095 kept the real URL and avoided the Android Chrome OOM by rendering a tiny pre-Expo "Compose blast" shell with only Subject and Message fields; it does not load the actual composer workflow with audience selection, templates, event chips, preview, draft restore, schedule review, or send/schedule validation.

The real composer still exists in the app and desktop web can load the Expo route, but phone browsers are deliberately intercepted before Expo scripts load. ORCH-1096 should not build a fake form. It should graduate only `/marketing/campaigns/compose` from the ORCH-1095 lightweight shell to a real, browser-safe composer path while preserving the ORCH-1091/1093/1094/1095 route/cache/OOM protections for every other route.

## 2. Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before source investigation. Relevant OPEN WARN rows factored:

- COMMS-0003: this ORCH must not introduce or modify external provider/API contracts unless the SPEC cites canonical docs inline. Current fix direction avoids provider/API changes.
- COMMS-0004, COMMS-0011, COMMS-0019: no ORCH-ID/intake renumbering applies; no new ID claimed.
- COMMS-0012, COMMS-0015, COMMS-0018: no deploy, OTA, merge, reap, backend deploy, or source-from-worktree release. Any later release must come from merged `main`.
- COMMS-0013, COMMS-0016: checkout/tax/experience constraints are out of scope.
- COMMS-0021: preserve provider-neutral seller/payout copy; this ORCH should not touch payout copy.

I did not commit an anchor-ledger acknowledgement because the anchor checkout was dirty and behind `origin/main`; after one failed mechanical ack edit, `COMMS_LEDGER.md` was restored from Git immediately and left intact. The report/spec carry the factored constraints instead.

## 3. Scope

- **Feature / issue:** Business web Marketing Composer parity at `/marketing/campaigns/compose`.
- **Actor:** Signed-in business user using phone browser or desktop browser.
- **Environment:** Mingla Business web export, Expo Router async web routes, static `/home`, ORCH-1095 pre-Expo route deferral.
- **Success definition:** Phone and desktop browsers can use the real composer workflow: audience, subject/body rich editor, personalization/event chips, template drawer, preview, draft/re-entry/refresh, schedule picker, review, validation, and send/schedule mutation path.
- **Assumptions:** Backend marketing tables/RLS and `marketing-send` are already the canonical data contract; no Supabase/provider contract changes are needed.
- **Out of scope:** Hub Events, Hub Trips, Account, Ari, Hub Experiences, payout account management, buyer checkout/tax, backend migrations, provider API changes, deploy/OTA/merge/reap.

## 4. Intended Journey

`Static Home Blast link or direct /marketing/campaigns/compose -> signed-in phone/browser route entry -> real composer UI -> pick/resolve audience -> type subject/body in rich editor -> insert personalization/event chips or apply template -> preview -> save draft or schedule/send -> marketing_campaigns row created/updated/scheduled -> user sees review/confirmation or actionable error`

Expected failure behavior: signed-out recovery at the same URL, stale/expired session recovery, current-brand missing/error state, audience/template/draft loading errors as visible toasts/banners, no infinite spinner beyond 8 seconds, no route OOM, no native-module crash, and no silent draft/schedule failure.

## 5. Historical Context

Read and factored:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md` P3F: identified Marketing Composer as P1 web parity gap requiring rich editor, schedule picker, keyboard, preview, templates, audience, and send/review proof.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1095_BUSINESS_WEB_INTERACTIVE_PARITY_WAVE.md`: proved ORCH-1094 static redirects prevented interactivity and targeted compose as one of five routes.
- `Mingla_Artifacts/specs/SPEC_ORCH-1095_BUSINESS_WEB_INTERACTIVE_PARITY_WAVE.md`: allowed compose route chunk budget up to 600 KB but required Android/iPhone proof.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1095_BUSINESS_WEB_INTERACTIVE_PARITY_WAVE.md`: first full-route promotion still OOMed Android Chrome; rework introduced pre-Expo lightweight route entries.
- `Mingla_Artifacts/reports/QA_ORCH-1095_BUSINESS_WEB_INTERACTIVE_PARITY_WAVE_REWORK.md`: PASS verified real URL/lightweight route, not full composer workflow; iPhone Safari was not run.
- ORCH-1091/1093/1094 guards and close notes: preserve JS cache revalidation, chunk recovery, blocked routes, static Home, and OOM fail-closed posture.

## 6. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `COMMS_LEDGER.md` | Process | Required entry ledger and cross-ORCH constraints. |
| 2 | ORCH-1085 P3 inventory | Historical | P3F composer web parity baseline. |
| 3 | ORCH-1095 investigation/spec/implementation/QA | Historical/runtime | Prove current route shell handoff and OOM history. |
| 4 | `mingla-business/scripts/inject-mobile-blur-css.mjs` | Preboot/runtime | Actual phone-browser route interception and lightweight composer shell. |
| 5 | `mingla-business/app/_layout.tsx` | Route/auth | Root route status and blocked/signed-out recovery. |
| 6 | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | Route/component | Real composer workflow, draft/schedule/review state. |
| 7 | `ComposerCanvas(.web).tsx` | Layout | Desktop split preview and mobile passthrough behavior. |
| 8 | `ComposerV2Editor.tsx` | Editor | Subject/body, toolbar, chips, templates, keyboard sizing. |
| 9 | `richEditor.tsx` / `richEditor.native.ts` | Native/web boundary | Tiptap web-only vs pell native quarantine. |
| 10 | `SchedulePickerSheet.tsx` / `.native.tsx` | Date/time | Web hidden HTML inputs vs native DateTimePicker split. |
| 11 | Campaign hooks/services | Data/cache | Draft, audience, templates, schedule mutation, invalidation. |
| 12 | Marketing migrations and `marketing-send` | Schema/backend | RLS and send/schedule data contract; prove no new backend change needed. |
| 13 | ORCH-1095 CI/Jest guard | Tests | Current guard passes while stripped compose shell remains. |
| 14 | `vercel.json` | Deploy/routing | Static `/home`, callback, SPA fallback, JS cache header. |

## 7. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs/history | Full web completion still needs P3F Marketing Composer parity. ORCH-1095 route proof was lightweight shell only. | ORCH-1085 P3F; ORCH-1095 implementation/QA. | Yes. |
| Schema/RLS | Marketing audiences/templates/campaigns exist with authenticated RLS; schedule updates are PostgREST updates; send edge function claims scheduled campaigns. | `20260602000003...` lines 72-129, 134-190, 195-266; `marketingCampaignService.ts`; `marketing-send/index.ts`. | Yes. |
| Code | Real composer route imports full V2 editor, audience picker, schedule picker, review, sent confirmation, templates, event chips, preview, draft hooks. | `compose.tsx` lines 62-111, 185-332, 377-412, 603-815. | Yes, but not phone-reachable. |
| Runtime/tests | `npm run test:orch-1095` passes; fresh export/guard passes. Playwright mobile route shows `expoScripts=0` and lightweight recovery at `/marketing/campaigns/compose`. | Commands run 2026-06-07 in ORCH-1096 worktree. | Contradiction: tests pass while full composer is absent on phone. |
| Data/cache | Preboot lightweight route reads stored Supabase auth and fetches brands/campaigns directly. Real composer uses React Query/Supabase client hooks after Expo boot. | `inject-mobile-blur-css.mjs` route loader; `marketingCampaignService.ts`; `useScheduleCampaign.ts`. | Split ownership creates parity gap. |

**Contradictions:** Current route status labels compose `"interactive"`, but phone browsers do not load the actual interactive composer. The current CI guard treats pre-Expo lightweight subject/body shell as success.

## 8. Findings

### F-1: Phone browsers reach a lightweight compose shell, not the real composer

- **Severity:** P1 launch blocker for business web completion.
- **Type:** confirmed bug / UX gap.
- **Confidence:** proven.
- **Broken journey step:** Route entry and first interactive screen.
- **Evidence:** `inject-mobile-blur-css.mjs` line 53 builds `isLightRoute`; line 54 includes `/marketing/campaigns/compose`; the route's `renderRoute` branch emits hand-authored Subject input, Message textarea, and "Return to marketing" button only. Playwright Pixel 5 probe against fresh export returned `light=true`, `expoScripts=0`.
- **Current behavior:** Signed-in phone users with valid session get the ORCH-1095 lightweight shell; unsigned users get lightweight signed-out recovery. The real Expo composer never loads on phone browsers.
- **Expected behavior:** Signed-in phone browser should use real composer controls or a purpose-built browser composer adapter that covers the same workflow.
- **Causal chain:** ORCH-1095 full-route promotion loaded the 2.9 MB common signed-in boot and OOMed Android Chrome -> implementation moved target routes to pre-Expo lightweight render -> compose stayed at real URL but lost workflow parity.
- **User impact:** A business user cannot select an audience, insert event/personalization chips, apply templates, preview, restore drafts, save real drafts, schedule, review, or send from phone browser.
- **Fix direction:** Replace only the compose branch of the lightweight route with a real, bounded browser composer path. Do not remove the lightweight strategy for other ORCH-1095 routes.
- **Missing test or guardrail:** Add ORCH-1096 test that fails while compose preboot contains only the stripped Subject/Message shell or "Return to marketing" as the only action.

### F-2: The real composer is feature-rich but too heavy to load through current phone Expo boot

- **Severity:** P1 production-hardening gap.
- **Type:** confirmed bug class / OOM risk.
- **Confidence:** proven for boot-size risk; physical OOM inherited from ORCH-1095 evidence.
- **Evidence:** Fresh export in ORCH-1096 reports `phoneBoot=2885080`, `__common=1882297`, and route chunk `/marketing/campaigns/compose` `570122` bytes. ORCH-1095 implementation proved direct full Expo promotion still crashed Samsung A72 Chrome with V8 OOM.
- **Current behavior:** Desktop can load Expo scripts; phone route bypasses them.
- **Expected behavior:** Phone composer must avoid loading the OOM-causing root/common boot while still delivering the real workflow.
- **Fix direction:** Implement a composer-specific browser entry/adapter with staged lazy loading of editor-heavy modules, or a route-specific preboot mini-app that owns the full composer workflow and data writes. A simple status flip to load Expo is not acceptable.
- **Missing test or guardrail:** Export-aware guard must assert phone composer entry avoids full root/common boot and has an explicit route budget accepted by physical Android/iPhone proof.

### F-3: Rich editor native/web boundaries are mostly correct but load-bearing

- **Severity:** P1.
- **Type:** production-hardening gap.
- **Confidence:** high.
- **Evidence:** `richEditor.tsx` imports `@tiptap/react`, StarterKit, Link, Underline, and chip nodes; comments enforce SSR safety and no `window`/`document` at module load. `richEditor.native.ts` re-exports `react-native-pell-rich-editor` and explains the prior web crash from pell's module-load `window` access.
- **Current behavior:** Web rich editor is Tiptap-only; native is pell-only.
- **Expected behavior:** ORCH-1096 must keep Tiptap out of native and pell/native WebView out of web/phone preboot.
- **Fix direction:** Preserve platform split; add ORCH-1096 guard that web composer entry/chunk does not include `react-native-pell-rich-editor`, `react-native-webview`, or native DateTimePicker, and native chunk does not import `@tiptap/*`.
- **Missing test or guardrail:** Extend ORCH-1095 native/provider token guard for composer-specific entry chunks.

### F-4: Schedule picker web split exists, but ORCH-1096 must prove real schedule workflow

- **Severity:** P1.
- **Type:** likely bug / unproven workflow.
- **Confidence:** high.
- **Evidence:** Web `SchedulePickerSheet.tsx` uses hidden `<input type="date">` and `<input type="time">` and does not import `@react-native-community/datetimepicker`; native sibling imports DateTimePicker. Current ORCH-1095 guard only checks this source split, not route interaction.
- **Current behavior:** Source is browser-safe, but phone composer shell does not expose schedule controls.
- **Expected behavior:** Phone browser can open schedule UI, choose date/time, continue to review, and schedule mutation receives valid ISO.
- **Fix direction:** Carry the web schedule picker into the browser composer path and add Playwright interaction coverage.

### F-5: Send-now label is misleading relative to implementation

- **Severity:** P2 product/UX gap.
- **Type:** likely bug.
- **Confidence:** source-proven.
- **Evidence:** `compose.tsx` imports only `useScheduleCampaign`; `useSendNow.ts` exists but is unused. `handleConfirmSchedule` sets `scheduled_for` to `new Date().toISOString()` for send-now and calls `scheduleMutation.mutate`; route comments say cron picks up send-now.
- **Current behavior:** "Send now" schedules for immediate cron pickup, not direct `marketing-send` invocation.
- **Expected behavior:** Either copy should honestly say "send now" as queued immediate dispatch with confirmation copy, or implementation should intentionally wire `useSendNow` after schedule succeeds. This is not required for phone parity but should not be hidden.
- **Fix direction:** ORCH-1096 may preserve current data contract but must test and document send-now behavior. If changing to direct send, cite Supabase edge function docs per COMMS-0003 and expand scope; recommended path is no API change.

### F-6: Draft/re-entry/refresh behavior exists in Expo route but is absent from the phone shell

- **Severity:** P1.
- **Type:** confirmed bug / data-loss risk.
- **Confidence:** high.
- **Evidence:** Real `compose.tsx` hydrates `?template`, `?draft`, and `?audience`; `useComposerDraft` debounces flush; phone preboot shell has no draft id, autosave, audience id, or schedule mutation.
- **Current behavior:** Phone shell typing is local DOM only and not persisted.
- **Expected behavior:** Browser composer must create/update `marketing_campaigns` drafts or explicitly block send/schedule until persisted.
- **Fix direction:** Browser composer path must use the same `createDraft`, `updateDraft`, `ensure*Audience`, and `scheduleSend` service contract or a typed equivalent.

### F-7: Current regression tests pass while the core parity failure remains

- **Severity:** P1 test gap.
- **Type:** regression-test gap.
- **Confidence:** proven.
- **Evidence:** `npm run test:orch-1095` passed after dependency install. ORCH-1095 Jest asserts lightweight pre-Expo entry and "Return to marketing"; CI guard requires `data-orch-1095-light-route-entry="true"` and route chunk under 600 KB.
- **Current behavior:** The test suite protects the stripped shell.
- **Expected behavior:** ORCH-1096 tests should fail before implementation and pass only when the real composer workflow is present on phone and desktop web.
- **Fix direction:** Add `test:orch-1096` after `test:orch-1095`, updating only compose-specific expectations while preserving ORCH-1095 constraints for other routes.

## 9. Root Cause Proof

### RC-1: Preboot route deferral returns before Expo and renders stripped compose

- **File + line:** `mingla-business/scripts/inject-mobile-blur-css.mjs:53-54`.
- **Exact code/schema:** `isLightRoute(path)` includes `/marketing/campaigns/compose`; `if(isPhone()&&status==="interactive"&&isLightRoute(path)){...renderRoute(path,session);return}`.
- **What it does:** Phone browsers with an interactive/light route render preboot HTML and never append Expo scripts.
- **What it should do:** For `/marketing/campaigns/compose`, render a real browser composer workflow or load a proven route-specific composer bundle that avoids the OOM-causing common boot.
- **Causal chain:** ORCH-1095 OOM -> pre-Expo light route -> stripped Subject/Message shell -> tests pass -> full composer remains unavailable.
- **Verification step:** Fresh export + Playwright Pixel 5 at `/marketing/campaigns/compose` returned `light=true`, `expoScripts=0`, and signed-out/light recovery; ORCH-1095 guard passes.

### RC-2: The real composer path depends on Expo route boot that phone browsers cannot safely load yet

- **File + line:** `compose.tsx:62-111`, `ComposerV2Editor.tsx:49-80`, `richEditor.tsx:60-64`.
- **Exact code/schema:** Route imports full composer components/hooks/services and Tiptap editor; export reports compose route chunk `570122` bytes plus `phoneBoot=2885080`.
- **What it does:** Full workflow exists behind Expo async route, but phone route bypasses it to avoid common boot.
- **What it should do:** Compose-specific phone entry should isolate the composer runtime from root/common boot and stage editor/editor-adjacent chunks.
- **Verification step:** Re-export and compare ORCH-1095 guard output before/after ORCH-1096; physical Android Chrome/iPhone Safari must show no OOM/crash while using real composer controls.

## 10. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Stripped shell persists no draft data | `inject-mobile-blur-css.mjs` | Shell has local `input`/`textarea` only. | P1 | data-loss/UX gap |
| Real route infinite prefill skeleton possible | `compose.tsx:591-600` | Audience param loading returns spinner until `audienceId` or `errorBanner`; no timeout. | P2 | production-hardening gap |
| Send-now uses schedule mutation only | `compose.tsx:393-412`; `useSendNow.ts` unused | Immediate dispatch hook exists but not wired. | P2 | UX gap |
| Hidden web date/time inputs require Safari proof | `SchedulePickerSheet.tsx:186-217` | `showPicker` fallback to click; iPhone Safari behavior unproven. | P1 | runtime proof gap |
| Tiptap web-only split is load-bearing | `richEditor.tsx`; `.native.ts` | Prevents pell/native WebView from web. | P1 | native-module quarantine |

## 11. Blast Radius

- **Other flows affected:** Marketing overview New campaign link; template routes opening `?template`; brand/event buyer blast CTAs opening `?audience`; campaign draft re-entry.
- **Business Web phone browsers:** Primary affected surface.
- **Business Web desktop:** Must remain full real composer with split preview pane.
- **Business native iOS/Android:** Should be unchanged; native pell and DateTimePicker siblings must remain.
- **Consumer iOS/Android, buyer/anonymous Web, admin Web:** Out of scope.
- **Query keys/cache/state:** `marketingKeys.campaigns.all` invalidation after schedule; draft autosave local route state; Supabase auth localStorage.
- **RLS/auth/permission:** Existing authenticated RLS gates `marketing_audiences`, `marketing_templates`, `marketing_campaigns`; no new policies required.
- **Integrations:** Supabase PostgREST and `marketing-send` edge function exist. No new external API contract needed if ORCH-1096 preserves current service calls.
- **Deploy/migration:** No DB migration expected; web deploy only after PR merge to main.
- **Recurring pattern:** A route can be "real URL interactive" in guards while actually being a preboot shell.

## 12. Verification Performed

Commands run from `mingla-business`:

```bash
npm install
npm run test:orch-1095
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && node scripts/ci/orch-1095-business-web-interactive-parity-wave.mjs
npx serve -s dist -l 4186
node <Playwright Pixel 5 probe for /marketing/campaigns/compose>
```

Results:

- `npm run test:orch-1095`: PASS after local dependency install.
- Fresh export/inject/ORCH-1095 guard: PASS.
- Export evidence: `phoneBoot=2885080`, `/marketing/campaigns/compose` route chunk `570122`.
- Pixel 5 unsigned probe: `/marketing/campaigns/compose`, `light=true`, `expoScripts=0`, text says "Sign in to open Compose blast."
- Pixel 5 fake-token probe: `light=true`, `expoScripts=0`, no Subject/Message because invalid token could not load route data; this still proves preboot ownership.
- Desktop unsigned probe: `expoScripts=3`, `light=false`, signed-out recovery text via Expo route.

Physical Android Chrome and iPhone Safari were not run in this forensics turn because no implementation exists yet to validate; they are mandatory tester gates in the spec.

## 13. Production Readiness Verdict

- **Ready / not ready:** Not ready for full business web Marketing Composer parity.
- **Launch blockers:** Phone browser gets stripped preboot shell; no audience/templates/chips/preview/draft/schedule workflow; no iPhone Safari proof; current tests bless the stripped shell.
- **Residual risks:** Full Expo boot OOM if implementor simply disables light route; hidden date/time input behavior on iPhone Safari; Tiptap chip selection/backspace on phone; draft persistence under refresh; send-now copy mismatch.
- **Telemetry/monitoring gaps:** No route-level web composer error telemetry or OOM marker in automated browser tests.
- **Missing tests:** ORCH-1096 guard, Playwright composer workflow, Android/iPhone manual gates, export native-module/chunk quarantine.
- **Fastest next verification:** Implement the ORCH-1096 test first so it fails against current code, then implement bounded browser composer path and run export + Android Chrome + iPhone Safari.

## 14. Discoveries For Orchestrator

None requiring a new cross-ORCH ledger entry. The send-now copy/behavior mismatch is inside ORCH-1096 spec scope as a documented parity/UX risk, not a separate active ORCH blocker.

## 15. Recommended Next Step

Proceed to implementation only using `SPEC_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`. Implementation must not be a fake stripped form, must add failing-before/passing-after repo tests in the same commit, and must not deploy/OTA/merge/reap from this worktree.
