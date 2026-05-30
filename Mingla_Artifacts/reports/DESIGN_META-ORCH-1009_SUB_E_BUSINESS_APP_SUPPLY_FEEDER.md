# DESIGN: META-ORCH-1009 Sub-E - Business-App Supply-Side Onboarding Feeder

Status: READY FOR ORCHESTRATOR REVIEW  
Mode: UI/UX design direction  
Date: 2026-05-30  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`  
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`  
Depends on: approved SPEC `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

## 1. Design Verdict

Build Sub-E as an operational onboarding cockpit, not as a marketing wizard.

Sarah's first-session experience must answer four questions at all times:

1. What does Mingla know about my venue?
2. What can I safely skip for now?
3. What is AI doing in the background?
4. What exactly blocks me from the consumer deck?

The current business app already has the right visual vocabulary: dark canvas, functional glass, warm orange CTAs, compact typography, and docked actions. Sub-E should extend those surfaces with clearer state machines rather than adding a new decorative onboarding style.

## 2. Evidence Used

Read and applied:

- `COMMS_LEDGER.md`: COMMS-0002, COMMS-0003, COMMS-0004, COMMS-0011, COMMS-0012, COMMS-0013, COMMS-0015, COMMS-0016.
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`.
- `Mingla_Artifacts/reports/REVIEW_SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`.
- `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md`.
- `mingla-business/src/constants/designSystem.ts`.
- `mingla-business/src/components/brand/BrandCreationFlow.tsx`.
- `mingla-business/app/venue/create.tsx`.
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`.
- `mingla-business/src/components/venue/VenueStep3Photos.tsx`.
- `mingla-business/src/components/venue/VenueStep7Review.tsx`.
- `mingla-business/src/components/brand/PoolMatchCard.tsx`.
- `mingla-business/src/components/brand/VenueCategoryPicker.tsx`.
- `mingla-business/src/components/ui/CoverPickerSheet.tsx`.
- `mingla-business/src/components/ui/Button.tsx`.
- `mingla-business/src/components/ui/GlassCard.tsx`.
- `mingla-business/app/(tabs)/hub/experiences.tsx`.
- `mingla-business/src/components/experience/ExperienceReviewCards.tsx`.
- `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`.

UI/UX Pro Max search takeaways:

- Progressive disclosure is the right structure for a 9-minute Tier 1 + Tier 2 flow.
- Empty states must name the next useful action.
- Errors must be announced as errors, not only rendered in red.
- React Native form inputs should stay controlled.
- Complex movement should use existing Reanimated/gesture patterns and respect reduced motion.

Mingla adaptation:

- Keep warm orange as the primary action accent.
- Keep business app surfaces dense, premium, and scan-first.
- Use glass as functional grouping, not decoration.
- Do not add purple AI gradients, emojis, fake stats, nested cards, or a landing page.

## 3. Current UX Gaps To Fix

| Gap | Current behavior | Required Sub-E behavior |
|---|---|---|
| Match selection | `usePoolMatchSearch` exposes one `match`; `PoolMatchCard` asks "Is this you?" | Show every match for the active query, with selected state, manual create, loading, no-match, and retry states. |
| Create-new path | "Continue without a match" exists, but the flow still assumes Google fields later | Create-new must feel first-class and never blocked by missing Google ID. |
| Photo/media | `VenueStep3Photos` uses ImagePicker and upload flow directly | Venue hero media routes through shared ORCH-0989 `CoverPickerSheet`/`CoverPicker`; gallery photos can stay as separate venue photos. |
| Review copy | "Submit for review" and "usually within 4 business hours" imply old claim moderation | New copy separates public profile creation from deck readiness. |
| Parser funnel | Pending generated experiences can expire and fail with 410 only after tap | Expired proposals must look expired before Sarah acts, with a refresh path. |
| Category gates | Hub parser copy and logic are restaurant/play oriented | Copy should allow any venue to parse a menu, service list, package sheet, flyer, or activities list. |
| AI opacity | No visible 8-stage pipeline state | Hub needs readable stage progress, partial success, retry, and "needs fix" states. |
| Deck coaching | No persistent "Why you're not in the deck yet" answer | Hub needs a mandatory coaching card that maps bouncer reasons to specific fixes. |

## 4. Screen Flow Map

### 4.1 Entry From Brand Creation

`BrandCreationFlow` remains the universal start. When Sarah chooses a physical/local venue path, route into the venue authoring flow with her existing brand draft already carried forward.

First screen must be usable onboarding, not a pitch screen.

Recommended entry copy:

- Title: `Add your venue`
- Helper: `Mingla will help turn your place into a deck-ready recommendation. You can create a new listing or claim one we already know.`
- Primary action: `Start`
- Secondary action when coming from an existing brand: `Use existing brand details`

### 4.2 Tier 1 Flow: Publishable Venue Profile

Goal: Sarah can create or claim the canonical venue in about 4 minutes.

Recommended Tier 1 sequence:

| Step | Screen | Required input | Skippable? | Result |
|---|---|---:|---:|---|
| 0 | Match search | Venue name or brand draft name | No | Search starts. |
| 1 | Match decision | Existing match selection OR create-new | No | Claim path or create-new path chosen. |
| 2 | Basics | Venue category, display name, slug | No | Brand and place identity are stable. |
| 3 | Address | Address, city, map pin when available | No for deck path; allow draft save if missing | Place can be located. |
| 4 | Hero media | Cover image or video via `CoverPickerSheet` | No for deck path; allow draft save if missing | Card can render. |
| 5 | Hours/contact | Opening hours, email or phone | Hours required for deck path | Operational trust. |
| 6 | Review | Create/link place | No | `upsert_tier1_place` can run. |

Do not show all seven current wizard steps as seven equal chores. Keep the existing `VenueCreatorWizard` internals, but present progress as compact milestones:

1. `Match`
2. `Basics`
3. `Location`
4. `Media`
5. `Details`
6. `Review`

The old "Story" step moves into Tier 2 because Sub-E's locked decision says Stage 4 generates the sales bio from inputs.

### 4.3 Tier 1 Completion State

After Tier 1 succeeds, show a completion screen that immediately pivots to deck readiness.

Recommended copy:

- Title: `Your venue profile is created`
- Body: `Finish deck readiness so Mingla can understand when to recommend it.`
- Primary CTA: `Continue deck setup`
- Secondary CTA: `Go to Hub`

Avoid "pending review" as the primary message. Claim moderation may still exist behind the scenes, but Sarah's next action is not waiting 4 business hours; it is completing the inputs that drive deck eligibility.

### 4.4 Tier 2 Flow: Deck-Ready Intelligence

Goal: Sarah can provide the extra evidence needed for Q2 scores in another 3-5 minutes.

Use a task rail rather than a long linear wizard. The rail lives immediately after Tier 1 and later as the same Hub card.

Tier 2 tasks:

| Task | Primary control | AI behavior | Completion copy |
|---|---|---|---|
| Add more venue photos | Photo gallery picker plus CoverPicker for hero | Stage 3 analyzes aesthetics, dedupe, and facets | `Photos ready` |
| Upload menu/activity/service sheet | File/image uploader | Stages 1-2 parse menu/activity/package evidence | `Items found` |
| Answer vibe quiz | Multi-select chips and one slider | Stages 5-6 seed facet + signal inference | `Vibe captured` |
| Confirm facets | Grouped toggles | AI proposes values from photos/menu/vibe | `Details confirmed` |
| Confirm AI sales bio | Generated bio card | Stage 4 drafts copy, Sarah approves/edits | `Story approved` |
| Check deck readiness | Status card | Stage 8 bouncer pass returns reasons/fixes | `Ready` or `Needs fixes` |

Tier 2 should not block profile creation. It should block deck eligibility.

### 4.5 Return Path From Hub

Every incomplete Tier 2 task must deep-link back from Hub:

- `Add photos`
- `Upload menu or list`
- `Answer vibe questions`
- `Confirm details`
- `Review your story`
- `Refresh deck check`

The same card hierarchy should be used immediately after Tier 1 and later in Hub so Sarah does not learn two different mental models.

## 5. Match Selection Design

### 5.1 Component Contract

Replace the current single `PoolMatchCard` decision with `PoolMatchSelectionList`.

The component renders:

- Search input with current query.
- Inline loading row.
- All fetched results for the active query.
- Selected result state.
- Persistent create-new action.
- Error/retry state.

Each result row should include:

- Thumbnail if available.
- Venue name, max 2 lines.
- Address/city, max 2 lines.
- Small metadata line: category/type when known.
- Selection affordance using an icon/radio state.
- Optional "Already claimed" or "Needs verification" badge only when backed by real data.

Use one glass surface for the list and rows separated by hairlines. Do not put a `GlassCard` inside every result row.

### 5.2 Interaction States

| State | UX |
|---|---|
| Query shorter than minimum | Helper: `Type your venue name to search Mingla's directory.` CTA disabled. |
| Loading | Stable skeleton rows or spinner row: `Searching matches...` Keep manual create visible but secondary. |
| Results | Header: `Select a match, or create a new listing.` Show all results fetched for query. |
| Long results | Virtualized list; sticky bottom dock with `Use selected` and `Create new`. |
| Selected match | Row border/accent, selected icon, bottom CTA enabled: `Use selected venue`. |
| No matches | Empty state: `No match found. You can create a new listing now.` Primary CTA `Create new listing`. |
| Search error | Alert copy: `Could not search right now. You can retry or create a new listing.` CTAs `Retry` + `Create new listing`. |
| Manual create selected | Show a compact confirmation row: `Creating a new Mingla venue listing.` CTA `Continue`. |

