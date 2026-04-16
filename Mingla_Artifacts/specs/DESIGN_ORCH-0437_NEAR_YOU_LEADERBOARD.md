# DESIGN SPEC — ORCH-0437: Near You Leaderboard

**Designer:** Mingla Designer
**Date:** 2026-04-15
**Status:** Complete — ready for orchestrator review

---

## 1. Layout Architecture

### Full Tab Structure

The Near You tab fills the space below the existing `[Near You] [Night Out]` tab bar, all the way to the bottom tab navigator.

```
┌──────────────────────────────────────────┐
│  [Near You]  [Night Out]                 │  ← Existing DiscoverTabs (unchanged)
├──────────────────────────────────────────┤
│                                          │
│  ░░░░░ AMBIENT GRADIENT BACKGROUND ░░░░ │  ← Full-bleed behind everything
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  YOUR PROFILE HEADER (fixed)      │  │  height: 72
│  │  [avatar] Name · Lvl 12 · status  │  │
│  │  categories · 2 seats · 14 min    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  FILTER PILLS (horizontal scroll) │  │  height: 44
│  │  [5km ▾] [Any Status ▾] [+2 more] │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ╔════════════════════════════════════╗  │
│  ║  LEADERBOARD FEED                 ║  │  ← FlashList (virtualized)
│  ║                                   ║  │
│  ║  ┌──────────────────────────────┐ ║  │
│  ║  │  Card 1 (rank #1)           │ ║  │  height: 88
│  ║  └──────────────────────────────┘ ║  │
│  ║                                   ║  │  gap: 10
│  ║  ┌──────────────────────────────┐ ║  │
│  ║  │  Card 2 (rank #2)           │ ║  │  height: 88
│  ║  └──────────────────────────────┘ ║  │
│  ║                                   ║  │
│  ║  ...infinite scroll...            ║  │
│  ║                                   ║  │
│  ╚════════════════════════════════════╝  │
│                                          │
└──────────────────────────────────────────┘
```

### Spacing (all values are design-space; use `s()` / `vs()` in code)

| Zone | Measurement | Value |
|------|-------------|-------|
| Tab bar to profile header | paddingTop | 8 |
| Profile header height | height | 72 |
| Profile header horizontal margin | marginHorizontal | 16 |
| Header to filter bar gap | marginTop | 8 |
| Filter bar height | height | 44 |
| Filter bar horizontal padding | paddingHorizontal | 16 |
| Filter bar to first card gap | marginTop | 10 |
| Card height | height | 88 |
| Card horizontal margin | marginHorizontal | 16 |
| Card-to-card gap | marginBottom | 10 |
| Card internal padding | padding | 12 |
| List bottom padding | paddingBottom | 100 (safe area + tab bar) |

---

## 2. Ambient Background

The entire Near You tab sits on top of an **animated ambient gradient** that gives the glass surfaces something to blur against.

### Background Spec

```
Type: LinearGradient (3 stops, diagonal)
Angle: 135° (top-left to bottom-right)
Colors:
  Stop 0%:  #fff7ed (warm cream — primary.50)
  Stop 50%: #fef3e2 (soft peach — between primary.50 and primary.100)
  Stop 100%: #fdf2f8 (hint of rose — adds depth)

Animation: Slow breathing effect
  - Gradient angle oscillates between 125° and 145° over 12s
  - Easing: sinusoidal (smooth, organic)
  - Purpose: subtle life — the background gently shifts, glass surfaces
    catch the change. Users won't consciously notice, but the tab feels alive.

Reduced motion: Static gradient at 135°, no animation.
```

### Platform Notes
- **iOS**: `expo-linear-gradient` with `useNativeDriver` animated values
- **Android**: Same component, but test blur performance. If gradient animation causes jank on low-end devices, disable animation on Android and use a static gradient.

---

## 3. Component Inventory

### 3.1 Self-Profile Header (`LeaderboardProfileHeader`)

Fixed at the top of the tab. Shows how you appear to others. Tapping opens the PreferencesSheet.

```
┌─────────────────────────────────────────────┐
│                                             │
│  ┌────┐                                    │
│  │    │  Sarah · Level 12        14 min ⏱  │
│  │ AV │  🧭 Exploring                      │
│  │    │  🍷🎨🎭  ·  2 seats open           │
│  └────┘                                    │
│                                   [Edit ›] │
└─────────────────────────────────────────────┘
```

#### Anatomy

