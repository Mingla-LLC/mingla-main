# Spec: Business Active Brand Recovery And Honest Home Empty State (ORCH-0756A)

> Date: 2026-05-08
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0756_BUSINESS_DRAFT_AND_BRAND_PERSISTENCE.md`
> Root cause: RC-0756-B and RC-0756-C
> Status: ready for implementation

## 1. Layman Summary

When a business user signs back in, the app should remember or recover which brand they are working on. Today the real brand still exists in Supabase, but the selected-brand pointer was only local and gets wiped on sign-out. The app then shows a false "No brands yet" state.

This spec fixes only that brand-selection recovery path. It does not solve draft persistence; that remains ORCH-0756B.

## 2. User Story

As a business organiser, I want the app to automatically select my real brand after sign-in, so that Home does not make it look like my brand disappeared.

## 3. Scope

- **In scope:**
  - Read `creator_accounts.default_brand_id` in `mingla-business`.
  - Write `creator_accounts.default_brand_id` when the user picks or creates a brand.
  - Add a deterministic current-brand resolver:
    1. keep valid local `currentBrandId`;
    2. else use valid `creator_accounts.default_brand_id`;
    3. else use newest valid brand from the fetched brand list;
    4. else no brand selected.
  - Fix Home so "No brands yet" only appears after the brand list has fetched and is truly empty.
  - Add repo-running regression tests and strict/static guards.
- **Non-goals:**
  - Server-backed event drafts, draft autosave, draft hydration, or app-delete draft recovery.
  - Orders, door sales, scans, guests, team/scanner invitations, audit logs, or notification prefs.
  - Persisting full Brand objects in Zustand.
  - Fixing the owner-only brand-list query for invited team members; record as a follow-up if touched.
  - Mobile/admin/marketing changes.
- **Assumptions:**
  - `getBrands(accountId)` returns newest-created brands first today via `.order("created_at", { ascending: false })`.
  - "Valid brand" means the brand ID appears in the current accessible brand list returned to the signed-in user.
  - The current owner-only brand-list behavior remains unchanged in this spec.
- **Dependencies:**
  - Existing `creator_accounts.default_brand_id` column, FK, index, and creator self-read/update RLS.
  - Existing React Query setup in `mingla-business`.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Read/write `default_brand_id` | RC-0756-C; baseline migration has column, FK, index, RLS | High |
| Keep Zustand ID-only | ORCH-0742/0743, `currentBrandStore.ts` v14, I-PROPOSED-J | High |
| Recover active brand after sign-in | RC-0756-B, RC-0756-C | High |
| Home must not say "No brands yet" when brands exist | Finding 2, `home.tsx` false empty condition | High |
| Preserve logout cleanup | README Constitution #6 and investigation contradiction analysis | High |
| Do not include drafts | Orchestrator split: ORCH-0756B owns server-backed drafts | High |

## 5. Success Criteria

1. A user with exactly one fetched brand and `currentBrandId === null` gets that brand selected automatically after sign-in.
2. A user with multiple fetched brands and a valid `creator_accounts.default_brand_id` gets the default brand selected.
3. A user with no local current brand and no valid server default gets the newest fetched brand selected.
4. If the persisted local `currentBrandId` is valid for the fetched list, the resolver leaves it alone.
5. If `creator_accounts.default_brand_id` points to a missing, deleted, or inaccessible brand, the resolver does not select it; it falls back to newest fetched brand and persists that replacement as the new default.
6. If no brands exist after the brand-list query fetches, Home renders the true no-brands empty state.
7. If brands exist but selection/default resolution is loading or recovering, Home does not render "No brands yet."
8. Explicit brand pick/create updates local `currentBrandId` immediately and attempts to persist the selected brand ID to `creator_accounts.default_brand_id`.
9. Default-brand write failure is visible to the user and not silently swallowed.
10. `currentBrandStore` continues to persist only `currentBrandId`; no full Brand snapshot or brand list returns to Zustand.
11. ORCH-0754 Home fake-data tests/guards still pass.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| Constitution #5: server state stays server-side | Brand rows stay in React Query; Zustand stores only active ID | Strict grep/static test against `currentBrandStore` persisted shape |
| Constitution #6: logout clears local state | Do not remove `clearAllStores()` or `currentBrandStore.reset()` | Static grep and sign-out recovery test |
| Constitution #9: no false/fabricated data | Home no longer says no brands when brands exist | Home state helper/unit test or strict static guard |
| I-PROPOSED-J: no persisted Brand snapshots in Zustand | No `currentBrand` object in persisted Zustand state | Regression test/grep |
| ORCH-0754 Home real-data contract | Do not reintroduce fake event rows or hardcoded event signatures | `npm run test:orch-0754` |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| `I-PROPOSED-AA ACTIVE_BRAND_RECOVERS_FROM_SERVER_DEFAULT` | `mingla-business` current-brand recovery | Active brand may be locally cached as an ID, but after auth/bootstrap the selected ID must resolve from valid local ID, valid server default, or fetched-brand fallback | `test:orch-0756a` resolver tests and Home false-empty guard |

Add this invariant to `Mingla_Artifacts/INVARIANT_REGISTRY.md` during implementation if the implementor touches artifacts; otherwise orchestrator may ratify at close.

## 7. Database / RLS / Migration

```sql
-- Migration: None expected.
```

- **Latest-migration check:** Forensics checked `creator_accounts.default_brand_id` in the baseline squash and later migration search. Later migrations through current max local `20260514000000_b2a_v3_brand_owner_team_member_trigger.sql` do not remove this column or its self-write RLS.
- **Existing schema used:**
  - `creator_accounts.default_brand_id uuid`
  - FK: `creator_accounts.default_brand_id -> brands.id ON DELETE SET NULL`
  - Index: `idx_creator_accounts_default_brand_id`
  - RLS: creators can read/update their own `creator_accounts` row.
  - Brands are selectable to authenticated brand members.
- **RLS behavior:** Client must only write a default brand ID that appears in the fetched accessible brand list. DB RLS on `creator_accounts` permits self-update but cannot by itself prove the referenced brand is accessible. The resolver must therefore treat inaccessible defaults as invalid.
- **Backfill/data migration:** None. Existing users with `default_brand_id = null` recover via newest brand fallback, and that fallback should persist the chosen ID.
- **Rollback:** Revert client reads/writes only. Schema remains untouched.
- **If migration becomes necessary:** Use a filename prefix greater than `20260514000000`, and record why the no-migration assumption failed.

## 8. Edge Functions / RPCs / Webhooks

None. The existing Supabase client path and RLS are sufficient for this scoped fix.

Do not add a service-role edge function for this. It would be unnecessary for self-owned account preference writes and would increase blast radius.

## 9. Service Layer

### `updateCreatorAccount`

- **Path:** `mingla-business/src/services/creatorAccount.ts`
- **Required signature change:**

```ts
export interface CreatorAccountUpdatePatch {
  display_name?: string;
  avatar_url?: string | null;
  marketing_opt_in?: boolean;
  default_brand_id?: string | null;
}

