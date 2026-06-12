# DESIGN — ORCH-1121 [Business brand-profile redesign: cover/avatar/about hero + Recent Events list]

- **Surfaces:** Business iOS + Business Android ONLY. Single file: `mingla-business/src/components/brand/BrandProfileView.tsx`.
- **OUT OF SCOPE:** `packages/brand-rendering/PublicBrandPage.tsx` — divergence accepted. Do not touch.
- **Owning skill:** mingla-designer (this doc). Investigation read: `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1121_BRAND_PROFILE_REDESIGN.md`.
- **Token source of truth:** `mingla-business/src/constants/designSystem.ts` (every value below maps to a named token from that file).
- **Components reused (do NOT reinvent):** `GlassCard`, `Avatar` (`size="hero"` = 84×84 circle), `EventCoverMedia` (`@mingla/event-rendering`), `OfferingListCard` + `offeringListCardModel`, `deriveCardStatus`, `Icon`, `Button`, `Pill`.
- **Hooks reused:** `useBusinessEventsForBrand(brand.id)` → `deriveCardStatus` → `OfferingListCard` (mirror `app/(tabs)/hub/events.tsx`).

This doc leads with the **3 cover-hero directions** for Seth to pick from, then the **full pixel
spec for the recommended default**, then the **Recent Events list spec**, then **per-platform deltas,
accessibility, and motion**.

---

## TOKEN QUICK-REFERENCE (used throughout)

```
spacing      xxs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32 · xxl 48
radius       sm 8 · md 12 · lg 16 · xl 24 · xxl 28 · display 40 · full 999
typography   display 32/48·700 · h1 26/32·700 · h2 24/36·700 · h3 20/32·600
             bodyLg 18/28·500 · body 16/24·400 · bodySm 14/20·400
             caption 12/16·500 (ls .2) · micro 11/14·600 (ls .4) · labelCap 12/16·600 (ls 1.4)
text         primary rgba(255,255,255,.96) · secondary .72 · tertiary .52
accent       warm #eb7825 · tint rgba(235,120,37,.28) · border rgba(235,120,37,.55) · glow .35
glass.tint   profileBase rgba(255,255,255,.04) · profileElevated rgba(255,255,255,.06)
glass.border profileBase rgba(255,255,255,.08) · profileElevated rgba(255,255,255,.12)
semantic     success #22c55e · warning #f59e0b · error #ef4444 (+ *Tint .18)
canvas       profile #141113 (the page background behind these cards)
durations    fast 120 · normal 200 · entry 260 · slow 320
easings      out cubic-bezier(.33,1,.68,1) · inOut cubic-bezier(.65,0,.35,1)
```

Android glass opaque fill (kit-consistent, matches `OfferingListCard.host`): **`rgba(20,22,26,0.92)`**
(≥0.92 opacity), with `overflow:'hidden'` and **no** Android shadow under the rounded fill.

---

# PART 1 — COVER HERO: 3 DIRECTIONS (Seth picks one)

All three keep the same DATA (cover media, hue fallback, `coverMediaFailed` flip, avatar `photo`,
`displayName`, `tagline`, `bio`/About, social chips) and all three fix the core defect: **the cover
must stop hard-cropping into a fixed 140px letterbox**. They differ in COMPOSITION and FEEL.

## Direction 1 — "Full-bleed banner" (RECOMMENDED DEFAULT)

> **Pitch:** A taller, edge-to-edge 16:9-ish cover that fills the card top with a bottom scrim, the
> 96px avatar half-overlapping the seam, name/verified/tagline/location centered below on the dark
> glass panel. The familiar profile-hero shape — but generous, legible, and never a thin strip.
>
> **Trade-off:** Spends the most vertical space (cover ~211px on a 375pt screen). Cover is still a
> *fill* (cover-fit), so an extreme portrait upload still center-crops — but at 16:9 the crop reads
> as intentional framing, not a sliver.

```
┌───────────────────────────────────────────┐  GlassCard variant=elevated, padding=0, radius xl(24)
│███████████ COVER (16:9, cover-fit) ███████│  height = round(cardW * 9/16) ≈ 190–211px
│███████████████████████████████████████████│  bottom scrim: linear black 0→.55 over bottom 45%
│███░░░░░░░░░░ scrim gradient ░░░░░░░░░░░░███│
│                  ╭─────╮                   │  avatar 96×96 circle, 3px ring, centered,
│                  │ AVA │   ← half-overlaps │  marginTop -48 (50% over the cover seam)
├──────────────────╰─────╯───────────────────┤
│              Brand Name  ✓verified          │  h2 24/36·700, centered
│                 Tagline line                │  bodySm 14·secondary, centered
│              ◷ City · Country               │  caption·tertiary + pin icon, centered (brand.address)
│                                             │
│  About us paragraph wraps here, left-       │  body 16·secondary, LEFT-aligned, marginTop lg
│  aligned, up to ~3 lines then "more".       │
│                                             │
│   ◉  ◉  ◉  ◉   (social chips, centered)     │  36×36 chips, centered row
└───────────────────────────────────────────┘
```

