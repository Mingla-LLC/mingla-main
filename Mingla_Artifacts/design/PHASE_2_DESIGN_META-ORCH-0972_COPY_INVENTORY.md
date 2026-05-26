# PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY

**ORCH:** META-ORCH-0972 — Phase 2 design deliverable
**Date:** 2026-05-25
**Companion to:** [PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md](./PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md)

Every CTA / label / empty state / error / toast / tooltip touched by META-ORCH-0972 with location + before-and-after copy. Use as Phase 4 implementor input for string changes. Empty "before" cells = newly-introduced copy.

---

## Brand creation flow (BrandCreationFlow)

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| `BrandSwitcherSheet.tsx:376` | Persona-mode header | "Choose a brand type" / "What kind of brand?" | "Create brand" |
| BrandCreationFlow Step 1 | Sheet title | (n/a — persona-fork shown) | "Create brand" |
| BrandCreationFlow Step 1 | Name label | (TripBrandWizard "Brand name") | "Brand name" |
| BrandCreationFlow Step 1 | Name placeholder | "e.g. Wandering Soul Retreats" | "e.g. Wandering Soul Retreats" |
| BrandCreationFlow Step 1 | Bio label | (TripBrandWizard "Short bio") | "Short bio (optional)" |
| BrandCreationFlow Step 1 | Bio placeholder | "Small group retreats in Mexico and Costa Rica" | "Tell people what you're about — 200 characters." |
| BrandCreationFlow Step 1 | CTA | "Continue" | "Continue" |
| BrandCreationFlow Step 2 | Title | (didn't exist for popup brands) | "Add an address?" |
| BrandCreationFlow Step 2 | Subtitle | n/a | "We'll use this to pre-fill venues for any experiences you publish. You can add this later." |
| BrandCreationFlow Step 2 | Address placeholder | n/a | "e.g. 12 Soho Square, London" |
| BrandCreationFlow Step 2 | Skip button | n/a | "Skip for now" |
| BrandCreationFlow Step 2 | Continue button | n/a | "Continue" |
| BrandCreationFlow Step 3 | Title | (existing cover picker has its own title) | "Add a cover (optional)" |
| BrandCreationFlow Step 3 | Skip button | (existing) | "Skip" |
| BrandCreationFlow Step 3 | Done button | (existing) | "Done" |
| BrandCreationFlow Step 4 | Headline | n/a | "What do you want to make first?" |
| BrandCreationFlow Step 4 | Subhead | n/a | "Mix and match anytime." |
| BrandCreationFlow Step 4 | Event button label | n/a | "Event" |
| BrandCreationFlow Step 4 | Event button subhead | n/a | "One night, one place." |
| BrandCreationFlow Step 4 | Trip button label | n/a | "Trip" |
| BrandCreationFlow Step 4 | Trip button subhead | n/a | "Multi-day getaway." |
| BrandCreationFlow Step 4 | Experience button label | n/a | "Experience" |
| BrandCreationFlow Step 4 | Experience button subhead | n/a | "Recurring or evergreen." |
| BrandCreationFlow create error toast | Error toast | (TripBrandWizard generic error) | "Couldn't create brand. Tap to retry." |
| Slug-collision toast | Error toast | (existing SlugCollisionError) | UNCHANGED |

---

## Brand edit (BrandEditView)

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| BrandEditView SECTION B-2 | Kind picker section header | "Brand kind" + "Physical space" / "Pop-up" pills + hint copy | DELETE entire section |
| BrandEditView address input | Label | (visible only when kind=physical) "Address" | (always visible) "Address (optional)" |
| BrandEditView address input | Helper text | "Required for physical brands so they appear on the map." | "Optional. We'll use this to pre-fill venues for any experiences you publish, and to show your address on your public page." |
| BrandEditView "Claim a venue" affordance (NEW) | Title | n/a | "Claim a venue on Mingla" |
| BrandEditView "Claim a venue" affordance | Body | n/a | "Got a physical space? Claim it for the Verified badge and better local discovery." |
| BrandEditView "Claim a venue" affordance | CTA | n/a | "Find my venue" |

---

## Home dashboard (homeNextAction rungs)

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| homeNextAction rung 1 | Title | "Finish setting up Stripe" | "Connect Stripe to take payments" |
| homeNextAction rung 1 | Body | "Mingla needs Stripe Connect to collect money. Finish setup to start selling." | "You have a paid offering ready to publish. Connect Stripe to start selling." |
| homeNextAction rung 1 | CTA | "Continue Stripe setup" | "Connect Stripe" |
| homeNextAction rung 1 trigger | (gates when fires) | Always when `stripeStatus !== 'active'` | Only when brand has drafted paid offering AND Stripe not active |
| homeNextAction rung 2 (trip-planner branch) | Title | "Plan a trip" | DELETED (replaced by OfferingChooser) |
| homeNextAction rung 2 (trip-planner branch) | Body | "You're set up. Create your first trip to start selling." | DELETED |
| homeNextAction rung 2 (trip-planner branch) | CTA | "Plan a trip" | DELETED |
| homeNextAction rung 2 (event-brand branch) | Title | "Create your first event" | DELETED |
| homeNextAction rung 2 (event-brand branch) | Body | "Your brand is ready. Create your first event to start selling tickets." | DELETED |
| homeNextAction rung 2 (event-brand branch) | CTA | "Create event" | DELETED |
| homeNextAction rung 2 (new) | Render | n/a | `<OfferingChooser headline="What do you want to make first?" subhead="Mix and match anytime." />` |
| homeNextAction rung 3 | Title | "Finish your draft" | UNCHANGED |
| homeNextAction rung 3 | Body | "You have a draft waiting. Finish it and publish to start selling." | UNCHANGED |
| homeNextAction rung 3 | CTA | "Open draft" | UNCHANGED |
| homeNextAction rung 4 | Title | "Add your venue address" | DELETED |
| homeNextAction rung 4 | Body | "Add your address so people can find you and Mingla can recommend you locally." | DELETED |
| homeNextAction rung 4 | CTA | "Edit brand" | DELETED |

---

## Hub tabs

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| Hub tab bar | Events tab label | "Events" | "Events" (count badge added) |
| Hub tab bar | Trips tab label | "Trips" | "Trips" (count badge added) |
| Hub tab bar | Experiences tab label | "Experiences" | "Experiences" (count badge added) |
| Hub tab bar | Get-started tab label (NEW) | n/a | "Get started" |
| hub/trips.tsx:161 | Empty state when kind!=trip_planner | "Trips are for trip-planner brands. Switch to a trip-planner brand to see trips." | DELETED (tab hidden instead) |
| hub/trips.tsx | Empty state when no upcoming trips (tab visible, filter=upcoming) | (existing copy) | "No upcoming trips yet" + "Plan a trip" CTA |
| hub/experiences.tsx:292 | Pending-verification hint | "Your venue is being verified. You can create experiences after Mingla verifies it." | DELETED |
| hub/experiences.tsx:345 | Non-physical dead-end | "Experiences are for verified physical venues." | DELETED (tab hidden when no experiences) |
| Hub Get-started tab body | Headline (NEW) | n/a | "Get started — pick what to create" |
| Hub Get-started tab body | OfferingChooser | n/a | `<OfferingChooser headline="Get started — pick what to create" />` |
| Hub Events tab empty (no upcoming) | (existing) | "No upcoming events." | UNCHANGED |
| Hub Experiences tab empty (no experiences but tab visible) | n/a | "No experiences yet" + "Create experience" CTA |

---

## Experience creation flow (NEW — ExperienceCreatorWizard)

| Location | Element | Copy |
|---|---|---|
| Sheet title | (NEW) | "Create experience" |
| Step 1 | Title label | "Experience title" |
| Step 1 | Title placeholder | "e.g. Friday Night Jazz Tasting" |
| Step 1 | Description label | "What's it about?" |
| Step 1 | Description placeholder | "10–500 characters." |
| Step 1 | Or-divider | "or" |
| Step 1 | Menu shortcut card title | "Upload a menu" |
| Step 1 | Menu shortcut card body | "We'll suggest experiences from your dishes." |
| Step 1 | Activities shortcut card title | "Paste your activities" |
| Step 1 | Activities shortcut card body | "We'll suggest experiences from your offerings." |
| Step 2 | Title | "Where does it happen?" |
| Step 2 | Venue label | "Venue or address" |
| Step 2 | Venue placeholder (no brand address) | "e.g. 12 Soho Square, London" |
| Step 2 | Venue helper text (pre-filled) | "Pre-filled from your brand address. Edit if this experience is somewhere else." |
| Step 2 | Save-as-brand checkbox label | "Also save this as my brand's address" |
| Step 3 | Title | "When is the next one?" |
| Step 3 | Subtitle | "Buyers see this as 'Next: <date>' on your experience card." |
| Step 3 | Recurrence label | "Recurrence" |
| Step 3 | Recurrence options (v1 per Q12) | "One-time only" (only option in v1 per designer Q12 recommendation) |
| Step 4 | (existing pricing flow) | UNCHANGED |
| Step 5 | (existing cover picker) | UNCHANGED |
| Publish CTA | (existing) | "Publish" |
| Save draft CTA | (existing) | "Save as draft" |

---

## Venue claim flow (reframed copy)

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| BrandEditView "Claim a venue" affordance | (see Brand edit section above) | n/a | "Claim a venue on Mingla" |
| VenueClaimStatusBanner kind=physical+pending | Banner copy | "Your venue is being verified to start selling. Usually within 4 business hours." | "Your venue claim is being reviewed. Usually within 4 business hours." |
| VenueClaimStatusBanner kind=physical+verified | Banner copy | (no banner shown today after verified) | "Verified location ✓ — your brand has the Verified badge on your public page." |
| VenueClaimStatusBanner kind=physical+rejected | Banner copy | "Your venue verification was rejected. Tap to see why." | "Your venue claim was declined. Tap to see why or try a different venue." |
| Venue search flow opening copy | Page heading | "Verify your venue to start selling on Mingla" | "Claim your venue on Mingla" |
| Venue search flow sub-copy | Sub-heading | "Tell us which place you operate so buyers can find you." | "Claim your venue for the Verified badge and better local discovery." |
| Verified location pill (PublicBrandPage, NEW) | Label | n/a | "Verified location" (with `shield-check` icon) |

---

## Public brand page (`/b/{brandSlug}`)

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| Tab bar | Upcoming label | "Upcoming" (event brands) / "Trips" (trip_planner) | "Upcoming" (always when any offering exists) |
| Tab bar | Events label | (not a separate tab today) | "Events" (data-driven; shown when events.length > 0) |
| Tab bar | Trips label | "Trips" (trip_planner only) / "Past Trips" | "Trips" (data-driven; shown when trips.length > 0); past trips folded into Trips tab below the upcoming section |
| Tab bar | Experiences label | (no experiences tab today) | "Experiences" (data-driven; shown when experiences.length > 0) |
| Tab bar | About label | "About" | "About" UNCHANGED |
| Upcoming tab empty state (zero offerings) | Copy | (no tabs rendered today for zero-offering brands) | (no Upcoming tab rendered; identity card + empty state) |
| Brand-has-zero-offerings empty state | Copy | (n/a — page doesn't render empty state for this case today) | "More coming soon from this brand." |
| `<ExperienceMiniCard>` (NEW) type-pill | Pill text | n/a | "Experience" |
| `<ExperienceMiniCard>` subline pattern | (NEW) | n/a | "{venue} · Next: {next-occurrence-formatted}" (e.g., "Soho Lounge · Next: Sat 7pm") |
| `<ExperienceMiniCard>` "from" price | (NEW) | n/a | "From {currencySymbol}{price}" (or "Free" pill if all tiers free) |
| `<EventMiniCard>` type-pill in Upcoming tab (NEW context) | Pill text | (no pill today; events tab is implied context) | "Event" |
| `<TripMiniCard>` type-pill in Upcoming tab (NEW context) | Pill text | (no pill today) | "Trip" |
| `<NextEventTeaser>` (ORCH-0963 primitive) | (existing) | "NEXT · {date} · {name} · From {price} →" | UNCHANGED (preserved as Events-tab primitive) |
| Past Events section header | Header | "Past" | UNCHANGED |
| Past Trips section header | Header | "Past Trips" | UNCHANGED |

---

## Admin Venue Claims dashboard

| Location | Element | Before (current) | After (META-ORCH-0972) |
|---|---|---|---|
| Page title | Header | "Venue Claims" or similar | "Venue Claims" |
| Pending tab label | Tab | (single list today) | "Pending review" |
| Verified tab label | Tab (NEW) | n/a | "Verified" |
| Rejected tab label | Tab (NEW) | n/a | "Rejected" |
| Pending empty | Body | (existing) | "No claims waiting for review. Nice work." |
| Verified empty | Body (NEW) | n/a | "No verified venues yet." |
| Rejected empty | Body (NEW) | n/a | "No rejected claims." |
| Row action | Approve | "Approve" | UNCHANGED |
| Row action | Reject | "Reject" | UNCHANGED |
| Reject reason prompt | Modal title | "Reject reason" | "Why is this claim being declined?" |

---

## Comments / doc-only copy (UPDATE-COPY classification)

| File | Line | Before | After |
|---|---|---|---|
| `mingla-business/src/types/brand.ts` | 200–210 | Comment block describing kind union as immutable for trip_planner, address meaningful only for physical | UPDATE to reflect kind deletion + universal address (or DELETE comment with the union) |
| `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` | 79–80 | "/trip/create gates on currentBrand.kind === 'trip_planner' — non-trip-planner brands see an explainer" | "Routes universally to /trip/create — any brand can author trips post-META-ORCH-0972" (or delete comment) |
| `mingla-business/app/trip/create.tsx` | 9 | "Gated on current brand kind='trip_planner' per I-PROPOSED-TR1-KIND-IMMUTABLE" | "Universal trip-create route per I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972)" |

---

## Strings NOT changed

For completeness, copy that stays identical:

- Stripe Connect onboarding flow copy (per ORCH-0954 + Q1 — Stripe is the money gate, not authoring; existing copy unaffected)
- Event creation flow copy (event creation already universal; no copy changes)
- Trip creation flow copy beyond removing the `/trip/create` gate (the wizard's own copy is unchanged)
- Cover picker copy (BrandCoverPickerSheet)
- All admin-dashboard copy outside Venue Claims (Brands list, brand-detail view, etc.)
- All consumer-app (`app-mobile/`) copy (consumer app brand-kind-agnostic)
- Marketing hub copy (audit-adjacent; expected to be NO-CHANGE per audit)

End of copy inventory.
