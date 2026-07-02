# DESIGN — ORCH-1263 [claim-adoption] — claim-variant walkthrough pixel spec

**Phase:** DESIGN (consumed by the forensics SPEC; the implementor builds from the SPEC that embeds this)
**Worktree:** `~/Desktop/mingla-orchs/orch-1263-[claim-adoption]` on `orch-1263-claim-adoption`
**Date:** 2026-07-02
**Inputs:** `Mingla_Artifacts/reports/INVENTORY_ORCH-1263_CREATE_VS_CLAIM.md` (side-by-side table, match seam §1.1, adoption map §2, risks §5); AS-BUILT wizard (`mingla-business/app/venue/create.tsx`, `src/components/venue/VenueCreatorWizard.tsx` — 6 steps per META-ORCH-1255); design system read live at file:line below; `DESIGN_META-ORCH-1255_VENUE_SURFACES.md` patterns honored (status chip §3, card glass §4.2, Android policy §8).
**Voice:** Mingla canonical — warm, plain, zero jargon. **No fabricated data anywhere: absent seeded fields show honest empty states, never placeholders that look real. Every count in this design is computed from actual adopted fields at runtime, never a fixed promise.**

Token provenance (single source, `mingla-business/src/constants/designSystem.ts`): `spacing` :29 · `radius` :39 · `accent` :179 · `canvas` :264 · `glass` :270 · `semantic` :298 · `text` :309 · `blurIntensity` :317 · `easings` :326 · `durations` :334 · `typography` :345 · `venueSettingsMaxWidth` :68. Existing components reused: `Button` (`ui/Button.tsx` — SIZE_HEIGHT sm 36 / md 44 / lg 52 :91, VARIANT_TOKENS :117), `GlassCard` (`ui/GlassCard.tsx:53-70`), `Stepper` (`ui/Stepper.tsx`), `ListingStatusChip` (`venue/ListingStatusChip.tsx`), `BrandHoursEditor` (`venue/BrandHoursEditor.tsx`), `EventCoverMedia`, `Input`, `IconChrome`, `Icon` (set at `ui/Icon.tsx:111-315`).

---

## 0. Cross-surface declaration

| # | Surface | Touched? | What |
|---|---------|----------|------|
| 1 | Business iOS | YES | Match moment, claim wizard (10 steps), review, submit states |
| 2 | Business Android | YES | Same with opaque-glass deltas (§9) |
| 3 | Business web (phone-width + desktop ≥1024) | YES | Same layouts; numbered stepper, hover/focus deltas, 720 column cap (§9) |
| 4 | Admin web | NO — byte-identical | Same approval queue; claim rides the identical pipeline (inventory §3.1) |
| 5 | Consumer app / buyer web | NO — byte-identical | Deck card stays served throughout (I-NO-CLAIM-DEMOTION); no UI change |

Desktop-web 16 contracts honored: everything gates through `useResponsiveLayout()`; no mobile regressions; wizard column capped at `venueSettingsMaxWidth` 720 on ≥1024 (same readable-measure rationale as ORCH-1186-A, designSystem.ts:63-68), left-anchored to the `spacing.md` edge.

**Server-contract note (design consumes, SPEC decides — inventory R-6):** this design needs (a) three presence booleans + a claim-state enum on the SEARCH payload (`hasHours`, `hasPhone`, `hasWebsite`, `photoCount`, `claimState: available | pending | claimed` — booleans defeat the scraping concern that motivated the whitelist; **no rating value ever crosses, rating stays FORBIDDEN**), and (b) full adopted values (phone/website/price_tiers/summary/full gallery) via an AUTHED claim-detail fetch fired on "Yes, this is me". Every element below states its behavior when its datum is absent.

---

## 1. IA & flow

**The user's moment:** a venue owner typed their place's name and just saw it — photos of their own room, their address. Emotion to hit: *recognition, then relief*. "Mingla already knows my place — this will be quick." Every design choice below either (a) proves we really know their place, or (b) converts a data-entry step into a one-tap confirmation.

**The ONE provenance system (dispatch asked for one — chip it is):** a non-interactive **provenance micro-chip** (§3). Tints and full-card washes were rejected: a tint on an editable field reads as a validation state, and a wash can't attach to a single photo tile. A chip travels: it sits on a field label row, on a photo tile, on a review row — one anatomy everywhere. Three states: `On Mingla` (adopted, untouched — green, because this content is literally live on the consumer deck right now), `Edited` (adopted then changed — neutral), `New` (operator-added — info blue, matching the "In review" family: new content pending review). Keep is the default and costs zero taps: leaving an item untouched IS keeping it.

**Flow map:**

```
Gate (name field, create.tsx:243-283)
 ├─ resume card (persisted claim draft exists) ─▶ "Resume" → wizard at saved step   (§8.4)
 ├─ match, claimState=available ─▶ ClaimMatchCard (§4) ─ "Yes, this is me"
 │        └─ authed claim-detail fetch (button loading ≤ its own timeout)
 │             ├─ ok    ─▶ claim wizard c0 (adoption banner reveal, §5.1)
 │             └─ fail  ─▶ inline warn + "Continue anyway" (whitelist-only prefill, §4.6)
 ├─ match, claimState=claimed  ─▶ blocked-politely card (§4.5) → Message support (/support/inbox)
 ├─ match, claimState=pending  ─▶ blocked-politely card, pending copy (§4.5)
 └─ No / Skip ─▶ existing create path (category → 6-step wizard) — UNCHANGED
Claim wizard: c0 Category → c1 Place → c2 Hours → c3 Photos → c4 Cover → c5 Pitch
              → c6 Contact → c7 Price → c8 Bookings → c9 Review
 └─ Submit ─▶ success (standard "In review" chip state, unchanged §8.1)
      ├─ 23505 double-claim ─▶ friendly backstop card (§8.2)
      └─ tier-1 failure     ─▶ "saved, retry" state — resume-not-recreate (§8.3)
```

