# Implementation Report — ORCH-BIZ-CYCLE-0a-001 · Mingla Business Foundation

**Status:** IN PROGRESS — **Sub-phase A complete**. Sub-phases B / C / D / E / F pending.
**Codebase:** `mingla-business/`
**Cycle:** 0a — Foundation
**Author:** Mingla Implementor
**Date:** 2026-04-28

---

## Sub-phase plan (founder-authorised)

| Phase | Scope | Status |
|-------|-------|--------|
| **A** | Pure-JS dep installs + token extension + currentBrandStore + tsc clean | ✅ Complete |
| **B** | Native installs (`expo-blur`, `expo-camera`, `expo-image-picker`, `@react-native-community/datetimepicker`, `@stripe/stripe-react-native`, `react-native-nfc-manager`, `@sentry/react-native`) + `app.config.ts` updates + ONE `eas build` per platform | ⏸ Awaiting authorisation |
| **C** | Build 22 UI primitives in `src/components/ui/` (Icon → MinglaMark → Spinner → … → Stepper) + chrome (TopBar, BottomNav) | ⏸ Pending |
| **D** | Wire 3-tab nav routes (`app/(tabs)/_layout.tsx`, `home.tsx`, `events.tsx`, `account.tsx`) + auth-gate redirect to `/(tabs)/home` + delete `app/home.tsx` | ⏸ Pending |
| **E** | `app/__styleguide.tsx` dev-only QA surface | ⏸ Pending |
| **F** | iOS / Android / web smoke tests + forbidden-import audit + final report | ⏸ Pending |

---

## Sub-phase A — Pure-JS foundation

### A.1 Pre-flight

Read in full before any work:
- `Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_FOUNDATION.md` (orchestrator addendum included)
- `Mingla_Artifacts/specs/SPEC_BIZ_DEPENDENCY_MANIFEST.md` §3 install commands
- `mingla-business/src/constants/designSystem.ts` (existing thin token set)
- `mingla-business/src/services/supabase.ts` (AsyncStorage import pattern)
- `mingla-business/package.json`

### A.2 Vestigial-package grep counts

Per dispatch §4.3, audit for vestigial deps. Sub-phase A reports counts only; removal is a Sub-phase B decision.

| Package | Source imports (`mingla-business/src` + `mingla-business/app`) | Recommendation |
|---------|---|---|
| `@react-navigation/bottom-tabs`, `@react-navigation/elements`, `@react-navigation/native` | **0** | **REMOVE** in Sub-phase B. We use Expo Router 6, not React Navigation directly. Listed in `package.json:23-25` only. Will shrink dep tree once removed. |
| `@expo/vector-icons` | **1** — `src/components/auth/BusinessWelcomeScreen.tsx:21` (`Ionicons` used in welcome screen icons) | **KEEP for now** (per AUDIT_BIZ_DEPENDENCY_INVENTORY D-DEP-3 verdict). Sub-phase C will introduce the new SVG `Icon` primitive; migration of `BusinessWelcomeScreen` to the new `Icon` is a Cycle-1 follow-up. Until migration, removing this dep would crash the welcome screen. |

Confirms AUDIT_BIZ_DEPENDENCY_INVENTORY findings D-DEP-2 (react-navigation vestigial — confirmed) and D-DEP-3 (vector-icons keep — confirmed).

### A.3 Dependencies installed

Ran `npm install zustand @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister react-error-boundary` from `mingla-business/`.

Result: 7 packages added (5 direct + 2 transitive), 956 total packages audited. No peer-dependency conflicts. Lockfile updated.

| Package | Version installed | Purpose |
|---------|-------|---------|
| `zustand` | `^5.0.12` | Client-only state (currentBrand, UI flags) |
| `@tanstack/react-query` | `^5.100.6` | Server-state cache (used from Cycle 0b backend wiring onwards) |
| `@tanstack/react-query-persist-client` | `^5.100.6` | Persisted cache wrapper |
| `@tanstack/query-async-storage-persister` | `^5.100.6` | AsyncStorage adapter for persist client |
| `react-error-boundary` | `^6.1.1` | `ErrorBoundary` primitive (Sub-phase C) |

