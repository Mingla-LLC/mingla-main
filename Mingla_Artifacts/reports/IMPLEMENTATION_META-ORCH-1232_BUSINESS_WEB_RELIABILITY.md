# IMPLEMENTATION — META-ORCH-1232: Business Web Reliability + Brand-Creation Persistence

Mode: IMPLEMENT. Surface: **mingla-business** (web + native; bug manifests on web). No schema migration (per SPEC §1.2). Branch: `orch-1232-business-web-reliability`. All paths under `mingla-business/` unless noted.

Built exactly to `SPEC_META-ORCH-1232_BUSINESS_WEB_RELIABILITY.md`. No scope widening; no public/anon path gated; no `app-mobile/`, account-deletion, or Ari-tool change.

---

## Files changed, per fix

### C1 — optimistic temp-id never reaches a uuid column / the current-brand pointer
- **NEW `src/utils/brandId.ts`** — single shared validator (Constitution #4). `isPersistedBrandId(id)` = strict RFC-4122 UUID (rejects every `_temp_…` base-36 id and any non-uuid). Exports `InvalidBrandIdError` + `TEMP_BRAND_ID_PREFIX`.
- **`src/utils/currentBrandResolver.ts`** — import at `:5`; `hasBrandId` now also requires `isPersistedBrandId` (`:32`); the "newest-brand" fallback selects the newest **persisted** brand via `brands.find(b => isPersistedBrandId(b.id))` (`:51`) instead of `brands[0]`. A zero-persisted-brand list (temp row only) returns `{brandId:null, reason:"none"}`.
- **`src/hooks/useCurrentBrandRecovery.ts`** — import at `:6`; belt guard in `runBrandRecoveryWrite` (`:111`): a non-null, non-persisted `resolution.brandId` short-circuits the write (no `setCurrentBrandId`, no `setCreatorDefaultBrand`). A null brandId ("none") is still a legitimate clear.
- **`src/services/creatorAccount.ts`** — import at `:7`; `setCreatorDefaultBrand` (`:101-102`) throws `InvalidBrandIdError` and issues NO update for a non-null non-uuid id (null clear still allowed).
- **`src/services/brandsService.ts`** — import at `:43`; `getBrand` (`:735`) returns `null` for a non-persisted id BEFORE issuing `.eq("id", …)` (clean miss, no 22P02).

### C2 — brand mutations auth-ready-gated (await-until-ready ≤5s → throw)
- **NEW `src/utils/authReadyGate.ts`** — `AuthNotReadyError`, `isAuthNotReadyError`, and `awaitAuthReady({isReady, capMs=5000, pollMs=100})`: resolves immediately if ready, polls until ready within the 5s cap, else throws `AuthNotReadyError`. Never silently drops.
- **`src/hooks/useBrands.ts`** — import at `:32`; new `useIsAuthReadyGetter()` ref-backed getter (`:271`) keeps the latest `isAuthReady` readable from the imperative `mutationFn`. All three mutation hooks `await awaitAuthReady(...)` in `mutationFn` before the service call: `useCreateBrand` (`:302`), `useUpdateBrand` (`:393`), `useCreateVenueBrand` (`:637`).
- **`src/components/brand/BrandCreationFlow.tsx`** — `const { user, isAuthReady } = useAuth();` (`:239`); create CTA `disabled` adds `|| !isAuthReady` (former `:824`); address CTA `disabled` adds `|| !isAuthReady` (former `:843`).

### H1 — write failures surface persistently + retryably (no lone auto-dismiss toast)
- **`src/components/brand/BrandCreationFlow.tsx`** — new persistent `writeError` state `{message, retry}` (`:315`); copy keys `createErrorInline` / `saveErrorInline` / `authNotReadyInline` ("Finishing sign-in… tap Retry in a moment.") / `retryCta` added to `BRAND_CREATION_COPY`. `handleCreateIdentity` catch (`:377`): non-`SlugCollisionError` failures set `writeError` (distinct AuthNotReady copy via `isAuthNotReadyError`) instead of a lone toast; `handleContinueAddress` catch (`:437`) same. Inline error region (`accessibilityRole="alert"` + Retry `Button onPress={writeError.retry}`) rendered in step 1 (`:680`) and step 2. The wizard does not advance on throw (`brandCreated` only dispatches after a successful `mutateAsync`); typed values are retained. `setWriteError(null)` clears on each fresh attempt. New `inlineError`/`inlineErrorText` styles. `SlugCollisionError` stays an inline form toast (user-correctable input).

### H2 — owned brand never invisible due to trigger lag/failure
- **`src/services/brandsService.ts`** — `getBrands` now reads `from("brands").select("*").eq("account_id", accountId).is("deleted_at", null)` (`:543`) IN ADDITION to the existing `brand_team_members` read, and UNIONs the directly-owned rows (`role:"brand_owner"`, de-duped by id) into the result. Non-owner membership visibility (ORCH-1081) preserved; both reads keep `deleted_at IS NULL`.

### H3 — auth-warm anon-empty read not cached as authed-empty
- **`src/services/brandsService.ts`** — `getBrands` calls `supabase.auth.getSession()` FIRST (`:501`, a local read, no network) and throws `BrandsAuthSessionNotAttachedError` (`:503`, new error class at `:97`) when no session/user is attached — BEFORE any list read — so React Query stays LOADING/retries instead of caching `[]` as authed-success during the interior auth-warm window.

### Auth-ready gate behavior (await → throw)
`awaitAuthReady` returns immediately if `isReady()` is already true; otherwise it polls every 100ms until ready within a 5000ms cap. If auth becomes ready within the window the mutation proceeds (now correctly authed). If the cap elapses still not ready, it throws `AuthNotReadyError`, which `BrandCreationFlow` catches and renders as a **persistent, retryable** inline error (distinct "Finishing sign-in…" copy) — the user's intent is preserved as an explicit retry, never silently discarded.

---

## Public / anon paths confirmed UNTOUCHED (no gate added)
Verified by inspection AND enforced by gate F:
- `src/utils/coldLoadAuthGates.ts` — `PUBLIC_BUYER_ROUTE_PREFIXES` (`:135`) and `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (`:208`) membership UNCHANGED (gate F snapshots both exactly).
- `src/hooks/usePublicEvents.ts` (`usePublicBrandBySlug`) — NO `isAuthReady`.
- `src/services/publicEventsService.ts` (`getPublicBrandBySlug`) — NO `isAuthReady`.
- `src/hooks/useBrands.ts` single-by-id `useBrand` (`:203-256`) — UNGATED (no `isAuthReady`). C1 instead keeps the `_temp_` id from ever reaching it.

No file under `app-mobile/` changed; no account-deletion path; no Ari tools; no schema migration.

---

## CI gates added (`.github/scripts/strict-grep/`, registered in `strict-grep-mingla-business.yml`)
Each has `--self-test`; all 5 self-tests + live runs PASS on the fix.

| Gate | Script | Proven fails-on-revert |
|------|--------|------------------------|
| I-PROPOSED-1232-A (C1) | `i-proposed-1232-a-no-temp-id-to-uuid.mjs` | Removed `isPersistedBrandId` from the resolver → `FAIL [guarded-sink] … resolver does NOT reference isPersistedBrandId` (1 violation). |
| I-PROPOSED-1232-B (C2) | `i-proposed-1232-b-brand-mutations-auth-gated.mjs` | Removed the 3 `awaitAuthReady` calls → `FAIL [hook-auth-gated]` ×3 for useCreateBrand/useUpdateBrand/useCreateVenueBrand (3 violations). |
| I-PROPOSED-1232-D (H2) | `i-proposed-1232-d-getbrands-owner-union.mjs` | Removed the `brands.account_id` owner read → `FAIL [owner-union-read]` + `[owner-deleted-filter]` (2 violations). |
| I-PROPOSED-1232-E (H3) | `i-proposed-1232-e-useBrands-no-anon-empty-success.mjs` | Replaced the throw with `return []` → `FAIL [throws-not-attached]` (1 violation). |
| I-PROPOSED-1232-F (PUBLIC-SAFETY, CLOSE-BLOCKING) | `i-proposed-1232-f-public-paths-ungated.mjs` | Gated `useBrand` + dropped `/booking/` from the buyer prefixes → `FAIL [F2: useBrand-ungated]` + `[F3: buyer-prefixes-frozen]` (2 violations). |

Note: gate F deliberately does NOT ban the `isAuthReady` token from `coldLoadAuthGates.ts` (it is a legitimate PARAMETER name in `shouldGateColdLoad`); it pins the two route-prefix lists to an exact snapshot instead.

---

## Jest coverage (all PASS — 55 tests / 9 suites)
- `src/utils/__tests__/brandId.metaOrch1232.test.ts` — C1 validator (uuid accept; `_temp_`/non-uuid/null reject; InvalidBrandIdError).
- `src/utils/__tests__/authReadyGate.metaOrch1232.test.ts` — C2 await-until-ready: immediate-ready, ready-mid-flight, cap-elapse throws AuthNotReadyError.
- `src/services/__tests__/brandsServiceMetaOrch1232.test.ts` — H3 (no session → throws, no list read fires; session → proceeds), H2 (owned brand surfaces with no membership row; de-dup), C1 (`getBrand("_temp_…")`/non-uuid → null, no query).
- `src/services/__tests__/setCreatorDefaultBrandMetaOrch1232.test.ts` — C1 (`_temp_`/non-uuid → InvalidBrandIdError, no update; null clear + real uuid proceed).
- `__tests__/components/BrandCreationFlow.metaOrch1232.test.tsx` — H1 (persistent writeError + Retry; non-collision routes to inline error not lone toast; AuthNotReady distinct copy; no step advance on throw) + C2 (CTAs gated on !isAuthReady).
- `src/utils/__tests__/currentBrandResolver.test.ts` — **MODIFIED** `[TEST-MOD-APPROVED META-ORCH-1232]` (fixtures switched to real UUIDs since the resolver now requires persisted ids; added C1 temp-id-ineligible cases).
- `src/hooks/__tests__/useCurrentBrandRecovery.orch1133.singleWriter.test.ts` — **MODIFIED** `[TEST-MOD-APPROVED META-ORCH-1232]` (fixture brandId → real UUID; added C1 belt-guard cases: `_temp_` resolution writes nothing; null "none" clear still writes).

Typecheck: `npx tsc --noEmit` is clean for every changed source + new test file (the pre-existing repo-wide errors — react-dom/server render-test deps, app.config.ts, richEditor, IconChrome, Sheet.web — are unrelated and present on origin/main).
