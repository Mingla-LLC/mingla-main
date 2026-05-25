# PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase:** 2 of 4 — USER JOURNEY DESIGN
**Designer skill invoked:** `ui-ux-pro-max` (operator-redirected from default `mingla-designer`)
**Author:** Claude (UI/UX Pro Max design intelligence layered with Mingla forensics judgment)
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Inputs:** [OPEN_QUESTIONS](../reports/INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md) (canonical Q1–Q11 answered state), [USER_JOURNEY_GAPS](../reports/INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md), [GAP_AUDIT](../reports/INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md), [DATA_MODEL_AUDIT](../reports/INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md), [SUPPLEMENTAL](../reports/SUPPLEMENTAL_META-ORCH-0972_AUDIT_REVIEW_FIXES.md), [CODEX_RE_REVIEW](../reports/CODEX_RE_REVIEW_META-ORCH-0972_AUDIT.md).

---

## Comms-ledger acks (entry hygiene)

Read on entry: COMMS-0001 (N/A), COMMS-0002 (factored — Phase 4 backend allowlist note carried forward), COMMS-0003 (N/A — no external APIs touched in Phase 2), COMMS-0004 (N/A), COMMS-0005 (N/A — ORCH-0964 is parallel; this design does not touch theme tokens or font customization). No new cross-ORCH discovery this turn.

---

## Design grounding

### Mingla's existing design language (preserved, not redesigned)

Per operator memory + prior ORCH design specs in `Mingla_Artifacts/design/`:

- **Visual style:** Glassmorphism + claymorphism. Backgrounds use translucent glass overlays; cards use `GlassCard` primitive with `radius.lg` corners + subtle shadow. Active states get accent-tinted glass.
- **Platform:** iOS-first, Android parity. React Native + Expo. Custom navigation (NOT React Navigation — `feedback_orchestrator_*` memory).
- **Typography:** Inter (variable weights 300–600), system-style. `text.primary` for body, `text.tertiary` for placeholders, `text.secondary` for muted.
- **Iconography:** Lucide via `Icon` component (`<Icon name="..." />`). Never emojis. 24×24 viewBox. Touch-target ≥ 44pt (I-38 from WCAG kit).
- **Motion:** 150–250ms for micro-interactions per `duration-timing`; spring physics for sheet entries via Mingla's `TopSheet` primitive; `prefers-reduced-motion` respected via `accessibilityReduceMotion`.
- **Haptics:** `Haptics.impactAsync(Light)` on tap, `Medium` on confirm, `Notification(Success)` on publish.
- **Colors:** Hue-driven (HSL only — per memory `feedback_rn_color_formats.md`). Brand accent uses `cover_hue` from brand row; system accent uses `accent.primary`.
- **Spacing:** `spacing.xs/sm/md/lg/xl/xxl` (4/8/12/16/24/32). Margin/padding via tokens, never raw numbers.
- **Sheets:** `TopSheet` extended to `UniversalCreatorSheet` per DEC-152 with `heightMode="compact"`.
- **Glass color rule:** light mode uses `bg-white/80+`, never `bg-white/10`; borders use `border-gray-200` not `border-white/10` (ui-ux-pro-max cross-cutting rule for glass-card readability).

### Cross-cutting rules enforced (from ui-ux-pro-max search)

- **Touch target ≥ 44×44pt** on every interactive element (Mingla I-38 + ui-ux-pro-max `touch-target-size`).
- **Motion 150–300ms** for state transitions (ui-ux-pro-max `duration-timing`).
- **Color contrast ≥ 4.5:1** for body text on both glass and solid backgrounds (ui-ux-pro-max `color-contrast`).
- **`prefers-reduced-motion`** respected for tab transitions and sheet animations.
- **No emojis as icons** — every chooser button uses Lucide icons (`calendar` for Event, `map-pin` for Trip, `sparkles` for Experience).
- **Cursor pointer on web** via `accessibilityRole="button"` (RN-web maps this to `cursor: pointer`).
- **Disable button during async** (`loading-buttons`) — every CTA that triggers a network call shows the existing `<Button loading>` state.
- **Reserve space for async content** (`content-jumping`) — tab visibility query uses suspense-style placeholder to avoid flash-of-wrong-tabs (Design Area 4 below).

---

## DESIGN AREA 1 — Unified brand-creation flow

### Decision (locks Q5 + Q6 + Q11)

Single linear flow replaces today's BrandSwitcherSheet persona-fork + TripBrandWizard + popup-create paths. No persona question. No kind capture. Lands user on Home with the 3-button chooser (Design Area 2).

### Flow

