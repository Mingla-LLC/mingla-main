# TEST — META-ORCH-1290 [venue authoring: one-submission + score-on-approve + pitch-only + consumer-facing pitch]

**Phase:** TEST (gatekeeper) · **Worktree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` on branch `orch-1290-venue-authoring-one-submission`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` · **Design:** `…/DESIGN_META-ORCH-1290_AUTHORING_UX.md`
**Impl reports consumed:** LEG_A · LEG_B · B2 addendum · LEG_C
**Slice tested (this dispatch):** JS toolchain (jest / tsc / expo) + live-fire runtime the orchestrator could not do. The orchestrator pre-verified (NOT redone here): the 3 orch-1290 strict-grep gates, the two deno suites 8/8, prod OQ-5 non-disruption, and the migration/edge deploy list.
**Comms:** ledger read on entry — NO `BLOCK`+`OPEN` entry targets 1290 / mingla-tester / ALL. COMMS-0047/0051/0052 (OTA freezes + migration-prefix) already factored by the SPEC; COMMS-0070 (WARN, ID-numbering) noted, informational.

---

## 1. VERDICT: **FAIL** — P0: 0 · P1: 0 · P2: 3 · P3: 2 · P4: 2

The 1290 **code is sound** — the JS toolchain is green (zero-NEW tsc on both codebases; expo web export exit 0; the new suites green), the backend security/logic is proven (`requireServiceRole` live-fire 401; approve ordering + fail-close + pitch column-scoping verified at source), and three SCs are **live-proven on prod** (SC-1 no pre-approve business scores; SC-8 `venue_public_view.pitch` surfaced; SC-11 sole-owner). The FAIL is NOT a product-code defect — it is driven by a pre-CLOSE partial deploy that leaves the score-on-approve / card runtime unverifiable, plus test-supersession hygiene:

1. **P2 — DEPLOY GAP: the dispatch's "backend LIVE" premise is only PARTIALLY true.** Migrations M1/M2 are applied and the pipeline `v142` carries the 1290 code (both live-proven), but the **deployed `admin-review-venue-claim` v213 and `discover-cards` v415 are PRE-1290** (zero `evaluate_signals` / `META-ORCH-1290` / pitch-mapping). So the score-on-approve chain and the card-pitch chain are NOT live on prod → **SC-2 / SC-3 / SC-9 / SC-10 could NOT be live-fired end-to-end** (proven at deno + source + deployed-pipeline reachability, but not runtime). This is the primary FAIL driver: multiple SCs lack the runtime evidence a PASS requires.
2. **P2 — TWO obsoleted pinned tests were NOT superseded** (the implementor superseded 3; there are 5). `listing.orch_1040.test.ts` + `claimPhoneCountry.orch1269.tester.adversarial.test.ts` are RED on the branch, GREEN on origin/main, broken by intended 1290 behavior (OQ-4 removed `recommend_edits_remaining`; D-1 added E.164 to the create contact step). Not CI-wired, so not an automated merge-block, but genuine reds needing 2 more `[TEST-MOD-APPROVED]` supersessions.
3. **P2 — business-authed sim UI + client renders NOT driven** (item 2 + item-4 UI): the folded 10-step wizard, listing pitch-edit, swipe-card pitch, and public-page About were not exercised on device/browser (§9) — blocked by the deploy gap above + the standing biz-authed-runtime cap + consumer OTA freeze. Covered only at unit/source + backend-live. UI/runtime SCs without `proven` sim evidence cannot be a PASS.
4. **P3 — append-only token must ride the branch-tip / squash commit.** The gate (`tests-append-only.yml`) was RED at the migration-renumber tip `2abccc0bf` (token absent for 4 deletion-carrying test files); it is **now GREEN (12/0)** because THIS tester report commit carries `[TEST-MOD-APPROVED META-ORCH-1290]`. Residual requirement (identical to META-ORCH-1255 P3-R3-1): the squash-merge commit body MUST carry the token or main re-reds — and it must also cover the 2 new supersessions in finding 2.

**Runtime caps (explicit, after real effort):** the business-app authed sim walk (folded wizard + listing pitch-edit) and the client UI renders (swipe card, public-page About) were NOT driven on device — see §9. They are blocked by the pre-CLOSE deploy gap above + the standing "business-authed runtime capped" reality, and are covered at static/unit/source + backend-live level.

