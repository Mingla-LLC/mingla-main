# DESIGN — META-ORCH-1290 [venue authoring: one-submission + editable AI pitch + scores-on-listing + consumer-facing pitch]

**Phase:** DESIGN (consumed by the forensics SPEC; the implementor builds from the SPEC that embeds this). No code changed.
**Worktree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` on `orch-1290-venue-authoring-one-submission` (rebased on `origin/main` `a577cd34c`).
**Date:** 2026-07-03
**Inputs:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` (F-1…F-15, OQ-1…OQ-7); Seth's LOCKED DECISIONS D-1/D-3/D-4/D-5/D-6; `DESIGN_META-ORCH-1255_VENUE_SURFACES.md` (status chip §3, card glass §4.2, public page §6, Android policy §8) + `DESIGN_ORCH-1263_CLAIM_WALKTHROUGH.md` (ProvenanceChip §3, adoption walkthrough §6, motion §7) honored; every design system value read live at file:line below.
**Voice:** Mingla canonical — warm, plain, zero jargon.
**No fabricated data anywhere.** A venue with no pitch shows an honest empty state on every surface — never fake text. Every score bar and card blurb is real or its element is HIDDEN/LOCKED, never faked. This is the binding constraint of the whole spec.

**Seth's decisions are answered, not re-litigated.** OQ-1 (from the investigation) is answered **YES** by D-6: the pitch becomes consumer-facing. OQ-2 is answered by D-3: SPLIT (bio-only draft during authoring; 16-signal eval at approve). This design assumes those and specifies the pixels.

Token provenance (single source, `mingla-business/src/constants/designSystem.ts` unless noted): `spacing` :29 · `radius` :39 · `shadows`/`androidSafeElevation` :26,:70 · `accent` :179 · `canvas` :264 · `glass` :270 · `semantic` :298 · `text` :309 · `blurIntensity` :317 · `easings` :326 · `durations` :334 · `typography` :345. Buttons: `SIZE_HEIGHT` sm 36 / md 44 / lg 52, `SIZE_PADDING_X` 12/16/20, `SIZE_ICON` 16/18/20 (`ui/Button.tsx:91`). Business icon set (`ui/Icon.tsx:108-320`) — available keys used here: `sparkle`, `edit`, `swap`, `check`, `upload`, `eye`, `flag`, `shield`, `chevR`, `plus`, `close`. Consumer swipe-card + expanded-modal values from `app-mobile/` at file:line inline. Public-page palette from `@mingla/offering-rendering` `createThemePalette(resolveTheme(venue.theme))` exactly as `PublicVenuePage.tsx:115-127`.

---

## 0. Cross-surface declaration (5 + 2)

| # | Surface | Touched? | What |
|---|---------|----------|------|
| 1 | Business iOS | YES | Folded one-submission wizard (§2), shared VenuePitchField (§3), listing page editable pitch + locked/live scores (§4) |
| 2 | Business Android | YES | Same, opaque-glass deltas (§9) |
| 3 | Business web (phone + desktop ≥1024) | YES | Same layouts; numbered stepper, 720 column cap, hover/focus deltas (§9) |
| 4 | Admin web (mingla-admin) | NO — byte-identical | Approve path gains the 16-signal eval trigger (SPEC/back-end); no admin **UI** change in this ORCH |
| 5 | Buyer/anon web (public venue page) | YES | Pitch "About" section + meta (§6) |
| +1 | Consumer iOS/Android (app-mobile) | YES | Swipe-card pitch line (§5a) + expanded-card full pitch (§5b) |
| +2 | Business web-preview (phone-width web) | YES | Rides the wizard/listing changes (Vercel `[deploy]`) |

**Blast-radius carry-forwards (from investigation §6):**
- **Business OTA is BLOCKED (COMMS-0052, still OPEN).** Every native wizard/listing change here is **native-build-only** — it rides the next business build, NOT `eas update`. The public-page + consumer-card changes are separate bundles (consumer app OTA per-platform; public page = business web Vercel `[deploy]`).
- The deck-readiness route (`app/venue/deck-readiness.tsx`) + `VenueDeckReadinessSetup.tsx` are **RETIRED as a user-facing leg** (D-1). Their cover/gallery/price/facet sub-forms migrate INTO the wizard as steps; the "Recommend me to users" button and the operator "Approve & publish" confirm are DELETED (D-2). CI gate `i-proposed-1285-create-lands-on-durable-deck-readiness.mjs` is **inverted by D-1** and must be retired with a superseding note (SPEC owns; investigation F-15).

---

## 1. IA & flow (all surfaces)

**The moments, per surface:**
- **Wizard (owner):** "I want my place on Mingla." One continuous fill → one Submit → "in review." No second leg, no "now do the AI part." The owner should never feel they finished and then discover more work.
- **Pitch step / listing pitch (owner):** "What do I even write?" The answer arrives as a **first draft they can accept, edit, or redo** — the AI does the blank-page work; the owner keeps control.
- **Listing scores (owner):** pre-approval — "did it work?" → an honest "locked until a human approves you." Post-approval — "where do I show up?" → the real 0-100 bars in plain moment-words.
- **Consumer swipe card (explorer):** deciding fast. The pitch is a **one-taste line** under the name — enough to lean in, never a paragraph that buries the photo.
- **Public venue page (buyer):** "is this my kind of place?" The pitch is the **voice of the venue**, right under the name, before the logistics.

**Flow map (authoring):**
```
"+" → UniversalCreatorSheet → "Create venue listing" → /venue/create (gate → category → FOLDED WIZARD)
FOLDED WIZARD (create, ONE submission — §2.1):
  s0 Address · s1 Name · s2 Hours · s3 Photos(≥5) · s4 Cover · s5 Contact(email/phone/website)
  · s6 Pitch(AI-draftable, §3) · s7 Price & highlights(tiers + best-for + quick-questions)
  · s8 Bookings · s9 Review → [Submit for review]
      └─ creates venue_listings row (is_servable=false) + persists the in-step pitch draft
         → lands on the venue management page, status chip = "In review"  (NO deck-readiness leg)
Admin approves ──▶ 16-signal eval runs (D-2) ──▶ scores populate ──▶ chip "Live on Mingla" ──▶ pitch + scores go public
CLAIM WIZARD (already single-submit, c0–c9): unchanged shape; only c5 Pitch swaps to the shared VenuePitchField (§3) with the regenerate affordance; NO pre-approve eval (already true).
```
Error paths: every AI/fetch failure = honest inline recovery, never a blank pane, never a dead second leg. The wizard's existing 23505 / slug-collision / tier-1-retry branches (`VenueCreatorWizard.tsx:427-465`) are preserved verbatim.

