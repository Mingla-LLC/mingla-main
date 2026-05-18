# SPEC — ORCH-0874 [Trip surfaces visual parity with Events]

**Owner:** Claude `mingla-forensics` (SPEC phase, same session as INVESTIGATE)
**Date:** 2026-05-18
**Inputs:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` (this session) + dispatch at `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 1. Scope & non-goals

### 1.1 In scope
Visual + chrome parity sweep across **4 trip-side surfaces** in `mingla-business`:

1. **Trips list page** (`app/(tabs)/hub/trips.tsx`) — adopt events-list visual language including new `TripListCard` primitive + filter row.
2. **Trip detail dashboard** (`app/trip/[id]/index.tsx`) — adopt events-detail hero + action grid + tile primitives; preserve ORCH-0873 [Tr3 Stage 2 UI] Money tab content as restyled tiles.
3. **Trip create + edit wizard chrome** (`TripCreatorWizard.tsx` + entry routes) — both variants closable per operator decision, mirroring event wizard chrome (close X always rendered, create-mode-dirty discard dialog, edit-mode silent exit, named Stepper, body-side step title hierarchy, publish ConfirmDialog).
4. **Public trip page** (`app/t/[brandSlug]/[tripSlug].tsx` + `TripPreview.tsx`) — adopt public event page hero treatment (X-close + share overlays on cover) while preserving the existing buyer-anon + full-bleed SafeArea posture.

**Plus ORCH-0867 fold-in** (recommended): the "View public page" header affordance lands as an `ActionTile` in the new trip detail action grid AND as an item in the right-slot Manage menu. ORCH-0867 closes simultaneously with ORCH-0874.

### 1.2 Non-goals (HARD)
- No business logic refactor. Query keys, services, mutations, RLS, RPCs, edge functions, copy strings — all unchanged.
- No unification of `TripCreatorWizard` with `EventCreatorWizard` into a shared component. Trips have 5 steps, events have 7, contents differ — mirror chrome/styling layer, keep wizard implementations separate.
- No deletion of trip-specific tiles. Money tab + PaymentPlanEditor + InstallmentScheduleDisplay + reassurance copy from ORCH-0873 SURVIVE — they only restyle to inherit event tile idiom.
- No new DB migrations. No new edge functions. No new strict-grep CI gates.
- No fix for the 53 TS-debt errors flagged in ORCH-0873 close (PaymentPlanEditor + MoneyTabBody style arrays). Implementor must NOT make them worse by adding more `[styles.a, condition && styles.b]` arrays — use `condition ? styles.b : null` or split StyleSheet.create into ViewStyle-typed + TextStyle-typed maps where new code lands.
- No changes to the trip data model, trip pricing tier model, or installment schedule shape.
- No changes to `routeForEventRow` helper (use as-is from the new TripListCard).

### 1.3 Assumptions
- Operator confirms answers to Open Questions Q1–Q5 (§11) BEFORE implementor starts.
- Operator confirms the ORCH-0867 fold (recommended) OR explicitly redirects to keep it separate.
- Tester ORCH-0873 [Tr3 Stage 2 UI] QA has either completed (baseline established) OR operator accepts that ORCH-0874 will be the first time the Money tab visual is verified end-to-end. Recommended: run ORCH-0873 tester pass first to lock the data-layer baseline before this visual restyle layers on top.

---

## 2. Cross-Surface Impact (MANDATORY — Phase 2.5)

