# DESIGN — ORCH-0815 Marketing Hub UI (Cycle B5 Phase A)

**ORCH:** ORCH-0815
**Mode:** Design pass (pixel-accurate, implementor-buildable)
**Author:** mingla-designer (Claude)
**Date:** 2026-05-12
**Status:** Design lock-in — no further visual decisions required from implementor
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md`
**Tokens authority:** `mingla-business/src/constants/designSystem.ts` (all values resolve there)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 0. How To Use This Document

Every layout below names exact tokens (e.g. `spacing.md`, `text.primary`,
`shadows.glassCardBase`). Implementor MUST resolve those identifiers against
`designSystem.ts` — never hand-code colors or numeric values that bypass the
token. If a value here isn't a token name, it's intentional (e.g. `64px` for
nav height which is component-local, not a system token).

Mingla is **a dark-canvas, glass-surface, warm-accent product.** It is NOT a
light-mode-first app. Marketing inherits this aesthetic — no white backgrounds,
no flat shadows, no system blue. The hub feels like an extension of the
existing Home/Events surfaces.

Every numeric size below is iOS-spec. Android tokens render identically except
`elevation` is zeroed (via `androidSafeElevation`) — the visual effect is
slightly flatter shadows on Android but no rectangle artifacts.

---

## 1. Design Intent (the emotional north star)

When a brand opens the Marketing tab, they should feel **capable**, not
overwhelmed. Mailchimp makes brands feel like an accountant; Klaviyo makes them
feel like a data scientist. Mingla Marketing should make them feel like a
**confident party host with a great guest list** — they know their people, the
tools are right there, the path from "I have an idea" to "it's scheduled" is
under 90 seconds, and the result number ($ revenue) is visible immediately.

Three feelings the design must produce:
1. **Reach is real.** The buyer-count is always visible, always specific.
   Never "your audience" — always "247 buyers — Sunset Rooftop."
2. **Sending feels safe.** Compliance, unsubscribe, "via Mingla" — all
   automatic and locked. Brand never worries about doing something illegal.
3. **Revenue is the headline.** Every campaign report leads with $, not opens
   or clicks. Opens are vanity; revenue is reality.

Personality cues:
- Empty states: warm, action-oriented, never apologetic
- Error states: honest, taking-responsibility, never blaming the user
- CTAs: imperative + specific ("Blast these 247 buyers", not "Send campaign")
- Loading: skeleton shimmer using `accent.tint` pulse — premium, not generic grey

---

## 2. Design Tokens — Locked References

All Marketing surfaces resolve to these tokens. No hand-coded values.

### 2.1 Canvas / Surface

| Surface | Token | Use |
|---|---|---|
| Page background | `canvas.discover` (#0c0e12) | Marketing tab + all sub-screens, brand Customers tab, event Buyers tab |
| Deep canvas (sub-elevation) | `canvas.depth` (#08090c) | Behind glass cards when stacking |
| Composer page | `canvas.profile` (#141113) | Composer has slightly warmer canvas to distinguish from list views |
| Glass card base (lowest) | `glass.tint.profileBase` rgba(255,255,255,0.04) | Standard content cards |
| Glass card elevated | `glass.tint.profileElevated` rgba(255,255,255,0.06) | Hero cards (Revenue hero, audience hero) |
| Glass chrome (sub-nav, bottom-nav) | `glass.tint.chrome.idle` rgba(12,14,18,0.48) | Sticky chrome bars |
| Glass backdrop (sheets, modals) | `glass.tint.backdrop` rgba(12,14,18,0.34) | Bottom sheets, full modals |

### 2.2 Borders / Highlights

| Element | Token |
|---|---|
| Glass card base border | `glass.border.profileBase` rgba(255,255,255,0.08) |
| Glass card elevated border | `glass.border.profileElevated` rgba(255,255,255,0.12) |
| Glass chrome border | `glass.border.chrome` rgba(255,255,255,0.14) |
| Top edge highlight (glass cards) | `glass.highlight.profileBase` (or `…Elevated`) — 1px line at top |
| Accent border (active states) | `accent.border` rgba(235,120,37,0.55) |

### 2.3 Text

| Use | Token | Notes |
|---|---|---|
| Headlines, primary content | `text.primary` rgba(255,255,255,0.96) | h1/h2/h3 always primary |
| Body copy, helper text | `text.secondary` rgba(255,255,255,0.72) | Default for body, sub-labels |
| Captions, meta | `text.tertiary` rgba(255,255,255,0.52) | Timestamps, counts in dim contexts |
| Disabled text, hint | `text.quaternary` rgba(255,255,255,0.32) | Placeholder, disabled labels |
| Inverse (on accent buttons) | `text.inverse` (#ffffff) | Pure white on warm-accent fills |

### 2.4 Accent (warm orange) — used sparingly for emphasis

| Use | Token |
|---|---|
| Primary CTA fill | `accent.warm` (#eb7825) |
| Pressed state on accent surfaces | `accent.warm` + 0.85 opacity overlay |
| Accent tint (spotlight pill, soft highlight) | `accent.tint` rgba(235,120,37,0.28) |
| Accent glow (active emphasis) | `accent.glow` rgba(235,120,37,0.35) |
| Accent border (active tab spotlight) | `accent.border` |

**Use rule:** accent is the BOLD note. Use for primary CTAs, active tab
spotlight, key metric highlight (revenue $ value), and one-element-per-screen
emphasis. Never two accent CTAs on the same screen.

### 2.5 Semantic (state colors)

| State | Token | Tint variant for backgrounds |
|---|---|---|
| Success (delivered, sent OK) | `semantic.success` (#22c55e) | `semantic.successTint` |
| Warning (scheduled past, near-limit) | `semantic.warning` (#f59e0b) | `semantic.warningTint` |
| Error (failed, denied) | `semantic.error` (#ef4444) | `semantic.errorTint` |
| Info (preview mode banner) | `semantic.info` (#3b82f6) | `semantic.infoTint` |

### 2.6 Spacing

All paddings/margins from `spacing` scale: 2 / 4 / 8 / 16 / 24 / 32 / 48.

| Use | Token | Px |
|---|---|---|
| Tight inline gaps | `spacing.xxs` | 2 |
| Sub-row gaps | `spacing.xs` | 4 |
| In-card gaps | `spacing.sm` | 8 |
| Between cards, section internal padding | `spacing.md` | 16 |
| Section gaps, screen edges | `spacing.lg` | 24 |
| Hero spacing | `spacing.xl` | 32 |
| Major page divides | `spacing.xxl` | 48 |

**Screen horizontal padding:** `spacing.md` (16px) on all screens, except
Composer which uses `spacing.lg` (24px) to give content breathing room.

### 2.7 Radius

| Use | Token | Px |
|---|---|---|
| Pills, filter chips | `radius.full` | 999 |
| Cards | `radius.lg` | 16 |
| Hero cards | `radius.xl` | 24 |
| Buttons (primary CTA) | `radius.md` | 12 |
| Tab spotlight | `radius.full` | 999 |
| Modal / sheet | `radius.xxl` | 28 (top corners only) |
| Inline tags | `radius.sm` | 8 |

### 2.8 Shadows

| Use | Token |
|---|---|
| Standard glass card | `shadows.glassCardBase` |
| Hero / elevated card | `shadows.glassCardElevated` |
| Bottom-nav, sub-nav | `shadows.glassChrome` |
| Active tab spotlight | `shadows.glassChromeActive` (orange glow) |
| Modal / sheet | `shadows.glassModal` |
| Inline badge / pill | `shadows.glassBadge` |

### 2.9 Blur intensity

| Surface | Token | Value |
|---|---|---|
| Pills, badges | `blurIntensity.badge` | 24 |
| Bottom-nav, sub-nav | `blurIntensity.chrome` | 28 |
| Sheet backdrop | `blurIntensity.backdrop` | 22 |
| Card base | `blurIntensity.cardBase` | 30 |
| Hero card | `blurIntensity.cardElevated` | 34 |
| Modal | `blurIntensity.modal` | 40 |

### 2.10 Motion

| Use | Token (duration / easing) |
|---|---|
| Press feedback (button scale down) | `durations.instant` (80) / `easings.press` |
| Tap highlight, micro-interactions | `durations.fast` (120) / `easings.out` |
| Tab switch, filter change | `durations.normal` (200) / `easings.inOut` |
| Sheet open | `durations.entry` (260) / spring (damping 18, stiffness 260, mass 0.9) |
| Sheet close | `durations.exit` (180) / `easings.in` |
| Page enter | `durations.slow` (320) / `easings.out` |
| Schedule confirmation choreography | `durations.deliberate` (400) / `easings.out` |
| Skeleton shimmer cycle | `durations.slowest` (800) / `easings.sine` |

**Reduced motion:** all spring animations fall back to `durations.normal` (200) +
`easings.inOut` linear timing. Confirmation choreography reduces to a single
fade-in. Implementor uses `useReducedMotion()` from `react-native-reanimated`
(pattern already in BottomNav).

### 2.11 Typography

Pulled from `typography` token. Use these names in code (not raw sizes).

| Token name | Used for |
|---|---|
| `typography.display` (32/48/700/−0.4) | Revenue hero $ value on Campaign report |
| `typography.h1` (26/32/700/−0.2) | Revenue hero $ value on Overview |
| `typography.h2` (24/36/700/−0.2) | Screen titles (when shown — most use sub-nav instead) |
| `typography.h3` (20/32/600/0) | Section headers ("Recent campaigns", "Your audiences") |
| `typography.bodyLg` (18/28/500/0) | Hero subtitle text |
| `typography.body` (16/24/400/0) | Default body copy |
| `typography.bodySm` (14/20/400/0) | Sub-row meta, dense list items |
| `typography.caption` (12/16/500/0.2) | Counts, percentages, timestamps |
| `typography.micro` (11/14/600/0.4) | "PREVIEW MODE" inline tags |
| `typography.labelCap` (12/16/600/1.4) | UPPERCASE metric labels ("SENT", "DELIVERED") |
| `typography.buttonLg` (16/24/600/0) | Primary CTA button labels |
| `typography.buttonMd` (14/20/600/0.2) | Secondary button labels, filter pills |
| `typography.statValue` (26/32/700/−0.4) | Metric tile numbers (Sent / Delivered / Opened / Clicked) |
| `typography.monoMd` (14/20/500/0) | Tracking IDs (campaign reports — admin-only) |

---

## 3. Icon Assignments

The Mingla icon set (`mingla-business/src/components/ui/Icon.tsx`) has 79
icons. Marketing uses these. **No new icons need to be added.**

### 3.1 Bottom-nav

- **Marketing tab:** `send` (paper-plane). Reasoning: `megaphone` (SPEC default
  proposal) is not in the icon set; `mail` reads as "inbox" not "campaign";
  `send` is the most semantically accurate for "blast/broadcast" and matches
  Mingla's existing visual language. Operator may swap if they prefer `target`
  or `rocket` but `send` is the design recommendation.

### 3.2 Sub-nav (Marketing tab inner segmented control)

Text-only segmented control — NO icons in sub-nav. The four labels
(`Overview · Audiences · Campaigns · Templates`) are tight, readable, and
icons would crowd the chrome capsule. Pattern matches BottomNav typography
style (`typography.caption`, 12pt, weight 600).

### 3.3 Per-screen icons

| Surface | Icon | Token name |
|---|---|---|
| Marketing > Overview headline (revenue hero) | `cash` |
| Metric tile: Sent | `send` |
| Metric tile: Delivered | `check` |
| Metric tile: Opened | `eye` |
| Metric tile: Clicked | `tap` |
| Audience card | `users` |
| Campaign card — scheduled | `clock` |
| Campaign card — sent | `check` |
| Campaign card — draft | `edit` |
| Campaign card — failed | `flag` |
| Composer step 1 (Who) | `users` |
| Composer step 2 (What) | `mail` |
| Composer step 3 (When) | `clock` |
| Composer step 4 (Compliance) | `shield` |
| Channel tabs: Email | `mail` |
| Channel tabs: SMS | `sms` |
| Channel tabs: RCS | `chat` |
| Insert event card action | `calendarPlus` |
| Campaign report: revenue hero | `cash` |
| Campaign report: funnel section | `funnel` |
| Campaign report: clicks section | `tap` |
| Campaign report: conversions sparkline | `trending` |
| Templates list | `template` |
| Brand Customers tab | `users` |
| Event Buyers tab | `users` |
| Customer row: marketing OK | `check` (in green) |
| Customer row: transactional only | `mail` (in tertiary text) |
| Filter sheet trigger | `filter` |
| Empty state (no campaigns) | `rocket` (paired with copy) |
| Empty state (no audiences) | `users` |
| Empty state (no templates) | `template` |
| Preview mode banner | `eye` |

---

## 4. Motion Language (for this surface)

Marketing animations communicate three things:
1. **Affirmation** — "the thing you did worked" (scheduling, saving draft)
2. **Continuity** — "this connects to that" (compose → schedule → history)
3. **Confidence** — "your reach is real" (count animations on audience cards)

### 4.1 Specific motion choreographies

**Bottom-nav 4-tab spotlight (extending existing BottomNav):**
- Spring `damping: 18, stiffness: 260, mass: 0.9` (already implemented in BottomNav.tsx)
- On tab change: spotlight `left` and `width` animate to new active tab
- 4-tab width math: each tab gets `(NAV_WIDTH - 2 * NAV_PADDING_X) / 4`
- Tab icon scale on press: `0.94` for `durations.instant` (80ms), then back to `1.0`
- Active tab icon: full opacity white; inactive: 55% white (existing pattern)

**Sub-nav segmented control (Marketing tab inner):**
- Identical spring config to BottomNav
- Active pill: `accent.tint` background + `accent.border` 1px + `shadows.glassChromeActive`
- Inactive pill: transparent + `text.secondary` label
- Sub-nav height: 44px (matches I-38 touch rule)
- Pill height inside: 36px with `spacing.sm` vertical padding from chrome

**Campaign-card schedule confirmation (the moment of joy):**
- User taps "Schedule" in review modal
- Modal slides down 280ms (`easings.in`)
- New campaign card on /campaigns?status=scheduled list:
  - Fades in over 200ms
  - Scale 0.94 → 1.0 spring (damping 14, stiffness 200)
  - Status icon (clock) rotates from 0° → 360° in 600ms `easings.out`
  - Card border briefly pulses `accent.glow` (200ms in, 400ms out)
- Haptic: medium impact at modal close, light at card settle

**Revenue hero count-up (Overview load):**
- $ value counts up from 0 to actual revenue over 600ms (`easings.out`)
- Delta arrow + percent fades in at 800ms after count completes
- Skeleton shimmer used during loading (see §4.3)

**Metric tile pulse (Overview):**
- On data refresh: tile briefly highlights with `accent.tint` border for 200ms
- Number jumps don't animate (jarring); only the border pulse signals update

**Audience reach update (live):**
- When a new order lands and audience grows: row number increments with
  `durations.normal` (200ms) `easings.out` from old value to new
- No flash, no color change — just a subtle number tick that the user notices peripherally

**Composer step transitions:**
- Composer is single-page (NOT a wizard) — steps don't transition into each other
- BUT: when user taps "Schedule" CTA, the four steps collapse vertically into a single review-modal layout (250ms cascading, 60ms stagger between step collapses)
- Cancel from review: reverse animation, content expands back

**Sheet open / close (audience picker, event picker, filter sheet):**
- Open: backdrop fades 0 → 0.6 alpha over 200ms; sheet slides up 280ms spring
- Close: sheet slides down 180ms `easings.in`; backdrop fades over 200ms
- Drag-down to dismiss: gesture follows finger 1:1; release threshold at 30%
  of sheet height OR velocity > 1000px/s

### 4.2 Hover (web/tablet)

- Cards: subtle scale 1.0 → 1.01 over 120ms; border alpha bumps from `0.08` → `0.14`
- Buttons: brightness +5% over 120ms
- Pressables: opacity 0.7 on press (existing pattern)

### 4.3 Loading states (skeleton shimmer)

- Skeleton row: background `rgba(255,255,255,0.04)` with a 30%-width
  gradient highlight (`accent.tint` at 50% opacity) sweeping left-to-right
  every 1200ms
- Three skeleton instances cycle in waves (60ms stagger) for visual rhythm
- This shimmer treatment is **Mingla-bespoke** — premium feel, brand-consistent

### 4.4 Reduced motion fallbacks

- Spotlight: 200ms linear instead of spring
- Schedule confirmation: card fades in only (no scale, no rotation, no pulse)
- Revenue count-up: value appears instantly, no count animation
- Sheets: 200ms opacity transition only (no slide)
- Skeleton shimmer: replaced with steady-state `rgba(255,255,255,0.04)` block

---

## 5. Bottom-Nav: 4-Tab Specification

### 5.1 Layout math

```
NAV_HEIGHT = 64 (existing)
NAV_PADDING_X = spacing.sm (8) (existing)
NAV_PADDING_Y = spacing.sm (8) (existing)
SPOTLIGHT_HEIGHT = 48 (existing)
TAB_WIDTH = (NAV_INNER_WIDTH) / 4  ← changed from /3
```

### 5.2 Visual changes from existing 3-tab nav

- Each tab is now narrower (75% of current width)
- Label still fits — "Marketing" is 9 characters, same as "Calendar" (which already renders)
- Spotlight pill scales width with tab count automatically
- No structural change to BottomNav.tsx logic — only TABS array adds 4th entry

### 5.3 Tab order — design pick

`Home · Events · Marketing · Account`

Reasoning: Marketing sits between Events (where the brand creates inventory)
and Account (settings, profile). It naturally fits between "the work" and
"the meta". Putting Marketing first or second would feel like demoting Events,
which is still the canonical primary action.

### 5.4 Tab icon + label

```
Marketing tab:
  icon: `send` (paper-plane)
  label: "Marketing"
  active state: full-opacity white icon, weight 600 label, accent spotlight pill behind
  inactive state: 55% opacity icon, weight 500 label
