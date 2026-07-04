# INVESTIGATION — META-ORCH-1290 [venue authoring: one-submission + score-on-approve + pitch-only]

**Phase:** INVESTIGATE (no code changed; recommend-don't-build)
**Branch / worktree:** `orch-1290-venue-authoring-one-submission` @ `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` (rebased on `origin/main` `a577cd34c`)
**Date:** 2026-07-03
**Sourcing:** all code read from the rebased worktree = current `origin/main`.
**Confidence:** proven by direct code-read. This is a static data-flow / architecture-map investigation (backend + edge-fn + view SQL + client code), which is exempt from the live-fire directive (PD-7: "pure backend / SQL / migration / edge-function / CI investigations, and investigations explicitly scoped 'code audit only'"). Every claim below cites file:line on current `origin/main`. A consumer-sim eyeball would *seal* the card verdict but cannot change it — the card's description is a hardcoded literal.

---

## 0. EXECUTIVE SUMMARY (layman) — answers the pitch-on-card question FIRST

**The pitch is shown NOWHERE a user can see it. It is NOT on the consumer swipe card, and it is NOT on the public venue page.** The swipe card renders only the venue name, photo, and metadata badges (distance / time / rating / price); the place-card builder in `discover-cards` literally hardcodes the card's description to an empty string (`description: ''`, line 905) and the blurb slot (`oneLiner`) to `null`, and the consumer app has **zero** references to `generative_summary` under any spelling. The public venue page (`/b/{slug}/v/{slug}`) shows name, "By {brand}", address, hours, map, gallery and menu — its data source, `venue_public_view`, does **not even SELECT** a pitch/summary/tagline/description column, and the page's meta description is a mechanical `"{name} — {brand} on Mingla"`.

**Where the pitch (`place_pool.generative_summary`) actually goes today:** (a) it is an **input to the AI signal-scoring** (`signalScorer.ts:266` concatenates it into the scored text), and (b) it is displayed to the **owner** on their own listing-management page as "Your pitch" (read-only). That's it. So **D-4's stated premise — "the pitch is the one public blurb" — is false as-built.** Collapsing tagline+description into one "pitch" is still worth doing for authoring simplicity, but Seth should decide *whether that pitch should ALSO become the consumer-facing blurb* (a bigger, separate change: wire `generative_summary` into `discover-cards` and into `venue_public_view`), because right now it never reaches a consumer's eyes.

**On the redesign itself:** the plumbing is already ~60% where Seth wants it. The blend step (`run-signal-scorer` → `place_scores`) **already runs only at admin approve** (`admin-review-venue-claim` → `runApproveGoLive`). The owner's post-approval per-signal 0-100 breakdown (D-5) **already exists** on the listing page. The two real gaps are: (1) the **Gemini evaluation that produces `ai_signal_scores` runs during authoring** (`handleTier2`), which D-2 forbids — it must move to the approve path; and (2) the **create path forces a separate post-submit "deck-readiness" leg** (cover/gallery/price/facets + the "Recommend me to users" button), which D-1 wants folded into one wizard submit. The claim path is already a single stage-only wizard and is the shape the create path should converge toward.

**D-3 recommendation (pitch AI-draft at submit, scores at approve):** SPLIT the one Gemini call into two — a **bio+facets draft call at submit** and a **16-signal evaluation call at approve** — rather than "compute-everything-at-submit-but-withhold." D-2's words are "no AI signal scores **computed** *or* shown pre-approval"; a withhold-but-compute approach still computes them pre-approval and violates the letter of D-2 (and keeps the current sole-owner writer). The split honors D-2 literally, at the cost of a second Gemini call at approve (latency lives in the admin action, not the owner's submit).

---

## 1. Q-SCORECARD

**Q1 — What does the consumer swipe card render for a place; is it `generative_summary`?**
**Verdict: NO — proven.** Card face = title + `oneLiner` (hardcoded `null` for places) + badges; expanded detail = `description` (hardcoded `''` for places) + a *separate* "Why we picked this" blurb sourced from `ai_reasoning` (a scoring byproduct, not the pitch). `generative_summary` appears in **zero** app-mobile files. See F-1, F-2, F-3.

**Q1b — Does the public venue page show `generative_summary` as the pitch?**
**Verdict: NO — proven.** `venue_public_view` does not select any summary/pitch/tagline/description column; `PublicVenuePage.tsx` renders no pitch body; meta description is mechanical. See F-4, F-5.

