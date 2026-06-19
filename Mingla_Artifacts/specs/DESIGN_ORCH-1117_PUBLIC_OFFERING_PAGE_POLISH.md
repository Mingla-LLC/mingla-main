# DESIGN — ORCH-1117 · Public Offering Page UX/Design Polish

**Status:** DESIGN complete (pixel-precise, build-ready)
**Author:** mingla-designer
**Date:** 2026-06-11
**Owner phase next:** orchestrator → forensics SPEC embed → implementor

---

## 0. Scope, surfaces, and the architecture truth

Four polish changes on the **public / buyer-facing offering view**, with full cross-surface parity:

| # | Change | Where the problem actually lives |
|---|--------|----------------------------------|
| 1 | White-theme legibility (date renders white-on-white) | **Event WEB only** (theme-color drives the page surface). Trips/exp/consumer are fixed-dark surfaces — preventive rule only. |
| 2 | Collapsible About (collapsed by default) | Event web + Trip web + Experience web are always-expanded. Consumer already has a partial pattern (3-line clamp) — upgrade to collapsed-by-default. |
| 3 | Floating Buy CTA at base of page | **No surface has one today.** New component, every surface. Bookable + Unavailable states. |
| 4 | Reduce title drop-shadow | **Event WEB only** has a heavy text shadow. Trip/exp/consumer titles have none — preventive rule only. |

### The six concrete surfaces

| Key | File | Surface model |
|-----|------|---------------|
| **EVT-WEB** | `packages/event-rendering/PublicEventPage.tsx` (rendered by `mingla-business/src/components/event/PublicEventPage.tsx` adapter) | **Theme-color-driven.** `createThemePalette()` builds a light OR dark page from the brand/event accent. This is the ONLY surface where the page background can be near-white. |
| **TRIP-WEB** | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` → `TripPreview.tsx` + `TripCheckoutFlow.tsx` | Fixed-dark (`#0c0e12`), white text, fixed orange accent `#eb7825`. |
| **EXP-WEB** | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` → `ExperiencePreview.tsx` + `ExperienceCheckoutFlow.tsx` | Fixed-dark, same as trip. |
| **EVT-NATIVE** | `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` (host: `ExpandedCardModal`, gorhom bottom sheet) | Fixed-dark (`#0c0e12`), white text, `colors.primary` accent. |
| **TRIP-NATIVE** | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | Fixed-dark. |
| **EXP-NATIVE** | consumer experience detail (rendered via the shared `@mingla/event-rendering` `PublicEventPage` hosted in the sheet, per ORCH-1072) | **Theme-color-driven** when hosted via the shared package — inherits EVT-WEB's palette logic. |

> **Load-bearing architecture fact:** EVT-WEB and EXP-NATIVE both render through `packages/event-rendering/PublicEventPage.tsx`. Fixing change #1 and #4 in that ONE file fixes both the web event page AND the in-app experience detail that is hosted on it. The trip/exp WEB preview components and the native `EventDetailLayout` are separate dark-surface components and only need changes #2 and #3.

---

## 1. CHANGE #1 — White-theme legibility (luminance-safe theme text)

### 1.1 Current state (cite)

`packages/event-rendering/PublicEventPage.tsx`:

- **L582–587** — the date line is **hardcoded `color: "#ffffff"`**:
  ```
  styles.dateLine, { color: "#ffffff", fontFamily: theme.fontFamilyValue }
  ```
- **L616–618** — the recurrence/“Show all” pill label is **hardcoded `color: "#ffffff"`**.
- **L185–225** — `createThemePalette()` ALREADY computes a luminance-aware `page` (light base `#f8fafc` when the accent is light), `primaryText` (`readableTextFor(page)` → `#000000` on a light page), `secondaryText`, `accent` (contrast-adjusted), and `accentWash`. The date line and pill simply **ignore this palette** and force white.

**Result:** when the resolved theme color is white/near-white, `useDark=false` → `page` is `#f8fafc` (near-white) → the date line and recurrence pill render white text on a near-white card = invisible. Proven by reading `createThemePalette` L190–202: a light accent forces a light page, but the date stays `#ffffff`.

This is the only place hardcoded white survives next to a palette-driven light surface. `titleLine` (L596) correctly uses `palette.primaryText`. The bug is isolated to the date line + its pill.

### 1.2 The design rule (generalized, not a one-off)

**Rule R1 — No raw `#ffffff` / raw theme color on a palette-driven surface.** Every text element on EVT-WEB / EXP-NATIVE that sits on `palette.page`, `palette.card`, `palette.glass`, `palette.panel`, or `palette.accentWash` MUST take its color from the palette’s luminance-aware tokens, never a literal. The palette already guarantees WCAG AA because:

