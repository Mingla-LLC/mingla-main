# SPEC — ORCH-1066 [admin deck score tuner + card preview]

**Status:** BUILD-READY
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1066-[deck-score-tuner]/` on branch `ORCH-1066-deck-score-tuner`
**Author:** mingla-forensics (INVESTIGATE-THEN-SPEC)
**Supabase project ref:** `gqnoajqerqhnvulmnyvv`
**Migration version allocated:** `20260904000000` (strictly > remote max `20260902000000` AND > the in-flight ORCH-1065 sibling `20260903000000`; verified free across all worktrees + anchor)

---

## 0. Triggering problem (proven live)

`Lantern & Vine` (brand `53aaea42-0e7d-4b2a-92db-c220d78a352c`, place_pool `8b720912-a0bf-405a-88f8-773eca6f3f33`):

| field | live value |
|---|---|
| `claim_status` | `pending_review` |
| `is_servable` | `false` |
| `is_active` | `true` |
| `business_authoring_status` | `deck_eligible` |
| `place_scores` rows | **0** |
| real `stored_photo_urls` | 7 |

**Causal chain (six-field, proven):**
1. **File + line:** `supabase/functions/run-signal-scorer/index.ts:229-231` (per-place mode) and `:246-248` (city/all-cities mode) — both SELECT branches `.eq('is_active', true).eq('is_servable', true)`.
2. **Exact code:** `.from('place_pool').select(SELECT_FIELDS).eq('is_active', true).eq('is_servable', true).in('id', placeIds)`.
3. **What it does:** the scorer only ever reads servable places, so a `is_servable=false` venue is silently excluded → zero `place_scores` rows are written for it.
4. **What it should do (for the tuner path):** an admin must be able to produce the 16 per-signal scores for a pending, non-servable venue WITHOUT first approving it.
5. **Causal chain:** scores are created only at approval (`admin-review-venue-claim/index.ts:91-225 runApproveGoLive` flips `is_servable=true` THEN loops active signals into the scorer). Before approval, `place_scores` is empty → the META-ORCH-1062 score editor in `ClaimsPage.jsx:817-877` only iterates the existing `scores` array → for an unscored venue it renders the dead-end copy "Score override available after the venue is scored (on approve)." (`ClaimsPage.jsx:873-876`). Admin is stuck: cannot tune/preview/pin before approving.
6. **Verification:** live SQL probe above returns `score_rows: 0`; `ClaimsPage.jsx:684` empty branch + `:873` dead-end branch both gate on `scores.length === 0`.

**Cross-confirmation:** COMMS-0018 independently proved the same class on the post-approval side (`Lumen Wine Bar` reached `is_servable=true` with `place_scores`=0 because the live v92 scorer-invoke dropped `signal_id`). META-ORCH-1062's keystone fix (`buildScorerInvokeBody`, `admin-review-venue-claim/index.ts:75-81`) repairs the approval path; **ORCH-1066 repairs the BEFORE-approval path** (on-demand scoring) + adds tuning/pin/preview/rank. These are complementary, non-overlapping fixes.

---

## 1. Scope & non-goals

### In scope
1. **Place-keyed score set RPC** — `admin_set_place_signal_score(p_place_pool_id, p_signal_id, p_score, p_reason)` — manual 0–200 dial for ANY servable-or-claimable place (Google-seeded + claimed), not just brands.
2. **Pin-to-top RPC** — `admin_pin_place_to_top(p_place_pool_id, p_signal_id, p_radius_m)` — sets this place's score for a signal just above the current local #1 within radius (computed, not hardcoded 200; cap 200).
3. **Deck-rank read RPC** — `admin_place_deck_rank(p_place_pool_id, p_signal_id, p_radius_m)` — returns `{rank, total, score, top_score, is_servable, gated_reason}`.
4. **On-demand scoring** for a non-servable pending venue (the Lantern & Vine fix) — chosen mechanism in §3.4.
5. **Venue Claims modal upgrade** (`ClaimsPage.jsx`) — "Score this venue now" button + editor that exposes ALL 16 signals (set / pin / preview) even from zero.
6. **Standalone tuner page** (`mingla-admin`, new nav entry) — search/pick any servable venue → per-signal dials + pin-to-top + deck-card preview + rank readout.
7. **Deck-card web replica** — faithful React-web replica of the consumer swipe card front face.

### Non-goals (explicit)
- **No consumer mobile / native code.** The real deck still gates on `is_servable=true`; for a non-servable venue the preview is **projected** ("how it WILL render once approved"). Surfacing is the approval path's job (META-ORCH-1062), tested separately by Seth.
- **No change to `query_servable_places_by_signal`** serving RPC (read-only mirror it; do not edit it).
- **No removal of the META-ORCH-1062 brand-keyed `admin_apply_score_override`** — it stays for the legacy claim approval channel; the tuner uses the new place-keyed RPC.
- **No new deck-ranking authority.** `place_scores.score` remains the sole rank key (Constitution #2). All three write RPCs UPSERT `place_scores` exactly like the 1062 path.
- **No change to the bouncer or `is_servable` write authority.** On-demand scoring must NOT flip `is_servable` (that authority stays with `admin-review-venue-claim` approval).

### Assumptions
- 16 active signals in `signal_definitions` (verified live: brunch, casual_food, creative_arts, drinks, fine_dining, flowers, groceries, icebreakers, lively, movies, nature, picnic_friendly, play, romantic, scenic, theatre).
- `place_scores` CHECK `score 0–200` (verified: `place_scores_score_range`), UNIQUE `(place_id, signal_id)` (verified: `place_scores_unique_place_signal`).
- `is_admin_user()` SECURITY DEFINER gate exists and is the admin authority (used by all 1062 RPCs).

---

## 2. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behaviour / files / parity |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NO | Real deck unchanged; serving RPC untouched. Preview is an admin-only projection. No native code. |
| 2 | Consumer Android (`app-mobile/`) | NO | Same as iOS. |
| 3 | Buyer/anon Web (`mingla-business/`) | NO | No buyer-facing surface; venue scoring is internal. |
| 4 | Business iOS (`mingla-business/`) | NO | Business app does not score/rank venues; admin-only. |
| 5 | Business Android (`mingla-business/`) | NO | Same. |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | Primary surface. Claims modal upgrade (`ClaimsPage.jsx`) + new standalone tuner page + new service fns + nav wiring. Parity automatic (single React-web codebase). |
| 7 | Business Web preview | NO | N/A. |

**Backend (shared, surface-agnostic):** new migration `20260904000000` (4 RPCs) + on-demand scoring mechanism (§3.4) + ORCH-0863 strict-grep allowlist (COMMS-0002). Backend parity is automatic (single DB / edge function).

Because the only UI surface is Admin Web (single codebase), there is NO manual cross-platform parity to split — all success criteria are single-surface.

---

## 3. Layer specification

### 3.0 Authority & doc citations (COMMS-0003)

All 4 RPCs are `SECURITY DEFINER`, admin-gated server-side via `is_admin_user()`, `SET search_path TO 'public', 'pg_temp'`, `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated`. This matches the META-ORCH-1062 RPC pattern exactly.

Cited Supabase docs (inline, per COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED):
- Database Functions (SECURITY DEFINER + `search_path` hardening): https://supabase.com/docs/guides/database/functions
- Function search_path mutable lint (0011): https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0011_function_search_path_mutable
- RLS & SECURITY DEFINER interaction: https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw
- Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Edge Functions (`verify_jwt`, invoke): https://supabase.com/docs/guides/functions

---

### 3.1 🔒 RPC #1 — `admin_set_place_signal_score` (place-keyed manual dial)

**File:** new migration `supabase/migrations/20260904000000_orch_1066_deck_score_tuner_rpcs.sql`.

```
CREATE OR REPLACE FUNCTION public.admin_set_place_signal_score(
  p_place_pool_id uuid,
  p_signal_id     text,
  p_score         numeric,
  p_reason        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
```

**Contract:**
- Guard order (each `RAISE EXCEPTION` aborts → see data probes §3.5):
  1. `auth.uid() IS NULL` → `not_authenticated`.
  2. `NOT is_admin_user()` → `forbidden`.
  3. `p_signal_id` null/empty → `signal_id_required`.
  4. `p_score IS NULL` → `score_required`.
  5. `p_score < 0 OR p_score > 200` → `score_out_of_range`.
  6. place_pool row missing (`SELECT 1 FROM place_pool WHERE id=p_place_pool_id`) → `place_not_found`.
  7. signal not active (`signal_definitions WHERE id=p_signal_id AND is_active=true`) → `unknown_or_inactive_signal`.
- Read current `place_scores.score` + `signal_version_id` for `(p_place_pool_id, p_signal_id)` → audit "original".
- `signal_version_id` falls back to `signal_definitions.current_version_id` when no prior row (mirrors `admin_apply_score_override:335-338`).
- **UPSERT `place_scores`** `ON CONFLICT (place_id, signal_id) DO UPDATE SET score, contributions = place_scores.contributions || EXCLUDED.contributions, scored_at = now()`. `contributions` records `{_admin_set:1, _original_score, _set_by: auth.uid(), _reason, _orch:'1066'}`.
- **Also write the audit slice** on `place_pool.ai_signal_scores_veto` keyed by `p_signal_id` → `{vetoed_score, original_score, reason, vetoed_at, vetoed_by}` (mirrors 1062 so the audit shape is uniform; the tuner override and the claim override are indistinguishable in audit).
- Return `{ok:true, signal_id, original_score, new_score, direction:'created'|'raised'|'lowered'|'unchanged'}`.

**Why place-keyed not brand-keyed:** the tuner targets ANY place_pool row (Google-seeded places have no brand). The 1062 RPC requires a brand + `place_pool_id` link; this one takes the place directly.

**Grants:** `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`

---

### 3.2 🔒 RPC #2 — `admin_pin_place_to_top` (computed pin, no hardcoded 200)

```
CREATE OR REPLACE FUNCTION public.admin_pin_place_to_top(
  p_place_pool_id uuid,
  p_signal_id     text,
  p_radius_m      double precision DEFAULT 16000
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
```

**Contract:**
- Same guards 1-7 as RPC #1 (minus score guards). Additional: `p_radius_m IS NULL OR p_radius_m <= 0` → `invalid_radius`.
- Read this place's `lat,lng` from `place_pool`. If `lat/lng` null → `place_missing_geo`.
- **Compute the local max servable score** for this signal within radius, EXCLUDING this place, using the SAME gates + Haversine the serving RPC uses (mirror `query_servable_places_by_signal` WHERE clause exactly — `is_servable=true AND is_active=true AND stored_photo_urls present AND not '__backfill_failed__' AND haversine <= radius`):
```
SELECT max(ps.score) INTO v_local_max
FROM place_pool pp JOIN place_scores ps ON ps.place_id=pp.id AND ps.signal_id=p_signal_id
WHERE pp.is_servable=true AND pp.is_active=true
  AND pp.id <> p_place_pool_id
  AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls,1) > 0
  AND NOT (array_length(pp.stored_photo_urls,1)=1 AND pp.stored_photo_urls[1]='__backfill_failed__')
  AND (6371000.0*2.0*ASIN(SQRT( POWER(SIN(RADIANS(pp.lat - v_lat)/2.0),2)
      + COS(RADIANS(v_lat))*COS(RADIANS(pp.lat))*POWER(SIN(RADIANS(pp.lng - v_lng)/2.0),2) ))) <= p_radius_m;
```
- **Target score** = `LEAST(200, coalesce(v_local_max, 0) + 1)` (just above #1; capped at 200). When the radius is empty (`v_local_max IS NULL`) → target `1` (any positive score makes it #1) — but to make a freshly-pinned venue clearly rank, use `LEAST(200, coalesce(v_local_max,199) + 1)` so an empty radius pins at **200** (top by construction). **Locked rule:** `v_target = CASE WHEN v_local_max IS NULL THEN 200 ELSE LEAST(200, v_local_max + 1) END`.
- UPSERT `place_scores` with `v_target` (same UPSERT + audit-slice + contributions `{_admin_pin:1, _local_max, _radius_m, _pinned_by, _orch:'1066'}` as RPC #1).
- Return `{ok:true, signal_id, local_max:v_local_max, new_score:v_target, capped:(v_target=200 AND v_local_max>=200), pinned:true}`.

**Edge case (`v_local_max = 200`):** if the incumbent #1 is already at the 200 cap, `LEAST(200, 201)=200` → tie. Tie-break in the serving RPC is `review_count DESC NULLS LAST`. Return `capped:true` + `tie_warning:true` so the UI tells the admin "Already at max; tie broken by review count — raise review_count or accept tie." (No silent failure — Constitution #5.)

---

### 3.3 🔒 RPC #3 — `admin_place_deck_rank` (read-only rank readout)

```
CREATE OR REPLACE FUNCTION public.admin_place_deck_rank(
  p_place_pool_id uuid,
  p_signal_id     text,
  p_radius_m      double precision DEFAULT 16000
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
```

**Contract:**
- Guards 1-2 (auth + admin) + 6-7 (place exists, signal active) + `invalid_radius`.
- Read this place's `score` (from `place_scores`), `is_servable`, `is_active`, geo.
- Compute, within radius using the EXACT serving-RPC gates + Haversine:
  - `total` = count of servable+scored places for this signal in radius (INCLUDING this place IFF it is itself servable+scored+photo'd).
  - `top_score` = max score in that set.
  - `rank` = `1 + count(servable places in radius with ps.score > this place's score)` — **projected** rank: computed as if this place WERE servable (so a pending venue sees where it WOULD land). When this place's `score IS NULL` (unscored) → `rank=null`.
- `gated_reason`: a text array of the serving gates this place currently FAILS (e.g. `['not_servable']`, `['no_real_photos']`, `['unscored_for_signal']`) so the admin understands why the projection ≠ live. Empty array = would surface live.
- Return `{rank, total, score, top_score, is_servable, is_active, projected:(NOT is_servable), gated_reason}`.

**Projected semantics (LOCKED):** because the real deck gates on `is_servable=true`, for a non-servable venue `rank`/`total` are computed by treating THIS place as servable while keeping the rest of the gate intact — i.e. "where it would rank the instant it's approved." The UI must label this "Projected rank (goes live on approve)" whenever `projected=true`.

---

### 3.4 🔒 On-demand scoring mechanism (the Lantern & Vine fix) — CHOSEN: option (c) variant — RPC-seed all 16 via #1, no servable flip

**Decision:** Do NOT modify `run-signal-scorer`'s `is_servable` gate (it is the bouncer's contract; loosening it risks scoring junk places and is a cross-ORCH hazard). Do NOT flip `is_servable` for a pending venue (that authority is the approval path's). Instead:

**`admin_score_place_preview(p_place_pool_id, p_signal_id DEFAULT NULL)` RPC** (RPC #4 in the same migration) — a SECURITY DEFINER function that computes rule-based scores for a place REGARDLESS of `is_servable`, by reusing the SAME scoring inputs the scorer reads, and UPSERTs `place_scores`. Two sub-paths:

- **Path A (preferred, deterministic + cheap):** the RPC computes scores in-database for the requested signal(s) using a SQL port of the rule path is NOT required — instead the RPC simply ensures a `place_scores` ROW EXISTS for each of the 16 active signals at a **neutral seed score** (LOCKED default `100`, mid-band) when none exists, writing `contributions={_admin_seed:1, _orch:'1066', _note:'preview_seed_pending_score'}`. This gives the admin 16 editable dials immediately (then they tune/pin each). This is the **"manually seed then tune"** model — operator-confirmed option (b)+(c) blend.
- **Path B (richer, optional follow-up — NOT required for ORCH-1066 close):** a new edge action `admin-score-place-preview` that calls the existing `_shared/signalScorer.ts computeScore` against the place row WITHOUT the servable gate, producing real rule-based scores. Spec'd here as the future upgrade; **ORCH-1066 ships Path A** (seed-then-tune) because it fully unblocks Lantern & Vine with zero scorer changes and zero risk to the bouncer contract.

**`admin_score_place_preview` contract (Path A, the shipped one):**
```
CREATE OR REPLACE FUNCTION public.admin_score_place_preview(
  p_place_pool_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
```
- Guards 1-2 (auth+admin) + 6 (place exists).
- For EACH active signal (`SELECT id, current_version_id FROM signal_definitions WHERE is_active=true`): `INSERT INTO place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at) VALUES (p_place_pool_id, sig.id, 100, jsonb_build_object('_admin_seed',1,'_orch','1066'), sig.current_version_id, now()) ON CONFLICT (place_id, signal_id) DO NOTHING` — `DO NOTHING` so it NEVER overwrites a real computed score or a prior admin tweak (idempotent, safe to click twice).
- Return `{ok:true, seeded_count, existing_count, total_signals:16}`.
- **Does NOT touch `is_servable`/`is_active`** — the venue stays `pending_review`, `is_servable=false`. The seeded scores live in `place_scores`; the preview + rank RPCs read them; the real deck still excludes the venue until approval. This is the **projected** preview contract.

**Why neutral 100, not 0:** 0 would rank the venue dead-last and make the preview useless; 100 (mid-band) gives a believable starting card the admin then tunes per signal. Seed value is LOCKED at 100; admin immediately overrides via RPC #1/#2.

**Grants for all 4 RPCs:** `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`.

---

### 3.5 🔒 Data probes for abort-capable guards (mandatory)

Every guard that can `RAISE EXCEPTION` and abort was validated against live data:

| Guard | Probe result |
|---|---|
| `place_not_found` | Lantern & Vine place `8b720912-...` exists → guard passes for the real target. |
| `unknown_or_inactive_signal` | 16 signals all `is_active=true` (verified) → no active-signal false-abort. |
| `score_out_of_range` | CHECK `place_scores_score_range` is `0–200` (verified) → RPC clamp matches DDL; UPSERT never violates CHECK. |
| `place_missing_geo` (pin) | Lantern & Vine `lat=35.7989165, lng=-78.7381279` (non-null) → pin computable. |
| `ON CONFLICT (place_id, signal_id)` | UNIQUE constraint `place_scores_unique_place_signal` exists (verified) → UPSERT conflict target valid. |
| seed `DO NOTHING` idempotency | Lantern & Vine has 0 score rows → first call seeds 16; second call seeds 0 (all conflict) → idempotent. |

No DDL table mutation at migration time (all `CREATE OR REPLACE FUNCTION`) → no abort-on-existing-rows risk for the migration itself.

---

### 3.6 🔒 Edge function layer

**No new edge function for Path A.** All 4 RPCs are called directly from `mingla-admin` via `supabase.rpc(...)` (admin React web uses direct Supabase calls — established pattern; the 1062 score editor routes through the edge wrapper only to share the audit-log + push path, but the wrapper is OPTIONAL).

**DECISION (LOCKED):** route the 3 write RPCs (#1 set, #2 pin, #4 seed) through the EXISTING `admin-review-venue-claim` edge function via NEW actions `set_place_score`, `pin_place_score`, `score_place_preview` — mirroring the existing `score_override`/`tweak_fields`/`add_feedback` action pattern (`admin-review-venue-claim/index.ts:264-374`) so each write gets an `admin_audit_log` row server-side (Constitution: admin writes audited). The read RPC #3 (`admin_place_deck_rank`) is called DIRECTLY via `supabase.rpc` (read-only, no audit needed).

- `verify_jwt`: **PRESERVE** the existing `admin-review-venue-claim` config (it validates auth header + `is_admin_user` in-body at `:233-248`). Do NOT change `verify_jwt`.
- New action branches return early (like `add_feedback` at `:264`), each: validate body → call the RPC through `userClient.rpc` (so `is_admin_user()` sees `auth.uid()`) → insert `admin_audit_log` via service-role client → return `{ok, result}`.
- Audit actions: `place_score_set`, `place_score_pin`, `place_score_preview_seed`, `target_type:'place_pool'`, `target_id:p_place_pool_id`.
- **COMMS-0002:** `admin-review-venue-claim/index.ts` already exists on main (not new) → editing it does NOT trip the ORCH-0863 C7 `no-new-backend-files` gate. The NEW migration file `20260904000000_orch_1066_deck_score_tuner_rpcs.sql` IS new → it MUST be added to a `ORCH_1066_BACKEND_ALLOWLIST` array in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit (per COMMS-0002, the pattern at lines 250-280). If a new migration test file is added under `supabase/migrations/__tests__/`, allowlist it too.

---

### 3.7 🔒 Service layer (`mingla-admin/src/services/`)

**Extend `adminClaimsService.js`** (for the claims-modal path) with:
- `setPlaceSignalScore(placePoolId, signalId, score, reason)` → invoke `admin-review-venue-claim` action `set_place_score`.
- `pinPlaceToTop(placePoolId, signalId, radiusM)` → action `pin_place_score`.
- `scorePlacePreview(placePoolId)` → action `score_place_preview` (the "Score this venue now" button).
- `getPlaceDeckRank(placePoolId, signalId, radiusM)` → DIRECT `supabase.rpc('admin_place_deck_rank', {...})`.

**New service `mingla-admin/src/services/deckTunerService.js`** (for the standalone tuner): re-exports the 4 fns above (placed in claims service to avoid duplication; the tuner imports from `adminClaimsService.js`) PLUS:
- `searchServableVenues(query, limit=20)` → query `place_pool` for `is_servable=true` rows matching name/address (reuse the existing place-pool search pattern; LIMIT 20).
- `getPlaceScores(placePoolId)` → query `place_scores` for the place (all signals) joined with `signal_definitions.label`, so the tuner shows all 16 with current values.
- `getPlacePreviewCard(placePoolId)` → query the place_pool fields the card replica needs (name, stored_photo_urls, rating, price_level/price_tiers, primary_type, types, lat, lng).

**Error contract:** every service fn throws on `error` or `data.error` (mirrors `overrideClaimScore:134-136`). No silent swallow.

---

### 3.8 🎨/🔒 Component layer — Venue Claims modal upgrade (`ClaimsPage.jsx`)

**🔒 LOCKED (functional):**
1. Add a **"Score this venue now"** button inside the `isPending` "Admin adjustments" block (`ClaimsPage.jsx:760-878`), shown when `scores.length === 0` (replaces the dead-end copy at `:873-876`). On click → `scorePlacePreview(detail.place_pool_id)` → on success, re-fetch the bundle (`getClaimReviewBundle`) so all 16 seeded scores load → toast "Seeded 16 scores — tune below."
2. **Editor exposes ALL 16 active signals**, not just existing rows. After seeding, the editor maps over the 16 `signal_definitions` (fetch once, cache) UNION the `scores` array, so every signal has a dial even at score 0/seed-100. For each signal row: numeric input (0–200), reason text, **Set** (→ `setPlaceSignalScore`), **Pin to top** (→ `pinPlaceToTop`, default radius 16000 m), and a live **rank chip** (→ `getPlaceDeckRank`) showing "#N of M (projected)".
3. Each write re-fetches the bundle + rank so the displayed values are authoritative (no optimistic drift).
4. **Card preview** — embed the `<DeckCardPreview>` replica (§3.10) fed by the bundle's place_pool fields, with a rank readout strip below it ("Ranks #N of M for {category} within 16 km — projected, goes live on approve").
5. Preserve the existing brand-keyed `overrideClaimScore` path? **NO** — the modal switches to the place-keyed RPCs for set/pin (richer + works from zero). The brand-keyed RPC stays in the codebase for the approval `score_vetoes` channel but the UI no longer calls `overrideClaimScore` for tuning. (Document this in the implementation report; do not delete the RPC.)

**🎨 OPEN (craft, handed to implementor + mingla-designer):** the exact layout of the 16-signal editor (grid vs list, collapse/expand, sort by score desc), the rank-chip micro-styling, the seed-button affordance, and the preview card placement within the modal. Must obey admin design tokens (`var(--color-text-*)`, `var(--color-brand-*)`, existing `Button`/`Badge`/`Spinner` primitives) and the 9 states.

**9 states (LOCKED copy):** loading ("Loading scores…" — exists), error ("Couldn't load scores: {e}" — exists), empty/unscored ("Not yet scored — tap Score this venue now." — REPLACES dead-end), seeded/populated (16 dials + preview), submitting (button → Spinner, inputs disabled — `acting` flag exists), offline (toast "You're offline — couldn't save."), first-time (same as unscored), returning (scores load from bundle), degraded (rank chip shows "Rank unavailable" if `admin_place_deck_rank` errors, never a fake number — Constitution #9).

---

### 3.9 🎨/🔒 Component layer — Standalone tuner page (`DeckScoreTunerPage.jsx`)

**New file:** `mingla-admin/src/pages/DeckScoreTunerPage.jsx`.

**🔒 Nav wiring (exact):**
1. `mingla-admin/src/App.jsx` — add `"deck-tuner": DeckScoreTunerPage` to the `PAGES` map (`App.jsx:34-51`) + the import (`App.jsx:11-24`).
2. `mingla-admin/src/lib/constants.js` — add `{ id: "deck-tuner", label: "Deck tuner", icon: "SlidersHorizontal" }` to the `NAV_GROUPS` items array (after the `signals`/`place-intelligence-trial` entries, `constants.js:134-135`, since it's a serving/ranking tool). `NAV_ITEMS` is derived via `flatMap` so the sidebar + command palette pick it up automatically (`constants.js:153`).
3. Icon `SlidersHorizontal` is a lucide-react icon (admin already uses lucide). Verify it's imported in the icon resolver the sidebar uses; if the sidebar maps icon strings, add `SlidersHorizontal` to that map.

**🔒 LOCKED (functional):**
1. **Venue search** — text input → `searchServableVenues(query)` → result list (name + address + city). Pick one → loads its scores + preview.
2. **Per-signal panel** — all 16 signals as rows: label, current score (mono), numeric 0–200 input, reason, **Set** + **Pin to top** + per-signal **rank chip** "#N of M". Radius selector (default 16 km; options 8/16/40 km) feeds pin + rank.
3. **Deck-card preview** — `<DeckCardPreview>` (§3.10) for the selected venue + a rank readout strip per the currently-focused signal.
4. **Servable-only:** the tuner search returns ONLY `is_servable=true` venues (already-live), so its preview/rank are LIVE (not projected) — `projected=false`. (Pending non-servable venues are tuned in the Claims modal, where the projection label applies.)
5. Empty state (no venue picked): "Search a live venue to tune its category scores." Loading, error, submitting, offline, degraded states as §3.8.

**🎨 OPEN:** page layout (search bar placement, two-column venue-list + tuner, sticky preview), signal-row density, radius-selector styling — implementor + designer craft within admin tokens.

---

### 3.10 🔒/🎨 Deck-card web replica — `<DeckCardPreview>`

**New file:** `mingla-admin/src/components/DeckCardPreview.jsx`. A faithful React-web replica of the consumer swipe-card FRONT FACE (`app-mobile/src/components/SwipeableCards.tsx:2605-2656`).

**🔒 LOCKED — fields + source (exact parity with the native front face):**

| Card element | Native source (SwipeableCards) | Web replica source | Render rule |
|---|---|---|---|
| Hero image | `currentRec.image` (`CardHeroImage`, `:2605`) | `place_pool.stored_photo_urls[0]` | `<img>` cover-fit; if missing/`__backfill_failed__` → neutral dark placeholder (NO fake image, Constitution #9). |
| Title | `currentRec.title` (`:2625`) | `place_pool.name` | Always shown; fallback "Experience" only if name null. |
| One-liner | `currentRec.oneLiner`, `numberOfLines={1}` (`:2626-2627`) | `place_pool.generative_summary` (or null) | Single line, ellipsis; hidden if null. |
| Distance badge | `currentRec.distance`, hidden if null (`:2634`) | N/A in admin (no user location) | **Omit** — admin has no buyer geo; do NOT fabricate a distance (Constitution #9). |
| Travel-time badge | `currentRec.travelTime`, hidden if null (`:2640`) | N/A | **Omit** — same reason. |
| Rating badge | `currentRec.rating`, hidden if null or ≤0, star icon, `toFixed(1)` (`:2645-2647`) | `place_pool.rating` | Star icon + `rating.toFixed(1)`; HIDDEN if null or ≤0 (exact native rule). |
| Category pill | `getReadableCategoryName(currentRec.category)` (`:2656`) | the tuner's currently-focused `signal_id` → its `signal_definitions.label` (the category being tuned) | Always shown. |
| Price tier | `currentRec.priceTier` → `tierLabel` (`priceTiers.ts`) | `place_pool.price_tiers`/`price_level` → reuse the SAME `priceTiers` mapping if portable, else `price_level` text | Shown if present; hidden if null. |

**🔒 Distance/travel omission is LOCKED and intentional:** the admin preview has no buyer origin, so those badges are omitted rather than faked. A one-line caption under the card states "Distance & travel time appear on the buyer's device based on their location." so the admin understands the difference (prevents a "the card is missing fields" false bug report).

**🎨 OPEN (visual craft — REQUIRES a `mingla-designer` pass):** the card MUST visually evoke the native glass card (rounded corners, hero with gradient scrim, badge chips, title/oneliner overlay at bottom) at admin-web scale (~320–360px wide). The implementor MUST invoke `mingla-designer` for the pixel-precise token-level visual contract (radii, scrim gradient, badge styling, type scale, light+dark, contrast ratios, the 9 states of the card itself: loading skeleton, no-photo, populated). This SPEC owns the functional field contract + the no-fabrication rule; the designer owns the visual fidelity. **Do not ship the preview with visuals left to implementor guesswork.**

**No-AI-slop ban:** no generic purple gradients, no stock/AI imagery, no emoji icons, no decorative glows. The hero is the venue's real photo or an honest neutral placeholder. References examined for fidelity: the live consumer deck card itself (`SwipeableCards.tsx` front face) is the single source of truth — the replica matches IT, not a generic "card" aesthetic.

---

## 4. Success criteria (observable / testable / unambiguous)

- **SC-1:** Opening Lantern & Vine's claim modal shows a "Score this venue now" button (because `place_scores`=0). Clicking it calls `admin_score_place_preview` and the modal then shows 16 editable signal dials (all at seed 100). Verified by: 16 `place_scores` rows for place `8b720912-...` after click; `DO NOTHING` re-click adds 0.
- **SC-2:** Setting `romantic=180` via the modal dial calls `admin_set_place_signal_score` → `place_scores.score` for `(8b720912, romantic)` = 180; `ai_signal_scores_veto.romantic` audit slice written; `admin_audit_log` row `action='place_score_set'`.
- **SC-3:** "Pin to top" for `drinks` within 16 km sets this place's `drinks` score to `LEAST(200, local_max+1)` (NOT a hardcoded 200 unless the radius is empty or incumbent is at 200). Verified: query local max for `drinks` in radius, confirm new score = that+1 (or 200 cap with `capped:true`).
- **SC-4:** The rank readout for a tuned signal shows "#N of M" where N/M match an independent SQL count using the serving-RPC gates. For Lantern & Vine (non-servable) the chip says "projected".
- **SC-5:** The `<DeckCardPreview>` renders the venue's real `stored_photo_urls[0]` hero, name, rating (hidden because Lantern & Vine — check its rating; if ≤0/null, badge hidden), category pill = focused signal label, and OMITS distance/travel-time with the explanatory caption.
- **SC-6:** Standalone tuner page reachable at `#/deck-tuner` from the sidebar + command palette; searching returns only `is_servable=true` venues; picking one loads scores + a LIVE (non-projected) rank.
- **SC-7:** All 4 RPCs reject a non-admin caller with `forbidden` and an anon caller with `not_authenticated`; out-of-range score → `score_out_of_range`; inactive/unknown signal → `unknown_or_inactive_signal`.
- **SC-8:** `admin_apply_score_override` (the 1062 brand-keyed RPC) is unchanged and still callable; the approval `score_vetoes` channel still works.
- **SC-9:** Migration version `20260904000000` applies cleanly on top of remote `20260902000000` after ORCH-1065's `20260903000000` lands (or independently if 1066 merges first — the two don't collide; verify ordering in CI migration-baseline).
- **SC-10:** ORCH-0863 strict-grep C7 passes (new migration in `ORCH_1066_BACKEND_ALLOWLIST` same commit).

---

## 5. Invariants

**Preserved:**
- **I-PLACE-SCORES-SOLE-WRITER (Constitution #2):** `place_scores.score` is written by `run-signal-scorer` + the META-ORCH-1062 override + (NEW) the ORCH-1066 RPCs. All four UPSERT with `ON CONFLICT (place_id, signal_id)` — no second authority, no divergent shape. The tuner RPCs write `contributions` with `_admin_*` provenance keys so the source of every score is auditable.
- **I-SCORER-INVOKE-HAS-SIGNAL-ID (META-ORCH-1062):** untouched — ORCH-1066 does not modify `run-signal-scorer` or its invoke.
- **I-ADMIN-WRITE-GATED:** all 4 RPCs `is_admin_user()`-gated; the 3 write actions also audit-logged via the edge wrapper.
- **Serving-RPC determinism (I-COLLAB-DECK-DETERMINISM):** `query_servable_places_by_signal` is read-only-mirrored, never edited; rank computation reuses its exact WHERE+ORDER gates so the projection matches reality.
- **Constitution #9 (no fabricated data):** distance/travel-time OMITTED (not faked) in the preview; missing hero → honest placeholder; missing rank → "unavailable" not 0.

**New (DRAFT → ACTIVE on CLOSE):**
- **I-1066-PIN-COMPUTED-NOT-HARDCODED:** `admin_pin_place_to_top` MUST compute the local max within radius and set `LEAST(200, local_max+1)`; the only path to a literal 200 is an empty radius or an incumbent already at 200. A hardcoded `200` literal as the pin target is a violation. Gate: a strict-grep or migration test asserting the function body computes `max(ps.score)` before setting.
- **I-1066-PREVIEW-PROJECTED-FOR-NONSERVABLE:** when `is_servable=false`, the rank RPC returns `projected:true` and the UI labels it; the preview never claims a non-servable venue is live.
- **I-1066-ONDEMAND-NO-SERVABLE-FLIP:** `admin_score_place_preview` MUST NOT write `is_servable`/`is_active`. Gate: migration test asserts the function touches only `place_scores`.

---

## 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Seed unscored venue | `admin_score_place_preview(8b720912)` | 16 `place_scores` rows @100; `{seeded_count:16}` | DB |
| T-02 | Seed idempotent | call T-01 twice | 2nd: `seeded_count:0, existing_count:16` | DB |
| T-03 | Set score happy | `set_place_signal_score(place, 'romantic', 180)` | row=180, direction='raised', audit slice + audit_log | Full stack |
| T-04 | Set out of range | score=250 | `score_out_of_range`, no write | DB guard |
| T-05 | Set inactive signal | signal='nonexistent' | `unknown_or_inactive_signal` | DB guard |
| T-06 | Set non-admin | non-admin JWT | `forbidden` | DB guard |
| T-07 | Pin computed | `pin_place_to_top(place,'drinks',16000)` with local_max=140 | new score=141, `{local_max:140,new_score:141,capped:false}` | DB |
| T-08 | Pin empty radius | radius with no other servable places | new score=200, `{local_max:null,new_score:200}` | DB |
| T-09 | Pin incumbent at cap | local_max=200 | new score=200, `{capped:true, tie_warning:true}` | DB |
| T-10 | Pin missing geo | place with null lat/lng | `place_missing_geo` | DB guard |
| T-11 | Rank non-servable | `place_deck_rank(8b720912,'romantic',16000)` | `{rank:N, projected:true, gated_reason:['not_servable']}` | DB |
| T-12 | Rank unscored signal | place seeded only some signals | `rank:null` for unscored signal | DB |
| T-13 | Rank matches serving | compare RPC rank to independent serving-gate SQL count | identical N/M | DB |
| T-14 | Modal seed button | unscored claim → click "Score this venue now" | 16 dials appear, no dead-end copy | Component |
| T-15 | Preview omits distance | render `<DeckCardPreview>` | no distance/travel badge; caption present; real hero | Component |
| T-16 | Preview hides null rating | venue rating null/≤0 | rating badge absent | Component |
| T-17 | Tuner search servable-only | search returns rows | every row `is_servable=true` | Service |
| T-18 | Tuner live rank | pick servable venue | `projected:false` | Full stack |
| T-19 | 1062 RPC untouched | call `admin_apply_score_override` | still works, brand-keyed | DB |
| T-20 | Migration ordering | apply `20260904000000` after `20260903000000` | clean, no collision | Migration |
| T-21 | strict-grep C7 | PR with new migration | passes via `ORCH_1066_BACKEND_ALLOWLIST` | CI |

---

## 7. Implementation order

1. **Migration** `supabase/migrations/20260904000000_orch_1066_deck_score_tuner_rpcs.sql` — 4 RPCs (`admin_set_place_signal_score`, `admin_pin_place_to_top`, `admin_place_deck_rank`, `admin_score_place_preview`) with grants + comments + doc-URL citations.
2. **strict-grep allowlist** — add `ORCH_1066_BACKEND_ALLOWLIST` to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (same commit as #1, COMMS-0002).
3. **Migration test** `supabase/migrations/__tests__/orch_1066_deck_score_tuner_rpcs.test.sql` — pin-computed, no-servable-flip, guard asserts (allowlist it too).
4. **Edge wrapper actions** — add `set_place_score`/`pin_place_score`/`score_place_preview` branches to `supabase/functions/admin-review-venue-claim/index.ts` (existing file, preserve `verify_jwt`).
5. **Services** — extend `adminClaimsService.js` + `getPlaceDeckRank`; new `deckTunerService.js`.
6. **`<DeckCardPreview>`** — new component; invoke `mingla-designer` for its visual contract FIRST.
7. **Claims modal upgrade** — `ClaimsPage.jsx` seed button + 16-signal editor + embedded preview + rank chips.
8. **Standalone tuner page** — `DeckScoreTunerPage.jsx` + nav wiring (`App.jsx` + `constants.js`).
9. **Deploy:** operator runs `supabase db push`; orchestrator deploys `admin-review-venue-claim` edge fn; admin web auto-deploys on merge (Vercel).

---

## 8. Regression prevention

- **Pin hardcode guard:** migration test T-07/T-08/T-09 + I-1066-PIN-COMPUTED-NOT-HARDCODED protective comment in the function body.
- **No-servable-flip guard:** T-01 asserts `is_servable` unchanged after seed; protective comment "MUST NOT flip is_servable — that authority is admin-review-venue-claim approval."
- **No-fabrication guard:** `<DeckCardPreview>` distance/travel omission is commented "admin has no buyer geo — OMIT, never fake (Constitution #9)."
- **Serving-gate drift guard:** the rank + pin RPCs copy the serving-RPC WHERE clause; a comment cross-references `query_servable_places_by_signal` so a future serving-gate change flags both. (Consider a follow-up shared SQL helper if the gates drift — noted for orchestrator.)

---

## 9. Open question for operator steering

**OQ-1 (preview-scoring richness):** ORCH-1066 ships Path A (seed all 16 at neutral 100, then admin tunes) for on-demand scoring. The richer Path B (a real rule-based `computeScore` against a non-servable place via a new `admin-score-place-preview` edge function) is spec'd as a future upgrade but NOT built here, because Path A fully unblocks Lantern & Vine with zero risk to the bouncer/scorer contract. **Confirm Path A (seed-then-tune) is acceptable for launch, or direct that Path B (real projected scores) ship in this ORCH.** Recommendation: ship Path A now; open Path B as a follow-up only if admins find seed-100 too coarse in practice.

---

*Cross-surface, granularity, and completion-condition clauses satisfied. The only UI surface is Admin Web (single React codebase → no manual parity split). The `<DeckCardPreview>` visual contract is explicitly delegated to a required `mingla-designer` pass (Phase 3.6 division of labor).*