**Q2 — Where is `generative_summary` written (create / claim / approve)?**
**Verdict:** create-apply → `handleConfirmAiOutputs` writes `generative_summary: salesBio` (`:1561`); claim stage → NOT written pre-approve, applied at approve by `authoredApply.ts` (`confirmed_ai_outputs.sales_bio → tier1.description(≥20) → omit`). See F-6, F-7.

**Q3 — Where does the AI 16-signal scoring run today, and the blend?**
**Verdict:** the Gemini eval that produces `ai_signal_scores` runs **pre-approval** in `handleTier2` (`:1424`) during the deck-readiness leg; the blend `run-signal-scorer` → `place_scores` runs **at approve** in `runApproveGoLive` (`:189-213`). D-2 requires moving (1) to approve. See F-8, F-9.

**Q4 — What is the "Recommend me" / deck-readiness leg, and what gates `deck_eligible`?**
**Verdict:** post-1285, create success `router.replace`s to a durable `/venue/deck-readiness` route mounting `VenueDeckReadinessSetup`; it collects cover/gallery/price/facets, fires `run_tier2_pipeline` ("Recommend me to users"), then `confirm_ai_outputs` sets status `deck_eligible` (bouncer servable + ≥5 gallery). See F-10, F-11.

**Q5 — Does D-5 (owner sees 16-signal breakdown post-approval) already exist?**
**Verdict: YES, largely — proven.** `VenueListingContent.tsx:222-390` + `VenueIntelligenceModule.tsx:436-469` render per-signal 0-100 bars from `ai_signal_scores.score_0_to_100` with a "Not scored yet" empty state. See F-12.

**Q6 — Is the pitch editable later from the listing page (D-3)?**
**Verdict: NO — proven.** Listing shows "Your pitch" as read-only `<Text>` (`VenueListingContent.tsx:358-363`); no edit/regenerate affordance there. `regenerate_sales_bio` action exists in the edge fn but is only wired inside the deck-readiness leg. See F-13.

**Q7 — Which invariants + CI gates fight this redesign?**
**Verdict:** `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` (two-writer allowlist) + gate `i-ai-signal-scores-column-sole-owner.mjs`; the 1285 gate `i-proposed-1285-create-lands-on-durable-deck-readiness.mjs` (directly inverted by D-1); `I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE` + its stage-only gate; `orch-1255-*` venue gates; the Sub-D staleness trigger/gate. See §5 + F-14, F-15.

---

## 2. INVESTIGATION MANIFEST (files read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `supabase/functions/discover-cards/index.ts` | edge | consumer deck response shape + place-card transform |
| 2 | `app-mobile/src/services/deckService.ts` | client | card→Recommendation mapping (description/oneLiner) |
| 3 | `app-mobile/src/components/SwipeableCards.tsx` | client | swipe card FACE render |
| 4 | `app-mobile/src/components/ExpandedCardModal.tsx` | client | expanded place detail render |
| 5 | `supabase/migrations/20261130000003_orch_1255_claim_rpcs_public_views.sql` | schema | `venue_public_view` columns |
| 6 | `supabase/migrations/20261130000000_orch_1255_venue_listings_core.sql` | schema | `venue_listings` columns (no pitch col) |
| 7 | `mingla-business/src/components/venue/PublicVenuePage.tsx` | client | public venue page render |
| 8 | `supabase/functions/run-business-place-authoring-pipeline/index.ts` | edge | 8 actions; `handleTier2`, `handleConfirmAiOutputs` |
| 9 | `supabase/functions/admin-review-venue-claim/index.ts` | edge | approve orchestration; scorer invoke; authoredApply |
| 10 | `supabase/functions/_shared/authoredApply.ts` | edge | approve-time `generative_summary` apply |
| 11 | `supabase/functions/_shared/signalScorer.ts` | edge | blend/veto; `generative_summary` as scored input |
| 12 | `supabase/functions/run-signal-scorer/index.ts` | edge | reads `ai_signal_scores`, writes `place_scores` |
| 13 | `mingla-business/src/components/venue/VenueCreatorWizard.tsx` + `venueWizardValidation.ts` | client | create/claim step maps |
| 14 | `VenueStep6Description.tsx`, `claim/ClaimStepPitch.tsx` | client | copy fields (tagline/description/pitch) |
| 15 | `VenueDeckReadinessSetup.tsx` | client | deck-readiness leg fields + "Recommend me" |
| 16 | `VenueListingContent.tsx`, `VenueIntelligenceModule.tsx` | client | D-5 score view + pitch display |
| 17 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | docs | AI-signal / 1263 / 1255 invariants |
| 18 | `.github/scripts/strict-grep/*.mjs`, `strict-grep-mingla-business.yml` | CI | gates that fight the change |