- `primaryText = readableTextFor(page)` → picks `#000000` or `#ffffff` by max contrast (L151–154, L202). On `#f8fafc` this is `#000000` (contrast ≈ 19:1).
- `secondaryText` / `tertiaryText` are the 0.76 / 0.58 alpha of the correct base (L208–215) → ≥4.5:1 for secondary on either page.
- `accent` is `contrastAdjustedAccent(…, page, 3.15)` then `contrastAdjustedForWhiteText(…, 4.5)` (L198–201) → safe as a button fill with white label AND as text on `page`.

**WCAG target:** AA — **≥4.5:1** for the date line (it is small, ≤14px, “normal” text); **≥3:1** is the floor only for ≥18.66px bold large text. We hold the date line to 4.5:1.

### 1.3 The fix (exact)

**Date line (eyebrow above the title).** It is an uppercase eyebrow — it should read as the **accent**, not flat body, to preserve the existing visual emphasis while becoming legible.

- New color: **`palette.accent`** (already AA-safe as text on `page`, ≥4.5:1 via the `contrastAdjustedForWhiteText(…, 4.5)` pass).
- Replace `{ color: "#ffffff" }` at L583 with `{ color: palette.accent }`.
- The component currently only has `theme` in scope at the title block, but `palette` is already computed in `PublishedBody` (L473) — pass it / reference it (it is in the same component scope). No new computation.

**Recurrence pill (`recurrencePill` + `recurrencePillLabel`).** The pill background is `palette.accentWash` (a low-alpha accent over the page). White-on-accentWash fails on a light page.

- Pill label color: **`palette.primaryText`** (AA-safe on `accentWash` because `accentWash` is a thin wash over `page`, so the effective background ≈ `page`, and `primaryText` is `readableTextFor(page)`).
- Replace `{ color: "#ffffff" }` at L617 with `{ color: palette.primaryText }`.
- Keep the pill border `palette.panelBorder` (already palette-driven).

**Generalization sweep (R1 enforcement).** Audit every literal color string inside `PublishedBody` / `PublicTicketRow` styles that is applied to TEXT on a palette surface. As of this read, the only offenders are the two above (the title, brand, venue, about, ticket text already use palette tokens). The implementor MUST add a strict-grep-style guard comment so a future literal can’t regress: any `color: "#ffffff"` / `color: "#fff"` on text inside this file is forbidden unless it sits on a guaranteed-dark fill (e.g. `accentText` on `palette.accent` button — that pairing is intentional and stays).

### 1.4 Token mapping (Change #1)

| Element | Before | After | Contrast on light page `#f8fafc` | Contrast on dark page `#07070a` |
|---------|--------|-------|----------------------------------|----------------------------------|
| Date eyebrow text | `#ffffff` (literal) | `palette.accent` | ≥4.5:1 (palette guarantees) | ≥4.5:1 |
| Recurrence pill label | `#ffffff` (literal) | `palette.primaryText` | ≈19:1 (`#000` on near-white) | ≈18:1 (`#fff` on near-black) |

### 1.5 States

- **Light theme (white/near-white accent):** date = dark-adjusted accent; pill label = `#000000`. Legible. *(This is the bug being fixed.)*
- **Dark theme (saturated/dark accent):** `useDark=true` → `page` near-black → date = light-adjusted accent (still readable, the `contrastAdjustedAccent` floor is 3.15:1 on page); pill label = `#ffffff`. Unchanged visual feel from today.
- **Default Mingla theme (`#eb7825`):** `accentOnDark ≥3`, page dark → identical to today’s shipped look. No visible change for the common case.

### 1.6 Per-surface delta (Change #1)

| Surface | Applies? | Action |
|---------|----------|--------|
| EVT-WEB | YES | The fix above. |
| EXP-NATIVE | YES (same file) | Inherits automatically. |
| TRIP-WEB / EXP-WEB | NO live bug (fixed-dark, white-on-dark date in `metaText` is legible) | **Preventive:** these never apply a per-brand theme color to text on a light surface — they use fixed `accent.warm` orange on `#0c0e12`. No change. If a future change introduces theme-color text on these, R1 applies. |
| EVT-NATIVE / TRIP-NATIVE | NO (fixed-dark) | No change. |

> **Open question OQ-1** (orchestrator): the date line becoming the accent color (vs. `palette.primaryText`) is a deliberate emphasis choice. If you prefer the date to read as quiet metadata rather than accent, use `palette.secondaryText` instead — also AA-safe. Default in this spec = `palette.accent` (keeps the “orange eyebrow” identity the default theme has today).

---