```
[Empty Home / Brand Switcher Sheet]
        │
        ▼
   "Create brand" CTA tap
        │
        ▼
┌─────────────────────────────┐
│  STEP 1 — Identity          │
│  - Name (required, 1–60ch)  │
│  - Bio (optional, 0–200ch)  │
│  - Continue ▶               │
└─────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  STEP 2 — Where (optional)          │
│  - Address (text, optional)         │
│    sub: "We'll use this to default  │
│    your experience venues. You can  │
│    add this later from Brand Edit." │
│  - Skip / Continue ▶                │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  STEP 3 — Cover (optional)          │
│  - <BrandCoverPickerSheet>          │
│    (existing primitive, unchanged)  │
│  - Skip / Done                      │
└─────────────────────────────────────┘
        │
        ▼
   createBrand({ name, bio, address?, coverHue, coverMediaUrl? })
   setCurrentBrand(brand)
   setDefaultBrand(brand) (fire-and-forget)
        │
        ▼
┌─────────────────────────────────────┐
│  STEP 4 — Welcome (Home empty)      │
│  [Identity card]                    │
│  "What do you want to make first?"  │
│  ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ Event  │ │  Trip  │ │  Exp.  │  │
│  └────────┘ └────────┘ └────────┘  │
└─────────────────────────────────────┘
```

**Stripe routing is deferred.** Per Q1, free offerings need no Stripe. Connect-Stripe upsell now lives in `homeNextAction` rung 1 (Design Area 3), fires only when the brand drafts a paid offering. Brand creation does NOT route to `/brand/{id}/payments` automatically — this is a deliberate change from today's TripBrandWizard behavior.

### Edge cases

- **Step 1 validation:** `name` required, 1–60 chars, slug auto-generated from name; on slug collision append `-2` etc. Existing `SlugCollisionError` path preserved.
- **Step 2 skip:** address null persisted; rung 4 of homeNextAction NEVER fires (removed entirely); experience creation re-asks per Q6.
- **Step 3 skip:** brand gets `coverHue: 25` (existing default) + null `coverMediaUrl`. Public page falls back to hash-hue gradient (`hashHueFromString(brand.id)`).
- **Network failure on createBrand:** existing `<Button loading>` state shown during mutation; on error, toast `"Couldn't create brand. Tap to retry."` with cached form state preserved.
- **Cold-start back-button:** at any step, pressing back returns to prior step OR closes the sheet (Step 1 back = close sheet; saves nothing). Standard `TopSheet` close behavior.

### Copy strings (full set)

| Element | Copy |
|---|---|
| Sheet title | "Create brand" |
| Step 1 name label | "Brand name" |
| Step 1 name placeholder | "e.g. Wandering Soul Retreats" |
| Step 1 bio label | "Short bio (optional)" |
| Step 1 bio placeholder | "Tell people what you're about — 200 characters." |
| Step 1 CTA | "Continue" |
| Step 2 title | "Add an address?" |
| Step 2 subtitle | "We'll use this to pre-fill venues for any experiences you publish. You can add this later." |
| Step 2 placeholder | "e.g. 12 Soho Square, London" |
| Step 2 skip | "Skip for now" |
| Step 2 CTA | "Continue" |
| Step 3 title | "Add a cover (optional)" |
| Step 3 skip | "Skip" |
| Step 3 CTA | "Done" |
| Step 4 headline | "What do you want to make first?" |
| Step 4 subhead | "Mix and match anytime." |
| Step 4 Event button | "Event" — icon `calendar` — subhead "One night, one place." |
| Step 4 Trip button | "Trip" — icon `map-pin` — subhead "Multi-day getaway." |
| Step 4 Experience button | "Experience" — icon `sparkles` — subhead "Recurring or evergreen." |

### Cross-surface parity

| Surface | Status | Notes |
|---|---|---|
| business-iOS | YES | Primary surface; ships in `BrandSwitcherSheet` rewrite + new `BrandCreationFlow` component |
| business-Android | YES | Shared RN code; verify haptic + back-button parity (Android hardware back) |
| business-web-preview | YES | Web back-button via `popstate` (per `feedback_back_listener_disarm_pattern.md`) |

### Files affected (per Phase 1 audit Dimension 1)

- DELETE: `PersonaPickerCards.tsx`, `PersonaForkSheet.tsx`, `TripBrandWizard.tsx`, all 4 personaFork test files, `TripBrandWizard.test.ts`, `brandsService.tripPlannerKind.test.ts`
- REPURPOSE: `BrandSwitcherSheet.tsx` (rewrite as single-flow shell; lines 163, 248–276, 361–413, 376 changes per audit); `brandsService.ts:93-128`; `brandMapping.ts:47-48/91-92/240-243/311/395`; `brandPatch.ts:38-40` (DELETE the 3-line kind dirty-patch block per supplemental gap G2).
- NEW: `BrandCreationFlow.tsx` (consolidated 4-step flow shell)

---

## DESIGN AREA 2 — Home empty-state 3-button chooser

### Decision (locks Q11)

Chooser pattern is connective tissue (per User Journey Theme A). Used in 3 surfaces with identical visual treatment: home empty state, hub "Get started" placeholder tab (Design Area 4), end of brand creation Step 4. Same component reused everywhere.

### Component spec — `<OfferingChooser>`

```
┌────────────────────────────────────────┐
│  What do you want to make first?       │  ← headline.lg, text.primary
│  Mix and match anytime.                │  ← text.tertiary
│                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ [cal]    │ │ [map]    │ │ [sparkle]││  ← Icon 28pt centered top
│  │ Event    │ │  Trip    │ │ Experience││  ← text.primary, 16pt, semibold
│  │ One      │ │ Multi-   │ │ Recurring││  ← text.tertiary, 13pt, regular
│  │ night... │ │ day...   │ │ or...    ││
│  └──────────┘ └──────────┘ └──────────┘│
└────────────────────────────────────────┘
```