---

## 3. FINDINGS (six-field)

### F-1 — Consumer swipe card place description is a hardcoded empty string
- **Symptom:** a business's authored pitch never appears on the consumer card.
- **Layer:** code (edge).
- **Probe:** read `transformServablePlaceToCard` — the sole place-card builder for all 3 serve paths (solo `:2457`, intersection `:1621`, collab `:1199`).
- **Evidence:** `supabase/functions/discover-cards/index.ts:905` `description: '',` and `:909-910` `oneLiner: null, tip: null,`. The RPC row (`query_servable_places_by_signal`) is transformed with these literals regardless of any `generative_summary` on the row.
- **Mechanism:** every place card the consumer sees carries an empty description → the pitch cannot reach the card.
- **Severity:** CONFIRMED (premise-defining).

### F-2 — Client maps `description`/`oneLiner` straight through; face shows `oneLiner` only
- **Symptom:** card face shows name + badges, no blurb.
- **Layer:** code (client).
- **Probe:** read `unifiedCardToRecommendation` + the card-face JSX.
- **Evidence:** `deckService.ts:213 description: card.description` / `:224 fullDescription: card.description` / `:248 oneLiner: card.oneLiner || null` — all fed by F-1's `''`/`null`. `SwipeableCards.tsx:3042-3045`: face renders `currentRec.title` then `currentRec.oneLiner` **only when truthy** (it's `null` for places). No `description` on the face.
- **Mechanism:** face = name + (null blurb) + badges → effectively **name-only**.
- **Severity:** CONFIRMED.

### F-3 — Consumer app has zero `generative_summary` references; expanded "why" uses `ai_reasoning`, not the pitch
- **Symptom:** even the expanded detail never shows the pitch.
- **Layer:** code (client).
- **Probe:** `grep -rn "generative_summary|generativeSummary" app-mobile/src` → **0 hits**. Read `ExpandedCardModal`.
- **Evidence:** `ExpandedCardModal.tsx:2065 description={card.description}` (= `''`); the "Why we picked this for you" section is fed by `ai_reasoning_by_signal` (built in `discover-cards.ts:834-844` `extractAiReasoningBySignal` from the RPC `ai_reasoning` column — a *scoring* byproduct, NOT `generative_summary`).
- **Mechanism:** expanded detail shows an empty pitch slot; any AI prose the user sees is per-signal reasoning, a different column.
- **Severity:** CONFIRMED.

### F-4 — `venue_public_view` does not expose any pitch/summary column
- **Symptom:** public venue page has no pitch to render.
- **Layer:** schema.
- **Probe:** read the latest `CREATE VIEW public.venue_public_view`.
- **Evidence:** `...20261130000003_orch_1255_claim_rpcs_public_views.sql:990-1009` — SELECT list = id, brand_id/slug/name, slug, name, address, city, country_code, lat, lng, venue_category, google_place_id, contact_email, contact_phone, cover_media_url/type, place_pool_id, theme fields, default_currency, hours agg, `pp.stored_photo_urls AS pool_photo_urls`, timestamps. **No** `generative_summary`, `editorial_summary`, tagline, description, or pitch.
- **Mechanism:** the anon read model carries no pitch → the public page cannot show one.
- **Severity:** CONFIRMED.

### F-5 — Public venue page renders no pitch body; meta is mechanical
- **Symptom:** page shows name/brand/address/hours/map/gallery/menu, no blurb.
- **Layer:** code (client).
- **Probe:** read `PublicVenuePage.tsx` identity + meta.
- **Evidence:** `:198-227` identity block = eyebrow "VERIFIED VENUE", `venue.name`, "By {brandName}", `venue.address`; `:191 metaDescription = \`${venue.name} — ${venue.brandName} on Mingla\``. No pitch field consumed anywhere.
- **Mechanism:** consistent with F-4 — no pitch surface on the public page.
- **Severity:** CONFIRMED.

