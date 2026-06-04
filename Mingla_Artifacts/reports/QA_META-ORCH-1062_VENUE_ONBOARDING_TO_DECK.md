# QA — META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline repair]

**Date:** 2026-06-03
**Tester:** mingla-tester (TEST mode, independent verification)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1062-[venue-onboard-to-deck]/` on branch `META-ORCH-1062-venue-onboard-to-deck`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1062_VENUE_ONBOARDING_TO_DECK.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1062_VENUE_ONBOARDING_TO_DECK.md`
**Supabase ref:** `gqnoajqerqhnvulmnyvv` (read-only SQL via MCP; no mutation, no db push, no deploy)
**Comms ledger:** read on entry. COMMS-0018 (this ORCH → META-ORCH-1009, WARN, OPEN) factored — it is the discovery that drove this work; no BLOCK entries addressed to this skill / this ORCH / ALL.

---

## VERDICT: **PASS (code-level + regression)**

P0: 0 | P1: 0 | P2: 0 | P3: 2 | P4: 3

This is a **code-level + regression** verification pass. The live stack is NOT yet deployed (orchestrator deploys post-merge, then runs a separate live smoke test). The keystone (approve → servable + scored, with the signal_id fix) is **correctly wired** for the live smoke test to succeed — see §Keystone verdict.

**Sim evidence:** EXEMPT for the keystone/backend (backend-only edge + RPC + SQL; the consumer deck renderer is explicitly OUT of scope and untouched — SPEC §Non-Goals, confirmed by `git diff` name-only). The only UI surface is `mingla-admin` (web-only React); its functional contract is verified by code-read + `vite build` + node unit tests + eslint. Admin live-fire (clicking through the modal) is deferred to the orchestrator's post-deploy smoke (RPCs not yet on remote). No iOS/Android leg applies.

**Regression tests:**
- implementor happy-path = `supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_scorer_loop.test.ts` (3 PASS) + `…/run-business-place-authoring-pipeline/__tests__/meta_orch_1062_no_demotion.test.ts` (3 PASS) + `mingla-admin/src/lib/__tests__/claimPhotos.test.js` (4 PASS) — **fails-on-revert independently re-verified by tester** (see §Step-0.5).
- tester adversarial = `supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_orchestration.adversarial.test.ts` (4 PASS, ✅ fails-on-revert proven) — attacks the `runApproveGoLive` ORCHESTRATION (Q1 partial-vs-total rollback, Q3 bounce-fail off-deck, ordering), a genuinely different angle from the implementor's body-shape unit test.

Both regression tests appear in `git diff origin/main...HEAD --name-only`.

---

## Contract verification table (each Q + each phase → file:line evidence)

### Orchestrator-LOCKED policy (Q1–Q4) — code matches EXACTLY

