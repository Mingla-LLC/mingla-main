# Spec: Business Web Marketing Composer Parity (ORCH-1096)

> Date: 2026-06-07
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`
> Root cause: RC-1/RC-2
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]`
> Branch: `ORCH-1096-business-web-marketing-composer-parity`
> Status: ready for implementation

## 1. Layman Summary

Make the phone-browser campaign composer real. Today the route opens safely, but only as a stripped Subject/Message shell. After this ORCH, a signed-in business user on Android Chrome, iPhone Safari, and desktop browser should be able to pick an audience, write rich email content, insert chips/templates, preview, save a draft, refresh/re-enter, and schedule/send through the existing marketing campaign data contract.

This is a bounded browser/runtime implementation. Do not change Supabase schema, RLS, provider integrations, payout copy, or deploy/release behavior unless implementation proves a blocker and routes it back for a spec amendment.

## 2. User Story

As a business owner using Mingla in a browser, I want the Campaign Compose route to behave like the real app composer, so that I can create or schedule a buyer blast without switching devices.

## 3. Scope

- **In scope:**
  - `/marketing/campaigns/compose` only.
  - Phone-browser signed-in route entry.
  - Desktop browser parity sanity.
  - Audience selection and `?audience=` prefill.
  - Subject/body rich editor.
  - Personalization chips, event chips, chip insertion/deletion.
  - Template drawer and `?template=` prefill.
  - `?draft=` restore, autosave, refresh/re-entry.
  - Preview drawer/modal.
  - Schedule picker, review sheet, validation, schedule/send-now-as-immediate-scheduled path.
  - Signed-out/stale-session/current-brand/data terminal states.
  - Export/native-module/chunk guards.
- **Non-goals:**
  - Hub Events, Hub Trips, Marketing overview, Account, Ari, Hub Experiences, payout account management.
  - Backend migrations/RLS/RPC changes.
  - New external provider APIs.
  - Direct send-now edge invocation unless separately approved.
  - Deploy, OTA, merge, or reap.
- **Assumptions:**
  - Existing marketing tables/RLS and campaign services remain canonical.
  - ORCH-1095 lightweight entries stay in place for `/hub/events`, `/hub/trips`, `/marketing`, and `/account`.
  - Physical Android Chrome and iPhone Safari are available to tester/implementor for final gates.
- **Dependencies:**
  - ORCH-1091 JS cache/chunk recovery.
  - ORCH-1093 fail-closed route protection.
  - ORCH-1094 blocked-route/static Home posture.
  - ORCH-1095 pre-Expo route deferral and lightweight shell pattern.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Replace stripped compose shell with real workflow | Investigation F-1 / RC-1 | High |
| Do not simply load full Expo boot on phones | Investigation F-2 / ORCH-1095 Android OOM evidence | High |
| Preserve Tiptap web-only and pell native-only split | Investigation F-3 | High |
| Prove schedule picker in phone browsers | Investigation F-4 | High |
| Preserve existing campaign data contract | Investigation schema/services cross-check | High |
| Add tests that fail before implementation | Investigation F-7 / project regression rule | High |
| Preserve provider-neutral copy and no provider changes | COMMS-0003, COMMS-0021 | High |

## 5. Success Criteria

1. Phone browser `/marketing/campaigns/compose` no longer renders only the ORCH-1095 stripped Subject/Message shell.
2. Signed-in Android Chrome and iPhone Safari can complete this smoke path at the real URL: open compose -> choose or prefill audience -> type subject -> type rich body -> insert a personalization chip -> insert or attempt event chip with honest empty state -> open template drawer -> preview -> save draft -> refresh/re-enter draft -> schedule picker -> review -> validation/schedule path.
3. Desktop browser still renders the real composer with wide preview pane and template drawer behavior.
4. Signed-out phone browser still shows bounded recovery at `/marketing/campaigns/compose` without loading broken app state.
5. No phone-browser OOM/crash signatures appear during physical Android Chrome validation.
6. Existing ORCH-1091/1093/1094/1095 route/cache/static-home protections remain passing.
7. Tests added in this ORCH fail against current code and pass after implementation.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| Static Home remains Expo-free | Do not add Expo scripts to `public/home.html`. | Existing ORCH-1095 guard plus ORCH-1096 guard. |
| Unknown/unsafe phone routes fail closed | Keep default `static-section`; blocked routes stay blocked. | `test:orch-1096` chains ORCH-1095. |
| Compose is real, not fake | Phone compose must expose audience/templates/chips/preview/draft/schedule. | New Playwright/Jest guard. |
| Native modules quarantined from web entry | No native DateTimePicker/pell/WebView/native file modules in web phone composer entry. | Export chunk scan. |
| Provider-neutral copy | No `Connect Stripe`, `Payments & Stripe`, or `Stripe account` regressions. | Existing and new source guard. |
| No external API drift without docs | No provider/API changes in scope. | Implementation report must state no provider changes; if changed, stop for amendment. |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| `I-BUSINESS-WEB-COMPOSER-REAL-WORKFLOW` | Business web Marketing Composer | `/marketing/campaigns/compose` phone-browser entry must provide real composer controls, not only local Subject/Message fields. | ORCH-1096 CI + Playwright + physical gates. |
| `I-COMPOSER-PHONE-BOOT-ISOLATED` | Business web route entry | Phone compose must avoid loading the OOM-causing root/common Expo boot unless physical proof and budget show it is safe. | Export guard + Android logcat proof. |