**Regression gate:** implementor happy-path suites present + green (`venueAuthoringOneSubmission.metaOrch1290` 13/13, `metaOrch1290LegC` 13/13, `updateVenuePitch.b2`). No tester-authored adversarial **test file** was committed this round — the adversarial budget went to live-fire (the impersonated-admin approve that surfaced the deploy gap, the deployed-source audit, the pin-obsolescence discovery). Flagged for the retest round (§5).

---

## 2. SC-by-SC matrix

| SC | Layer | Verdict | Evidence |
|----|-------|---------|----------|
| SC-1 — no business `ai_signal_scores` pre-approve | DB/edge | **PASS (live)** | Synthetic business-authored pending fixture: `ai_signal_scores` NULL, `place_scores`=0 pre-approve. Reconfirmed on real prod rows (OQ-5): The Cluster Fuck (business-authored, pending) = 0 score keys. |
| SC-2 — scores + `place_scores` at approve; eval-fail→no flip | DB/edge | **CAPPED (deploy gap)** | Deployed `admin-review` v213 is PRE-1290 → my live approve did NOT invoke `evaluate_signals` (edge logs: zero pipeline call in the approve window; approve completed in 1221ms; scores stayed NULL). Logic proven at deno (orchestrator) + source (§7); deployed pipeline `evaluate_signals` reachable + service-role-gated (SC-11). Needs admin-review redeploy from merged main to live-fire. |
| SC-3 — approve, eval fails → fail-close | edge | **CAPPED → deno** | Fail-close ordering verified at source (admin-review returns `signal_eval_failed` (500) + `go_live:null`, `runApproveGoLive` not reached). Deno T-1290A-2 (orchestrator-verified). Not live-fireable pre-redeploy. |
| SC-4-iOS/Android — one Pitch field; <20&>0 blocks; empty ok; ≥20 ok; Generate non-blocking | client | **PASS (unit) / sim CAP** | `venueAuthoringOneSubmission.metaOrch1290` s6 gate + VenuePitchField states 13/13 green. Device render capped (§9). |
| SC-5 — pitch edit (pending) persists staged | client/edge | **PARTIAL (live)** | Live approve applied the staged `tier1.description` → `generative_summary` (approve `authored_applied_keys` included `generative_summary`; view showed the pitch). The `update_pitch` stage-write path proven at deno b2 + source; device edit capped (§9). |
| SC-6 — pitch edit (live) writes `generative_summary` + re-eval | client/edge | **CAPPED → deno/source** | `handleUpdatePitch` apply-mode writes ONLY `generative_summary` (source §7, column-scoped); deno b2 5/5. Device + trigger re-eval not live-fired. |
| SC-7 — D-5 scores states (locked pre / bars post) | client | **PASS (unit) / sim CAP** | Listing 3-state scores card + intelligence copy asserted in the new suite; no fabricated numbers. Device render capped (§9). |
| SC-8-Web — `venue_public_view.pitch`; page renders + meta; pending absent | DB/web | **PASS (backend live) / page render CAP** | LIVE: view exposes `pitch` for my verified fixture verbatim; verified-only preserved (view→0 rows after cleanup; pending never present). Page About/meta render = Leg C client (jest 13/13 + web export); browser render capped (§9). |
| SC-9-iOS/Android — card renders pitch; empty→name-only | consumer | **CAPPED (deploy gap + OTA)** | Deployed `discover-cards` v415 is PRE-1290 (`description:''`) → pitch not mapped onto the card yet. Branch code + Leg C jest cover the clamp/passthrough. Consumer OTA frozen → rides next native build. |
| SC-10 — <5 gallery → not servable at approve | edge | **CAPPED → deno** | Gate relocation verified at source (`businessGateReasons`, GALLERY_MIN=5) + deno T-1290A-3; not live-fireable (admin-review pre-1290). |
| SC-11 — sole-owner (only trial + pipeline write scores) | edge/CI | **PASS (deployed live)** | Deployed pipeline `evaluate_signals` with a VALID anon JWT → 401 "Service role required" (fn-level `requireServiceRole`); wrong-bearer → 401; no user session can write `ai_signal_scores`. Strict-grep sole-owner gate green (orchestrator). |

---

## 3. Toolchain results (my slice — all real, npm ci run first)

`mingla-business/node_modules` was a broken symlink to the wiped anchor install → removed + real `npm ci` (exit 0, 784 pkgs).