| Q | Locked policy | Implemented? | Evidence |
|---|---|---|---|
| **Q1** | Total signal-scoring failure on approve → roll back is_servable to false + admin-visible error. Partial success (≥1 signal) stays live. | ✅ EXACT | `admin-review-venue-claim/index.ts:200-216` — `totalFailure = scored_signals.length===0 && failed_signals.length>0` → `.update({is_servable:false, bouncer_reason:'scoring_failed_on_approve'})`, `result.rolled_back=true`. Partial success never enters the branch → stays servable. Result surfaced in `go_live` response (`:479-488`, Constitution #5). Adversarial test proves both halves. |
| **Q2** | Score override is REAL + BIDIRECTIONAL (raise OR lower), clamped 0–200, writes deck-rank key `place_scores.score` (UPSERT, can create a row), audit-logged, admin-gated server-side. | ✅ EXACT | `20260831000000_…_admin_vetting_rpcs.sql:258-364` `admin_apply_score_override`: gate `is_admin_user()` (`:280`); clamp `score<0 OR score>200 → score_out_of_range` (`:292`); UPSERT into `place_scores ON CONFLICT (place_id,signal_id)` writing `score=EXCLUDED.score` (`:340-350`); creates a row if none (`v_version` fallback `:335-338`); audit slice on `ai_signal_scores_veto` + `contributions._admin_override` (`:318-329, :343`); returns `direction` created/raised/lowered (`:357-361`). UI input `min=0 max=200`, label "raises or lowers deck rank" (`ClaimsPage.jsx:710,719-721`). |
| **Q3** | Re-bounce fails on approve → identity still verified (claim_status='verified') but place stays off-deck (is_servable not flipped) with a stored bouncer_reason. Approval NOT hard-blocked. | ✅ EXACT | `biz_review_venue_claim` runs first + sets `claim_status='verified'` unconditionally (`index.ts:314-324`); go-live is separate and gated: on bounce-fail `runApproveGoLive` records `bouncer_reason`/`bouncer_validated_at` and `return result` WITHOUT flipping `is_servable` (`:121-134`). Adversarial test "re-bounce FAIL leaves venue off-deck, never scores" proves no flip + no scorer invoke. |
| **Q4** | Admin claim-detail read goes through an admin-gated SECURITY DEFINER bundle RPC (is_admin_user enforced inside). | ✅ EXACT | `admin_get_claim_review_bundle(uuid)` SECURITY DEFINER, `auth.uid() IS NULL→not_authenticated` + `NOT is_admin_user()→forbidden` (`sql:52-57`), returns brand + place_pool vetting fields + `place_scores` array (`:86-135`); admin UI reads via `getClaimReviewBundle` (`adminClaimsService.js:76`, `ClaimsPage.jsx:108`). RLS probe (impl report) showed admin COULD read directly, but Q4 LOCKS the definer RPC — implemented. |

### Phase contract verification

| Phase | Contract | Verified | Evidence |
|---|---|---|---|
| **0** | 3 deployed-but-unmerged sources reconciled onto branch byte-faithfully; authoring pipeline source on branch. | ✅ | SC-0.1 sha at reconcile commit `18775bc99` = `a68ac42d86cd5fba8064fa479ccaa92d93bda589cbee9e5882b49c38aa810608` (tester-verified). Admin-review reconcile = 9070 B carrying all v92 fingerprints incl. the broken `place_ids:[placePoolId]` call (tester-verified vs deployed v92 source fetched via MCP). Sub-F migration `20260813000000` present (`git diff name-only`). C7 allowlist present. `verify_jwt` preserved. |
| **4 keystone** | On approve: (a) re-bounce linked place_pool row, (b) flip is_servable=true BEFORE scoring, (c) loop ACTIVE signals + invoke run-signal-scorer with BOTH signal_id AND place_ids (buildScorerInvokeBody), (d) log per-signal failures not swallow, (e) Q1 rollback, (f) Q3 off-deck on bounce-fail. Live bug (missing signal_id) fixed. | ✅ ALL 6 | (a) `index.ts:113` `bounce(ppRow)`; (b) flip `:135-149` then loop `:169`; (c) `:154-194` loops `signal_definitions WHERE is_active=true`, invokes via `buildScorerInvokeBody(signalId, placePoolId)` `:73-79` → `{signal_id, place_ids}`; (d) per-signal `console.error` + `failed_signals.push` `:178-192` (no swallow); (e) `:200-216`; (f) `:121-134`. **Live bug fixed:** deployed v92 calls `body:{place_ids:[placePoolId]}` (no signal_id, tester-confirmed via MCP) → run-signal-scorer v160 returns 400 `signal_id is required` (tester-confirmed in deployed source). Branch passes both keys. |
| **3** | `nextIsServableForConfirm` preserves prior is_servable=true (no demotion); net-new rows stay false. | ✅ | `run-business-place-authoring-pipeline/index.ts:388-392` `return priorIsServable === true`. Applied at confirm `:1391` and the SECOND demotion site `handleTier2` `:1276` (impl discovery, in-scope). Net-new INSERT default `false` untouched `:585`. Tester-verified the Phase-3 diff is ONLY the helper + 2 call-site swaps + comments. |
| **1** | Admin UI: gallery inline (PhotoLightbox), scores render, override + tweak call right RPCs/edge actions. | ✅ | `ClaimsPage.jsx`: `collectClaimPhotos`+`PhotoLightbox` (`:13,28,314,845`); "Quality signals" + place_scores list + "Not yet scored" empty state (`:541,576,580-590`); missing fields null-hidden (`:599-629`); bidirectional override (`:266-296,710-755`); tweak (`:240`). `adminClaimsService.js`: `getClaimReviewBundle`/`tweakClaimFields`/`overrideClaimScore` → `tweak_fields`/`score_override` edge actions (`:76,92-95,111-117`). Edge wrapper dispatches both actions admin-gated + audit-logged (`index.ts:253-300`). |
| **1 RPC** | `admin_tweak_venue_claim_fields` whitelists keys + pending-only. | ✅ | `sql:182` whitelist `address/venue_category/price_level/price_tiers` else `invalid_patch_key`; `:195` `claim_status<>'pending_review'→brand_not_pending_review`; admin-gated `:172`. |

---

## Test runs (captured)

```
# deno — all META-ORCH-1062 edge tests (3 implementor scorer + 4 tester adversarial + 23 authoring)
$ deno test --allow-all supabase/functions/admin-review-venue-claim/__tests__/ \
      supabase/functions/run-business-place-authoring-pipeline/__tests__/
ok | 30 passed | 0 failed (290ms)

# deno check (both edge fns) — clean
$ deno check supabase/functions/admin-review-venue-claim/index.ts \
      supabase/functions/run-business-place-authoring-pipeline/index.ts
Check … (exit 0)

# mingla-admin node tests
$ node --test src/lib/__tests__/claimPhotos.test.js src/lib/__tests__/claimsPhone.test.js
# tests 7 | # pass 7 | # fail 0

# eslint (touched admin files) — clean (exit 0, no output)
$ npx eslint src/pages/ClaimsPage.jsx src/services/adminClaimsService.js src/lib/claimPhotos.js

# vite build — green
$ npm run build   # ✓ 2943 modules transformed; built in 3.52s; exit 0

# strict-grep gates
$ node .github/scripts/strict-grep/meta-orch-1062-approval-go-live.mjs --self-test   # Self-test PASSED
$ node .github/scripts/strict-grep/meta-orch-1062-approval-go-live.mjs               # OK (scorer invoke carries signal_id; confirm preserves prior is_servable; approve loops active signals)
$ node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs --self-test   # Self-test PASSED
$ node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs               # OK C1–C7 (C7 zero offenders; META_ORCH_1062 allowlist incl. tester adversarial test)
```

**Live read-only probes (MCP, `gqnoajqerqhnvulmnyvv`):**
- 16 active signals; `place_scores` CHECK = `score>=0 AND score<=200` (Q2 clamp matches).
- `Lumen Wine Bar`: `is_servable=true` AND `0 place_scores` → **proves the keystone bug live** (servable-without-scores = off-deck).
- `ai_signal_scores_veto` column live; the 3 new RPCs NOT yet on remote (expected — no db push).
- Deployed `admin-review-venue-claim` invokes scorer with `body:{place_ids:[placePoolId]}` (no signal_id); deployed `run-signal-scorer` v160 returns 400 `signal_id is required` without it → the silent-failure chain is real and the branch fix targets it precisely.

---

## Step 0.5 — Regression gate

**Implementor fails-on-revert (independently re-verified by tester):**
- Revert `buildScorerInvokeBody` to `{ place_ids:[...] }` (old bug shape) → all 3 implementor scorer tests FAIL (`0 passed | 3 failed`). Restored clean.
- Revert `nextIsServableForConfirm` → `return false` (re-introduce 1062-B) → "claim of an ALREADY-servable place stays servable" FAILS (`2 passed | 1 failed`). Restored clean.

**Tester adversarial test — different angle, fails-on-revert proven:**
- Path: `supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_orchestration.adversarial.test.ts`
- Drives the exported `runApproveGoLive` orchestration with an injected fake admin client (faithful supabase-js surface) + the REAL `_shared/bouncer.ts`:
  1. Partial scorer success (1 of 3 fails) → venue STAYS live, NOT rolled back (Q1).
  2. Total scorer failure → is_servable rolled back to false + `bouncer_reason='scoring_failed_on_approve'` (Q1).
  3. Re-bounce FAIL (no website + no hours → real B4+B6) → no servable flip, NO scorer invoke, reason stored (Q3).
  4. Ordering invariant: the `is_servable=true` flip is committed BEFORE the first scorer invoke (sequence-number assertion) + every invoke carries non-empty signal_id.
- Result: **4 passed | 0 failed**.
- **fails-on-revert:** neutralizing the Q1 rollback predicate (`totalFailure = false`) → "TOTAL scorer failure rolls is_servable back to false" FAILS (`3 passed | 1 failed`). Restored clean.

To enable the test, `runApproveGoLive` was changed from module-private to `export` (a one-keyword test-enablement change, zero behavior change; diff is comment + `export` only). The new test file was added to the ORCH-0863 C7 `META_ORCH_1062_BACKEND_ALLOWLIST` so the gate stays green.

---

## Adversarial probes (hidden fallbacks / swallowed errors / response-shape)

- **No silent failure on the keystone:** per-signal scorer failures are logged (`console.error`) AND aggregated into `failed_signals`, returned in the `go_live` response (Constitution #5). The old swallow-all `catch` is gone. ✅
- **Re-bounce read failure** (`ppErr || !ppRow`) returns early with empty result (identity already verified) — does not crash approve, does not flip servable. Acceptable degraded path. ✅
- **`signal_definitions` read failure** is treated as total failure → Q1 rollback fires (`:162-171, :200`). No servable-without-scores leak. ✅
- **Score override defense-in-depth:** UI validates 0–200 (`ClaimsPage.jsx:271`) AND the RPC re-validates `score_out_of_range` server-side (`sql:292`) — client cannot bypass. ✅
- **Whitelist bypass:** `admin_tweak_venue_claim_fields` rejects any non-whitelisted key incl. `is_servable` with `invalid_patch_key` (`sql:181-185`) — servable is only flippable via the approve path, never via tweak. ✅
- **Deck renderer unchanged (solo/collab parity):** `git diff origin/main...HEAD --name-only` shows ZERO touches to `discover-cards`, `query_servable_places_by_signal*`, `transformServablePlaceToCard`, `SwipeableCards`, or any consumer/app-mobile file. No deck regression possible. ✅
- **No claimed-venue boost:** approve path writes only `place_scores.score` (the universal rank key) + servable flip — no `is_claimed`/`claimed_by` read in any deck path. I-NO-CLAIMED-VENUE-BOOST preserved. ✅

---

## Findings

| # | Sev | Finding | Detail / fix |
|---|---|---|---|
| F-1 | **P3** | Strict-grep Part A trusts `buildScorerInvokeBody(...)` BY NAME at the call site, not its return shape. Reverting the helper body to `place_ids`-only still passes the gate (the deno test catches it, but the gate alone would not). | Defense-in-depth gap, not a live defect — the unit test is the real guard. Could harden Part A to also assert the helper body contains `signal_id`. Non-blocking. |
| F-2 | **P3** | The migration SQL probe `meta_orch_1062_admin_vetting_rpcs.test.sql` is hand-run post-`db push`; it cannot run now (RPCs not yet on remote). | Expected per dispatch (no db push). The orchestrator MUST run it after `db push` at CLOSE. Migration SQL itself was code-reviewed (SECURITY DEFINER + gate + clamp + whitelist all present). Non-blocking. |
| F-3 | P4 | Phase 3 implementor discovered + fixed a SECOND demotion site (`handleTier2`) carrying the identical hard-coded `is_servable:false`. Good catch — both route through the shared helper. | Praise. |
| F-4 | P4 | The `go_live` response object cleanly surfaces re-bounce verdict + scored/failed signals + rollback to the admin — no silent failure. Strong Constitution #5 adherence. | Praise. |
| F-5 | P4 | Q1/Q2 correctly implement the orchestrator-LOCKED decisions that DIVERGE from the SPEC's defaults (SPEC default Q1=keep-servable, Q2=reduce-only). The implementor followed the dispatch, not the stale SPEC draft, and documented the supersession. | Praise — correct precedence handling. |

**Zero P0, zero P1.** All five Completion-Condition clauses hold (tests green + captured; deno check + eslint + vite build clean; both regression tests in the PR diff with the adversarial attacking a different angle + implementor fails-on-revert re-verified; backend/admin-web exempt from sim legs with stated reason; zero open P0/P1).

---

## Keystone verdict (explicit)

**The keystone (approve → servable + scored, with the signal_id fix) is CORRECTLY WIRED for the live smoke test to succeed.** Proof chain:
1. The live bug is real: deployed admin-review calls the scorer with `place_ids` only; deployed run-signal-scorer v160 hard-400s without `signal_id` (both confirmed via MCP) — and `Lumen Wine Bar` is live-proof (servable, 0 scores, off-deck).
2. The branch fix invokes `run-signal-scorer` per active signal with `buildScorerInvokeBody(signalId, ppid)` = `{signal_id, place_ids:[ppid]}` — exactly the shape v160 accepts.
3. Ordering is correct: `is_servable=true` is committed before the scorer loop (the scorer SELECT filters `is_servable=true`), proven by the adversarial ordering test.
4. Re-bounce gates servability (Q3); Q1 rollback prevents servable-without-scores.

Remaining to PROVE end-to-end (orchestrator's post-deploy live smoke, NOT this pass): `db push` `20260831000000` → deploy both edge fns from main (verify_jwt preserved) → approve `Lantern & Vine` → assert `place_scores` rows created + venue returned by `query_servable_places_by_signal` for its bbox+signal.

---

## Discoveries for orchestrator

1. **F-1 (P3):** consider hardening strict-grep Part A to assert the `buildScorerInvokeBody` return contains `signal_id`, not just trust the call-site name.
2. **F-2 (P3):** the migration SQL probe MUST be hand-run after `db push` at CLOSE (it is the only live check of the RPC gate/clamp/whitelist).
3. Deploy order is load-bearing: `db push` (`20260831000000`) BEFORE deploying `admin-review-venue-claim` (its `tweak_fields`/`score_override` actions call the new RPCs).
