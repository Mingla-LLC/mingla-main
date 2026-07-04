# SPEC — META-ORCH-1290 [venue authoring: one-submission + score-on-approve + pitch-only + consumer-facing pitch]

**Phase:** SPEC (binding build contract; no implementation)
**Branch / worktree:** `orch-1290-venue-authoring-one-submission` @ `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` (rebased on `origin/main` — read shipped code from the worktree/origin/main, NOT the stale anchor).
**Investigation base:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` — every F-#/OQ-# below cites it.
**Design authority (binding for pixels):** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1290_AUTHORING_UX.md` (written in parallel; not yet on disk at SPEC time). Wherever this SPEC says "per DESIGN", the DESIGN doc governs layout / spacing / type / motion / exact copy. This SPEC governs data flow, contracts, gates, and behavior. If a DESIGN pixel contradicts a behavior contract here, the behavior contract wins and the conflict routes back through the orchestrator.
**Locked decisions:** Seth's D-1..D-6 (dispatch). This SPEC resolves the investigation's OQ-1..OQ-7 (see §10).
**Comms:** No BLOCK+OPEN ledger entry targets this ORCH/forensics/ALL. WARN factored: COMMS-0052 (business OTA frozen → business changes are NATIVE-BUILD-ONLY, no `eas update`), COMMS-0047 (consumer OTA frozen → the swipe-card change rides the next CONSUMER native build), COMMS-0051 (migration prefix-collision hazard → §4.1 migration versions collision-scanned across origin/main + all worktrees).

---

## 1. Executive summary

Today a business lists a venue in TWO steps: a wizard (name / address / hours / contact / story), then a SEPARATE post-submit "deck-readiness" leg (cover / gallery / price / facets + a "Recommend me to users" button) that runs a Gemini call which computes and persists the venue's 16-signal AI scores BEFORE any human approves it. The AI pitch is written but is invisible to consumers, and the owner edits nothing after submit.

META-ORCH-1290 makes authoring ONE submission and moves scoring to approval:

- **D-1 One submission.** Fold the deck-readiness data-collection (cover / gallery / price) into the single create wizard so create converges on the already-single-path CLAIM flow. The "Recommend me to users" and "Approve & publish" buttons disappear; submit lands the owner on the listing page in `pending_review`.
- **D-2 Score on approve.** No BUSINESS-authored `ai_signal_scores` is computed or persisted before admin ACCEPT. The 16-signal Gemini evaluation runs at approve. (NUANCE: a claimed seeded place may already carry Google-trial scores written by `run-place-intelligence-trial` — that slice is legit and untouched; D-2 governs only the business-authored write.)
- **D-3 Pitch = AI-drafted at submit + owner-editable anytime.** Split the single Gemini call into (a) a bio-draft-only call at submit and (b) the 16-signal eval at approve. The pitch is editable in the wizard AND later on the listing page.
- **D-4 One "Pitch" field.** Collapse tagline+description into a single Pitch field, reusing `place_pool.generative_summary` (no new column).
- **D-5 Full breakdown post-approval.** The owner sees the 16-signal 0-100 breakdown on the listing page (UI exists — fix empty/pre-approval copy + make the pitch editable there).
- **D-6 Consumer-facing pitch.** Render the pitch on the explorer SWIPE CARD (app-mobile, native) and the PUBLIC venue page (`/b/{brandSlug}/v/{venueSlug}`) by surfacing `generative_summary` through the two servable RPCs + `discover-cards` and through `venue_public_view` + `PublicVenuePage`.

Three legs: **A** backend (pipeline split + approve-eval + view/RPC pitch exposure + migrations + gates), **B** business app (folded wizard + single Pitch field + editable listing pitch + status redefinition), **C** consumer + public (swipe card + public page render the pitch).

---

## 2. Scope & non-goals

### In scope
- Split the pipeline's single Gemini call into a **bio-draft** call (submit) and a **16-signal eval** call (approve) (D-3, F-8).
- Strip the pre-approve `ai_signal_scores` write from `handleTier2`; move the eval to the approve path as a new pipeline action `evaluate_signals` INVOKED service-to-service by `admin-review-venue-claim` (D-2, OQ-3 resolved to "invoke pipeline eval; writer unchanged").
- Fold create's cover / gallery / price collection into the create wizard; collapse tagline+description → one Pitch field with AI generate/regenerate (D-1, D-4).
- Remove the "Recommend me to users" + "Approve & publish" client seams; redefine post-submit status to `pending_review`; relocate the ≥5-gallery deck gate to approve (D-1).
- Make the listing-page pitch editable with AI regenerate; fix the D-5 empty-state + "Changes remaining" copy (D-3, D-5, F-12, F-13).
- Surface `generative_summary` on the consumer swipe card (both servable RPCs + `discover-cards`) and the public venue page (`venue_public_view` + service + `PublicVenuePage`) (D-6, F-1..F-5).
- Retire the ORCH-1285 CI gate (D-1 deletes the nav it hard-requires); add two new DRAFT invariants + gates; preserve I-1263 + sole-owner gates.

