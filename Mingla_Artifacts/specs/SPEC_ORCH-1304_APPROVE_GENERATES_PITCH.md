# SPEC — ORCH-1304 [approve generates the pitch]

**Phase:** SPEC → IMPLEMENT (driven to completion in one pass by operator directive)
**Branch / worktree:** `ORCH-1304-approve-generates-pitch` @ `~/Desktop/mingla-orchs/ORCH-1304-[approve-generates-pitch]` (off `origin/main` `e3743acf6`).
**Supersedes:** META-ORCH-1290 decision **D-3** ("pitch = AI-drafted by the owner at submit"). ORCH-1304 moves pitch generation to **admin approve**. All other 1290 decisions (D-1 one-submission, D-2 score-on-approve, D-4 one Pitch field, D-5 breakdown, D-6 consumer-facing) stand.
**Operator decision:** pitch is generated when the admin approves; the venue goes **live immediately** with the AI pitch; the owner refines it afterward on the listing page.

---

## 1. Executive summary

Today the owner writes/generates the pitch themselves before submitting (a "Generate pitch with AI" button + a Pitch wizard step). ORCH-1304 removes ALL owner-side pre-approval pitch generation. The owner submits photos/cover/website/price/hours/contact only. When the admin clicks **Approve**, the approve edge path — which already generates the 16-vibe scores (`evaluate_signals`) — ALSO generates the AI pitch and writes it to `place_pool.generative_summary`, so the venue goes live with a pitch. The owner then edits/regenerates that pitch on their listing page (the existing `VenuePitchField`, now shown only once the venue is verified).

---

## 2. Scope & non-goals

### In scope
- **Backend:** at approve, generate the pitch and write `generative_summary` (only when it is currently empty — never clobber an owner edit on re-approve). Fail-SOFT: a pitch-gen failure does NOT block go-live (scoring stays fail-CLOSE). (§4.1)
- **Backend:** a new owner-authed `save_tier2` pipeline action so the deck-readiness edit surface can persist website/price/vibes/facets WITHOUT generating a pitch. (§4.1)
- **Client:** remove the Pitch step from the create wizard (s6) and the claim wizard (c5); remove the "Generate pitch with AI" + pitch textarea + "Save pitch" block from `VenueDeckReadinessSetup`; keep that screen as an inputs editor (Save via `save_tier2`). (§4.2)
- **Client:** on the listing page, show the editable `VenuePitchField` ONLY for a verified venue; for pending, show a read-only placeholder ("Mingla writes your pitch when your venue is approved — you can edit it here after."). (§4.2)
- **Client:** fix the stale `VenueSettingsModule` "Photos & vibes & AI" copy — drop the "Re-run Recommend me"/edit-cap language; relabel to "Edit photos & details"; empty-state → "Your pitch and match scores are written when Mingla approves your venue." (§4.2)
- **CI + tests:** keep the three 1290 gates green; add ORCH-1304 gate(s) + behavioral tests. (§4.3, §7)