### 5.3 Copy Rules

Do:

- Say `create a new listing`.
- Say `use this venue` for a selected match.
- Say `Mingla's directory` unless the result is explicitly Google-backed.

Avoid:

- `Skip`, because create-new is not a lesser path.
- `No, different business` as the main path for create-new.
- Any implication that Google verification is required to start.

## 6. Tier 1 Field Design

### 6.1 Basics

Use the existing `VenueCategoryPicker` pattern, but extend it beyond three options per the SPEC taxonomy. Use compact chips for larger category counts instead of full-height cards for every option.

Recommended layout:

- Top row: selected category chips.
- Main list: category groups like `Food & drink`, `Things to do`, `Arts & culture`, `Nightlife`, `Wellness/outdoor`.
- Allow multi-select when the backend supports it; if backend remains single primary category, show one primary selection plus optional "also fits" chips for AI inputs.

### 6.2 Address

Address is functional, not promotional.

States:

- Prefilled from selected match: show read-only summary with `Edit` action.
- Manual create: controlled address field plus city/country.
- Missing lat/lng: show warning state, not a dead end: `Add a full address so Mingla can place you in the deck.`
- Map pin unavailable: allow continue to draft but mark deck readiness as blocked.

### 6.3 Hero Media

Use `CoverPickerSheet` as the sole hero image/video control.