export async function updateCreatorAccount(
  userId: string,
  patch: CreatorAccountUpdatePatch,
): Promise<void>
```

- **Query/client behavior:** use `.from("creator_accounts").update(patch).eq("id", userId).select("id").maybeSingle()` or equivalent row-returning update.
- **Error contract:**
  - throw on Supabase error;
  - throw if no row is returned, closing the existing rowcount-waiver class for this touched function;
  - do not silently succeed on 0-row update.
- **Return type:** `Promise<void>`.
- **Validation:** service may accept `default_brand_id` as `string | null`; caller is responsible for only passing IDs from accessible brand list.

### Optional helper: `setCreatorDefaultBrand`

- **Path:** either `mingla-business/src/services/creatorAccount.ts` or `mingla-business/src/hooks/useCreatorAccount.ts`.
- **Signature:**

```ts
export async function setCreatorDefaultBrand(
  userId: string,
  brandId: string | null,
): Promise<void>
```

- **Behavior:** thin wrapper around `updateCreatorAccount(userId, { default_brand_id: brandId })`.
- **Reason:** keeps call sites from constructing account patches by hand.

## 10. Hook / State / Cache Layer

### `useCreatorAccount`

- **Path:** `mingla-business/src/hooks/useCreatorAccount.ts`
- **Data type:** add `default_brand_id: string | null` to `CreatorAccountRow`.
- **Select:** include `default_brand_id` in the Supabase select.
- **Update patch:** include `default_brand_id?: string | null`.
- **Query key:** keep `creatorAccountKeys.byId(userId)`.
- **Mutation behavior:** `useUpdateCreatorAccount` should delegate to `updateCreatorAccount` service rather than duplicating raw Supabase update logic, unless the implementor keeps the existing inline path and adds row-returning verification there too.
- **Invalidation/update:** on success, invalidate `creatorAccountKeys.byId(user.id)`. Prefer also patching the query cache for `default_brand_id` immediately after default-brand mutation so resolver does not flicker.

### New pure resolver utility

- **Path:** `mingla-business/src/utils/currentBrandResolver.ts`
- **Types:**

```ts
export type CurrentBrandResolveReason =
  | "keep-local"
  | "server-default"
  | "newest-brand"
  | "none";

