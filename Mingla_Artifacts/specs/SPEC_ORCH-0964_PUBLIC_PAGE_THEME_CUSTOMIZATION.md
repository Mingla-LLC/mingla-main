# SPEC — ORCH-0964 [Public-page customization: theme color + preset fonts + entrance animations]

**Authored:** 2026-05-25 by Claude `mingla-forensics` (SPEC mode)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`
**Branch:** `ORCH-0964-public-page-theme-customization`
**Severity:** S2-medium / `missing-feature` + `ux`

---

## 1. Goal

Ship brand-owner-controllable theming for Mingla's public brand and public event surfaces. Three knobs per brand (with optional per-event override): single hex color, font picked from a 14-font whitelist, entrance animation picked from a 10-animation whitelist. Theme renders identically on buyer-web, consumer iOS, and consumer Android via the existing shared `packages/event-rendering/PublicEventPage` component.

## 2. Locked decisions (do NOT re-litigate)

| # | Decision |
|---|---|
| D-1 | **Fonts (14):** Inter, Poppins, Space Grotesk, Plus Jakarta Sans, Manrope, Playfair Display, DM Serif Display, Fraunces, Lora, Bebas Neue, Anton, Unbounded, Caveat, Dancing Script. All OFL-licensed, Google Fonts hosted. |
| D-2 | **Animations (10):** `none`, `confetti`, `fireworks`, `balloons`, `sparkles`, `glitter_shower`, `snowfall`, `falling_petals`, `hearts`, `shimmer_reveal`. |
| D-3 | **Animation tech:** Lottie. `lottie-react-native` for mobile (consumer iOS/Android + business iOS/Android + buyer-web via react-native-web). Lottie JSON files bundled as workspace package `packages/theme-animations/`. |
| D-4 | **Consumer-app scope:** shared `packages/event-rendering/PublicEventPage` only. NO theming of `SwipeableCards`, `CuratedExperienceSwipeCard`, `BusinessEventCard`, `DiscoverScreen`, `EventDetailLayout` (nightOut). |
| D-5 | **Contrast safety:** auto-pick foreground text color via WCAG luminance algorithm. Brand-picked color is stored as-is; foreground (`#000000` or `#ffffff`) is computed at render time, NOT stored. |
| D-6 | **Storage shape:** typed columns on `brands` and `events`. No new JSONB keys. |
| D-7 | **Per-brand default + per-event override.** Resolver chain: `event.theme_*_override ?? brand.theme_* ?? mingla.default`. |
| D-8 | **Out of scope:** `/checkout/*` (proven isolated, MUST NOT mount theme provider at app root), `mingla-admin/`, business-app preview, consumer Discover grid, recommendation swiper. |

## 3. Cross-Surface Impact Inspection (MANDATORY)

| Surface | In scope? | What user sees | File paths touched | Parity |
|---|---|---|---|---|
| **Buyer-web** (`mingla-business/`) | ✅ YES | Public brand page hero themed; public event page (shared `PublicEventPage`) themed; entrance animation plays once on first paint per session. | `mingla-business/app/b/[brandSlug]/index.tsx`, `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`, `mingla-business/src/components/brand/PublicBrandPage.tsx`, `mingla-business/src/components/event/PublicEventPage.tsx` (adapter), `mingla-business/src/hooks/usePublicBrandBySlug.ts`, `mingla-business/src/hooks/usePublicEventBySlug.ts`, `mingla-business/src/components/brand/BrandEditView.tsx`, `mingla-business/src/components/event/EventEditView.tsx` (or equivalent) | **Automatic via shared package** for event page; manual for brand page (separate component). |
| **Consumer iOS** (`app-mobile/`) | ✅ YES (event detail only) | When user taps a business event card → `ExpandedBusinessEventSheet` mounts shared `PublicEventPage` with brand+event theme applied. Animation plays once per sheet-open. | `packages/event-rendering/PublicEventPage.tsx`, `packages/event-rendering/designTokens.ts`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (prop pass-through only), `app-mobile/src/hooks/useEventTheme.ts` (new — resolves event+brand theme for sheet host) | **Automatic via shared package.** |
| **Consumer Android** (`app-mobile/`) | ✅ YES (event detail only) | Same as iOS. | Same as iOS. | **Automatic via shared package + RN cross-platform.** |
| **Business iOS** (`mingla-business/`) | ⚠️ Partial — EDIT UI only | Brand owners edit their theme in `BrandEditView` and `EventEditView`. NO preview while editing — they save and view live. | `mingla-business/src/components/brand/BrandEditView.tsx`, `mingla-business/src/components/event/EventEditView.tsx`, NEW `mingla-business/src/components/theme/ThemeEditorSection.tsx`. | Manual UI; same RN code path as Android. |
| **Business Android** (`mingla-business/`) | ⚠️ Partial — EDIT UI only | Same as business iOS. | Same. | Same. |
| **Admin web** (`mingla-admin/`) | ❌ NOT in scope | No admin theming UI. | None. | N/A. |
| **Business-web preview** (`mingla-business/` dev/web) | ❌ NOT in scope | Live preview while editing is explicit non-goal at INTAKE. | None. | N/A. |