### Non-goals
- **No admin-UI change.** The "Mark as called → Approve" flow is unchanged (a separate concern the operator did not ask to change here). Approve still calls the same edge path.
- **No new DB column, no migration.** Reuse `generative_summary`; no schema change.
- **No change to scoring** (`evaluate_signals` scoring half, `run-signal-scorer`, sole-owner of `ai_signal_scores`).
- **No consumer/public change** — D-6 already renders `generative_summary`; approve now populates it, which is exactly what those surfaces read.
- **No removal of `VenuePitchField`** — it stays for post-approve listing edits (and its bio-draft action stays for the owner's post-approve "Regenerate").
- **No `RECOMMEND_EDIT_CAP` / `recommend_edits_remaining` behavior change** beyond hiding its stale copy (dead-but-harmless; leave the DB column/field).

---

## 3. Cross-surface impact

| # | Surface | Covered | Behavior | Parity |
|---|---------|---------|----------|--------|
| 1 | Consumer iOS/Android | NO (verify) | Card already reads `generative_summary`; now it's populated at approve. No code change. | automatic |
| 2 | Buyer/anon Web (public venue page) | NO (verify) | `venue_public_view.pitch` already exposes it. No change. | automatic |
| 3 | Business iOS/Android (native) | YES | Wizard loses Pitch step; deck-readiness loses pitch-gen; listing pitch verified-only. **NATIVE-BUILD-ONLY (COMMS-0052)** — rides next business native build. | shared RN |
| 4 | Business Web preview | YES | Same files; ships on Vercel `[deploy]`. This is what the operator tests on `business.usemingla.com`. | same bundle |
| 5 | Admin Web | NO | Approve orchestration change is backend; admin UI unchanged. | verify |
| 6 | Edge (`run-business-place-authoring-pipeline`, `admin-review-venue-claim`) | YES | Pitch generated at approve; `save_tier2` added. Deploy via Supabase. | n/a |

**Ship channels:** edge fns → Supabase deploy (operator/prod-gated). Business client → Vercel `[deploy]` (web) + next business native build (NO `eas update`, COMMS-0052).

---

## 4. Layered specification

### 4.1 Edge functions

#### A. `run-business-place-authoring-pipeline/index.ts` — generate the pitch at approve
In `handleEvaluateSignals` (the service-role approve action), AFTER `buildAiSignalScores` and BEFORE the `place_pool.update`:
- Read the current pitch: `existingPitch = asString(place.generative_summary ?? "").trim()`.
- If `existingPitch.length === 0`: call `callGeminiForBioDraft({ brand: brandForPrompt, place, tier2, imageUrls, websiteText: websiteScan?.text ?? null })` inside its own `try/catch`. On success with a non-empty `bio`, set `generatedPitch = bio.trim()`. On ANY error, `console.error` and leave `generatedPitch = null` (fail-soft — scoring already succeeded; the venue still goes live; the owner regenerates later).
- Include `generative_summary` in the single existing `place_pool.update(...)` ONLY when `generatedPitch !== null`: `...(generatedPitch !== null ? { generative_summary: generatedPitch } : {})`. Never write `generative_summary: null` here (don't wipe a Google-trial summary).
- Update the return payload to include `pitch_generated: generatedPitch !== null`.
- Protective comment: "ORCH-1304: the pitch is generated at APPROVE (only when empty — never clobber an owner edit or a seeded summary). Reverting re-introduces owner-side pre-approval pitch generation."

**Ordering guarantee:** `admin-review-venue-claim` runs `applyAuthoredContentOnApprove` (which OMITS `generative_summary` when the authored pitch is <20 chars — now always, since the owner writes none) BEFORE invoking `evaluate_signals`. So the place read inside `handleEvaluateSignals` sees `generative_summary` = null (new venue) → generates; or = an owner's prior edit / seeded Google summary → preserves. No conflict.

#### B. `run-business-place-authoring-pipeline/index.ts` — new `save_tier2` action
- Add `handleSaveTier2(client, brand, venue, body)` (owner-authed; reached AFTER `requireUser → loadOwnedBrand → loadOwnedVenue`, exactly like `update_pitch`).
- Behavior: merge `body.tier2` into `business_authoring_inputs.tier2` (stage) — website/price_tiers/vibe_chips/facets — via one `place_pool.update({ business_authoring_inputs: nextInputs })`. It writes NO serving column and calls NO Gemini (I-1263 preserved). Mirror `handleUpdatePitch`'s stage-merge pattern. Return `{ kind:"ok", action:"save_tier2", place_pool_id }`.
- Router: add `if (body.action === "save_tier2") return await handleSaveTier2(...)` next to `update_pitch`.
- **Do NOT touch** `handleTier2`/`run_tier2_pipeline`/`regenerate_sales_bio` — they remain the bio-draft action used by the listing page's post-approve "Regenerate".

#### C. `admin-review-venue-claim/index.ts`
- **No change required.** It already invokes `evaluate_signals` at approve (which now also generates the pitch). Verify only: the eval invoke stays between authored-apply and go-live; the fail-close on eval error is unchanged (scoring failure still blocks go-live; pitch failure is swallowed inside `handleEvaluateSignals` and never surfaces as an eval error).

### 4.2 Business client (`mingla-business`)

#### D. `venueWizardValidation.ts`
- Remove step `s6` ("Pitch") from `CREATE_STEPS` and `c5` ("Pitch") from `CLAIM_STEPS`. Renumber remaining create steps (s6 Price→ becomes the step after Contact; keep ids stable-enough or re-key — the wizard body switch must match). Remove the `case "s6"` and `case "c5"` pitch-validation branches (and update `CLAIM_FILLABLE_TOTAL` from 9 → 8, and `claimStepPrefilled`/`claimDockLabel`/`claimPrefilledStepCount` c5 references).
- The owner's `draft.description` is no longer collected in the wizard → on submit it is empty → the pitch is generated at approve.

#### E. `VenueCreatorWizard.tsx`
- Remove the `VenuePitchField` render (the s6 case) from the body switch and its import if now unused. Renumber the switch cases to match the new step map. `handleSubmit` still passes `bio: st.description.trim()` (now "") — harmless; the approve path generates the pitch.

#### F. `claim/ClaimStepPitch.tsx` + its mount
- Remove the `ClaimStepPitch` render (the c5 case) from the wizard body switch; keep the file (append-only friendliness) or delete if no longer imported anywhere — implementor's call, but do not leave a dead import.

#### G. `VenueDeckReadinessSetup.tsx`
- Remove the "About your venue → Our AI scans…" pitch hint, the **"Generate pitch with AI"** button, the loader card, and the entire `{generatedBio.length > 0 ? ...}` pitch textarea + "Save pitch" block. Remove `handleRunAi`/`handleSavePitch`/`runTier2Pipeline`/`updateVenuePitch`/`generatedBio`/`editedBio`/`recommendStage`/`shotFailed`/`RECOMMEND_STAGES`/`websiteScreenshotUrl` and related state.
- Keep cover, gallery, website, price, vibes, facets collection. Replace the removed button with a single **"Save changes"** primary button → new `saveTier2({ brandId, venueId, placePoolId, tier2: buildTier2() })` service call (§H). Website/price/vibes/facets persist; cover+gallery already auto-save via `syncHeroMedia`/`syncGallery`.
- Update the header/help copy to drop "our AI writes your listing" pitch framing; keep "Get recommended on Mingla" + "Add photos, a website, and a price range so Mingla can match you to the right customers. Mingla writes your pitch and match scores when it approves your venue."

#### H. `businessPlaceAuthoringService.ts`
- Add `saveTier2({ brandId, venueId, placePoolId, tier2 })` → invokes `save_tier2`. Keep `runTier2Pipeline`/`updateVenuePitch`/`confirmAiOutputs` (still used post-approve on the listing).

#### I. `VenueListingContent.tsx`
- Gate the editable `VenuePitchField` block to `isLive` (verified). For a pending/rejected venue, render a read-only placeholder card instead: "Mingla writes your pitch when your venue is approved. You'll be able to edit it here after." (Keeps the owner from pre-approval pitch generation while preserving post-approve edit/Regenerate.)
- Leave `handleGeneratePitch`/`handleSavePitch`/`VenuePitchField` for the live branch unchanged.

#### J. `VenueSettingsModule.tsx`
- In the "Photos & vibes & AI" section: remove the `editsRemaining` "You can re-run Recommend me N more times" `<Text>`; change the empty-state to "Your pitch and match scores are written when Mingla approves your venue."; relabel the primary button "Re-run Recommend me" → **"Edit photos & details"** (still `goToDeckReadiness`); drop the `sparkle`/edit-cap `disabled` tie. Keep the "Edit photos & vibes" secondary button (or merge into the one primary).

### 4.3 CI + tests (§7, §9)

---

## 5. Success criteria

- **SC-1 (approve generates pitch).** Approve a venue whose `generative_summary` is null → after approve, `generative_summary` is a non-empty AI paragraph AND `ai_signal_scores` populated AND `is_servable=true`. (DB/edge)
- **SC-2 (no clobber).** Approve a venue whose `generative_summary` is already set (owner edit or seeded) → approve does NOT overwrite it; scores still refresh. (DB/edge)
- **SC-3 (pitch fail-soft).** If bio-gen throws at approve but scoring succeeds → venue still goes live (`is_servable=true`), `generative_summary` stays null, no error returned to admin. (edge)
- **SC-4 (scoring fail-close preserved).** If `callGeminiForSignalEval`/`buildAiSignalScores` throws → `evaluate_signals` 500s → admin-review fail-closes (no servable flip). (edge)
- **SC-5 (create wizard).** The create wizard has NO Pitch step and NO "Generate pitch with AI"; submit lands on the listing in `pending_review`. (client)
- **SC-6 (deck-readiness editor).** `VenueDeckReadinessSetup` has NO pitch generation; "Save changes" persists website/price/vibes/facets (visible on reload). (client/edge)
- **SC-7 (listing pending).** A pending venue's listing shows the "Mingla writes your pitch when approved" placeholder, NOT an editable/Generate field. (client)
- **SC-8 (listing live).** A verified venue's listing shows the editable `VenuePitchField` with Regenerate + Save (writes `generative_summary`). (client/edge)
- **SC-9 (settings copy).** `VenueSettingsModule` shows NO "Re-run Recommend me"/edit-cap copy. (client)
- **SC-10 (sole-owner).** `ai_signal_scores` writer unchanged; `save_tier2` writes no serving column. (CI)

---

## 6. Invariants
- **Preserved:** I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE (`save_tier2` stages only; no serving write pre-approve), I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (writer unchanged), I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE (scores still only at approve), I-PROPOSED-1290-PITCH-CONSUMER-FACING, I-PROPOSED-1290-PITCH-WRITES-VIA-PIPELINE-ACTION (`update_pitch` unchanged; `save_tier2` writes no pitch column).
- **New (DRAFT → ACTIVE at CLOSE):** **I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE** — the business venue pitch (`generative_summary`) is generated by `handleEvaluateSignals` at approve (only when empty), never by an owner pre-approval affordance. Gate = §9 G-1.

## 7. Test cases
| Test | Scenario | Expected | Layer |
|------|----------|----------|-------|
| T-1 | approve, empty pitch | `generative_summary` set by bio-draft; scores set; servable | edge (deno) |
| T-2 | approve, existing pitch | `generative_summary` unchanged; scores refreshed | edge |
| T-3 | approve, bio-gen throws, scoring ok | servable=true; `generative_summary` null; no error | edge |
| T-4 | approve, scoring throws | 500; admin-review fail-close (no flip) | edge |
| T-5 | `save_tier2` on pending | tier2 merged into `business_authoring_inputs`; no serving column written | edge |
| T-6 | create wizard step map | no "Pitch" label; validation has no s6/c5 pitch branch | client (jest) |
| T-7 | listing pending vs live | pending → placeholder; live → editable VenuePitchField | client |
| T-8 | G-1 gate self-test | GOOD (approve writes generative_summary) passes; BAD (removed) fails | CI |

## 8. Implementation order
1. Edge — pipeline: `handleEvaluateSignals` pitch-gen (§A) + `save_tier2` (§B).
2. Edge — verify `admin-review-venue-claim` unchanged (§C).
3. Service — `saveTier2` (§H).
4. Client — validation step map (§D), wizard (§E, §F), deck-readiness (§G), listing (§I), settings (§J).
5. CI/tests — G-1 gate + workflow job; deno tests T-1..T-5; jest T-6/T-7.
6. Run all gates + typecheck + jest + deno tests; fix.

## 9. Regression prevention (fails-on-revert)
- **G-1 — `.github/scripts/strict-grep/i-proposed-1304-pitch-generated-at-approve.mjs` (NEW).** Over `run-business-place-authoring-pipeline/index.ts` (comment-stripped): FAIL unless `handleEvaluateSignals` contains a `callGeminiForBioDraft(` call AND a `generative_summary` key reachable in its `place_pool.update`. `--self-test`: GOOD (present) passes; BAD (removed) fails. Append a job to `strict-grep-mingla-business.yml`.
- Keep the three META-ORCH-1290 gates green (they remain true).
- Behavioral deno test `meta_orch_1304_pitch_on_approve.test.ts` asserts T-1/T-2/T-3 via an injected fake client; jest asserts T-6.

## 10. Allowlist + DO-NOT-TOUCH
### Allowlist
- `supabase/functions/run-business-place-authoring-pipeline/index.ts`
- `supabase/functions/run-business-place-authoring-pipeline/__tests__/meta_orch_1304_pitch_on_approve.test.ts` (NEW)
- `mingla-business/src/services/businessPlaceAuthoringService.ts`
- `mingla-business/src/components/venue/venueWizardValidation.ts`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx`
- `mingla-business/src/components/venue/VenueListingContent.tsx`
- `mingla-business/src/components/venue/VenueSettingsModule.tsx`
- `mingla-business/src/components/venue/claim/ClaimStepPitch.tsx` (unmount only)
- `.github/scripts/strict-grep/i-proposed-1304-pitch-generated-at-approve.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (append one job)
- append-only tests under `mingla-business/**/__tests__` + `supabase/functions/**/__tests__`

### DO-NOT-TOUCH
- `admin-review-venue-claim/index.ts` approve orchestration (verify only; no behavior change).
- `run-signal-scorer`, `_shared/signalScorer.ts`, `run-place-intelligence-trial` — score writers untouched.
- `handleTier2` / `run_tier2_pipeline` / `update_pitch` / `handleUpdatePitch` — the post-approve Regenerate + pitch-edit paths stay.
- `venue_public_view` / servable RPCs / `discover-cards` — D-6 render paths already correct.
- The three 1290 strict-grep gates + `i-ai-signal-scores-column-sole-owner.mjs` allowlist.
- `place_pool` / `venue_listings` schema — no migration.
