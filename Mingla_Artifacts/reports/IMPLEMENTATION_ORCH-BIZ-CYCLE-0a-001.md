# Implementation Report — ORCH-BIZ-CYCLE-0a-001 · Mingla Business Foundation

**Status:** IN PROGRESS — **Sub-phase A ✅ Complete · Sub-phase B ✅ Complete (all 10 SC PASS, I-2 verified both platforms)**. Sub-phases C / D / E / F pending.
**Codebase:** `mingla-business/`
**Cycle:** 0a — Foundation
**Author:** Mingla Implementor
**Date:** 2026-04-28

---

## Sub-phase plan (founder-authorised)

| Phase | Scope | Status |
|-------|-------|--------|
| **A** | Pure-JS dep installs + token extension + currentBrandStore + tsc clean | ✅ Complete (committed `5ebce86c`) |
| **B** | Native installs + app.config + EAS build per platform + dev-client smoke | ✅ Complete — iOS build #4 (after 3 config-iteration fails) + Android build + smoke PASS both platforms. I-2 verified. Pending checkpoint commit. |
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

**End of Sub-phase A report.**

---

## Sub-phase B — Native installs + app.config.ts + EAS build (Steps 1–4 complete)

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_B.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_B.md)
**Implementor stop point:** end of Step 4 (`expo prebuild --clean` validated). Steps 5–6 require founder hardware + EAS minutes — handed back per locked sequential rule + dispatch §7.

### B.1 Step 1 — Vestigial removal

```
$ npm uninstall @react-navigation/bottom-tabs @react-navigation/elements @react-navigation/native
[19 vulnerabilities (18 moderate, 1 high) — pre-existing]
```

Post-removal grep:
```
$ grep -rE "@react-navigation/(bottom-tabs|elements|native)" src app | grep -v node_modules
[zero matches — exit 1]

$ grep -E "@react-navigation" package.json
[zero matches — exit 1]
```

3 packages removed cleanly. `package-lock.json` regenerated.

### B.2 Step 2 — Native installs

```
$ npx expo install expo-blur expo-camera expo-image-picker @react-native-community/datetimepicker @stripe/stripe-react-native react-native-nfc-manager @sentry/react-native
> Installing 6 SDK 54.0.0 compatible native modules and 1 other package using npm
> npm install --save react-native-nfc-manager
added 22 packages, audited 978 packages in 24s
```

**Installed versions** (captured from `package.json`):

| Package | Version | Source |
|---------|---------|--------|
| `expo-blur` | `~15.0.8` | expo-install (SDK-54-compat) |
| `expo-camera` | `~17.0.10` | expo-install (SDK-54-compat) |
| `expo-image-picker` | `~17.0.11` | expo-install (SDK-54-compat) |
| `@react-native-community/datetimepicker` | `8.4.4` | expo-install (SDK-54-compat) |
| `@stripe/stripe-react-native` | `0.50.3` | expo-install (SDK-54-compat) |
| `@sentry/react-native` | `~7.2.0` | expo-install (SDK-54-compat) |
| `react-native-nfc-manager` | `^3.17.2` | npm fallback (Expo had no SDK-54 mapping but accepted the install) |

**D-NFC-OUTCOME = Option 3** (forced npm install). Per dispatch §3 Step 2: when Expo can't find an SDK-54-compat mapping, the three options were Option 1 (`expo-config-plugin-nfc-manager`), Option 2 (defer to Cycle B4), or Option 3 (forced version). expo-install chose Option 3 itself by falling back to plain `npm install --save`. Native binary auto-links via React Native auto-linking. NFC isn't used in Cycles 0a–12, so any iOS NFC entitlement work can be deferred until Cycle 13 (Door Mode).

`expo-install` warned about 4 plugins it couldn't write to the dynamic `app.config.ts`:
```
Cannot automatically write to dynamic config at: app.config.ts
Add the following to your Expo config
{ "plugins": [
    "@react-native-community/datetimepicker",
    "@stripe/stripe-react-native",
    "react-native-nfc-manager",
    "@sentry/react-native"
] }
```

Of these, the dispatch §5 specified plugin entries only for `@stripe/stripe-react-native` (with merchantIdentifier + enableGooglePay) and `@sentry/react-native/expo`. `@react-native-community/datetimepicker` and `react-native-nfc-manager` were intentionally excluded by the dispatch (auto-linking sufficient). Surfaced as **D-DTP-1** below.