### F-6 — `venue_listings` has no pitch column; the pitch lives on `place_pool.generative_summary`
- **Layer:** schema.
- **Evidence:** `...20261130000000_orch_1255_venue_listings_core.sql:42-68` — columns are place/identity/claim only; **no** summary/tagline/pitch/bio/description column. The venue references `place_pool` via `place_pool_id`; the pitch is `place_pool.generative_summary`.
- **Mechanism:** any "venue-level pitch" today is really a place_pool field reached through the FK. Relevant to D-4's "dedicated venue pitch column vs reuse."
- **Severity:** CONFIRMED (data-model fact).

### F-7 — Create-apply writes `generative_summary` at confirm; claim stages it for approve
- **Layer:** code (edge).
- **Evidence:** `handleConfirmAiOutputs` — apply mode writes `generative_summary: salesBio` (`run-business-place-authoring-pipeline/index.ts:1561`); stage mode omits it (`:1551-1557`) and stores `confirmed_ai_outputs.sales_bio`. `authoredApply.ts:161-173` applies it at approve: `confirmed_ai_outputs.sales_bio` → else `tier1.description` (≥20) → else omit.
- **Mechanism:** two write paths + one approve-time apply; both create's `description` (`VenueStep6Description`) and claim's pitch (`ClaimStepPitch`, `:58 patch({ description })`) funnel into the same `description` draft → `tier1.description`.
- **Severity:** CONFIRMED.

### F-8 — The 16-signal Gemini eval (`ai_signal_scores`) is computed PRE-approval in `handleTier2` (D-2 violation)
- **Symptom:** scores exist before any human accepts.
- **Layer:** code (edge).
- **Probe:** read `handleTier2` + the Gemini prompt.
- **Evidence:** `handleTier2` calls `callGeminiForEvaluations` (`:1334`) and writes `ai_signal_scores: aiSignalScores` to `place_pool` (`:1424`) during the user's "Recommend me to users" click. The single prompt produces **all four** in one call — bio, photo_analysis, facets, and "one Q2 score per active signal" (`:998-1003`). Shape per entry: `{ signal_id, score_0_to_100, inappropriate_for, reasoning }` (`:67-71`).
- **Mechanism:** authoring-time click → full 16-signal AI evaluation persisted before approval. D-2 forbids this.
- **Severity:** CONFIRMED ROOT CAUSE (of the D-2 gap).

### F-9 — The blend (`run-signal-scorer` → `place_scores`) already runs only at approve (D-2 already satisfied for the blend)
- **Layer:** code (edge).
- **Evidence:** `admin-review-venue-claim/index.ts` `runApproveGoLive` flips `is_servable=true` (`:155-165`) then loops the 16 active signals invoking `run-signal-scorer` once per signal (`:189-213`, body `buildScorerInvokeBody`); `run-signal-scorer/index.ts:3-6` reads `is_servable=true` places, blends `ai_signal_scores` via `computeScore`, and is the sole owner of `place_scores.score`. `computeScore` treats AI as optional: `signalScorer.ts:313 const aiEntry = place.ai_signal_scores?.[signalId] ?? null` (no AI slice → deterministic-only score).
- **Mechanism:** the blend is already deferred to approve; only the *eval that feeds it* is early (F-8).
- **Severity:** CONFIRMED (favorable — less to move than it looks).

### F-10 — Post-1285, create success routes to a durable deck-readiness leg (the thing D-1 removes)
- **Layer:** code (client).
- **Evidence:** `VenueCreatorWizard.tsx:78-84` — wizard no longer mounts `VenueDeckReadinessSetup`; create success `router.replace`s to `app/venue/deck-readiness.tsx`. Create step map (`venueWizardValidation.ts:31-38`): s0 Address · s1 Name · s2 Hours · s3 Contact · **s4 "Inputs"/Story (tagline+description)** · s5 Review. **Create wizard collects NO cover / gallery / price / facets** — those live in the deck-readiness leg.
- **Mechanism:** create today = two legs (wizard submit → deck-readiness). D-1 collapses to one.
- **Severity:** CONFIRMED.