```

### 5.5 Accessibility

- `accessibilityRole="tab"` on each tab Pressable
- `accessibilityLabel="Marketing"` + `accessibilityState={{ selected: active }}`
- Each tab Pressable ≥44pt (achieved via existing 64px nav height + 48px spotlight + 8px padding)

---

## 6. Marketing Hub Shell

Every screen under `/marketing/` shares this shell:

```
┌────────────────────────────────────────┐
│  [glass chrome — sub-nav segmented]     │  ← sticky, top of screen
│  Overview · Audiences · Campaigns · …   │
├────────────────────────────────────────┤
│                                         │
│  [scrollable content]                   │  ← per-screen
│                                         │
│                                         │
│  [FAB: + New campaign] (where applicable)│  ← floating bottom-right
└────────────────────────────────────────┘
│  [BottomNav with Marketing active]      │  ← existing bottom-nav
└────────────────────────────────────────┘
```

### 6.1 Sub-nav segmented control specification

- Component: NEW `MarketingSubNav.tsx`
- Container: GlassChrome wrapper, `radius="full"`, `intensity="chrome"`
- Height: 44px outer, 36px inner pills
- Spacing: `spacing.md` horizontal page margin, `spacing.sm` between pills
- Background: `glass.tint.chrome.idle`, hairline border `glass.border.chrome`
- Active pill: `accent.tint` fill, `accent.border` 1px, `shadows.glassChromeActive`
- Inactive pill: transparent, `text.secondary` label
- Pill labels: `typography.caption` (12pt/600/letter-spacing 0.2)
- Animated spotlight: identical spring config to BottomNav
- Top safe-area inset honored — sub-nav sits below status bar with `spacing.sm` gap

### 6.2 Floating Action Button (FAB)

- Only on Campaigns and Overview screens
- Size: 56pt diameter
- Position: bottom-right, `spacing.lg` (24) from edges, `spacing.xxl + 56` (104) above bottom-nav
- Fill: `accent.warm` (#eb7825)
- Icon: `plus`, 28pt, `text.inverse`
- Shadow: `shadows.glassCardElevated`
- Press: scale 0.94 for 80ms (`easings.press`)
- Accessibility: `accessibilityLabel="New campaign"`, `accessibilityRole="button"`

### 6.3 Page header (for routes without sub-nav, e.g. composer)

- Glass chrome wrapper, full-width, `radius="lg"` (top corners only)
- Left: back chevron (32pt touch target) + screen title
- Right: optional action button(s)
- Height: 56pt
- Background: `glass.tint.chrome.idle`
- Title: `typography.h3` (20/32/600)

---

## 7. Screen Designs

Every screen below specifies: layout, exact dimensions, every state
(loading/empty/error/populated), accessibility, and responsive variants.

### 7.1 Screen: Marketing → Overview

**Route:** `(tabs)/marketing/index.tsx`
**Default sub-tab:** Overview (operator may flip to Campaigns per §15.2 of SPEC)

#### Layout — populated state

```
┌─────────────────────────────────────────┐
│  MarketingSubNav: [●Overview] Aud Camp T│   sticky, sub-nav
├─────────────────────────────────────────┤   spacing.lg padding-top
│                                         │
│  ┌─── Revenue Hero (elevated glass) ───┐│
│  │  💰  REVENUE FROM BLASTS          ↗│ │
│  │      $4,287                        │ │   ← display typo
│  │      ▲ $1,420 vs prior 30 days     │ │   ← caption, semantic.success
│  └────────────────────────────────────┘ │
│                                         │   spacing.lg
│  ┌─ Sent ─┐┌──Deliv──┐┌─Opened─┐┌─Clicked┐│   4 metric tiles in row
│  │  2,341 ││  2,217  ││  1,094 ││   287  ││   each: glass card base
│  │        ││  94.7%  ││  49.3% ││  12.9% ││
│  └────────┘└─────────┘└────────┘└────────┘│
│                                         │   spacing.lg
│  RECENT CAMPAIGNS                        │   ← labelCap, text.tertiary
│  ┌──────────────────────────────────────┐│
│  │ ✉  Last 50 tickets — Sunset Rooftop  ││
│  │    Sent 2 days ago · 247 recipients   ││
│  │    $1,250 revenue · View report →     ││
│  │  ──────────────────────────────────   ││   hairline border between rows
│  │ ✉  Thanks for buying — Garden Brunch ││
│  │    Sent 6 days ago · 89 recipients    ││
│  └──────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘
                                    [+ FAB] ← bottom-right
