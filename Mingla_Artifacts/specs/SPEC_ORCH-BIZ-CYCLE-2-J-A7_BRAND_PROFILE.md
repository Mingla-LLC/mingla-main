# Spec — J-A7: View Brand Profile (Founder View)

> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A7
> **Cycle:** 2 — Brands
> **Codebase:** `mingla-business/` (mobile + web parity per DEC-071)
> **Predecessor investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A7.md`
> **Predecessor audit:** `Mingla_Artifacts/reports/AUDIT_BIZ_CYCLE_2_J_A6_PREFLIGHT.md`
> **Authoritative design:** `HANDOFF_BUSINESS_DESIGNER.md` §5.3.3 lines 1825-1830
> **Spec writer turn:** 2026-04-29
> **Status:** locked

---

## 1. Scope

### 1.1 In scope

- **Route:** `mingla-business/app/brand/[id]/index.tsx` — new dynamic Expo Router route
- **Component:** `mingla-business/src/components/brand/BrandProfileView.tsx` — new composed view
- **State:** `mingla-business/src/store/currentBrandStore.ts` — extend `Brand` type, bump persist v2 → v3 with migration
- **Stub data:** `mingla-business/src/store/brandList.ts` — extend STUB_BRANDS with bio/contact/links/attendees
- **Account tab:** `mingla-business/app/(tabs)/account.tsx` — add "Your brands" rows section above dev card

### 1.2 Out of scope (hard non-goals)

- ❌ J-A8 (`/brand/[id]/edit`) — separate dispatch
- ❌ J-A9 (`/brand/[id]/team`) — Operations row fires Toast only
- ❌ J-A10 (`/brand/[id]/payments`) — Operations row + Stripe banner fire Toast only
- ❌ J-A11–A12 (payments/onboard, payments/reports) — Toast only
- ❌ `/brand/list` (BrandsListScreen) — not a J-A7 entry point in this cycle
- ❌ `/brand/[id]/preview` (public preview) — sticky shelf "View public page" fires Toast only
- ❌ `/brand/[id]/settings`, `/brand/[id]/audit` — separate cycles
- ❌ Photo upload / cropping — Brand.photo stays optional URL string; J-A7 renders gradient-with-initial fallback when undefined (no upload UI)
- ❌ Long-bio "Read more" expansion — see §3.5 "Hidden complexity opt-out"
- ❌ Backend code — DEC-071 frontend-first
- ❌ Kit primitives extension — DEC-079 kit closure
- ❌ Form prefill polish (J-A6 audit H-4) — deferred to end-of-Cycle-2 polish slice

### 1.3 Assumptions

- Cycle 1 baseline intact: BrandSwitcherSheet, currentBrandStore v2, STUB_BRANDS 4-entry stub (verified by J-A6 audit)
- Expo Router 6 dynamic-segment idiom: `app/brand/[id]/index.tsx` resolves `/brand/lm/`
- `useLocalSearchParams<{id: string}>()` returns the `id` segment as a string on iOS, Android, and web
- AsyncStorage persistence works on web via the existing Cycle 0b/WEB3 fixes
- Founder is always brand-owner (no role-based gating in J-A7 — single-tier permission)

---

## 2. Authoritative design source

Per investigation H-A7-1, the J-A7 spec source is **NOT** the design package's `BrandProfileScreen` (which is the editor / J-A8). The source is **`HANDOFF_BUSINESS_DESIGNER.md` §5.3.3 (lines 1825-1830)**, verbatim:

> ### 5.3.3 `/brand/:brandId/` — Brand profile (founder view)
>
> **Mobile:** hero glass card elevated with brand photo + name + bio + contact + social chips. Below: stats strip (total events, total attendees, GMV — only for users with finance access). Below: Recent events list. Sticky shelf at bottom with "Edit brand" + "View public page".
> **Desktop:** Two-column. Left: profile card. Right: stats strip on top, then recent events table.
> **States:** default · empty bio ("Add a description so people know what you're about" inline CTA) · stripe-not-connected banner.
> **Edge cases:** Long bio → expandable "Read more."

Mobile shape is canonical for both mobile and web (DEC-081 — no separate Next.js web; Expo Web reuses mobile components). Desktop two-column is post-MVP polish, NOT in J-A7.

---

## 3. Layer specifications

### 3.1 Schema layer (Brand type extension)

**File:** `mingla-business/src/store/currentBrandStore.ts`

Add new optional fields to `Brand` type:

```typescript
export interface BrandContact {
  email?: string;
  phone?: string;
}

