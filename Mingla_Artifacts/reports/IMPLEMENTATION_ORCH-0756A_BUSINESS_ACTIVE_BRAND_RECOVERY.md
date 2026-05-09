# Implementation Report: Business Active Brand Recovery And Honest Home Empty State (ORCH-0756A)

> Date: 2026-05-08
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md`
> Status: implemented, partially verified

## 1. Layman Summary

The business app now has a real way to recover the active brand after sign-in. If the local selected-brand ID was cleared by logout, the app reads the creator account's `default_brand_id`; if that is missing or invalid, it selects the newest fetched brand and saves that as the new default. Home no longer says "No brands yet" just because no active brand has hydrated yet.

Draft-event persistence was not changed. That remains ORCH-0756B.

## 2. Request And Context

- **Request:** Implement the approved ORCH-0756A brand-selection recovery spec.
- **Source:** `$implementor` dispatch after ORCH/forensics handoff.
- **Affected surfaces:** `mingla-business` creator account service/hook, active-brand recovery, Home, brand switcher, app layout, Jest/static guards.
- **Related issues/artifacts:** `INVESTIGATION_ORCH-0756_BUSINESS_DRAFT_AND_BRAND_PERSISTENCE.md`; ORCH-0754 Home fake-data guard.

## 3. Scope

- **In scope:** read/write `creator_accounts.default_brand_id`; recover active brand from valid local ID, server default, or newest fetched brand; honest Home loading/no-brand states; brand pick/create default persistence; tests and strict guard.
- **Out of scope:** server-backed drafts, draft hydration/autosave, app-delete draft recovery, mobile/admin changes, migrations, team-member brand-list behavior.
- **Assumptions:** `getBrands(accountId)` remains newest-first and `creator_accounts.default_brand_id` already exists with usable self-update RLS.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0756A_BUSINESS_ACTIVE_BRAND_RECOVERY.md` | Implementation contract | Scope excludes drafts and requires default-brand recovery. |
| `mingla-business/src/services/creatorAccount.ts` | Persistence write path | Existing update did not support `default_brand_id` or verify a row was updated. |
| `mingla-business/src/hooks/useCreatorAccount.ts` | Account query/cache owner | Account query omitted `default_brand_id`. |
| `mingla-business/src/hooks/useBrands.ts` | Brand list query metadata | Home/recovery can use `isFetched` and newest-first brand data. |
| `mingla-business/src/store/currentBrandStore.ts` | Zustand invariant | Persisted shape is ID-only and must stay that way. |
| `mingla-business/app/(tabs)/home.tsx` | Broken UI state | Old empty condition collapsed no brands with no active selection. |
| `mingla-business/app/_layout.tsx` | App bootstrap | Needed app-wide recovery and splash readiness guard. |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | Pick/create flows | Needed non-blocking default-brand writes and visible failure callback. |

## 5. Blast Radius

- **Direct changes:** business app active-brand recovery, account preference update, Home empty/loading state, brand switcher default persistence.
- **Cascade changes:** creator-account query cache now includes `default_brand_id`; layout waits for recovery before treating null current brand as ready.
- **Parity surfaces:** business app only.
- **Cache impact:** `creatorAccountKeys.byId(user.id)` is patched on account mutation success and invalidated.
- **State boundaries:** `currentBrandStore` still persists only `currentBrandId`.
- **Auth/RLS/security:** no service-role path; client writes only through existing self-update account RLS.
- **Deploy path:** no migration, no edge function.

## 6. Old To New Receipts

### `mingla-business/src/services/creatorAccount.ts`

- **Before:** account update accepted only profile/marketing fields and could silently succeed on a zero-row update.
- **After:** exported `CreatorAccountUpdatePatch` includes `default_brand_id`; update uses `.select("id").maybeSingle()` and throws when no row returns; added `setCreatorDefaultBrand`.
- **Why:** default brand must persist server-side and write failures must not be hidden.

### `mingla-business/src/hooks/useCreatorAccount.ts`

- **Before:** query omitted `default_brand_id`; mutation duplicated raw Supabase update.
- **After:** row type/select include `default_brand_id`; mutation delegates to verified service; cache is patched and invalidated on success.
- **Why:** recovery needs the server default and immediate cache consistency.

### `mingla-business/src/utils/currentBrandResolver.ts`

- **Before:** no deterministic resolver existed.
- **After:** pure resolver implements local-valid, server-default, newest-brand, none.
- **Why:** makes selection order testable without React Native render tooling.

### `mingla-business/src/hooks/useCurrentBrandRecovery.ts`

- **Before:** no app-wide recovery existed after logout cleared local current brand.
- **After:** hook waits for brand and account queries, resolves current brand, updates local selected ID, persists newest fallback as default, and exposes save errors.
- **Why:** sign-in should recover a real brand instead of leaving Home in a false empty state.

