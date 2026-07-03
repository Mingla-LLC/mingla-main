# TEST — ORCH-1285 · Venue deck-readiness "Recommend me" step flashed/closed on web create → fix routes create to the durable deck-readiness route

- **Phase:** TEST (independent verification; no product-code edits)
- **Date:** 2026-07-03
- **Worktree:** `~/Desktop/mingla-orchs/orch-1272-[deck-readiness-web-flash]/` on branch `orch-1285-deck-readiness-web-flash` (head `dfe2c7948`; fix commit `bf4b89a6e`)
- **Inputs verified against:** `INVESTIGATION_ORCH-1285_…` §G/§F-9 + `IMPLEMENTATION_ORCH-1285_…`
- **Runtime surface used:** iOS sim (iPhone 17 Pro Max, iOS 26.4) driving the **branch** bundle via worktree Metro (`:8089`, `pk_live` env) against LIVE prod — authed via a disposable mail.tm QA account. (Authed biz-web is the documented cap; resolved on native per the ORCH-1255 recipe.)

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise).

The create-path "Submit for review" now lands on the **durable** `/venue/deck-readiness` route and **stays there** (no flash-and-close), the venue **persists across a full app reload**, and the **recover path** (Hub → venue → Settings → "Edit photos & vibes") reaches the *same* durable route reloading server state. Source + unit + fails-on-revert + web-bundle + live-fire native all agree. Regression gate satisfied (implementor happy-path test with fails-on-revert re-proven + tester adversarial test, both on-branch and in-diff). Client-navigation-only fix; zero migration/edge/native/schema change.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | Create tier-1 success `router.replace`s to durable `/venue/deck-readiness` (not the ephemeral inline mount) | **PASS (proven)** | Source `VenueCreatorWizard.tsx:417-426`; jest test 1; **runtime**: `29_s6_review`→`30_after_submit_t2s` (Submitting…)→`30_after_submit_t13s` (landed on "Deck readiness"). Header chrome reads "Deck readiness" = `app/venue/deck-readiness.tsx` (the inline mount never rendered that chrome). |
| SC-2 | Nav uses the real param contract via `routeForDeckReadinessFix({…fix:"review_pipeline"})` — exact parity with `VenueListingContent.handleEdit` | **PASS (proven)** | Builder → `brand_id,focus=review,fix=review_pipeline,place_pool_id,venue_id`; handleEdit literal (`VenueListingContent.tsx:192`) = same set/values; tester test **T1** executes the builder and diff-matches the handleEdit literal. |
| SC-3 | Ephemeral inline `<VenueDeckReadinessSetup>` + `createdVenue`/`setCreatedVenue` REMOVED | **PASS** | Non-comment grep clean; jest tests 2+3; gate (b)+(c); tester test T3(a) asserts exactly one builder call. |
| SC-4 | Claim path's intentional defer UNTOUCHED | **PASS** | `VenueCreatorWizard.tsx:397-403` claim branch returns via `onDone(...)` before the create leg; tester test **T2** AST-proves the claim branch has NO `routeForDeckReadinessFix` and DOES `return`. |
| SC-5 | No cron/auto-transition out of `processing` added | **PASS** | Diff = client/CI/docs only; zero edge/migration. Runtime: created venue sat at `processing` until operator action (DB-confirmed). |
| SC-6 | Landing route reloads brand+venue+pipeline server-side | **PASS (proven)** | `deck-readiness.tsx` uses `useVenueListing` + `useBrandPlaceAuthoringContext` from URL params; jest test 4 + tester T4; **runtime**: recover reload showed live 0/5 photos + website-required for the created venue (`38_recover_deckreadiness`). |
| SC-7 | Stuck venue recoverable via Hub | **PASS (proven)** | `35→38`: Hub → venue → Settings → "Edit photos & vibes" → durable "Deck readiness". Same route the create path now uses. |
| SC-8 | CI regression guard + fails-on-revert | **PASS** | Gate self-test 5/5 + real PASS; jest 4/4 (implementor) + 4/4 (tester); fails-on-revert independently re-proven (see §4). |
| SC-9 | Web build succeeds | **PASS** | `expo export -p web --clear` exit 0; create chunk bundles `routeForDeckReadinessFix`, `deck-readiness` compiles as its own chunk, create chunk no longer embeds the AI setup (0 matches). |
| SC-10 | Persistence — durable landing survives a reload | **PASS (proven)** | Stable at t=13s post-submit (no flash); survived a FULL app relaunch — venue present as Hub card + "Get your venue live" to-do (`31→32→33`). |
| SC-11 | "Recommend me" AI can run → deck_eligible | **PASS (screen reached + functional); deck_eligible completion cited** | Create + recover both land on the functional "Get recommended on Mingla" screen with the Recommend-me requirements (cover/5 photos/website/price) rendered. The `run_tier2_pipeline`→`confirm_ai_outputs`→`deck_eligible` flow runs on the **UNCHANGED** `VenueDeckReadinessSetup` (untouched by this fix) and is independently runtime-proven in META-ORCH-1255 R2/R3 (venues walked to verified/deck_eligible via this exact screen). Not re-driven here (5-photo+AI upload adds no coverage of the create-nav fix). |

