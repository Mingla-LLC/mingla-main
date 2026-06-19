# DESIGN IA — META-ORCH-1148 — Mingla Venue Management Suite (Phase 2)

> **Type:** Design / Information-Architecture + responsive layout-system artifact. NOT a build
> contract — this is the design foundation a SPEC embeds and the implementor builds from.
> **Author:** mingla-designer · **Date:** 2026-06-15 · **Anchor:** `/Users/sethogieva/Desktop/mingla-main/`
> **Inputs read:** `Mingla_Artifacts/specs/VISION_META-ORCH-1148_VENUE_MANAGEMENT_SUITE.md`,
> `COMMS_LEDGER.md` (no BLOCK/OPEN entries to this skill or to 1148/ALL — the two active rows are
> trip-migration WARNs, irrelevant here), the live Hub shell (`app/(tabs)/hub/_layout.tsx`,
> `HubSubNav.tsx`, `useResponsiveLayout.ts`, `OfferingListCard.tsx`), and the design-system tokens
> (`mingla-business/src/constants/designSystem.ts`).
>
> **Scope discipline (per `feedback_shared_worldmap_scope_bleed`):** this artifact designs only
> what Seth's VISION + LOCKED DECISIONS specify — the 11-module IA shell (so it scales) plus
> detailed first-ship screens (the booking loop). The 6 later modules get nav-slot + empty-state
> treatment only, not detailed screens.

---

## 0. The product moment (why this design exists)

A venue operator (host stand, manager, owner) lives in a high-tempo, glance-and-act loop: *who's
coming tonight, what's open, who's waiting, fill the gaps.* They touch this on three surfaces with
opposite ergonomics — a **desktop browser at the host stand** (wide, mouse, comparing), a **phone
browser** (manager away from the stand), and the **native business app** (owner on the move). A
Mingla guest, meanwhile, is in a totally different moment: deciding *where to go tonight* on the
consumer deck, and a "Reserve a table" affordance must feel as light as a swipe — no form dread.

The design job: one suite that is **dense where the operator compares** (reservations list, tables
inventory) and **spacious where anyone chooses** (the toggle moment, the guest reserve flow), that
**collapses gracefully** from two columns to one, and that **never feels like 11 systems** — it
feels like one calm command center that happens to be deep.

Design north star, verbatim from Seth: *"Robust but COMPACT, simple yet innovative; intentional,
modern, sleek, usable to facilitate quick adoption yet still packed with features."*

---

## 1. FULL-SUITE INFORMATION ARCHITECTURE

### 1.1 Where the suite lives

The suite is **the Hub "Venue" tab** — a fourth peer to Events / Experiences / Trips in
`HubSubNav`, gated by the brand having a claimed/created venue. It is NOT a new bottom-tab; the
business app's 5-tab bar is fixed (Home / Hub / Marketing / …). Inside the Venue tab sits the
**suite shell** (its own internal navigation). This keeps the global IA stable and nests the new
depth one level down, exactly where venue work belongs.

```
Business app bottom tabs:  [ Home ] [ Hub ] [ Marketing ] [ … ] [ … ]
                                     │
Hub sub-nav (HubSubNav):   Events · Experiences · Trips · ⬩ Venue ⬩   ← new pill, venue-gated
                                                              │
                                              ┌───────────────┴───────────────┐
                                              │   THE VENUE SUITE SHELL        │
                                              │   (internal module nav)        │
                                              └────────────────────────────────┘
```

> **Reconciliation with the existing Hub sub-nav:** `HubSubNav` is a horizontal pill scroller of
> *offering kinds*. "Venue" is a kind-peer pill there (visibility driven by `useHubVisibleTabs`,
> same as the others). Tapping it enters the suite, which then runs its OWN module navigation —
> the suite's module nav is a SECOND, nested level and must be visually distinct from the Hub
> pill row so the operator never confuses "which offering" with "which venue module." (Resolution:
> Hub pills = rounded `warm`-fill pills at the very top; suite module nav = a different pattern per
> surface, §2.)

### 1.2 The 11 modules — canonical order, grouping, gating

The module list is grouped into **four bands**. Bands are a visual/cognitive device (section
dividers in the nav), not routes. This grouping is what makes 11 modules feel like ~4 ideas.

| # | Module | Band | First-ship? | Gating |
|---|--------|------|-------------|--------|
| 1 | **Overview** | A · Command | ✅ detailed | Always on (the preserved listing lives here) |
| 2 | **Tables** | B · Booking | ✅ detailed | Reservations toggle ON |
| 3 | **Availability** | B · Booking | ✅ detailed | Reservations toggle ON |
| 4 | **Reservations** | B · Booking | ✅ detailed | Reservations toggle ON |
| 5 | **Waitlist** | B · Booking | ✅ detailed | Reservations toggle ON |
| 6 | **Menu** (5 sub) | C · Catalog | nav-slot only | toggle ON; sub-nav reveals |
| 7 | **Demand** | D · Intelligence | nav-slot only | toggle ON |
| 8 | **Guests** | D · Intelligence | nav-slot only | toggle ON |
| 9 | **Campaigns** | D · Intelligence | nav-slot only | toggle ON |
| 10 | **Feedback** | D · Intelligence | nav-slot only | toggle ON |
| 11 | **Settings** | A · Command | ✅ detailed | Always on (profile/hours/rules/fee/team) |

**Bands (nav section headers):**
- **A · Command** — Overview, Settings. The always-on frame. Present even with the toggle OFF.
- **B · Booking** — Tables, Availability, Reservations, Waitlist. The first-ship loop. Hidden until
  the toggle is ON.