## 2. CHANGE #2 — Collapsible About (collapsed by default)

### 2.1 Current state (cite)

- **EVT-WEB** `PublicEventPage.tsx:856–872` — `About` title + full `aboutBody` text, **always fully expanded**, no toggle.
- **TRIP-WEB** `TripPreview.tsx:164–167` — `description` rendered in full, always.
- **EXP-WEB** `ExperiencePreview.tsx` — description block always expanded (same pattern as trip).
- **EVT-NATIVE** `EventDetailLayout.tsx:330–356` — **already has a partial pattern**: 3-line `numberOfLines` clamp + “Show more/Show less” toggle, but it is **expanded by default for short copy** and uses a 160-char threshold. This is the reference interaction; we standardize it and flip the default to collapsed.

### 2.2 The design — one shared “collapsible section” pattern

**Collapsed affordance (default state):**
- Section header row: the word **About** (existing `sectionTitle` token) on the left, a **chevron** glyph on the right, the WHOLE row is the tap target.
- Below the header: a **peek** of the body — `numberOfLines={3}` clamp with `ellipsizeMode="tail"`, so the buyer sees the first ~3 lines and a trailing ellipsis (signals “there’s more”).
- A text affordance under the peek: **“Read more”** (Mingla voice; not “Show more”) using the accent token.
- Chevron points **down (▾)** when collapsed.

**Expanded state:**
- Full body, no clamp.
- Affordance flips to **“Show less”**, chevron points **up (▴)**.

**Collapse-by-default rule:** the About section starts COLLAPSED on every surface. *Exception:* if the description is short enough to fully fit in the 3-line peek (no truncation), render it expanded with NO toggle (a toggle for 2 lines is noise). Detection: keep the existing EVT-NATIVE heuristic generalized — if `description.length <= 160` chars, render full + no toggle; else collapsed + toggle. (160 chars ≈ 3 lines at 15px/24lh on a 660-max column and on phone width.)

### 2.3 Anatomy + tokens

| Element | Token / value |
|---------|---------------|
| Header row | `flexDirection: row`, `alignItems: center`, `justifyContent: space-between`, min height **44pt** (tap target), `paddingVertical: spacing.xs` |
| “About” label | existing `sectionTitle` (EVT-WEB: 21/26/900; native: 16/600) — unchanged per surface |
| Chevron | SVG icon (NOT emoji): `Icon name="chevron-down"` / rotate 180° for up. Size **20**. Color = `palette.tertiaryText` (web) / `rgba(255,255,255,0.52)` (native). |
| Body peek | EVT-WEB: `aboutBody` (15/24) `numberOfLines={collapsed ? 3 : undefined}`; native: `body` (14/20) same |
| Affordance text | “Read more” / “Show less”, `typography.buttonMd`-weight (600), color = `palette.accent` (web) / `colors.primary` (native). Its own ≥44pt tap target OR fold it into the header tap target (see A11y). |
| Body→affordance gap | `spacing.xs` (4) |
| Section vertical rhythm | unchanged (`marginTop: spacing.lg` web; `section` divider native) |

### 2.4 Motion

| Trigger | Property | Curve | Duration | Notes |
|---------|----------|-------|----------|-------|
| Tap header/affordance | height of body (collapsed 3-line ↔ full) | `easings.inOut` (`cubic-bezier(0.65,0,0.35,1)`) | `durations.normal` = **200ms** | Native: `LayoutAnimation.configureNext` with a 200ms easeInEaseOut, OR Reanimated `withTiming(…, {duration:200})` on a measured height. Web: Framer `animate={{height}}` 0.2s. |
| Chevron rotate | `rotate` 0°→180° | same | **200ms** | Runs with the height. |
| Affordance label crossfade | `opacity` | `easings.inOut` | **120ms** (`durations.fast`) | Optional; label can hard-swap. |

**`prefers-reduced-motion` / reduce-motion fallback:** skip the height + rotate animation — toggle instantly (no animated height). Chevron still flips (static). Required (RN: check `AccessibilityInfo.isReduceMotionEnabled`; web: `prefers-reduced-motion`).

> **Height-animation caution (native, inside a gorhom bottom sheet):** EVT-WEB on app-mobile and EXP-NATIVE render inside `BottomSheetScrollView`. Animating a child’s height inside a virtualized sheet scroll can jump scroll position. Safer native default: **toggle `numberOfLines` between 3 and undefined with `LayoutAnimation.easeInEaseOut(200)`** (cheap, content-driven, no measured-height race). Web can use Framer height animation freely.

### 2.5 Accessibility