**Manual parity success criteria (separate gates per surface):**
- `SC-2-buyer-web`, `SC-2-consumer-iOS`, `SC-2-consumer-Android` — same theme renders identically on all 3 read surfaces (validated by tester at TEST phase).
- `SC-4-business-iOS`, `SC-4-business-Android` — Edit UI works on both write surfaces.

## 4. Layer-by-layer spec

### 4.1 Database

**Migration:** `supabase/migrations/<YYYYMMDDHHMMSS>_orch_0964_brand_event_theme_columns.sql`

Implementor MUST compute timestamp via `max(scan(~/Desktop/mingla-orchs/*/supabase/migrations/), now) + 1s` per `feedback_orchestrator_removes_registry_row_in_close_commit.md` and ORCH-0960 [`spawn.sh` migration timestamp collision].

```sql
-- brands: per-brand default theme
ALTER TABLE public.brands
  ADD COLUMN theme_color TEXT NULL,           -- 7-char hex e.g. '#FF6F00' or NULL
  ADD COLUMN theme_font TEXT NULL,            -- font slug from D-1 whitelist, or NULL
  ADD COLUMN theme_animation TEXT NULL;       -- animation slug from D-2 whitelist, or NULL

ALTER TABLE public.brands
  ADD CONSTRAINT brands_theme_color_hex_chk
    CHECK (theme_color IS NULL OR theme_color ~* '^#[0-9a-f]{6}$');

ALTER TABLE public.brands
  ADD CONSTRAINT brands_theme_font_whitelist_chk
    CHECK (theme_font IS NULL OR theme_font IN (
      'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
      'playfair_display','dm_serif_display','fraunces','lora',
      'bebas_neue','anton','unbounded','caveat','dancing_script'
    ));

ALTER TABLE public.brands
  ADD CONSTRAINT brands_theme_animation_whitelist_chk
    CHECK (theme_animation IS NULL OR theme_animation IN (
      'none','confetti','fireworks','balloons','sparkles',
      'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
    ));

-- events: optional per-event override (NULL = use brand default)
ALTER TABLE public.events
  ADD COLUMN theme_color_override TEXT NULL,
  ADD COLUMN theme_font_override TEXT NULL,
  ADD COLUMN theme_animation_override TEXT NULL;

ALTER TABLE public.events
  ADD CONSTRAINT events_theme_color_override_hex_chk
    CHECK (theme_color_override IS NULL OR theme_color_override ~* '^#[0-9a-f]{6}$');

ALTER TABLE public.events
  ADD CONSTRAINT events_theme_font_override_whitelist_chk
    CHECK (theme_font_override IS NULL OR theme_font_override IN (
      'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
      'playfair_display','dm_serif_display','fraunces','lora',
      'bebas_neue','anton','unbounded','caveat','dancing_script'
    ));

ALTER TABLE public.events
  ADD CONSTRAINT events_theme_animation_override_whitelist_chk
    CHECK (theme_animation_override IS NULL OR theme_animation_override IN (
      'none','confetti','fireworks','balloons','sparkles',
      'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
    ));
```

**Indexes:** none. Theme columns are never queried as filters.

**RLS:** no policy changes required (existing `Brand admin plus can update brands` and `Event manager plus can update events` cover new columns implicitly per investigation §3).

**Backfill:** none required. All columns default to NULL; resolver falls back to `mingla.default` (defined in shared package). Investigation §3 confirms no live brand data conflicts.

**Migration pre-flight probe** (per `feedback_invariant_migration_backstop`): NONE — all columns are `NULL`able with no data assumptions. No pre-flight probe required, but cite this NULL-safe shape in implementation report.

