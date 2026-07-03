# IMPLEMENTATION — ORCH-1263 [claim-adoption] LEG B (client) + Leg C jest groups

- **Phase:** IMPLEMENT (Leg B — `mingla-business/` client; plus Leg C's jest rows T-B1..T-B8)
- **Date:** 2026-07-02 · **Branch:** `orch-1263-claim-adoption` · **Worktree:** `~/Desktop/mingla-orchs/orch-1263-[claim-adoption]/`
- **Binding contracts:** `Mingla_Artifacts/specs/SPEC_ORCH-1263_CLAIM_ADOPTION.md` v2 (`338e2fca0`) §Leg B + jest rows of §Leg C, and the embedded `DESIGN_ORCH-1263_CLAIM_WALKTHROUGH.md` (`3abffeada`) for pixels/states/copy/motion
- **Builds on Leg A AS-BUILT** (`90a70c8d0..4db156cc7`): client tier-1 payload matches the §A3.1 stage reads (`draft.website` / `draft.priceTiers` / `draft.adoptedGalleryUrls` / `draft.adoption`); detail fired on YES via the claim-search-pool `{place_id}` mode (shared 10/min bucket; `{detail}` / 400 `invalid_place_id` / 404 `place_not_available`).
- **Status label:** implemented, partially verified — jest (28/28 new + full-suite parity with origin/main), all strict-grep gates green (G-2 flipped red→green), tsc zero-new vs origin/main, `expo export -p web --clear` exit 0. NO simulator/device runtime in this session — the sim walkthrough is tester-owned (§9/§11).
- Rebased on `origin/main` before work. NO server/migration/gate-file edits (verified: Leg B diff touches `mingla-business/**` only). NO deploys, NO OTA (business = NATIVE BUILD ONLY, COMMS-0052/0063).

## 1. Summary (plain English)

A venue owner who finds their place in Mingla's directory now walks a 10-step claim instead of retyping their business from scratch. The match card proves we know their place (their own photos plus "6 photos · Hours · Phone · Website · Rated on Google" fact pills — never a rating value); one tap on "Yes, this is me" pulls the full listing into a private draft (zero server writes until submit) and every step arrives pre-filled with keep/edit/delete controls and honest "On Mingla / Edited / New" chips. The one mandatory decision is picking a cover. Already-claimed and in-review places are blocked politely at the gate with a live-chat support path — the old six-step dead walk is gone. Late-night venues can finally save 10pm–2am hours (both validators fixed), a half-finished claim resumes instead of erroring, and an abandoned draft leaves no trace.

## 2. SPEC success-criteria coverage (client halves; server halves = Leg A)

| SC | Client obligation | Status | Evidence | Commit |
|---|---|---|---|---|
| SC-1 (client) | blocked card variants at the gate, NO Yes button; blocked sorts below available | ✓ tested | T-B5 (facts/sort/source-contract: `if (blocked)` precedes the Yes JSX) | `1cd92b547`, `5343f4edc` |
| SC-2 | YES → detail fetch → draft fill, zero server writes; fetch failure → explicit `Continue anyway` lean path; chips only for arrived fields | ✓ tested (fetch path UNVERIFIED live) | T-B2 (prefills pure, `detailFetched` flag); fetch fn unit-shape only — live curl at CLOSE | `e17152f6c`, `0c268a479` |
| SC-3 | c0 always renders; confident preselect + chip + Keep; unconfident unselected + "wasn't sure" copy; c0 blocks without a selection | ✓ tested | T-B2 unconfident arm + T-B1 + `venueStepError("c0")` | `43e76575a`, `c8ec360f4` |
| SC-4 | adopted 22:00→02:00 passes c2 untouched + `next day` line; `open===close` rejected with new copy in BOTH validators | ✓ tested | T-B3 (behavioral c2/s2 + source-contract both files) + G-2 green | `43e76575a` |
| SC-5 | c4 blocks until cover chosen; c3 remove/undo, New chips, move-menu reorder; nothing server-side pre-submit | ✓ tested (upload arm UNVERIFIED runtime) | T-B4 (gating + pure gallery ops); uploads = storage-only staging (D-B9) | `c8ec360f4` |
| SC-6/SC-7 (client half) | claim tier-1 draft carries EXACTLY the §A3.1 extras; cover rides createVenue | ✓ | wizard submit deltas + Leg A's T-A1 key-set asserts the server side | `5343f4edc` |
| SC-10 (client) | own-row resume (skip createVenue, re-run tier-1); tier-1-complete routes to management; foreign 23505 → §8.2 card, draft preserved | ✓ tested | T-B6 (plan matrix + pre-check-before-create + branch tokens) | `43e76575a`, `5343f4edc` |
| SC-12 | create path behaviorally unchanged (6 steps, same order, same writes) | ✓ | T-B1 byte-stable ids/labels; full jest suite fail-set IDENTICAL to origin/main; create submit flow preserved incl. inline deck-readiness | all |
| SC-13 | chips (3 states + revert), banner live-`n` + collapse, prefilled dots, dock labels, motion M-1..M-8 w/ reduced-motion, Android opaque, web deltas | ✓ built / partially tested | T-B7/T-B8 (logic); pixel/motion conformance = tester spot-check vs DESIGN; motion deviations D-B6 | `1cd92b547`, `c8ec360f4` |
| SC-8 / SC-9 / SC-11 | server-side | Leg A | — | — |

## 3. Files changed (all commits prefixed `ORCH-1263(B):`, `e17152f6c..fe587db6f`)

| File | Δ | Commit |
|---|---|---|
| `src/types/poolMatch.ts` | +54 | `e17152f6c` |
| `src/services/poolSearchService.ts` | +165/−36 | `e17152f6c` |
| `src/services/venueListingsService.ts` | +41/−4 | `e17152f6c` |
| `src/services/businessPlaceAuthoringService.ts` | +14 | `e17152f6c` |
| `src/store/draftVenueStore.ts` | +187/−16 | `0c268a479` |
| `src/utils/prefillDraftFromPoolMatch.ts` | +158/−18 | `0c268a479` |
| `src/components/venue/venueWizardValidation.ts` | +295/−48 | `43e76575a` |
| `src/components/venue/VenueSettingsModule.tsx` | +4/−1 (predicate only) | `43e76575a` |
| `src/components/venue/BrandHoursEditor.tsx` | +40/−12 (`next day` + equality copy) | `43e76575a` |
| `src/components/brand/ClaimMatchCard.tsx` (new) | +387 | `1cd92b547` |
| `src/components/brand/PoolMatchCard.tsx` | +8 ([TRANSITIONAL] header only) | `1cd92b547` |
| `src/components/ui/ProvenanceChip.tsx` (new) | +175 | `1cd92b547` |
| `src/components/ui/Stepper.tsx` | +119/−28 (additive `prefilled`) | `1cd92b547` |
| `src/components/venue/claim/` (11 new: Banner + c0–c9 steps) | +2,417 | `c8ec360f4` |
| `src/components/venue/VenueCreatorWizard.tsx` | +440/−? (shell: claim map/dock/banner/submit) | `5343f4edc` |
| `app/venue/create.tsx` | +272/−? (gate/YES/resume/success) | `5343f4edc` |
| `src/components/venue/VenueStep7Review.tsx` | +4/−4 (dead Photos row) | `5343f4edc` |
| `__tests__/orch1263ClaimAdoption.happy.test.tsx` (new) | +749 | `fe587db6f` |

Leg B total: 28 files, ~+5,340/−192 across the branch (incl. Leg A). Zero `supabase/**`, zero `.github/**` edits in Leg B.

## 4. Data-model changes applied

None (client-only leg). The persisted client draft bumps `mingla-business-draft-venue-v2` → `-v3` (pre-submit drafts; v2 blob abandoned — house precedent, prod-safe).

## 5. Edge functions touched

None in Leg B. Deploy list unchanged from Leg A §5 (`run-business-place-authoring-pipeline`, `admin-review-venue-claim`, `claim-search-pool` — all `verify_jwt` true).

## 6. Regression tests added + fails-on-revert

- **New:** `mingla-business/__tests__/orch1263ClaimAdoption.happy.test.tsx` — 28 tests across 8 groups (T-B1..T-B8 per SPEC §7). All pure/behavioral where the logic is exported (step model, prefills, validation, provenance, dock labels, review groups, banner math, gallery ops, submit plan) + source-contract arms where mounting is impossible under the node jest config (blocked-variant ordering, settings-module predicate, wizard pre-check ordering).
- **`fails-on-revert verified at fe587db6f`** — TRUE LINE DELETION of (a) the D-D `if (o === c)` equality check in `venueWizardValidation.ts` and (b) the ten `CLAIM_STEPS` entries → `3 failed, 25 passed` (T-B1 claim map, T-B3 equality, T-B8 hours-honesty). Restored → `28 passed, 28 total`.
- **Gates (all run this session):** G-2 `orch-1263-claim-front-load-and-overnight` — **self-test PASS + live PASS (was RED on arm (c) pre-Leg-B — the required gate-proof)**. G-1 stage-only-preapprove self-test + live PASS. All five `orch-1255-*` + `orch-1256-profile-todos` gates PASS.
- **Pinned suites:** full default jest run — branch `222 failed / 4855 total` vs origin/main baseline `222 failed / 4827 total`; `FAIL`-suite sets diffed **byte-identical** (the 222 are pre-existing on origin/main). The +28 passing are this ORCH's. `create.ve2` / `ve2PoolMatchFlow` / `prefillDraftFromPoolMatch` / `metaOrch1255LegB` / `LegC` / `tester.adversarial` re-run green explicitly (49/49).
- **Append-only:** the only test-path change in Leg B is the NEW file (verified via `git diff 4db156cc7..HEAD --name-only`).
- **tsc:** branch 727 errors == origin/main 727 (verified against a scratch `origin/main` worktree; the stale anchor's 721 is main-drift, not mine); zero errors in any touched file.
- **Web:** `npx expo export -p web --clear` exit 0.

## 7. Old → New receipts

### `src/types/poolMatch.ts` + `src/services/poolSearchService.ts`
**Before:** 13-field whitelist match row; search only. **Now:** row carries `hasHours/hasPhone/hasWebsite/hasRating/photoCount/claimState/venueCategoryConfident` (optional-typed for the pinned pre-1263 literal — the mapper ALWAYS sets them, old-fn-tolerant defaults); NEW `PoolAdoptionDetail` + `fetchPlaceAdoptionDetail` (`{place_id}` detail mode, parses the structured non-2xx body, typed `PlaceNotAvailableError`). **Why:** §B1, SC-1/SC-2. **Lines:** +54 / +129 net.

### `src/services/venueListingsService.ts` + `businessPlaceAuthoringService.ts`
**Before:** 23505 place-uniq threw a bare `Error(string)`; no own-listing probe; `Tier1PlaceDraft` had no claim surface. **Now:** typed `PlaceClaimConflictError` (same message), `findOwnListingForPlace(brandId, placePoolId)` own-RLS probe (R-10), `Tier1PlaceDraft` += optional `website/priceTiers/adoptedGalleryUrls/adoption` matching Leg A's §A3.1 reads exactly. **Why:** §B1, SC-6/SC-10. **Lines:** +37 / +14.

### `src/store/draftVenueStore.ts`
**Before:** v2 per-brand draft; dead `photoUris`; no adoption model. **Now:** v3 — `claim` block (immutable `adopted` snapshot, `keptGalleryUrls` ordered grid, `addedGalleryUrls`, `coverChoice`, `detailFetched`, `adoptedAt`), top-level `website/priceTiers/wantsReservations`, `photoUris` DELETED, `pickDraft` carries `claim` through `activateBrand` stash/restore; exported pure `provenanceFor(field, draft)` — provenance COMPUTED never stored, revert flips the chip back. **Why:** §B2, D-B, DESIGN §3. **Lines:** +171 net.

### `src/utils/prefillDraftFromPoolMatch.ts`
**Before:** one lean prefill (name/address/pin/category/hours + dead photoUris). **Now:** lean prefill = the `Continue anyway` fallback (sets `claim{detailFetched:false}`, adopted limited to arrived whitelist fields) + `prefillDraftFromAdoption` (phone/website/price-filtered/summary-per-OQ-2/full gallery/facets/reservable hint; generative-only pitch prefill; confident-only category preselect; `step: 0`; stale contact/pitch fields cleared). Legacy `photoUris` stays ONLY on the return type ([TRANSITIONAL], stripped at call sites) for the pinned suite. **Why:** §B2, OQ-2, D-F/OQ-D7. **Lines:** +140 net.

### `src/components/venue/venueWizardValidation.ts`
**Before:** numeric-index validation; hours rejected ALL `o >= c` with the "aren't supported yet" copy. **Now:** step-ID-keyed `venueStepError` (create s0–s5 rules byte-equal except D-D), claim c0–c9 rules (c4 cover-gate, c5 empty-allowed/≥20, c6 URL-shape website, c7 ≥1 tier), `venueWizardSteps(isClaim)`, `claimStepPrefilled`/`claimPrefilledStepCount` (banner live math), `claimDockLabel` (Keep/Save/Continue per DESIGN §5.3 + §6.9 c8 arm), `resolveClaimSubmitPlan` (pure D-C matrix). Shared `hoursError`: only equality invalid. **Why:** §B0/§B4, D-D, SC-3/4/5/10. **Lines:** +247 net.

### `src/components/venue/VenueSettingsModule.tsx` + `BrandHoursEditor.tsx`
**Before:** Settings `hoursInvalid` and the editor's inline `stepErr` both rejected `o >= c`; no overnight affordance. **Now:** both reject ONLY `o === c` (Settings = the allowlisted one-line predicate; editor copy per DESIGN §6.3 "Open and close can't be the same time.") and the editor renders the `next day` micro-line inside the Closes control (native + web) with an overnight-aware a11y label. **Why:** §2.4/D-D, DESIGN §6.3, SC-4. **Lines:** +3 / +28 net.

### `src/components/brand/ClaimMatchCard.tsx` (new) + `PoolMatchCard.tsx`
**Before:** PoolMatchCard: single 72×72 + 3 buttons; claimed places walked the full wizard into a 23505. **Now:** ClaimMatchCard per DESIGN §4 — eyebrow, photo strip (72×72 + 28×34×2 edge stack, hue fallback), presence-fact pills (booleans ONLY), reassurance ≥2 facts, a11y label carrying the facts; states: default / YES-loading (Button loading + 0.85 content) / fetch-error (`Continue anyway`) / claimed (§4.3 shield + Message support, NO Yes) / pending (§4.4 clock). Pure `claimCardFacts`/`shouldShowReassurance`/`sortMatchesForGate` exported. PoolMatchCard is dead code retained [TRANSITIONAL] (pinned suite reads its source — D-B4). **Why:** §B3, SC-1. **Lines:** +387 / +8.

### `src/components/ui/ProvenanceChip.tsx` (new) + `Stepper.tsx`
**Before:** no provenance system; stepper dots knew current/visited/future only. **Now:** the ONE dotless micro-chip (On Mingla success / Edited neutral / New info, `Suggested` override, scrim tile variant, `accessible={false}`, M-3 flip + M-7 entrance, reduced-motion instant); Stepper gains additive `prefilled` — future-prefilled dots green-45 (M-8 confirm ramp), web circles successTint/green-45-border/secondary number, mobile caption appends "· most are quick confirms" when ≥6 prefilled. **Why:** DESIGN §3/§5.2. **Lines:** +175 / +91 net.

### `src/components/venue/claim/*` (11 new files)
**Before:** nothing. **Now:** the DESIGN §5–§6 walkthrough — Banner (live `n` of 9, sparse swap, collapse after c0), c0 Category (confident-only preselect), c1 Place (collapsed confirm cards expanding IN PLACE to the untouched `VenueStep1Address`/`VenueStep2NameSlug`; ORCH-1079 lock untouched), c2 Hours (single week-level chip over the shared editor), c3 Photos (92×92 grid, scrim chips, enlarged 24×24 delete + hitSlop 10, `1st` badge, long-press/press move menu as the ONLY reorder input, derivable removed-strip with per-photo Undo, storage-upload add), c4 COVER CHOOSER (2-up→4-up wrap math 4:5 tiles, accent border + 24pt check badge, 170pt `EventCoverMedia` preview band, dashed upload tile → existing CoverPickerSheet, "Looking good." flourish, empty-gallery full-width variant), c5 Pitch (sparkle note + pre-draft when generative; honest empty; `Start fresh`), c6 Contact (phone clear-×, email never chipped, website in-wizard), c7 Price (tier chips + hitSlop, selection required), c8 Bookings (Suggested info row, switch NEVER auto-on, sub-label swap on flip), c9 Review (KEPT/CHANGED/ADDED group cards via pure `buildClaimReviewRows`, rows jump to steps, cover thumb 40×50, §8.2 foreign + §8.3 retry warm cards, 4-business-hours stays-live helper). **Why:** §B4, DESIGN §5–§8. **Lines:** +2,417.

### `src/components/venue/VenueCreatorWizard.tsx`
**Before:** fixed 6-step map, one dock label, poolBanner caption, submit = create-only. **Now:** two step maps on one shell (mode ⇔ `draft.claim`); ID-keyed body switch; claim dock labels + c4 disabled-gate caption; adoption banner slot (create's poolBanner untouched for legacy pool drafts); M-2 incoming transitions (component-scoped reanimated, web fade-only); submit: claim validation loop over c-ids, resume-not-recreate pre-check BEFORE createVenue (`resolveClaimSubmitPlan`), cover on the create RPC, §A3.1 tier-1 extras, claim success → §8.1 pending card (NEVER the inline deck-readiness leg), typed 23505 → own(retry)/foreign(§8.2) with the draft preserved, generic claim failure → §8.3 retry card. Create arm flow-identical (same calls, same order, same payloads — nulls where claim adds values). **Why:** §B4, SC-6/10/12. **Lines:** +440 gross.

### `app/venue/create.tsx` + `VenueStep7Review.tsx`
**Before:** PoolMatchCard direct-prefill on Yes; no blocked/resume handling; one success copy; review showed the dead photo count. **Now:** gate renders sorted ClaimMatchCards; YES = detail fetch (per-match loading), race backstop swaps the card to blocked, failure arms `Continue anyway`; support routes to `/support/inbox`; resume card (§8.4) with inline start-over confirm; `resolveInitialPhase` claim-draft → gate (?pool=1 still wizard-resumes); typing with a live claim draft no longer severs its pool link; claim success copy per §8.1; review's dead "Photos: N selected" row deleted. **Why:** §B3/§B5, SC-1/2. **Lines:** +272 / −4.

## 8. Cross-surface impact

| Surface | Effect | Parity |
|---|---|---|
| Business iOS | full claim walkthrough (primary) | automatic (shared RN code) |
| Business Android | identical + opaque-safe cards (all new cards are flat `rgba(255,255,255,0.06)` tints or the established GlassCard; move menu is a solid `#191c21` panel) | automatic |
| Business Web preview | same shared files; M-2 fade-only, numbered stepper successTint, `<input type="time">` next-day line, keyboard move-menu | automatic; verification capped at compile (`expo export` exit 0) per standing memory |
| Consumer iOS/Android | none (no `app-mobile` code) | n/a |
| Buyer/anon Web | none | n/a |
| Admin Web | none (Leg A server-side only) | n/a |

## 9. Smoke result

No simulator/device run in this session (Leg B verified via jest + gates + tsc + web export). Runtime QA needed (tester, sim-first per SPEC §11): the full Raleigh script c0–c9, chip flips on-device, c3 long-press menu + undo strip, c4 upload (image AND video) through CoverPickerSheet, resume card + start-over, half-claim drill, Android time-picker/image-picker/opaque-glass spot checks, biz-web preview code-level.

## 10. Deviations from the SPEC (none silent)

- **D-B1 — BrandHoursEditor beyond "next-day line only":** its inline `stepErr` also carried the `o >= c` rejection; DESIGN §6.3 explicitly re-specifies that error's copy (`open == close` → new copy), and DESIGN owns copy where the two overlap. Predicate + copy updated; leaving it would have shown a false error against valid overnight rows in mixed-error states.
- **D-B2 — `keptGalleryUrls` holds the FULL ordered grid** (adopted keeps AND uploads; `addedGalleryUrls` = the uploads subset, always ⊆ kept). A strict kept/added split makes "Make first" on an upload impossible (uploads could never precede kept photos) — DESIGN §6.4 orders the WHOLE grid. The submit formula `kept ∪ added` is preserved verbatim (union = kept order). Tile provenance derives from membership in `adopted.galleryUrls`, so chips are unaffected.
- **D-B3 — `claim.adoptedAt` added** to the store block (spec's block shape lacked the timestamp its own §B1 `adoption.adoptedAt` payload requires). Additive; captured at copy-on-start.
- **D-B4 — PoolMatchCard NOT removed** (spec: "REMOVED in this ORCH"): pinned append-only `ve2PoolMatchFlow.test.ts` reads the file's source and `create.ve2.test.ts` asserts the literal token "PoolMatchCard" in create.tsx. Deleting = breaking pinned suites (forbidden). Retained as dead code with a [TRANSITIONAL] header; create.tsx keeps the token in an explanatory comment. Exit: a [TEST-MOD-APPROVED] ORCH retires the pinned reads.
- **D-B5 — legacy compat for pinned literals:** `PoolMatch`'s 7 new fields are OPTIONAL at the type level (the pinned prefill suite's pre-1263 literal must compile); the service mapper always sets them. The prefill return type keeps `photoUris` ([TRANSITIONAL]; call sites strip pre-`patch`). Lean prefill treats an ABSENT confidence flag as legacy preselect (explicit `false` = unselected — the live edge always sets the flag, so runtime behavior is exactly DESIGN §6.1; the legacy arm also preserves old-RPC tolerance).
- **D-B6 — motion approximations (reduced-motion fallbacks all exactly per DESIGN §7):** M-1 collapse = cross-fade (no measured-height animation — reanimated layout builders are the ORCH-1211 web-crash class); M-2 = incoming-only slide/fade (the 180ms outgoing overlap would need double-mounting inside the ScrollView); M-4 = held-state 2px accent border + menu (the DESIGN's own reduced-motion arm, used on all platforms — the move menu is the sole reorder input per OQ-4, so the drag-lift spring has no gesture to ride); M-8 = 120ms opacity ramp on the new dot color (no cross-color UI-thread interpolation).
- **D-B7 — c8 dock label defaults to `Keep & continue`** even when no hint was adopted (DESIGN §6.9's explicit c8 ruling: "off is a valid keep") — overrides §5.3's generic "nothing adopted → Continue" for this one step.
- **D-B8 — c4 upload target sentinel:** `CoverPickerSheet` venue target with `venueId: ""` (no venue row exists pre-submit; the picker never reads `venueId` — host persists the patch, here into the draft; mirrors the picker's own `""` eventRowId sentinel precedent). A video upload rides the brand-keyed processing pipeline pre-submit (storage/processing only — no place/venue row writes).
- **D-B9 — storage objects pre-submit:** c3/c4 uploads write to the `brand_covers` bucket before submit (the spec's own draft shape stores URLs, so bytes must land somewhere). "Zero server writes pre-submit" holds for place/venue/DB rows; an abandoned draft can orphan storage objects (same class as every other pre-persist upload in the app).
- **D-B10 — small UX resolutions where the DESIGN is silent:** c1 cards toggle collapsed/expanded on header tap; the §8.4 start-over confirm is an inline action swap (RN `Alert` is a no-op on web); the race backstop renders the PENDING blocked variant (the 404 doesn't disclose which state the place entered).

## 11. Operator action required

Nothing new from Leg B (no migrations, no edge deploys, no OTA — business ships by native build only). Leg A's §11 ordered CLOSE plan stands unchanged. One addition to the CLOSE curls: after deploy, one YES-path exercise from the app (or the tester's Raleigh script step 2) proves the client detail fetch against the live fn.

## 12. Known issues / deferred

1. **[TRANSITIONAL] ×3:** PoolMatchCard.tsx dead file (D-B4); `photoUris` on the prefill return type (D-B5); both exit via a [TEST-MOD-APPROVED] pinned-suite retirement ORCH.
2. **Dynamic Type 1-up cover-grid drop** (DESIGN §10: tiles <140pt after font scaling → 1-up) not wired — the grid maths off layout width only. Cosmetic at extreme scales; flagging for the tester's a11y pass.
3. **Full pointer-drag reorder deferred** per OQ-4 (move menu everywhere).
4. **`rate_limited` on the detail fetch** surfaces as the generic fetch-error card arm (Continue anyway) — acceptable (explicit, never silent), but a dedicated "wait a moment" copy would be kinder; noting for polish.

## 13. Discoveries for Orchestrator

1. **PRE-EXISTING broken pinned suite `src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts`** — fails on origin/main byte-identical (expects `CoverPickerSheet`/`syncHeroMedia`/`runTier2Pipeline`/… tokens in the wizard source; those left the wizard in the META-ORCH-1255(R2) deck-readiness extraction). Same class as Leg A §12.2's claim-search-pool find; both belong in one pinned-suite-refresh ORCH. NOT touched (append-only).
2. **Full default jest on origin/main: 222 failing tests / 260 FAIL suite-lines** — a large standing red mass in the default config (env-dependent + drifted source-contract suites). CI evidently gates on scoped suites, but any future "run the whole suite" gate will need this triaged.
3. **The stale anchor (`~/Desktop/mingla-main` @ `c3ed85521`) drifts from origin/main** in `packages/brand-rendering` (menu-sections rename) — tsc baselines taken on the anchor mislead by ±6 errors; baseline against origin/main (done here via a scratch worktree, since reaped).

## 14. Invariant preservation check

I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE ✓ (client adds NO new server calls pre-submit beyond the read-only detail fetch + storage uploads) · I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START ✓ (prefills pure; abandon = draft reset only) · I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED ✓ (gate variants + sort + backstop own/foreign; G-2 green) · I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED ✓ (facts rendered as booleans/counts; no rating value anywhere client-side) · I-PROPOSED-1263-OVERNIGHT-HOURS-VALID ✓ (both validators + editor; G-2 green) · I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO ✓ (server-side; client c4 never mutates the gallery on select) · I-NET-NEW-HOLD ✓ (create path flow-identical; SC-12 suites green) · ORCH-1079 §3.C googlePlaceId lock ✓ (c1 wraps Step1 unmodified; prefills set googlePlaceId from pool only) · I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE ✓ (gate green) · ANDROID_GLASS_USES_OPAQUE_FALLBACK ✓ (new cards flat-tint/solid; no new translucent-over-content surfaces) · WCAG I-38/I-39 ✓ (≥44pt targets via sizes+hitSlop; chips text-labeled, `accessible={false}` merged into host labels) · Constitution #4 ✓ (no new query keys) · #5 ✓ (the claim block is client-draft state, not server records — the adopted snapshot is a pre-submit form value by design, D-B).