- Header row: `accessibilityRole="button"`, `accessibilityState={{ expanded }}`, `accessibilityLabel="About"`, `accessibilityHint={collapsed ? "Expands the description" : "Collapses the description"}`.
- Tap target ≥44×44. Prefer making the **entire header row** the toggle (chevron is decorative `accessibilityElementsHidden`), so the affordance text and header are one target — eliminates a tiny “Read more” hit area.
- Reading order: About header → body → (affordance, if separate).
- Color is never the only indicator: the chevron rotation + the “Read more/Show less” word both signal state (not color alone).

### 2.6 Per-surface delta (Change #2)

| Surface | Component to edit | Default | Collapse engine |
|---------|-------------------|---------|-----------------|
| EVT-WEB | `packages/event-rendering/PublicEventPage.tsx` About block (L856–872) — add `aboutCollapsed` state (default true), wrap in the shared collapsible pattern | collapsed | web: Framer height OR `numberOfLines`; package is RN-primitive, so use `numberOfLines` + `LayoutAnimation` (works on web via RN-web) |
| EXP-NATIVE | same file | collapsed | same |
| TRIP-WEB | `TripPreview.tsx` description block (L164–167) — wrap in collapsible | collapsed | `numberOfLines` + `LayoutAnimation` |
| EXP-WEB | `ExperiencePreview.tsx` description block | collapsed | same |
| EVT-NATIVE | `EventDetailLayout.tsx:330–356` — already has the toggle; **flip default `aboutCollapsed` from current behavior to true** (it is already `useState(true)` at L72 — verify it starts collapsed; standardize copy to “Read more/Show less” and chevron) | collapsed | already `numberOfLines` |
| TRIP-NATIVE | `ConsumerTripDetailScreen.tsx` description | collapsed | same |

> EVT-NATIVE already defaults `aboutCollapsed=true` (L72) and clamps to 3 lines — it is the **reference**. This change brings the other five surfaces up to it and adds the chevron + standardized copy.

---

## 3. CHANGE #3 — Floating Buy-ticket CTA (sticky base bar)

### 3.1 Current state (cite)

No surface has a sticky/floating CTA. Today the buy action is **inline only**:
- EVT-WEB: per-ticket `PublicTicketRow` button (`PublicEventPage.tsx:1047–1081`), label state-machine at L971–982 (`Buy ticket` / `Get free ticket` / `Sold out` / `Join waitlist` / `Pay at the door` / `Sales ended` / `On sale soon` / `Sales paused`).
- TRIP-WEB: `TripCheckoutFlow` Reserve CTA (inline, bottom of scroll).
- EXP-WEB: `ExperienceCheckoutFlow.tsx:123–143` `Get my spot` / `Get my free spot` / `Ended`.
- EVT-NATIVE: `EventDetailLayout.tsx:236–256` `Get Tickets {price}` inline CTA.
- **Unavailable plumbing already exists:** `bookable` flag — EVT-WEB adapter neutralizes buy + shows a banner (`mingla-business/.../PublicEventPage.tsx:373–390`, callback guard L271–291); EXP-WEB swaps the whole checkout flow for an unavailable card (`[experienceSlug].tsx:170–184`). ORCH-1116 owns the `bookable` flag wiring; this design CONSUMES it.

### 3.2 The design — a single floating bar pinned to the page base

A persistent bar that floats above the scroll content, pinned to the bottom edge, visible at all scroll positions. It is the **primary** path; the inline CTA stays as the **detailed** path (see coexistence, §3.6).

**Anatomy (bookable state):**
```
┌───────────────────────────────────────────────┐
│  From £25            [  Buy ticket  →  ]        │   ← floating bar
└───────────────────────────────────────────────┘
   price block (left)        action button (right)
```
- **Left:** price block. Line 1 = `From {price}` in the brand’s currency (label “From” when multiple tiers / a starting price; just `{price}` if single tier). Line 2 (optional, micro) = the offering-specific qualifier (“per person”, “all-in”). Uses the **server-computed all-in price** already in the data (`priceAllInGbp`/`priceCents` — never recompute fees; per the WYSIWYP memory rule).
- **Right:** the action button. Label = the offering verb: **Buy ticket** (event paid), **Get free ticket** (event free), **Reserve my spot** (trip), **Get my spot** (experience). Trailing chevron/arrow optional.

**Anatomy (NOT-bookable / unavailable state) — Constitution #1, no dead taps:**
```
┌───────────────────────────────────────────────┐
│  ⓘ Booking unavailable                          │
│     Organizer is finishing payment setup        │   ← non-interactive, NOT a button
└───────────────────────────────────────────────┘
```
- The bar becomes an **informational strip**, NOT a button. `accessibilityRole` is NOT "button"; it does not call any checkout. No `onPress` that dead-ends.
- Title: “Booking unavailable” (matches the existing banner copy). Subline (micro): “The organizer is finishing payment setup.”
- Same applies to other non-buyable states surfaced today inline (Sold out, Sales ended, On sale soon, Pay at the door): the floating bar mirrors the **inline state-machine label** but as a **disabled, non-tappable** strip with the reason — never a live Buy button.