### Non-goals (explicit)
- **No new DB column for the pitch.** Reuse `place_pool.generative_summary` (D-4; F-6). No `venue_listings.pitch`.
- **No change to the deterministic blend.** `run-signal-scorer` → `place_scores` already runs only at approve (F-9); untouched except that it now blends fresh approve-time AI scores.
- **No operator facet-confirmation step.** The removed confirm step's facet application is replaced by AI-inferred facets written by the approve `evaluate_signals` action (§4.2.C). Facets are NOT a new wizard step (claim never collected them in-wizard either) — converge to claim, not widen.
- **No consumer ranking-timing change.** Net-new authored rows are already `is_servable=false` until approve (F-9); removing pre-approve scoring does not change WHEN a venue ranks.
- **No admin UI redesign.** The admin review bundle already surfaces `ai_signal_scores`; it must only tolerate "no business scores until approve" (verify, don't rebuild).
- **No `place_scores` sole-owner change.** `run-signal-scorer` stays the only writer.
- **No claim-path structural change.** Claim is already single-submit + stage-only; changes are minimal (shared Pitch component + no pre-approve eval).

### Assumptions
- Create-new and claim both drive the venue lifecycle through `venue_listings.claim_status` (`pending_review` → `verified`/`rejected`); the listing page reads `venue.claimStatus` (verified from `VenueListingContent.tsx:233-235`).
- `business_authoring_status` (`draft`/`processing`/`needs_fix`/`deck_eligible`/`failed`) is a pipeline-diagnostic status separate from `claim_status`.
- The durable `/venue/deck-readiness` route + `VenueDeckReadinessSetup` SURVIVE as the Hub→Edit recovery/edit surface; only its two AI buttons and the create-submit nav change (dispatch; F-15).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | Swipe card + expanded modal render the venue pitch (`generative_summary`) as the card blurb (per DESIGN length/placement). | `app-mobile/src/services/deckService.ts` (map new field), swipe-card/modal render already read `description`/`oneLiner` (F-2). | Manual vs Android (same RN code → automatic) |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | Same as iOS. | (shared RN) | Automatic (shared code) |
| 3 | **Buyer/anon Web** (`mingla-business/` public `/b/{b}/v/{v}`) | YES | Public venue page renders the pitch body + uses it as meta description. | `supabase/migrations` (view), `mingla-business/src/services/publicEventsService.ts`, `mingla-business/src/components/venue/PublicVenuePage.tsx` | Manual (separate render path from card) |
| 4 | **Business iOS** (`mingla-business/` iOS) | YES | Single-submit wizard; one Pitch field w/ AI generate/regenerate; listing pitch editable; D-5 copy. | `VenueCreatorWizard.tsx`, `venueWizardValidation.ts`, `VenueStep6Description.tsx`→shared Pitch, `VenueListingContent.tsx`, `VenueIntelligenceModule.tsx`, wizard cover/gallery/price steps, `businessPlaceAuthoringService.ts` | Manual vs Android (shared RN → automatic); **NATIVE-BUILD-ONLY (COMMS-0052)** |
| 5 | **Business Android** (`mingla-business/` Android) | YES | Same as business iOS. | (shared RN) | Automatic (shared code); NATIVE-BUILD-ONLY |
| 6 | **Admin Web** (`mingla-admin/`, adjacent) | PARTIAL | Approve now triggers the AI eval before scoring; admin bundle must tolerate "no business scores until I approve." NO admin code change expected — verify only. | none (verify `admin-review-venue-claim` behavior) | Manual verify |
| 7 | **Business Web preview** (adjacent) | YES | Wizard + listing changes ride Vercel `[deploy]`; the pitch renders on the public page (buyer web). | (same `mingla-business` files) | Automatic (same bundle) |

**NOT-covered rationale:** none fully excluded. Admin (6) is verify-only because the approve orchestration change is backend and the existing bundle already reads `ai_signal_scores`.

**Ship channels:** business wizard/listing = business web via Vercel `[deploy]` + **next business native build** (NO `eas update`, COMMS-0052). Public page + `discover-cards` edge fn + view/RPC migrations = Vercel + edge-deploy + Management-API migration apply. Consumer swipe-card = **next CONSUMER native build** (consumer OTA blocked, COMMS-0047/ORCH-1171).

---

## 4. Layered specification

### 4.1 Database — migrations (versions collision-scanned per COMMS-0051)

Latest prefix on origin/main + this branch = `20261210000000`; no other worktree carries a colliding 2027* prefix. Allocate:

**M1 — `supabase/migrations/20261211000000_meta_orch_1290_venue_public_view_pitch.sql`** (D-6 public page).
- `DROP VIEW IF EXISTS public.venue_public_view;` then `CREATE VIEW` re-adding **exactly** the current SELECT list (per `20261130000003...:990-1009`) **plus** `pp.generative_summary AS pitch` (sourced from the already-joined `LEFT JOIN public.place_pool pp`). Keep `WHERE v.claim_status = 'verified'`, `security_invoker = false`, `GRANT SELECT ... TO anon, authenticated`, and the COMMENT (append "META-ORCH-1290: + pitch (generative_summary), anon-safe public-directory text").
- Anon-safety: `generative_summary` is owner-authored public-directory prose on an already verified-only view → exposing it is within I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE. No new grant.
- Runtime complement: extend `supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql` to assert `pitch` is present for a verified venue and the view still excludes non-verified rows.

**M2 — `supabase/migrations/20261211000001_meta_orch_1290_servable_rpcs_generative_summary.sql`** (D-6 swipe card).
- The two servable RPCs live in `20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql`: `query_servable_places_by_signal` (solo) and `query_servable_places_by_signal_intersection` (collab/intersection). Both have a `RETURNS TABLE(...)` signature that OMITS `generative_summary`. A `RETURNS TABLE` shape change CANNOT use `CREATE OR REPLACE` (Postgres rejects an OUT-column change) — **DROP then CREATE** each function (mirror the precedent noted at `20260806000000...:50`).
- For each: add `generative_summary text` to `RETURNS TABLE` (immediately after `stored_photo_urls`/`types` block, before `signal_score`) and add `pp.generative_summary` to the SELECT. **Preserve byte-for-byte** the three-gate serving WHERE, the `ORDER BY` (determinism contract — collab I-COLLAB-DECK-DETERMINISM), the `ai_reasoning`/`ai_score_raw` columns, `SECURITY DEFINER`, `SET search_path`, and the COMMENTs (append the 1290 note).
- Re-`GRANT EXECUTE` to the same roles the originals grant (copy from the source migration).

Both migrations are additive/read-only to serving data. Apply via Management API (project ref `gqnoajqerqhnvulmnyvv`), NOT blind `supabase db push` (project_migration_history_drift). No RLS/table/constraint change. No `place_pool` schema change (pitch reuses `generative_summary`, F-6).

### 4.2 Edge functions

#### 4.2.A `run-business-place-authoring-pipeline/index.ts` — SPLIT the Gemini call (D-2, D-3)

**Contract change 1 — bio-draft-only at submit.** `callGeminiForEvaluations` (`:956`) today returns bio + photo_analysis + facets + `evaluations` (the 16 scores) + consistency in ONE call, and `handleTier2` writes `ai_signal_scores` from it (`:1424`). Split:
- Introduce `callGeminiForBioDraft(input)` → returns `{ bio, facets, photo_analysis?, consistency? }` ONLY. Prompt = the no-images/with-images bio+facets instruction MINUS the "one Q2 score per active signal" clause; drop `signals` from the payload; drop `evaluations` from the response schema. Keep `prompt_version` stamping + the 2-attempt retry (but coverage-of-signals check no longer applies).
- `handleTier2` (used by actions `run_tier2_pipeline` and `regenerate_sales_bio`, `:1891`) MUST:
  - call `callGeminiForBioDraft` (NOT the eval),
  - **REMOVE** the `ai_signal_scores: aiSignalScores` key from the `place_pool.update(...)` at `:1424` and remove the `buildAiSignalScores` call at `:1343`,
  - keep writing `business_authoring_inputs.pending_ai_outputs.generated_bio` + `facets` (staging only), `photo_analysis`, `raw_google_data` cross-validation, bouncer diagnostics, and the stage/apply write-mode boundary (F-8/§4.2 write-mode unchanged),
  - keep returning `generated_bio` + `facets` for the client to show/edit.
- Effect: after this change the pipeline writes NO `ai_signal_scores` anywhere pre-approval (D-2, I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE).

**Contract change 2 — `evaluate_signals` action for approve (D-2, OQ-3 = invoke-pipeline).** Add a new action `evaluate_signals`:
- **Auth branch (service-role only).** `requireUser` (`:489`) rejects a service-role token. For `action === "evaluate_signals"` ONLY, add a `requireServiceRole(req)` branch BEFORE `requireUser`: accept iff the `Authorization: Bearer <token>` equals `SUPABASE_SERVICE_ROLE_KEY` (constant-time compare). No user is loaded; `brand_id`, `venue_id`, `place_pool_id` come from the body and are validated (uuid). Every OTHER action keeps `requireUser`. This keeps `ai_signal_scores`'s sole writer = this file (sole-owner gate + invariant UNTOUCHED — the dispatch's preferred mechanism).
- **Body:** `{ action:"evaluate_signals", brand_id, venue_id, place_pool_id }`.
- **Behavior:** load the place (service client), `loadSignals`, `galleryUrls`, `scanWebsite` (same inputs `handleTier2` used), call a new `callGeminiForSignalEval(input)` → `{ evaluations, photo_analysis?, consistency? }` (the 16-score half of the old call; keep the coverage retry + `buildAiSignalScores` fail-close), then ONE `place_pool.update({ ai_signal_scores: buildAiSignalScores(...), photo_analysis, ai_signal_scores_veto?: unchanged })` on `place_pool.id = place_pool_id`. Also write the AI-inferred facet columns (`gemini.facets ∩ FACET_COLUMNS`) here — this replaces the retired operator-confirm facet application (§2 non-goal). Return `{ kind:"ok", action:"evaluate_signals", signals_evaluated, place_pool_id }`.
- **Idempotent + fail-honest:** a re-approve re-evaluates and overwrites (last-writer-wins for the AI slice); a Gemini failure returns a structured error the caller treats as fail-close (§4.2.B).
- Router (`:1888-1908`): add `if (body.action === "evaluate_signals") return await handleEvaluateSignals(...)` (BEFORE `requireUser` gate for this action per the auth branch above).

