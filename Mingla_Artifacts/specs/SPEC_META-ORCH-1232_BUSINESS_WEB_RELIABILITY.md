# SPEC — META-ORCH-1232: Business Web Reliability + Brand-Creation Persistence

Mode: SPEC (binding build contract). Surface: **mingla-business** (web + native; the bug manifests on **web**). Backend: Supabase `gqnoajqerqhnvulmnyvv` (LIVE prod) — **no schema migration required by this spec**; all fixes are client/RLS-timing-shaped.

Source of truth: `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1232_BUSINESS_WEB_RELIABILITY.md`, including its `## SECOND-PASS VALIDATION` section (authoritative, re-verified). Every file:line below was re-confirmed against THIS worktree (`orch-1232-business-web-reliability`).

This document is a contract. The implementor builds **exactly** what is here — no more (no scope widening), no less (no half-fixes). Where this spec says "MUST", a CLOSE is blocked until it is true and CI-proven.

---

## 0. The bug in one paragraph (so the implementor cannot misread intent)

A business user with **zero brands** (Seth's exact state: `creator_accounts.default_brand_id = NULL`, no `brands` row, no `brand_team_members` row) creates a brand on **business web**. The brand silently does **not** persist, and the switcher relapses to "create a new brand." Two independent client defects combine to cause it: (1) the brand-create mutation is **not auth-ready-gated**, so it can fire during the auth-warm window (fresh sign-in / token refresh) and be rejected by the `brands` INSERT RLS `WITH CHECK (account_id = auth.uid())` while the client is still effectively anon — and that rejection collapses into a single auto-dismissing toast indistinguishable from "nothing happened"; and (2) the optimistic `_temp_…` brand id minted by `useCreateBrand.onMutate` leaks into the authoritative current-brand pointer and the `setCreatorDefaultBrand` UPDATE + `getBrand(.eq("id", …))` — both **uuid** columns — producing Postgres `22P02 invalid input syntax for type uuid` and corrupting brand selection.

---

## 1. Scope & non-scope (BINDING)

### 1.1 IN SCOPE (this ORCH fixes exactly these)
- **C2** — auth-ready-gate the brand mutation path: `useCreateBrand`, `useUpdateBrand`, `useCreateVenueBrand`.
- **C1** — optimistic-id safety: no `_temp_`/non-uuid id may EVER reach a uuid column, the current-brand pointer, or `getBrand`/any `.eq("id", …)`.
- **H1** — surface brand-create/update write failures persistently and retryably (no silent failure).
- **H2** — switcher truth: an owned brand must never be invisible because the `brand_team_members` owner-row trigger lagged or failed.
- **H3** — anon/RLS-empty reads during the auth-warm window must NOT be cached as authed-genuinely-empty.

### 1.2 EXPLICITLY OUT OF SCOPE (do NOT touch in this ORCH)
- The **account-deletion FK bug** (`auth.users` delete blocked by `events_created_by_fkey`, SQLSTATE 23503) — tracked separately in **GitHub issue #668**. Do not modify any deletion path.
- The **Ari `list_events` leak** — separate ORCH.
- The **consumer app** (`app-mobile`) — entirely out of scope. No file under `app-mobile/` may be changed.
- **M1** (multi-owner pointer history — already mitigated by the single-writer gate), **M2** (realtime channel `Date.now()` naming churn), **L1** (GB/GBP pricing defaults), and the queryClient global `staleTime` redesign beyond what H3 requires. Out of scope; do not refactor them.
- **No schema migration.** If the implementor believes a migration is required, STOP and escalate — this spec asserts none is.

---

## 2. Per-fix contract

> All paths below are relative to `mingla-business/` unless stated otherwise.

### C1 — Optimistic temp-id must never reach a uuid column or the current-brand pointer (PRIMARY-PAIR, PROVEN)

**Root cause (proven):** `useCreateBrand.onMutate` mints `id: \`_temp_${Date.now().toString(36)}\`` (`src/hooks/useBrands.ts:286`) and prepends it as `brands[0]` into the **same list cache** (`:299-302`) that `useCurrentBrandRecovery` reads via `useBrands(userId)` (`src/hooks/useCurrentBrandRecovery.ts:139`). For a zero-brand account, `resolveCurrentBrandId` returns `{ brandId: brands[0].id, reason: "newest-brand" }` (`src/utils/currentBrandResolver.ts:37-40`) — i.e. the `_temp_…` id — which `runBrandRecoveryWrite` (authoritative mount) then writes to `currentBrandId` (`useCurrentBrandRecovery.ts:110`) **and** to `creator_accounts.default_brand_id` via `setCreatorDefaultBrand(userId, "_temp_…")` (`:121` → `creatorAccount.ts:90-93` → uuid column) **and** which flows to `useCurrentBrand → useBrand("_temp_…") → getBrand(.eq("id","_temp_…"))` against the uuid `brands.id` (`src/services/brandsService.ts:673-679`). Both DB-bound paths throw `22P02`.

**Required behavior change (defense-in-depth — implement ALL THREE; do not pick one):**

1. **Guard at the resolver (single chokepoint):** in `resolveCurrentBrandId` (`src/utils/currentBrandResolver.ts`), a brand id that is not a syntactically valid UUID MUST be ineligible for selection. Add a `isPersistedBrandId` predicate (a brand id is selectable only if it is a real UUID — at minimum it MUST reject any id matching `/^_temp_/`; a strict UUID-v4/RFC-4122 regex is preferred). Filter the candidate set so `currentBrandId`, `defaultBrandId`, and the `brands[0]` "newest-brand" fallback all skip non-persisted ids. When the only candidates are non-persisted, return `{ brandId: null, reason: "none" }` (NOT the temp id).

2. **Guard at the write boundary (belt):** in `runBrandRecoveryWrite` (`src/hooks/useCurrentBrandRecovery.ts`), before `setCurrentBrandId(resolution.brandId)` and before the `setCreatorDefaultBrand(userId, resolution.brandId)` call, assert `resolution.brandId` is a persisted UUID. A non-persisted id MUST short-circuit the write (no `setCurrentBrandId`, no default-brand write) — never poison the pointer or issue the UPDATE.

3. **Guard at the service source (suspenders):** in `setCreatorDefaultBrand` (`src/services/creatorAccount.ts`) and `getBrand` (`src/services/brandsService.ts`), reject a non-UUID `brandId` BEFORE issuing the Supabase call. `getBrand("_temp_…")` MUST return `null` (treat as miss, not a thrown `22P02`); `setCreatorDefaultBrand(userId, "_temp_…")` MUST throw a typed, app-level error (e.g. `InvalidBrandIdError`) and MUST NOT send the UPDATE. Use one shared validator (e.g. `src/utils/brandId.ts` exporting `isPersistedBrandId(id)`); the resolver, the write boundary, and the services all import it (Constitution #4 — one source of truth).

**Acceptance criterion (C1):** Across an end-to-end brand-create from a zero-brand account, **no** value matching `^_temp_` (or any non-UUID) is ever (a) written to `currentBrandId`, (b) passed to `setCreatorDefaultBrand`/`updateCreatorAccount`'s `default_brand_id`, or (c) passed to `getBrand`/any `.eq("id", …)` on `brands`. Prove via the C1 regression test (§4 I-PROPOSED-1232-A) AND a clean pg-log window (no new `22P02` for a temp id during a create). Note (per second-pass correction §5d): the old `42P02`/auto-clear narrative is secondary — the binding criterion is "no non-uuid id reaches a uuid column / the pointer."

---

### C2 — Brand mutations must be auth-ready-gated (PRIMARY-PAIR; mechanism PROVEN, timing SUSPECTED-HIGH)

**Root cause (confirmed):** `useBrands` gates its query on `const enabled = isAuthReady && accountId !== null` (`src/hooks/useBrands.ts:135-136`). `useCreateBrand` (`:269-335`), `useUpdateBrand` (`:356-408`), and `useCreateVenueBrand` (`:593-605`) contain **no `isAuthReady` reference** — they fire whenever `mutateAsync` is called. The create CTA is gated only on `trimmedName.length === 0 || createBrandMutation.isPending` (`src/components/brand/BrandCreationFlow.tsx:824`), never on auth readiness. On web the JWT can attach late; a pre-JWT insert runs as `anon`, `auth.uid()` is NULL, and the `brands` INSERT RLS `WITH CHECK ((account_id = auth.uid()) AND (deleted_at IS NULL))` rejects it.

**Required behavior change — gate consistent with how `useBrands` already gates (AWAIT-until-ready, NEVER silently drop):**

Each of the three mutation hooks (`useCreateBrand`, `useUpdateBrand`, `useCreateVenueBrand`) MUST become auth-aware via `const { isAuthReady } = useAuth();`. The chosen mechanism (apply uniformly to all three):

- The hook MUST NOT issue the DB write while `isAuthReady === false`. Because a mutation is imperative (a query's `enabled` flag has no mutation equivalent), implement an **await-until-ready guard inside `mutationFn`** (preferred): before calling the service (`createBrand` / `updateBrand` / `createVenueBrandPendingReview`), `await` a short, bounded readiness wait (poll/subscribe to `isAuthReady`, cap e.g. **5 seconds**). If auth becomes ready within the window, proceed with the write (now correctly authed). If the cap elapses still-not-ready, **throw a typed `AuthNotReadyError`** so the caller surfaces it via H1 (a visible, retryable error) — this is the "never silently drop" requirement: the user's intent is preserved as an explicit, retryable failure, never discarded.
- **Additionally** gate the **create CTA** (`BrandCreationFlow.tsx:824`) and the **address-step CTA** (`:843`) and any update CTA so the button is `disabled` while `!isAuthReady` (mirroring the read-gate posture). This prevents the fire-before-ready entirely in the common case; the in-`mutationFn` await is the backstop for races where auth flips false mid-flight.

**Forbidden:** Do NOT add `isAuthReady` to `useBrand` (single-by-id, `:203-256`) — it is intentionally UNGATED because `brands` has an anon "Public can read non-deleted brands" policy that public pages depend on (§3). Do NOT silently no-op a mutation when auth isn't ready (that would re-create H1).

**Acceptance criterion (C2):** A brand-create fired during the auth-warm window either (a) completes successfully once auth settles within the wait cap, or (b) surfaces a visible, retryable `AuthNotReadyError` via H1 — and in NO case produces an anon-rejected insert presented as success/no-op. Prove via the C2 regression test (§4 I-PROPOSED-1232-B) and the runtime test §5(a)/(b).

---

### H1 — Write failures must surface persistently and retryably (PROVEN; Constitution rule #3: no silent failures)

**Root cause (confirmed):** `handleCreateIdentity`'s catch (`BrandCreationFlow.tsx:342-350`) maps any non-`SlugCollisionError` to a single `setToast(BRAND_CREATION_COPY.createErrorToast)` ("Couldn't create brand. Tap to retry.", `:160`) with no persistent error state and no step retention; `queryClient.ts` sets `mutations: { retry: 0 }` (`:44-46`). A failed save is indistinguishable from inaction.

**Required behavior change:**
- On a brand-create/update write failure (any thrown error that is NOT a handled `SlugCollisionError`), the wizard MUST render a **persistent, non-auto-dismissing error surface** on the active step (an inline error banner/region with a **Retry** affordance), NOT a transient toast. The error MUST persist until the user retries or dismisses it explicitly. The wizard MUST stay on the step that failed with the user's typed values intact (it already does not advance on throw — keep that).
- `AuthNotReadyError` (from C2) MUST render with actionable copy distinct from a hard failure — e.g. "Finishing sign-in… tap Retry in a moment." It MUST be retryable.
- The **Retry** affordance MUST re-invoke the same mutation (`mutateAsync`) with the same inputs.
- Do NOT broadly flip `mutations.retry` globally in `queryClient.ts` (out of scope per §1.2). If a per-mutation retry is desired for transient/`401`-after-auth, scope it to the brand-create mutation only via its own `retry` option; this is OPTIONAL, not required.

**Acceptance criterion (H1):** A forced brand-create write failure (e.g. injected RLS rejection / network 401) produces a visible error that does NOT auto-dismiss, carries a working Retry, and never looks like a no-op. Prove via runtime test §5(b) and the H1 component test (§4 I-PROPOSED-1232-C).

---

### H2 — An owned brand must never be invisible due to trigger lag/failure (PROVEN code path; latent risk)

**Root cause (confirmed):** `getBrands` (`src/services/brandsService.ts:486-491`) sources the switcher list from `from("brand_team_members").select("role, brand:brands!inner(*)").eq("user_id", accountId).is("removed_at", null).is("brand.deleted_at", null)`. The owner membership row is created by the `AFTER INSERT` trigger `biz_brand_owner_team_member_after_insert`. If that trigger lags/fails or the row is `removed_at`-stamped, a genuinely-owned brand does not appear though it exists in `brands.account_id`.

**Required behavior change (client-side self-heal, no schema change):**
- `getBrands(accountId)` MUST also read brands the user owns directly via `brands.account_id = accountId` (the anon-safe authed owner SELECT path) and **UNION** them into the result, de-duplicated by `brand.id`, with owner role attributed for the direct-owned rows. Net effect: an owned brand surfaces in the switcher whether or not its `brand_team_members` row exists yet. Keep the existing `brand_team_members` query for non-owner members (ORCH-1081 contract — do not regress non-owner visibility).
- Both reads MUST keep `deleted_at IS NULL` filtering (do not surface soft-deleted brands).

**Acceptance criterion (H2):** Immediately after a successful insert (and in a simulated state where the `brand_team_members` owner row is absent), the brand appears in `getBrands(accountId)`'s output exactly once. Prove via the H2 service test (§4 I-PROPOSED-1232-D) and runtime persistence check §5(a).

---

### H3 — Auth-warm anon-empty reads must not be cached as authed-empty (CONFIRMED config; SUSPECTED per-surface impact)

**Root cause (confirmed):** `useBrands` for an anon/auth-warming caller can resolve `200 + []` and cache as success (`src/hooks/useBrands.ts:130-134` comment). Combined with the global 5-min `staleTime` (`queryClient.ts`), a mid-warm empty read can render "Create your first brand" though brands exist server-side.

**Required behavior change (narrow, at the source — do NOT redesign global staleTime):**
- `useBrands` MUST distinguish **"not-yet-authed / auth-warming"** from **"authed-and-genuinely-empty."** Concretely: the list query MUST NOT resolve to a cached **success-empty** while the session is still warming. Because `useBrands` already gates `enabled = isAuthReady && accountId !== null`, the remaining gap is the **interior window** where `isAuthReady` is true but the Supabase JWT/session is not yet attached (the same window C2 addresses). The fix MUST ensure that during that interior window, an empty result is treated as **loading/pending**, not a committed empty — e.g. the `queryFn` MUST verify an authenticated session is attached (`auth.uid()` present) before returning `[]`; if not attached, it MUST throw/retry rather than cache `[]` as success, so the consumer renders LOADING not EMPTY.
- This MUST be done **inside `useBrands`/`getBrands`** (the source), NOT by adding new per-consumer heuristics. Existing consumer mitigations (`resolveBrandListStatus`, `shouldClearCurrentBrandId`) stay as-is; do not remove them.

**Acceptance criterion (H3):** On a cold web load during the auth-warm window for an account that owns brands, the switcher/account screen never shows "Create your first brand" as a settled state when brands exist — it shows loading until the authed read returns the real list. Prove via runtime test §5(a) repeated across a fresh sign-in, and the H3 unit test (§4 I-PROPOSED-1232-E).

---

## 3. HARD NON-NEGOTIABLE — public / anon page safety (CLOSE-BLOCKING)

**The fix MUST NOT add an auth gate to ANY public/anon surface.** Only the named authed mutation/query hooks in §2 may change. The following are on a **cleanly separated code path** (re-confirmed in this worktree) and MUST remain UNGATED and untouched:

**Public buyer routes** — `PUBLIC_BUYER_ROUTE_PREFIXES` (`src/utils/coldLoadAuthGates.ts:135`), matched by `isPublicBuyerRoute` (`:166`) and consumed in `app/_layout.tsx`:
`/e/`, `/t/`, `/b/`, `/exp/`, `/checkout/`, `/checkout-trip/`, `/checkout-experience/`, `/o/`, `/booking/`.

**Self-authenticating Stripe-Connect seller routes** — `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (`coldLoadAuthGates.ts:208`) — sessionless, carry their own Stripe `client_secret`. MUST NOT be gated.

**Public data hooks** — `usePublicBrandBySlug` (`src/hooks/usePublicEvents.ts:69`) → `getPublicBrandBySlug` (`src/services/publicEventsService.ts:1336`) → reads `business_public_brands_view` / `claimed_venues_public_view` keyed on **slug** via the anon RLS policies ("Public can read non-deleted brands", "Public can read brands with public events"). NO `isAuthReady`, NO `brand_team_members`.

**`useBrand` (single-by-id)** (`src/hooks/useBrands.ts:203-256`) — intentionally UNGATED; public pages depend on by-id reads against the anon "Public can read non-deleted brands" policy. The fix MUST NOT gate `useBrand`; C1 instead prevents the `_temp_` id ever reaching it.

**Binding statement:** ONLY `useCreateBrand`, `useUpdateBrand`, `useCreateVenueBrand` (gating) + `resolveCurrentBrandId` / `runBrandRecoveryWrite` / `getBrand` / `setCreatorDefaultBrand` / `getBrands` / `useBrands` (the C1/H2/H3 chokepoints) are touched. **No public RPC, no slug path, no buyer/seller route, and `useBrand` are modified.** This is a CLOSE-blocking acceptance criterion — see §4 I-PROPOSED-1232-F (the gate that forbids `isAuthReady` from appearing in any public-path file).

---

## 4. DRAFT invariants (pre-stage as `I-PROPOSED-1232-*`; DRAFT → ACTIVE on CLOSE)

Each invariant gets a strict-grep script in `.github/scripts/strict-grep/` AND/OR a jest test, plus a registry row in `.github/workflows/strict-grep-mingla-business.yml`. Each MUST fail-on-revert.

| ID | Rule | Enforcement | Regression test |
|----|------|-------------|-----------------|
| **I-PROPOSED-1232-A** | No `_temp_`/non-UUID id may reach a uuid column or the current-brand pointer. `resolveCurrentBrandId` filters non-persisted ids; `runBrandRecoveryWrite` short-circuits on non-UUID; `setCreatorDefaultBrand`/`getBrand` reject non-UUID before the Supabase call. | strict-grep `i-proposed-1232-a-no-temp-id-to-uuid.mjs` — asserts `isPersistedBrandId` is imported and applied in the resolver + write boundary + both services; asserts no `setCreatorDefaultBrand`/`.eq("id"` reachable without the guard. | jest: resolver returns `reason:"none"` for a `_temp_` brands[0]; `getBrand("_temp_x")` → `null` (no throw); `setCreatorDefaultBrand(uid,"_temp_x")` throws `InvalidBrandIdError` and issues NO update. |
| **I-PROPOSED-1232-B** | Brand mutations are auth-ready-gated (await-until-ready; never silently drop). `useCreateBrand`/`useUpdateBrand`/`useCreateVenueBrand` reference `isAuthReady`; throw `AuthNotReadyError` on cap-elapse. | strict-grep `i-proposed-1232-b-brand-mutations-auth-gated.mjs` — asserts each of the 3 hooks references `isAuthReady` and the create/address CTAs are `disabled` on `!isAuthReady`. | jest: mutation with `isAuthReady=false` past cap throws `AuthNotReadyError`; with `isAuthReady=true` proceeds to the service call. |
| **I-PROPOSED-1232-C** | Brand write failures surface persistently + retryably (never a lone auto-dismiss toast). | jest component test on `BrandCreationFlow`: forced create failure renders a persistent inline error + working Retry; does NOT advance step; keeps typed values. | Same test asserts the error region is present and Retry re-invokes the mutation. |
| **I-PROPOSED-1232-D** | Owned brands never invisible: `getBrands` unions `brands.account_id = uid` with the `brand_team_members` read, de-duped, both `deleted_at IS NULL`. | strict-grep `i-proposed-1232-d-getbrands-owner-union.mjs` — asserts `getBrands` reads `brands` by `account_id` in addition to `brand_team_members`. | jest: with the membership row absent but a `brands.account_id` row present, `getBrands` returns the brand exactly once with owner role. |
| **I-PROPOSED-1232-E** | Auth-warm empty reads are not cached as authed-empty: `useBrands`/`getBrands` verifies an attached authed session before returning `[]`; otherwise loading. | strict-grep `i-proposed-1232-e-useBrands-no-anon-empty-success.mjs` — asserts the session-attached check precedes any empty return in the list path. | jest: `getBrands` with no attached session throws/loops (does not resolve `[]` success); with session present returns the list. |
| **I-PROPOSED-1232-F** | **PUBLIC-SAFETY (CLOSE-BLOCKING):** `isAuthReady` MUST NOT appear in any public-path file: `coldLoadAuthGates.ts`, `usePublicEvents.ts` (`usePublicBrandBySlug`), `publicEventsService.ts` (`getPublicBrandBySlug`), and `useBrand` (single-by-id) MUST stay ungated. The public route prefix lists MUST be unchanged. | strict-grep `i-proposed-1232-f-public-paths-ungated.mjs` — fails if `isAuthReady` is referenced in the public hooks/services, if `useBrand` gains an `isAuthReady` gate, or if `PUBLIC_BUYER_ROUTE_PREFIXES`/`SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` membership changed. | The gate IS the regression test (revert = a public path gets gated = fail). |

Add all gates as jobs in `.github/workflows/strict-grep-mingla-business.yml` (registry pattern, one job per script). Each script supports `--self-test` against fixtures (mirror `i-proposed-1136-web-sheet-css-transition.mjs`).

---

## 5. Test plan (the tester WILL drive a real browser)

Documented constraint: authed biz-web runtime is hard to drive headlessly. The tester MUST drive a **real browser** (Playwright/Chromium) against either a local `npx expo start --web` build of `mingla-business` OR the deployed `business.usemingla.com`, signed in as a real account, and capture evidence (screenshots, console, network, and live-prod SQL/pg-log reads). Source-only reasoning is capped at "suspected"; a PASS REQUIRES runtime evidence.

**(a) Brand-create PERSISTS from a zero-brand account, repeatedly + across fresh sign-in.**
- Use an account with **zero brands** (`default_brand_id` NULL, no `brands` row, no `brand_team_members` row). Create a brand.
- Verify it PERSISTS on ALL THREE: (1) appears in the brand switcher; (2) a row exists in `brands` (live-prod SQL, `account_id = uid`, `deleted_at IS NULL`); (3) a `brand_team_members` owner row exists for `user_id = uid` (or, if the trigger lagged, the brand still shows via the H2 union — assert visibility either way).
- Repeat the create ≥3× (distinct names) to shake out timing.
- **Force the auth-warm window:** sign OUT, then sign IN and **immediately** (within ~1–2s of landing) initiate a create — i.e. action before the JWT settles. Observe via DevTools that `auth.uid()`-bearing requests are/aren't yet attached. Confirm the create EITHER completes once auth settles OR surfaces the retryable `AuthNotReadyError` (per C2/H1) — and NEVER silently fails to persist.

**(b) Forced write failure surfaces a visible, non-dismissing error with Retry.**
- Force a brand-create failure (e.g. block/return 401 on the `brands` insert via DevTools network override, or sign-out-mid-flight). Confirm a **persistent inline error** (not an auto-dismissing toast), a working **Retry**, the wizard stays on the step, typed values intact, and Retry succeeds once unblocked.

**(c) NO `_temp_` value ever lands in the default-brand pointer.**
- During/after a create, read `creator_accounts.default_brand_id` (live-prod SQL) — it MUST be NULL or a real UUID, never `_temp_…`. Pull the prod **postgres log window** during the test and confirm **no new `22P02 invalid input syntax for type uuid` for a `_temp_` value** is emitted. Inspect the browser console for any client-side `22P02`.

**(d) REGRESSION — every public/anon route still loads while LOGGED OUT (CLOSE-BLOCKING).**
- In a logged-OUT browser (cleared session), load and exercise each public surface and confirm it renders + functions: a public brand page `/b/<slug>`, an event `/e/<id>`, a trip `/t/<id>`, an experience `/exp/<id>`, the checkout routes `/checkout/…`, `/checkout-trip/…`, `/checkout-experience/…`, an order `/o/<id>`, and `/booking/…`, plus a self-authenticating Stripe-Connect seller route. NONE may redirect to auth or show a blank/empty state introduced by this change. Capture evidence per route.

Tester verdict is PASS only if (a)–(d) all pass with runtime evidence; (d) is independently CLOSE-blocking.

---

## 6. Regression guards (CI) — summary

Add these to `.github/workflows/strict-grep-mingla-business.yml` (one job each):
- `i-proposed-1232-a-no-temp-id-to-uuid.mjs` (C1)
- `i-proposed-1232-b-brand-mutations-auth-gated.mjs` (C2)
- `i-proposed-1232-d-getbrands-owner-union.mjs` (H2)
- `i-proposed-1232-e-useBrands-no-anon-empty-success.mjs` (H3)
- `i-proposed-1232-f-public-paths-ungated.mjs` (PUBLIC-SAFETY, CLOSE-blocking)

Plus jest tests for I-PROPOSED-1232-A/-B/-C/-D/-E (resolver/service/hook/component). Each guard MUST be proven fails-on-revert in the implementation report (revert the fix → gate red → restore → green).

---

## 7. Implementor checklist (acceptance summary)
- [ ] C1: shared `isPersistedBrandId` validator applied at resolver + write boundary + `getBrand` + `setCreatorDefaultBrand`; no `_temp_` reaches any uuid column/pointer.
- [ ] C2: `useCreateBrand`/`useUpdateBrand`/`useCreateVenueBrand` await-until-ready (≤5s cap) + `AuthNotReadyError` on cap; create/address CTAs disabled while `!isAuthReady`.
- [ ] H1: persistent inline error + Retry on brand write failure; no lone auto-dismiss toast; step + values retained.
- [ ] H2: `getBrands` unions `brands.account_id` owner reads, de-duped, `deleted_at IS NULL`.
- [ ] H3: `useBrands`/`getBrands` never caches an auth-warm empty as authed-success.
- [ ] §3 PUBLIC SAFETY: `isAuthReady` absent from all public-path files; `useBrand` ungated; route prefix lists unchanged.
- [ ] §4 invariants pre-staged; §6 CI gates added + fails-on-revert proven.
- [ ] No `app-mobile/` change; no schema migration; no account-deletion/Ari-leak touch.
