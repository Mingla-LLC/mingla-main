# DESIGN — ORCH-0874 [Trip surfaces visual parity with Events]

**Owner:** `/ui-ux-pro-max` (preflight design exploration per `feedback_implementor_uses_ui_ux_pro_max.md`)
**Date:** 2026-05-18
**Inputs:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` (this session's spec)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` (this session's investigation)
- `mingla-business/src/constants/designSystem.ts` (canonical token authority)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 1. Why a design pass at all

ORCH-0874 is fundamentally a **mirror job**: the event-side already establishes the visual language; the trip side adopts it. There is no new style/palette/typography to invent — the design system at `mingla-business/src/constants/designSystem.ts` is the canonical authority and is unchanged.

The design pass's value is therefore:
1. **Validate** the mirror decisions in the spec against design principles (touch targets, contrast, motion, hierarchy).
2. **Visualize** what each surface looks like AFTER the mirror so the operator can review without running a build.
3. **Surface** the visual implications of the spec's 7 open questions so each can be answered with concrete ASCII mockups, not abstract tradeoffs.

This doc supplements the spec; it does not duplicate it. Implementation receipts come back to the spec's SC-01..SC-21 + test cases.

---

## 2. Token confirmation (no new tokens needed)

Every visual rule in this design doc maps to an existing token in `designSystem.ts`. No new colors, spacing, radii, typography, or motion values introduced.

| Surface area | Token | Resolved value |
|---|---|---|
| Page background | `canvas.discover` | `#0c0e12` |
| Card base background | `glass.tint.profileBase` | `rgba(255,255,255,0.04)` |
| Card elevated background | `glass.tint.profileElevated` | `rgba(255,255,255,0.06)` |
| Chrome button background | `glass.tint.chrome.idle` | `rgba(12,14,18,0.48)` |
| Card border (base) | `glass.border.profileBase` | `rgba(255,255,255,0.08)` |
| Card border (elevated) | `glass.border.profileElevated` | `rgba(255,255,255,0.12)` |
| Brand accent (primary buttons, active tabs, progress fill, eyebrows) | `accent.warm` | `#eb7825` |
| Accent tint (primary tile bg, active filter pill bg) | `accent.tint` | `rgba(235,120,37,0.28)` |
| Accent border (primary tile border, active filter pill border) | `accent.border` | `rgba(235,120,37,0.55)` |
| Status: live, success | `semantic.success` + `successTint` | `#22c55e` / `rgba(34,197,94,0.18)` |
| Status: at-risk, failed | `semantic.error` + `errorTint` | `#ef4444` / `rgba(239,68,68,0.18)` |
| Status: warning | `semantic.warning` + `warningTint` | `#f59e0b` |
| Title text | `text.primary` | `rgba(255,255,255,0.96)` |
| Body text | `text.secondary` | `rgba(255,255,255,0.72)` |
| Caption / meta text | `text.tertiary` | `rgba(255,255,255,0.52)` |
| Disabled / quaternary | `text.quaternary` | `rgba(255,255,255,0.32)` |
| Step title (in wizard body) | `typography.h1` (26pt, 700, -0.2) | — |
| Card title | bodySm (14pt 400) + fontWeight 600 override | — |
| Section eyebrow | 11pt fontWeight 700 letterSpacing 1.4 uppercase `accent.warm` | — |
| Caption (status pills, meta) | `typography.caption` (12pt, 500, +0.2) | — |
| Motion: tab/filter active | `durations.normal` (200ms) + `easings.out` | — |
| Motion: dock hide on keyboard | instant (no animation — RN Keyboard listener) | — |

**No oklch / lab / color-mix anywhere** (per `feedback_rn_color_formats.md` — those render transparent on iOS+Android). All values are hex / rgba / hsl — confirmed.

---

## 3. Surface-by-surface visual mirror (ASCII mockups)

### 3.1 Trips list (`app/(tabs)/hub/trips.tsx`)

**BEFORE (current state):**
```
┌──────────────────────────────────────────────┐
│  (header owned by parent hub layout)         │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Marbella Summer Retreat               │  │
│  │  Draft                          [ → ]  │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  Lisbon Spring Long Weekend            │  │
│  │  Published                      [ → ]  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  (no cover images, no progress, no filters)  │
└──────────────────────────────────────────────┘
```

**AFTER (mirror of events list):**
```
┌──────────────────────────────────────────────┐
│  (header owned by parent hub layout)         │
├──────────────────────────────────────────────┤
│  [All] [Upcoming●] [Past] [Drafts]    ←Q1    │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │ ▓▓▓│ Marbella Summer Retreat       ⋯  │  │
│  │ ▓▓▓│ Aug 16–22 · Marbella, Spain   ⋯  │  │
│  │ ▓▓▓│ [Upcoming · 12 days]              │  │
│  │     │ ████████░░░░  8 of 14 booked  £2400│  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ ▓▓▓│ Lisbon Spring Long Weekend    ⋯  │  │
│  │ ▓▓▓│ Mar 14–17 · Lisbon, Portugal  ⋯  │  │
│  │ ▓▓▓│ [Ended]                           │  │
│  │     │ 12 of 12 booked              £1800│  │
│  └────────────────────────────────────────┘  │
│                                              │
│  (cover thumbnail 76×92, status pill,        │
│   progress bar, manage ⋯, revenue strip)     │
└──────────────────────────────────────────────┘
```

**Per-element design call:**
- **Filter pill row** sits between hub sub-nav and list. `glass.tint.profileBase` bg, `radiusTokens.full`, 34pt height, 1pt `glass.border.profileBase` border. Active state: `accent.tint` bg + `accent.border` border + `text.primary` label. `flexGrow:0` MANDATORY (per the silent layout footgun). Live-pulse dot retired for trips (no "live now" lifecycle — see Q1 recommended set).
- **Card cover thumbnail** 76×92, `radiusTokens.md`. Uses existing `EventCoverMedia` component fed trip's `coverHue` (deterministic from trip.id) — even if trips don't have user-uploaded covers today, the hue-derived placeholder reads cleanly.
- **Status pill** uses existing `Pill` primitive variants: `accent` for Upcoming with "· N days" suffix; inline `pastPill` style for Ended; `draft` for Draft; muted-draft for Cancelled.
- **Progress bar** appears when `capacity > 0 AND travelersBooked > 0`. 3pt track height. `accent.warm` fill. 11pt `text.tertiary` label below: "{N} of {Y} booked".
- **Manage icon** (⋯) — right-rail, 32×32 circular, `glass.tint.chrome.idle` bg, `moreH` icon. Conditional on Q5.
- **Revenue strip** — bottom-right absolute, 13pt fontWeight 700, tabular-nums. Hidden for drafts. Currency-aware via `Intl.NumberFormat` (NEVER fabricate — if revenue null, hide).

### 3.2 Trip detail dashboard (`app/trip/[id]/index.tsx`)

**BEFORE (current state):**
```
┌──────────────────────────────────────────────┐
│  [<]    Marbella Summer Retreat       [Edit] │
│  [Upcoming]                                  │
│  ─────────────────────────────────────────── │
│  [Overview]  [Travelers (8)]  [Money (2)]    │
│  ═══════                                     │
│                                              │
│  ┌────────────────┐ ┌────────────────┐      │
│  │ REVENUE        │ │ TRAVELERS      │      │
│  │ £2,400         │ │ 8 / 14         │      │
│  └────────────────┘ └────────────────┘      │
│  ┌─────────────────────────────────────┐    │
│  │ DEPARTURE                           │    │
│  │ in 12 days                          │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ DESTINATION                         │    │
│  │ Marbella, Spain                     │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  (no hero, no action grid, no share)         │
└──────────────────────────────────────────────┘
```

**AFTER — Q2 = KEEP TABS (recommended, smaller diff):**
```
┌──────────────────────────────────────────────┐
│  [<]   Marbella Summer Retreat   [↗] [⋯]    │ ← share + moreH
│  ┌─────────────────────────────────────────┐ │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ │ ← cover 200pt
│  │ ▓ [Upcoming · 12 days]               ▓ │ │   gradient overlay
│  │ ▓ Marbella Summer Retreat           ▓ │ │   24pt title
│  │ ▓ Aug 16–22 · Marbella, Spain       ▓ │ │   13pt subline
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌──────────┐┌──────────┐┌──────────┐┌────┐ │ ← ActionTile grid
│  │ [eye]    ││ [user]   ││ [send]   ││[ed]│ │   2-col wrap, gap 8
│  │ View     ││ Brand    ││ Marketing││Edit│ │
│  │ public   ││ page     ││ blasts   ││trip│ │ ← Edit = primary
│  │ page     ││          ││          ││    │ │
│  └──────────┘└──────────┘└──────────┘└────┘ │
│                                              │
│  [Overview]  [Travelers (8)]  [Money (2)●]   │ ← tabs unchanged
│  ═══════                                     │
│                                              │
│  ┌────────────────┐ ┌────────────────┐      │
│  │ ╔══════════════╗  ╔══════════════╗ │ ← GlassCard elevated
│  │ ║ REVENUE      ║  ║ TRAVELERS    ║ │     wrap (no longer
│  │ ║ £2,400       ║  ║ 8 / 14       ║ │     raw View)
│  │ ╚══════════════╝  ╚══════════════╝ │
│                                              │
│  (etc — Departure + Destination KPI tiles)   │
└──────────────────────────────────────────────┘
```

**AFTER — Q2 = FLATTEN (alternative, larger diff):**
```
┌──────────────────────────────────────────────┐
│  [<]   Marbella Summer Retreat   [↗] [⋯]    │
│  ┌─────────────────────────────────────────┐ │
│  │ ▓▓ hero cover + status + title + subln ▓│ │
│  └─────────────────────────────────────────┘ │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐       │
│  │View││Brnd││Mktg││Edit││Trvl││Mny ║       │ ← Travelers + Money
│  │pub ││page││blst││trip││ers ││tab*│       │   become grid tiles
│  └────┘└────┘└────┘└────┘└────┘└────┘       │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║ REVENUE                              ║   │ ← single KPI tile
│  ║ £2,400                ────────       ║   │   (sparkline placeholder)
│  ║                   ┃ ┃ ┃ ┃ ┃ ┃ ┃ ┃   ║   │
│  ╚══════════════════════════════════════╝   │
│  ┌──────────────────────────────────────┐   │
│  │ TRAVELERS · 5 of 8 most recent       │   │
│  │ ─────────────────────────────────    │   │
│  │ Maria S      paid     £300           │   │
│  │ Luca G       paid     £300           │   │
│  │ (3 more rows)                        │   │
│  │ → View all travelers (8)             │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │ MONEY · 2 at risk                    │   │
│  │ ─────────────────────────────────    │   │
│  │ £1,200 collected · £1,200 scheduled  │   │
│  │ → View full money tab                │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │ [Cancel trip]                        │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**Recommendation:** Q2 = **KEEP TABS** (Option A). Reasoning:
- Money tab from ORCH-0873 is dense (filter chips + per-booking expand + ledger). Embedded as a flat summary in single-scroll loses the operator's ability to scan + act on at-risk rows without leaving the page.
- Tabs are a familiar mobile pattern; flattening forces 2 new sub-routes + MoneyTabBody extraction (larger diff, more regression surface).
- Hero + action grid land above tabs — operator gets both the "event-detail feel" AND the existing tabbed information density.
- Implementor diff is dramatically smaller (no new sub-route files, no MoneyTabBody hoisting).

### 3.3 Trip wizard chrome (`TripCreatorWizard.tsx`)

**BEFORE (current state):**
```
┌──────────────────────────────────────────────┐
│  [<]                                         │ ← only back chevron
│         Step 1 of 5                          │   no close X
│         Basics                               │
│  ═════ ════ ─── ─── ───                      │ ← anonymous 4pt dots
│                                              │
│  (step body — no eyebrow, no title in body)  │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │              [Continue]              │   │ ← single button footer
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**AFTER (mirror of event wizard chrome):**
```
┌──────────────────────────────────────────────┐
│  [×]  [Basics][When][Where][Cover][Tickets]  │ ← Close X + named
│       ═══════ ════                      1/5  │   Stepper + counter
│  Trip Planner · Step 1 of 5         Saved    │ ← subtitle row
│  ─────────────────────────────────────────── │
│                                              │
│  STEP 1 OF 5                                 │ ← eyebrow accent.warm
│  Basics                                      │ ← 26pt h1 title
│  Title, dates, destination, capacity         │ ← 14pt subtitle
│                                              │
│  (step body — TripCreatorStep1Basics)        │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║          [    Continue    ]          ║   │ ← step 1: single
│  ╚══════════════════════════════════════╝   │   button in floating
│       (glass elevated radius=xxl dock)       │   GlassCard dock
└──────────────────────────────────────────────┘

STEPS 2-4 dock:
  ╔══════════════════════════════════════╗
  ║  [   Back   ]  [    Continue    ]    ║
  ╚══════════════════════════════════════╝

STEP 5 (Review) dock:
  ╔══════════════════════════════════════╗
  ║  [ Back ]  [   Publish trip   ]      ║
  ╚══════════════════════════════════════╝
              (back flex:1, publish flex:2)
```

**Close X handler behavior (matrix):**

| Mode | Pristine? | Behavior |
|---|---|---|
| Create (just hit `/trip/create`) | YES | Discard draft silently + back to `/(tabs)/hub/trips` |
| Create | NO (any edit) | Open `ConfirmDialog`: "Discard this trip? / You'll lose your changes. / [Discard, destructive] [Keep editing]" |
| Edit (published trip) | YES or NO | Silent exit to `/trip/{id}` — autosave already persisted; no dialog |
| Edit (draft trip with prior progress) | YES or NO | Silent exit to back-stack — autosave already persisted; no dialog |

**Publish ConfirmDialog (Step 5):**
```
  ┌────────────────────────────────────────┐
  │  Publish trip?                         │
  │                                        │
  │  Marbella, Spain · Aug 16–22           │
  │  Buyers can book immediately.          │
  │  You can edit details after            │
  │  publishing.                           │
  │                                        │
  │       [ Cancel ]    [ Publish ]        │
  └────────────────────────────────────────┘
```

### 3.4 Public trip page (`app/t/[brandSlug]/[tripSlug].tsx`)

**BEFORE (current state):**
```
┌──────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓▓ (cover 100% × 220, full-bleed) ▓▓        │ ← no X-close
│ ▓▓                                ▓▓        │   no share overlay
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│                                              │
│  Marbella Summer Retreat                     │
│  by Leggothis Travel                         │
│  Aug 16–22 · Marbella, Spain · 14 spots      │
│  ...                                         │
│                                              │
│  [Reserve my spot]                           │
└──────────────────────────────────────────────┘
```

**AFTER (mirror of public event page):**
```
┌──────────────────────────────────────────────┐
│ ▓[×]▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓[↗]▓▓ │ ← X-close top-left
│ ▓▓ (cover 100% × 220, full-bleed) ▓▓        │   share top-right
│ ▓▓ X + share are 36×36 IconChrome ▓▓        │   36×36 IconChrome
│ ▓▓ on glass.tint.chrome.idle bg   ▓▓        │   glass chrome
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│                                              │
│  (rest of TripPreview unchanged)             │
│                                              │
│  [Reserve my spot]                           │
└──────────────────────────────────────────────┘
```

**Critical SafeArea preservation:** the cover is intentionally full-bleed UNDER the status bar (per ORCH-0859 REWORK 5b operator pixel-decision). The X-close and share overlays must position with `top: insets.top + spacing.sm` so they sit BELOW the status bar but ON the cover gradient. They use `position: absolute` from the page root, not from within `TripPreview` (TripPreview owns content layout; route owns chrome).

---

## 4. Open question visual variants (Q1–Q5)

For each operator-blocked question, here are concrete visual options so the decision can be made on visuals not abstracts. Recommendations come from the spec; this design pass confirms them visually.

### Q1 — Trip list filter pills

**Option A (Recommended):** All / Upcoming / Past / Drafts
```
[All]  [Upcoming]  [Past]  [Drafts]
─────  ════════  ────  ────
                    (active)
```
4 pills. Clean. Mirrors event filter shape minus "Live" (trips have no live-now lifecycle).

**Option B:** All / Upcoming / In-progress / Ended / Drafts
```
[All]  [Upcoming]  [In-progress●]  [Ended]  [Drafts]
                       ═══════════════
                       (active, with green pulse dot)
```
5 pills. Adds in-progress state for trips currently between start_at and end_at. Operator advantage: scan "what's running right now". Tradeoff: 5 pills feels crowded on narrow screens (375pt iPhone SE); horizontal scroll required.

**Option C:** No filters (current state).

**Design recommendation: Option A.** Reasoning:
- Cleanest density. 4 pills fit at 375pt without horizontal scroll.
- "In-progress" overlaps semantically with "Upcoming" for most operators (a trip starting tomorrow vs starting yesterday — both feel "current"). Folding into "Upcoming" until-end is acceptable; the trip detail badge can still show "in progress" status.
- Drafts pill always last per event convention.

### Q2 — Trip detail topology

**Option A (Recommended):** Keep tabs (see §3.2 mockup above).

**Option B:** Flatten single-scroll (see §3.2 alternative mockup above).

**Design recommendation: Option A.** Reasoning enumerated in §3.2. Keep tabs.

### Q3 — Trip detail action grid tiles

Recommended grid (4 tiles, primary on Edit since it's the highest-frequency operator action):

```
┌──────────┐┌──────────┐┌──────────┐┌──────────┐
│ [eye]    ││ [user]   ││ [send]   ││ [edit]   │
│ View     ││ Brand    ││ Marketing││ Edit     │ ← primary
│ public   ││ page     ││ blasts   ││ trip     │   accent.tint bg
│ page     ││          ││          ││          │
└──────────┘└──────────┘└──────────┘└──────────┘
   2-col flexWrap, gap 8, minHeight 76, flexBasis 48%
```

**Decision sub-Qs:**
- **Marketing blasts tile** — INCLUDE. The trip is `event_type='trip'` and the marketing-blast route is `/event/{id}/blasts` (event-id agnostic). Trip planners want to message ticket buyers same as event organizers. Confirm trip planners actually use blasts before shipping — open follow-up if unused.
- **Cancel trip** — DO NOT put in grid. Mirror event pattern: bottom-of-page "Cancel trip" ghost button as the destructive action (currently absent on trip detail). Add as the LAST section below the existing tabs/content per `event/[id]/index.tsx:770–784`.
- **Money tile** — NOT in grid since Q2=A keeps Money as a tab. Tile would duplicate.
- **Scan tile** (primary on events) — NOT applicable to trips (no QR scanning at trip departure). Skip.

### Q4 — Trip wizard publish errors UX

**Option A (Recommended):** Keep current Step 5 banner pattern.
```
  ┌────────────────────────────────────────┐
  │ ⚠ Couldn't publish                     │
  │ Trip needs a destination set on Step 1.│
  │ [Go to Step 1]                         │
  └────────────────────────────────────────┘
```

**Option B:** New `TripPublishErrorsSheet` with Fix-jump buttons.
```
  ┌────────────────────────────────────────┐
  │  Fix 2 issues before publishing        │
  │  ───────────────────────────────────   │
  │  • Trip needs a destination            │
  │           [ Fix in Step 1 → ]          │
  │  • Pricing is empty                    │
  │           [ Fix in Step 4 → ]          │
  └────────────────────────────────────────┘
```

**Design recommendation: Option A** (banner). Reasoning:
- Trips have 5 steps and a small validation surface (title, dates, destination, pricing, at-least-one-day). At most 3–4 validation errors possible.
- A banner with a single "Go to Step N" link is sufficient.
- Sheet adds ~100 LOC for marginal UX gain on rare error path.
- Defer sheet to a follow-up ORCH if real operator usage shows banner is insufficient.

### Q5 — Trip manage menu

**Option A (Recommended):** YES — new `TripManageMenu` sheet, opens from header `moreH` icon.
```
  ┌────────────────────────────────────────┐
  │  Trip options                          │
  │  ───────────────────────────────────   │
  │  [eye]   View public page              │
  │  [↗]    Share trip link                │
  │  [edit]  Edit trip                     │
  │  ───────────────────────────────────   │
  │  [x]     Cancel trip   (destructive)   │
  └────────────────────────────────────────┘
```

**Option B:** No menu — right slot is share-only.

**Option C:** No menu, no right-slot affordances at all (only the back chevron).

**Design recommendation: Option A.** Reasoning:
- Cancel-trip needs a home. Bottom-of-page ghost button (per event pattern) works, but on a tab-topology trip detail the user has to scroll to bottom of whichever tab they're on to find it. Menu surfaces consistently.
- Share-trip-link via native share sheet is high-frequency for trip planners (sending Marbella URL to a WhatsApp group).
- Menu items 1+3 duplicate action-grid tiles intentionally — operators expect both reachable from manage-menu AND grid.

### Q6 — ORCH-0867 fold

**Recommendation: FOLD.** No visual concerns either way; this is purely a process question. The View-public-page tile is in the action grid (Q3 tile 1) and the manage menu (Q5 item 1). ORCH-0867's slot is filled. Close ORCH-0867 simultaneously with ORCH-0874.

### Q7 — Implementor side

No visual implication. Operator picks based on workload. Spec §11 recommends Codex `implementor-mingla` (default for UI-touching scope).

---

## 5. Accessibility checks

| Check | Status | Notes |
|---|---|---|
| Touch target ≥ 44pt | PASS by design | IconChrome at 36pt + 8pt hitSlop = 44pt effective. ActionTile at flexBasis 48%, minHeight 76 (well above 44). Filter pills at 34pt height + hitSlop expanding to 44pt (mirror events.tsx:520). Header back / share / moreH buttons all 36pt + 8pt hitSlop. |
| Color contrast ≥ 4.5:1 | PASS | `text.primary` rgba(255,255,255,0.96) on `canvas.discover` #0c0e12 = ~19:1. `text.secondary` (0.72) on same = ~14:1. `accent.warm` on dark = AAA. Glass overlays + status bar gradient inside hero may drop into AA territory for some buyer-anon viewports — implementor should verify on iOS sim with cover hue extremes. |
| Visible focus states | PASS by RN platform default | RN Pressable platform-default pressed states (opacity 0.7 on ActionTile, 0.85 on EventListCard) cover focus. No web focus rings needed on mobile-native surfaces. |
| accessibilityLabel on every interactive element | REQUIRED in spec (SC-20) | Every new Pressable / IconChrome / ActionTile in the implementor diff MUST have explicit `accessibilityLabel`. Including: wizard Close X ("Close wizard"), share button ("Share trip"), moreH ("Trip options"), action grid tiles (each tile's `label` doubles as accessibilityLabel via ActionTile.tsx:42), TripListCard ("`${trip.title}, ${statusLabel}, ${dateRangeText}`"), public page X-close ("Close"), public page share ("Share"). |
| accessibilityRole | PASS | Buttons: `accessibilityRole="button"`. Tabs in detail page (existing): `accessibilityRole="tab"` with `accessibilityState={{ selected: active }}`. Progress segments replaced with Stepper which already handles accessibilityRole. |
| Reduced motion | N/A by surface | No new animations beyond existing dock-hide (instant via Keyboard listener) and the existing Stepper transitions which inherit reduced-motion already. Public page hero overlays are static. |
| Keyboard never blocks input | REQUIRED in spec | Wizard Step 1 title field MUST remain visible above keyboard after the KeyboardAvoidingView → explicit listener migration. Implementor verifies on iOS sim per SC test T-23. |
| Color is not the only indicator | PASS | Status pills use both color AND text label ("Upcoming · 12 days", "Live now", "Ended", "Draft", "Cancelled"). At-risk badge uses both red color AND "⚠ At risk" text. Filter pills use both color (accent.tint) AND active label state. |

**Accessibility risk:** None blocking. The single watchout is hero cover contrast — if a buyer-anon trip cover has a light hue (e.g., desert tones), the white title overlay could drop to ~3:1. Mitigation: the existing gradient overlay (`pointerEvents="none"`) is darkened from bottom, which is where the title sits. Implementor should preserve gradient strength when adopting the event hero pattern.

---

## 6. Motion + interaction

| Element | Motion | Timing |
|---|---|---|
| Filter pill tap → active | Background color crossfade | `durations.normal` (200ms) `easings.out` |
| Tab tap → active | Bottom border slide (or instant repaint — RN default) | Instant repaint acceptable; matches event detail |
| ActionTile press | Opacity 0.7 (existing ActionTile.tsx:83–85) | Instant on press, 0.7 release |
| TripListCard press | Opacity 0.85 (mirror EventListCard) | Instant on press, 0.85 release |
| Wizard step advance / back | Step body crossfade or instant | RN default (no animation) — matches event wizard |
| Stepper progress | Active pill bg fade | `durations.fast` (120ms) inherited from Stepper primitive |
| Dock hide on keyboard show | Conditional render (`keyboardVisible ? null : <dock>`) | Instant — matches event wizard pattern |
| ConfirmDialog appear | Existing ConfirmDialog primitive entrance animation | Inherited from ConfirmDialog component |
| Public page X-close / share tap | Opacity 0.8 press feedback | Instant |
| Hero cover load | No fade-in (static image) | N/A |

No new motion tokens introduced.

---

## 7. Implementor checklist (preflight)

Before writing the first line, implementor should:

1. **Read this design doc + the spec end-to-end** — particularly §3 mockups + §4 Q-resolutions (after operator answers Q1–Q7).
2. **Open events list, event detail, event wizard, public event page on the iOS simulator** (using existing dev build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` if needed) and **screenshot each** before touching trip files. These screenshots are the visual ground-truth the trip surfaces must match.
3. **Confirm the 3rd-party tile reuse is safe**: `ActionTile.tsx` + `EventDetailKpiCard.tsx` + `EventCoverMedia.tsx` are imported from `src/components/event/` directly. If consumed from `src/components/trip/`, the import path is `from "../event/ActionTile"`. Cross-component-folder imports are acceptable per current codebase pattern (no proposal to move them to `shared/` — that's out of scope per spec §1.2).
4. **Verify the `Stepper` primitive accepts `currentIndex={step-1}`** for a 5-step wizard (TripCreatorWizard.tsx state is 1-indexed; Stepper is 0-indexed per `STEPPER_STEPS` mapping in EventCreatorWizard.tsx:95–98). Decrement at the call site.
5. **Wire `useDiscardTrip` hook** — confirm if it exists in `useTrips.ts`. If not, add per spec §3.3.6 option (a): minimal hook + service method deleting the draft event row gated on `status='draft'`.
6. **Migrate wizard from `KeyboardAvoidingView` to explicit `Keyboard.addListener` + dynamic `paddingBottom`** (mirror EventCreatorWizard.tsx:262–312). LIVE-FIRE VERIFY on iOS sim that Step 1 title input remains usable with keyboard up. This is the highest-risk regression in the spec.
7. **Preserve all ORCH-0873 Money tab functionality** — only restyle the booking row container (wrap in GlassCard variant="base") and filter chips (mirror event filter pill shape). Do NOT touch the filter logic, expand/collapse state, Retry mutation wiring, Refund stub, or InstallmentScheduleDisplay/PaymentPlanEditor references.
8. **Preserve the SafeArea allowlist comment** at `app/trip/[id]/edit.tsx:12` — the wizard chrome change preserves the existing `paddingTop: insets.top` at TripCreatorWizard.tsx so the allowlist tag remains valid.
9. **NO new `[styles.a, condition && styles.b]` patterns** — use `condition ? styles.b : null` instead, or split StyleSheet.create into ViewStyle + TextStyle maps where new code lands. Reduces the existing 53 TS-debt count, doesn't increase it (spec §1.2 hard guard).
10. **Run the implementor regression test files locally before commit** — confirm fails-on-revert verification per Step 0.5 gate.

---

## 8. Out-of-scope (for follow-up ORCHs only)

- Fixing the 53 ORCH-0873 TS-debt errors (style-array union narrowing). Separate ORCH.
- Extracting `ActionTile` / `EventDetailKpiCard` / `EventCoverMedia` to `src/components/shared/`. Separate refactor ORCH.
- Adding a marketing-blast equivalent if trip planners don't already use `/event/{id}/blasts`. Separate product ORCH.
- Trip-specific cover image upload UX (currently trips only have `coverHue`-derived placeholders). Separate Tr-product ORCH.
- Cancel-trip flow + email notifications to booked buyers. Out of visual scope.
- Sub-routes `/trip/{id}/travelers` and `/trip/{id}/money` (only if Q2=B; otherwise not needed).
- ORCH-0868 forwardRef RedBox cleanup. Separate dev-experience ORCH.

---

## 9. Layman summary

This design doc takes the spec and turns each abstract decision into a concrete ASCII mockup so you can see what the new screens look like before any code runs.

**Big picture:** trip surfaces inherit the event visual language. No new colors, fonts, or motion — every value already exists in `designSystem.ts`.

**Per surface:**
- **Trips list:** cover thumbnail + status pill + progress bar + manage ⋯ + revenue strip + filter pills on top.
- **Trip detail (Q2=keep tabs):** hero cover with title overlay → action-tile grid (View public page, Brand page, Marketing blasts, Edit trip) → existing Overview/Travelers/Money tabs with restyled tiles inside. Header gets share + manage menu buttons.
- **Trip wizard:** Close X always visible (with create-mode-dirty discard dialog, edit-mode silent exit). Named Stepper replaces anonymous dots. Body shows eyebrow + 26pt step title + 14pt subtitle. Floating glass dock for Back + Continue + Publish. Publish dialog confirms before submitting.
- **Public trip page:** X-close top-left + share top-right overlays on the cover hero.

**For the 7 open questions:** I produced visual variants for each and recommended the same defaults the spec did. The only operator decision that materially shifts the diff size is Q2 (KEEP tabs = small diff; FLATTEN = larger diff with 2 new sub-routes). Keeping tabs is recommended.

**Accessibility:** all touch targets meet 44pt (via 36pt button + 8pt hitSlop pattern); contrast ratios well above 4.5:1 on dark glass surfaces; hero cover gradient preserves title contrast on light-hue trips. Single watchout: implementor must live-fire-verify the wizard Step 1 keyboard behavior after migrating from KeyboardAvoidingView to explicit listener — this is the biggest regression risk in the ORCH.

**No new design tokens. No new icons. No new typography. No new motion.** Pure mirror.
