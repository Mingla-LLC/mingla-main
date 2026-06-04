# IMPLEMENTATION — META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline repair]

**Date:** 2026-06-03
**Executor:** mingla-implementor (Claude, parity mirror)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1062-[venue-onboard-to-deck]/` on branch `META-ORCH-1062-venue-onboard-to-deck`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1062_VENUE_ONBOARDING_TO_DECK.md` (committed `971ac9293`)
**Supabase ref:** `gqnoajqerqhnvulmnyvv`
**Status:** implemented and verified (all 5 phases committed; per-phase regression tests pass + fails-on-revert proven; deno check / eslint / vite build / strict-grep all green). Migrations + edge deploys awaiting the orchestrator (NOT db-pushed, NOT deployed — per dispatch).

**Orchestrator-locked decisions implemented exactly:** Q1=(b) rollback-on-total-scoring-failure; Q2=real bidirectional admin override on `place_scores.score` (0–200, audit-logged, admin-gated); Q3=(b) approve identity even if re-bounce fails (venue stays off-deck with stored reason); Q4=admin-gated SECURITY DEFINER bundle RPC after RLS probe.

---

## Commit map (per phase, on branch)

| Phase | Commit | Summary |
|---|---|---|
| Phase 0 — source reconcile | `18775bc99` | 3 deployed-but-unmerged sources onto branch + C7 allowlist |
| Migration (DB-first) | `9b98def18` | `20260831000000` admin-vetting RPCs + post-apply probe test |
| Phase 3 — stop demotion | `53bfcbb91` | prior-state-preserving is_servable in confirm + handleTier2 |
| Phase 2 + Phase 4 | `bfc06b34f` | un-bounce bridge + approval scorer-loop keystone fix + strict-grep gate |
| Phase 1 — admin console | `4a0af0fa1` | gallery + scores + missing fields + bidirectional override + tweak |

---

## Edge functions whose SOURCE changed → deploy list (FOR THE ORCHESTRATOR)

Deploy FROM main after merge (COMMS-0015), preserving `verify_jwt`. Order relative to migration noted below.

1. **`run-business-place-authoring-pipeline`** (`verify_jwt:true`) — Phase 3 (confirm + handleTier2 no longer demote a live claim). Reconciled v37 + edited.
2. **`admin-review-venue-claim`** (`verify_jwt:true`) — Phase 2 (in-process re-bounce on approve) + Phase 4 (scorer loop with signal_id, Q1 rollback) + Phase 1 (`tweak_fields` / `score_override` actions). Reconciled v92 + edited.