Required placement:

- Tier 1 `Media` screen has a hero preview at top.
- Primary action: `Choose cover`
- Secondary action after media exists: icon button for replace.
- For video upload, show processing state from `onCoverVideoProcessingChange`.

Hero-video boost copy must not promise rank.

Allowed copy:

- `A short video helps Mingla understand the feel of your venue.`
- `Video can improve deck confidence when it clearly shows the space.`

Avoid:

- `Get a 1.15x boost`
- `Rank higher`
- `Guaranteed more deck placements`

### 6.4 Hours And Contact

Hours should be compact and recoverable:

- Default collapsed weekdays.
- `Same hours every day` toggle.
- Per-day edit rows.
- Closed toggle per day.
- Copy holiday/special hours out of scope unless already supported.

Contact:

- Require email or phone.
- Website/social optional.
- Explain contact as trust and verification, not public spam.

## 7. AI Sales Bio Confirm/Edit UX

Stage 4 is not "clean up my writing." It is AI-generated sales bio from Sarah's inputs, then Sarah confirms or edits.

### 7.1 Screen Structure

Render a single `Generated profile story` surface:

- Header: `Generated profile story`
- Status pill: `Drafted by Mingla AI`
- Body: editable preview text, 4-8 lines before expansion.
- Source chips: `Photos`, `Menu`, `Vibe answers`, `Venue details` when actually used.
- Actions:
  - Primary: `Use this story`
  - Secondary: `Edit`
  - Ghost: `Regenerate`

