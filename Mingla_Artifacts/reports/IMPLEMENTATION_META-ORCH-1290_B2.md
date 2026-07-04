# IMPLEMENTATION — META-ORCH-1290 (B2 addendum): pitch write via pipeline action, not client RLS UPDATE

**ORCH:** META-ORCH-1290 [venue authoring — one submission] — ADDENDUM resolving blocker **B-2**.
**Worktree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]/` on branch `orch-1290-venue-authoring-one-submission` (Legs A/B/C already on-branch).
**Status:** implemented, partially verified (deno + strict-grep gates GREEN; tsc/jest/expo-export UNRUN — shared `node_modules` lacks the dev toolchain, see §Operator action).

---

## 1. Summary (plain English)

When a venue owner edits their listing "pitch" (the one-line/paragraph blurb), Leg B saved it by having the phone/browser write straight into the `place_pool` table using a row-level permission. That permission is too broad — it lets an owner set **any** column of their own row (e.g. quietly flip their venue live `is_servable=true` or fake AI scores), skipping admin approval, the bouncer, and scoring. This addendum moves that save onto the backend authoring pipeline as a new `update_pitch` action that writes **only the pitch column** and decides live-vs-staged on the server. The owner sees no difference; the loophole is closed.

## 2. The B-2 fix

- **Before:** `updateVenuePitch` in `businessPlaceAuthoringService.ts` did a direct client `supabase.from("place_pool").update(...)`, gated only by RLS policy `place_pool_business_owner_update` + `GRANT ALL ON place_pool TO authenticated` — a row-level UPDATE that can set any column via PostgREST.
- **After:** `updateVenuePitch` invokes the new `update_pitch` action on `run-business-place-authoring-pipeline`. The action is a **USER action** (goes through the existing `requireUser` → `loadOwnedBrand` → `loadOwnedVenue` ownership gate — NOT the service-role `evaluate_signals` branch). It writes the pitch **column-scoped** and never any serving/scoring column.
- **Stage-vs-apply is decided SERVER-SIDE via the existing `placeWriteMode` helper** (reused, not duplicated) from `venue.claim_status` + the place's `business_author_brand_id`:
  - **apply** (verified venue OR create-owned business-authored row) → writes `place_pool.generative_summary` only (empty pitch → `NULL`). Same column `authoredApply`/`confirm` already own; fires the Sub-D AFTER-UPDATE trigger → re-queues the eval (SC-6).
  - **stage** (pre-approval claim of a seeded place) → writes only `business_authoring_inputs.tier1.description` (empty pitch → `""`), merged into existing inputs so tier2/adoption staging survives. NEVER a serving column (I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE). `authoredApply` applies it at approve (SC-5).
- A client can no longer force a live write onto a pre-approval claim (server decides the mode). The RLS policy is left intact (pre-existing; orchestrator is registering a separate sweep — see §Discoveries).

## 3. SPEC criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-5 (listing edit, pending) | edit pitch on a pending venue persists (staged `tier1.description`); approve applies to `generative_summary` | ✓ implemented — now via `update_pitch` stage mode (deno B2b) | see commit |
| SC-6 (listing edit, live) | verified venue → write `generative_summary` directly; Sub-D trigger re-queues eval | ✓ implemented — `update_pitch` apply mode (deno B2a) | see commit |
| B-2 (arch) | pitch write is RPC/service-role-owned, not a client RLS UPDATE | ✓ resolved — deno B2a-e + jest + strict-grep gate | see commit |

## 4. Files changed

| File | Δ | What |
|------|---|------|
| `supabase/functions/run-business-place-authoring-pipeline/index.ts` | +~95 | `update_pitch` in the `Action` union; `pitch?` on `RequestBody`; `export` on `loadOwnedVenue` (for the ownership test — precedented pattern in this file); `handleUpdatePitch` (column-scoped, `placeWriteMode`-driven); dispatch branch (user-authed, after `sync_gallery`) |
| `mingla-business/src/services/businessPlaceAuthoringService.ts` | +~20/−~50 | `updateVenuePitch` repointed to invoke `update_pitch`; direct `place_pool` UPDATE path + its comment REMOVED; signature `{ brandId, venueId, placePoolId, pitch }` (dropped `isLive` — server computes mode) |
| `mingla-business/src/components/venue/VenueListingContent.tsx` | +~4/−~2 | `handleSavePitch` passes `brandId/venueId`, null-guards them; dep array; `isLive` stays a client-only re-scoring flag |
| `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx` | +~4/−~2 | `handleSavePitch` passes `brandId/venueId`; dep array |
| `.github/scripts/strict-grep/i-proposed-1290-pitch-via-pipeline.mjs` | +~110 (new) | DRAFT gate for I-PROPOSED-1290-PITCH-WRITES-VIA-PIPELINE-ACTION (`--self-test` GOOD/BAD) |
| `.github/workflows/strict-grep-mingla-business.yml` | +~6 | registers the gate in the existing `meta-orch-1290-*` job |
| `supabase/functions/run-business-place-authoring-pipeline/__tests__/meta_orch_1290_b2_update_pitch.test.ts` | +~275 (new) | deno suite (B2a-e) |
| `mingla-business/src/services/__tests__/updateVenuePitch.b2.test.ts` | +~95 (new) | jest service suite (invoke, not direct write) |
| `mingla-business/src/components/venue/__tests__/venueAuthoringOneSubmission.metaOrch1290.test.ts` | +~30 (additions-only) | appended B2 source-assert describe block |
| `Mingla_Artifacts/specs/SPEC_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` | +1 | DRAFT invariant added to §6 |

No migration (both columns `generative_summary` + `business_authoring_inputs` pre-exist). No RLS/schema change.

## 5. Edge functions touched

- `run-business-place-authoring-pipeline` — **preserve `verify_jwt: true`** and the `x-client-info` header. New `update_pitch` action is user-authed (requireUser). `ai_signal_scores` sole-writer (`evaluate_signals`, service-role) unchanged — `update_pitch` writes NO scores. **Redeploy required** (orchestrator/operator, from merged main).

## 6. Regression tests + fails-on-revert

- **deno:** `meta_orch_1290_b2_update_pitch.test.ts` — 5 tests (B2a apply→`generative_summary` only + forbidden-key asserts; B2b stage→`tier1.description` only, merge preserved; B2c empty→NULL/""; B2d create-owned→apply; B2e ownership 403 via `loadOwnedVenue`). Run: `11 passed | 0 failed` (incl. the 6 sibling `orch_1263_stage_only_claim` tests, still green). `deno check` on the edge fn: clean.
- **fails-on-revert (deno):** injected the exact B-2 vulnerability — apply mode also writing `is_servable: true` — → **B2a/B2c/B2d FAILED** on the column-scoped key-set / forbidden-key assertions (diff showed the extra key). Restored → `5 passed | 0 failed`. **Fails-on-revert verified at HEAD of this addendum commit** (see §commit hash below).
- **jest:** `updateVenuePitch.b2.test.ts` — asserts `supabase.functions.invoke` fires with the exact `update_pitch` body AND `supabase.from` is NEVER called; plus real-error surfacing. Reverting to the direct write makes `mockFrom` get called → assertion fails. **UNRUN in this session** (see §7).
- **strict-grep:** `i-proposed-1290-pitch-via-pipeline.mjs` self-test PASS + run PASS. Reverting `updateVenuePitch` to `.from("place_pool")` or dropping the edge handler fails it.
- **all orch-1290 + 1255 + 1263 strict-grep gates:** 10/10 GREEN (self-tests + runs).

## 7. Operator action required (gates UNRUN in this session)

The worktree's `mingla-business/node_modules` is a **symlink to the anchor's**, which is a partial install with **no `typescript`, `@types`, `jest`, or `ts-jest`**. Running `npm ci` here would mutate the shared anchor `node_modules` (concurrent-session hazard, per memory). So these HARD gates were NOT run and must be run by the operator/tester after a clean install:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]/mingla-business"
npm ci
npx tsc --noEmit -p tsconfig.json                       # expect ZERO new errors
npx jest src/services/__tests__/updateVenuePitch.b2.test.ts \
         src/components/venue/__tests__/venueAuthoringOneSubmission.metaOrch1290.test.ts
npx expo export -p web --clear                            # expect exit 0
```