### 3.3 Placement, safe-area, elevation, glass

| Property | Value |
|----------|-------|
| Position | `position: absolute`, `left: 0`, `right: 0`, `bottom: 0`, above the scroll (`zIndex: 6` — above toast `5`, banner `5`, chrome `3/4`) |
| Bar inner padding | `paddingHorizontal: spacing.md` (16), `paddingTop: spacing.md` (16) |
| Bottom safe-area | `paddingBottom: insets.bottom + spacing.sm` (iOS home indicator); web: `paddingBottom: spacing.md` (16). Use `useSafeAreaInsets()`. |
| Max content width | inner content `maxWidth: 660`, `alignSelf: center` (matches the body column on web; full-bleed bar background, centered content) |
| Height | content-driven; min button height **56** (matches existing `cta`/`ticketBuyerBtn` 56–58) |
| Top edge | a `1px` hairline top border `palette.panelBorder` (web) / `rgba(255,255,255,0.12)` (native dark) to separate from scroll content |
| Scroll spacer | add `paddingBottom` to the scroll content = bar height + safe area (≈ **96 + insets.bottom**) so the last inline element is never hidden under the bar (EVT-WEB `scrollContent` currently `spacing.xl*2` = 64 — increase). |

**Background / glass — Android opaque-fallback policy (HARD constraint):**

| Platform | Bar background fill |
|----------|---------------------|
| **iOS** | translucent glass: `GlassBlur` (intensity 28–34) + fill `palette.panelStrong` (light page: `rgba(255,255,255,0.92)`; dark page: `rgba(255,255,255,0.11)` over the dark base) — the existing `panelStrong` token. `overflow: 'hidden'` to clip. |
| **Android** | **opaque ≥0.92 frosted fill via `Platform.select`**: a SOLID composited color, no rgba transparency. On the dark surface use **`#16181b`** (the established `ariBubbleAndroid` opaque value) or composite `palette.page` to a solid; on a light EVT-WEB page use a solid near-white `#f4f6f9`. `overflow: 'hidden'`, **NO Android shadow** under the rounded/edge fill. |
| **Web** | solid/blur acceptable; use `palette.panelStrong` with a backdrop-blur and the hairline top border. No transparency that lets text bleed through. |

> This satisfies `ANDROID_GLASS_USES_OPAQUE_FALLBACK`: iOS keeps the real blur; Android gets an opaque ≥0.92 solid fill, clipped, shadow-suppressed. The bar MUST be readable — a buyer must never see scroll text ghosting through the price.

**Elevation:** iOS/web `shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset:{0,-8}` (upward shadow, lifts off content). Android: **no shadow** (opaque fill rule) — rely on the hairline top border for separation.

### 3.4 Tokens (Change #3)

| Element | Token / value |
|---------|---------------|
| Bar fill (iOS dark) | `palette.panelStrong` + GlassBlur 28 |
| Bar fill (Android dark) | `#16181b` (opaque) |
| Bar fill (light page, iOS/web) | `palette.panelStrong` (`rgba(255,255,255,0.92)`) |
| Bar fill (light page, Android) | `#f4f6f9` (opaque) |
| Top border | `palette.panelBorder` (web/iOS) / `rgba(255,255,255,0.12)` (native dark) |
| Price label “From” | `typography.micro` (11/14/600) uppercase, color `palette.tertiaryText` |
| Price value | `typography.h3`-ish: 18–20, weight 900, color `palette.primaryText` |
| Button (bookable) | reuse `ticketBuyerBtn`: `backgroundColor: palette.accent`, `borderColor: palette.accentText`, min height 56, radius `radius.lg`, label `palette.accentText` (white) 17/900. **Press:** `opacity: 0.85` or scale 0.98 + Light haptic (native). |
| Strip (unavailable) | fill `palette.panel` (quieter than panelStrong), no accent; icon `ⓘ` (SVG `Icon name="info"`) color `palette.tertiaryText`; title `palette.secondaryText` 14/700; subline `palette.tertiaryText` 12/500. NOT a button. |
| Button gap from price | `spacing.md` (16) |

### 3.5 States (Change #3 — full matrix)