### 4.2 Shared design tokens — workspace package extension

**File:** `packages/event-rendering/designTokens.ts` — EXTEND (do not break existing API).

Add the theme contract:

```typescript
// Mingla default theme — fallback when neither event nor brand sets a value
export const MINGLA_DEFAULT_THEME = {
  color: '#eb7825',          // Mingla orange (matches app-mobile/src/constants/colors.ts primary)
  font: 'inter' as const,
  animation: 'none' as const,
} as const;

export type ThemeFontSlug =
  | 'inter' | 'poppins' | 'space_grotesk' | 'plus_jakarta_sans' | 'manrope'
  | 'playfair_display' | 'dm_serif_display' | 'fraunces' | 'lora'
  | 'bebas_neue' | 'anton' | 'unbounded' | 'caveat' | 'dancing_script';

export type ThemeAnimationSlug =
  | 'none' | 'confetti' | 'fireworks' | 'balloons' | 'sparkles'
  | 'glitter_shower' | 'snowfall' | 'falling_petals' | 'hearts' | 'shimmer_reveal';

export interface ResolvedTheme {
  color: string;             // 7-char hex, always set (defaulted)
  foregroundColor: '#000000' | '#ffffff';  // computed via luminance
  font: ThemeFontSlug;       // always set (defaulted)
  fontFamilyValue: string;   // resolved native font family name e.g. 'Inter_500Medium' (per platform)
  animation: ThemeAnimationSlug;  // always set
}

export const FONT_FAMILY_MAP: Record<ThemeFontSlug, string> = {
  inter: 'Inter_500Medium',
  poppins: 'Poppins_500Medium',
  space_grotesk: 'SpaceGrotesk_500Medium',
  plus_jakarta_sans: 'PlusJakartaSans_500Medium',
  manrope: 'Manrope_500Medium',
  playfair_display: 'PlayfairDisplay_500Medium',
  dm_serif_display: 'DMSerifDisplay_400Regular',  // serif display has only 400
  fraunces: 'Fraunces_500Medium',
  lora: 'Lora_500Medium',
  bebas_neue: 'BebasNeue_400Regular',  // display has only 400
  anton: 'Anton_400Regular',
  unbounded: 'Unbounded_500Medium',
  caveat: 'Caveat_500Medium',
  dancing_script: 'DancingScript_500Medium',
};
```

**Foreground-color resolver (WCAG luminance algorithm):**

```typescript
// packages/event-rendering/themeResolver.ts (NEW)
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const sr = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const sg = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const sb = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
}

export function computeForeground(hex: string): '#000000' | '#ffffff' {
  // Spec: WCAG contrast ≥ 4.5 required for normal text.
  // Threshold of 0.179 luminance gives ≥4.5:1 contrast against white for darker colors.
  return relativeLuminance(hex) > 0.179 ? '#000000' : '#ffffff';
}

export function resolveTheme(
  brandTheme: Partial<{ color: string; font: ThemeFontSlug; animation: ThemeAnimationSlug }> | null,
  eventOverride: Partial<{ color: string; font: ThemeFontSlug; animation: ThemeAnimationSlug }> | null,
): ResolvedTheme {
  const color = eventOverride?.color ?? brandTheme?.color ?? MINGLA_DEFAULT_THEME.color;
  const font = eventOverride?.font ?? brandTheme?.font ?? MINGLA_DEFAULT_THEME.font;
  const animation = eventOverride?.animation ?? brandTheme?.animation ?? MINGLA_DEFAULT_THEME.animation;
  return {
    color,
    foregroundColor: computeForeground(color),
    font,
    fontFamilyValue: FONT_FAMILY_MAP[font],
    animation,
  };
}
```

### 4.3 Lottie animation assets — workspace package

**NEW workspace package:** `packages/theme-animations/`

Structure:
```
packages/theme-animations/
├── package.json
├── index.ts
├── lottie/
│   ├── confetti.json
│   ├── fireworks.json
│   ├── balloons.json
│   ├── sparkles.json
│   ├── glitter_shower.json
│   ├── snowfall.json
│   ├── falling_petals.json
│   ├── hearts.json
│   └── shimmer_reveal.json
└── README.md  (sources + licenses)
```