## Direction 2 — "Aspect-true cover card" (nothing cropped)

> **Pitch:** The cover renders at its OWN aspect ratio inside a rounded media card (via
> `EventCoverMedia onAspectRatio` → clamp 4:5…16:9), so a tall poster shows tall and a wide banner
> shows wide — **zero crop, the whole image is always visible**. Avatar + identity sit in a separate
> glass panel BELOW the cover (no overlap), like a stacked two-card hero.
>
> **Trade-off:** Honors the upload literally, but loses the classic "avatar punched into the banner"
> profile gestalt; tall covers push the identity block far down the screen, and the cover height
> jumps per-brand (less layout predictability). Best when brands upload deliberate poster art.

```
┌───────────────────────────────────────────┐  Card 1: cover, padding=0, radius xl
│                                             │  EventCoverMedia, height = clamp(ratio) → contain-fit
│        COVER at true aspect ratio           │  letterboxed onto hue ONLY if ratio out of clamp band
│        (4:5 … 16:9, never cropped)          │
│                                             │
└───────────────────────────────────────────┘
┌───────────────────────────────────────────┐  Card 2: identity, glass base, padding lg, gap above = md
│ ╭─────╮  Brand Name ✓                       │  avatar 72×72 LEFT, name+meta right (split layout)
│ │ AVA │  Tagline · City                     │
│ ╰─────╯                                     │
│ About us paragraph, left-aligned …          │
│ ◉ ◉ ◉ ◉                                      │
└───────────────────────────────────────────┘
```

## Direction 3 — "Split identity band" (compact, asymmetric)

> **Pitch:** A shorter 3:1 cover ribbon (height ~125px) as a textured backdrop, with the avatar and
> identity LEFT-aligned and overlapping the lower-left corner — an asymmetric, editorial, "header
> bar" feel. Densest of the three; gets the user to the events list fastest.
>
> **Trade-off:** Most compact and modern, but the 3:1 ribbon crops aggressively (closest to today's
> problem) and left-aligned asymmetry is a bigger departure from the current centered hero — higher
> visual-risk if Seth wants it to still feel like a "profile."

```
┌───────────────────────────────────────────┐  cover 3:1 ribbon, height ≈ cardW/3 ≈ 117–125px
│███████ COVER ribbon (3:1, cover) ██████████│  scrim left→right + bottom for text legibility
│░░░░╭─────╮░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
├────│ AVA │──────────────────────────────────┤ avatar 80×80, bottom-left, marginTop -40, marginLeft lg
│    ╰─────╯  Brand Name ✓                     │ name right of avatar, baseline-aligned
│             Tagline · City                   │
│  About us paragraph left-aligned …           │
│  ◉ ◉ ◉ ◉                                      │
└───────────────────────────────────────────┘
```

### Recommendation

**Direction 1 (Full-bleed banner).** It fixes the exact complaint (thin crop) with the least
behavioral risk: it preserves the centered profile gestalt Seth already approved, gives the cover
room to breathe at a predictable 16:9, guarantees legible identity via a baked-in bottom scrim, and
keeps a single clean glass panel. Direction 2 is the "purist" choice if Seth cares most about never
cropping a poster; Direction 3 is the "compact/editorial" choice. The full pixel spec below is
written for **Direction 1**, with **per-direction deltas** called out where they diverge so the
implementor can build whichever Seth selects.

---

# PART 2 — FULL PIXEL SPEC (Direction 1, recommended default)

## 2.1 IA & hierarchy

The user is the brand OWNER looking at their own profile. Their decision priority: *"Is this me, does
it look good, what's my recent activity, what do I manage?"* Hierarchy top→bottom:

1. **Cover** — emotional/brand-identity anchor (largest visual element).
2. **Avatar + Name (+ verified)** — "this is my brand" confirmation. Primary identity.
3. **Tagline + Location** — one-line positioning + place.
4. **About us** — the descriptive paragraph (the brand `bio`).
5. **Social chips** — secondary, scannable, tap-to-open.

The hero is a single `GlassCard variant="elevated" padding={0}` (unchanged wrapper contract — the
`padding={0}` is load-bearing for the edge-to-edge cover). Inside: a **cover region**, then a padded
**body region**.

## 2.2 Layout & spacing grid (4/8pt)