| State | Trigger | Bar appearance | Tappable? |
|-------|---------|----------------|-----------|
| **bookable / paid** | `bookable===true`, published, on sale | price + accent “Buy ticket” button | YES → existing checkout |
| **bookable / free** | free ticket | price = “Free”, button “Get free ticket” | YES → claim flow |
| **bookable / trip** | trip published | “From {price}” + “Reserve my spot” | YES |
| **bookable / experience** | exp published | “From {price}” + “Get my spot” | YES |
| **unavailable (not bookable)** | `bookable===false` (ORCH-1116) | info strip “Booking unavailable / organizer finishing payment setup” | NO (non-button) |
| **sold out** | all tiers capacity 0, no waitlist | strip “Sold out” (quiet) | NO |
| **sold out + waitlist** | capacity 0, waitlist on | button “Join waitlist” (accent) | YES → waitlist sheet |
| **sales ended / past** | event ended / all dates past | strip “Sales ended” | NO |
| **pre-sale** | all tiers `saleStartAt` future | strip “On sale {countdown}” | NO |
| **door only** | all tiers `availableAt==='door'` | strip “Pay at the door” | NO |
| **loading** | data fetching | bar hidden OR skeleton: a `palette.panel` bar with a shimmer pill where the button is, no label | NO |
| **pressed** (button states) | press-in | `opacity 0.85` / scale 0.98, Light haptic (native) | — |

> The floating-bar state is a **pure projection of the same state-machine** already in `PublicTicketRow` (L971–990) and the page-level banners. The implementor MUST derive it from the SAME computed variant + `bookable`, not a parallel copy — single source of truth (forensics: hoist the variant/label computation so both inline and floating consume it).

### 3.6 Coexistence with the inline CTA — **DECISION + open question**

**Design recommendation (default):** **KEEP BOTH.**
- The floating bar is the always-reachable primary action (thumb-zone, no scroll required).
- The inline CTA(s) stay because:
  - EVT-WEB has **per-ticket** rows — the floating bar can only represent “buy the cheapest / open the ticket list”; the inline rows are where the buyer picks a specific tier / sees per-tier price, capacity, description. Removing them breaks multi-tier events.
  - Trip/exp are single-ticket — there the floating bar and the inline CTA are redundant, so on those surfaces the floating bar can REPLACE the inline CTA (or the inline becomes a quiet “details” affordance).
- **Behavior when both exist:** tapping the floating bar on a **multi-tier** event scrolls to / opens the Tickets section (or opens the cheapest tier) rather than blind-buying. On **single-ticket** trip/exp it goes straight to checkout (same as inline).

> **Open question OQ-2 (orchestrator / Seth — product call):**
> 1. On **multi-tier events**, should the floating “Buy ticket” (a) scroll to the Tickets section, (b) open the cheapest tier’s checkout, or (c) open a tier-picker sheet? Default in this spec = **(a) smooth-scroll to Tickets** (no dead-buy of an unintended tier).
> 2. On **single-ticket trip/exp**, should the inline Reserve/Get-spot CTA be **removed** (floating replaces it) or **kept** (redundant but reassuring)? Default = **keep inline, but de-emphasize** (the floating bar is the loud one). Seth may prefer remove-inline for cleanliness.

### 3.7 Motion (Change #3)

| Trigger | Property | Curve | Duration | Fallback |
|---------|----------|-------|----------|----------|
| Bar mount (page load) | `translateY` 100%→0 + `opacity` 0→1 | `easings.out` (`cubic-bezier(0.33,1,0.68,1)`) | `durations.entry` = **260ms** | reduced-motion: appear instantly (no slide) |
| State change (bookable↔unavailable, label swap) | crossfade `opacity` | `easings.inOut` | **120ms** | hard swap |
| Button press | scale 0.98 / opacity 0.85 + Light haptic (native) | `easings.press` | **80ms** | no haptic if unavailable |

> No hide-on-scroll-down behavior by default (the bar is the primary action; hiding it costs conversions). If Seth wants auto-hide on scroll, that’s a future enhancement — out of scope here.

### 3.8 Accessibility (Change #3)

- Bookable button: `accessibilityRole="button"`, `accessibilityLabel` = full action + price (“Buy ticket, from £25”), `accessibilityState={{disabled:false}}`, min 56pt height ≥44.
- Unavailable strip: `accessibilityRole="text"` (or `summary`), `accessibilityLabel="Booking unavailable. The organizer is finishing payment setup."` — explicitly **not** a button so screen-reader users aren’t told to “double-tap to activate” a dead control.
- The bar must not trap focus or block the scroll content beneath when content is short — `pointerEvents="box-none"` on the wrapper, `auto` on the bar itself.
- Color-independent state: every non-bookable state carries a **word** (“Sold out”, “Sales ended”, “Booking unavailable”) + an icon, never color alone.

