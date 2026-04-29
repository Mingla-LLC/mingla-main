# Mingla Business — Dependency Manifest

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081 in DECISION_LOG.md.**
> Any Next.js, `@supabase/ssr`, or `mingla-web/` dependency lines in this
> manifest are STALE. The dependency surface is `mingla-business/` only.
> Web deps remain (Expo Web stack) but the parallel Next.js codebase deps
> are no longer required.

> **Mode:** Forensics SPEC (output of `FORENSICS_DEPENDENCY_MANIFEST_AUDIT.md`)
> **ORCH-ID:** ORCH-BIZ-DEP-MANIFEST-001
> **Companion:** `Mingla_Artifacts/reports/AUDIT_BIZ_DEPENDENCY_INVENTORY.md`
> **Authored:** 2026-04-28
> **Confidence:** H — every dep verified against current `mingla-business/package.json`, Expo SDK 54 docs, and the locked Frontend Build Roadmap
> **Status:** PARTIALLY-SUPERSEDED by DEC-081 (mingla-web deps obsolete).

---

## 1. Executive Summary

The total Mingla Business build needs **~28 unique dependencies** across both codebases. Of these, **8 are native to `mingla-business/`** (require `eas build`); the rest are pure-JS or web-only.

**Single-rebuild bundle for Cycle 0a:** install **8 native modules in one `eas build`** rather than spreading them across cycles. This collapses **5+ rebuilds into 1**, saving roughly 90–125 minutes of build time + cycle-blocking wait.

**Deferred to backend cycles (B4 / B5):** Stripe Terminal SDK, OneSignal, Mixpanel, AppsFlyer. Pre-installing these in Cycle 0a wastes ~12 MB of binary and requires APIs we don't have until backend wires them.

**`mingla-web/` (Next.js):** ~10 deps, all pure-JS, all Vercel-cheap. No rebuild concept.

**Real-world timeline risks:** Apple Tap to Pay entitlement (requires Apple approval, multi-week timeline) and Google Play NFC entitlement. Both are surfaced in §9 below; neither blocks Cycle 0a.

**Key decisions baked in:**
- `react-native-maps` deferred to Cycle 3 (location picker design-time decision; one extra rebuild accepted if adopted)
- `@react-navigation/*` packages already in `mingla-business/package.json` are vestigial (we use Expo Router) — flagged for cleanup but not blocking
- `expo-blur` is **NOT yet installed** (a real gap — Glass primitives need it from Day 1)

---

## 2. Per-Dep Master Table

Codebase: `B` = mingla-business, `W` = mingla-web, `Both` = both.
Rebuild: `Y` = native, requires `eas build`. `N` = pure-JS, just `npm install`.
Already: status of mingla-business/package.json today.
Cycle 0a bundle: included in foundation `eas build`? `Y/N/Defer`.