| Surface | Covered? | User-visible behavior | File paths touched | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/`) | NO | No consumer trip surface exists today. | none | n/a |
| Consumer Android (`app-mobile/`) | NO | No consumer trip surface exists today. | none | n/a |
| Buyer/anon Web (`mingla-business/` `/t/{brandSlug}/{tripSlug}`) | **YES** | Public trip page gets X-close + share button overlays on cover hero, matching public event page. | `app/t/[brandSlug]/[tripSlug].tsx`, `src/components/trip/TripPreview.tsx` | Automatic — single shared route file used by both iOS+Android+Web (mobile renders via RN; web preview via Expo web) |
| Business iOS (`mingla-business/` on iOS) | **YES** | Trip list shows cards + filters; trip detail shows hero + action grid; trip wizard has Close X + named Stepper + body-side title + publish dialog. | All planner-side files in §3 | Automatic — single RN code path |
| Business Android (`mingla-business/` on Android) | **YES** | Same as iOS. | Same | Automatic — single RN code path |
| Admin Web (`mingla-admin/`) | NO | No admin trip page. | none | n/a |
| Business Web preview (`mingla-business/` dev/web) | YES (follows along) | Same as business iOS/Android via Expo web bundle. | Same | Automatic — RN-web handles. Web preview is not a separate target; if iOS/Android verify, web inherits. |

**Parity is automatic on every covered surface** because RN single-codebase. No per-surface success criteria needed (SC-N-iOS / SC-N-Android / SC-N-Web split is not required).

**Manual-parity carve-out (zero in this spec):** none — every change is in shared RN files.

---

## 3. Per-layer specification

### 3.1 Database / RPC / Edge function layers
**N/A.** No DB, RPC, or edge function changes.

### 3.2 Service / hook layers
**N/A.** No new services or hooks. Existing hooks (`useTrips`, `useTrip`, `useCreateTripDraft`, `useUpdateTripBasics`, etc.) are consumed as-is.

### 3.3 Component layer (the entire spec)

#### 3.3.1 NEW: `src/components/trip/TripListCard.tsx`
Mirror of `src/components/event/EventListCard.tsx` (425L) with trip-appropriate data.

**Props:**
```typescript
export interface TripListCardProps {
  trip: Trip;                       // from useTrips list
  brand: Brand;                     // from currentBrandStore
  onOpen: () => void;               // routes via routeForEventRow
  onManageOpen?: () => void;        // optional — only if Q5 says yes to manage menu on list
}
```

**Visual structure (mirror EventListCard.tsx):**
- Outer: `glass.tint.profileBase` background, `radiusTokens.lg`, 1pt `glass.border.profileBase` border, `overflow: visible`.
- Layout: `flexDirection: row` with 76×92 cover (left, `radiusTokens.md`) + body column (`flex:1`) + right rail.
- Cover: use trip `coverImageUrl` if available, else trip `coverHue`-derived placeholder via existing `EventCoverMedia` primitive (works for both — `EventCoverMedia` is content-agnostic).
- Status pill: `Pill` primitive — variant logic for trips:
  - `draft` → `Pill variant="draft"` ("Draft")
  - Published, departure in future → `Pill variant="accent"` ("Upcoming · {N} days")
  - Published, in-progress (start ≤ now ≤ end) → `Pill variant="live" livePulse` ("Live now")
  - Published, ended (now > end) → inline `pastPill` style ("Ended")
  - Cancelled → `Pill variant="draft"` muted ("Cancelled")
- Title: 15pt fontWeight 600, single-line truncation. Use trip.title.
- Subline: 11pt tertiary, single-line. Format: `{startDate}–{endDate} · {destinationLocationText}` (e.g., "Aug 16–22 · Marbella, Spain"). If destination is null, fallback to dates only.
- Sold/capacity affordance:
  - Trip with capacity AND >0 travelers: 3pt progress track + `accent.warm` fill bar + label "{X} of {Y} booked". Use `travelerCount` from `useTrip` aggregate (already wired in `app/trip/[id]/index.tsx`).
  - Trip with capacity AND 0 travelers: "{Y} capacity · 0 booked" text.
  - Draft: "Not published" text.
- Manage icon: right-rail 32×32 circular button with `glass.tint.chrome.idle`, opens `TripManageMenu` (NEW, see §3.3.4) — render only if `onManageOpen` prop is provided AND operator decides Q5=yes.
- Revenue strip: bottom-right absolute, 13pt fontWeight 700, tabular-nums. Use trip total revenue if available; hide for drafts.
- Past + 0-traveler: `opacity: 0.7`.
- Press state: `opacity: 0.85`.
- `onOpen` press handler: call `routeForEventRow(trip)` from `src/utils/routeForEventRow.ts` per `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` invariant.

**Accessibility:**
- `accessibilityRole="button"` on outer Pressable.
- `accessibilityLabel={`${trip.title}, ${statusLabel}, ${dateRangeText}`}`.
- Manage button: `accessibilityLabel="Trip options"`, `hitSlop=6`.

#### 3.3.2 NEW: `src/components/trip/TripManageMenu.tsx`
**Conditional on Q5 = yes.** Mirror of `EventManageMenu.tsx` (operator-facing actions sheet). Actions: View public page / Share / Edit trip / Cancel trip. Cancel-trip uses typeToConfirm `ConfirmDialog`. If Q5 = no, skip this component and put actions only in the action grid + detail header.

#### 3.3.3 MODIFY: `mingla-business/app/(tabs)/hub/trips.tsx`
- Add filter row above the trip list mirroring `events.tsx:502–541`. Filter set per **Q1**.
- Replace inline-styled `Pressable` tile (lines 116–162) with `<TripListCard>` mounts per `trips.map(...)`.
- Add `useSafeAreaInsets()` and apply `paddingBottom: insets.bottom + 120` to ScrollView contentContainerStyle (mirror `events.tsx:550`).
- Use `flexGrow:0` on the filter ScrollView (mirror `events.tsx:761`) per `feedback_rn_scrollview_flex_grow_default_one_silent_footgun` — CRITICAL to avoid layout split.
- Empty state: replace placeholder card with `GlassCard variant="elevated" padding={spacing.lg}` — copy "No trips yet" + "Tap the + button above to start your first trip." + conditional "Build a new trip" CTA (gated on brand.kind=='trip_planner').

#### 3.3.4 MODIFY: `mingla-business/app/trip/[id]/index.tsx`
**The biggest single change. Topology depends on Q2.**

**Q2 = KEEP TABS (default if operator does not respond):**
- Add hero ABOVE the tabs (between header and status pill row).
  - Use `EventCoverMedia` (or equivalent — confirm trips have `coverHue` or `coverImageUrl`) at height=200, `radius={24}`.
  - Gradient overlay (absolute, dark gradient, `pointerEvents="none"`).
  - Status pill (existing `statusPillLive` / `statusPillDraft` logic, moved into hero).
  - Title: 24pt fontWeight 700 letterSpacing -0.2 white + text-shadow, `numberOfLines={2}`. Use trip.title.
  - Subline: 13pt `rgba(255,255,255,0.85)`, single-line. Format: `{startDate}–{endDate} · {destinationLocationText}`.
- Add action grid BELOW the hero, BEFORE the tabs.
  - `flexDirection: row, flexWrap: wrap, gap: 8` (mirror `event/[id]/index.tsx:975–979`).
  - Render `ActionTile` components (reuse `src/components/event/ActionTile.tsx` directly — it's content-agnostic; if dependency direction concerns arise, move it to `src/components/shared/` in a follow-up ORCH NOT this one).
  - Tiles for the trip detail action grid (operator confirms via Q3):
    1. **View public page** (icon="eye", primary=false) → opens `/t/{brandSlug}/{tripSlug}` (this is the ORCH-0867 fold).
    2. **Brand page** (icon="user", primary=false) → opens `/b/{brandSlug}`.
    3. **Marketing blasts** (icon="send", primary=false) → opens `/event/{trip.id}/blasts` (the marketing blast surface is event-id agnostic — trips ARE events with event_type='trip'). Conditional on Q3.
    4. **Edit trip** (icon="edit" or "pencil", primary=true) → opens `/trip/{trip.id}/edit`. Replaces the inline header Edit pill.
- Header chrome (lines 445–452) RESTYLED to mirror event detail (`event/[id]/index.tsx:599–614`):
  - Left: `[36×36 back Pressable]` (unchanged).
  - Title: centered, h3 typography (unchanged).
  - Right slot: TWO IconChrome buttons (36pt each, 6pt gap):
    - `share` → opens new `ShareModal` instance (existing component) with public trip URL.
    - `moreH` → opens new `TripManageMenu` (per §3.3.2, conditional on Q5).
  - REMOVE the inline "Edit" Pressable — Edit moves to the action grid (item 4 above).
- Tabs (Overview / Travelers / Money) UNCHANGED structurally — same 3 tabs, same active-styling (bottom border `accent.warm` 2px), same badge in Money tab label.
- Tab content tile RESTYLE:
  - **Overview tab:** Wrap each KPI tile in `GlassCard variant="elevated" radius="lg" padding=spacing.lg` (mirror `EventDetailKpiCard.tsx`). Two-column grid for Revenue + Travelers (mirror event KPI dual-column layout). Full-width for Departure + Destination (current pattern fine — just adopt GlassCard variant).
  - **Travelers tab:** Wrap each traveler row in `GlassCard variant="base" padding=spacing.md` (or keep current inline-styled rows if the diff cost is too high — implementor decision per smaller diff).
  - **Money tab (`MoneyTabBody`):** Wrap each booking row outer container in `GlassCard variant="base" padding=spacing.md`. Filter chips: restyle to mirror events filter pill primitive (events.tsx:769–787 — 34pt height pills, `glass.tint.profileBase`, `radiusTokens.full`, `accent.tint` when active). PRESERVE all data wiring, expand/collapse logic, retry mutation, refund stub.
- Root-mounted overlays: add `ShareModal` (existing), `TripManageMenu` (per §3.3.2, conditional). Preserve all existing modals.

**Q2 = FLATTEN TO SINGLE SCROLL (alternative):**
- Remove tabs entirely.
- Single ScrollView: Hero → Action grid → Revenue KPI tile → Travelers section (collapsed to top 5 rows + "View all travelers" link → sub-route `/trip/{id}/travelers`) → Money section (collapsed to summary card + "View full money tab" link → sub-route `/trip/{id}/money` where the full MoneyTabBody renders) → Cancel trip CTA (mirror `event/[id]/index.tsx:770–784`).
- Requires MoneyTabBody extraction to its own file: `src/components/trip/MoneyTabContent.tsx` consumable by both the summary card and the sub-route.
- Requires creating 2 new sub-route files: `app/trip/[id]/travelers.tsx` + `app/trip/[id]/money.tsx`.
- LARGER diff but stronger event parity. Operator decides.

#### 3.3.5 MODIFY: `mingla-business/src/components/trip/TripCreatorWizard.tsx`
**The operator's headline ask: both wizards closable.**

- **Add `isCreateMode: boolean` prop** to `TripCreatorWizardProps`. Default false (edit mode). Compute in route per §3.3.6.
- **Replace header chrome (lines 412–429)** with event-pattern chrome row (mirror `EventCreatorWizard.tsx:653–670`):
  - `[IconChrome icon="close" size=36 onPress={handleClose} accessibilityLabel="Close wizard"]` — ALWAYS rendered, regardless of mode.
  - `[Stepper steps={STEPPER_STEPS} currentIndex={step-1} showCaption={false}]` — replaces the anonymous progress segments. Build `STEPPER_STEPS` from existing `STEP_TITLES` map: `[{id:'step-1', label:'Basics'}, {id:'step-2', label:'Day by day'}, {id:'step-3', label:'What\\'s included'}, {id:'step-4', label:'Pricing'}, {id:'step-5', label:'Review'}]`.
  - `[stepCounter "{N}/5"]` — 12pt tertiary tabular-nums.
- **Remove the progress segments View (lines 431–456)** — Stepper subsumes.
- **Add subtitle row** (mirror `EventCreatorWizard.tsx:672–693`):
  - `[brand.name · Step N of 5]` + autosave-state text ("Saving..." / "Saved" / "Unsaved changes — retrying").
  - Wire autosave state: add `useEffect` watching `isAutosaving` boolean + mutation `.isPending` flags from existing mutations.
- **Move step title hierarchy into body** (mirror `EventCreatorWizard.tsx:725–729`):
  - Add `STEP_SUBTITLES` map: `{ 1: "Title, dates, destination, capacity", 2: "Day-by-day itinerary", 3: "What's included / excluded", 4: "Pricing + payment plan", 5: "Preview and publish" }`.
  - Body wraps with: `[eyebrow "Step N of 5"] [26pt title from STEP_TITLES] [14pt subtitle from STEP_SUBTITLES]` ABOVE the step body.
  - REMOVE the step counter + title from the header `headerCenter` (lines 424–427) — body now owns the title.
- **Add `handleClose` callback** (mirror `EventCreatorWizard.tsx:434–460`):
  - **Create mode + pristine** (no draft changes since /trip/create): call `onDiscardTrip()` (NEW prop, route maps to `useDiscardTrip` mutation) + `onExit('abandoned')`.
  - **Create mode + dirty:** open Discard ConfirmDialog with copy:
    - title: "Discard this trip?"
    - description: "You'll lose your changes."
    - confirmLabel: "Discard", cancelLabel: "Keep editing", destructive=true.
    - On confirm: `await onDiscardTrip()`, then `onExit('discarded')`.
  - **Edit mode:** simple `onExit('abandoned')` — no dialog (auto-save semantics; trip wizard already autosaves on each step transition).
  - Pristine check: compare current draft state vs trip-from-server initial state. Helper: `isTripWizardPristine(step1Draft, daysDraft, inclusionsDraft, step4Draft, trip)` — returns true if all four draft objects equal their server-derived initial values. Implementor decides exact equality semantics (deep equals on critical fields).
- **Add `handleStepBack` (separate from header Close)** — Steps 2-5 dock Back button decrements step (mirror event wizard `handleStepBack`).
- **Restructure dock (mirror `EventCreatorWizard.tsx:739–808`):**
  - Wrap in `GlassCard variant="elevated" padding={0} radius="xxl"` with `marginHorizontal: spacing.md, marginBottom: spacing.lg, paddingVertical: 6, paddingHorizontal: 8`.
  - **Step 1:** single full-width "Continue" button (no in-wizard Back — chrome X handles exit).
  - **Steps 2–4:** `[Back ghost flex:1] [Continue primary flex:1]`.
  - **Step 5:** `[Back ghost flex:1] [Publish primary flex:2]`. Publish disabled when `submitting` or pending validation errors.
  - Add `keyboardVisible` listener pattern (mirror `EventCreatorWizard.tsx:262–279`) — dock hides when keyboard up.
- **Add Publish ConfirmDialog** (mirror event 826–836):
  - title: "Publish trip?"
  - description: "{destinationLocationText} · {startDate}–{endDate}. Buyers can book immediately. You can edit details after publishing."
  - confirmLabel: "Publish", cancelLabel: "Cancel".
  - On confirm: run existing `handlePublish` logic.
  - On cancel: close dialog.
- **Per Q4: Add `TripPublishErrorsSheet` (optional).**
  - If Q4 = yes: create `src/components/trip/TripPublishErrorsSheet.tsx` mirror of `PublishErrorsSheet.tsx`. On publish-error with field-pointing errors, open the sheet with Fix-jump buttons; on publish-error without field errors, fall back to current banner pattern.
  - If Q4 = no: keep current Step 5 banner pattern as-is.
- **Replace KeyboardAvoidingView with explicit listener pattern** (mirror event wizard 262–312). PRESERVE current keyboard behavior on Step 1 title input — implementor must verify via live-fire sim that typing into the title field with keyboard up doesn't regress (the field stays visible above the keyboard).
- **Overlays at root JSX** (mirror event 810–852):
  - Discard `ConfirmDialog`
  - Publish `ConfirmDialog`
  - `TripPublishErrorsSheet` (conditional on Q4)
  - Toast wrap (`position: absolute, top: 0, left: 0, right: 0, paddingTop: spacing.lg, paddingHorizontal: spacing.md`)

#### 3.3.6 MODIFY: `mingla-business/app/trip/[id]/edit.tsx`
- Add `useCreateMode` derivation: read `useTrip(eventId).data.trip` — `isCreateMode = trip.status === 'draft' && trip.title.length === 0 && trip.days.length === 0` (or equivalent first-time-edit signal). Implementor confirms exact heuristic against `Trip` shape from `tripsService.ts`.
- Pass `isCreateMode` prop to `<TripCreatorWizard>`.
- Wire `onDiscardTrip` prop: connect to a NEW `useDiscardTrip` hook (if not already in `useTrips.ts`) that calls a mutation deleting the draft event row. **IF the hook doesn't exist**, implementor decides: either (a) add a minimal `useDiscardTrip` hook + `tripsService.discardTrip(eventId)` service method (single DELETE call gated on draft status), OR (b) document the gap and only enable the create-mode-pristine + create-mode-dirty paths conditional on hook availability, with the dirty-discard dialog leaving the draft in place when discard fails. Decision: ship option (a) — it's the right contract and matches the operator decision that wizards are closable with proper semantics.

#### 3.3.7 MODIFY: `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` + `src/components/trip/TripPreview.tsx`
- Add X-close button overlay on cover hero (mirror public event page pattern). Top-left absolute position, 36×36 IconChrome icon="close", `glass.tint.chrome.idle` background, navigates to `router.back()` or `/` if no back stack.
- Add share button overlay on cover hero (mirror public event page pattern). Top-right absolute position, 36×36 IconChrome icon="share", opens native `Share.share({ url, title })` with the public trip URL.
- PRESERVE the existing full-bleed SafeArea posture (no SafeScreen wrap; the `orch-strict-grep-allow safearea-on-fullscreen-routes` allowlist comment must continue to cover this route — verify after change).
- PRESERVE the buyer-anon posture (no `useAuth`).
- All other `TripPreview` content (title, brand byline, dates, destination, capacity, description, itinerary days, inclusions/exclusions, pricing card) UNCHANGED.

#### 3.3.8 EXISTING components reused as-is (no modification needed)
- `src/components/event/ActionTile.tsx` — content-agnostic, consume directly from trip detail.
- `src/components/event/EventDetailKpiCard.tsx` — content-agnostic, consume directly if Q2 keeps KPI tiles. Implementor MAY pass trip-specific props (revenueGbp, payoutGbp).
- `src/components/event/EventCoverMedia.tsx` — content-agnostic, consume directly for trip hero.
- `src/components/ui/Pill.tsx` — used by new `TripListCard` for status pill.
- `src/components/ui/Stepper.tsx` — used by trip wizard chrome.
- `src/components/ui/IconChrome.tsx` — used by trip wizard close + trip detail header right slot + public trip page overlays.
- `src/components/ui/ConfirmDialog.tsx` — used by trip wizard discard + publish.
- `src/components/ui/GlassCard.tsx` — used pervasively per restyle requirements.

---

## 4. Success criteria (SC-N)

All criteria are observable, testable, unambiguous.

| ID | Description |
|---|---|
| **SC-01** | `TripCreatorWizard.tsx` renders an `IconChrome icon="close" size=36` as the FIRST element in its chrome row (mirroring `EventCreatorWizard.tsx:654–659`). Present on ALL 5 steps. Verifiable via Maestro tap or source assertion `<IconChrome ... icon="close"` in file. |
| **SC-02** | When operator opens `/trip/create` (create mode) → wizard mounts at Step 1 → makes ANY field edit on Step 1 → taps Close X → a ConfirmDialog appears with title "Discard this trip?" and confirmLabel "Discard". Tapping Discard discards the draft AND exits to `/(tabs)/hub/trips`. |
| **SC-03** | When operator opens `/trip/create` (create mode) → wizard mounts at Step 1 → makes NO edits → taps Close X → wizard discards draft silently AND exits to `/(tabs)/hub/trips` without a dialog. |
| **SC-04** | When operator opens `/trip/{id}/edit` on a published trip (edit mode) → makes any edit on any step → taps Close X → wizard exits silently to `/trip/{id}` (or back-stack) WITHOUT a dialog. Auto-save semantics: changes already persisted. |
| **SC-05** | Trip wizard header progress chrome uses the `Stepper` primitive with named pill chips (Basics / Day by day / What's included / Pricing / Review). NOT the 4pt anonymous segments. Verifiable by source assertion `<Stepper steps=` in `TripCreatorWizard.tsx`. |
| **SC-06** | Trip wizard body renders step title hierarchy: eyebrow "STEP N OF 5" (11pt accent.warm uppercase) + 26pt step title + 14pt step subtitle. Below the chrome row, above the step body. Mirrors event wizard body lines 725–729. |
| **SC-07** | Trip wizard dock uses `GlassCard variant="elevated" radius="xxl"` floating layout. Hidden when keyboard is visible. Step 1: single "Continue" button. Steps 2–4: `[Back ghost] [Continue primary]`. Step 5: `[Back ghost flex:1] [Publish primary flex:2]`. |
| **SC-08** | Trip wizard subtitle row shows `{brand.name} · Step N of 5` + autosave-state text. Autosave-state text shows "Saving..." while an autosave mutation is pending, "Saved" after success, "Unsaved changes — retrying" on transient error. |
| **SC-09** | Trip wizard Publish tap (Step 5) opens a `ConfirmDialog` with title "Publish trip?" and description containing destination + dates. Cancel returns to Step 5. Confirm proceeds with existing publish mutation. |
| **SC-10** | `src/components/trip/TripListCard.tsx` is created and used in `hub/trips.tsx`. Outer Pressable has `glass.tint.profileBase` background, `radiusTokens.lg`, 1pt border. Press handler routes via `routeForEventRow`. |
| **SC-11** | Trip list page renders a filter row above the list with pills per **Q1** answer. Filter row uses `flexGrow:0` (per the well-known double-ScrollView footgun). |
| **SC-12** | Trip detail page renders a hero section between header and tabs (or as the topmost section if Q2 flattens tabs) with cover image (height=200, `radius={24}`), gradient overlay, status pill, 24pt title (white + text-shadow), 13pt date+destination subline. |
| **SC-13** | Trip detail page renders an action grid below the hero with `ActionTile` components per **Q3** answer. Includes "View public page" tile (ORCH-0867 fold-in). |
| **SC-14** | Trip detail header right slot renders TWO `IconChrome` buttons (36pt each) — `share` (opens ShareModal with public trip URL) + `moreH` (opens TripManageMenu per Q5). The inline "Edit" Pressable is removed; Edit moves to action grid. |
| **SC-15** | (If Q2 = KEEP TABS): Money tab booking rows are wrapped in `GlassCard variant="base" padding=spacing.md`. Filter chips ("All bookings" / "At risk") use 34pt height pill primitive matching event filter pill shape. Data wiring, expand/collapse, Retry mutation, Refund stub all unchanged. |
| **SC-15-alt** | (If Q2 = FLATTEN): Money content moves to `src/components/trip/MoneyTabContent.tsx` (extracted from MoneyTabBody). Sub-route `app/trip/[id]/money.tsx` mounts the full content. Trip detail page shows Money summary card with "View full money tab" CTA → sub-route. |
| **SC-16** | (If Q2 = FLATTEN): Sub-route `app/trip/[id]/travelers.tsx` exists and renders the full traveler list. Trip detail page shows top-5 traveler summary + "View all travelers" CTA → sub-route. |
| **SC-17** | Public trip page (`app/t/[brandSlug]/[tripSlug].tsx`) shows X-close overlay (top-left, 36×36 IconChrome icon="close") and share overlay (top-right, 36×36 IconChrome icon="share") on the cover hero. Tapping X navigates back. Tapping share opens native share sheet with public trip URL. |
| **SC-18** | Public trip page preserves buyer-anon posture: no `useAuth` import, no sign-in redirect. Preserves full-bleed SafeArea posture: no SafeScreen wrap; existing `orch-strict-grep-allow safearea-on-fullscreen-routes` allowlist still applies. |
| **SC-19** | `WCAG I-38` invariant preserved: all new buttons + IconChromes meet 44pt min touch target (via 36pt button + `hitSlop={8}` pattern, or 44pt actual). All new Pressables in TripListCard, action grid, wizard chrome, public page overlays comply. |
| **SC-20** | `WCAG I-39` invariant preserved: every new Pressable has explicit `accessibilityLabel`. Includes wizard close X, action grid tiles, share/moreH header buttons, TripListCard, public page X-close + share overlays. |
| **SC-21** | (ORCH-0867 fold): Trip detail action grid contains a "View public page" tile that navigates to `/t/{brandSlug}/{tripSlug}`. Operator can tap this tile from the trip operator dashboard and land on the buyer-facing page. WORLD_MAP ORCH-0867 row gets closed simultaneously with ORCH-0874. |

---

## 5. Invariants

### 5.1 Preserved (must not break)
| Invariant | How implementation preserves it |
|---|---|
| `I-PROPOSED-TR1-PERSONA-INTERFACE` | Wizard chrome change doesn't touch `PersonaPickerCards` or its `PersonaDef.id` union. |
| `I-PROPOSED-TR1-KIND-IMMUTABLE` | No change to `brands.kind` handling. |
| `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` | New `TripListCard` press handler MUST use `routeForEventRow(trip)` from `src/utils/routeForEventRow.ts`. Verified by SC-10. |
| `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` | Public trip page MUST NOT add SafeScreen wrap. Existing allowlist comment at `app/trip/[id]/edit.tsx:12` MUST remain valid (TripCreatorWizard still applies paddingTop internally). Verified by SC-18 + CI strict-grep gate. |
| `I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER` | Not directly touched, but trip publish flow (which calls `useLiveEventStore.addLiveEvent`) UNCHANGED. |
| `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (ACTIVE) | Money tab restyle preserves all PaymentPlanEditor + InstallmentScheduleDisplay + biz_retry_installment RPC wiring. No backend touch. |
| `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` (DRAFT) + `I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID` (DRAFT) + `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` (DRAFT) | Not affected — visual-only restyle. |
| `I-38` (44pt touch target on IconChrome) | All new IconChromes use 36pt size + 8pt hitSlop, OR 44pt actual. Verified by SC-19. |
| `I-39` (accessibilityLabel on interactive Pressable) | All new Pressables have explicit accessibilityLabel. Verified by SC-20. |
| Constitution #3 (no silent failures) | New publish ConfirmDialog + discard ConfirmDialog surface errors via existing Toast pattern. |
| Constitution #10 (currency-aware) | No currency formatting changes; existing Intl.NumberFormat usage preserved. |
| Memory `feedback_rn_sub_sheet_must_render_inside_parent.md` | If TripPublishErrorsSheet is added (Q4=yes), it renders inside parent JSX, not as Fragment sibling. |
| Memory `feedback_toast_needs_absolute_wrap.md` | New Toast emissions wrap in `position:absolute` View. |
| Memory `feedback_keyboard_never_blocks_input.md` | Trip wizard Step 1 title field MUST remain visible above keyboard after the KeyboardAvoidingView → explicit listener migration. Verified live-fire by tester. |

### 5.2 NEW invariants established
**None codified as CI strict-grep gates** (per dispatch §7.4 — no new gates from this ORCH).

If post-implementation review surfaces a structural pattern worth codifying (e.g., "all trip-side fullscreen modal wizards must include a close-X affordance"), register as separate follow-up ORCH with its own gate.

---

## 6. Test cases

### 6.1 Implementor happy-path regression test (REQUIRED — Step 0.5 gate)
**File:** `mingla-business/src/components/trip/__tests__/TripCreatorWizardChrome.test.ts` (NEW)

Source-assertion test pattern (mirrors `PaymentPlanEditor.test.ts` shape from ORCH-0873). Pins SC-01 through SC-09 + SC-19/20 with literal source matches:

```typescript
describe("ORCH-0874 TripCreatorWizard chrome", () => {
  const SRC = readFileSync(
    join(__dirname, "..", "TripCreatorWizard.tsx"),
    "utf8"
  );

  it("SC-01: Close X always rendered in chrome row", () => {
    expect(SRC).toMatch(/<IconChrome[^>]*icon="close"[^>]*size=\{?36/);
  });

  it("SC-05: named Stepper replaces anonymous progress segments", () => {
    expect(SRC).toMatch(/<Stepper[^>]*steps=/);
    expect(SRC).not.toMatch(/progressSegment/); // old anonymous segments removed
  });

  it("SC-06: body renders eyebrow + step title + subtitle", () => {
    expect(SRC).toMatch(/STEP_SUBTITLES/);
    expect(SRC).toMatch(/STEP \d* OF 5/i);
  });

  it("SC-02 + SC-03: handleClose branches on isCreateMode + pristine", () => {
    expect(SRC).toMatch(/isCreateMode/);
    expect(SRC).toMatch(/isTripWizardPristine/);
    expect(SRC).toContain('"Discard this trip?"');
  });

  it("SC-09: publish dialog renders confirm with trip-specific copy", () => {
    expect(SRC).toContain('"Publish trip?"');
  });

  it("SC-19: IconChrome close uses 36pt + hitSlop or 44pt actual", () => {
    expect(SRC).toMatch(/<IconChrome[^>]*size=\{?36[^>]*\/?\s*>/);
  });

  it("SC-20: close X has accessibilityLabel", () => {
    expect(SRC).toMatch(/accessibilityLabel=["']Close wizard["']/);
  });
});
```

**Plus additional source-assertion files** for `TripListCard.test.ts`, `TripDetailHeader.test.ts` (pins SC-13 + SC-14 + SC-21 in `app/trip/[id]/index.tsx`), and `PublicTripPageOverlays.test.ts` (pins SC-17 + SC-18 in `app/t/[brandSlug]/[tripSlug].tsx`).

**Fails-on-revert verification:** Implementor MUST verify each assertion fails when the corresponding fix is reverted, then PASS when restored. Cite test paths + passing run + `fails-on-revert verified at <commit hash>` line in the implementation report.

### 6.2 Tester adversarial regression test (REQUIRED — Step 0.5 gate, DIFFERENT angle from implementor)
**File:** `mingla-business/src/components/trip/__tests__/TripWizardChromeAdversarial.test.ts` (NEW)

Adversarial angle = behavior + edge cases the implementor's source-assertion test cannot cover. Examples:

1. **A-01:** Maestro flow that opens `/trip/create`, types into the title field on Step 1, taps the chrome X, asserts the ConfirmDialog appears with "Discard this trip?". Tap Discard. Assert the operator lands on `/(tabs)/hub/trips` AND the just-created draft is NOT in the list.
2. **A-02:** Maestro flow that opens `/trip/{publishedId}/edit`, makes any edit, taps the chrome X. Assert NO dialog appears AND operator lands on `/trip/{publishedId}` immediately.
3. **A-03:** Source-assertion that `app/trip/[id]/edit.tsx` passes `isCreateMode` prop computed from trip state (not hardcoded false).
4. **A-04:** Source-assertion that no new `[styles.a, condition && styles.b]` patterns were introduced (TS-debt regression check — diff against `git stash` of just the closing PR's `.tsx` files; grep for ` && styles.` inside style arrays; alert if count increases).
5. **A-05:** Maestro flow that opens `/trip/{id}` operator dashboard, taps the "View public page" action tile, asserts navigation to `/t/{brandSlug}/{tripSlug}` AND that the X-close + share overlays render on the public page.
6. **A-06:** Public trip page route file scan — assert NO `useAuth` import, NO sign-in redirect logic (regression check on buyer-anon posture).
7. **A-07:** Source-assertion that `routeForEventRow` is imported and called from `TripListCard.tsx` (regression check on `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE`).

### 6.3 Full test matrix

| Test | Scenario | Layer | Verification |
|---|---|---|---|
| T-01 | `/trip/create` → type title → tap X → confirm dialog → Discard | Wizard chrome | A-01 Maestro |
| T-02 | `/trip/{id}/edit` published trip → edit → tap X → silent exit | Wizard chrome | A-02 Maestro |
| T-03 | Wizard chrome shows named Stepper not anon segments | Wizard chrome | SC-05 source |
| T-04 | Body shows eyebrow + step title + subtitle | Wizard chrome | SC-06 source |
| T-05 | Publish tap (Step 5) opens ConfirmDialog | Wizard chrome | SC-09 source + Maestro |
| T-06 | Autosave state text updates in subtitle row | Wizard chrome | Maestro + Metro log check |
| T-07 | Step 2-4 dock shows Back + Continue side-by-side | Wizard chrome | SC-07 source |
| T-08 | Dock hides when keyboard visible | Wizard chrome | Maestro |
| T-09 | Trip list shows filter pills (per Q1) | List page | Source + Maestro |
| T-10 | Trip list card press uses routeForEventRow | List page | A-07 source |
| T-11 | Trip list card visual matches EventListCard shape | List page | Source + screenshot diff |
| T-12 | Trip detail shows hero | Detail page | Source + Maestro screenshot |
| T-13 | Trip detail action grid contains "View public page" tile | Detail page | SC-13 source |
| T-14 | "View public page" tile navigates correctly | Detail page | A-05 Maestro |
| T-15 | Trip detail header right slot has share + moreH | Detail page | SC-14 source |
| T-16 | Money tab booking rows wrap in GlassCard variant="base" | Detail page | SC-15 source |
| T-17 | Money tab filter chips match event filter pill style | Detail page | Source + visual diff |
| T-18 | Money tab Retry button + Refund stub UNCHANGED in behavior | Detail page | Regression: existing ORCH-0873 Maestro flow passes |
| T-19 | Public trip page hero shows X-close + share overlays | Public page | SC-17 Maestro |
| T-20 | Public trip page X-close navigates back | Public page | Maestro |
| T-21 | Public trip page share opens native share sheet | Public page | Maestro (iOS) |
| T-22 | Public trip page has no useAuth, no sign-in redirect | Public page | A-06 source |
| T-23 | Wizard Step 1 title field remains visible above keyboard | Wizard chrome | Live-fire iOS sim Maestro |
| T-24 | I-38 / I-39 invariants preserved on all new Pressables | All | Source scan + axe-RN if available |
| T-25 | ORCH-0867 fold complete: WORLD_MAP shows ORCH-0867 closed simultaneously | Process | Manual artifact check at close |
| T-26 | No new `[styles.a, cond && styles.b]` patterns introduced | All | A-04 diff scan |

---

## 7. Implementation order

The implementor should follow this order to minimize merge surface and keep each commit reviewable:

1. **NEW component: `TripListCard.tsx`** + test → ship in isolation (no consumer yet).
2. **MODIFY `hub/trips.tsx`** to consume `TripListCard` + add filter row. Visual smoke.
3. **NEW component: `TripManageMenu.tsx`** (if Q5=yes) + test.
4. **MODIFY `app/trip/[id]/index.tsx`** — add hero + action grid + header right slot + (if Q5=yes) TripManageMenu mount + Money tab tile restyle + ORCH-0867 fold (View-public-page tile in grid).
5. **NEW hook + service: `useDiscardTrip` + `tripsService.discardTrip`** (if not already present).
6. **MODIFY `app/trip/[id]/edit.tsx`** — derive + pass `isCreateMode` + wire `onDiscardTrip`.
7. **MODIFY `TripCreatorWizard.tsx`** — chrome rewrite (close X + Stepper + handleClose + dialogs + body title + dock + subtitle row + keyboard listener migration).
8. **NEW component: `TripPublishErrorsSheet.tsx`** (if Q4=yes) + wire into wizard.
9. **MODIFY `app/t/[brandSlug]/[tripSlug].tsx` + `TripPreview.tsx`** — add X-close + share overlays.
10. **Write all implementor regression tests** + run all (Jest + any Deno tests if backend hooks change). Verify fails-on-revert per Step 0.5 gate.
11. **Live-fire sim verification** of T-23 (Step 1 keyboard preservation) + T-12 (hero render) + T-19 (public page overlays). Capture screenshots for the implementation report.
12. **Write implementation report** with old→new receipts for every file changed.

---

## 8. Regression prevention

For each finding addressed:
- Source-assertion tests pin the structural shape (close X presence, Stepper presence, ConfirmDialog presence, action grid presence, View-public-page tile presence).
- Maestro flows pin the user-visible behavior (dialog appearance on create-mode dirty close, silent exit on edit-mode close, action grid tile navigation).
- No new CI strict-grep gates from this ORCH (per dispatch §7.4). If patterns emerge during review worth codifying, register follow-up ORCHs.
- TS-debt regression check via A-04 (count `&& styles.` inside style arrays in the closing diff; fail if increased).
- Live-fire sim verification of keyboard behavior + hero render + public page overlays.

---

## 9. Cross-platform smoke matrix

Per `feedback_tester_canonical_and_platform_parity.md`, tester must verify on:

| Platform | Required smoke flows |
|---|---|
| iOS Simulator (business) | T-01, T-02, T-03, T-12, T-14, T-19, T-23 (keyboard) — capture screenshots for report |
| Android Emulator (business) | T-01, T-02, T-12, T-14, T-19 — capture screenshots for report |
| Web Browser (mingla-business web preview) | T-09, T-11, T-12, T-14, T-19, T-20 — capture screenshots for report; web is buyer-anon-web's actual delivery surface for /t routes |

If any platform is blocked (sim won't boot, dev build missing), tester MUST ask operator with specific actionable unblock request per tester skill rules — NOT silently CONDITIONAL PASS.

---

## 10. Implementation receipts template

For each file changed, implementor report must include:

```
### [filename.tsx]
**What it did before:** [exact prior behavior]
**What it does now:** [exact new behavior]
**Why:** [which SC-N + finding R-N/C-N/H-N this addresses]
**Lines changed:** [count]
```

Cite Maestro flow output + sim screenshots in the implementation report. Cite source-assertion test passing run + `fails-on-revert verified at <commit hash>` for each new test.

---

## 11. Open questions (operator must answer BEFORE implementor starts)

**RESOLVED 2026-05-18 by operator "all defaults":**
- **Q1 → A.** Filter pills: All / Upcoming / Past / Drafts (4 pills, no Live).
- **Q2 → A.** Trip detail KEEPS tabs (Overview / Travelers / Money). Hero + action grid land ABOVE the tabs.
- **Q3 → default 4-tile grid.** Tiles: View public page (default), Brand page (default), Marketing blasts (default — `/event/{id}/blasts` is event-id agnostic), Edit trip (primary, accent.tint bg, replaces inline header Edit pill). Money tile NOT in grid (Money is a tab). Scan tile NOT applicable. Cancel-trip is a BOTTOM ghost button below the tabs (mirror event pattern at `event/[id]/index.tsx:770–784`), NOT in the grid.
- **Q4 → A.** Keep current Step 5 banner pattern for publish errors. No new `TripPublishErrorsSheet` component.
- **Q5 → A.** Yes — new `TripManageMenu` sheet opens from header `moreH` button. Items: View public page / Share trip link / Edit trip / Cancel trip (destructive).
- **Q6 → FOLD.** ORCH-0867 [Trip dashboard "View public page" button] folds into ORCH-0874. The View-public-page tile in the action grid (Q3 tile 1) AND the View-public-page item in TripManageMenu (Q5 item 1) both satisfy ORCH-0867's slot. ORCH-0867 closes simultaneously with ORCH-0874.
- **Q7 → Codex `implementor-mingla`** (default per Canonical Pipeline Routing for UI-touching scope; operator may redirect at dispatch time).

**ORCH-0873 [Tr3 Stage 2 UI] tester sequencing** (separate question outside Q1–Q7): operator confirmed "all defaults" → run Claude `mingla-forensics` TEST mode on ORCH-0873 FIRST to lock the Money tab + PaymentPlanEditor + InstallmentScheduleDisplay baseline before ORCH-0874 layers a visual restyle on top.

All §3 component-layer specifications + §4 success criteria proceed with these locked answers. The "(if Q2 = FLATTEN)" branch in §3.3.4 + SC-15-alt / SC-16 are NOW MOOT and the implementor should ignore them.

---

**Original options (for reference only — superseded by RESOLVED block above):**


### Q1 — Trip list filter pills
Which filter set on the trip list?

| Option | Filters | Tradeoff |
|---|---|---|
| **A (Recommended)** | All / Upcoming / Past / Drafts | Mirrors event filter shape, drops "Live" since trips have no live-now lifecycle (a trip is either upcoming, in-progress between start+end, or ended). Simpler. |
| B | All / Upcoming / In-progress / Ended / Drafts | More granular; surfaces in-progress trips explicitly. Adds 5th pill that may rarely be useful. |
| C | No filters | Match current state. Operator browses by chronology. Lowest churn, but breaks visual parity (events has 5 filters). |

### Q2 — Trip detail topology
Keep tabs (Overview / Travelers / Money) or flatten to single-scroll like events?

| Option | Topology | Tradeoff |
|---|---|---|
| **A (Recommended)** | KEEP TABS | Smallest diff. Money tab from ORCH-0873 stays as-is functionally; only its inner tiles restyle to GlassCard. Operator already has tabs as mental model. Hero + action grid live ABOVE the tabs. |
| B | FLATTEN single-scroll | Stronger event parity. Money + Travelers become sub-routes. Larger diff (2 new sub-route files + MoneyTabBody extraction). Operator navigation pattern changes. |

### Q3 — Trip detail action grid tiles
Which tiles in the action grid?

Default set (assumes Q3=default): View public page (primary tile, top-left), Brand page, Edit trip, Marketing blasts. Confirm or adjust:

| Tile | Include? |
|---|---|
| View public page (primary, icon="eye") | Yes (default — ORCH-0867 fold) |
| Brand page (icon="user") | Yes (default — mirror event grid) |
| Edit trip (icon="edit") | Yes (default — replaces inline Edit pill) |
| Marketing blasts (icon="send") | Operator decides — does trip-side support marketing blasts? Event grid has this. |
| Cancel trip (icon="x" or destructive) | Operator decides — events have this as bottom CTA, not grid. Mirror that pattern? |
| Money (icon="pound", if Q2=FLATTEN) | Only if Q2=B; otherwise Money is a tab. |
| Travelers (icon="users", if Q2=FLATTEN) | Only if Q2=B. |

### Q4 — Trip wizard publish errors UX
On publish-time validation error, sheet or banner?

| Option | UX | Tradeoff |
|---|---|---|
| **A (Recommended)** | KEEP CURRENT BANNER | Trip wizard has 5 steps and small validation surface — banner on Step 5 with reason is sufficient. Lower scope. |
| B | NEW SHEET (mirror PublishErrorsSheet) | Stronger event parity. Fix-jump-to-step buttons. Larger scope (~100 LOC new sheet). |

### Q5 — Trip manage menu
Right-slot moreH button opens a manage menu, or skip the menu entirely?

| Option | UX | Tradeoff |
|---|---|---|
| **A (Recommended)** | YES, NEW TripManageMenu | Mirror event detail right slot exactly (share + moreH). Menu contains: View public page / Share / Edit trip / Cancel trip. Adds ~100 LOC. |
| B | NO menu — right slot is share only | Simpler. Lose the consolidated actions surface. Cancel-trip needs another home (bottom CTA per event pattern). |
| C | NO menu — right slot empty | Most minimal. Public page + share + cancel only reachable via action grid tiles. |

### Q6 — ORCH-0867 fold
Recommended: FOLD. Explicit operator confirmation requested:

| Option | Action | Tradeoff |
|---|---|---|
| **A (Recommended)** | FOLD ORCH-0867 into ORCH-0874 | One implementor pass, one tester pass, one PR. ORCH-0867 closes simultaneously. |
| B | KEEP SEPARATE | ORCH-0874 declares the action-grid tile slot; ORCH-0867 implementor passes ships the body separately. Two PRs touching same file. |

### Q7 — Implementor side
Codex `implementor-mingla` (default per routing) or Claude `mingla-implementor`?

Operator's standing rule (`feedback_implementor_uses_ui_ux_pro_max.md`): UI-touching dispatch invokes `/ui-ux-pro-max` as pre-flight design step. Either implementor side can drive this.

---

## 12. Layman summary

This spec turns the four trip surfaces into the same visual product family as events.

**The biggest single fix:** the trip wizard gets a Close X button (today operators can only walk back step-by-step) — and the close button behaves exactly like the event wizard: in create-mode with unsaved changes it asks "Discard this trip?" before exiting; in edit-mode it exits silently because changes already auto-save.

**The trip list** gets the same content-card primitive events use (with cover image, status pill, capacity bar, manage icon) instead of today's flat tap-row, plus filter pills above so operators can scope to Upcoming / Past / Drafts.

**The trip detail page** gets a hero (cover + title + dates overlay) and an action-tile grid (View public page, Edit, Brand page, Marketing blasts) above the existing Overview / Travelers / Money tabs. The Money tab from ORCH-0873 stays — its inner booking rows just restyle to use the same glass cards events use. Header right-slot gets share + manage menu buttons mirroring event detail.

**The public trip page** gets the X-close + share button overlays on the cover hero that the public event page already has.

**ORCH-0867** (the missing "View public page" button on the trip dashboard) folds into this ORCH because the same diff touches the same file.

**No changes to data, queries, RLS, RPCs, or business logic.** Pure visual + chrome work.

7 open questions for operator to answer before implementor starts (filters set, tabs vs flatten, action grid contents, publish errors UX, manage menu yes/no, ORCH-0867 fold confirm, implementor side). Recommended answers all noted.

20+ success criteria + 26 test cases mapping each criterion to a verification step. Implementor must ship source-assertion test + fails-on-revert verification per Step 0.5 gate; tester must write adversarial test on different angle (behavior + live-fire sim verification).