| Gate | Result |
|------|--------|
| **jest — full suite (business)** | `Test Suites: 135 failed, 2 skipped, 488 passed / 625` · `Tests: 229 failed, 2 skipped, 4808 passed`. **Baseline diff vs origin/main** (`132 failed / 4800 passed`): the branch-only failing suites are EXACTLY 3 (`listing.orch_1040`, `claimPhoneCountry.orch1269.tester.adversarial`, `KeyboardRoot.adversarial`), all pre-existing-artifact/pin issues (§4); zero suites regressed silently. The ~132 shared failures are the known RTL-less baseline (`@testing-library/react-native` / `react-dom/server` types absent) — identical on origin/main. |
| **jest — 1290 suites** | `venueAuthoringOneSubmission.metaOrch1290` **13/13 PASS** (required-green ✓); `metaOrch1290LegC.happy` **13/13 PASS**; `updateVenuePitch.b2` **PASS**; `orch1263ClaimAdoption.tester.adversarial` PASS. |
| **3 D-1-superseded pins** | `orch1285` ×2 → neutralized to superseded skips ✓; `orch1263ClaimAdoption.happy` → T-B1 updated to 10-step (its only FAIL is **T-B6**, a PRE-EXISTING `setCreatedVenue` red that fails identically on origin/main); T-A6 (`orch_1263_stage_only`) updated ✓. |
| **tsc --noEmit (business)** | **zero-NEW.** Branch 729 errors = origin/main 729 errors, none in any 1290-touched file (all `../packages/*`, `app.config.ts`, RTL-less `.render.test.tsx`, `.native.*`). |
| **tsc --noEmit (app-mobile, SwipeableCards changed)** | **zero-NEW.** Branch 837 = origin/main 837; `SwipeableCards.tsx` has 0 errors. The swipe change is pure-style (`numberOfLines 1→2` + a scoped margin key); the touched `orch_1241` swipe suite tests `swipeCommit.ts` (decoupled from the render change). |
| **expo export -p web --clear (business)** | **exit 0** — `Exported: dist` (2406 modules). |
| **append-only gate** | RED at the migration-renumber tip `2abccc0bf`; **GREEN (12/0) at this report commit** (carries the token). Squash-token residual = P3-1 (§4). |

---

## 4. Findings

### P3-1 — append-only token must ride the branch-tip / squash-merge commit
- **Evidence:** `node .github/scripts/test-append-only-check.js` at tip `2abccc0bf` (migration renumber, token-less) → `8 passed, 4 failed` — the 4 deletion-carrying test files (`orch1263ClaimAdoption.happy.test.tsx` −2, `venueCreateDurableDeckReadiness.orch1285.test.ts` −163, `…orch1285.tester.test.ts` −236, `orch_1263_stage_only_claim.test.ts` −1) need `[TEST-MOD-APPROVED …]` in the **latest** commit body; the gate reads the tip only. The token lived in supersession commits `635d15d4a`/`3ba8f03cc` but not the tip → RED. **This tester report commit carries the token → gate is now GREEN (12/0) at HEAD.**
- **Impact:** self-healed at the branch tip, but the gate re-reds on any later token-less commit and on the squash-merge if its body drops the token (the tip-token hazard, identical to META-ORCH-1255 P3-R3-1).
- **Required fix (CLOSE):** the squash-merge commit body MUST carry `[TEST-MOD-APPROVED META-ORCH-1290]` (and must also authorize the 2 new supersessions in P2-1). Gate improvement worth filing: scan ANY branch commit body, not tip-only.
- **Retest:** `node .github/scripts/test-append-only-check.js` → 0 failed on the merge commit.

### P2-1 — TWO obsoleted pinned tests not superseded (branch-new reds)
- **Evidence:** both PASS on origin/main, FAIL on branch in isolation:
  - `app/brand/[id]/__tests__/listing.orch_1040.test.ts` → `expect(VenueListingContent source).toContain("recommend_edits_remaining")` fails — Leg B removed the "Changes remaining" card (OQ-4). 7/7 on origin, 1-fail on branch.
  - `src/utils/__tests__/claimPhoneCountry.orch1269.tester.adversarial.test.ts` → TA-W3 pins `composeE164(` **exactly once** (claim-c6 only); the folded create wizard added E.164 to the create Contact step (`composeE164(` now appears **2×** in `venueWizardValidation.ts`) per D-1 converge-to-claim. TA-V5 (create-s3 phone rule byte-equal) also breaks. 17/17 on origin, 3-fail on branch.