### F-11 — Deck-readiness leg = the fields + AI + confirm to fold in
- **Layer:** code (client + edge).
- **Evidence:** `VenueDeckReadinessSetup.tsx` collects cover (`EventCoverMedia`/`CoverPickerSheet`), gallery 5-20 (`:80-102`), price tiers (`:121`), facet Y/N by category (`:130-170`), and "Best for" signal chips (`:86-94`). Button "Recommend me to users" (`:708`) → `run_tier2_pipeline`; shows editable "Your venue's pitch" (`:747-761`); "Approve & publish" (`:764`) → `confirm_ai_outputs`. `deck_eligible` gate = bouncer servable AND ≥5 gallery (`index.ts:1511-1513`, `businessGateReasons`).
- **Mechanism:** this leg's data-collection must migrate into the wizard (D-1); its AI-eval must split (D-2/D-3); its confirm-gate becomes the single submit gate.
- **Severity:** CONFIRMED.

### F-12 — D-5 (owner per-signal 0-100 breakdown) already exists on the listing page
- **Layer:** code (client).
- **Evidence:** `VenueListingContent.tsx:222-228` maps `ctx.data.ai_signal_scores` → `{id,label,score_0_to_100}` sorted desc; `:366-390` renders "How you match Mingla moments" 0-100 bars. `VenueIntelligenceModule.tsx:436-469` renders the same via an RPC with a "Not scored yet — run 'Recommend me'" empty state.
- **Mechanism:** D-5 is ~built; under D-2 it stays empty until approve then populates — matching D-5's "post-approval" intent. Copy referencing "run 'Recommend me'" (`VenueIntelligenceModule:468-469`) must change since that button is being removed.
- **Severity:** CONFIRMED (D-5 mostly done; needs copy + gating tweak).

### F-13 — Pitch is read-only on the listing page (D-3 gap)
- **Layer:** code (client).
- **Evidence:** `VenueListingContent.tsx:358-363` — "Your pitch" is a plain `<Text>{bio}</Text>`, no edit control. `regenerate_sales_bio` exists in the edge fn (`index.ts:1454`, service `runTier2Pipeline`) but is only invoked inside the deck-readiness leg.
- **Mechanism:** D-3's "edit/regenerate pitch later from the listing page" needs new UI + a persist path (edit `generative_summary`; regenerate via a bio-only call).
- **Severity:** CONFIRMED (net-new for D-3).

### F-14 — Sole-owner invariant + gate constrain where `ai_signal_scores` may be written
- **Layer:** docs + CI.
- **Evidence:** `INVARIANT_REGISTRY.md:699-713` — `place_pool.ai_signal_scores` has EXACTLY TWO writers: `run-place-intelligence-trial` and `run-business-place-authoring-pipeline` (`handleTier2`). Gate `.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs:48-50` `ALLOWED_WRITER_FILES` = those two files; any new `.update({ ai_signal_scores` elsewhere FAILS CI (`:124,:160`).
- **Mechanism:** if D-2 moves the eval-write into `admin-review-venue-claim`, that file must be added to the allowlist AND the invariant amended (two→three writers, or replace the pipeline writer). If instead the approve path *calls* the pipeline's eval, the writer stays the pipeline and the gate is untouched — a cleaner option.
- **Severity:** CONFIRMED (gate will fight naive move).

### F-15 — The 1285 gate hard-requires the deck-readiness route D-1 deletes
- **Layer:** CI.
- **Evidence:** `i-proposed-1285-create-lands-on-durable-deck-readiness.mjs:18-26` — FAILS unless the create wizard contains `router.replace(routeForDeckReadinessFix(...))` AND FAILS if `<VenueDeckReadinessSetup>` / `createdVenue` is reintroduced. D-1 removes the deck-readiness route entirely → this gate's premise is inverted and it must be **retired/replaced**, not merely edited.
- **Mechanism:** the gate encodes the *opposite* of the D-1 target; leaving it armed blocks every D-1 PR.
- **Severity:** CONFIRMED (gate must be retired with a superseding note).

---