export interface BrandLinks {
  website?: string;
  instagram?: string;
  /** Custom link list (post-MVP); empty in J-A7 stubs. */
  custom?: Array<{ label: string; url: string }>;
}

export interface BrandStats {
  events: number;
  followers: number;
  rev: number;
  /** Total attendees across all events. NEW in J-A7 schema v3. */
  attendees: number;
}

export type Brand = {
  id: string;
  displayName: string;
  slug: string;
  photo?: string;
  role: BrandRole;
  stats: BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
  /** Long-form description shown on profile. NEW in J-A7 schema v3. */
  bio?: string;
  /** One-line tagline. NEW in J-A7 schema v3. */
  tagline?: string;
  /** Contact info shown in profile + edit. NEW in J-A7 schema v3. */
  contact?: BrandContact;
  /** Social + custom links. NEW in J-A7 schema v3. */
  links?: BrandLinks;
};
```

**Persist version bump:**

- `persistOptions.name` stays `"mingla-business.currentBrand.v2"` → bump to `"mingla-business.currentBrand.v3"`
- `version: 3`
- New `migrate` callback handles v1, v2, and v3:
  - `version < 2` → return `{ currentBrand: null, brands: [] }` (Cycle 0a → 1 reset, unchanged from v2)
  - `version === 2` → preserve existing `currentBrand` and `brands`; for each brand, ensure `stats.attendees ?? 0` is added (default 0) and other new fields stay undefined. Cast back to `PersistedState`.
  - `version >= 3` → return as-is

```typescript
migrate: (persistedState, version) => {
  if (version < 2) {
    return { currentBrand: null, brands: [] };
  }
  if (version === 2) {
    const v2 = persistedState as { currentBrand: { stats: { attendees?: number } } | null; brands: Array<{ stats: { attendees?: number } }> };
    const upgradeStats = <T extends { stats: { attendees?: number } }>(b: T): T => ({
      ...b,
      stats: { ...b.stats, attendees: b.stats.attendees ?? 0 },
    });
    return {
      currentBrand: v2.currentBrand !== null ? upgradeStats(v2.currentBrand as never) : null,
      brands: v2.brands.map((b) => upgradeStats(b as never)),
    } as PersistedState;
  }
  return persistedState as PersistedState;
}
```

Header comment update: document the v2 → v3 schema change inline so future cycles audit cleanly.

### 3.2 Stub data layer

**File:** `mingla-business/src/store/brandList.ts`

Extend each of 4 STUB_BRANDS with realistic populated fields. Lonely Moth example:

```typescript
{
  id: "lm",
  displayName: "Lonely Moth",
  slug: "lonelymoth",
  role: "owner",
  stats: { events: 3, followers: 2418, rev: 24180, attendees: 728 },
  currentLiveEvent: null,
  bio: "A six-year-running curatorial project from Sara Marlowe. Limited capacity, generous time. Slow-burn evenings in East London.",
  tagline: "One room. One sound system. Slow-burn evenings.",
  contact: {
    email: "hello@lonelymoth.events",
    phone: "+44 7700 900 312",
  },
  links: {
    website: "lonelymoth.events",
    instagram: "@lonely.moth.events",
    custom: [],
  },
},
```

Apply equivalent realistic fields to The Long Lunch, Sunday Languor, Hidden Rooms. Use distinct copy per brand so the test fixture exercises rendering. Implementor selects copy from designer handoff §6 sample data if present, otherwise composes plausible stubs.

Required fields for ALL 4: `bio` (3 sentences min), `tagline` (1 sentence), `contact` (email + optional phone), `links.website`, `links.instagram`. `links.custom` empty array.

`stats.attendees` per-brand: Lonely Moth 728, The Long Lunch 124, Sunday Languor 1860, Hidden Rooms 256.

### 3.3 Route layer

**File (NEW):** `mingla-business/app/brand/[id]/index.tsx`

Expo Router 6 dynamic-segment file. Reads route param via `useLocalSearchParams`:

```typescript
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";