**Illustrative (≤2 lines, NOT an implementation):**
`if (action === "evaluate_signals") { const g = await requireServiceRole(req); if (g instanceof Response) return g; return handleEvaluateSignals(service, body); }`

#### 4.2.B `admin-review-venue-claim/index.ts` — run the eval at approve (D-2)

- Insert the eval BETWEEN `applyAuthoredContentOnApprove` and `runApproveGoLive` inside `approveGoLiveWithAuthoredApply` (`:311-332`) — so the scorer blends fresh AI scores over AUTHORED content (F-9 ordering, ORCH-1263 §A5).
- Mechanism: `const ev = await admin.functions.invoke("run-business-place-authoring-pipeline", { body: { action:"evaluate_signals", brand_id, venue_id, place_pool_id } })`. `admin` uses `SUPABASE_SERVICE_ROLE_KEY` → the invoke carries the service-role Authorization the pipeline's `requireServiceRole` accepts. `brand_id`/`venue_id` are already resolved in scope (`venueRow.brand_id`, `parsed.venueId`, `placePoolId`).
- **Fail-close:** if the eval invoke errors, do NOT proceed to `runApproveGoLive` — return a structured `{ error:"signal_eval_failed", detail }` (same shape/precedent as the `authored_apply_failed` return at `:705-714`). The claim stays `verified` (identity) but off-deck; admin re-approves (idempotent). This mirrors the existing authored-apply fail-close.
- **Relocate the ≥5-gallery deck gate to approve.** Today `businessGateReasons` (gallery ≥ `GALLERY_MIN`) gates `deck_eligible` inside the removed `confirm_ai_outputs` (`handleConfirmAiOutputs:1511-1512`). Add `businessGateReasons(ppRow)` to `runApproveGoLive`'s re-bounce (`:133-151`): if the shared `bounce()` passes but gallery < min, DO NOT flip `is_servable` — record the reason and keep the venue verified-but-off-deck (identical semantics to today's `needs_fix`, just enforced at approve). Import `businessGateReasons` (export it from the pipeline `_shared` or duplicate the tiny predicate — see allowlist).
- Reject branch (`:717-722`): the `business_recommend_edit_count = 0` reset is now vestigial (the edit-cap concept is retired, §4.3.D / OQ-4). Leave the reset as a harmless no-op OR remove it; do NOT let its removal widen scope — pick removal only if the column write is dead everywhere.