### `mingla-business/app/_layout.tsx`

- **Before:** `currentBrandId === null` was always splash-ready.
- **After:** calls recovery app-wide and only treats null as ready when recovery is not resolving.
- **Why:** avoid booting into a false no-brand Home state while recovery is still possible.

### `mingla-business/app/(tabs)/home.tsx`

- **Before:** `brands.length === 0 || currentBrand === null` rendered "No brands yet."
- **After:** separates loading/resolving, true no-brands, brands-exist/no-selection, and populated dashboard; offers a Choose brand action when needed.
- **Why:** Home must never imply real brands disappeared.

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

- **Before:** pick/create updated local current brand only.
- **After:** pick/create immediately update local UI, then fire-and-forget save `default_brand_id`; parent gets a toast callback on failure.
- **Why:** explicit user selections should persist across sign-out without slowing the interaction.

### Tests / guards

- **Added:** `src/utils/__tests__/currentBrandResolver.test.ts`, `.github/scripts/strict-grep/orch-0756a-active-brand-recovery.mjs`, `test:orch-0756a`.
- **Why:** cover resolver order and protect against the old false-empty/state-persistence regressions.

### `Mingla_Artifacts/INVARIANT_REGISTRY.md`

- **Before:** ORCH-0756A active-brand recovery invariant was not recorded.
- **After:** added `I-PROPOSED-AA ACTIVE_BRAND_RECOVERS_FROM_SERVER_DEFAULT`.
- **Why:** spec requested registry ratification when implementation touched artifacts.

## 7. Implementation Details

- **Architecture decisions:** kept brand rows in React Query; kept Zustand ID-only; used existing Supabase client/RLS instead of adding edge functions.
- **Data flow:** auth user -> creator account query + brand list query -> resolver -> `currentBrandId` -> `useCurrentBrand`.
- **Mutation/query behavior:** explicit pick/create saves default via `useUpdateCreatorAccount`; fallback newest-brand save uses `setCreatorDefaultBrand`.
- **State handling:** resolver has loop prevention through an applied tuple; duplicate hook mounts are guarded by a module-level in-flight write set.
- **Error handling:** default save failure keeps local brand selected and surfaces `Brand selected for now. Couldn't save it as your default.`
- **Copy/accessibility:** Home now has `Loading brands`, `No brands yet`, and `Choose a brand`; choose button has an accessibility label.
- **Analytics/notifications/realtime:** not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| One fetched brand auto-selects after sign-in | Resolver newest fallback + recovery hook | Jest resolver test; TypeScript | PASS |
| Valid server default wins when no valid local ID | Resolver server-default branch | Jest resolver test | PASS |
| Invalid/missing default falls back to newest and persists | Recovery persists only `newest-brand` result | Static guard; code review; TypeScript | PASS |
| Valid local ID is preserved | Resolver keep-local branch | Jest resolver test | PASS |
| True no-brands empty state only after fetched empty list | Home `hasNoBrands` uses `brandsQuery.isFetched && brands.length === 0` | Static guard; TypeScript | PASS |
| Brands exist but selection is loading/recovering does not say no brands | Home `isBrandResolving` and `hasBrandsButNoSelection` split | Static guard; TypeScript | PASS |
| Pick/create persists default without blocking UI | Brand switcher fire-and-forget mutation after local update | Static guard; TypeScript | PASS |
| Default write failure visible | Toast callback + recovery error message | Static guard; TypeScript | PASS |
| `currentBrandStore` remains ID-only | No store change; guard inspects partialize block | `test:orch-0756a` | PASS |
| ORCH-0754 fake-data guard preserved | No event-summary fake data changed | `npm run test:orch-0754` | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Server state stays server-side | Yes | Yes | Brand rows remain React Query data. |
| Logout clears local state | Yes | Yes | No logout cleanup or store reset changes. |
| No false/fabricated data | Yes | Yes | Home no longer says "No brands yet" while brand list is loading or non-empty. |
| No persisted Brand snapshots in Zustand | Yes | Yes | Guard checks `partialize` remains `currentBrandId` only. |
| ORCH-0754 Home real-data contract | Yes | Yes | Existing ORCH-0754 guard/test pass. |
| I-PROPOSED-AA active brand recovery | Yes | Yes | Added to registry; enforced by `test:orch-0756a`. |

## 10. Parity Check

- **Mobile:** not touched; draft persistence remains a separate mobile/business concern for ORCH-0756B.
- **Business app:** implemented.
- **Admin:** not touched.
- **Public/web:** not touched.
- **Solo/collab:** owner brand-list behavior unchanged; invited/team-member query limitation remains a follow-up.
- **Gaps:** no manual device/browser sign-out/sign-in run in this pass.

## 11. Cache And Persisted State Safety