```

#### Revenue Hero card specifications

- Container: GlassCard variant="elevated" (`glass.tint.profileElevated`)
- Radius: `radius.xl` (24)
- Padding: `spacing.xl` (32) all sides
- Shadow: `shadows.glassCardElevated`
- Border: `glass.border.profileElevated` + top edge highlight
- Min height: 140pt
- Layout: vertical stack, `spacing.xs` between elements
- Cash icon: 32pt, `accent.warm` color, top-left
- Label: `typography.labelCap` (12pt/600/wide-tracked), `text.tertiary`, uppercase, "REVENUE FROM BLASTS"
- Trending arrow (↗): 16pt, `accent.warm`, top-right (only when delta exists)
- $ value: `typography.h1` (26/32/700), `text.primary`
- Delta line: `typography.bodySm` (14/20/400), color depends:
  - Positive delta: `semantic.success` + "▲ $X,XXX vs prior 30 days"
  - Negative delta: `semantic.error` + "▼ $X,XXX vs prior 30 days"
  - Neutral: `text.tertiary` + "No change vs prior 30 days"
- Tap behavior: NONE on hero (it's display-only). Avoid making it tappable —
  it has no obvious destination.

#### Metric tile specifications (4 in row)

- Component: NEW `MetricCard.tsx` (also reusable in Campaign report)
- Container: GlassCard variant="base"
- Width: equal-share row, `spacing.sm` (8) gap between tiles
- Min width per tile: 80pt (4 tiles fit on iPhone SE width = 320pt content)
- Padding: `spacing.md` (16) all sides
- Layout: vertical stack
- Icon: 20pt, `text.secondary`, top-left
- Label: `typography.labelCap` (12pt/600), `text.tertiary`, uppercase
- Value: `typography.statValue` (26/32/700), `text.primary`, `adjustsFontSizeToFit` true
- Sub-percentage (when shown): `typography.caption` (12/16/500), `text.tertiary`
- Skeleton state: width-block at value position pulsing with shimmer

**Responsive — tablet/web:**
- On viewport ≥768pt: row stays 4-across, tile widths grow proportionally
- On viewport <360pt: row scrolls horizontally; tiles 100pt wide

#### Recent Campaigns list

- Section header: `typography.labelCap` "RECENT CAMPAIGNS", `text.tertiary`, uppercase
- Container: GlassCard variant="base", `radius.lg` (16), no internal padding
- Row layout: 3 rows max, each row 76pt tall
- Per-row padding: `spacing.md` (16) horizontal, `spacing.sm` (8) vertical
- Per-row separator: 1px hairline `glass.border.profileBase`, full width (no margin)
- Row content:
  - Status icon (20pt) left, with `spacing.sm` right margin
  - Vertical stack: title (`typography.body`, primary) + meta (`typography.bodySm`, secondary) + revenue ($ in `semantic.success` or "—" in tertiary)
  - Right chevron (`chevR`, 16pt, `text.tertiary`)
- Tap behavior: navigate to `/marketing/campaigns/[id]` report
- Press feedback: row background flash to `glass.tint.profileElevated` for 120ms

#### Empty state

When account has zero campaigns ever AND has buyers:

```
┌─────────────────────────────────────────┐
│         [rocket icon, 48pt accent]      │
│                                         │
│        You have 247 buyers across       │
│             3 brands. Let them          │
│         know about your next event.     │
│                                         │
│         [ + New campaign ] ← primary    │
│                                         │
│       Learn about marketing on Mingla → │
└─────────────────────────────────────────┘
```

- Icon: `rocket`, 48pt, `accent.warm`, top-center
- Headline: `typography.h3`, `text.primary`, center-aligned, 2-line max
- Sub-headline: `typography.bodySm`, `text.tertiary` (only shown if 0 buyers)
- Primary CTA: full-width inside `spacing.lg` page margin, `accent.warm` fill
- Secondary link: text-only, `accent.warm`, opens help URL
- Vertical centering: 40% from top of safe area
- When account has zero buyers AND zero campaigns: headline becomes "You don't have any buyers yet. Audiences fill in as people buy tickets — then you can blast them." (no primary CTA — disabled)

#### Loading state

- Sub-nav renders immediately (it's chrome)
- Revenue hero: skeleton block 140pt tall with shimmer
- Metric row: 4 skeleton tiles with shimmer (60ms stagger)
- Recent campaigns: 3 skeleton rows (60ms stagger)

#### Error state

- Toast banner inserted between sub-nav and content (not blocking content render):
  - Wrapper: absolute positioned per `feedback_toast_needs_absolute_wrap.md`
  - Background: `semantic.errorTint`
  - Border-left: 3px `semantic.error`
  - Padding: `spacing.md`
  - Text: `typography.bodySm`, `text.primary`, "Couldn't load metrics — pull to retry."
  - Dismiss after 4s OR on tap
- Content shows last-cached values if available, OR empty-state structure

#### Accessibility

- Revenue hero: `accessibilityLabel="Revenue from blasts: ${value}, ${delta direction} ${delta value} versus prior 30 days"`
- Metric tiles: `accessibilityLabel="${label}: ${value}${, percentage if present}"`
- Recent campaign rows: `accessibilityLabel="${campaign name}, sent ${date}, ${recipient count} recipients, ${revenue}. Tap to view report."`
- FAB: `accessibilityLabel="New campaign"`, `accessibilityHint="Opens the campaign composer"`

### 7.2 Screen: Marketing → Audiences

**Route:** `(tabs)/marketing/audiences/index.tsx`

#### Layout — populated

```
┌─────────────────────────────────────────┐
│  MarketingSubNav: Over [●Audiences] Camp│
├─────────────────────────────────────────┤
│  YOUR AUDIENCES               [+ New]    │   labelCap header
│                                          │   [+ New] greyed in Phase A
│  ┌──────────────────────────────────────┐│
│  │ 👥  All buyers — Rooftop Club        ││
│  │     412 people · 387 reachable        ││
│  │     Updated live from orders          ││   bodySm tertiary
│  │  ─────────────────────────────────    ││
│  │ 🎫  Buyers — Sunset Rooftop · Sat Apr │ ← icon: ticket
│  │     247 people · 231 reachable        ││
│  │  ─────────────────────────────────    ││
│  │ 🎫  Buyers — Garden Brunch · Sun Apr  ││
│  │     89 people · 84 reachable          ││
│  └──────────────────────────────────────┘│
│                                          │
│  COMING SOON                              │   labelCap tertiary
│  ┌──────────────────────────────────────┐│
│  │ 👤  Brand followers                  ││   ← all greyed
│  │     Available when followers ship    ││
│  │  ─────────────────────────────────    ││
│  │ 📥  Custom segment                   ││
│  │     Phase A+ — build later            ││
│  └──────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

#### Per-row specifications

- Component: NEW `AudienceCard.tsx`
- Row height: 80pt
- Padding: `spacing.md` horizontal, `spacing.sm` vertical
- Icon: 24pt left, `text.secondary` (brand audiences) or `accent.warm` (special)
- Title: `typography.body`, `text.primary`, 1-line max with ellipsis
- Counts: `typography.bodySm`, `text.secondary`. Format:
  - "412 people · 387 reachable" (use `·` middle dot)
- Caption (3rd line): `typography.caption`, `text.tertiary`, "Updated live from orders"
- Right chevron `chevR`, 16pt, `text.tertiary`
- Press: navigate to `/marketing/audiences/[id]`

#### "Coming soon" section

- Same row layout but:
  - Opacity 0.5 on the whole row
  - `Pressable` disabled — no chevron, no tap
  - Caption replaced with status text ("Available when followers ship")
- Section uses `typography.labelCap` "COMING SOON" header in `text.quaternary`

#### Empty state

When account has no events with paid orders (and therefore no audiences):

```
[users icon, 48pt accent]
No buyers yet.
Audiences fill in automatically as people buy tickets.
```

- Icon: `users`, 48pt, `accent.warm`
- Copy: `typography.body`, `text.secondary`, center-aligned, 2 lines
- No CTA (nothing for the brand to do here — they need to sell tickets first)
- Soft microcopy at bottom: "Your event listings → set up the right ticketing first" with `text.tertiary`, tappable to /events