`index.ts` exports a static map:
```typescript
import confetti from './lottie/confetti.json';
import fireworks from './lottie/fireworks.json';
// ... etc
import type { ThemeAnimationSlug } from '@mingla/event-rendering';

export const LOTTIE_BY_SLUG: Record<Exclude<ThemeAnimationSlug, 'none'>, object> = {
  confetti, fireworks, balloons, sparkles,
  glitter_shower: glitterShower, snowfall, falling_petals: fallingPetals,
  hearts, shimmer_reveal: shimmerReveal,
};
```

**Animation source requirement:** implementor sources each `.json` from LottieFiles (or equivalent) under a commercial-clean license. README documents source URL + license per file. Target per-file size ≤ 50 kB raw JSON (~10–25 kB gzipped over the wire). Total package weight: ~250–500 kB raw.

**Tinting:** Lottie JSON files MUST be color-themeable via the `colorFilters` prop on `LottieView` (mobile) and equivalent on web. Implementor selects animations whose color layers can be tinted to `theme.color`. If no tintable variant exists for an animation, ship the multicolor original and document the deviation in implementation report.

### 4.4 Font bundling

**Dependency add (both apps):** `@expo-google-fonts/<font-slug>` per font, OR a single `@expo-google-fonts/dev` import set. Recommended: per-font packages for clean tree-shaking.

`mingla-business/package.json` and `app-mobile/package.json` add:
- `@expo-google-fonts/inter`
- `@expo-google-fonts/poppins`
- `@expo-google-fonts/space-grotesk`
- `@expo-google-fonts/plus-jakarta-sans`
- `@expo-google-fonts/manrope`
- `@expo-google-fonts/playfair-display`
- `@expo-google-fonts/dm-serif-display`
- `@expo-google-fonts/fraunces`
- `@expo-google-fonts/lora`
- `@expo-google-fonts/bebas-neue`
- `@expo-google-fonts/anton`
- `@expo-google-fonts/unbounded`
- `@expo-google-fonts/caveat`
- `@expo-google-fonts/dancing-script`

**Font loading:** both apps' root layouts (`mingla-business/app/_layout.tsx`, `app-mobile/App.tsx` or equivalent) MUST register ALL 14 fonts via `useFonts({ ... })` at startup. Theme renders with system default until fonts hydrate (acceptable — fonts load in <500ms on warm cache).

**Web `@font-face`:** Expo Google Fonts handles react-native-web automatically (uses CSS `@font-face` under the hood). No manual web-only font-face registration required.

**Bundle cost target:** ≤ 6 MB total font assets per app per platform. If exceeded, implementor flags as deviation; SPEC may drop weight variants.

### 4.5 Hook layer — buyer-web

**Extend `mingla-business/src/hooks/usePublicBrandBySlug.ts`:**
- Existing query already fetches the brand row. SELECT must include new columns `theme_color, theme_font, theme_animation`.
- Return value adds `theme: { color, font, animation } | null` (NULL when all 3 columns NULL).

**Extend `mingla-business/src/hooks/usePublicEventBySlug.ts`:**
- Existing query joins brand. SELECT must include event override columns AND the brand's theme columns (via the existing brand join).
- Hook computes `resolvedTheme: ResolvedTheme` by calling `resolveTheme(brand.theme, event.themeOverrides)` from `@mingla/event-rendering`.
- Return value adds `resolvedTheme: ResolvedTheme`.

### 4.6 Hook layer — consumer app

**NEW:** `app-mobile/src/hooks/useEventTheme.ts`
- Input: `BusinessEventCard` (already includes brand_id and event_id).
- Behavior: fetch brand theme (cached, key `['brandTheme', brandId]`, staleTime 5 min) + event override (from card if present; supplement via fetch if missing). Compute `ResolvedTheme` via `resolveTheme()`.
- Output: `{ resolvedTheme: ResolvedTheme, isLoading: boolean }`.
- Used by `ExpandedBusinessEventSheet.tsx` to compute theme prop passed to shared `PublicEventPage`.

### 4.7 Render layer — shared `PublicEventPage`

**File:** `packages/event-rendering/PublicEventPage.tsx`

Add new optional prop:
```typescript
interface PublicEventPageProps {
  // ... existing props
  theme?: ResolvedTheme;     // when undefined, MINGLA_DEFAULT_THEME applies
}
```