## 4. FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| Docs | Dispatch/D-4 assume the pitch is "the one public blurb"; memory says tagline+description→`generative_summary`. | **Contradicts Code/Schema:** the pitch is not public-facing anywhere (F-1..F-5). |
| Schema | `venue_listings` has no pitch col; `venue_public_view` exposes none; pitch = `place_pool.generative_summary`. | View omits the pitch → public page cannot show it (F-4). |
| Code | Card description `''`, oneLiner `null`; app-mobile has 0 `generative_summary` refs; eval runs pre-approve; blend runs at approve; D-5 view built; pitch read-only. | Eval-pre-approve contradicts D-2 (F-8). |
| Runtime | Not exercised (static data-flow question; PD-7 exempt). The `''` literal is unconditional, so no runtime state changes it. | — |
| Data | Not queried (read-only; no prod access in this session). 2 existing pending venues may already hold pre-approve `ai_signal_scores` from `handleTier2`. | **Open:** their state under D-2 semantics (§7 OQ-5). |

**Flagged contradiction (load-bearing):** the redesign brief (D-4) treats the pitch as the consumer blurb; the code proves it is invisible to consumers. This must be resolved before SPEC (OQ-1).

---

## 5. REDESIGN SCOPE — file-by-file (per D-1..D-5)

