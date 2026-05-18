# INVESTIGATION — ORCH-0874 [Trip surfaces visual parity with Events]

**Owner:** Claude `mingla-forensics` (INVESTIGATE phase)
**Date:** 2026-05-18
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
**Confidence:** H (source-only audit, no live-fire required per dispatch §7.6 — code-read + design-pattern comparison is the right tool for visual parity work)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 1. Symptom summary

**Expected:** Trip planners and buyers experience trips and events as the same product family. The four trip-side surfaces (trips list / trip detail dashboard / trip create + edit wizard chrome / public trip page) inherit the visual language, navigation chrome, tile primitives, and design tokens that events use as canonical patterns.

**Actual:** All four trip-side surfaces diverge from the event-side equivalents in structurally significant ways. Most critically, the trip wizard has NO close affordance at all — operators can only walk back step-by-step. The trip detail page lacks the action-tile grid, hero treatment, and tile primitives that establish event detail's information density. The trip list uses raw inline-styled `Pressable` elements instead of a list-card primitive mirroring `EventListCard`. The public trip page lacks the full-bleed hero pattern of the public event page.

**Why it matters:** Mingla is positioned as one product family — when a trip planner who has also operated events lands on a trip surface, the chrome and tile language should feel identical. Today it doesn't. Trip surfaces look hand-rolled; event surfaces look polished. This investigation maps the gaps so the spec can prescribe exact mirror actions.

**Operator framing (verbatim):** *"a lot of elements will be copied from events visual only and the content mapped to trips"*. Hard constraint: visual + chrome parity only, no business logic refactor.

---

## 2. Phase 0 ingest — prior artifacts loaded

| Artifact | Relevance |
|---|---|
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0873_TR3_STAGE_2_UI.md` | Most recent trip-detail-page modification. Adds Money tab + PaymentPlanEditor + InstallmentScheduleDisplay + MoneyTabBody subcomponent. Status: implemented partially completed; 4 SCs deferred; 53 TS-debt errors flagged. These additions MUST survive ORCH-0874 — only restyle, never delete. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_BRAND_ONBOARDING.md` | Locks `PersonaPickerCards` literal union to `'place' \| 'event' \| 'trip'` (I-PROPOSED-TR1-PERSONA-INTERFACE) and `brands.kind` post-create immutability for `trip_planner` (I-PROPOSED-TR1-KIND-IMMUTABLE). Wizard chrome change does NOT touch these. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` (via WORLD_MAP entry + REWORK 5b notes) | Established `routeForEventRow` as the canonical trip-vs-event router; trip list mirroring events list MUST respect this. Established `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` — public trip page intentionally renders full-bleed under the status bar per operator pixel-review decision; SafeArea wrapping is operator-rejected. |
| `Mingla_Artifacts/WORLD_MAP.md` rows ORCH-0867/0868/0873/0874 | ORCH-0867 ("View public page" button missing on trip dashboard) is in fold-decision scope. ORCH-0868 (forwardRef RedBox cleanup) is out of scope. |
| Memory `feedback_anon_buyer_routes.md` | Public trip page must NEVER call `useAuth` — already compliant per current `app/t/[brandSlug]/[tripSlug].tsx`. |
| Memory `feedback_rn_sub_sheet_must_render_inside_parent.md` | Any new sheets added by this spec (e.g., publish-error sheet on trip wizard) must render inside parent JSX, not as Fragment siblings. |
| Memory `feedback_toast_needs_absolute_wrap.md` | Any new toast emission point needs the absolute wrap pattern. |

**Migration chain rule:** N/A — no DB-touching investigation.

---

## 3. Investigation manifest

22 files read in full or via parallel Explore agent. Order:

### Event-side canonical (8 files — Explore agent #1 + personal reads)
1. `mingla-business/app/(tabs)/hub/events.tsx` (861L) — events LIST
2. `mingla-business/src/components/event/EventListCard.tsx` (425L) — list card primitive
3. `mingla-business/app/event/[id]/index.tsx` (1030L) — event DETAIL dashboard
4. `mingla-business/src/components/event/EventDetailKpiCard.tsx` (143L)
5. `mingla-business/src/components/event/ActionTile.tsx` (97L)
6. `mingla-business/src/components/event/ReconciliationCtaTile.tsx` (34L)
7. `mingla-business/src/components/event/TicketTierCard.tsx` (317L)
8. `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` (90L) — public event page

### Event-side wizard chrome (3 files — personal reads)
9. `mingla-business/app/event/create.tsx` (119L) — create entry route
10. `mingla-business/app/event/[id]/edit.tsx` (439L) — edit entry route + create resume
11. `mingla-business/src/components/event/EventCreatorWizard.tsx` (959L) — wizard internals

### Trip-side current state (3 files — Explore agent #2 + personal reads)
12. `mingla-business/app/(tabs)/hub/trips.tsx` (233L) — trips LIST
13. `mingla-business/app/trip/[id]/index.tsx` (1063L) — trip DETAIL dashboard
14. `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (132L) — public trip page

### Trip-side wizard chrome (3 files — personal reads)
15. `mingla-business/app/trip/create.tsx` (114L) — create entry route
16. `mingla-business/app/trip/[id]/edit.tsx` (127L) — edit entry route
17. `mingla-business/src/components/trip/TripCreatorWizard.tsx` (588L) — wizard internals

### Trip-side step + tile inventory (5 files — Explore agent #2)
18-22. `TripCreatorStep1Basics.tsx`, `TripCreatorStep2Itinerary.tsx`, `TripCreatorStep3Inclusions.tsx`, `TripCreatorStep4Pricing.tsx`, `TripCreatorStep5Review.tsx` (component-level scan; full text not loaded into orchestrator context)