Apply theme:
1. Hero band background = `theme.color` (replacing existing `hsl(coverHue, 60%, 45%)` formula — see migration note below).
2. Hero text + CTA text foreground = `theme.foregroundColor`.
3. Section heading font + CTA font = `{ fontFamily: theme.fontFamilyValue }`.
4. Body text retains system default (only headings + CTAs are themed — preserves readability).
5. Entrance animation: mount `<LottieView source={LOTTIE_BY_SLUG[theme.animation]} autoPlay loop={false} ... />` as absolutely-positioned overlay on first mount only (per-session guard via `useRef`). When `theme.animation === 'none'`, skip mount entirely.

**Migration note for coverHue:** the existing `hsl(coverHue, 60%, 45%)` formula on `PublicBrandPage.tsx:309` and equivalent in `PublicEventPage` remains as the FALLBACK when `theme.color === MINGLA_DEFAULT_THEME.color` AND brand has a non-default `cover_hue`. This preserves visual continuity for brands that have not yet set a `theme_color` but have customized `cover_hue` historically. Implementor: add a `useCoverHueFallback` flag in resolver; SPEC-CLARIFY at implementation if ambiguous.

### 4.8 Render layer — buyer-web public brand page

**File:** `mingla-business/src/components/brand/PublicBrandPage.tsx`

- Replace `backgroundColor: hsl(${brand.coverHue}, 60%, 45%)` at line ~309 with `backgroundColor: resolvedTheme.color` (resolvedTheme prop threaded from page route).
- Page route `mingla-business/app/b/[brandSlug]/index.tsx` computes `resolvedTheme` from `usePublicBrandBySlug` hook (no event override at brand-page scope — pass `null` as eventOverride).
- Hero text/CTA foreground = `resolvedTheme.foregroundColor`.
- Section headings = `{ fontFamily: resolvedTheme.fontFamilyValue }`.
- Mount Lottie entrance animation overlay on first mount per session.

### 4.9 Render layer — consumer app event sheet

**File:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

- Call `useEventTheme(card)` to get `resolvedTheme`.
- Pass `theme={resolvedTheme}` to the shared `PublicEventPage` component.
- NO additional theming logic in the sheet host itself — it's a pure pass-through.

### 4.10 Edit UI — business app

**NEW component:** `mingla-business/src/components/theme/ThemeEditorSection.tsx`

Three sub-controls:

1. **Color picker.** Hex input field + native color picker. Validates `^#[0-9a-f]{6}$` (case-insensitive) on blur. Display the resolved foreground text on a preview swatch beside the input ("Sample text" on the chosen background, foreground auto-computed). NO contrast warning (D-5 auto-pick is the entire contrast strategy).

2. **Font dropdown.** Bottom sheet with 14 entries, each rendered IN ITS OWN FONT for preview. Tap to select. Persists selected slug.

3. **Animation dropdown.** Bottom sheet with 10 entries. Selecting `confetti` etc. triggers a 2-second Lottie preview in-place. Tap "Use this animation" to persist slug.

**Mount points:**
- `mingla-business/src/components/brand/BrandEditView.tsx` — mount under existing visual-customization sections. Brand-level write. Scope: `brand.theme_color`, `brand.theme_font`, `brand.theme_animation`.
- `mingla-business/src/components/event/EventEditView.tsx` (or `TicketCreatorWizard.tsx` event-settings step — implementor identifies the canonical event-edit screen) — mount under "Visual" section. Event-level OVERRIDE write. Scope: `event.theme_color_override`, `event.theme_font_override`, `event.theme_animation_override`. Each control has a "Use brand default" reset button that writes `NULL`.

**Section ordering:** theme editor goes AFTER existing identity/cover-media sections, BEFORE Stripe/tax sections. Implementor confirms ordering at implementation by reading existing BrandEditView structure.

**Hide for trip-planner brands?** Per `feedback_brand_kind_immutable_post_create.md`, `kind='trip_planner'` brands have restrictions. SPEC decision: trip-planner brands GET theme editing (no carve-out documented in memory rule that affects theme). If implementor finds a conflict at implementation, surface as P1.

### 4.11 Service layer — write paths

**Brand-write:** existing `mingla-business/src/services/brandsService.ts` `updateBrand()` (or equivalent) — add `theme_color`, `theme_font`, `theme_animation` to the patch shape. NO new service function required.

**Event-write:** existing `mingla-business/src/services/eventsService.ts` `updateEvent()` (or `biz_update_live_event` if RPC-based — implementor verifies) — add 3 override columns to the patch shape.

