# DESIGN — META-ORCH-1255 [multi-venue first-class creation] — venue surfaces pixel spec

**Phase:** DESIGN (consumed by the forensics SPEC; the implementor builds from the SPEC that embeds this)
**Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on `orch-1255-venue-first-class-multi`
**Date:** 2026-07-01
**Inputs:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md` (F-9…F-13 insertion points), live design system read at file:line below.
**Voice:** Mingla canonical — warm, plain, zero jargon. **No fabricated data anywhere: missing data HIDES its element, never fakes it.**

---

## 0. Cross-surface declaration (5 + 2)

| # | Surface | Touched? | What |
|---|---------|----------|------|
| 1 | Business iOS | YES | Creator-sheet 4th row, venue card list, per-venue management page, brand-edit removal |
| 2 | Business Android | YES | Same as iOS with opaque-glass deltas (§8) |
| 3 | Business web-preview (phone-width web) | YES | Same as phone layouts; web press/hover deltas (§8) |
| 4 | Business desktop web (≥1024) | YES | Card list = 4-column grid (contract #7); management page keeps VenueSuiteShell's two-column rail; sheet unchanged |
| 5 | Buyer/anon web | YES | New per-venue public page under the brand (§6) |
| +1 | Admin web (mingla-admin) | NO — byte-identical | Queue stays brand-row keyed; no design change in this ORCH |
| +2 | Consumer app (app-mobile) | NO — byte-identical | Deck already per-place; no UI change |

Desktop-web 16 contracts honored: all changes gate through `useResponsiveLayout()` (contract 1), grid = `DESKTOP_HUB_GRID_COLUMNS` (contract 7, `src/constants/desktopLayout.ts:28`), no mobile regressions (contract 2), `venueSuiteStore` pill-row bridge preserved (LOCKED DECISION 5 — §5.4).

Token provenance used throughout (single source): `mingla-business/src/constants/designSystem.ts` — `spacing` (:29), `radius` (:39), `semantic` (:298), `text` (:309), `glass` (:270), `accent` (:179), `typography` (:345), `durations` (:334), `easings` (:326), `canvas` (:264). Public-page palette comes from `@mingla/offering-rendering` `createThemePalette(resolveTheme(brand.theme))` exactly as `packages/brand-rendering/PublicBrandPage.tsx:292-301` does.

---

## 1. IA & flow (all surfaces)

**The user's moment per surface:**
- **Creator sheet:** operator just tapped "+" with intent to make something. Decision: which of 4 things. Action: one tap → the right flow. Venue is the 4th peer — never gated, never conditional (I-BRAND-UNIVERSAL-AUTHORING).
- **Card list (Hub → Venue tab):** operator wants to know "are my places live, and which one needs me?" Decision: which venue to open. The status chip IS the information hierarchy — it must be readable at a glance without opening anything.
- **Per-venue management:** operator picked ONE venue; everything on screen is scoped to it. The header must keep saying WHICH venue so multi-venue operators never act on the wrong one.
- **Public venue page (anon):** a buyer followed a link. Decision: "do I want to go here / book it?" Everything serves that: photos → what it is → where → when open → what it costs → reserve.
- **Brand edit:** the physical-location question no longer lives here at all — venues are created from the creator sheet. Clean removal, zero replacement.

**Flow map:**
```
"+" TopBar button ──▶ UniversalCreatorSheet (root, 4 rows)
                        └─ "Create venue listing" ──▶ close+push /venue/create   (existing gate→category→wizard→success)
Hub ▸ Venue tab (brand has ≥1 venue listing, any state)
  ├─ loading  → skeleton cards (§4.6)
  ├─ error    → retry card (§4.8)
  ├─ empty    → (tab hidden by gating; empty state exists ONLY for the race where the last venue is removed while mounted, §4.7)
  └─ populated → header row ("Your venues · N" + "+ Add venue") + card list/grid
        └─ card tap ──▶ PUSH per-venue management page (back returns to list)
              └─ VenueSuiteShell scoped to (brandId, placePoolId); header = back + venue name + status chip
Public: /b/{brandSlug} ──"By {brand}" backlink◀── /b/{brandSlug}/v/{venueSlug}   (route final per SPEC)
  ├─ venue live (verified)  → full page (§6)
  ├─ not live / not found   → single not-found state (§6.8 — one state, no leak of "exists but hidden")
  └─ reservable=false       → same page, NO reserve bar (§6.7)
