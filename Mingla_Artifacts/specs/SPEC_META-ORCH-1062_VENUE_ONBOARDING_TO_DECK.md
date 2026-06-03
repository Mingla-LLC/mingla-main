# SPEC — META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline repair]

**Date:** 2026-06-03
**Author:** mingla-forensics (SPEC mode, INVESTIGATE-then-SPEC)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1062-[venue-onboard-to-deck]/` on branch `META-ORCH-1062-venue-onboard-to-deck` (branched from main `d0a6e08c1`)
**Supabase ref:** `gqnoajqerqhnvulmnyvv`
**Inputs:** `Mingla_Artifacts/AUDIT_META-ORCH-1062_VENUE_ONBOARDING_TO_DECK.md` (anchor) + this skill's live INVESTIGATE pass (RPC bodies, deployed edge sources, live data, migration chain — all verified read-only on `gqnoajqerqhnvulmnyvv`).
**Migration version prefix allocated:** `20260830000000` (strictly greater than the max across remote `schema_migrations` (`20260829000000`) AND all active sibling worktrees (`meta-orch-1059` carries `20260829000000`); see §0.4).
**Cross-ORCH comms:** COMMS-0018 written to main (`5e1f81798`) — two more deployed-but-unmerged backend artifacts discovered (admin-review WS7 + Sub-F veto migration); Phase 0 absorbs them.

---

## 0. Executive summary + the corrected root-cause model

The audit is correct that the pipeline is severed at the approval→servable seam, but the INVESTIGATE pass found the seam is **partially wired in a DEPLOYED edge function whose source is not on main, and that wiring is itself broken**. The precise truth an implementor must build against:

1. **`admin-review-venue-claim` is deployed at v92 with a "WS7 go-live" block** (META-ORCH-1009 Sub-F) that, on approve, ALREADY sets `place_pool.is_servable=true, is_active=true` and invokes `run-signal-scorer`. **But main carries the OLD Ve3 source with none of this** — editing main's copy would edit a file production isn't running (defect 1062-F, expanded).
2. **That deployed v92 scorer invoke is broken**: it calls `run-signal-scorer` with `{ place_ids:[ppid] }` and **NO `signal_id`**. `run-signal-scorer` hard-requires `signal_id` (returns HTTP 400 `signal_id is required` immediately). The call is wrapped in best-effort `try/catch`, so it silently fails → **`place_scores` is never produced on approve** → the venue never satisfies the deck's `INNER JOIN place_scores` gate → never reaches the deck. **This is the true keystone bug (1062-A), not a missing write.** Live proof: `Lumen Wine Bar` (`place_pool_id 3b10d972-…`) has `is_servable=true` (manual SQL flip) yet `0` rows in `place_scores`.
3. The hard-coded `is_servable: false` in `run-business-place-authoring-pipeline` `confirm_ai_outputs` (line 1373) demotes a previously-live claimed Google place (defect 1062-B).
4. No un-bounce path: bouncer reads only `place_pool`, never re-runs on the linked row when a claimant fixes data (defect 1062-C).
5. Admin review UI shows no gallery, no scores, no override/tweak (defects 1062-D/E).

**Build order (operator-locked):** Phase 0 (reconcile all three unmerged sources onto main) → Phase 1 (admin can SEE: photos + scores + missing fields) → Phase 2 (un-bounce bridge) → Phase 3 (stop demotion) → Phase 4 (keystone: approval actually produces `place_scores` by looping signals, so the venue ranks and lands on the deck).

### 0.1 The two parallel tables (orientation — verified live)
- `brands`: business identity. Claim = `brands` row, `claim_status` ∈ `none→pending_review→verified|rejected`. Admin queue operates here.
- `place_pool`: consumer-deck supply. Deck-eligible ⟺ `is_active=true AND is_servable=true` AND ≥1 `place_scores` row for the queried signal above threshold AND real `stored_photo_urls` (in-code G3 gate in `discover-cards`).
- Link: `brands.place_pool_id`.

### 0.2 The deck-eligibility WHERE-clause (NOT changed by this SPEC — confirmed correct)
`query_servable_places_by_signal` / `…_intersection` (latest def: `supabase/migrations/20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql`): `pp.is_active=true AND pp.is_servable=true` + `INNER JOIN place_scores ps ON ps.place_id=pp.id AND ps.signal_id=<sig>` (filter score ≥ filterMin) + lat/lng bbox + type gate, `ORDER BY ps.score DESC`; plus the in-code real-stored-photos gate in `discover-cards`. **A servable place with no `place_scores` row for the queried signal is excluded.** This is why Phase 4 MUST produce `place_scores`, not merely flip `is_servable`.

### 0.3 Live data snapshot (proves the failure; defines the Phase-4 test fixtures)
| place_pool_id | name | is_active | is_servable | authoring_status | stored_photos | gallery | place_scores rows | claim_status | called |
|---|---|---|---|---|---|---|---|---|---|
| `8b720912-a0bf-405a-88f8-773eca6f3f33` | Lantern & Vine | true | **false** | deck_eligible | 7 | 6 | **0** | pending_review | no |
| `3b10d972-e556-4162-a53d-f206e231c4bc` | Lumen Wine Bar | true | **true** (manual flip) | deck_eligible | 1 | null | **0** | pending_review | no |
| `f0c3f4c4-e861-4424-89da-be47683701c9` | The Tuscanny Place | true | false | processing | 1 | 4 | 0 | pending_review | no |

`Lantern & Vine` is the canonical Phase-4 happy-path fixture (7+6 photos, deck_eligible). `Lumen Wine Bar` proves that `is_servable=true` alone is insufficient (0 scores → still off-deck).

### 0.4 Migration version allocation (safe-migration discipline)
- Remote `schema_migrations` max = `20260829000000`. Sibling worktrees max = `20260829000000` (`meta-orch-1059`). Collab worktree carries `20260826000000`.
- **Allocated for this ORCH:** `20260830000000` (Phase-0 Sub-F reconcile copy — see §1.3), `20260831000000` (Phase-2/3/4 RPC `biz_review_venue_claim` v-next + helper), in strict ascending order. Both strictly exceed all known versions.
- Every new migration that contains a `RAISE`/guard that could abort on existing rows MUST be preceded in the SPEC by a read-only data probe (see each phase's "Safe-migration" note). None of the migrations in this SPEC perform destructive DDL on populated columns; the only ADD COLUMN is `IF NOT EXISTS`.

### 0.5 Adversarial gate (Step 0.5) — applied per phase
Each phase below carries at least one happy-path regression test AND one adversarial test (the "what breaks this" angle), per the forensics Step 0.5 requirement.

---

## Scope, Non-Goals, Assumptions

**Scope (IN):**
- Backend RPCs (`biz_review_venue_claim` and a new bouncer-bridge helper), the `admin-review-venue-claim` edge wrapper, and the `run-business-place-authoring-pipeline` edge function (`confirm_ai_outputs` only).
- `mingla-admin` claim-review console (`ClaimsPage.jsx` + `adminClaimsService.js`): photo gallery, scores display, field/score override controls.
- Phase-0 source reconciliation onto main (three artifacts).
- The ORCH-0863 C7 backend allowlist + new strict-grep invariants.

**Non-Goals (OUT — with reason):**
- Consumer deck renderer + ranking (`discover-cards`, `query_servable_places_by_signal*`, `transformServablePlaceToCard`, `SwipeableCards`) — **proven correct by the audit; untouched.**
- Claimed-venue boosting / badging / sponsored sort — explicitly excluded by dispatch.
- Buyer-web — no claim authoring on web (the wizard is business-app only).
- Consumer-app venue-claim entry point — does not exist; not in scope to add.
- The aesthetic scorer backfill (30/88,365 scored) — out of scope; admin will render `photo_aesthetic_data` if present but its population is a separate ORCH.
- Stripe / money path — untouched.

**Assumptions (verified, not assumed-for-efficiency):**
- `run-signal-scorer` per-place mode accepts `{ signal_id:<text>, place_ids:[<uuid>] }`, filters `is_active=true AND is_servable=true`, scores ONE signal per call, upserts `place_scores ON CONFLICT (place_id,signal_id)`, deletes vetoed rows. **Verified by reading deployed v160 source.**
- 16 active signals exist, all with `current_version_id`. **Verified live.**
- `place_pool.ai_signal_scores_veto` + `business_gallery_urls` + `business_recommend_edit_count` columns exist on remote (Sub-F migration applied). **Verified live.**
- `is_admin_user()` is the server-side admin gate; `biz_review_venue_claim` is `SECURITY DEFINER` and enforces `auth.uid() IS NOT NULL` + `is_admin_user()`. **Verified by reading live function def.**

---

## Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behaviour the spec demands | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile`) | OUTCOME ONLY | An approved venue with photos appears on the signal deck identically to a Google place (no badge). No code change here. | none | automatic (shared `place_pool`) |
| 2 | Consumer Android (`app-mobile`) | OUTCOME ONLY | Same as iOS. | none | automatic |
| 3 | Buyer/anon Web (`mingla-business` public) | NOT COVERED | No claim authoring on web. | none | n/a |
| 4 | Business iOS (`mingla-business`) | OUTCOME ONLY | A previously-live claimed venue is NOT demoted by the Tier-2 confirm (Phase 3). No authoring-UI change. | none (backend only) | automatic |
| 5 | Business Android (`mingla-business`) | OUTCOME ONLY | Same as Business iOS. | none | automatic |
| 6 | Admin Web (`mingla-admin`) — adjacent | **COVERED (primary UI)** | Reviewer sees full gallery (inline lightbox), all scores (bouncer verdict/reason, per-signal place_scores, aesthetic), the missing text fields, and can override a score + tweak address/category/price before approve. | `ClaimsPage.jsx`, `adminClaimsService.js`, reuse `PhotoLightbox.jsx` | manual (admin-only code) |
| 7 | Business Web preview — adjacent | NOT COVERED | No claim-review UI on business web. | none | n/a |