```
GlassCard  variant="elevated"  padding={0}  radius=xl (24)   ← existing wrapper
│
├─ Cover region  (heroCover)
│   height: COVER_H = Math.round(coverWidth * 9 / 16)
│       coverWidth = card inner width (card spans content column; on a 375pt
│       screen with the page's horizontal padding this is ~343pt → COVER_H ≈ 193).
│       Clamp: COVER_H = clamp(176, computed, 240).  Min 176 guarantees the
│       avatar overlap never eats the whole cover; max 240 caps tall screens.
│   borderTopLeftRadius / borderTopRightRadius: radius.xl (24)  ← matches card top
│   overflow: 'hidden'   (clip media + scrim to the rounded top corners)
│   contains, stacked z:
│     (z0) media OR hue fill  → fills the region (see §2.5 three-state)
│     (z1) scrim gradient     → bottom 50% black 0 → 0.55 (legibility insurance)
│
├─ Body region  (heroBody)   paddingHorizontal: spacing.lg (24)
│                            paddingBottom:    spacing.lg (24)
│   │
│   ├─ Avatar row (heroAvatarRow)
│   │     alignItems: 'center'
│   │     marginTop: -48           ← 50% of the 96px avatar overlaps the cover seam
│   │     marginBottom: spacing.sm (8)
│   │     Avatar: 96×96 circle (see §2.4 — UPSIZED from hero 84 → 96 via wrapper)
│   │             ring: 3px solid canvas.profile (#141113) → crisp cutout on any cover
│   │
│   ├─ Name row (heroNameRow)
│   │     flexDirection:'row' · justifyContent:'center' · alignItems:'center' · gap: spacing.xs (4)
│   │     Name text (heroName)   — h2, centered, numberOfLines={2}
│   │     Verified badge          — Icon "check"/"verified" 16, accent.warm, only if brand.verified
│   │     marginTop: 0  (avatar row already spaced)
│   │
│   ├─ Tagline (heroTagline)   — rendered only when brand.tagline non-empty
│   │     bodySm · text.secondary · textAlign:'center' · marginTop: 2
│   │
│   ├─ Location row (heroLocationRow)  — rendered only when brand.address non-empty
│   │     flexDirection:'row' · justifyContent:'center' · alignItems:'center' · gap: 4 · marginTop: 4
│   │     Icon "pin"/"mapPin" 13 · text.tertiary
│   │     Label text (heroLocation) — caption · text.tertiary · numberOfLines={1}
│   │
│   ├─ Divider (heroDivider)  — only when About OR chips follow
│   │     height: StyleSheet.hairlineWidth · backgroundColor: glass.border.profileBase
│   │     marginTop: spacing.md (16) · marginHorizontal: 0
│   │
│   ├─ About us (heroAbout)   — when hasBio
│   │     "About us" eyebrow (heroAboutEyebrow): labelCap · text.tertiary · marginTop: spacing.md (16) · marginBottom: spacing.xs (4)
│   │     Body paragraph (heroAboutBody): body · text.secondary · textAlign:'left'
│   │             numberOfLines={4} collapsed; tap "Read more"/"Show less" to toggle (see §2.6)
│   │   ELSE (no bio)  → empty-bio CTA (heroEmptyBio) — PRESERVE EXISTING behavior:
│   │     dashed accent.border + accent.tint pill → handleEmptyBio → onEdit
│   │     marginTop: spacing.md (16)
│   │
│   └─ Social chips (socialsRow)  — when ≥1 chip (existing IIFE, unchanged logic)
│         flexDirection:'row' · flexWrap:'wrap' · gap: spacing.sm (8)
│         justifyContent: 'center'   ← CHANGED from default (left) to center to match Dir-1
│         marginTop: spacing.md (16)
│         each chip: 36×36 (existing socialChip style — already ≥44? NO, 36 → see A11y §4)
```

**Density rationale:** the hero is a *choosing/identity* moment, not a *comparing* moment → spacious.
Generous cover, centered identity, comfortable line spacing. About-us paragraph is the one
information-dense element (left-aligned for readability; centered body copy hurts multi-line reading).

## 2.3 Type scale (every text element)

| Element | Token | Size/LH/Weight | Color | Align | Lines |
|---|---|---|---|---|---|
| Brand name | `typography.h2` | 24 / 36 / 700, ls −0.2 | `text.primary` (.96) | center | 2 |
| Tagline | `typography.bodySm` | 14 / 20 / 400 | `text.secondary` (.72) | center | 2 |
| Location | `typography.caption` | 12 / 16 / 500, ls .2 | `text.tertiary` (.52) | center | 1 |
| "About us" eyebrow | `typography.labelCap` | 12 / 16 / 600, ls 1.4 (UPPERCASE) | `text.tertiary` | left | 1 |
| About body | `typography.body` | 16 / 24 / 400 | `text.secondary` | left | 4 (toggle) |
| "Read more" link | `typography.caption` | 12 / 16 / 600 | `accent.warm` | left | 1 |
| Empty-bio CTA text | `typography.bodySm` | 14 / 20 / 500 | `accent.warm` | left | — |