### (a) Wizard — D-1 (one submission) + D-4 (single "pitch")
- `mingla-business/src/components/venue/venueWizardValidation.ts` — extend the **create** step map to add Cover, Photos/Gallery (≥5), Price, and (optionally) Facets steps so create matches the claim map's coverage; replace s4 "Story (tagline+description)" with a single **Pitch** step. Update `venueStepError` (drop the tagline rule; keep pitch ≥20 OR allow empty-with-AI-draft as claim's c5 already does, `:145-164`).
- `mingla-business/src/components/venue/VenueStep6Description.tsx` — collapse to ONE field (remove "Short tagline (optional)"), OR replace with a shared `VenuePitchStep` reused by both paths. Add an **AI "Generate / Regenerate pitch"** affordance (editable textarea + button) — the bio-only submit-time call (D-3).
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx` — remove the `router.replace(routeForDeckReadinessFix(...))` create-success seam; on submit run tier-1 create **plus** the bio-only pitch draft, land directly on the venue management page ("in review").
- `mingla-business/app/venue/deck-readiness.tsx` + `VenueDeckReadinessSetup.tsx` — **retire** as a user-facing leg (or repurpose its cover/gallery/price/facet sub-forms as wizard steps). Remove the "Recommend me to users" button and the operator "Approve & publish" confirm (that becomes the single wizard submit).
- Store: `draftVenueStore` — ensure cover/gallery/price/facets persist across the (now longer) create wizard as they already do for claim.
- **Claim path:** already single-submit + stage-only; mainly relabel c5 pitch's AI-assist to the shared component and ensure it does NOT trigger a pre-approve eval.

### (b) Pipeline — D-2 (score on approve) + D-3 (pitch draft at submit)
- `supabase/functions/run-business-place-authoring-pipeline/index.ts` — **SPLIT** `callGeminiForEvaluations`: introduce a **bio(+facets)-only** action used at submit (`draft_pitch` / repurposed `regenerate_sales_bio`) that does NOT compute or write `ai_signal_scores`; strip the `evaluations` write out of `handleTier2` (remove the `ai_signal_scores:` update at `:1424`). Prompt `:998` must be split into a bio-only prompt and a scoring prompt.
- `supabase/functions/admin-review-venue-claim/index.ts` — add the **16-signal evaluation** step to the approve path, BEFORE `runApproveGoLive`'s scorer loop (so the blend sees fresh AI scores). Decision: either (i) `admin-review-venue-claim` writes `ai_signal_scores` directly (→ amend sole-owner allowlist/invariant, F-14), or (ii) it **invokes the pipeline's eval action** service-to-service so the writer stays `run-business-place-authoring-pipeline` (no allowlist change — recommended).
- Ensure **no** `ai_signal_scores` is computed/persisted anywhere pre-approval (D-2). The listing D-5 view will then be empty until approve — desired.

### (c) Admin — D-2
- `admin-review-venue-claim` approve already runs `applyAuthoredContentOnApprove` (applies `generative_summary`, cover, hours, price, facets) then `runApproveGoLive` (rebounce → servable → per-signal scorer). Insert the eval step in `approveGoLiveWithAuthoredApply` after authored-apply, before scorer. Reject already resets `business_recommend_edit_count=0` (`:719-721`) — revisit whether the edit-cap concept survives (it was tied to "Recommend me" runs; OQ-4).

### (d) Listing page — D-5 (breakdown) + D-3 (editable pitch)
- `VenueListingContent.tsx` / `VenueIntelligenceModule.tsx` — D-5 bars already render from `ai_signal_scores` (F-12); update empty-state copy that says "run 'Recommend me'" (that button is gone) to "Scores appear after Mingla approves your venue." Make "Your pitch" **editable** (D-3): add an edit textarea + "Regenerate with AI" (bio-only call) + a persist path to `place_pool.generative_summary` (needs a new owner-write path/RPC or a pipeline action — today only confirm/authoredApply write it).

### (e) Data / columns — D-4
- **No new column strictly required:** the pitch already lives on `place_pool.generative_summary` reached via `venue_listings.place_pool_id`. Recommend **reuse** `generative_summary`. A dedicated `venue_listings.pitch` column would only be justified if Seth wants per-venue pitch independent of the place_pool row (relevant only for multi-venue-on-one-place edge cases). If D-4's pitch is to become consumer-facing (OQ-1), that's the bigger change: add `generative_summary` to `venue_public_view` (touches `orch-1255-public-venue-anon-safe.mjs`) AND populate `description`/`oneLiner` in `discover-cards.ts:905` (touches the deck card contract).
- Migration: only needed if (i) a new column is added, or (ii) `venue_public_view` is re-created to expose the pitch.

### (f) Deck-eligibility gate redefinition — D-1/D-2
- Today `deck_eligible` is set by `confirm_ai_outputs` (operator confirm) gated on bouncer-servable + ≥5 gallery. With no user AI-confirm step, redefine: the single wizard **submit** sets status to `pending_review` (bouncer-servable + ≥5 gallery + pitch present as the submit gate); **approval** is what flips `is_servable`/scored/live. Reconcile `business_authoring_status` values (`draft`/`processing`/`needs_fix`/`deck_eligible`/`failed`) with the new single-submit lifecycle.

### Cross-path note (claim vs create)
Claim is already the target shape: single stage-only wizard (`I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE`), pitch in-wizard (c5), AI at approve. Create must converge to it. Keep create's authored row `is_servable=false` until approve (F-9, `I-NET-NEW-HOLD`). Do NOT let the new create flow write serving-read place columns pre-approve for claim (stage-only gate G-1).

---

## 6. BLAST RADIUS / CROSS-SURFACE

| Surface | Impact |
|---------|--------|
| Consumer iOS/Android (`app-mobile`) | **No behavioral change from D-1..D-3/D-5** — the pitch is already invisible to consumers (F-1..F-3). Ranking timing shifts: a venue now gets `ai_signal_scores` only at approve, so pre-approve it ranks on deterministic-only scores IF ever servable — but net-new authored rows are `is_servable=false` until approve anyway (F-9), so **no venue ranks pre-approval today either**. Removing pre-approve scoring does not change *when* a venue can rank. **Only changes** if OQ-1 is taken (wire pitch into the card) — then the card gains a blurb. |
| Business iOS/Android/Web (`mingla-business`) | Primary surface. Wizard, deck-readiness route, listing page all change. **Business OTA is BLOCKED** (COMMS-0052) — native wizard changes ride the next business build, not `eas update`. |
| Buyer/anon Web | `venue_public_view` unchanged unless OQ-1 taken; public venue page unchanged unless pitch is wired in. |
| Admin Web (`mingla-admin`) | Approve path now also triggers the AI eval; admin review bundle already surfaces `ai_signal_scores` — verify it tolerates "no scores until I approve." |
| Business Web preview | Rides the wizard change (Vercel `[deploy]`). |

**In-scope:** business authoring (create+claim), pipeline eval split, approve orchestration, listing pitch-edit + D-5 copy. **Out-of-scope (flag for Seth, OQ-1):** wiring the pitch onto the consumer card / public page — a separate initiative with its own gates.

---

## 7. INVARIANT IMPACT (flagged, not resolved)

- `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` (ACTIVE) — **touched.** Moving/splitting the eval changes the writer set. Prefer approve-path *invokes* pipeline eval (writer stays pipeline; invariant untouched). Else amend to add `admin-review-venue-claim` + update `ALLOWED_WRITER_FILES` (F-14).
- `I-PROPOSED-1285-CREATE-LANDS-ON-DURABLE-DECK-READINESS` — **inverted by D-1.** Retire the gate + invariant with a superseding note (F-15).
- `I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE` (ACTIVE) — **must be preserved.** The new single-submit create must keep net-new rows off serving-read columns until approve; claim stays stage-only. Gate G-1 `orch-1263-claim-stage-only-preapprove.mjs` still applies.
- `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` / `-PROMPT-VERSION-DISCRIMINATED` — the split eval must keep the 6-key shape + stamp `prompt_version` (F-8 shape).
- `orch-1255-venue-approval-per-venue-row.mjs`, `orch-1255-public-venue-anon-safe.mjs`, `orch-1255-no-hidden-brand-on-venue-create.mjs`, `orch-1218-venue-authoring-no-vendor-leak.mjs` — approval-per-row + anon-safe view + no-vendor-leak must survive; the anon-safe gate is directly relevant IF OQ-1 adds the pitch to the view.
- `meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` + the `place_pool` AFTER UPDATE trigger on `generative_summary` (migration `20260808000000:369`) — editing the pitch post-approval (D-3) will **queue a Gemini re-eval** via that trigger. Confirm this is the desired behavior (a pitch edit re-scores the venue) — it may be, but flag it (OQ-6).
- **Propose new (DRAFT):** `I-PROPOSED-1290-NO-SIGNAL-SCORES-PRE-APPROVE` — no code path writes `place_pool.ai_signal_scores` for a venue whose claim/listing is not `verified`/approved. (SPEC to author + gate.)

---

## 8. DISCOVERIES FOR ORCHESTRATOR (side issues)
- **D-i (premise):** `generative_summary` is dead weight to consumers today — it only feeds scoring + the owner's own view. Worth a program decision (OQ-1): is the pitch meant to be public? If yes, it's a *separate* consumer-facing wiring initiative (card + public view).
- **D-ii:** `RECOMMEND_EDIT_CAP=4` (`index.ts:106`) — the "3 changes then locked" concept is coupled to the removed "Recommend me" button; it needs a home or removal (OQ-4).
- **D-iii:** COMMS-0052 (BLOCK, still OPEN) — business OTA is blocked until a new native build; every native wizard change here is native-build-only, not OTA.

## 9. OPEN QUESTIONS (for SPEC / Seth)
- **OQ-1 (blocks D-4 framing):** Should the pitch become the **consumer-facing** blurb (card + public venue page)? Right now it is invisible to users. If yes, scope grows (wire `discover-cards` description + `venue_public_view`). If no, D-4 is purely an *authoring* simplification.
- **OQ-2 (D-3 mechanism):** Confirm SPLIT (bio-only at submit + eval at approve) over withhold-but-compute. Recommended: SPLIT (honors D-2's "not computed pre-approval"; extra Gemini call lands in the admin action).
- **OQ-3 (D-2 writer):** Approve-path *invokes pipeline eval* (writer unchanged, no gate churn) vs approve-path *writes scores itself* (amend sole-owner). Recommend invoke.
- **OQ-4:** Fate of `RECOMMEND_EDIT_CAP` / "3 changes remaining" now that "Recommend me" is gone.
- **OQ-5 (backward-compat):** The 2 existing pending venues may already carry pre-approve `ai_signal_scores` (from `handleTier2`). Under D-2, leave them, or clear until approve? Needs a read-only prod query on `place_pool` (SPEC/tester with prod access).
- **OQ-6:** Editing the pitch post-approval fires the Sub-D re-eval trigger → re-scores the venue. Desired? (Likely yes.)
- **OQ-7:** Does create's new wizard require the same cover/gallery (≥5)/price/facets as the deck-readiness leg enforced, or a leaner submit gate with the rest as post-approval to-dos (mirroring claim's to-do deferral)?

## 10. CONFIDENCE + RECOMMENDED NEXT PHASE
- **Confidence:** proven (static data-flow + architecture; every claim file:line-cited on `origin/main`; PD-7 live-fire exempt). The one thing not runtime-confirmed is the 2 pending venues' data-state (OQ-5) — honestly flagged, needs a read-only prod query, does not change the redesign shape.
- **Recommended next phase:** SPEC (mingla-forensics SPEC mode), scoped to D-1..D-5 as in §5, with OQ-1/OQ-2/OQ-3 resolved by Seth FIRST (OQ-1 changes whether this touches the consumer surface). Invoke `mingla-designer` for the folded single-submit wizard + the editable-pitch/regenerate listing UI. Do NOT widen into the consumer card/public-page pitch wiring unless OQ-1 = yes.