Admin Web is the only surface with new UI; its success criteria are tagged SC-1-Admin..SC-… below. There is no manual-parity split (single surface).

---

# PHASE 0 — Source reconcile (prerequisite; defect 1062-F, expanded)

**Goal:** Bring the three production artifacts that run live but have no source on `main` onto this branch with byte-fidelity to what is deployed/applied, so Phases 2/3/4 edit the real running code.

## 0.A Files to land on the branch (exact)

| Artifact | Canonical source (verified byte-identical to deployed) | Deploy/remote truth | Verify |
|---|---|---|---|
| `supabase/functions/run-business-place-authoring-pipeline/index.ts` (+ `__tests__/`) | `~/Desktop/mingla-main/__orch1039_test/supabase/functions/run-business-place-authoring-pipeline/` (untracked on anchor) | deployed **v37**, `ezbr_sha256` bundle; index.ts sha256 = `a68ac42d86cd5fba8064fa479ccaa92d93bda589cbee9e5882b49c38aa810608` | `shasum -a256` of the copied `index.ts` MUST equal `a68ac42d…`. |
| `supabase/functions/admin-review-venue-claim/index.ts` (+ `reviewLogic.ts`, `index.test.ts`) — WS7 version | `~/Desktop/mingla-main/__orch1039_test/supabase/functions/admin-review-venue-claim/` OR `~/Desktop/mingla-orchs/ORCH-1038-test/supabase/functions/admin-review-venue-claim/` (byte-identical to deployed v92) | deployed **v92** | `diff` the copied `index.ts` against the deployed v92 source (fetch via `mcp__supabase__get_edge_function admin-review-venue-claim`) → MUST be empty. |
| `supabase/migrations/20260813000000_meta_orch_1009_sub_f_recommend_review.sql` | any of: `ORCH-1038-test`, `ORCH-1056`, `ORCH-1058`, `meta-orch-1059`, `META-1048-test-partner`, `hotfix-stripe-pk-test-on-prod`, `orch-0977-ios-build` (all sha-identical) | applied to remote (`schema_migrations` has `20260813000000`; `ai_signal_scores_veto` column live) | `git diff` shows it added; `mcp__supabase__list_migrations` confirms `20260813000000` already on remote (so `db push` will treat it as already-applied — see §0.C). |

**Shared deps already on main (no reconcile needed, verified):** `_shared/cors.ts`, `_shared/bouncer.ts`, `_shared/bouncerChainRules.ts` (authoring pipeline imports), and the Sub-F-era admin email/push helpers (`_shared/email/claimApprovedEmail.ts`, `claimRejectedEmail.ts`, `_shared/push-utils.ts`) which are already on main from ORCH-0101 Ve3.

## 0.B Reconcile mechanism (exact procedure for the implementor)
1. `cp` the `run-business-place-authoring-pipeline/` directory (index.ts + `__tests__/`) from `__orch1039_test` into `supabase/functions/run-business-place-authoring-pipeline/` on this branch. Run `shasum -a256` on `index.ts` → assert `a68ac42d86cd5fba8064fa479ccaa92d93bda589cbee9e5882b49c38aa810608`.
2. `cp` the WS7 `admin-review-venue-claim/` directory (index.ts + reviewLogic.ts + index.test.ts) from `__orch1039_test` (or ORCH-1038-test) over the branch's old-Ve3 copy. `diff` against the deployed v92 source fetched via MCP → assert empty.
3. `cp` `20260813000000_meta_orch_1009_sub_f_recommend_review.sql` into `supabase/migrations/`.
4. **Renumber concern:** the migration version `20260813000000` is LOWER than this ORCH's allocated `20260830000000`. That is fine and intentional — it is a reconcile of an ALREADY-APPLIED remote migration; it lands at its original historical timestamp so the migration history matches remote. Do NOT renumber it.
5. This is a SOURCE reconcile, not a redeploy. **No edge deploy in Phase 0.** Deploys happen at CLOSE after the Phase 2/3/4 edits land, per the deploy-from-main rule (COMMS-0015).