**CRITICAL — DO NOT route through `events.theme` JSONB.** The new columns are typed siblings, NOT keys inside the JSONB. Per investigation §3 and ORCH-0950 wholesale-wipe class. If the existing patch path normalizes through `events.theme` JSONB, implementor MUST add explicit handling for the new typed columns OUTSIDE the JSONB merge.

## 5. Success criteria

| # | Criterion | Layer | Verifiable by |
|---|---|---|---|
| SC-1 | A brand owner sets `theme_color = '#FF6F00'`, `theme_font = 'playfair_display'`, `theme_animation = 'confetti'` in BrandEditView; on save, the brand row in DB reflects all 3 values; the public brand page renders orange hero with white text in Playfair Display headings and confetti plays once on load. | DB + Render | Direct SQL read + buyer-web Chromium screenshot |
| SC-2-buyer-web | The themed public brand page renders identically on buyer-web Chromium AND Safari. | Render | Playwright cross-browser screenshot |
| SC-2-consumer-iOS | The themed event page in `ExpandedBusinessEventSheet` renders with the same theme on iOS sim. | Render | Maestro + iOS sim screenshot |
| SC-2-consumer-Android | Same on Android emulator. | Render | Maestro + Android emu screenshot |
| SC-3 | A brand owner sets event-level overrides for the same event; the event page renders with the override values, NOT the brand defaults. | DB + Render | Direct SQL + screenshot diff |
| SC-4-business-iOS | The Theme Editor section appears in BrandEditView and EventEditView on business iOS, all 3 controls functional. | Edit UI | Maestro iOS sim flow |
| SC-4-business-Android | Same on Android emulator. | Edit UI | Maestro Android emu flow |
| SC-5 | When brand-picked color is `#FFFF00` (bright yellow), the rendered hero text is black (not white). When color is `#000080` (navy), the rendered hero text is white. | Resolver | Unit test on `computeForeground()` |
| SC-6 | A brand with NULL theme columns and an event with NULL override columns renders the Mingla default theme (orange, Inter, no animation). | Resolver | Unit test on `resolveTheme(null, null)` |
| SC-7 | An event with override color but NULL override font + animation inherits brand's font + animation when set; falls back to Mingla default when brand also NULL. | Resolver | Unit test on `resolveTheme()` |
| SC-8 | The `/checkout/*` pages do NOT render any brand-theme color, font, or animation, regardless of brand-theme values. Checkout layout stays Mingla-neutral. | Render | Screenshot at `/checkout/<eventId>` |
| SC-9 | Invalid hex (e.g. `#ZZ1234`) is rejected at DB level via CHECK constraint. | DB | Direct INSERT/UPDATE attempt |
| SC-10 | A font slug outside the 14-whitelist is rejected at DB level via CHECK constraint. | DB | Direct INSERT/UPDATE attempt |
| SC-11 | An animation slug outside the 10-whitelist is rejected at DB level via CHECK constraint. | DB | Direct INSERT/UPDATE attempt |
| SC-12 | Lottie animations bundled into both apps without exceeding total bundle size by more than 6 MB above the pre-ORCH-0964 baseline. | Build | `eas build` size diff |
| SC-13 | Fonts loaded via `useFonts` resolve within 500ms on warm cache; UI does not flicker on font hydration (system default until ready, then atomic swap). | Runtime | Manual sim check |
| SC-14 | The entrance animation plays ONCE per session per page load — does NOT re-trigger on prop changes, re-renders, or sub-navigation. | Render | Maestro flow + sim repro |
| SC-15 | An invalid theme value sneaking into DB (e.g., direct SQL bypassing the CHECK) is gracefully ignored at render — resolver falls through to next layer rather than crashing. | Resolver | Unit test with bad input |

## 6. Invariants

### Preserve (existing)
- **I-ARI-NO-OKLCH** — colors emitted from theme MUST be hex/rgb/hsl/hwb only. SPEC's `theme_color` is 7-char hex by CHECK constraint — compliant.
- **I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE** — no overlap; this SPEC does not touch capacity.
- **I-CATEGORY-SLUG-CANONICAL** — no overlap.
- **I-ANIMATIONS-NATIVE-DRIVER-DEFAULT** — Lottie animations on RN use native driver by default; verify implementor doesn't disable.
- **Constitution rule 9 (no fabricated data)** — when theme columns are NULL, render Mingla default, NOT a fake "your brand's theme".
- **Constitution rule 6 (logout clears everything)** — theme cache (React Query `['brandTheme', ...]` key) MUST be invalidated on logout in `app-mobile` consumer cache reset.

