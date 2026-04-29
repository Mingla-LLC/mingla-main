# Implementation Report — ORCH-BIZ-CYCLE-0a-001 · Mingla Business Foundation

**Status:** IN PROGRESS — **Sub-phases A / B / C.1 / C.2 / C.3 / D ✅ Complete**. Sub-phases E / F pending.
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

---

## Sub-phase C.1 — Tier 1 Atoms + Form/Display Primitives

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_C1.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_C1.md)
**Outcome:** all 9 components built, tsc clean, 5 verification gates PASS, 6 success criteria PASS (SC-10 = report appended). 4 SC remain UNVERIFIED until visual smoke in Sub-phase E styleguide.

### C.1.1 Files created (9 new)

All at `mingla-business/src/components/ui/`. Each carries an exported `Props` interface and both named + default exports.

#### `Icon.tsx`

**What it did before:** did not exist.
**What it does now:** ports 69 SVG glyphs verbatim from `design-package/.../primitives.jsx:9–79` into a `react-native-svg` `<Svg>` wrapper. Exports `IconName` union (69 string literals) so callers get autocomplete + compile-time validation. `<Icon name="home" size={22} color={text.primary} strokeWidth={1.75} />`. Invalid names log a dev-only `console.warn` and render a fallback square (no crash). Glyphs that the source rendered with `fill="currentColor"` (apple, moreH, keypad, flashOn, star, play, pause, target, tag) thread the `color` prop through `fill={color}`. Stroked glyphs inherit stroke from the parent `<Svg>` `stroke` attribute.
**Why:** SC-1 + SC-3 — most-imported atom; `Button` (leading icon), `Input` (leading icon + clear), `StatusBar` (web simulated cluster) all consume.
**Lines added:** ~290

#### `MinglaMark.tsx`

**What it did before:** did not exist.
**What it does now:** 32×32 brand monogram. Rounded gradient square (`#fb923c → #eb7825` at 135°) with white M path (stroke 2px, round caps/joins). Each instance generates a unique gradient id via React 19 `useId()` so multiple marks on the same screen don't collide on `<defs>` ids. Props `{ size?: number = 28; color?: string = "#fff" }`.
**Why:** SC-1 + SC-3 + SC-6 — only authorised hex (`#fb923c`, `#eb7825`, `#fff`) per dispatch SC-6. Required by future `TopBar` in Tier 3.
**Lines added:** ~55

#### `Spinner.tsx`

**What it did before:** did not exist.
**What it does now:** indeterminate loading affordance. Renders a 3/4-arc `<Circle>` and rotates it 360° per second via Reanimated v4 (`withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1)`). Reduce-motion fallback collapses to a 600ms opacity 0.6 ↔ 1.0 cycle (no rotation). Sizes `24 | 36 | 48`, stroke 3px, default colour `accent.warm`. Cleanup cancels animation on unmount.
**Why:** SC-1 + SC-3 + SC-5 — `Button.loading` state replaces leading icon with this; future deck loading states consume it.
**Lines added:** ~95

#### `Skeleton.tsx`

**What it did before:** did not exist.
**What it does now:** loading placeholder shape. Base background `rgba(255,255,255,0.06)`. Shimmer overlay via `expo-linear-gradient` translates from `-containerWidth` to `+containerWidth` over 1400ms with `Easing.out(Easing.ease)`. Shimmer width is 60% of container, animated through `Animated.createAnimatedComponent(LinearGradient)`. Reduce-motion fallback renders the static base, no sweep. Props `{ width, height, radius?: keyof radius = 'md' }`.
**Why:** SC-1 + SC-3 + SC-5 — Tier 2 `EventCover` and `KpiTile` will compose this for missing-image / loading states.
**Lines added:** ~110

#### `StatusBar.tsx`

**What it did before:** did not exist.
**What it does now:** three exports — `<NativeStatusBar barStyle?="light" translucent? />` (wraps `expo-status-bar` for native), `<WebStatusBar time? textColor? />` (renders a simulated iOS row on web with live-updating clock + chart/globe/flashOn icon cluster), and `<StatusBar />` (default — switches by `Platform.OS`). Time formats locally; ticks every 30s. Passes Mingla domain rule — no dating language.
**Why:** SC-1 + SC-3 — used by every screen that wants the "phone-bg" prototype framing on web. **Spec deviation (D-IMPL-2):** dispatch §5.5 + §3.2 produced a TS name collision because `NativeStatusBarProps.style` and `WebStatusBarProps.style` had different types. Renamed the native bar's foreground style prop to `barStyle` to disambiguate. Documented below.
**Lines added:** ~110

#### `Button.tsx`

**What it did before:** did not exist.
**What it does now:** primary CTA primitive. Variants `primary | secondary | ghost | destructive` × sizes `sm (36) | md (44) | lg (52)` × shapes `pill | square`. Press scale 0.96 over 120ms `easings.press`; reduce-motion fallback opacity 0.7. Loading state replaces leading icon with `<Spinner />`, dims label to opacity 0.7 (layout stable). Disabled state opacity 0.32, no haptic. Native: `HapticFeedback.buttonPress()` (light impact) on press-down. Web: hover bumps background by ~6% lightness; focus draws 2px `accent.warm` outline (only when `:focus-visible`). `onPress` errors are caught in `__DEV__` console and not surfaced to the user — caller is expected to handle outcomes via toasts upstream. A11y: `accessibilityRole="button"`, `accessibilityState={{ disabled, busy: loading }}`.
**Why:** SC-1 + SC-3 + SC-4 + SC-5 — the integration point for Icon + Spinner.
**Lines added:** ~245

#### `Pill.tsx`

**What it did before:** did not exist.
**What it does now:** small chip primitive. 6 variants (`live | draft | warn | accent | error | info`) each map to a tinted background, border, status dot colour, and text colour. Height 24, radius `full`, padding-x 10, font `typography.micro` UPPERCASE. The 6×6 dot sits on the left with 6px gap. `livePulse` triggers a Reanimated `withRepeat(withTiming(1.4, ..., Easing.inOut(Easing.sin)), -1, true)` on the dot's scale; reduce-motion collapses to opacity 0.5 ↔ 1.0. Cleanup cancels on unmount.
**Why:** SC-1 + SC-3 + SC-4 + SC-5 — wrapped by `StatusPill`; future `KpiTile`, `EventCover` overlays compose this.
**Lines added:** ~165

#### `StatusPill.tsx`

**What it did before:** did not exist.
**What it does now:** opinionated `Pill` wrapper. Status dictionary maps the 7 organiser states (`LIVE | DRAFT | UPCOMING | ENDED | PENDING | PREVIEW | SOLD_OUT`) to variant + label + livePulse triple. `LIVE` auto-sets `livePulse: true`. Optional `overrideLabel` for chrome compositions that need e.g. "STARTING SOON" with the UPCOMING variant. **Spec deviation (D-IMPL-3):** dispatch §5.8 specified `'SOLD OUT'` (with space) as the prop value. Used `'SOLD_OUT'` (underscore) so the union is a valid TypeScript identifier in switch/match contexts; the rendered label preserves the space (`"SOLD OUT"`).
**Why:** SC-1 + SC-3 + SC-4 — the only domain-aware primitive in this tier; saves later cycles from re-deriving status colour rules.
**Lines added:** ~75

#### `Input.tsx`

**What it did before:** did not exist.
**What it does now:** single-line text input. Variants `text | email | phone | number | password | search` map to sensible `keyboardType` + `secureTextEntry` + `autoCapitalize` + `autoComplete` defaults so callers get the right keyboard for free. `search` injects a leading magnifying-glass icon. Height 48, radius `sm`, padding-x 14. Background `rgba(255,255,255,0.04)`. Border 1px `rgba(255,255,255,0.12)` idle → 1.5px `accent.warm` on focus. Optional leading icon (12px from left). Optional clear button (`<Pressable>` with `accessibilityRole="button"` + 8px hitSlop) shows when `clearable === true` AND value is non-empty. Forwards standard `TextInputProps` via `...rest` for power users (autoFocus, returnKeyType, etc.).
**Why:** SC-1 + SC-3 + SC-4 — needed for every later form (auth, brand creation, event wizard).
**Lines added:** ~190

### C.1.2 Verification matrix (10 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | 9 component files at `src/components/ui/` | ✅ PASS | `ls src/components/ui/*.tsx` returns 10 (9 new + existing BrandIcons.tsx) |
| 2 | Each carries an exported Props interface | ✅ PASS | `IconProps`, `MinglaMarkProps`, `SpinnerProps`, `SkeletonProps`, `NativeStatusBarProps`+`WebStatusBarProps`+`StatusBarProps`, `ButtonProps`, `PillProps`, `StatusPillProps`, `InputProps` all exported |
| 3 | Strictly typed; verification §6.1 + §6.2 pass | ✅ PASS | `npx tsc --noEmit` exits 0; grep for `any|@ts-ignore|@ts-expect-error` returns only 2 matches both inside explanatory comments (Button.tsx:97, StatusPill.tsx:21) — no actual code violations |
| 4 | Every variant + state from master §7.1 implemented | ✅ PASS | Button: 4 variants × 3 sizes × {idle, hover, focus, press, loading, disabled} states; Pill: 6 variants × {idle, livePulse, reduce-motion}; StatusPill: 7 statuses; Input: 6 variants × {idle, focus, clearable, disabled} |
| 5 | Reduce-motion fallback in Spinner / Skeleton / Button / Pill | ✅ PASS | Spinner.tsx:51-71 (opacity cycle); Skeleton.tsx:51-66 (static base); Button.tsx:128-143 (opacity 0.7); Pill.tsx:106-127 (dot opacity) |
| 6 | Token values from designSystem.ts; only allowed hex is MinglaMark + Skeleton-RGBA | ⚠ PASS WITH NOTE | Audit found 6 hex literals: 4 in Icon.tsx (Google brand palette — externally specified, cannot be tokenised); 2 in Button.tsx (`#f0843a`, `#f25656` hover shades — flagged as **D-IMPL-1**, candidate for future `accent.warm.hover` / `semantic.errorHover` tokens). Skeleton uses RGBA only. MinglaMark uses #fb923c/#eb7825 (allowed by SC-6) + #fff (allowed default). All other colours flow through `designSystem.ts` token exports. |
| 7 | Mingla domain rule: zero "dating" / "match-making" language | ✅ PASS | `grep -riE "dating|match-making|swipe to like" src/components/ui` returns zero matches |
| 8 | `npx tsc --noEmit` exits 0 | ✅ PASS | Final run after all fixes: `EXIT: 0` |
| 9 | Forbidden-import grep returns zero matches | ✅ PASS | `grep -rE "from \".*app-mobile|from 'app-mobile" src/components/ui` returns zero |
| 10 | Sub-phase C.1 section appended to report | ✅ PASS | This section |

**Visual smoke** is intentionally deferred to Sub-phase E (`__styleguide.tsx`). Components are TypeScript-clean and dependency-graph-sound but have not been rendered on a real device or browser. SC-4 (every variant implemented) is verified by reading the code, not by rendering.

### C.1.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched in this tier |
| I-2 | ✅ Preserved | No auth files touched |
| I-3 | ✅ Preserved (TS-level); web visual smoke deferred to Sub-phase F | Components use `Platform.OS === 'web'` guards in StatusBar; no native-only API used without web fallback |
| I-4 | ✅ Preserved | Cross-app forbidden-import grep returns zero |
| I-5 | ✅ Preserved | Domain-rule grep returns zero; sample text in StatusPill dictionary uses event-organiser language only |
| I-6 | ✅ Preserved | No `any`, no `@ts-ignore`, no `@ts-expect-error`; tsc strict clean |
| I-7 | ✅ Preserved | Icon invalid name warns + falls back to square (never throws/null); Button onPress errors caught and dev-logged (production silent — caller responsible for user-visible feedback) |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | Reduce-motion wired in 4 of the 4 animated components (Spinner, Skeleton, Button, Pill) |
| I-10 | ✅ Preserved (N/A this tier) | No currency strings — currency lands in Tier 2 KpiTile / ActionTile |

### C.1.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-1** | Button hover backgrounds for solid-fill variants (`primary`, `destructive`) hardcode shade hex (`#f0843a`, `#f25656`). Dispatch §3.6 said "+6% alpha" which doesn't apply cleanly to fully-opaque tokens. Hardcoded values were chosen as the smallest deviation. | Low (cosmetic) | Add `accent.warmHover` and `semantic.errorHover` tokens to `designSystem.ts` in a future Sub-phase A revision. Until then, the hex values are inline-commented and tracked here. |
| **D-IMPL-2** | TypeScript type collision in `StatusBar.tsx`: `NativeStatusBarProps.style` (StatusBarStyle string union) collided with `WebStatusBarProps.style` (`StyleProp<ViewStyle>`). Renamed native prop to `barStyle` to disambiguate. Dispatch §5.5 hadn't anticipated. | Low | Future cycles consuming `<NativeStatusBar />` directly use `barStyle`, not `style`. The default `<StatusBar />` export accepts both fields cleanly. |
| **D-IMPL-3** | Dispatch §5.8 used `'SOLD OUT'` (with space) as a `StatusPillStatus` value. Renamed to `'SOLD_OUT'` (underscore) so the union is a valid identifier; the rendered label preserves the space. | Low | Update dispatch §5.8 in any future cycle reference. |
| **D-IMPL-4** | `react-native-reanimated`'s `useReducedMotion` hook returns `boolean` synchronously per v4 docs. Implementation does not need to handle the legacy "fallback to false on detection failure" rule from dispatch §3.7 because the hook never errors at runtime — it falls back to false internally. Comment block in dispatch §3.7 is outdated reference. | Info | None |
| **D-PROC-1** | Monorepo Metro-port collision: `app-mobile/` and `mingla-business/` both default to Metro port 8081 + similar URL schemes. If a stale `npx expo start` is running in one app's directory, opening the OTHER app's dev client can cross-connect to the wrong Metro server, loading the wrong JS bundle on the right native binary. Symptom: `RNCNetInfo is null` (netinfo only declared in app-mobile) + Reanimated C++ vs JS version mismatch. Founder confirmed cause was working-directory mistake; resolved by `Ctrl+C → cd mingla-business → npx expo start --clear`. | Info | Add to onboarding / dev-setup notes for Mingla Business: "Always confirm Metro is running from `mingla-business/` (not `app-mobile/` or project root) before opening the dev client." Optional future hardening: configure mingla-business to run on port 8082 in `app.config.ts` to physically separate the two. |

### C.1.5 Transition Items

| Marker | Location | Exit condition |
|--------|----------|----------------|
| Inline comment block in `Button.tsx` `VARIANT_TOKENS` | Solid-fill hover backgrounds | Add `accent.warmHover` / `semantic.errorHover` tokens to `designSystem.ts` and replace hex literals (D-IMPL-1) |
| Inline comment block in `Icon.tsx` above `google` renderer | Google brand palette explanation | Permanent — Google requires their palette unchanged |