`npm audit` shows 19 pre-existing vulnerabilities (18 moderate, 1 high). All inherited from existing deps, none introduced by this batch. Sub-phase F will surface to orchestrator if any are exploitable in this product.

### A.4 Token extension — `src/constants/designSystem.ts`

**Modified:** `mingla-business/src/constants/designSystem.ts` (extended additively)

#### Old → New receipt

**What it did before:** thin token surface — `spacing` (xs/sm/md/lg/xl/xxl), `radius` (sm/md/lg/xl/full), `shadows` (sm/md only), `fontWeights`, `colors` (legacy mobile-aligned tokens with `#f97316` primary), `backgroundWarmGlow`. ~69 lines.

**What it does now:** all existing exports preserved verbatim (no breaking change to current callers). Additive scale extensions: `spacing.xxs = 2`; `radius.xxl = 28`, `radius.display = 40`; `shadows.lg`, `shadows.xl`, `shadows.glassBadge`, `shadows.glassChrome`, `shadows.glassChromeActive`, `shadows.glassCardBase`, `shadows.glassCardElevated`, `shadows.glassModal`. Net-new exports from the design package's `tokens.css`: `accent`, `canvas`, `glass` (tint / border / highlight nested object), `semantic`, `text`, `blurIntensity`, `easings`, `durations`, `typography`. ~245 lines.

**Why:** Cycle 0a success criterion S-8 (TypeScript compiles with the extended tokens, no caller breaks) and the foundation that all 22 UI primitives in Sub-phase C consume.

**Lines changed:** ~+180 added, 0 removed (additive only). Existing call sites unchanged.

**Verification of additive contract (Invariant I-1):**
- All previous exports — `spacing`, `radius`, `shadows`, `fontWeights`, `colors`, `backgroundWarmGlow` — still resolve with their existing fields. New fields only ADD to the existing scale objects (e.g., `spacing.xxs` is new, but `spacing.xs` through `spacing.xxl` retain their original values).
- `npx tsc --noEmit` exit code 0 (see A.6) — every existing importer of `designSystem` resolves cleanly.

### A.5 currentBrandStore creation

**Created:** `mingla-business/src/store/currentBrandStore.ts` (new file, ~58 lines).

**What it does:** persisted Zustand store for the active organiser brand. Exports:
- `Brand` type (stub: `{ id: string; displayName: string }` — Cycle 1 expands to full schema-bound shape)
- `CurrentBrandState` type (state + actions)
- `useCurrentBrandStore` — full store hook
- `useCurrentBrand()` selector (returns `Brand | null`)
- `useBrandList()` selector (returns `Brand[]`)

**State shape:** `{ currentBrand: null, brands: [] }` initial. Actions: `setCurrentBrand`, `setBrands`, `reset`.

**Persistence:** uses `zustand/middleware` `persist` + `createJSONStorage(() => AsyncStorage)`. Key: `mingla-business.currentBrand.v1`. `partialize` whitelists only `currentBrand` + `brands` (no functions persisted). `version: 1` for future migrations.

**Why this lives in Sub-phase A:** the TopBar primitive (Sub-phase C) reads `useCurrentBrand()` to decide whether to render "Create brand" or the brand's `displayName`. Per orchestrator addendum 2026-04-28, this needs to exist before Sub-phase C imports it.

**Sub-phase A return criteria (per addendum):**
- (a) Store file created — ✅
- (b) Basic shape compiles cleanly — ✅ (tsc clean, see A.6)
- (c) AsyncStorage persistence wired — ✅ (`createJSONStorage(() => AsyncStorage)`)
- (d) Selector hooks `useCurrentBrand()` + `useBrandList()` exported — ✅