**Dynamic Type:** all use RN default `allowFontScaling` (on). Name `numberOfLines={2}`, tagline
`{2}`, location/eyebrow `{1}` — at the largest accessibility sizes these truncate gracefully rather
than break layout. About body is NOT line-clamped destructively — at large type it simply grows the
"collapsed" height; keep the Read-more toggle (don't hard-cap content the user can't reach).

## 2.4 Avatar — upsize 84 → 96 without forking the shared component

`Avatar size="hero"` is a fixed 84×84 used by 4 sites; do NOT change the shared token. Instead wrap
it to present at 96 in THIS hero only, OR (cleaner) render the avatar inside a 96×96 ring container
and let `Avatar size="hero"` (84) sit centered with a 6px gap that reads as the ring. **Spec the ring
container approach:**

```
heroAvatarRing:
  width: 96 · height: 96 · borderRadius: 999
  alignItems:'center' · justifyContent:'center'
  backgroundColor: canvas.profile (#141113)   ← the ring color = page bg → crisp cutout
  (this also masks any cover bleed behind the avatar)
child: <Avatar name={brand.displayName} size="hero" photo={brand.photo} />  (84×84)
```

Net visual: an 84px avatar inside a 96px disc → a 6px solid ring in the page color. This avoids a new
Avatar size AND gives the crisp cutout. (If the implementor prefers, a literal 96 avatar with
`borderWidth:3 borderColor:canvas.profile` is an acceptable equivalent — but the shared `Avatar`
takes no border prop, so the ring-container is the no-fork path.)

## 2.5 Three-state cover fallback (PRESERVE the chain; upgrade the container)

Keep the exact existing decision chain and the `coverMediaFailed` flip (`useState` + `useEffect`
reset on URL change). Only the CONTAINER (band → 16:9 region) and the **scrim** change.

```
State 1 — media present + !coverMediaFailed:
  RECOMMENDED: render <EventCoverMedia> (from @mingla/event-rendering) instead of raw
  ExpoImage/RNImage. It already handles image · GIF · VIDEO across web+native, honors
  coverMediaType, and animates GIF/video. Props:
     hue={brand.coverHue}
     mediaUrl={coverMediaUrl}
     mediaType={brand.coverMediaType ?? null}
     radius={0}                 ← the parent heroCover already clips the top corners
     height="100%"  width="100%"
     videoContentFit="cover"
     autoplay={true}  playbackActive={true}  loop={true}  muted={true}
     onError={() => setCoverMediaFailed(true)}   ← keep the failure flip
     label=""                                       ← no overlay text from ECM
  This RESOLVES discovery D-1 (video covers currently render as a static frame) — the
  business hero now animates GIF/video covers like the consumer/event surfaces.
  NOTE: ECM cover-fits; the 16:9 region means wide covers fill cleanly and tall covers
  center-crop to 16:9 (acceptable framing, NOT the old sliver).

State 2 — media present + load FAILED (coverMediaFailed === true):
  → hue gradient fill (same as State 3). ECM's own onError sets the flip.

State 3 — coverMediaUrl === null:
  → hue fill: backgroundColor: `hsl(${brand.coverHue}, 60%, 45%)`  (UNCHANGED token math)
  Upgrade to a subtle vertical gradient for depth (optional, recommended):
     LinearGradient from hsl(h,60%,48%) → hsl(h,55%,38%), top→bottom.
     If LinearGradient isn't already imported, a flat hsl(h,60%,45%) fill is acceptable.
```

### Scrim (legibility insurance — REQUIRED on all media states)

Because the cover can be ANY image/color and the avatar ring + (in Dir-3) text sit over it, add a
bottom scrim INSIDE `heroCover`, above the media, below the avatar:

```
heroCoverScrim (absolute, bottom):
  position:'absolute' · left:0 · right:0 · bottom:0 · height: '50%'
  LinearGradient: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']  (top→bottom)
  pointerEvents:'none'
  (If LinearGradient unavailable: a flat View height '32%' bottom, backgroundColor
   'rgba(0,0,0,0.45)' is the fallback — but the gradient is strongly preferred.)
```

In Direction 1 the name/tagline sit BELOW the cover on the dark glass panel, so the scrim's job is
(a) seat the avatar cutout against the cover and (b) guarantee that IF the avatar's photo is light,
its ring still reads. In **Directions 2/3** where text overlays the cover, the scrim is mandatory and
must reach ≥0.55 under the text block (Dir-3 adds a left→right scrim too — see §6).

## 2.6 Every interactive state