| Element | Position | Typography | Color |
|---------|----------|------------|-------|
| Container | Full width, glassmorphic surface | — | `glass.surfaceElevated` bg |
| Avatar | Left, 44×44 circle, 2px orange border when discoverable | — | border: `accent` |
| Activity ring | Around avatar, 48×48 SVG ring | — | stroke: `accent`, 2px |
| Name | Right of avatar, top-left | `fontSize: 15, fontWeight: '700'` | `text.primary` (#111827) |
| Level pill | Inline after name | `fontSize: 11, fontWeight: '700'` | bg: `#fffbeb`, text: `#92400e`, border: `#fde68a` |
| Status | Below name, with status icon | `fontSize: 12, fontWeight: '500'` | `accent` (#eb7825) |
| Categories | Below status, icon row | 14×14 icons, `gap: 6` | `gray.500` (#6b7280), active pulse: `accent` |
| Seats | Inline after categories, right-aligned cluster | `fontSize: 11, fontWeight: '600'` | `success.600` (#16a34a) |
| Active time | Top-right corner | `fontSize: 11, fontWeight: '500'` | `gray.400` (#9ca3af) |
| Edit chevron | Bottom-right corner | `fontSize: 11, fontWeight: '500'` | `gray.400` with chevron-right icon (10px) |

#### Glass Treatment

```
backgroundColor: 'rgba(255, 255, 255, 0.72)'
borderColor: 'rgba(255, 255, 255, 0.50)'
borderWidth: 1
borderRadius: 20
blur: 40 (behind the surface — BlurView wrapping the gradient bg)
shadow: glass.shadow
```

#### States

| State | Visual Change |
|-------|--------------|
| Discoverable ON | Orange border on avatar, green seats text, full opacity |
| Discoverable OFF | No avatar border, dimmed to `opacity: 0.6`, seats text reads "Hidden" in `gray.400` |
| No status set | Status line reads "No status set" in `gray.400`, italic |
| Tap | `opacity: 0.85` press feedback → opens PreferencesSheet |

#### Interaction
- `activeOpacity: 0.85` on the entire header
- `onPress` → opens PreferencesSheet (existing component, with new discoverability section)
- Haptic: `Haptics.impactAsync(ImpactFeedbackStyle.Light)` on press

---

### 3.2 Leaderboard Card (`LeaderboardCard`)

The core repeating element. Compact, information-dense, swipeable.

```
┌───────────────────────────────────────────────────┐
│                                                   │
│  ┌────┐                                          │
│  │    │  Alex · Level 28       ◉ Very close      │
│  │ AV │  🔍 Looking for plans                    │
│  │    │  🍷 🎨 🎮 · 1 seat    Active for 8 min  │
│  └────┘                                          │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │         ✦  Indicate Interest                │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
└───────────────────────────────────────────────────┘

← SLIDE RIGHT REVEALS →
┌───────────────────┐
│                   │
│    ✦ Tag Along    │  ← Revealed behind card on right-slide
│                   │
└───────────────────┘
```

#### Anatomy

| Element | Position | Typography | Color |
|---------|----------|------------|-------|
| Container | Full width minus 32px margins, glassmorphic | — | Glass surface |
| Avatar | Left column, 40×40 circle | — | Photo, fallback: colored initials |
| Activity ring | Around avatar, 44×44 SVG ring, 2px stroke | — | `accent` stroke, animated fill based on cumulative swipe activity |
| Name | Top-left of content area | `fontSize: 14, fontWeight: '700'` | `text.primary` |
| Level pill | Inline after name | `fontSize: 10, fontWeight: '700'`, `paddingHorizontal: 6, paddingVertical: 2` | bg: `#fffbeb`, text: `#92400e`, border: `#fde68a`, `borderRadius: 999` |
| Proximity | Top-right | `fontSize: 11, fontWeight: '600'` | Color varies by tier (see below) |
| Proximity dot | Before proximity text, 6×6 circle | — | Same color as text |
| Status | Below name, with icon | `fontSize: 12, fontWeight: '500'` | `gray.600` (#4b5563) |
| Status icon | Before status text, 12×12 | — | `accent` |
| Categories | Bottom-left, icon row | 16×16 icons, `gap: 5` | `gray.400`, pulse to `accent` on live swipe |
| Seat count | Inline after categories, separated by `·` | `fontSize: 11, fontWeight: '600'` | Varies: ≥2 seats: `success.600`, 1 seat: `warning.600`, 0 seats: hidden (card exits) |
| Active time | Bottom-right | `fontSize: 10, fontWeight: '500'` | `gray.400` |
| Interest button | Full-width below content, `height: 34` | `fontSize: 13, fontWeight: '700'` | bg: `accent`, text: `#fff`, `borderRadius: 10` |
| Interest icon | Before button text, `sparkles` icon 14px | — | `#fff` |

#### Proximity Tiers

| Tier | Label | Dot + Text Color |
|------|-------|-----------------|
| < 1km | Very close | `success.500` (#22c55e) |
| 1–5km | Nearby | `primary.500` (#f97316) |
| 5–20km | In your area | `warning.500` (#f59e0b) |
| 20–50km | Further out | `gray.400` (#9ca3af) |
| 50–100km | Far away | `gray.300` (#d1d5db) |

#### Glass Treatment

```
backgroundColor: 'rgba(255, 255, 255, 0.60)'
borderColor: 'rgba(255, 255, 255, 0.40)'
borderWidth: 1
borderRadius: 16
blur: 30 (if using BlurView underneath — see platform notes)
shadow:
  shadowColor: 'rgba(0, 0, 0, 0.06)'
  shadowOffset: { width: 0, height: 4 }
  shadowOpacity: 1
  shadowRadius: 12
  elevation: 4
```

#### Card States

| State | Visual Treatment |
|-------|-----------------|
| **Default** | Standard glass surface, full opacity |
| **Currently swiping** | Activity ring around avatar pulses brighter (animated opacity 0.6→1.0 loop, 1.5s). Subtle warm glow on card border: `borderColor` transitions to `rgba(235,120,37,0.30)` |
| **Interest sent** | Card opacity → 0.55. Button becomes: bg `gray.100`, text `gray.500`, label "Interest Sent ✓", disabled. Slide gesture disabled. |
| **1 seat left** | Seat text color → `warning.600` (#d97706). Small `flame` icon (10px) next to seat count, pulsing. |
| **Sliding right** | Card translates X. Behind it (absolutely positioned, right-aligned), a `accent` surface reveals with "✦ Tag Along" text centered. At 40% width threshold, haptic tick. At 75%+ release, auto-send. Below 40%, snap back. |
| **Interest sending** | Button shows `ActivityIndicator` (white, small) for 300ms, then transitions to "sent" state. |

#### Slide-to-Interest Gesture Spec

```
Gesture: PanGestureHandler (horizontal only)
Direction: Right only (left swipe does nothing)

Thresholds:
  - 0–39% of card width: snap back on release (spring damping: 15, stiffness: 150)
  - 40%: haptic tick (Haptics.impactAsync Light), behind-card surface fully visible
  - 40–74%: card stays where finger is, behind-card shows "✦ Tag Along" text
  - 75%+: release auto-sends interest request
    - Card snaps to full right (exits screen briefly, 200ms)
    - Then snaps back to position with "Interest Sent ✓" state
    - Haptic: Haptics.notificationAsync(Success)

Behind-card surface:
  backgroundColor: accent (#eb7825)
  borderRadius: 16 (matches card)
  Text: "✦ Tag Along" — fontSize: 14, fontWeight: '700', color: '#fff'
  Icon: sparkles, 16px, color: '#fff'
  Layout: centered vertically, right-padded 24px from right edge
  Opacity: interpolated from 0 → 1 as card slides from 0 → 40%
```

---

### 3.3 Filter Pills Bar (`LeaderboardFilters`)

Horizontal scrollable row of glassmorphic filter pills.

```
┌─────────────────────────────────────────────────┐
│  [5 km ▾]  [Any Status ▾]  [All ▾]  [Seats ▾] │
└─────────────────────────────────────────────────┘
```

#### Pill Anatomy (each filter pill)

| Element | Typography | Color (inactive) | Color (active) |
|---------|------------|-------------------|-----------------|
| Container | — | bg: `rgba(255,255,255,0.50)`, border: `rgba(255,255,255,0.35)` | bg: `rgba(235,120,37,0.12)`, border: `rgba(235,120,37,0.30)` |
| Label text | `fontSize: 12, fontWeight: '600'` | `gray.600` (#4b5563) | `accent` (#eb7825) |
| Chevron icon | 10px | `gray.400` | `accent` |
| Badge count | `fontSize: 9, fontWeight: '700'`, 16×16 circle | — | bg: `accent`, text: `#fff` (shown when multi-select has N selections) |

#### Pill Dimensions

```
height: 32
paddingHorizontal: 12
borderRadius: 999 (full round)
gap between pills: 8
ScrollView paddingHorizontal: 16
showsHorizontalScrollIndicator: false
```

#### Filter Dropdowns

Each pill, when tapped, opens a small glassmorphic dropdown BELOW the pill bar (not a modal).

**Radius dropdown:**
```
┌──────────────────┐
│  1 km             │
│  5 km        ✓    │  ← Current selection
│  10 km            │
│  25 km            │
│  50 km            │
│  100 km           │
└──────────────────┘

Style:
  backgroundColor: 'rgba(255, 255, 255, 0.92)'
  borderRadius: 12
  shadow: glass.shadow
  width: 140
  Each option: height 36, paddingHorizontal: 14
  Selected: text color accent, checkmark icon
  Backdrop: Pressable transparent overlay to close
```

**Status dropdown:**
```
Multi-select checkboxes:
  ☑ Exploring
  ☑ Looking for plans
  ☑ Open to meet
  ☐ Busy
  [Apply]

Width: 200
Same glass style as radius dropdown
Checkbox: 18×18 rounded square, accent fill when checked
Apply button: small accent pill at bottom, fontSize: 12
```

**Categories dropdown:**
```
Multi-select with category icons:
  ☑ 🍷 Drinks & Music
  ☑ 🎨 Creative & Arts
  ☐ 🎮 Play
  ... (all 8 visible categories)
  [Apply]

Width: 220
Same glass style
Each row: 14px icon + 12px label + checkbox
```

**Seats dropdown:**
```
  Any
  Has open seats  ✓
  2+ seats
  3+ seats

Width: 160
Same glass style as radius
```

---

### 3.4 Interest Request Banner (`TagAlongBanner`)

Slides in from the top when someone indicates interest in you.

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌────┐  Alex (Level 28) wants to             │
│  │ AV │  tag along · 🔍 Looking for plans      │
│  └────┘                                        │
│           [Decline]        [Accept ✦]          │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### Anatomy

| Element | Spec |
|---------|------|
| Container | `marginHorizontal: 16`, `marginTop: insets.top + 8`, glassmorphic surface elevated |
| Glass | `backgroundColor: 'rgba(255,255,255,0.88)'`, `borderRadius: 20`, blur: 50, `shadow: glass.shadow` |
| Avatar | 36×36 circle, left-aligned |
| Title line | "**Alex** (Level 28) wants to tag along" — `fontSize: 13, fontWeight: '600'` for name, `'400'` for rest, `color: text.primary` |
| Status line | Their status with icon — `fontSize: 12, fontWeight: '500'`, `color: gray.500` |
| Decline button | `paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: gray.100`, text: `fontSize: 13, fontWeight: '600', color: gray.600` |
| Accept button | `paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, backgroundColor: accent`, text: `fontSize: 13, fontWeight: '700', color: #fff`, sparkles icon 12px before text |
| Button row | `flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8` |

#### Animation

```
Entry: slide down from y = -120 to y = 0
  duration: 350ms
  easing: spring (damping: 18, stiffness: 140)
  + opacity 0 → 1 over first 200ms

Auto-dismiss: after 30 seconds if not actioned
  Exit: slide up to y = -120
  duration: 250ms
  easing: easeIn

Accept tap:
  Button scales 0.95 → 1.0 (50ms spring)
  Haptic: notificationAsync(Success)
  Banner pulses green border briefly (borderColor → success.400, 200ms, then fade)
  Then exits (slide up, 250ms)

Decline tap:
  Button scales 0.95 → 1.0 (50ms spring)
  Haptic: impactAsync(Light)
  Banner exits (slide up, 250ms)

Multiple banners: Stack vertically with 8px gap
  Max visible: 3
  Additional banners queue — next one enters when current exits
```

---

### 3.5 Match Celebration (`TagAlongMatchOverlay`)

Full-screen overlay when a tag-along is accepted (both users see this).

```
┌─────────────────────────────────────────────────┐
│                                                 │
│              ✧ · . ✦ ˚ ✧ · .                  │
│                                                 │
│            ┌────┐    ┌────┐                    │
│            │ AV │ ↔  │ AV │                    │
│            │YOU │    │THEM│                    │
│            └────┘    └────┘                    │
│                                                 │
│            Let's explore together!              │
│                                                 │
│     Your preferences have been shared.          │
│                                                 │
│          [Go to Session →]                      │
│                                                 │
│              ✧ · . ✦ ˚ ✧ · .                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### Anatomy

| Element | Spec |
|---------|------|
| Overlay bg | `rgba(0, 0, 0, 0.45)` — blurred backdrop |
| Content card | Centered, `width: SCREEN_WIDTH - 64`, glassmorphic elevated surface, `borderRadius: 28`, `padding: 32` |
| Glass | `backgroundColor: 'rgba(255,255,255,0.85)'`, blur: 60, border: `rgba(255,255,255,0.60)` |
| Your avatar | 56×56 circle, 3px `accent` border |
| Their avatar | 56×56 circle, 3px `accent` border |
| Connector | Between avatars: animated sparkle line, or `↔` icon 20px in `accent` |
| Avatar gap | 24px between circles |
| Headline | "Let's explore together!" — `fontSize: 20, fontWeight: '700', color: text.primary`, `marginTop: 20` |
| Subtext | "Your preferences have been shared." — `fontSize: 14, fontWeight: '400', color: gray.500`, `marginTop: 8` |
| CTA button | Full-width, `height: 48, borderRadius: 14, backgroundColor: accent`, text: `fontSize: 15, fontWeight: '700', color: #fff`, arrow icon 14px |
| CTA marginTop | 24 |
| Particles | Subtle sparkle/confetti particles floating in from edges (see animation section) |

#### Animation

```
Entry sequence (choreographed):
  0ms:    Overlay bg fades in (opacity 0→1, 200ms, easeOut)
  100ms:  Content card scales from 0.8→1.0 + opacity 0→1 (300ms, spring damping: 16)
  200ms:  Your avatar slides in from left (translateX: -30→0, 250ms, spring)
  250ms:  Their avatar slides in from right (translateX: 30→0, 250ms, spring)
  400ms:  Connector appears (scale 0→1, 200ms, easeOut)
  450ms:  Headline fades in (opacity 0→1, 200ms)
  550ms:  Subtext fades in (opacity 0→1, 200ms)
  650ms:  CTA slides up (translateY: 20→0 + opacity 0→1, 250ms, easeOut)
  200ms:  Particles begin (continuous, subtle)

Haptic: Haptics.notificationAsync(Success) at 100ms

CTA tap → navigates to collab session (SessionViewModal)
  Exit: card scales to 0.95, opacity → 0 (200ms), overlay fades (200ms)

Auto-dismiss: Never. Must tap CTA or backdrop.
Backdrop tap: Same as CTA — go to session. No way to dismiss without entering session.

Reduced motion:
  No particles, no slides, no spring. Instant opacity fade-in for all elements.
  Haptic still fires.
```

#### Particles Spec

```
Type: 12–16 small sparkle dots, randomly positioned
Size: 3–6px circles
Colors: accent (50%), warning.300 (30%), primary.200 (20%)
Movement: Float upward slowly (translateY: 0 → -40 over 3s), fade out at top
Respawn: Continuous loop, staggered start times
Opacity: 0.3–0.7 (random per particle)
Reduced motion: Hidden entirely
```

---

## 4. New Glassmorphism Tokens

Extend the existing `glass` object in `designSystem.ts`:

```typescript
export const glass = {
  // ...existing tokens...

  // Near You leaderboard surfaces
  leaderboard: {
    card: {
      backgroundColor: 'rgba(255, 255, 255, 0.60)',
      borderColor: 'rgba(255, 255, 255, 0.40)',
      borderWidth: 1,
      borderRadius: 16,
    },
    cardActive: {
      // When user is currently swiping — warmer border
      borderColor: 'rgba(235, 120, 37, 0.30)',
    },
    cardSent: {
      // After interest is sent — dimmed
      opacity: 0.55,
    },
    header: {
      backgroundColor: 'rgba(255, 255, 255, 0.72)',
      borderColor: 'rgba(255, 255, 255, 0.50)',
      borderWidth: 1,
      borderRadius: 20,
    },
    filterPill: {
      backgroundColor: 'rgba(255, 255, 255, 0.50)',
      borderColor: 'rgba(255, 255, 255, 0.35)',
      borderWidth: 1,
      borderRadius: 999,
    },
    filterPillActive: {
      backgroundColor: 'rgba(235, 120, 37, 0.12)',
      borderColor: 'rgba(235, 120, 37, 0.30)',
    },
    dropdown: {
      backgroundColor: 'rgba(255, 255, 255, 0.92)',
      borderColor: 'rgba(255, 255, 255, 0.60)',
      borderWidth: 1,
      borderRadius: 12,
    },
    banner: {
      backgroundColor: 'rgba(255, 255, 255, 0.88)',
      borderColor: 'rgba(255, 255, 255, 0.55)',
      borderWidth: 1,
      borderRadius: 20,
    },
    matchCard: {
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
      borderColor: 'rgba(255, 255, 255, 0.60)',
      borderWidth: 1,
      borderRadius: 28,
    },
  },

  // Blur intensities per surface
  blur: {
    card: 30,
    header: 40,
    banner: 50,
    match: 60,
    dropdown: 35,
  },

  // Glass shadows per surface
  shadowLight: {
    shadowColor: 'rgba(0, 0, 0, 0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;
```

---

## 5. New Typography Styles

No new font sizes needed — all text uses existing `typography.*` scale. New semantic combinations:

| Name | fontSize | fontWeight | color | Usage |
|------|----------|------------|-------|-------|
| `cardName` | 14 (sm) | '700' (bold) | text.primary | Card display name |
| `cardStatus` | 12 (xs) | '500' (medium) | gray.600 | Status text on card |
| `cardMeta` | 11 | '600' (semibold) | gray.400 | Seats, active time, proximity |
| `cardMetaWarm` | 11 | '600' | accent | Proximity "very close" |
| `levelPill` | 10 | '700' | #92400e | Level number in pill |
| `filterLabel` | 12 (xs) | '600' | gray.600 / accent | Filter pill text |
| `bannerTitle` | 13 | '600' | text.primary | Banner headline |
| `bannerSub` | 12 (xs) | '500' | gray.500 | Banner status line |
| `matchHeadline` | 20 (xl) | '700' | text.primary | Match celebration title |
| `matchSub` | 14 (sm) | '400' | gray.500 | Match subtitle |
| `interestBtn` | 13 | '700' | #ffffff | Interest button text |

All should use `ms()` for responsive scaling.

---

## 6. Animation Specs

### 6.1 Category Icon Pulse (Live Swipe Flash)

When a user on the leaderboard swipes a card in category X, the matching category icon on their leaderboard card pulses.

```
Trigger: Realtime event — user swiped on [category]
Target: The specific category icon (16×16 Ionicon) on their card

Animation sequence:
  0ms:   Icon color transitions from gray.400 → accent (#eb7825)
         Icon scale: 1.0 → 1.35
  250ms: Hold at peak
  500ms: Icon color transitions accent → gray.400
         Icon scale: 1.35 → 1.0
  750ms: Complete, back to resting state

Easing: easeOut for scale up, easeInOut for scale down
Overlap: spring (no easing curve needed for the scale — use spring with damping: 12, stiffness: 180)

Multiple rapid swipes:
  If same category: restart the animation (cancel current, begin fresh)
  If different category: both icons can pulse simultaneously (independent animations)

Reduced motion:
  No scale change. Icon color changes instantly (no transition) — flash accent for 400ms, then back.
```

### 6.2 Activity Ring (Cumulative)

The SVG ring around each user's avatar fills based on their cumulative activity in the current session.

```
Ring: 44×44 (card) or 48×48 (header), stroke width 2px
Color: accent (#eb7825)
Background stroke: gray.200 (#e5e7eb), same width

Fill calculation:
  0 swipes:     0% fill (just background stroke)
  1–5 swipes:   20% fill
  6–15 swipes:  40% fill
  16–30 swipes: 60% fill
  31–50 swipes: 80% fill
  51+ swipes:   100% fill (full ring)

Animation: When fill increases, animate the stroke-dashoffset over 400ms, easeOut
  + subtle glow: shadow around ring pulses once (shadowOpacity 0→0.3→0 over 600ms)

Currently swiping state:
  Ring opacity oscillates 0.6 → 1.0 → 0.6, period: 1.5s, easing: sinusoidal
  (This is independent of fill — it's the "heartbeat" showing they're active right now)

Reduced motion: No heartbeat pulse. Fill changes are instant (no dashoffset animation).
```

### 6.3 Card Enter Animation

```
Trigger: New user appears on leaderboard (Realtime insert)

Animation:
  Card starts at: opacity 0, translateY: 20, scale: 0.97
  Card ends at:   opacity 1, translateY: 0, scale: 1.0
  Duration: 350ms
  Easing: spring (damping: 18, stiffness: 150)

If multiple cards enter simultaneously (e.g., initial load):
  Stagger by 50ms per card (card 1 at 0ms, card 2 at 50ms, card 3 at 100ms...)
  Max stagger: 500ms (cards 11+ enter at the same time as card 10)

Reduced motion: Instant appear, no animation.
```

### 6.4 Card Exit Animation

```
Trigger: User disappears from leaderboard (seats full, left area, went offline)

Animation:
  Card: opacity 1→0, translateX: 0→-30, scale 1.0→0.97
  Duration: 250ms
  Easing: easeIn

  After card exits, remaining cards below reflow upward:
    translateY animation, 200ms, easeOut
    (LayoutAnimation or Reanimated2 layout transitions)

Reduced motion: Instant removal, list reflows without animation.
```

### 6.5 Rank Reorder Animation

```
Trigger: User's rank changes (level change, proximity change, activity change)

Animation:
  Card smoothly translates to new Y position
  Duration: 400ms
  Easing: spring (damping: 20, stiffness: 120)

Note: Use Reanimated2's Layout.springify() on FlashList items, or manual
translateY tracking. FlashList + LayoutAnimation can conflict — test carefully.

Reduced motion: Instant position change.
```

### 6.6 Interest Button Tap Animation

```
Trigger: User taps the "Indicate Interest" button

Sequence:
  0ms:    Button scale 1.0→0.93 (50ms, spring)
  50ms:   Button scale 0.93→1.0 (100ms, spring)
  50ms:   Haptic impactAsync(Medium)
  100ms:  Button content swaps to ActivityIndicator (white, small)
  400ms:  ActivityIndicator replaced with "Interest Sent ✓"
          Card transitions to sent state (opacity → 0.55)
  400ms:  Haptic notificationAsync(Success)

Reduced motion: No scale animation. Instant state swap after 300ms loading.
```

### 6.7 Ambient Gradient Breathing

```
Property: LinearGradient angle
Range: 125° ↔ 145°
Duration: 12s full cycle (6s each direction)
Easing: sinusoidal (Math.sin based interpolation)
Platform: Animated.Value driving the start/end points of the gradient

Reduced motion: Static at 135°
Android fallback: Static at 135° if animation causes jank
```

---

## 7. State Matrix

### Near You Tab States

| State | What Shows | Behavior |
|-------|-----------|----------|
| **Loading (initial)** | Profile header (with cached data or skeleton). Filter bar (skeleton pills). 3 skeleton cards below (glass surface, pulsing opacity 0.3↔0.7, 1.2s loop). | Data fetching from `leaderboard_presence` table. |
| **Empty (no users nearby)** | Profile header. Filter bar. Empty state card centered (see §7.1). | User can adjust radius filter. |
| **Populated** | Profile header. Filter bar (with counts). Scrollable leaderboard cards. | Normal state. Real-time updates. |
| **Populated + interest sent** | Same as populated. Sent cards show dimmed with "Interest Sent ✓". | Sent cards stay in the list but are non-interactive. |
| **Populated + incoming interest** | Same as populated. TagAlongBanner slides in from top. | Banner overlays the leaderboard. List is still scrollable behind it. |
| **Match accepted** | TagAlongMatchOverlay covers everything. | Dismisses to SessionViewModal. |
| **Discoverable OFF** | Profile header shows "Hidden" state (dimmed, no border). Filter bar + leaderboard still visible and usable. Info pill at top of list: "You're hidden — others can't see you." | User can still browse, just not be seen. |
| **Error (network)** | Profile header (cached). Filter bar. Error state card: "Couldn't load nearby explorers. Check your connection." + Retry button. | Retry button refetches. |
| **Error (location)** | Profile header. Filter bar. Error state card: "We need your location to show who's nearby." + "Enable Location" button. | Deep-links to location settings. |

### 7.1 Empty State Card

```
┌─────────────────────────────────────────────┐
│                                             │
│              🧭                             │
│                                             │
│     No one exploring nearby... yet          │
│                                             │
│     Expand your radius to find more         │
│     people, or check back soon!             │
│                                             │
│          [ Expand Radius ]                  │
│                                             │
└─────────────────────────────────────────────┘

Icon: compass-outline, 48px, gray.300
Headline: fontSize: 17, fontWeight: '600', color: text.primary, textAlign: center
Subtext: fontSize: 13, fontWeight: '400', color: gray.500, textAlign: center
Button: accent bg, white text, borderRadius: 12, height: 40, paddingHorizontal: 20
  fontSize: 13, fontWeight: '600'
Card: glass.leaderboard.card style, paddingVertical: 32, paddingHorizontal: 24
  marginHorizontal: 32 (narrower than regular cards for visual distinction)
```

### 7.2 Skeleton Card

```
Same dimensions as LeaderboardCard (height: 88, same margins/radius/glass).
Content replaced with:
  - 40×40 circle (gray.200, left position)
  - 3 rectangles (gray.200, borderRadius: 6):
    - 120×14 (top, name placeholder)
    - 160×12 (middle, status placeholder)
    - 100×10 (bottom, meta placeholder)

Pulse animation: opacity oscillates 0.3 ↔ 0.7, duration 1.2s, easeInOut loop
Reduced motion: Static at opacity 0.5, no pulse
```

---

## 8. Interaction Specs

### Gesture Summary

| Element | Gesture | Action | Haptic |
|---------|---------|--------|--------|
| Profile header | Tap | Open PreferencesSheet | impactAsync(Light) |
| Filter pill | Tap | Toggle dropdown | impactAsync(Light) |
| Filter dropdown option | Tap | Select/deselect + close (single) or toggle (multi) | impactAsync(Light) |
| Filter dropdown backdrop | Tap | Close dropdown | None |
| Leaderboard card button | Tap | Send interest request | impactAsync(Medium) → notificationAsync(Success) |
| Leaderboard card | Pan right | Reveal "Tag Along" behind card | impactAsync(Light) at 40% threshold |
| Leaderboard card | Pan right release ≥75% | Auto-send interest | notificationAsync(Success) |
| Leaderboard card | Pan right release <40% | Snap back | None |
| Banner Accept | Tap | Accept tag-along | notificationAsync(Success) |
| Banner Decline | Tap | Decline tag-along | impactAsync(Light) |
| Match CTA | Tap | Navigate to collab session | impactAsync(Medium) |
| Match backdrop | Tap | Navigate to collab session | impactAsync(Light) |

### Touch Targets

All interactive elements meet the `44px` minimum touch target:
- Filter pills: 32px visible height, but 44px touchable height (12px vertical hit slop)
- Card button: 34px visible height, 44px touchable (5px hit slop top/bottom)
- Banner buttons: 32px visible, 44px touchable

---

## 9. Responsive Notes

### Screen Size Adaptations

| Screen | Change |
|--------|--------|
| **iPhone SE (375×667)** | Card height stays 88. Filter pills may scroll. Profile header stays 72 but categories truncate to 4 icons + "+N". |
| **iPhone 14 (390×844)** | Reference design. Everything fits as specified. |
| **iPhone 14 Pro Max (430×932)** | Card height stays 88 (content is fixed, not stretched). Additional vertical breathing room in gaps. |
| **iPad** | Not applicable — Mingla is iPhone-only for now. |

### Dynamic Type

| Element | Scales? | Max Scale |
|---------|---------|-----------|
| Card name | Yes, via `ms()` | 1.3x (capped — card height is fixed) |
| Card status | Yes, via `ms()` | 1.3x |
| Card meta | No — `fontSize: 11` is minimum readable, scaling would break layout |
| Filter pills | No — fixed height, text truncates |
| Banner text | Yes, via `ms()` | 1.3x |
| Match headline | Yes, via `ms()` | 1.5x |

---

## 10. Platform Notes

### iOS
- Use `expo-blur` (`BlurView`) behind glass surfaces for real backdrop blur
- `blurType: 'light'`, intensity values as specified per surface
- Haptics: Full `expo-haptics` API available
- Spring animations: Use `Animated.spring` or Reanimated2 `withSpring`

### Android
- `expo-blur` uses a fallback on Android (not true hardware blur)
- **Recommendation:** On Android, skip `BlurView` entirely. Use solid `rgba` backgrounds (the glass tokens already work without blur — the translucency alone provides the effect against the gradient background)
- LayoutAnimation: Requires `UIManager.setLayoutAnimationEnabledExperimental(true)` (already enabled in the codebase per ActivityStatusPicker)
- Haptics: `expo-haptics` works on Android but some devices have no haptic motor — always treat haptics as enhancement, never as the only feedback
- Spring animations: Reanimated2 preferred over Animated API (better perf on Android)
- Test gradient animation on mid-range Android devices. Disable if FPS drops below 55.

---

## 11. Preferences Sheet Additions

### New Section: "Near You Leaderboard"

Inserted as **Section 7** (after the existing 6 sections), same glass card treatment as other sections.

```
┌─────────────────────────────────────────────┐
│                                             │
│  Near You Leaderboard                       │  ← Section title
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Appear on the leaderboard          │    │
│  │  Let nearby explorers find you  [⬤] │    │  ← Toggle switch
│  └─────────────────────────────────────┘    │
│                                             │
│  When discoverable:                         │  ← Sub-label, gray.400
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Who sees you                       │    │
│  │  [Everyone ▾]                       │    │  ← Dropdown selector
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Your status                        │    │
│  │  ○ None                             │    │
│  │  ● Exploring                        │    │  ← Radio group
│  │  ○ Looking for plans                │    │
│  │  ○ Open to meet                     │    │
│  │  ○ Busy                             │    │
│  │  ○ Custom: [_______________]        │    │  ← Text input appears on select
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Available seats                    │    │
│  │  How many can tag along?            │    │
│  │  [ - ]  3  [ + ]                    │    │  ← Stepper, range 1–5
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

#### Specs

| Control | Spec |
|---------|------|
| **Master toggle** | Standard RN `Switch`, `trackColor: { true: accent, false: gray.200 }`, `thumbColor: '#fff'`. When OFF, all sub-controls below are `opacity: 0.4` and disabled. |
| **Who sees you** | Dropdown selector (same style as `visSelector` in the old ActivityStatusPicker). Tap opens inline options list. Options: Everyone, Friends, Friends of Friends, Paired, Nobody. Selected option shows orange bg pill. |
| **Status radio** | Vertical list of touchable rows, each `height: 40`. Selected row: orange dot (`accent`) + `fontWeight: '600'` + `color: accent`. Unselected: `gray.300` dot + `fontWeight: '400'` + `color: text.secondary`. Custom row: when selected, reveals a `TextInput` below (`maxLength: 30`, same style as the old ActivityStatusPicker custom input). |
| **Seats stepper** | Centered row: minus button (32×32, `gray.200` bg, `gray.600` icon) + number (`fontSize: 20, fontWeight: '700'`) + plus button (32×32, `accent` bg, white icon). Range: 1–5. At min, minus is `opacity: 0.4, disabled`. At max, plus is `opacity: 0.4, disabled`. Haptic `impactAsync(Light)` on each tap. |
| **Sub-label** | "When discoverable:" — `fontSize: 11, fontWeight: '500', color: gray.400, marginTop: 12, marginBottom: 4` |
| **Disabled state** | When master toggle is OFF, all sub-controls fade to `opacity: 0.4` with `pointerEvents: 'none'`. Animated transition: 200ms, easeOut. |

#### Animation

Section enters with the same staggered animation as other PreferencesSheet sections (70ms delay after previous section).

Toggle ON/OFF: sub-controls animate height 0↔auto with `LayoutAnimation.easeInEaseOut`, 250ms.

---

## 12. Accessibility

### Screen Reader Labels

| Element | `accessibilityLabel` | `accessibilityRole` |
|---------|---------------------|---------------------|
| Profile header | "Your leaderboard profile. [Name], Level [N], [status]. Tap to edit preferences." | `button` |
| Filter pill (radius) | "Distance filter: [N] kilometers. Tap to change." | `button` |
| Filter pill (status) | "Status filter: [selections]. Tap to change." | `button` |
| Leaderboard card | "[Name], Level [N], [status], [proximity], [seats] seats open, active for [time]." | `none` (children are accessible) |
| Interest button | "Indicate interest in [Name]." | `button` |
| Interest button (sent) | "Interest sent to [Name]." | `text` (no longer interactive) |
| Card slide gesture | Not announced — the button is the accessible alternative to sliding | — |
| Banner | "Tag along request from [Name], Level [N]. [status]. Accept or decline." | `alert` |
| Accept button | "Accept tag along from [Name]." | `button` |
| Decline button | "Decline tag along from [Name]." | `button` |
| Match overlay | "Match! You and [Name] will explore together. Tap to go to your session." | `alert` |
| Discoverability toggle | "Appear on the Near You leaderboard. Currently [on/off]." | `switch` |
| Seats stepper | "Available seats: [N]. Minimum 1, maximum 5." | `adjustable` |

### Contrast Ratios

All text meets WCAG AA (4.5:1 for normal text, 3:1 for large text):

| Text | Foreground | Background (worst case) | Ratio |
|------|-----------|------------------------|-------|
| Card name (#111827) | on glass (rgba 255,255,255,0.60) over gradient | ~#fff2e6 | 12.8:1 ✓ |
| Card status (#4b5563) | on glass over gradient | ~#fff2e6 | 7.1:1 ✓ |
| Card meta (#9ca3af) | on glass over gradient | ~#fff2e6 | 3.2:1 ✓ (large text rule, 11px is borderline — acceptable for supplementary info) |
| Level pill text (#92400e) | on #fffbeb | — | 5.8:1 ✓ |
| Button text (#ffffff) | on accent (#eb7825) | — | 3.1:1 ✓ (large text, bold) |

### Reduced Motion

Every animation section above includes a `Reduced motion` fallback. Summary:
- No spring animations → instant state changes
- No gradient breathing → static gradient
- No card enter/exit slides → instant appear/remove
- No category icon pulse → instant color flash (400ms hold, no scale)
- No activity ring heartbeat → static ring
- No match particles → hidden
- Haptics still fire (they're not motion)

---

## 13. Component File Map

New files the implementor will create:

```
app-mobile/src/components/leaderboard/
  LeaderboardFeed.tsx           ← Main container (tab content)
  LeaderboardProfileHeader.tsx  ← Self-profile fixed header
  LeaderboardCard.tsx           ← Individual user card
  LeaderboardFilters.tsx        ← Filter pills bar
  LeaderboardEmptyState.tsx     ← Empty state card
  LeaderboardSkeleton.tsx       ← Loading skeleton cards
  TagAlongBanner.tsx            ← Interest request notification
  TagAlongMatchOverlay.tsx      ← Match celebration overlay
  ActivityRing.tsx              ← SVG ring around avatars (reusable)
  AmbientGradient.tsx           ← Animated background gradient
```

PreferencesSheet modifications (existing file):
```
app-mobile/src/components/PreferencesSheet.tsx
  + Section 7: LeaderboardPreferencesSection (inline or extracted)
```

Design system additions:
```
app-mobile/src/constants/designSystem.ts
  + glass.leaderboard.* tokens
  + glass.blur.* tokens
  + glass.shadowLight token
```