### 7.2 Edit Mode

When Sarah taps `Edit`:

- Keep the generated text in a controlled multiline input.
- Show character count only if there is a real limit.
- Primary action becomes `Save story`.
- Secondary action `Restore AI draft`.
- Keep source chips visible but subdued.

### 7.3 Regenerate State

Regenerate must be bounded:

- Confirm if Sarah has unsaved edits: `Regenerating will replace your current draft.`
- Loading: `Writing a new story...`
- Error: `Could not regenerate right now. Your current draft is safe.`

### 7.4 Trust Copy

One helper line under the title:

`This appears on your venue profile after you approve it.`

Do not show raw AI prompts or internal signal names.

## 8. Vibe Quiz And Facet Confirmation

### 8.1 Vibe Quiz Model

Use chips, not free text, for the first pass. This keeps the flow fast and creates clean AI inputs.

Recommended questions:

| Question | Control | Notes |
|---|---|---|
| `Best for` | Multi-select chips, 1-4 | First dates, group nights, solo reset, brunch, family day, special occasion. |
| `Energy level` | Segmented control or slider | Quiet, balanced, lively. |
| `Best time` | Multi-select chips | Morning, afternoon, golden hour, dinner, late night. |
| `Group size` | Segmented chips | Solo/duo, 3-4, 5-8, larger groups. |
| `Date vibe` | Multi-select chips | Conversation, playful, romantic, impressive, casual. |
| `Price feel` | Single-select chips | Easygoing, comfy, premium, splurge. |

Keep each chip at minimum 44px height where possible. If labels get long, wrap to two lines rather than shrinking text.

### 8.2 Facet Toggles

Facets should be grouped by operator mental model, not database column order.

Groups:

- `Food and drinks`: brunch, lunch, dinner, cocktails, wine, beer, dessert, vegetarian options.
- `Atmosphere`: quiet, lively, romantic, scenic, good for groups, family-friendly.
- `Practical`: reservations, walk-ins, accessibility, dog-friendly, outdoor seating.
- `Programming`: live music, classes, events, performances.

Each facet row has:

- Label.
- AI confidence hint when AI proposed it: `AI found this in your menu` or `AI guessed from photos`.
- Toggle state.

Prefer a binary toggle for Sarah's confirmation, but store unknown separately in state where the backend needs it. Do not visually imply "No" when Mingla simply does not know yet.

## 9. Hub Deck-Readiness Coaching

The Hub card is mandatory. Title it exactly:

`Why you're not in the deck yet`

When the venue is ready, title can change to:

`You're deck-ready`

### 9.1 Card Hierarchy

Use one elevated glass surface with sections, not nested cards.

Top hierarchy:

1. Status pill:
   - `Draft`
   - `Checking`
   - `Needs fixes`
   - `Deck-ready`
   - `Failed`
2. One-sentence summary.
3. Primary fix CTA.
4. Reason list with one-tap actions.
5. AI pipeline disclosure accordion.

### 9.2 Bouncer Reason Copy

Map bouncer codes to plain English. Exact code names can stay in debug logs, not visible UI.

| Code family | Sarah-facing reason | Primary fix CTA |
|---|---|---|
| B3 | `Mingla is missing a required venue detail like name, address, or map pin.` | `Open venue basics` |
| B4 | `This place type is not a strong Mingla destination yet.` | `Review category` |
| B5 | `Mingla needs a trusted website or contact signal before recommending this venue.` | `Add website/contact` |
| B6 | `Mingla needs your hours before it can recommend this venue.` | `Add hours` |
| B8 | `Mingla needs at least one usable venue photo or video.` | `Add photos` |
| B9 | `This looks like a location inside another business.` | `Request review` |
| B10 | `This looks like a fast-food or snack category Mingla does not serve in the deck.` | `Request review` |
| B11 | `This looks like a fast-food or coffee chain.` | `Request review` |
| B12 | `This looks like a casual chain.` | `Request review` |

If multiple reasons exist, pick the first fixable reason as the primary CTA. Secondary reasons remain tappable rows.