### A.6 TypeScript verification

```
$ cd mingla-business && npx tsc --noEmit
EXIT: 0
```

Zero errors. No warnings. Strict mode preserved (`noImplicitAny`, `strictNullChecks`, etc. — inherited from existing `tsconfig.json`).

### A.7 Files touched

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/package.json` | npm install added 5 deps | +5 |
| `mingla-business/package-lock.json` | regenerated | (auto) |
| `mingla-business/src/constants/designSystem.ts` | extended additively | +180 |
| `mingla-business/src/store/currentBrandStore.ts` | new file | +58 |

**No files deleted in Sub-phase A.** (Vestigial removal happens in Sub-phase B; `app/home.tsx` deletion happens in Sub-phase D atomically with `(tabs)/home.tsx` creation.)

### A.8 Invariants — Sub-phase A scope

| ID | Invariant | Status | Evidence |
|----|-----------|--------|----------|
| I-1 | `designSystem.ts` existing exports remain backward-compatible | ✅ Preserved | tsc clean; existing fields unchanged in scale objects |
| I-2 | Auth flow keeps working | ✅ Preserved | No auth files touched in Sub-phase A |
| I-3 | App boots on iOS / Android / web | ⏸ Deferred to Sub-phase F (smoke tests) — no native boot performed in Sub-phase A |
| I-4 | No imports from `app-mobile/src/services/board*` etc. | ✅ Verified | Only files created import `zustand`, `zustand/middleware`, `@react-native-async-storage/async-storage` |
| I-5 | Mingla = experience app, never dating | ✅ Verified | All copy in `currentBrandStore` is technical (no user-facing strings); designSystem token names neutral |
| I-6 | No `any` types added, no `@ts-ignore` | ✅ Verified | `currentBrandStore.ts` strictly typed; tsc clean |
| I-7 | No silent failures | ✅ Preserved | No catch blocks added in Sub-phase A |
| I-8 | No service-role Supabase from client | ✅ Preserved | No Supabase code touched |
| I-9 | Reduce-motion respected | ⏸ N/A in Sub-phase A — applies to Sub-phase C primitives |
| I-10 | Currency-aware (UK baseline) | ⏸ N/A in Sub-phase A — applies to Sub-phase C placeholders |

### A.9 Discoveries for orchestrator

**None.** No surprises during Sub-phase A. Tooling cooperative.

### A.10 Pending decisions (none in Sub-phase A)

All Sub-phase A scope was explicit. No judgment calls escalated.

### A.11 What Sub-phase A does NOT cover (deferred per phasing)

- Native module installs (`expo-blur`, `expo-camera`, etc.) — Sub-phase B
- `app.config.ts` permissions / entitlements / plugins — Sub-phase B
- `eas build` per platform — Sub-phase B
- 22 UI primitives — Sub-phase C
- Tab routing + auth-gate redirect — Sub-phase D
- `__styleguide` dev route — Sub-phase E
- iOS / Android / web smoke + screenshots — Sub-phase F
- Forbidden-import grep audit — Sub-phase F
- Vestigial package removal (`@react-navigation/*`) — Sub-phase B

---

## Sub-phase A — Founder verification step

Before authorising Sub-phase B, the founder may want to:

1. Open `mingla-business/src/constants/designSystem.ts` and confirm new tokens are appended (not replacing existing scales).
2. Open `mingla-business/src/store/currentBrandStore.ts` and confirm shape + selector hooks.
3. Run `cd mingla-business && npx tsc --noEmit` locally — should exit 0.
4. (Optional) `cd mingla-business && npx expo start` then press `i` for iOS simulator to confirm app still boots and Google sign-in still works (regression check on Invariant I-2 ahead of any later phase).

If anything looks off, push back before Sub-phase B starts. Sub-phase B is the irreversible-ish one — adding native modules and running `eas build` consumes EAS minutes.

---

**End of Sub-phase A report. Sub-phases B–F to follow when authorised.**