---

## 4. Event-side canonical patterns (what trips must mirror)

### 4.1 LIST page (`hub/events.tsx` + `EventListCard.tsx`)
- **Container:** `View flex:1` host (events.tsx:498–714) → `useSafeAreaInsets()` for bottom padding (`insets.bottom + 120`, events.tsx:550). Header chrome owned by parent `hub/_layout.tsx`.
- **Filter row:** Horizontal `ScrollView` (events.tsx:502–541) with 5 pills — All / Live / Upcoming / Drafts / Past (events.tsx:265–278). Pill visual: 34pt height, `glass.tint.profileBase` background, `radiusTokens.full`, 1pt border. Active state: `accent.tint` background. Live pulse: 6×6 `semantic.success` dot when filter="live" AND counts.live > 0 (events.tsx:527–529, 816–821). Hit-slop expands to 44pt WCAG. `flexGrow:0` prevents the well-known double-ScrollView footgun (per memory `feedback_rn_scrollview_flex_grow_default_one_silent_footgun`).
- **List primitive:** Plain `ScrollView` + `View` with `gap: spacing.md` (events.tsx:543–595, 731). Not FlatList. No pagination, no pull-to-refresh.
- **Empty state:** `GlassCard variant="elevated" padding={spacing.lg}` (events.tsx:556) — "No events yet" + "Tap the + button above to start your first event." + conditional "Build a new event" CTA when filter is All or Draft.
- **Loading/error states:** Delegated to store; no explicit skeleton.
- **Card primitive (`EventListCard.tsx`):**
  - Outer: `glass.tint.profileBase` background, `radiusTokens.lg`, 1pt `glass.border.profileBase` border, `overflow: visible`.
  - Layout: `flexDirection: row` with 76×92 cover (left, `radiusTokens.md`), body column (`flex:1`), right rail (absolute manage icon + revenue strip).
  - Cover: `EventCoverMedia` component with `coverHue` + optional `mediaUrl` + `mediaType` + draft overlay (`rgba(12,14,18,0.55)`).
  - Status pill: `Pill` primitive with variants `live` / `accent` / `draft`, plus inline `pastPill` style for past events.
  - Title: 15pt fontWeight 600, single-line truncation.
  - Date+venue subline: 11pt tertiary, single-line truncation.
  - Sold/revenue affordance: finite-capacity → 3pt progress track + accent.warm fill bar + label; unlimited → "X sold" text only; draft → "Series template" or "Not published".
  - Manage icon: right-rail 32×32 circular button with `glass.tint.chrome.idle`, `hitSlop=6`.
  - Revenue strip: bottom-right absolute, 13pt fontWeight 700, tabular-nums.
  - Past+0-sold: `opacity: 0.7`.
  - Press state: `opacity: 0.85`.
- **Navigation:** Card body press → `routeForEventRowDefensive()` (events.tsx:308–315). Manage icon → opens `EventManageMenu` Sheet.

### 4.2 DETAIL dashboard (`event/[id]/index.tsx`)
- **Container:** `View flex:1` with `#0c0e12` background. `useSafeAreaInsets()` supplies `paddingTop: insets.top` on header wrap and `paddingBottom: insets.bottom + spacing.xl` on ScrollView content.
- **Header chrome:** `TopBar` primitive (detail-index.tsx:595–614) with `leftKind="back"` → `handleBack()`. Title "Event" hardcoded. Right slot: two `IconChrome` buttons (36pt) — `share` (opens `ShareModal`) + `moreH` (opens `EventManageMenu`).
- **No tabs.** Single `ScrollView` with all sections stacked vertically.
- **Section order (top→bottom):**
  1. **Hero** (627–652): `EventCoverMedia` height=200, `radius={24}`, gradient overlay, `EventDetailHeroStatusPill`, 24pt title with text-shadow, 13pt date+venue subline.
  2. **Action grid** (655–714): `flexDirection: row, flexWrap: wrap, gap: 8`. Renders `ActionTile` components — Scan tickets (`primary={true}`), Scanners, Orders, Guests, Blasts, Public page, Brand page, Door Sales (conditional on `event.inPersonPaymentsEnabled`), Reconciliation (conditional on `VIEW_RECONCILIATION` permission via `ReconciliationCtaTile` wrapper).
  3. **Revenue KPI** (717–721): `EventDetailKpiCard` — `glass elevated`, dual-column (revenue 26pt, payout 16pt), 12-bar sparkline placeholder.
  4. **Currency warning** (723–730): `GlassCard variant="base"`, conditional.
  5. **Ticket types section** (733–751): `GlassCard variant="base"` + `EventDetailTicketTypeRow` children, "TICKET TYPES" eyebrow label.
  6. **Recent activity** (754–768): `GlassCard variant="base"` + `EventDetailActivityRow` children, "RECENT ACTIVITY" eyebrow, 5-row cap.
  7. **Cancel event CTA** (770–784): `Button variant="ghost" fullWidth`, gated on live/upcoming + canEditEvent permission.
- **Root-mounted overlays:** `ShareModal`, `EventManageMenu` (conditional mount on `brand !== null && manageMenuVisible`, ORCH-0862 unmount-on-close fix), `EndSalesSheet`, Cancel `ConfirmDialog` (typeToConfirm variant).
- **Toast wrap:** absolute top-anchored View with `top: 80`.