## 0.C Migration-history safety (critical)
- `20260813000000` is ALREADY recorded in remote `schema_migrations`. When the operator next runs `supabase db push --linked`, this file will be skipped as already-applied (its version is below the remote head). Confirmed safe because no later migration on main between `20260810000000` and `20260830000000` exists yet to collide.
- The byte content of the reconciled file MUST equal the remote-applied content (sha-verified across 7 worktrees = identical). Do not "improve" it during reconcile.

## 0.D ORCH-0863 backend allowlist (COMMS-0002, BLOCKING gate)
The C7 `no-new-backend-files` gate in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` fires against the PR diff. The reconciled + Phase-2/3/4-touched backend files are NEW-to-this-PR (never on main as this content). Add a single allowlist block IN THE SAME COMMIT:
```js
// META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline repair]
// PR #<n>. C7 is scoped to ORCH-0863 marketing; these backend touches are
// venue-claim deck-pipeline-repair scope (Phase 0 source reconcile + the
// approval→servable→scorer wiring).
const META_ORCH_1062_BACKEND_ALLOWLIST = [
  "supabase/functions/run-business-place-authoring-pipeline/index.ts",
  "supabase/functions/admin-review-venue-claim/index.ts",
  "supabase/functions/admin-review-venue-claim/reviewLogic.ts",
  "supabase/migrations/20260813000000_meta_orch_1009_sub_f_recommend_review.sql",
  "supabase/migrations/20260830000000_meta_orch_1062_sub_f_reconcile_noop.sql", // if used (see §1.3)
  "supabase/migrations/20260831000000_meta_orch_1062_approval_servable_scorer.sql",
];
```
…and spread it into the combined allowlist array (alongside `...META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST,` near line 1281). Add the corresponding `__tests__` paths the implementor creates.

## Phase 0 — Success criteria
- **SC-0.1 (LOCKED):** `shasum -a256 supabase/functions/run-business-place-authoring-pipeline/index.ts` == `a68ac42d86cd5fba8064fa479ccaa92d93bda589cbee9e5882b49c38aa810608` on the branch.
- **SC-0.2 (LOCKED):** `admin-review-venue-claim/index.ts` on the branch is byte-identical to deployed v92 (empty `diff`).
- **SC-0.3 (LOCKED):** `20260813000000_meta_orch_1009_sub_f_recommend_review.sql` present on the branch, byte-identical to the remote-applied copy; `mcp__supabase__list_migrations` shows it already on remote (so `db push` is a no-op for it).
- **SC-0.4 (LOCKED):** C7 gate green on the PR (allowlist block present + spread).
- **SC-0.5 (LOCKED):** `verify_jwt` settings preserved on reconcile: `run-business-place-authoring-pipeline`=true, `admin-review-venue-claim`=true (both are JWT-gated; neither is a webhook).

## Phase 0 — Invariants
- **I-1062-SOURCE-MATCHES-DEPLOYED (NEW):** any `supabase/functions/<fn>/index.ts` that this ORCH touches must, before its own edits, be byte-identical to the live-deployed version (sha-checked). Prevents editing a stale copy.

## Phase 0 — Test cases
| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-0.1 (happy) | Reconcile fidelity | copied authoring index.ts | sha256 == `a68ac42d…` | shell/CI gate |
| T-0.2 (happy) | Admin reconcile fidelity | copied admin-review index.ts | empty diff vs deployed v92 | shell/CI gate |
| T-0.3 (adversarial) | Stale-copy trap | implementor edits the branch's OLD Ve3 admin-review instead of reconciling first | a pre-edit sha/diff gate FAILS the PR (CI step asserting I-1062-SOURCE-MATCHES-DEPLOYED before any diff) | CI gate |

---

# PHASE 1 — Admin vetting console (defects 1062-D + 1062-E)

**Goal:** The reviewer can SEE everything needed to decide (full gallery inline + all scores + the missing fields) and can OVERRIDE a score + TWEAK submitted fields before approving.

## 1.1 Data the modal needs (exact join walk)
The claim modal currently reads `brands` + an embedded `place_pool` (only `national_phone_number, google_maps_uri`). It must additionally surface, for the linked `place_pool` row (via `brands.place_pool_id → place_pool.id`):

**Photos (all string-URL arrays):**
- `place_pool.stored_photo_urls` (deck image source; hero + gallery merged by the authoring pipeline)
- `place_pool.business_gallery_urls` (the 5–20 venue-uploaded gallery)
- `brands.cover_media_url` (cover) — already in CLAIM_SELECT.

**Scores:**
- Bouncer verdict + reason: `place_pool.is_servable` (boolean) + `place_pool.bouncer_reason` (text) + `place_pool.bouncer_validated_at`.
- Signal scores: `place_scores` rows for `place_id = place_pool.id` → list of `{ signal_id, score, scored_at }` (JOIN `place_scores` by `place_id`).
- Aesthetic score: `place_pool.photo_aesthetic_data` (jsonb 1.0–10.0; render if present, "not scored yet" otherwise).
- AI signal slice (optional, render compact): `place_pool.ai_signal_scores` (jsonb) + any existing `place_pool.ai_signal_scores_veto`.

**Missing text fields (1062-D, render if present):**
- `place_pool.price_level` / `place_pool.price_tiers`, `place_pool.website`, `brands` social columns (if any), `place_pool` amenity booleans the bouncer reads (`serves_*`, `outdoor_seating`, `good_for_groups`, …), `place_pool.business_authoring_inputs->tier1` (the submitter's pitch/description).

## 1.2 Query construction (exact — client-direct PostgREST, RLS-bound)
The admin reads via the browser Supabase client (admin session). Two safe options; **the SPEC selects Option A** (single embedded select, lowest blast radius):

**Option A — extend CLAIM_SELECT embedded select + a second scores fetch.** In `mingla-admin/src/services/adminClaimsService.js`:
- Widen the embedded `place_pool:place_pool_id ( … )` projection to add: `id, is_servable, bouncer_reason, bouncer_validated_at, stored_photo_urls, business_gallery_urls, photo_aesthetic_data, price_level, price_tiers, website, ai_signal_scores, ai_signal_scores_veto, business_authoring_status, business_authoring_inputs`, plus the amenity booleans the modal renders.
- Add `venue_category, address` and any social columns to the top-level `brands` projection if not present (they are: `venue_category`, `address` already in CLAIM_SELECT).
- Add a NEW service fn `fetchClaimScores(placePoolId)`: `supabase.from('place_scores').select('signal_id, score, scored_at').eq('place_id', placePoolId).order('score', { ascending:false })`. Called from `openDetail` when `detail.place_pool_id` is set, into a `scores` state, with its own loading state (mirror the existing `hours`/`hoursLoading` pattern at `ClaimsPage.jsx`).

**RLS prerequisite (must verify, not assume):** the admin browser session must be allowed to SELECT `place_scores` and the new `place_pool` columns. `place_scores` RLS — probe before implementing:
```sql
-- READ-ONLY probe the implementor runs first:
SELECT polname, cmd, qual FROM pg_policies WHERE schemaname='public' AND tablename='place_scores';
SELECT polname, cmd, qual FROM pg_policies WHERE schemaname='public' AND tablename='place_pool';
```
If `place_scores`/`place_pool` are not admin-SELECTable from an authed admin browser session, route the read through a NEW `SECURITY DEFINER` RPC `admin_get_claim_review_bundle(p_brand_id uuid)` (gated by `is_admin_user()`) returning a single JSON bundle (brand fields + place_pool fields + place_scores array). **This RPC is the preferred path** if the probe shows any RLS gap, because it (a) avoids loosening table RLS, (b) gives one round-trip, (c) is the natural home for the server-side admin gate. Migration version `20260831000000` (shared with Phase 4 RPC — same file).

## 1.3 Score override + field tweak (1062-E) — new write path
An admin reduce-only score-veto mechanism ALREADY exists in the deployed `admin-review-venue-claim` (the `score_vetoes` body param → `place_pool.ai_signal_scores_veto`). The SPEC formalizes and EXTENDS it:

**(a) Score override (reduce-only, pre-approve):** Reuse the existing `score_vetoes` channel. Admin enters, per signal, a `vetoed_score` (0–200) + `reason`. On approve, `admin-review-venue-claim` writes `place_pool.ai_signal_scores_veto = { "<signal_id>": { vetoed_score, original_score, reason, vetoed_at, vetoed_by } }` (shape from Sub-F migration comment). **Reduce-only invariant:** `vetoed_score` MUST be ≤ the current computed `place_scores.score` for that signal (server-rejects an increase). This prevents an admin from fabricating rank. The signal scorer (Phase 4) and the deck RPC must honor the veto — **OPEN design note:** the deployed scorer does NOT currently read `ai_signal_scores_veto` when writing `place_scores.score`; the SPEC requires the implementor to wire the veto into the post-scorer step (after Phase 4 scoring, apply `LEAST(place_scores.score, vetoed_score)` for vetoed signals) OR document that veto is display-only. **This is an open question for operator steering — see §Open Questions Q2.**

**(b) Field tweak (address / category / price, pre-approve):** A NEW `SECURITY DEFINER` RPC:
```
admin_tweak_venue_claim_fields(
  p_brand_id uuid,
  p_patch jsonb   -- whitelisted keys only
) RETURNS jsonb
```
- Auth: `auth.uid() IS NOT NULL` AND `is_admin_user()` (raise `forbidden` otherwise) — same guard as `biz_review_venue_claim`.
- Whitelist EXACTLY these keys (reject any other key with `invalid_patch_key`): `address` (→ writes `brands.address` AND `place_pool.address`), `venue_category` (→ `brands.venue_category`; if it maps to types, also `place_pool.types`/`primary_type` via the existing `_shared/mapMinglaSlugToVenueCategory.ts` mapping — but only if the venue is business-authored, never overwrite a real Google place's types), `price_level` (→ `place_pool.price_level`), `price_tiers` (→ `place_pool.price_tiers`).
- Only operates while `brands.claim_status='pending_review'` (raise `brand_not_pending_review` otherwise) so tweaks can't rewrite a live venue.
- Writes an `admin_audit_log` row (the edge wrapper does this today for reviews; for the RPC, the edge action wrapper writes the audit — see §1.4).
- Returns the updated bundle (or `{ok:true}`).

**Safe-migration note:** this RPC is `CREATE OR REPLACE FUNCTION` (no table mutation at migration time) → cannot abort on existing rows. No data probe needed for the DDL itself. The `category→types` remap path must be guarded by `IF place_pool.fetched_via='business_authored'` (read-only check inside the fn) — probe live distribution first:
```sql
SELECT fetched_via, count(*) FROM place_pool WHERE is_claimed=true GROUP BY 1;
```

## 1.4 Edge action surface for tweak
Add a `tweak_fields` action to the existing `admin-review-venue-claim` edge wrapper (it already validates admin via `is_admin_user()` RPC and writes `admin_audit_log`), OR call the new `admin_tweak_venue_claim_fields` RPC directly from `adminClaimsService.js` (client-direct, like `biz_review_venue_claim` is NOT — reviews go through the edge for email/push). **SPEC decision:** route tweak through the edge wrapper as a new `action:'tweak_fields'` (with `patch` in the body) so the audit-log + admin-gate path is shared and consistent. The edge wrapper calls `admin_tweak_venue_claim_fields` then logs `admin_audit_log` with `action='venue_claim_tweak'`.

## 1.5 UI contract (Admin Web only) — functional + UX acceptance bar
**This SPEC owns the functional contract + UX acceptance bar. The granular visual token contract (colors/spacing/typography/states) MUST be produced by `mingla-designer` before IMPLEMENT** (the admin uses Tailwind v4 + the existing `var(--color-*)` token set already present in `ClaimsPage.jsx`; reuse those tokens — no new palette). The designer pass references the existing `Modal/ModalBody/ModalFooter/SectionCard/Badge/Spinner/Button` kit + `PhotoLightbox.jsx`.

**LOCKED functional UI requirements:**
- **Gallery (LOCKED):** Replace the `cover_media_url` "Open image" text link (`ClaimsPage.jsx:358-370`) with an inline thumbnail grid of ALL photos = `[cover_media_url, ...stored_photo_urls, ...business_gallery_urls]` de-duplicated, preserving order, filtering falsy. Clicking any thumbnail opens `PhotoLightbox` (`{ photos, startIndex, onClose }`) at that index. If zero photos → render the existing empty-state copy "No photos submitted yet." Thumbnails: fixed grid, `object-cover`, lazy-loaded.
- **Scores block (LOCKED):** A "Quality signals" section showing: bouncer verdict (`is_servable ? "Passes bouncer" : "Bounced"`) + `bouncer_reason` (comma-list rendered as chips), each `place_scores` row as `{signal label}: {score rounded}` sorted desc, aesthetic score (`photo_aesthetic_data.score` if present else "Not scored"). If `place_scores` is empty (the common pre-approve case) render "Not yet scored — scoring runs on approve." (This is truthful and matches Phase 4.)
- **Missing fields (LOCKED):** Render price (`price_level`/`price_tiers`), website (as link), and the submitter pitch (`business_authoring_inputs->tier1->description`) when present; hide rows that are null (never fabricate — Constitution #9).
- **Override controls (LOCKED):** Per-signal reduce-only score input (number 0–200, with the current score as max + placeholder) + a reason field; collected into a `scoreVetoes` map passed to the approve action. A "Tweak fields" sub-form (address text, category select using existing `CAT_LABELS`, price input) that calls the `tweak_fields` action and reloads the modal on success.
- **Approve gating unchanged (LOCKED):** approve still requires `marked_called_at` and not-duplicate (`canApprove` logic at `ClaimsPage.jsx:189`). Override/tweak are available pre-approve regardless of called-state.

**UX acceptance bar (LOCKED):** all 9 states present (loading scores, error fetching scores, empty photos, empty scores, populated, submitting tweak, tweak error, offline/degraded, first-open) with Mingla-admin voice copy; no AI slop (no generic gradients/emoji icons — admin uses lucide icons + the token set); contrast inherits the existing admin dark theme tokens (already ≥4.5:1 in the kit). **OPEN (handed to implementor craft):** thumbnail grid column count responsiveness, lightbox transition feel, exact arrangement of the scores chips, micro-spacing within the existing token scale.

## Phase 1 — Success criteria
- **SC-1.1-Admin (LOCKED):** Opening a claim with photos renders an inline thumbnail grid (cover+stored+gallery, deduped); clicking a thumb opens `PhotoLightbox` at that index; Esc/arrows/click-outside close/navigate.
- **SC-1.2-Admin (LOCKED):** The modal shows bouncer verdict+reason, every `place_scores` row (or the "Not yet scored" line), and aesthetic score (or "Not scored").
- **SC-1.3-Admin (LOCKED):** Price, website, and submitter pitch render when present and are hidden (not faked) when absent.
- **SC-1.4-Admin (LOCKED):** An admin can enter a reduce-only score override per signal + reason; on approve, `place_pool.ai_signal_scores_veto` persists the `{vetoed_score, original_score, reason, vetoed_at, vetoed_by}` shape; an attempted INCREASE is server-rejected.
- **SC-1.5-Admin (LOCKED):** An admin can tweak address/category/price on a `pending_review` claim via `tweak_fields`; the write persists to `brands`+`place_pool`, an `admin_audit_log` row is written, and the modal reloads showing the new values; a non-whitelisted key is rejected with `invalid_patch_key`; a tweak on a non-`pending_review` brand raises `brand_not_pending_review`.
- **SC-1.6-Admin (LOCKED, security):** `admin_tweak_venue_claim_fields` and any new bundle RPC raise `forbidden` when called by a non-admin (verified by `is_admin_user()` server-side, not client trust).

## Phase 1 — Invariants
- **I-ADMIN-CLAIM-PHOTOS-INLINE (NEW):** the claim modal renders the full photo set inline via `PhotoLightbox`, never a bare text link.
- **I-SCORE-OVERRIDE-REDUCE-ONLY (NEW):** an admin score veto can only lower a signal's effective score, never raise it (server-enforced).
- **I-ADMIN-WRITE-GATED (NEW):** every new admin write RPC enforces `is_admin_user()` server-side.
- Preserve **Constitution #9** (no fabricated data — null rows hidden, never faked).

## Phase 1 — Test cases
| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1.1 (happy) | Gallery renders | open `Lantern & Vine` claim (7 stored + 6 gallery) | 13-deduped thumbnail grid; lightbox opens on click | Component |
| T-1.2 (happy) | Scores render pre-approve | open any pending claim (0 place_scores) | "Not yet scored — scoring runs on approve." + bouncer reason chips | Component |
| T-1.3 (happy) | Tweak persists | tweak address on a pending claim | `brands.address`+`place_pool.address` updated, audit row, modal reloads | RPC+edge+UI |
| T-1.4 (adversarial) | Score-increase attempt | veto a signal with `vetoed_score` > current score | server rejects (`score_veto_must_reduce`); no write | RPC/edge |
| T-1.5 (adversarial) | Non-admin tweak | call `admin_tweak_venue_claim_fields` with a non-admin JWT | `forbidden`, zero rows changed | RPC |
| T-1.6 (adversarial) | Tweak a live venue | tweak a `verified` brand | `brand_not_pending_review`; no write | RPC |
| T-1.7 (adversarial) | Whitelist bypass | patch `{is_servable:true}` via tweak | `invalid_patch_key`; no write (servable is NOT admin-tweakable; only the approve path flips it) | RPC |

---

# PHASE 2 — Un-bounce bridge (defect 1062-C)

**Goal:** When an admin approves (or a claimant resubmits fixed data), the bouncer RE-RUNS over the linked `place_pool` row using its real current data, so a previously-bounced place can re-qualify.

## 2.1 The bouncer truth (verified)
- `is_servable` is written by `run-bouncer` (batch, city-scoped) and by `run-business-place-authoring-pipeline` `confirm_ai_outputs` (per business-authored row). The bouncer reads `place_pool` fields only (`name, types, website, hours, photos, rating, review_count`), never claim/brand fields.
- The pure bouncer is `_shared/bouncer.ts` (`bounce(place)` → `{ is_servable, reasons }`) — already on main, imported by the authoring pipeline. **A single-row bouncer evaluation can be done in-process via `bounce()`** without invoking the batch `run-bouncer` edge function over a whole city.

## 2.2 The bridge (SPEC decision: server-side, single-row, on the approval path)
Add a single-row bouncer re-evaluation as a step inside the approval flow (Phase 4 shares this code), implemented as a `SECURITY DEFINER` helper invoked from the `admin-review-venue-claim` edge wrapper on `approve` BEFORE the servable flip:

**Mechanism (edge-side, in `admin-review-venue-claim`):**
1. On `approve` (after `biz_review_venue_claim` returns ok, before/with the go-live patch), fetch the linked `place_pool` row's bouncer-relevant fields.
2. Re-run the bouncer over the row. **Two implementation options — SPEC selects (a):**
   - **(a) Targeted single-row invocation of `run-pre-photo-bouncer` + `run-bouncer` scoped to the one place.** Verify (read live source) whether these accept a `place_ids:[uuid]` body. **Probe required (implementor):** read `run-bouncer/index.ts` + `run-pre-photo-bouncer/index.ts` request schemas. If they accept a single-place/`place_ids` filter, invoke them with `{ place_ids:[ppid] }`. This is preferred because `run-bouncer` is the canonical sole writer of `is_servable` (preserves Constitution #2 single-owner).
   - **(b) Fallback** if neither accepts a single-row filter: import `bounce()` from `_shared/bouncer.ts` into the edge wrapper, evaluate the fetched row, and let the result feed the Phase-4 servable decision (the wrapper writes `is_servable` — acceptable because the wrapper is already the go-live writer for claims).
3. **Result wiring:** the bouncer verdict gates the servable flip in Phase 4 (only flip `is_servable=true` if the re-bounce passes). On a pass, write `place_pool.bouncer_reason` (cleared/updated) + `bouncer_validated_at=now()`. On a fail, do NOT flip servable; return the bounce reasons to the admin so they know why the venue can't go live yet (and can tweak/ask-for-more).

## 2.3 Claimant-resubmit path (data-fix re-bounce)
When a claimant edits venue data through the business authoring wizard, `run-business-place-authoring-pipeline` `confirm_ai_outputs` already re-runs `bounce()` (line 1344) and writes `bouncer_reason`. **Phase 3 fixes the demotion there.** No new claimant-side trigger is needed — the existing confirm step IS the claimant re-bounce; it just must stop hard-coding `is_servable=false` (Phase 3). So the un-bounce bridge has two real entry points: (i) admin approve (this phase), (ii) the existing confirm step (Phase 3 makes it non-demoting).

## Phase 2 — Success criteria
- **SC-2.1 (LOCKED):** On `approve`, the linked `place_pool` row is re-bounced against its current data BEFORE the servable decision; the verdict + reasons are recorded in `bouncer_reason`/`bouncer_validated_at`.
- **SC-2.2 (LOCKED):** A previously-bounced venue whose current data now passes the bouncer flips to `is_servable=true` on approve (Phase 4 completes the chain); one whose data still fails does NOT flip and the admin receives the bounce reasons.
- **SC-2.3 (LOCKED):** `is_servable` writes remain single-owner-consistent: either via `run-bouncer` (option a) or via the approval wrapper that already owns claim go-live (option b) — no third uncoordinated writer is introduced.

## Phase 2 — Invariants
- **I-CLAIM-REBOUNCE-ON-APPROVE (NEW):** approve always re-evaluates the bouncer on the linked row before deciding servability; servable is never granted to a row whose current data fails the bouncer.
- Preserve **Constitution #2** (one owner per truth — `is_servable`).

## Phase 2 — Test cases
| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-2.1 (happy) | Re-bounce passes | approve `Lantern & Vine` (7+6 photos, real data) | re-bounce passes → servable flip proceeds (Phase 4) | edge+DB |
| T-2.2 (adversarial) | Re-bounce fails | approve a claim whose place has <5 real photos / missing required fields | `is_servable` NOT flipped; admin gets bounce reasons; claim_status still becomes verified OR approve is blocked — **see Open Q3** | edge+DB |
| T-2.3 (adversarial) | Stale bounce | a place bounced 60 days ago with NEW good data | re-bounce uses CURRENT data, not the stale `bouncer_reason` | edge+DB |

---

# PHASE 3 — Stop live-place demotion (defect 1062-B)

**Goal:** Claiming an ALREADY-servable Google place must not strip its servability via `confirm_ai_outputs`.

## 3.1 The bug (exact)
`run-business-place-authoring-pipeline/index.ts` `confirm_ai_outputs` (the reconciled v37 source), line **1373**, hard-codes `is_servable: false` in the `place_pool` UPDATE for EVERY business-authored confirm. The comment (lines 1369-1372) defers go-live to admin. But for a place that was ALREADY `is_servable=true` (a live Google-seeded place being claimed), this flips it OFF — and the broken approval seam never restores it.

## 3.2 The fix (exact contract)
In `confirm_ai_outputs`, replace the unconditional `is_servable: false` with a **prior-state-preserving** rule:
- Read the row's CURRENT `is_servable` (the function already `SELECT`s the place earlier — extend the select to include `is_servable` and `business_author_brand_id`/`fetched_via` if not already present).
- Decision:
  - If the row is **net-new business-authored** (`fetched_via='business_authored'` AND it was never servable, i.e. inserted with `is_servable=false`): keep `is_servable=false` (unvetted net-new rows must NOT leak onto the deck — preserves the hold-until-admin contract).
  - If the row is a **claim of a place that was already servable** (`is_servable=true` at confirm time, e.g. a live Google place): **preserve `is_servable=true`** (do NOT demote). The Tier-2 confirm enriches the listing without removing it from the deck.
- Implement as: compute `nextIsServable = (priorIsServable === true) ? true : false;` and write `is_servable: nextIsServable` instead of the literal `false`. Equivalently: only DEFAULT-false for net-new authored rows; never strip an existing true.
- The bouncer verdict computed at line 1344 (`servable`/`reasons`) still gates `business_authoring_status` (`deck_eligible` vs `needs_fix`) exactly as today — Phase 3 does NOT change the status logic, only the `is_servable` write.

**Guard against leak:** a net-new authored row that has never been admin-approved stays `is_servable=false` (unchanged). Only a row that was ALREADY `true` retains `true`. This cannot leak an unvetted net-new row because net-new rows start `false` (insert at line 573) and only become `true` via admin approve (Phase 4) — which now also re-bounces (Phase 2).

## Phase 3 — Success criteria
- **SC-3.1 (LOCKED):** Running `confirm_ai_outputs` on a claim whose linked `place_pool` row had `is_servable=true` leaves it `true` (no demotion).
- **SC-3.2 (LOCKED):** Running `confirm_ai_outputs` on a net-new business-authored row (`is_servable=false`) leaves it `false` (no leak).
- **SC-3.3 (LOCKED):** `verify_jwt=true` preserved on `run-business-place-authoring-pipeline`.

## Phase 3 — Invariants
- **I-NO-CLAIM-DEMOTION (NEW):** the business authoring confirm step never lowers a place's `is_servable` from true to false.
- **I-NET-NEW-HOLD (NEW):** a net-new business-authored row remains `is_servable=false` until admin approve (no deck leak).

## Phase 3 — Test cases
| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-3.1 (happy) | Net-new hold | confirm on a freshly-inserted authored row (`is_servable=false`) | stays false | edge+DB |
| T-3.2 (adversarial) | Live-place claim | seed a `place_pool` row `is_servable=true`, link a claim, run confirm | stays `is_servable=true` (NOT demoted) | edge+DB |
| T-3.3 (adversarial) | Status still gates | confirm a row that fails the gallery gate | `business_authoring_status='needs_fix'`, `is_servable` unchanged from prior | edge+DB |

---

# PHASE 4 — Approval makes it live (keystone; defect 1062-A)

**Goal:** On approve, the linked `place_pool` row becomes servable AND gets `place_scores` rows for its relevant signals, so it ranks and appears on the deck.

## 4.1 The real bug (verified — corrects the audit framing)
The deployed `admin-review-venue-claim` v92 ALREADY (a) flips `is_servable=true, is_active=true` and (b) invokes `run-signal-scorer`. **But (b) is broken**: it calls `admin.functions.invoke("run-signal-scorer", { body: { place_ids: [placePoolId] } })` with **NO `signal_id`**. `run-signal-scorer` returns HTTP 400 `signal_id is required` on entry (verified in deployed v160 source). The call is in a best-effort `try/catch` → silently swallowed → **`place_scores` is never produced** → the venue fails the deck's `INNER JOIN place_scores`. Proven live: `Lumen Wine Bar` has `is_servable=true` and `0` score rows.

The comment claims "the Sub-D rescore-sweep cron picks the venue up later," but the Sub-D cron (`20260808000000`):
- The per-tick stale-AI sweep only covers `(place,signal)` pairs that ALREADY have an `ai_signal_scores` slice AND drifted — a net-new venue has no AI slice → never picked up.
- The drift trigger requires `ai_signal_scores IS NOT NULL` (Guard 2) — never fires for a net-new venue.
- The quarterly backstop runs every 90 days — far too slow.

So nothing produces `place_scores` for a freshly-approved venue. **Phase 4 must fix the scorer invocation to actually score the place across its signals.**

## 4.2 The fix (exact wiring — the implementor cannot misinterpret this)
In `admin-review-venue-claim`, on `approve`, after the `is_servable=true, is_active=true` patch succeeds AND the Phase-2 re-bounce passed:

**Invoke `run-signal-scorer` ONCE PER ACTIVE SIGNAL, scoped to the single place:**
```
// pseudocode contract — NOT product code
const { data: signals } = await admin
  .from('signal_definitions')
  .select('id')
  .eq('is_active', true);                     // 16 active signals (verified)
