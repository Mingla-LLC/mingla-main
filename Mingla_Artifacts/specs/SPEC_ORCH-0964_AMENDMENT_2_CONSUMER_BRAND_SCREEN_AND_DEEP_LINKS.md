# SPEC AMENDMENT 2 — ORCH-0964 — consumer-app brand screen + shared package extraction + deep links

**Authored:** 2026-05-25 (third pass) by Claude `mingla-forensics`
**Supersedes:** `SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` §2 D-4, §3 Cross-Surface Impact, §4 (parts), §5–7 (parts), §8 implementation order, §10 hard guards — where this amendment is more specific.
**Companion to:** `SPEC_ORCH-0964_AMENDMENT_POST_0961_0962_0963.md` (binding alongside).

**Operator decisions locked 2026-05-25 (this turn):**
- **A-D1** Architecture: promote `PublicBrandPage` to a NEW shared workspace package `packages/brand-rendering/`. Mirrors `packages/event-rendering/` pattern.
- **A-D2** Deep links: included in ORCH-0964 scope. Universal Links (iOS) + App Links (Android) + `.well-known/` files deployed on Vercel.
- **A-D3** Phasing: one-shot ship. ~13–14 day implementation budget. Single PR, single native rebuild.

---

## 1. New scope — what gets built (additions to original SPEC)

### A. New shared workspace package — `packages/brand-rendering/`

Mirrors the structure of `packages/event-rendering/`:

```
packages/brand-rendering/
├── package.json
├── index.ts
├── types.ts                  ← PublicBrandPageProps + Brand + Trip + Event types (moved from mingla-business)
├── designTokens.ts           ← copy of mingla-business's brand-page-relevant tokens, OR re-export from event-rendering
├── PublicBrandPage.tsx       ← the kind-branched render (moved from mingla-business/src/components/brand/)
├── TripMiniCard.tsx          ← primitive moved from mingla-business
├── EventMiniCard.tsx         ← primitive moved (if it's a stand-alone file; else inlined section)
├── NextEventTeaser.tsx       ← primitive moved
└── tsconfig.json
```

**Migration rule:** the existing `mingla-business/src/components/brand/PublicBrandPage.tsx` becomes a THIN adapter that imports the shared component and passes data, EXACTLY mirroring how `mingla-business/src/components/event/PublicEventPage.tsx` adapter pattern works post-ORCH-0961.

```typescript
// mingla-business/src/components/brand/PublicBrandPage.tsx (post-refactor)
import { PublicBrandPage as SharedPublicBrandPage } from '@mingla/brand-rendering';
import { usePublicBrandBySlug } from '../../hooks/usePublicBrandBySlug';

export function PublicBrandPage({ slug }: { slug: string }) {
  const { brand, trips, events, isLoading, resolvedTheme } = usePublicBrandBySlug(slug);
  if (isLoading) return <LoadingState />;
  if (!brand) return <NotFoundState />;
  return (
    <SharedPublicBrandPage
      brand={brand}
      trips={trips}
      events={events}
      theme={resolvedTheme}
      onClose={/* router fallback chain per ORCH-0961 */}
      onShare={/* share handler */}
      hideFloatingChrome={false}  // buyer-web shows the shared close+share
    />
  );
}
```

**Imports inside the shared package MUST be self-contained:**
- NO imports from `mingla-business/src/`
- NO imports from `app-mobile/src/`
- NO `useAuth`, `useRouter`, `usePublicBrandBySlug` — those stay in adapters
- Theme types + resolver re-imported from `@mingla/event-rendering` (no circular dep — only `brand-rendering` → `event-rendering`)
- React Native primitives only (`View`, `Text`, `Pressable`, `ScrollView`, `Image` — works on RN-Web + RN-iOS + RN-Android identically)

### B. New consumer-app brand profile screen

**New route file:** `app-mobile/app/brand/[slug].tsx`

Mounts `@mingla/brand-rendering`'s `PublicBrandPage` using a new consumer-app hook `useBrandBySlug`. Pattern:

```typescript
// app-mobile/app/brand/[slug].tsx
import { useLocalSearchParams } from 'expo-router';
import { PublicBrandPage as SharedPublicBrandPage } from '@mingla/brand-rendering';
import { useBrandBySlug } from '../../src/hooks/useBrandBySlug';

export default function BrandProfileScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { brand, trips, events, isLoading, resolvedTheme } = useBrandBySlug(slug);
  // ... loading + error states
  return (
    <SharedPublicBrandPage
      brand={brand}
      trips={trips}
      events={events}
      theme={resolvedTheme}
      hideFloatingChrome={true}  // consumer-app uses its own navigation chrome
      onClose={() => router.back()}
      onShare={shareViaSystemSheet}
    />
  );
}
```

**New hook:** `app-mobile/src/hooks/useBrandBySlug.ts` — consumer-app analog of `mingla-business`'s `usePublicBrandBySlug`. Calls the same `business_public_brands_view` (and trip RPC `pg_public_trips_by_brand` for trip-brand kind) — RLS-aware, anon-readable per ORCH-0963.

**React Query key:** `['consumerBrand', slug]`, staleTime 5 minutes.

**Logout cache clear:** the React Query cache reset on logout (per Constitution rule 6) MUST invalidate `['consumerBrand', ...]` keys.

### C. Entry point from event sheet

**File:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

Add a brand-identity tap target on the existing brand attribution row (or hero brand-attribution element — implementor identifies exact element). Tapping navigates to `/brand/<slug>` via Expo Router.

**Hard guards:**
- The tap target MUST be visually distinguishable (not a hidden hit area). Use `IconChrome`-style affordance OR underline+chevron OR clear "View brand" CTA.
- The navigation MUST NOT close the event sheet — sheet should remain mounted so user can tap back and resume. Verify the consumer-app navigation graph supports this (Expo Router stack on top of bottom-sheet modal).
- If the brand slug is missing or invalid, the tap target is NOT rendered (no broken affordance).

### D. Deep links — Universal Links (iOS) + App Links (Android)

**Goal:** when a user with the consumer app installed clicks `https://usemingla.com/b/<slug>` (or the `business.usemingla.com` equivalent), the link opens the consumer app's `/brand/<slug>` screen instead of buyer-web.

**Domain decision:** confirm with operator which domain hosts the public links. Likely candidates:
- `usemingla.com` (marketing root)
- `business.usemingla.com` (where buyer-web currently lives)

**Recommendation:** wire BOTH domains as `associatedDomains` so existing buyer-web links (which point at `business.usemingla.com/b/...`) ALSO open in the app. Operator confirms at implementation.

**Files / config to add:**

1. **`app-mobile/app.json` (or `app.config.ts`)** — extend `expo.ios.associatedDomains` + `expo.android.intentFilters`:

   ```json
   {
     "expo": {
       "ios": {
         "associatedDomains": [
           "applinks:usemingla.com",
           "applinks:business.usemingla.com"
         ]
       },
       "android": {
         "intentFilters": [
           {
             "action": "VIEW",
             "autoVerify": true,
             "data": [
               { "scheme": "https", "host": "usemingla.com", "pathPrefix": "/b" },
               { "scheme": "https", "host": "business.usemingla.com", "pathPrefix": "/b" }
             ],
             "category": ["BROWSABLE", "DEFAULT"]
           }
         ]
       }
     }
   }
   ```

2. **`/.well-known/apple-app-site-association`** deployed at BOTH `usemingla.com` and `business.usemingla.com`:

   ```json
   {
     "applinks": {
       "details": [
         {
           "appIDs": ["<TEAM_ID>.com.mingla.minglaapp"],
           "components": [
             { "/": "/b/*", "comment": "Brand profile" }
           ]
         }
       ]
     }
   }
   ```

   - `<TEAM_ID>` and bundle ID confirmed from `app-mobile/app.json` `ios.bundleIdentifier` at implementation.
   - File MUST be served with `Content-Type: application/json` (Vercel header config in `vercel.json` or equivalent).
   - File MUST be served WITHOUT redirect.