**Why fold, not add-a-leg:** the claim path (`c0–c9`) already proves a single stage-only submit with the AI deferred to approve is the right shape (investigation F-10/F-11). Create converges to it. The only reordering vs claim: **Contact (s5) precedes Pitch (s6)** so the pitch draft can read the website the owner just entered — a strictly better first draft. Everything else mirrors claim minus the "adopt" framing (create has no `place_pool` to adopt from, so no ProvenanceChips on create).

---

## 2. Surface A — the folded one-submission wizard (D-1)

### 2.1 Step map — replace `CREATE_STEPS` (`venueWizardValidation.ts:31-38`)

Today create is 6 steps (`s0 Address · s1 Name · s2 Hours · s3 Contact · s4 Inputs · s5 Review`) and then `router.replace`s to the deck-readiness leg (`VenueCreatorWizard.tsx:417-425`). The folded map is **10 steps, one submit**:

| id | Label | Content | Source component (migrate/reuse) | Submit gate |
|----|-------|---------|----------------------------------|-------------|
| s0 | Address | Mapbox address + pin | `VenueStep1Address` (unchanged) | address + lat/lng present (`venueStepError s0`) |
| s1 | Name | name + slug | `VenueStep2NameSlug` (unchanged) | name + slug present |
| s2 | Hours | 7-day grid, overnight-valid | `VenueStep4Hours` (unchanged) | `hoursError` |
| s3 | Photos | gallery upload 5–20 | migrate `VenueDeckReadinessSetup` gallery block (`:519-576`) into a `VenuePhotosStep` | **≥5 photos** |
| s4 | Cover | choose from s3 gallery OR upload | migrate cover block (`:488-517`) into `VenueCoverStep`; the 1263 §6.5 cover-chooser grid pattern | **1 cover chosen** |
| s5 | Contact | email / phone / website | extend `VenueStep5Contact` with the website field (from deck-readiness `:606-615`) | email OR phone present; website optional; c6-style E.164 check |
| s6 | Pitch | single AI-draftable field | **new shared `VenuePitchField` (§3)** replacing `VenueStep6Description` | pitch ≥20 chars (a "Draft with AI" tap satisfies it instantly) |
| s7 | Price & highlights | price tiers (req) + "Best for" chips + quick yes/no questions | migrate price (`:617-640`) + best-for (`:642-665`) + facets (`:667-701`) into `VenuePriceHighlightsStep` | **≥1 price tier**; best-for + facets OPTIONAL (never block — the AI still scores every signal) |
| s8 | Bookings | reservations toggle (off default) | 1263 §6.9 pattern (`BrandSwitch`, off) | never blocks |
| s9 | Review | full summary + Submit | extend `VenueStep7Review` (§2.3) | last-step submit |