### New (DRAFT → ACTIVE on ORCH-0964 CLOSE)

- **I-PROPOSED-THEME-TYPED-COLUMNS** — brand + event theme data MUST live in typed columns, NEVER inside the existing `events.theme` JSONB. Strict-grep gate: forbid `theme.theme_color`, `theme.themeColor`, `theme.themeFont`, `theme.themeAnimation` keys in `events.theme` JSONB writes.
- **I-PROPOSED-THEME-RESOLVER-CANONICAL** — the only path to compute the rendered theme is `@mingla/event-rendering`'s `resolveTheme(brandTheme, eventOverride)`. Forbid duplicate resolver logic in any consumer (RN component, hook, edge function). Strict-grep gate: any `themeColor =` assignment outside the resolver file is flagged.
- **I-PROPOSED-THEME-FOREGROUND-COMPUTED** — foreground text color is ALWAYS computed at render time via `computeForeground()`. NEVER stored. NEVER user-set. Strict-grep gate: forbid `theme_foreground_color` / `themeForegroundColor` as a column or persisted field.
- **I-PROPOSED-CHECKOUT-NO-BRAND-THEME** — `/checkout/*` routes MUST NOT consume theme data. Strict-grep gate: `mingla-business/app/checkout/**` files cannot import from `@mingla/event-rendering` `resolveTheme` / `ResolvedTheme` / `MINGLA_DEFAULT_THEME`.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 (happy) | Brand default theme, no event override | brand: orange/Playfair/confetti; event: all NULL | Public event page renders orange + Playfair + confetti | Full stack |
| T-02 (happy) | Per-event override | brand: orange/Playfair/confetti; event: blue/Inter/sparkles | Event page renders blue + Inter + sparkles. Brand page (same brand) still renders orange + Playfair + confetti | Full stack |
| T-03 (resolver edge) | Partial event override | brand: orange/Playfair/confetti; event: color=blue, font=NULL, animation=NULL | Event page renders blue + Playfair + confetti | Resolver |
| T-04 (resolver default) | Everything NULL | brand: all NULL; event: all NULL | Mingla default (orange `#eb7825` + Inter + none) | Resolver |
| T-05 (foreground edge) | Yellow color | `#FFFF00` | Foreground computed as `#000000` | Resolver |
| T-06 (foreground edge) | Navy color | `#000080` | Foreground computed as `#ffffff` | Resolver |
| T-07 (foreground boundary) | Exact threshold luminance | `#777777` (mid-gray) | Foreground = `#000000` (luminance 0.184 > 0.179 threshold) | Resolver |
| T-08 (DB CHECK) | Invalid hex | INSERT `theme_color='not-a-hex'` | CHECK constraint violation, INSERT rejected | DB |
| T-09 (DB CHECK) | Bad font slug | INSERT `theme_font='comic_sans'` | CHECK constraint violation | DB |
| T-10 (DB CHECK) | Bad animation slug | INSERT `theme_animation='explosion'` | CHECK constraint violation | DB |
| T-11 (checkout isolation) | Themed brand's checkout page | Brand with hot-pink theme + checkout open | Checkout page is Mingla-neutral (orange chrome, no pink) | Render |
| T-12 (cross-platform parity) | Identical theme on 3 surfaces | Same brand, viewed on iOS + Android + buyer-web | Screenshots match within rendering tolerances | Render |
| T-13 (animation once-per-session) | Re-render of event sheet | Open sheet, close, re-open same event in <60s | Animation plays first time only; second open does NOT replay | Render |
| T-14 (font hydration) | Cold start | Launch app with cleared font cache | System default renders for <500ms, then atomic swap to themed font with no FOUT/flicker | Runtime |
| T-15 (logout cache clear) | User logs out | Logout from consumer app | React Query theme cache cleared; next login fetches fresh | Hook |
| T-16 (adversarial — invariant) | JSONB sneak | Implementor accidentally writes theme to `events.theme.theme_color` | Strict-grep CI gate fails | CI |
| T-17 (adversarial — invariant) | Duplicate resolver | Someone writes a 2nd `resolveTheme` in app-mobile | Strict-grep CI gate fails | CI |