### B.3 Step 3 — Config file updates

#### `app.json` — Old → New receipt

**What it did before:** minimal Expo Router base config with `ios.supportsTablet: true`, `ios.bundleIdentifier`, `ios.infoPlist.ITSAppUsesNonExemptEncryption: false`, `android.package`, `android.adaptiveIcon` block, two plugins (`expo-router`, `expo-splash-screen`). 60 lines.

**What it does now:** all existing fields preserved. Additions per dispatch §3 Step 3:
- `ios.supportsTablet: true → false` (Mingla Business is a phone-first organiser app per DEC-070)
- `ios.infoPlist`: + 4 keys (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSFaceIDUsageDescription`); existing `ITSAppUsesNonExemptEncryption: false` preserved
- `ios.entitlements`: NEW — `com.apple.developer.in-app-payments: ["merchant.com.sethogieva.minglabusiness"]`. **Tap to Pay entitlement OMITTED** per Sub-phase B dispatch §2.2 (deferred until Apple approves application — exit condition: re-add to `ios.entitlements` before Cycle 13 dispatch)
- `ios.associatedDomains`: NEW — `applinks:business.mingla.com` + `applinks:mingla.com`
- `android.permissions`: NEW — CAMERA, NFC, READ_MEDIA_IMAGES, READ_EXTERNAL_STORAGE, INTERNET
- `android.intentFilters`: NEW — VIEW + autoVerify on `business.mingla.com`, `mingla.com/e`, `mingla.com/b`

**Why:** Cycle 0a Sub-phase B success criteria SC-3 (merchant ID wired), SC-1/SC-2 indirectly (no react-navigation refs in config). Apple Pay merchant ID — registered by founder 2026-04-28. Tap to Pay deferred to honour Risk R-AAP-1 (multi-week Apple approval).

**Lines changed:** ~+38 added, 1 modified (`supportsTablet`). 0 removed.

#### `app.config.ts` — Old → New receipt

**What it did before:** dynamic config exporting Google Sign-In + Apple Authentication plugins, plus Supabase URL / Google client IDs in `extra`. 58 lines.

**What it does now:** all existing logic preserved. Additions:
- Top-of-file `// [TRANSITIONAL]` block documenting Apple Tap to Pay omission with exit condition
- Plugins array extended (preserves existing Google + Apple): added `expo-camera`, `expo-image-picker` (with photosPermission), `@stripe/stripe-react-native` (with merchantIdentifier + enableGooglePay), `@sentry/react-native/expo`
- Inline `// [TRANSITIONAL]` comments documenting D-DEV-1 (expo-blur has no config plugin in 15.0.8) and D-NFC-OUTCOME (nfc-manager auto-links, no plugin entry needed)

**Why:** Cycle 0a Sub-phase B success criterion SC-3 (Stripe merchant ID wired through plugin config) + SC-4 (prebuild validates).

**Lines changed:** ~+30 added (mostly plugin entries + transition comments). 0 removed (existing plugins preserved verbatim).

#### `eas.json` — Updated 2026-04-28

**What it did before:** minimal CLI version + 3 build profiles (development / preview / production) with no env vars. 21 lines.

**What it does now:** all three profiles carry `"env": { "SENTRY_DISABLE_AUTO_UPLOAD": "true" }`. Disables Sentry's build-time source-map upload step (which was failing because no Sentry org is configured yet). Sentry SDK still installs + catches crashes at runtime — only the upload step is skipped. ~30 lines.

**Why:** D-SENTRY-1 was promoted from prebuild warning to build-blocker after iOS build #2 (2026-04-28) failed at `sentry-cli: An organization ID or slug is required`. Patch applied directly by orchestrator (auto-mode authorisation from founder). Re-enable per-profile when Sentry org + auth token are configured (target: Cycle 14 or production-readiness pass).

**Lines changed:** +9 added, 0 removed.

### B.4 Step 4 — Prebuild validation

```
$ npx expo prebuild --clean --no-install
PluginError: Unable to resolve a valid config plugin for expo-blur.
```

**Initial failure** — `expo-blur` 15.0.8 does not export a config plugin. Dispatch §5 incorrectly listed it as a plugin entry. Surfaced as **D-DEV-1** (dispatch spec error).

**Targeted fix:** removed `"expo-blur"` from `app.config.ts` plugins array, replaced with comment:
```typescript
// expo-blur 15.0.8 has no config plugin — auto-links via React Native
// auto-linking only. Adding it as a plugin entry throws PluginError.
// Surfaced as D-DEV-1 in implementation report.
```

**Re-run:** prebuild succeeded:
```
[@sentry/react-native/expo] Missing config for organization, project. Environment variables will be used as a fallback during the build.
- Clearing android
✔ Cleared android code
- Creating native directory (./android)
✔ Created native directory
- Updating package.json
✔ Updated package.json
- Running prebuild
✔ Finished prebuild
```

Single non-blocking warning: `@sentry/react-native/expo` missing org/project config → falls back to env vars at build time. Surfaced as **D-SENTRY-1** below.

`./android` generated and `.gitignore`-d (already excluded). `./ios` not generated locally — Windows host can't run iOS toolchain. EAS will run iOS prebuild remotely on macOS workers in Step 5.

### B.5 Steps 5–6 — Founder action required

**Step 5 — `eas build` per platform.** Implementor stops here per:
1. EAS build consumes real minutes (~20–40 min × 2 ≈ $X depending on plan)
2. EAS build often prompts for Apple Developer Program credentials interactively (cannot be answered from a non-interactive shell)
3. Build wall-clock exceeds the 10-min Bash timeout
4. Sub-phase B dispatch §7 mandates STOP-on-blocker; EAS minute commitment is exactly that class of decision

Founder runs:
```bash
cd mingla-business
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
```

These can run sequentially or in parallel (EAS handles them independently). Capture for the report:
- iOS build URL + duration + status
- Android build URL + duration + status
- Any plugin warnings (especially Stripe + Sentry)

**Step 6 — Dev-client smoke test on real devices.** After both builds succeed, founder installs the dev clients on physical iPhone + Android and verifies:
- App boots without crash
- Existing welcome screen renders (`BusinessWelcomeScreen`)
- Google sign-in flow opens (Invariant **I-2** verification gate — most important)
- Sign-in succeeds and routes to existing `app/home.tsx` placeholder
- Sign-out from home returns to welcome

If any of those fail, **STOP** — Sub-phase C is gated on I-2 holding.

### B.6 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-DEV-1** | Dispatch §5 listed `"expo-blur"` as a plugin entry. expo-blur 15.0.8 has no config plugin (auto-links only). Removing the entry was required to pass prebuild. **Spec error in dispatch.** | Low (cosmetic; correct fix is unambiguous) | Future Cycle dispatches that touch expo-blur should NOT list it as a plugin |
| **D-DTP-1** | `expo-install` recommended adding plugin entries for `@react-native-community/datetimepicker` and `react-native-nfc-manager`. Dispatch §5 intentionally omitted both (auto-linking sufficient). Confirmed correct via successful prebuild. | Info | None — dispatch was right, expo-install over-recommends |
| **D-EAS-1** | Dispatch §3 Step 3 said "add `EXPO_PUBLIC_SENTRY_DSN` env placeholder (commented out)" to `eas.json`. JSON has no comments. Implementor left `eas.json` untouched. | Low | Orchestrator decides: (a) leave untouched and add at Cycle B5 push setup, (b) add `"env": { "EXPO_PUBLIC_SENTRY_DSN": "" }` to development profile now |
| **D-SENTRY-1** | `@sentry/react-native/expo` plugin warns "Missing config for organization, project" at prebuild. Then fails the build at the source-map upload step: `An organization ID or slug is required (provide with --org)`. **Promoted from prebuild warning to build-blocker after iOS build #2 (2026-04-28).** | **Resolved 2026-04-28** | Added `"env": { "SENTRY_DISABLE_AUTO_UPLOAD": "true" }` to all three `eas.json` build profiles (development, preview, production). Sentry SDK still installs + catches crashes at runtime; only the build-time source-map upload step is skipped. Re-enable per-profile when Sentry org + auth token are configured (target: Cycle 14 or production-readiness pass). |
| **D-NFC-OUTCOME** | `react-native-nfc-manager` installed via plain npm (Option 3) since Expo had no SDK-54-compat mapping. Auto-links. iOS NFC entitlement deferred to Cycle 13 (Door Mode) — not used in Cycles 0a–12. | Info | Track for Cycle 13 dispatch |

### B.7 Transition Items

| Marker | Location | Exit condition |
|--------|----------|----------------|
| `// [TRANSITIONAL] Apple Tap to Pay entitlement` | `app.config.ts` top of file | Apple approves application → re-add `"com.apple.developer.proximity-reader.payment.acceptance": true` to `ios.entitlements` in `app.json` |
| `// [TRANSITIONAL] react-native-nfc-manager auto-linked` | `app.config.ts` plugins array | Cycle 13 (Door Mode) — re-evaluate if iOS NFC entitlement needs `expo-config-plugin-nfc-manager` (Option 1) |
| `// expo-blur 15.0.8 has no config plugin` | `app.config.ts` plugins array | If a future expo-blur version exports a config plugin, restore the entry |

### B.8 Files changed in Sub-phase B

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/package.json` | -3 react-navigation + +7 native modules | net -3 +7 lines |
| `mingla-business/package-lock.json` | regenerated | (auto) |
| `mingla-business/app.json` | extended with iOS permissions/entitlements/domains + Android permissions/intentFilters | +38 added, 1 modified |
| `mingla-business/app.config.ts` | extended with 5 new plugin entries (camera, image-picker, stripe, sentry) + transition comments | +30 added |

No source files (`src/` or `app/`) touched.

### B.9 Sub-phase B success criteria status

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | `@react-navigation/{bottom-tabs,elements,native}` removed from package.json + zero source matches | ✅ PASS | B.1 grep verification |
| 2 | All 7 native modules installed at SDK-54-compatible versions, exact versions recorded | ✅ PASS | B.2 version table |
| 3 | `app.config.ts` carries merchant ID, all permissions, all plugins; Tap to Pay OMITTED with transition comment | ✅ PASS | B.3 + transition comment in app.config.ts |
| 4 | `npx expo prebuild --clean` succeeds; warnings surfaced | ✅ PASS | B.4 (after D-DEV-1 fix) |
| 5 | iOS dev client builds successfully on EAS, build URL captured | ✅ PASS | Build #4 succeeded after 3 config-iteration fails (Apple Pay App ID capability + Sentry source-map upload) |
| 6 | Android dev client builds successfully on EAS | ✅ PASS | Build succeeded first try (config fixes from iOS were platform-agnostic) |
| 7 | iOS dev client installed, boots, Google sign-in flow opens (I-2 verified) | ✅ PASS | Founder confirmed welcome → Google sign-in → home → sign-out round-trip on physical iPhone |
| 8 | Android dev client same | ✅ PASS | Founder confirmed boot + sign-in flow on Android device |
| 9 | Sub-phase B section appended to report with all evidence | ✅ PASS | this section |
| 10 | NFC outcome (D-NFC-OUTCOME) documented | ✅ PASS | B.6 — Option 3 (forced npm install + auto-link) |

**Status:** 10 of 10 PASS. Sub-phase B closed.

### B.10 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched in Sub-phase B |
| I-2 | ✅ Verified both platforms | Founder confirmed welcome → Google sign-in → home → sign-out round-trip on iPhone + Android device |
| I-3 | ✅ iOS + Android verified; web pending Sub-phase F | iOS dev client boots, Android dev client boots. Web smoke pending styleguide route in Sub-phase F. |
| I-4 | ✅ Preserved | No source files touched |
| I-5 | ✅ Preserved | All new strings in Info.plist + Android permissions are organiser-context (ticket scanning, brand imagery, Apple Pay confirmation). No dating language |
| I-6 | ✅ Preserved | No TS code added |
| I-7 | ✅ Preserved | No catch blocks added |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | N/A | No animation code added |
| I-10 | N/A | No currency-handling code added |

### B.11 Founder action checklist before Sub-phase C

- [ ] Run `cd mingla-business && npx eas build --profile development --platform ios`
- [ ] Run `cd mingla-business && npx eas build --profile development --platform android`
- [ ] Capture both build URLs + durations + statuses for the report
- [ ] Install iOS dev client on physical iPhone, boot app, complete Google sign-in
- [ ] Install Android dev client on physical Android device, boot app, complete Google sign-in
- [ ] Confirm sign-out from home → welcome screen still works
- [ ] Hand back to orchestrator with screenshots / notes for Sub-phase C authorisation

If any step fails, STOP and hand back to orchestrator — Sub-phase C is gated on Sub-phase B being fully PASS on all 10 SC.

---

**End of Sub-phase B implementor section. Steps 5–6 awaiting founder.**