for (const sig of signals) {
  await admin.functions.invoke('run-signal-scorer', {
    body: { signal_id: sig.id, place_ids: [placePoolId] }   // BOTH keys required
  });
}
```
- `run-signal-scorer` per-place mode (verified v160): with `{signal_id, place_ids:[ppid]}` it `SELECT`s the place WHERE `is_active=true AND is_servable=true` (so the servable flip MUST happen first), `computeScore`s for that one signal, and upserts `place_scores ON CONFLICT (place_id,signal_id)`. Eligibility gates (min_rating/min_reviews) inside `computeScore` mean ineligible signals produce score 0 / `_ineligible` and are NOT written as rank-qualifying — so looping all 16 is safe; only the signals the venue genuinely qualifies for get a deck-qualifying `place_scores` row.
- **Per-signal failures are non-fatal** but MUST be logged with the signal_id (replace the current swallow-all `catch`). Aggregate result `{ scored_signals:[…], failed_signals:[…] }` returned to the admin.
- **Ordering invariant:** the servable flip (`is_servable=true`) MUST be committed BEFORE the scorer loop, because the scorer's SELECT filters `is_servable=true`. If the flip and the loop are not in the same transaction, the flip's UPDATE must be awaited and confirmed first (it already is — the wrapper awaits the update before the scorer call).

## 4.3 Alternative implementation locus (RPC vs edge) — SPEC decision
The audit suggested fixing `biz_review_venue_claim` (the RPC). **The SPEC keeps the go-live + scorer wiring in the EDGE wrapper `admin-review-venue-claim`, NOT the RPC**, because:
- The RPC is `SECURITY DEFINER` SQL and cannot cleanly invoke an edge function (`run-signal-scorer`) — `net.http_post` from SQL is possible but the wrapper already owns this orchestration and the email/push/audit side-effects.
- The deployed v92 already locates the go-live block in the wrapper; keeping it there minimizes blast radius and matches I-1062-SOURCE-MATCHES-DEPLOYED.
- `biz_review_venue_claim` stays the source of truth for `brands.claim_status` ONLY (its current contract). **The SPEC does NOT add the servable write to the RPC.**

**However**, the migration `20260831000000_meta_orch_1062_approval_servable_scorer.sql` IS still needed for: (i) the new `admin_tweak_venue_claim_fields` RPC (Phase 1), (ii) the optional `admin_get_claim_review_bundle` RPC (Phase 1, if RLS probe demands it), (iii) any `place_scores` veto-application helper (Phase 1 §1.3 open question). The approval→scorer loop itself is pure edge code (no migration).

## 4.4 Guards (only-if)
- Only flip + score if `place_pool_id` is present and the Phase-2 re-bounce PASSED (no scoring an un-bounceable row).
- Only score if photos present is already enforced by the bouncer gallery gate (≥5 photos) inside the re-bounce — a row with <5 real photos fails the re-bounce and never reaches the scorer loop.
- Idempotent: re-approving (noop path) does not re-flip or re-score (the wrapper's `noop` guard already short-circuits).

## Phase 4 — Success criteria
- **SC-4.1 (LOCKED, keystone):** Approving a vetted claim (`Lantern & Vine` fixture) results in `place_pool.is_servable=true` AND ≥1 `place_scores` row for at least one signal the venue qualifies for, within the approve request.
- **SC-4.2 (LOCKED):** The newly-scored venue is returned by `query_servable_places_by_signal` for a qualifying signal in its bbox (deck-eligible), ranking by `place_scores.score` identically to a Google place (no badge/boost).
- **SC-4.3 (LOCKED):** The scorer loop invokes `run-signal-scorer` with BOTH `signal_id` and `place_ids` per active signal; a missing-`signal_id` call (the old bug) is gone (grep-asserted).
- **SC-4.4 (LOCKED):** Per-signal scorer failures are logged with the signal_id and do not abort the approve; the response reports `scored_signals`/`failed_signals`.
- **SC-4.5 (LOCKED):** Servable flip is committed before the scorer loop (ordering invariant).
- **SC-4.6 (LOCKED):** `verify_jwt=true` preserved on `admin-review-venue-claim` and `run-signal-scorer`.

## Phase 4 — Invariants
- **I-APPROVE-PRODUCES-SCORES (NEW):** a successful approve of a re-bounce-passing claim produces at least one `place_scores` row (servable-without-scores is a defect).
- **I-SCORER-INVOKE-HAS-SIGNAL-ID (NEW):** every `run-signal-scorer` invocation from the approval path includes a `signal_id` (the missing-signal_id 400 bug never recurs). Enforceable by a strict-grep gate asserting the call site passes `signal_id`.
- **I-NO-CLAIMED-VENUE-BOOST (PRESERVED):** approved venues rank purely by `place_scores.score`; no `is_claimed`/`claimed_by`/`business_author_brand_id` read in any deck RPC or renderer (audit-confirmed; this SPEC does not change it).

## Phase 4 — Test cases
| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-4.1 (happy, keystone) | Approve → live | mark-called + approve `Lantern & Vine` | `is_servable=true`, `place_scores` rows created for qualifying signals, venue appears in `query_servable_places_by_signal` for its bbox+signal | full stack |
| T-4.2 (happy) | Deck parity | the approved venue in solo + collab decks | renders as ordinary single-place card, ranked by score, no badge | full stack |
| T-4.3 (adversarial) | Missing-signal_id regression | inspect the approval scorer call | call includes `signal_id` (strict-grep gate); a synthetic call without it would be rejected by the scorer | CI gate + edge |
| T-4.4 (adversarial) | Servable-without-scores | approve but force a scorer 500 for all signals | `is_servable=true` but `failed_signals` reported; admin sees the venue is servable-but-unscored (degraded state surfaced, not silent) — **see Open Q1 on whether to roll back servable on total-score-failure** | edge |
| T-4.5 (adversarial) | Ineligible-everywhere venue | approve a venue that qualifies for ZERO signals (e.g. rating below all min_rating gates) | `is_servable=true`, `place_scores`=0, venue NOT on deck (correctly gated) — admin warned "scored 0 signals; venue will not appear until it qualifies" | edge+DB |
| T-4.6 (adversarial) | Re-approve idempotency | approve an already-verified claim | noop; no duplicate scoring | edge |

---

## Implementation Order (strict)
1. **Phase 0** — reconcile 3 sources onto branch (sha/diff-verified) + C7 allowlist block. (No deploy.)
2. **Migration `20260831000000_meta_orch_1062_approval_servable_scorer.sql`** — `admin_tweak_venue_claim_fields` RPC (+ optional `admin_get_claim_review_bundle` if RLS probe demands) (+ optional veto-application helper). DB-first.
3. **Phase 3** — `run-business-place-authoring-pipeline` `confirm_ai_outputs` prior-state-preserving `is_servable` (line 1373).
4. **Phase 2** — re-bounce step in `admin-review-venue-claim` approve path.
5. **Phase 4** — fix the scorer loop (signal_id per active signal) in `admin-review-venue-claim`; gate on re-bounce; report scored/failed.
6. **Phase 1** — `adminClaimsService.js` (CLAIM_SELECT widen + `fetchClaimScores`/bundle) + `ClaimsPage.jsx` (gallery + scores + missing fields + override/tweak forms), reuse `PhotoLightbox`. (Designer pass precedes this.)
7. Strict-grep gates (I-SCORER-INVOKE-HAS-SIGNAL-ID, I-APPROVE-PRODUCES-SCORES guard, I-NO-CLAIM-DEMOTION) + tests.
8. CLOSE: operator `db push` (only `20260831000000` is new; `20260813000000` already applied) → THEN deploy edge fns FROM main (`run-business-place-authoring-pipeline`, `admin-review-venue-claim`) preserving `verify_jwt:true` → verify live.

## Regression Prevention
- **Strict-grep gate** asserting every `run-signal-scorer` invoke in `admin-review-venue-claim` is accompanied by a `signal_id` key (kills the 1062-A class).
- **Strict-grep gate** asserting `confirm_ai_outputs` no longer contains a literal unconditional `is_servable: false` (the 1062-B class) — must be the prior-state-preserving expression.
- **Deno test** for the authoring confirm: prior-`true`→stays-`true`, prior-`false`→stays-`false`.
- **Protective comments** at the scorer loop and the `is_servable` decision explaining WHY (signal_id required; never demote a live claim).

---

## Open Questions (need operator steering before/at IMPLEMENT)

- **Q1 (Phase 4):** If the scorer fails for ALL signals on approve (venue servable but zero scores), should the system (a) keep `is_servable=true` and surface "servable but unscored" to the admin (degraded, self-heals on next scorer run), or (b) roll back `is_servable=false` so the venue is never servable-without-scores? SPEC default = (a) (degraded-but-honest; matches the existing best-effort posture and the Sub-D cron as a safety net), but (b) is cleaner for the I-APPROVE-PRODUCES-SCORES invariant. **Recommend (a) + a follow-up retry, but confirm.**
- **Q2 (Phase 1 §1.3):** Should an admin score-veto (`ai_signal_scores_veto`) actually LOWER the deck-ranking `place_scores.score` (requires the implementor to apply `LEAST(score, vetoed_score)` after the Phase-4 scorer run), or is the veto display-only metadata for now? The deployed scorer does NOT read the veto today. **Recommend: apply it (reduce-only) so the override is real, since 1062-E explicitly asks for "override a score."** Confirm scope.
- **Q3 (Phase 2 T-2.2):** When a re-bounce FAILS on approve, should approve (a) be BLOCKED (raise, admin must fix data first), or (b) still set `claim_status='verified'` but leave `is_servable=false` (claim approved as a business identity, venue just not deck-live yet)? SPEC default = (b) (claim approval and deck go-live are separable; the brand can still own its page). Confirm.
- **Q4 (Phase 1 RLS):** Pending the live `pg_policies` probe on `place_scores`/`place_pool` — if admin browser SELECT is blocked, the SPEC routes reads through the `admin_get_claim_review_bundle` `SECURITY DEFINER` RPC. Confirm the implementor runs the probe and chooses the RPC path if any gap exists (do not loosen table RLS).

---

## Layer-by-layer summary of the contract specified

- **DB/RPC:** new `admin_tweak_venue_claim_fields(p_brand_id,p_patch)` (`SECURITY DEFINER`, `is_admin_user()` gate, whitelisted keys, pending-only); optional `admin_get_claim_review_bundle(p_brand_id)` (RLS-gap fallback); optional veto-apply helper. `biz_review_venue_claim` UNCHANGED. Migration `20260831000000`; Sub-F migration `20260813000000` reconciled (already-applied).
- **Edge:** `admin-review-venue-claim` (reconciled to v92 then edited): re-bounce on approve (Phase 2), prior-state servable decision honored, **scorer loop fixed to pass `signal_id` per active signal** (Phase 4), `tweak_fields` action (Phase 1). `run-business-place-authoring-pipeline` (reconciled to v37 then edited): `confirm_ai_outputs` prior-state-preserving `is_servable` (Phase 3). Both keep `verify_jwt:true`. `run-signal-scorer` UNCHANGED (consumed as-is).
- **Service (admin):** `adminClaimsService.js` widened CLAIM_SELECT + `fetchClaimScores`/bundle + `tweak`/`approve(scoreVetoes)`.
- **Component (admin):** `ClaimsPage.jsx` inline gallery via `PhotoLightbox`, scores block, missing-fields, reduce-only override + tweak forms; 9 states; designer pass required for tokens.
- **CI:** C7 backend allowlist block + 3 new strict-grep invariants + Deno tests.