Error paths: every fetch failure = honest inline error with a way forward; never a blank pane; never a dead six-step walk (claimed places are blocked AT THE GATE — the backstop card §8.2 exists only for the race).

**Step count honesty:** claim mode is 10 steps vs create's 6, yet must FEEL faster — because up to 8 of the 10 arrive filled and cost one tap each. The speed is real (taps, not steps): a fully-seeded place is ~10 taps + 1 mandatory cover choice + 1 pitch skim. The design never claims "N steps done" — it claims "N steps already filled from your listing", computed live (§5.1).

Step map (claim mode replaces `STEPPER_STEPS`, VenueCreatorWizard.tsx:55-62):

| id | Label | Content | Prefill source (coverage) | Empty-state behavior |
|----|-------|---------|---------------------------|----------------------|
| c0 | Category | confirm chip | types mapper — CONFIDENT matches only (§6.1) | picker unselected + honest copy |
| c1 | Place | name + slug + address confirm cards | name/address/pin (100%) | n/a (always present on a match) |
| c2 | Hours | 7-day grid incl. overnight | opening_hours (93.2%) | default week, no chips |
| c3 | Photos | adopted gallery grid | stored_photo_urls (100%, avg 4.8) | add-photos empty state |
| c4 | Cover | THE mandatory decision | chosen FROM c3 gallery or upload (0% have covers) | upload-only variant |
| c5 | Pitch | editable pre-draft | editorial/generative summary (40.9%) | honest empty textarea (59%) |
| c6 | Contact | phone / email / website | phone (51.1%) · website (90.5%) · email (never) | plain empty inputs |
| c7 | Price | tier chips | price_tiers (49.2%) | chips unselected |
| c8 | Bookings | reservations toggle | reservable hint (20%) → SUGGESTION only | plain toggle, off |
| c9 | Review | adopted / edited / added summary | computed | n/a |

---

## 2. Layout & spacing grid

4/8pt grid throughout, all values = `spacing` tokens (xxs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32).

- **Wizard shell:** unchanged (VenueCreatorWizard.tsx:304-366) — chrome row padH `spacing.md` padV `spacing.sm`; Stepper; scroll content `paddingBottom: insets.bottom + spacing.xl`; dock padH `spacing.lg`, padT `spacing.sm`, padB `insets.bottom + spacing.md`, hairline top border rgba(255,255,255,0.12).
- **Step body host:** `gap: spacing.md`, `paddingHorizontal: spacing.lg`, `paddingBottom: spacing.xl` (VenueStep7Review.tsx:87-91 pattern — every claim step reuses it).
- **Cards inside steps:** the `deckBlock` recipe — radius 12, `padding: spacing.md`, bg rgba(255,255,255,0.06), `gap: spacing.sm` (VenueDeckReadinessSetup.tsx:847-852). Flat tint, not blur glass — safe on all platforms as-is.
- **Provenance chip:** padH `spacing.sm` (8), padV 3, radius `radius.full`; sits in a label row with `gap: spacing.sm`, or overlaid `spacing.xs` (4) inset on photo tiles.
- **Density rationale:** confirm steps are SPACIOUS (one card, one decision — choosing); the review step is DENSE (rows at `gap: spacing.sm` — comparing what happened).
- **Desktop ≥1024:** step body column `maxWidth: venueSettingsMaxWidth` (720), left-anchored `spacing.md`; dock buttons right-aligned within the same 720 column.

---

## 3. The provenance chip (ONE component, used by every step)