```
Error paths: every fetch failure = honest error card with retry; never a blank pane, never fabricated placeholders.

---

## 2. Surface 1 — Universal Creator Sheet, 4th root option

File: `mingla-business/src/components/ui/UniversalCreatorSheet.tsx`. Append to `ROOT_OPTIONS` (:113-144) AFTER the trip entry. Row markup/styles identical to existing root rows (`styles.row` :462-473) — zero new visual language.

### 2.1 Content
| Field | Value | Why |
|---|---|---|
| `key` | `"venue"` | extends `RootOption.key` union (:93) |
| `iconName` | `"location"` | already in the app icon set (`src/components/ui/Icon.tsx:43`) and already the venue affordance (`BrandEditView` CTA `leadingIcon="location"`). Add `"location"` to the sheet-local `IconName` union (:90). SVG icon set — no emoji. |
| `title` | `Create venue listing` | verb-first, parallel to siblings |
| `subtitle` | `Your place on Mingla — discovered, recommended, bookable.` | canonical voice; parallel "noun — detail" cadence of the 3 siblings; 55 chars = 2 lines max at phone width |
| `route` | `"/venue/create"` | existing close+push path (`pushRoute` :216-227); no step |
| `testID` | `"universal-creator-venue"` | sibling pattern |
| a11y | `accessibilityLabel={title}`, `accessibilityHint={subtitle}` (inherited from the shared row renderer :277-279) | I-39 |

Row anatomy (unchanged, stated for the record): icon wrap 44×44 (`rowIconWrap` :477 — I-38 target met), icon 28 `text.primary`, title `typography.bodyLg` 18/28 w600 `text.primary`, subtitle `typography.bodySm` 14/20 `text.secondary`, trailing `chevR` 20 `text.tertiary`, row padding 16H/16V, radius `radius.lg` 16, bg `glass.tint.profileBase`, hairline border `glass.border.profileBase`, pressed bg `glass.tint.profileElevated`.

### 2.2 Small-device fit — VERDICT: 4 rows do NOT safely fit; fix required
Measured geometry (all from source):
- Compact panel = measured content + `HANDLE_AREA_HEIGHT` 24 (`TopSheet.tsx:970`, `:211`); anchored at `insets.top + 76` (`TOPBAR_OFFSET` :153). **Compact mode has NO viewport clamp and no scroll** (:200-217).
- Root content today at 375pt width: container pad 16+16, header 60 (h3 32 + gap 4 + body 24), gap 16, row = 16+16 pad + (28 title + 2 + 40 two-line subtitle) = **102pt/row**, row gap 8.
- 3 rows: panel ≈ 454pt → bottom edge ≈ 550 on iPhone SE (667pt, top inset 20) — fits.
- **4 rows: panel ≈ 564pt → bottom edge ≈ 660 on SE (7pt from screen bottom, zero scrim), and OVERFLOWS on short-Android (≈640dp usable) and phone-web with browser chrome (visual viewport ≈550-620pt).**

**Fix (both parts are required):**
1. **Root-step row density.** Root rows only (not the event/experience chooser steps): `paddingVertical` 16 → **12** (`spacing.sm + spacing.xs`; no 12 token exists — compose, don't invent one) and subtitle `numberOfLines={2}` (defensive; copy is authored ≤2 lines). Saves 8pt × 4 rows = 32pt → panel ≈ 532pt. Icon wrap stays 44×44 so the touch target still ≥44pt (row min height 68 ≥ 44 — I-38 intact). Visual rhythm check: 12V against 16H reads intentional (matches the `ariThread.cardPad` 12 density family).
2. **Compact clamp + conditional scroll in TopSheet (additive, safety net).** In compact mode clamp `panelHeight = min(measured + 24, screenHeight − panelTop − spacing.xl)` (32pt breathing floor of scrim below the panel) and enable the content area's vertical scroll ONLY when clamped. `fixed-70` behavior untouched; Brand Switcher untouched. This makes compact safe forever (Dynamic Type XXL, future 5th row, short web viewports) instead of re-litigating fit per row.

Dynamic Type: text scales, rows grow, the clamp+scroll absorbs it — never clipped, never overlapping the home indicator.

### 2.3 Motion
None new. Rows use the existing pressed-state color swap (no animation); sheet open/close is TopSheet's existing spring. Reduced motion: TopSheet already honors it.

---

## 3. Status chip — single shared definition (used by §4 card, §5 header)

Source of truth stays `listingStatusView()` (`src/utils/listingStatus.ts:19-87`) fed per-venue. Chip visual = the proven badge in `VenueListingContent.tsx:269-274, 462-472`, extracted as-is into a reusable `ListingStatusChip` (component extraction, zero restyle).

**Anatomy:** pill radius 999, `paddingHorizontal: spacing.sm` (8), `paddingVertical: spacing.xs` (4), row of 8×8 dot (radius 4) + gap `spacing.xs` (4) + label `typography.bodySm` fontSize 14, fontWeight "700", `numberOfLines={1}`. `alignSelf: "flex-start"`.

**Label → tone → colors** (tone maps `TONE_COLOR`/`TONE_TINT`, `VenueListingContent.tsx:59-70`; hex from `designSystem.ts:298-307, 309-315`):

| Label | tone | Dot + text color | Pill bg | Contrast on `canvas.discover` |
|---|---|---|---|---|
| Live on Mingla | success | `semantic.success` #22c55e | `semantic.successTint` rgba(34,197,94,0.18) | 7.4:1 (AA ✓) |
| In review (= deck_eligible OR pending_review — the "pending admin approval" state) | info | `semantic.info` #3b82f6 | `semantic.infoTint` rgba(59,130,246,0.18) | 4.6:1 (AA ✓) |
| Processing | info | #3b82f6 | infoTint | 4.6:1 |
| Draft | neutral | `text.secondary` rgba(255,255,255,0.72) | rgba(255,255,255,0.10) | 10.4:1 |
| No listing yet | neutral | same as Draft | same | — |
| Needs fixes | warning | `semantic.warning` #f59e0b | `semantic.warningTint` rgba(245,158,11,0.18) | 8.6:1 |
| Changes needed (rejected/failed) | warning | #f59e0b | warningTint | 8.6:1 |
| Suspended | warning | #f59e0b | warningTint | 8.6:1 |
| Removed | warning | #f59e0b | warningTint | 8.6:1 |

Color is never the only indicator: the label text always renders (WCAG 1.4.1). a11y: chip is not focusable itself; its text joins the card/header accessibility label ("…, status: Live on Mingla").

---

## 4. Surface 2 — Venue card list (Hub ▸ Venue tab when ≥1 venue exists)

Mount: replaces the direct `VenueSuiteShell` mount in `app/(tabs)/hub/listing.tsx` as the tab's root view. Chrome (TopBar, To-Do, HubSubNav pills) stays layout-owned exactly as today (`hub/_layout.tsx`). While the CARD LIST is showing, the venue module pill row must NOT be active — `venueSuiteStore.activate()` moves from the tab mount to the per-venue page (§5.4), so the Hub offering pills remain over the list. Tab label stays "Venue" (`HubSubNav.tsx:46`; rename to "Venues" is a copy decision the SPEC may take — the pill row auto-sizes either way).

### 4.1 List header row (populated state only)
- Container: `flexDirection: "row"`, `alignItems: "center"`, `justifyContent: "space-between"`, `paddingHorizontal: spacing.md` (16), `paddingTop: spacing.sm` (8), `paddingBottom: spacing.sm`.
- Left: `Your venues` — `typography.h3` (20/32 w600) `text.primary`, plus count ` · N` in `text.tertiary` same size w400. Why: the count is the multi-venue operator's fastest sanity check.
- Right — **"+ Add venue" affordance** (placement decision: header-right, always visible without scrolling; a list-tail affordance disappears below the fold once an operator has 4+ venues): Pressable, height 34 (matches Hub filter-pill geometry `events.tsx` `pill` style), `paddingHorizontal: spacing.md − 2` (14), `borderRadius: radius.full`, bg `accent.tint` rgba(235,120,37,0.28), border 1 `accent.border` rgba(235,120,37,0.55), content = `plus` icon 14 `accent.warm` + gap 6 + label fontSize 13/16 w600 `accent.warm` "Add venue". hitSlop `{top:5,bottom:5}` → 44pt target (I-38, same technique as ORCH-0857). Pressed: opacity 0.7. a11y: role button, label "Add a venue listing". Action: push `/venue/create` (intent already known — do not bounce through the creator sheet).

### 4.2 Card anatomy (VenueListCard — new component, modeled 1:1 on `EventListCard`)
Host (from `EventListCard.tsx:381-397`): `borderRadius: radius.lg` (16), border 1 `glass.border.profileBase`, `overflow: "hidden"`, bg `Platform.select({ ios: glass.tint.profileBase, android: "rgba(20, 22, 26, 0.92)", default: glass.tint.profileBase })` — the exact META-ORCH-1002 opaque-frosted Android fallback; NO Android shadow under the rounded fill (ANDROID_GLASS_USES_OPAQUE_FALLBACK).

Inner layout: `flexDirection: "row"`, `gap: spacing.sm` (8), `padding: spacing.sm` (8), `alignItems: "stretch"`. Left→right:

1. **Cover 76×92** (`COVER_W`/`COVER_H`, `EventListCard.tsx:77-78`), radius `radius.md` 12, `overflow: "hidden"`. Media = the venue's `cover_media_url` (image or video poster) via `EventCoverMedia`. **Fallback when no cover:** `EventCoverMedia` `hue` placeholder, `hue = hashHueFromString(venue name)` — the established no-media treatment app-wide; never a grey box, never a stock photo.
2. **Body column** — `flex: 1`, `minWidth: 0`, `justifyContent: "space-between"`, `paddingRight: 44` (manage-rail clearance, same as events):
   - **Status chip** (§3), `marginBottom: 4`.
   - **Venue name** — `typography.bodyLg` values via the events-card `title` treatment: fontSize 16, w600 (match `EventListCard` title exactly — copy its `title` style token-for-token), `text.primary`, `numberOfLines={1}`.
   - **Address/city line** — fontSize 13/18 `text.secondary`, `numberOfLines={1}`. Content = street address if present, else city, else HIDDEN (no "Address unknown" filler).
   - **Data slot** (ONE line, fontSize 12/16, priority order; first match wins, none → row hidden):
     1. Open admin-feedback count > 0 → `{n} to fix` in `semantic.warning` w600 (the actionable state outranks vanity data).
     2. Menu item count > 0 → `{n} menu items` in `text.tertiary`.
     3. Reservations enabled → `Reservations on` in `text.tertiary`.
     - Never a fabricated stat, never "0 menu items".
3. **Tap affordance** — `chevR` 18 `text.tertiary`, width-28 centered column (events pattern) — the card body must visibly lead somewhere (Constitution #1).

Card min height = 92 cover + 16 padding = 108pt (≥44 target). Whole card is ONE Pressable (role button, label `Open {name}, status: {statusLabel}`); no separate manage rail in v1 (manage actions live inside the venue page — one card, one action, no ambiguity).

### 4.3 States (every one designed)
- **Default** — above.
- **Pressed** — content opacity 0.85 (`cardBodyPressed` parity).
- **Hover (desktop web)** — `cursor: "pointer"` via `Platform.select({ web: … })`; bg lifts to `glass.tint.profileElevated`; NO layout shift.
- **Focus (web)** — visible outline: border color → `accent.border` (keyboard focus only, `:focus-visible` semantics via RNW).
- **Disabled** — none exists (every listed venue is openable in every status; even Removed opens its management page to read why).

### 4.4 Layout per breakpoint
- **Phone (native + web <1024):** single column, `gap: spacing.sm` (8) between cards, list `paddingHorizontal: spacing.md` (16), scroll `paddingBottom: insets.bottom + 120` (the shared BottomNav-clearance pin, `events.tsx` + `venueShellScroll`).
- **Tablet (native):** identical to phone — `useResponsiveLayout` returns `isWideDesktop: false` on native always (`useResponsiveLayout.ts:6`); no invented tablet breakpoint (consistency with every Hub list).
- **Desktop web ≥1024 (`WIDE_DESKTOP_MIN_WIDTH`, `useResponsiveLayout.ts:50`):** 4-column grid — contract #7 — reusing the events pattern verbatim: wrapper `flexDirection:"row", flexWrap:"wrap", marginHorizontal:-spacing.xs`, cell `width: 100/DESKTOP_HUB_GRID_COLUMNS %`, `paddingHorizontal: spacing.xs` (4), `marginBottom: spacing.sm` (8) (`events.tsx` `desktopListGrid`/`desktopListCell`).

### 4.5 Type scale recap
| Element | Token | Size/LH/Weight |
|---|---|---|
| Header title | typography.h3 | 20/32/600 |
| Card name | events-card title parity | 16/22/600 |
| Address line | — (events dateVenue parity) | 13/18/400, text.secondary |
| Data slot | — (events subText parity) | 12/16/400 (600 for "{n} to fix") |
| Chip label | typography.bodySm + w700 | 14/–/700 |

Dynamic Type: all Text scales; card height grows (no fixed heights besides the cover); `numberOfLines` keeps rows honest.

### 4.6 Loading (skeleton)
3 skeleton cards (phone) / 4 (desktop grid row), using the kit `Skeleton` (`src/components/ui/Skeleton.tsx` — 1400ms sweep, reduced-motion renders static base rgba(255,255,255,0.06)). Per card, inside the same host shell: cover block `Skeleton width=76 height=92 radius="md"`; body column gap 8: `Skeleton width=96 height=24 radius="full"` (chip), `Skeleton width="70%" height=16`, `Skeleton width="50%" height=12`. No spinner, no content jumping — skeleton dimensions equal the real card's.

### 4.7 Empty (no venues yet)
Primary rule: the Venue tab only APPEARS with ≥1 venue (new gating predicate replaces `hasPhysicalLocation || hasPlacePool`, F-10) — so the canonical "no venues" surface is the CREATOR SHEET row plus the Home to-do. The in-tab empty state exists for the mounted-while-last-venue-deleted race and deep links:
- `GlassCard variant="elevated" padding={spacing.lg}` (`GlassCard.tsx:53-70` tokens), title `No venues yet` (h3, `text.primary`, marginBottom 4), body `List your place so Mingla can recommend it to people planning to go out — and take bookings when you're ready.` (bodySm, `text.secondary`, marginBottom 16), CTA styled as the events `emptyCta` (padV 8, padH 16, radius.md 12, bg accent.tint, border 1 accent.border, label bodySm w600 accent.warm): `List your venue` → push `/venue/create`. a11y label "List your venue".