**Step 0.5 regression-test gate (mandatory at CLOSE):**
- **Implementor happy-path test (REQUIRED):** `packages/event-rendering/__tests__/resolveTheme.test.ts` covers T-03, T-04, T-05, T-06, T-07 with `fails-on-revert verified at <commit>` proof.
- **Tester adversarial test (REQUIRED):** `packages/event-rendering/__tests__/themeResolver.adversarial.test.ts` covers boundary luminance (T-07), invalid hex pass-through (T-15), AND a different angle from happy path — e.g., race-condition where brand theme query loads AFTER event override query.

## 8. Implementation order

1. **DB migration** — apply columns + CHECKs.
2. **Shared package extension** — `packages/event-rendering/designTokens.ts` + `themeResolver.ts` + `PublicEventPage.tsx` theme prop wiring. Unit tests for resolver.
3. **Theme animations package** — create `packages/theme-animations/` workspace, source 9 Lottie JSON files, register exports.
4. **Font deps** — add 14 `@expo-google-fonts/*` packages to both `app-mobile` and `mingla-business`. Register all 14 in root layouts via `useFonts`.
5. **Hook layer** — extend `usePublicBrandBySlug`, `usePublicEventBySlug` (buyer-web). NEW `useEventTheme` (consumer app).
6. **Render — buyer-web public brand page** — thread theme through `PublicBrandPage.tsx`.
7. **Render — buyer-web public event page** — thread theme through adapter to shared `PublicEventPage` (auto-themes consumer app too).
8. **Render — consumer event sheet** — `ExpandedBusinessEventSheet` calls `useEventTheme`, passes prop.
9. **Edit UI** — NEW `ThemeEditorSection.tsx`, mount in `BrandEditView.tsx` + event-edit screen.
10. **Service layer** — extend update patches; verify NO JSONB merge contamination.
11. **CI gates** — write 4 strict-grep scripts for the 4 new invariants.
12. **Regression tests** — Step 0.5 implementor + tester tests.
13. **Native rebuilds** — `eas build` both apps (Lottie + fonts are native deps; this is mandatory, OTA insufficient).

## 9. Regression prevention

- **Strict-grep CI gates** (4) per §6 new invariants. Register in `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`.
- **DB CHECK constraints** prevent invalid values from ever landing.
- **Centralized resolver** prevents drift — every consumer calls one function.
- **Append-only test rule** per ORCH-0840 — `resolveTheme.test.ts` and adversarial test are immutable post-merge without `[TEST-MOD-APPROVED ORCH-NNNN]` in commit body.

## 10. Hard guards for implementor

- **DO NOT** add theme keys to `events.theme` JSONB. Typed columns ONLY.
- **DO NOT** mount any theme provider at `mingla-business/app/_layout.tsx` (would leak to checkout).
- **DO NOT** import `lottie-react-native` from `mingla-admin/` (admin not in scope).
- **DO NOT** ship `_thumb.jpg` or thumbnail mirrors of Lottie files (text-content, not images — N/A here, just noting).
- **DO NOT** disable `useNativeDriver` on Lottie animations.
- **DO NOT** skip `eas build` and try to ship via OTA. Lottie + fonts are native deps.
- **DO NOT** widen the consumer-app theming surface beyond shared `PublicEventPage` without operator approval.
- **DO** invoke `/ui-ux-pro-max` skill before writing `ThemeEditorSection.tsx` per `feedback_implementor_uses_ui_ux_pro_max.md`.
- **DO** verify migration timestamp does not collide with parallel worktrees per `feedback_orchestrator_removes_registry_row_in_close_commit.md`.
- **DO** confirm `verify_jwt` settings preserved if any edge functions touched (none expected, but standard guard).
- **DO** add backend allowlist entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` per `feedback_close_commit_precommit_checks.md` if migration files are added.

## 11. Phasing (operator-optional)

Two-phase shipping is supported but not required:
- **Phase A:** color + animation + edit UI for color/animation. Skip font work. Faster to ship; one native rebuild (Lottie only).
- **Phase B:** fonts. Adds 14 font packages, second native rebuild, font picker UI.

If operator wants to ship in one pass, this SPEC supports it. If phased, implementor splits dispatches accordingly.

## 12. Downstream routing

After implementor returns: Claude `mingla-orchestrator` REVIEW → operator applies migration → orchestrator deploys (no edge functions expected) → Claude `mingla-tester` TEST (4-device parity per `feedback_tester_3sims_plus_operator_physical.md`) → CLOSE.