**`run-signal-scorer`, `run-bouncer`, `run-pre-photo-bouncer` are UNCHANGED** — consumed as-is (the bouncer batch fns can't take a single place, so the re-bounce uses the pure `_shared/bouncer.ts` in-process).

### Deploy ORDER relative to the migration
1. **FIRST:** operator runs `db push` (applies `20260831000000` — the 3 admin RPCs). The two edge functions' new admin actions (`tweak_fields`/`score_override`) call those RPCs, so the migration MUST be live before `admin-review-venue-claim` is deployed.
2. **THEN:** deploy `admin-review-venue-claim` and `run-business-place-authoring-pipeline` from main.

---

## Migrations to apply (in order)

| Version | File | Remote state | Action on `db push` |
|---|---|---|---|
| `20260813000000` | `meta_orch_1009_sub_f_recommend_review.sql` | ALREADY applied (in `schema_migrations`) | **No-op skip** (Phase 0 reconcile only; byte-identical to remote-applied across 7 sibling worktrees, sha `a43897a2…`) |
| `20260831000000` | `meta_orch_1062_admin_vetting_rpcs.sql` | NOT on remote (NEW) | **Applied** — creates `admin_get_claim_review_bundle`, `admin_tweak_venue_claim_fields`, `admin_apply_score_override` |

**Copy-paste db push command (operator, from the linked anchor or after merge):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1062-[venue-onboard-to-deck]" && /Users/sethogieva/bin/supabase db push --linked
```
(If run from the unlinked worktree it errors `Cannot find project ref` — run from the linked anchor `~/Desktop/mingla-main` after merge, or link the worktree first. `--include-all` is NOT needed: `20260831000000` is strictly above the remote head `20260829000000`; `20260813000000` is below the head and already-applied so it is skipped, not reordered.)

**Migration version safety (probe):** `mcp__supabase__list_migrations` confirmed remote max = `20260829000000`; `20260813000000` present; `20260831000000` absent. No remote-only version sits below `20260831000000`. Allocated prefixes strictly exceed remote + all sibling worktrees (`meta-orch-1059` max `20260829000000`).

---

## Regression-test evidence

| Phase | Test path | Result | fails-on-revert |
|---|---|---|---|
| 3 | `supabase/functions/run-business-place-authoring-pipeline/__tests__/meta_orch_1062_no_demotion.test.ts` | 3 PASS (deno) | ✅ at `9b98def18` (revert helper → `return false` ⇒ "claim of a live place stays servable" FAILS) |
| 2/4 | `supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_scorer_loop.test.ts` | 3 PASS (deno) | ✅ at `53bfcbb91` (revert `buildScorerInvokeBody` to place_ids-only ⇒ all 3 FAIL; gate also FAILS) |
| 1 | `mingla-admin/src/lib/__tests__/claimPhotos.test.js` | 4 PASS (node --test) | ✅ at `bfc06b34f` (revert `collectClaimPhotos` to cover-only ⇒ 3 of 4 FAIL) |
| migration | `supabase/migrations/__tests__/meta_orch_1062_admin_vetting_rpcs.test.sql` | hand-run post-`db push` probe (5 asserts: fns exist as SECURITY DEFINER, search_path pinned, non-admin gated, signature, grant matrix) | RAISEs immediately if migration absent |

Existing suites unbroken: 23 authoring deno tests PASS, 11 admin-review deno tests PASS, 3 claimsPhone node tests PASS. `deno check` clean on both edge fns. `eslint` clean on all admin files. `vite build` green (2942 modules). New strict-grep gate `meta-orch-1062-approval-go-live.mjs` self-test + real run PASS; C7 (ORCH-0863) self-test PASS.

---

## Data-probe results (read-only, on remote)

- `fetched_via` distribution for claimed rows: **all 3 are `business_authored`** (category→types remap guard is moot today but kept for future Google-claim rows).
- RLS (Q4 probe): `place_scores` has `place_scores_auth_read` (SELECT, authenticated, `qual:true`); `place_pool` has `authenticated_read_place_pool` (SELECT, authenticated). Admin browser COULD read directly, but Q4 is LOCKED to the SECURITY DEFINER bundle RPC (one round-trip + server admin gate + robust to future RLS tightening) — implemented as `admin_get_claim_review_bundle`.
- Live fixtures: `Lantern & Vine` (`8b720912…`, 7 stored + 6 gallery, deck_eligible, is_servable=false, 0 scores) = Phase-4 happy path. `Lumen Wine Bar` (`3b10d972…`, is_servable=true via manual flip, 0 scores) proves servable-without-scores is off-deck.
- `place_scores.score` CHECK = `0 ≤ score ≤ 200` (Q2 clamp confirmed). 16 active signals.
- Deployed `admin-review-venue-claim` **v92** confirmed to carry the broken `body: { place_ids: [placePoolId] }` (no signal_id) — the keystone 1062-A bug, now fixed.

---

## Phase-by-phase receipts

### Phase 0 — source reconcile (`18775bc99`)
- `run-business-place-authoring-pipeline/index.ts` (+ 3 `__tests__`): copied from `__orch1039_test`; sha256 = `a68ac42d86cd5fba8064fa479ccaa92d93bda589cbee9e5882b49c38aa810608` (SC-0.1 ✅).
- `admin-review-venue-claim/index.ts`: old Ve3 (6852 B) replaced with WS7 (9070 B). 14 behavioral fingerprints (broken scorer call, veto patch, go-live flip, edit-count reset) all present in deployed v92 bundle (SC-0.2 ✅). `reviewLogic.ts`/`index.test.ts` byte-identical Ve3↔WS7 (no change).
- `20260813000000_…sub_f…sql`: sha `a43897a2…`, identical across 7 sibling worktrees + remote-applied (SC-0.3 ✅).
- C7 allowlist block `META_ORCH_1062_BACKEND_ALLOWLIST` added + spread (SC-0.4 ✅). `verify_jwt` preserved (SC-0.5 ✅).

### Migration `20260831000000` (`9b98def18`)
- `admin_get_claim_review_bundle(uuid)` (Q4), `admin_tweak_venue_claim_fields(uuid,jsonb)` (Phase 1), `admin_apply_score_override(uuid,text,numeric,text)` (Q2). All `SECURITY DEFINER`, `auth.uid() IS NULL→not_authenticated` + `is_admin_user()→forbidden`, `search_path` pinned, `REVOKE…FROM PUBLIC,anon` + `GRANT…TO authenticated`.
- **SPEC deviation (noted):** the migration is named `…admin_vetting_rpcs.sql` (not the SPEC's placeholder `…approval_servable_scorer.sql`) because the approval→scorer loop is pure EDGE code (SPEC §4.3) — the migration holds only RPCs. The SPEC's optional `20260830000000` no-op reconcile migration was dropped as unnecessary (the Sub-F migration reconciles at its own historical timestamp). C7 allowlist updated to the real names.

### Phase 3 — stop demotion (`53bfcbb91`)
- `confirm_ai_outputs` line 1373 literal `is_servable: false` → `nextIsServableForConfirm(place.is_servable)` (exported pure helper; prior `true` stays `true`, else `false`).
- **Discovered + fixed a SECOND demotion site:** `handleTier2` (line ~1281) also hard-coded `is_servable: false` on its UPDATE — same 1062-B class for an already-live claim — routed through the same helper. The net-new INSERT default `false` (line 585) is correct (I-NET-NEW-HOLD) and untouched.

### Phase 2 + Phase 4 (`bfc06b34f`)
- **Phase 2:** the batch bouncer fns (`run-bouncer`/`run-pre-photo-bouncer`) reject a single place (require `city_id`/`all_cities`, else 400) — SPEC option (a) not viable, so implemented option (b): import pure `bounce()` from `_shared/bouncer.ts`, fetch the linked row's bouncer fields, re-evaluate in-process on approve. Servable only granted on a re-bounce pass; on fail, `bouncer_reason`/`bouncer_validated_at` recorded and `is_servable` NOT flipped (Q3=(b): identity stays verified, venue off-deck).
- **Phase 4:** flip `is_servable=true`/`is_active=true` committed BEFORE scoring; loop active `signal_definitions`; invoke `run-signal-scorer` per signal via `buildScorerInvokeBody(signalId, ppid)` (BOTH keys — kills the 1062-A 400). Per-signal failures logged + reported in `go_live.failed_signals`/`scored_signals`. Q1=(b): total failure rolls `is_servable` back to `false` with `bouncer_reason='scoring_failed_on_approve'`.
- New strict-grep gate `meta-orch-1062-approval-go-live.mjs` (Part A scorer-invoke-has-signal-id, Part B no `is_servable:false` inside any `.update(`, Part C approve-loops-signals) + self-test, wired into `strict-grep-mingla-business.yml`.

### Phase 1 — admin console (`4a0af0fa1`)
- `ClaimsPage.jsx`: inline photo gallery (`collectClaimPhotos`) + PhotoLightbox; quality-signals block (bouncer verdict + reason chips + place_scores + aesthetic); missing fields (price/website/pitch, null-hidden); per-signal bidirectional override form; field-tweak form (pending-only); 9 states.
- `adminClaimsService.js`: `getClaimReviewBundle` (Q4 RPC), `tweakClaimFields` (`tweak_fields` edge action), `overrideClaimScore` (`score_override` edge action), `reviewClaim` scoreVetoes passthrough.
- `admin-review-venue-claim` edge: early-dispatch `tweak_fields` + `score_override` actions (admin-gated, call the RPCs via the user client so `is_admin_user()` sees `auth.uid()`, audit-logged), `verify_jwt:true` preserved.
- `claimPhotos.js`: extracted pure helper (testable).

---

## Spec success criteria

All LOCKED SCs implemented: SC-0.1..0.5, SC-1.1..1.6-Admin, SC-2.1..2.3, SC-3.1..3.3, SC-4.1..4.6. SC-4.1/4.2 (end-to-end deck appearance) are demonstrable only after `db push` + edge deploy on `Lantern & Vine` — flagged for the orchestrator/tester live-fire. New invariants honored: I-1062-SOURCE-MATCHES-DEPLOYED, I-ADMIN-CLAIM-PHOTOS-INLINE, I-SCORE-OVERRIDE (now bidirectional per Q2 — supersedes the SPEC's reduce-only draft), I-ADMIN-WRITE-GATED, I-CLAIM-REBOUNCE-ON-APPROVE, I-NO-CLAIM-DEMOTION, I-NET-NEW-HOLD, I-APPROVE-PRODUCES-SCORES, I-SCORER-INVOKE-HAS-SIGNAL-ID, I-NO-CLAIMED-VENUE-BOOST (untouched).

**Q2 note:** the SPEC drafted score override as "reduce-only"; the orchestrator LOCKED it to REAL bidirectional (admins may raise UP). `admin_apply_score_override` therefore clamps 0–200 and allows raise OR lower, writing the deck-ranking `place_scores.score` directly (UPSERT) + the audit slice on `ai_signal_scores_veto`. The SPEC's I-SCORE-OVERRIDE-REDUCE-ONLY is intentionally superseded by the locked decision.

---

## Discoveries for orchestrator

1. **Second demotion site** (`handleTier2`, authoring pipeline) carried the identical 1062-B hard-coded `is_servable:false` as the confirm step — fixed in Phase 3 (in-scope; same invariant). No separate ORCH needed.
2. **Bouncer batch fns can't score a single place** — confirmed by reading deployed source; SPEC option (a) was not viable, used option (b). No action; documented for future un-bounce work.
3. **COMMS-0018** (this ORCH's own FYI) acknowledged: Phase 0 absorbs the Sub-F source-to-main merge; META-ORCH-1009 owners should not re-merge a divergent copy.
4. **Live-fire gap:** SC-4.1/4.2 (an approved `Lantern & Vine` appears on the signal deck) can only be proven after `db push` + edge deploy — hand to the tester for on-remote live-fire.

---

## Handoff (deploy sequence for the orchestrator)
1. Merge the branch PR to main (required checks green).
2. From the linked anchor: `supabase db push --linked` (applies only `20260831000000`).
3. Deploy from main (verify_jwt preserved): `run-business-place-authoring-pipeline`, then `admin-review-venue-claim`.
4. verify-first-call each (non-404), then live-fire `Lantern & Vine` approve → confirm `place_scores` rows created + venue returned by `query_servable_places_by_signal`.

---

## Post-#299 merge resolution (2026-06-03, mingla-implementor / Claude)

PR #299 (META-ORCH-1009 Sub-E+F, squash `2d12f5678`) and the follow-on
COMMS-0018 reconciliation merged to `origin/main` (`5e1f81798`) while this ORCH
was in flight, touching the same files. Merged `origin/main` into the branch and
resolved the cross-ORCH conflict preserving BOTH sides' intent. Merge commit
`769e4dae3` (2 parents: `616a3e33a` ours + `5e1f81798` main).

### Conflict map + resolution (6 conflicts)

| File | Type | Resolution |
|---|---|---|
| `supabase/functions/run-business-place-authoring-pipeline/index.ts` | add/add | Took OURS. Verified the ONLY delta vs `origin/main` is the Phase 3 `nextIsServableForConfirm` change (function def + two call sites in `handleTier2` + `handleConfirmAiOutputs`). Ours == #299 base + Phase 3. |
| `supabase/functions/admin-review-venue-claim/index.ts` | content | Took OURS. Keeps `score_vetoes` read (WS7 backward-compat), `runApproveGoLive`, `buildScorerInvokeBody` w/ `signal_id` (keystone 1062-A fix), Q1 rollback, Q3 off-deck. Supersedes the #299 WS7 go-live block per spec. |
| `mingla-admin/src/pages/ClaimsPage.jsx` | 3-way (3 regions) | Semantic merge. See "How the two score-editing UIs were reconciled" below. |
| `mingla-admin/src/services/adminClaimsService.js` | 3-way (2 regions) | Took main's more-general `scoreVetoes` JSDoc type + main's safer non-empty guard; kept the `score_vetoes` pass-through DORMANT for backward-compat (edge fn still accepts it; UI no longer sends it on approve). |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | content | UNION — `META_ORCH_1062_BACKEND_ALLOWLIST` + all of main's new ORCH allowlists (1044/1045/1050/1051/1052/1054/1058B/1060) merged into one `ALLOWLIST`. |
| `Mingla_Artifacts/WORLD_MAP.md` | content | UNION — this branch's META-ORCH-1062 CLOSE entry on top + main's new entries (ORCH-1062 vibe-overrides, META-ORCH-1048, etc.) preserved. |

`.easignore` and the remaining strict-grep files auto-merged cleanly (no symlink artifact; `.easignore` byte-identical to main). `supabase/config.toml` auto-merged to main's copy (no per-fn `verify_jwt` block for these fns → defaults preserved, zero regression).

### How the two score-editing UIs were reconciled (operator-locked policy)

The core conflict was two competing score editors in the admin claim modal.

KEPT (this branch / META-ORCH-1062 — the single coherent console):
- PhotoLightbox-based inline gallery (richer; `collectClaimPhotos(bundle, …)` → thumbnail grid → `PhotoLightbox`) — the ONE canonical gallery.
- Real deck-rank scores via the admin-gated bundle read (`bundle.scores` = actual `place_scores`), shown in "Quality signals".
- BIDIRECTIONAL Q2 score override (0–200, raise OR lower) via `admin_apply_score_override` (`overrideClaimScore`).
- Whitelisted field-tweak control (`tweakClaimFields`).

REMOVED from #299 WS7 (superseded — no dead controls, no duplicate gallery, no two editors):
- The #299 simple `<img>` photo gallery (`pp.business_gallery_urls`) — duplicate of the PhotoLightbox grid.
- The #299 REDUCE-ONLY signal-score veto editor (`vetoes` state + the `<input max={original}>` grid + "N score(s) will be reduced on approve"). The `vetoes` state, `setVetoes` calls, and `approve({ scoreVetoes: vetoes })` were removed; approve now calls `runReview("approve")` with no opts.

PRESERVED from #299 WS7 (genuinely additive operator context):
- The "Recommendation profile" panel: AI pitch (`generative_summary`), operator answers (`facets`), and the AI consistency check (`consistency.verdict/confidence/summary/flags`) read from `business_authoring_inputs`. Its local `pp` was renamed `recoPp` to avoid shadowing the outer bundle-derived `pp`.

BACKWARD-COMPAT retained: `admin-review-venue-claim` still accepts `score_vetoes`, so `reviewClaim`'s pass-through is kept (dormant). Approve no longer depends on it — the go-live path is now Phase 4 (servable-flip → per-signal scorer), not WS7 vetoes.

### Re-verification (all GREEN, captured)

- `deno check` admin-review-venue-claim → exit 0; run-business-place-authoring-pipeline → exit 0.
- `deno test` admin-review-venue-claim → 15 passed / 0 failed (incl. signal_id-always-present, Q1 total-failure rollback, Q3 off-deck, servable-flip-before-scorer ordering).
- `deno test` run-business-place-authoring-pipeline → 23 passed / 0 failed; `meta_orch_1062_no_demotion.test.ts` → 3 passed / 0 failed (claim-of-live stays servable, net-new held, null→held).
- `eslint` ClaimsPage.jsx + adminClaimsService.js → exit 0 (clean). `claimPhotos.test.js` → 4 pass. (Full-repo `eslint .` exits 1 from PRE-EXISTING debt in SignalLibraryPage/StripeModePage/SubscriptionManagementPage/UserManagementPage — inherited from main, NOT this merge; the two resolved files are clean.)
- `vite build` mingla-admin → exit 0 (2945 modules, built in ~3.6s).
- strict-grep `meta-orch-1062-approval-go-live.mjs` → OK (scorer carries signal_id, confirm preserves prior is_servable, approve loops active signals).
- strict-grep `orch-0863-marketing-hub-phase-b.mjs` → All checks PASS (C7: 18 files in origin/main…HEAD diff, zero un-allowlisted backend touches).

### Keystones confirmed intact post-merge
- `buildScorerInvokeBody` throws on missing signal_id, returns `{ signal_id, place_ids }` (kills 1062-A HTTP 400).
- Phase 3 `nextIsServableForConfirm` exported + wired in both confirm paths.
- Migration `20260831000000_meta_orch_1062_admin_vetting_rpcs.sql` untouched (new file, 15721 bytes); branch migration prefix kept.
- `verify_jwt` settings unchanged (config.toml == origin/main).

### Hard guards honored
No `db push`, no edge-fn deploy, no PR open/merge — orchestrator owns those. Only the merge/conflict files staged. Migration prefix and verify_jwt preserved.