**Why these merges.** D-1 lists "cover, gallery, hours, pitch, price, facets, contact." s3+s4 keep Photos and Cover as separate steps (1263 §6.5's proven "cover is the one hero decision, it earns its own stage"). s7 absorbs price + best-for + facets into ONE "Price & highlights" step because the deck-readiness leg already presented them as one scroll (`VenueDeckReadinessSetup.tsx:599-701`) — splitting them into three steps would inflate the count for optional refinements. **Facets/best-for are OPTIONAL** (D-1 says the owner *enters* them; the AI does not depend on them — `computeScore` treats AI slices as optional, `signalScorer.ts:313`), so they never gate Submit.

Category is chosen at the gate BEFORE the wizard (`create.tsx` → category → wizard), so create needs no Category step — matching today.

### 2.2 Shell — unchanged geometry (`VenueCreatorWizard.tsx:545-622`)

The wizard shell is reused verbatim; only the step map + step bodies + the success seam change:
- Chrome row: title `List your venue` `typography.body` 16 w700 `text.primary`; sub `Step {n} of 10` `typography.caption` `text.tertiary` (`:641-650`). Now reads "of 10".
- `Stepper` (`ui/Stepper.tsx`) renders 10 dots (mobile) / numbered circles (web). 10 dots × 8 + 9 gaps × 8 = 152pt — fits every phone (1263 §5.2 measured this exact count).
- Dock: Back `ghost lg` + primary `lg` `Continue`, disabled-until-valid (`:590-620`, B2 contract). On s9 the dock is hidden; Review owns its Submit button.
- `StepTransition` (M-2, `:131-165`): incoming slide+fade ±24→0 260ms native; fade-only web; reduced-motion instant. Unchanged.

**The success seam — the D-1 change (`VenueCreatorWizard.tsx:405-426`):** DELETE the `router.replace(routeForDeckReadinessFix(...))` create branch. On Submit success, land directly on the venue management page (`/venue/{id}` management surface / `VenueListingContent` `chromeMode="page"`), status chip **"In review"**. Reset THIS brand's draft first (`draftVenueStore.reset(brandId)`, as today `:417`). Back cannot return to the blanked wizard (`router.replace`, not push). The claim branch (`:397-403`) already lands correctly — leave it.

### 2.3 s9 Review / Submit screen (extend `VenueStep7Review`)

Body host per 1263 §2 (`gap: spacing.md`, `paddingHorizontal: spacing.lg`, `paddingBottom: spacing.xl`). Title `Review & submit` `typography.h3` 20/32 w600 `text.primary`; helper `Your venue goes to us for a quick check — approval usually lands within 4 business hours.` `typography.bodySm` `text.secondary` lh 20.

**Summary card** (`deckBlock` recipe: radius 12, `padding: spacing.md`, bg rgba(255,255,255,0.06), `gap: spacing.sm`) — one card, rows in visual order; each row is a Pressable that jumps to its step (`setStep`), role button, label `{field}: {value}. Tap to change.`, trailing `chevR` 16 `text.tertiary`, hairline separators rgba(255,255,255,0.08), row padV `spacing.sm`:

| Row | Value shown | Hidden when |
|---|---|---|
| Cover | 40×50 thumb (radius 6) of chosen cover + `Cover set` | never (required) |
| Photos | `{n} photos` | never (required ≥5) |
| Name & address | name (16 w600) + address line (13 `text.secondary`, 1 line) | never |
| Hours | `Open {n} days` / today's line | hours empty |
| Pitch | first **3 lines** of the pitch, `numberOfLines={3}`, `typography.bodySm` `text.secondary` | pitch empty → row shows `Add a pitch` in `semantic.warning` (jump target) |
| Contact | email • phone • website (whichever present, joined ` · `, 1 line) | none present (won't happen — gate requires one) |
| Price & highlights | `{tiers} · {n} highlights` (best-for + facet-yes count) | price empty (won't submit) |
| Bookings | `Reservations on` / `Reservations off` | never |

**Submit button:** primary `lg` `Submit for review`; loading label `Submitting…` (existing `VenueStep7Review` prop `submitting`). Submit errors reuse the existing `submitError` inline slot (`semantic.warning`). On success → §2.2 seam.

**States:** default (above) · submitting (button loading, rows non-interactive, opacity 0.85) · error (inline `submitErr` caption `semantic.warning`, rows stay tappable so the owner can fix + resubmit) · the existing slug-collision (`:428-434`) and claim edge cards are out of create scope.

---

## 3. The shared VenuePitchField — editable AI pitch + regenerate (D-3 + D-4)

**One component, three mount points:** wizard s6 (create), claim c5 (`ClaimStepPitch` swaps its body to this), and the listing/management page (§4.2). This is the single home of "AI drafts it, you edit it, you can redo it anytime." Replaces the two-field `VenueStep6Description` (tagline + description → GONE) and the read-only listing pitch.

### 3.1 Anatomy (top → bottom, `gap: spacing.md`, host padH `spacing.lg`)

1. **Title** (wizard only) `Your pitch` `typography.h3` 20/32 w600 `text.primary`.
2. **Label row** (`flexDirection:"row"`, `alignItems:"center"`, `justifyContent:"space-between"`):
   - Left: `PITCH` `typography.labelCap` (12/16 w600 ls 1.4) `text.tertiary`.
   - Right: state chip — **`AI DRAFT`** micro-chip when the current text is an unedited AI draft (see 3.2 states 3); on claim, the `ProvenanceChip` (`On Mingla`/`Edited`) instead (1263 §3). No chip when the owner typed their own.
3. **Textarea** — the deck-readiness input recipe verbatim (`VenueDeckReadinessSetup.tsx:985-998`, `ClaimStepPitch.tsx:126-136`): `minHeight: 150`, `padding: spacing.md`, `borderRadius: 12`, `overflow:"hidden"`, `borderWidth: 1`, `borderColor: rgba(255,255,255,0.12)`, `backgroundColor: rgba(0,0,0,0.18)`, `color: text.primary`, `fontSize: typography.body.fontSize` (16), `textAlignVertical:"top"`, `multiline`, placeholder `What makes your place worth the trip?` (`text.tertiary`). a11y label `Venue pitch`.
4. **Action row** (`flexDirection:"row"`, `gap: spacing.sm`, `alignItems:"center"`, `flexWrap:"wrap"`):
   - **Empty** → single button `Draft with AI` `secondary md` `leadingIcon="sparkle"` (attention-weighted; md 44pt).
   - **Populated** → `Regenerate` `secondary sm` `leadingIcon="sparkle"` + `Clear` `ghost sm` (only when text present). sm = 36pt + Button's hitSlop → ≥44 effective.
5. **Helper** `typography.caption` `text.tertiary` lh 17: empty → `Our AI writes a first draft from your details — website, photos, the lot. Edit it freely; honest beats fancy.` · drafted → `This is what people read on your card. Make it yours.`
6. **Error slot** (below) — inline `semantic.warning` caption when the AI call fails (state 5).

### 3.2 Every state (fully specified — the honest states Seth asked for)

| # | State | Textarea | Label chip | Action row | Notes |
|---|-------|----------|-----------|-----------|-------|
| 1 | **Empty** (no draft, no text) | placeholder only, editable | none | `Draft with AI` (md, sparkle) | Owner may type directly OR tap draft. Never pre-filled with fake text. Gate: ≥20 chars OR a draft. |
| 2 | **Drafting** (AI running) | textarea REPLACED by a shimmer skeleton (3 lines: `Skeleton` widths 100% / 92% / 64%, height 16, radius 4, gap 8, `overflow:"hidden"` inside the 150-min box) + a rotating status caption centered below: `Reading your details…` → `Finding your angle…` → `Writing your pitch…` (2000ms rotate, mirror `RECOMMEND_STAGES` cadence `VenueDeckReadinessSetup.tsx:99-106`) | none | `Draft with AI` → Button `loading` (spinner); Clear/Regenerate hidden | **No fake text ever shows** — only the shimmer, until the real draft lands. |
| 3 | **Drafted** (AI text present, unedited) | filled with the real draft; reveal motion M-P1 | `AI DRAFT` micro-chip (see 3.3) | `Regenerate` (sparkle) + `Clear` | The one flourish: helper swaps to `This is what people read on your card. Make it yours.` |
| 4 | **Edited** (owner changed the draft) | owner's text | chip DROPS on create (`AI DRAFT`→none); on claim `On Mingla`→`Edited` (M-3, 1263) | `Regenerate` + `Clear` | Regenerate here shows a confirm (3.4). Reverting to the exact draft restores the chip. |
| 5 | **Error** (AI failed) | keeps whatever's there (draft or empty), editable | none | `Try again` (replaces Regenerate/Draft) | Inline warn caption `Couldn't draft that just now — write your own or try again.` `semantic.warning` (8.6:1). NEVER blocks: the owner types their own and continues. |
| 6 | **Disabled** (submitting / saving) | non-editable, opacity 0.6 | frozen | buttons disabled | |

### 3.3 The `AI DRAFT` micro-chip

Dotless pill (so it can't be misread as a listing status — 1263 §3 rationale), `radius.full`, padH `spacing.sm` (8), padV 3, single `Text` `typography.micro` (11/14 w600 ls 0.4), `numberOfLines={1}`, `alignSelf:"flex-start"`, height ≈20pt. Colors: text `accent.warm` #eb7825, bg `accent.tint` rgba(235,120,37,0.28). Contrast (accent.warm on the composited tint over `canvas.discover`) ≥4.5:1 at 11pt w600. `accessible={false}` — its meaning ("this is an AI first draft") joins the field's a11y label: `Venue pitch, AI first draft — edit to make it yours`. Rule: renders ONLY while the text is byte-identical to the last AI draft; the first keystroke removes it (color is never the only signal — the helper copy states it too).

### 3.4 Regenerate behavior + the bio-only action

- **Regenerate from an unedited draft (state 3):** fires immediately → state 2 (Drafting) → new draft replaces (M-P2). No confirm (nothing to lose).
- **Regenerate from an edited pitch (state 4) or the listing page:** a lightweight confirm first — a `BaseBottomSheet`/inline confirm row: `Replace your pitch with a fresh AI draft?` + `Regenerate` (primary sm, `semantic`-neutral) + `Keep mine` (ghost sm). Protects the owner's words.
- **Action wiring (SPEC owns):** both `Draft with AI` and `Regenerate` call a **bio-only** pipeline action that writes ONLY `place_pool.generative_summary` and returns `generated_bio` — it MUST NOT compute or write `ai_signal_scores` (D-2). Today's closest existing action is `regenerate_sales_bio` (`businessPlaceAuthoringService.ts:53`, returns `generated_bio: string`); the SPEC either confirms it is bio-only or splits it from `run_tier2_pipeline` (investigation §5b, OQ-2/OQ-3 — recommend approve-path *invokes* the pipeline so the sole-owner invariant `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` is untouched, F-14). **Optional regenerate cap** (OQ-4 fate of `RECOMMEND_EDIT_CAP=4`): if a cap survives, show it as a caption under Regenerate — `{n} AI drafts left` `text.tertiary` — and disable Regenerate at 0 with `Out of AI drafts — edit yours by hand or contact support.` If Seth drops the cap, omit entirely (the "Changes remaining" card §4.4 goes with it).

### 3.5 Motion (pitch)

| # | Moment | Trigger | Property | Curve / duration | Reduced motion |
|---|--------|---------|----------|------------------|----------------|
| M-P1 | Draft reveal | AI draft lands (state 2→3) | shimmer opacity 1→0 cross-fading with real text opacity 0→1 + translateY 6→0 | `durations.entry` 260 `easings.out` | instant fill, no shimmer fade |
| M-P2 | Regenerate | new draft lands | current text opacity 1→0.35 + shimmer returns (state 2), then M-P1 for the new text | as M-P1 | instant swap |
| M-P3 | `AI DRAFT` chip flip | first keystroke on a draft | chip opacity 1→0, width→0 (no layout jump — text below is unaffected) | `durations.fast` 120 linear | instant remove |
| M-P4 | Status caption rotate | while drafting | crossfade between stage strings | `durations.normal` 200 | show first string only |

**No typewriter.** A character-by-character "AI is typing" effect implies live authorship and reads as theater; the honest, fast move is a single fade-in of the finished draft (M-P1). Stated so the implementor doesn't add one.

---

## 4. Surface B — listing / management page (D-3 editable pitch + D-5 scores)

File: `mingla-business/src/components/venue/VenueListingContent.tsx`. All cards are `GlassCard` (`variant="base"` unless noted), padding `spacing.lg`. The page already renders Status → Feedback → Rejection → What-you-submitted → Scores → Changes-remaining → Actions (`:283-446`). Two blocks change (pitch, scores) and one is retired (changes-remaining, optional).

### 4.1 "What you submitted" — pitch becomes editable (replaces `:358-363`)

Today the pitch is a read-only `<Text>{bio}</Text>` (`:358-363`). Replace the "Your pitch" sub-block with the **`VenuePitchField` (§3)** mounted in a compact listing variant:
- No step Title (the `Your pitch` label row carries it); the field lives inside the existing "What you submitted" `GlassCard`, under the submitted-media row (`:332-357`).
- Seeds from `bio` (`:202-214` `confirmed_ai_outputs.generated_bio ?? sales_bio ?? pending.generated_bio`). If `bio` is null/empty → state 1 (Empty) with `Draft with AI`.
- Below the field: a `Save` button, primary `sm`, disabled until the text differs from the persisted value AND ≥20 chars; loading label `Saving…`; success → `Toast` (existing host `:462-467`) `Pitch updated.` Persist path writes `place_pool.generative_summary` (SPEC owns the owner-write RPC; investigation F-13).
- **Post-approval edit warning (OQ-6, honest):** when the venue is Live (`isLive`, `:235`), a caption under Save: `Editing your pitch sends it back for a quick re-score — your listing stays live.` `text.tertiary`. (The `place_pool` AFTER-UPDATE trigger on `generative_summary` re-queues the eval, migration `20260808000000:369` — surface it so the owner isn't surprised.)
- States 1–6 exactly as §3.2; the field never blocks the rest of the page.

### 4.2 "How you match Mingla moments" — the D-5 scores card (rework `:366-390`)

Today this card renders ONLY when `scoreRows.length > 0` (`:367`) — so pre-approval it is INVISIBLE. D-5 needs a **pre-approval locked state** that is always present once a venue exists. Make the card render in three states:

**State PRE-APPROVAL / LOCKED** (venue exists, not yet approved, `scoreRows.length === 0`):
- `GlassCard variant="base" padding={spacing.lg}`.
- Header row: `sparkle` icon 16 `text.tertiary` + title `Your vibe scores` `typography.body` 16 w700 `text.primary`.
- Body: `Your vibe scores appear once an admin approves your listing — they decide which explorer feeds you show up in.` `typography.bodySm` `text.secondary` lh 20. (Seth's exact copy intent, plain.)
- **Ghost preview (honest, clearly inert):** 4 placeholder rows mirroring the real bar layout but unmistakably empty — label = a short `Skeleton` (width 88, height 12, radius 4), track = the real `scoreBarTrack` (height 8, radius 4, bg rgba(255,255,255,0.10)) with **NO fill** (0%), value slot = `—` `text.quaternary`. This shows the owner WHAT will appear without faking a number. Opacity 0.6 on the whole preview group so it reads as "coming soon," not real. NO real signal labels are shown (the eval hasn't chosen them yet — showing romantic/lively/etc. at 0 would imply a real zero score, which is a lie).
- No CTA (nothing for the owner to do — approval is ours). The old `VenueIntelligenceModule.tsx:468-469` copy "run 'Recommend me'" is DEAD (that button is removed) — wherever that empty-state string renders, it becomes this locked copy.

**State POPULATED / LIVE** (approved, `scoreRows.length > 0`) — the existing bars, polished (`:369-388`):
- Header `sparkle` 16 `accent.warm` + `How you match Mingla moments` (keep) `typography.body` 16 w700 `text.primary`.
- Subtitle `Higher means we recommend you more for that moment.` `typography.caption` `text.tertiary` (drop the jargon "Your AI scores per signal").
- Bars unchanged geometry (`:373-388`): each row `flexDirection:"row"`, `gap: spacing.sm`; label `width: 110`, `typography.caption` `text.secondary`, `numberOfLines={1}` — **human labels** via `venueSignalLabel(id)` (`venueSignals.ts:39`) which already maps `fine_dining`→`Fine dining`, `nature`→`Nature & outdoors`, etc. (F-12); track `flex:1` height 8 radius 4 bg rgba(255,255,255,0.10) `overflow:"hidden"`; fill height 8 radius 4 bg `accent.warm`, `width: {score}%` clamped 0–100; value `width: 28`, right-aligned, `typography.caption` w700 `text.primary`.
- **Polish deltas:** (a) sort desc (already, `:229`); (b) show the **top 6** by default with a `Show all` ghost sm toggle when >6 (the list can be 12 — a wall of bars buries the owner's strong moments; progressive disclosure); (c) fill color ramps by strength for glanceability — `score ≥ 70` `accent.warm` #eb7825, `40–69` rgba(235,120,37,0.66), `<40` rgba(235,120,37,0.38) — still one hue (no rainbow), and the number is always shown so color is never the only signal.
- Reveal motion M-D1 (§7): bars grow width 0→{score}% on first mount, 60ms stagger, `durations.slow` 320 `easings.out`; reduced-motion renders at final width.

**State RE-SCORING** (Live + a pitch/edit re-queued the eval, `ai_signal_scores` present but stale): keep the current bars at full opacity, add a caption under the subtitle `Re-scoring your latest changes — this updates shortly.` `text.tertiary` with a tiny `ActivityIndicator` (12) `accent.warm`. Never blank the existing bars while re-scoring (no content flash).

### 4.3 Loading / error (page-level, existing)
Reuse the page's `ActivityIndicator` loading (`:279-282`) and the "No listing yet" empty (`:269-278`) verbatim.

### 4.4 "Changes remaining" card (`:393-402`) — retire or repurpose (OQ-4)
Tied to the removed "Recommend me" runs. **Default: remove the card.** If the regenerate cap survives (§3.4), the cap lives as a caption under the pitch Regenerate button instead — one home, not a separate card.

### 4.5 "Edit listing" action (`handleEdit`, `:189-194`)
Today it routes to `/venue/deck-readiness?...` — a route being retired. **Re-point** `handleEdit` to re-enter the **folded wizard in edit mode** prefilled from the venue (or, minimally, keep the owner on this page since the pitch/photos are now editable inline). SPEC decides; the design requires the button never lands on the dead deck-readiness leg.

---

## 5. Surface C — consumer swipe card + expanded card (D-6a — the big call)

### 5a. THE SWIPE CARD — placement decision

**Decision: the pitch renders in the existing `oneLiner` slot on the card face, clamped to 2 lines — a one-taste line, NOT the full pitch.** Rationale: the card face already reserves this exact slot (`SwipeableCards.tsx:3043-3044`), it sits precisely where a place blurb belongs (between the title and the badge row, on the gradient-darkened lower third), and it is `null` for places today (`discover-cards/index.ts:909`). The deck is a **choosing** surface (spacious, glanceable) — the full pitch belongs on the **expanded** card (the deliberation surface). Clamping the ONE pitch field to 2 lines is honest (no second field — D-4) and un-crowds the photo. The full pitch shows on tap-to-expand (§5b). This is progressive disclosure done right.

**Exact card-face layout delta** (`titleOverlay` block, `SwipeableCards.tsx:3035-3096`; styles `:3356-3405`):

The `titleOverlay` (position absolute, bottom 0, `padding: 20`, `paddingBottom: 40`, zIndex 2) currently stacks: `cardTitle` (24 bold white, `marginBottom: 16`) → `oneLiner` (only if truthy) → `detailsBadges` → state badges. The delta:

1. **Populate `oneLiner` from the pitch.** In `discover-cards`, map `generative_summary` → the card's `oneLiner` (and `description`, §5b). The face render `:3043-3044` already handles it — but change `numberOfLines={1}` → **`numberOfLines={2}`** so a place blurb gets two lines (a taste). Experiences keep 1 line (they have real short taglines) — scope the 2-line variant to place cards (`cardType` place / non-curated non-event branch, the same branch this JSX lives in `:3009-3116`, so it is already place-only here).
2. **Tighten the title→blurb gap so they read as one unit** (avoid crowding): when a place pitch is present, the title uses a scoped `marginBottom: 6` (not 16), and the `oneLiner` uses `marginTop: 0`, `marginBottom: 10`. Net: title (24) → 6 → blurb (2×~20=40) → 10 → badges. Added height vs today's place card (which has no blurb) ≈ **+56pt**, entirely within the 45%-height `heroGradient` (`:3376-3383`) so the text stays on dark canvas. When NO pitch → title keeps `marginBottom: 16` and no blurb renders (today's exact look).
3. **Type treatment of the blurb** (keep the existing `oneLiner` style `:3384-3393`, unchanged): `fontSize: 15`, `fontWeight: "600"`, `color: "#FFFFFF"`, `textShadowColor: "rgba(0,0,0,0.7)"`, `textShadowOffset: {0,1}`, `textShadowRadius: 3`. Line-clamp = `numberOfLines={2}` with default tail ellipsis. Effective on-card budget ≈ 2 × ~40 chars ≈ **80 chars**.
4. **Copy contract on the pitch generator (so the clamp reads clean):** the bio-only draft prompt (§3.4) must lead with a **strong first sentence** (the hook) — the pitch is authored "hook first," so the 2-line clamp lands on a complete thought most of the time. State this in the SPEC's prompt contract; it is a design requirement, not a nice-to-have.

**Card-face states:**
- **Populated** — venue has an approved pitch → 2-line blurb shows (above).
- **Empty (honest)** — venue with no pitch → `oneLiner` is null/empty → the `{currentRec.oneLiner && ...}` guard (`:3043`) renders NOTHING; card shows name + badges exactly as today. **Never fabricated.** (In practice a venue only reaches the deck after approval — `is_servable=true` at approve, F-9 — and by then it has an AI pitch; the empty path is the safety net, not the common case.)
- **Loading** — none at field level: cards arrive fully-formed from the RPC (no per-field async). The deck's own loading is out of scope.
- **Error** — n/a at field level.

**Wiring (D-6a, SPEC owns; investigation §5e + agent trace):** the RPC `query_servable_places_by_signal` (+ `_intersection`) do NOT return `generative_summary` today (RETURNS TABLE `migrations/20260806000000...:63-86`; SELECT `:90-114`) — add `pp.generative_summary` to both. Then in `transformServablePlaceToCard` (`discover-cards/index.ts:846`) set `oneLiner: row.generative_summary ?? null` (`:909`) and `description: row.generative_summary ?? ''` / `fullDescription` (`:905`, §5b). `deckService.ts` already passes both through (`:213/:224/:248`). The anon-safe view gate (`orch-1255-public-venue-anon-safe.mjs`) is NOT touched by the deck RPC change; the public view is §6.

### 5b. THE EXPANDED CARD — the full pitch

The full pitch renders in the expanded modal's existing (currently blank) description slot — `ExpandedCardModal.tsx:2065` `description={card.description}` → `CardInfoSection.tsx:161` `{description && <Text style={styles.description}>{description}</Text>}`.

- **Placement:** the pitch is the venue's **voice**, so it stays where `description` already sits — inside `CardInfoSection`, directly under the title/tags/metrics, ABOVE the logistics sections (order confirmed by the agent trace: hero → CardInfoSection(title→tags→metrics→**description**→tip) → buttons → Venue/Weather/Busyness/PracticalDetails). No new section, no reordering.
- **Type (existing `styles.description` `CardInfoSection.tsx:229-234`, unchanged):** `fontSize: 15`, `color: "#374151"`, `lineHeight: 22`, `marginBottom: 8`, weight 400. Container padH 16 (`:168-172`). Full pitch, NOT clamped here (this is the deliberation surface — the whole voice earns its space).
- **States:** populated → full pitch. Empty → the `{description && ...}` guard renders nothing (honest; the section title/metrics still render). Loading/error → the modal's own states (out of scope).
- **Note:** there is NO "Why we picked this for you" render target in the mobile app (agent-confirmed: `ai_reasoning_by_signal` is produced by the edge fn `discover-cards:915` but never consumed in `app-mobile/src`). So the ONLY consumer render targets for the pitch are the card-face `oneLiner` (§5a) and this `description` (§5b). No third surface to design.

**No-crowding guarantee (the explicit ask):** the card face gains at most 2 lines (56pt) inside the existing gradient; the full pitch is deferred to expand. The photo is never buried — the blurb sits on the same darkened band the title already uses.

---

## 6. Surface D — public venue page pitch (D-6b)

File: `mingla-business/src/components/venue/PublicVenuePage.tsx`. The 1255 spec §6.3 already SPECIFIED an "About / pitch" section (ClampedBio, 4-line clamp, Read more) — but it was never wired because `venue_public_view` omits the summary column (investigation F-4/F-5). D-6b wires it. **Schema (SPEC owns):** add `place_pool.generative_summary` to `venue_public_view` (migration `...20261130000003...:990-1009`); `PublicVenue` type gains `pitch: string | null`; the anon-safe gate (`orch-1255-public-venue-anon-safe.mjs`) is updated to permit the new column (it is public content by design).

### 6.1 The "About" pitch section — insert between identity (`:198-227`) and map (`:230-249`)

In `bodyContent` (`:465-474`) insert `aboutBlock` immediately after `identityBlock`, before `mapBlock`:

```
identityBlock  (name, By {brand}, address)
aboutBlock     ← NEW pitch section
mapBlock · addressCard · hoursBlock · menuBlock · galleryBlock
```

**Anatomy (themed, palette-driven like every block on this page):**
- No section label needed (the pitch reads as prose directly under the identity) — OR a quiet `ABOUT` `sectionLabel` (12/16 w700 ls 1.4 `palette.tertiaryText`, `:626-632`) for scannability. **Decision: no label** — the pitch under the name IS the about; a label is furniture here.
- Body text: `typography` ~15/23, `color: palette.secondaryText`, themed font (`themedFont`). Value = `venue.pitch`.
- **Clamp + Read more:** clamp to **4 lines** (`numberOfLines={expanded ? undefined : 4}`); when the text overflows, a `Read more` / `Show less` pressable below — `palette.accent`, 13/18 w600, role button, padV 8 (→≥44pt with hitSlop). (Matches 1255 §6.3's `ClampedBio` intent; if a shared `ClampedBio` exists in `@mingla/offering-rendering`, reuse it; else this spec's 4-line + toggle.)
- `marginBottom` handled by the `body` container `gap: 20` (`:539-541`) — no manual margin.

**States:**
- **Populated** — `venue.pitch` present → section renders.
- **Empty (honest)** — `venue.pitch` null/empty → the whole `aboutBlock` is OMITTED (no label, no empty box) — consistent with the page's real-data-only rule (`:17-22`).
- **Loading / error** — route-level (the page only mounts with a resolved venue); no in-block state.

### 6.2 Meta / OG — replace the mechanical line (`:191`)
Today `metaDescription = \`${venue.name} — ${venue.brandName} on Mingla\`` (`:191`). Change to **pitch-first**: `metaDescription = venue.pitch ? clamp(venue.pitch, 155) : \`${venue.name} — ${venue.brandName} on Mingla\`` — single line, newlines stripped, ≤155 chars (SEO description budget). `pageTitle` (`:192-195`) unchanged. OG/Twitter description (`:483/:496`) follows `metaDescription`. This is 1255 §6.11's stated intent, finally fed real data.

### 6.3 Desktop (≥1024) sticky panel (`:402-451`)
The `deskPanel` (`:402-451`) shows name/address/today/By-brand/Share/Reserve. **Add a 2-line clamped pitch** under the address (`numberOfLines={2}`, `palette.secondaryText`, 14/20, `marginTop: 4`) when `venue.pitch` present — the desktop viewer sees the voice without scrolling. Full pitch still lives in the in-body `aboutBlock` on the left column. Hidden when empty.

---

## 7. Motion spec (consolidated — trigger → curve → duration → property → reduced-motion)

| # | Moment | Trigger | Property + values | Curve / duration | Reduced motion |
|---|--------|---------|-------------------|------------------|----------------|
| M-2 | Wizard step transition | goNext/goBack/jump | incoming translateX ±24→0, opacity 0→1; outgoing 0→∓24, 1→0 | entry 260 `easings.out` / exit 180 `easings.in`; web fade-only 200 | instant swap (existing `:131-165`) |
| M-P1 | Pitch draft reveal | AI draft lands | shimmer opacity 1→0 ⨯ text opacity 0→1 + translateY 6→0 | `durations.entry` 260 `easings.out` | instant fill |
| M-P2 | Pitch regenerate | new draft lands | text →0.35 + shimmer returns, then M-P1 | as M-P1 | instant swap |
| M-P3 | `AI DRAFT` chip flip | first keystroke on a draft | chip opacity 1→0, width→0 | `durations.fast` 120 linear | instant remove |
| M-P4 | Draft status rotate | while drafting | crossfade stage strings | `durations.normal` 200 | first string only |
| M-D1 | Score bars reveal | scores card first mount (populated) | each bar width 0→{score}%, 60ms stagger | `durations.slow` 320 `easings.out` | render at final width |
| M-D2 | Score re-scoring | eval re-queued | subtitle caption fade-in + 12px spinner | `durations.normal` 200 | caption appears, no spinner spin |
| M-C1 | Card blurb entrance | front card settles | the existing `titleOverlay` fade+`titleOverlaySlide` (`SwipeableCards.tsx:3035-3040`) already animates the whole overlay incl. the blurb — no new animation | existing | existing |
| M-6b | Public "Read more" | toggle | height auto (layout), rotate none | `durations.normal` 200 `easings.inOut` | instant expand |

All reanimated hooks check `useReducedMotion` (pattern `Stepper.tsx`, `VenueCreatorWizard.tsx:136`). Web: M-2 fade-only.

---

## 8. Accessibility (binding)

- **Contrast (on effective bg over `canvas.discover` #0c0e12 unless themed):** `AI DRAFT` chip accent.warm-on-tint ≥4.5:1 (11pt w600); `semantic.warning` text 8.6:1; `text.secondary` 10.4:1; `text.tertiary` 4.9:1 (12pt+ only); score labels `text.secondary` on canvas 10.4:1; score value w700 `text.primary` 15.9:1. Card-face blurb #FFFFFF over the 45% gradient + text-shadow ≥7:1. Public page pitch uses only `palette.*` pairings already AA-audited by the brand-page system.
- **Targets ≥44pt (I-38):** all Buttons (sm 36 + kit hitSlop, md 44, lg 52); Regenerate/Clear sm carry Button hitSlop; Review rows ≥ `spacing.sm`×2 + content ≥44; public "Read more" padV 8 + hitSlop; card is one big Pressable.
- **Roles/labels (I-39):** pitch textarea `Venue pitch` (+ `, AI first draft` in state 3); `Draft with AI`/`Regenerate`/`Clear` labelled buttons; `AI DRAFT` chip `accessible={false}` (meaning merged into the field label); score card LOCKED state announces `Your vibe scores — locked until an admin approves your listing`; each score bar `accessibilityRole="progressbar"` `accessibilityValue={{min:0,max:100,now:score}}` label `{human label}, {score} out of 100`; card face blurb joins the card's a11y label (`{name}. {pitch}.`); expanded description read in order after the title.
- **Reading order = visual order** on every surface; the score LOCKED body announced once (`accessibilityLiveRegion="polite"` on mount).
- **Dynamic Type:** no fixed text-row heights; the pitch textarea grows; card blurb `numberOfLines={2}` clamps gracefully; score labels `numberOfLines={1}` truncate before overlapping the bar.
- **Reduced motion:** every M-row above has a stated fallback; the draft reveal and bar grow both render final-state instantly.
- **Color never the only indicator:** `AI DRAFT` has text + the helper states it; score strength has the number, not just the fill ramp; the LOCKED scores read as text, not just low opacity.

---

## 9. Per-platform deltas (consolidated)

| Concern | iOS | Android | Web |
|---|---|---|---|
| Wizard/listing cards (`GlassCard`, `deckBlock`) | translucent as built | `deckBlock` rgba(255,255,255,0.06) composites opaque-safe on the solid `canvas.discover`; where true glass (`GlassCard`) is used, the established opaque frost + `overflow:"hidden"` + **NO shadow under the rounded fill** (`androidSafeElevation`→0, `designSystem.ts:26`) — `ANDROID_GLASS_USES_OPAQUE_FALLBACK` | translucent (blur supported) |
| Pitch textarea | native multiline | native multiline | `<textarea>` via RNW; same recipe |
| Draft shimmer | `Skeleton` sweep | `Skeleton` sweep | same; reduced-motion static base |
| Regenerate confirm | `BaseBottomSheet` | same + opaque sheet fill | modal scrim |
| Stepper | 10 dots | 10 dots | 10 numbered circles; 720 col cap |
| Card-face blurb | `oneLiner` 2-line + textShadow | identical (text on gradient, no glass) | identical (RNW) |
| Public "About" + Read more | themed prose | themed prose | themed prose; hover `cursor:"pointer"` on Read more, no layout shift |
| Public sticky pitch (desktop) | n/a | n/a | 2-line clamp in `deskPanel` |
| Colors | hex/rgb/rgba/hsl ONLY (RN color rule) | same | same |

---

## 10. Build-ready handoff + justification ledger

**ZERO new tokens.** New composed values stated inline (`AI DRAFT` chip padV 3; score ghost-preview opacity 0.6; title→blurb 6/0/10 place-card gaps; strength ramp alphas 0.66/0.38). All colors hex/rgb/rgba (RN color rule).

**New components:**
- `VenuePitchField` (§3) — the shared editable-AI-pitch control (wizard s6, claim c5, listing page). Owns states 1–6, `AI DRAFT` chip, Draft/Regenerate/Clear, M-P1…M-P4.
- `VenuePhotosStep` (s3), `VenueCoverStep` (s4), `VenuePriceHighlightsStep` (s7) — migrations of the deck-readiness sub-forms (`VenueDeckReadinessSetup.tsx:488-701`) into wizard steps.

**Modified:**
- `venueWizardValidation.ts` — replace `CREATE_STEPS` with the 10-step folded map (§2.1); extend `venueStepError` (drop the tagline; add s3 ≥5 photos, s4 cover-chosen, s5 website-optional, s6 pitch ≥20, s7 ≥1 tier).
- `VenueCreatorWizard.tsx` — new step bodies in the `switch` (`:468-537`); DELETE the `router.replace(routeForDeckReadinessFix)` success branch (`:405-425`) → land on management "In review".
- `VenueStep7Review.tsx` — the folded summary + submit (§2.3).
- `ClaimStepPitch.tsx` — swap its body to `VenuePitchField` (keep the empty-allowed c5 gate `venueWizardValidation.ts:146-155`).
- `VenueListingContent.tsx` — editable pitch (§4.1), 3-state scores card (§4.2), retire "Changes remaining" (§4.4), re-point `handleEdit` off the dead route (§4.5).
- `VenueIntelligenceModule.tsx` — replace the "run 'Recommend me'" empty copy (`:468-469`) with the LOCKED copy (§4.2).
- **RETIRE** `app/venue/deck-readiness.tsx` + `VenueDeckReadinessSetup.tsx` as a user leg; retire CI gate `i-proposed-1285-...` (F-15).
- **Consumer (app-mobile):** `SwipeableCards.tsx` — `numberOfLines={1}`→`{2}` for the place `oneLiner` (`:3044`) + the scoped title/blurb gaps (§5a); `discover-cards/index.ts` — map `generative_summary`→`oneLiner`/`description` (`:905/:909`); the two RPCs — add `generative_summary` to RETURNS TABLE + SELECT.
- **Public (`PublicVenuePage.tsx`):** `aboutBlock` (§6.1), meta pitch (§6.2), desktop clamp (§6.3); `venue_public_view` + `PublicVenue` type gain `pitch`.

**SPEC-owned contracts this design consumes:** the bio-only pitch action (write ONLY `generative_summary`, no `ai_signal_scores` — D-2/F-14, prefer approve-path invokes the pipeline); the 16-signal eval moved to the approve path; the owner-write persist path for `generative_summary` from the listing page (F-13); `generative_summary` added to both deck RPCs + `venue_public_view` (+ anon-safe gate update); the retirement of the 1285 deck-readiness gate; the regenerate-cap decision (OQ-4); the pitch-generator "hook-first" copy contract (§5a.4). Invariants: keep `I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE` (net-new create rows stay `is_servable=false` until approve); the new `I-PROPOSED-1290-NO-SIGNAL-SCORES-PRE-APPROVE` (investigation §7).

**Regression guards to respect:** `sanitizeAuthoringError` call sites in `VenueCreatorWizard.tsx` (strict-grep) survive; `orch-1255-*` venue gates; append-only test gate; desktop-contract jest suite; `ANDROID_GLASS_USES_OPAQUE_FALLBACK`.

**Justification ledger (why each element exists, everything else cut):**
- One folded wizard — a finished-then-more-work flow is the exact frustration D-1 kills; the claim path already proves single-submit works.
- Contact before Pitch — a pitch drafted with the website in hand is a better first draft; the only reorder vs claim, and it earns itself.
- `VenuePitchField` as ONE component — the pitch must feel identical in the wizard and on the listing page; one control, one behavior, no drift.
- AI DRAFT chip + no typewriter — honest signposting that it's a starting point, without theater that implies live authorship.
- Card blurb = 2-line clamp of the ONE pitch, full pitch on expand — choosing surface vs deliberation surface; never a second field (D-4), never a buried photo (Seth's explicit no-crowd ask).
- `oneLiner` slot reuse — the card already reserved this exact spot; wiring beats inventing.
- Scores LOCKED ghost-preview with no fake numbers — shows what's coming without lying about a zero score; the honest answer to "did it work?" is "a human decides next."
- Score strength ramp + top-6 — glanceability for the owner's strong moments without a rainbow or a wall of bars.
- Public About under the name — the venue's voice before its logistics; the section 1255 promised, finally fed real data.
- Empty = hidden/locked everywhere — a venue with no pitch never shows fake text on any surface. Non-negotiable.
