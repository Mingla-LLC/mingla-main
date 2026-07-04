# IMPLEMENTATION — META-ORCH-1290 LEG B (business app) [venue authoring: one-submission + editable AI pitch + scores-on-listing]

**Phase:** IMPLEMENT (Leg B — business app client only). Leg A (backend) is on-branch (`77a945a..f5ba6e632`). Leg C (consumer swipe-card + public venue page) is separate.
**Worktree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` @ branch `orch-1290-venue-authoring-one-submission`.
**Contracts:** `SPEC_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` §Leg B + `DESIGN_META-ORCH-1290_AUTHORING_UX.md`.
**Status:** `implemented, partially verified` (unit/jest + static + web-export green; the two new backend actions the SPEC assumed are NOT on prod, so the pitch owner-write + AI-draft paths are unit/mock-proven only — runtime QA is the tester's phase). **Two orchestrator-owned blockers** (below).

---

## 1. Summary (plain English)

Listing a venue is now ONE flow. The create wizard collects everything in a single 10-step pass (address, name, hours, photos, cover, contact+website, pitch, price, bookings, review) and Submit lands the owner on the management page marked "In review" — the old second "deck-readiness / Recommend me to users" leg is gone. Tagline + description collapse into ONE **Pitch** field that the owner can draft with AI, edit, regenerate, or clear — the same field appears in the wizard, in claim, and on the listing page. The listing page's scores card now ALWAYS shows: before an admin approves, an honest "locked — a human decides which feeds you show up in" state with a real bar layout but NO fake numbers; after approval, the real 0–100 bars in plain moment-words with a strength ramp and a top-6 / Show-all toggle. The owner never self-approves anymore.

---

## 2. SPEC success-criteria coverage (Leg B rows)

| SC | What | Verified | Commit |
|----|------|----------|--------|
| SC-3 (folded wizard) | create collects cover/photos/price/pitch in ONE pass; submit → management "In review"; no deck-readiness leg, no "Recommend me" | ✓ jest folded-map + gates + nav-removal; web-export | `5b75e8d` |
| SC-4-iOS/Android (one pitch field) | ONE field (no tagline); <20&>0 blocks; empty allowed; ≥20 passes; Generate fills + stays editable; submit not blocked | ✓ jest `venueStepError s6` + VenuePitchField states | `5b75e8d` |
| SC-5 (listing edit, pending) | edit pitch on a pending venue persists (staged tier1.description); approve applies to generative_summary | ◑ implemented (RLS owner-write staged path); **unverified — needs runtime** | `5b75e8d` |
| SC-6 (listing edit, live) | verified venue → write generative_summary directly; Sub-D trigger re-queues eval | ◑ implemented (RLS owner-write to generative_summary; trigger confirmed in migration `20260808000000:369`); **unverified — needs runtime** | `5b75e8d` |
| SC-7 (D-5 scores states) | pre-approval "Your vibe scores appear once an admin approves…" + ghost preview (no "Recommend me"); post-approval 0-100 bars | ✓ jest listing scores card + intelligence copy | `5b75e8d` |
| SC-4 pitch AI (bio-draft, no scores) | "Draft/Regenerate" call the bio-draft action which writes NO ai_signal_scores | ✓ Leg-A gate G-A green; VenuePitchField wires `runTier2Pipeline` (bio-only per Leg A) | `5b75e8d` |

SC-1/2/8/9/10/11 are Leg A/C.

---

## 3. Files changed (Leg B)

| File | Δ | Note |
|------|---|------|
| `mingla-business/src/store/draftVenueStore.ts` | +~25 | top-level `galleryUrls` + `coverChoice` (additive, tolerant `pickDraft`, NO persist-version bump) |
| `mingla-business/src/components/venue/venueWizardValidation.ts` | +~55/−~20 | `CREATE_STEPS` → folded 10-step map; `venueStepError` s3-s8 mirror claim c3/c4/c6/c5/c7/c8 |
| `mingla-business/src/components/venue/VenuePitchField.tsx` | +~430 (NEW) | shared editable-AI-pitch control (6 states, `AI DRAFT` chip, Draft/Regenerate/Clear, Skeleton shimmer, no fabricated text) |
| `mingla-business/src/components/venue/VenuePhotosStep.tsx` | +~330 (NEW) | create s3 gallery on top-level `galleryUrls` |
| `mingla-business/src/components/venue/VenueCoverStep.tsx` | +~300 (NEW) | create s4 cover chooser on top-level `coverChoice` |
| `mingla-business/src/components/venue/VenueCreatorWizard.tsx` | +~60/−~40 | folded body switch (reuse claim Contact/Price/Bookings + new Photos/Cover + VenuePitchField); DELETE create→deck-readiness nav; syncGallery at submit; land via `onDone` |
| `mingla-business/src/components/venue/claim/ClaimStepPitch.tsx` | +~15/−~110 | body → shared `VenuePitchField` |
| `mingla-business/src/components/venue/VenueStep7Review.tsx` | +~70/−~20 | folded create summary (cover/photos/pitch/price/bookings) |
| `mingla-business/src/components/venue/VenueListingContent.tsx` | +~150/−~40 | editable pitch (`VenuePitchField` + `updateVenuePitch`); 3-state scores card (locked/populated/re-scoring); retire changes-remaining; lucide `Sparkles` (orch1196) |
| `mingla-business/src/components/venue/VenueIntelligenceModule.tsx` | +~4/−~4 | Tile-D empty copy → admin-approval locked copy |
| `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx` | +~25/−~40 | relabel AI button → "Generate pitch with AI"; remove self-publish confirm seam → "Save pitch" (staged) |
| `mingla-business/src/services/businessPlaceAuthoringService.ts` | +~90 | `updateVenuePitch` (RLS owner-write) + `fetchVenuePitchSource` |
| `mingla-business/src/components/venue/__tests__/venueAuthoringOneSubmission.metaOrch1290.test.ts` | +~230 (NEW) | 13 tests, all green |

---

## 4. Data-model changes

None. No migration, no new column. The pitch reuses `place_pool.generative_summary` (live) + the staged `business_authoring_inputs.tier1.description` (pending) — D-4. Draft store gains two client-only fields (galleryUrls/coverChoice), additive.

## 5. Edge functions touched

None (Leg B is barred from `supabase/functions`). See §Blockers — the SPEC's intended `update_pitch` action was not shipped in Leg A; the listing pitch owner-write uses the RLS-permitted direct `place_pool` UPDATE instead (§Deviations).

---

## 6. Regression tests added + fails-on-revert

- **`mingla-business/src/components/venue/__tests__/venueAuthoringOneSubmission.metaOrch1290.test.ts`** — 13 tests, all PASS: folded 10-step map + labels; s3 no-block / s4 cover-gate / s6 empty-or-≥20 / s7 price-gate; wizard retires the create-nav + lands via onDone + syncGallery; VenuePitchField `AI DRAFT` chip + "Draft with AI" + Skeleton (no fabricated text); listing LOCKED copy + ghost preview + strength ramp + Show-all; changes-remaining retired; deck-readiness self-publish seam removed + "Generate pitch with AI".
- **fails-on-revert verified at `5b75e8d84`** — true LINE DELETION of the `case "s6"` pitch gate in `venueWizardValidation.ts` → the "s6 Pitch is empty-allowed OR ≥20" test **FAILS**; restored (`git checkout`) → **PASSES**.
- **Append-only:** my commit adds ONE test file, modifies/deletes NONE (`git show 5b75e8d84 --name-status` — one `A`).

---

## 7. Old → New receipts (per surface)

### venueWizardValidation.ts
**Before:** create = 6 steps (s0 Address · s1 Name · s2 Hours · s3 Contact · s4 Inputs[tagline+description] · s5 Review).
**Now:** create = folded 10 steps (s0 Address · s1 Name · s2 Hours · s3 Photos · s4 Cover · s5 Contact+website · s6 Pitch · s7 Price · s8 Bookings · s9 Review); gates mirror claim (s3 no-block, s4 cover, s5 email|phone+E.164+website, s6 empty-or-≥20, s7 ≥1 tier).
**Why:** D-1 one-submission converge-to-claim; SPEC §4.3.A / OQ-7 / SC-3/SC-4.

### VenueCreatorWizard.tsx
**Before:** on create tier-1 success, `router.replace(routeForDeckReadinessFix(...))` into the post-submit deck-readiness leg.
**Now:** folds Photos/Cover/Contact/Pitch/Price/Bookings into the wizard; on success persists the gallery via `syncGallery` and lands the owner on the management page via `onDone(null, venueId, name)` — "In review". Passes website/price/gallery in the create tier-1 draft.
**Why:** D-1 (delete the second leg); SC-3.

### VenuePitchField.tsx (NEW) + ClaimStepPitch.tsx
**Before:** two-field VenueStep6Description (tagline + description); read-only ClaimStepPitch textarea.
**Now:** ONE shared editable field with 6 honest states (empty→"Draft with AI"; drafting→Skeleton shimmer + rotating status, NEVER fake text; drafted→real text + `AI DRAFT` chip + Regenerate + Clear; edited→chip drops, Regenerate confirms; error→"write your own or try again", non-blocking; disabled). Claim keeps its seeded note + provenance chip + "Start fresh".
**Why:** D-3/D-4 single pitch, one editable source, loading-truthfulness.

### VenueListingContent.tsx
**Before:** read-only `<Text>{bio}</Text>`; scores card rendered ONLY when scores existed; a "Changes remaining" edit-cap card.
**Now:** editable pitch (VenuePitchField + Save via `updateVenuePitch`, live→re-score caption); scores card ALWAYS renders (LOCKED ghost-preview / POPULATED bars w/ human labels + strength ramp + top-6/Show-all / RE-SCORING caption); changes-remaining REMOVED; `Sparkles` from lucide (orch1196 guard).
**Why:** D-3/D-5; OQ-4 retire the cap.

### VenueDeckReadinessSetup.tsx (survives as Hub→Edit)
**Before:** "Recommend me to users" (ran the pre-approve eval) + "Approve & publish" (owner self-publish → deck_eligible).
**Now:** "Generate pitch with AI" (bio-draft only, per Leg A) + "Save pitch" (stages the pitch; flips NO serving column, never sets deck_eligible).
**Why:** D-2 no owner self-approval; §4.3.E.

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Business iOS | YES | folded wizard + pitch field + listing scores/pitch — NATIVE-BUILD-ONLY (COMMS-0052) |
| Business Android | YES | same (shared RN — automatic) |
| Business Web preview | YES | rides Vercel `[deploy]`; web export exit 0 |
| Consumer iOS/Android | NO | Leg C (swipe card) |
| Buyer/anon Web (public page) | NO | Leg C (`PublicVenuePage` / `publicEventsService`) |
| Admin Web | NO | — |

Parity is automatic (one RN codebase). No manual parity split within Leg B.

## 9. Smoke result

No device/sim smoke (implementor scope). Static + jest + web-export only. The pitch owner-write + AI-draft paths depend on Leg A's `run_tier2_pipeline` (bio-draft) already on-branch and the RLS owner-UPDATE policy `place_pool_business_owner_update` (verified present in migration `20261130000003:1355`) — but are NOT runtime-verified here (the tester must live-fire on the business sim once Leg A's edge fns + migrations are deployed).

## 10. Known issues / deferred

- **Listing pitch persistence uses a direct RLS owner-write, not an edge action** (§Deviations) — the SPEC's `update_pitch` action was never built in Leg A. This is RLS-guarded and delivers SC-5/SC-6, but the tester should confirm the RLS predicate resolves for a brand-author caller at runtime.
- **Regenerate has no visible cap, but Leg A's backend still enforces `RECOMMEND_EDIT_CAP` on `run_tier2_pipeline`** (Leg A discovery D-B). A 5th regenerate 429s → VenuePitchField error state 5 handles it honestly (non-blocking). Recommend a Leg-A follow-up to lift the cap on the bio-draft action (OQ-4 retires the concept).
- **Create-from-scratch website/price reach approve via `business_authoring_inputs.tier1` only; `buildAuthoredApplyPatch` reads `tier2.website`/`tier2.price_tiers`.** For a pool-LINKED create the backend claim branch seeds tier2 (fine); for a pure create-from-scratch INSERT, website/price stage in tier1 but are not tier2-seeded, so they may not apply at approve (gallery IS handled via `syncGallery`; pitch/cover/hours apply correctly). Low severity (deck-refinement, not blocking). See Discoveries.
- **DESIGN §2.3 tap-to-jump review rows** are rendered as a non-tappable summary (create's VenueStep7Review has no `onJump` plumbing) — the owner uses Back to edit. Deferred nicety.

## 11. Operator action required

None from me (no migration, no edge deploy in Leg B). Ships via the next business NATIVE build + Vercel `[deploy]` (COMMS-0052 — NO `eas update`). The two blockers below need orchestrator action before CLOSE.

## 12. Blockers (orchestrator-owned)

- **B-1 — pinned append-only tests obsoleted by D-1 (same class as Leg A's T-A6).** Three source-AST tests pin behaviors D-1 explicitly RETIRES and now fail at runtime; I did NOT modify them (dispatch guard + `tests-append-only.yml`):
  - `src/components/venue/__tests__/venueCreateDurableDeckReadiness.orch1285.test.ts` (test 1) — asserts the wizard calls `router.replace(routeForDeckReadinessFix(...))` — the create nav D-1 deletes.
  - `src/components/venue/__tests__/venueCreateDurableDeckReadiness.orch1285.tester.test.ts` (T3) — asserts exactly one `routeForDeckReadinessFix(` call.
  - `__tests__/orch1263ClaimAdoption.happy.test.tsx` (T-B1) — asserts `create = the pre-1263 six steps` (D-1 makes it 10).
  **Required:** authorize retiring/updating these with `[TEST-MOD-APPROVED META-ORCH-1290]` (the ORCH-1285 durable-route landing is superseded by D-1 single-submit — mirror the .mjs gate Leg A already retired). (`orch1263 T-B6` also fails but is PRE-EXISTING — it references `setCreatedVenue`, removed pre-1290.)
- **B-2 — the SPEC's `update_pitch` edge action was not shipped in Leg A.** Leg B is barred from `supabase/functions`, so the listing-pitch owner-write uses the RLS-permitted direct `place_pool` UPDATE. If the orchestrator prefers the SPEC's edge-action mechanism, dispatch a Leg-A addendum for `update_pitch` and I will re-point `updateVenuePitch` to it.

## Deviations from the literal SPEC text (behavior preserved)

1. **Listing-pitch persistence = direct RLS owner-write, not the SPEC's `update_pitch` edge action.** The action doesn't exist and Leg B can't add it. `updateVenuePitch` (in `businessPlaceAuthoringService.ts`) uses `place_pool_business_owner_update` (RLS) + `GRANT ALL … TO authenticated`: LIVE→`generative_summary` (Sub-D re-eval, SC-6); PENDING→staged `business_authoring_inputs.tier1.description` only, never a serving column pre-approve (I-1263, SC-5). DESIGN §4.1 explicitly mandates writing `place_pool.generative_summary`; this is the only in-boundary mechanism.
2. **s3 Photos does NOT hard-gate ≥5 at submit** — mirrors claim c3 (SPEC §4.3.A / OQ-7 "converge-to-claim"; ≥5 enforced at approve, SC-10). DESIGN §2.1's "≥5 at submit" pixel is overridden by the SPEC behavior contract (§6 rule). The step shows "≥5 to go live".
3. **Facets/best-for are NOT a wizard step** — SPEC §2 non-goal ("converge to claim, not widen"); facets are AI-inferred at approve (Leg A `evaluate_signals`). s7 is Price only (mirror claim c7), not DESIGN §2.1's "Price & highlights".
4. **No in-wizard AI generation** — the venue row doesn't exist pre-submit, so `run_tier2_pipeline` can't run; the wizard pitch is typed/left-empty (empty allowed), AI generation happens on the listing page where the venue exists (SPEC §4.3.C "generated later on the listing page"). No dead "Draft" button ships in the wizard.

## Verification matrix

| Gate | Result |
|------|--------|
| tsc (`npx tsc --noEmit`) | zero NEW errors in Leg-B files; all 729 residual errors are pre-existing (`../packages/*` cross-resolution + RTL-less render tests + app.config) — unchanged vs origin/main |
| jest — new suite | 13/13 PASS; fails-on-revert proven @ `5b75e8d84` |
| jest — regression sweep | my only NEW failures are the 3 B-1 blockers; `ve2`, `orch1190r2/r3`, `orch1184`, `orch1263 T-B6`, `liveEventStore` migrators are PRE-EXISTING baseline reds (verified by stash-baseline) |
| strict-grep | `i-ai-signal-scores-column-sole-owner`, `i-proposed-1290-no-business-signal-scores-pre-approve`, `i-proposed-1290-pitch-consumer-facing`, `orch-1255-*` (×4), `orch-1263-*` (×2), `i-proposed-1270-*` (×3) — all PASS |
| append-only | my commit adds 1 test, modifies/deletes 0 |
| expo export -p web --clear | exit 0 |

## Discoveries for Orchestrator

- **D-1 (blocker B-1):** three pinned tests pin D-1-retired behavior → test-sync authorization needed.
- **D-2 (blocker B-2):** `update_pitch` edge action never shipped; direct RLS write used.
- **D-3:** create-from-scratch website/price stage in `tier1`, but `buildAuthoredApplyPatch` reads `tier2` → they may not apply at approve for the pure-create INSERT path (pool-linked create is fine). Low severity; consider a Leg-A tier2-seed or extend the direct owner-write.
- **D-4:** Leg A left `RECOMMEND_EDIT_CAP` live on `run_tier2_pipeline` (Leg A D-B) → the listing/deck-readiness "Regenerate" 429s after 4 runs; VenuePitchField degrades honestly. Recommend lifting the cap on the bio-draft action (OQ-4).

---

**Downstream:** back to **mingla-orchestrator** for REVIEW → **mingla-tester** (business-sim live-fire of the folded wizard + pitch owner-write + scores states once Leg A edge fns/migrations are deployed; verify the RLS owner-UPDATE resolves for a brand-author caller). Orchestrator owns: the B-1 test-sync authorization, the B-2 mechanism decision, and CLOSE.