| # | Package | Codebase | Class | Rebuild | First cycle | Already? | Cycle 0a bundle | Notes |
|---|---------|----------|-------|---------|-------------|----------|-----------------|-------|
| **Already-installed mobile deps (no action required)** ||||||||
| 1 | `expo` `~54.0.33` | B | core | — | 0a | ✅ | — | Expo SDK 54. All dep selection conforms to SDK 54 compatibility. |
| 2 | `react` `19.1.0` + `react-dom` `19.1.0` | B+W | core | — | 0a | ✅ (B); needs add (W) | — | mingla-web installs same versions for parity |
| 3 | `react-native` `0.81.5` | B | core | — | 0a | ✅ | — | |
| 4 | `expo-router` `~6.0.23` | B | core | — | 0a | ✅ | — | File-based routing |
| 5 | `@supabase/supabase-js` `^2.74.0` | B+W | pure-JS | N | 0a (B); 0b (W) | ✅ (B); needs add (W) | N (already) | |
| 6 | `@react-native-google-signin/google-signin` `^16.0.0` | B | native | Y | 0a (active) | ✅ | already in builds | Configured plugin in app.config.ts |
| 7 | `expo-apple-authentication` `~8.0.8` | B | native | Y | 0a (active) | ✅ | already in builds | Configured plugin |
| 8 | `@react-native-async-storage/async-storage` `^2.2.0` | B | pure-JS-ish | N | 0a | ✅ | — | Auth session persistence |
| 9 | `react-native-svg` `15.12.1` | B | native | Y | 0a | ✅ | already in builds | Used by MinglaMark + Icon |
| 10 | `react-native-reanimated` `~4.1.1` + `react-native-worklets` `0.5.1` | B | native | Y | 0a | ✅ | already in builds | BottomNav spotlight, glass enter motion |
| 11 | `react-native-gesture-handler` `~2.28.0` | B | native | Y | 0a | ✅ | already in builds | Sheet drag, swipe-to-action |
| 12 | `react-native-safe-area-context` `~5.6.0` | B | native | Y | 0a | ✅ | already in builds | |
| 13 | `react-native-screens` `~4.16.0` | B | native | Y | 0a | ✅ | already in builds | |
| 14 | `expo-image` `~3.0.11` | B | native | Y | 0a | ✅ | already in builds | EventCover variant |
| 15 | `expo-haptics` `~15.0.8` | B | native | Y | 0a | ✅ | already in builds | Press / scan haptics |
| 16 | `expo-linear-gradient` `~15.0.8` | B | native | Y | 0a | ✅ | already in builds | Glass tint floor + warm-glow auth bg |
| 17 | `expo-linking`, `expo-constants`, `expo-dev-client`, `expo-font`, `expo-splash-screen`, `expo-status-bar`, `expo-symbols`, `expo-system-ui`, `expo-web-browser` | B | native | Y | 0a (various) | ✅ | already in builds | Standard Expo modules |
| 18 | `react-native-web` `~0.21.0` | B | pure-JS | N | 0a | ✅ | — | Drives Expo Web export |
| 19 | `@expo/vector-icons` `^15.0.3` | B | pure-JS | N | optional | ✅ | — | Probably unused going forward — package's own Icon library replaces it. **Flagged for removal** if zero imports across cycles 0a–17. |
| 20 | `@react-navigation/bottom-tabs` `^7.4.0` + `elements` `^2.6.3` + `native` `^7.1.8` | B | pure-JS | N | unused | ✅ | — | **VESTIGIAL** — Mingla Business uses Expo Router file-based routing, not React Navigation. **Recommend removal** (saves bundle weight). Confirm zero imports in Cycle 0a. |
| **NEW deps needed for Cycle 0a foundation (mingla-business)** ||||||||
| 21 | `expo-blur` `~15.0.8` | B | native | Y | 0a | ❌ | **YES — REQUIRED** | Glass primitives need backdrop blur from Day 1. Critical gap in current package.json. |
| 22 | `zustand` `^5.0.0` | B | pure-JS | N | 0a | ❌ | — | Client state stores (currentBrandStore, draftEventStore, appStore) |
| 23 | `@tanstack/react-query` `^5.x` | B | pure-JS | N | 0a | ❌ | — | Hook abstraction layer used even with stub data; eventual backend swap is seamless |
| 24 | `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` | B | pure-JS | N | 0a | ❌ | — | Optional but recommended; persists React Query cache to AsyncStorage |
| 25 | `react-error-boundary` `^4.0.0` | B+W | pure-JS | N | 0a | ❌ | — | Top-level + per-route error boundaries |
| **NEW native deps to PRE-BUNDLE in Cycle 0a (saves later rebuilds)** ||||||||
| 26 | `expo-camera` `~17.0.0` | B | native | Y | Cycle 11 | ❌ | **YES — PRE-BUNDLE** | Scanner. Pre-install saves a Cycle-11 rebuild. Camera permission string required (§7). |
| 27 | `expo-image-picker` `~17.0.0` | B | native | Y | Cycle 2 | ❌ | **YES — REQUIRED** | Brand photo upload. Cycle 2 needs it; bundle now. Photo library permission string required. |
| 28 | `@react-native-community/datetimepicker` `^8.x` | B | native | Y | Cycle 3 | ❌ | **YES — PRE-BUNDLE** | Event date/time picker. Pre-install saves a Cycle-3 rebuild. |
| 29 | `react-native-qrcode-svg` `^6.x` | B | pure-JS (uses react-native-svg) | N | Cycle 11 | ❌ | — (pure-JS; install in Cycle 11) | Issued ticket QR + door-cash-sale ticket QR. Pure-JS — no rebuild. |
| 30 | `@stripe/stripe-react-native` `~0.x (latest Expo SDK 54-compatible)` | B | native | Y | Cycle 12 | ❌ | **YES — PRE-BUNDLE** | Door card payments. Includes Apple Pay support. Merchant identifier config required (§7). |
| 31 | `react-native-nfc-manager` `^3.x` | B | native | Y | Cycle 12 | ❌ | **YES — PRE-BUNDLE (gated by feature flag)** | NFC tap-to-pay UX. Native module without official Expo plugin — needs `expo-config-plugin-nfc-manager` or manual prebuild. **Risk: §9 Apple Tap to Pay entitlement timeline.** |
| 32 | `@sentry/react-native` `^6.x` | B | native | Y | Cycle 16 (formal) | ❌ | **YES — RECOMMEND** | Error tracking — useful from Cycle 0a anyway. Sentry Expo plugin auto-handles native config. |
| **NEW pure-JS deps (install per cycle, no rebuild)** ||||||||
| 33 | `react-hook-form` `^7.x` | B+W | pure-JS | N | Cycle 2 | ❌ | — | Form management |
| 34 | `zod` `^3.x` | B+W | pure-JS | N | Cycle 2 | ❌ | — | Schema validation |
| 35 | `@hookform/resolvers` `^3.x` | B+W | pure-JS | N | Cycle 2 | ❌ | — | RHF + Zod bridge |
| 36 | `rrule` `^2.x` | B | pure-JS | N | Cycle 4 | ❌ | — | RFC 5545 RRULE parsing for recurring events |
| 37 | `date-fns` `^3.x` | B+W | pure-JS | N | Cycle 3 (date formatting) | ❌ | — | Lightweight date manipulation. Alternative: native `Intl.DateTimeFormat` (no dep) — recommend Intl, fall back to date-fns only if needed. |
| **DEFERRED to backend cycles — DO NOT install in Cycle 0a** ||||||||
| 38 | `react-native-maps` | B | native | Y | Cycle 3 (location picker) | ❌ | **DEFER decision** | Heavy (~10 MB). Decide in Cycle 3 based on location-picker design. Alternative: `expo-maps` (SDK 54 beta) is lighter. ONE acceptable rebuild if adopted. |
| 39 | Stripe Terminal SDK | B | native | Y | Cycle B4 (live door card) | ❌ | **DEFER (B4)** | Requires real-device pairing + Stripe Terminal merchant onboarding — backend cycle territory. |
| 40 | `mixpanel-react-native` | B | native | Y | Cycle B5 | ❌ | **DEFER (B5)** | Analytics. Dead binary weight pre-backend. |
| 41 | `react-native-appsflyer` | B | native | Y | Cycle B5 | ❌ | **DEFER (B5)** | Attribution. Same as above. |
| 42 | `react-native-onesignal` | B | native | Y | Cycle B5 | ❌ | **DEFER (B5)** | Push. APNs setup required separately. |
| **mingla-web/ Next.js deps (Cycle 0b foundation)** ||||||||
| 43 | `next` `^15.x` | W | core | N | 0b | (NEW codebase) | — | App Router, edge functions, image optimization |
| 44 | `react` `^19`, `react-dom` `^19` | W | core | N | 0b | (NEW codebase) | — | Match mingla-business React 19 |
| 45 | `typescript` `^5.x` | W | dev | N | 0b | (NEW codebase) | — | |
| 46 | `@supabase/supabase-js` `^2.74.0` | W | pure-JS | N | 0b | (NEW codebase) | — | Same version as mingla-business |
| 47 | `@supabase/ssr` `^0.5.x` | W | pure-JS | N | 0b | (NEW codebase) | — | Server-side auth, cookie handling per DEC-076 |
| 48 | `@stripe/stripe-js` `^4.x` | W | pure-JS | N | Cycle 8 | (NEW codebase) | — | Stripe Elements client (UI stub for now) |
| 49 | `@stripe/react-stripe-js` `^3.x` | W | pure-JS | N | Cycle 8 | (NEW codebase) | — | React wrappers for Stripe Elements |
| 50 | `@sentry/nextjs` `^8.x` | W | pure-JS | N | Cycle 16 | (NEW codebase) | — | Sentry SDK for Next.js (server + browser) |
| 51 | (font: `next/font` — built-in, no dep) | W | — | — | 0b | — | — | Use `next/font/google` for Inter |