| State | Element | Spec |
|---|---|---|
| Default | Hero card | `GlassCard elevated`: iOS translucent profileElevated + glassCardElevated shadow; Android opaque (see §6). |
| Press | Social chip | `Pressable` → `opacity: 0.7` on `pressed` (matches existing chip pattern). Haptic: `selection` (iOS), none Android. |
| Press | Empty-bio CTA | `opacity: 0.85` on pressed → `handleEmptyBio` → `onEdit`. |
| Press | "Read more"/"Show less" | `opacity: 0.7` pressed → toggles `aboutExpanded` state. |
| Loading | Cover media | `EventCoverMedia` shows the hue fill until the image/video paints (its built-in behavior) — no separate skeleton needed. |
| Error | Cover media | `onError` → `coverMediaFailed=true` → hue State 2. |
| Empty | About | No `bio` → dashed accent CTA (preserved). |
| Empty | Tagline / Location / Chips | Element not rendered at all (no placeholder). |
| Disabled | n/a | none in the hero. |

`aboutExpanded` is a new local `useState<boolean>(false)`. Show the "Read more" toggle ONLY when the
collapsed text would clip (i.e. bio is long). Cheap heuristic: render `numberOfLines={aboutExpanded ?
undefined : 4}` and always show the toggle when `brand.bio.length > 160` (≈ 4 lines at this width);
otherwise no toggle and no clamp. (A measured `onTextLayout` approach is acceptable but not required.)

---

# PART 3 — RECENT EVENTS LIST (Section E rewrite)

Replaces the 100%-hardcoded lying empty-state. Wire to real data, mirror `app/(tabs)/hub/events.tsx`.

## 3.1 Data contract

- **Hook (call at TOP LEVEL, with the other hooks, before the L421/L440 early returns — preserves
  ORCH-0710 hook ordering):**
  `const { data: brandEvents = [] } = useBusinessEventsForBrand(brand?.id ?? null);`
- **Derive + filter + sort + slice (useMemo):**
  ```
  const recentEvents = useMemo(() => {
    return brandEvents
      .map(e => ({ event: e, status: deriveCardStatus(e) }))   // 'live'|'upcoming'|'past'|'draft'
      // published only (hook already excludes drafts & trips); keep all statuses
      .sort(by event.date DESC — most recent first; nulls last)
      .slice(0, 5);
  }, [brandEvents]);
  const totalCount = brandEvents.length;
  ```
  - **Published + past included** (the hook returns scheduled/live/ended/cancelled; no status filter).
  - **Most-recent-first** (descending by event date). ~5 rows max.
  - `deriveCardStatus` collapses `cancelled → past`; maps to `OfferingCardStatus`
    (`live`/`upcoming`/`past`). `OfferingListCard` renders the matching pill.

## 3.2 Section header

```
sectionHeaderRow (existing style)  — flexDirection:'row', justifyContent:'space-between',
                                     alignItems:'center', paddingHorizontal: spacing.xs, paddingTop: spacing.sm
  Left:  Text "Recent events"  — typography.h3 (20/32/600), text.primary  (existing sectionTitle)
  Right: "See all"  → ONLY when totalCount > 5
         Pressable → routes to the Hub events list (onSeeAllEvents prop, or existing nav to /(tabs)/hub/events)
         Text: typography.caption (12/16/600), accent.warm
         Icon "chevR" 14, accent.warm, gap 2
         hitSlop 8; accessibilityRole="button"; accessibilityLabel="See all events"
```

> "See all" target: the canonical owner events list is `app/(tabs)/hub/events.tsx`. Route to it (the
> SPEC/implementor wires the exact nav call — a new `onSeeAllEvents?: () => void` prop on
> `BrandProfileView`, supplied by `app/brand/[id]/index.tsx`, mirrors the existing prop pattern).
> Only rendered when there are more than the 5 shown.

## 3.3 The row — reuse `OfferingListCard` AS-IS (confirmed compact)

`OfferingListCard` is already the right compact row: opaque-Android host, 76×92 cover thumb via
`EventCoverMedia`, status pill (LIVE pulsing / UPCOMING / **ENDED** for past / **CANCELLED** /
DRAFT), title (1 line), date·venue subline, capacity progress or metric, optional revenue strip, and
a chevron tap-affordance. **No compact variant needed — use it directly.** Per row:

```
<OfferingListCard
  kind="event"                                  // (experiences also flow through; map per eventType if needed)
  model={offeringListCardModel(event, status)}  // reuse the existing model builder used by the Hub
  onOpen={() => onOpenEvent(event.id)}          // tap row → event detail (see §3.5)
  // onManageOpen OMITTED on the brand-profile surface → hides the 3-dot manage trigger.
  //   Rationale: the brand profile is a glanceable summary; management lives in the Hub.
/>
```

- **List container (recentEventsList):** `gap: spacing.sm (8)`, `marginTop: spacing.sm (8)` under the
  section header. Plain `View` (each `OfferingListCard` is its own self-contained glass card — do NOT
  wrap the rows in an outer `GlassCard`, that would double-nest glass).

### Past-event visual treatment (via `deriveCardStatus`)