import { BrandProfileView } from "../../../src/components/brand/BrandProfileView";
import { useBrandList } from "../../../src/store/currentBrandStore";

export default function BrandProfileRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const brands = useBrandList();
  const brand = typeof id === "string"
    ? brands.find((b) => b.id === id) ?? null
    : null;

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <BrandProfileView brand={brand} onBack={() => router.back()} />
    </View>
  );
}
```

- File path determines route: `/brand/lm/`, `/brand/b_lwhq2k1m/`, etc.
- Both stub IDs (`lm`) and user-created IDs (`b_<ts36>`) resolve via the same `find` (verifies J-A6 audit H-1).
- When `brand === null`, renders not-found state inside BrandProfileView.
- `router.back()` works on all 3 platforms; web also supports browser-back arrow.
- No `Platform.OS` branches in this file.

### 3.4 Component layer

**File (NEW):** `mingla-business/src/components/brand/BrandProfileView.tsx`

```typescript
export interface BrandProfileViewProps {
  brand: Brand | null;
  onBack: () => void;
}
```

Render two states:

#### 3.4.1 `brand === null` — Not Found

- TopBar with `leftKind="back"` + title `"Brand"` + onBack handler
- ScrollView body with single GlassCard containing:
  - h2 "Brand not found"
  - Body text: "The brand you tried to open doesn't exist or has been removed. Go back to your account to pick another."
  - Button label "Back to Account" → `onBack()`

#### 3.4.2 `brand !== null` — Populated

Top-down sections:

**Section A — Hero (GlassCard variant="elevated", padding=spacing.lg):**

- Avatar block (84×84): if `brand.photo` defined, render photo; else render gradient with `brand.displayName.charAt(0).toUpperCase()` per design package line 139-145 (use `accent.warm` gradient — same tint already used in BrandSwitcherSheet's `brandAvatar` style, but larger).
- `<Text>` displayName (typography.h2)
- `<Text>` tagline (typography.bodySm, secondary color) — render only if defined; omit if undefined.
- Bio block:
  - If `brand.bio` defined and non-empty: `<Text>` bio (typography.body, secondary color, no line cap in v1 — see §3.5 below)
  - If `brand.bio` undefined or empty string: empty-bio inline CTA card — small Pressable with helper text `"Add a description so people know what you're about"` + chevR icon — fires `[TRANSITIONAL]` Toast `"Editing lands in J-A8."`
- Contact strip (only if `brand.contact?.email` OR `brand.contact?.phone`):
  - Email row with Icon name="user" (best fallback in current kit) — left-icon + `Text` value
  - Phone row similarly
  - Compose inline (no new primitive); use existing Pill or custom inline View
- Social chips strip (only if `brand.links?.website` OR `brand.links?.instagram`):
  - Render a horizontal row of Pill primitives — variant="info" — label = website domain or "@instagram"
  - Each chip: Pressable that fires `[TRANSITIONAL]` Toast `"Opening links lands in Cycle 3."` (deferred to keep scope narrow)

**Section B — Stats Strip:**

- Horizontal row of 3 KpiTile primitives, equal width (flex: 1 each)
- Tile 1: label="Events" value=`brand.stats.events`, sub="all time"
- Tile 2: label="Attendees" value=`brand.stats.attendees.toLocaleString("en-GB")`, sub="all time"
- Tile 3: label="GMV" value=`formatGbp(brand.stats.rev)`, sub="all time"
- Use the same `formatGbp` helper as home.tsx line 42-47 (`Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })`). DRY violation acceptable for now or extract to `mingla-business/src/utils/formatGbp.ts` (implementor decides; if extracted, move home.tsx's copy too).

**Section C — Stripe-Not-Connected Banner (always rendered in J-A7, `[TRANSITIONAL]`):**

- GlassCard variant="base" padding=spacing.md
- Inline left: Icon name (best available — implementor picks from existing 24-icon set, e.g., `bank` or fallback)
- Body column:
  - Title "Connect Stripe to sell tickets" (typography.body, weight 600)
  - Sub "Get paid for your events. Setup takes 5 minutes." (typography.caption, secondary)
- Right: chevR icon
- Whole row Pressable → fires `[TRANSITIONAL]` Toast `"Stripe Connect lands in J-A10."`
- Header comment: `// [TRANSITIONAL] always-on banner — replaced by stripe-state-driven banner in J-A10. Exit: Brand.stripeStatus field added.`