#### 4.2.C `_shared/authoredApply.ts` — pitch source after confirm removal (D-1/D-4)

- `buildAuthoredApplyPatch` (`:134`) applies `generative_summary` from `confirmed_ai_outputs.sales_bio → tier1.description(≥20) → omit` (`:161-174`). With the confirm step removed, `confirmed_ai_outputs` is absent; the applied source becomes `tier1.description` — the single Pitch field (which may be AI-drafted-then-edited). **No change required** to this branch: it already falls through to `tier1.description(≥20)`. Add a code comment noting `confirmed_ai_outputs.sales_bio` is now legacy (kept for old rows).
- **Facets:** `buildAuthoredApplyPatch` reads facets from `confirmed_ai_outputs.facets` (`:184-190`). With confirm removed, this is empty → facets are instead written by the approve `evaluate_signals` action (§4.2.A). Leave the `confirmed.facets` branch as a legacy no-op. (Net delta: facets at approve now come from AI inference, not operator confirmation — acceptable; facet columns are deck-refinement, not blocking. OQ-7 note.)

#### 4.2.D `discover-cards/index.ts` — pitch onto the card (D-6)

- `transformServablePlaceToCard` (`:846`) — the sole builder for all 3 serve paths — hardcodes `description: ''` (`:905`) and `oneLiner: null` (`:909`). After M2 the RPC row carries `generative_summary`. Change:
  - `description: (row.generative_summary as string | null) ?? ''`,
  - **and** the card blurb slot per DESIGN: DESIGN pins whether the pitch shows as the card-face `oneLiner` (short) or only in the expanded modal `description`. Default binding (DESIGN may override): `oneLiner: firstSentenceOrClamp(row.generative_summary)` for the face + full `description` for the modal. If DESIGN says face stays name-only, keep `oneLiner: null` and populate `description` only.