## 7. Database / RLS / Migration

None expected.

- Current tables/policies are in `20260602000003_orch_0815_marketing_hub_phase_a.sql`.
- Current `marketing-send` claim helper is in `20260603000000_orch_0815_b_marketing_send_cron.sql`.
- Do not add migrations unless implementation proves a schema blocker and routes back for a spec amendment.
- If a migration becomes unavoidable, its filename prefix must be greater than the max migration version already in `supabase/migrations/` and must cite Supabase docs inline per COMMS-0003.

## 8. Edge Functions / RPCs / Webhooks

None expected.

- Preserve current `marketing-send` behavior.
- Preserve send-now-as-immediate-scheduled unless Seth approves a spec amendment to wire `useSendNow`.
- Do not alter `marketing-send`, `mkt_claim_campaigns`, Resend payloads, or cron behavior in this ORCH.

## 9. Service Layer

Use existing services:

- `marketingCampaignService.createDraft`
- `marketingCampaignService.updateDraft`
- `marketingCampaignService.getCampaign`
- `marketingCampaignService.scheduleSend`
- `marketingCampaignService.ensureBrandBuyersAudience`
- `marketingCampaignService.ensureEventBuyersAudience`
- `marketingTemplateService.getTemplate`, starter/user template list hooks
- `brandEvents.useBrandEvents` or equivalent existing event-card source

Requirements:

- Browser composer path must use the same row shapes: `CampaignChannelPayload.kind === "email"`, `subject`, `body_html`, `body_text`, `embedded_events`.
- All service errors must surface as visible route-owned error copy/toast; no silent failures.
- No service may write local-only drafts that cannot be re-entered via `?draft=`.

## 10. Hook / State / Cache Layer

### Draft State

- Use or adapt `useComposerDraft` for 800ms debounced autosave.
- First valid save creates `marketing_campaigns` draft only after account, brand, audience, subject/body are available.
- Refresh/re-entry with `?draft=` restores subject, body, audience, schedule mode/time, and embedded event chips.
- Draft save failures show `"Couldn't save draft. Tap Save draft to retry."` or equally actionable copy.

### Schedule State

- Use `useScheduleCampaign`.
- After schedule mutation succeeds, invalidate `marketingKeys.campaigns.all`.
- Send-now continues to call `scheduleSend` with `scheduled_for = now()` unless spec-amended.

### Auth/Brand State

Phone and desktop composer must terminate for:

- signed out,
- valid stored session,
- stale/expired session,
- auth bootstrap timeout with/without session,
- current brand missing,
- current brand recovery loading/error,
- audience/template/draft query loading/error,
- empty templates/events/audiences,
- populated data.

No spinner beyond 8 seconds without route-owned fallback/retry copy.

## 11. Component / Screen Layer

### `scripts/inject-mobile-blur-css.mjs`

Allowed approaches:

1. Preferred: keep pre-Expo route deferral but replace only the compose lightweight branch with a real browser composer mini-entry that lazy-loads composer-specific assets and uses existing Supabase service contracts.
2. Alternative: load a route-specific Expo/browser composer bundle that does not load root/common signed-in boot and passes physical Android/iPhone proof.

Requirements:

- `/marketing/campaigns/compose` must be distinguishable from the other ORCH-1095 light routes.
- The stripped HTML shell with only Subject, Message, and Return to marketing must be removed or demoted to signed-out/error recovery only.
- Keep `/hub/events`, `/hub/trips`, `/marketing`, and `/account` on their ORCH-1095 lightweight route entries unless separately scoped.
- Keep blocked non-goals blocked.
- Keep markers: `mingla-mobile-web-chunk-recovery`, `mingla-mobile-web-home-preboot`, `mingla-mobile-web-no-blur`, `orch1091-js-cache-bust`, `orch1093-mobile-route-script-deferral`.