- **Query keys changed:** none.
- **Invalidations added:** `creatorAccountKeys.byId(user.id)` invalidated after account update; cache patched first.
- **Data shape changes:** `CreatorAccountRow` now includes `default_brand_id`.
- **AsyncStorage/Zustand impact:** no new persisted fields; active brand remains `currentBrandId` only.
- **Cold start behavior:** after sign-in, app can recover selected brand from server default or newest accessible brand.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0756A guard + resolver | `PATH=/opt/homebrew/bin:$PATH npm run test:orch-0756a` | PASS | 22 guard checks; 6 Jest tests. |
| ORCH-0754 regression | `PATH=/opt/homebrew/bin:$PATH npm run test:orch-0754` | PASS | Existing Home fake-data guard and 5 Jest tests. |
| Resolver direct Jest | `PATH=/opt/homebrew/bin:$PATH npx jest currentBrandResolver.test` | PASS | 6 tests. |
| TypeScript | `PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit` | PASS | No output. |
| Full lint | `PATH=/opt/homebrew/bin:$PATH npm run lint` | FAIL, unrelated existing errors | 80 errors / 107 warnings; no ORCH-0756A-touched file has lint errors. |
| Touched-file lint | `PATH=/opt/homebrew/bin:$PATH npx eslint app/_layout.tsx 'app/(tabs)/home.tsx' src/components/brand/BrandSwitcherSheet.tsx src/hooks/useCreatorAccount.ts src/hooks/useCurrentBrandRecovery.ts src/services/creatorAccount.ts src/utils/currentBrandResolver.ts src/utils/__tests__/currentBrandResolver.test.ts` | PASS with warnings | 0 errors; 3 pre-existing `_layout.tsx` unused eslint-disable warnings. |

Full lint error files:

- `app/__styleguide.tsx`
- `app/account/delete.tsx`
- `app/event/[id]/guests/[guestId].tsx`
- `app/event/[id]/index.tsx`
- `src/components/brand/BrandEditView.tsx`
- `src/components/brand/BrandStripeCountryPicker.tsx`
- `src/components/brand/BrandStripeOrphanedRefundsSection.tsx`
- `src/components/brand/PublicBrandNotFound.tsx`
- `src/components/event/CreatorStep2When.tsx`
- `src/components/event/CreatorStep7Preview.tsx`
- `src/components/event/EditAfterPublishBanner.tsx`
- `src/components/event/PublicEventNotFound.tsx`
- `src/components/event/PublicEventPage.tsx`
- `src/components/event/TicketTierEditSheet.tsx`
- `src/components/guests/AddCompGuestSheet.tsx`
- `src/components/notifications/BusinessNotificationsScreen.tsx`
- `src/components/onboarding/MinglaToSAcceptanceGate.tsx`
- `src/components/orders/CancelOrderDialog.tsx`
- `src/components/orders/MaterialChangeBanner.tsx`

## 13. Regression Surface

1. **Auth bootstrap / splash:** layout now waits on recovery when a null current ID may still recover.
2. **Brand switcher:** default-brand save runs after immediate local selection; failure produces toast but does not roll back local UI.
3. **Home empty states:** state copy changed around brand loading/no-selection.
4. **Creator account mutation:** rowcount verification may reveal previously silent missing-account update failures.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Full lint suite has unrelated debt | CI lint remains red until existing errors are cleaned | Separate lint cleanup ORCH | Files listed in verification section |
| Team-member brand list remains owner-oriented | Invited collaborators may still not see expected brands | Separate team-member brand query spec | `useBrands(accountId)` / `getBrands(accountId)` |
| No manual sign-out/sign-in run | Automated proof covers resolver and static contracts, not device UX | Tester/browser/device QA | business app |

## 15. Discoveries For Orchestrator

- The existing owner/account scoped brand-list behavior was intentionally not changed. If invited team members need active-brand recovery, forensics should spec accessible-brand list semantics separately.
- `npm run lint` is currently blocked by broad pre-existing lint errors unrelated to ORCH-0756A.

## 16. Deploy Notes

- **Migrations:** none.
- **Edge functions:** none.
- **Mobile OTA/native:** none.
- **Business/admin web:** business app code only.
- **Env vars/secrets:** none.

## Suggested Commit Message

```text
business: recover active brand after sign-in

Resolves: ORCH-0756A
Evidence: test:orch-0756a, test:orch-0754, currentBrandResolver.test, tsc
Deploy: no migration or edge deploy
```

## Ready-To-Test Checklist

1. Sign in as a business user with one brand and no local selected brand; Home should select that brand and show the dashboard.
2. Sign in with multiple brands and `creator_accounts.default_brand_id` set to one accessible brand; that brand should become active.
3. Set `default_brand_id` to an inaccessible/deleted brand; sign in should fall back to the newest fetched brand and save it as default.
4. Sign in with no brands; Home should show "No brands yet."
5. Pick or create a brand, sign out, sign back in; that brand should recover as active.