export interface ResolveCurrentBrandInput {
  currentBrandId: string | null;
  defaultBrandId: string | null;
  brands: Array<{ id: string }>;
}

export interface ResolveCurrentBrandResult {
  brandId: string | null;
  reason: CurrentBrandResolveReason;
}
```

- **Rules:**
  - if `currentBrandId` is non-null and appears in `brands`, return it with `keep-local`;
  - else if `defaultBrandId` is non-null and appears in `brands`, return it with `server-default`;
  - else if `brands[0]` exists, return `brands[0].id` with `newest-brand`;
  - else return `null` with `none`.
- **Why pure:** lets `ts-jest` cover all selection behavior without React Native render tooling.

### New hook: `useCurrentBrandRecovery`

- **Path:** `mingla-business/src/hooks/useCurrentBrandRecovery.ts`
- **Inputs:** none; internally reads:
  - `useAuth()` for `user`;
  - `useBrands(user?.id ?? null)` for brands plus query metadata;
  - `useCreatorAccount()` for default ID plus query metadata;
  - `useCurrentBrandStore` for `currentBrandId` and setter;
  - default-brand mutation helper.
- **Return type:**

```ts
export interface CurrentBrandRecoveryState {
  isResolving: boolean;
  isError: boolean;
  errorMessage: string | null;
}
```

- **Execution gate:**
  - do nothing while `user` is null;
  - do nothing while brand list or creator account query is loading/not fetched;
  - do nothing when brand list is empty except ensure `currentBrandId` is null if it points to an inaccessible brand;
  - compute `resolveCurrentBrand(...)` once data is ready.
- **Mutation behavior:**
  - If resolver returns `keep-local`, do not mutate server default.
  - If resolver returns `server-default`, call `setCurrentBrandId(defaultBrandId)` only.
  - If resolver returns `newest-brand`, call `setCurrentBrandId(newestId)` and persist `{ default_brand_id: newestId }`.
  - If resolver returns `none`, call `setCurrentBrandId(null)` only if needed.
- **Loop prevention:** track the last applied tuple (`userId`, `currentBrandId`, `defaultBrandId`, joined brand IDs, result reason) with a `useRef`, or equivalent, so repeated renders do not spam `default_brand_id` updates.
- **Error behavior:**
  - If fallback persistence fails after setting local current brand, keep the local brand selected and expose `isError/errorMessage` for UI toast: `Brand selected for now. Couldn't save it as your default.`
  - Do not clear the local current brand just because the default write failed.
- **Zustand/AsyncStorage/sign-out cleanup:** no change to `currentBrandStore.reset()` or `clearAllStores()`. Recovery happens after next sign-in.

### Root/layout wiring

- **Path:** `mingla-business/app/_layout.tsx`
- **Requirement:** call `useCurrentBrandRecovery()` in `RootLayoutInner` after auth context is available so recovery is app-wide, not only Home-specific.
- **Splash gate:** Update the brand-ready gate so `currentBrandId === null` is not automatically considered "ready" when the signed-in user has brands and the recovery hook is still resolving. The gate may still keep the existing 2s timeout behavior; after timeout, Home must show a resolving/loading state rather than false "No brands yet."

## 11. Component / Screen Layer

### `BrandSwitcherSheet`

- **Path:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`
- **New behavior on pick:**
  - immediately call `setCurrentBrand(brand)`;
  - close sheet immediately;
  - persist default brand via mutation;
  - if mutation fails, surface visible failure through parent toast or local sheet/toast boundary.
- **New behavior on create:**
  - after `createBrand` returns server brand, call `setCurrentBrand(newBrand)`;
  - persist `default_brand_id = newBrand.id`;
  - call `onBrandCreated`;
  - if default persistence fails, keep brand selected locally and show warning copy.
- **Suggested prop addition:**

```ts
onDefaultBrandSaveError?: (message: string) => void;
```

Parent screens can route this into the existing `Toast`.

- **Copy for default-save failure:** `Brand selected for now. Couldn't save it as your default.`
- **Do not block brand switching on default persistence:** preserving immediate UI response satisfies no-dead-taps.