#### Live count update animation

- When audience reach changes (new order lands): number tick animation
  - Old number fades to `text.quaternary` over 80ms
  - New number cross-fades in over 120ms
  - No flash, no color — peripheral notice only

#### Accessibility

- Row: `accessibilityLabel="${audience name}, ${total} people, ${reachable} reachable. Tap to view contacts."`
- Greyed rows: `accessibilityState={{ disabled: true }}` + `accessibilityHint="Available in a future release"`

### 7.3 Screen: Marketing → Audience Detail

**Route:** `(tabs)/marketing/audiences/[id].tsx`

#### Layout — populated

```
┌─────────────────────────────────────────┐
│  ← All buyers — Rooftop Club             │   page header, glass chrome
│  412 people · 387 reachable              │   bodySm secondary
├─────────────────────────────────────────┤
│  [All] [Marketing OK] [No consent]       │   filter pills
├─────────────────────────────────────────┤
│  ┌─ BuyerRow ────────────────────────┐  │   shared with Customers tab
│  │ Alex M.                            │  │
│  │ ale**@gmail.com · 3 orders · $147 │  │
│  │ Last: Sunset Rooftop · 12 days ago│  │
│  │ ✉ marketing OK · 📱 SMS OK         │  │
│  │ ────────────────────────────────   │  │
│  │ ... (24 more rows)                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [ Load more (362 remaining) → ]         │
│                                          │
│  [ Blast these 387 people → ]            │  ← sticky bottom CTA
└─────────────────────────────────────────┘
```

#### Filter pills

- Container: scrollable row, `spacing.sm` (8) between pills, `spacing.md` page margin
- Pill height: 32pt
- Pill width: hugs content + `spacing.md` horizontal padding
- Idle: `glass.tint.profileBase` + `glass.border.profileBase`, `text.secondary` label
- Active: `accent.tint` + `accent.border`, `text.primary` label
- Typography: `typography.buttonMd` (14/20/600/0.2)
- Tap: switches filter, list refreshes with shimmer (no full page reload)

#### BuyerRow specifications (shared component used 3 places)

- Component: NEW `BuyerRow.tsx` — single source per I-PROPOSED-BT
- Row height: 96pt
- Padding: `spacing.md` horizontal, `spacing.sm` vertical
- Layout: vertical stack
  - Line 1: Name in `typography.body` (16/24/400), `text.primary`
  - Line 2: Masked email + orders + spend, `typography.bodySm`, `text.secondary`
    - Format: "ale**@gmail.com · 3 orders · $147 total"
  - Line 3: Last event + relative date, `typography.bodySm`, `text.tertiary`
    - Format: "Last: Sunset Rooftop · 12 days ago"
  - Line 4: Consent state icons + labels, `typography.caption`, `text.secondary`
    - Each consent state: small icon (12pt) + 1-word label
    - "marketing OK" in `semantic.success`; "transactional only" in `text.tertiary`
- Separator: 1px hairline `glass.border.profileBase`, full width
- Press: navigate to customer detail (read-only history with this brand)
- Press feedback: 120ms background flash to `glass.tint.profileElevated`

#### Sticky bottom CTA

- Position: absolute, bottom-anchored above safe-area + bottom-nav
- Background: gradient fade from transparent (top, 40pt) to `canvas.discover` (bottom)
  - This makes the CTA float above the list without a hard line
- CTA button: full-width inside `spacing.md` page margin
- Background: `accent.warm`, `radius.md` (12)
- Height: 52pt
- Label: `typography.buttonLg` (16/24/600), `text.inverse`, center-aligned
- Format: "Blast these 387 people →"
- Count reflects current filter (e.g. tapping "Marketing OK" filter changes 387 → 387; tapping "No consent" changes to "Blast these 25 people →" but in error state — disabled)
- Disabled state: `text.quaternary` text, `glass.tint.profileBase` background, `accessibilityState.disabled`

### 7.4 Screen: Marketing → Campaigns

**Route:** `(tabs)/marketing/campaigns/index.tsx`

#### Layout — populated

```
┌─────────────────────────────────────────┐
│  MarketingSubNav: Over Aud [●Camp] Tmp   │
├─────────────────────────────────────────┤
│  [All] [Scheduled] [Sent] [Drafts] [Fail]│   filter pills
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐ │
│  │ ⏰  Last call — Saturday tickets    │ │   ← scheduled (clock icon)
│  │    Scheduled for Sat 11:00 AM        │ │
│  │    247 recipients                     │ │
│  │    [Edit] [Cancel]                    │ │   secondary actions inline
│  │  ─────────────────────────────────    │ │
│  │ ✉  Last 50 tickets — Sunset Rooftop │ │   ← sent (check icon)
│  │    Sent Tue 6:00 PM · 247 recipients │ │
│  │    49% opened · 13% clicked            │ │
│  │    $1,250 revenue · View report →     │ │
│  │  ─────────────────────────────────    │ │
│  │ 📝  Untitled draft                  │ │   ← draft (edit icon)
│  │    Saved 12 min ago                   │ │
│  │    No audience selected               │ │
│  │    [Resume]                            │ │
│  │  ─────────────────────────────────    │ │
│  │ ⚠  Birthday blast — Rooftop          │ │   ← failed (flag icon)
│  │    Failed Tue 3:42 PM                 │ │
│  │    Resend domain not verified         │ │   ← error in semantic.error
│  │    [Retry] [Delete]                    │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                                    [+ FAB]
```

#### Filter pills

Identical specs to §7.3 filter pills. 5 pills: All / Scheduled / Sent / Drafts / Failed.

#### Per-campaign-row specifications

- Component: NEW `CampaignCard.tsx`
- Row min-height: 108pt (taller than audience row because more meta)
- Padding: `spacing.md` horizontal, `spacing.sm` vertical
- Layout: vertical stack
  - Header line: status icon (20pt) + campaign name (`typography.body`, `text.primary`)
  - Status icon colors:
    - Scheduled: `accent.warm`
    - Sent: `semantic.success`
    - Draft: `text.tertiary`
    - Failed: `semantic.error`
  - Meta lines: `typography.bodySm`, `text.secondary`
  - Revenue line (sent only): `typography.bodySm`, `text.primary` (revenue $) + "View report →" link in `accent.warm`
  - Error line (failed only): `typography.bodySm`, `semantic.error`
  - Action buttons row at bottom: secondary buttons (defined below)

#### Inline secondary buttons (per row)

- Component: existing `Button` with `variant="ghost"` (or new variant if not present)
- Height: 36pt
- Padding: `spacing.md` horizontal
- Background: `glass.tint.profileBase`, `radius.full`
- Border: `glass.border.profileBase`
- Label: `typography.buttonMd`, `text.secondary`
- Pressed: background `glass.tint.profileElevated`
- Destructive ("Cancel", "Delete"): label color `semantic.error`, otherwise same shape

#### Empty state (no campaigns)

```
[rocket icon, 48pt accent]
Your first campaign starts here.
You have 247 buyers waiting for the next event.
[ + New campaign ]  ← primary CTA
```

(Same shape as Overview empty state.)

#### Accessibility

- Campaign row: `accessibilityLabel="${name}, ${status}. ${meta line}. ${revenue if sent}."`
- Inline buttons: `accessibilityLabel="${action} ${campaign name}"`

### 7.5 Screen: Marketing → Composer (THE most important screen)