---

## 3. Findings

No P0/P1/P2/P3. Two P4 (praise):

- **P4-1 — Constitution Rule 5/8 exemplary.** The fix *removes* the throw-away `createdVenue` component state and the inline mount (subtract-before-add) and replaces them with a URL-param + server-reloaded route — server state no longer held in volatile client state. Textbook.
- **P4-2 — Trigger-agnostic minimal fix.** Reuses the already-shipped durable route (`handleEdit` recovery) via the canonical builder, so create/recover share ONE code path and the whole class of auth/hydration/chunk re-render teardown (investigation F-2) is neutralized without needing to identify the exact per-frame trigger.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out at head `dfe2c7948` (fix `bf4b89a6e`). I **truly line-deleted** the `router.replace(routeForDeckReadinessFix({…})) … return;` seam (9 lines) in `VenueCreatorWizard.tsx`, then ran the gate + both jest suites:

- **Gate FAILED** exit 1: `create-success navigation seam missing — expected router.replace(routeForDeckReadinessFix({ ... }))`.
- **Implementor jest test 1 FAILED**: `expect(durableNavCall).not.toBeNull()` → **Received: null** (`:108`).
- **Tester jest test T3 FAILED**: `expect(builderCalls.length).toBe(1)` → **Received: 0** (`:190`).
- 6 other assertions still passed (not seam-dependent).

Restored via `git checkout --` → file sha back to `aee6257b108f4899d95651b3bc69d4b328ca23c0` (= `HEAD:…VenueCreatorWizard.tsx`), tree pristine; **gate PASS + jest 8/8 PASS**. `fails-on-revert verified at bf4b89a6e / dfe2c7948`.

---

## 5. Adversarial test added

- **Path:** `mingla-business/src/components/venue/__tests__/venueCreateDurableDeckReadiness.orch1285.tester.test.ts` (NEW; append-only).
- **Different angle** than the implementor's happy-path AST test:
  - **T1 (functional parity):** executes the real `routeForDeckReadinessFix({fix:"review_pipeline"})` AND parses the LITERAL route in `VenueListingContent.handleEdit`, asserting identical param key-set + `focus=review`/`fix=review_pipeline` — proves create lands on the *exact* recovery contract, not merely "a" deck route. (Implementor never compared cross-file.)
  - **T2 (claim-defer regression guard):** AST-isolates the submit-path `if (claimMode)` branch (the one calling `onDone`) and asserts it contains NO `routeForDeckReadinessFix` and DOES `return` — guards F-6.
  - **T3 (back-trap guard):** exactly one builder call; it is wrapped by `router.replace` (NOT `push`) and followed by an early `return`.
  - **T4:** durable route reloads via `useVenueListing` + `useBrandPlaceAuthoringContext` + `useLocalSearchParams`.