**Section D — Operations List (per design package §5.3.3 layout intent + handoff §5.3.3 implies this content):**

- GlassCard variant="base" padding=spacing.sm — wraps 4 rows
- Each row: Pressable, flex-row, gap, padding 12, border-bottom hairline (except last)
- Row content: 32×32 icon-circle + (label + sub-label column) + chevR icon
- Rows:
  1. icon=`bank` (or fallback), label="Payments & Stripe", sub="Not connected" → Toast "J-A10"
  2. icon=`user`, label="Team & permissions", sub="1 member" → Toast "J-A9"
  3. icon=`bank` (or fallback for receipt — implementor uses kit Icon with closest match), label="Tax & VAT", sub="Not configured" → Toast "Cycle later"
  4. icon=`bank` (or chart fallback), label="Finance reports", sub="Stripe-ready CSVs" → Toast "J-A12"
- All `[TRANSITIONAL]` markers with cycle-specific exit conditions

**Section E — Recent Events (`[TRANSITIONAL]` stub — Cycle 3 lands real events):**

- Section label "Recent events" (typography.h3, paddingHorizontal=spacing.xs)
- If `brand.stats.events === 0`:
  - Empty-state GlassCard: "No events yet" + body "Events you create will show here." + Button "Create your first event" → Toast `"Event creation lands in Cycle 3."`
- Else:
  - 3 hardcoded stub rows per brand (same structure as home.tsx line 262-285 STUB_UPCOMING_ROWS pattern):
    - Row: EventCover (hue-coded) + (Pill label "Past" + title + when) + sold count
  - Implementor picks 3 plausible past-event titles per brand; sold counts derived from `brand.stats.attendees / 3` (rough) — `[TRANSITIONAL]` exit Cycle 3.

**Section F — Sticky Bottom Shelf:**

- Fixed-position View at bottom (above tabs — but profile is NOT a tab route, so it sits above `insets.bottom`)
- Padding: spacing.md horizontal + spacing.md vertical
- 2-button row, gap=spacing.sm:
  - Button label="Edit brand" variant="primary" size="md" leadingIcon="edit" → fires Toast `"Editing lands in J-A8."` `[TRANSITIONAL]`
  - Button label="View public page" variant="secondary" size="md" leadingIcon="eye" (or fallback) → fires Toast `"Public preview lands in Cycle 3+."` `[TRANSITIONAL]`
- Backed by GlassChrome panel with cardElevated intensity for visual separation from scrolling content

**Header (TopBar):**

- `leftKind="back"`
- title=`brand.displayName`
- onBack=`onBack` prop (route file passes `router.back()`)
- right slot: undefined (default search + bell renders) — OR pass empty `<View />` to suppress per design page that didn't show right icons. **Decision: pass `<View />` to keep visual focus on profile content.**

### 3.5 Hidden complexity opt-out — Long-bio "Read more"

§5.3.3 edge case requires expandable "Read more" for long bios. This requires either:
- (A) `numberOfLines` cap with `onTextLayout` measurement to detect overflow → toggle button. Real implementation effort.
- (B) Hardcoded character cap (e.g., 240 chars) → toggle button. Naïve but predictable.

**Spec choice:** Defer to **post-J-A7 polish** if it requires (A); ship (B) only if implementor confirms it's a 1-hour add. Otherwise render full bio without truncation. Implementor decides at build time and documents the choice in the implementation report.

### 3.6 Account tab integration

**File:** `mingla-business/app/(tabs)/account.tsx`

Add new "Your brands" section between the existing sign-out GlassCard (line 121-146) and the dev-tools GlassCard (line 148-173):