- Type the new row field where the RPC result is typed (add `generative_summary?: string | null`). No fabrication: absent/empty → `''`/`null` (degrades to today's behavior).

### 4.3 Business app (`mingla-business`) — client

#### 4.3.A Wizard step model + validation — `venueWizardValidation.ts`
- Extend `CREATE_STEPS` (`:31-38`) so create collects what claim collects (converge to claim, D-1). Per DESIGN, target create map: Address · Name · Hours · Contact · **Pitch (single field)** · **Cover** · **Photos** · **Price** · Review. (Exact order/labels per DESIGN §wizard.) The Pitch step replaces s4 "Inputs" (which held tagline+description).
- `venueStepError` (`:95`): DROP the tagline rule; the Pitch step allows EMPTY or ≥20 chars (mirror claim c5 exactly, `:146-155` — "may be EMPTY; entered text ≥20"). Add validation for the new Cover/Photos/Price steps mirroring claim c4/c3/c7 (`:143-145`, `:177-178`). **Gallery ≥5 is NOT a submit gate** (claim c3: "GALLERY_MIN is enforced at go-live" `:143`) — it is enforced at approve (§4.2.B).
- Keep the claim map (`CLAIM_STEPS`) unchanged.

#### 4.3.B Single Pitch field + AI generate/regenerate — `VenueStep6Description.tsx` → shared component
- Collapse to ONE field (remove the "Short tagline (optional)" `Input` at `:38-44`; drop `tagline` from the store write). Preferred: extract a shared `VenuePitchStep` reused by BOTH create (new Pitch step) and claim (`ClaimStepPitch` c5) so the "Generate/Regenerate with AI" affordance + provenance chip live in one place. If a full extraction is too wide, add the AI affordance to both `VenueStep6Description` and `ClaimStepPitch` identically.
- **AI affordance (D-3, non-blocking):** a "Generate pitch" / "Regenerate" button that calls the bio-draft action (`runTier2Pipeline`/`regenerate_sales_bio`, now bio-only per §4.2.A) and fills the editable textarea with the returned `generated_bio`; the owner may edit or clear it. Submit is NEVER blocked on generation (empty pitch is valid, per claim c5). The generated/edited text writes to `draft.description` (→ `tier1.description` → `generative_summary` at approve).
- Copy per DESIGN; keep the claim "Start fresh" / seeded-note affordances (`ClaimStepPitch:43-83`).

#### 4.3.C Create submit flow — `VenueCreatorWizard.tsx`
- Fold cover/gallery/price collection into the wizard body switch (`:468-537`): render the new create Cover/Photos/Price steps (reuse `ClaimStepCover`/`ClaimStepPhotos`/`ClaimStepPrice` or wrap them so create + claim share components). `handleSubmit` already passes `coverMediaUrl`/`coverMediaType`/`hours` to `createVenue` and `website`/`priceTiers`/`adoptedGalleryUrls` in the claim branch (`:378-390`); extend the CREATE branch to pass the same cover/gallery/price payload it now collects.
- **Remove the create→deck-readiness nav (D-1, F-15).** Delete the `router.replace(routeForDeckReadinessFix({...}))` block (`:417-425`) and its `routeForDeckReadinessFix` import (`:65`). Replace with the SAME success path claim uses: `useDraftVenueStore.getState().reset(currentBrand.id); onDone(null, venueId, name);` → lands on the listing/management page in `pending_review`. Optionally fire one bio-draft call at submit if the owner never generated one (non-blocking; failure is swallowed — the pitch can be generated later on the listing page).
- The durable `/venue/deck-readiness` route + `VenueDeckReadinessSetup` are NOT deleted — they remain the Hub→Edit surface (`VenueListingContent.handleEdit:189-194`). Their two AI buttons change per §4.3.E.

#### 4.3.D Listing page — editable pitch + D-5 copy — `VenueListingContent.tsx`
- **Editable pitch (D-3, F-13).** The `bio` block (`:358-363`) is read-only `<Text>`. Make it an editable textarea + "Save" + "Regenerate with AI" per DESIGN. Persistence:
  - **Pending venue** (`claimStatus !== 'verified'`): save writes `business_authoring_inputs.tier1.description` (the draft pitch), applied to `generative_summary` at approve. Use a new pipeline action `update_pitch` (owner-authed via `requireUser`) OR reuse `upsertTier1Place` with a description-only draft. "Regenerate" calls the bio-only draft action.
  - **Live venue** (`claimStatus === 'verified'`): save writes `place_pool.generative_summary` DIRECTLY (owner-authed) — this fires the Sub-D `generative_summary` AFTER-UPDATE trigger → re-queues a Gemini re-eval (OQ-6 = DESIRED; document in a code comment). Needs an owner-write path: add an `update_pitch` action that, in apply mode, writes `generative_summary` (respects `placeWriteMode` — stage mode writes only the draft; apply mode writes the live column).
- **D-5 empty-state / copy (F-12).** The score bars (`:367-390`) already render from `ai_signal_scores`. Under D-2 they are EMPTY until approve — desired. The `VenueIntelligenceModule.tsx` empty-state (`:466-470`) says "run 'Recommend me'" — that button is gone. Change to: "Scores appear after Mingla approves your venue." Same for any listing-page empty copy.
- **"Changes remaining" (OQ-4, F-12/D-ii).** The `editsRemaining` block (`:392-402`) is tied to the removed "Recommend me" edit-cap. REMOVE this card (or repurpose per DESIGN). Do not reference `recommend_edits_remaining` in copy.

#### 4.3.E Edit surface — `VenueDeckReadinessSetup.tsx` (survives; buttons change)
- Remove the pre-approve AI-eval seam: the "Recommend me to users" button → `handleRunAi` → `runTier2Pipeline` (`:389-409`) now runs the bio-DRAFT only (no scores) — relabel to "Generate pitch with AI" (per DESIGN) OR fold into the shared Pitch component. The "Approve & publish" button → `handleConfirm` → `confirmAiOutputs` (`:411-442`) is REMOVED; editing saves fields + re-enters `pending_review` (a "Save & resubmit for review" action that syncs cover/gallery/price/pitch and does NOT flip any serving column). No client call sets `deck_eligible` anymore.

#### 4.3.F Service — `businessPlaceAuthoringService.ts`
- `runTier2Pipeline`/`regenerate_sales_bio` result type (`Tier2PipelineResult:51-60`) keeps `generated_bio` + `facets`; it no longer implies scores were written (update the doc comment).
- `confirmAiOutputs` (`:287-314`) becomes unused by the wizard/edit surface — leave the function (append-only; a pinned test may reference it) but it is no longer called from live UI. Add `updatePitch({ brandId, venueId, placePoolId, pitch, regenerate? })` for §4.3.D if a new action is chosen. `evaluate_signals` is NOT exposed in this client service (service-role only, invoked by admin edge fn).

### 4.4 Consumer app (`app-mobile`) — swipe card (D-6)
- `deckService.ts` `unifiedCardToRecommendation` maps `card.description`/`card.oneLiner` straight through (`:213/:224/:248`, F-2). After §4.2.D the card carries the pitch; no mapper change is strictly required IF the card already exposes `description`/`oneLiner`. Verify the card type carries them; the swipe face (`SwipeableCards.tsx:3042-3045`) renders `oneLiner` when truthy and the expanded modal (`ExpandedCardModal.tsx:2065`) renders `description`. Per DESIGN, confirm the face shows the pitch as `oneLiner` (clamped) or leaves it to the modal. NO new component; existing slots light up when populated.

---

## 5. Success criteria (observable, testable; per-surface where parity is manual)

- **SC-1 (D-1 backend).** After a create "Submit for review", NO `place_pool.ai_signal_scores` exists for that venue's place until an admin approves it (query `place_pool.ai_signal_scores` = null/absent pre-approve for the business-authored slice).
- **SC-2 (D-2 approve).** After admin `approve`, `place_pool.ai_signal_scores` is populated (16 signals, 6-key shape, `prompt_version` stamped) AND `place_scores` rows exist for the venue (blend ran over fresh AI scores). If the eval fails, the venue stays `verified` but `is_servable=false` and NO `place_scores` were written (fail-close).
- **SC-3 (D-1 wizard).** The create wizard collects cover, photos, price, and a single Pitch field in ONE pass; on submit the owner lands on the listing page in `pending_review` with NO separate deck-readiness leg and NO "Recommend me to users" button.
- **SC-4-iOS / SC-4-Android (D-4).** The Pitch step shows ONE field (no tagline). Entering <20 chars (and >0) blocks the step; empty is allowed; ≥20 passes. "Generate/Regenerate with AI" fills the field and remains editable; submit is not blocked on it.
- **SC-5 (D-3 listing edit, pending).** On a pending venue, editing the pitch on the listing page and saving persists the new text (visible on reload); approve applies it to `generative_summary`.
- **SC-6 (D-3 listing edit, live).** On a verified venue, editing the pitch writes `place_pool.generative_summary` directly and the Sub-D trigger queues a re-eval (row's `ai_signal_scores.*.evaluated_at` refreshes after the cron).
- **SC-7 (D-5).** Pre-approval the listing "How you match Mingla moments" section is empty with copy "Scores appear after Mingla approves your venue" (NO "Recommend me" reference); post-approval it shows 0-100 bars per signal.
- **SC-8-Web (D-6 public).** `GET venue_public_view` for a verified venue returns `pitch`; `/b/{b}/v/{v}` renders the pitch body and uses it as the meta description (falls back to "{name} — {brand} on Mingla" when null). A pending/rejected venue is still absent from the view (anon-safe).
- **SC-9-iOS / SC-9-Android (D-6 card).** For a servable venue with a non-empty `generative_summary`, the consumer swipe card/modal renders the pitch (per DESIGN slot); an empty pitch degrades to today's name-only card (no blank artifact).
- **SC-10 (gate relocation).** A venue with <5 gallery photos cannot be flipped `is_servable=true` at approve (stays verified-but-off-deck with a gallery reason).
- **SC-11 (sole-owner).** No file other than `run-place-intelligence-trial/index.ts` and `run-business-place-authoring-pipeline/index.ts` writes `place_pool.ai_signal_scores` (gate stays green with writer unchanged).

---

## 6. Invariants

### Preserved
- **I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE (ACTIVE).** The folded create wizard + the new `evaluate_signals`/bio-draft actions MUST NOT write serving-read place columns pre-approve; claim stays stage-only. Verified by gate `orch-1263-claim-stage-only-preapprove.mjs` (unchanged): (a) `opening_hours: normalizeBusinessHoursForPool` still appears exactly ONCE (the create INSERT) — do NOT add a second; (b) no `[mediaUrl]` one-element `stored_photo_urls`; (c) `handleSyncHeroMedia` keeps `nextStoredPhotosForHero(`; (d) no `claimed_by:`/`is_claimed:` in the tier-1 claim branch. The bio-draft write targets `business_authoring_inputs` only.
- **I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (ACTIVE).** UNCHANGED — the writer stays `run-business-place-authoring-pipeline/index.ts` (via `evaluate_signals`, invoked by admin). `ALLOWED_WRITER_FILES` in `i-ai-signal-scores-column-sole-owner.mjs` is NOT edited. (This is the whole point of OQ-3 = invoke-pipeline.)
- **I-AI-SIGNAL-SCORES-SHAPE-CONTRACT / -PROMPT-VERSION-DISCRIMINATED.** The `evaluate_signals` eval keeps the 6-key entry shape + stamps `prompt_version` (`buildAiSignalScores`, F-8) — reused verbatim.
- **I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE (DRAFT).** M1 adds `pitch` to `venue_public_view` (still verified-only, definer). Gate `orch-1255-public-venue-anon-safe.mjs` unchanged (service still reads `venue_public_view`, never `venue_listings`).
- **I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW**, **orch-1255-no-hidden-brand-on-venue-create**, **orch-1218-venue-authoring-no-vendor-leak**, **collab-deck determinism** (RPC `ORDER BY` unchanged in M2) — all preserved.
- **I-NET-NEW-HOLD / I-NO-CLAIM-DEMOTION.** Net-new rows stay `is_servable=false` until approve; a claim of an already-live place is not demoted (`nextIsServableForConfirm`, F-9) — untouched.

### Retired
- **I-PROPOSED-1285-CREATE-LANDS-ON-DURABLE-DECK-READINESS (DRAFT) → RETIRE.** D-1 deletes the `router.replace(routeForDeckReadinessFix(...))` create-success nav the gate hard-requires (F-15). DELETE the gate file `.github/scripts/strict-grep/i-proposed-1285-create-lands-on-durable-deck-readiness.mjs` AND its job in `.github/workflows/strict-grep-mingla-business.yml`. Add a superseding note (DECISION_LOG at CLOSE): "1285's durable-route landing is superseded by META-ORCH-1290 D-1 single-submit; the durable `/venue/deck-readiness` route SURVIVES as Hub→Edit only." Do NOT merely edit the gate — its premise is inverted.

### New (DRAFT — flip ACTIVE at CLOSE; orchestrator owns the flip)
- **I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE (DRAFT).** No code path writes `place_pool.ai_signal_scores` for a BUSINESS-authored venue before its `venue_listings.claim_status = 'verified'`. Scoped to the business path — the `run-place-intelligence-trial` Google-trial write is explicitly out of scope (D-2 nuance). Gate = §9 G-A.
- **I-PROPOSED-1290-PITCH-CONSUMER-FACING (DRAFT).** `place_pool.generative_summary` is surfaced to consumers via BOTH (a) `venue_public_view.pitch` and (b) the two servable RPCs → `discover-cards` card `description`. Gate = §9 G-B.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Submit create venue | full wizard submit | `place_pool.ai_signal_scores` null; `business_authoring_status` not `deck_eligible`; `claim_status=pending_review` | DB/edge |
| T-2 | Approve venue | admin `approve` on a ≥5-photo venue | `ai_signal_scores` (16, stamped) + `place_scores` rows exist; `is_servable=true` | DB/edge |
| T-3 | Approve, eval fails | Gemini 500 at `evaluate_signals` | `signal_eval_failed` returned; `is_servable=false`; no `place_scores`; claim still `verified` | edge |
| T-4 | Approve, <5 photos | approve a 3-photo venue | not servable; gallery reason recorded; verified | edge |
| T-5 | Pitch field validation | 10-char pitch | step blocked ("≥20 or clear it"); empty → allowed | client |
| T-6 | AI generate pitch | tap Generate | textarea fills with `generated_bio`; editable; NO `ai_signal_scores` written | client/edge |
| T-7 | Edit pitch (pending) | edit + save on pending venue | `tier1.description` updated; reload shows it; approve → `generative_summary` = it | client/edge |
| T-8 | Edit pitch (live) | edit + save on verified venue | `place_pool.generative_summary` updated; Sub-D re-eval queued | client/edge |
| T-9 | D-5 empty-state | pending venue listing | "Scores appear after Mingla approves your venue"; NO "Recommend me" | client |
| T-10 | Public page pitch | verified venue `/b/{b}/v/{v}` | pitch body + meta = pitch; null pitch → mechanical meta | web |
| T-11 | Anon-safety | pending venue in `venue_public_view` | absent (verified-only preserved) | DB |
| T-12 | Card pitch | servable venue with pitch | card `description`/`oneLiner` = pitch (per DESIGN); empty pitch → name-only | consumer |
| T-13 | Sole-owner gate | full diff | `i-ai-signal-scores-column-sole-owner.mjs` green (writer unchanged) | CI |
| T-14 | 1285 retirement | delete gate + job | `strict-grep-mingla-business.yml` no longer references the 1285 gate; suite green | CI |
| T-15 | Backward-compat | Academy (pre-existing scores + pitch) & The Cluster Fuck (none) | Academy pitch renders on card/public once verified; approve re-evaluates both; no crash on absent scores | DB/consumer |

---

## 8. Implementation order

1. **DB (M1, M2)** — write + apply both migrations via Management API; run the SQL `__tests__` complements.
2. **Edge — pipeline** — split `callGeminiForEvaluations` into bio-draft + signal-eval; strip `ai_signal_scores` from `handleTier2`; add `evaluate_signals` action + `requireServiceRole` branch.
3. **Edge — admin-review** — invoke `evaluate_signals` between authored-apply and go-live (fail-close); relocate `businessGateReasons` gate into `runApproveGoLive`.
4. **Edge — discover-cards** — map `generative_summary` → card `description`/`oneLiner` (per DESIGN).
5. **Service — publicEventsService** — add `pitch` to `VenuePublicViewRow` + `PublicVenue` + mapper; ensure the resolve query selects it.
6. **Client — public page** — `PublicVenuePage.tsx` render pitch + meta fallback.
7. **Client — wizard** — `venueWizardValidation.ts` step map + validation; shared Pitch component + AI affordance; `VenueCreatorWizard.tsx` fold steps + remove deck-readiness nav; edit-surface button changes.
8. **Client — listing** — editable pitch + `update_pitch` action wiring; D-5 + "Changes remaining" copy.
9. **Client — consumer** — verify `deckService.ts`/card slots light up (map field if needed).
10. **CI** — delete the 1285 gate + workflow job; add G-A + G-B gates + workflow jobs (append-only).

---

## 9. Regression prevention (fails-on-revert contracts)

- **G-A — `.github/scripts/strict-grep/i-proposed-1290-no-business-signal-scores-pre-approve.mjs` (NEW, append job to `strict-grep-mingla-business.yml`).** Over `run-business-place-authoring-pipeline/index.ts` (comment-stripped): FAIL if `handleTier2` (the `run_tier2_pipeline`/`regenerate_sales_bio` handler) contains an `ai_signal_scores:` key in a `place_pool.update(`. PASS only when the pre-approve eval write is absent. `--self-test`: GOOD = handleTier2 with bio-draft only; BAD = handleTier2 with `ai_signal_scores: ...` restored → FAILS. Reverting D-2 (re-adding the pre-approve write) fails this gate.
- **G-B — `.github/scripts/strict-grep/i-proposed-1290-pitch-consumer-facing.mjs` (NEW, append job).** FAIL unless (a) `discover-cards/index.ts` maps `generative_summary` into the card `description` (regex `description:\s*.*generative_summary`), AND (b) the M2 migration adds `pp.generative_summary` to BOTH servable RPCs, AND (c) `venue_public_view` migration/view exposes `generative_summary`/`pitch`. `--self-test` GOOD/BAD fixtures. Reverting D-6 (restoring `description: ''`) fails (a).
- **Sole-owner gate (existing) as a fails-on-revert for OQ-3:** `i-ai-signal-scores-column-sole-owner.mjs` stays green ONLY because the writer stays the pipeline file; if an implementor moves the write into `admin-review-venue-claim` without amending the allowlist, this gate FAILS — a built-in guard that OQ-3's invoke-mechanism was honored.
- **SQL runtime complements:** extend `orch_1255_public_view_anon.test.sql` (pitch present + verified-only) and add a `meta_orch_1290_servable_rpc_pitch.test.sql` (RPC returns `generative_summary`).
- **Behavioral edge tests:** a pipeline test asserting `handleTier2` payload has NO `ai_signal_scores` key; an admin-review test asserting eval-invoke ordering (authored-apply → evaluate_signals → go-live) and fail-close (eval error → no `runApproveGoLive`). Protective comments cite D-2/OQ-3.

**Protective-comment "why":** each gate/test carries a one-line comment: "META-ORCH-1290 D-2: business signal scores are computed at APPROVE, never at authoring — reverting re-introduces pre-approval scoring / hides the pitch."

---

## 10. Open questions — RESOLVED in this SPEC (with the resolution binding)

- **OQ-1 (pitch consumer-facing?)** RESOLVED **YES** by D-6 — wired into card + public page (§4.2.D, §4.1 M1/M2, §4.3/4.4).
- **OQ-2 (D-3 mechanism)** RESOLVED **SPLIT** — bio-draft at submit + 16-signal eval at approve (§4.2.A).
- **OQ-3 (D-2 writer)** RESOLVED **invoke-pipeline** — approve invokes the pipeline's `evaluate_signals` (service-role auth branch); `ai_signal_scores` writer unchanged; sole-owner gate + invariant UNTOUCHED (§4.2.A/B). Fallback (write in admin-review + amend allowlist) is documented but NOT taken.
- **OQ-4 (RECOMMEND_EDIT_CAP)** RESOLVED **retire** — the "Recommend me" edit-cap + "Changes remaining" card are removed with the button (§4.3.D). `RECOMMEND_EDIT_CAP`/`business_recommend_edit_count` become dead; leave the DB column (no destructive migration).
- **OQ-6 (pitch edit re-eval)** RESOLVED **DESIRED** — a live-venue pitch edit fires the Sub-D `generative_summary` trigger → re-scores (§4.3.D SC-6); documented, not suppressed.
- **OQ-7 (submit gate strictness)** RESOLVED **converge-to-claim** — the single submit does NOT hard-require gallery ≥5 (claim defers it); ≥5 is enforced at approve (§4.2.B, SC-10). Facets are AI-inferred at approve, not a wizard step (§4.2.C).

**Still needs Seth / operator (does NOT block the build):**
- **OQ-5 (backward-compat, 2 pending venues).** Academy (already has Google-trial `ai_signal_scores` + a pitch) and The Cluster Fuck (none). Binding plan: LEAVE existing scores in place (they don't rank — net-new rows are `is_servable=false` until approve, F-9); approve RE-EVALUATES fresh, overwriting the business slice. Tester (with read-only prod access, project `gqnoajqerqhnvulmnyvv`) must VERIFY pre-approve `ai_signal_scores` provenance on both rows and confirm approve overwrites cleanly. No data migration required.

---

## 11. Downstream routing

- **Next = mingla-implementor** (SPEC execution, this worktree). Then **mingla-tester** (adversarial + live-fire on business sim + the two SQL/edge runtime complements + read-only prod check for OQ-5). Then **mingla-orchestrator CLOSE** (flip the two `I-PROPOSED-1290-*` DRAFT invariants ACTIVE; retire I-PROPOSED-1285; record the DECISION_LOG supersede note; deploy edge fns + apply migrations via Management API + Vercel `[deploy]`; NO business/consumer `eas update` — both native changes ride their next native builds per COMMS-0052/0047).
- **Working tree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]/` on branch `orch-1290-venue-authoring-one-submission`.

---

## Scoped allowlist (implementor may change ONLY these) + DO-NOT-TOUCH

### Allowlist
- `supabase/migrations/20261211000000_meta_orch_1290_venue_public_view_pitch.sql` (NEW)
- `supabase/migrations/20261211000001_meta_orch_1290_servable_rpcs_generative_summary.sql` (NEW)
- `supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql` (extend) + `supabase/migrations/__tests__/meta_orch_1290_servable_rpc_pitch.test.sql` (NEW)
- `supabase/functions/run-business-place-authoring-pipeline/index.ts`
- `supabase/functions/admin-review-venue-claim/index.ts`
- `supabase/functions/_shared/authoredApply.ts` (comment + facet legacy note only; behavior via `tier1.description` unchanged)
- `supabase/functions/discover-cards/index.ts`
- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/src/services/businessPlaceAuthoringService.ts`
- `mingla-business/src/components/venue/PublicVenuePage.tsx`
- `mingla-business/src/components/venue/venueWizardValidation.ts`
- `mingla-business/src/components/venue/VenueStep6Description.tsx` (+ shared `VenuePitchStep` if extracted, NEW under the same dir)
- `mingla-business/src/components/venue/claim/ClaimStepPitch.tsx`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx`
- `mingla-business/src/components/venue/VenueListingContent.tsx`
- `mingla-business/src/components/venue/VenueIntelligenceModule.tsx`
- `app-mobile/src/services/deckService.ts` (map new card field ONLY if the card type doesn't already carry it)
- `.github/scripts/strict-grep/i-proposed-1290-no-business-signal-scores-pre-approve.mjs` (NEW)
- `.github/scripts/strict-grep/i-proposed-1290-pitch-consumer-facing.mjs` (NEW)
- `.github/scripts/strict-grep/i-proposed-1285-create-lands-on-durable-deck-readiness.mjs` (DELETE)
- `.github/workflows/strict-grep-mingla-business.yml` (remove the 1285 job; append the two 1290 jobs)
- edge behavioral tests under `supabase/functions/**/__tests__/` (append-only)

### DO-NOT-TOUCH (stop-and-amend before any change)
- `supabase/functions/run-signal-scorer/index.ts` — `place_scores` sole owner; the blend already runs at approve (F-9). No change.
- `supabase/functions/_shared/signalScorer.ts` `computeScore` — AI is already optional (`:313`); no change.
- `supabase/functions/run-place-intelligence-trial/index.ts` — the OTHER legit `ai_signal_scores` writer (Google trial). D-2 does NOT touch it.
- `i-ai-signal-scores-column-sole-owner.mjs` `ALLOWED_WRITER_FILES` — MUST stay {trial, pipeline}. Amend ONLY if the implementor abandons the invoke-mechanism (requires a SPEC amendment).
- `venue_listings` schema / `place_pool` schema — no new column (D-4 reuses `generative_summary`).
- `biz_review_venue_claim` RPC / `claim_status` lifecycle — unchanged.
- Anchor checkout `~/Desktop/mingla-main` — never edit.

Any change outside the allowlist → **stop-and-amend** (append here or `SPEC_AMENDMENT_META-ORCH-1290_*.md`); never silently widen.