`OfferingListCard` already handles this — **do not re-implement**:
- `status === 'past'` → **ENDED** pill (muted `pastPill`: rgba white .04 fill, .08 border, tertiary
  text). When a past event also has zero headcount metric → the whole card fades to `opacity: 0.7`
  (`hostFaded`). Cancelled → **CANCELLED** pill + faded. This satisfies "dimmed / Ended chip".
- Live → pulsing LIVE pill. Upcoming → UPCOMING accent pill. The mix reads correctly when recent
  events span live/upcoming/past.

## 3.4 States

| State | Render |
|---|---|
| **Loading** (hook fetching, no cached data) | 1–2 skeleton rows: a `View` at host shape (radius lg, opaque-Android fill, `glass.border.profileBase` border) with a shimmering 76×92 block + two grey bars (width 60% then 40%, height 12, radius full, `rgba(255,255,255,0.06)`). Reduced-motion: static grey, no shimmer. (Optional but recommended; if skipped, render nothing until data resolves — acceptable since `staleTime` 30s makes cached loads instant.) |
| **Populated** | 1–5 `OfferingListCard` rows, most-recent-first. "See all" in header iff `totalCount > 5`. |
| **Genuinely empty** (`brandEvents.length === 0` after fetch settles) | The EXISTING empty card — keep verbatim, now CONDITIONAL: `GlassCard variant="base" padding={spacing.lg}` → title "No events yet" (existing `emptyEventsTitle`), body "Events you create will show here." (existing `emptyEventsBody`), and the LIVE `Button label="Create your first event" onPress={handleCreateEvent} variant="primary" size="md" leadingIcon="plus"`. **Constitution #1 preserved** (CTA routes to `/event/create`), **Constitution #9 fixed** (only shows on a real empty result). |

> **Personality note (empty state):** optionally warm the empty body copy to Mingla voice — e.g.
> *"Nothing on the calendar yet. Let's fix that."* — but this is a copy nicety, not required; the
> existing copy is acceptable. Keep the CTA label exactly "Create your first event".

## 3.5 Row tap target

Tap a row → the event detail. `OfferingListCard onOpen` fires `onOpenEvent(event.id)`. The route is
the Hub's existing event-detail (`/event/{id}`), per `eventType` if experiences are included
(`/experience/{id}`). Implementor wires the exact nav via a new `onOpenEvent?: (id) => void` prop on
`BrandProfileView` supplied by `app/brand/[id]/index.tsx` (same prop pattern as `onCreateEvent`).
**Not a dead tap** — must navigate.

---

# PART 4 — ACCESSIBILITY