```typescript
{brands.length > 0 ? (
  <GlassCard variant="elevated" padding={spacing.lg}>
    <Text style={styles.title}>Your brands</Text>
    <Text style={styles.body}>Tap a brand to open its profile.</Text>
    <View style={styles.brandRowsCol}>
      {brands.map((brand) => (
        <Pressable
          key={brand.id}
          onPress={() => router.push(`/brand/${brand.id}/` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${brand.displayName} profile`}
          style={styles.brandRow}
        >
          <View style={styles.brandAvatar}>
            <Text style={styles.brandInitial}>
              {brand.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.brandTextCol}>
            <Text style={styles.brandName} numberOfLines={1}>{brand.displayName}</Text>
            <Text style={styles.brandSub} numberOfLines={1}>
              {brand.stats.events} events · {brand.stats.followers.toLocaleString("en-GB")} followers
            </Text>
          </View>
          <Icon name="chevR" size={16} color={textTokens.tertiary} />
        </Pressable>
      ))}
    </View>
  </GlassCard>
) : null}
```

(Style copy reuses BrandSwitcherSheet's `brandRow` / `brandAvatar` / `brandInitial` / `brandTextCol` / `brandName` / `brandSub` style tokens — implementor MAY copy them inline OR extract to `src/components/brand/BrandRow.tsx` if they're used in 3+ places. Currently 2 places — copy inline acceptable.)

When `brands.length === 0`, the section is hidden entirely (Cycle 1 empty state on Home tab covers the create-first-brand affordance via the topbar chip — Account tab need not duplicate).

---

## 4. Success Criteria

**AC#1** From Account tab, when ≥1 brand is in the store, a "Your brands" section appears with one row per brand. Each row shows avatar (initial in a tinted square), displayName, sub-text (`{events} events · {followers} followers`), and a chevR icon.

**AC#2** Tapping any brand row in Account navigates to `/brand/${brand.id}/`. The destination route resolves to a screen showing that brand's profile.

**AC#3** When `/brand/:id/` opens with a valid id, the profile screen renders all five J-A7 sections (Hero, Stats Strip, Stripe-Not-Connected Banner, Operations List, Recent Events) plus the sticky bottom shelf with two buttons.

**AC#4** Hero section displays: 84×84 avatar (gradient with brand initial when no `photo`), brand displayName as h2, tagline (if defined) as body-sm, bio body text or empty-bio inline CTA when bio missing, contact rows (email + phone if defined), social chip row (website + instagram if defined).

**AC#5** Stats Strip renders 3 KpiTile primitives in equal-width row: Events / Attendees / GMV, with `Intl.NumberFormat("en-GB","GBP")` for GMV (zero fraction digits) and `toLocaleString("en-GB")` for Attendees.

**AC#6** Stripe-Not-Connected Banner is unconditionally rendered, marked `[TRANSITIONAL]`, and tapping it fires Toast "Stripe Connect lands in J-A10."

**AC#7** Operations List shows 4 rows (Payments, Team, Tax, Finance) — tapping each fires its specific `[TRANSITIONAL]` Toast.

**AC#8** Recent Events section renders 3 stub past-event rows when `brand.stats.events > 0`, OR an empty-state GlassCard with "Create your first event" button (fires Toast for Cycle 3) when `brand.stats.events === 0`.

**AC#9** Sticky bottom shelf shows "Edit brand" (primary) + "View public page" (secondary). Edit fires Toast "Editing lands in J-A8." Public fires Toast "Public preview lands in Cycle 3+."

**AC#10** When `/brand/:id/` opens with an id that doesn't match any brand in the list (e.g., paste `/brand/nonexistent/` in browser, or stale deep link), the screen shows "Brand not found" GlassCard with "Back to Account" button. Back returns to `/(tabs)/account`.

**AC#11** Both stub-format IDs (`lm`, `tll`, `sl`, `hr`) and user-created-format IDs (`b_<ts36>`) resolve correctly via `useBrandList().find(b => b.id === id)`. No format normalization needed (carries J-A6 audit H-1 mitigation).

**AC#12** Mobile + web parity: `/brand/lm/` opens identically on iOS, Android, and web. On web specifically:
- (a) Direct URL navigation (paste `/brand/lm/` in browser address bar after login) works
- (b) Browser back button returns to Account tab
- (c) BlurView visual layers fall back to solid background when CSS backdrop-filter unsupported

**AC#13** TopBar header reads `leftKind="back"` with title=`brand.displayName`, back button calls `router.back()`. Default right slot suppressed (empty View).

**AC#14** Persist v3 migration: cold-launch with v2-persisted state hydrates correctly. New optional fields (bio, tagline, contact, links) start as `undefined`. `stats.attendees` defaults to 0 when migrating from v2.

**AC#15** `npx tsc --noEmit` exits 0. No `any`, no `@ts-ignore`, no `as unknown as X`. Explicit return types on every component + helper. No new kit primitives created.

**AC#16** All `[TRANSITIONAL]` markers are present and grep-verifiable. Each has an exit condition (J-A8, J-A9, J-A10, J-A12, Cycle 3, B1).

---

## 5. Invariants

| ID | Preserve / Establish | Verification |
|---|---|---|
| I-1 | `designSystem.ts` not modified | git diff shows no changes |
| I-3 | iOS / Android / web all execute | Smoke-pass per AC#12 |
| I-4 | No `app-mobile/` imports | grep verify |
| I-6 | tsc strict clean | AC#15 |
| I-7 | Label transitionals | AC#16 |
| I-9 | No animation timings touched | TopSheet untouched, no new anim primitives |
| I-10 | Currency-aware UI | `Intl.NumberFormat("en-GB","GBP")` per AC#5 |
| DEC-071 | Frontend-first | No backend code anywhere |
| DEC-079 | Kit closure preserved | No new files in `src/components/ui/`; new files only in `src/components/brand/` |
| DEC-080 | TopSheet untouched | Verified — J-A7 is route-based, not overlay |
| DEC-081 | No `mingla-web/` references | grep verify |

**New invariant established:**

| New ID | Invariant | Why |
|---|---|---|
| I-11 | Brand-by-id lookup uses format-agnostic resolver | Future-proofs against ID format changes (UUID, slug-based, etc.); spec section 7.1 |

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A7-01 | Account brand-rows rendered | Seeded 4 stub brands | "Your brands" GlassCard shows 4 rows in seed order; each shows avatar+name+stats sub-text+chevR | Account screen |
| T-A7-02 | Account brand-rows hidden | brands.length === 0 | "Your brands" section not rendered; existing Account layout unchanged | Account screen |
| T-A7-03 | Tap brand row → navigate | Tap "Lonely Moth" row | `router.push('/brand/lm/')` fires; navigation lands on profile screen | Route + Account |
| T-A7-04 | Profile renders populated | `/brand/lm/` with seeded data | All 5 sections render: Hero (photo gradient + name + tagline + bio + contact + social) + Stats Strip + Stripe Banner + Operations + Recent Events; sticky shelf visible | Component |
| T-A7-05 | Profile stats math | `/brand/lm/` | Events="3", Attendees="728", GMV="£24,180" (en-GB locale) | Component + helper |
| T-A7-06 | Empty bio inline CTA | brand.bio === undefined | Hero shows inline Pressable "Add a description so people know what you're about" → tap fires Toast "Editing lands in J-A8." | Component |
| T-A7-07 | Empty events state | brand.stats.events === 0 | Recent Events section shows empty-state GlassCard with "Create your first event" → Toast "Cycle 3" | Component |
| T-A7-08 | ID format heterogeneity | Navigate to `/brand/b_lwhq2k1m/` after creating brand via switcher | Profile renders for that user-created brand identically | Route resolver |
| T-A7-09 | Brand not found | `/brand/nonexistent/` (URL paste or stale deep link) | "Brand not found" GlassCard renders; "Back to Account" returns to /(tabs)/account | Component + Route |
| T-A7-10 | Edit CTA placeholder | Tap "Edit brand" sticky shelf button | Toast "Editing lands in J-A8." appears; no navigation | Component |
| T-A7-11 | View public page placeholder | Tap "View public page" sticky shelf button | Toast "Public preview lands in Cycle 3+." | Component |
| T-A7-12 | Stripe banner inert | Tap banner row | Toast "Stripe Connect lands in J-A10." | Component |
| T-A7-13 | Operations rows inert | Tap each of 4 Operations rows | Each fires its specific Toast (J-A10 / J-A9 / Cycle later / J-A12) | Component |
| T-A7-14 | Web direct URL | Paste `/brand/sl/` in browser; press Enter | Profile renders for Sunday Languor; browser back returns to Account | Route + web |
| T-A7-15 | TopBar back | Tap TopBar back arrow | `router.back()` returns to Account | Component + Route |
| T-A7-16 | Persist migration v2→v3 | App was on v2 with seeded brands; cold-launch with v3 | All brands have `stats.attendees` field defaulted to 0; bio/tagline/contact/links undefined; no crash | State migration |
| T-A7-17 | Persist migration v1→v3 | App was on v1 (Cycle 0a era); cold-launch with v3 | currentBrand: null, brands: []  (v1 reset path unchanged) | State migration |
| T-A7-18 | tsc strict | `npx tsc --noEmit` | exit 0 | Build |

Min 3 cases per success criterion: ✅ (T-A7-01 through 18 cover all 16 ACs).

---

## 7. Implementation Order

1. **Schema + stubs first** — extend `currentBrandStore.ts` Brand type + bump v2→v3 + migration; extend `brandList.ts` STUB_BRANDS with bio/tagline/contact/links/attendees for all 4 brands.
2. **tsc check** — confirm clean before component build.
3. **Build BrandProfileView component** at `src/components/brand/BrandProfileView.tsx` with all 5 sections + sticky shelf + not-found state. tsc check.
4. **Create route file** `app/brand/[id]/index.tsx` thin wrapper around BrandProfileView. tsc check.
5. **Wire Account brand-rows section** in `app/(tabs)/account.tsx`. tsc check.
6. **Smoke run** locally (founder-side) — iOS smoke + Android smoke + web smoke.
7. **Verify TRANSITIONAL marker grep** — implementor's report lists every marker placed.
8. **Write implementation report** per implementor skill template.

Order rationale: schema first prevents mid-build refactors when components type-check against stale Brand shape. Component before route lets implementor unit-test the component visually via styleguide route (`/__styleguide`) if added there. Account integration last — it's the simplest piece and doesn't block component work.

---

## 8. Regression Prevention

- **Format-agnostic ID resolver pattern** — code comment in `app/brand/[id]/index.tsx` line 10:
  ```
  // Format-agnostic ID resolver per Cycle 2 invariant I-11.
  // DO NOT add normalization logic; the find() handles all ID shapes
  // (stub `lm`, user-created `b_<ts36>`, future UUIDs).
  ```
- **Persist version bump discipline** — header comment in `currentBrandStore.ts` documents v2→v3 change inline; future schema changes follow same pattern.
- **TRANSITIONAL coverage** — implementation report MUST grep-verify every `[TRANSITIONAL]` marker has an exit condition. Cycle 1 already practices this; J-A7 reinforces.
- **Test T-A7-08** explicitly verifies both ID formats — protection against future regressions if someone refactors to `useCurrentBrand` (singular) by accident.

---

## 9. Out-of-band carve-outs

Three items J-A6 audit flagged + this spec confirms:

| Carry-over | Status in J-A7 |
|---|---|
| **H-1 (J-A6 audit)** ID format tolerance | ✅ ADDRESSED — AC#11 + I-11 + T-A7-08 |
| **H-4 (J-A6 audit)** Form prefill polish | ❌ DEFERRED to end-of-Cycle-2 polish (explicit non-goal §1.2) |
| **D-IMPL-38 (Cycle 1)** Sign-out doesn't clear brand store | ❌ DEFERRED to B1 backend cycle (Cycle 1 acceptance) |

---

## 10. Founder-facing UX (plain English summary)

When this lands, the founder will:

- Open Account tab → see "Your brands" with a row per brand (initial + name + event/follower count)
- Tap a row → see that brand's profile screen with: brand photo placeholder, name, tagline, bio, contact info, social links, stats (events / attendees / revenue), a "Connect Stripe" prompt, a list of 4 operations (Payments / Team / Tax / Reports — all inert until later cycles), a list of recent events (3 stubs or empty state), and a sticky bottom bar with "Edit brand" + "View public page" (both inert until later cycles)
- Tap back → return to Account
- Paste `/brand/lm/` in a browser URL → land directly on Lonely Moth's profile (works on web)
- Try to open a non-existent brand id → see "Brand not found" + back button

**What this DOESN'T do yet:** Editing anything (J-A8). Connecting Stripe (J-A10). Viewing the public-facing brand page (Cycle 3+). Real recent events (Cycle 3). Real attendee/payout numbers (B1 backend).

---

## 11. Dispatch hand-off

Implementor dispatch shall reference both:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A7.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A7_BRAND_PROFILE.md` (this file)

Implementor follows §7 implementation order verbatim. Tester verifies T-A7-01 through T-A7-18 inclusive.

---

**End of J-A7 spec.**
