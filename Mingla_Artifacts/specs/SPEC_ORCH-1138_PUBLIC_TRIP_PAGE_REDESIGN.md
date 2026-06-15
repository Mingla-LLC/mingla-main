# SPEC — ORCH-1138 [Public Trip Page Visual Redesign + Brand-Theming Parity]

**Status:** SPEC (binding contract). NOT implemented.
**Author:** mingla-forensics (SPEC mode).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign` (rebased onto origin/main @ `2f84d6b55`).
**Approved design:** Direction A — "Immersive Itinerary" (`Mingla_Artifacts/design/ORCH-1138/DIRECTION_A_IMMERSIVE_ITINERARY.html` + `DESIGN_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md`, anchor checkout). The design doc IS the pixel/token/state/motion source of truth; this SPEC binds it to exact files and the data path.
**Surfaces:** buyer/anon Web (`/t/{brandSlug}/{tripSlug}`) + business iOS/Android (same RN screen). NOT consumer app-mobile native trip detail; NOT experiences.

---

## 0. Provenance reconciliation (read before scoping — corrects a stale dispatch premise)

The dispatch states ORCH-1130 [public trip page payment redesign] (PR #461) is "in-flight, held pre-merge." **This is STALE.** As of the rebased worktree base `2f84d6b55`, ORCH-1130 is **MERGED to origin/main and CLOSED**:

- `028f48e16 ORCH-1130: public trip page payment-structure + installments UX redesign [deploy] (#461)`
- `2c0b13154 docs: ORCH-1130 + ORCH-1134 CLOSE (...) (#468)`

Consequence (binds the seam, §4.6 + §11): IMPLEMENT does **not** wait for #461 to land — the full ORCH-1130 payment surface is already present in this branch (`TripPaymentChoice.tsx`, `TripCheckoutFlow.tsx`, `installmentScheduleProjection.ts`, the route's `paymentPlanChoice` state, the `barPrice`/deposit logic, the `plan` route param into `/checkout-trip/`). ORCH-1138 **wraps and themes** that surface; it does not respec the payment IA. (If a later 1130 follow-on lands before this implements, rebase onto merged main and re-confirm the seam — but no blocking dependency exists today.)

**KEY DATA FACT — CONFIRMED, no schema change needed.** Trips are rows in the `events` table. The theming columns already exist on prod (verified via live `information_schema.columns` introspection + the ORCH-0964 migration `supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql`):
- `public.brands.theme_color` / `theme_font` / `theme_animation` (text, hex/whitelist-CHECK-constrained).
- `public.events.theme_color_override` / `theme_font_override` / `theme_animation_override` (text, same constraints).
- `business_public_events_view` already exposes both sets (`brand_theme_*` + `theme_*_override`) and is `GRANT SELECT … TO anon`.

**Therefore ORCH-1138 is a FETCH + RENDER change only. No migration, no view change, no RLS change.** The single data-layer gap is that `usePublicTripBySlug.ts` does not currently *select/map* the theme columns into its payload (the `brands` select omits `theme_*`; the `events` `select("*")` already returns `theme_*_override` but the mapper drops them). §4.2 closes exactly that gap.

---

## 1. Executive summary

The public trip page (`/t/{brandSlug}/{tripSlug}`) is the **only** public offering page that ignores the brand's chosen theme. `TripPreview.tsx` hardcodes the default warm accent (`accent.warm`) on every accent element, locks the page to a single dark surface (`#0c0e12`), uses a plain `<Image>` hero (no video-cover support, no overlap seam, no entrance animation), renders the brand as a thin grey byline (no "Presented by" chip), and stacks day cards flat. The themed public **event** page (`packages/event-rendering/PublicEventPage.tsx`) already solves all of this with a proven `resolveTheme` → `createThemePalette` contrast engine.

ORCH-1138 brings the trip page to **1:1 theming parity** with the event page (Direction A — "Immersive Itinerary"): full-bleed aspect-adaptive themed hero with `ThemeEntranceAnimation` + video support, a rounded body card that overlaps the cover (`marginTop:-28`, `borderTopRadius:28`, accent-tinted border), a "Presented by" brand chip with avatar, accent/font/contrast-palette theming on every surface, **plus** a trip-native vertical numbered **itinerary spine**. The ORCH-1130 payment block is **wrapped and themed in place**, not reimplemented. Tax stays venue-sourced server-side; this SPEC touches no money math.

**Reuse-first:** the change consumes the existing `@mingla/event-rendering` theming primitives (`resolveTheme`, `resolveOfferingSurface`, `ThemeEntranceAnimation`, `EventCoverMedia`, the package design tokens). The ONE net-new shared primitive is the **export of `createThemePalette` + its `ThemePalette` type** from the package (today they are private inside `PublicEventPage.tsx`). This is a pure extraction — no behavior change to the event page — so trips render off the exact same contrast engine instead of a forked copy.

---

## 2. Scope & non-goals

### In scope
1. Export `createThemePalette` and the `ThemePalette` type from `@mingla/event-rendering` (extract from `PublicEventPage.tsx`, re-import there — zero behavior change to events).
2. `usePublicTripBySlug.ts`: select brand `theme_*` columns; map `brand.theme` (ThemeInput) and `trip.themeOverride` (ThemeInput) into the payload via the shared `asThemeInput` shape. (`events.theme_*_override` already arrive via `select("*")`.)
3. Rebuild `TripPreview.tsx` to Direction A: themed full-bleed hero (overlap seam + entrance animation + `EventCoverMedia` cover supporting image/video/no-cover), "Presented by" brand chip, themed meta chips + route line, collapsible About, **vertical numbered itinerary spine**, themed inclusions, themed pricing/CTA elements — all driven by a resolved `ThemePalette` passed in as an OPTIONAL prop (additive; absent ⇒ today's dark default, so the wizard/checkout callers are untouched).
4. Route `app/t/[brandSlug]/[tripSlug].tsx`: resolve the theme once (`resolveTheme(brand.theme, trip.themeOverride)`), build the palette (`createThemePalette`), pass it to `TripPreview`, the refund/deadline strips, the wrapped payment block, and derive the floating-bar `surface` via `resolveOfferingSurface(resolvedTheme)` (replacing the hardcoded `surface="dark"`).
5. Thread an OPTIONAL `palette` prop into the ORCH-1130 payment components (`TripCheckoutFlow` → `TripPaymentChoice`) so the accent-topped pay-card, segmented toggle, schedule dots, and "DUE TODAY" emphasis take the resolved accent/contrast colors. **Additive only — payment IA, copy, amounts, schedule projection, and the no-plan/free branches are 1130's and stay byte-identical when no palette is passed.**
6. Themed loading **skeleton** matching the Direction A layout (replaces today's bare spinner), and themed Error / Not-found / No-cover / Video-cover / Sold-out / Bookings-closed / Deadline-approaching / Not-bookable / installments-on-vs-off / theme-absent-default states (§4.5).
7. Per-surface (web vs RN) deltas per design §1.8; Android opaque-glass fallback on every translucent panel.

### Non-goals (explicit)
- **No payment IA redesign.** ORCH-1130 owns pay-in-full/pay-over-time, the segmented control behavior, deposit "due today" copy, schedule projection, the `plan` route param, and the no-plan/free branches. ORCH-1138 only *themes* and *visually hosts* them.
- **No schema / view / RLS / migration change.** All theme columns exist and are anon-granted (§0).
- **No money math.** Tax stays venue-sourced server-side (`events.venue_tax_address`); prices read from `priceCents`/`installmentSchedule` exactly as today. No fee/tax recompute.
- **No multi-tier UI.** Today only `pricingTiers[0]` renders; a tier selector is out of scope (design §4 Q3) unless Seth re-opens.
- **No consumer app-mobile trip detail and no experiences page.** Those are separate surfaces/ORCHs. (The shared `createThemePalette` export is consumer-safe but no consumer wiring ships here.)
- **No floating-bar accent theming beyond surface tone.** The event page's `FloatingOfferingBar` themes only light/dark *surface* (its action accent is the fixed `#eb7825`); trip parity = match that exactly. Do NOT introduce a themed bar accent (would diverge from events and widen scope).
- **No change to the `/t/` full-bleed status-bar-overlap aesthetic** (the existing `orch-strict-grep-allow safearea-on-fullscreen-routes` comment stays; the hero stays full-bleed by design).
- **No re-theming of the wizard Step 5 review or the `/checkout-trip/` payment step.** Those reuse `TripPreview`/`TripPaymentChoice` with NO palette prop and must render identically to today.

### Assumptions
- Brands with no theme set (NULL `theme_*`) resolve to `MINGLA_DEFAULT_THEME` (`#eb7825` / `inter` / `none`) via the existing resolver — producing a dark page visually equivalent to today's look (acceptance: §5 SC-9).
- `installmentScheduleProjection` and all 1130 amount/copy logic are correct and unchanged (proven by 1130's TEST PASS); this SPEC does not re-verify them.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **No** | unchanged | none | n/a — consumer trip detail is a separate surface/ORCH |
| 2 | Consumer Android (`app-mobile/` Android) | **No** | unchanged | none | n/a — same reason |
| 3 | Buyer/anon **Web** (`mingla-business` `/t/{brandSlug}/{tripSlug}`) | **YES** | Themed Direction-A trip page (hero seam, brand chip, itinerary spine, themed payment block, light/dark contrast page) | route + `TripPreview` + hook + payment-wrap + package export | **Automatic** (shared RN screen rendered via react-native-web) |
| 4 | **Business iOS** (`mingla-business` iOS) | **YES** | Same themed screen natively | same files | **Automatic** (same RN component) |
| 5 | **Business Android** (`mingla-business` Android) | **YES** | Same themed screen; translucent panels use opaque ≥0.92 fallback | same files + `Platform.select` opaque fills | **Manual delta** (Android glass policy — see §4.4 Component + §5 per-surface SCs) |
| 6 | Admin Web (`mingla-admin/`) | **No** | unchanged | none | n/a — no trip page in admin |
| 7 | Business Web preview / wizard Step 5 (`TripCreatorStep5Review` → `TripPreview`) | **Adjacent — MUST NOT REGRESS** | unchanged (renders `TripPreview` with NO `palette` prop ⇒ today's dark default) | none (verified by additive-prop default) | **Automatic** via additive default; guarded by §5 SC-10 + §9 regression test |

`/checkout-trip/[tripEventId]/payment.tsx` (the 1130 Review & pay step that also renders `TripPaymentChoice`) is in the same MUST-NOT-REGRESS bucket as row 7: it passes no `palette` and must render byte-identical to today.

---

## 4. Layered specification

### 4.1 Database / Schema / RLS — NO CHANGE
No migration, no view edit, no RLS edit, no constraint edit. All theme columns exist and are anon-granted (§0). The implementor MUST NOT author a migration. If IMPLEMENT believes a schema change is required, **stop-and-amend** (§ allowlist) — it is not.

### 4.2 Data / Hook layer — `usePublicTripBySlug.ts`

File: `mingla-business/src/hooks/usePublicTripBySlug.ts`

Changes (all additive to the existing `PublicTripPayload`):

1. **Brand select** — extend the brands query (currently `id, slug, name, description, cover_media_url`) to also select `theme_color, theme_font, theme_animation`:
   ```ts
   .select("id, slug, name, description, cover_media_url, theme_color, theme_font, theme_animation")
   ```
2. **Events select** — already `.select("*")`, which returns `theme_color_override`/`theme_font_override`/`theme_animation_override` from the `events` table. No query change; only mapping is added (below). Confirm at IMPLEMENT that these three fields are present on the returned row (they are columns on `events`).
3. **ThemeInput assembly** — import the package validators and assemble two `ThemeInput | null` values using the SAME shape `publicEventsService.asThemeInput` uses (validate-then-include; null when empty). Mirror it locally (do not import from `publicEventsService` — keep the hook's import surface clean; a ≤10-line local `asThemeInput` is acceptable, OR import `isThemeColor`/`isThemeFontSlug`/`isThemeAnimationSlug` from `@mingla/event-rendering`). Compute:
   - `brandTheme: ThemeInput | null` from `brand.theme_color/theme_font/theme_animation`.
   - `tripThemeOverride: ThemeInput | null` from `event.theme_color_override/theme_font_override/theme_animation_override`.
4. **Payload shape** — extend `PublicTripPayload`:
   - add `brand.theme: ThemeInput | null` (on the existing returned `brand` object).
   - add top-level `themeOverride: ThemeInput | null` (the trip's per-row override).
   Rationale for placing `themeOverride` top-level rather than on `trip`: `Trip` is a shared service type used by the wizard/checkout; keep the public payload's theme data on the payload, not on `Trip`, to avoid widening the shared type (DO-NOT-TOUCH `tripsService.Trip`).
5. **Cache:** query key unchanged (`tripKeys.publicBySlug(brandSlug, tripSlug)`); `staleTime` unchanged (60s). The new columns ride the existing key — no new key, no invalidation change.
6. **Error contract:** unchanged — preserve the throw-on-`.error` pattern (ORCH-0879 PostgrestError surfacing) and the `maybeSingle()` null→not-found behavior.
7. **`bookable` / paid-gate logic:** unchanged (ORCH-1117 `resolveTripBookable`).

Return type: `UseQueryResult<PublicTripPayload | null, Error>` unchanged in shape; `PublicTripPayload` gains `brand.theme` + `themeOverride`. No `any` introduced beyond the existing eslint-disabled row casts.

### 4.3 Package layer — `@mingla/event-rendering`

File: `packages/event-rendering/PublicEventPage.tsx` + `packages/event-rendering/index.ts`

1. **Extract `createThemePalette` + `ThemePalette` into an exportable surface.** Two acceptable mechanisms (implementor picks the lower-churn one; both must leave the event page rendering byte-identical):
   - (Preferred) Move `createThemePalette`, the `ThemePalette` type, and their pure helpers (`parseHexColor`, `mixHexColors`, `hexToRgba`, `relativeLuminance`, `contrastRatio`, `readableTextFor`, `contrastAdjustedAccent`, `contrastAdjustedForWhiteText`, `FALLBACK_ACCENT_RGB`, etc.) into a new file `packages/event-rendering/themePalette.ts`, and have `PublicEventPage.tsx` import them. Export `createThemePalette` + `ThemePalette` from `index.ts`.
   - (Alternative) Keep them in `PublicEventPage.tsx` but add `export` to `createThemePalette` and the `ThemePalette` type and re-export from `index.ts`.
   Either way: **NO change to the algorithm** — `useDark` decision, 10%/3.5% page mix, `3.15` accent-on-page floor, `4.5` white-on-accent floor, all palette field values stay exactly as in `2f84d6b55`. The event page must produce pixel-identical output (guarded by §9).
2. **`index.ts`** — add:
   ```ts
   export { createThemePalette } from "./themePalette"; // or "./PublicEventPage"
   export type { ThemePalette } from "./themePalette";
   ```
   `resolveTheme`, `resolveOfferingSurface`, `ThemeEntranceAnimation`, `EventCoverMedia`, `ThemeInput`, `ResolvedTheme` are already exported — reuse as-is.
3. **Package isolation** unchanged (`I-MOR-0827-PACKAGE-ISOLATION`): no app imports introduced into the package.

### 4.4 Component layer — `TripPreview.tsx` (the redesign)

File: `mingla-business/src/components/trip/TripPreview.tsx`

**Props (additive — the redesign must be backward-compatible for the wizard/checkout callers):**
```ts
export interface TripPreviewProps {
  trip: Trip;
  brand: TripPreviewBrand;
  showCta?: boolean;                 // unchanged
  contentPadding?: number;           // unchanged
  onReserveTap?: () => void;         // unchanged
  testID?: string;                   // unchanged
  /** ORCH-1138 — resolved brand-theme palette. When undefined (wizard/checkout
   *  callers), render today's dark default look. When provided (public /t/ route),
   *  the whole page themes off it. */
  palette?: ThemePalette;            // NEW (from @mingla/event-rendering)
  /** ORCH-1138 — resolved theme for fontFamilyValue + entrance animation.
   *  Undefined ⇒ no font theming, no entrance animation (today's behavior). */
  theme?: ResolvedTheme;             // NEW
}
```
**Rule:** when `palette === undefined` the component path must be visually equivalent to the pre-1138 file (the wizard preview and `/checkout-trip` payment step paths). Implement this with a single resolved `p = palette ?? DEFAULT_DARK_PALETTE` where `DEFAULT_DARK_PALETTE` reproduces today's hardcoded colors (page `#0c0e12`/transparent, accent `accent.warm`, white/secondary/tertiary text) — so the template is unified but the default branch matches today. Font: `theme?.fontFamilyValue` (undefined ⇒ omit `fontFamily`, i.e. platform default, today's behavior).

**Direction A layout + theming map (design doc §2.1 DIRECTION A + the approved HTML are authoritative; this binds the tokens to surfaces):**

| Surface element | Theme source | Notes |
|---|---|---|
| Hero cover | `EventCoverMedia` (image/video) OR `palette`-derived `heroColor` (no-cover) | full-bleed; aspect-adaptive (mirror `PublicEventPage` `heroBox` aspectRatio clamp `0.75…16/9`); `ThemeEntranceAnimation theme={theme} sessionKey={`trip:${trip.id}`}` over the cover; video shows the audio/mute pill bottom-right (ORCH-1124 default of `EventCoverMedia`); reduced-motion skips the entrance animation |
| Body card | `backgroundColor: palette.page`, `borderColor: palette.panelBorder`, `marginTop: -28`, `borderTopRadius: 28`, `maxWidth: 660` centered | the overlap seam (matches `PublicEventPage.bodyContent`) |
| Eyebrow (duration · group) | `color: palette.accent`, `fontFamily: theme.fontFamilyValue` | 11px / 900 / letter-spacing 1.6 uppercase |
| Title | `color: palette.primaryText`, `fontFamily: theme.fontFamilyValue` | ≥32px so the font choice reads (design §3 borrow) |
| Meta chips (dates / seats-left / capacity) | icon `stroke: palette.accent`; seats-left text `color: palette.accent` (bold) | seats/capacity only when present (Constitution #9 — no fabricated fields). NOTE: `pricingTiers[].ticketsRemaining` is `null` in this hook today (§ note below) — render capacity from `businessTrip.capacity` only; do not invent a seats-left number |
| Brand chip ("Presented by") | tile `backgroundColor: palette.accent` (or photo), kicker `palette.tertiaryText`, name `palette.primaryText`, "View" CTA `palette.accent`; row bg `palette.glass`, border `palette.cutoutBorder` | mirror `PublicEventPage` brand chip; tappable → open brand (`/b/{slug}`); ≥44pt |
| Route line (Leaving from → Destination) | arrow/icons `palette.accent`, text `palette.primaryText/secondaryText` | conditional on `departureLocationText`/`destinationLocationText` (hide when absent) |
| About | `CollapsibleDescription` (existing) | read-more link `palette.accent`; 200ms height settle (existing LayoutAnimation), reduced-motion instant |
| Itinerary spine | 2px rail `linear-gradient(palette.accent → palette.accentWash)`; numbered dots `palette.accent` fill + `palette.accentText` numeral + 4px `palette.page` ring (`shadow`/border ring); day-ord eyebrow `palette.accent`; day-title `palette.primaryText` + `fontFamily`; narrative `palette.secondaryText`; stop chips bg `palette.accentWash` / border `palette.panelBorder` / text `palette.secondaryText` | the new trip-native layer. Day media gallery (ORCH-1119) preserved inside each day card. **Long-trip collapse:** collapse to first 2 days with a "Show all N days" toggle when `days.length >= 5` (design §4 Q1 recommended yes; mirror event `SHOW_INITIAL_DATES`); toggle label `palette.accent` |
| Inclusions | included ✓ mark `palette.accent` on `palette.accentWash`; excluded × `palette.tertiaryText` + strike-through | color is never the only indicator (✓/× glyph + strike) — Constitution + design §1.3 |
| Pricing recap (when shown) | tier name `palette.secondaryText`, price `palette.primaryText` + `fontFamily` | the page's primary money block is the wrapped payment card (§4.6); this is the quiet recap path for no-plan trips |

**All states (loading/error/etc.) are owned by the ROUTE (§4.5), not `TripPreview`** — `TripPreview` renders only the populated body (it already assumes a valid `trip`). The no-cover and video-cover states ARE `TripPreview`'s (hero branch). Empty itinerary / empty inclusions ⇒ section omitted entirely (today's behavior, preserved).

**Android glass policy (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`):** every translucent panel introduced or themed (brand-chip row bg, stop chips, pay-card track, any `palette.glass`/`panel` fill) uses `Platform.select` with an opaque ≥0.92 Android fill, `overflow:'hidden'`, and no Android shadow under a rounded fill. iOS keeps the translucent palette values. (The existing day-media tile already follows this — match it.)

**Accessibility:** every tappable ≥44pt; brand chip + day-toggle + read-more have `accessibilityRole="button"` + labels; contrast guaranteed by `createThemePalette` (≥4.5:1 text, ≥3.15:1 accent-on-page); reduced-motion fallback on entrance + height-settle.

### 4.5 Route / state layer — `app/t/[brandSlug]/[tripSlug].tsx`

File: `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`

1. **Resolve theme once** (after `payload` is non-null), memoized:
   ```ts
   const resolvedTheme = useMemo(
     () => resolveTheme(payload.brand.theme ?? null, payload.themeOverride ?? null),
     [payload.brand.theme, payload.themeOverride],
   );
   const palette = useMemo(() => createThemePalette(resolvedTheme), [resolvedTheme]);
   const surface = useMemo(() => resolveOfferingSurface(resolvedTheme), [resolvedTheme]);
   ```
   (Both `resolveTheme` and `createThemePalette` and `resolveOfferingSurface` from `@mingla/event-rendering`.)
2. **Pass theme down:** `<TripPreview trip brand showCta={false} palette={palette} theme={resolvedTheme} />`.
3. **Host background:** the `styles.host` `backgroundColor: "#0c0e12"` → `palette.page` (so a light brand theme yields a light page, not a dark gutter). The state-screen hosts (`stateHost`) also take `palette.page` once a theme is known; the loading skeleton uses `palette.page` too (see below — but note theme isn't known until data loads, so the skeleton uses the neutral default page until first paint, acceptable).
4. **Floating bar surface:** replace `surface="dark"` with `surface={surface}` (derived). Bar accent stays `#eb7825` (parity boundary — non-goal §2). The CTA price/deposit logic (1130) is unchanged.
5. **Refund/deadline/closed strips** (`closedBannerWrap`, `countdownPill`, `refundPolicyWrap`): re-color off `palette` (countdown pill bg `palette.accentWash`, border `palette.panelBorder`, text `palette.accent`; closed banner keeps `semantic.error` red per ORCH-0875 — error red is NOT themed). Keep `RefundPolicyDisplay` as-is (shared component; if it accepts a palette/accent prop, pass it; otherwise leave — confirm at IMPLEMENT, do not widen).
6. **Wrapped payment block:** pass `palette` to `<TripCheckoutFlow … palette={palette} />` (§4.6).

**Every UI state (the route owns these — exact treatments from design §1.5):**

| State | Trigger | Treatment |
|---|---|---|
| Loading | `query.isLoading || query.isFetching` | **Skeleton** matching Direction A: cover shimmer block + title bar + 3 meta-chip bars + 2 day-card bars + price bar (replaces today's bare `ActivityIndicator`). Neutral default-page background (theme unknown pre-data). No content jump. |
| Error | `query.isError` | Centered "Couldn't load trip" + the real PostgrestError `.message` (preserve ORCH-0879) + Retry. |
| Not found / not live | `payload === null` | Centered "Trip not found — this trip may not be live yet, or the link is wrong." |
| No cover media | `trip.coverMediaUrl === null` | Hero = flat `palette`-derived `heroColor` (mirror event no-cover branch); title legible over scrim. |
| Cover is video | `trip.coverMediaType === "video"` | `EventCoverMedia` video, autoplay-muted, audio/mute pill bottom-right (ORCH-1124). |
| Sold out | capacity reached (NOTE: this hook does NOT compute sold-out today — `ticketsRemaining` is null; see note) | If/when wired: "SOLD OUT" banner under hero, payment block dimmed, floating bar non-tappable "Sold out". **For 1138: do NOT fabricate a sold-out state the hook can't prove.** Render sold-out ONLY if a real signal exists; otherwise omit (Constitution #2/#9). Flag as Open Question §10. |
| Bookings closed | `trip.bookingsClosed === true` | Red "Bookings closed" strip (preserve ORCH-0875) + floating bar non-tappable (existing `tripCta` unavailable branch). |
| Deadline approaching | `booking_deadline` future | Accent countdown pill "Bookings close in N …" (existing; re-themed). |
| Not bookable | `payload.bookable === false` | Floating bar non-tappable "Booking unavailable" (preserve ORCH-1117); payment block still shows price, CTA-coupling dimmed. |
| Installments on vs off | 1130 `paymentPlanChoice` | Headline number / subline / schedule visibility / floating-bar price all swap together (1130 single-source — unchanged; 1138 only themes the colors). |
| Theme absent (default) | NULL brand theme | `MINGLA_DEFAULT_THEME` → dark page ≈ today's look (SC-9). |

### 4.6 ORCH-1130 integration seam — payment block (WRAP, do not reimplement)

Files: `mingla-business/src/components/trip/TripCheckoutFlow.tsx` + `mingla-business/src/components/trip/TripPaymentChoice.tsx`

**Contract:** ORCH-1138 adds an OPTIONAL `palette?: ThemePalette` prop and themes the *colors* only. Everything else 1130 — the segmented control behavior, "Pay in full" / "Pay over time" labels, deposit/full amount logic, `depositPct`, the `InstallmentScheduleDisplay` ladder, the no-plan quiet-recap branch, the free/undefined-tier branches, the `value`/`onChange` plumbing — is **unchanged** and must render byte-identical when `palette` is absent.

1. `TripCheckoutFlow`: add `palette?: ThemePalette` to props; forward to `<TripPaymentChoice … palette={palette} />`. The no-plan recap line (`recapRow`/`recapPrice`/`recapHelper`) may take `palette.primaryText/secondaryText/tertiaryText` when palette present (defaults to today's `textTokens` when absent).
2. `TripPaymentChoice`: add `palette?: ThemePalette`; when present, drive:
   - pay-card top stripe + border → `palette.accent` / `palette.panelBorder` (the 4px accent stripe = design §2.1 "accent top-stripe").
   - selected segment fill/border/title → `palette.accent`/`palette.accentWash`; dot inner/border → `palette.accent`.
   - schedule "today" dot → `palette.accent`; future dots muted (`palette.tertiaryText`); "Deposit" tag → `palette.accent`.
   - "Charged today" / amount labels → `palette.primaryText/secondaryText`.
   When `palette === undefined`, the current hardcoded `rgba(235,120,37,…)` + `textTokens` look is preserved (the `/checkout-trip/payment.tsx` Review & pay step path).
3. **Do NOT change** `installmentScheduleProjection.ts`, the route param threading, `InstallmentScheduleDisplay` logic, or any amount/copy. If theming `InstallmentScheduleDisplay` dots requires a prop it doesn't have, add an OPTIONAL color prop additively — but prefer to theme only at the `TripPaymentChoice` wrapper level; **stop-and-amend** if deeper changes seem needed.

**Integration target note:** because 1130 is already merged at `2f84d6b55`, the seam target is the *current* merged version — no rebase-wait. IMPLEMENT rebases onto latest origin/main before starting (standard) and re-confirms these two files match what this SPEC read; if 1130 follow-on changed them, re-confirm the additive-palette approach still fits and flag any drift.

---

## 5. Success criteria (numbered, observable, per-surface where parity is manual)

- **SC-1-Web / SC-1-iOS / SC-1-Android** — For a brand with `theme_color = #0f766e` (teal), `theme_font = playfair_display`: the `/t/` page renders a teal-tinted dark page, a Playfair title, teal eyebrow/chip/spine-dots/inclusion-marks/segment-fill, and a Playfair price — NOT the default orange/Inter. (Web + business iOS + business Android.)
- **SC-2** — A per-trip override (`events.theme_color_override = #b91c1c`) wins over the brand color (cascade: override > brand > default) on the same page.
- **SC-3** — A LIGHT brand color (e.g. `#fde047` yellow) produces a **light page** (`createThemePalette` `useDark=false`), with dark `primaryText`, and a contrast-adjusted accent that is legible as text on the page AND as white-on-accent on the segment fill (no invisible white-on-near-white — the ORCH-1117 R1 class of bug cannot recur).
- **SC-4** — Hero: an image cover renders full-bleed aspect-adaptive with the −28 overlap seam; a **video** cover autoplays muted with the bottom-right audio pill; a **no-cover** trip shows the accent-derived `heroColor` with a legible title. The `ThemeEntranceAnimation` plays once per session over the cover (and is skipped under reduced-motion).
- **SC-5** — Brand chip shows avatar (or accent letter tile) + "Presented by" kicker + brand name + "View" CTA, ≥44pt, tapping opens `/b/{brandSlug}`.
- **SC-6** — Itinerary renders as a vertical spine: a rail + numbered accent dots with a page-colored ring, one day card per day, stops as chips. A trip with `days.length >= 5` collapses to 2 days with a working "Show all N days" toggle.
- **SC-7-Android** — Every translucent panel (brand row, stop chips, pay-card track) uses an opaque ≥0.92 Android fill with `overflow:'hidden'` and no Android shadow under the rounded fill; iOS keeps translucent.
- **SC-8** — Payment block (1130, wrapped): pay-in-full shows the full price; pay-over-time switches the emphasis to deposit "due today" + reveals the themed schedule ladder; the floating-bar price + kicker swap with the toggle. Toggling between full/over-time multiple times leaves amounts and copy exactly as 1130 ships them (no 1138 regression to payment numbers).
- **SC-9** — A brand with NULL theme renders a dark page visually equivalent to the pre-1138 trip page (orange accent, Inter/default font) — no visible change for un-themed brands.
- **SC-10 (REGRESSION GATE)** — The wizard Step 5 review (`TripCreatorStep5Review` → `TripPreview` with no `palette`) AND `/checkout-trip/[tripEventId]/payment.tsx` (`TripPaymentChoice` with no `palette`) render byte-identical to `2f84d6b55` (no theming bleed into the unthemed callers).
- **SC-11** — The public **event** page (`PublicEventPage`) renders pixel-identical to `2f84d6b55` after `createThemePalette` is extracted/exported (pure refactor, zero behavior change).
- **SC-12** — Floating bar `surface` follows the resolved theme (light page ⇒ light bar fill) via `resolveOfferingSurface`; not hardcoded dark.
- **SC-13** — Loading shows the Direction-A skeleton (not a bare spinner); Error surfaces the real PostgrestError message (ORCH-0879 preserved); Not-found shows the exact copy.
- **SC-14** — No fabricated data: missing departure/destination/capacity/description/itinerary/inclusions are HIDDEN, not faked; no invented seats-left number; currency from the trip tier (no hardcoded glyph).

---

## 6. Invariants

**Preserved (must not break):**
- `I-MOR-0827-PACKAGE-ISOLATION` — `@mingla/event-rendering` imports nothing from any app's `src/`. The `createThemePalette` extraction stays inside the package. Verified by the existing package-isolation gate.
- `I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED` (ORCH-1117/1076) — the `bookable` paid-gate + "Booking unavailable" strip behavior is untouched.
- ORCH-0879 PostgrestError surfacing on the error state — preserved (§4.5).
- ORCH-0875 refund-ladder + countdown/closed-banner — preserved (re-themed colors only; error red stays `semantic.error`).
- ORCH-0876 trip-specific checkout chain — Reserve still targets `/checkout-trip/{trip.id}` (`tripCheckoutPath`), never `/checkout/{id}` (`eventType.filter.audit.test.ts`).
- ORCH-1124 video audio-pill bottom-right placement — inherited from `EventCoverMedia`.
- ORCH-1130 payment IA/amounts/copy/projection — wrapped, not changed (additive palette only).
- `ANDROID_GLASS_USES_OPAQUE_FALLBACK` — every new/themed translucent panel honors it.
- The `/t/` full-bleed `orch-strict-grep-allow safearea-on-fullscreen-routes` design-intent comment — kept.

**Proposed NEW (DRAFT — orchestrator flips ACTIVE on CLOSE):**
- `I-PROPOSED-1138-TRIP-PAGE-USES-SHARED-THEME-RESOLVER` **[DRAFT]** — The public trip page MUST resolve its theme via `@mingla/event-rendering`'s `resolveTheme` + `createThemePalette` (the shared engine), never a forked/second theming path and never raw hardcoded accent hexes on themed surfaces. Enforced by a strict-grep gate (§9): the trip route + `TripPreview` import `createThemePalette`/`resolveTheme` from `@mingla/event-rendering`, and `TripPreview`'s themed surfaces read from a `palette`, not `accent.warm`.
- `I-PROPOSED-1138-PAYMENT-BLOCK-THEME-IS-ADDITIVE` **[DRAFT]** — `TripPaymentChoice`/`TripCheckoutFlow` MUST keep `palette` optional and render the 1130 default look when it is absent (protects the wizard + `/checkout-trip/payment.tsx` callers). Enforced by SC-10 regression test.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | Themed teal+Playfair brand | brand `theme_color #0f766e`, `theme_font playfair_display`, no override | page teal-dark, Playfair title, accent on eyebrow/chip/spine/marks/segment | component (web + RN) |
| T-2 | Override beats brand | override `#b91c1c`, brand `#0f766e` | crimson accent throughout | hook+component |
| T-3 | Light brand → light page + contrast | `theme_color #fde047` | `useDark=false`, dark primaryText, accent legible as text AND white-on-accent | palette unit + component |
| T-4 | No-cover hero | `coverMediaUrl=null` | accent-derived `heroColor`, legible title, no broken image | component |
| T-5 | Video cover | `coverMediaType="video"` | autoplay-muted + bottom-right audio pill | component |
| T-6 | Long-trip itinerary collapse | `days.length = 7` | 2 days shown + working "Show all 7 days" toggle | component |
| T-7 | Android opaque glass | Android render | brand row/stop chips/pay-card opaque ≥0.92 fill, no rounded-fill shadow | component (Platform) |
| T-8 | Payment toggle themed + amounts intact | plan trip, toggle full↔over-time ×3 | accent-themed segments + schedule; amounts/copy = 1130 values unchanged | component+integration |
| T-9 | NULL theme = today's look | brand theme all NULL | dark page, orange accent, default font | component (fails-on-revert anchor for SC-9) |
| T-10 (regression) | Unthemed callers unchanged | `TripPreview`/`TripPaymentChoice` with NO `palette` | byte-identical to `2f84d6b55` snapshot | component |
| T-11 (regression) | Event page unchanged | render `PublicEventPage` before/after extraction | identical palette output + render | package unit + snapshot |
| T-12 | Hook selects + maps theme | mock brand row w/ `theme_*`, event row w/ `theme_*_override` | payload has `brand.theme` + `themeOverride` ThemeInputs; invalid hex dropped | hook unit |
| T-13 | Error surfaces PostgrestError | brands query returns `{code:42501,message:"permission denied"}` | error state shows that message, not generic | route |
| T-14 | No fabricated fields | trip missing departure/capacity/itinerary | those rows/sections omitted; no fake seats-left | component |
| T-15 | Floating-bar surface follows theme | light brand theme | `surface="light"` passed to `FloatingOfferingBar` | route |
| T-16 (a11y) | Targets + reduced-motion | render w/ reduce-motion on | entrance + height-settle skipped; all tappables ≥44pt | component |

For each SC there is at minimum a happy-path (T-1/4/5/6/8), an error/edge path (T-13/14, T-3 contrast edge), and a fails-on-revert anchor (T-9/T-10/T-11).

---

## 8. Implementation order

1. **Package** — extract/export `createThemePalette` + `ThemePalette` (§4.3); run the event-page snapshot test (T-11) to prove zero behavior change FIRST.
2. **Hook** — `usePublicTripBySlug` select + map theme (§4.2); unit test T-12.
3. **Payment wrap** — add optional `palette` to `TripCheckoutFlow` + `TripPaymentChoice` (§4.6); regression snapshot T-10 for the no-palette path BEFORE adding themed branches.
4. **Component** — rebuild `TripPreview` to Direction A with the `palette ?? DEFAULT_DARK_PALETTE` unified template (§4.4); tests T-1…T-7, T-14, T-16.
5. **Route** — resolve theme/palette/surface, thread into `TripPreview`/strips/payment/bar, skeleton + states, host bg (§4.5); tests T-2, T-8, T-9, T-13, T-15.
6. **Gates** — add the strict-grep gate for `I-PROPOSED-1138-*` (§9); run the full mingla-business jest + web bundle-budget gate (`__common` 2.25MB cap — per memory `reference_biz_web_lucide_shim_and_bundle_budget`); confirm no `lucide` barrel import was introduced.

---

## 9. Regression prevention (fails-on-revert contract)

1. **Event-page parity snapshot (T-11):** a jest snapshot/structural test asserting `createThemePalette(<fixed ResolvedTheme>)` returns the exact `ThemePalette` field values it returns at `2f84d6b55`, AND a `PublicEventPage` render snapshot. MUST PASS after extraction and FAIL if the extraction alters any palette value. (Protects SC-11.)
2. **Unthemed-caller regression (T-10):** a `TripPreview` render test with NO `palette` prop + a `TripPaymentChoice` render test with NO `palette`, snapshotted against the pre-1138 output. MUST FAIL if the redesign leaks themed colors into the default branch (protects the wizard + `/checkout-trip/payment.tsx`). (Protects SC-10 / `I-PROPOSED-1138-PAYMENT-BLOCK-THEME-IS-ADDITIVE`.)
3. **Shared-resolver strict-grep gate** (`scripts/ci/orch-1138-trip-page-uses-shared-theme-resolver.mjs` — name illustrative): asserts (a) `app/t/[brandSlug]/[tripSlug].tsx` imports `resolveTheme` + `createThemePalette` from `@mingla/event-rendering`; (b) `TripPreview.tsx` accepts a `palette` prop and its themed surfaces (eyebrow, spine dots, brand-chip CTA, inclusion marks) do NOT use `accent.warm` directly. MUST FAIL on revert to the hardcoded-accent version. (Protects `I-PROPOSED-1138-TRIP-PAGE-USES-SHARED-THEME-RESOLVER`.) Each themed surface carries a protective comment: `// ORCH-1138 — themed via createThemePalette (shared event-page engine); do not reintroduce raw accent.warm`.
4. **Hook theme-mapping test (T-12):** asserts the payload carries `brand.theme` + `themeOverride` and that an invalid hex is dropped (validates-then-includes). MUST FAIL if the select/map is reverted.
5. **Contrast test (T-3):** asserts a light brand color yields `primaryText !== "#ffffff"` and an accent with contrast ≥4.5:1 as text on `page` — catches the ORCH-1117 R1 invisible-text regression class.

All five must FAIL when their respective change is reverted and PASS when restored.

---

## 10. Open questions (need Seth before / during IMPLEMENT)

1. **Sold-out signal.** This hook (`usePublicTripBySlug`) sets `pricingTiers[].ticketsRemaining = null` and does NOT compute sold-out (only the buyer-checkout `usePublicTripById` does). Direction A §1.5 specifies a "SOLD OUT" state, but the page has no real signal for it today. **Recommendation:** ship 1138 WITHOUT a sold-out state (omit it — Constitution #9, no fabricated state) and register "wire `pg_public_ticket_types_remaining` into the public trip page sold-out state" as a follow-on ORCH. Confirm, or expand 1138 scope to add the RPC fetch (would touch the hook beyond theming).
2. **Deposit copy + total line** (carried from design §4 Q2, owned by 1130): the schedule shows the total in the subline + implied by rows, not as a discrete line. 1138 keeps 1130's exact copy — confirm no copy change is wanted here.
3. **Long-trip collapse threshold:** SPEC sets collapse at `days.length >= 5` (design §4 Q1 "recommended yes for 5+"). Confirm the threshold, or set a different N.
4. **`RefundPolicyDisplay` theming:** it's a shared re-export shim; SPEC leaves its internals untouched and only re-themes its wrapper card. Confirm we don't need the ladder marks themed to accent (would touch the shared component → wider scope).

---

## 11. Downstream routing

**Next = mingla-implementor (business side).**

NEXT HANDOFF — paste into mingla-implementor (mingla-business / packages/event-rendering):

Implement ORCH-1138 [public trip page visual redesign + brand-theming parity] from this SPEC. Goal: bring `/t/{brandSlug}/{tripSlug}` (anon web + business iOS/Android RN) to Direction-A "Immersive Itinerary" brand-theming parity with the public event page, wrapping (not respecing) the already-merged ORCH-1130 payment block. Inputs: this SPEC (`Mingla_Artifacts/specs/SPEC_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md`), the approved design (`Mingla_Artifacts/design/ORCH-1138/DIRECTION_A_IMMERSIVE_ITINERARY.html` + `DESIGN_…md` in the anchor checkout), ORCH-ID 1138, worktree `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`. Hard constraints: NO migration/view/RLS change (theme columns already exist + anon-granted); export `createThemePalette` from `@mingla/event-rendering` as a pure refactor with ZERO event-page behavior change; theme is an ADDITIVE optional `palette` prop on `TripPreview`/`TripCheckoutFlow`/`TripPaymentChoice` so the wizard Step 5 + `/checkout-trip/payment.tsx` callers render byte-identical; honor the allowlist + DO-NOT-TOUCH below; rebase onto origin/main first; prove fails-on-revert on all 5 §9 safeguards; run mingla-business jest + the `__common` 2.25MB web bundle-budget gate. Resolve Open Questions §10 with Seth before shipping the sold-out state. Expected output: working code + implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md` in the worktree. Then → mingla-tester (web + business iOS + business Android, incl. Android opaque-glass + light-theme contrast + unthemed-caller regression) → orchestrator CLOSE (flip the two `I-PROPOSED-1138-*` invariants ACTIVE).

---

## Scoped allowlist (implementor MAY change ONLY these)

- `packages/event-rendering/PublicEventPage.tsx` (extract `createThemePalette` — no render change)
- `packages/event-rendering/index.ts` (export `createThemePalette` + `ThemePalette`)
- `packages/event-rendering/themePalette.ts` (NEW, if using the move-to-new-file option)
- `mingla-business/src/hooks/usePublicTripBySlug.ts` (select + map theme; payload shape)
- `mingla-business/src/components/trip/TripPreview.tsx` (the Direction-A redesign + optional palette/theme props)
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (resolve theme/palette/surface; thread down; skeleton + state theming; host bg)
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (forward optional `palette`)
- `mingla-business/src/components/trip/TripPaymentChoice.tsx` (optional `palette` theming — additive)
- NEW test files + NEW `scripts/ci/orch-1138-*.mjs` strict-grep gate
- `Mingla_Artifacts/` reports/spec under the worktree

## DO-NOT-TOUCH (stop-and-amend before any change here)

- Any `supabase/migrations/**`, any view, RLS, or DB constraint (NO schema change — §0/§4.1).
- `installmentScheduleProjection.ts`, `InstallmentScheduleDisplay.tsx`, the 1130 `plan` route param, and any 1130 amount/copy/IA logic.
- `mingla-business/src/services/tripsService.ts` `Trip` type (keep theme on the payload, not on `Trip`).
- `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` and `TripCreatorStep5Review.tsx`/`TripCreatorWizard.tsx`/`ExperiencePreview.tsx` (they consume `TripPreview`/`TripPaymentChoice` with no palette — must render unchanged; do not pass them a palette).
- `FloatingOfferingBar.tsx` (use its existing `surface` prop; do NOT add a themed bar accent — parity boundary).
- The event-page render output (`createThemePalette` extraction must be behavior-neutral).
- `app-mobile/**` (consumer surface — out of scope).
- The COMMS ledger / World Map / other global registries (orchestrator owns at CLOSE).