### `app/(tabs)/marketing/campaigns/compose.tsx`

Requirements:

- Preserve desktop real composer.
- If implementation introduces a browser adapter component, keep native route behavior unchanged.
- Preserve `?audience=`, `?template=`, and `?draft=` hydration.
- Add bounded timeout/fallback for audience prefill spinner.
- Do not add `redirectMobileBusinessWebToStaticHome` to this route.

### `ComposerV2Editor` / `richEditor`

Requirements:

- Keep `@tiptap/*` web-only.
- Keep `react-native-pell-rich-editor` native-only.
- Phone browser must prove:
  - subject input focus,
  - body editor focus/typing,
  - bold/italic/underline/link toolbar either works or unsupported action is visibly disabled,
  - personalization chip insertion,
  - event chip insertion when event exists or clear empty state when none,
  - atomic chip delete/backspace.

### `SchedulePickerSheet`

Requirements:

- Web keeps browser-native date/time controls and no `@react-native-community/datetimepicker`.
- iPhone Safari gate must prove date and time can be changed or, if native picker cannot be automated, manual tester records visible state before/after and confirms review receives the selected time.

### Preview / Template / Audience

Requirements:

- Audience picker opens and selects brand buyers or event buyers.
- Template drawer opens, applies replace and/or insert-at-cursor behavior.
- Preview opens on phone and desktop; desktop wide preview pane remains.
- Empty states are honest: no templates, no events, no buyers.

## 12. Business / Admin / Public Parity

- **Business Web phone:** Primary surface.
- **Business Web desktop:** Must not regress.
- **Business native iOS/Android:** No intended change; native schedule/editor splits must remain.
- **Admin Web:** None.
- **Consumer iOS/Android:** None.
- **Buyer/anonymous Web:** None.
- **Operational dependency:** Later deploy only from merged main.

## 13. Realtime / Notifications / Analytics

None required.

Optional analytics/logging may be added only if it uses existing local analytics wrappers and does not introduce provider payload changes. If external analytics/provider contract changes are proposed, stop for spec amendment and cite provider docs per COMMS-0003.

## 14. Implementation Order

1. Add `mingla-business/scripts/ci/orch-1096-business-web-marketing-composer-parity.mjs` and `mingla-business/src/utils/__tests__/orch_1096_business_web_marketing_composer_parity.test.ts`; make them fail on current stripped shell.
2. Add `test:orch-1096` to `package.json`, chained after `test:orch-1095`.
3. Update compose route-entry strategy in `inject-mobile-blur-css.mjs` or a route-specific browser entry while preserving all existing preboot/cache/blocked-route markers.
4. Wire browser composer workflow to existing service/data contract.
5. Harden terminal states and audience/template/draft timeouts.
6. Add Playwright coverage for mobile browser composer workflow against exported `dist`.
7. Run fresh export/inject and `npm run test:orch-1096`.
8. Run physical Android Chrome gate.
9. Run physical iPhone Safari gate.
10. Write implementation report with source/export/runtime evidence.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-01 | Current stripped shell fails guard | Current source | Test fails if compose branch only has Subject/Message/Return to marketing shell | CI | New ORCH-1096 guard |
| T-02 | Route maps preserved | Source | Compose promoted to real composer strategy; other ORCH-1095 routes unchanged; blocked routes blocked | CI/Jest | `test:orch-1096` |
| T-03 | Native-module quarantine | Exported chunks | No pell/WebView/native DateTimePicker/native file modules in web composer entry | CI | Export scan |
| T-04 | Tiptap web-only | Source/export | `@tiptap/*` only in web composer path; no native import regression | CI | Source grep |
| T-05 | Signed-out recovery | Pixel 5 browser | Same URL, bounded sign-in recovery, no blank page | Playwright | Automated |
| T-06 | Subject/body typing | Signed-in browser fixture | Subject and rich body update visible state | Playwright/manual | Automated where possible |
| T-07 | Audience select/prefill | `?audience=brand:<id>` and picker | Audience resolves or shows actionable error; no infinite spinner | Jest/Playwright | Automated |
| T-08 | Template apply | `?template=<id>` and drawer | Subject/body hydrate/apply | Jest/Playwright | Automated |
| T-09 | Chip insert/delete | Personalization and event chip | Chip renders and deletes atomically | Jest/Playwright | Automated |
| T-10 | Preview | Phone + desktop | Preview opens; desktop pane remains | Playwright | Automated |
| T-11 | Draft autosave/re-entry | Create draft, refresh with `?draft=` | Draft content restored | Jest/Playwright | Automated |
| T-12 | Schedule picker | Phone browsers | Date/time selected and review shows selected label | Playwright/manual Safari | Automated/manual |
| T-13 | Validation | Missing fields | Actionable missing-field copy; no dead tap | Jest/Playwright | Automated |
| T-14 | Schedule mutation | Mocked Supabase/service | `scheduleSend` called with expected payload | Jest | Automated |
| T-15 | Android Chrome OOM | Physical Samsung/Android Chrome | No OOM/crash signatures; route remains responsive | Manual gate | Required |
| T-16 | iPhone Safari | Physical iPhone Safari | Full smoke path passes | Manual gate | Required |
| T-17 | Desktop parity | Chromium/Safari desktop | Wide composer panes and controls still work | Playwright/manual | Required |