### 9.3 Ready State

Ready state copy:

- Title: `You're deck-ready`
- Body: `Mingla can now consider this venue when it matches someone's plans.`
- Secondary line: `Keep photos, hours, and menu details fresh for better confidence.`

Do not promise deck impressions, traffic, ranking, or revenue.

## 10. 8-Stage Gemini Pipeline States

The AI pipeline should run in the background after Tier 2, but the Hub must show enough progress to reduce anxiety.

### 10.1 Stage Names

Use Sarah-facing names:

| Internal stage | UI label |
|---|---|
| Menu OCR | `Reading menu or list` |
| Activity extraction | `Finding bookable ideas` |
| Photo analysis | `Reviewing photos` |
| Description generation | `Drafting profile story` |
| Structured facet inference | `Filling venue details` |
| Signal pre-evaluation | `Checking recommendation fit` |
| Cross-validate vs Google | `Comparing directory details` |
| Bouncer servability | `Checking deck readiness` |

### 10.2 Per-Stage Statuses

Each stage can be:

- `Queued`
- `Running`
- `Done`
- `Needs review`
- `Failed`
- `Skipped`

Partial success is expected. A failed photo analysis should not hide a completed bio draft. A failed cross-validation should not erase already-confirmed Sarah edits.

### 10.3 Loading And Retry Copy

Global loading:

`Mingla is checking your venue. You can leave this screen.`

Per-stage retry:

`Try again`

Pipeline failed:

`Some checks did not finish. Your saved details are safe.`

Partial success:

`Most checks finished. Review the remaining item to finish deck readiness.`

### 10.4 Toast Rules

Toasts should confirm saved actions, not explain complex failure.

Good:

- `Story saved`
- `Cover updated`
- `Deck check started`

Use inline alerts for actionable failures.

## 11. Expired Generated-Experience Proposal UX

Sub-E must fix the 26-attempt/0-completion funnel collapse by making proposal state truthful before Sarah taps.

### 11.1 Pending Proposal Card States

Extend `ExperienceConfirmationCard` or its data wrapper with explicit states:

| State | UX |
|---|---|
| Pending active | Existing Accept/Edit/Reject actions, plus expiry microcopy. |
| Expires soon | Warning microcopy: `Refresh soon - this suggestion expires today.` |
| Expired | No Accept button. Show `This suggestion expired. Refresh it to use it.` CTA `Refresh suggestion`. |
| Refreshing | Stable disabled controls; spinner in CTA. |
| Failed refresh | Alert row: `Could not refresh. Try again.` |
| Accepted | Remove from pending list; show normal created experience in existing list. |

### 11.2 Hub Empty State

Current empty state should become more instructive:

- Title: `No suggested experiences yet`
- Body: `Upload a menu, package sheet, flyer, or activity list and Mingla will draft ideas you can approve.`
- Primary CTA: `Upload a list`

Do not say restaurant-only or play-only.

### 11.3 Copy For Universal Parser

Replace category-specific framing with broader copy:

- `Upload a menu, service sheet, package list, flyer, or activity list.`
- `Mingla will draft experiences you can edit before anything goes live.`

## 12. Visual System Direction

Use existing `mingla-business` tokens and primitives.

### 12.1 Tokens

- Canvas: `canvas.discover` or current venue-create canvas.
- Accent: `accent.warm`.
- Text: `text.primary`, `text.secondary`, `text.tertiary`.
- Semantic: `semantic.success`, `semantic.warning`, `semantic.error`, `semantic.info`.
- Spacing: 2/4/8/16/24/32/48 scale.
- Radius: default 8-24 depending on existing primitive.

Do not introduce a new palette. Do not add a broad AI gradient.

### 12.2 Typography

- Use compact screen headings, not hero-scale type.
- Use existing body and caption tokens.
- Avoid adding new negative letter spacing.
- Keep button labels short enough for 390px width.

### 12.3 Components

Reuse:

- `Button`
- `Icon`
- `GlassCard`
- `GlassChrome`
- `Sheet`
- `CoverPickerSheet`
- `Stepper`
- existing input primitives

Design constraints:

- Avoid cards inside cards.
- Use dividers, rows, and grouped sections inside a single surface.
- Prefer icon+text buttons for clear actions.
- Keep icon-only buttons for close, remove, retry, replace, and edit where the icon is familiar and accessibility labels exist.

## 13. Accessibility And Mobile Responsiveness

Required acceptance criteria:

- All tap targets are at least 44px high/wide, with 48px preferred for primary controls.
- Errors use alert semantics/accessibility announcements where supported.
- Color is never the only status signal.
- Selected match rows expose `accessibilityState={{ selected: true }}`.
- Busy buttons expose busy/disabled state.
- Long venue names, addresses, and generated bio text wrap without horizontal overflow.
- Keyboard does not cover active text inputs.
- Bottom action docks respect safe area.
- Reduced motion avoids unnecessary animated transitions.
- Screen reader order follows the visual flow: title, helper, input/list, status, actions.
- Expired proposals do not expose an enabled Accept control to assistive tech.

Visual QA matrix:

- iPhone 17 Pro Max simulator already named in registry.
- Small phone width around 390px.
- Android business dev build.
- Web preview/tablet layout if the same code path renders web.

Manual visual cases:

- Long venue name.
- 20+ search matches.
- No search matches.
- Search error.
- Manual create path.
- Selected match path.
- Missing address.
- Missing cover.
- Video cover processing.
- AI pipeline partial failure.
- Bouncer multiple reasons.
- Expired generated proposal.

## 14. Implementation Acceptance Criteria

An implementation satisfies this design gate only if:

1. The claim/create screen shows every available match for the active query, not a single top match.
2. Manual create is a first-class path with positive copy and a persistent CTA.
3. Tier 1 completion creates/links the venue and then pivots to deck readiness.
4. Tier 2 is available in the same first session and again from Hub.
5. Hero image/video uses shared `CoverPickerSheet`/`CoverPicker`; direct hero upload paths are removed for this surface.
6. Hero-video copy explains confidence, not rank promises.
7. Stage 4 renders an AI-generated bio that Sarah must confirm or edit before it becomes public profile copy.
8. Vibe quiz uses chip/segmented controls and avoids free-text dependency for first pass.
9. Facets are grouped by operator mental model and support AI-proposed confirmation.
10. Hub includes `Why you're not in the deck yet` with bouncer reason translations and one-tap fix paths.
11. The 8-stage pipeline has loading, retry, partial-success, failed, and done states.
12. Expired generated-experience proposals are visibly expired before accept and offer refresh instead of returning a dead 410 after tap.
13. Universal parser copy is not hard-gated to restaurant/play wording.
14. Accessibility requirements in section 13 are covered by code, labels, and tests/manual QA.
15. Regression tests cover at least:
    - all-match rendering vs previous single-match behavior,
    - create-new continuation with no Google match,
    - expired proposal disables accept and offers refresh,
    - Hub coaching renders one bouncer reason with correct fix CTA,
    - CoverPickerSheet is used for hero cover selection in venue authoring.

## 15. Implementor Notes

Preferred component additions:

- `PoolMatchSelectionList`
- `VenueDeckReadinessCard`
- `BusinessAuthoringPipelineStatus`
- `VibeQuiz`
- `FacetConfirmationList`
- `GeneratedSalesBioCard`
- `ExpiredExperienceProposalState`

Preferred data flow:

- Match screen owns query and selected match/manual-create choice.
- Wizard owns Tier 1 draft.
- Pipeline state owns Tier 2 status and Hub readiness.
- AI-generated outputs are stored as proposed values until Sarah confirms.

Do not ship:

- Consumer deck card type work. That is Sub-F.
- New checkout/payment surfaces.
- Multi-stop experience UX.
- New visual language.
- Fake deck placement metrics.

## 16. Orchestrator Review Notes

This design artifact clears the UI/UX gate for implementation review, with one caveat: the implementor still needs to prove exact backend field names and returned pipeline statuses from the final edge-function contract. If those names differ from this artifact, the UI should preserve the Sarah-facing labels and map the backend statuses behind the scenes.

Recommended next routing:

`orchestrator review -> implementor dispatch -> tester after implementation`