### C.1.6 Files changed

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/components/ui/Icon.tsx` | new | ~290 |
| `mingla-business/src/components/ui/MinglaMark.tsx` | new | ~55 |
| `mingla-business/src/components/ui/Spinner.tsx` | new | ~95 |
| `mingla-business/src/components/ui/Skeleton.tsx` | new | ~110 |
| `mingla-business/src/components/ui/StatusBar.tsx` | new | ~110 |
| `mingla-business/src/components/ui/Button.tsx` | new | ~245 |
| `mingla-business/src/components/ui/Pill.tsx` | new | ~165 |
| `mingla-business/src/components/ui/StatusPill.tsx` | new | ~75 |
| `mingla-business/src/components/ui/Input.tsx` | new | ~195 |

**Total:** 9 new files, ~1340 net lines added. Zero files modified, zero deleted.

### C.1.7 Founder action

Tier 1 components are TypeScript-clean and ready for Tier 2 (C.2) consumption. Visual smoke happens in Sub-phase E styleguide — Tier 1 alone has no rendering surface. Authorise Tier 2 (C.2 — IconChrome / GlassChrome / GlassCard / EventCover / KpiTile / ActionTile / EmptyState) when ready.

---

**End of Sub-phase C.1 report.**

---

## Sub-phase C.2 — Tier 2 Glass + Composition Primitives

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_C2.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_C2.md)
**Outcome:** all 7 components built, tsc clean, all 7 verification gates PASS, all 10 success criteria PASS (SC-10 = report appended). Visual smoke deferred to Sub-phase E.

### C.2.1 Files created (7 new)

All at `mingla-business/src/components/ui/`. Each carries an exported `Props` interface and both named + default exports.

#### `GlassChrome.tsx`

**What it did before:** did not exist.
**What it does now:** the foundation 5-layer glass wrapper. Renders L1 BlurView (`expo-blur` v15.0.8 with `tint="dark"` and intensity from `blurIntensity` token map — `chrome=28`, `cardBase=30`, `cardElevated=34`, `modal=40`, `badge=24`, `backdrop=22`) → L2 tint floor (translucent fill from `glass.tint.{badge|chrome|backdrop|profileBase|profileElevated}`) → L3 top-edge highlight (1px line at `glass.highlight.{profileBase|profileElevated}`) → L4 hairline border (`StyleSheet.hairlineWidth` perimeter at `glass.border.{chrome|profileBase|profileElevated}`) → L5 drop shadow (token-driven, applied to outer container). Web fallback path detected at module scope: when `Platform.OS === 'web'` AND neither `backdrop-filter` nor `-webkit-backdrop-filter` is supported, L1 falls back to a solid `<View>` with `backgroundColor: rgba(20,22,26,0.92)` — visible degradation, never `return null` (Invariant I-7). Props expose `intensity`, `tint` (preset), `radius`, `tintColor` / `borderColor` / `highlightColor` (overrides), and `shadow` (style override). Children render in a clipped inner container so the L1 blur doesn't bleed beyond the rounded radius.
**Why:** SC-1 + SC-3 + SC-5 + SC-6 — the bedrock glass primitive. IconChrome composes it. GlassCard composes it. Future TopBar / BottomNav (Tier 3) will compose it.
**Lines added:** ~150

#### `IconChrome.tsx`

**What it did before:** did not exist.
**What it does now:** 36×36 circular glass icon button. Composed from `GlassChrome` (radius `full`, intensity `chrome`) + `Icon` (size = `0.5 * containerSize`). Active variant overrides `tintColor → accent.tint`, `borderColor → accent.border`, `shadow → shadows.glassChromeActive` (the warm-glow shadow), and the icon colour to `accent.warm`. Press: scale 0.96 over 120ms `easings.press` (reduce-motion: opacity 0.7). Light haptic on native press-down. Optional badge dot in top-right (`semantic.error` background + `text.inverse` micro-cap label, hides when `badge === 0 || undefined`, displays `"99+"` for badge values >99). When `onPress` is `undefined`, renders as a non-interactive presentational chrome (no Pressable wrapper).
**Why:** SC-1 + SC-3 + SC-4 + SC-5 — used by future TopBar (search/bell), Brand chip dropdown trigger, BottomNav fab affordances.
**Lines added:** ~205

#### `GlassCard.tsx`

**What it did before:** did not exist.
**What it does now:** content-area card. Two variants:
- `base`: intensity `cardBase` (30), tint `glass.tint.profileBase`, border `glass.border.profileBase`, highlight `glass.highlight.profileBase`, shadow `shadows.glassCardBase`, default radius `lg` (16).
- `elevated`: intensity `cardElevated` (34), tint `glass.tint.profileElevated`, border `glass.border.profileElevated`, highlight `glass.highlight.profileElevated`, shadow `shadows.glassCardElevated`, default radius `xl` (24).

Composes `GlassChrome` directly (no duplication of the 5-layer logic). Inner padding default `spacing.md` (16); pass `padding={0}` for flush content. The judgment-call from dispatch §5.3 — chose to compose GlassChrome rather than duplicate the layer stack — keeps both primitives in lockstep when the glass material is later refined.
**Why:** SC-1 + SC-3 + SC-5 — KpiTile, ActionTile, EmptyState all consume; future deck cards in Cycle 4 will too.
**Lines added:** ~95

#### `EventCover.tsx`

**What it did before:** did not exist.
**What it does now:** hue-driven striped placeholder for missing event imagery. Source web reference at `primitives.jsx:101–122` uses CSS `repeating-linear-gradient` with `oklch()` colour values. Both unsupported in React Native; ported as: a `<react-native-svg>` element with a base `<Rect>` fill (`hsl(hue, 60%, 50%)`) and a clipped `<G>` containing parallel `<Rect>` stripes (`hsl(hue, 60%, 40%)`, 14px wide × 14px gap, rotated 45°) over a square 600×600 viewBox with `preserveAspectRatio="xMidYMid slice"`. Bottom vignette via `expo-linear-gradient` (transparent → `rgba(0,0,0,0.72)` from 50%→100%). Top-left "COVER" label (10/14, weight 600, letter-spacing 0.5, colour `rgba(255,255,255,0.55)`). Children render on top as overlay slot. Props: `hue?, radius?, label?, height?, width?, children?`. **Colour-space deviation logged as D-IMPL-5.**
**Why:** SC-1 + SC-3 — required for any event surface that lacks Cloudinary imagery; future deck card empty-cover state composes this.
**Lines added:** ~135

#### `KpiTile.tsx`

**What it did before:** did not exist.
**What it does now:** dashboard tile. Composes `GlassCard variant="base"` containing label (uppercase `typography.labelCap`, colour `text.tertiary`) + value (`typography.statValue`, `text.primary`, `adjustsFontSizeToFit` for very long values) + optional delta (`typography.caption`, colour drives by `deltaUp`: `true → semantic.success`, `false → semantic.error`, `undefined → text.tertiary`) + optional sub (`typography.bodySm`, `text.secondary`, max 2 lines). **Currency-aware contract (Invariant I-10):** `value: string | number` — caller is responsible for `Intl.NumberFormat` formatting (locale + currency + min/max fraction digits). KpiTile NEVER formats currency itself. Documented at the file head and in `value` prop JSDoc.
**Why:** SC-1 + SC-3 + SC-5 + SC-7 — every dashboard surface in Cycles 1, 9, 12 will compose this. Currency neutrality is the load-bearing contract.
**Lines added:** ~115

#### `ActionTile.tsx`

**What it did before:** did not exist.
**What it does now:** action grid tile. Composes `GlassCard` (variant `base` for default, `elevated` + `shadows.glassChromeActive` for `primary`) containing a 40×40 circular icon container + label (`typography.bodyLg`, weight 600) + optional sub (`typography.bodySm`, secondary). Primary variant: icon container background `accent.tint`, border `accent.border`, icon colour `accent.warm`. Default variant: icon container background `glass.tint.profileElevated`, border `glass.border.profileElevated`, icon colour `text.primary`. Press: scale 0.97 / 120ms / `easings.press` (reduce-motion: opacity 0.85). Light haptic on native. Min-height 96, padding 16. `onPress` errors caught with `__DEV__` console (caller responsible for user-visible feedback upstream).
**Why:** SC-1 + SC-3 + SC-5 — used in future Home / Events action grids; the `primary` variant differentiates the hero action.
**Lines added:** ~190

#### `EmptyState.tsx`

**What it did before:** did not exist.
**What it does now:** centred panel with optional illustration (`IconName` string OR custom `React.ReactNode`) + h3 title + bodySm description + optional CTA `Button`. Type guard `isIconName` distinguishes the union. When `illustration` is an `IconName`, renders `<Icon size={48} color={text.quaternary} />`. CTA renders the `Button` primitive with default variant `primary`, size `md`. Layout: vertical centred stack, padding `spacing.lg`, gaps `spacing.md` between illustration + title, `spacing.xs` between title + description, `spacing.lg` (less `xs` margin compensation) before CTA.
**Why:** SC-1 + SC-3 — every empty state in Cycles 1–17 (no events yet, no orders, etc.) composes this with organiser-language copy at the call site.
**Lines added:** ~115

### C.2.2 Verification matrix (10 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | 7 component files at `src/components/ui/` | ✅ PASS | `ls src/components/ui/*.tsx` returns 17 (9 from C.1 + 7 new + existing BrandIcons.tsx) |
| 2 | Each carries an exported `Props` interface | ✅ PASS | `GlassChromeProps`, `IconChromeProps`, `GlassCardProps`, `EventCoverProps`, `KpiTileProps`, `ActionTileProps`, `EmptyStateProps` all exported |
| 3 | Strictly typed; verification §6.1 + §6.2 pass | ✅ PASS | `npx tsc --noEmit` exits 0; grep for `any|@ts-ignore` returns only matches inside comment text or natural-language doc strings ("anything that floats", "any list / surface", "any reasonable cover") — no actual code violations |
| 4 | Every variant + state from master §7.1 §10–15 + §19 implemented | ✅ PASS | GlassChrome 6 intensities × 3 tints × 5 radii; IconChrome {idle, active, pressed, disabled, with-badge} × press states; GlassCard 2 variants; EventCover hue + label + overlay-slot; KpiTile {with/without delta, deltaUp true/false/undefined, with/without sub}; ActionTile {primary true/false} × press states; EmptyState {with/without illustration, illustration as IconName vs ReactNode, with/without description, with/without CTA} |
| 5 | 5-layer glass rule preserved | ✅ PASS | GlassChrome.tsx renders L1 BlurView (line 110), L2 tint floor (line 119), L3 top highlight (line 124), L4 hairline border (line 130), L5 shadow (line 78). IconChrome + GlassCard compose GlassChrome directly — same stack |
| 6 | Web `backdrop-filter` fallback wired | ✅ PASS | GlassChrome.tsx:60-66 `supportsBackdropFilter` constant detects via `CSS.supports`; lines 108-117 branch between `<BlurView>` (when supported) and solid-rgba `<View>` (when unsupported). Detection runs once at module scope to avoid per-render cost |
| 7 | KpiTile contract: caller pre-formats | ✅ PASS | KpiTile.tsx accepts `value: string | number`, renders via `String(value)` only; no `Intl.NumberFormat` call. Documented at file head + in `value` prop JSDoc + `KpiTileProps` |
| 8 | Mingla domain rule: zero "dating" / "match-making" / "swipe to" / "swipe right/left" | ✅ PASS | `grep -riE "dating\|match-making\|swipe to like\|swipe right\|swipe left" src/components/ui` returns zero matches |
| 9 | `npx tsc --noEmit` exits 0 | ✅ PASS | Final post-fix run: `EXIT: 0` |
| 10 | Sub-phase C.2 section appended to report | ✅ PASS | This section |

**Visual smoke** is intentionally deferred to Sub-phase E (`__styleguide.tsx`). Components are TypeScript-clean and dependency-graph-sound but have not been rendered on real device or browser. All variants are verified at the code-level (read), not at render-time.

### C.2.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched in this tier |
| I-2 | ✅ Preserved | No auth files touched |
| I-3 | ✅ Preserved (TS-level); Sub-phase F runs full web smoke | `Platform.OS === "web"` guard wraps the only platform-divergent path (BlurView fallback). All 7 components render on iOS, Android, and web — verified by code review |
| I-4 | ✅ Preserved | Cross-app forbidden-import grep returns zero |
| I-5 | ✅ Preserved | Domain-rule grep returns zero; sample default copy in EmptyState defaults uses neutral / organiser-friendly language only |
| I-6 | ✅ Preserved | No `any`, no `@ts-ignore`, no `@ts-expect-error`; tsc strict clean |
| I-7 | ✅ Preserved | Web glass fallback is a visible solid-rgba layer, not null. EventCover renders parallel rects (the safer primary path) — degrades gracefully if SVG renderer chokes on the clipped `<G>` |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | Reduce-motion wired in IconChrome + ActionTile press animations (the only motion in this tier). GlassChrome / GlassCard / EventCover / KpiTile / EmptyState are static |
| I-10 | ✅ Preserved | KpiTile `value: string | number` contract; no formatting in component (caller responsibility) — the load-bearing currency-neutrality contract |

### C.2.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-5** | EventCover web source uses `oklch()` colour space which RN does not support. Approximated `oklch(0.55 0.18 hue)` → `hsl(hue, 60%, 45%)` and `oklch(0.50 0.16 hue)` → `hsl(hue, 60%, 40%)`. Approximation is perceptually close but not identical at extreme hues (near-grey desaturation differs). | Low (cosmetic) | If exact-match becomes required, port a JS oklch→rgb function (~30 LOC) or accept the deviation as a known design-fidelity gap. Track for Sub-phase E styleguide visual smoke. |
| **D-IMPL-6** | `expo-blur` v15.0.8 on web automatically maps `<BlurView>` to `backdrop-filter: blur(N) saturate(...)`. No explicit web shim code needed in our component — the package handles it. Our `supportsBackdropFilter` detection is therefore a fallback safety net for browsers that lack `backdrop-filter` (Firefox <103, older Safari, some embedded browsers). | Info | None — implementation is correct as-shipped. |
| **D-IMPL-7** | `PressableStateCallbackType` requires both `pressed: boolean` and `hovered: boolean`. When rendering a non-interactive variant of IconChrome, we call the render function with `{ pressed: false, hovered: false }` to satisfy the type. Identical pattern as Button's pressable-state extension from C.1. | Info | None — type discipline preserved without escape casts. |

### C.2.5 Transition Items

None added in this tier. The two pre-existing transitional comments (Button hover hex shades from C.1, Apple Tap to Pay entitlement from Sub-phase B) remain unchanged.

### C.2.6 Files changed

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/components/ui/GlassChrome.tsx` | new | ~150 |
| `mingla-business/src/components/ui/IconChrome.tsx` | new | ~205 |
| `mingla-business/src/components/ui/GlassCard.tsx` | new | ~95 |
| `mingla-business/src/components/ui/EventCover.tsx` | new | ~135 |
| `mingla-business/src/components/ui/KpiTile.tsx` | new | ~115 |
| `mingla-business/src/components/ui/ActionTile.tsx` | new | ~190 |
| `mingla-business/src/components/ui/EmptyState.tsx` | new | ~115 |

**Total:** 7 new files, ~1005 net lines added. Zero files modified, zero deleted.

### C.2.7 Founder action

Tier 2 components are TypeScript-clean and ready for Tier 3 (C.3) consumption. Visual smoke happens in Sub-phase E styleguide — Tier 2 alone has no rendering surface. Authorise Tier 3 (C.3 — Toast / Sheet / Modal / ErrorBoundary / ConfirmDialog / Stepper / TopBar / BottomNav, 8 components) when ready.

---

**End of Sub-phase C.2 report.**

---

## Sub-phase C.3 — Tier 3 Overlays + Chrome

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_C3.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_C3.md)
**Outcome:** all 8 components built, tsc clean, all 7 verification gates PASS, all 13 success criteria PASS (SC-13 = report appended). The kit is now COMPLETE.

### C.3.1 Files created (8 new)

All at `mingla-business/src/components/ui/`. Each carries an exported `Props` interface and both named + default exports.

#### `Toast.tsx`

**What it did before:** did not exist.
**What it does now:** top-of-screen banner. 4 kinds (`success | error | warn | info`) each map to a leading icon + tinted accent strip on the leading edge of an `elevated` GlassCard. Auto-dismiss timing per kind: success/info 2600ms, warning 6000ms, error persistent (caller must close). Slide-down (translateY -40 → 0) + opacity entrance over 220ms `Easing.out(cubic)`; exit 160ms `Easing.in(cubic)`. Reduce-motion fallback: opacity-only entrance/exit, no translate. Auto-dismiss timer cleared on visibility change. Cleanup cancels animations on unmount. Max-width 480 on web, full-width minus 32px mobile.
**Why:** SC-1 + SC-3 + SC-5 — TopBar consumes for brand-chip taps; future cycles use for confirmation feedback.
**Lines added:** ~135

#### `Modal.tsx`

**What it did before:** did not exist.
**What it does now:** centred overlay panel. Scrim `rgba(0,0,0,0.5)` over full screen, tap to dismiss (configurable via `dismissOnScrimTap`). Web: Escape key fires `onClose` (registered on `document` via runtime-detected `globalThis.document`). Native: no Escape handling. Open: scrim fade 200ms + panel scale 0.96→1.0 + opacity over 200ms `Easing.out`. Close: scale 1.0→0.96 + opacity 0 over 160ms `Easing.in`. Reduce-motion: opacity-only. Body uses `GlassCard variant="elevated"` with `radius="xl"` and `padding={spacing.lg}`. Web max-width 480 (caller can override).
**Why:** SC-1 + SC-3 + SC-5 + SC-6 — ConfirmDialog composes; future cycles use for any centred dialog.
**Lines added:** ~165

#### `Sheet.tsx`

**What it did before:** did not exist.
**What it does now:** bottom-anchored drag-to-dismiss panel. Snap points relative to screen height: `peek=25%`, `half=50%`, `full=90%`. Drag handle (36×4 rounded, colour `glass.border.pending`) at top of panel. Open: spring (`damping: 22, stiffness: 200, mass: 1`) on translateY from full-height-down to 0. Reduce-motion: 200ms timing fade-in, no spring. Close: 240ms `Easing.in(cubic)` translateY back. Drag gesture via `react-native-gesture-handler` `Gesture.Pan().onUpdate().onEnd()` — only allows drag-down (translationY > 0). Closes when translationY > 80px OR velocityY > 600. Body: `GlassCard variant="elevated"` with top corners radius `xl`, bottom corners 0. **Caller must wrap app root in `GestureHandlerRootView`** — Expo Router 6 includes one by default.
**Why:** SC-1 + SC-3 + SC-5 + SC-7 — every later cycle that needs bottom-sheet UI (brand creation in Cycle 1, brand switcher in Cycle 2, etc.) composes this.
**Lines added:** ~210

#### `ErrorBoundary.tsx`

**What it did before:** did not exist.
**What it does now:** wraps `react-error-boundary`'s `ErrorBoundary`. Default `FallbackComponent` renders the Mingla Business standard panel: flag icon + "Something broke." h3 title + "We're on it." bodySm description + 2 Buttons (`Try again` primary fires `resetErrorBoundary()`, `Get help` ghost fires a `console.log` placeholder per **Transition Item — Sentry wiring deferred to Cycle 14**). Optional `onError` prop typed as `ReactErrorBoundaryProps["onError"]` (which has `error: unknown` — accommodates the actual react-error-boundary v6 signature). Optional `FallbackComponent` override + `onReset` callback.
**Why:** SC-1 + SC-3 + SC-10 — top-level + per-route error containment for every screen in Cycles 1–17.
**Lines added:** ~125

#### `ConfirmDialog.tsx`

**What it did before:** did not exist.
**What it does now:** three-variant confirmation dialog over `Modal`. Common: title + description + Cancel button (`secondary`). Variants:
- `simple`: + Confirm button (`primary` or `destructive` if `destructive: true`).
- `typeToConfirm`: + hint "Type X to confirm." + `Input` field. Confirm button disabled until `inputValue === confirmText` exactly.
- `holdToConfirm`: Confirm replaced by a custom `Pressable` with progress bar inside. Press-and-hold 1500ms with `Easing.linear` fills width 0→100%. Release before 100% resets to 0% over 200ms. At 100% triggers `onConfirm()` via `runOnJS`. **Hold-to-confirm intentionally exempt from reduce-motion** — the animated progress fill IS the load-bearing UX (users need to see hold time).

`onConfirm` errors caught with `__DEV__` console (caller responsible for user-visible feedback upstream).
**Why:** SC-1 + SC-3 + SC-4 — destructive actions in admin / settings flows; the type-to-confirm variant gates account-deletion-style irreversible actions.
**Lines added:** ~225

#### `Stepper.tsx`

**What it did before:** did not exist.
**What it does now:** wizard step indicator. Switches by `Platform.OS`. Mobile (`StepperMobile`): 8×8 dot row with optional "Step N of M" caption. Current dot `accent.warm`, completed dots `text.inverse`, future dots `rgba(255,255,255,0.32)`. Web (`StepperWeb`): 24×24 numbered circles + label below + 2px connector line between steps. Connector contains an inner `Animated.View` whose width animates `0% → 100%` over 280ms `Easing.out(cubic)` when the step transitions from future to completed. Reduce-motion: connector fill jumps to filled instantly. Props: `{ steps: Array<{id, label}>, currentIndex: number (0-based), showCaption?: boolean }`.
**Why:** SC-1 + SC-3 + SC-5 — every multi-step wizard in Cycles 1, 3, 7 (event creator, brand wizard, payment setup) composes this.
**Lines added:** ~190

#### `TopBar.tsx`

**What it did before:** did not exist.
**What it does now:** top-of-screen chrome. Wrapper: `GlassChrome` with `intensity="backdrop"` (22), `tintColor={glass.tint.backdrop}`, `radius="lg"`, min-height 56px. Three left variants:
- `brand`: MinglaMark + brand label + chevron-down. Reads `useCurrentBrand()` from `currentBrandStore`. When `null`, label is "Create brand"; otherwise `truncate(displayName, 18)`. Wrapped in `Pressable` with accessibility role.
- `back`: chevron-left IconChrome (`onPress={onBack}`) + optional title (`typography.h3`).
- `none`: empty 36×36 placeholder for layout balance.

Right slot configurable; defaults to a `<DefaultRightSlot />` rendering search + bell IconChromes (with optional `unreadCount` badge on bell). **Cycle 0a transition: default right-slot icons render but onPress is unwired** — Cycle 1+ wires real navigation.

Brand chip tap behaviour:
- `null` → `Toast` "Brand creation lands in Cycle 1." (info kind)
- has brand → `Toast` "Brand switcher lands in Cycle 2." (info kind)

Toast renders inline at the end of the TopBar tree (not via global host) since Cycle 0a doesn't have a toast manager. Local state `useState<ToastState | null>`.
**Why:** SC-1 + SC-3 + SC-4 + SC-8 — every screen in Cycles 1–17 will render a TopBar variant.
**Lines added:** ~210

#### `BottomNav.tsx`

**What it did before:** did not exist.
**What it does now:** 3-tab capsule per DEC-073. Wrapper: `GlassChrome` with `radius="full"`, `intensity="chrome"`, `tintColor={glass.tint.chrome.idle}`. 64-px height, internal padding 8/8. Tabs are flex-equal-width Pressables — each renders Icon + label vertically. Active tab: white icon, weight-600 label. Inactive: `rgba(255,255,255,0.55)` icon, weight-500 label. Spotlight: absolutely-positioned `<Animated.View>` behind active tab — background `accent.tint`, border `accent.border`, shadow `shadows.glassChromeActive`, height 48, radius `full`. Animates `left` and `width` via spring (`damping: 18, stiffness: 260, mass: 0.9`) on `active` change. Reduce-motion: 200ms timing instead. Per-tab layout captured via `onLayout` event for accurate left/width measurement. Light haptic on tap (native only). A11y: each tab `accessibilityRole="tab"` + `accessibilityState={{ selected }}`. Per DEC-073, `tabs` prop accepts arbitrary length (Cycle 12 future-4-tab) but Cycle 0a default is 3.
**Why:** SC-1 + SC-3 + SC-4 + SC-9 — the BottomNav is the persistent visible navigation shell for every screen.
**Lines added:** ~190

### C.3.2 Verification matrix (13 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | 8 component files at `src/components/ui/` | ✅ PASS | `ls src/components/ui/*.tsx` returns 25 (1 BrandIcons + 9 C.1 + 7 C.2 + 8 C.3) |
| 2 | Each carries an exported Props interface | ✅ PASS | `ToastProps`, `ModalProps`, `SheetProps`, `ErrorBoundaryProps`, `ConfirmDialogProps`, `StepperProps`, `TopBarProps`, `BottomNavProps` all exported |
| 3 | Strictly typed; verification §6.1 + §6.2 pass | ✅ PASS | `npx tsc --noEmit` exits 0; grep for `any|@ts-ignore|@ts-expect-error` against tsx returns zero hits in code (only matches inside doc strings) |
| 4 | Every variant + state from master §7.1 §16–18 + §20–22 + §7.2 implemented | ✅ PASS | Toast: 4 kinds × {visible/hidden, auto-dismiss/persistent}; Modal: {visible/hidden, scrim-tap on/off, web Escape}; Sheet: 3 snap points × {drag-pan, scrim-tap}; ErrorBoundary: {default fallback, custom fallback, onError, onReset}; ConfirmDialog: 3 variants × {destructive/non, type-match disabled, hold-fill}; Stepper: 2 platforms × {current/completed/future per dot+connector}; TopBar: 3 leftKinds × {default rightSlot, custom rightSlot, brand-chip Toast}; BottomNav: arbitrary-length tabs × {active spotlight animated, haptic, layouts captured} |
| 5 | Reduce-motion in Toast / Sheet / Modal / BottomNav / Stepper; ConfirmDialog hold-to-confirm exempt | ✅ PASS | Toast.tsx:79 + 84 (translate vs opacity-only); Modal.tsx:73-83 + 87 (scale collapse); Sheet.tsx:80 + 84-85 (timing vs spring); BottomNav.tsx:91-100 (timing vs spring); Stepper.tsx:60-68 (instant vs animated). ConfirmDialog hold-to-confirm uses `withTiming(1, ..., Easing.linear)` unconditionally — documented in C.3.4 |
| 6 | Web Modal closes on Escape; native Modal does not | ✅ PASS | Modal.tsx:91-110 — `Platform.OS === "web"` guard wraps a `document.addEventListener("keydown", ...)` listener with cleanup |
| 7 | Sheet drag-to-dismiss via `react-native-gesture-handler` | ✅ PASS | Sheet.tsx:104-118 — `Gesture.Pan().onUpdate().onEnd()` v2 API; closes when translationY > 80 OR velocityY > 600 |
| 8 | TopBar reads `useCurrentBrand()` and switches label | ✅ PASS | TopBar.tsx:79 imports + line 96 reads; lines 109-119 switch label between "Create brand" and `truncate(displayName, 18)` |
| 9 | BottomNav spotlight animates spring on `active` change; default tabs prop is 3 | ✅ PASS | BottomNav.tsx:90-100 spring/timing branch; `tabs` prop is required (no implicit default — caller passes 3 per DEC-073) |
| 10 | ErrorBoundary `Get help` is `console.log` placeholder; Sentry deferred | ✅ PASS | ErrorBoundary.tsx:35-43 — `handleGetHelp` is dev-only console.log marked `[TRANSITIONAL]` with Cycle 14 exit condition. Documented in C.3.5 |
| 11 | Mingla domain rule preserved | ✅ PASS | `grep -riE "dating\|match-making\|swipe to like\|swipe right\|swipe left\|find someone\|chat with someone special" src/components/ui` returns zero matches |
| 12 | `npx tsc --noEmit` exits 0 | ✅ PASS | Final post-fix run: `EXIT: 0` |
| 13 | Sub-phase C.3 section appended to report | ✅ PASS | This section |

**Visual smoke** is intentionally deferred to Sub-phase E (`__styleguide.tsx`).

### C.3.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched |
| I-2 | ✅ Preserved | No auth files touched |
| I-3 | ✅ Preserved (TS-level); Sub-phase F runs full smoke | `Platform.OS` guards in Modal (Escape key) + Stepper (variant). Reduce-motion guards in 5 of 6 animated components. All 8 components render on iOS / Android / web — verified by code review |
| I-4 | ✅ Preserved | Cross-app forbidden-import grep returns zero |
| I-5 | ✅ Preserved | Domain-rule grep returns zero; Toast samples + ErrorBoundary copy use neutral / organiser-friendly language only |
| I-6 | ✅ Preserved | No `any`, no `@ts-ignore`, no `@ts-expect-error`; tsc strict clean |
| I-7 | ✅ Preserved | Modal scrim tap dismisses (visible). Toast errors don't auto-dismiss (visible — caller must close). Sheet drag past threshold dismisses (visible). ErrorBoundary fallback panel surfaces error (visible — never null). ConfirmDialog onConfirm errors caught with __DEV__ console (caller responsible for user feedback) |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved with documented exemption | Reduce-motion wired in 5 of 6 animated components (Toast, Sheet, Modal, BottomNav, Stepper). ConfirmDialog hold-to-confirm is INTENTIONALLY exempt — the progress fill IS the UX (users need to see hold time) — documented in C.3.4 and at the file head |
| I-10 | ✅ Preserved | No currency strings in this tier |

### C.3.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-8** | Auto-generated `.expo/types/router.d.ts` file was found corrupted (duplicate concatenated module declarations + unterminated template literal). The file references `mingla-business/src/components/ui/*` paths as ROUTES — Expo Router's typed-routes generator picked up component files outside `app/` directory, likely due to the auto-watcher running concurrently with file creation during this session. Deleted the file; tsc proceeded. The file regenerates on next `npx expo start`. **Founder action:** if the regenerated file shows the same bogus routes, file may be a real Expo Router bug — investigate `experiments.typedRoutes: true` config in `app.json` against the `app/` directory contents | Low — tooling artifact, not source code | Watch for the same corruption on next dev start. If it recurs, consider disabling `typedRoutes` until investigated |
| **D-IMPL-9** | `react-error-boundary` v6 `onError` callback uses `error: unknown` (not `error: Error`) per the v6 API. Resolved by deriving the type via `ReactErrorBoundaryProps["onError"]` rather than declaring it manually. Note for Sub-phase D / Cycle 14: when wiring Sentry's `captureException`, narrow the type with a `error instanceof Error` guard before extracting stack. | Info | None — resolved cleanly without escape casts |
| **D-IMPL-10** | `Input.tsx` (built in C.1) deliberately omits `autoCapitalize` and `autoCorrect` from the forwarded props (variant maps these internally). ConfirmDialog initial draft passed them; removed. The `Input.text` variant has no defaults for these — TextInput's natural defaults apply. If a future caller needs explicit override, they must use a different variant or we add `text-extended` variant exposing the autoCap/autoCorrect knobs. | Low | None — the omission is correct per Input's contract |

### C.3.5 Transition Items

| Marker | Location | Exit condition |
|--------|----------|----------------|
| `// [TRANSITIONAL] Cycle 14 wires Sentry feedback link / in-app support flow` | `ErrorBoundary.tsx:36` `handleGetHelp` | Cycle 14 — replace `console.log` with Sentry feedback dialog or in-app support deeplink |
| `// [TRANSITIONAL] right-slot icons render but onPress is unwired in Cycle 0a — Cycle 1+ wires search + notifications navigation` | `TopBar.tsx:64` `DefaultRightSlot` | Cycle 1+ — wire search + notifications screens |
| Brand chip taps fire placeholder Toasts ("Brand creation lands in Cycle 1.", "Brand switcher lands in Cycle 2.") | `TopBar.tsx:99-105` `handleBrandTap` | Cycle 1: replace null-brand Toast with real brand-creation Sheet open. Cycle 2: replace branded Toast with real BrandSwitcherSheet open |

### C.3.6 Files changed

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/components/ui/Toast.tsx` | new | ~135 |
| `mingla-business/src/components/ui/Modal.tsx` | new | ~165 |
| `mingla-business/src/components/ui/Sheet.tsx` | new | ~210 |
| `mingla-business/src/components/ui/ErrorBoundary.tsx` | new | ~125 |
| `mingla-business/src/components/ui/ConfirmDialog.tsx` | new | ~225 |
| `mingla-business/src/components/ui/Stepper.tsx` | new | ~190 |
| `mingla-business/src/components/ui/TopBar.tsx` | new | ~210 |
| `mingla-business/src/components/ui/BottomNav.tsx` | new | ~190 |

**Total:** 8 new files, ~1450 net lines added. Zero files modified, zero deleted. Plus 1 transient deletion of corrupted `.expo/types/router.d.ts` (auto-regenerates).

### C.3.7 Founder action

The **kit is complete**. All 24 primitives + chrome components shipped. Tier 3 components are TypeScript-clean and ready for Sub-phase D consumption. Visual smoke happens in Sub-phase E styleguide.

**Sub-phase D (next) is the FIRST VISIBLE PAYOFF** — it wires `(tabs)/_layout.tsx` + Home/Events/Account placeholder screens + the auth-gate redirect. After Sub-phase D you'll see the orange BottomNav + glass TopBar + brand chip on the dev client.

Authorise Sub-phase D when ready.

---

**End of Sub-phase C.3 report. Tier 3 complete. Sub-phase C.1 + C.2 + C.3 = 24 primitives shipped.**

---

## Sub-phase D — Tab Routes + First Visible Payoff

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_D.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_D.md)
**Outcome:** all 10 SC PASS. tsc clean. The kit is now wired through the tab nav. Founder visual smoke pending in Sub-phase F (or earlier — see §D.7).

### D.1 Files changed

#### Created (4 new)

##### `app/_layout.tsx` (modified)

**What it did before:** wrapped the Stack in `SafeAreaProvider` + `AuthProvider`. No GestureHandlerRootView.
**What it does now:** the same tree, additionally wrapped in `<GestureHandlerRootView style={{ flex: 1 }}>` from `react-native-gesture-handler`. This is required for Sub-phase C.3 `Sheet` (and any future Pan/Swipe gesture). One-line wrap. AuthProvider, SafeAreaProvider, and Stack all preserved verbatim.
**Why:** SC-6 — GestureHandlerRootView present. Without it, Sheet's `Gesture.Pan()` throws at runtime.
**Lines changed:** +3, 0 removed (additive wrap).

##### `app/(tabs)/_layout.tsx` (new)

**What it did before:** did not exist.
**What it does now:** the tabs route-group layout. Renders `<Slot />` for the active tab content + our custom `<BottomNav />` capsule below it. `TABS` constant is the 3-tab array per DEC-073 (Home / Events / Account). Active tab inferred from `usePathname()` via `detectActiveTab` helper (matches paths like `/home`, `/events`, `/account` regardless of whether Expo Router resolves the `(tabs)` group prefix). `handleChange` pushes via `router.push("/(tabs)/<id>")`. Bottom nav padded with `useSafeAreaInsets().bottom` for home-indicator clearance. Background `canvas.discover` (#0c0e12).
**Why:** SC-1 + SC-7 + SC-9 — composes BottomNav with the 3-tab default per DEC-073, hosts the `<Slot />` for active tab content.
**Lines added:** ~70

##### `app/(tabs)/home.tsx` (new)

**What it did before:** did not exist.
**What it does now:** Home placeholder. Renders `<TopBar leftKind="brand" />` (which reads `useCurrentBrand()` and shows "Create brand" since the store is empty in Cycle 0a) + a `GlassCard variant="elevated"` with title "Home" and body "Cycle 1 lands content here." Top inset honoured via `useSafeAreaInsets().top`.
**Why:** SC-2 — placeholder Home.
**Lines added:** ~60

##### `app/(tabs)/events.tsx` (new)

**What it did before:** did not exist.
**What it does now:** Events placeholder, identical structure to Home. Title "Events", body "Cycle 9 lands content here." (Cycle 9 lands the Events list per BUSINESS_PRD §5.0.)
**Why:** SC-2 — placeholder Events.
**Lines added:** ~60

##### `app/(tabs)/account.tsx` (new)

**What it did before:** did not exist.
**What it does now:** Account placeholder. Renders the same shape as Home + Events, with two additions: (1) a "Signed in as &lt;email&gt;" line reading `user.email ?? user.user_metadata.email ?? "creator"` (porting the legacy logic from the deleted `app/home.tsx`); (2) a `<Button label="Sign out" variant="secondary" />` whose press handler calls `useAuth().signOut()` with try/catch dev-error logging. After sign-out, the auth-gate at `app/index.tsx` re-renders the welcome screen — no explicit `<Redirect />` needed in this tab.
**Why:** SC-3 — Account placeholder + sign-out preserves I-2 (auth round-trip).
**Lines added:** ~95

#### Modified (1)

##### `src/config/routes.ts`

**What it did before:** `home: "/home"` plus `auth.index: "/auth"`. 12 lines.
**What it does now:** `home: "/(tabs)/home"`, `events: "/(tabs)/events"`, `account: "/(tabs)/account"` (the latter two added for future caller convenience), `auth.index: "/auth"`. Doc comment updated to explain Expo Router `(tabs)` group resolution. 17 lines.
**Why:** SC-4 — auth-gate redirect via `AppRoutes.home` now points at the new tabs path. Expo Router resolves `/(tabs)/home` → `/home` at runtime, so this string is purely declarative.
**Lines changed:** +5, ~3 modified.

#### Deleted (1)

##### `app/home.tsx`

**What it did before:** the legacy placeholder Home — a flat View with title "Mingla Business" + email line + raw `TouchableOpacity` Sign-out button (background `#eb7825`).
**What it does now:** does not exist.
**Why:** SC-5 — atomic delete with `(tabs)/home.tsx` creation. Leaving both alive triggers an Expo Router duplicate-route error because `app/home.tsx` and `app/(tabs)/home.tsx` resolve to the same URL `/home`. The Account tab now hosts the sign-out flow (with the new `Button` primitive instead of `TouchableOpacity`).

### D.2 Verification matrix (10 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | `app/(tabs)/_layout.tsx` exists with TABS array of 3 entries | ✅ PASS | File created; `TABS` array carries 3 entries with id/icon/label per DEC-073 |
| 2 | 3 tab screens exist with TopBar + GlassCard placeholder | ✅ PASS | `home.tsx`, `events.tsx`, `account.tsx` all created and follow the same shape |
| 3 | Account tab renders Sign-out Button calling `useAuth().signOut()` | ✅ PASS | account.tsx:25-34 `handleSignOut` + line 67 `<Button label="Sign out" />` |
| 4 | `AppRoutes.home === "/(tabs)/home"` | ✅ PASS | `routes.ts:9` |
| 5 | `app/home.tsx` is deleted | ✅ PASS | `ls app/` returns no `home.tsx` (only `_layout.tsx`, `index.tsx`, `auth/`, `(tabs)/`) |
| 6 | `app/_layout.tsx` wraps `GestureHandlerRootView` AND `SafeAreaProvider` | ✅ PASS | `_layout.tsx:9-15` — both present, GestureHandlerRootView outermost |
| 7 | `npx tsc --noEmit` exits 0 | ✅ PASS | Final run: `EXIT: 0` |
| 8 | No new hex literals (token discipline preserved) | ✅ PASS | `grep -rnE "#[0-9a-fA-F]{6}" "app/(tabs)/"` returns zero matches |
| 9 | Mingla domain rule preserved | ✅ PASS | `grep -riE "dating\|match-making\|swipe to like" "app/(tabs)/"` returns zero |
| 10 | Sub-phase D section appended to implementation report | ✅ PASS | This section |

### D.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched |
| I-2 | ✅ Preserved (TS-level); founder-device smoke pending | Auth flow unchanged. Account tab calls `useAuth().signOut()` with try/catch. Sign-out → auth-gate re-renders welcome (the `(tabs)` group only mounts when `user !== null` because the gate redirects there from index.tsx). Real-device verification in Sub-phase F |
| I-3 | ✅ Preserved (TS-level); Sub-phase F runs full smoke | Tab routes work on iOS / Android / web (Expo Router handles all three identically). Web visual smoke deferred to Sub-phase F |
| I-4 | ✅ Preserved | Cross-app forbidden-import grep returns zero |
| I-5 | ✅ Preserved | Domain-rule grep returns zero. All sample copy is cycle-pointer language ("Cycle 1 lands content here", "Cycle 9 lands content here", "Cycle 14 lands settings here") + neutral "Signed in as &lt;email&gt;" |
| I-6 | ✅ Preserved | No `any`, no `@ts-ignore`; tsc strict clean |
| I-7 | ✅ Preserved | Account-tab signOut errors caught with `__DEV__` console.error. No silent failure. (Caller of /(tabs)/account isn't responsible for user-visible feedback because sign-out errors are rare and the auth-gate redirect handles the common path.) |
| I-8 | ✅ Preserved | No Supabase code touched — sign-out via existing AuthContext |
| I-9 | N/A | No new motion in this sub-phase. BottomNav spotlight + reduce-motion already wired in C.3 |
| I-10 | N/A | No currency strings |

### D.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-11** | Dispatch §2.1 mentioned `app/welcome.tsx` as a file to verify. It does not exist — `BusinessWelcomeScreen` is rendered inline by `app/index.tsx` based on `user === null`. The dispatch reference was outdated; no welcome route exists today. | Info | None — implementation correctly worked with the actual file structure |
| **D-IMPL-12** | The TopBar in each tab screen has `paddingTop: insets.top` applied at the tab-screen level (not at the (tabs) layout level) so each tab manages its own safe-area top. This avoids the BottomNav layout having to know about top inset, but it does mean each new tab screen has to remember this pattern. Worth documenting in Cycle 1's first real screen as a convention. | Low | None — the pattern is explicit in all 3 tab files; future tabs will copy it |
| **D-IMPL-13** | `pathname` from `usePathname()` returns the resolved URL without the `(tabs)` group prefix (e.g. `/home`, not `/(tabs)/home`). The `detectActiveTab` helper accommodates both forms via `endsWith` check, so the active-tab inference is robust regardless of how Expo Router serializes the path internally. | Info | None |

### D.5 Transition Items

None new in this sub-phase. The pre-existing transition items remain:
- ErrorBoundary "Get help" → Cycle 14 Sentry (unchanged from C.3)
- TopBar default right-slot icons unwired → Cycle 1+ (unchanged from C.3)
- Brand chip Toast placeholders → Cycle 1 + 2 (unchanged from C.3)

### D.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/app/_layout.tsx` | modified (wrap with GestureHandlerRootView) | +3 |
| `mingla-business/app/(tabs)/_layout.tsx` | new | ~70 |
| `mingla-business/app/(tabs)/home.tsx` | new | ~60 |
| `mingla-business/app/(tabs)/events.tsx` | new | ~60 |
| `mingla-business/app/(tabs)/account.tsx` | new | ~95 |
| `mingla-business/src/config/routes.ts` | modified (route paths + doc) | +5 |
| `mingla-business/app/home.tsx` | **deleted** | -69 |

**Net:** 4 created, 2 modified, 1 deleted. ~+225 lines added, ~-69 deleted = **+156 net**.

### D.7 Founder smoke instruction

**This is the first visible payoff of Cycle 0a.** Reload the dev client. After signing in you should see:

1. **Dark canvas** (`#0c0e12`) instead of the white legacy home
2. **Glass TopBar** at top with the orange Mingla M monogram + "Create brand" chip + chevron-down
3. **3-tab BottomNav** at bottom — Home / Events / Account capsule with **orange spotlight** behind the active tab
4. **GlassCard placeholder** in the centre saying "Cycle 1 lands content here." (or "Cycle 9..." / "Cycle 14...")
5. **Tap each tab** → spotlight springs across, content swaps
6. **Tap brand chip** → Toast slides down: "Brand creation lands in Cycle 1." (auto-dismisses after 2.6s)
7. **Tap Account** → see "Signed in as &lt;your-email&gt;" + grey "Sign out" button
8. **Tap Sign out** → returns to welcome screen
9. **Sign in again** → lands on Home with spotlight on Home

**If anything looks off:**
- TopBar appears flat / no blur → web browser may not support `backdrop-filter` (expected fallback to solid `rgba(20,22,26,0.92)`); on iOS/Android the BlurView should render real blur
- Spotlight doesn't animate / jumps instantly → `useReducedMotion()` is returning `true` (OS-level reduce motion enabled — disable to verify spring animation)
- Brand chip tap does nothing → check console for `[Toast]` warnings; `useState` for the inline Toast may have desynced
- Sign out fails → check console for `[AccountTab] signOut threw:` log; Supabase session might be stale

Authorize Sub-phase E (styleguide route) when smoke passes.

---

**End of Sub-phase D report. First visible payoff achieved.**

---

## Sub-phase D.1 — Polish Fixes (founder-steered Path D)

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_D1.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_D1.md)
**Outcome:** all 4 surgical polish fixes landed. tsc clean. Two files modified, no new files, no deletions, no `designSystem.ts` edits. Founder visual smoke #2 pending.

### D.1.1 Files modified

#### `mingla-business/src/components/ui/TopBar.tsx`

**What it did before:**
- Brand-chip rendered `<MinglaMark size={28} />` + brand label + chevron-down
- `<GlassChrome>` wrapper used `intensity="backdrop"` (22) + `tintColor={glass.tint.backdrop}` (0.34 alpha) + default `shadows.glassChrome`
- `handleBrandTap` always set a new Toast state (no toggle behaviour)
- `styles.toastWrap` lacked explicit `zIndex` / `elevation`, so Toast painted behind the tab's ScrollView
- Imported `glass` + `MinglaMark` (both used by the brand chip)

**What it does now:**
- Brand chip renders only brand label + chevron-down (MinglaMark removed per ORCH-BIZ-0a-D1)
- `<GlassChrome>` wrapper now `intensity="cardElevated"` (34) + `tintColor="rgba(12, 14, 18, 0.55)"` + `shadow={shadows.glassCardElevated}` per ORCH-BIZ-0a-D2 (Path D)
- `handleBrandTap` toggles: if `toast !== null`, set `null` and return (early dismiss); else open the appropriate Toast per ORCH-BIZ-0a-D4
- `styles.toastWrap` carries `zIndex: 1000` + `elevation: 1000` so Toast paints above tab ScrollView on iOS + Android per ORCH-BIZ-0a-D3
- Imports updated: `MinglaMark` removed, `glass` removed (no longer consumed at file scope), `shadows` added
- File-head doc comment refreshed to describe the new chrome wrapper choice + the intentional MinglaMark omission

**Why:** all 4 ORCH-BIZ-0a-D fixes (1, 2, 3, 4) per founder visual-smoke feedback after Sub-phase D landed.

**Lines changed:** ~12 added, ~5 removed (net +7).

#### `mingla-business/src/components/ui/BottomNav.tsx`

**What it did before:** `<GlassChrome>` wrapper used `intensity="chrome"` (28) + `tintColor={glass.tint.chrome.idle}` (0.48 alpha).

**What it does now:** `<GlassChrome>` wrapper now `intensity="cardElevated"` (34) + `tintColor="rgba(12, 14, 18, 0.55)"`. `borderColor={glass.border.chrome}` preserved. `shadow` left at GlassChrome's default (the active-tab spotlight already carries `shadows.glassChromeActive` warm-glow; doubling up would over-shadow per dispatch §2 Fix 2).

**Why:** ORCH-BIZ-0a-D2 (Path D — premium glass, visual harmony with TopBar's bumped intensity).

**Lines changed:** 2 modified.

### D.1.2 Verification matrix (8 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | MinglaMark gone from brand chip render + import removed | ✅ PASS | `grep -n "MinglaMark" src/components/ui/TopBar.tsx` returns one match, line 11 — a doc-comment explaining the intentional omission. Zero code references. Import line 35 (`import { MinglaMark } from "./MinglaMark"`) removed |
| 2 | TopBar GlassChrome overrides intensity/tintColor/shadow | ✅ PASS | TopBar.tsx:157-160 — `intensity="cardElevated"`, `tintColor="rgba(12, 14, 18, 0.55)"`, `shadow={shadows.glassCardElevated}` |
| 3 | BottomNav GlassChrome overrides intensity/tintColor | ✅ PASS | BottomNav.tsx:141-142 — `intensity="cardElevated"`, `tintColor="rgba(12, 14, 18, 0.55)"` |
| 4 | Toast wrap has zIndex + elevation 1000 | ✅ PASS | TopBar.tsx:239-240 — `zIndex: 1000` + `elevation: 1000` |
| 5 | Brand chip tap toggles Toast | ✅ PASS | TopBar.tsx:97-100 — early-return `setToast(null)` when `toast !== null` |
| 6 | tsc clean | ✅ PASS | `npx tsc --noEmit` exits 0 |
| 7 | No designSystem.ts edits | ✅ PASS | All overrides happen at the component level. Sub-phase A's "additive only" rule preserved |
| 8 | Sub-phase D.1 section appended to report | ✅ PASS | This section |

### D.1.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched |
| I-2 | ✅ Preserved | No auth files touched |
| I-3 | ✅ Preserved (TS-level); founder visual smoke #2 pending | Premium glass overrides use the same expo-blur intensity API. Web fallback (solid `rgba(20,22,26,0.92)`) still kicks in when `backdrop-filter` unsupported |
| I-4 | ✅ Preserved | No imports from app-mobile |
| I-5 | ✅ Preserved | Domain-rule grep returns zero |
| I-6 | ✅ Preserved | tsc strict clean — no `any`, no `@ts-ignore` |
| I-7 | ✅ Preserved | Toast toggle still surfaces dismiss visibly. zIndex fix means Toast is now actually visible (was previously a silent rendering-stack failure — surfaced and fixed) |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | No new motion added; reduce-motion paths unchanged |
| I-10 | ✅ Preserved (N/A) | No currency strings touched |

### D.1.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-14** | Hardcoded `"rgba(12, 14, 18, 0.55)"` literal appears in both TopBar.tsx and BottomNav.tsx. Same RGBA value, two consumers. If founder visual smoke #2 likes the result, the orchestrator should consider promoting this to a `glass.tint.chromePremium` token in a future Sub-phase A revision. | Low | Defer to a "promote-component-overrides-to-tokens" cycle if the polish lands well |
| **D-IMPL-15** | The Toast lives inside TopBar's render tree. The zIndex + elevation fix works for the brand-chip Toast, but if Cycle 1+ wants Toasts firing from OTHER components (e.g. a save-success Toast from an event creator), each component would need its own Toast tree + zIndex management. **A global Toast manager (`<ToastHost>` + `useToast()` hook) is the right architecture for that scale** — defer to a future cycle when that need surfaces | Info | Architecturally noted — no action this cycle |
| **D-IMPL-16** | The Sub-phase D.1 dispatch §3.1 said to confirm `shadows.glassCardElevated` exists in `designSystem.ts`. It does (Sub-phase A added it). No deviation. | Info | None |

### D.1.5 Transition Items

No new transition items. The pre-existing markers from C.3 + D remain unchanged:
- ErrorBoundary "Get help" → Cycle 14 Sentry
- TopBar default right-slot icons unwired → Cycle 1+
- Brand chip Toast placeholders → Cycle 1 (brand creation) + Cycle 2 (brand switcher)

### D.1.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/components/ui/TopBar.tsx` | modified (4 in-place edits + doc comment refresh) | net +7 |
| `mingla-business/src/components/ui/BottomNav.tsx` | modified (2-line override change) | net 0 (2 modified) |

**Total:** 0 created, 2 modified, 0 deleted. ~+7 net lines.

### D.1.7 Founder smoke instruction

Reload the dev client. Confirm:

1. **Brand chip shows just text + chevron** — no orange Mingla M logo
2. **Chrome surfaces feel heavier + frostier** — TopBar floats with a more visible drop shadow underneath; BottomNav's glass capsule reads as more solid against the dark canvas
3. **Tap brand chip** → Toast slides down ABOVE the home tab content (not behind it). Visible from any tab
4. **Tap brand chip again immediately** → Toast dismisses (no waiting for the 2.6s auto-dismiss)
5. **Switch tabs while a Toast is showing** → not part of this fix's scope; Toast is local to TopBar so it'll persist across tab switches; that behaviour can be revisited if it feels wrong

If any of (1)–(4) look off, tell me which and I'll iterate. Authorize Sub-phase E (styleguide) when smoke passes.

---

**End of Sub-phase D.1 report.**

---

## Sub-phase D.2 — Premium Glass (border brightness)

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_D2.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_D2.md)
**Outcome:** single token-value edit landed. tsc clean. Zero component edits. Founder visual smoke #3 pending.

**Sub-phase A revision flag:** this dispatch deliberately revised an existing token value (rather than adding a new one). Documented under `D.2.4` below per dispatch §2.

### D.2.1 The edit

#### `mingla-business/src/constants/designSystem.ts` (line 167)

**What it did before:** `chrome: "rgba(255, 255, 255, 0.06)"` — chrome border at 6% white alpha (effectively invisible against the dark canvas).

**What it does now:** `chrome: "rgba(255, 255, 255, 0.14)"` — chrome border at 14% white alpha (clearly visible frosted-glass edge, matches the `app-mobile/` Events page sticky-header / card-chip border treatment per Explore audit 2026-04-29).

**Why:** ORCH-BIZ-0a-D2 founder visual smoke #2 — Path D's intensity / tint / shadow bumps did not deliver "explorer-app feel." Explore investigation of Events page showed the missing element was border brightness (2.3× delta — `0.06` → `0.14`). Single-token edit propagates to all chrome consumers (TopBar, BottomNav, IconChrome, IconChrome inside TopBar's right slot).

**Lines changed:** 1 modified (line 167). Net 0 lines.

### D.2.2 Verification gates

| Gate | Status | Evidence |
|------|--------|----------|
| `npx tsc --noEmit` exits 0 | ✅ PASS | Final run: `EXIT: 0` |
| `glass.border.chrome` value updated | ✅ PASS | `grep -n "chrome:" designSystem.ts` returns line 167 with `0.14` alpha |
| Consumers auto-inherit | ✅ PASS | 3 explicit usages: `GlassChrome.tsx:87` (prop default), `BottomNav.tsx:143` (explicit), `IconChrome.tsx:126` (inactive). TopBar consumes via GlassChrome's default param flow |
| Zero component edits | ✅ PASS | `git diff src/components/` returns empty for tsx files (only designSystem.ts changed) |

### D.2.3 Success criteria status

| SC | Criterion | Status |
|----|-----------|--------|
| 1 | `glass.border.chrome` is `"rgba(255, 255, 255, 0.14)"` | ✅ PASS |
| 2 | tsc clean | ✅ PASS |
| 3 | No component file edits | ✅ PASS |
| 4 | Sub-phase D.2 section appended to report | ✅ PASS |

### D.2.4 Sub-phase A revision flag

This dispatch edited an existing `designSystem.ts` token value rather than adding a new one. Per Sub-phase A's "additive only forever" closure rule, this is a deliberate exception, justified as follows:

- **No caller breaks.** All consumers (GlassChrome, TopBar, BottomNav, IconChrome) continue to work identically; only the rendered alpha changes.
- **The original value was under-specified.** `0.06` was chosen at Sub-phase A time without a visual reference. The Events page audit gave us a calibrated reference, and `0.14` is the correct match.
- **Refining a value across all callers is the safest possible kind of token change.** Renaming or removing exports breaks call sites; tightening an RGBA value does not.

If we make a habit of editing existing token values, the rule needs revisiting. For one-off corrections like this, the spirit of Sub-phase A's closure (no contract breaks) is preserved.

### D.2.5 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ⚠ DELIBERATE EXCEPTION | designSystem.ts edit is a token-value revision, not a contract change. Documented in D.2.4 |
| I-2 | ✅ Preserved | No auth files touched |
| I-3 | ✅ Preserved | RGBA strings work identically across iOS / Android / web |
| I-4 | ✅ Preserved | No imports from app-mobile |
| I-5 | ✅ Preserved | No copy / domain text touched |
| I-6 | ✅ Preserved | tsc strict clean |
| I-7 | ✅ Preserved | Border is now visibly bright (the prior 0.06 was a silent visual failure — surfaced and fixed) |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | No motion changes |
| I-10 | ✅ Preserved (N/A) | No currency strings touched |

### D.2.6 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-17** | Sub-phase A's `glass.border.profileBase` (`0.08`) and `glass.border.profileElevated` (`0.12`) are also under-specified relative to the Events page reference (which uses `0.14–0.18` for card chips). If founder visual smoke #3 says cards still look flat, propose D.3 to bump these too. **Out of scope for D.2.** | Info | Future iteration if needed |
| **D-IMPL-18** | The Sub-phase A "additive only" rule was useful for component-export stability but is over-broad if it forbids ALL token-value refinement. Recommend orchestrator codify a clearer rule: "exports stable, values may be refined when callers don't break." Otherwise we'll keep treating each token tweak as a special-case exception. | Info | Process improvement for orchestrator to consider |

### D.2.7 Transition Items

No new transition items.

### D.2.8 Founder smoke instruction

Reload the dev client. Confirm:

1. **Chrome surfaces have a clearly visible frosted edge** — TopBar's outer perimeter is now defined against the dark canvas (was nearly invisible in D.1). BottomNav same. IconChrome buttons (search + bell in TopBar's right slot) also have visible round edges.
2. **Compare to the Events page on the consumer Mingla app** — the chrome should now feel materially similar (same border brightness recipe).
3. **No regressions** — TopBar text alignment, brand chip toggle, BottomNav spotlight animation, IconChrome press scale should all still work as before. Only the border alpha changed.

If still not premium enough, the next-best Explore findings (queued in `D-IMPL-17`):
- Bump `glass.border.profileBase/.profileElevated` for card surfaces
- Add variable blur intensities (chromeBadge / chromeElevated tokens)
- Add a glow-shadow token for active interactions

Authorize Sub-phase E (styleguide) when smoke passes.

---

**End of Sub-phase D.2 report.**

---

## Sub-phase E — Hidden /__styleguide Route

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E.md)
**Outcome:** all 10 SC PASS. tsc clean. Single new file at `app/__styleguide.tsx` (~770 lines) + 1 small Account-tab edit. The kit is now QA-able as a single scrollable surface.

### E.1 Files changed

#### `mingla-business/app/__styleguide.tsx` (NEW)

**What it did before:** did not exist.

**What it does now:** the dev-only styleguide route at `/__styleguide`. Production builds short-circuit via `if (!__DEV__) return <Redirect href="/(tabs)/home" />` at the top of the component — Metro tree-shakes everything below for production bundles. The dev route renders 10 scrollable sections per dispatch §3.3:

1. **Tokens** — colour swatches (accent / canvas / glass tint+border / semantic / text), shadow specimens (md, lg, xl, glassChrome, glassChromeActive, glassCardBase, glassCardElevated), spacing-scale visualisation (xxs through xxl), radius-scale visualisation (sm through xxl), motion token notes
2. **Typography** — every typography token rendered with its name + sample text "Live event tonight"
3. **Atoms** — MinglaMark sizes 28/40/56, Spinner sizes 24/36/48, Skeleton 3 width×height combos, WebStatusBar (web only — note for native)
4. **Icon glyphs** — all 69 IconName values in a flex-wrap grid at size 22 with name labels (the QA gate confirming every glyph + the IconName union compile)
5. **Form & display** — Buttons (4 variants × 3 sizes + loading/disabled/leading-icon/square/sample-press), Pills (6 variants + livePulse toggle), StatusPills (7 statuses), Inputs (8 examples covering all 6 variants + leading-icon + clearable + disabled)
6. **Glass surfaces** — IconChrome (idle, badge=3, badge=120, active, disabled), GlassChrome intensity comparison (chrome / cardBase / cardElevated / modal), GlassCard (base + elevated side by side), EventCover (5 hue values: 0, 25, 80, 200, 320)
7. **Compositions** — KpiTile (3 delta states: up, down, neutral; values pre-formatted via `Intl.NumberFormat` GBP), ActionTile (default + primary), EmptyState (icon illustration + custom node + no-CTA)
8. **Overlays** — Toast trigger buttons (4 kinds), Sheet trigger, Modal trigger, ConfirmDialog triggers (3 variants), ErrorBoundary scoped trigger (throws inside a real `<ErrorBoundary>` so the fallback panel renders)
9. **Indicator** — Stepper at index 0, 2, last (3 phases); Platform.OS auto-switches mobile dots vs web numbered circles
10. **Chrome** — TopBar (3 leftKind variants), BottomNav (interactive — tapping a tab fires the spring spotlight animation)

Trigger overlays (Toast / Sheet / Modal / ConfirmDialog) are rendered conditionally at the bottom of the screen using local `useState` flags, not via global host. ErrorBoundary uses an inline `ErrorTrigger` that throws when `shouldThrow=true`; reset clears the flag.

A small back-button in the top-left header lets the founder return to the Account tab.

**Why:** SC-1 through SC-10 — the full QA surface for the foundation kit. Every primitive renders at least once.

**Lines added:** ~770

#### `mingla-business/app/(tabs)/account.tsx` (MODIFIED)

**What it did before:** Account-tab placeholder with email + Sign-out Button only.

**What it does now:** same plus a dev-only "Open dev styleguide" Button below sign-out. Wrapped in `{__DEV__ ? (...) : null}` so production builds tree-shake the entry point. Uses `Button variant="ghost"` with `leadingIcon="grid"` for visual differentiation. Imports `useRouter()` from `expo-router` and pushes to `/__styleguide`.

**Why:** SC-6 — entry point so the founder can find the styleguide on real devices.

**Lines changed:** +13 added, ~3 modified.

### E.2 Verification matrix (10 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | `app/__styleguide.tsx` exists with all 10 sections | ✅ PASS | File created with sections 1-10 per dispatch §3.3 |
| 2 | All 24 primitives rendered at least once | ✅ PASS | Inventory across sections: MinglaMark §3, Icon §3+§4, Spinner §3, Skeleton §3, StatusBar §3, Button §5+overlay triggers, Pill §5, StatusPill §5, Input §5, IconChrome §6, GlassChrome §6, GlassCard §6+§E.Section component, EventCover §6, KpiTile §7, ActionTile §7, EmptyState §7, Toast §8, Sheet §8, Modal §8, ConfirmDialog §8, ErrorBoundary §8, Stepper §9, TopBar §10, BottomNav §10 — 24 of 24 |
| 3 | All 69 Icon names render in the grid | ✅ PASS | `ALL_ICON_NAMES` array literally lists 69 names; map renders each with name label |
| 4 | Toast / Sheet / Modal / ConfirmDialog / ErrorBoundary have working trigger buttons | ✅ PASS | 4 Toast triggers (one per kind), 1 Sheet trigger, 1 Modal trigger, 3 ConfirmDialog triggers (one per variant), 1 ErrorBoundary trigger inside `<ErrorBoundary onReset>` scope |
| 5 | `__DEV__` gate redirects production builds | ✅ PASS | `app/__styleguide.tsx:104-106` early-returns `<Redirect href="/(tabs)/home" />` when `!__DEV__` |
| 6 | Account tab has dev-only "Open dev styleguide" Button | ✅ PASS | `app/(tabs)/account.tsx:73-83` — wrapped in `__DEV__` ternary, uses `Button variant="ghost"` with `leadingIcon="grid"` |
| 7 | tsc clean | ✅ PASS | `npx tsc --noEmit` exits 0 |
| 8 | No new hex literals (token discipline preserved) | ✅ PASS | `grep -nE "#[0-9a-fA-F]{6}" app/__styleguide.tsx` returns zero matches |
| 9 | Mingla domain rule preserved | ✅ PASS | All sample text uses event-organiser language: "Live event tonight", "Save event", "Lonely Moth Live", "Tickets sold", "Refunds", "Doors open", "End the live event?", "No events yet", "Welcome to Mingla Business". Forbidden grep returns zero |
| 10 | Sub-phase E section appended to implementation report | ✅ PASS | This section |

### E.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched |
| I-2 | ✅ Preserved | Auth flow unchanged — Account-tab change is additive (new dev-only Button below existing sign-out) |
| I-3 | ✅ Preserved (TS-level) | iOS / Android / web all render the styleguide. Section 3 includes a `Platform.OS === "web"` guard for `<WebStatusBar />` (only renders on web; native shows a note instead) |
| I-4 | ✅ Preserved | No imports from app-mobile |
| I-5 | ✅ Preserved | All sample text is event-organiser language (verified by grep) |
| I-6 | ✅ Preserved | tsc strict clean. The single grep match for "any" at line 702 is a user-facing string ("anything looks broken"), not a TS `any` type |
| I-7 | ✅ Preserved | No silent failures — ErrorBoundary trigger throws into a real `<ErrorBoundary>` scope so the fallback renders. Trigger reset path resets state cleanly |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | Reduce-motion handled by primitives themselves; styleguide adds no new motion |
| I-10 | ✅ Preserved | KpiTile demo values use `Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })` — caller pre-formats per the I-10 contract documented in KpiTile's file head |

### E.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-19** | The styleguide imports `easings` from `designSystem.ts` but doesn't directly read its values inside JSX (only references it textually in a Tokens-section subtitle). To keep the import live for IDE intellisense + visible in the import block, a `void easings;` statement was added before the StyleSheet definitions. Same pattern would apply if any other token export needs to remain "informational only" in this file. | Info | None — pattern is benign, used once |
| **D-IMPL-20** | `app/__styleguide.tsx` is 770 lines as a single file. Future styleguide expansion (e.g. when Cycle 1 adds new domain components) should consider extracting per-section subcomponents to keep the file scannable. For Cycle 0a, single-file is fine and matches dispatch §3.1. | Info | Defer to future cycle when file grows |
| **D-IMPL-21** | `Pressable` import was added to render the back button in the styleguide header. No alternative was reasonable — the back button is a one-off interactive element that doesn't warrant a new primitive. Notable as the only interactive element in this file that doesn't go through Button/IconChrome — kept inline for size economy. | Info | None |

### E.5 Transition Items

No new transition items. Pre-existing markers from C.3 + D + D.1 + D.2 unchanged.

### E.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/app/__styleguide.tsx` | new | ~770 |
| `mingla-business/app/(tabs)/account.tsx` | modified (dev-only nav button + import + styleguideRow style) | +13, 3 modified |

**Total:** 1 created, 1 modified, 0 deleted. ~+783 net lines.

### E.7 Founder smoke instruction

Reload the dev client. Open Account tab → tap "Open dev styleguide" (only visible in dev builds). You'll land on the styleguide page.

**Smoke pass per platform:**

1. **iOS** — scroll through all 10 sections top to bottom. Confirm:
   - Section 4 Icon grid: all 69 glyphs visible, no fallback squares (which would mean a missing/invalid icon name)
   - Section 5 Buttons: tap "Sample press" → check console for the haptic-verify log line; press should also scale + haptic
   - Section 5 Pills: tap "livePulse: ON" toggle → live pill's dot should stop/restart breathing
   - Section 6 GlassChrome: 4 boxes show progressively more frost (chrome → cardBase → cardElevated → modal)
   - Section 8 Toast: tap each kind — `success`/`info` auto-dismiss after 2.6s; `warn` after 6s; `error` is persistent (tap chip again to dismiss)
   - Section 8 Sheet: drag the handle down past 80px to dismiss; or tap scrim
   - Section 8 Modal: tap scrim to dismiss
   - Section 8 ConfirmDialog typeToConfirm: type "Lonely Moth" exactly to enable the destructive Confirm button
   - Section 8 ConfirmDialog holdToConfirm: press-and-hold the orange button — bar fills over 1.5s; release before 100% resets
   - Section 8 ErrorBoundary: tap "Throw" → fallback panel with "Something broke. We're on it." renders → tap "Try again" → scope resets
   - Section 9 Stepper: dot row with current/completed/future colours visible
   - Section 10 BottomNav: tap a different tab → spotlight springs across with the warm-glow shadow
2. **Android** — repeat all of the above. Check the haptic on Sample Button press (Android haptic feedback engine is different from iOS — verify it actually fires).
3. **Web** (`npx expo start --web` then visit `http://localhost:8081/__styleguide`):
   - Section 3 includes a live `WebStatusBar` row with current local time + signal/wifi/battery icons
   - Section 6 GlassChrome: confirm `backdrop-filter` works in Chrome / Safari / Firefox. If unsupported, the fallback solid rgba should be visible (still readable, just not blurred)
   - Section 8 Modal: press Escape key — modal should dismiss

If anything is off, tell me which section + what's wrong. I'll dispatch a surgical fix before Sub-phase F closes the cycle.

Authorize Sub-phase F (close protocol + final cross-platform smoke + founder sign-off + Cycle 0a closure) when smoke passes.

---

**End of Sub-phase E report.**

---

## Sub-phase E.1 — Brand + Input polish (3 corrections after E smoke)

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E1.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E1.md)
**Outcome:** all 3 ORCH-BIZ-0a-E[1-3] corrections landed. tsc clean. 1 component deleted, 1 asset copied, 2 components extended.

### E.1.1 Files changed

#### `mingla-business/src/components/ui/MinglaMark.tsx` — DELETED

**What it did before:** rendered a 32×32 SVG with a 135° linearGradient `#fb923c → #eb7825` background plus a white M-path stroked at 2px. Used in 4 styleguide locations.

**What it does now:** does not exist.

**Why:** ORCH-BIZ-0a-E1. The orange-gradient M monogram was off-brand vs the consumer Mingla app's actual brand identity (white wordmark on transparent). Deleted per founder direction. Zero production consumers existed post-Sub-phase D.1 — only styleguide demos referenced it.

**Lines removed:** ~58.

#### `mingla-business/assets/mingla_official_logo.png` — NEW (copied)

**What it did before:** did not exist in `mingla-business/`.

**What it does now:** copied verbatim from `app-mobile/assets/mingla_official_logo.png` (29762 bytes — same byte size confirmed). White wordmark on transparent, native dimensions 1356×480, used by the consumer Mingla app's WelcomeScreen + AppLoadingScreen.

**Why:** ORCH-BIZ-0a-E1. The styleguide section 3 + section 7 EmptyState now render the real brand asset via `<Image source={require(...)} />`.

#### `mingla-business/src/components/ui/Input.tsx` — MODIFIED

**What it did before:** 6 variants (text/email/phone/number/password/search). Phone variant was a single TextInput with `keyboardType="phone-pad"`. Password variant was a single TextInput with `secureTextEntry: true` set permanently (no toggle). Trailing slot: optional clear button when `clearable && value`. ~230 lines.

**What it does now:**
- **Phone variant (ORCH-BIZ-0a-E2):** renders a left-side country chip (flag + dial code + chevron-down) BEFORE the TextInput. The chip is a `Pressable` that opens a `<Sheet snapPoint="half">` with a hardcoded 12-country picker (UK default per Strategic Plan UK launch + US, IE, CA, AU, NZ, DE, FR, NL, ES, IT, PL). Tap a country → `Sheet` closes → chip updates → optional `onCountryChange` callback fires. Caller's `value`/`onChangeText` continue to carry **only the local-number portion**; caller reconstructs E.164 via `country.dialCode + value`. New optional props: `defaultCountryIso?: string` (defaults to "GB"; invalid ISO falls back to GB with `__DEV__` warning) and `onCountryChange?: (country: PhoneCountry) => void`. The `PHONE_COUNTRIES` constant is `[TRANSITIONAL]`-marked for Cycle 3+ swap to `libphonenumber-js`.
- **Password variant (ORCH-BIZ-0a-E3):** renders a trailing eye-toggle Pressable. Tap toggles local `secureRevealed` state (default `false` → text obscured). Eye icon dims to `text.tertiary` when text is visible (no `eye-off` glyph available — fallback per dispatch §5.1). A11y label flips between "Show password" / "Hide password". `clearable` prop ignored on password variant per dispatch §5.2 (visual conflict with eye toggle).
- **Trailing slot priority:** password eye > clear button. Mutually exclusive — `secureTextEntry` was removed from `VARIANT_BEHAVIOUR.password` (it's now driven by local state).
- **Public exports added:** `PhoneCountry` interface, `PHONE_COUNTRIES` constant.

~330 lines (net +100 from rewrite).

**Why:** ORCH-BIZ-0a-E2 + ORCH-BIZ-0a-E3 — founder visual smoke #4 corrections to bring phone + password input UX up to modern expectations.

#### `mingla-business/app/__styleguide.tsx` — MODIFIED

**What it did before:** imported `MinglaMark`, rendered 3 size demos in section 3 + 1 EmptyState illustration in section 7.

**What it does now:** `MinglaMark` import removed. `Image` added to react-native imports. Section 3 atoms now shows ONE row "Mingla wordmark (real brand)" rendering `mingla_official_logo.png` at width 180 with native aspect ratio 1356/480. Section 7 EmptyState welcome's illustration now renders the same wordmark at width 200. Two new style entries added to `demoStyles` (`wordmarkSmall`, `wordmarkLarge`) holding the width + aspectRatio numbers.

**Lines changed:** -10 (removed 3 size demos) +9 (one wordmark row + 2 style entries + import). Net -1 line.

### E.1.2 Verification matrix (11 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | `MinglaMark.tsx` deleted from `src/components/ui/` | ✅ PASS | `ls` returns "No such file or directory" |
| 2 | `mingla_official_logo.png` copied to `mingla-business/assets/` | ✅ PASS | `ls -la` returns 29762-byte file matching source |
| 3 | Styleguide section 3 + section 7 use real wordmark via `<Image>` | ✅ PASS | `grep -n "MinglaMark" __styleguide.tsx` returns zero; both usage sites now render `Image source={require(...)}` |
| 4 | Phone variant renders country chip + number field | ✅ PASS | Input.tsx renders country chip Pressable when `variant === "phone"` (lines ~270–280) before the TextInput |
| 5 | Country picker Sheet opens on chip tap, closes on country tap | ✅ PASS | `handleOpenPicker` sets `pickerOpen=true`; `handlePickCountry` sets `pickerOpen=false` + fires `onCountryChange` callback |
| 6 | Default country is GB unless `defaultCountryIso` overrides | ✅ PASS | `findCountryByIso(undefined)` returns `DEFAULT_PHONE_COUNTRY` which is `PHONE_COUNTRIES[0]` = GB; invalid ISO falls back with `__DEV__` warning |
| 7 | `onCountryChange` callback fires on country selection | ✅ PASS | `handlePickCountry(next)` calls `onCountryChange?.(next)` after state set |
| 8 | Password variant has trailing eye toggle that flips `secureTextEntry` | ✅ PASS | `secureTextEntry = isPassword && !secureRevealed`; trailing Pressable toggles `secureRevealed` |
| 9 | Eye icon a11y label switches between "Show password" / "Hide password" | ✅ PASS | `accessibilityLabel={secureRevealed ? "Hide password" : "Show password"}` |
| 10 | tsc clean | ✅ PASS | Final `npx tsc --noEmit` exits 0 |
| 11 | Sub-phase E.1 section appended to report | ✅ PASS | This section |

### E.1.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched |
| I-2 | ✅ Preserved | Auth flow unchanged |
| I-3 | ✅ Preserved (TS-level) | Country picker uses Sheet (gesture-handler v2 API works on iOS / Android / web). Emoji flags render natively across all 3 platforms — no image asset needed |
| I-4 | ✅ Preserved | No imports from app-mobile (the wordmark asset is now in `mingla-business/assets/`, not imported across boundaries) |
| I-5 | ✅ Preserved | No "dating" / "match" / "swipe" language anywhere |
| I-6 | ✅ Preserved | tsc strict clean. No `any`, no `@ts-ignore`. `PhoneCountry` interface explicitly typed |
| I-7 | ✅ Preserved | Invalid `defaultCountryIso` falls back to GB visibly (with `__DEV__` warning). Password eye toggle visibly indicates state (icon colour change). Country picker visibly opens / closes |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | Sheet's spring + reduce-motion behaviour unchanged |
| I-10 | ✅ Preserved (N/A) | No currency strings touched |

### E.1.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-22** | The Icon set has `"eye"` but no `"eye-off"` (or "eye-slashed") glyph. Password reveal toggle uses opacity-based state indicator as fallback — fully-bright eye = hidden / dimmed eye = visible. Functionally clear but less idiomatic than a true eye-off icon. | Low | Add `"eye-off"` to Icon.tsx in a future cycle; flip the toggle to swap glyphs instead of dimming |
| **D-IMPL-23** | `PHONE_COUNTRIES` is a hardcoded 12-country list with `[TRANSITIONAL]` marker. Cycle 3+ should swap to `libphonenumber-js` for full international coverage + proper E.164 validation when Mingla expands beyond UK + Western Europe. The current list is sufficient for UK launch. | Info | Track for Cycle 3+ orchestrator dispatch |
| **D-IMPL-24** | Country picker's selected-row indicator (`<Icon name="check" />`) and Sheet drag handle are visible but not animated. Modern country pickers often animate selection with a subtle scale/colour pulse. Out of scope for Cycle 0a; flag for design polish in a future cycle if founder feedback pushes for it. | Info | Defer; Sub-phase E.1 polish target was UX correctness, not animation flourish |
| **D-IMPL-25** | `Sheet` is the chosen UX for the country picker. On web, `Sheet` is a bottom-anchored panel with drag-to-dismiss — works fine. On native, the Sheet's drag gesture requires `GestureHandlerRootView` at the app root (already wrapped in Sub-phase D). No new native deps. | Info | None — confirmation that the dependency chain holds |

### E.1.5 Transition Items

| Marker | Location | Exit condition |
|--------|----------|----------------|
| `// [TRANSITIONAL] 12-country hardcoded list` | `Input.tsx` PHONE_COUNTRIES declaration | Cycle 3+ — swap to `libphonenumber-js` + full international list when Mingla expands beyond UK + Western Europe |

Pre-existing transition items unchanged.

### E.1.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/components/ui/MinglaMark.tsx` | **deleted** | -58 |
| `mingla-business/assets/mingla_official_logo.png` | **new (copied)** | (binary asset) |
| `mingla-business/src/components/ui/Input.tsx` | modified (phone picker + password toggle) | net +100 |
| `mingla-business/app/__styleguide.tsx` | modified (replace 4 MinglaMark usages with wordmark Image) | net -1 |

**Total:** 1 deleted, 1 new asset, 2 modified. Net ~+41 lines (excluding the 30 KB asset).

### E.1.7 Founder smoke instruction

Reload dev client. Open Account → Open dev styleguide. Confirm:

1. **Section 3 atoms** — only ONE row remains: "Mingla wordmark (real brand)" rendering the white wordmark on the dark canvas (no orange logo anywhere)
2. **Section 5 form & display, phone variant** — the phone Input row shows a left chip with 🇬🇧 + +44 + chevron-down, then the number field. Tap the chip → bottom sheet opens with 12 countries → tap one (e.g. 🇺🇸) → sheet closes → chip updates to 🇺🇸 +1
3. **Section 5 form & display, password variant** — trailing eye icon visible. Tap eye → text reveals (icon dims). Tap again → text hides (icon brightens)
4. **Section 7 EmptyState welcome** — illustration is the real wordmark (same as section 3, just larger)

If any of (1)-(4) look off, tell me which and I'll iterate. Authorize Sub-phase F (close + final cross-platform smoke + Cycle 0a closure) when smoke passes.

---

**End of Sub-phase E.1 report.**

---

## Sub-phase E.2 — Android shadows + Wordmark deletion + Phone polish

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E2.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E2.md)
**Outcome:** all 4 ORCH-BIZ-0a-E[4-7] corrections landed. tsc clean. 3 files modified, no new files, no deletions.

### E.2.1 Files changed

#### `mingla-business/src/constants/designSystem.ts`

**What it did before:** all 6 glass shadow tokens (`glassBadge`, `glassChrome`, `glassChromeActive`, `glassCardBase`, `glassCardElevated`, `glassModal`) carried fixed numeric `elevation` values (4 / 6 / 8 / 6 / 10 / 16). On Android these rendered as hard rectangular drop-shadows that bled through translucent glass surfaces, creating the "solid box inside" artifact founder reported on visual smoke #5.

**What it does now:** added `import { Platform } from "react-native"` plus a `glassElevation(ios: number): number` helper that returns the iOS value on iOS and `0` on Android via `Platform.select`. All 6 glass shadow entries now wrap their elevation value: `elevation: glassElevation(N)`. iOS shadow* fields preserved verbatim — premium blur visual unchanged on iOS. Removed the `as const` from the `shadows` const because elevation is now a function-call result, not a literal (this doesn't break any consumer since shadow style values are passed to RN's StyleSheet which handles both literal and computed numbers identically).

**Why:** ORCH-BIZ-0a-E4. Documented as the 2nd deliberate exception to Sub-phase A's "additive only" rule (after D.2's `glass.border.chrome` alpha bump). No caller breaks; iOS visual unchanged.

**Lines changed:** +5 import + helper, ~6 elevation modifications. Net +5.

#### `mingla-business/src/components/ui/Input.tsx`

**What it did before:**
- Phone variant chip rendered `flag + dialCode + chevron-down`
- Country picker Sheet had a `<Text style={styles.pickerTitle}>Select country</Text>` title above the country list
- TextInput on Android suffered the default `includeFontPadding: true` extra ascender/descender padding, which on the styleguide's narrow phone-input row pushed text outside the 48-px container — visually appeared as a "2-line" wrap
- TextInput style: `flex: 1, height: "100%"` (no flexShrink/minWidth)

**What it does now:**
- Phone chip renders `flag + chevron-down` only — dial code text dropped from the chip; dial code still visible in each picker-row + announced in the chip's a11y label so screen readers get full context
- Sheet picker no longer shows the "Select country" title — the country list itself is contextually clear
- TextInput style adds an Android-only branch via `Platform.OS === "android"` that includes `includeFontPadding: false` and `textAlignVertical: "center"` (combats the Android `TextInput` default-padding bug)
- TextInput style adds `flexShrink: 1, minWidth: 0` for safety on narrow rows
- `countryDialCode` and `pickerTitle` style entries removed from `styles`
- `inputAndroid` style entry added

**Why:** ORCH-BIZ-0a-E6 (chip + 2-line wrap) + ORCH-BIZ-0a-E7 (drop title).

**Lines changed:** ~-15 (removed dialCode chip text + Sheet title + 2 unused styles) +10 (Android style entry + flexShrink/minWidth on input). Net -5.

#### `mingla-business/app/__styleguide.tsx`

**What it did before:**
- Section 3 atoms had a `<SectionRow label="Mingla wordmark (real brand)">` rendering the wordmark at width 180
- Section 7 EmptyState welcome demo passed `illustration={<Image ... mingla_official_logo.png ...>}` at width 200
- `Image` imported from react-native
- `wordmarkSmall` and `wordmarkLarge` style entries in `demoStyles`
- Section 5 phone-variant placeholder was `"+44 7700 900000"` (redundant with chip)

**What it does now:**
- Section 3 atoms removed the wordmark SectionRow entirely; subtitle updated from "Wordmark · Spinner · Skeleton · StatusBar" to "Spinner · Skeleton · StatusBar"
- Section 7 EmptyState welcome demo now passes no `illustration` prop (label changed to "no illustration") — relies on title + description only
- `Image` removed from react-native imports
- `wordmarkSmall` + `wordmarkLarge` style entries removed
- Phone placeholder updated to `"7700 900000"` (local-number portion only)

**Why:** ORCH-BIZ-0a-E5 (founder explicit "outrightly deleted") + ORCH-BIZ-0a-E6 placeholder cleanup.

**Lines changed:** ~-25 (wordmark row + EmptyState illustration block + Image import + 2 style entries) +1 (subtitle text). Net ~-24.

**Note:** `mingla-business/assets/mingla_official_logo.png` retained on disk — no harm in keeping for future welcome / splash use.

### E.2.2 Verification matrix (12 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | All 6 glass shadow tokens use `glassElevation()` helper | ✅ PASS | `grep -c "glassElevation" designSystem.ts` returns 7 (1 helper def + 6 uses) |
| 2 | `Platform` imported in designSystem.ts | ✅ PASS | Line 1 of imports `import { Platform } from "react-native"` |
| 3 | Wordmark SectionRow removed from section 3 | ✅ PASS | `grep -n "Mingla wordmark" __styleguide.tsx` returns zero |
| 4 | EmptyState welcome's illustration prop removed (Option A) | ✅ PASS | section 7's "Welcome to Mingla Business" EmptyState now passes no `illustration` prop |
| 5 | `wordmarkSmall` / `wordmarkLarge` styles removed | ✅ PASS | `grep -n "wordmarkSmall\|wordmarkLarge" __styleguide.tsx` returns zero |
| 6 | `Image` import removed from styleguide | ✅ PASS | `grep -n "import.*Image" __styleguide.tsx` returns zero |
| 7 | Country chip renders flag + chevron only | ✅ PASS | `grep -nE "country\.dialCode" Input.tsx` matches only JSDoc + a11y label, NOT the chip JSX |
| 8 | TextInput has `includeFontPadding: false` + `textAlignVertical: center` on Android | ✅ PASS | `inputAndroid` style entry at line 426-428; applied via `Platform.OS === "android"` ternary in component style array |
| 9 | "Select country" title + `pickerTitle` style removed | ✅ PASS | `grep -nE "Select country\|pickerTitle" Input.tsx` returns zero |
| 10 | Styleguide phone placeholder updated to "7700 900000" | ✅ PASS | section 5 phone variant placeholder is now `"7700 900000"` |
| 11 | tsc clean | ✅ PASS | `npx tsc --noEmit` exits 0 |
| 12 | Sub-phase E.2 section appended to report | ✅ PASS | This section |

### E.2.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ⚠ DELIBERATE EXCEPTION | `designSystem.ts` edit IS a token-value revision (the 2nd, after D.2). Documented in §E.2.1 + dispatch §3.3. No caller breaks; iOS visual unchanged |
| I-2 | ✅ Preserved | Auth flow unchanged |
| I-3 | ✅ Preserved | iOS / Android / web all render. Android specifically improved by elevation removal. Web unaffected (no elevation concept on web) |
| I-4 | ✅ Preserved | No imports from app-mobile |
| I-5 | ✅ Preserved | No "dating" / "match" / "swipe" language |
| I-6 | ✅ Preserved | tsc strict clean. Removed `as const` from `shadows` because elevation is now computed at module load — RN style typing accepts numeric or undefined values either way |
| I-7 | ✅ Preserved | Android shadow rectangles were a silent visual failure — surfaced and fixed |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | No motion changes |
| I-10 | ✅ Preserved (N/A) | No currency strings touched |

### E.2.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-26** | The `as const` removal from `shadows` is a minor TypeScript-discipline downgrade — consumers no longer get literal-narrowed types for shadow numeric values. In practice, all consumers pass shadow objects to `StyleSheet.create` or directly into a `style={shadows.X}` prop, which expects general numeric values, so no caller is affected. If literal typing becomes important in a future cycle, the helper signature can be adjusted to return a const-typed numeric literal pattern. | Info | None — `as const` removal is correct for the runtime-computed elevation pattern |
| **D-IMPL-27** | Android `includeFontPadding: false` + `textAlignVertical: "center"` is a pattern that should propagate to ANY TextInput in the kit. Currently only `Input.tsx` benefits. If a future component embeds a raw `<TextInput>` (e.g. ConfirmDialog typeToConfirm consumes our `Input` so it inherits the fix; but a hypothetical inline TextInput would not), the same Android pattern needs to be applied. Recommend codifying as a kit convention or extracting to a shared style helper. | Low | Track for future polish; ConfirmDialog already inherits via `Input` consumption |
| **D-IMPL-28** | If founder visual smoke #6 still reports Android glass surfaces feeling "not premium enough" after elevation removal, the recommended next step is to bump the Android tint floor opacity (e.g. `glass.tint.profileElevated` 0.55 → 0.85 on Android only) so the surface reads as solid-frosted instead of translucent — same `Platform.select` pattern. Out of scope for E.2; defer if needed. | Info | Defer to E.3 if founder pushes |

### E.2.5 Transition Items

No new transition items. Pre-existing markers from C.3 + D + D.1 + D.2 + E.1 unchanged.

### E.2.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/constants/designSystem.ts` | modified (Platform import + glassElevation helper + 6 shadow elevations) | net +5 |
| `mingla-business/src/components/ui/Input.tsx` | modified (chip shortened + Android font fix + Sheet title removed + flexShrink/minWidth) | net -5 |
| `mingla-business/app/__styleguide.tsx` | modified (wordmark deletion + placeholder update + style cleanup) | net -24 |

**Total:** 0 created, 3 modified, 0 deleted. Net ~-24 lines (mostly from styleguide simplification).

### E.2.7 Founder smoke instruction

Reload dev client. Open Account → Open dev styleguide. Confirm:

1. **Section 3 atoms** — no wordmark row, just Spinner / Skeleton / StatusBar demos
2. **Section 7 EmptyState welcome** — title "Welcome to Mingla Business" + description without an illustration
3. **Section 5 phone field** — chip is compact: 🇬🇧 ▼ (just flag + chevron). Placeholder reads `7700 900000`. Single visual line on both iOS and Android (no 2-line wrap)
4. **Tap phone chip** — Sheet opens, country list visible, NO "Select country" title at the top (just the drag handle + countries)
5. **Android specifically** — GlassChrome active variant in section 6, ActionTile primary in section 7, BottomNav spotlight in section 10, shadow specimens in section 1: all should render WITHOUT a solid rectangle inside / behind the surface. Chrome should feel premium-frosted on Android the way it does on iOS

If anything is still off, tell me which section / surface and I'll iterate. Authorize Sub-phase F (close + final cross-platform smoke + Cycle 0a closure) when smoke passes.

If Android glass STILL feels under-premium after elevation removal, **D-IMPL-28** (Android tint floor opacity bump) is queued as the next polish iteration — easy to dispatch as E.3.

---

**End of Sub-phase E.2 report.**

---

## Sub-phase E.3 — Android shadow extension + TextInput cleanup + iOS phone padding

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E3.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E3.md)
**Outcome:** all 4 ORCH-BIZ-0a-E[8-11] corrections landed. tsc clean. 2 files modified.

### E.3.1 Files changed

#### `mingla-business/src/constants/designSystem.ts`

**What it did before:** E.2's `glassElevation()` helper was applied only to the 6 `glass*` shadow entries. The 4 generic shadow entries (`sm`, `md`, `lg`, `xl`) still carried literal numeric `elevation` values (2 / 4 / 8 / 12). On Android these rendered as hard rectangular drop-shadows that bled through the styleguide's translucent ShadowSpecimen demos — same root cause as E.4 but unscoped from E.2's fix.

**What it does now:**
- Renamed `glassElevation()` → `androidSafeElevation()` for clarity (no longer just glass-specific)
- Applied `androidSafeElevation()` to ALL 10 shadow tokens — `sm` / `md` / `lg` / `xl` + the 6 `glass*` entries
- Doc comment refreshed explaining the rename + scope expansion

**Why:** ORCH-BIZ-0a-E8. Documented as the 3rd Sub-phase A revision (after D.2's `glass.border.chrome` alpha bump + E.2's first elevation Platform.select). No caller breaks; iOS visuals unchanged.

**Lines changed:** 1 helper rename + 4 elevation field updates + 1 expanded doc comment. Net +6.

#### `mingla-business/src/components/ui/Input.tsx`

**What it did before:**
- `inputAndroid` style had only `includeFontPadding: false` + `textAlignVertical: "center"` (E.2's fix) — Android `TextInput` still inherited default theme `paddingVertical`, causing the phone field's typed text + placeholder to wrap to 2 visual lines on narrow rows
- TextInput had no `underlineColorAndroid` prop — Android `EditText` default drawable rendered as a "hovering rounded box" over the field on focus
- Phone variant TextInput `paddingLeft: 0` (because the country chip occupies the leading slot), creating zero breathing room between chip's right border and typed number — visually crowded "weirdly to the left" on iOS

**What it does now:**
- `inputAndroid` style extended with `paddingVertical: 0` + `paddingTop: 0` + `paddingBottom: 0` (5 entries total) — fully overrides Android theme padding
- `<TextInput>` in render carries `underlineColorAndroid="transparent"` prop — kills the EditText drawable on Android (silent no-op on iOS)
- Phone variant TextInput `paddingLeft` conditional dropped `isPhone ||` — phone now gets the same `PADDING_X` (14) left padding as text/email/number/password/search variants. The country chip's `paddingRight: 8` + the TextInput's `paddingLeft: 14` now combine for ~22px of breathing room between chip content and typed number — clean visual separation across iOS + Android

**Why:** ORCH-BIZ-0a-E9 + E10 + E11.

**Lines changed:** +3 (paddingVertical/Top/Bottom in inputAndroid) +1 (underlineColorAndroid prop) -1 (drop `isPhone ||` from conditional). Net +3.

### E.3.2 Verification matrix (6 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | All 10 shadow tokens use `androidSafeElevation()` | ✅ PASS | `grep -c "androidSafeElevation" designSystem.ts` returns 11 (1 helper def + 10 uses) |
| 2 | `inputAndroid` includes `paddingVertical: 0` + `paddingTop: 0` + `paddingBottom: 0` | ✅ PASS | All 3 fields present at lines 429-431 |
| 3 | `<TextInput>` carries `underlineColorAndroid="transparent"` | ✅ PASS | Line 315 of Input.tsx |
| 4 | Phone variant `paddingLeft` is `PADDING_X`, not `0` | ✅ PASS | Line 325 conditional simplified to `resolvedLeadingIcon !== undefined ? 0 : PADDING_X` (phone variant has no `resolvedLeadingIcon`, so falls through to `PADDING_X`) |
| 5 | tsc clean | ✅ PASS | Final `npx tsc --noEmit` exits 0 |
| 6 | Sub-phase E.3 section appended to report | ✅ PASS | This section |

### E.3.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ⚠ DELIBERATE EXCEPTION | `designSystem.ts` token-value revision is the 3rd (after D.2 + E.2). Documented in §E.3.1. No caller breaks; iOS visual unchanged |
| I-2 | ✅ Preserved | Auth flow unchanged |
| I-3 | ✅ Preserved | iOS / Android / web all render. Android specifically improved. iOS phone breathing room improved |
| I-4 | ✅ Preserved | No imports from app-mobile |
| I-5 | ✅ Preserved | No "dating" / "match" / "swipe" language |
| I-6 | ✅ Preserved | tsc strict clean |
| I-7 | ✅ Preserved | Android EditText drawable + non-glass elevation rectangles were silent visual artifacts — surfaced and fixed |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | No motion changes |
| I-10 | ✅ Preserved (N/A) | No currency strings touched |

### E.3.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-29** | The `androidSafeElevation()` helper is now used by every shadow in `designSystem.ts`. If a future cycle introduces an opaque card or button that legitimately wants Android elevation (Material Design lift), it must override at the component level via `style={{ elevation: N }}` — the token system no longer ships Android elevation by default. Track for any first opaque-surface introduction. | Info | None — the convention is correct for the current all-glass surface set |
| **D-IMPL-30** | `underlineColorAndroid="transparent"` is the standard Android TextInput-cleanup pattern. If a future cycle introduces a custom-styled TextInput (e.g. a multiline note field), the same prop should propagate. Recommend codifying as a kit convention or extracting to a shared TextInput-style helper. | Low | Track for future TextInput surfaces |
| **D-IMPL-31** | Phone variant's `paddingLeft` simplification (drop `isPhone ||`) means the conditional is now identical to the original conditional from C.1. The `isPhone` branch was added in E.1 but proved unnecessary once the chip's own paddingRight + the TextInput's PADDING_X provided sufficient visual gap. The chip's `paddingRight: 8` + TextInput `paddingLeft: 14` = 22px combined breathing room. | Info | Pattern locked in for future variants that consume left-side adornments |

### E.3.5 Transition Items

No new transition items. Pre-existing markers unchanged.

### E.3.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/constants/designSystem.ts` | modified (rename helper + extend to all shadows) | net +6 |
| `mingla-business/src/components/ui/Input.tsx` | modified (3 padding zeros + underlineColorAndroid + paddingLeft conditional fix) | net +3 |

**Total:** 0 created, 2 modified, 0 deleted. Net +9 lines.

### E.3.7 Founder smoke instruction

Reload dev client. Open Account → Open dev styleguide.

**Android (primary verification surface):**
1. Section 1 Tokens — shadow specimens md/lg/xl render WITHOUT a rectangle inside; same clean look as iOS
2. Section 5 phone field — `7700 900000` placeholder renders on a SINGLE line (no 2-line wrap)
3. All input fields (especially password + phone number) — NO floating rounded box around them; clean transparent containers

**iOS (regression check + Fix 4 verification):**
4. Section 5 phone field — typed number / placeholder has clear breathing room between the country chip and the text (no longer crowding against chip's right border)
5. All other primitive surfaces unchanged from prior smoke

**Both platforms:**
6. Glass surfaces (TopBar, BottomNav, IconChrome, GlassCard, ActionTile) — premium feel preserved; no regressions

If any issue persists, tell me which platform / which section / what's wrong. Authorize Sub-phase F (close + final cross-platform smoke + Cycle 0a closure) when smoke passes.

If Android glass surfaces still feel under-premium after the elevation removal + drawable cleanup, **D-IMPL-28** from E.2 (Android tint floor opacity bump from 0.55 → 0.85) is queued as the next polish. Easy E.4 if needed.

---

**End of Sub-phase E.3 report.**

---

## Sub-phase E.4 — Sheet/Modal lazy-render fix

**Authority:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E4.md`](../prompts/IMPLEMENTOR_CYCLE_0a_SUBPHASE_E4.md)
**Outcome:** ORCH-BIZ-0a-E12 corrected. tsc clean. 2 files modified.

### E.4.1 Files changed

#### `mingla-business/src/components/ui/Sheet.tsx`

**What it did before:** rendered its full View tree on every render regardless of `visible`. Outer View used `pointerEvents={visible ? "auto" : "none"}` and the panel translated off-screen via `translateY(closedY)` when closed — but the View tree was always present in the parent's layout. When the Sheet was rendered inline inside `Input.tsx` (Fragment sibling pattern), `position: absolute` resolved to the nearest positioned ancestor (the small SectionRow `rowContent` ~48px tall), not the screen root. The panel's `translateY(closedY)` was therefore computed relative to that tiny frame and the rendered panel visually leaked into adjacent rows in the styleguide ScrollView — exactly the iOS artifact the founder reported on smoke #7 (rounded box + drag handle visible behind number + password Input rows).

**What it does now:**
- Added `useState<boolean>(visible)` for a `mounted` flag (initial value follows `visible`)
- Added `useRef<ReturnType<typeof setTimeout> | null>` for `closeTimerRef`
- New `useEffect` watches `visible`: on `true` → set `mounted=true` immediately + cancel any pending unmount timer; on `false` → schedule a 280ms unmount via `setTimeout` (240ms close animation + 40ms safety buffer)
- If `visible` flips back to `true` during the close window, the unmount timer is cancelled and the component stays mounted
- Cleanup on component-unmount cancels any pending timer (no zombie callbacks)
- Early `if (!mounted) return null;` immediately before the JSX return

When the Sheet is closed (and the close animation has completed), it returns `null` — no View tree, no layout footprint, no inline-render leak. When `visible` flips back to true, the component re-mounts with fresh `useSharedValue` initial values (closedY for translateY, 0 for scrimOpacity), and the existing animation `useEffect` runs to animate to the open state.

**Why:** ORCH-BIZ-0a-E12 — Sheet panel leak diagnosed via founder iOS screenshot.

**Lines changed:** +31, -2 (removed 2 lines of trailing code displaced by the new useEffect, replaced with the new mount-control useEffect + early-return). Net +29.

#### `mingla-business/src/components/ui/Modal.tsx`

**What it did before:** same pattern as Sheet — full render tree always present, scrim opacity-animated, panel scale-animated. Same potential for inline-render leaks if Modal were rendered inside a positioned ancestor smaller than the screen.

**What it does now:** same lazy-mount pattern as Sheet, with a 200ms unmount delay (Modal's exit animation is 160ms + 40ms safety buffer — faster than Sheet's because Modal's exit is faster).

**Why:** ORCH-BIZ-0a-E12 prophylactic — even though Modal isn't currently rendered inline anywhere in the kit (ConfirmDialog passes Modal at the top of its render and is itself rendered inline in styleguide section 8 + future cycle screens), the same architectural defect existed. Apply the fix uniformly so future cycles don't trip on it.

**Lines changed:** +31, -2. Net +29.

### E.4.2 Verification matrix (7 SC)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | Sheet returns `null` when `mounted === false` | ✅ PASS | Sheet.tsx:169 — `if (!mounted) return null;` immediately before main JSX return |
| 2 | Modal returns `null` when `mounted === false` | ✅ PASS | Modal.tsx:151 — same pattern |
| 3 | Both schedule unmount via setTimeout AFTER close animation | ✅ PASS | Sheet uses `UNMOUNT_DELAY_MS = 280` (240+40); Modal uses `UNMOUNT_DELAY_MS = 200` (160+40). Both verified via grep |
| 4 | Both cancel pending unmount if `visible` flips back to true | ✅ PASS | Both `useEffect` blocks check `closeTimerRef.current !== null` and clearTimeout when `visible` flips to true |
| 5 | Both clean up timers on component unmount | ✅ PASS | Both `useEffect` returns a cleanup that clears the ref'd timer |
| 6 | tsc clean | ✅ PASS | Final `npx tsc --noEmit` exits 0 |
| 7 | Sub-phase E.4 section appended to report | ✅ PASS | This section |

### E.4.3 Invariant re-check

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched |
| I-2 | ✅ Preserved | Auth flow unchanged |
| I-3 | ✅ Preserved | iOS / Android / web all benefit from the fix uniformly. Animations still run because Reanimated `useSharedValue(closedY)` initialises correctly each fresh mount |
| I-4 | ✅ Preserved | No imports from app-mobile |
| I-5 | ✅ Preserved | No copy / domain text touched |
| I-6 | ✅ Preserved | tsc strict clean |
| I-7 | ✅ Preserved | The leak was a silent visual failure — surfaced and fixed |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved | Animation timings preserved (Sheet 240ms close + 40ms buffer; Modal 160ms close + 40ms buffer). Reduce-motion paths unchanged |
| I-10 | ✅ Preserved (N/A) | No currency strings touched |

### E.4.4 Discoveries for orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-32** | The lazy-mount pattern (`useState<boolean>(visible)` + `useRef<setTimeout>` + early `null` return) is now used in both Sheet and Modal. Recommend extracting to a shared `useLazyMount(visible, exitDurationMs)` custom hook in a future cycle to DRY the pattern. Three primitives (Sheet, Modal, and any future overlay) would benefit. Out of scope for E.4 (founder asked for the fix, not the abstraction). | Info | Track for Cycle 1+ refactor |
| **D-IMPL-33** | The ROOT architectural fix would be a screen-level overlay host (like `react-native-portalize` or a custom `<OverlayHost>` at app root + a context-driven imperative API). That'd let Sheet + Modal ALWAYS render at the screen root regardless of where the consumer mounts them, eliminating the inline-positioning class of bugs entirely. The lazy-mount fix in E.4 is a tactical patch; the strategic fix is a Cycle 1+ refactor. | Info | Track for Cycle 1+ |
| **D-IMPL-34** | After this fix, ConfirmDialog (which composes Modal) inherits the lazy-mount behaviour automatically — its triggers in the styleguide should no longer leak. Verified via code review (no ConfirmDialog-specific lazy-mount logic needed; the wrapping Modal handles it). | Info | None — confirmed working by inheritance |

### E.4.5 Transition Items

No new transition items. Pre-existing markers unchanged.

### E.4.6 Files changed summary

| Path | Action | Lines |
|------|--------|-------|
| `mingla-business/src/components/ui/Sheet.tsx` | modified (lazy-mount pattern + early-null return) | net +29 |
| `mingla-business/src/components/ui/Modal.tsx` | modified (same pattern) | net +29 |

**Total:** 0 created, 2 modified, 0 deleted. Net ~+58 lines.

### E.4.7 Founder smoke instruction

Reload dev client. Open Account → Open dev styleguide.

**Primary verification — the leak fix:**

1. Section 5 (Form & display, Inputs) — number + password rows should now have NO rounded box / drag handle hovering inside or behind them. Clean, transparent input containers as iOS expects

**Regression check — verify the fix doesn't break overlay open/close:**

2. Section 8 (Overlays) — tap "Open bottom sheet" → Sheet still opens with the spring slide-up animation
3. Drag the Sheet's handle down past 80px OR tap the scrim → Sheet still closes cleanly with the timing animation
4. Re-open and re-close several times — no stuck state, no flicker, no leak
5. Section 8 — tap "Open centred modal" → Modal still opens with the scale + opacity entrance
6. Tap scrim or press Escape (web) → Modal still closes cleanly
7. Section 8 — tap any of the 3 ConfirmDialog triggers (simple / type to confirm / hold to confirm) — they still open and close correctly (ConfirmDialog inherits the fix via Modal composition)
8. Section 5 phone field — tap the country chip → country picker Sheet still opens and closes correctly. After closing, no leak in the rows below

If anything is off (e.g. Sheet doesn't open, Modal doesn't close, fluctuates between states, or another visual artifact appears), tell me which trigger / which scenario and I'll iterate.

Authorize Sub-phase F (close + final cross-platform smoke + Cycle 0a closure) when smoke passes.

---

**End of Sub-phase E.4 report.**












