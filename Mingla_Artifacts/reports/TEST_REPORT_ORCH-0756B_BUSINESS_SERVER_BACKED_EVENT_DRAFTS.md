# QA Report: Business Server-Backed Event Drafts (ORCH-0756B)

> Date: 2026-05-08
> Mode: TARGETED + SPEC-COMPLIANCE + SECURITY
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:3 P3:1 P4:2

## 1. Layman Summary

The implementation is directionally sound: new business drafts are created as Supabase `events` rows, server draft rows hydrate back into the local draft cache, autosave writes the wizard snapshot to `events.theme.business_draft`, and plaintext ticket passwords are stripped before durable server JSON.

I cannot give a full PASS because the required credentialed runtime smoke was not available in this tester session. The exact user pain is runtime durability: create a draft, sign out/in, simulate app deletion/local storage loss, and see the draft return from Supabase. Code evidence strongly supports that path after a successful server save, but it still needs device/app proof before orchestrator close.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Tester handoff: `Mingla_Artifacts/prompts/TESTER_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0756_BUSINESS_DRAFT_AND_BRAND_PERSISTENCE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Migration: `supabase/migrations/20260515000001_orch_0756b_event_draft_persistence.sql`
- Changed business files: create/edit/preview/Home/Events routes, server draft service/hooks/mapper, draft store, wizard, ticket sheet, validation, `useBrands`
- Tests: `serverDraftEventMapper.test`, ORCH-0756A resolver tests, ORCH-0754 Home summary tests

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | ORCH-0756B migration, baseline events policies | Status vocabulary, public draft exposure, event-manager policies, migration deployment |
| Services | `src/services/eventDrafts.ts` | Create/fetch/autosave/discard/publish-resolution calls |
| Hooks/State/Cache | `useServerDraftEvents.ts`, `draftEventStore.ts` | Server hydration, query cache sync, legacy migration, local cache behavior |
| Components/Screens | create/edit/preview routes, Home, Events, wizard, ticket sheet | Create-before-navigation, loading behavior, autosave UX, discard/publish flow, password-configured UI |
| Tests/Build | package scripts, Jest, TypeScript, ESLint, Supabase CLI | Focused automation and deploy ledger |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| New draft creates server row before navigation | `app/event/create.tsx:47-60`, `useServerDraftEvents.ts:195-215`, `eventDrafts.ts:31-58` | VERIFIED | Navigation happens only after `createDraft(currentBrandId)` resolves with `newDraft.id`. |
| Server row uses `status='draft'`, `visibility='draft'`, brand/account ownership, JSON snapshot | `serverDraftEventMapper.ts:258-280`, `eventDrafts.ts:35-54` | VERIFIED | Insert includes `brand_id`, `created_by`, fallback title, slug, `theme.business_draft`, `status`, `visibility`. |
| Home/Events/edit/preview hydrate server drafts | `home.tsx:131-132`, `events.tsx:117-118`, `edit.tsx:80-88`, `preview.tsx:54-57`, `useServerDraftEvents.ts:123-146` | VERIFIED | Detail/list queries upsert server drafts into local cache. |
| Autosave is visible and writes to Supabase | `EventCreatorWizard.tsx:264-274`, `298-306`, `594-608`, `eventDrafts.ts:102-119` | VERIFIED | User sees `Saving...`, `Saved`, or `Unsaved changes - retrying`. |
| Legacy `d_...` drafts migrate once and avoid duplicate recreation | `useServerDraftEvents.ts:63-118`, `edit.tsx:108-127`, `preview.tsx:123-141` | PARTIAL | Code checks `legacyLocalDraftId` from server rows and in-flight ids; no automated idempotence test and no runtime proof. |
| Discard resolves server draft | `eventDrafts.ts:121-130`, `useServerDraftEvents.ts:218-237`, `EventCreatorWizard.tsx:350-409`, `events.tsx:428-440` | VERIFIED STATIC | Soft-deletes server row before local deletion on routed wizard/menu paths. Runtime still untested. |
| Publish prevents draft reappearing | `eventDrafts.ts:132-150`, `EventCreatorWizard.tsx:450-481`, `draftEventStore.ts:592-607` | PARTIAL | Server row is promoted out of `draft` before local publish. See P2-002 for ordering risk. |
| Plaintext ticket passwords are not persisted to server JSON | `serverDraftEventMapper.ts:142-148`, `195-229`, mapper test | VERIFIED | Server payload nulls `password` and records `passwordConfigured`. |
| Recovered configured password validates | `draftEventValidation.ts:413-424`, `TicketTierEditSheet.tsx:379-420`, mapper test | VERIFIED | `passwordConfigured=true` bypasses re-entry requirement. |
| `useBrands` no longer queries invalid DB statuses | `useBrands.ts:364-383` | VERIFIED | Uses `ended/cancelled/scheduled/live`. Adjacent `brandsService.ts` still has invalid `upcoming`; see P3-001. |
| RLS protects drafts from public/other-account access | baseline policies at `20260505000000...:14246`, `14258`; ORCH migration comments | PARTIAL | Static policy shape is reasonable; no credentialed anonymous/other-brand probe was run. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| ORCH-0756B mapper/password/status tests | `cd mingla-business && npm run test:orch-0756b` | PASS | 1 suite, 6 tests passed. |
| ORCH-0756A regression | `cd mingla-business && npm run test:orch-0756a` | PASS | Strict guard passed 22 checks; resolver Jest 6/6 passed. |
| ORCH-0754 regression | `cd mingla-business && npm run test:orch-0754` | PASS | Strict Home guard passed; brandEventSummary Jest 5/5 passed. |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | PASS | Exit 0, no output. |
| Touched-file ESLint | exact implementation-report command | PASS | Exit 0, no output. |
| Broad lint | `cd mingla-business && npm run lint` | FAIL, unrelated debt | 171 problems across broad existing files; no ORCH-0756B touched files named in the failure output. |
| Migration ledger | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | `20260515000001` appears on both Local and Remote. |
| Status vocabulary scan | `rg` for `upcoming`/`past` status queries | PARTIAL | `useBrands` fixed; `brandsService.ts:199-206` still has adjacent invalid status query. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS static | Create route shows retry state; discard publish errors toast. Runtime pending. |
| One owner per truth | PASS for drafts | Supabase `events` is now the durable draft source; Zustand is cache/migration source. |
| No silent failures | PASS static | Autosave error renders `Unsaved changes - retrying`; discard/publish failures toast. |
| One key per entity | PASS | Query keys are centralized in `eventDraftKeys`. |
| Server state server-side | PASS for draft survival | Server drafts are inserted/fetched/autosaved from Supabase. |
| Logout clears everything | PASS | Logout can clear cache because server row should hydrate afterward. Runtime pending. |
| Label temporary | PASS | Migration comments and store header label server-backed draft contract. |
| Subtract before adding | PASS | Existing local draft store was reduced to cache role rather than adding a second UI-only path. |
| No fabricated data | PASS | No fake draft data introduced. |
| Persisted-state startup | CONDITIONAL | Static recovery path exists; runtime sign-out/app-delete proof still required. |

## 7. Findings

### P2 Medium

**P2-001: Required credentialed sign-out/sign-in and app-deletion smoke is still unverified**
- **Evidence:** Tester handoff required runtime smoke steps 1-9. No safe credentialed business account/device/browser runtime was available in this tester session.
- **What is wrong:** The implementation cannot be closed as fully proven against the original user bug until a real app session creates a draft, signs out/in, clears local storage/app data, and confirms the same draft rehydrates from Supabase.
- **Impact:** Static proof is strong, but the user-reported data-loss path is an end-to-end cache/auth/RLS/runtime problem. A missing runtime proof is exactly where regressions can hide.
- **Required follow-up:** Operator/tester performs the runtime smoke from the handoff: create draft, verify Supabase row, sign out/in, simulate app deletion/local storage loss, edit/re-save, discard, publish if safe, inspect password JSON, and verify anonymous/other-brand access if feasible.
- **Retest:** Record evidence in a retest report or appendendum before orchestrator close.

**P2-002: Publish resolution promotes the server draft before local publish conversion succeeds**
- **Evidence:** `EventCreatorWizard.tsx:450-481` awaits `onBeforeLocalPublish?.(liveDraft)` first; `edit.tsx:270-272` wires that to `publishServerDraft.markPublished`; `eventDrafts.ts:132-150` updates the server row to `status='scheduled'`; then `draftEventStore.publishDraft` converts locally at `draftEventStore.ts:592-607`, and `convertDraftToLiveEvent` can return `null` if the brand is missing from React Query cache at `liveEventConverter.ts:40-50`.
- **What is wrong:** If the server update succeeds but local conversion returns `null`, the local draft is preserved but the server row is no longer `status='draft'`. After sign-out/app deletion, that draft will not rehydrate as a draft.
- **Impact:** This is an edge case around publish, not the core sign-out draft-save path. Still, it violates the spec's intent that publish should not resolve the draft until the full publish path succeeds.
- **Required follow-up:** `$implementor` should either validate local publish prerequisites before marking the server row published, or move publish into a single server-authoritative path that only promotes after all required publish work succeeds.
- **Retest:** Add a focused test or static guard for "brand cache missing/local publish fails -> server draft remains draft" or document why that state cannot occur at runtime.

**P2-003: Regression automation is narrower than the ORCH-0756B contract**
- **Evidence:** `package.json` `test:orch-0756b` runs only `serverDraftEventMapper.test`; the test file covers 6 mapper/password/status cases. There are no route/hook/service tests for create-before-navigation, edit loading-not-redirecting, autosave errors, legacy migration idempotence, sign-out cache clear plus server rehydrate, or publish/discard server behavior.
- **What is wrong:** Important behavior is verified statically but not covered by repo-running automated tests.
- **Impact:** Future regressions could break the actual user journey while the ORCH-0756B test still passes.
- **Required follow-up:** Add focused tests around `useServerDraftEvents`/service mocks and route behavior, especially legacy migration idempotence and no redirect during server hydration. Keep runtime smoke as the final proof.
- **Retest:** Rerun expanded `test:orch-0756b` plus the existing regression gates.

### P3 Low

**P3-001: Adjacent invalid event status query remains in `brandsService.ts`**
- **Evidence:** `useBrands.ts:364-383` is fixed, but `mingla-business/src/services/brandsService.ts:199-206` still queries `.in("status", ["upcoming", "live"])` against the DB enum `draft/scheduled/live/ended/cancelled`.
- **What is wrong:** The handoff specifically asked about `useBrands`, which is clean. This adjacent service path still has the old vocabulary drift.
- **Impact:** Brand delete/preview behavior can still miscount scheduled events. It is adjacent to ORCH-0756B and already known from ORCH-0756 investigation.
- **Required follow-up:** Register or fold into the existing status-vocabulary cleanup item; use `scheduled/live` for active blockers and `ended/cancelled` for past.

### P4 Notes

- **P4-001:** Password handling is a good pattern: `password` is local-only, server JSON stores only `passwordConfigured`, and validation accepts recovered configured passwords without revealing secrets.
- **P4-002:** Migration `20260515000001` is monotonic and remote-applied. It only adds comments/policy comments, relying on existing event-manager-plus policies; that is acceptable for this scoped implementation because existing policies already cover draft insert/update/select and public policies exclude drafts.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Creating a draft creates a server draft row immediately | VERIFIED STATIC | `create.tsx:47-60`, `eventDrafts.ts:31-58` | Runtime pending |
| Editing autosaves to Supabase | VERIFIED STATIC | `EventCreatorWizard.tsx:298-306`, `eventDrafts.ts:102-119` | Runtime pending |
| Sign-out/app deletion recovers draft after login | PARTIAL | Home/Events hydrate via `useServerDraftsForBrand`; edit/preview hydrate detail | P2-001 |
| Existing local drafts migrate once | PARTIAL | `useServerDraftEvents.ts:63-118`; direct route migration in edit/preview | P2-003 |
| Draft page does not redirect while hydration loading | VERIFIED STATIC | `edit.tsx:144-154`, `preview.tsx:144-152` | No automated route test |
| Plaintext passwords never stored in server JSON | VERIFIED | `serverDraftEventMapper.ts:142-148`; Jest password test | None |
| Publishing/discarding resolves server draft | PARTIAL | Discard good; publish has ordering risk | P2-002 |
| DB/UI status vocabulary mapping avoids invalid queries | PARTIAL | `useBrands` fixed; `brandsService` adjacent drift remains | P3-001 |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Public draft exposure | None found | Public policy comment says only `visibility='public'` and `status IN ('scheduled','live')`; draft rows use `visibility='draft'`, `status='draft'` | PASS static |
| Authorized draft mutation | None found | Baseline events policies require `event_manager+` and `created_by = auth.uid()` on insert | PASS static |
| Other-brand/anonymous RLS runtime proof | P2 condition | No credentialed RLS probe run | CONDITIONAL |
| Plaintext ticket password exposure | None found | Mapper strips `password`; test confirms payload JSON lacks `secret-pass` | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Create route | Shows spinner and retry copy if server draft creation fails | None | PASS static |
| Wizard save state | Shows `Server draft`, `Saving...`, `Saved`, or `Unsaved changes - retrying` | None | PASS static |
| Edit/preview hydration | Loading state shown before redirect | None | PASS static |
| Runtime recovery | User-visible draft survival still needs real smoke | P2 | CONDITIONAL |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Business | Static + automated | CONDITIONAL PASS | Runtime smoke pending. |
| Mobile | N/A | Not in scope | Consumer mobile not touched. |
| Admin | N/A | Not in scope | Not touched. |
| Public/web | Static only | No draft exposure found | Publish/live durability broader scope deferred. |
| iOS | No | Unverified | Needs runtime app smoke if target platform. |
| Android | No | Unverified | Needs runtime app smoke if target platform. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|
| Drafts in `events` | None | High positive | None | None | Uses existing events policies | Runtime proof pending. |
| `theme.business_draft` JSON | None | High positive | None | None | Password stripped | Future canonical publish still deferred. |
| Event status vocabulary comments | None | Medium | None | None | Documents valid DB statuses | `brandsService` adjacent drift remains. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Migration deployed | Supabase CLI linked ledger | PASS | None for deployment visibility. |
| Sign-out/sign-in recovery | Not available | UNVERIFIED | Create draft, save, sign out/in, confirm rehydrate. |
| App deletion/local storage loss | Not available | UNVERIFIED | Clear local storage/app data after save, sign in, confirm draft returns. |
| Discard does not reappear | Static only | PARTIAL | Discard runtime check after server row exists. |
| Publish does not reappear | Static with risk | PARTIAL | Publish runtime check plus P2-002 follow-up. |
| RLS wrong actor | Static only | PARTIAL | Anonymous/other-brand read/update probe if safe. |

## 14. Required Actions

No P0/P1 blockers found.

## 15. Conditional / Recommended Actions

1. **P2-001:** Run the required credentialed runtime smoke before orchestrator close.
2. **P2-002:** Harden publish ordering so a local publish conversion failure cannot promote the server draft out of `draft`.
3. **P2-003:** Expand `test:orch-0756b` beyond mapper coverage to include hook/service/route behaviors.
4. **P3-001:** Clean the adjacent invalid status query in `brandsService.ts`.

## 16. Discoveries For Orchestrator

- ORCH-0756B can move to runtime smoke / conditional-close review, but not unconditional close.
- Adjacent status-vocabulary debt remains outside `useBrands`: `brandsService.ts` still uses `upcoming` against the DB enum.
- Server-backed draft persistence is now structurally present; the remaining highest-value proof is device/browser runtime with actual auth and Supabase rows.

## 17. Retest Notes

Retest cycle: N/A. This is the first independent ORCH-0756B test pass.