Edge deploy (orchestrator/operator, from merged main): `run-business-place-authoring-pipeline` (verify_jwt=true).

## 8. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Business iOS / Android | YES | pitch save now hits the pipeline action (shared RN → parity automatic). NATIVE-BUILD-ONLY (COMMS-0052) — no OTA. |
| Buyer/anon Web · Consumer iOS/Android · Admin Web · Business Web preview | NO | no code path change (buyer/anon never edited pitch; consumers read `generative_summary` unchanged) |

## 9. Discoveries for Orchestrator

1. **RLS policy `place_pool_business_owner_update` + `GRANT ALL ON place_pool TO authenticated` remain live.** This feature no longer uses them for the pitch write, but they still grant any authenticated owner broad row-level UPDATE power on `place_pool`. Per the dispatch, a separate sweep should decommission/narrow them (verify no other feature depends on the owner-update policy first).
2. **Create-new pending seed nuance (low severity).** For a create-owned business-authored venue still pending, `placeWriteMode` = apply → the pitch writes `generative_summary`, but the listing seed logic (`VenueListingContent` `fetchVenuePitchSource`) reads `tier1.description` first for a non-verified venue. On reload the seed could show the pre-edit `tier1.description`. This is the task's explicit design (create-owned = apply) and matches how the create INSERT already writes `generative_summary`; flag for the tester to confirm reload-visibility on a create-owned pending venue, and consider aligning the client seed to prefer `generative_summary` for apply-mode rows if it surfaces.