### 4.8 Error
`GlassCard variant="base" padding={spacing.lg}`: title `Couldn't load your venues` (body 16 w700 `text.primary`), body `Give it a second and try again.` (bodySm `text.secondary`), `Button label="Try again" variant="secondary" size="md"` → refetch. Never auto-retry-spinner-forever.

### 4.9 Motion
- Card press: color/opacity state change only (matches events cards — no scale theatrics in dense lists).
- List enter: none added (Hub tabs don't animate list entry; consistency > novelty).
- Skeleton→content: cross-fade opacity 0→1, `durations.normal` 200ms, `easings.out`; reduced-motion: instant swap.

---

## 5. Surface 3 — Per-venue listing management entry

### 5.1 Navigation pattern
Card tap → `router.push` to a per-venue page (route shape final in SPEC; carries `brandId` + `placePoolId`), matching how every Hub card opens its detail (events → event page). Back (header chevron / browser back / Android back) returns to the card list with scroll position retained. **Venue switching in v1 = back to the card list only. No dropdown/switcher in the header** — one venue on screen at a time, zero wrong-venue writes.

### 5.2 Page composition
The page mounts the EXISTING `VenueSuiteShell` (`src/components/venue/VenueSuiteShell.tsx`) scoped to the venue (shell + its 7 modules gain venue scoping per SPEC; zero visual redesign of the modules), under a new page header:

**Header row** (pattern: `VenueListingContent.tsx:232-245` page-mode header):
- Container: `flexDirection:"row"`, `alignItems:"center"`, `paddingHorizontal: spacing.md` (16), `paddingTop: insets.top + spacing.sm` (native page context), `paddingBottom: spacing.sm`, `gap: spacing.sm`.
- Back: `ArrowLeft` 22 `text.primary` (lucide, exactly as VenueListingContent), Pressable hitSlop 10 (→ ≥44pt), role button, label "Back to your venues".
- Title block (flex 1, minWidth 0): venue name `typography.h3` 20/32/600 `text.primary` `numberOfLines={1}`.
- Trailing: **status chip** (§3) — right-aligned, `flexShrink: 0`. On very long names the name truncates, the chip never does. a11y reading order: back → name → status.
- No manage kebab in the header (module actions live in the suite's own modules).

### 5.3 Per-breakpoint
- Phone/native: single column; the venue module pill row replaces the Hub pills via the store bridge exactly as today.
- Desktop ≥1024: header row renders above the shell's two-column rail+workspace (`desktopRail` width `venueRailWidth` 220, `designSystem.ts:62`); left-anchored to the same `spacing.md` edge (ORCH-1184 layout preserved verbatim).

### 5.4 Store-bridge contract (LOCKED DECISION 5 — binding)
`venueSuiteStore.activate()/deactivate()` moves from `hub/listing.tsx` (tab mount) to THIS page's mount/unmount. Consequences the implementor must not break: (a) card list showing → Hub offering pills visible; (b) venue page showing on native/web-phone → module pill row swapped in (`hub/_layout.tsx` bridge :285-306 region untouched); (c) page unmount → Hub pills restored. Note: on native the pushed page sits OUTSIDE the hub layout, so the module pill row rendering moves with the shell (the shell's existing inline fallback path covers this — verify at implement time; if the layout bridge can't reach a pushed page, the shell renders its own row, which is the documented fallback in `VenueSuiteShell.tsx:9-15`).

### 5.5 Transition motion
Standard expo-router push (platform default slide on native, instant on web). No custom shared-element in v1 — the suite is heavy; honest instant nav beats a janky hero transition. Reduced-motion: platform handles it.

### 5.6 Deep links
`/brand/{id}/listing[?focus=feedback]` (to-dos, admin pushes — F-12) lands on the CARD LIST when the brand has >1 venue; with exactly 1 venue it may forward straight to that venue's page (SPEC decision); `focus=feedback` continues to ride into the suite's Settings module unchanged.

---

## 6. Surface 4 — Per-venue PUBLIC page (buyer web, anonymous)

Same shell, same theming as `/b/{brandSlug}`: `ParallaxCoverShell` + `createThemePalette(resolveTheme(brand.theme))` + brand theme font via `useThemeFont` (`mingla-business/src/components/brand/PublicBrandPage.tsx:169-174`, `packages/brand-rendering/PublicBrandPage.tsx:292-301`). Page bg `#0c0e12` fallback. Mobile-first single scroll; desktop ≥1024 two-column with sticky panel (brand-page `deskPanel` pattern :598-651). Anon sees ONLY live (verified) venues — everything else is §6.8.

### 6.1 Cover
`ParallaxCoverShell` with `coverMediaUrl` = venue cover (image/video, mute toggle if video — brand-page behavior verbatim). Fallback: hue placeholder, `hue = hashHueFromString(venueSlug)`. Floating chrome: X close (hidden on web per `hideCloseOnWeb`) + Share.

### 6.2 Identity block (first content section)
- Eyebrow: `Verified venue` in `palette.accent` (existing `verifiedBadge` treatment — 12/16 w700, letterSpacing 1.2, uppercase feel per brand page).
- Venue name: brand-page `brandName`/`heroTitle` treatment, themed font, `palette.primaryText`. Desktop overlays name+address on the hero exactly like the brand page (:657-664).
- **Brand attribution:** Pressable row directly under the name — `By {brand.displayName}` — 14/20, "By" in `palette.tertiaryText`, brand name in `palette.accent` w600. Role link, label `View {brand} on Mingla`, → `/b/{brandSlug}`. Target ≥44pt via padV 12. Justification: the venue lives UNDER the brand; the backlink is the IA spine.
- Address line: `palette.tertiaryText` 13/18 (brand-page `brandAddr` parity). Hidden if absent.

### 6.3 About / pitch
Venue pitch (the confirmed AI/sales bio from the venue's public read model) via the brand-page `ClampedBio` pattern (clamp 4 lines, "Read more" toggle, `palette.secondaryText`). Section hidden when absent.

### 6.4 Address + static map
Map block modeled on `PublicEventPage.tsx:678-726` ("Where you'll be"):
- URL via **`buildProxyStaticMapUrl`** → the vendor-neutral `static-map` Supabase edge fn (`packages/offering-rendering/mapboxStaticProxyUrl.ts` — server proxy, NEVER a client key, vendor string never in the client URL). Params: `lat/lng` from the venue row, `accentHex: palette.accent`, `height: 300`.
- Block: bg `palette.card`, radius 16, `overflow:"hidden"`; image `resizeMode:"cover"`, height 220 phone / 300 desktop; name pill overlaid bottom-left (bg `palette.page`, radius full, padH 12 padV 6, text 13 w600 `palette.primaryText`); alt `Map of {venue name}`.
- **Fail-safe (I-PROPOSED-1162-MAP-FAILSAFE-HIDES):** coords missing/non-finite or functions base absent → map HIDDEN entirely; the address card below is the honest fallback.
- Address card (always when address exists): pressable card (bg `palette.card`, border `palette.cutoutBorder`, radius 16, pad 16) → opens the platform maps app/URL; role button, label `Open {name} in maps`. Hidden when no address AND no coords (never an empty shell).

### 6.5 Hours
Data: `BrandHourEntry[]` (`publicEventsService.ts:216` — already in the public venue read model). Card (surface.card), pad 16, radius 16:
- Section label `HOURS` — 12/16 w700 letterSpacing 1.4 `palette.tertiaryText` (the app's `labelCap`/fieldLabel convention).
- 7 day rows: `flexDirection:"row"`, `justifyContent:"space-between"`, padV 6; day 14/20 `palette.secondaryText`, times 14/20 `palette.primaryText` `fontVariant:["tabular-nums"]`; closed day → `Closed` in `palette.tertiaryText`.
- Today's row: day + times w700, 3px accent left-bar (accent, radius.full) inset — today is the buyer's actual question.
- Empty hours array → whole section hidden.

### 6.6 Menu / price tiers + gallery
- **Menu:** reuse the brand page `MenuTab` composition verbatim (`packages/brand-rendering/PublicBrandPage.tsx:1426+`): category sections (name 16 w700 themed, optional desc 13), item rows in a `surface.card` with hairline separators, name 15 w600 / desc 13 / price 15 w700 right column. **Currency-aware:** `formatMenuPrice` with the zero-decimal set (`MENU_ZERO_DECIMAL_CURRENCIES`, :132-146), currency = the item's currency (sourced from brand `default_currency` upstream). Rendered as an in-page section (this page has no tab bar — it is a leaf page, one scroll). Hidden when 0 items.
- **Price tiers** (only when menu is empty AND tiers exist): chip row — `Chill / Comfy / Bougie / Lavish` labels (`VenueListingContent.tsx:72-77` map), chips = radius.full, padH 12 padV 6, bg `palette.card`, text 13 w600 `palette.secondaryText`. Hidden when absent.
- **Gallery:** horizontal `ScrollView` with `snapToInterval`, tiles 240×180 (4:3) radius 12, gap 8, `paddingHorizontal 16`; images from the venue gallery; each `accessibilityLabel="{name} photo {i} of {n}"`. Desktop: same strip (horizontal scroll is fine at 4 visible tiles). Hidden when 0 photos. Lazy-load offscreen images (performance rule).

### 6.7 Reserve affordance — both variants designed
- **Reservable (`pg_venue_reservable_for_place` → `reservable: true`):** sticky bottom reserve bar, `TripReserveBar` float pattern (`packages/offering-rendering/TripReserveBar.tsx:406-422`): full-width bar pinned bottom, bg `palette.page`, `paddingBottom: safeBottom + 8`; CTA pill bg `palette.accent`, minHeight 52, padV 15 padH 26, label 16 w900 `palette.accentText`: **`Reserve a table`**. Left slot: `Free to reserve` or the reservation fee formatted in the venue's currency when a fee exists (16 w900) — fee data comes from the reservable RPC; absent → left slot hidden, CTA centered. CTA destination (web reserve flow vs app handoff) is the SPEC's call — the bar hosts either; if v1 is app-handoff the label stays and the tap opens the Mingla app link. Scroll content gets `contentBottomInset` = bar height + safeBottom so nothing hides behind it (keyboard-never-blocks analog).
- **Non-reservable:** NO bar at all (`reservable:false` or RPC error → fail closed to no bar). Never a disabled dead CTA. `contentBottomInset: 0`.

### 6.8 Not-found / not-live (anon protection)
ONE state for "no such venue", "not live yet", "suspended/removed" — identical output, no information leak. Mirrors `PublicBrandNotFound` verbatim geometry (`src/components/brand/PublicBrandNotFound.tsx:39-100`): centered column on `#0c0e12`, 64×64 glass icon disk (`search` icon 32 `text.tertiary`), title 22 w700 `text.primary` **`This venue isn't on Mingla yet`**, body 14 `text.tertiary` center **`The link may be mistyped, or the venue isn't live right now. Check the URL and try again.`**, CTA `Browse Mingla →` (accent, role button). If the PARENT brand is public, add a secondary text link `See {brand.displayName} →` → `/b/{brandSlug}` (only when the brand itself resolves publicly — otherwise omitted).

### 6.9 Loading / error (route level)
Match `/b/{brandSlug}` route states verbatim (`app/b/[brandSlug]/index.tsx:48-64`): centered `ActivityIndicator` + `Loading venue…`; error → `This venue could not load` + `Refresh this page or try the link again.`

### 6.10 Desktop ≥1024 sticky panel
Right column (brand-page `deskPanel` composition): accent top bar 3px, venue name (20 w700 themed), address, TODAY's hours line (`Open today · 9:00–17:00` — from real hours only, else hidden), `By {brand}` link, Share button (bg `palette.accent`, label w700 `palette.accentText`), reserve CTA duplicated here when reservable (the sticky bottom bar is then suppressed on desktop — one primary CTA per viewport).

### 6.11 SEO/OG (web)
`Head` block parity with the brand page (:265-297): title `{venue} · {city} on Mingla` (city only when present), description from pitch (≤160) else `{venue} — {brand} on Mingla`, og:image = venue cover else brand OG fallback, canonical URL, twitter card `summary_large_image`.

---

## 7. Surface 5 — Brand edit page after toggle removal

`src/components/brand/BrandEditView.tsx` — **clean removal, nothing replaces the block:**
- DELETE the `PHYSICAL LOCATION` `sectionLabel` + `GlassCard` block (lines 501-539: toggle row, sublabel copy, inline "Add your venue" CTA).
- DELETE `handleClaimVenue` (:385-394) and the now-orphaned styles `toggleRow`, `toggleTextCol`, `toggleLabel`, `toggleSub`, `claimCtaRow` (and `claimAffordance` :981 if unreferenced after removal).
- KEEP the `InlineToggle` import — still used by the `displayAttendeeCount` toggle (:426).
- **Spacing correction = automatic:** the ScrollView content uses `gap: spacing.md` (:902-906), so the Photo card now sits exactly 16pt above the `ABOUT` section label with zero manual adjustment. The `sectionLabel`'s own `paddingTop: spacing.sm` (:975) is per-label rhythm and stays. Nothing else moves. Verify visually: Photo card → 16 gap → "ABOUT" (label has its 8pt internal top pad) → fields.
- Do NOT add a replacement card, link, or hint here. Venue creation now lives in the creator sheet (§2) — a second entry point on brand-edit would be decorative duplication.

---

## 8. Per-platform deltas (consolidated)

| Concern | iOS | Android | Web |
|---|---|---|---|
| Card/sheet-row glass | translucent `glass.tint.profileBase` rgba(255,255,255,0.04) | OPAQUE frosted `rgba(20,22,26,0.92)` (cards) / `#23262b` idle · `#2c2f35` pressed (sheet rows — existing `ROW_BG` constants, `UniversalCreatorSheet.tsx:404-418`), `overflow:"hidden"`, NO shadow under rounded fill | translucent (blur supported) |
| Shadows | token values | `elevation: 0` via `androidSafeElevation` (`designSystem.ts:26`) | CSS box-shadow from tokens |
| Press/hover | pressed opacity/color | identical | + `cursor:"pointer"`, hover elevate, `:focus-visible` accent border; hover never shifts layout |
| Card list layout | single column | single column | <1024 single column; ≥1024 four-column (contract 7) |
| Reserve bar | n/a (buyer web page) | n/a | sticky bottom (phone) / sticky right panel CTA (desktop) |
| Colors | hex/rgb/rgba/hsl ONLY — no oklch/lab/color-mix anywhere (RN color rule) | same | same |

---

## 9. Accessibility (binding checklist)

- Every Pressable: `accessibilityRole` + `accessibilityLabel` (I-39); ≥44pt targets everywhere (I-38) — 34pt-tall pills carry `hitSlop {top:5,bottom:5}`.
- Contrast: all text-on-surface pairs listed in §3 pass AA; body text ≥ 13pt on `text.secondary` (10.4:1 on canvas). Public page: themed palettes already AA-audited by the brand-page system; reuse only `palette.*` pairings that exist there.
- Status is text + color, never color alone. Reading order = visual order (chip → name → address → data; back → name → chip).
- Dynamic Type: no fixed text-row heights; sheets clamp+scroll (§2.2); cards grow.
- Reduced motion: skeleton sweep off (built into `Skeleton`), Pill pulse falls to opacity (built-in), cross-fades become instant swaps, TopSheet honors `useReducedMotion`.
- Public page images: every image has `accessibilityLabel`/alt; map image alt `Map of {name}`.
- One-handed: primary actions bottom-anchored (reserve bar); destructive actions none on these surfaces.

---

## 10. Build-ready handoff

**Existing tokens only — ZERO new tokens.** New components: `ListingStatusChip` (extraction of the VenueListingContent badge), `VenueListCard`, `VenueCardList` (tab root), per-venue management page header. Modified: `UniversalCreatorSheet` (4th row + root-row padV 12), `TopSheet` (compact clamp + conditional scroll — additive prop-less behavior), `hub/listing.tsx` (card list root; suite mount moves to the pushed page), `BrandEditView` (deletion only, §7). Public page: new route component composing `ParallaxCoverShell`, `createThemePalette`, `MenuTab` internals, `buildProxyStaticMapUrl`, `PublicBrandNotFound`-pattern 404. RN primitives throughout (`StyleSheet.create`, no CSS-in-JS). Data inputs referenced (per-venue status/claim/counts) are the SPEC's contract to supply — this design consumes `listingStatusView()` inputs per venue and hides any missing slot.

**Regression guards to respect while implementing:** `sanitizeAuthoringError` ≥4 call sites in `VenueCreatorWizard.tsx` (strict-grep), `orch-0885-a-no-bottomnav-on-wide-desktop`, desktop-contract jest suite (`npm run test:orch-0885-a` + `useResponsiveLayout.test.ts`), append-only test gate.

**Justification ledger (why each element exists):** creator row — venue creation must be a first-class peer; chip-first card hierarchy — status is the operator's question; header-right add affordance — always reachable at any list length; back-only venue switching — zero wrong-venue writes in v1; map-through-proxy — key never ships to clients; no-bar-when-not-reservable — no dead taps; single not-found state — no anon information leak; empty brand-edit gap — one entry point, no duplication. Everything not listed above was cut.