### 3.9 Per-surface delta (Change #3)

| Surface | Where bar mounts | Inline CTA fate | Currency source |
|---------|------------------|-----------------|-----------------|
| EVT-WEB | adapter `mingla-business/.../PublicEventPage.tsx` (sibling of `SharedPublicEventPage`, above toast) — OR inside the package with a `floatingCta` prop. Recommend **package prop** so EXP-NATIVE inherits. | keep per-ticket rows; floating scrolls to Tickets (OQ-2) | `event.currency` + `priceAllInGbp` |
| EXP-NATIVE | inherits package floating bar | n/a (sheet) | same |
| TRIP-WEB | `[tripSlug].tsx` sibling of ScrollView, absolute bottom | replace/de-emphasize inline Reserve | `tier.currency`/`priceCents` |
| EXP-WEB | `[experienceSlug].tsx` sibling of ScrollView | replace/de-emphasize inline Get-spot | `ticket.currency`/`priceCents` |
| EVT-NATIVE | `ExpandedCardModal` host renders bar pinned to sheet bottom (NOT inside the scrolling `EventDetailLayout`) | keep inline Get Tickets | `accountPreferences.currency` (existing) |
| TRIP-NATIVE | sheet/screen bottom | keep inline | account currency |

> **Native sheet caveat:** EVT-NATIVE / EXP-NATIVE render inside a gorhom bottom sheet. The floating bar must be pinned to the **sheet’s** bottom (a sibling of `BottomSheetScrollView`, inside the sheet, respecting `insets.bottom`), NOT the OS window bottom — otherwise it floats over the wrong layer. Forensics to confirm the sheet host exposes a footer slot (`BottomSheetFooter` from gorhom is the correct primitive).

---

## 4. CHANGE #4 — Reduce title drop-shadow

### 4.1 Current state (cite)

`packages/event-rendering/PublicEventPage.tsx:1343–1352` (`titleLine`):
```
fontSize: 36, lineHeight: 41, fontWeight: "900",
textShadowColor: "rgba(0,0,0,0.28)",
textShadowOffset: { width: 0, height: 2 },
textShadowRadius: 10,
```
This heavy `0,2 / radius 10 / 28%-black` shadow reads as “dirty/smudged”, especially on a light theme page where the title is dark — a dark shadow under dark text on a near-white card is muddy. The title sits **inside the body card** (`palette.page`), NOT over the cover media, so the shadow isn’t even doing legibility work here.

Other surfaces (TRIP-WEB `TripPreview.title` L267–272, EXP `title`, EVT-NATIVE `title` L473–479) have **no text shadow** — they’re already clean. So change #4 is essentially EVT-WEB/EXP-NATIVE only.

### 4.2 The design — remove the shadow on solid surfaces; subtle scrim only over media

**Rule R4 — Title text shadow is removed when the title sits on a solid/opaque surface; replaced by a scrim/gradient when (and only when) the title overlays cover media.**

In the current layout, the EVT-WEB title is **inside the body card** (solid `palette.page`), so:

- **Remove the text shadow entirely** on `titleLine`. The body card already provides contrast (`primaryText` is AA-safe on `page`). No shadow needed.

If a future layout ever places the title **over the cover media** (it does not today), use a **bottom-up gradient scrim** on the hero (the hero already has `heroOverlay` `rgba(0,0,0,0.32)` at L1227–1234 + EVT-NATIVE has a `LinearGradient` to `rgba(12,14,18,0.95)` at L197–201) — lean on THAT scrim for legibility, not a per-glyph text shadow. A scrim is cleaner than a text shadow because it’s uniform, not smudged per letter.

### 4.3 Before → after tokens (Change #4)

| Property | Before | After |
|----------|--------|-------|
| `titleLine.textShadowColor` | `rgba(0,0,0,0.28)` | **removed** |
| `titleLine.textShadowOffset` | `{0, 2}` | **removed** |
| `titleLine.textShadowRadius` | `10` | **removed** |
| (optional, if any over-media title ever appears) | — | rely on existing hero scrim; if a hairline is wanted for safety, max `textShadowColor: rgba(0,0,0,0.18), offset {0,1}, radius 3` — a *whisper*, not a smudge |
| `fontSize/lineHeight/fontWeight` | 36/41/900 | **unchanged** |

> The “whisper” fallback (`0.18 / 0,1 / radius 3`) is ONLY if testing reveals a real over-media legibility gap on some theme. Default = full removal. This is the “cleaner/flatter” feel Seth asked for.

### 4.4 States / surfaces (Change #4)