- Three equal-weight `GlassCard` buttons in a row (3-up on iPhone landscape + tablet + web; stacked vertically on iPhone portrait if width < 380pt to preserve 44pt+ touch targets).
- Card height: `spacing.xxl × 4` = 128pt. Card padding: `spacing.md`. Card gap: `spacing.sm`.
- Icon at top center (Lucide, 28pt, `accent.primary`); title below (16pt semibold); subtitle (13pt regular, `text.tertiary`).
- On tap: haptic `impactAsync(Light)` + route to `/event/create` / `/trip/create` / `/experience/create` respectively.
- Active state: subtle accent-tinted glass overlay (no scale transform — avoids layout shift per ui-ux-pro-max `hover-vs-tap`).
- Disabled state: opacity 0.5 + no haptic + no route. Never disabled in the new model (universal authoring) — included for future contingencies only.
- `accessibilityRole="button"` + `accessibilityLabel="Create event / Plan trip / Design experience"` per WCAG kit I-39.

### Visual hierarchy

All three equal weight. No "recommended" badge, no "popular" tag. Operator intent: every brand can do any offering type; the chooser should not bias.

### Where it appears

| Surface | Trigger | Headline variant |
|---|---|---|
| Brand creation Step 4 | After brand row inserted | "What do you want to make first?" |
| Home empty state (rung 2) | `homeNextAction` rung 2 evaluation | "What do you want to make first?" |
| Hub "Get started" tab (Q2) | All 3 buckets empty | "Get started — pick what to create" |

Same component, different headline prop.

---

## DESIGN AREA 3 — `homeNextAction` rung redesign

### Decision (locks Q1)

Rung 1 demoted from blocker to opportunistic upsell. Rung 2 becomes the 3-button chooser. Rung 4 deleted entirely.

### New rung decision tree

```
1. brand has drafted any offering with max(tier.price) > 0
       AND brand.stripeStatus !== 'active'
   → RUNG 1 (Stripe upsell)
        CTA: "Connect Stripe to enable paid tickets"
        Body: "You have a paid offering drafted. Connect Stripe to publish it."
        Route: /brand/{id}/payments

2. counts.total === 0
   → RUNG 2 (Chooser)
        Render: <OfferingChooser />
        (no text-only CTA; the chooser IS the CTA)

3. counts.live === 0 && counts.draft > 0
   → RUNG 3 (Finish draft) — UNCHANGED
        CTA: "Open draft"
        Body: "You have a draft waiting. Finish it and publish to start selling."
        Route: routeForEventRowDefensive(mostRecentDraft)

4. (DELETED — was: physical-no-address nudge)

5. Healthy state → null (no rung rendered; Live KPI hero owns the screen)
```

### Free vs paid rule contract (Q1 detail)

- "Paid offering" = any offering (event, trip, or experience) where at least one ticket tier has `price_cents > 0`.
- RSVP-with-deposit counts as paid (deposit > 0).
- Free trip with optional paid add-ons counts as paid.
- The check fires on the brand's CURRENT draft + live offerings; if user drafts paid → deletes paid → rung 1 stops firing.

### Copy strings

| Rung | Title | Body | CTA |
|---|---|---|---|
| 1 | "Connect Stripe to take payments" | "You have a paid offering ready to publish. Connect Stripe to start selling." | "Connect Stripe" |
| 2 | (uses OfferingChooser; no separate title) | (uses OfferingChooser subhead) | (uses OfferingChooser buttons) |
| 3 | "Finish your draft" | "You have a draft waiting. Finish it and publish to start selling." | "Open draft" |

### Files affected

REPURPOSE: `homeNextAction.ts:33-130` (full rewrite); `homeNextAction.test.ts` (rewrite fixtures). REGATE: `(tabs)/home.tsx` empty-state block.

---

## DESIGN AREA 4 — Hub data-driven tab visibility

### Decision (locks Q2 + Q3)

Tab BAR renders only tabs whose bucket has ≥1 row (draft or live). When all 3 buckets empty, single "Get started" tab renders with `<OfferingChooser>`. Default tab = sticky last-visited, Events on first ever visit.

### Visibility rule

```
useHubVisibleTabs(brandId):
  counts = useBrandOfferingCounts(brandId)
    returns { events: number, trips: number, experiences: number }

  if (events + trips + experiences === 0)
    → [{ key: "get-started", label: "Get started" }]
  else
    visible = []
    if (events > 0) visible.push({ key: "events", label: "Events", count: events })
    if (trips > 0) visible.push({ key: "trips", label: "Trips", count: trips })
    if (experiences > 0) visible.push({ key: "experiences", label: "Experiences", count: experiences })
    return visible
```

### Default tab selection

```
useHubInitialTab(visibleTabs):
  lastVisited = AsyncStorage.getItem(`hub:lastTab:${brandId}`)
  if (lastVisited && visibleTabs.some(t => t.key === lastVisited))
    → lastVisited
  if (visibleTabs.some(t => t.key === "events"))
    → "events"
  → visibleTabs[0].key (fallback to first visible)
```

On tab change, persist `lastVisited` to AsyncStorage scoped by brandId.

