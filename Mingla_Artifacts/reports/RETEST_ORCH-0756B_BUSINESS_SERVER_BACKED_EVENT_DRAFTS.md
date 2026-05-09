# Retest Report: ORCH-0756B Business Server-Backed Event Drafts

> Date: 2026-05-08
> Mode: RETEST + SPEC-COMPLIANCE + SECURITY
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:0 P4:2

## 1. Layman Summary

The rework fixed the known publish-ordering hole: the app now checks whether local publish conversion can succeed before it marks the Supabase draft as published. That means the specific edge case from the first tester report, where the server draft could stop being a draft before local publish succeeded, is now statically resolved.

I still cannot call ORCH-0756B fully production-proven because the original user pain is runtime data survival: create a draft, sign out, clear local app data/app deletion, sign back in, and see the draft return from Supabase. No safe credentialed business account/device runtime was available in this tester session.

## 2. Inputs Reviewed

- Retest handoff: `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Prior tester report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Rework-touched code: `EventCreatorWizard.tsx`, `liveEventConverter.ts`, `brandsService.ts`, `serverDraftLifecycleGuards.test.ts`, `serverDraftEventMapper.test.ts`, `package.json`
- Existing ORCH-0756B code paths: create/edit/preview routes, `useServerDraftEvents.ts`, `eventDrafts.ts`, `serverDraftEventMapper.ts`

## 3. Claim Verification

| Claim | Evidence | Status | Notes |
|---|---|---|---|
| Publish preflights local conversion before server promotion | `EventCreatorWizard.tsx:451-473` | VERIFIED | `canConvertDraftToLiveEvent(liveDraft)` runs before `onBeforeLocalPublish?.(liveDraft)` and before `publishDraft(liveDraft.id)`. |
| Failed preflight leaves server draft as draft | `EventCreatorWizard.tsx:456-461`; `eventDrafts.ts:132-150` | VERIFIED STATIC | The failure branch returns before server mutation. Runtime not exercised. |
| Preflight is side-effect-free | `liveEventConverter.ts:26-34` | VERIFIED | It only calls `getBrandFromCache(draft.brandId) !== null`. |
| Server publish mutation still only touches draft rows | `eventDrafts.ts:145-147` | VERIFIED | Update includes `.eq("status", "draft")` and `.is("deleted_at", null)`. |
| Create route waits for server draft before navigation | `create.tsx:53-57` | VERIFIED | Navigation uses `newDraft.id` only in `createDraft(...).then(...)`. |
| Edit/preview do not redirect while hydration is loading | `edit.tsx:144-148`; `preview.tsx:145-148` | VERIFIED | Redirect waits until draft is null and server query is not loading/fetching. |
| Legacy local migration remains idempotent | `useServerDraftEvents.ts:63-115` | VERIFIED STATIC | Checks migrated ids, `legacyLocalDraftId`, and in-flight ids before creating server draft. |
| Discard resolves server draft before local deletion | `useServerDraftEvents.ts:224-229`; `EventCreatorWizard.tsx` discard callback wiring | VERIFIED STATIC | Hook calls service mutation first; local delete occurs on mutation success. |
| Plaintext ticket passwords are stripped | `serverDraftEventMapper.ts:142-148`, `:195-220`; mapper tests | VERIFIED | Password is nulled, `passwordConfigured` is retained. |
| `brandsService` no longer queries invalid `upcoming` status | `brandsService.ts:72`, `:199-207` | VERIFIED | Uses `["scheduled", "live"]`; grep found no `["upcoming", "live"]` in service. |
| `test:orch-0756b` expanded beyond mapper-only | `package.json`; `serverDraftLifecycleGuards.test.ts` | VERIFIED | Runs mapper tests plus lifecycle guard suite. |

## 4. Verification Commands

| Command | Result | Evidence |
|---|---|---|
| `cd mingla-business && npm run test:orch-0756b` | PASS | 2 suites, 12 tests passed. |
| `cd mingla-business && npm run test:orch-0756a` | PASS | Strict guard passed 22 checks; resolver Jest 6/6 passed. |
| `cd mingla-business && npm run test:orch-0754` | PASS | Strict Home guard passed; brandEventSummary Jest 5/5 passed. |
| `cd mingla-business && npx tsc --noEmit` | PASS | Exit 0. |
| Touched-file ESLint command from retest prompt | PASS | Exit 0 across ORCH-0756B and rework-touched files. |
| `cd mingla-business && npm run lint` | FAIL, unrelated broad debt | 171 problems across existing files; no ORCH-0756B/rework-touched file appeared in the failure output. |

Watchman emitted a recrawl warning during Jest runs. It did not fail tests.

## 5. Findings

### P2 Medium

**P2-001: Required credentialed sign-out/app-deletion runtime smoke remains unverified**
- **Evidence:** No safe credentialed business account/device/browser runtime was available in this tester session.
- **Impact:** The original bug is a runtime durability bug involving auth transition, local storage clearing, Supabase rows, cache hydration, and RLS. Static evidence is strong, but this exact journey is not production-proven.
- **Required follow-up:** Operator/tester must run the credentialed smoke: create draft, save, sign out/in, clear local storage/app data, sign in, verify rehydration, edit/resave, discard, publish if safe, inspect password JSON, and probe wrong actor if feasible.
- **Retest/close rule:** Do not close ORCH-0756B as runtime-proven until this is complete or the operator explicitly accepts a conditional/manual deferral.

**P2-002: Expanded automation is improved but still mostly static for route/hook lifecycle**
- **Evidence:** `serverDraftLifecycleGuards.test.ts` verifies source-order and source-contract strings for publish ordering, create-before-navigation, hydration redirect guards, legacy migration idempotence markers, service draft targeting, and status vocabulary.
- **Impact:** This is materially better than mapper-only coverage and would catch accidental removal/reordering of key guards. It does not execute React hooks/routes with mocked services, so it is less protective than true hook/route behavioral tests.
- **Required follow-up:** Not an implementor blocker by itself because runtime smoke is the stronger remaining gate, but future hardening should replace static lifecycle guards with executable hook/service/route tests once the Jest/Expo transform boundary is solved.

## 6. Prior Finding Retest

| Prior finding | Retest result | Evidence |
|---|---|---|
| P2-001 runtime smoke unverified | STILL UNVERIFIED | No credentials/device flow available. |
| P2-002 publish promotes server before local conversion | RESOLVED STATIC | Preflight at `EventCreatorWizard.tsx:456` runs before server callback at `:463`; server update remains draft-constrained. |
| P2-003 automation mapper-only | PARTIAL / IMPROVED | `test:orch-0756b` now has 12 tests across mapper + lifecycle guards, but route/hook coverage is static rather than executable. |
| P3-001 invalid `brandsService` status query | RESOLVED | `BRAND_DELETE_BLOCKING_EVENT_STATUSES = ["scheduled", "live"]`. |

## 7. Security / RLS / Privacy

| Check | Result | Evidence |
|---|---|---|
| Draft public exposure | PASS static | Draft rows use `status='draft'` and `visibility='draft'`; publish/discard services target draft rows. |
| Wrong-actor RLS | UNVERIFIED runtime | No safe wrong-actor credentials/fixtures available. |
| Plaintext ticket password persistence | PASS static + automated | Mapper strips `password`; existing mapper test covers password JSON. |
| Server mutation narrowing | PASS static | `markServerDraftPublished`, autosave, discard all constrain draft rows by id/status/deleted state. |

## 8. UX / State Handling

- Publish preflight failure shows a user-facing retry toast instead of silently mutating server state.
- Autosave state remains visible through `serverSaveState` in the wizard.
- Edit/preview loading guards prevent premature redirect while server draft hydration is in progress.
- Runtime user-visible recovery still needs actual app smoke.

## 9. Verdict

`CONDITIONAL PASS`.

No P0/P1 blockers found. The specific P2 publish-ordering rework is statically verified, the adjacent status-vocabulary issue is fixed, focused tests pass, TypeScript passes, and touched-file ESLint passes. ORCH-0756B is ready for orchestrator conditional-close review only if the operator accepts the remaining runtime gap; otherwise it should go to credentialed runtime smoke before close.

## 10. Required Next Step

Run the credentialed runtime smoke:

1. Sign in as a business user with a brand.
2. Create a uniquely named draft event.
3. Wait for save state.
4. Confirm Supabase `events.status='draft'` and `theme.business_draft`.
5. Sign out/in and confirm the draft returns.
6. Clear local app/browser storage or simulate app deletion.
7. Sign in again and confirm the draft returns from Supabase.
8. Edit/resave, then discard and confirm it does not reappear.
9. Publish a separate safe draft if possible and confirm it does not reappear as a draft.
10. Confirm no plaintext ticket password exists in server JSON.