- **C · Catalog** — Menu (with its 5 sub-modules: All Menus · Items · Specials · Packages · Add-ons
  · Insights). Hidden until toggle ON; later ship.
- **D · Intelligence** — Demand, Guests, Campaigns, Feedback. Hidden until toggle ON; later ship.

> **Menu's 5 sub-modules** are a sub-level UNDER the Menu module — they do NOT inflate the top-level
> module count. The module-nav pattern (§1.3) must support one level of nesting (Menu → its tabs)
> without a third visual hierarchy. Resolution: Menu is a single nav row; selecting it swaps col-2
> to a Menu workspace whose own top is a secondary segmented control (All / Items / Specials /
> Packages / Add-ons / Insights). One nest, contained inside the content column — never a third nav
> rail.

### 1.3 The module-nav pattern (surface-agnostic contract)

One conceptual model, three renderings (detailed in §2). The model is a **list-detail master**:

- **Master = the module list** (the 11 rows, banded). Persistent, always shows the active module.
- **Detail = the module workspace** (one module's screen).
- **Selection state** is a single `activeModule` value (`'overview' | 'tables' | … | 'settings'`),
  the suite's analog of the app's `setCurrentPage`. It drives which workspace renders.
- **Deep state within a module** (e.g. Reservations' Today/Upcoming/Waitlist views, Menu's
  sub-tabs) is a **secondary segmented control at the top of the detail column** — never a third
  nav level, never a new route push on native.

This pattern scales: adding module #12 later is one row in the master, one workspace in the detail.
The shell never restructures.

---

## 2. RESPONSIVE LAYOUT SYSTEM (three targets, one model)

**Canonical breakpoint, reused — do NOT invent a new one.** The business app already gates desktop
via `useResponsiveLayout()` → `isWideDesktop` (web AND viewport ≥ `WIDE_DESKTOP_MIN_WIDTH = 1024`,
inclusive). Native always returns `false`. Invariant `I-DESKTOP-GATE-VIA-HOOK` forbids inlining the
width check. **The suite reads `isWideDesktop` from this hook for its two-column gate.** No new
breakpoint constant.

| Surface | Condition | Layout |
|---------|-----------|--------|
| **Web desktop** | `isWideDesktop === true` (web, ≥1024px) | **Two columns** (master rail + detail) |
| **Web phone** | web, `< 1024px` | **Single column**, module nav as a top segmented control / overflow sheet |
| **Mobile app** | `Platform.OS !== 'web'` | **Single column**, module nav as a secondary pill row + sheet, inside the Hub Venue tab |

### 2.1 Web desktop — TWO COLUMNS (the recommended master pattern)

**Chosen pattern: list-detail master.** Col 1 = the module-nav master (the 11 banded rows). Col 2 =
the active module's workspace. This is the right call over the alternatives because:
- It matches the operator's mental model (pick a job on the left, do it on the right) and the
  existing business desktop-web contract (compact shell + rail + content), so it reuses the
  established "rail" idiom rather than introducing a new one.
- It keeps all 11 modules one click away with zero hunting — critical for "packed with features but
  quick adoption."
- The booking loop's densest screen (Reservations list) wants maximum horizontal room; a narrow nav
  rail + wide content gives it.

```
┌─ Hub chrome (TopBar + Hub pills: Events · Experiences · Trips · ▸Venue◂) ──────────────┐
│                                                                                          │
│ ┌── COL 1: MODULE MASTER ──┐  ┌── COL 2: MODULE WORKSPACE ─────────────────────────────┐│
│ │ ▸ VENUE NAME             │  │  [ secondary segmented control if the module has views ]││
│ │   ● open · fee: free     │  │  ┌──────────────────────────────────────────────────┐  ││
│ │                          │  │  │                                                  │  ││
│ │ ─ COMMAND ────────────   │  │  │   active module content                          │  ││
│ │  ◆ Overview        ●     │  │  │   (Overview cards / Tables grid / Reservations   │  ││
│ │  ⚙ Settings              │  │  │    list + detail / Availability editor …)        │  ││
│ │                          │  │  │                                                  │  ││
│ │ ─ BOOKING ────────────   │  │  │                                                  │  ││
│ │  ▦ Tables          12    │  │  │                                                  │  ││
│ │  ◷ Availability          │  │  │                                                  │  ││
│ │  ☷ Reservations    42 ●  │  │  │                                                  │  ││
│ │  ⏲ Waitlist        7     │  │  │                                                  │  ││
│ │                          │  │  │                                                  │  ││
│ │ ─ CATALOG ───────────    │  │  │                                                  │  ││
│ │  ▤ Menu                  │  │  │                                                  │  ││
│ │                          │  │  │                                                  │  ││
│ │ ─ INTELLIGENCE ───────   │  │  │                                                  │  ││
│ │  ◭ Demand                │  │  │                                                  │  ││
│ │  ♟ Guests                │  │  │                                                  │  ││
│ │  ✉ Campaigns             │  │  │                                                  │  ││
│ │  ♡ Feedback              │  │  └──────────────────────────────────────────────────┘  ││
│ └──────────────────────────┘  └────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Column geometry (desktop, ≥1024px):**
- **Compact shell:** the whole suite sits inside the existing business desktop content frame
  (centered, `maxWidth` per the desktop contract — do not let it run edge-to-edge on ultra-wide).
  Recommend suite `maxWidth: 1200`, centered, with the Hub chrome above it unchanged.
- **Col 1 (master rail):** fixed width **`260`** (`≈ spacing.xxl × 5 + xs`; express as a named
  `venueRailWidth = 260` token). Vertical scroll if bands overflow. Persistent.
- **Gutter between columns:** `spacing.lg` (24).
- **Col 2 (detail):** `flex: 1`, fills remaining width. Internal content respects a max readable
  measure for text-heavy modules (Menu storyteller copy capped ~`720`); data tables (Tables,
  Reservations) use full column width.
- **Two-column INSIDE col 2 where it helps:** Reservations uses a *nested* list-detail (a
  reservation list on the left of col 2, the selected reservation card on the right) ONLY at very
  wide widths (≥ ~1320 effective). Below that, the reservation detail opens as a right-docked panel
  / sheet over the list. This is the business desktop-web "two-column grid" contract honored one
  level deeper. (Open question Q3.)

**Active-row affordance (master):** the active module row gets a `warm` left-edge indicator
(3px bar) + `accent.tint` fill + `text.primary` label; inactive rows are `text.secondary` on
transparent, hover → `glass.tint` wash + `cursor: pointer` (web), no layout shift. Count/badge
chips (e.g. Reservations `42`, a `●` "needs attention" dot) sit right-aligned in the row.

### 2.2 Web phone — SINGLE COLUMN (how the two columns reflow)

Below 1024px on web, the two columns **stack into one**, and the master rail **converts to a top
navigator**:

- The 11-row master rail is **too tall to stack above content**. So on web-phone the module nav
  becomes a **horizontal segmented scroller** pinned under the Hub chrome — same idiom as
  `HubSubNav`'s pill scroller, so it's already familiar. Bands collapse to inline separators (a hair
  divider + faint band label between groups) so the scroller still reads as grouped.
- The active module's workspace fills the full single column below it.
- The nested col-2 list-detail (Reservations) **fully linearizes**: the list is the screen; tapping
  a reservation pushes/overlays the detail as a full-width panel with a back affordance.
- **Overflow:** if 11 pills are too many to scan in a scroller, the LAST pill is a `⋯ More` chip
  that opens a sheet listing the remaining modules (banded). First-ship has only ~6 visible
  (Overview, Tables, Availability, Reservations, Waitlist, Settings) so a scroller suffices; the
  `More` sheet is the scale valve for when Menu/Demand/etc. light up. (Open question Q1.)

```
WEB PHONE ( <1024px )
┌─ Hub chrome ───────────────────────────┐
│ Events Experiences Trips ▸Venue◂        │
├─────────────────────────────────────────┤
│ [Overview][Tables][Avail][Reserv…][⋯]   │  ← module segmented scroller (reflowed master)
├─────────────────────────────────────────┤
│                                         │
│   active module workspace               │
│   (full single column)                  │
│                                         │
└─────────────────────────────────────────┘
```

### 2.3 Mobile app — SINGLE COLUMN inside the Hub Venue tab

Native has no two-column affordance and must respect the Hub shell + the thumb zone. Model:

- Entering the Venue pill in `HubSubNav` lands on **Overview** by default (mirrors `hub/index.tsx`
  redirecting to a canonical landing).
- The module nav renders as a **secondary horizontal pill row** directly beneath `HubSubNav`
  (visually lighter than the Hub pills: smaller, `glass`-tinted, not `warm`-filled — so the two
  rows never read as the same control). This is the same nested-nav concern from §1.1, resolved by
  weight differentiation.
- The pill row shows the **first-ship modules** inline (Overview · Tables · Availability ·
  Reservations · Waitlist · Settings). As later bands light up, an end-cap `⋯` pill opens a
  **`BaseBottomSheet`** module picker (banded list with icons + counts) — the native analog of
  web-phone's `More` sheet. This keeps the always-visible row short (adoption) while the full suite
  is one tap away (depth).
- The active module workspace is a **sectioned vertical scroll** filling the tab body.
- Module-internal views (Reservations' Today/Upcoming/etc.) are a **secondary segmented control**
  at the top of the workspace — NOT the pill row, NOT a route push.
- Reservation detail, add-table, availability-edit, etc. open as **`BaseBottomSheet` / `TopSheet`**
  overlays (sub-flows in sheets preserve context — the Mingla navigation contract), never new
  full-screen routes that fight the tab bar.

```
MOBILE APP (Hub > Venue)
┌─ TopBar (brand chip · +) ──────────────┐   ← Hub chrome (unchanged)
│ Events Experiences Trips ▸Venue◂        │   ← HubSubNav (Venue active)
├─────────────────────────────────────────┤
│ Overview Tables Avail Reserv Wait ⋯     │   ← suite module pill row (lighter weight)
├─────────────────────────────────────────┤
│  [ Today | Upcoming | Waitlist | … ]    │   ← module-internal segmented control
│  ┌───────────────────────────────────┐  │
│  │ reservation card                  │  │
│  │ reservation card                  │  │   ← sectioned vertical scroll
│  │ …                                 │  │
│  └───────────────────────────────────┘  │
│            [ + New reservation ]  ◀──────┼── primary action in thumb zone
└─────────────────────────────────────────┘
```

### 2.4 Responsive contract summary (one table)

| Concern | Desktop ≥1024 | Web phone <1024 | Mobile app |
|---|---|---|---|
| Module nav | Col-1 vertical master rail (260px, banded) | Top segmented scroller + `⋯ More` sheet | Secondary pill row + `⋯` `BaseBottomSheet` |
| Module workspace | Col 2, `flex:1` | Full single column | Sectioned vertical scroll |
| Module-internal views | Segmented control atop col 2 | Segmented control | Segmented control |
| Detail (e.g. a reservation) | Right panel in col 2 (nested two-col when very wide) | Full-width pushed/overlaid panel | `BaseBottomSheet` overlay |
| Primary action | Top-right of workspace, button | Top-right / sticky | Thumb-zone sticky button |
| Gate | `isWideDesktop === true` | web && `!isWideDesktop` | `Platform.OS !== 'web'` |

---

## 3. THE TOGGLE UX (OFF → "Reservations" → ON)

Per LOCKED DECISION 4: a **single "Reservations" capability toggle** unlocks the whole suite; the
existing listing stays the always-on Overview/Profile base. Not multiple toggles, not auto-on.

### 3.1 OFF state — Overview/Profile only (the preserved listing, reimagined)

With the toggle OFF, the Venue suite is **just two modules**: Overview and Settings (Band A). The
existing listing — status, AI match scores, gallery, public hours, feedback — **becomes the
Overview module body**, unchanged in substance, re-housed in the suite shell. Bands B/C/D are
**absent from the nav** (not greyed — absent; a greyed list of 9 locked rows would read as a
paywall and kill adoption).

At the bottom of the Overview, an **invitation card** teaches and drives the upgrade — the single
most important adoption moment in the suite:

```
┌─ TURN ON RESERVATIONS ────────────────────────────────┐
│  ◷  Take table reservations on Mingla                  │
│                                                        │
│  Let Mingla guests book a table straight from the      │
│  app — you set the tables, hours, and (optionally) a   │
│  reservation fee. Free to switch on.                   │
│                                                        │
│  ▸ Tables, availability & a live reservation list      │
│  ▸ Bookings from the Mingla deck & your venue page     │
│  ▸ Waitlist when you're full                           │
│                                                        │
│            [  Turn on Reservations  ]  ◀── primary     │
└────────────────────────────────────────────────────────┘
```

- Copy is Mingla-voiced: confident, plain, zero jargon ("Free to switch on" removes the #1
  hesitation). It promises ONLY first-ship capabilities (per `feedback_mingla_positioning` honesty
  rule — no "Demand intelligence" promise here; that's not shipped).
- The toggle also lives in **Settings → Reservations** as the canonical switch; the Overview card is
  the discovery surface. Both write the same `reservations_enabled` capability flag.

### 3.2 The transition (OFF → ON)

Tapping "Turn on Reservations":
1. A brief **setup sheet** (or col-2 panel on desktop) confirms the 3 must-haves to actually take a
   booking, framed as a 3-step starter, NOT a wall of settings: **Add at least one table → Set your
   hours → (optional) Reservation fee.** Each step is skippable but the nav shows a `●` until done.
2. On confirm, the capability flag flips, **Bands B (and the gated C/D nav slots) animate in** to
   the master rail (staggered fade+slide, §5), and the suite lands the operator on **Tables** with
   its empty state, because the very next job is "add a table."

This staged reveal makes the unlock feel like the app *grew*, not like a settings checkbox.

### 3.3 ON state — empty states that teach and drive adoption

Every first-ship module has a designed empty state that (a) explains the module's job in one line,
(b) gives ONE primary action, (c) carries Mingla personality without sacrificing clarity:

| Module | Empty headline | Body | Primary action |
|---|---|---|---|
| Tables | "No tables yet" | "Add your tables so Mingla knows what's bookable. Start with your most-requested ones." | `+ Add table` |
| Availability | "Set when you take bookings" | "Hours, turn times, and how many parties per slot. We'll handle the math." | `Set hours` |
| Reservations | "No reservations yet" | "When guests book — from Mingla or here — they land in this list. Add one to test the flow." | `+ New reservation` |
| Waitlist | "Nobody's waiting" | "When you're full, drop walk-ins here and text them when a table opens." | `+ Add to waitlist` |
| Demand (later) | "Demand is warming up" | "Once bookings flow, you'll see your hottest times and open gaps to fill." | (none — informational) |

**Adoption nudge chain:** Tables empty → after first table, Availability still empty → Overview
shows a "1 step left: set your hours" to-do row (reuses the `BusinessTodoToggle` pattern already in
the Hub shell). This routes the operator through the minimum-to-go-live path without a wizard.

---

## 4. FIRST-SHIP SCREEN DESIGNS

Structural wireframes + component + state inventory. Tokens referenced are the live business tokens
(`spacing`, `radius`, `accent.warm`, `text.*`, `glass.*`, `canvas.*`, `typography.*`). Glass usage
states BOTH iOS-translucent and Android-opaque values (§6, Android policy).

### 4.1 Overview — venue command center

The glance-and-go dashboard. A **bento grid of stat cards** (asymmetric, scannable) topped by the
venue identity strip, anchored by the hero CTA "Fill open tables."

```
OVERVIEW (col 2 / mobile workspace)
┌────────────────────────────────────────────────────────┐
│  VENUE NAME            ● Open now · closes 10 PM         │  identity strip
│  ◷ AI match: 87 · ★ 4.6 · Reservations ON               │
├────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
│  │ 42           │ │ 18           │ │ 7            │     │  bento KPI row
│  │ covers today │ │ seats open   │ │ waiting     │     │
│  └──────────────┘ └──────────────┘ └──────────────┘     │
│  ┌───────────────────────────┐ ┌──────────────────┐     │
│  │ ◷ 7:30 PM is your hottest │ │ 👥 Groups of 4   │     │  insight cards
│  │   time                    │ │   are trending   │     │  (wider + narrow)
│  └───────────────────────────┘ └──────────────────┘     │
│  ┌────────────────────────────────────────────────┐     │
│  │ 👀 People are viewing your brunch menu          │     │  demand teaser
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │      ⚡ Fill open tables                         │     │  HERO CTA
│  │      One-tap push to matching Mingla guests     │     │  (warm fill)
│  └────────────────────────────────────────────────┘     │
│  ── existing listing: gallery · public hours · feedback │  preserved base
└────────────────────────────────────────────────────────┘
```

- **Bento grid:** desktop = 3-up KPI row + 2-up insight row + full-width teaser (CSS grid,
  `gap: spacing.md`); web-phone/mobile = 2-up KPI, then 1-up stacked. Cards are `GlassCard` with
  `radius.lg`.
- **Stat-card anatomy:** value in `typography.statValue` (`accent.warm` for the headline KPI,
  `text.primary` otherwise), label in `typography.caption` `text.secondary`, optional trend glyph.
  Tabular-nums for all numbers (`fontVariant: ['tabular-nums']`).
- **Hero CTA "Fill open tables":** `accent.warm` fill, `text.inverse`, `radius.lg`,
  `typography.buttonLg`; routes into Campaigns (later ship) — until Campaigns ships, the CTA opens a
  "Coming soon — get notified" sheet rather than a dead tap (honesty + no dead taps). (Open Q5.)
- **Crucial honesty rule:** an insight/KPI card renders ONLY when it has real data (mirrors the
  `home.tsx` "analytics tiles only render with real numbers" contract from memory). No invented "42
  covers" on a venue with zero bookings — empty Overview shows the toggle/adoption state instead.
- **States:** loading (skeleton bento), empty (pre-booking adoption nudge), populated (above),
  error (per-card "couldn't load" with retry, never a blank grid).

### 4.2 Tables — inventory (not floor plan)

A **dense, sortable table-of-tables** (the operator is comparing), with `+ Add table` opening a
sheet, and Smart Capacity Rules as a collapsible panel.

```
TABLES
┌────────────────────────────────────────────────────────┐
│  Tables                        [ ⚙ Capacity rules ] [+] │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Name  Seats  Min–Max  Zone     Type    Combine ● │  │  header row
│  ├──────────────────────────────────────────────────┤  │
│  │ T1     2     1–2      Patio    High-top   —    ●  │  │
│  │ T2     4     2–5*     Indoor   Booth      ✓    ●  │  │  * = rule override
│  │ T6     6     4–6      Indoor   Standard   ✓    ●  │  │
│  │ PR     12    8–14     Private  Lounge     —    ○  │  │  ○ = inactive
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

**Add/Edit Table sheet** (`BaseBottomSheet` native / right panel desktop), fields per VISION §2:
name/number · capacity · min/max party · combineable toggle · zone tag (indoor/outdoor/private/
bar/patio) · accessible toggle · type (high-top/booth/lounge/standard) · active toggle · notes.
- Field grouping: **Identity** (name, capacity) → **Party fit** (min/max, combineable) →
  **Character** (zone, type, accessible) → **Status & notes**. Each group a `GlassCard` section.
- Inputs follow the business form tokens; toggles are the standard switch; the active toggle is
  prominent (it's the on/off-the-floor control).

**Smart Capacity Rules (MVP)** — collapsible panel, rule rows in plain language (VISION examples):
"No 2-tops on a 6-top" · "Allow 5 on a 4-top (you approve)" · "8+ requires deposit" · "Patio is
reservation-only on weekends" · "Private room needs manager approval" · "Bar = walk-in only." Each
rule is a toggle + inline param (the number, the day-set). MVP ships a fixed rule catalog with
on/off + params, NOT a freeform rule builder (scope control). A `*` on a table's Min–Max signals an
active override rule.
- **States:** empty (the adoption nudge from §3.3), populated (grid), saving (optimistic row insert
  + spinner), error (row reverts + toast), inactive tables (dimmed row, still editable).

### 4.3 Availability — hours / turn-time / buffers

A **structured editor**, not a free calendar: three stacked sections.

```
AVAILABILITY
┌────────────────────────────────────────────────────────┐
│  ① Business hours                                       │
│     Brunch  Sat–Sun  10:00–15:00          [edit]        │
│     Dinner  Tue–Sun  17:00–22:00          [edit]        │
│     + Add service period                               │
│  ② Turn time by party size                             │
│     P2  75m   P4  90m   P6+  120m         [edit]        │
│  ③ Booking controls                                    │
│     Buffer between seatings   15m                       │
│     Max reservations / slot   6                         │
│     Reservation window        opens 30d · closes 1h     │
│  ④ Blackouts & holidays                                │
│     Dec 24 (closed) · Dec 31 (special hours)  [+]       │
└────────────────────────────────────────────────────────┘
```

- **Service period editor** (sheet/panel): label · days-of-week multi-select · start/end time ·
  type (dine-in/takeout/private) · which menu attaches (later, when Menu ships).
- **Turn-time editor:** a small matrix of party-size buckets → minutes; the engine uses these to
  compute slot availability for the consumer picker.
- **Availability Suggestions** (the AI nudge, VISION §3): an inline `accent`-tinted advisory card —
  *"You're blocking too much capacity at 7 PM. Opening two more 2-top slots could increase
  bookings."* Dismissible; renders only with real signal. (Later-ship data; nav-slot in first ship
  unless Demand data exists.)
- **States:** empty (set-hours nudge), partial (hours set, no turn times → "1 step left" hint),
  complete, saving, error.

### 4.4 Reservations — the main list + the reservation card + lifecycle

The operational heart. **Segmented views** (Today · Upcoming · Waitlist · Completed · No-shows ·
Canceled) over a **list of reservation cards**, with a detail panel/sheet for actions.

```
RESERVATIONS
┌────────────────────────────────────────────────────────┐
│ [ Today | Upcoming | Waitlist | Completed | No-shows… ] │  segmented views
│                                          [ + New ]      │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 7:30 PM  Amaka Johnson          ● Confirmed   ›    │ │  reservation card
│ │ Party of 4 · Table T2 · 🎂 Birthday               │ │
│ │ Deposit paid · ✦ First Mingla booking             │ │  source/tags row
│ └────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 8:00 PM  D. Okafor              ⏳ Pending     ›    │ │
│ │ Party of 2 · Table — · From Mingla                │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

**Reservation card anatomy** (the VISION exemplar): time (lead, `typography.h3` tabular) · guest
name · **status pill** (color-coded) · party size · table assignment · occasion glyph · payment
status · source · tags (VIP/birthday/first-time/regular/high-risk). The card reuses the
`OfferingListCard` structural DNA (cover/thumb slot → status pill → title → subline → metric →
right-rail manage), recolored for reservations — **not a parallel card system.**

**Status pill colors** (color is never the ONLY indicator — each pairs with a glyph + label):
- Pending `⏳` — `text.secondary` neutral
- Confirmed `●` — success green
- Arrived/Seated `◐` — `accent.warm`
- Completed `✓` — muted/faded
- No-show `⚠` — error/danger
- Canceled `✕` — faded strike-through treatment

**Lifecycle actions** (VISION §4) — on the detail panel/sheet: Confirm · Message · Change table ·
Add note · Mark arrived/seated · Mark no-show · Mark completed · Cancel. Layout: **safe actions as
chips/buttons in the thumb zone; destructive (Cancel, No-show) require a reach + confirm** (per the
"destructive needs friction" principle). Status transitions are **optimistic** (§5).

```
RESERVATION DETAIL (sheet/panel)
┌────────────────────────────────────────────┐
│ Amaka Johnson                         ✕     │
│ 7:30 PM · Party of 4 · Table T2             │
│ 🎂 Birthday · Deposit paid · From Mingla    │
│ "Window seat if possible" — guest note      │
│ ─────────────────────────────────────────── │
│ [ Confirm ] [ Message ] [ Change table ]    │  primary row (thumb zone)
│ [ Mark arrived ]  [ Add note ]              │
│ ─────────────────────────────────────────── │
│ [ Mark no-show ]      [ Cancel ]            │  destructive (reach + confirm)
└────────────────────────────────────────────┘
```

**Manual create** (`+ New`): a short sheet — guest name · party size · date · time (from available
slots) · table (auto-suggested from capacity rules, overridable) · occasion · tags · note · source
(defaults "phone"). Reuses the consumer slot-picker logic (§4.7) so operator + guest see the same
availability truth.

- **States per view:** empty (per §3.3), populated, loading (skeleton cards), creating (optimistic
  insert), action-in-flight (button spinner + disabled), error (revert + toast), realtime-incoming
  (a new Mingla booking animates into Today/Upcoming with a brief `accent` glow + optional haptic).

### 4.5 Waitlist

Lighter than Reservations: a **queue list** with wait estimates and one-tap "table's ready."

```
WAITLIST
┌────────────────────────────────────────────────────────┐
│  Waitlist · 7 waiting              [ + Add to waitlist ]│
│  ┌────────────────────────────────────────────────────┐ │
│  │ 1 · Tunde · Party 2 · ~20m · Patio ok   [Notify] ›│ │
│  │ 2 · Mara · Party 4 · ~35m              [Notify] › │ │
│  └────────────────────────────────────────────────────┘ │
│  ⓘ You lost 9 waitlist guests last Fri 8–9 PM.         │  smart advisory (later data)
└────────────────────────────────────────────────────────┘
```

- **Add-to-waitlist sheet:** guest · party size · preferred seating · SMS-when-ready toggle ·
  auto-expire after X. **Notify** sends the "table's ready" SMS (reuses the `marketing-send` / SMS
  infra later; first ship may stub to a simple notify). **Convert to reservation** promotes a
  waitlist entry into the Reservations list with one action (shared create path).
- Position numbers are ordered, drag-reorder is a nice-to-have (defer). Lost-guest tracking is a
  later-ship analytic; the advisory card renders only with real data.
- **States:** empty ("Nobody's waiting"), populated, notifying (button → "Notified ✓"),
  expired-entry (faded + auto-removed), error.

### 4.6 Settings

Always-on (Band A). Grouped `GlassCard` sections; this is where the **Reservations toggle** lives
canonically.

Sections (VISION §11): **Venue profile** (name, address, contact — much reuses the existing claim/
listing data) · **Hours** (links to Availability) · **Reservation rules** (cancellation policy,
deposit rules, the **reservations_enabled toggle**, **optional reservation fee**) · **Tax/service
charges** (the all-in pass/absorb toggles — reuses the existing brand fee/tax engine, NOT a new
control) · **Team permissions** (Owner/Manager/Host/Server/Marketing/Finance/Scanner roles) ·
**Notifications** · **Integrations** · **Payment settings** (Stripe/Paystack status, reused).

- **Reservation fee control:** a toggle ("Charge a reservation fee") → amount input → a one-line
  preview of what the guest sees all-in (WYSIWYP), reusing the existing all-in pricing engine and
  the brand pass/absorb switches. NO new tax form, NO billing-address field (per the
  ORCH-1130/ORCH-1025 "no buyer tax form" invariant — venue tax stays server-sourced).
- **States:** loaded, saving (per-section optimistic), error, role-gated (a Host sees fewer
  sections than an Owner — sections the role can't edit are hidden, not greyed).

### 4.7 CONSUMER booking surface (closes the loop)

This is the build that makes the operator tools non-empty. Two entry points + one reserve flow.

**Entry A — App deck card (`SwipeableCards`).** A venue with `reservations_enabled` gets a
**"Reserve a table" affordance on its deck/expanded card** — a secondary action alongside the
existing Save/Book, NOT a new card type. It mirrors the experience deck-card "Book" pattern
(ORCH-1065): brand badge + a `Reserve` chip → opens the reserve sheet. The deck stays a *choosing*
surface — the chip is light, the commitment happens in the sheet.

**Entry B — Public venue page.** A **floating "Reserve a table" button** (parity with the existing
floating reserve-button on trip/experience public pages — per the all-surface-parity memory rule;
this MUST land on web + business iOS/Android + consumer app). Tapping → the reserve flow.

**The reserve flow (sheet sequence, `BaseBottomSheet`):**

```
RESERVE  (step 1: party + date)        →  (step 2: time)         →  (step 3: confirm/pay)
┌──────────────────────────┐    ┌──────────────────────────┐   ┌──────────────────────────┐
│ Reserve at VENUE     ✕   │    │ Pick a time          ‹   │   │ You're all set?      ‹   │
│ Party size  [- 4 +]      │    │ Fri Jun 20 · Party 4     │   │ Fri Jun 20 · 7:30 PM     │
│ Date        [ Jun 20 ▾ ] │    │ ◷ 6:45  7:00  7:30 ●     │   │ Party of 4               │
│                          │    │   8:00  8:15  (8:30 full)│   │ Reservation fee  $10 ◀───│ if set
│        [ See times ]     │    │        [ Continue ]      │   │ all-in · no surprises    │
└──────────────────────────┘    └──────────────────────────┘   │   [ Confirm & pay ]      │ → PaymentSheet
                                                                 │   or [ Confirm ] (free)  │
                                                                 └──────────────────────────┘
```

- **Step 1 — Party + date:** stepper for party size (respects venue min/max), date picker bounded
  by the reservation window. One primary action.
- **Step 2 — Time:** a grid of **available slots** computed from Availability (hours × turn-time ×
  max-per-slot × buffers × capacity rules). Full slots are visibly disabled ("full"), never hidden
  (teaches scarcity → nudges adjacent times). The selected slot gets the `accent.warm` ring.
- **Step 3 — Confirm:**
  - **Free reservation (default):** single `Confirm` → booking created → confirmation.
  - **Fee set:** shows the fee **all-in, WYSIWYP** (no itemized tax/fee breakdown beyond the
    combined line per the cart "one combined Fees & tax line" rule), `Confirm & pay` → **native
    PaymentSheet** via `ticket-checkout-create` (the existing all-in Stripe/Paystack engine — NO
    billing address, NO browser, NO tax form). Routing (Stripe vs Paystack) inherits the brand's
    existing payout-country logic.
- **Confirmation state:** a celebratory but restrained confirmation (checkmark draw + venue name +
  the booking summary + "Added to your plans"), and a path to the consumer Calendar/Saved. A
  haptic success tick on native.
- **Loop closes:** the new reservation appears in the operator's Reservations → Today/Upcoming with
  source = `Mingla`, optionally animating in via realtime (§4.4).

- **Consumer states:** loading slots (skeleton grid), no availability ("Fully booked Fri — try
  Sat?" with a date nudge), payment in-flight (PaymentSheet owns it), payment failed (return to
  step 3 with a Mingla-voiced retry, booking NOT created), success, network error.

---

## 5. MOTION & MICRO-INTERACTIONS (restrained, on-brand)

Every animation declares trigger → curve → duration → property, with a `prefers-reduced-motion`
fallback. Durations use the system bands (micro 100–200 · standard 250–350 · emphasis 400–600).

| Interaction | Trigger | Curve | Duration | Property | Reduced-motion |
|---|---|---|---|---|---|
| Module switch (desktop col 2) | activeModule change | ease-out | 180ms | opacity 0→1 + 8px translateY | opacity only |
| Suite unlock (Bands B/C/D reveal) | toggle ON | spring (soft) | 400ms, staggered 40ms/row | opacity + translateX -12→0 | instant appear |
| Active master-row indicator | row select | ease-out | 150ms | left-bar scaleY + fill opacity | instant |
| Reservation status change (optimistic) | action tap | ease-out | 200ms | pill color cross-fade + card subtle scale 1→1.01→1 | color swap only |
| Incoming Mingla booking | realtime insert | ease-out | 350ms | card slide-in + `accent` glow pulse (1×) | appear, no glow |
| Slot select (consumer) | tap slot | spring | 220ms | ring scale 0.9→1 + haptic | ring appear |
| Confirmation checkmark | booking success | spring (draw) | 450ms | stroke-dashoffset draw + haptic tick | static check |
| Sheet present (all sub-flows) | open | platform sheet spring | ~300ms | translateY + scrim fade | reduced translate |
| KPI count-up (Overview) | data load | ease-out | 600ms | number interpolate | final value, no count |

Principles honored: motion = language (enter from where it came, feedback that something happened),
never decoration. The single celebratory moment (confirmation) earns emphasis-band timing;
everything operational stays micro/standard so the host stand never feels laggy.

---

## 6. PER-SURFACE DELTAS + ACCESSIBILITY

### 6.1 Android glass opaque-fallback (hard policy — every glass surface)

The suite uses `GlassCard` + sheet glass extensively (master rail, KPI cards, reservation cards,
sheets). For EACH:
- **iOS:** translucent `glass.tint.profileBase` fill + real blur + border `glass.border.profileBase`.
- **Android:** opaque fill **`rgba(20,22,26,0.92)`** (the kit-consistent value already used by
  `OfferingListCard`), via `Platform.select`; **`overflow: 'hidden'`** to clip the fill to
  `radius.lg`; **NO Android shadow** under the rounded opaque fill (square-halo artifact).
- Gate: `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. Never reintroduce translucent Android fills; never
  flatten the iOS glass.

### 6.2 Web vs native deltas

- **Web:** hover states on master rows / buttons / slots (`glass.tint` wash + `cursor:pointer`),
  causing NO layout shift; focus-visible rings for keyboard nav (the desktop two-column suite must
  be fully keyboard-navigable — master rail = a `tablist`, workspace = `tabpanel`). Lucide icons
  via the established web shim (`lucide-react` Proxy) — per-icon named imports only, never barrel
  import (bundle-budget gate).
- **Native:** press + haptic feedback (no hover); sheet gestures (swipe-to-dismiss) on all
  sub-flows; safe-area insets respected (the Hub shell already pads `insets.top`); the suite body
  must clear the bottom tab bar.
- **Both:** the module-internal segmented controls are real segmented controls (role `tablist`),
  not free pills, so screen readers announce "tab 2 of 6."

### 6.3 Accessibility floor

- **Touch targets ≥44pt** — master rows, pills, slot chips, all lifecycle action buttons. The
  consumer slot grid in particular: each slot ≥44×44 with adequate spacing (fat-finger safe).
- **Contrast ≥4.5:1** — `text.primary` (0.96 white) on `canvas.discover` (#0c0e12) passes
  comfortably; `text.secondary` (0.72) reserved for non-essential meta; `text.tertiary` (0.52) only
  for large/decorative — verify any small tertiary-on-glass pairing hits ≥4.5:1 or bump to
  secondary. `accent.warm` (#eb7825) on dark passes for large text/icons; for small text on warm
  fill use `text.inverse`/near-black (the existing pill pattern uses `#0c0e12` on `warm`).
- **Color never the only signal** — every reservation status pairs a glyph + text label with its
  color; full vs open slots show "full" text, not just a dim color.
- **Reading order = visual order**; reduced-motion honored everywhere (§5).
- **Dynamic Type** — labels scale; the master rail row height grows with type; the bento grid reflows
  rather than truncating KPI values.
- **One-handed reachability** — every module's PRIMARY action (`+ New`, `Confirm & pay`) sits in the
  thumb zone on native; destructive actions require a deliberate reach.

---

## 7. OPEN DESIGN QUESTIONS (for Seth)

1. **Web-phone / mobile module overflow:** is a horizontal **segmented scroller + `⋯ More` sheet**
   the right reflow of the desktop master rail, or do you want the module nav to be a single
   **"Venue menu" sheet** opened from one button (cleaner top, one extra tap)? First-ship has ~6
   modules so the scroller is fine; this matters once Menu/Demand/etc. light up.
2. **Mobile nested-nav weight:** the suite adds a SECOND pill row under the Hub's Events/Experiences/
   Trips/Venue pills. Acceptable as designed (lighter weight to differentiate), or should entering
   Venue **replace** the Hub pill row with the module row to avoid two stacked pill bars on a phone?
3. **Reservations nested two-column (desktop):** at very wide widths, show the reservation **list +
   detail side-by-side** in col 2 (3 effective columns total), or always open the reservation detail
   as a right-docked panel/sheet over the list? Side-by-side is more powerful for a busy host stand;
   the panel is simpler and reflows more cleanly.
4. **Smart Capacity Rules scope:** confirm MVP = a **fixed catalog of toggleable rules with params**
   (the 6 VISION examples), NOT a freeform rule builder. The builder is a meaningful later ship.
5. **"Fill open tables" hero CTA before Campaigns ships:** Campaigns is a later band. For first ship,
   should the Overview hero CTA (a) open a "coming soon, notify me" sheet, (b) be hidden until
   Campaigns ships, or (c) route to a minimal one-tap push that reuses `marketing-send` now? I
   recommend (a) to keep the command-center complete without a dead tap.
6. **Reservation fee default + range:** free-by-default is locked. Do you want a suggested default
   fee (e.g. a per-seat hold) and a min/max guardrail, or fully venue-discretionary?
7. **Where the toggle's canonical home is:** I placed the switch in **Settings → Reservation rules**
   with the **Overview invitation card** as the discovery surface. Confirm, or do you want the toggle
   ALSO inline at the top of the Venue tab when OFF (more discoverable, slightly louder)?

---

## 8. Build-ready handoff notes (for the SPEC that embeds this)

- **Reuse, don't reinvent:** `GlassCard`, `OfferingListCard` DNA (recolor for reservation cards),
  `BaseBottomSheet`/`TopSheet` for all sub-flows, `HubSubNav` idiom for the reflowed module nav,
  `BusinessTodoToggle` for the adoption nudge chain, `useResponsiveLayout().isWideDesktop` for the
  two-column gate (NO new breakpoint), the existing all-in Stripe/Paystack `ticket-checkout-create`
  engine for the reservation fee (NO new tax/billing form — `orch-1130-no-buyer-tax-form` invariant).
- **New tokens proposed:** `venueRailWidth = 260` (master-rail width), a `venueSuiteMaxWidth = 1200`
  (compact-shell cap). Everything else maps to existing `spacing/radius/typography/text/glass/accent`
  tokens — no raw hex/spacing in components.
- **New nav surface:** a "Venue" pill in `HubSubNav` + `HubDataDrivenTabId` (venue-gated via
  `useHubVisibleTabs`), and a suite-internal `activeModule` state machine (the suite's `setCurrentPage`
  analog).
- **All-surface parity (non-negotiable):** the consumer "Reserve a table" surface must land on web +
  business iOS/Android + consumer app (incl. the floating reserve button), per the public-page
  all-surface-parity memory rule; OTA the consumer dev channel.
- **Honesty gate:** Overview KPI/insight cards render only with real data; later-band CTAs that aren't
  shipped open a "coming soon" sheet, never a dead tap.

---

*End of design IA artifact. This is the design foundation; the forensics SPEC turns it into the
build contract, and the implementor builds from the SPEC.*