3. **`/.well-known/assetlinks.json`** deployed at BOTH domains:

   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "com.mingla.minglaapp",
         "sha256_cert_fingerprints": ["<SHA256_FINGERPRINT_FROM_PLAY_CONSOLE>"]
       }
     }
   ]
   ```

   - SHA256 fingerprint sourced from Google Play Console for the production keystore.

4. **Expo Router deep-link handler** in `app-mobile/app/_layout.tsx` (or equivalent) — Expo Router auto-handles routing once `app/brand/[slug].tsx` exists AND `app.json` `scheme` matches. Verify at implementation.

**Deployment note (DEC-179 / dependency walk):** the `.well-known/` files live in the marketing site's Vercel deployment (`mingla-marketing/public/.well-known/`) OR `mingla-business`'s Vercel deployment depending on which domain serves them. Implementor identifies the canonical host repo at implementation. If both domains need the files, two PRs to two repos may be needed — surface this at implementation.

**`vercel.json` Content-Type:** ensure `.well-known/*.json` has `Content-Type: application/json`. iOS Universal Links FAIL SILENTLY if the file is served as `text/plain`.

### E. The shared brand-rendering theming wiring

The original SPEC §4.7 + Amendment 1 §6 already covered theming inside `PublicBrandPage`. ALL of that theming work now lands in `packages/brand-rendering/PublicBrandPage.tsx` instead of `mingla-business/src/components/brand/PublicBrandPage.tsx`. Theme prop interface unchanged. Foreground-color computation unchanged. Lottie mount-once-per-session unchanged.

**Both buyer-web AND consumer-app render identically** because they mount the same component with the same theme prop.

## 2. Updated Cross-Surface Impact (cumulative — supersedes Amendment 1's table addendum)

| Surface | In scope? | What user sees | File paths touched |
|---|---|---|---|
| Buyer-web public brand page | ✅ YES | Themed brand page; same render as consumer app | `packages/brand-rendering/*` (NEW), `mingla-business/src/components/brand/PublicBrandPage.tsx` (becomes adapter) |
| Buyer-web public event page | ✅ YES | Themed event page | `packages/event-rendering/PublicEventPage.tsx` (theme prop added) |
| **Consumer iOS brand profile (NEW)** | ✅ YES | New `/brand/[slug]` screen mounted from event-sheet tap or deep-link click | `app-mobile/app/brand/[slug].tsx` (NEW route), `app-mobile/src/hooks/useBrandBySlug.ts` (NEW) |
| **Consumer Android brand profile (NEW)** | ✅ YES | Same as iOS | Same files (RN cross-platform) |
| Consumer iOS event sheet | ✅ YES | Themed sheet + new brand-identity tap target | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (theme threading + nav entry) |
| Consumer Android event sheet | ✅ YES | Same as iOS | Same |
| Business iOS / Android (theme editor) | ⚠️ Partial | Edit UI for theme | `mingla-business/src/components/theme/ThemeEditorSection.tsx` (NEW), `BrandEditView.tsx` + event-edit screen mounts |
| **Deep links (Universal Links / App Links) (NEW)** | ✅ YES | URL click opens app | `app-mobile/app.json` config + `.well-known/` files on Vercel domains |
| `/checkout/*` (buyer-web) | ❌ NOT in scope | No theme leakage | enforced by `I-PROPOSED-CHECKOUT-NO-BRAND-THEME` invariant |
| Admin web | ❌ NOT in scope | — | — |
| Business-web preview live theme preview | ❌ NOT in scope | — | — |

## 3. Updated success criteria (additions)

| # | Criterion | Layer | Verifiable by |
|---|---|---|---|
| SC-16 | A user with the consumer app installed taps `https://business.usemingla.com/b/leggothis` from another app (Messages, Mail, Safari address bar long-press → "Open in App") and lands directly on `/brand/leggothis` inside the consumer app. | Deep link | Manual iOS device test (Universal Links require real device + signed app; sim doesn't fully reproduce). |
| SC-17 | Same on Android: tap an app-link URL from another app, lands on consumer app brand screen. | Deep link | Real Android device test. |
| SC-18 | When the consumer app is NOT installed, the same URL opens normally in mobile Safari/Chrome → buyer-web themed brand page. No broken behaviour. | Deep link fallback | Real device test (uninstall app, click URL, observe browser open). |
| SC-19 | Inside the consumer event sheet, tapping the brand identity affordance navigates to the consumer brand profile screen. Event sheet remains mounted (back-nav returns to it). | Consumer navigation | Maestro iOS sim flow + Android emu flow. |
| SC-20 | Consumer brand profile renders identically to buyer-web brand page given the same brand (same theme, same kind-branched IA, same `TripMiniCard` / `NextEventTeaser` content). | Cross-surface parity | Side-by-side screenshot diff on the same brand. |
| SC-21 | Logging out of the consumer app invalidates the `['consumerBrand', ...]` React Query cache. Next login fetches fresh brand data. | Cache discipline (Constitution rule 6) | Unit test + hook integration test. |
| SC-22 | `.well-known/apple-app-site-association` returns HTTP 200 with `Content-Type: application/json` on both deployed domains. Same for `assetlinks.json`. | Infra | `curl -I` test against production URLs. |
| SC-23 | The shared package `@mingla/brand-rendering` has NO imports from `mingla-business/src/` or `app-mobile/src/`. Verified by static analysis. | Architecture invariant | ESLint rule OR strict-grep gate. |

## 4. Updated invariants — NEW (DRAFT → ACTIVE on ORCH-0964 CLOSE)

- **I-PROPOSED-BRAND-RENDERING-SELF-CONTAINED** (NEW) — `packages/brand-rendering/*` files MUST NOT import from `mingla-business/src/` or `app-mobile/src/`. Mirrors the contract established for `packages/event-rendering/` by META-ORCH-0827. Enforced by strict-grep gate.
- **I-PROPOSED-DEEP-LINK-WELL-KNOWN-JSON-CONTENT-TYPE** (NEW) — `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` MUST be served with `Content-Type: application/json` on every public Mingla domain that hosts brand links. Vercel config enforces.

Existing invariants from original SPEC §6 + Amendment 1 §7 still apply. Specifically:
- **I-PUBLIC-BRAND-KIND-BRANCHED** — kind-branching now lives inside the shared package; gate must be retargeted at `packages/brand-rendering/PublicBrandPage.tsx`.
- **I-PROPOSED-BRAND-FIELD-MAP-COVERAGE** — extended-field-list registry must register the new `theme_color`, `theme_font`, `theme_animation` columns + ensure the shared package consumes them.

## 5. Updated test cases (additions)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-18 | Cross-surface parity — same brand on both | Brand: `leggothis` themed | Buyer-web `/b/leggothis` + consumer-app `/brand/leggothis` screenshots match | Render |
| T-19 | Event-sheet tap → brand screen | Open event sheet, tap brand identity | Navigates to `/brand/<slug>` with sheet mounted under | Navigation |
| T-20 | Back from brand screen → event sheet | After T-19, tap back | Returns to event sheet, sheet still mounted at original event | Navigation |
| T-21 | Trip-brand consumer view | Brand `kind='trip_planner'` viewed in consumer | Renders Trips/Past Trips tabs + `TripMiniCard`s | Render |
| T-22 | Event-brand consumer view | Brand `kind='popup'` viewed in consumer | Renders Upcoming/Past tabs + `EventMiniCard`s + `NextEventTeaser` | Render |
| T-23 | Universal Link cold | App not running, tap URL from Messages | App launches directly into `/brand/<slug>` | Deep link (real iOS device) |
| T-24 | Universal Link warm | App backgrounded, tap URL | App foregrounds into `/brand/<slug>` | Deep link (real iOS device) |
| T-25 | App Link cold | Same as T-23 on Android | Real Android device |
| T-26 | URL with no app installed | Uninstall app, tap URL | Browser opens buyer-web brand page (existing behaviour preserved) | Deep link fallback |
| T-27 | `.well-known/` MIME | `curl -I https://business.usemingla.com/.well-known/apple-app-site-association` | HTTP 200 + `Content-Type: application/json` | Infra |
| T-28 | Package isolation | grep `packages/brand-rendering/*` for `mingla-business` or `app-mobile` imports | Zero matches | Static analysis / CI |

## 6. Updated implementation order

Insert/amend:

1. **Step 0 — Rebase per-ORCH branch onto `origin/main`** (per Amendment 1 §8). Re-read all referenced files.
2. **Step 1 — DB migration** (per original SPEC §4.1 + Amendment 1 §3 view updates).
3. **Step 2 — Create `packages/brand-rendering/` workspace package.** Initial scaffold: package.json, tsconfig, index.ts, types.ts, designTokens (re-export from event-rendering), empty PublicBrandPage.tsx.
4. **Step 3 — Move `PublicBrandPage` + primitives into the new package.** Migrate the kind-branched IA from `mingla-business/src/components/brand/PublicBrandPage.tsx` verbatim into `packages/brand-rendering/PublicBrandPage.tsx`. Convert `mingla-business/src/components/brand/PublicBrandPage.tsx` into an adapter that imports and threads props. ALL ORCH-0962 mappers + ORCH-0963 kind-branching logic preserved unchanged; only locations move. Verify all existing tests still pass (`PublicBrandPage.orch_0962.test.ts`, `orch_0963_*.test.ts` files may need import-path updates).
5. **Step 4 — Wire theme prop into the shared package.** Per original SPEC §4.7 + Amendment 1 §6.
6. **Step 5 — Shared `PublicEventPage` theme wiring** (per original SPEC + Amendment 1).
7. **Step 6 — Theme animations + font deps** (per original SPEC §4.3 + §4.4).
8. **Step 7 — Buyer-web hooks** (extend mappers per Amendment 1 §4).
9. **Step 8 — Consumer-app hook + screen.** NEW `app-mobile/src/hooks/useBrandBySlug.ts`. NEW `app-mobile/app/brand/[slug].tsx` route.
10. **Step 9 — Event sheet tap target.** `ExpandedBusinessEventSheet.tsx` brand-identity affordance + navigation.
11. **Step 10 — Deep links: app config.** Update `app-mobile/app.json` `associatedDomains` + `intentFilters`.
12. **Step 11 — Deep links: `.well-known/` files.** Add to the appropriate host repo(s). Configure `vercel.json` Content-Type. Implementor identifies which repos host `usemingla.com` + `business.usemingla.com` — likely `mingla-marketing/` and `mingla-business/`. Two separate PRs may be needed if both domains require the files. Surface at implementation.
13. **Step 12 — Edit UI** (Theme Editor Section + mounts per original SPEC §4.10).
14. **Step 13 — Service-layer writes** (per original SPEC §4.11).
15. **Step 14 — CI gates: 6 strict-grep gates total** — 4 from original SPEC §6 + 2 from this amendment (I-PROPOSED-BRAND-RENDERING-SELF-CONTAINED, I-PROPOSED-DEEP-LINK-WELL-KNOWN-JSON-CONTENT-TYPE) + extend ORCH-0962 brand-field-map-coverage gate's expected list.
16. **Step 15 — Regression tests** (per original SPEC + new SC-16..SC-23).
17. **Step 16 — Native rebuilds** of both apps. Required for Lottie + fonts + new `/brand/[slug]` route registration + universal/app links config.

## 7. Updated hard guards (additions to original §10 + Amendment 1 §9)

- **DO NOT** leave any imports from `mingla-business/src/` inside `packages/brand-rendering/*` after the move. Strict-grep gate enforces.
- **DO NOT** duplicate the kind-branching logic — there is ONE `PublicBrandPage` in `packages/brand-rendering/`, two thin adapters in the two consuming apps.
- **DO NOT** ship `.well-known/` files with `Content-Type: text/plain` — iOS Universal Links FAIL SILENTLY. Verify with `curl -I` post-deploy.
- **DO NOT** ship deep-link config without verifying the SHA256 fingerprint matches the actual production Android keystore.
- **DO NOT** assume the event-sheet brand-tap navigation pattern from buyer-web — consumer-app uses Expo Router + bottom sheet host; navigation behaviour MAY differ. Verify at implementation.
- **DO NOT** break existing buyer-web `/b/<slug>` routes during the package extraction. Adapter MUST be wired BEFORE the move.
- **DO NOT** widen scope to consumer-app event detail / Discover grid / swiper deck theming (still D-4 from original SPEC — only the shared event sheet + new brand screen are themed inside consumer app).

## 8. Effort budget recap

- Original SPEC scope: ~8 days
- Amendment 1 (post-0961/0962/0963 view + render adjustments): no net add — re-routes existing work
- Amendment 2 (this — shared package + consumer screen + deep links): +5–6 days
- **Total: ~13–14 days for one-shot ship**

Implementor will likely split into ~3 sub-commits on the per-ORCH branch but ship as ONE PR per `feedback_close_commit_precommit_checks.md` "one PR per CLOSE" rule.

## 9. Open items requiring operator input at implementation time

- Which Vercel project(s) host `usemingla.com` vs `business.usemingla.com`? Need to know which repo gets the `.well-known/` files (or both).
- Production Android keystore SHA256 fingerprint — from Play Console. Implementor will ask.
- Confirm consumer-app `ios.bundleIdentifier` + Apple Team ID for the AASA file. Should be readable from existing `app-mobile/app.json`.

These do NOT block SPEC approval — they block specific implementation steps.

---

**SPEC + Amendment 1 + Amendment 2 are now the binding contract.** Ready for implementor dispatch.