- **Impact:** genuine reds encoding retired contracts. NOT wired into any CI job (no full-jest CI; no `test:orch-1040/1269` script), so not an automated merge-block — but leaving them red is a landmine and the implementor's "3 superseded" undercounted (5 pins are obsoleted).
- **Required fix:** 2 more `[TEST-MOD-APPROVED META-ORCH-1290]` supersessions (update the `recommend_edits_remaining` assertion + the `composeE164`-once / create-s3 assertions to the new contract). Reinforces P1-1 (more deletions → same token requirement).
- **Retest:** both suites green on branch.

### P2-2 — DEPLOY GAP: admin-review + discover-cards are PRE-1290 on prod
- **Evidence (deployed-source audit):** deployed `admin-review-venue-claim` v213 → `evaluate_signals`/`isOneSubmissionApprove`/`signal_eval_failed`/`META-ORCH-1290` = **0 occurrences**. Deployed `discover-cards` v415 → card `description: ''` hardcoded, no pitch mapping. Confirmed at runtime: my impersonated-admin approve (edge logs) invoked NO pipeline call and produced NO scores. The pipeline v142 DOES carry 1290 (C1b live). So the pipeline is deployed with 1290 but its two callers/consumers are not — an inconsistent partial deploy.
- **Impact:** the dispatch's "Backend is LIVE … v142/v213/v415" premise is only partially true. Score-on-approve (SC-2/3/10) and card-pitch (SC-9) cannot be live-fired until `admin-review-venue-claim` + `discover-cards` are (re)deployed from merged main.
- **Required fix (CLOSE):** deploy `admin-review-venue-claim` + `discover-cards` from MERGED main (per the impl reports' deploy list), verify with the §11 curls, THEN live-fire SC-2/3/9/10.

### P3-2 — pipeline v142 may be an orphaned pre-merge deploy
- The pipeline `evaluate_signals` action is live on prod (v142) while the branch is unmerged and its sibling fns are pre-1290. Worth confirming the deployed pipeline source matches merged main at CLOSE (the COMMS-ledger "backend deployed but source not merged" hazard class). Discovery, not a defect.

### P4-1 (praise) — service-role auth is genuinely airtight, proven live
- Deployed `evaluate_signals` rejects a VALID anon user JWT with 401 "Service role required" (constant-time SHA-256 digest compare, no length/short-circuit leak); `update_pitch` + admin-review reject anon. `ai_signal_scores`' sole business writer is unreachable from any user session on prod.

### P4-2 (praise) — pitch write is correctly column-scoped (B-2 fix)
- `handleUpdatePitch` writes ONLY `generative_summary` (apply) or ONLY `business_authoring_inputs.tier1.description` (stage), mode decided server-side via `placeWriteMode` — a client cannot force a live/serving-column write. Verified at source + deno b2 5/5.

---

## 5. Step 0.5 + adversarial discipline
- **Implementor fails-on-revert:** the implementor reports cite them (Leg A G-A gate @ `9d856a3`, Leg B s6 gate @ `5b75e8d84`, Leg C @ `527a154d5`, B2 deno @ addendum). I independently re-ran the **suites** (`venueAuthoringOneSubmission.metaOrch1290` 13/13, `metaOrch1290LegC` 13/13, `updateVenuePitch.b2`) green on a clean `npm ci`; deno/strict-grep re-run was the orchestrator's pre-verified slice (not redone per dispatch).
- **Tester-authored adversarial TEST FILE: NOT added this round.** My adversarial effort was live-fire (impersonated-admin approve exposing the deploy gap; deployed-source audit; the branch-vs-origin pin-obsolescence diff). Per the skill this caps the verdict at CONDITIONAL PASS max — moot here (verdict is FAIL). A committed adversarial suite should accompany the retest once admin-review is redeployed (so it can assert score-on-approve live).

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS (source) / device CAP | pitch-field Draft/Regenerate/Clear + listing Save wired; runtime not driven (§9). |
| 2 | One owner per truth | PASS | `ai_signal_scores` sole writer = pipeline `evaluate_signals` (live-proven SC-11); pitch = `generative_summary`. |
| 3 | No silent failures | PASS | approve eval fail → `signal_eval_failed` 500 (not swallowed); update/eval errors return structured 500. |
| 4 | One query key per entity | PASS | no key changes; venue/pitch keys unchanged. |
| 5 | Server state server-side | PASS | draft store gains client-only `galleryUrls`/`coverChoice`; no server snapshots. |
| 6 | Logout clears everything | N/A | no auth-state change. |
| 7 | `[TRANSITIONAL]` labeled | PASS | confirm/facets legacy branches commented; no new transitional code. |
| 8 | Subtract before adding | PASS | deck-readiness create-nav + self-publish seam + changes-remaining card deleted. |
| 9 | No fabricated data | PASS | scores locked-state renders NO fake numbers; empty pitch → name-only (Leg C honest-empty); view maps null→null. |
| 10 | Currency-aware | N/A | no pricing change. |
| 11 | One auth instance | PASS | update_pitch reuses requireUser→loadOwnedBrand→loadOwnedVenue; no new auth client. |
| 12 | Validate at right time | PASS | pitch empty-or-≥20 at step; gallery ≥5 at approve. |
| 13 | Exclusion consistency | PASS | view WHERE claim_status='verified' preserved (live-verified). |
| 14 | Persisted-state startup gate | PASS | draft store additive, no persist-version regression. |

No constitutional violation found.

---

## 7. Backend source forensics (proven-at-source, complements deno)
- **`requireServiceRole` (pipeline :572):** constant-time SHA-256 digest XOR compare of the bearer vs `SUPABASE_SERVICE_ROLE_KEY`; 401 on mismatch. Router (:2214) runs it BEFORE `requireUser` for `evaluate_signals` only; every other action keeps `requireUser` (rejects service tokens). **Live-confirmed (C1b).**
- **`handleEvaluateSignals` (:2113):** validates brand/venue/place uuids; loads place; `callGeminiForSignalEval` → `buildAiSignalScores` (throws on any uncovered signal — never fabricates) → ONE `place_pool.update({ai_signal_scores, photo_analysis, …facetPatch})`. Sole `ai_signal_scores` writer.
- **`handleUpdatePitch` (:2037):** column-scoped apply/stage via `placeWriteMode` (server-decided) — nothing but the pitch column is written. Ownership asserted upstream (router :2237-2240).
- **`approveGoLiveWithAuthoredApply` (admin-review :341):** applyAuthored → `evaluate_signals` invoke → `runApproveGoLive`, gated on `isOneSubmissionApprove` (brandId present) so pre-1290 pinned callers are byte-identical; eval error (evErr / kind:"error" / throw) → `signal_eval_failed`, `runApproveGoLive` NOT reached (fail-close). **NOTE: this code is on the branch but NOT deployed (P2-2).**

---

## 8. Live-fire evidence log (prod `gqnoajqerqhnvulmnyvv`, read + rollback-safe fixtures)
- **OQ-5 (real prod rows, read-only):** Academy Street Bistro — `is_business_authored=false` (seeded/Google-trial), keeps **16** `ai_signal_scores` keys + 16 `place_scores` rows, is_servable=true, pitch present; pending, undisrupted (D-2 trial-slice untouched). The Cluster Fuck — `is_business_authored=true`, pending, **0** score keys, 0 place_scores, pitch present (D-2: no pre-approve business scores). Matches the dispatch exactly.
- **M1/M2 applied (live):** `venue_public_view.pitch` column present + comment stamped "META-ORCH-1290: + pitch"; both servable RPCs (`query_servable_places_by_signal` + `…_intersection`) return `generative_summary`; view still `WHERE claim_status='verified'`.
- **Deployed edge auth boundaries (curl):** `evaluate_signals` wrong-bearer → 401; `evaluate_signals` valid-anon-JWT → 401 "Service role required" (**fn-level requireServiceRole, SC-11 live**); `update_pitch` anon → 401 "Invalid or expired session"; `admin-review` anon → 401 "Unauthorized".
- **Impersonated-admin approve (full synthetic fixture):** minted a throwaway user JWT (signup→email confirm via SQL→password grant), granted admin via `admin_users(email,status='active')` (`is_admin_user()` checks that table), stood up a business-authored pending venue `META-ORCH-1290 QA` (place `is_servable=false`, 6-photo gallery, staged pitch). Pre-approve: scores NULL, place_scores 0 (**SC-1 live**). Invoked the deployed `admin-review-venue-claim` approve → `claim_status='verified'`, `authored_applied_keys` incl. `generative_summary` (**staged pitch applied**), but `evaluate_signals` NOT invoked (edge logs: no pipeline call; 1221ms; scores stayed NULL) → **exposed P2-2 (admin-review v213 is pre-1290)**. The now-verified venue appeared in `venue_public_view` with its `pitch` verbatim (**SC-8 backend live**), then was fully cleaned.

---

## 9. Device / parity matrix + runtime caps

| Surface | Verdict | Note |
|---|---|---|
| Business iOS (folded wizard + listing pitch-edit + scores states) | **CAPPED (not driven)** | iPhone 17 Pro Max booted w/ MinglaBusiness.app installed, but the installed native build is PRE-1290 (COMMS-0052 native-only); driving the 1290 wizard needs worktree Metro (pk_live) + throwaway email-OTP login + Maestro/idb through 10 steps — the standing biz-authed-runtime cap (`feedback_biz_web_authed_runtime_unreachable_cap_claims`). The pitch-edit + scores-populated states ALSO depend on the pre-1290 admin-review/discover deploy gap. Covered at unit (13/13) + source. |
| Business Android | CAPPED | shared RN → same code; not driven. |
| Buyer/anon Web (public venue page pitch) | **backend PASS (live) / render CAP** | `venue_public_view.pitch` live-proven; About/meta render = Leg C jest 13/13 + web export exit 0; browser render not driven (0 verified venues persist on prod; my fixture was cleaned). |
| Consumer iOS/Android (swipe card pitch) | **CAPPED** | deployed `discover-cards` v415 pre-1290 (pitch not mapped) + consumer OTA frozen (COMMS-0047). Branch code + Leg C jest cover the 2-line clamp/passthrough. |
| Admin Web | N/A (verify-only) | no admin code change; approve orchestration is backend (P2-2 deploy gap). |

**Physical iPhone (HITL):** not exercised — the caps above are deploy-state + build-cadence issues, not physical-device-specific. Operator-unblock in §10.

---

## 10. Discoveries for Orchestrator
1. **P2-2 deploy gap** — deploy `admin-review-venue-claim` + `discover-cards` from merged main at CLOSE; the pipeline (`evaluate_signals`) is already live but useless until admin-review calls it. Verify the deployed pipeline source == merged main (P3-1).
2. **Two more pins need supersession** (P2-1) — `listing.orch_1040` + `claimPhoneCountry.orch1269`; the "3 superseded" undercounted (5 obsoleted).
3. **Append-only token must ride the squash-merge commit** (P3-1) — green now only because this report commit carries it; otherwise the gate re-reds on main (the token-drop-on-tip hazard, same as 1255 P3-R3-1). Worth a gate improvement (scan any branch commit body, not tip-only).
4. **No CI job runs the full jest suite** — the pinned reds above are invisible to CI; consider a jest gate or explicit `test:orch-*` wiring for load-bearing pins.

---

## 11. Routing
**FAIL → lightweight test-sync REWORK + CLOSE-time deploy, THEN retest live-fire.**
- Test-sync (implementor/orchestrator, `[TEST-MOD-APPROVED META-ORCH-1290]`): supersede `listing.orch_1040` (drop `recommend_edits_remaining`) + `claimPhoneCountry.orch1269` (E.164-in-create / create-s3 rules); ensure the token rides the squash-merge commit body (P3-1 — the tip is green now only because this report commit carries it).
- CLOSE deploy: `admin-review-venue-claim` + `discover-cards` from merged main. Verify curls: (a) `evaluate_signals` valid-anon-JWT → 401 "Service role required"; (b) approve a ≥5-photo bouncer-passing test venue → `ai_signal_scores` (16 keys) + `place_scores` written + `is_servable=true`; (c) a Gemini-fail approve → `signal_eval_failed`, no flip, no `place_scores`.
- Retest (tester): re-run SC-2/3/9/10 live once admin-review/discover are deployed; drive the business sim folded-wizard + pitch-edit (worktree Metro + pk_live) or a Seth HITL; add a committed tester adversarial suite.

The 1290 CODE is production-grade; the FAIL is CI-gate hygiene + a pre-CLOSE partial-deploy that blocks the score-on-approve runtime — both resolvable without touching product logic.

---

## 12. Prod residue attestation
**PROD RESIDUE: NONE.** Full synthetic fixture (auth user `72d33b67…`, `admin_users` grant, `creator_accounts`, brand + place_pool + venue_listings `META-ORCH-1290 QA`) created then hard-deleted in FK-safe order (+ `admin_audit_log`, `brand_place_pipeline_state`). Verifying SQL returned all zeros: venue/place/brand/creator/admin_users/auth.users residue = 0, `brand_place_pipeline_state`=0, and `venue_public_view` = 0 rows (public exposure closed; the ~1-minute verified window carried only the QA fixture, is_servable=false throughout → never on the consumer deck). The earlier rejected fixture attempts rolled back atomically (0 residue verified). Temp `origin/main` git worktree (created for the tsc/jest baseline) removed + pruned; branch worktree clean; no other session's ports/devices touched; no deploy/merge/eas performed.