- **4/4 PASS**; `fails-on-revert verified at bf4b89a6e` (T3 `builderCalls.length` → 0 on revert). Both the implementor happy-path test and this tester test appear in `git diff origin/main...HEAD --name-only` for the closing PR (implementor's is committed; tester's committed in this report's commit).

---

## 6. Constitution 14-rule matrix (vs the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | "Submit for review" navigates (runtime `30`). |
| 2 | One owner per truth | PASS | place pointer sourced from venue row (`deck-readiness.tsx:68`), no dup. |
| 3 | No silent failures | PASS | create catch path unchanged (`setSubmitErr`/`sanitizeAuthoringError`). |
| 4 | One query key per entity (factory) | N/A | uses existing `venueListingKeys`/`brandPlacePipelineKeys`. |
| 5 | Server state server-side | PASS (praise) | removes `createdVenue` client state → server-reloaded hooks. |
| 6 | Logout clears everything | N/A | no auth/store change. |
| 7 | Label temporary + exit | N/A | none introduced. |
| 8 | Subtract before adding | PASS (praise) | removed state + mount + unused imports before adding nav. |
| 9 | No fabricated data | N/A | none. |
| 10 | Currency-aware | N/A | none. |
| 11 | One auth instance | N/A | none. |
| 12 | Validate at the right time | N/A | none. |
| 13 | Exclusion consistency | N/A | none. |
| 14 | Persisted-state startup gate | N/A | durable route reads URL+server, not a persisted client store. |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Notes |
|---------|---------|-------|
| Business iOS (native) | **PASS (proven, live-fire)** | Full authed create→durable-route landing + persistence + recover walked on iPhone 17 Pro Max against the branch bundle. Screenshots `01`–`38` in `Mingla_Artifacts/evidence/ORCH-1285/`. |
| Business **Web** (Vercel — the ship target) | **PASS (source+unit+bundle proven); authed-runtime cap** | The pipeline cannot authenticate to business.usemingla.com (`feedback_biz_web_authed_runtime_unreachable_cap_claims`) and the fix ships web-only. The fix is **trigger-agnostic** (it deletes the ephemeral state entirely — the flash cannot occur without it), single RN codebase, and the create chunk provably bundles the durable-nav seam (`create-*.js`). Native live-fire proves the identical RN path. Residual: Seth's authed eyeball on the deployed Vercel build (see §Cap). |
| Business Android | N/A this session | same RN path; ships on next native build (OTA prohibited). |
| Buyer/anon Web · Consumer iOS/Android · Admin Web | N/A | not touched (client-nav within business create only). |

**Recover-path result (explicit ask):** PASS. My QA venue at `business_authoring_status='processing'` was reached via Hub → venue → Settings → "Edit photos & vibes" → durable "Deck readiness" and its server state reloaded (`38`). The live prod row "The Cluster Fuck" (place_pool `cd41f4e8`, brand `1ce63bf4`, venue `f41cbabe`) was confirmed **read-only** still at `processing` / `is_servable=false` / 1 input key (the exact stranded state) and **left intact** for the orchestrator's Raleigh revert.

**tsc:** zero-new — 727 baseline errors (all pre-existing `packages/*` test-dep noise), **zero referencing any touched file** (wizard, `deckReadinessRoutes.ts`, `deck-readiness.tsx`, both test files).

---

## 8. Runtime cap (documented)

Authed **web** runtime is unreachable to the pipeline (standing cap). Resolved on the **iOS sim** per the ORCH-1255 recipe: worktree Metro `:8089` + `pk_live` env, disposable mail.tm account (`orch1285qa…@web-library.net`) via email-OTP, Maestro (text) + idb (taps). One residual: a human (Seth) eyeball on the *deployed Vercel* build would upgrade the web surface from "proven-by-equivalence" to "proven-on-web" — optional, since the fix is trigger-agnostic and the native RN path is live-fire-proven. The `run_tier2_pipeline→deck_eligible` completion was not re-driven (unchanged screen; proven in META-ORCH-1255 R2/R3).

---

## 9. Discoveries for Orchestrator

1. **ORCH-ID collision (confirm at CLOSE).** `strict-grep-mingla-business.yml` now carries TWO "ORCH-1285" display names: this deck-readiness job (`orch-1285-create-lands-on-durable-deck-readiness`) and the already-merged admin console (`orch-1285-offerings-read-only`). YAML job KEYS are distinct (no CI break), but the label collision should be reconciled — renumber one at CLOSE (matches implementor Discovery #1).
2. **Worktree `node_modules` is a symlink** to the anchor. Native Metro bundled fine, but lazy-imports for `posthog-react-native`, `expo-tracking-transparency` failed to resolve through the symlink (non-fatal warnings; analytics/ATT only). For a clean native Metro, a real `npm ci` in the worktree is advised (matches `feedback_ota_from_worktree_needs_real_npm_ci`).
3. **Pre-existing stale test** `VenueCreatorWizard.ve2.test.ts` fails identically on `origin/main` (tokens removed by META-ORCH-1255 R2) — not caused by this ORCH; recommend a `[TEST-MOD-APPROVED]` retarget/retire (matches implementor Discovery #2).
4. **create.tsx dead create-success sub-branch** (implementor §10) — harmless unreachable code (only claim reaches `phase="success"` now); small follow-up cleanup ORCH.

---

## 10. Cleanup attestation

**PROD RESIDUE: NONE.** All QA fixtures created this session were deleted and verified zero: venue `76823ea2…` (0), place_pool `40da7312…` (0, `business_authored`/`is_servable=false` guard), brand `9bbe8d4f…` "ORCH1285 QA Venue Brand" (0), `brand_team_members` (0), `creator_accounts` (0), auth user `76bb9946…`/`orch1285qa…@web-library.net` (0). Orchestrator's live row "The Cluster Fuck" (`f41cbabe…`/`cd41f4e8…`) **PRESERVED** (verified count 1 each, untouched). Tester Metro killed by PID (port 8089 free); business app terminated; sim left booted; no other session's ports/devices touched; no global pkill.