All automated tests must be included in the same scoped commit/push as the implementation.

## 16. Regression Prevention

- **Structural safeguard:** ORCH-1096 CI guard rejects a compose route that remains only a preboot Subject/Message shell.
- **Test:** `npm run test:orch-1096` chains ORCH-1095 and the new compose parity tests.
- **Protective documentation:** Implementation report must state exactly how phone compose avoids root/common boot OOM.
- **Artifact update:** Implementation report under `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md`.

## 17. Rollback And Deploy Safety

- **Migration order:** None.
- **Edge function deploy:** None.
- **Mobile OTA vs native build:** No native app change intended. If native files are touched unexpectedly, stop and explain.
- **Business/admin web deploy:** Deploy only after PR merge to `main`; never deploy from ORCH worktree.
- **Env vars/secrets:** No new env vars. Preserve existing public Supabase URL/anon-key resolution in injector if used.
- **Partial rollback risk:** If compose promotion fails physical proof, keep `/marketing/campaigns/compose` on the ORCH-1095 lightweight shell and report rework; do not ship a half-promoted route that loads full Expo boot and risks OOM.

## 18. Physical Device Gates

### Android Chrome

Use a physical Android phone, preferably the same Samsung A72 class used in ORCH-1095 when available.

Required smoke:

1. Serve fresh export with SPA fallback from the ORCH worktree.
2. Open `/marketing/campaigns/compose` signed in.
3. Complete audience, subject, body, chip, template, preview, save draft, refresh/re-enter, schedule, review.
4. Confirm URL remains `/marketing/campaigns/compose`.
5. Capture screenshot/XML/evidence.
6. Run logcat grep for `V8 javascript OOM|Ineffective mark-compacts|SIGSEGV|CrRendererMain|Aw, Snap|fatal exception|Render process`; expected 0 new lines.

### iPhone Safari

Required smoke:

1. Open the same fresh export or deployed PR preview on physical iPhone Safari.
2. Complete the same workflow.
3. Specifically prove keyboard does not hide subject/body, Tiptap/body editing is usable, chip delete works, and date/time picker selection reaches review.
4. Capture screenshots and tester notes.

## 19. Common Mistakes

1. Do not "fix" parity by removing `/marketing/campaigns/compose` from `isLightRoute` and loading the full Expo root/common boot on phones.
2. Do not leave the current Subject/Message-only shell and call it a composer.
3. Do not touch backend/provider APIs just to make route proof easier.
4. Do not break ORCH-1095 lightweight entries for Hub Events/Trips/Marketing/Account.
5. Do not import native DateTimePicker, pell, WebView, image picker, Stripe Connect, or file-system modules into web phone composer entry chunks.
6. Do not hide schedule/send failures; every failed mutation needs visible retryable copy.

## 20. Handoff To Implementor

Implement ORCH-1096 in `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1096-[business-web-marketing-composer-parity]` on branch `ORCH-1096-business-web-marketing-composer-parity`. Start by adding failing ORCH-1096 tests that reject the current stripped preboot compose shell, then replace only the compose phone-browser entry with a real workflow that preserves ORCH-1091/1093/1094/1095 protections and uses existing marketing campaign services. No backend/provider/schema/deploy/OTA/merge/reap work is in scope. Final output must include `IMPLEMENTATION_ORCH-1096_BUSINESS_WEB_MARKETING_COMPOSER_PARITY.md` plus automated test results, fresh export evidence, physical Android Chrome proof, and physical iPhone Safari proof.