### 4.3 Tile primitives
- **`ActionTile`:** Pressable. `flexBasis: 48%`, `minHeight: 76`, `padding: spacing.md - 2`, `glass.tint.profileBase` background, `radiusTokens.md`, 1pt `glass.border.profileBase` border, `flexDirection: column`, `gap: 4`. Icon 20pt (`primary` ⇒ accent.warm), label 13pt fontWeight 600, optional sub 11pt tertiary. Primary variant: `accent.tint` background + `accent.border` + accent.warm icon. Pressed: `opacity: 0.7`. `accessibilityRole="button"` + `accessibilityLabel={label}`.
- **`EventDetailKpiCard`:** `GlassCard variant="elevated" radius="lg" padding=spacing.lg`. Dual-column row: REVENUE label + 26pt value (left) / PAYOUT label + 16pt value (right). Sparkline placeholder (12 bars × 28pt total height). `hasData` guard.
- **`ReconciliationCtaTile`:** Wraps `ActionTile`. Returns `null` if permission missing (Constitution #1 — no dead taps).
- **`TicketTierCard`:** `React.memo`. Outer row: reorder column (up/down chevrons, 28×28, glass) + card body (`GlassCard variant="base"` padding=spacing.md). Header row (title col + actions row: Duplicate / Edit / Delete). Stats row (Price / Capacity / Sold cells). Badges row (`Pill` modifiers). Error state: `semantic.error` border. Disabled: Delete hidden when `hasSales=true`; reorder boundaries.

### 4.4 PUBLIC page (`app/e/[brandSlug]/[eventSlug].tsx`)
- **Route**: `/e/{brandSlug}/{eventSlug}`. Anon-tolerant — no `useAuth`. Outside `app/(tabs)/`.
- **States:** Loading (`ActivityIndicator` + "Loading event..." text), error ("Event could not load"), not found (`PublicEventNotFound`), success (`PublicEventPage`).
- **Delegated rendering:** `PublicEventPage` owns the actual layout (full-bleed cover + X-close + share buttons overlaid, sections stacked).
- **Host wrapper:** `flex: 1`, `#0c0e12` background. NO SafeArea wrap (full-bleed intentional per ORCH-0859 REWORK 5b allowlist tag).

### 4.5 Event WIZARD CHROME (`EventCreatorWizard.tsx`)
- **Routing:** `/event/create` → `useCreateServerDraft` → `router.replace('/event/{id}/edit?step=0')`. `/event/[id]/edit` resolves the draft (legacy local migration, server draft, or `mode=edit-published` LiveEvent) and mounts `EventCreatorWizard` with `isCreateMode` flag derived from `lastStepReached === 0 && name.length === 0`.
- **Chrome row (lines 653–670):** `[IconChrome icon="close" size=36] [Stepper steps] [step counter "1/7"]`. The Close X is ALWAYS rendered, regardless of mode.
- **Subtitle row (672–693):** "{brand.displayName} · Step N of 7" + autosave state ("Saving..." / "Saved" / "Unsaved changes - retrying").
- **Body (704–731):** ScrollView with `paddingBottom: keyboardHeight`. Eyebrow ("Step N of 7") + 26pt title + 14pt subtitle (`STEP_DEFS` lines 83–91). Step body component below.
- **Dock (739–808):** `GlassCard variant="elevated" radius="xxl"` floating, hidden when keyboard up. Layout varies by step:
  - **Step 1:** single full-width "Continue" button (no in-wizard Back — chrome X handles exit).
  - **Steps 2–6:** `[Back ghost flex:1] [Continue primary flex:1]`.
  - **Step 7:** `[Back ghost flex:1] [Publish primary flex:2]`. Publish disabled when `publishability.status === 'blocked-stripe'` or `coverVideoProcessing`.
- **handleClose (434–460):**
  - **Create mode + pristine:** `discardDraft()` immediately + `onExit('abandoned')`.
  - **Create mode + dirty:** open Discard `ConfirmDialog` ("Discard this event?" / "You'll lose your changes." / Discard|Keep editing, destructive).
  - **Edit mode:** simple `onExit('abandoned')` — no dialog (auto-save semantics).
- **Publish flow (502–566):** validate → `PublishErrorsSheet` if errors → `ConfirmDialog` ("Publish event?" / "Publish recurring event? N occurrences..." / "Publish event with N dates?") → 1.2s artificial wait → call `onPublishDraft(draft)` → on success route to `/e/{brandSlug}/{eventSlug}`.
- **Overlays at root JSX (810–852):** Discard `ConfirmDialog`, Publish `ConfirmDialog`, `PublishErrorsSheet`, Toast (absolute top wrap).
- **Keyboard handling:** `Keyboard.addListener` for show/hide, dynamic `paddingBottom: keyboardHeight`, deferred `scrollToEnd` via `requestAnimationFrame`. Dock hidden when keyboard visible.

---

## 5. Trip-side current state (what diverges)

### 5.1 LIST page (`hub/trips.tsx`, 233L)
- **Container:** Raw `ScrollView`. NO SafeAreaView; no insets handling.
- **No filter row at all.** Single flat list by creation order (descending). No tabs, no segmented control.
- **List primitive:** `trips.map()` directly into a `View` with `styles.tripsList` (gap `spacing.sm`). Each trip is a top-level `Pressable` with inline `styles.tripCard`.
- **Card visual (NO dedicated card component):**
  - `flexDirection: row` (icon right-aligned)
  - `padding: spacing.lg`, `borderRadius: radius.lg`
  - `backgroundColor: rgba(255,255,255,0.03)`, `borderColor: rgba(255,255,255,0.08)` (1px)
  - Gap `spacing.md` between text column and icon
  - **NO hero image / cover. NO progress bar. NO revenue strip. NO manage icon.**
  - Status: inline text in `accent.warm` (caption fontSize, fontWeight 600) — NOT a `Pill` primitive.
- **Navigation (lines 118–129):** Draft trips → `/trip/{id}/edit`; non-draft → `/trip/{id}`. Does NOT use `routeForEventRow` helper.
- **Empty / non-trip-planner / loading / error states:** Each state-specific copy + placeholder card with `glass.tint.profileElevated` + `radius.xl`. Reasonable patterns but not aligned with `GlassCard variant="elevated"` event pattern.

### 5.2 DETAIL dashboard (`trip/[id]/index.tsx`, 1063L — ORCH-0873 modified)
- **Container:** `SafeScreen` wrapper, `flex:1 backgroundColor:#0c0e12`.
- **Header (lines 445–452):** Inline View. `[36×36 back Pressable] [centered title h3] [right "Edit" Pressable]`. **NO View-public-page button** (this is the ORCH-0867 gap). NO share icon. NO manage menu trigger.
- **Status pill row below header (lines 255–268):** Conditional `styles.statusPillLive` (`rgba(34,197,94,0.16)`) or `styles.statusPillDraft` (`rgba(255,255,255,0.06)`). Caption fontWeight 600.
- **Tabs (lines 502–508):** Three tabs — Overview / Travelers (count in label) / Money (at-risk count badge in red when > 0 per ORCH-0873). Bottom border `accent.warm` 2px on active. Inactive text `textTokens.secondary`, active `textTokens.primary`.
- **Tab content (ALL inline-styled, no imported tile components):**
  - **Overview (325–364):** 4 KPI tiles in 2-row grid: Revenue, Travelers, Departure, Destination. Each tile: `padding: md, borderRadius: md, bg: rgba(255,255,255,0.03), border: 1px rgba(255,255,255,0.08), gap: xs`. Label (caption tertiary) + value (h3 fontWeight 700 primary).
  - **Travelers (365–396):** Loading (`ActivityIndicator`), empty (`users` icon + "No travelers yet..."), populated rows with name + email + payment status + amount.
  - **Money (397–409):** Renders `MoneyTabBody` subcomponent (lines 758–1063, defined inline in same file). Filter chips (All / At risk), per-booking expand/collapse rows, installment ledger rows with status pills + Retry button + Refund stub.
- **NO hero. NO action grid. NO TicketTierCard equivalent (single tier on trips). NO recent activity feed. NO cancel CTA.**

### 5.3 PUBLIC page (`app/t/[brandSlug]/[tripSlug].tsx`, 132L)
- **Auth posture:** Compliant — no `useAuth`, lives outside `app/(tabs)/`.
- **SafeArea:** No `SafeScreen` wrap (intentional per ORCH-0859 REWORK 5b — full-bleed cover under status bar).
- **Sections (lines 88–101):** ScrollView host → `TripPreview` (cover + title + brand byline + dates/destination/capacity meta + description + day-by-day itinerary cards + inclusions/exclusions + pricing card) → `TripCheckoutFlow` (tier card + "Reserve my spot" CTA).
- **Hero treatment:** `TripPreview` renders cover image at 100% width × 220 height, or "No cover image" placeholder. **NO X-close button overlay. NO share button overlay** like the public event page has.

### 5.4 WIZARD CHROME (`TripCreatorWizard.tsx`, 588L)
- **Routing:** `/trip/create` → `useCreateTripDraft` → `router.replace('/trip/{id}/edit')`. `/trip/[id]/edit` loads the trip via `useTrip` and mounts `TripCreatorWizard`. **No `isCreateMode` flag — wizard has no create-vs-edit semantic distinction today.**
- **Header (lines 412–429):** `[chevL back Pressable 36×36] [centered: "Step N of 5" caption + h3 title] [empty 36×36 spacer to balance]`. **NO Close X button.**
- **Progress row (431–456):** 5 segments at 4pt height, 6pt gap. Complete: `accent.warm` full opacity. Current: `accent.warm` 0.6 opacity. Upcoming: `rgba(255,255,255,0.08)`. **Anonymous progress (no step names) — diverges from event Stepper which shows pill chips with step names.**
- **Body (459–495):** Inline switch over `step === N` rendering 5 step components. No eyebrow, no step title in body (it's only in the header). No subtitle.
- **Footer (498–516):** Single full-width `Button` — "Continue" (steps 1–4) or "Publish trip" (step 5) or "Try publish again" on error. NO Back button in footer (Back is in header).
- **handleBack (365–372):**
  - **Step 1:** calls `onExit()` (the route maps to `router.back()`).
  - **Steps 2–5:** decrement step.
  - **No discard confirmation dialog at all.** No dirty-state check.
- **handlePublish (375–402):** Direct mutation call; on error sets `publishError` and Step 5 renders banner. NO `ConfirmDialog`, NO `PublishErrorsSheet`.
- **Autosave:** Per-step transition (`autosaveCurrentStep` line 332). No periodic timer like event's 700ms debounced autosave.
- **Keyboard handling:** `KeyboardAvoidingView behavior="padding"` wrapping the whole tree. No dock-hide pattern.

---

## 6. Findings — classified

### 🔴 R-1 — ROOT CAUSE: Trip wizard has NO close affordance

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/components/trip/TripCreatorWizard.tsx:412–429` |
| **Exact code** | Header has only `[chevL back Pressable]` + `[headerCenter step counter + title]` + `[backBtn spacer]`. The third 36×36 View at line 428 is an empty spacer to balance the layout — NOT a button. |
| **What it does** | Operator on any step of the trip wizard (create or edit) has no way to dismiss the wizard except walking back step-by-step. Even on Step 1 the Back chevron calls `onExit()` (which the route maps to `router.back()`) but there's no visual cue that the back chevron IS the close affordance. |
| **What it should do** | Per operator decision 2026-05-18 (AskUserQuestion answer in this ORCH's INTAKE), **both create and edit trip wizards must be closable**, mirroring how `EventCreatorWizard` always renders an `IconChrome icon="close" size=36` in the chrome row (lines 654–659) with semantic-correct handler: create mode + pristine → discard immediately; create mode + dirty → ConfirmDialog; edit mode → silent exit (auto-save semantics). |
| **Causal chain** | TripCreatorWizard.tsx:412–429 lacks Close X → operator on Step 3 has no quick-exit affordance → must tap Back × 2 → friction → mismatch with event wizard which has X always visible → product feels inconsistent. |
| **Verification** | Compare TripCreatorWizard.tsx:412–429 against EventCreatorWizard.tsx:653–670 side by side; the event row has `IconChrome icon="close"` as the first element, trip row has `Pressable chevL` only. |

### 🔴 R-2 — ROOT CAUSE: Trip detail header missing "View public page" affordance (ORCH-0867)

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/trip/[id]/index.tsx:445–452` |
| **Exact code** | Header is `[36×36 back] [centered title] [right "Edit" Pressable]`. No share button. No View-public-page button. No moreH menu. |
| **What it does** | Trip planner sees no in-product way to open the buyer-facing public trip page (`/t/{brandSlug}/{tripSlug}`) from the operator dashboard. Planner must construct the URL manually or share-via-iOS-from-a-different-screen. |
| **What it should do** | Mirror event detail header (`event/[id]/index.tsx:599–614`) which renders two `IconChrome` buttons — `share` (36pt, opens ShareModal) + `moreH` (36pt, opens EventManageMenu). The "View public page" action is then a tile in the action grid (per §4.2 grid item) AND an option in the Manage menu. |
| **Causal chain** | Trip planner can't preview own work in-product → must guess URL → friction → already flagged as ORCH-0867 [Trip dashboard "View public page" button] but never specced because ORCH-0874 supersedes the slot definition. |
| **Verification** | Diff trip/[id]/index.tsx:445–452 vs event/[id]/index.tsx:599–614. Confirmed: trip has 1 right-side affordance ("Edit"), event has 2 (`share` + `moreH`). |

### 🟠 C-1 — CONTRIBUTING: Trip list has no card primitive

`hub/trips.tsx:116–162` uses raw `Pressable` with inline `styles.tripCard` (no hero image, no progress bar, no revenue strip, no status Pill primitive). Event list (`EventListCard.tsx`) is a 425-line dedicated card primitive with cover + status pill + progress/sold/revenue. Trip list visually reads as a "settings menu item" rather than a "content card". Mirror: extract a `TripListCard.tsx` component matching `EventListCard.tsx` shape, with trip-specific data (no live/past lifecycle, simpler status: Draft / Published; capacity → sold ratio if any travelers booked; trip dates instead of event date).

### 🟠 C-2 — CONTRIBUTING: Trip list has no filter row

`hub/trips.tsx` has no filter pills at all. Event list has 5 pills (All / Live / Upcoming / Drafts / Past) at `events.tsx:265–278`. For trips, the right set is operator decision (open question Q1 in SPEC) — at minimum All / Upcoming / Past / Drafts.

### 🟠 C-3 — CONTRIBUTING: Trip detail lacks hero treatment

`trip/[id]/index.tsx:255–268` shows only a status pill below the header. Event detail (`event/[id]/index.tsx:627–652`) has full hero — `EventCoverMedia` height=200, gradient overlay, status pill, 24pt title with text-shadow, date+venue subline. Trip detail needs equivalent: cover image (from trip cover if set), gradient overlay, status pill, title (trip name), date range + destination subline.

### 🟠 C-4 — CONTRIBUTING: Trip detail has no action grid

`trip/[id]/index.tsx` jumps from status pill row directly to tabs. Event detail has an `ActionTile` grid (`event/[id]/index.tsx:655–714`) with 7–9 tiles (Scan, Scanners, Orders, Guests, Blasts, Public page, Brand page, conditional Door Sales + Reconciliation). Trip detail needs a parallel grid with trip-applicable actions: View public page (ORCH-0867 fold), Brand page, Marketing blasts (if applicable to trips), Edit trip (replaces inline header Edit pill), Money (links to Money tab — open question Q2 on whether to keep tabs).

### 🟠 C-5 — CONTRIBUTING: Trip wizard progress is anonymous (no step names)

`TripCreatorWizard.tsx:431–456` renders 5 unlabeled 4pt segments. Event wizard (`EventCreatorWizard.tsx:660–666`) uses the `Stepper` primitive with named pill chips (Basics / When / Where / Cover / Tickets / Settings / Preview). Operator on trip wizard cannot see at-a-glance which step they're heading to. Mirror: replace progress segments with `Stepper` primitive using `STEP_TITLES` map (already defined at TripCreatorWizard.tsx:81–87).

### 🟠 C-6 — CONTRIBUTING: Trip wizard step title hierarchy weaker than event

Event wizard renders step title hierarchy INSIDE the body — eyebrow (11pt accent.warm uppercase "Step N of 7") + 26pt step title + 14pt subtitle — at lines 725–729 of EventCreatorWizard.tsx. Trip wizard renders step counter + h3 title in the HEADER only (lines 424–427), no subtitle anywhere. Mirror: move step title rendering into the body, add subtitle copy to `STEP_TITLES` map.

### 🟠 C-7 — CONTRIBUTING: Trip wizard has no Publish confirmation dialog

`TripCreatorWizard.tsx:375–402` calls `publishMutation.mutateAsync` directly on Publish tap. Event wizard (`EventCreatorWizard.tsx:528–566`) gates publish behind a `ConfirmDialog` with whenMode-specific copy ("Publish event?" / "Publish recurring event? N occurrences..." / "Publish event with N dates?") plus 1.2s artificial submit delay per spec. For trips: single confirm dialog ("Publish trip?" with destination + dates subline) — no recurrence variants needed.

### 🟠 C-8 — CONTRIBUTING: Trip wizard has no PublishErrorsSheet

Event wizard uses `PublishErrorsSheet` (J-E12 flow at EventCreatorWizard.tsx:502–526) with Fix-jump-to-step buttons. Trip wizard sets `publishError` and shows banner in Step 5 (TripCreatorWizard.tsx:399–401). For trips: smaller validation surface so a banner may be sufficient — but a sheet with Fix-jump improves consistency. Decision left to SPEC.

### 🟡 H-1 — HIDDEN FLAW: Trip wizard dock pattern divergence

Event wizard uses a floating glass dock (`EventCreatorWizard.tsx:739–808` with `GlassCard variant="elevated" radius="xxl"` + Back/Continue/Publish layout). Trip wizard uses a flat single-button footer (TripCreatorWizard.tsx:498–516). When trips eventually need a Back button alongside Continue (e.g., to allow Back on Steps 2–4 from the footer instead of forcing operator up to the header), the divergent dock pattern will be expensive to retrofit. Mirror NOW to avoid the retrofit cost later.

### 🟡 H-2 — HIDDEN FLAW: Public trip page hero missing X-close + share overlays

`app/t/[brandSlug]/[tripSlug].tsx` delegates to `TripPreview` which renders cover but NO X-close or share button overlays. Public event page (`app/e/[brandSlug]/[eventSlug].tsx` → `PublicEventPage`) has these overlays per the route file's comment. Buyer-anon on the trip public page has no quick-exit affordance and no native share button — inconsistent with the event public page UX.

### 🟡 H-3 — HIDDEN FLAW: Trip wizard has no autosave-state UI

Event wizard surfaces autosave state in the subtitle row (EventCreatorWizard.tsx:677–692: "Saving..." / "Saved" / "Unsaved changes - retrying"). Trip wizard runs autosave per step transition but never shows status. If a trip autosave silently fails, the operator only learns when they hit Publish and validation fails. Mirror autosave-state UI for parity + reliability.

### 🟡 H-4 — HIDDEN FLAW: Trip detail uses tabs vs event detail's single-scroll

Trip detail (`trip/[id]/index.tsx:502–508`) has tabs (Overview / Travelers / Money). Event detail has NO tabs — single scroll. Operator mental model differs between trip and event ops. Decision: SHOULD trip flatten to single scroll like events, OR keep tabs? Significant UX consequence; surface as open question Q2 in SPEC.

### 🔵 O-1 — OBSERVATION: ORCH-0873 Money tab implementation is solid

`MoneyTabBody` subcomponent (lines 758–1063 of trip/[id]/index.tsx) handles filter chips + per-booking expand/collapse + status pills + Retry button + Refund stub correctly. Inline-styled (not GlassCard), but functionally complete. For ORCH-0874: restyle the booking rows to use `GlassCard variant="base"` and the filter chips to match the event filter-pill primitive (events.tsx:502–541) — preserve all data wiring and interaction.

### 🔵 O-2 — OBSERVATION: Trip wizard already has the unified-route pattern

Both `/trip/create` → `/trip/[id]/edit` (create) and `/trip/[id]/edit` (resume) mount the same wizard component. Same pattern events uses. **No route refactor needed** for the wizard chrome work — only the wizard internals + a new `isCreateMode` prop computed by the edit route.

### 🔵 O-3 — OBSERVATION: Trip wizard already lives in REWORK 5b SafeArea-allowlist scope

`app/trip/[id]/edit.tsx:12` carries the `orch-strict-grep-allow safearea-on-fullscreen-routes` comment because `TripCreatorWizard` applies `paddingTop: insets.top` internally (TripCreatorWizard.tsx:410). This means the wizard already has the right SafeArea posture — don't break it when adding close X.

### 🔵 O-4 — OBSERVATION: Two pre-existing wizard helpers not used

Trip step file scan (Explore agent #2) confirms `TripCreatorWizard` defines `STEP_TITLES` constant (lines 81–87) but doesn't use it in the body (only header). Stepper primitive exists in event wizard via `Stepper` import (EventCreatorWizard.tsx:70–71). Both helpers are ready to be mirrored.

---

## 7. Five-layer cross-check

| Layer | Question | Result |
|---|---|---|
| **Docs** | Does PRODUCT_DOCUMENT.md or any spec require trips to mirror events visually? | No formal doc — but Mingla positioning memory (`feedback_mingla_positioning.md`) frames trips and events as siblings inside the experience-app product. Operator dispatch is the binding directive. |
| **Schema** | Any DB-level distinction trips vs events that would force divergent UI? | None for visual surfaces. Trips are `events.event_type='trip'` with `business_trip` row attached and `trip_pricing_tiers` with `tier_metadata.installments` JSONB. Schema doesn't dictate UI. |
| **Code** | Do the trip surfaces actually diverge from events as described? | Confirmed — see findings R-1 through H-4 with file:line evidence. |
| **Runtime** | N/A — this is a code audit, not a runtime bug. | Skipped per Prime Directive §7 exemption (pure code audit / design exploration). |
| **Data** | Any data shape forcing UI divergence? | No. ORCH-0873 added `tier_metadata.installments` JSONB which extends data; it does not force the divergent tile/header chrome treatment. |

**No layer contradicts another.** The divergence is purely UI/UX choice during prior trip development, not driven by schema or data constraints. Therefore the mirror is straightforward — no schema unblocks needed.

---

## 8. Blast radius map

For each root cause + contributing finding, downstream surfaces affected:

- **R-1 (trip wizard close)** affects: `app/trip/create.tsx` (create entry — already routes through edit), `app/trip/[id]/edit.tsx` (mounts wizard — needs to pass `isCreateMode`), `TripCreatorWizard.tsx` (add chrome row + ConfirmDialog + handleClose). NO downstream consumers (the wizard is not embedded anywhere else).
- **R-2 (View public page button)** affects only `app/trip/[id]/index.tsx`. Fold ORCH-0867 in (recommendation §10 below).
- **C-1 (trip list card)** affects: new `src/components/trip/TripListCard.tsx`, `hub/trips.tsx`. NO downstream consumers.
- **C-2 (trip list filters)** affects only `hub/trips.tsx` + the `useTrips`-derived data (filter logic, not the hook itself — local filter applied to list).
- **C-3 (hero), C-4 (action grid), H-4 (tabs decision)** all affect only `app/trip/[id]/index.tsx`.
- **C-5, C-6, C-7, C-8, H-1, H-3 (wizard internals)** all affect only `TripCreatorWizard.tsx` + possibly a small new `TripPublishErrorsSheet.tsx`.
- **H-2 (public page overlays)** affects `TripPreview.tsx` + `app/t/[brandSlug]/[tripSlug].tsx`.

**Invariants potentially impacted (per dispatch §6):**
- `I-PROPOSED-TR1-PERSONA-INTERFACE` (locked 3-id union) — NOT TOUCHED by ORCH-0874.
- `I-PROPOSED-TR1-KIND-IMMUTABLE` (`brands.kind` post-create immutability) — NOT TOUCHED.
- `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` (routeForEventRow helper) — RELEVANT: trip list card press currently bypasses this helper (uses direct router.push); the new `TripListCard` should consume `routeForEventRow` for consistency.
- `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` — RELEVANT: must preserve the existing allowlist comments at `app/trip/[id]/edit.tsx:12` and not introduce new SafeArea-wrapping that conflicts with operator's full-bleed decision.
- `I-38` (44pt touch targets on IconChrome) — RELEVANT: new close X on trip wizard must respect 44pt min via hitSlop or 36pt button + 8pt hitSlop pattern.
- `I-39` (accessibilityLabel on interactive Pressables) — RELEVANT: every new tile + button must have explicit `accessibilityLabel`.

**Recurring patterns to avoid:**
- `feedback_rn_sub_sheet_must_render_inside_parent.md` — if `TripPublishErrorsSheet` is added, it MUST render inside parent JSX, not as a Fragment sibling.
- `feedback_toast_needs_absolute_wrap.md` — any new Toast emission needs the absolute wrap pattern.
- `feedback_keyboard_never_blocks_input.md` — wizard chrome change must NOT regress keyboard-handling behavior (trip wizard currently uses `KeyboardAvoidingView`; event wizard uses explicit listener + dynamic padding. Mirror to event pattern would replace — verify no regression).
- `feedback_rn_color_formats.md` — any new color tokens must use hex/rgb/hsl/hwb (no oklch/lab).

---

## 9. Invariant violations

**None established by current state.** All findings are design-debt / missing-feature, not invariant violations. The fix will ESTABLISH new visual-parity invariants but is not breaking existing ones.

---

## 10. ORCH-0867 fold recommendation

**FOLD ORCH-0867 INTO ORCH-0874.** Reasons:

1. **Same file, same diff.** ORCH-0867's slot is in `app/trip/[id]/index.tsx:445–452`. ORCH-0874 is rewriting that exact header chrome to mirror event detail (which has the View-public-page button as an `ActionTile` in the grid AND a `share` icon in the right slot AND a manage menu option). Two ORCHs touching the same 20 lines = inevitable merge conflict + duplicate regression tests.
2. **Implementor + tester economy.** One implementor pass covers both. One tester pass verifies both. One PR. Cleaner CLOSE artifact-sync.
3. **No standalone value.** ORCH-0867's button only makes sense after the action grid + share-icon pattern lands. Shipping ORCH-0867 first means awkward solo button placement; shipping after ORCH-0874 means re-doing the slot work.
4. **No scope inflation.** ORCH-0874 already touches this file for hero + action grid + tabs decision. Adding the public-page button is 5 lines of additional implementation.

ORCH-0867 row in WORLD_MAP gets closed with note "Folded into ORCH-0874 close 2026-MM-DD".

---

## 11. Fix strategy (direction only — spec gives the details)

The spec at `specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` will prescribe:

1. **Trip list:** Extract `TripListCard.tsx` mirroring `EventListCard.tsx` shape. Add filter row mirroring `events.tsx:502–541` with trip-appropriate filters (operator decides exact set). Card press uses `routeForEventRow`.
2. **Trip detail:** Add hero (mirror `event/[id]/index.tsx:627–652`). Add action grid using `ActionTile` (View public page, Brand page, Marketing blasts if applicable, Edit trip, plus the existing tab-targets if collapsing — see Q2). Header right slot mirrors event detail (`share` IconChrome + `moreH` IconChrome → ShareModal + TripManageMenu). Tabs decision blocked on Q2; Money tab restyle to use GlassCard variant="base" booking rows.
3. **Trip wizard chrome:** Replace anonymous progress segments with `Stepper` (named pill chips). Add `IconChrome icon="close"` to chrome row (always rendered). Add `handleClose` with create-vs-edit semantic branch (mirrors event wizard 434–460). Add discard `ConfirmDialog` for create-mode-dirty path. Add publish `ConfirmDialog`. Optionally add publish errors sheet. Move step title into body with eyebrow + 26pt title + 14pt subtitle. Add autosave-state UI in subtitle row.
4. **Public trip page:** Add X-close + share button overlays on the hero per public event page pattern. Cover hero stays full-bleed (preserve SafeArea allowlist).
5. **ORCH-0867 fold:** View-public-page button lands as an `ActionTile` in the trip detail action grid (item #1 in that grid).

---

## 12. Regression prevention

The spec must include:

- **Implementor happy-path test** (in same PR as fix): pin the wizard chrome shape — assert `IconChrome icon="close"` is present in TripCreatorWizard.tsx; assert `ConfirmDialog` for discard is mounted at root; assert `STEP_TITLES` map is consumed in the body (not just header).
- **Tester adversarial test** (different angle): simulate dirty-state on create-mode wizard, confirm Close-X tap opens dialog (not silent discard); on edit-mode wizard, confirm Close-X tap exits silently with no dialog (per event wizard semantics); assert no regression in `routeForEventRow` consumption from new TripListCard.
- **No new CI strict-grep gates** from this ORCH (per dispatch §7.4). If a structural invariant emerges from review, register as a separate follow-up ORCH.

---

## 13. Discoveries for orchestrator

1. **TripCreatorWizard `STEP_TITLES` constant (lines 81–87) is declared but only used in the header `headerCenter`** (line 426). Mirror to events would also use it for the body title. Surface in spec § "Wizard step title hierarchy".
2. **Trip detail Edit pill is inline-styled** (lines 238–252) — when the new action grid lands, this header Edit pill likely becomes redundant (Edit moves to grid tile). Decision required in spec.
3. **`useCurrentBrandRecovery` hook used in `app/event/create.tsx`** (line 48) is not used in `app/trip/create.tsx`. Likely an intentional skip (trip-planner brand recovery has different semantics) but worth flagging.
4. **`MoneyTabBody` (ORCH-0873) is defined as an internal subcomponent** of `trip/[id]/index.tsx` (lines 758–1063). If the ORCH-0874 tabs decision is to flatten, MoneyTabBody needs to either become a top-level component file or move to a sub-route — that's a small extra scope. Confirm in spec.
5. **53 TS-debt errors flagged in ORCH-0873 close** (PaymentPlanEditor + MoneyTabBody style arrays) are NOT in this ORCH's scope but the implementor should NOT make them worse by adding more arrays of conditional styles. Spec must call this out as a hard guard.
6. **Trip wizard uses `KeyboardAvoidingView`** (line 408) while event wizard uses explicit listener + dynamic padding + dock-hide pattern. Mirror would replace — could regress keyboard behavior on Step 1's text input. Spec must require post-implementation verification on iOS sim that Step 1's title input remains usable with keyboard up.

---

## 14. Confidence level

**H (High).** Confidence is bound to:
- 22 files read in full or via Explore agent with explicit file:line citations
- Prior artifact ingest complete (ORCH-0855 / 0859 / 0869 / 0873 + relevant memories)
- Phase 0 mandatory ingest performed
- No layer contradictions in the five-layer cross-check
- Operator-flagged surface (wizard chrome closability) has direct file:line evidence on both sides
- Live-fire sim NOT required per dispatch §7.6 (code-audit dispatch)

**Confidence cap:** This investigation does not run the actual mobile binary. If the spec implementation reveals an iOS-specific quirk (e.g., dock-hide pattern interacts with iOS 17 keyboard differently than expected), that's a downstream finding the tester will catch via live-fire sim per the tester's Phase 0.A live-fire gate.

---

## Layman summary

Trip surfaces in `mingla-business` look hand-rolled; event surfaces look polished. The biggest single gap is that **the trip wizard has no close button** — operators can only walk back step-by-step. The trip detail page is missing the cover hero and action-tile grid that make event detail feel dense and capable. The trip list uses a flat tap-row instead of a content card. The public trip page lacks the X-close + share overlays the public event page has.

Good news: none of this is forced by schema or data — it's all UI choice from prior trip development. Mirroring is straightforward.

This investigation identifies **2 root causes, 8 contributing factors, 4 hidden flaws, 4 observations** with file:line evidence on every claim. The spec at `Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` (written next in same session) prescribes exact mirror actions for all 4 surfaces, with ORCH-0867 [Trip dashboard "View public page" button] recommended for fold-in.

Three operator decisions needed in spec phase: (1) which filter pills on the trip list, (2) keep trip tabs or flatten to single scroll like events, (3) whether trip wizard gets a PublishErrorsSheet or just an inline banner. Each is called out as an open question.