- **Contrast (WCAG AA):**
  - Name `text.primary` rgba(255,255,255,.96) on the glass panel (`canvas.profile` #141113 base) →
    ≈ 17:1. PASS (AAA).
  - Tagline/About `text.secondary` .72 → ≈ 9:1. PASS.
  - Location/eyebrow `text.tertiary` .52 → ≈ 5.1:1. PASS AA (4.5:1) for these small texts.
  - **Text/avatar over the COVER:** the cover is arbitrary → the bottom scrim (0→0.55 black) +
    the avatar's solid `canvas.profile` ring guarantee the avatar cutout and any overlaid text
    (Dir-3) clear 4.5:1. In Dir-1, identity text is on the dark panel, not the cover → always safe.
  - Social-chip icon `accent.warm` #eb7825 on `accent.tint` rgba(.28) over dark → icon is decorative
    + labeled; not a contrast-critical text pairing.
- **Touch targets (≥44pt):**
  - Social chips are **36×36** today → **add `hitSlop={6}`** (→ 48pt effective) OR bump to 44×44.
    Spec: keep 36 visual + `hitSlop={{top:6,bottom:6,left:6,right:6}}`. (Flag — current chips lack it.)
  - "See all", "Read more": small text → `hitSlop={8}`.
  - `OfferingListCard` rows are ≥92pt tall → fine.
- **Roles + labels:**
  - Cover: `EventCoverMedia` carries `accessibilityLabel` internally; pass none extra (decorative).
  - Avatar: decorative within the hero (name is adjacent text); no separate label needed.
  - Verified badge: `accessibilityLabel="Verified brand"`, `accessibilityRole="image"`.
  - Each social chip: existing `accessibilityLabel` (e.g. "Instagram @handle") + `accessibilityRole="button"` (preserved).
  - "See all": `accessibilityRole="button"` label "See all events".
  - Row: `OfferingListCard` already sets `accessibilityRole="button"` + a composed label ("Open
    {title}. {metric} {revenue}.").
- **Reading order:** matches visual order (cover decorative → name → tagline → location → about →
  chips → section header → rows → empty/Create CTA). No reorder needed.
- **Reduced motion:** see §5 — GIF/video cover should respect `prefers-reduced-motion`/`isReduceMotionEnabled`
  by NOT autoplaying (show first frame); LIVE pill pulse already has the system's reduced-motion path
  in `Pill`. Skeleton shimmer → static.
- **One-handed reach:** the only primary action low on the page is "Create your first event" (empty
  state) — bottom of a scroll, thumb-reachable. Identity is read-only top content. Good.

---

# PART 5 — MOTION

| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Hero mount (card enters viewport) | none required (it's the top of a scroll) | — | — | — |
| GIF/video cover | autoplay loop (ECM built-in) | native | continuous | **Do not autoplay** — show first frame (pass `autoplay={!reduceMotion}` / `playbackActive={!reduceMotion}`). |
| Cover image paint | cross-fade hue→image (ECM built-in) | `easings.out` | `durations.normal` (200) | keep (opacity fade is fine under reduced motion; ECM default). |
| "Read more" / "Show less" | height/opacity of About paragraph | `easings.inOut` | `durations.normal` (200) | instant toggle (no animation). Use `LayoutAnimation.configureNext` (iOS/Android) gated on `!reduceMotion`. |
| Social chip press | opacity 1→0.7 | `easings.press` | `durations.fast` (120) | keep (opacity only). |
| LIVE pill pulse (in rows) | ECM/`Pill livePulse` built-in | — | — | already reduced-motion aware in `Pill`. |
| Skeleton shimmer | translateX gradient | linear | 1000 loop | static grey, no shimmer. |

Source `reduceMotion` from the app's existing reduced-motion signal (the same one `Pill livePulse`
consults). No new dependency.

---

# PART 6 — PER-PLATFORM DELTAS (incl. Android glass policy)

## Glass fills (HARD CONSTRAINT — `ANDROID_GLASS_USES_OPAQUE_FALLBACK`)

Both the hero `GlassCard variant="elevated"` and every `OfferingListCard` already implement the
policy; the NEW surfaces below must match.

| Surface | iOS | Android |
|---|---|---|
| Hero `GlassCard elevated` | translucent `glass.tint.profileElevated` (rgba .06) + real blur + `shadows.glassCardElevated` | opaque fill `rgba(20,22,26,0.92)`, `overflow:'hidden'`, **no shadow/elevation** (already handled by GlassCard's variant tokens — verify it uses the opaque Android path; if not, add `Platform.select`). |
| `OfferingListCard` row | translucent `glass.tint.profileBase` | opaque `rgba(20,22,26,0.92)` + `overflow:'hidden'`, no Android shadow (ALREADY in `OfferingListCard.host`). |
| Empty-events `GlassCard base` | translucent profileBase | opaque `rgba(20,22,26,0.92)` (GlassCard's existing base path). |
| Avatar ring | solid `canvas.profile` (#141113) — opaque BOTH platforms (no glass) | same. |
| Social chip | `accent.tint` rgba(.28) over dark — keep on iOS | acceptable as-is (chip is small + bordered; not a large glass surface). No shadow. |
| Cover region | `overflow:'hidden'` clip to top corners — REQUIRED both platforms (clips media + scrim) | same; no Android shadow on the cover. |

**Android specifics:** no `shadowColor`/`elevation` on the cover region or any opaque rounded fill
(square-halo bug). The avatar ring + cover clip are the legibility mechanism, not shadow.

## Cover media element

- **iOS / web:** `EventCoverMedia` uses RN `<Image>` for stills (per the ORCH-0805-WEB path) and
  `expo-video` `VideoView` for video.
- **Android:** `EventCoverMedia` uses `expo-image` for correct GIF animation. (All handled inside
  ECM — switching the hero from raw `ExpoImage`/`RNImage` to `EventCoverMedia` means the per-platform
  image element is no longer this file's concern, AND it fixes D-1 video covers.)

## Safe area / scroll

No change — the hero sits inside the existing `ScrollView` with `RefreshControl`; the page already
manages safe-area insets. The taller cover simply pushes content down; pull-to-refresh unaffected.

## Light vs dark

The business app brand profile is dark-surface (`canvas.profile` #141113). No light-mode variant is
introduced (the surface is dark in both system appearances here). All text tokens are the white-alpha
set; the scrim and avatar ring are dark-on-dark consistent. If a light mode is ever added, the scrim
(black gradient) and the white-alpha text would need light counterparts — out of scope now, flagged.

---

# PART 7 — BUILD-READY HANDOFF

## New local state / props (BrandProfileView)
- `const [aboutExpanded, setAboutExpanded] = useState(false);`
- `useBusinessEventsForBrand(brand?.id ?? null)` — TOP-LEVEL, before early returns (ORCH-0710).
- New props on `BrandProfileView` (supplied by `app/brand/[id]/index.tsx`, same pattern as
  `onCreateEvent`): `onOpenEvent?: (eventId: string, eventType?: string) => void` (row tap),
  `onSeeAllEvents?: () => void` (header "See all"). If routing is done in-component via the app
  router instead, props can be omitted — SPEC's call.

## Tokens used (all EXISTING — no new design tokens required)
`spacing.{xs,sm,md,lg}`, `radius.{md,lg,xl,full}`, `typography.{h2,h3,bodySm,body,caption,labelCap}`,
`text.{primary,secondary,tertiary}`, `accent.{warm,tint,border}`, `glass.{tint,border}.profileBase`,
`canvas.profile`, `semantic.*` (pills via reused components), `durations.*`, `easings.*`.

## New style keys (StyleSheet)
`heroCover` (replaces `heroCoverBand`), `heroCoverFill` (keep), `heroCoverScrim` (new),
`heroAvatarRing` (new, replaces the bare `heroAvatarRow` overlap math), `heroNameRow` (new),
`heroLocationRow` (new), `heroLocation` (new), `heroDivider` (new), `heroAboutEyebrow` (new),
`heroAboutBody` (replaces `heroBio`), `heroReadMore` (new), `recentEventsList` (new),
`seeAllRow` (new). Keep: `heroBody`, `heroName`, `heroTagline`, `emptyBioCta`/`emptyBioText`,
`socialsRow` (+ add `justifyContent:'center'`), `socialChip` (+ hitSlop on the Pressable),
`sectionHeaderRow`, `sectionTitle`, `emptyEventsTitle/Body/BtnRow`.

## Components / imports added
- `EventCoverMedia` (already importable in business via `../ui/EventCoverMedia`).
- `OfferingListCard` + the existing offering model builder (mirror `hub/events.tsx` usage).
- `deriveCardStatus` from `app/(tabs)/hub/eventCardStatus`.
- `useBusinessEventsForBrand` from `../../hooks/useBusinessEvents`.
- Optional `LinearGradient` (expo-linear-gradient) for the scrim + hue gradient; flat-View fallback
  specified if it's not already a dependency.

## Cleanup (per investigation D-3)
Remove/repair the stale "mirrors PublicBrandPage.tsx:259-346" comments at L248–253, L489–494,
L819–821 — the business hero now intentionally diverges from the public page.

## Direction deltas (if Seth picks 2 or 3 instead of 1)
- **Dir 2:** cover uses `EventCoverMedia` with `videoContentFit="contain"` + `onAspectRatio` to set
  `heroCover` height = `cardW / clamp(ratio, 0.8, 1.78)`; identity becomes a SEPARATE `GlassCard base`
  below (gap `spacing.md`); avatar 72×72 LEFT, name/meta in a right column (`flexDirection:'row'`);
  About + chips left-aligned. No scrim needed over the cover (no overlaid text) but keep a faint
  bottom 0→.25 scrim for media depth.
- **Dir 3:** `heroCover` height = `Math.round(cardW/3)` clamped (110…130); avatar 80×80,
  `marginTop:-40`, `marginLeft:spacing.lg`, left-aligned; name baseline-aligned to the right of the
  avatar; ADD a left→right scrim (`['rgba(0,0,0,0.5)','rgba(0,0,0,0)']` horizontal) plus the bottom
  scrim so the left-anchored avatar/name clear 4.5:1 on any cover.

---

## World Map summary (paste-ready)

ORCH-1121 [Business brand-profile redesign] DESIGN complete. Three cover-hero directions proposed for
Seth to pick: **(1) Full-bleed banner** — taller 16:9 cover + bottom scrim + 96px avatar half-overlap
+ centered identity (RECOMMENDED: least risk, fixes the thin-crop, predictable layout); **(2)
Aspect-true cover card** — cover renders at its own clamped aspect ratio (zero crop) with a separate
identity panel below (purist, but tall covers push identity down + variable height); **(3) Split
identity band** — compact 3:1 ribbon with left-anchored avatar/name (densest/editorial, but crops
hardest + biggest departure). Full pixel spec written for Direction 1: cover `EventCoverMedia` (fixes
D-1 video), `coverMediaFailed` 3-state preserved, required bottom scrim for legibility, 84-in-96 ring
avatar (no shared-Avatar fork), About-us eyebrow + read-more, optional location line (D-2), centered
chips with hitSlop. Recent Events: wire `useBusinessEventsForBrand(brand.id)` → `deriveCardStatus` →
5 most-recent `OfferingListCard` rows (manage 3-dot hidden), past→ENDED+faded via existing logic,
"See all" header link when >5, row tap → event detail, and the EXISTING "Create your first event"
empty card kept but CONDITIONAL on a genuinely-empty result (fixes Constitution #9). Android glass
opaque-fallback `rgba(20,22,26,0.92)` + clip + no-shadow specified on every new surface. No new design
tokens. Next: SPEC embeds this + dispatches IMPLEMENT.
```