### Tab badge counts

Each tab shows a count badge (small `text.tertiary` pill, e.g., `Events · 3`). Count = total offerings in bucket including drafts + live (not filtered to upcoming).

### Loading state (avoid flash-of-wrong-tabs)

Per ui-ux-pro-max `content-jumping` rule, the tab bar reserves space during the counts query. While loading:

```
┌────────────────────────────────────┐
│  [shimmer pill] [shimmer pill]     │  ← 2 placeholder pills, same height as real tabs
└────────────────────────────────────┘
```

Once counts resolve, tabs animate in (fade 200ms, no scale).

### Tab transition motion

When user creates the first offering of a new type (e.g., brand has events + creates first trip), the Trips tab fades in over 200ms on next mount. No reorder animation (avoid layout thrash).

### Empty state per tab body

If a tab is visible (count > 0) but the current filter yields zero items (e.g., Events tab with only past events, filter set to "Upcoming"), the tab BODY shows an empty state with a "Create event" CTA. The TAB stays visible (count > 0). This is different from the "all buckets empty" case.

### Get Started tab body

When zero offerings exist:

```
┌────────────────────────────────────┐
│  [Get started]                     │  ← Only tab
├────────────────────────────────────┤
│                                    │
│     Get started — pick what        │
│       to create                    │
│                                    │
│  ┌──────┐ ┌──────┐ ┌──────┐       │
│  │Event │ │ Trip │ │ Exp. │       │
│  └──────┘ └──────┘ └──────┘       │
│                                    │
└────────────────────────────────────┘
```

### Copy strings

| Element | Copy |
|---|---|
| Events tab label | "Events" |
| Trips tab label | "Trips" |
| Experiences tab label | "Experiences" |
| Get-started tab label | "Get started" |
| Get-started body headline | "Get started — pick what to create" |
| Tab body empty state (e.g., Events with 0 upcoming) | "No upcoming events yet" + "Create event" CTA |
| Loading | (visual shimmer only, no copy) |

### Files affected

REPURPOSE: `(tabs)/hub/_layout.tsx` (new tab bar component); NEW: `useHubVisibleTabs.ts` hook (location: `mingla-business/src/hooks/`); NEW: `useBrandOfferingCounts.ts` hook; DELETE: hard kind gates in `(tabs)/hub/trips.tsx:161` + `(tabs)/hub/experiences.tsx:292/307/319/331/345`.

---

## DESIGN AREA 5 — Public brand page IA

### Decision (locks Q4 + Q9)

Data-driven tabs. Upcoming tab interleaves events + trips + experiences chronologically when ANY offerings exist. Per-type tabs (Events / Trips / Experiences) shown only when their bucket has data. Zero offerings → no tabs, identity card only.

### Tab structure

```
Brand has 0 of everything:
  [Identity card]
  [Bio / contact / social row]
  [Empty state copy]
  (NO tabs)

Brand has at least 1 of anything:
  [Identity card]
  [Bio / contact / social row]
  [Tab bar: Upcoming | Events? | Trips? | Experiences? | About]
  [Tab body]

Tab visibility rules:
  - Upcoming: always shown when ANY (events+trips+experiences) > 0
  - Events: shown when events.length > 0
  - Trips: shown when trips.length > 0
  - Experiences: shown when experiences.length > 0
  - About: always shown when brand has bio OR address OR contact OR social

Tab order (left to right): Upcoming, Events, Trips, Experiences, About
Default selected: Upcoming
```

### Upcoming tab body (chronological interleave)

Each item in the Upcoming list rendered with its native card primitive:

| Offering type | Card primitive | Date used for sort |
|---|---|---|
| Event | `<EventMiniCard>` (existing) | `event_dates.start_at` |
| Trip | `<TripMiniCard>` (from ORCH-0963, preserved) | `event_dates.start_at` (master date) |
| Experience | `<ExperienceMiniCard>` (NEW — see Component spec below) | `theme.experience_meta.next_occurrence_at` |

Sort ASC by date; only future items (`date > now`); cap at 30 to avoid pagination explosion (cursor-based load-more if needed; Phase 3 spec decides exact limit).

Each item also shows a small type-pill in the top-left corner so buyers instantly know what they're tapping (`Event`, `Trip`, or `Experience` — `text.tertiary`, glass-tinted pill).

### Per-type tab bodies