### `HomeTab`

- **Path:** `mingla-business/app/(tabs)/home.tsx`
- **Required state split:**

| State | Condition | Renders |
|---|---|---|
| Brand list loading/recovery resolving | user exists and brand/creator query not settled, or `useCurrentBrandRecovery().isResolving` | neutral loading/skeleton/resolving copy; must not say "No brands yet" |
| No brands | brand list fetched, `brands.length === 0` | existing "No brands yet" create-brand prompt |
| Brands exist but no selected brand after recovery/error | brand list fetched, `brands.length > 0`, `currentBrand === null`, recovery not resolving | "Choose a brand" style state with top-bar/switcher action, not "No brands yet" |
| Populated | `currentBrand !== null` | existing ORCH-0754 real-data dashboard |

- **Existing bug to remove:** `const isEmpty = brands.length === 0 || currentBrand === null`.
- **Required replacement:** derive separate booleans such as `hasNoBrands`, `isBrandResolving`, `hasBrandsButNoSelection`, and `hasSelectedBrand`.
- **Build-event behavior:** when brands exist but no selection remains after recovery error, opening the brand switcher is acceptable. Copy must not say "Create a brand first."
- **ORCH-0754 preservation:** do not change `buildBrandEventSummary`, fake-data guards, event rows, or KPI logic except where current-brand gating requires it.

### Other business screens

- **Events tab:** No required UI change for this spec, but app-wide recovery from `_layout.tsx` should benefit it. If the implementor finds a false "create/select brand" copy identical to Home, document but do not expand unless it blocks the app-wide resolver.
- **TopBar:** No required change unless loading/selection state creates an obvious false label. Do not persist Brand snapshots to solve TopBar display.

## 12. Business / Admin / Public Parity

- **Business app:** In scope.
- **Admin:** None.
- **Public/web share pages:** None.
- **Mobile consumer app:** None.
- **Operational dependency:** None; existing schema supports the fix.

## 13. Realtime / Notifications / Analytics

None required.

Optional telemetry may be added only if a local analytics pattern already exists in `mingla-business`; do not create a new analytics subsystem for this spec.

## 14. Implementation Order

1. Update `CreatorAccountRow`, select list, and update patch to include `default_brand_id`.
2. Refactor `useUpdateCreatorAccount` / `updateCreatorAccount` so creator-account updates are row-verified and can update `default_brand_id`.
3. Add `currentBrandResolver.ts` pure utility and unit tests.
4. Add `useCurrentBrandRecovery.ts` hook with query gating, loop prevention, local-ID preservation, fallback persistence, and surfaced error state.
5. Wire `useCurrentBrandRecovery()` into `app/_layout.tsx`; adjust splash/brand readiness so resolving is not mistaken for "ready empty."
6. Update `BrandSwitcherSheet` pick/create flows to persist the selected default brand and surface failure through existing toast/inline patterns.
7. Update `HomeTab` to separate no-brands, resolving, no-selection, and populated states.
8. Add strict/static regression script for ORCH-0756A and package script `test:orch-0756a`.
9. Run required verification commands and write implementation report.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-0756A-01 | Keep valid local selection | `currentBrandId=B`, `defaultBrandId=A`, `brands=[B,A]` | resolver returns `B`, reason `keep-local` | util | Jest |
| T-0756A-02 | Use valid server default | `currentBrandId=null`, `defaultBrandId=A`, `brands=[B,A]` | resolver returns `A`, reason `server-default` | util | Jest |
| T-0756A-03 | Invalid server default fallback | `currentBrandId=null`, `defaultBrandId=Z`, `brands=[B,A]` | resolver returns `B`, reason `newest-brand` | util | Jest |
| T-0756A-04 | Newest fallback with no default | `currentBrandId=null`, `defaultBrandId=null`, `brands=[B,A]` | resolver returns `B`, reason `newest-brand` | util | Jest |
| T-0756A-05 | No brands | `currentBrandId=null`, `defaultBrandId=null`, `brands=[]` | resolver returns null, reason `none` | util | Jest |
| T-0756A-06 | Invalid local but valid default | `currentBrandId=Z`, `defaultBrandId=A`, `brands=[B,A]` | resolver returns `A`, reason `server-default` | util | Jest |
| T-0756A-07 | Creator account query includes default | mocked/select inspection or isolated hook/service test | selected columns include `default_brand_id` | service/hook | Jest or strict grep |
| T-0756A-08 | Default update is row-verified | mocked Supabase update returns no row | update throws | service | Jest |
| T-0756A-09 | Brand pick persists default | mocked mutation path for `handlePick` or extracted helper | local ID set and default mutation receives brand ID | component/helper | Jest or focused helper test |
| T-0756A-10 | Brand create persists default | mocked create returns brand | local ID set and default mutation receives new brand ID | component/helper | Jest or focused helper test |
| T-0756A-11 | Home brands exist/no selection | static/helper state says brands fetched > 0 and current brand null | no "No brands yet"; shows resolving or choose-brand state | UI/static | Jest helper or strict grep |
| T-0756A-12 | No full Brand snapshot regression | inspect `currentBrandStore` persisted shape | partialize contains only `currentBrandId`; no persisted `currentBrand`/`brands` | static | strict grep script |
| T-0756A-13 | ORCH-0754 preserved | existing Home fake-data guard | pass | regression | `npm run test:orch-0754` |