| Surface | Title context today | Action |
|---------|---------------------|--------|
| EVT-WEB | inside solid body card | **remove shadow** |
| EXP-NATIVE | same file, same card | inherits removal |
| TRIP-WEB / EXP-WEB | solid body, no shadow today | none (already clean) |
| EVT-NATIVE | solid body, no shadow today (`title` L473) | none; verify no shadow creeps in |
| TRIP-NATIVE | solid body | none |

No motion. No a11y change (removing a shadow only improves contrast clarity; AA still met by `primaryText` on `page`).

---

## 5. Consolidated per-surface implementation matrix

| Change | EVT-WEB (`packages/.../PublicEventPage.tsx`) | EXP-NATIVE (same pkg) | TRIP-WEB (`TripPreview`) | EXP-WEB (`ExperiencePreview`) | EVT-NATIVE (`EventDetailLayout`) | TRIP-NATIVE (`ConsumerTripDetailScreen`) |
|--------|---|---|---|---|---|---|
| #1 White-theme legibility | **date→`palette.accent`; pill→`palette.primaryText`** | inherits | n/a (fixed-dark) | n/a | n/a | n/a |
| #2 Collapsible About | new collapsed-by-default toggle | inherits | wrap description | wrap description | flip default true + chevron/copy | wrap description |
| #3 Floating Buy CTA | package `floatingCta` prop, all states + `bookable` | inherits (sheet footer) | absolute bottom bar | absolute bottom bar | sheet footer bar | sheet/screen bottom bar |
| #4 Title shadow | **remove `textShadow*`** | inherits | none | none | none | none |
| Android glass | bar: opaque `#16181b`/`#f4f6f9`, clip, no shadow | same | same | same | same | same |

---

## 6. Build-ready handoff

- **New tokens needed:** none. Everything resolves to existing tokens: `palette.accent`, `palette.primaryText`, `palette.secondaryText`, `palette.tertiaryText`, `palette.panel`, `palette.panelStrong`, `palette.panelBorder`, `palette.accentText`, `spacing.*`, `radius.lg`, `typography.micro/h3/buttonMd`, `durations.entry/normal/fast/instant`, `easings.out/inOut/press`, `semantic.*`. New literal `#16181b` (Android-opaque dark bar) and `#f4f6f9` (Android-opaque light bar) reuse the established `ariThread.ariBubbleAndroid` value and a near-white sibling — propose adding `floatingBarAndroidDark: "#16181b"` / `floatingBarAndroidLight: "#f4f6f9"` to the package `designTokens.ts` for clarity.
- **Primitives:** RN `Pressable`, `View`, `Text`, `Icon` (SVG chevron/info — NO emoji), `GlassBlur` (existing in package), `useSafeAreaInsets`, `LayoutAnimation` / Reanimated `withTiming`, gorhom `BottomSheetFooter` (native sheet surfaces), Framer Motion (web-only height/translateY if preferred over RN-web LayoutAnimation).
- **Single-source-of-truth requirement:** hoist the buy/unavailable **state-machine** (label + tappability + reason) so the inline CTA AND the floating bar both consume it. Do not fork the logic.
- **No-dead-tap requirement (Constitution #1):** the floating bar in every non-bookable state is a non-button info strip — runtime dead-tap proof required at TEST (the memory rule “interactive elements must fire — runtime proof”).
- **CI guard to add:** strict-grep forbidding `color: "#fff"`/`"#ffffff"` literals on text inside `packages/event-rendering/PublicEventPage.tsx` except the intentional `accentText`-on-`accent`-button pairing (R1 regression guard).

---

## 7. Open questions for the orchestrator

- **OQ-1 (Change #1, low stakes):** date eyebrow color = `palette.accent` (emphasis, default) vs `palette.secondaryText` (quiet metadata). Both AA-safe. Default chosen = accent.
- **OQ-2 (Change #3, PRODUCT — needs Seth):** (a) multi-tier event floating “Buy ticket” → scroll-to-Tickets (default) vs open-cheapest vs tier-picker sheet; (b) single-ticket trip/exp → keep inline CTA (default) vs remove it so the floating bar is the only CTA. This is the one decision that materially changes the layout.
- **OQ-3 (Change #3, native):** confirm the gorhom sheet host on EVT-NATIVE / EXP-NATIVE exposes a `BottomSheetFooter` slot for the pinned bar (forensics to verify during SPEC; if not, the bar pins to the screen and the sheet’s detents must account for it).
- **OQ-4 (cross-cutting):** ORCH-1116 owns the `bookable` flag. This design assumes `bookable` is available on every offering payload (event already has it; experience already has it; **trip** — confirm `bookable` is threaded to the public trip payload, else the floating-bar unavailable state can’t render on TRIP-WEB).