New component `ProvenanceChip` — sibling of `ListingStatusChip`, deliberately DOTLESS so it can never be misread as a listing status (the status chip's 8×8 dot is its signature, ListingStatusChip.tsx:71).

**Anatomy:** pill radius `radius.full`; padH `spacing.sm` (8), padV 3; single `Text`, `typography.micro` (11/14 w600 letterSpacing 0.4, designSystem.ts:354), `numberOfLines={1}`; `alignSelf: "flex-start"`. Height ≈ 20pt. Non-interactive, `accessible={false}` — its text joins the host row's `accessibilityLabel` (e.g. "Phone, from your existing listing").

| State | Label | Text + (photo-overlay icon) color | Pill bg | Contrast (label on effective bg over canvas #0c0e12) | Meaning |
|---|---|---|---|---|---|
| adopted | `On Mingla` | `semantic.success` #22c55e | `semantic.successTint` rgba(34,197,94,0.18) | 6.9:1 (AA ✓ at 11pt w600) | live listing content, kept by default |
| edited | `Edited` | `text.secondary` rgba(255,255,255,0.72) | rgba(255,255,255,0.10) | 9.8:1 | adopted then changed by the operator |
| new | `New` | `semantic.info` #3b82f6 | `semantic.infoTint` rgba(59,130,246,0.18) | 4.6:1 (AA ✓) | operator-added, wasn't on the listing |

Photo-tile overlay variant (used in §6.4/§6.5): same chip over media needs a scrim — wrap in bg rgba(0,0,0,0.55), radius full, same padding (composited behind the tint). Contrast on worst-case white photo ≥ 4.5:1 via the scrim.

**Rules:** a chip renders ONLY when its datum truly came from `place_pool` (adopted) or the operator acted (edited/new). A field with no seeded value gets NO chip — an empty input with an `On Mingla` chip would be a lie. State transitions are live: editing an adopted field swaps `On Mingla → Edited` in place (§7 motion M-3); reverting text to the exact adopted value swaps back. Color is never the only signal — the label text always renders (WCAG 1.4.1).

---

## 4. THE MATCH MOMENT — ClaimMatchCard (evolution of PoolMatchCard)

`PoolMatchCard.tsx` today: 72×72 photo + name + address + 3 buttons. The evolution keeps the skeleton (GlassCard `elevated`, padding `spacing.md`) and adds the proof-of-knowledge layer. The emotional beat lives in TWO changes: the photo strip (their own room, plural) and the facts row (we counted what we have).

### 4.1 Anatomy (top → bottom, gap spacing.sm between blocks)
1. **Eyebrow** — `We found your place in our directory` — `typography.caption` (12/16 w500 ls 0.2) `text.secondary`. (Today's "We found a match in our directory" is colder; "your place" is the recognition beat.)
2. **Identity row** (flexDirection row, gap `spacing.md`):
   - **Photo strip** replaces the single 72×72: primary photo 72×72 radius `radius.md` (12) + a 28×72 edge stack hinting more — two 28×34 thumbs (radius 6, gap 4) column, from `photoUrls[1]`/`[2]`. 0 photos → 72×72 hue placeholder (`EventCoverMedia` hue fallback — never the current grey #E5E7EB box, PoolMatchCard.tsx:105-110, which reads as broken on the dark canvas). 1 photo → single 72×72, no stack.
   - **Text col** (flex 1, gap `spacing.xs`): name `typography.body` 16 w700 `text.primary` (2 lines max); address line `typography.bodySm` 14 `text.secondary` (2 lines, hidden when absent — as today).
3. **"Already have" facts row** — the proof. Wrap row (`gap: spacing.xs`), micro-fact pills: radius full, padH 8, padV 3, bg rgba(255,255,255,0.08), text `typography.micro` 11/14 w600 `text.secondary` (7.8:1). Facts render ONLY when true, in this order: `{photoCount} photos` (photoCount ≥ 1) · `Hours` (hasHours) · `Phone` (hasPhone) · `Website` (hasWebsite) · `Rated on Google` (hasRating boolean — presence only, value stays banned). Zero facts true → the whole row is HIDDEN (sparse place, §8.5 — no empty pill shells).
4. **Reassurance line** — `Most of your listing is already filled in — claiming takes about two minutes.` — `typography.caption` `text.tertiary` (4.9:1, AA for 12pt). Rendered ONLY when ≥2 facts are true (don't promise speed for a sparse place; sparse variant §8.5 says nothing here).
5. **Actions** (gap `spacing.sm`, unchanged buttons): primary md `Yes, this is me` / secondary md `No, different business` / ghost sm `Skip — create from scratch`.

a11y: card `accessibilityLabel` = "{name}, {address}. Already on Mingla: {facts joined}. Is this your place?" — facts join the label so a screen-reader user gets the same proof.

### 4.2 States
- **Default** — above.
- **Loading (post-YES)** — `Yes, this is me` enters Button `loading` (spinner replaces label, Button.tsx built-in); the other two buttons `disabled`; card content opacity 0.85. No skeleton — the card itself is the loading surface. Label stays "Yes, this is me" (Button loading hides it behind the spinner).
- **Fetch error (claim-detail failed)** — inline warn under actions: `Couldn't pull your full listing — you can still claim and fill things in yourself.` caption `semantic.warning` (8.6:1) + primary button relabels `Continue anyway` (falls back to today's whitelist prefill; adoption chips then render only for fields that DID arrive). Never a dead end.
- **Search list states (gate, unchanged today, restated):** searching → `Searching our directory…` hint caption `text.tertiary` (create.tsx:256-258); search error → warn caption #F59E0B (create.tsx:259-261); no matches → no card, the `Continue without a match` primary lg stands (create.tsx:277-282).

### 4.3 "Already claimed" — blocked politely (claimState = claimed)
Same GlassCard, same identity row (photo strip + name + address — confirm it's the right place before telling them no). Then:
- **Status banner** (replaces facts row): row gap `spacing.sm`, `shield` icon 16 `text.secondary` (Icon.tsx:315), text `This place is already managed on Mingla.` `typography.bodySm` w600 `text.primary`.
- **Body** — `If that's you on another account — or you think that's a mistake — message support and we'll sort it out.` bodySm `text.secondary`, lineHeight 20.
- **Actions:** primary md `Message support` → `/support/inbox` (the shipped business live-chat surface) · ghost sm `Not your place? Create a new listing` → `goToCategory` (the existing No-path). **No "Yes, this is me" button exists in this variant** — the six-step dead walk is designed out at the gate.

### 4.4 "Claim in review" (claimState = pending)
Identical geometry to §4.3; banner text `Someone's claim for this place is being reviewed.`; body `If that claim is yours, it's in good hands — check your other account. If not, tell support now so we can look before it's approved.`; same two actions. (Info, not warning — nothing is wrong yet.) Banner icon `clock` 16.

### 4.5 Multiple matches
List behavior unchanged (create.tsx:262-275, `matchList` gap `spacing.md`). Blocked variants sort BELOW available ones (an available claim is the productive action).

### 4.6 Justifications
Photo strip — their own photos are the single strongest "we know you" proof; presence-facts — convince without widening the anon-ish payload (booleans can't be scraped into a dataset of ratings); blocked-at-gate — R-10's six-step dead walk is a trust killer; support path is chat not email — it's live, it's in-app, it already exists.

---

## 5. PROGRESS + TRUST — the "mostly done already" system

### 5.1 The adoption banner (the reveal moment — replaces poolBanner in claim mode)
Today: one static caption line (VenueCreatorWizard.tsx:322-326). Claim mode replaces it with a GlassCard `base` (radius lg 16, padding `spacing.md`), between Stepper and scroll, marginH `spacing.lg`, marginB `spacing.sm`:
- Row (gap `spacing.sm`): `sparkle` icon 18 `accent.warm` + title `We already know {venue name}` `typography.body` 16 w700 `text.primary`, numberOfLines 1.
- Body: `{n} of {total-1} steps are filled from your listing. Keep what's right, fix what's not.` bodySm `text.secondary` lh 20. **`n` = count of steps c0–c8 whose adopted payload passes that step's validation, computed at wizard entry — live math, never a constant.** If n ≤ 2 (sparse place): body swaps to `We've filled in what we have — the rest is yours.` (no number bragging).
- The banner appears on EVERY step (it is the mode indicator), but collapses after c0 to a single-line variant: icon 14 + `{n} of {total-1} filled from your listing` caption `text.secondary` — padV `spacing.sm`, no card chrome (the full card only on first paint; §7 M-1 animates the collapse). Rationale: the reveal earns 88pt once; on step 6 it would be furniture.

### 5.2 Stepper claim variant (Stepper.tsx gains a per-step `prefilled` flag)
- **Mobile dots** (DOT_SIZE 8, :49): current `accent.warm`, confirmed/visited `text.inverse`, plain future rgba(255,255,255,0.32) — all unchanged (:98-103). NEW: **future steps whose content arrived filled render `rgba(34, 197, 94, 0.45)`** (success at dot-legible alpha). Read: "already has content, awaiting your look" — distinct from both white-32 (empty future) and white (confirmed). A visited prefilled dot becomes standard white — confirmation converts green to done. 10 dots × 8 + 9 gaps × 8 = 152pt — fits every phone.
- **Caption** (mobile): `Step {N} of 10 · most are quick confirms` when n ≥ 6, else standard `Step {N} of 10` (caption token, :187-193). Never overpromise a sparse place.
- **Web numbered circles** (:120-164): future-prefilled circles get bg `semantic.successTint`, border rgba(34,197,94,0.45), number `text.secondary`. Current/completed unchanged (accent). Connector fill behavior unchanged (280ms, :51). 10 circles × 24 + 9 connectors × min 24 = 456pt — fits the 720 column.
- **NOT done:** no checkmarks on unvisited steps (a check before the operator looked is a fabricated claim), no percentage bar (steps aren't equal-weight; a % would lie).

### 5.3 Dock CTA labels (the zero-effort keep affordance)
The dock (VenueCreatorWizard.tsx:338-365) keeps Back ghost lg + primary lg. Primary label per state:
- Step arrived adopted AND untouched AND valid → **`Keep & continue`** — one tap IS the keep.
- Operator changed anything this step → **`Save & continue`**.
- Nothing was adopted for this step → **`Continue`** (create parity).
- c4 Cover (nothing adopted by definition) → `Continue` once a cover is chosen; disabled until then (§6.5).
- c9 Review → `Submit for review` (unchanged).
Disabled treatment = existing Button disabled (visibly greyed, B2 contract, VenueCreatorWizard.tsx:106-110).

---

## 6. THE ADOPTION WALKTHROUGH — step by step

Every step: body host per §2; each adopted item carries its ProvenanceChip in the field-label row (label left, chip right of label text, gap `spacing.sm`); keep = do nothing; edit = the field's normal editor; delete = explicit control where removal is meaningful (photos, phone, pitch draft — stated per step). Titles `typography.h3` 20/32 w600 `text.primary`; helpers bodySm `text.secondary`.

### 6.1 c0 — Category (confirm, never fabricate)
R-8 is a design kill: 97% of places would silently land "restaurant". Rule: **preselect ONLY on a confident mapping** (primary_type in the play / creative_arts families, or a true restaurant-family type per the mapper's explicit arms). The everything-else→restaurant default is NOT confidence — those places arrive UNSELECTED.
- Confident: title `What kind of place is it?`, helper `Our directory says {label} — change it if that's not right.`, existing `VenueCategoryPicker` with the derived value selected + `On Mingla` chip in the helper row. Dock: `Keep & continue`.
- Unconfident: same picker, nothing selected, helper `Pick what fits best — our directory wasn't sure.` No chip. Dock: `Continue`, disabled until picked.

### 6.2 c1 — Place (name + address, confirm not re-enter)
Two cards (deckBlock recipe), NOT two empty editors — the claim moment is "confirm what we have":
- **Name card:** label row `NAME & LINK` (`typography.labelCap` 12/16 w600 ls 1.4 `text.tertiary`) + chip `On Mingla`. Value: name `typography.body` 16 w600 `text.primary`; slug line `usemingla.com/b/{brandSlug}/v/{slug}` caption `text.tertiary`, numberOfLines 1. Trailing `edit` icon 18 `text.secondary` (Icon.tsx:156), whole card pressable → expands in place to the existing `VenueStep2NameSlug` editor (slug availability logic untouched); card border becomes `glass.border.profileElevated` while expanded. On any change: chip → `Edited`.
- **Address card:** label row `ADDRESS` + chip. Value: formattedAddress body 16 `text.primary` (2 lines). Pressable → existing `VenueStep1Address` (Mapbox re-pick; the ORCH-1079 googlePlaceId lock is untouched — the design never exposes the pool link to editing).
- Collapsed cards are single-tap targets, min height ≥ 64pt. a11y: role button, label `{label}: {value}, from your existing listing. Tap to edit.`

### 6.3 c2 — Hours (pre-filled grid + overnight, the F-2 blocker made visible)
Reuses `BrandHoursEditor` (day rows :592-600, timeBtns :616-631) with the adopted week from `mapPoolOpeningHoursToBrandHours`. Additions:
- **Provenance:** one chip in the step header row (`OPENING HOURS` labelCap + `On Mingla`), NOT per day-row — 7 chips would be noise; the week was adopted as a unit. Any change to any row flips the single chip to `Edited`.
- **Cross-midnight display (the design contract for R-2 — validator/editor extension is the SPEC's):** a row where `close <= open` is an **overnight span**, rendered as: Closes timeBtn value `{HH:MM}` with a second line inside the same timeBtn — `next day` — `typography.micro` 11/14 w600 `text.tertiary`, marginTop 1. The Opens btn is unchanged. Example: Fri · Opens 22:00 · Closes 02:00 ⁄ *next day*. No parentheses, no "+1" jargon — plain words.
- Day-row summary for closed-following-overnight stays honest: Saturday that only exists as Friday's spill is CLOSED in the grid (the mapper keys by open-day; the display never invents a Saturday shift).
- **Error states:** missing time on an open day → existing copy (BrandHoursEditor stepErr :156-168). `open == close` exactly → `Open and close can't be the same time.` (24h venues are out of scope; never render "Open 24 hours" from equal times). The current "Overnight hours … aren't supported yet" copy DIES with this design.
- a11y: overnight Closes button label `Friday closing time, 2 AM next day`.

### 6.4 c3 — Photos (the adopted gallery: keep / delete / reorder / add)
Grid = the proven deck-readiness geometry: wrap row gap `spacing.sm`, tiles 92×92 radius 10 (VenueDeckReadinessSetup.tsx:867-877). At 375pt width with padH 24: 3 columns (3×92 + 2×8 = 292 ≤ 327). Content:
- Title `Your photos`; helper `These are already on your Mingla listing. Remove any that shouldn't be here, drag to reorder, add better ones.` Counter line `{n} photos · at least {GALLERY_MIN} to go live` caption `text.tertiary`, flips to `semantic.success` w700 at ≥ min (galleryCountOk parity :895-898).
- **Per-tile:** adopted tiles carry the overlay ProvenanceChip `On Mingla` (scrim variant §3) bottom-left inset 4; operator-added tiles carry `New`. Delete = the existing × control ENLARGED: 24×24 (was 22, :878-888), bg rgba(0,0,0,0.6), hitSlop 10 → ≥44pt effective; label `Remove photo {i} of {n}`.
- **Reorder:** long-press 300ms lifts the tile (§7 M-4), drag over the wrap grid, siblings shift (layout-animated). Order = public gallery order; first position gets a corner badge `1st` (micro chip, neutral) so order visibly matters. Web: pointer drag, same visuals; keyboard alternative: focused tile + Enter opens a move menu (`Move earlier / Move later / Make first`) — drag is never the only path (WCAG 2.5.7).
- **Add:** secondary md button `Add photos` leadingIcon `upload` (existing pattern :561-575).
- **Deleting an adopted photo is CLIENT-STAGED** (copy-on-start boundary, inventory §2): nothing touches the live listing until submit→confirm. Deleting below GALLERY_MIN just re-arms the counter; the step never hard-blocks (min is enforced at go-live, not at claim — matches today's deck-readiness gate).
- **Empty (0 seeded — not observed in prod, designed anyway):** helper `No photos on file — add at least {GALLERY_MIN} so people can picture your place.`, grid absent, add button primary-weighted (variant secondary → primary). No chips.

### 6.5 c4 — COVER CHOOSER (new step — the hero moment, the one mandatory decision)
The payoff framing: after five confirmations, this is the step where the owner ADDS the thing Mingla doesn't have (0% of seeded places have covers). It must feel like choosing the poster, not filling a field.
- **Title** `Pick your cover` h3; helper `The first thing people see when Mingla recommends you. Make it the shot you're proudest of.` bodySm `text.secondary`.
- **Preview band (top, appears on selection):** `EventCoverMedia` height 170, radius 12, full column width — identical geometry to the deck-readiness hero preview (:497-508), so what they pick here is literally what they'll see there. Before selection: the band is ABSENT (no grey placeholder rectangle — absence is honest).
- **Chooser grid:** 2-up large-tap tiles from the c3 gallery (current order): tile width = (colWidth − spacing.sm)/2 → 159pt at 375 (fluid; desktop 720 col → 4-up at ~172pt via the same wrap math), height = width × 1.25 (4:5 portrait, the deck card's aspect family), radius `radius.lg` 16, overflow hidden. Gap `spacing.sm` both axes.
  - **Selected:** border 2 `accent.warm` + check badge 24×24 top-right inset 8 (bg `accent.warm`, radius full, `check` icon 14 `text.inverse`) + the preview band populates. Exactly one selectable.
  - **Unselected:** border 1 `glass.border.profileBase`.
  - **Pressed:** scale 0.97 (§7 M-5).
- **Upload tile:** same geometry, border 1 dashed `glass.border.profileElevated`, bg `glass.tint.profileBase`, centered `upload` icon 28 `text.secondary` + label `Upload new` bodySm w600 `text.secondary`. Opens the existing CoverPicker flow (image/video); a finished upload becomes a `New`-chipped tile in the grid, auto-selected.
- **On selection**, helper swaps to `Looking good.` bodySm `accent.warm` w600 — the single permitted flourish (personality is baked in, one line, no confetti).
- **Dock:** `Continue`, DISABLED until a selection exists — this is the one mandatory decision and the UI says so honestly: sub-dock caption when disabled: `Pick a cover to continue` caption `text.tertiary`, centered.
- **Empty gallery variant (0 photos at c4):** grid absent; upload tile renders full-width at height 170; helper `Add your best shot — photo or short video.`
- a11y: tiles role `button` (radio semantics via `accessibilityState={{ selected }}`), label `Photo {i} of {n}{selected ? ", selected as cover" : ""}`; grid container `accessibilityLabel="Choose a cover photo"`.
- **Provenance:** gallery-sourced tiles need no chip here (the whole grid is explicitly "from your photos"); only the uploaded tile carries `New`. Chips on every tile would bury the check badge.

### 6.6 c5 — Pitch (41% pre-drafted / 59% honest empty)
- **Seeded (editorial/generative summary present):** title `Your pitch`; **the "we wrote a starting point" note** — a distinct note row above the textarea: `sparkle` icon 14 `accent.warm` + `We wrote a starting point from your listing — make it yours.` caption `text.secondary`. Textarea = existing input recipe (minHeight 150, radius 12, bg rgba(0,0,0,0.18), border rgba(255,255,255,0.12) — VenueDeckReadinessSetup.tsx:985-998) pre-filled with the summary; label row `PITCH` labelCap + chip `On Mingla` → `Edited` on change. **Delete affordance:** ghost sm `Start fresh` under the textarea — clears to empty (chip disappears; this is the one field where "delete the draft" is a real intent). Char rule unchanged (≥20).
- **Empty (59%):** no note row, no chip, no fake draft. Placeholder `What makes your place worth the trip?` (`text.tertiary` placeholder color); helper `Tell people what to expect — at least 20 characters. Our AI polishes it later; honest beats fancy.` Dock `Continue` (disabled until valid, existing rule).
- The kept-verbatim draft becomes the AI operator seed downstream (inventory s4) — the note's "make it yours" nudges real input without blocking a keep.

### 6.7 c6 — Contact (phone / email / website)
Three labeled fields (existing Input / input recipe):
- **Phone:** pre-filled from `national_phone_number` when present (51.1%) + chip `On Mingla`; clear-field × inside the input (delete affordance — validation still requires ≥1 of email/phone). Absent → plain empty input, no chip.
- **Email:** ALWAYS operator-entered (no pool source exists) — plain input, never chipped.
- **Website:** pre-filled (90.5%) + chip. (Moves INTO the wizard from deck-readiness for claim mode — it's adopted content and belongs in the walkthrough; dispatch scope.)
- Helper `People reach you here — check it's current.` Error (both phone+email empty): existing copy `Add an email or phone number.`

### 6.8 c7 — Price (pre-selected tiers)
Existing PRICE_TIERS_BIZ chip row verbatim (36pt-min chips, radius 18, active rgba(255,138,76,0.16)/border 0.7 — :1004-1025; hitSlop {top:4,bottom:4} added → ≥44pt). Label row `PRICE RANGE` labelCap + chip `On Mingla` when `price_tiers` seeded (49.2%); helper `Pick all that fit a normal visit.` Toggling any tier → `Edited`. Unseeded → unselected chips, no provenance chip, helper unchanged. Dock `Keep & continue` / `Save & continue`; selection required (parity with deck-readiness must-have).

### 6.9 c8 — Bookings (the suggestion treatment — never auto-on)
- **Base row (all places):** deckBlock card, row: text col (label `Take reservations on Mingla` body 16 w600 `text.primary`; sub `You can set tables, times and fees after you're live.` caption `text.tertiary`) + `BrandSwitch` right, **value OFF** (DB default false is probe-locked, R-11 — the design never fights it).
- **Suggestion variant (reservable hint = true, 20%):** ABOVE the toggle row, an info hint row inside the same card: `calendar` icon 14 `semantic.info` + `Google shows you take reservations — flip this on and Mingla can take bookings too.` caption `text.secondary` + chip `Suggested` (info family — the ONE place the chip text differs; it is a suggestion, not adopted content). **The switch still starts OFF.** Operator flips it → hint row fades out (§7 M-6), sub-label swaps to `We'll walk you through setup after approval.`
- No hint → no row, nothing implied. Dock: `Keep & continue` (off is a valid keep) — this step can never block.

### 6.10 c9 — Review (adopted vs edited vs added, then the same machine)
Title `Review & submit` h3; helper `Your listing stays live while we check this — approval usually lands within 4 business hours.` (merges the existing 4-hour promise, VenueStep7Review.tsx:39-42, with the stays-live trust fact from I-NO-CLAIM-DEMOTION).
Three group cards (deckBlock), rendered only when non-empty, in this order:
1. `KEPT FROM YOUR LISTING · {n}` labelCap header — rows of untouched-adopted items.
2. `YOU CHANGED · {n}` — edited items.
3. `YOU ADDED · {n}` — new items (always contains Cover).
**Row anatomy** (dense — comparing): k/v pattern from VenueStep7Review (:107-119 — k caption uppercase ls 0.5 `text.tertiary`, v body 16 `text.primary` numberOfLines 2) + trailing ProvenanceChip + `chevR` 16 `text.tertiary`. Whole row pressable → jumps to that step (`setStep`), role button, label `{k}: {v}, {chip}. Tap to change.` Row padV `spacing.sm`, hairline separators rgba(255,255,255,0.08). Photos rows summarize: `Photos · {kept} kept, {removed} removed, {added} added`; Cover row shows a 40×50 thumb of the chosen cover (radius 6) beside the value.
Submit button primary lg `Submit for review`, loading label `Submitting…` (existing). Submit errors §8.2/§8.3.

---

## 7. Motion spec (every animation: trigger → curve → duration → property → reduced-motion)

| # | Moment | Trigger | Property + values | Curve / duration | Reduced motion |
|---|--------|---------|-------------------|------------------|----------------|
| M-1 | Adoption banner reveal | claim wizard first mount | card opacity 0→1, translateY 8→0; then on leaving c0 the card collapses to the one-liner: height animates (measured→32), body/title cross-fade | entry: `durations.entry` 260 `easings.out`; collapse: `durations.normal` 200 `easings.inOut` | instant render; collapse = instant swap |
| M-2 | Step transition | goNext / goBack / review-row jump | outgoing translateX 0→∓24, opacity 1→0 (`durations.exit` 180, `easings.in`); incoming translateX ±24→0, opacity 0→1 (`durations.entry` 260, `easings.out`); direction follows navigation | as stated | instant swap |
| M-3 | Provenance chip state flip (On Mingla → Edited and back) | first change to an adopted field | chip cross-fade: old opacity 1→0 / new 0→1 in place, no width jump (both labels short; container animates width via layout if needed) | `durations.fast` 120 linear | instant swap |
| M-4 | Gallery tile lift + reorder | long-press 300ms | scale 1→1.05, shadow `glassBadge`; siblings reflow via layout animation; drop: scale→1 | lift spring damping 18 stiffness 220; reflow `durations.normal` 200 `easings.inOut` | no scale; tile gets 2px accent border while "held"; reflow instant |
| M-5 | Cover select | tap tile | tile scale 1→0.97→1 (press spring); border color 0→`accent.warm` opacity 0→1 (120ms); check badge scale 0.6→1 (`durations.fast` 120 `easings.out`); preview band: opacity 0→1 + translateY 6→0 (`durations.entry` 260 `easings.out`) | as stated | border + badge + band appear instantly |
| M-6 | Bookings hint dismiss | switch flips on | hint row opacity 1→0, height→0 | `durations.normal` 200 `easings.in` | instant removal |
| M-7 | Chip entrance per step | incoming step settles (M-2 end) | chips opacity 0→1, translateY 4→0, single 120ms delay after M-2 (no stagger — ≤3 chips/step; stagger would read as loading) | `durations.normal` 200 `easings.out` | render with content |
| M-8 | Stepper prefilled-dot confirm | leaving a prefilled step forward | dot color green-45 → `text.inverse` | `durations.fast` 120 linear | instant |

Web: M-2 becomes fade-only (opacity, 200ms) — horizontal slides fight browser back-gesture affordances. All reanimated; every hook checks `useReducedMotion` (pattern: Stepper.tsx:60-75).

---

## 8. EDGE STATES

### 8.1 Submit success → standard pending state (unchanged machinery)
Success screen (create.tsx:197-224 shell): title `That's it — {name} is in review` h3; body `Your listing stays live while we verify it's really you. Approval usually lands within 4 business hours.` body 16 `text.secondary` lh 22; `Done` primary lg → the venue's management page, where the EXISTING `ListingStatusChip` shows `In review` (info tone) — chip system byte-identical (1255 D-4; this design adds zero states to it).

### 8.2 Double-claim at submit (23505 backstop — the race the gate can't catch)
Replaces the raw support copy (venueListingsService.ts:160-171 surfaces it; design owns presentation). Inline error card on c9 (deckBlock, border 1 `semantic.warning`, bg `semantic.warningTint`): title `Someone's already claiming this place` body 16 w700 `text.primary`; body `A claim for this place is already in review. If that's you on another account — or it shouldn't be — message support and we'll sort it out.` bodySm `text.secondary` lh 20; actions row gap `spacing.sm`: primary md `Message support` → `/support/inbox` · ghost md `Back to my venues`. The wizard does NOT clear the draft (their work survives while support sorts it).

### 8.3 Half-claim retry — submit partially failed (R-7: venue row created, tier-1 died)
The SPEC's contract is resume-not-recreate; the design states the face of it: inline error card on c9 (warning recipe as §8.2): title `Saved — but the last step hiccuped`; body `Your claim is safe. Try again and we'll pick up exactly where it stopped.`; primary md `Try again` (re-runs from the failed stage; never re-walks steps, never re-fires the row insert). If retry hits 23505 against the operator's OWN row, it must resolve as resume — the §8.2 card is reserved for genuinely foreign claims (SPEC distinguishes by owner).

### 8.4 Pick up where you left off (pre-submit abandon)
Gate phase, when a persisted claim draft exists for the current brand (`placePoolId !== null`), a resume card renders ABOVE the name input (GlassCard `elevated`, padding `spacing.md`): row — photo 56×56 radius `radius.md` (draft's first gallery URL; hue fallback) + col (name body 16 w700; `You're on step {step+1} of 10 — nearly there.` caption `text.secondary`) ; actions: primary md `Resume claim` → wizard at persisted step (the store's `step` field already survives, draftVenueStore.ts:54-58) · ghost sm `Start over` → confirm dialog (`Throw away this claim draft?` / destructive `Start over` / cancel), then `reset()`. The abandon boundary stays clean: nothing server-side ever happened (inventory §2).

### 8.5 Sparse place (no summary, no phone, few facts)
- Match card: facts row shows only what's true; ≤1 fact → reassurance line hidden (§4.1) — the card promises nothing it can't deliver.
- Banner: `We've filled in what we have — the rest is yours.` (§5.1).
- c5 empty textarea, c6 empty phone, c7 unselected chips, no provenance chips anywhere they'd be false. The walkthrough silently degrades toward create-mode — same steps, honest emptiness, zero fake pre-fill.

### 8.6 Overnight-heavy place (bar cohort, 4,211 servable)
Fully handled by §6.3: adopted 22:00–02:00 rows render with `next day`, pass through untouched as a Keep, and the step indicator counts hours as filled. No "review this day" interstitial — the plain-words display IS the review.

---

## 9. Per-platform deltas

| Concern | iOS | Android | Web |
|---|---|---|---|
| Match/resume/banner cards (GlassCard) | translucent stack as built (GlassCard.tsx:53-70) | GlassCard's chrome renders over `canvas.discover`; any NEW flat card in this spec uses the deckBlock rgba(255,255,255,0.06) tint (composits opaque-safe on the solid canvas); where true glass is specified (match card, banner) the Android fill is the established opaque frost `rgba(20,22,26,0.92)` + `overflow:"hidden"`, NO shadow under the rounded fill (ANDROID_GLASS_USES_OPAQUE_FALLBACK) | translucent (blur supported) |
| Stepper | dots (claim green-45 prefilled state) | dots, same | numbered circles + successTint prefilled fill (§5.2) |
| Step transition | M-2 slide+fade | same | fade-only 200ms |
| Hours time control | spinner modal (BrandHoursEditor :456-473) | system dialog (:475-482) | `<input type="time">` (:499-522); `next day` micro-line renders under the Closes control identically |
| Gallery reorder | long-press drag + haptic (light impact on lift) | long-press drag (no haptic API assumption beyond RN default) | pointer drag + keyboard move menu (§6.4) |
| Hover/focus | n/a | n/a | tiles/cards/rows: `cursor:"pointer"`, hover bg lift to `glass.tint.profileElevated`, `:focus-visible` border → `accent.border`; zero layout shift |
| Column | full width | full width | <1024 full; ≥1024 `maxWidth: 720` left-anchored (§2) |
| Colors | hex/rgb/rgba/hsl ONLY (RN color rule) | same | same |

---

## 10. Accessibility (binding)

- Contrast (all on effective bg over `canvas.discover` #0c0e12): success chip 6.9:1 · info chip 4.6:1 · neutral chip 9.8:1 · facts pill 7.8:1 · warning text 8.6:1 · text.secondary 10.4:1 · text.tertiary 4.9:1 (12pt+ only — never below caption) — all AA ✓. Check badge `text.inverse` on `accent.warm` follows the app-wide established action pairing (ORCH-1101 precedent, designSystem.ts:208-214).
- Targets ≥44pt: cover tiles 159×199 · gallery delete 24 + hitSlop 10 · price chips 36 + hitSlop {4,4} · c1 cards ≥64 · all Buttons ≥36+hitSlop per kit. I-38 ✓.
- Roles/labels: every Pressable carries role + label (stated per section); provenance chips `accessible={false}` with text merged into host labels; cover grid uses `accessibilityState.selected`; stepper dots decorative (caption carries the state).
- Reading order = visual order; the adoption banner is announced once on wizard entry (`accessibilityLiveRegion="polite"` on first mount only).
- Dynamic Type: no fixed text heights; chips/pills grow; the 2-up cover grid drops to 1-up when the computed tile width < 140pt after font scaling pushes the column.
- Reduced motion: every row of §7 has its stated fallback; drag has a non-gesture path.
- Color never sole indicator: chips have labels; overnight has words; prefilled dots are paired with the caption text.

---

## 11. Build-ready handoff

**ZERO new tokens.** New values composed from existing tokens only (chip padV 3, dot green rgba(34,197,94,0.45), tile math) — stated inline above.
**New components:** `ProvenanceChip` (§3) · `ClaimMatchCard` (evolution of `PoolMatchCard`; keep the old export until the SPEC swaps call sites) · `ClaimAdoptionBanner` (§5.1) · `CoverChooserStep` (§6.5) · claim step bodies c0–c9 where they diverge from the existing `VenueStep*` (c2 wraps `BrandHoursEditor`; c1 wraps Steps 1–2 as collapsed cards; c7 reuses the PRICE_TIERS_BIZ row; c8 reuses `BrandSwitch`).
**Modified:** `Stepper` (additive `prefilled?: boolean` per step, §5.2) · `VenueCreatorWizard` (claim step map + dock labels + banner slot) · gate phase in `create.tsx` (resume card, blocked variants, YES-loading).
**RN primitives throughout** (`StyleSheet.create`); reanimated for §7; no new deps except a drag solution the SPEC selects (or long-press + move-menu only, which needs none).
**SPEC-owned contracts this design consumes:** search-payload presence booleans + claimState; authed claim-detail fetch; overnight validator/mapper extension (close.day-aware); client-staged photo model + non-destructive write boundary (R-1/R-3); resume-not-recreate (R-7); draft-store adoption/provenance fields (R-9); confident-category mapping arms (R-8).
**Regression guards:** `sanitizeAuthoringError` call sites in the wizard (strict-grep) · `orch-1255-no-hidden-brand-on-venue-create.mjs` (nothing here touches brand creation) · append-only test gate · desktop-contract suite.

**Justification ledger:** chip-not-tint — one anatomy travels to fields, tiles and review rows; presence-facts — proof without scraping surface; blocked-at-gate — kills the six-step dead walk; green prefilled dots — "already has content" without claiming "done"; Keep & continue — the zero-effort keep is the CTA itself; cover as its own step — the one mandatory decision deserves the stage; no % progress bar — steps aren't equal, a bar would lie; unconfident category unselected — 34,179 silent "restaurant"s was fabrication at scale; overnight in words — "next day" beats notation; review in three groups — the operator's last question is "what did I just agree to". Everything not listed was cut.