**Route:** `(tabs)/marketing/campaigns/compose.tsx`
**Canvas:** `canvas.profile` (#141113) — slightly warmer to distinguish from list views

#### Layout — full composer (vertical, mobile)

```
┌─────────────────────────────────────────┐
│ ← New campaign            [Save draft]   │   page header
├─────────────────────────────────────────┤
│                                          │
│  1 · WHO                                 │   step header
│  ┌──────────────────────────────────────┐│
│  │  Audience                             ││
│  │  ┌────────────────────────────────┐  ││
│  │  │ Buyers — Sunset Rooftop · Sat ▾│  ││   ← BottomSheet picker
│  │  └────────────────────────────────┘  ││
│  │  247 people · 231 with marketing OK   ││
│  └──────────────────────────────────────┘│
│                                          │
│  2 · WHAT                                │
│  ┌──────────────────────────────────────┐│
│  │  Channel                              ││
│  │  [✉ Email] [📱 SMS·pend] [💬 RCS·pend]││   ← ChannelTabs
│  │                                       ││
│  │  Subject                              ││
│  │  ┌────────────────────────────────┐  ││
│  │  │ Last 50 tickets — see you Sat  │  ││   ← Input
│  │  └────────────────────────────────┘  ││
│  │                                       ││
│  │  Message                              ││
│  │  ┌────────────────────────────────┐  ││
│  │  │ Hi {first_name},               │  ││   ← multiline Input
│  │  │                                 │  ││
│  │  │ Just a heads up — only 50      │  ││
│  │  │ tickets left for Sunset Rooftop│  ││
│  │  │ on Saturday. See you there.    │  ││
│  │  │                                 │  ││
│  │  │ {{event:abc}}                  │  ││   ← event card token
│  │  │                                 │  ││
│  │  └────────────────────────────────┘  ││
│  │                                       ││
│  │  [+ Insert event card]                ││   ← inline action button
│  │                                       ││
│  │  [Preview email →]                    ││   ← opens preview sheet
│  └──────────────────────────────────────┘│
│                                          │
│  3 · WHEN                                │
│  ┌──────────────────────────────────────┐│
│  │  ○ Send now                           ││
│  │  ● Schedule                           ││
│  │    [Sat Apr 27, 11:00 AM ▾]           ││   ← DateTimePicker
│  │    Buyers' local time · best 10am–2pm ││   ← helper
│  └──────────────────────────────────────┘│
│                                          │
│  4 · COMPLIANCE  🔒                      │   step header with lock
│  ┌──────────────────────────────────────┐│
│  │  From: Rooftop Club via Mingla        ││
│  │  Reply-to: hello@rooftopclub.com      ││
│  │  Unsubscribe: link added automatically ││
│  │  Brand address: 123 Main St, ...      ││
│  │                                       ││
│  │  ℹ Your buyers can opt out anytime — ││
│  │    Mingla honors this across brands.  ││
│  └──────────────────────────────────────┘│
│                                          │
├─────────────────────────────────────────┤
│  [Save draft]    [Review & schedule →]  │   sticky footer
└─────────────────────────────────────────┘
```

#### Page header

- Glass chrome wrapper, `radius="lg"` top corners
- Height: 56pt
- Padding: `spacing.md`
- Left: back chevron (`arrowL`, 24pt, `text.primary`) + "New campaign" (`typography.h3`)
- Right: "Save draft" text button (`typography.buttonMd`, `accent.warm`)
- Save-draft button is disabled until any field is dirty (`text.quaternary` when disabled)

#### Step header pattern (repeats for steps 1–4)

- Label: `typography.labelCap` (12/16/600/letter-spacing 1.4), uppercase
- Color: `accent.warm` (step number in accent) + `text.primary` (step name)
- Format: "1 · WHO" — number is `accent.warm`, separator and name are `text.primary`
- Step 4 includes a small lock icon (`shield`, 14pt, `text.tertiary`) to signal read-only

#### Step container (each step)

- GlassCard variant="base", `radius.lg` (16)
- Padding: `spacing.md` (16) all sides
- Margin between steps: `spacing.lg` (24)
- Internal spacing: `spacing.sm` (8) between sub-elements

#### Step 1 specifications: WHO

- Sub-label "Audience": `typography.bodySm`, `text.secondary`
- Audience picker: full-width Pressable
  - Height: 52pt
  - Background: `glass.tint.profileBase`
  - Border: `glass.border.profileBase` 1px
  - `radius.md` (12)
  - Content: selected audience name (left) + `chevD` icon (right, 16pt)
  - Empty state: "Choose an audience" in `text.quaternary`
  - Press: opens `AudiencePickerSheet`
- Reach line below picker: `typography.caption`, `text.secondary`
  - Format: "247 people · 231 with marketing consent"
  - Pre-fill from query param shows immediately

#### AudiencePickerSheet specifications

- Component: NEW `AudiencePickerSheet.tsx`
- Rendered INSIDE parent Sheet per `feedback_rn_sub_sheet_must_render_inside_parent.md`
- Modal-style bottom sheet
- Backdrop: full-screen `glass.tint.backdrop`, fades 200ms
- Sheet: anchored bottom, `radius.xxl` top corners only, `glass.tint.profileElevated` background, full `blurIntensity.modal`
- Max height: 70% of screen
- Drag handle: 36pt wide × 4pt tall, `glass.border.profileBase`, top-center, 8pt from top
- Title: "Choose audience", `typography.h3`, `text.primary`, `spacing.md` horizontal padding
- List: audience rows (same `AudienceCard.tsx` component)
- Tap row: closes sheet with `durations.exit` + writes audience to composer state

#### Step 2 specifications: WHAT (the meat)

- Sub-label "Channel": `typography.bodySm`, `text.secondary`
- ChannelTabs (NEW component):
  - 3 tabs visible from day one (I-PROPOSED-BS invariant)
  - Email enabled: glass.tint.chrome.idle background, `text.primary` label, `mail` icon
  - SMS/RCS disabled: same shape, opacity 0.5, label appends "· pending", `accessibilityState.disabled`
  - Active tab (Email always in Phase A): `accent.tint` background, `accent.border`, `accent.warm` icon
  - Height: 40pt
  - Each tab: 33% width minus gaps
- Sub-label "Subject" with input:
  - Input height: 48pt
  - `glass.tint.profileBase` background, `glass.border.profileBase` 1px, `radius.md`
  - Placeholder: "What's this campaign about?" in `text.quaternary`
  - Value: `typography.body`, `text.primary`
  - Padding: `spacing.md` horizontal, `spacing.sm` vertical
  - Character counter at bottom-right (when nearing 60-char preview limit): `typography.caption`, `text.tertiary`
- Sub-label "Message" with multiline input:
  - Height: minimum 120pt, grows up to 320pt
  - Same styling as subject
  - Placeholder: "Hi {first_name}, ..." in `text.quaternary`
  - Variable tokens (`{first_name}`, `{event_name}`, etc.) render in `accent.warm` color inline as the user types
  - Event-card tokens (`{{event:abc}}`) render as a small inline tag in `accent.tint` background
- "[+ Insert event card]" button:
  - Component: ghost button (existing pattern)
  - Height: 40pt
  - Width: hugs content
  - `accent.warm` text, `glass.border.profileBase` border
  - On press: opens `EventCardInserter` sheet
- "[Preview email →]" link:
  - Text-only button, `accent.warm`, `typography.bodySm`
  - On press (mobile): opens preview as sub-sheet
  - On press (tablet/web ≥768pt): the preview pane is ALREADY rendered side-by-side; this button scrolls to it

#### EmailPreviewPane specifications

- Component: NEW `EmailPreviewPane.tsx`
- Mobile: rendered inside a sub-sheet (60% screen height, drag-to-dismiss)
- Tablet/web (viewport ≥768pt): rendered as fixed right pane, 40% of viewport width
- Background: `glass.tint.profileElevated`, `radius.lg`
- Header: shows "From: ${Brand name} via Mingla", subject preview, in `typography.caption`
- Body: renders email HTML in a sandboxed WebView with Mingla's email template wrapper:
  - Mingla logo at top
  - Brand cover image (if event card embedded)
  - Subject as H1
  - Body with variable substitution (use first ticket buyer's name as preview)
  - Event card if embedded
  - Mingla footer with unsubscribe link
- Live update: re-renders on every keystroke (debounce 200ms)
- Loading state: skeleton block 240pt tall

#### Step 3 specifications: WHEN

- Radio group (custom-styled to match Mingla):
  - "Send now" radio: 44pt row
    - Radio circle: 20pt, `glass.border.profileBase`. When selected: filled `accent.warm` with white inner dot
    - Label: `typography.body`, `text.primary`
    - Tap target: full row
  - "Schedule" radio: 44pt row, same styling
- When "Schedule" selected:
  - DateTimePicker reveals below with `durations.normal` slide-down
  - Picker: native iOS/Android picker triggered by tap on a styled Pressable
  - Pressable: full-width, 52pt, same styling as audience picker
  - Format: "Sat Apr 27, 11:00 AM" in `typography.body`
  - On tap: opens native picker (iOS modal, Android inline)
- Helper text: `typography.caption`, `text.tertiary`
  - "Buyers' local time · best between 10am–2pm" (this text reflects per-recipient TZ being Phase A+ — for Phase A it's "Brand's local time")

#### Step 4 specifications: COMPLIANCE (read-only)

- Header with lock icon (small `shield`, `text.tertiary`)
- Container: same GlassCard variant="base" but with reduced internal contrast (0.5 alpha overlay)
- 4 rows of static text:
  - "From: ${Brand name} via Mingla" — `typography.bodySm`, `text.primary`
  - "Reply-to: ${brand reply email}" — `typography.bodySm`, `text.secondary`
  - "Unsubscribe: link added automatically" — `typography.bodySm`, `text.secondary`
  - "Brand address: ${brand address}" — `typography.bodySm`, `text.tertiary`
- Info box at bottom:
  - Background: `semantic.infoTint`, `radius.sm`, `spacing.sm` padding
  - Icon: `info` or small `shield`, 14pt, `semantic.info`
  - Text: `typography.caption`, `text.secondary`
  - "Your buyers can opt out anytime — Mingla honors this across all your brands."

#### Sticky footer

- Component: glass chrome wrapper, top-edge highlight, bottom-pinned above safe-area
- Height: 64pt
- Padding: `spacing.md`
- Layout: 2-button row
  - Left button "Save draft": ghost button, `text.secondary`, full half-width minus gap
  - Right button "Review & schedule →": primary `accent.warm`, full half-width
  - Gap between: `spacing.sm`
- Primary button disabled state: `text.quaternary` text, `glass.tint.profileBase` background, when:
  - No audience selected
  - Subject empty
  - Body empty
  - "Schedule" selected but no time chosen
- Save-draft also disabled until any field is dirty

#### Review modal (after tapping "Review & schedule")

- Modal sheet, full glass treatment
- Backdrop fades in 200ms
- Sheet slides up from bottom 280ms spring
- Content:
  - Header: "Ready to schedule?" (`typography.h2`, `text.primary`)
  - Audience summary: "247 people will receive this campaign"
  - Email preview thumbnail (tappable to expand)
  - Schedule time prominently displayed: `typography.bodyLg`, `text.primary`, `accent.warm` for the time portion
  - Compliance summary (compact)
  - Sticky bottom: [Back to edit] (ghost) + [Schedule] (primary `accent.warm`)
- On "Schedule": triggers schedule-confirmation choreography per §4.1

#### Sent confirmation (transient overlay)

- Full-screen overlay on top of /marketing/campaigns route
- Center vertical content:
  - Animated checkmark icon (24pt, `semantic.success`, draws over 600ms)
  - Headline: "Your campaign is scheduled" or "Your campaign is sending now" — `typography.h2`
  - Sub-line: "Saturday at 11:00 AM · 247 recipients" — `typography.body`, `text.secondary`
  - Single CTA: "[View in campaigns]" — text-only `accent.warm`
- Auto-dismisses after 3s OR on tap CTA
- Background: `glass.tint.backdrop` full-screen
- Haptic: medium impact on appear, light on dismiss

#### Composer keyboard handling

- Per `feedback_keyboard_never_blocks_input.md`:
  - Keyboard listener added on mount
  - Dynamic `paddingBottom` increases with keyboard height
  - On focus of any TextInput: `requestAnimationFrame` then `scrollToEnd` if needed
  - Subject input never blocked
  - Body input always visible above keyboard with extra padding for autocorrect bar

#### Composer dirty-state back-block

- Per `feedback_back_listener_disarm_pattern.md`:
  - `useRef<boolean>` `dirtyRef` flips true on first field change
  - `navigation.beforeRemove` listener:
    - If `dirtyRef.current === true`: prevent default + show ConfirmDialog ("Save draft? · Discard · Cancel")
    - Each option flips `dirtyRef` false before allowing exit
  - Same pattern for web `popstate`

### 7.6 Screen: Marketing → Campaign Report

**Route:** `(tabs)/marketing/campaigns/[id].tsx`

#### Layout

```
┌─────────────────────────────────────────┐
│  ← Last 50 tickets — Sunset Rooftop      │   page header
│  Sent Tue Apr 23 at 6:00 PM              │   bodySm secondary
├─────────────────────────────────────────┤
│                                          │
│  ┌─ Revenue Hero (XL) ─────────────────┐ │
│  │  💰  CAMPAIGN REVENUE                │ │
│  │      $1,250                          │ │   ← display typography
│  │      10 conversions · $125 avg       │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  FUNNEL                                  │
│  ┌──────┐┌──────┐┌──────┐┌──────┐        │   metric tiles
│  │ 247  ││ 234  ││ 115  ││ 32   │        │
│  │ Sent ││ Deliv││Opened││Click │        │
│  │ 100% ││94.7% ││49.1% ││13.7% │        │
│  └──────┘└──────┘└──────┘└──────┘        │
│                                          │
│  CLICK DESTINATIONS                      │
│  ┌────────────────────────────────────┐  │
│  │ Event page              ▓▓▓▓▓▓▓ 22 │  │   horizontal bar chart
│  │ Checkout                ▓▓▓▓ 10    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  CONVERSIONS OVER TIME                   │
│  ┌────────────────────────────────────┐  │
│  │   [sparkline 24h hourly purchases] │  │
│  │                                     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  TOP BUYERS FROM THIS CAMPAIGN           │
│  ┌────────────────────────────────────┐  │
│  │ Alex M.       $50   Sat 12:14 PM   │  │
│  │ Maya R.       $25   Sat 1:08 PM    │  │
│  │ Devon P.      $50   Sun 9:42 AM    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [Duplicate]      [Save as template]     │   footer actions
└─────────────────────────────────────────┘
```

#### Revenue Hero (Campaign Report variant)

- Same structure as Overview hero but:
  - Uses `typography.display` (32pt) for $ value — bigger because this is THE result
  - Sub-line shows conversions count + avg: `typography.body`, `text.secondary`
  - No delta arrow (campaign-scoped, not period-scoped)

#### Funnel section

- Same 4 metric tiles as Overview
- Section header: `typography.labelCap` "FUNNEL", `text.tertiary`

#### Click destinations bar chart

- Section header: `typography.labelCap` "CLICK DESTINATIONS"
- Container: GlassCard variant="base"
- Per-bar row:
  - URL or label: `typography.bodySm`, `text.primary`, left-aligned, max 60% width
  - Bar fill: `accent.warm` solid, height 8pt, `radius.sm`
  - Bar width: proportional to clicks vs max
  - Count: `typography.caption`, `text.secondary`, right-aligned
- Max 5 bars; if more click destinations exist, show "View all clicks →" link

#### Conversions sparkline

- Section header: `typography.labelCap` "CONVERSIONS OVER TIME"
- Container: GlassCard variant="base", height 120pt
- Sparkline: 24 data points (hourly), color `accent.warm`
- Use `react-native-svg` Path component, NOT a chart library — keep dependencies tight
- Y-axis: implicit, 0 to max conversions in any single hour
- X-axis: implicit, 24h from sent time
- Hover/tap dots show exact value (web only — mobile uses overall trend)
- Skeleton: shimmer block 120pt tall

#### Top buyers list

- Section header: `typography.labelCap` "TOP BUYERS FROM THIS CAMPAIGN"
- Container: GlassCard variant="base"
- Row layout: 3-column flex
  - Name: `typography.body`, `text.primary`, 40% width
  - Amount: `typography.body` semibold, `semantic.success`, 25% width
  - Timestamp: `typography.bodySm`, `text.tertiary`, 35% width right-aligned

#### Footer actions

- 2-button row at bottom of scroll
- "[Duplicate]" — ghost button, `text.secondary`
- "[Save as template]" — ghost button, `accent.warm`
- Width: equal split

#### Empty data states (per-section)

- 0 conversions: hide hero $ value section, replace with friendly card:
  - Icon: `funnel`, 32pt, `text.tertiary`
  - Headline: "No purchases yet from this blast." — `typography.body`, `text.secondary`
  - Sub: "Most events convert in 24–48 hours. Check back tomorrow."
- 0 opens: show funnel with all zeros + microcopy in tertiary text "Awaiting delivery — Resend reports within ~5 minutes."
- Preview mode (MARKETING_SEND_LIVE_ENABLED=false):
  - Banner at top: `semantic.infoTint` background, "PREVIEW MODE — no real email was sent" in `typography.micro`, `text.primary`

### 7.7 Screen: Brand → Customers Tab

**Route:** `mingla-business/app/brand/[id]/customers.tsx`
**Tab in brand strip:** appears as 4th tab after Overview/Events/Team (before Settings)

#### Layout — populated

```
┌─────────────────────────────────────────┐
│  ← Rooftop Club                          │   existing brand page header
│                                          │
│  Overview · Events · Team · [Customers] ·│   existing brand tab strip
│  Settings                                │   Customers is NEW
├─────────────────────────────────────────┤
│  412 customers · 387 reachable           │   bodyLg, text.primary
│  [ Blast these 387 customers → ]         │   sticky primary CTA
├─────────────────────────────────────────┤
│  [All] [This year] [▾ Filter]            │   filter pills
├─────────────────────────────────────────┤
│  ┌─ BuyerRow ───────────────────────┐   │
│  │ Alex M.                          │   │
│  │ ale**@gmail.com · 3 orders · $147│   │
│  │ Last: Sunset Rooftop · 12d ago   │   │
│  │ ✉ marketing OK · 📱 SMS OK        │   │
│  │ ───────────────────────────────  │   │
│  │ ... (24 more rows)               │   │
│  └──────────────────────────────────┘   │
│                                          │
│  [ Load more (362 remaining) → ]         │
└─────────────────────────────────────────┘
```

#### Counts header

- Format: "412 customers · 387 reachable"
- Typography: `typography.bodyLg` (18/28/500), `text.primary`
- Padding: `spacing.md` horizontal, `spacing.sm` vertical
- Sticky CTA directly below

#### Sticky CTA

- Same specifications as §7.3 sticky CTA
- Format: "Blast these 387 customers →"
- Disabled when reachable count = 0

#### Filter pills

Same specs as §7.3. Three pills in Phase A: All / This year / ▾ Filter (opens sheet).

#### Filter sheet (NEW BuyerFilterSheet)

- Component: NEW `BuyerFilterSheet.tsx`
- Bottom sheet, parent-sheet rule
- Sections:
  - Event filter (multi-select chips, scrollable horizontally)
  - Date range (preset: Last 30 days / Last 90 days / This year / All time / Custom)
  - Consent state (checkboxes: Marketing OK / SMS OK / Transactional only)
  - Spend range (slider: $0 — max)
- Footer:
  - "Reset" link (text-only, `text.secondary`)
  - "Apply (showing N)" primary button (`accent.warm`)
- Live count updates as filters change

#### Customer rows

- Use shared `BuyerRow.tsx` (single source — I-PROPOSED-BT)
- 25/page pagination
- Press: navigate to customer detail screen (read-only history with this brand)

#### Empty states

- No buyers yet: same shape as Audiences empty state
- Filter results in 0: "No customers match these filters." + "Reset filters →" link

#### Permissions

- Tab visible to anyone with `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('brand_member')`
- "Blast these N customers" CTA visible only if `>= biz_role_rank('event_manager')`
- Lower-rank users see the CTA disabled with tooltip "Ask a brand manager to send campaigns" (on long-press or tap)

### 7.8 Screen: Event → Buyers Tab

**Route:** `mingla-business/app/event/[id]/buyers/index.tsx`
**Tab in event strip:** appears in existing event sub-nav

#### Layout

```
┌─────────────────────────────────────────┐
│  ← Sunset Rooftop · Sat Apr 27          │   existing event header
│                                          │
│  Overview · Orders · Guests · [Buyers] · │   existing event tab strip
│  Scanner · ...                           │
├─────────────────────────────────────────┤
│  247 buyers · 231 reachable              │
│  [ Blast these 231 buyers → ]            │
├─────────────────────────────────────────┤
│  [All] [▾ Ticket type] [▾ Filter]        │   filter pills
├─────────────────────────────────────────┤
│  [BuyerRow × N — shared component]       │
│                                          │
│  [ Load more → ]                         │
└─────────────────────────────────────────┘
```

Same component layout as §7.7 — `BuyerRow` is shared.

Differences:
- Counts scoped to one event
- Filter pills scope to this event's ticket types (Standard / VIP / Door / etc.)
- "Blast these N buyers" CTA pre-fills audience = `event:[id]`

### 7.9 Screen: Marketing → Templates

**Route:** `(tabs)/marketing/templates/index.tsx`

#### Layout

```
┌─────────────────────────────────────────┐
│  MarketingSubNav: Over Aud Camp [●Templ]│
├─────────────────────────────────────────┤
│  YOUR TEMPLATES                  [+ New]│
│  ┌────────────────────────────────────┐ │
│  │ 📝  Last call — N spots left       │ │
│  │     Used 3 times                    │ │
│  │  ─────────────────────────────────  │ │
│  │ 📝  Thanks for buying              │ │
│  │     Used 1 time                     │ │
│  └────────────────────────────────────┘ │
│                                          │
│  MINGLA STARTER PACK                     │
│  ┌────────────────────────────────────┐ │
│  │ ⭐ Last call                       │ │
│  │ ⭐ Pre-event reminder (24h)        │ │
│  │ ⭐ Thank you for coming            │ │
│  │ ⭐ Similar upcoming event          │ │
│  │ ⭐ Re-engagement                   │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                                    [+ FAB]
```

#### TemplateCard specifications

- Component: NEW `TemplateCard.tsx`
- Row height: 72pt
- Icon: 24pt left
  - User templates: `template`, `text.secondary`
  - Starter pack: `star`, `accent.warm`
- Title: `typography.body`, `text.primary`
- Sub: usage count for user templates / template description for starter pack, `typography.bodySm`, `text.tertiary`
- Right chevron
- Press: navigate to template detail

#### Empty state (user templates)

- No empty state for "YOUR TEMPLATES" section — it just doesn't render if 0 user templates exist
- Starter pack always renders (5 seeded by migration)

### 7.10 Screen: Marketing → Template Detail

**Route:** `(tabs)/marketing/templates/[id].tsx`

Similar to Composer Step 2 in shape but simpler:
- Subject input
- Body input with variable placeholders + insert event card action
- Helper at bottom listing supported variables: `{first_name}`, `{event_name}`, `{event_date}`, `{brand_name}`, `{event_url}`
- Save button (primary `accent.warm`) — disabled until dirty
- "Use this template" primary CTA → navigates to composer with `?template=[id]` query param
- For user templates: also show "Delete" (destructive ghost) and "Duplicate" (ghost) buttons
- For starter pack: only "Use this template" (no edit / delete)

---

## 8. Shared Components — Full Specs

### 8.1 `MarketingSubNav.tsx`

```typescript
interface Props {
  active: 'overview' | 'audiences' | 'campaigns' | 'templates';
  onChange: (id: string) => void;
}
```

- GlassChrome wrapper, `radius="full"`, `intensity="chrome"`
- 4 pills (text-only), animated spotlight identical to BottomNav
- Sticky at top of `/marketing/*` routes
- Height: 44pt outer, 36pt inner
- Spring spotlight config: damping 18, stiffness 260, mass 0.9
- Reduced motion: 200ms timing

### 8.2 `MetricCard.tsx`

```typescript
interface Props {
  icon: IconName;
  label: string;
  value: string | number;
  percent?: string;
  loading?: boolean;
  testID?: string;
}
```

- GlassCard base, `radius.lg`
- Width: flex-1 in row, min 80pt
- Padding `spacing.md`
- 3-row vertical stack: icon | label | value | percent
- Skeleton shimmer when loading

### 8.3 `CampaignCard.tsx`

```typescript
interface Props {
  campaign: Campaign;  // typed shape per SPEC §6.4
  onPress: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
  onViewReport?: () => void;
}
```

Per §7.4 specifications.

### 8.4 `AudienceCard.tsx`

Per §7.2 specifications.

### 8.5 `AudiencePickerSheet.tsx`

Per §7.5 specifications.

### 8.6 `ChannelTabs.tsx`

```typescript
interface Props {
  active: 'email' | 'sms' | 'rcs';
  onChange: (channel: string) => void;
  enabledChannels: ('email' | 'sms' | 'rcs')[];
}
```

- 3 tab pills in row (NEVER hidden — I-PROPOSED-BS)
- Each: icon + label
- Disabled tabs: opacity 0.5, label appends "· pending", `accessibilityState.disabled`
- Active tab: `accent.tint` background + `accent.border`

### 8.7 `BuyerRow.tsx`

SINGLE source per I-PROPOSED-BT. Used in:
- Audience detail (§7.3)
- Brand Customers tab (§7.7)
- Event Buyers tab (§7.8)

Per §7.3 specifications.

### 8.8 `BuyerFilterSheet.tsx`

Per §7.7 specifications.

### 8.9 `EmailPreviewPane.tsx`

Per §7.5 specifications. WebView-based render.

### 8.10 `EventCardInserter.tsx`

```typescript
interface Props {
  brandId: string;
  onSelect: (eventId: string) => void;
  onClose: () => void;
}
```

- Sub-sheet (inside composer parent Sheet)
- Lists brand's events with status='draft' or 'published'
- Per-row: event cover thumbnail + name + date + status
- Tap: returns event ID, inserts `{{event:[id]}}` token into body at cursor

### 8.11 `CampaignReportHero.tsx` / `CampaignReportFunnel.tsx` / `CampaignReportSparkline.tsx`

Per §7.6 specifications.

### 8.12 `TemplateCard.tsx`

Per §7.9 specifications.

### 8.13 `BlastCustomersCta.tsx`

```typescript
interface Props {
  audienceId?: string;  // pre-fill query param
  audienceKind: 'brand' | 'event';
  audienceTargetId: string;
  reachableCount: number;
  disabled?: boolean;
}
```

- Sticky bottom-anchored button (per §7.3, §7.7, §7.8 sticky CTA)
- Width: full minus `spacing.md` page margin
- Height: 52pt
- Format: "Blast these ${reachableCount} ${unit} →"
  - unit = "customers" for brand context, "buyers" for event context, "people" for audience detail
- Background: `accent.warm`
- Disabled when reachableCount = 0 or user lacks event_manager rank

---

## 9. Empty / Loading / Error State Catalog

Consolidates all the per-screen states for design system consistency.

### 9.1 Empty states

| Screen | When | Icon | Headline | Sub | CTA |
|---|---|---|---|---|---|
| Overview | 0 campaigns ever | rocket | "Your first campaign starts here." | "You have N buyers waiting for the next event." | "[+ New campaign]" |
| Overview | 0 buyers AND 0 campaigns | rocket (faded) | "You don't have any buyers yet." | "Audiences fill in as people buy tickets — then you can blast them." | "View events →" (links to events tab) |
| Audiences | 0 audiences (no events with paid orders) | users | "No buyers yet." | "Audiences fill in automatically as people buy tickets." | "View events →" |
| Audience detail | Filter returns 0 | filter | "No people match these filters." | — | "[Reset filters]" |
| Campaigns | 0 campaigns | rocket | "Your first campaign starts here." | "You have N buyers waiting for the next event." | "[+ New campaign]" |
| Campaigns (filter) | Filter returns 0 | search | "No campaigns match this filter." | — | "[Show all]" |
| Templates | 0 user templates | template | (none — section just doesn't render) | — | (Mingla starter pack always shows below) |
| Brand Customers | 0 customers | users | "No customers yet." | "When people buy tickets to your events, they appear here." | "[Create event →]" |
| Event Buyers | 0 buyers | users | "No buyers yet." | "When tickets sell, buyers show up here." | "[View event details →]" |

### 9.2 Loading states

All loading states use the **skeleton shimmer** treatment from §4.3:
- Base color: `rgba(255,255,255,0.04)` block
- Shimmer sweep: 30%-width `accent.tint` 50% opacity gradient, left-to-right every 1200ms
- Stagger: 60ms between sibling skeletons

Pattern for each screen:

| Screen | Skeleton structure |
|---|---|
| Overview | 1 hero block (140pt) + 4 metric tiles + 3 list rows |
| Audiences | 4-row skeleton list |
| Audience detail | header counts skeleton + 8-row buyer list |
| Campaigns | 4-row campaign list with status icon placeholder |
| Composer | (no skeleton — composer fields show empty) |
| Campaign report | hero (140pt) + funnel row + bar chart (120pt) + sparkline (120pt) + top-buyers list (3 rows) |
| Brand Customers | header counts + 8-row buyer list |
| Event Buyers | header counts + 8-row buyer list |
| Templates | 3-row user templates + 5-row starter pack |

### 9.3 Error states

Two patterns:

**Pattern A — Inline error toast (non-blocking):**
- Used when error doesn't prevent screen render (e.g., metrics fail but cached values available)
- Wrapper: absolute-positioned per `feedback_toast_needs_absolute_wrap.md`
- Background: `semantic.errorTint`
- Border-left: 3px `semantic.error`
- Padding: `spacing.md`
- Layout: icon (`bell` or `flag`, 16pt, `semantic.error`) + text + dismiss X
- Text: `typography.bodySm`, `text.primary`
- Dismiss: auto after 4s OR on tap
- Mingla-voice example copy:
  - Network: "We're not getting through to the server. Pull to retry."
  - Permission: "You don't have access to this campaign. Ping a brand manager."
  - Generic: "Something went sideways. We're looking at it."

**Pattern B — Full error state (blocking):**
- Used when error prevents screen render entirely (e.g., campaign-not-found 404)
- Center-vertical content:
  - Icon (`close` circle, 48pt, `semantic.error`)
  - Headline: "Couldn't find that campaign." `typography.h2`
  - Sub: "It may have been deleted. Tap below to go back."
  - Primary CTA: "[Back to campaigns]"

### 9.4 Preview mode banner (Phase A specific)

When `MARKETING_SEND_LIVE_ENABLED=false`:

- Persistent banner at the top of every Marketing screen (below sub-nav)
- Background: `semantic.infoTint`
- Border-bottom: 1px `semantic.info`
- Height: 32pt
- Padding: `spacing.md` horizontal
- Layout: small `eye` icon (12pt, `semantic.info`) + text + small "?" tooltip trigger
- Text: `typography.micro` (11/14/600/letter-spacing 0.4), `text.secondary`, UPPERCASE
- Copy: "PREVIEW MODE — DRAFTS ARE SAVED BUT NOT SENT YET"
- Tap "?" opens a Sheet explaining:
  - "Marketing is in preview while production checkout finalises. Your audiences fill in as tickets sell, and you can compose and schedule campaigns — but emails won't actually send until we flip the switch. We'll let you know when."

---

## 10. Accessibility Specifications

### 10.1 Touch targets

- All interactive Pressables ≥44pt × 44pt (I-38 invariant)
- Achieved via either intrinsic size OR `hitSlop` extension
- Verified components:
  - Bottom-nav tabs: 64pt height (passes)
  - Sub-nav pills: 36pt inner + 8pt padding = 44pt effective with hitSlop
  - Filter pills: 32pt with `hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}`
  - Per-row tap targets: full row 76–108pt (passes)
  - FAB: 56pt (passes)
  - Inline secondary buttons: 36pt + `hitSlop`

### 10.2 accessibilityLabel rules (I-39)

Every Pressable MUST have `accessibilityLabel`. Format conventions:

| Element | Label format |
|---|---|
| Tab | `${tabLabel}` |
| Card row | `${primary content}, ${meta}, ${state}. ${action hint}.` |
| Button | `${verb} ${object}` e.g., "Send campaign", "Save draft" |
| FAB | `${primary action}` e.g., "New campaign" |
| Filter pill | `${filter value} filter${, selected if active}` |
| Icon-only button | `${verb}` e.g., "Close", "Edit" |
| Disabled element | unchanged label + `accessibilityState={{ disabled: true }}` |
| Tab/segmented control | `accessibilityRole="tab"` + `accessibilityState={{ selected }}` |

### 10.3 Reading order

- Vertical top-to-bottom natural order on every screen
- No `accessibilityElementsHidden` unless modal occludes background
- Modals + sheets use `accessibilityViewIsModal={true}` to trap screen reader focus

### 10.4 Dynamic Type

- All text uses tokens that respect iOS Dynamic Type
- `numberOfLines` constraints have `ellipsizeMode="tail"` so truncation is honest
- Critical values (revenue $) use `adjustsFontSizeToFit minimumFontScale={0.7}` to prevent truncation at the cost of slight shrinkage

### 10.5 Contrast (WCAG AA)

Verified against `canvas.discover` (#0c0e12):
- `text.primary` rgba(255,255,255,0.96) → 18.5:1 (AAA)
- `text.secondary` rgba(255,255,255,0.72) → 13.0:1 (AAA)
- `text.tertiary` rgba(255,255,255,0.52) → 8.5:1 (AAA)
- `text.quaternary` rgba(255,255,255,0.32) → 4.3:1 (passes AA for large text only — restrict to placeholder/disabled/hint contexts)
- `accent.warm` (#eb7825) → 6.2:1 (AAA for normal text)
- `semantic.success` (#22c55e) → 8.5:1 (AAA)
- `semantic.error` (#ef4444) → 5.5:1 (AA)

### 10.6 Reduced motion

Per §4.4. Implementor must check `useReducedMotion()` from react-native-reanimated and provide non-animated fallbacks.

### 10.7 High contrast / Increased contrast (iOS)

- `glass.border.*` token alphas double when iOS "Increase Contrast" is on
- Pattern: check `AccessibilityInfo.isHighContrastEnabled()` (RN 0.73+)
- Substitute `glass.border.profileBase` (0.08) → 0.16 when high contrast
- Token-level helper recommended: `useBorderAlpha()` hook

---

## 11. Responsive Variants

### 11.1 Mobile (< 768pt) — DEFAULT

All specifications above are mobile-default.

### 11.2 Tablet / Large mobile (≥ 768pt, < 1024pt)

- Composer: side-by-side editor + preview pane
  - Editor: 60% width
  - EmailPreviewPane: 40% width, fixed right pane (no sheet needed)
- Page horizontal padding: `spacing.lg` (24) instead of `spacing.md`
- Metric tiles row: width grows proportionally (4 tiles still)
- Audience cards: max width 600pt centered
- Campaign cards: max width 600pt centered
- Bottom-nav: unchanged (still floating capsule at bottom)

### 11.3 Web (mingla-business/app web) — ≥ 1024pt

- Marketing tab: full-width layout with max-width 1200pt centered
- Composer: 70/30 split (editor / preview)
- Two-column layout for audience list / customer list:
  - List: 70% width
  - Right panel: 30% width with quick summary or chart
- Hover states enabled (see §4.2)
- Keyboard shortcuts:
  - `N` = new campaign
  - `/` = focus filter pills
  - `Esc` = close any open sheet/modal
  - `Cmd/Ctrl+S` = save draft (composer)
  - `Cmd/Ctrl+Enter` = open review modal (composer)

### 11.4 iPad / large-tablet ≥ 1024pt with split-view

- Falls back to mobile layout (single column) when app is split-view < 600pt
- Otherwise follows tablet layout

---

## 12. Personality Voice — Copy Spec

Mingla voice in Marketing context: **the cool friend who's also great at marketing**. Confident, specific, never apologetic, never preachy.

### 12.1 Empty state copy (all 9 screens)

Already specified in §9.1. Key rules:
- Always lead with the action ("Your first campaign starts here.")
- Always include the specific number ("You have 247 buyers waiting")
- Never apologize ("Oops!" / "Sorry, nothing here yet")
- Never use jargon ("audience" is OK; "segment" is jargon for Phase A+)

### 12.2 Error state copy

Per §9.3 Pattern A examples. Key rules:
- Take responsibility ("We're not getting through" — not "your request failed")
- Be specific about the cause when known ("Resend domain not verified")
- Always offer a next action

### 12.3 CTA copy

Verb + specific number, always:
- "Blast these 247 buyers →" ✓
- "Schedule for Saturday" ✓
- "Send campaign" ✗ (too generic — what campaign? to whom?)

### 12.4 Confirmation copy

After scheduling:
- "Your campaign is scheduled" (not "Campaign saved" — saved isn't the user's intent)
- "Saturday at 11:00 AM · 247 recipients" (specific, not "Soon · Several people")

After unsubscribing (recipient-side):
- "You won't receive marketing emails from {Brand} anymore."
- NOT "You have been unsubscribed." (passive voice, distant)

### 12.5 Compliance copy (locked, exact wording)

These are legal — wording is fixed:
- "From: ${Brand} via Mingla"
- "Reply-to: ${reply email}"
- "Unsubscribe: link added automatically"
- "Brand address: ${full address}"
- "Your buyers can opt out anytime — Mingla honors this across all your brands."

### 12.6 Preview mode banner copy (locked)

- "PREVIEW MODE — DRAFTS ARE SAVED BUT NOT SENT YET"
- Tooltip: "Marketing is in preview while production checkout finalises. Your audiences fill in as tickets sell, and you can compose and schedule campaigns — but emails won't actually send until we flip the switch. We'll let you know when."

### 12.7 Helpful microcopy (operator confidence-building)

- Below audience reach: "Updated live from orders" (signals real-time freshness)
- Below schedule picker: "Buyers' local time · best between 10am–2pm" (smart-send hint)
- Below compose body: "Variables fill in per recipient: {first_name}, {event_name}, {event_date}"

---

## 13. Implementor Decision Register

What the implementor MUST do exactly, what is locked, and what is defaulted.

### 13.1 Locked by this design (no implementor decision needed)

- All tokens from §2
- All icons from §3
- Bottom-nav tab order: Home / Events / Marketing / Account
- Marketing tab icon: `send`
- Sub-nav: text-only segmented control (no icons)
- Composer: single-page with 4 numbered steps (no wizard)
- BuyerRow shared across 3 contexts (I-PROPOSED-BT)
- ChannelTabs always renders 3 tabs (I-PROPOSED-BS)
- All motion specs from §4
- All accessibility rules from §10
- Preview-mode banner copy locked (§12.6)

### 13.2 Default with operator-override path

These have a design default but operator may want to swap (mark in SPEC §15):

| Item | Design default | Override path |
|---|---|---|
| Marketing tab icon | `send` | Swap to `rocket` or `target` in `_layout.tsx` TABS array |
| Marketing default sub-tab | Overview | Change initial route in `marketing/_layout.tsx` |
| Customer email mask format | `ale**@gmail.com` (first 3 chars + `**` + `@domain`) | Change mask helper |
| Pagination size | 25/page buyer rows | Const in `useBrandCustomers.ts` |
| Schedule timezone helper text | "Buyers' local time · best 10am–2pm" | Helper text const |
| Sparkline data point count | 24 (hourly for 24h) | Const in `CampaignReportSparkline.tsx` |

### 13.3 Explicitly NOT designed (will create implementor friction if attempted)

- SMS-channel composer body field (out of scope; ChannelTabs tab is disabled)
- RCS rich-card preview (out of scope)
- Brand-followers audience kind (no schema yet)
- AppsFlyer integration UI (Phase F)
- Send-to-all-Mingla-customers cross-brand audience (no operator scope)
- Multi-variant A/B testing (Phase A+)

### 13.4 Negative-control design rules (for strict-grep gate)

Per SPEC §13, implementor demonstrates each strict-grep check fires on these intentional regressions:

| Check | Regression scenario |
|---|---|
| `ChannelTabs.tsx` renders all three | Temporarily comment out SMS tab → gate fails → restore |
| Single BuyerRow source | Import BuyerRow from a wrong path → gate fails |
| No oklch in styles | Add `backgroundColor: 'oklch(60% 0.15 30)'` somewhere → gate fails |
| No bare crypto.randomUUID | Add `crypto.randomUUID()` in services → gate fails |
| Migration apply-time probes | Remove a `DO $$` block → gate fails |

---

## 14. Cross-References

- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md`
- Tokens: `mingla-business/src/constants/designSystem.ts`
- Existing BottomNav: `mingla-business/src/components/ui/BottomNav.tsx` (4-tab extension point)
- Existing Icon: `mingla-business/src/components/ui/Icon.tsx` (79 icons available)
- Existing GlassChrome / GlassCard / KpiTile patterns: precedent for new components
- Strategy: `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` §3.8 (placement) + §3.9 (Customers tab)
- Decision: `Mingla_Artifacts/DECISION_LOG.md` DEC-149
- Mingla design rules referenced:
  - `feedback_keyboard_never_blocks_input.md` — composer TextInputs
  - `feedback_rn_sub_sheet_must_render_inside_parent.md` — all sheets nested correctly
  - `feedback_rn_color_formats.md` — hex/rgb/hsl/hwb only
  - `feedback_toast_needs_absolute_wrap.md` — error toasts wrapped
  - `feedback_back_listener_disarm_pattern.md` — composer dirty-state back-block
  - `feedback_wcag_aa_kit_invariants.md` — I-38 + I-39 enforced

---

## 15. Confidence + Risks

**Design confidence: HIGH.** Every token, every motion, every state mapped to existing
Mingla patterns. No new primitives. Implementor can build straight from this doc
without re-deriving visual decisions.

**Known design risks the implementor should watch:**

1. **4-tab BottomNav width math.** Existing 3-tab capsule may need horizontal
   padding tuning. Verify "Marketing" (9 chars) doesn't truncate on iPhone SE
   (width 320pt — content area ~304pt — each tab ~76pt). If truncation:
   reduce label letter-spacing OR drop to 8-char "Market" (less ideal).
2. **EmailPreviewPane WebView on Android.** Some Android WebViews choke on
   embedded `<style>` blocks. Test with Mingla's actual email template wrapper
   on a real device before declaring preview-pane done.
3. **Sparkline on tiny viewports.** 24 data points in 120pt height at 320pt
   width may look noisy. If so, reduce to 12 (every-2-hours) on viewports < 360pt.
4. **Sub-nav spotlight spring on Android.** Existing BottomNav already proves
   the pattern works on Android; replicate exactly (don't tune).
5. **Filter sheet filter-count refresh debounce.** Live count updates on every
   filter change. Debounce 200ms or the count UI flickers during rapid changes.

---

## 16. Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. All design artifacts
saved here; implementor will pull from the same branch.