| Tab | Body shape |
|---|---|
| Events | Existing EventMiniCard list (preserves ORCH-0963 NextEventTeaser + sticky "Buy tickets" pill on first 3 cards) + Past section below |
| Trips | TripMiniCard list (current) + Past Trips section below |
| Experiences | ExperienceMiniCard list (NEW); no past section (experiences are evergreen/recurring; "past" semantically doesn't apply the same way) |
| About | Bio / contact / social row / address card (if address present) / venue verified badge (if claimed) |

### New `<ExperienceMiniCard>` component spec

```
┌─────────────────────────────────────┐
│  [Cover image OR hash-hue gradient] │  ← 16:9 aspect, radius.lg top corners
│  ┌─────────┐                        │
│  │ Experience │  ← type-pill (top-left over image)
│  └─────────┘                        │
├─────────────────────────────────────┤
│  Experience title                   │  ← text.primary, 16pt semibold
│  Venue · Next: Sat 7pm              │  ← text.tertiary, 13pt
│  From £25                           │  ← text.primary, 14pt, accent-tinted
└─────────────────────────────────────┘
```

- Card height: ~220pt (16:9 cover + content block).
- Tap → `/exp/{brandSlug}/{experienceSlug}` (new route — per existing event/trip route segregation pattern, ORCH-0859 I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE).
- Subtitle line: venue text from `theme.experience_meta.venue_text` (if present) + "Next: <formatted date>" from `theme.experience_meta.next_occurrence_at`.
- "From £X" only if any tier has `price_cents > 0`; otherwise show "Free" pill.
- Hash-hue fallback uses `hashHueFromString(experience.id)` (same util as TripMiniCard).

### Address card (Q6 cleanup)

Show only if `brand.address` is non-empty string. No kind gate. Render in About tab.

### Verified location badge

Show if `brand.claim_status === 'verified'`. Positioned next to brand name in identity card. Copy: "Verified location" with `shield-check` Lucide icon. No kind gate (per Q10 / I-VENUE-CLAIM-OPTIONAL).

### Edge cases

- **Single offering type only:** e.g., brand has only events → Upcoming tab + Events tab + About tab. Upcoming is essentially a duplicate of Events but with future-only filter. That's acceptable; if buyers find it redundant, Phase 5 can flag and ORCH a one-tab variant later.
- **Experience with no `next_occurrence_at`:** appears only in Experiences tab (not Upcoming). Phase 3 spec defines whether the implementor sets a default `next_occurrence_at` at experience-create time or leaves it null.
- **Past offerings:** Events tab + Trips tab each carry a "Past" section below (existing behavior). Experiences tab has no past section (intentional — see component spec note).

### Cross-surface parity

| Surface | Status | Notes |
|---|---|---|
| buyer-web (`/b/{brandSlug}`) | YES | Primary; ships in `PublicBrandPage.tsx` rewrite |
| iOS/Android consumer (`app-mobile/`) | Out of scope per audit Dimension 12 (consumer app brand-kind-agnostic; doesn't render public-brand routes today) |

### Files affected

REPURPOSE: `PublicBrandPage.tsx` (drop `isTripBrand` constant + 14 references; rebuild tab structure with data-driven visibility); `publicEventsService.ts` (drop kind union, rewrite `getPublicBrandBySlug` to parallel-fetch events + trips + experiences). NEW: `<ExperienceMiniCard>` component; new `fetchPublicBrandExperiences` service fn + `pg_public_experiences_by_brand` RPC (Phase 3 spec defines exact contract). REPURPOSE: `pg_public_trips_by_brand.sql` (drop the `b.kind = 'trip_planner'` guard at line 46).

---

## DESIGN AREA 6 — Experience creation flow with venue ask

### Decision (locks Q6 + Q7)

Experience creation always asks for venue. Pre-fills from `brand.address` if present. Offers "Save this as my brand address too" if brand has no address and user types one.

### Flow

```
[Hub > Experiences > "Create experience" or OfferingChooser > Experience tap]
        │
        ▼
┌────────────────────────────────────┐
│  STEP 1 — What                     │
│  - Title (required, 1–80ch)        │
│  - Description (required, 10–500ch)│
│  - Continue ▶                       │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│  STEP 2 — Where                    │
│  - Venue (text input)              │
│    [pre-filled with brand.address  │
│     if present; placeholder if not]│
│  - [if brand has no address]       │
│    ☐ "Save this as my brand        │
│       address too"                  │
│  - Continue ▶                       │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│  STEP 3 — When                     │
│  - Next occurrence (date + time)   │
│  - [Recurrence: One-time / Weekly  │
│     / Monthly] (Phase 3 spec       │
│     defines if recurrence ships    │
│     in v1 or defers)               │
│  - Continue ▶                       │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│  STEP 4 — Pricing                  │
│  - Tier name + price + capacity    │
│  - (existing pricing flow)         │
│  - Continue ▶                       │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│  STEP 5 — Cover (optional)         │
│  - (existing cover picker)         │
│  - Publish or save as draft        │
└────────────────────────────────────┘
        │
        ▼
   createExperienceDraft(...)
   theme.experience_meta = {
     venue_text: "...",
     next_occurrence_at: "ISO timestamp",
     ...existing experience_meta fields
   }
```

### Step 2 pre-fill logic

```
useExperienceVenueDefault(currentBrand):
  if (currentBrand.address && currentBrand.address.trim().length > 0)
    return { value: currentBrand.address, source: "brand" }
  return { value: "", source: "none" }
```

- When `source === "brand"`: field is pre-filled, user can edit per-experience (e.g., touring chef holding event at different venue).
- When `source === "none"`: field is empty, placeholder reads "e.g. 12 Soho Square, London", and the "Save as brand address" checkbox appears below.
- When user EDITS a pre-filled value: no checkbox appears (assumption: they're overriding for this experience only, not changing brand-level).

### "Save as my brand address" toggle behavior

On Publish/Save:
1. Create experience draft with `theme.experience_meta.venue_text` set.
2. If checkbox checked AND brand.address was null: also fire `updateBrand({ id: brand.id, address: venueText })` mutation in parallel.

### Copy strings

| Element | Copy |
|---|---|
| Sheet title | "Create experience" |
| Step 1 title label | "Experience title" |
| Step 1 title placeholder | "e.g. Friday Night Jazz Tasting" |
| Step 1 description label | "What's it about?" |
| Step 1 description placeholder | "10–500 characters." |
| Step 2 title | "Where does it happen?" |
| Step 2 venue label | "Venue or address" |
| Step 2 venue placeholder (no brand address) | "e.g. 12 Soho Square, London" |
| Step 2 venue helper text (pre-filled) | "Pre-filled from your brand address. Edit if this experience is somewhere else." |
| Step 2 save-as-brand checkbox | "Also save this as my brand's address" |
| Step 3 title | "When is the next one?" |
| Step 3 subtitle | "Buyers see this as 'Next: <date>' on your experience card." |
| Step 4 / Step 5 | (existing pricing + cover flow copy unchanged) |

### Cross-surface parity

| Surface | Status |
|---|---|
| business-iOS | YES |
| business-Android | YES |
| business-web-preview | YES (uses same RN form components) |

### Files affected

NEW: `ExperienceCreatorWizard.tsx` (or extension of existing creation flow patterns from `TripCreatorWizard`). REPURPOSE: `canGenerateExperiencesFromMenu.ts` + `canGenerateExperiencesFromActivities.ts` (drop kind gate); `experiences.tsx` hub tab (drop 5 kind gates). Schema enrichment in Phase 3: `theme.experience_meta.venue_text` + `theme.experience_meta.next_occurrence_at` JSON sub-fields per Q9.

---

## DESIGN AREA 7 — Venue claim opt-in reframe

### Decision (locks I-VENUE-CLAIM-OPTIONAL)

VE1–VE4 system survives. Only the framing flips: from "verify your venue to start selling" → "claim your venue on Mingla for better discovery + Verified badge." Banner shown for any brand with an active claim regardless of kind.

### Brand Edit — new "Claim a venue" affordance

Add to top of BrandEditView (above the kind-picker section that's being deleted):

```
┌────────────────────────────────────────┐
│  📍  Claim a venue on Mingla            │  ← icon: map-pin
│                                        │
│  Got a physical space? Claim it for    │  ← text.tertiary
│  the Verified badge and better         │
│  local discovery.                      │
│                                        │
│  [Find my venue →]                     │  ← Button primary
└────────────────────────────────────────┘
```

Shown when `brand.claim_status === 'none'` AND no `place_pool_id` set. On tap → opens existing venue-search flow (the one currently behind PersonaPickerCards "A place" path).

### VenueClaimStatusBanner reframe

Today: banner only renders if `brand.kind === 'physical'` (kind gate at line 28 of `VenueClaimStatusBanner.tsx`).

New: banner renders for any brand with `claim_status !== 'none'`. Variants:

| `claim_status` | Banner copy |
|---|---|
| `pending_review` | "Your venue claim is being reviewed. Usually within 4 business hours." |
| `verified` | "Verified location ✓ — your brand has the Verified badge on your public page." |
| `rejected` | "Your venue claim was declined. Tap to see why or try a different venue." |
| `none` | (no banner) |

### Verified badge on public brand page

Per Design Area 5, shown next to brand name in identity card when `claim_status === 'verified'`. Icon `shield-check`, copy "Verified location".

### Address auto-fill on claim success

When admin approves a claim (claim_status flips to verified), if `brand.address` was null, server-side fills it from the matched Google Places venue's formatted address. Brand-edit shows the address as populated next time user opens it.

### Copy strings

| Element | Copy |
|---|---|
| Brand-edit affordance title | "Claim a venue on Mingla" |
| Brand-edit affordance body | "Got a physical space? Claim it for the Verified badge and better local discovery." |
| Brand-edit affordance CTA | "Find my venue" |
| Banner pending | "Your venue claim is being reviewed. Usually within 4 business hours." |
| Banner verified | "Verified location ✓" |
| Banner rejected | "Your venue claim was declined." |
| Public page verified pill | "Verified location" + `shield-check` icon |

### Files affected

REPURPOSE: `VenueClaimStatusBanner.tsx:28` (drop kind gate); `venueClaimBannerLogic.ts:25` (drop kind gate); NEW: "Claim a venue" affordance in `BrandEditView.tsx` (replaces the now-deleted SECTION B-2 kind picker block). Marketing copy across the venue-search flow updated.

---

## DESIGN AREA 8 — Admin Venue Claims dashboard

### Decision (locks Q10)

Default Claims page filters to `claim_status = 'pending_review'`. Separate "All Claims" view for verified + rejected history.

### Page structure

```
[Mingla Admin > Brands > Claims]
┌────────────────────────────────────────────────────────┐
│  Tabs: [ Pending (12) ] [ Verified ] [ Rejected ]      │
├────────────────────────────────────────────────────────┤
│  Pending tab body:                                     │
│   ┌──────────────────────────────────────────────┐    │
│   │ Brand name · slug · claimed venue · submitted │    │
│   │ [View] [Approve] [Reject]                     │    │
│   └──────────────────────────────────────────────┘    │
│   ... (sorted by submitted ASC = oldest first)         │
└────────────────────────────────────────────────────────┘
```

Verified and Rejected tabs show same row shape with `Approved` or `Rejected` chip + `reviewed at` timestamp instead of action buttons. Reviewed-by admin email + rejection reason shown on hover.

### Filter signal replacement (per audit Dim 12 finding)

Today: `adminClaimsService.js:37` uses `.eq("kind", "physical")`.

Replacement queries:
- Pending tab: `.eq("claim_status", "pending_review")`
- Verified tab: `.eq("claim_status", "verified").order("verified_at DESC")`
- Rejected tab: `.eq("claim_status", "rejected").order("rejected_at DESC")`

No kind filter anywhere.

### Copy strings

| Element | Copy |
|---|---|
| Page title | "Venue Claims" |
| Pending tab label | "Pending review" |
| Verified tab label | "Verified" |
| Rejected tab label | "Rejected" |
| Empty pending state | "No claims waiting for review. Nice work." |
| Empty verified/rejected | "No claims yet." |
| Action: approve | "Approve" |
| Action: reject | "Reject" |
| Reject reason prompt | "Why is this claim being declined?" |

### Files affected

REPURPOSE: `mingla-admin/src/services/adminClaimsService.js:37` (replace filter); NEW: admin Claims page tab structure (3 tabs). Reuses existing admin table primitives.

### Cross-surface parity

| Surface | Status |
|---|---|
| admin-web | YES (only surface; admin is web-only) |

---

## DESIGN AREA 9 — Universal AI experience generator flow

### Decision

`parse-restaurant-menu` + `parse-play-activities` edge functions become universal. Any brand can upload a menu PDF or paste activities text and get parsed suggestions. Kind + claim gates DELETED.

### Entry point

Today: Hub > Experiences tab; gated on `kind === 'physical' && venueCategory === '...' && claim_status === 'verified'`.

New: Hub > Experiences tab > "Create experience" CTA opens the standard creation flow (Design Area 6). On Step 1 (What), add an optional shortcut:

```
┌────────────────────────────────────┐
│  STEP 1 — What                     │
│                                    │
│  [Title input]                     │
│  [Description input]               │
│                                    │
│  ─── or ───                        │
│                                    │
│  ┌──────────────────────────────┐ │
│  │ 📄 Upload a menu              │ │
│  │ We'll suggest experiences    │ │
│  │ from your dishes.            │ │
│  └──────────────────────────────┘ │
│  ┌──────────────────────────────┐ │
│  │ 🎯 Paste your activities      │ │
│  │ We'll suggest experiences    │ │
│  │ from your offerings.         │ │
│  └──────────────────────────────┘ │
└────────────────────────────────────┘
```

Tap "Upload menu" → opens existing `MenuSnapInput` (no kind gate); tap "Paste activities" → opens existing `ActivitiesSnapInput`. Both feed the existing parse + review + accept flow, which now creates experience drafts that flow into Step 2 (venue ask) of Design Area 6.

### `venueCategory` inference

`venueCategory` (restaurant / play / creative_and_arts) was previously set on brand creation via venue claim. Under the new model:
- Brands that go through venue claim still get `venueCategory` set from the claimed Google Places venue (existing path).
- Brands that don't claim: `venueCategory` is null. The shortcuts in Step 1 still show but the AI parser will infer category from the uploaded content (menu = restaurant, activities = play). Phase 3 spec defines the exact inference rule for the edge function.

### Copy strings

| Element | Copy |
|---|---|
| Or-divider | "or" |
| Menu upload card title | "Upload a menu" |
| Menu upload card body | "We'll suggest experiences from your dishes." |
| Activities card title | "Paste your activities" |
| Activities card body | "We'll suggest experiences from your offerings." |

### Files affected

REPURPOSE: `canGenerateExperiencesFromMenu.ts` + `canGenerateExperiencesFromActivities.ts` (drop kind+claim gates entirely; return true always, or compute simpler eligibility). DELETE server-side gates at `parse-restaurant-menu/index.ts:155+161`, `parse-play-activities/index.ts:162+176`, `_shared/agentTools.ts:412+421`. REPURPOSE: `experiences.tsx` 5 kind gates collapse to single universal entry point.

---

## CROSS-CUTTING DESIGN DECISIONS

### Theme A — 3-button chooser as connective tissue

The same `<OfferingChooser>` component (Design Area 2) appears in 3 places: end of brand creation flow (Step 4), home empty state (rung 2), and hub "Get started" tab (Q2). Same component, different headline prop. This single visual pattern teaches users the universal-authoring model: any brand can make any offering.

### Theme B — Address as data, not gate

Address is OPTIONAL at brand creation (Step 2 skippable). It's OPTIONAL forever (no gate ever fires for missing address — rung 4 deleted). It's USED for: pre-filling experience venues (Design Area 6), rendering the address card on public page when present (Design Area 5), auto-filling on venue claim approval (Design Area 7). Nothing else.

### Theme C — Venue claim as upgrade path

Venue claim becomes an opt-in trust signal (Verified badge + discovery boost), not a permission gate. Marketing copy reframed end-to-end (Design Area 7). VE1–VE4 system survives; only the framing flips.

### Theme D — Data-driven tabs (public page + hub)

Same visibility rule on both surfaces: tabs render only when their bucket has content. Different defaults (public page: Upcoming first; hub: sticky last-visited, Events on first visit). One mental model.

### Theme E — Hub mirrors public page

Both surfaces use the same Events/Trips/Experiences tab vocabulary. Both use data-driven visibility. The implementor SHOULD share the `useOfferingCounts(brandId)` hook between them (one query, used in two places). This is also a Phase 3 spec recommendation.

---

## NEWLY-SURFACED OPEN QUESTIONS

Items the audit's Q1–Q11 didn't cover that this design surfaced. None are blocking for Phase 3 SPEC, but Phase 3 should resolve them:

### Q12 — Experience recurrence model: ship v1 with one-time only?

Design Area 6 Step 3 mentions "Recurrence: One-time / Weekly / Monthly". The Phase 1 audit found NO recurrence model on experience rows today. Options:

- **(a) v1 ships one-time only** — `next_occurrence_at` is a single timestamp. Recurring experiences require operator to manually republish. Simplest; smallest schema.
- **(b) v1 ships with simple recurrence enum** — add `theme.experience_meta.recurrence: 'one_time' | 'weekly' | 'monthly'`. UI displays "Every Saturday" etc. Server-side regenerates `next_occurrence_at` after each occurrence date passes (cron or trigger).
- **(c) v1 ships with full `experience_instances` table** — explicitly rejected in Q9.

**Designer recommendation:** Option A for v1 (single timestamp, no recurrence). Phase 3 spec confirms; Phase 5+ can ORCH recurrence as a follow-up if users ask for it.

### Q13 — Past trips/past events sections inside per-type tabs vs unified "Past" tab?

Design Area 5 keeps existing per-type Past sections inside the Events tab and Trips tab. Phase 3 spec should confirm this matches operator's expected mental model, OR add a unified "Past" tab at the right end of the tab bar. Designer recommendation: **per-type past sections** (matches today; less tab proliferation).

### Q14 — Upcoming tab cap?

Designer recommendation: cap 30 items, cursor-load-more if needed. Phase 3 spec confirms.

### Q15 — `venueCategory` inference rule for AI parser?

Design Area 9 — when brand hasn't claimed a venue (`venueCategory` is null), the AI parser needs to infer category from uploaded content. Designer recommendation: **infer by tool type** (menu upload → set `temporaryCategory: 'restaurant'` for the parse call; activities paste → `'play'`). Don't write to brand row; just pass to the edge function.

---

## Implementation phase notes (for Phase 3 spec writer)

This design assumes the following primitives EXIST and will be reused (no new primitives invented by this design):

- `<GlassCard>` — existing card primitive
- `<Icon name="..." />` — Lucide wrapper
- `<Button>` — with `loading` state
- `<TopSheet>` / `<UniversalCreatorSheet>` — sheet primitives
- `<EventMiniCard>`, `<TripMiniCard>` — existing card primitives (TripMiniCard via ORCH-0963)
- `<BrandCoverPickerSheet>` — existing cover picker
- `useCurrentBrand()`, `useCreateBrand()`, `useUpdateBrand()` — existing hooks
- `Haptics.impactAsync(...)` — Expo Haptics
- `AsyncStorage` — for hub last-visited persistence

NEW primitives Phase 3 spec must define:

- `<OfferingChooser>` — the 3-button chooser (Design Area 2)
- `<ExperienceMiniCard>` — public-page experience card (Design Area 5)
- `<BrandCreationFlow>` — 4-step flow shell (Design Area 1)
- `<ExperienceCreatorWizard>` — experience creation flow (Design Area 6)
- `useHubVisibleTabs()` + `useHubInitialTab()` — tab visibility hooks (Design Area 4)
- `useBrandOfferingCounts()` — shared count query (Theme E)
- `useExperienceVenueDefault()` — venue pre-fill logic (Design Area 6)
- `fetchPublicBrandExperiences()` + `pg_public_experiences_by_brand` RPC — public-page experience fetch (Design Area 5)

Phase 3 spec defines exact prop interfaces, hook signatures, RPC SQL, and migration order. Phase 4 implementor builds.

---

## Completeness checklist

- [x] All 9 design areas covered with flow + copy + edge cases + cross-surface parity + files-affected
- [x] All 5 cross-cutting themes addressed (A–E)
- [x] No contradiction with OPEN_QUESTIONS Q1–Q11 — every design decision cross-referenced
- [x] No new schema beyond Q9-locked JSON sub-fields
- [x] No scope drift into Phase 3 (contracts/types/RLS/SQL deferred)
- [x] Cross-surface parity declared per area
- [x] 4 newly-surfaced open questions (Q12–Q15) flagged for Phase 3
- [x] ui-ux-pro-max cross-cutting rules applied (touch ≥ 44pt, motion 150–300ms, contrast ≥ 4.5:1, prefers-reduced-motion, no emojis as icons, cursor-pointer via accessibilityRole, disable-button-during-async, content-jumping prevention)
- [x] Mingla existing primitives preserved (no redesign of GlassCard / Icon / Button / TopSheet)
- [x] Locked invariants respected (I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE, I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE)

End of master design document.