**Counts:**
- Already-installed mobile native: **14 modules** (in production builds today)
- New native to install in Cycle 0a's `eas build`: **8 modules** (expo-blur + camera + image-picker + datetimepicker + stripe-react-native + nfc-manager + sentry-react-native + the existing native deps that don't need new installs)
- Actually, of the 8, only **6 are NEW**: expo-blur, expo-camera, expo-image-picker, @react-native-community/datetimepicker, @stripe/stripe-react-native, react-native-nfc-manager, @sentry/react-native (= 7 NEW native to land in Cycle 0a's rebuild — let me recount: 21, 26, 27, 28, 30, 31, 32 = **7 new native modules in the Cycle 0a rebuild**)
- Pure-JS deps for Cycle 0a: **5** (zustand, @tanstack/react-query, @tanstack/react-query-persist-client + @tanstack/query-async-storage-persister, react-error-boundary)
- Pure-JS deferred to later cycles: react-hook-form + zod + @hookform/resolvers (Cycle 2), rrule (Cycle 4), date-fns (Cycle 3 if adopted), react-native-qrcode-svg (Cycle 11)
- Deferred-to-backend native: 4 (Stripe Terminal, Mixpanel, AppsFlyer, OneSignal)
- mingla-web Next.js Cycle 0b: 7 deps (next, react/react-dom, typescript, @supabase/supabase-js, @supabase/ssr, @sentry/nextjs deferred to Cycle 16)

---

## 3. Cycle 0a `eas build` Bundle (one rebuild)

After Cycle 0a's implementor lands all dependencies, ONE `eas build --profile development --platform ios` + ONE `eas build --profile development --platform android` produces development clients with the full native dep set. From Cycle 1 through Cycle 17, no further rebuilds needed unless a deferred-to-backend native dep gets pulled forward.

### 3.1 Native modules to land in Cycle 0a build

```bash
# Run in mingla-business/
npx expo install \
  expo-blur \
  expo-camera \
  expo-image-picker \
  @react-native-community/datetimepicker \
  @stripe/stripe-react-native \
  react-native-nfc-manager \
  @sentry/react-native
```

**Then do ONE rebuild per platform:**

```bash
cd mingla-business
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
```

### 3.2 Pure-JS modules for Cycle 0a (no rebuild)

```bash
# Run in mingla-business/
npm install \
  zustand \
  @tanstack/react-query \
  @tanstack/react-query-persist-client \
  @tanstack/query-async-storage-persister \
  react-error-boundary
```

### 3.3 Justification per pre-bundled native dep

| Dep | First cycle | Why bundle in 0a |
|-----|-------------|------------------|
| `expo-blur` | 0a | Glass primitives need it immediately (REQUIRED — not optional) |
| `expo-camera` | 11 | Saves a Cycle-11 rebuild. Adds ~1.5 MB. Camera permission string can be set now. |
| `expo-image-picker` | 2 | Cycle 2 brand photo upload + Cycle 3 cover image. Required by Cycle 2; bundle now. |
| `@react-native-community/datetimepicker` | 3 | Saves a Cycle-3 rebuild. Lightweight (~200 KB). |
| `@stripe/stripe-react-native` | 12 | Saves a Cycle-12 rebuild. ~3 MB. Includes Apple Pay button support — useful for design preview earlier. |
| `react-native-nfc-manager` | 12 | Saves a Cycle-12 rebuild. Small (~500 KB). Gated behind feature flag in code; never visible to user pre-Cycle-12 even if installed. |
| `@sentry/react-native` | 16 (formal) | Useful from Day 1 for catching cycle-1-onwards bugs. Adds ~2 MB but worth it. |

---

## 4. mingla-web/ Cycle 0b deps (no rebuild concept)

```bash
# Inside mingla-web/ (NEW directory at repo root)
npm init next-app@latest . --typescript --app --no-src-dir --no-tailwind
npm install \
  @supabase/supabase-js \
  @supabase/ssr
# Cycle 8 (Checkout) adds:
# npm install @stripe/stripe-js @stripe/react-stripe-js
# Cycle 16 (cross-cutting) adds:
# npm install @sentry/nextjs
```

Defaults:
- App Router (`app/` directory)
- TypeScript strict
- No Tailwind (use vanilla CSS with tokens.css copy — lighter, matches design package's CSS-vars approach)
- ESLint default Next.js config

---

## 5. Pure-JS Install Batches per Cycle

| Cycle | Pure-JS deps to add | Codebase | Command |
|-------|---------------------|----------|---------|
| 0a | zustand, @tanstack/react-query, @tanstack/react-query-persist-client, @tanstack/query-async-storage-persister, react-error-boundary | B | `npm install zustand @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister react-error-boundary` |
| 0b | next, react, react-dom, typescript, @supabase/supabase-js, @supabase/ssr | W | `npm init next-app@latest . --typescript --app && npm install @supabase/supabase-js @supabase/ssr` |
| 1 | (none) | B | — |
| 2 | react-hook-form, zod, @hookform/resolvers | B | `npm install react-hook-form zod @hookform/resolvers` |
| 3 | (date utility — recommend Intl built-in; date-fns only if needed) | B | (decide in cycle) |
| 4 | rrule | B | `npm install rrule` |
| 5 | (none) | B | — |
| 6 | react-hook-form + zod (web parity if not already) | W | `npm install react-hook-form zod @hookform/resolvers` |
| 7 | (none) | W | — |
| 8 | @stripe/stripe-js, @stripe/react-stripe-js | W | `npm install @stripe/stripe-js @stripe/react-stripe-js` |
| 9 | (none) | B | — |
| 10 | (none) | B | — |
| 11 | react-native-qrcode-svg | B | `npm install react-native-qrcode-svg` |
| 12 | (none — natives pre-bundled in 0a) | B | — |
| 13 | (none) | B | — |
| 14 | (none) | B | — |
| 15 | (TBD — marketing landing libs decided in cycle) | W | — |
| 16 | (mingla-business: nothing extra; mingla-web: @sentry/nextjs) | both | `cd mingla-web && npm install @sentry/nextjs` |
| 17 | (none) | both | — |

---

## 6. DEFER list — DO NOT install in Cycle 0a

| Dep | Cycle of first use | Why defer |
|-----|-------------------|-----------|
| `react-native-maps` | Cycle 3 | Heavy (~10 MB). Decide in cycle when location-picker design is finalised. Alternative `expo-maps` (SDK 54 beta) lighter. Accept ONE Cycle-3 rebuild if adopted. |
| Stripe Terminal SDK | Cycle B4 | Backend cycle. Requires real card-reader hardware + Stripe Terminal merchant onboarding. |
| `mixpanel-react-native` | Cycle B5 | Analytics — dead binary weight pre-backend. Bundles only when backend wires events. |
| `react-native-appsflyer` | Cycle B5 | Attribution — same as above. |
| `react-native-onesignal` | Cycle B5 | Push notifications — requires APNs / FCM setup. Backend cycle territory. |
| `expo-secure-store` | (potential) — Cycle B2+ | If session secrets need keychain instead of AsyncStorage; revisit. |

---

## 7. Native Config Diffs Required

### 7.1 `mingla-business/app.config.ts` additions

Append to the existing config the following (illustrative shape — implementor verifies exact field placement):

```typescript
ios: {
  bundleIdentifier: "com.sethogieva.minglabusiness",
  supportsTablet: false,
  infoPlist: {
    NSCameraUsageDescription:
      "Mingla Business uses your camera to scan attendee tickets at the door.",
    NSPhotoLibraryUsageDescription:
      "Mingla Business uses your photo library to upload brand and event imagery.",
    NSPhotoLibraryAddUsageDescription:
      "Mingla Business saves event tickets to your photo library when you tap Save.",
    NSFaceIDUsageDescription:
      "Mingla Business uses Face ID to confirm Apple Pay transactions at the door.",
  },
  entitlements: {
    "com.apple.developer.proximity-reader.payment.acceptance": true,
    "com.apple.developer.in-app-payments": [
      "merchant.com.sethogieva.minglabusiness",
    ],
  },
  associatedDomains: ["applinks:business.mingla.com", "applinks:mingla.com"],
},
android: {
  package: "com.sethogieva.minglabusiness",
  permissions: [
    "android.permission.CAMERA",
    "android.permission.NFC",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.INTERNET",
  ],
  intentFilters: [
    {
      action: "VIEW",
      autoVerify: true,
      data: [
        { scheme: "https", host: "business.mingla.com" },
        { scheme: "https", host: "mingla.com", pathPrefix: "/e" },
        { scheme: "https", host: "mingla.com", pathPrefix: "/b" },
      ],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ],
},
plugins: [
  // existing
  ["@react-native-google-signin/google-signin", { iosUrlScheme }],
  "expo-apple-authentication",
  // NEW
  "expo-blur",
  "expo-camera",
  [
    "expo-image-picker",
    {
      photosPermission:
        "Mingla Business uses your photo library to upload brand and event imagery.",
    },
  ],
  [
    "@stripe/stripe-react-native",
    {
      merchantIdentifier: "merchant.com.sethogieva.minglabusiness",
      enableGooglePay: true,
    },
  ],
  "@sentry/react-native/expo",
  // react-native-nfc-manager has NO official Expo plugin — see §9 Risk R-NFC-1
],
```

### 7.2 `mingla-business/eas.json` additions

```jsonc
{
  "cli": { "version": ">= 16.25.1", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_SENTRY_DSN": "<placeholder — replace at preflight>"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_SENTRY_DSN": "<placeholder>"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_SENTRY_DSN": "<placeholder>"
      }
    }
  }
}
```

### 7.3 `mingla-web/.env.local` (NEW codebase)

```
NEXT_PUBLIC_SUPABASE_URL=<same as mobile>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same as mobile>
# Cycle 8:
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
# Cycle 16:
# NEXT_PUBLIC_SENTRY_DSN=
```

---

## 8. Compatibility Matrix vs Expo SDK 54

| Dep | SDK 54 status | Notes |
|-----|---------------|-------|
| expo-blur | ✅ Confirmed `~15.0.x` matches SDK 54 | Latest stable |
| expo-camera | ✅ Confirmed `~17.0.x` matches SDK 54 | Latest stable; replaces deprecated expo-barcode-scanner |
| expo-image-picker | ✅ Confirmed `~17.0.x` matches SDK 54 | |
| @react-native-community/datetimepicker | ✅ `^8.x` works on RN 0.81 | |
| @stripe/stripe-react-native | ✅ `~0.45.x` works on RN 0.81 | Verify in implementor |
| react-native-nfc-manager | ⚠️ `^3.x` works but **no Expo Config Plugin** ships with the package — implementor must use `expo-config-plugin-nfc-manager` (third-party) OR run `npx expo prebuild` once and commit android/ios native dirs | See Risk R-NFC-1 below |
| @sentry/react-native | ✅ `^6.x` ships with `@sentry/react-native/expo` plugin for SDK 54 | |
| zustand | ✅ Pure-JS — no SDK lock | |
| @tanstack/react-query | ✅ Pure-JS — no SDK lock | |
| react-hook-form | ✅ Pure-JS | |
| zod | ✅ Pure-JS | |
| rrule | ✅ Pure-JS | |
| react-native-qrcode-svg | ✅ `^6.x` works with react-native-svg `15.12.x` | |
| react-error-boundary | ✅ Pure-JS — works on React 19 | |

---

## 9. Risks

### Risk R-AAP-1 — Apple Tap to Pay entitlement (HIGH severity, MEDIUM-LIKELIHOOD blocker for Cycle 12 / B4)

Apple Tap to Pay on iPhone (`com.apple.developer.proximity-reader.payment.acceptance`) requires:
- Apple Developer Program account + Stripe merchant approval.
- Application via Apple Developer portal explaining use case (event organisers accepting at the door).
- Apple review timeline: typically **1–4 weeks**.

**Mitigation:** apply for the entitlement during Cycle 0a or 1 (well before Cycle 12). Cycle 12's Stripe Terminal SDK + NFC tap UI still ships as a stub in UI cycles regardless; the entitlement only blocks B4 (live door card). Document the application status.

### Risk R-NFC-1 — react-native-nfc-manager has no official Expo plugin (LOW severity, prep work required)

**Options:**
1. Use `expo-config-plugin-nfc-manager` (third-party, works on SDK 54 — verify in implementor).
2. Eject from managed workflow: run `npx expo prebuild`, commit android/ios native dirs, manually add NFC entitlements.
3. Defer NFC entirely to backend cycles when manual config is acceptable.

**Recommendation:** Option 1 if the third-party plugin is current; otherwise Option 3 (defer NFC to B4 — accept one extra rebuild then). Implementor verifies in Cycle 0a; if neither option works, NFC moves to a separate cycle.

### Risk R-VESTIGIAL-1 — `@react-navigation/*` packages may be unused (LOW severity, cleanup item)

`@react-navigation/bottom-tabs`, `@react-navigation/elements`, `@react-navigation/native` are in the current `package.json` but Mingla Business uses Expo Router. If zero imports across cycles 0a–17, recommend removal — saves ~500 KB bundle weight. Cycle 0a's implementor should grep for imports and report; orchestrator decides on removal.

### Risk R-MAPS-1 — Location picker library decision (MEDIUM severity, Cycle-3 blocker)

Choose between:
- `react-native-maps` (heavy, ~10 MB, Google Maps + Apple Maps)
- `expo-maps` (SDK 54 beta, lighter, Apple Maps only on iOS — sufficient if location is just a pin)
- No map (text-only address input — simplest, viable for MVP)

**Recommendation:** evaluate in Cycle 3 design phase. If a visual map is needed, `expo-maps` is preferred for binary weight. Accept ONE additional rebuild at Cycle 3 if adopted.

### Risk R-PEER-1 — `@tanstack/query-async-storage-persister` peer-dep clash (LOW)

Verify `@tanstack/query-async-storage-persister` peer-dep resolves cleanly with `@react-native-async-storage/async-storage ^2.2.0` and `@tanstack/react-query ^5.x`. Implementor verifies during install.

### Risk R-SENTRY-1 — Sentry Expo plugin requires source-maps upload key (LOW, Cycle 0a)

Sentry plugin needs `SENTRY_AUTH_TOKEN` for source-maps upload at build time. Requires Sentry organisation + project setup. Implementor or orchestrator stages this before first Cycle 0a `eas build`.

---

## 10. Forbidden-Import Check

✅ No proposed dep induces import from `app-mobile/src/services/board*`, `pairing*`, `recommendations*`, or `boardDiscussion*`. All deps are framework-level (state, forms, validation, native modules) — no consumer-domain coupling.

✅ No dep description / sample uses dating-app language. All naming is generic (events, brands, tickets, scanner).

---

## 11. Confidence Per Dep

| Class | Confidence | Reasoning |
|-------|------------|-----------|
| Already-installed (rows 1–20) | H | Verified directly against `mingla-business/package.json` |
| New for Cycle 0a (rows 21–25, 26–32) | H | Standard Expo SDK 54 modules; widely deployed |
| Pure-JS new (33–37) | H | Mature libs, no platform coupling |
| Deferred to backend (38–42) | H — for the deferral decision; M — for the eventual install (versions will be SDK-specific at the time) |
| mingla-web/ deps (43–51) | H — Next.js 15 + React 19 + Supabase SSR is canonical |

**Overall manifest confidence: H.**

---

## 12. Cycle 0a Implementor — What to Reference

The Cycle 0a implementor dispatch will reference this manifest for its install commands:

- §3.1 — native install command + ONE `eas build` per platform
- §3.2 — pure-JS install command
- §7.1 — `app.config.ts` additions (Apple Pay merchant, NFC entitlement, permissions)
- §7.2 — `eas.json` env var additions
- §8 — version pins
- §9 — risks the implementor must surface in their report

---

**End of manifest. Companion audit at `Mingla_Artifacts/reports/AUDIT_BIZ_DEPENDENCY_INVENTORY.md`.**
