# QA Report: Business Active Brand Recovery And Honest Home Empty State (ORCH-0756A)

> Date: 2026-05-08
> Mode: TARGETED + SPEC-COMPLIANCE
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:1 P4:3

## 1. Layman Summary

ORCH-0756A is code-verified for the main trust repair: the business app can now recover an active brand from a valid local ID, `creator_accounts.default_brand_id`, or the newest fetched brand, and Home no longer collapses "no selected brand yet" into "No brands yet." I found no P0/P1 blockers and no required implementor rework.

The verdict is **CONDITIONAL PASS** because I could not run a credentialed sign-out/sign-in runtime smoke in this tester pass, and full `npm run lint` remains red from unrelated existing repo-wide lint debt. Focused ORCH-0756A gates pass, TypeScript passes, and ORCH-0756A-touched files have zero ESLint errors.

ORCH-0756B draft persistence remains untested and untouched.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0756_BUSINESS_DRAFT_AND_BRAND_PERSISTENCE.md`
- Tester prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
- Changed files reviewed:
  - `mingla-business/src/utils/currentBrandResolver.ts`
  - `mingla-business/src/utils/__tests__/currentBrandResolver.test.ts`
  - `mingla-business/src/hooks/useCurrentBrandRecovery.ts`
  - `mingla-business/src/hooks/useCreatorAccount.ts`
  - `mingla-business/src/services/creatorAccount.ts`
  - `mingla-business/app/_layout.tsx`
  - `mingla-business/app/(tabs)/home.tsx`
  - `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`
  - `mingla-business/src/store/currentBrandStore.ts`
  - `.github/scripts/strict-grep/orch-0756a-active-brand-recovery.mjs`
  - `mingla-business/package.json`
  - `Mingla_Artifacts/INVARIANT_REGISTRY.md`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Existing `creator_accounts.default_brand_id`, FK, index, and creator self-read/update RLS exist; no ORCH-0756A migration added. |
| Edge/RPC/Webhooks | `supabase/functions/`, `supabase/migrations/` status | No in-scope edge/RPC/migration changes for ORCH-0756A. |
| Services | `creatorAccount.ts`, `brandsService.ts` | Row-returning account update; default-brand patch type; newest-first brand list. |
| Hooks/State/Cache | `useCreatorAccount.ts`, `useCurrentBrandRecovery.ts`, `currentBrandStore.ts`, `clearAllStores.ts` | Query/cache behavior, resolver application, loop prevention, ID-only persistence, logout cleanup preservation. |
| Components/Screens | `_layout.tsx`, `home.tsx`, `BrandSwitcherSheet.tsx` | App-wide recovery, splash readiness, honest Home states, pick/create default persistence and error toast wiring. |
| Business/Admin/Public | `mingla-business`, `app-mobile`, `mingla-admin` status | Business app only; no mobile/admin changes. |
| Tests/Build | Jest, strict grep, TypeScript, ESLint | Required gates run; lint caveat classified. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Resolver order matches spec | `currentBrandResolver.ts:24-42`; resolver tests `currentBrandResolver.test.ts:7-67` | VERIFIED | Local valid ID, server default, newest fallback, none are covered. |
| Account row reads `default_brand_id` | `useCreatorAccount.ts:21-29`, `:61-67` | VERIFIED | Row type and select include `default_brand_id`. |
| Account update writes `default_brand_id` and verifies row returned | `creatorAccount.ts:4-9`, `:57-70`, `:73-78` | VERIFIED | Throws on Supabase error and null returned row. |
| Recovery waits for query fetch and applies resolver | `useCurrentBrandRecovery.ts:21-52`, `:54-95` | VERIFIED | Uses both `brandsQuery.isFetched` and `creatorAccount.isFetched`. |
| Invalid/inaccessible default cannot be selected unless in fetched brands | `currentBrandResolver.ts:18-22`, `:33-39`; `useCurrentBrandRecovery.ts:42-52` | VERIFIED | Validation is by membership in fetched brand list. |
| Newest fallback persists default | `useCurrentBrandRecovery.ts:74-87` | VERIFIED | Persists only for `newest-brand`; local selection remains on catch. |
| Loop/write spam prevention exists | `useCurrentBrandRecovery.ts:19`, `:29`, `:57-80` | VERIFIED | Applied tuple + module-level in-flight write set. |
| App-wide recovery is wired | `_layout.tsx:81-104`, `:204-214` | VERIFIED | Hook runs inside AuthProvider and QueryClientProvider. |
| Home no longer uses old false-empty condition | `home.tsx:230-240`, `:287-326`; grep no matches | VERIFIED | Loading, true empty, and choose-brand states are split. |
| Brand pick/create persists selected default without blocking UI | `BrandSwitcherSheet.tsx:114-124`, `:135-152` | VERIFIED | Local set/close happen before fire-and-forget mutation. |
| Default write failure visible | `BrandSwitcherSheet.tsx:120-123`, `:148-151`; `home.tsx:156-158`, `:224-228`; recovery hook `:81-84` | VERIFIED | Error flows to toast callback/message. |
| `currentBrandStore` remains ID-only | `currentBrandStore.ts:103-110`, `:127-132`, `:153-164` | VERIFIED | `partialize` persists only `currentBrandId`. |
| Logout cleanup unchanged | `clearAllStores.ts:30-42`; `AuthContext.tsx:180-188`, `:482-489` | VERIFIED | `currentBrandStore.reset()` remains in centralized cleanup. |
| ORCH-0754 Home fake-data guard preserved | `home.tsx:241-245`, `:418-527`; `npm run test:orch-0754` | VERIFIED | Fake signatures absent; ORCH-0754 guard/test pass. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Local shell PATH check | `which node; which npm; which npx` | PATH missing plain binaries | Output: `node not found`, `npm not found`, `npx not found`. Used `/opt/homebrew/bin` prefix for Node gates. |
| ORCH-0756A guard + resolver | `PATH=/opt/homebrew/bin:$PATH npm run test:orch-0756a` | PASS | Guard 22 checks PASS; `currentBrandResolver.test.ts` 6/6 PASS. |
| ORCH-0754 regression | `PATH=/opt/homebrew/bin:$PATH npm run test:orch-0754` | PASS | I-PROPOSED-Z PASS; `brandEventSummary.test.ts` 5/5 PASS. |
| Resolver direct Jest | `PATH=/opt/homebrew/bin:$PATH npx jest currentBrandResolver.test` | PASS | 6/6 tests PASS. |
| TypeScript | `PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit` | PASS | Exit 0, no output. |
| Full lint | `PATH=/opt/homebrew/bin:$PATH npm run lint` | FAIL, unrelated existing debt | 187 problems: 80 errors, 107 warnings. No ORCH-0756A-touched file has a lint error. |
| Touched-file ESLint | `PATH=/opt/homebrew/bin:$PATH npx eslint app/_layout.tsx 'app/(tabs)/home.tsx' src/components/brand/BrandSwitcherSheet.tsx src/hooks/useCreatorAccount.ts src/hooks/useCurrentBrandRecovery.ts src/services/creatorAccount.ts src/utils/currentBrandResolver.ts src/utils/__tests__/currentBrandResolver.test.ts` | PASS with warnings | 0 errors; 3 pre-existing `_layout.tsx` unused eslint-disable warnings. |
| Home forbidden-signature grep | `rg -n "brands\\.length === 0 \\|\\| currentBrand === null|STUB_UPCOMING_ROWS|StubUpcomingRow|Sunday Languor Brunch|The Long Lunch \\(Series\\)|currentBrand\\?\\.currentLiveEvent" "mingla-business/app/(tabs)/home.tsx"` | PASS | Exit 1 / no matches. |
| Zustand persisted-shape grep | `rg -n "currentBrand:|brands:" "mingla-business/src/store/currentBrandStore.ts"` | PASS with classification | Matches only historical comments and v13->v14 migration extraction, not `partialize`. |
| ORCH-0756A strict guard direct | `PATH=/opt/homebrew/bin:$PATH node .github/scripts/strict-grep/orch-0756a-active-brand-recovery.mjs` | PASS | `ORCH-0756A PASS: active-brand recovery guard passed (22 checks).` |
| Scope status check | `git diff --name-only -- mingla-business app-mobile mingla-admin supabase/migrations supabase/functions` and targeted `git status` | PASS for ORCH-0756A scope | No mobile/admin/migrations/draft/live/order-store changes. One unrelated dirty Supabase function exists outside ORCH-0756A. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS | Choose-brand action opens switcher in Home: `home.tsx:307-317`; brand switcher rows have press handlers: `BrandSwitcherSheet.tsx:201-209`. |
| One owner per truth | PASS | Brand rows stay in React Query via `useBrands`; Zustand persists ID-only at `currentBrandStore.ts:127-132`. |
| No silent failures | PASS | Account update throws on error/no row at `creatorAccount.ts:61-70`; default write failure toasts at `BrandSwitcherSheet.tsx:120-123` and `useCurrentBrandRecovery.ts:81-84`. |
| One key per entity | PASS | Creator account key remains `creatorAccountKeys.byId(user.id)` at `useCreatorAccount.ts:41-45`, patched/invalidated at `:89-100`. |
| Server state server-side | PASS | `CreatorAccountRow` and brand list are React Query state; no full server row persisted to Zustand. |
| Logout clears everything | PASS | `clearAllStores.ts:30-42`; `AuthContext.tsx:180-188`, `:482-489`. |
| Label temporary | N/A | No new transitional hack introduced for ORCH-0756A. |
| Subtract before adding | PASS | Replaces false Home empty condition; does not reintroduce persisted Brand snapshots. |
| No fabricated data | PASS | ORCH-0754 guard PASS; Home forbidden fake signatures absent. |
| Currency-aware | N/A | No currency logic changed in this scope. |
| One auth instance | PASS | Uses existing `useAuth` and Supabase client; no new auth client. |
| Validate at right time | PASS | Resolver validates defaults against fetched brand list before selection. |
| Exclusion consistency | N/A | Not a place/category exclusion change. |
| Persisted-state startup | PASS | `_layout.tsx:100-104` waits for recovery/brand fetch before splash readiness except existing timeout fallback. |

## 7. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: Manual sign-out/sign-in runtime smoke remains unverified**
- **Evidence:** No credentials/runtime were provided in this tester pass. Implementation report also notes "No manual device/browser sign-out/sign-in run" in its parity/gap section.
- **What is wrong:** Automated/static verification proves the resolver and wiring, but does not exercise a real Supabase session, AsyncStorage reset, React Query cache clear, sign-in bootstrap, and Home render together.
- **Impact:** Low code-risk after passing gates, but the user-visible fix is specifically a sign-out/sign-in experience, so runtime proof should be captured before orchestrator close if possible.
- **Required fix:** No code rework required. Run one credentialed business-app smoke: sign out, sign in, confirm an existing brand recovers and Home does not show a false no-brand state.
- **Retest:** Tester or operator records the manual smoke result. If credentials are unavailable, orchestrator may accept Conditional Pass as close evidence with explicit manual deferral.

**P2-002: Full `mingla-business` lint remains red from unrelated existing files**
- **Evidence:** `npm run lint` returns 187 problems (80 errors, 107 warnings). Error files include `app/__styleguide.tsx`, `app/account/delete.tsx`, `app/event/[id]/index.tsx`, `src/components/brand/BrandEditView.tsx`, `src/components/event/CreatorStep2When.tsx`, and others. ORCH-0756A-touched files have 0 ESLint errors in the targeted lint command.
- **What is wrong:** Repo-wide lint is still not a clean release gate.
- **Impact:** External release hygiene risk, but not caused by ORCH-0756A and not evidence that the active-brand recovery fix is broken.
- **Required fix:** Separate lint cleanup ORCH, not ORCH-0756A rework.
- **Retest:** Re-run full `npm run lint` after the separate lint debt is cleaned.

### P3 Low

**P3-001: `_layout.tsx` still has pre-existing unused eslint-disable warnings**
- **Evidence:** Touched-file ESLint reports `_layout.tsx:148`, `:155`, `:175` unused `no-console` disable warnings; no errors.
- **What is wrong:** Minor lint hygiene issue in a touched file, but unrelated to ORCH-0756A behavior and already existed in the area.
- **Impact:** Non-blocking cleanup.
- **Required fix:** Optional tidy when `_layout.tsx` is next touched for lint cleanup.
- **Retest:** Touched-file ESLint should return zero warnings after cleanup.

### P4 Notes

- **P4-001:** The strict guard is useful and directly checks the old false-empty condition, account default plumbing, app-wide recovery hook, pick/create persistence, failure-to-toast wiring, and ID-only store partialize block.
- **P4-002:** `currentBrandStore` grep matches `currentBrand:` / `brands:` only in historical comments and migration extraction (`currentBrandStore.ts:112-140`), while the live persisted shape remains ID-only (`:127-132`).
- **P4-003:** `getBrands(accountId)` remains newest-first via `.order("created_at", { ascending: false })` at `brandsService.ts:115-121`, satisfying the spec assumption for newest fallback.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| 1. One fetched brand with null local ID auto-selects | PASS static/automated; runtime unverified | Resolver newest fallback at `currentBrandResolver.ts:37-40`; recovery setter at `useCurrentBrandRecovery.ts:70-72`; Jest test at `currentBrandResolver.test.ts:38-46` | P2-001 runtime smoke |
| 2. Multiple brands with valid `default_brand_id` select default | PASS static/automated | Resolver server-default branch at `currentBrandResolver.ts:33-35`; tests at `currentBrandResolver.test.ts:18-26`, `:58-66` | None |
| 3. No local/no valid default selects newest | PASS static/automated | Resolver newest fallback at `currentBrandResolver.ts:37-40`; tests at `currentBrandResolver.test.ts:28-46` | None |
| 4. Valid local ID preserved | PASS | Resolver keep-local at `currentBrandResolver.ts:29-31`; test at `currentBrandResolver.test.ts:8-16` | None |
| 5. Invalid default falls back and persists replacement | PASS static/automated; runtime unverified | Invalid default test at `currentBrandResolver.test.ts:28-36`; fallback persistence at `useCurrentBrandRecovery.ts:74-87` | P2-001 runtime smoke |
| 6. True no-brands state after fetched empty list | PASS | `hasNoBrands = brandsQuery.isFetched && brands.length === 0` at `home.tsx:230`; render at `home.tsx:291-300` | None |
| 7. Loading/recovering does not show "No brands yet" | PASS | `isBrandResolving` at `home.tsx:231-234`; loading render at `home.tsx:319-326` | None |
| 8. Pick/create updates local immediately and persists default | PASS | Pick at `BrandSwitcherSheet.tsx:114-124`; create at `BrandSwitcherSheet.tsx:135-152` | None |
| 9. Default write failure visible | PASS | Toast callback at `BrandSwitcherSheet.tsx:120-123`, `:148-151`; Home callback at `home.tsx:156-158`; recovery error at `useCurrentBrandRecovery.ts:81-84` | None |
| 10. `currentBrandStore` persists only `currentBrandId` | PASS | `PersistedState` at `currentBrandStore.ts:110`; `partialize` at `:127-132`; guard PASS | None |
| 11. ORCH-0754 fake-data tests/guards pass | PASS | `npm run test:orch-0754` PASS; forbidden Home grep no matches | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Default-brand writes use existing self-update creator account RLS | None | Baseline migration has self-read/update policies at `20260505000000_baseline_squash_orch_0729.sql` lines from grep: creator self-read/update around `14226`/`14230`; service writes through normal Supabase client at `creatorAccount.ts:61-66` | PASS |
| Client does not blindly trust server default | None | Default ID must appear in fetched brand list via `hasBrandId` at `currentBrandResolver.ts:18-22` | PASS |
| No service-role edge function added | None | Scope/status checks show no ORCH-0756A edge function or migration file; product diff is business-app only plus guard/artifacts | PASS |
| Missing account update no longer silently succeeds | None | `creatorAccount.ts:67-70` throws on null returned row | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Home loading/recovery state | Shows `Loading brands` / `Getting your brand workspace ready.` instead of "No brands yet" while unresolved | None | PASS |
| Home true empty state | Shows `No brands yet` only after fetched empty brand list | None | PASS |
| Home brands-exist/no-selection state | Shows `Choose a brand` and provides button with `accessibilityLabel="Choose a brand"` | None | PASS |
| Brand switcher failure path | Default save failure remains visible as toast and local UI stays selected | None | PASS |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Static scope check | N/A | Not in ORCH-0756A scope; no mobile changes. |
| Business | Static + automated | CONDITIONAL PASS | Code/tests pass; manual sign-out smoke unverified. |
| Admin | Static scope check | N/A | No admin changes. |
| Public/web | Static scope check | N/A | No public/web changes. |
| Solo | Static + automated | PASS | Owner/account-scoped business path verified. |
| Collab | Static only | CONDITIONAL | Team-member brand-list semantics intentionally unchanged. |
| iOS | Not runtime-tested | UNVERIFIED | No native change; runtime smoke not run. |
| Android | Not runtime-tested | UNVERIFIED | No native change; runtime smoke not run. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| `default_brand_id` read/write | None | Yes | None | None | Uses existing `creator_accounts` column/RLS | No migration. |
| Active-brand recovery hook | None | Yes | None | None | Reads brands/account through client | App-wide in business layout. |
| Home state split | None | Yes | None | None | None | Preserves ORCH-0754 data sources. |
| Brand switcher default persistence | None | Yes | None | None | Existing account update RLS | Non-blocking UI write. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Existing DB support | Migration grep | PASS | None. |
| Local automated regression | Jest + strict grep + TypeScript | PASS | None. |
| Runtime sign-out/sign-in recovery | Not run; no credentials/runtime smoke in this tester pass | UNVERIFIED | Sign out/sign in with existing brand, valid default, invalid default, and no-brand account. |
| Full repo lint | `npm run lint` | FAIL external debt | Separate lint cleanup. |

## 14. Required Actions

None. I found no P0/P1 blocker and no implementor rework required for ORCH-0756A.

## 15. Conditional / Recommended Actions

1. **P2-001:** Run and record a credentialed business-app sign-out/sign-in smoke before final close if credentials/runtime are available.
2. **P2-002:** Track full `mingla-business` lint debt separately; do not block ORCH-0756A rework on unrelated files.
3. **P3-001:** Optionally remove stale `_layout.tsx` unused eslint-disable comments during a future lint hygiene pass.

## 16. Discoveries For Orchestrator

- ORCH-0756B remains the real draft persistence repair. ORCH-0756A did not change draft autosave/hydration or app-delete recovery.
- Team-member/collab active-brand recovery is still bounded by existing owner/account-scoped `getBrands(accountId)` behavior at `brandsService.ts:115-121`. If invited organisers must recover brands they can access but do not own, that needs separate forensics/spec.
- Current repo-wide `mingla-business` lint failures are broad and pre-existing; no ORCH-0756A-touched file has a lint error.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| RC-0756-B: Home says no brands when active selection is missing | YES, code/static | Home state split at `home.tsx:230-240`, `:291-326`; old condition grep no matches | No automated regression detected. |
| RC-0756-C: default brand column unused by business app | YES, code/static | `useCreatorAccount.ts:21-29`, `:61-67`; `creatorAccount.ts:4-9`, `:57-78`; switcher/recovery writes | No automated regression detected. |
| ORCH-0754 fake Home data | Still fixed | `npm run test:orch-0754` PASS; forbidden Home grep no matches | No regression. |

Retest cycle: N/A.