Required commands after implementation:

```bash
cd mingla-business && npm run test:orch-0756a
cd mingla-business && npm run test:orch-0754
cd mingla-business && npx jest currentBrandResolver.test
cd mingla-business && npx tsc --noEmit
cd mingla-business && npm run lint
```

If full lint remains red from known unrelated debt, the implementation report must include the exact failing files and prove no ORCH-0756A-touched files are involved.

## 16. Regression Prevention

- **Structural safeguard:** central pure resolver `resolveCurrentBrandId` owns the fallback order.
- **Test:** add `mingla-business/src/utils/__tests__/currentBrandResolver.test.ts`.
- **Strict/static script:** add `.github/scripts/strict-grep/orch-0756a-active-brand-recovery.mjs` or equivalent. It must fail if:
  - `currentBrandStore` partialize persists anything other than `currentBrandId`;
  - `useCreatorAccount` select omits `default_brand_id`;
  - Home contains the old combined condition `brands.length === 0 || currentBrand === null`;
  - Home renders `"No brands yet"` in a branch not guarded by a fetched empty brand list, as far as static checks can reasonably detect.
- **Package script:** add `test:orch-0756a` chaining the strict script plus resolver Jest test.
- **Protective comments:** add short comments near resolver fallback and Home state split explaining that "no selected brand" is not "no brands."
- **Artifact update:** implementation report should propose ratifying `I-PROPOSED-AA` at close.

## 17. Rollback And Deploy Safety

- **Migration order:** None.
- **Edge function deploy:** None.
- **Mobile OTA vs native build:** Business app JS-only change; no native dependency expected. OTA/web deployment acceptable under existing business-app deploy process.
- **Business/admin web deploy:** Business app only.
- **Env vars/secrets:** None.
- **Partial rollback risk:** If the UI changes deploy without default-brand persistence, Home may stop lying but selection may still not recover reliably. If persistence deploys without Home state split, users can still see false "No brands yet" during resolving. Ship as one scoped change.
- **Data safety:** Writing `default_brand_id` is reversible and nullable. Invalid defaults are ignored by resolver and replaced with a valid fallback when available.

## 18. Common Mistakes

1. Do not preserve local `currentBrandId` through logout to solve this. Logout cleanup is intentional; recovery should come from server-backed account/brand state.
2. Do not put full Brand rows back into Zustand.
3. Do not let `useBrandList()` hide loading state in Home; the UI needs fetched/loading metadata to distinguish no brands from not-yet-loaded brands.
4. Do not silently ignore failed `default_brand_id` writes.
5. Do not expand into ORCH-0756B draft persistence.
6. Do not fix team-member brand listing unless the implementor proves it is required for this active-brand recovery; if found, document as follow-up.

## 19. Handoff To Implementor

Implement ORCH-0756A as a focused brand-selection recovery fix. Start with `creator_accounts.default_brand_id` plumbing, then add a pure resolver and recovery hook, then wire `_layout`, `BrandSwitcherSheet`, and Home's state split. Keep `currentBrandStore` ID-only and keep logout clearing intact. Add `test:orch-0756a`, keep `test:orch-0754` green, and report any existing lint debt separately from touched files.
