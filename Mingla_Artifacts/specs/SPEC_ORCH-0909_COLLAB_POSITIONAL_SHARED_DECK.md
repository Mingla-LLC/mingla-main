# SPEC — ORCH-0909 [Collab deck architectural rewrite to positional shared-deck model with intersection geographic semantics]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-21
**Phase:** SPEC (binding contract; implementor consumes verbatim)
**Severity:** S1-high
**Classification:** architecture-flaw + design-debt + data-integrity (rewrite, not bug fix)
**Status:** READY FOR IMPLEMENT — all four product decisions locked by operator
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0909_COLLAB_DECK_POSITIONAL_SHARED_DECK_v2.md`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`
**Supersedes:** ORCH-0902 [Collab deck deterministic rewrite] — entire per-client version-pinned model retired; CR-1 through CR-9 reinterpreted

---

## Layman summary (every contract decision + success criterion + invariant + test in one line each)

- One ordered card sequence per collab session. Card at position N is the same physical row for every participant; everyone sees the same deck in the same order. Some swipe faster; nobody sees a different card at the same position.
- Joiners enter at the live frontier (whichever participant is farthest along); they do NOT see historical cards. Their next card matches what the farthest existing person was about to see.
- Geographic semantic is INTERSECTION. Cards must be reachable by EVERY accepted GPS-bearing participant. Empty intersection → "you are too far apart, increase travel time" smart empty state. No more UNION (ORCH-0902 CR-2 retired).
- Dead-ends are LIVE — no permanent sentinel; if conditions improve (joiner adds categories, pref change widens radius), the dead-end position fills with a real card on the next swipe.
- Joining is ONE atomic RPC `accept_session_with_prefs` that writes accept + GPS + categories + intents + travel constraints together. No more two-step accept-then-async-GPS-write. Kills the 19-second lag window observed in production session daadd454.
- If user has no GPS at accept (permission off, indoor, no lock), they join anyway with a banner: "We're having trouble getting your location. Once we have it, your travel limits will be added to the deck." Their circle is excluded from intersection until GPS arrives; the trigger re-fires when it does.
- 50-circle hard cap is removed by installing PostGIS extension and rewriting `query_servable_places_by_signal_*` to use `ST_DWithin` + `ST_Intersects`. 500-participant scale becomes achievable.
- On deploy day, all in-flight collab sessions reset to `current_position=0`. CR-9 single-shot cutover pattern preserved from ORCH-0902.
- Client retires: `pinnedDeckVersion`, `accumulatedCardsRef`, `sessionServedIdsRef`, `pinnedDeckVersionSessionRef`, three-case transition effect at `RecommendationsContext.tsx:583-635`, `isExhausted` advancement gate, `isRefreshingAfterPrefChange` machinery, `expected_deck_version` request param, the async GPS-write effect at `RecommendationsContext.tsx:1465-1478` (for the COLLAB-ACCEPT path only).
- Server-side `discover-cards/handleDeterministicV2` rewrites from "return entire deck array" to "return next card at my current_position + 1" with atomic INSERT ON CONFLICT for frontier generation.
- 13 success criteria gate this work (SC-01 through SC-13) — positional alignment, joiner alignment, intersection-empty handling, live dead-end revival, match quorum, concurrent frontier race, atomic accept atomicity, no-GPS banner, PostGIS scale, single-shot migration, retire-old-state-machinery, realtime propagation, "you are too far apart" smart empty.
- 6 new invariants registered + ORCH-0902's CR-2 (union) DEPRECATED → CR-2' (intersection).
- 9 regression tests required to satisfy ORCH-0840 Step 0.5 gate (implementor happy-path + tester adversarial, both with fails-on-revert).
- Implementation order: PostGIS install → DB migration → SQL functions → atomic accept RPC → edge function rewrite → client retirement → client re-implementation → tests → CI gates.

---

## Phase 0 ingest receipts

| # | File | Takeaway |
|---|------|----------|
| 1 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0909_COLLAB_DECK_POSITIONAL_SHARED_DECK_v2.md` | Load-bearing — contract LCD-1..LCD-8 + 20 use-case determinism walk |
| 2 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0909_COLLAB_DECK_DIVERGENCE_ON_JOIN.md` | SUPERSEDED; SQL probes + 50-cap data are still accurate (§3, §4, §8) |
| 3 | `Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_SESSION_DECK_DETERMINISTIC_REWRITE.md` | Inherited patterns — CR-9 single-shot cutover, edge-function deploy carve-out, trigger structure |
| 4 | `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` | Current schema; `pg_aggregate_collab_prefs` 50-cap at line 315; trigger structure at line 525-597 |
| 5 | `supabase/migrations/20260627000000_orch_0902_round_gps_in_aggregation_hash.sql` | Fix A — 4-decimal GPS rounding stays in new aggregator |
| 6 | `supabase/functions/discover-cards/index.ts` (600-1100) | Current `handleDeterministicV2` — full rewrite to positional |
| 7 | `app-mobile/src/contexts/RecommendationsContext.tsx` (440-660, 990-1180, 1465-1490) | Client state machinery — full retirement |
| 8 | `app-mobile/src/hooks/useBoardSession.ts` (280-400) | Realtime — keep subscription, drop deck-state propagation |
| 9 | `app-mobile/src/services/collaborationInviteService.ts` (60-260) | Current accept flow — 4-step sequence; replaced by atomic RPC |
| 10 | `app-mobile/src/hooks/useUserLocation.ts` (118-128) | 13s GPS timeout; cache usually has location ready |
| 11 | Memory `feedback_collab_deck_determinism_contract.md` | ORCH-0902 contract being superseded; update at CLOSE Extension Step 5a |
| 12 | Memory `feedback_solo_collab_parity.md` | Solo + collab parity rule — DECK affected; solo path untouched by this spec |
| 13 | Memory `feedback_tester_canonical_and_platform_parity.md` | TEST phase requires iOS sim + Android emu + web parity per surface |
| 14 | Memory `feedback_one_pr_per_close.md` | CLOSE produces one PR; bundles forbidden by default |

---

## 1. Scope, non-goals, assumptions

### 1.1 Scope (in)

- New DB schema: `session_deck_cards` table + `session_participants.current_position` column + PostGIS extension install.
- Rewrite of SQL functions: `pg_aggregate_collab_prefs` (intersection + no-GPS handling), `query_servable_places_by_signal_intersection` (renamed; PostGIS path), new `accept_session_with_prefs` atomic RPC.
- Rewrite of trigger `recompute_deck_version_after_prefs_change` — behavior preserved but new aggregation feeds it.
- Rewrite of `supabase/functions/discover-cards/index.ts` — `handleDeterministicV2` becomes positional.
- Retirement of client state machinery in `app-mobile/src/contexts/RecommendationsContext.tsx` per §6.1.
- New client state + swipe handler + accept flow + banner UX per §6.2 through §6.5.
- Migration of in-flight sessions on deploy day (single-shot reset).
- 9 Step-0.5 regression tests + 4 CI gates.
- One memory file decommission + one new memory file establishment.

### 1.2 Non-goals (out)

- Solo deck flow (`useDeckCards` for `isSoloMode=true`) is UNCHANGED. The positional shared-deck model applies only to collab.
- Discussion / chat substrate (ORCH-0898 [Consumer collab session group chat]) — not touched.
- Friends / connections / invite flow upstream of `accept_session_with_prefs` — invite resolution stays as-is; only the accept action changes.
- Calendar / scheduler / lock-in lifecycle (ORCH-0908 [Collab session lifecycle]) — separate ORCH track.
- Existing right-swipe match notification system — match quorum logic stays at the `board_user_swipe_states` layer; only the swipe-position tracking changes.
- Per-card analytics / appsflyer events at the deck layer — not touched.
- Performance optimization of the swipe round-trip (e.g., card prefetching of N>1) — out of scope; spec requires single-card-per-swipe (with optional client lookahead documented as a future ORCH).
- Marketing Hub / business app / admin web — irrelevant.

### 1.3 Assumptions

- A1. PostGIS extension can be installed on the Supabase project. The Supabase project allows the `postgis` extension (it is in the Supabase available-extensions list). Verified externally; implementor verifies before migration write.
- A2. The `preferences` table continues to hold per-user solo prefs. `accept_session_with_prefs` reads from it as a fallback for fields not passed explicitly.
- A3. `place_pool` rows have valid `lat`, `lng`, and one row per place (no duplicates by `google_place_id` within active set).
- A4. `useUserLocation` cache returns a usable lat/lng on the vast majority of accept events. The no-GPS path is a rare edge.
- A5. Realtime subscription on `collaboration_sessions` UPDATEs continues to propagate via `useBoardSession`. The new model uses it for participant count + `current_position` propagation, not for `deck_version` state machinery.
- A6. `card_pool` / `place_pool` / signal scoring (ORCH-0700-ORCH-0735) all remain canonical for candidate generation. No changes to the pool layer.

---

## 2. Cross-Surface Impact (Phase 2.5 MANDATORY)

| Surface | In scope? | What changes | Parity |
|---------|-----------|--------------|--------|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Client retirement + new swipe handler + new accept flow + "locating you" banner; user-visible: every collab card position is identical across participants, joiners see the frontier, "too far apart" empty state, GPS-pending banner | Automatic via shared RN code with Android |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same as iOS — shared RN code | Automatic |
| **Backend** (`supabase/`) | YES | New table + column + PostGIS install + rewritten SQL functions + rewritten edge function + new atomic RPC | N/A (single backend) |
| **Buyer / anonymous Web** (`mingla-business/` `/checkout/{eventId}` etc.) | NO | No collab feature on buyer-web | — |
| **Business iOS** (`mingla-business/` on iOS) | NO | Different app; no collab deck | — |
| **Business Android** (`mingla-business/` on Android) | NO | Different app; no collab deck | — |
| **Admin Web** (`mingla-admin/`) | NO | No consumer-deck UI on admin | — |
| **Business Web preview** (`mingla-business/` dev/web) | NO | Same as Business iOS/Android | — |

Parity is automatic via shared `app-mobile/` RN code. Per-surface success criteria are NOT needed (one SC suffices for both iOS + Android). The TEST phase must still exercise BOTH iOS Simulator AND Android Emulator per `feedback_tester_canonical_and_platform_parity.md` — this is a tester-enforced gate, not a per-surface SC split.

---

## 3. Database layer

### 3.1 New table `public.session_deck_cards`

Exact SQL (goes in a new migration file `supabase/migrations/20260628000000_orch_0909_positional_shared_deck.sql`):

```sql
CREATE TABLE IF NOT EXISTS public.session_deck_cards (
  session_id uuid NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  position int NOT NULL,
  card_id uuid NOT NULL REFERENCES public.place_pool(id) ON DELETE RESTRICT,
  generated_at_version int NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, position),
  CONSTRAINT session_deck_cards_position_pos CHECK (position >= 1),
  CONSTRAINT session_deck_cards_version_pos CHECK (generated_at_version >= 1)
);

COMMENT ON TABLE public.session_deck_cards IS
  'ORCH-0909 LCD-1: positional shared deck — card at (session_id, position) is the immutable identity of the Nth card in the session. Generated lazily by the participant who first reaches the frontier; subsequent participants reaching that position read the same row. ON DELETE CASCADE from collaboration_sessions; ON DELETE RESTRICT from place_pool (a place can be removed from active pool but cards already-served stay valid).';

CREATE INDEX IF NOT EXISTS idx_session_deck_cards_session_pos
  ON public.session_deck_cards (session_id, position DESC);

COMMENT ON INDEX public.idx_session_deck_cards_session_pos IS
  'ORCH-0909: supports frontier queries (MAX(position) per session) and next-card lookups (position > caller_current_position LIMIT 1).';
```

**RLS:** SELECT allowed for accepted participants; INSERT/UPDATE/DELETE forbidden in user context (only the SECURITY DEFINER edge-function path writes; immutable history).

```sql
ALTER TABLE public.session_deck_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sdc_select ON public.session_deck_cards;
CREATE POLICY sdc_select ON public.session_deck_cards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = session_deck_cards.session_id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = true
    )
  );

-- INSERT only via SECURITY DEFINER edge-function calling pattern; service_role bypass for ops.
DROP POLICY IF EXISTS sdc_insert_service_only ON public.session_deck_cards;
CREATE POLICY sdc_insert_service_only ON public.session_deck_cards
  FOR INSERT
  WITH CHECK (
    current_user = 'postgres'
    OR auth.role() = 'service_role'
  );

-- UPDATE and DELETE forbidden — immutable history (no policies = no access).
```

### 3.2 New column `session_participants.current_position`

```sql
ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS current_position int NOT NULL DEFAULT 0;

ALTER TABLE public.session_participants
  DROP CONSTRAINT IF EXISTS sp_current_position_nonneg;
ALTER TABLE public.session_participants
  ADD CONSTRAINT sp_current_position_nonneg CHECK (current_position >= 0);

COMMENT ON COLUMN public.session_participants.current_position IS
  'ORCH-0909 LCD-6: how far this participant has personally swiped in the session deck. Bumped server-side by discover-cards/handleDeterministicV2 on every swipe. Frontier F = MAX(current_position) WHERE has_accepted=true. New joiners insert with current_position = F.';
```

### 3.3 Install PostGIS extension (LCD per P1)

```sql
-- Pre-flight: verify Supabase project allows postgis extension
-- (Implementor MUST confirm via `mcp__supabase__list_extensions` before this migration ships)
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 3.4 Retain `session_deck_versions` table as audit

Per LCD-8: `session_deck_versions` table is RETAINED but no longer load-bearing for serving. The frozen `aggregated_params` snapshot remains useful for:
- ORCH-0908 [Collab session lifecycle] exclude_place_ids path (already reads from it, unchanged).
- Audit / debugging of historical V_n state.
- Potential future "deck history reconstruction" features.

No schema change; just documented as no-longer-load-bearing.

### 3.5 Migration ordering and file naming

ONE new migration file:

**File:** `supabase/migrations/20260628000000_orch_0909_positional_shared_deck.sql`

**Contents in order:**
1. `CREATE EXTENSION IF NOT EXISTS postgis;` (§3.3)
2. `CREATE TABLE public.session_deck_cards` + RLS + index (§3.1)
3. `ALTER TABLE public.session_participants ADD COLUMN current_position` (§3.2)
4. New / replaced SQL functions (§4) — all in this same migration for atomic deploy:
   - `pg_aggregate_collab_prefs` (CREATE OR REPLACE — rewrites existing)
   - `query_servable_places_by_signal_intersection` (CREATE OR REPLACE — renamed from `_union`)
   - DROP old `query_servable_places_by_signal_union` (after the rename + grep confirms no callers)
   - `accept_session_with_prefs` (new function — CREATE OR REPLACE)
   - `recompute_deck_version_after_prefs_change` (trigger function rewritten if needed — most logic preserved, just calls new aggregator)
5. Migration step §7.1 (in-flight session reset) — runs in the same transaction as the schema changes for single-shot cutover

---

## 4. SQL function layer

### 4.1 `pg_aggregate_collab_prefs` rewrite (intersection + no-GPS handling)

**Signature unchanged:** `pg_aggregate_collab_prefs(p_session_id uuid) RETURNS jsonb`.

**Behavior changes:**

- **Categories / intents / dateWindows / selectedDates:** UNION across ALL accepted participants (unchanged from ORCH-0902 — chips are inclusive).
- **Circles:** include ONLY participants with `custom_lat IS NOT NULL AND custom_lng IS NOT NULL`. Participants without GPS are NOT included as circles.
- **Intersection geometry (new field `intersection_geometry`):** if PostGIS is installed (it is, per §3.3), compute the geometric intersection of all included circles. If empty (no common reachable area), set `intersection_empty = true`.
- **`intersection_empty: bool`** new top-level field; drives "too far apart" smart empty state at `discover-cards`.
- **`pending_gps_user_ids: uuid[]`** new top-level field; lists accepted participants with `custom_lat IS NULL`. Drives the per-session "waiting on X's location" banner (optional — see §6.5).
- **Hash determinism:** SHA-256 hash of the canonical jsonb is unchanged — trigger continues to bump `deck_version` only on real changes.
- **CR-8 quorum (acceptedCount >= 2) preserved:** if `acceptedCount < 2`, return empty result with `intersection_empty: false` (the deck hasn't minted yet, not "too far apart").
- **50-circle cap REMOVED:** with PostGIS path A (§4.2), there is no need for the cap. Drop the `RAISE EXCEPTION` block at the prior `pg_aggregate_collab_prefs:315`.

**Pseudo-SQL (implementor produces final form):**

```sql
CREATE OR REPLACE FUNCTION public.pg_aggregate_collab_prefs(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prefs jsonb;
  v_accepted_user_ids uuid[];
  v_accepted_count int;
  v_categories text[];
  v_intents text[];
  v_date_windows text[];
  v_selected_dates text[];
  v_datetime_pref text;
  v_circles jsonb;
  v_pending_gps_user_ids uuid[];
  v_intersection_geom geometry;
  v_intersection_empty bool;
  v_result jsonb;
BEGIN
  SELECT participant_prefs INTO v_prefs
    FROM public.collaboration_sessions WHERE id = p_session_id;

  IF v_prefs IS NULL OR jsonb_typeof(v_prefs) <> 'object' THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb, 'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb, 'selectedDates', '[]'::jsonb,
      'datetimePref', null, 'circles', '[]'::jsonb,
      'acceptedCount', 0, 'pending_gps_user_ids', '[]'::jsonb,
      'intersection_empty', false
    );
  END IF;

  SELECT array_agg(user_id ORDER BY user_id) INTO v_accepted_user_ids
    FROM public.session_participants
    WHERE session_id = p_session_id AND has_accepted = true;

  v_accepted_count := COALESCE(array_length(v_accepted_user_ids, 1), 0);

  IF v_accepted_count < 2 THEN
    -- CR-8: deck doesn't mint until quorum
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb, 'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb, 'selectedDates', '[]'::jsonb,
      'datetimePref', null, 'circles', '[]'::jsonb,
      'acceptedCount', v_accepted_count,
      'pending_gps_user_ids', '[]'::jsonb,
      'intersection_empty', false
    );
  END IF;

  -- Categories / intents / dateWindows / selectedDates: UNION (unchanged)
  -- ... [same patterns as ORCH-0902 with JSONB null guards]

  -- Circles: ONLY participants with GPS
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', uid,
      'lat', ROUND((prefs->>'custom_lat')::numeric, 4),
      'lng', ROUND((prefs->>'custom_lng')::numeric, 4),
      'travel_mode', COALESCE(prefs->>'travel_mode', 'walking'),
      'time_min', COALESCE((prefs->>'travel_constraint_value')::int, 30),
      'radius_m', public.estimate_circle_radius_m(
        COALESCE(prefs->>'travel_mode', 'walking'),
        COALESCE((prefs->>'travel_constraint_value')::int, 30)
      )
    ) ORDER BY uid
  ) INTO v_circles
  FROM jsonb_each(v_prefs) AS rows(uid, prefs)
  WHERE uid::uuid = ANY(v_accepted_user_ids)
    AND prefs->>'custom_lat' IS NOT NULL
    AND prefs->>'custom_lng' IS NOT NULL;

  -- Pending GPS: accepted participants WITHOUT custom_lat/lng
  SELECT array_agg(uid::uuid ORDER BY uid) INTO v_pending_gps_user_ids
  FROM jsonb_each(v_prefs) AS rows(uid, prefs)
  WHERE uid::uuid = ANY(v_accepted_user_ids)
    AND (prefs->>'custom_lat' IS NULL OR prefs->>'custom_lng' IS NULL);

  -- Intersection geometry (PostGIS): intersect all GPS-bearing participant circles
  -- ST_Buffer of each (lat,lng) by radius_m converted to degrees
  -- Use ST_Intersection cumulatively. Empty result → intersection_empty=true.
  IF jsonb_array_length(COALESCE(v_circles, '[]'::jsonb)) >= 2 THEN
    -- Compute intersection of all circles in v_circles
    -- (Implementor produces final ST_Intersection / ST_Buffer / ST_DWithin SQL)
    v_intersection_empty := <ST_IsEmpty(cumulative_intersection)>;
  ELSE
    -- Only 1 GPS-bearing participant → no intersection issue; use that single circle as the bound
    v_intersection_empty := false;
  END IF;

  v_result := jsonb_build_object(
    'categories', COALESCE(to_jsonb(v_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(v_intents), '[]'::jsonb),
    'dateWindows', COALESCE(to_jsonb(v_date_windows), '[]'::jsonb),
    'selectedDates', COALESCE(to_jsonb(v_selected_dates), '[]'::jsonb),
    'datetimePref', v_datetime_pref,
    'circles', COALESCE(v_circles, '[]'::jsonb),
    'acceptedCount', v_accepted_count,
    'pending_gps_user_ids', COALESCE(to_jsonb(v_pending_gps_user_ids), '[]'::jsonb),
    'intersection_empty', v_intersection_empty
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.pg_aggregate_collab_prefs(uuid) IS
  'ORCH-0909 LCD-2: returns canonical aggregated prefs for the session. Intersection-based (cards must be reachable by ALL GPS-bearing participants); intersection_empty=true signals "too far apart". 50-circle cap removed (PostGIS path A scales to N>>50). pending_gps_user_ids drives client banner UX.';
```

### 4.2 `query_servable_places_by_signal_intersection` (renamed; PostGIS path)

**Old name:** `query_servable_places_by_signal_union` (ORCH-0902).
**New name:** `query_servable_places_by_signal_intersection`.

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal_intersection(
  p_signal_id text,
  p_filter_min numeric,
  p_circles jsonb,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit int DEFAULT 200
)
RETURNS TABLE(
  place_id uuid, google_place_id text, name text, address text,
  lat double precision, lng double precision,
  rating numeric, review_count int, price_level text,
  price_range_start_cents int, price_range_end_cents int,
  opening_hours jsonb, website text, photos jsonb,
  stored_photo_urls text[], types text[], primary_type text,
  signal_score numeric, signal_contributions jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH circles AS (
    SELECT
      ST_SetSRID(ST_MakePoint((c->>'lng')::double precision, (c->>'lat')::double precision), 4326)::geography AS center,
      (c->>'radius_m')::double precision AS rad_m
    FROM jsonb_array_elements(p_circles) AS c
    WHERE (c->>'lat') IS NOT NULL
      AND (c->>'lng') IS NOT NULL
      AND (c->>'radius_m') IS NOT NULL
  ),
  candidate_places AS (
    -- A place is a candidate IFF it lies inside EVERY circle (intersection)
    SELECT pp.id
    FROM public.place_pool pp
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
      -- ALL circles must contain this place (intersection)
      AND NOT EXISTS (
        SELECT 1 FROM circles c
        WHERE NOT ST_DWithin(
          c.center,
          ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
          c.rad_m
        )
      )
  )
  SELECT
    pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng,
    pp.rating, pp.review_count, pp.price_level,
    pp.price_range_start_cents, pp.price_range_end_cents,
    pp.opening_hours, pp.website, pp.photos, pp.stored_photo_urls,
    pp.types, pp.primary_type, ps.score, ps.contributions
  FROM public.place_pool pp
  JOIN candidate_places cp ON cp.id = pp.id
  JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.query_servable_places_by_signal_intersection IS
  'ORCH-0909 LCD-2: returns servable places inside the INTERSECTION of all participant reachable circles (Path A, PostGIS ST_DWithin geography). Deterministic ORDER BY signal_score DESC, review_count DESC NULLS LAST, place_id ASC. Replaces query_servable_places_by_signal_union (ORCH-0902 union semantic retired).';
```

**Drop the old union function** (after grep confirms no remaining callers — implementor verifies):

```sql
DROP FUNCTION IF EXISTS public.query_servable_places_by_signal_union(text, numeric, jsonb, uuid[], int);
```

### 4.3 NEW atomic RPC `accept_session_with_prefs`

This RPC replaces the 4-step accept flow in `collaborationInviteService.ts:60-260`. ONE atomic call writes:
- `collaboration_invites.status = 'accepted'`
- `session_participants` upsert with `has_accepted = true`
- `collaboration_sessions.participant_prefs[user_id]` (deep merge with full prefs)

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.accept_session_with_prefs(
  p_session_id uuid,
  p_invite_id uuid,            -- the collaboration_invites.id row to mark accepted
  p_lat numeric,                -- nullable; null = no-GPS path
  p_lng numeric,                -- nullable; null = no-GPS path
  p_categories text[],
  p_intents text[],
  p_travel_mode text,
  p_travel_constraint_value int,
  p_date_option text DEFAULT NULL,
  p_datetime_pref text DEFAULT NULL,
  p_selected_dates text[] DEFAULT NULL,
  p_use_gps_location bool DEFAULT true,
  p_custom_location text DEFAULT NULL,
  p_intent_toggle bool DEFAULT true,
  p_category_toggle bool DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_existing_invite_user uuid;
  v_prefs_merge jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Step 1: verify invite belongs to this session + this user
  SELECT invited_user_id INTO v_existing_invite_user
    FROM public.collaboration_invites
    WHERE id = p_invite_id AND session_id = p_session_id;

  IF v_existing_invite_user IS NULL OR v_existing_invite_user <> v_user_id THEN
    RAISE EXCEPTION 'invite_not_found_or_not_owner';
  END IF;

  -- Step 2: mark invite accepted
  UPDATE public.collaboration_invites
    SET status = 'accepted', updated_at = now()
    WHERE id = p_invite_id;

  -- Step 3: upsert participant with has_accepted=true and current_position=frontier
  INSERT INTO public.session_participants
    (session_id, user_id, has_accepted, joined_at, current_position)
  VALUES (
    p_session_id,
    v_user_id,
    true,
    now(),
    COALESCE(
      (SELECT MAX(current_position) FROM public.session_participants
        WHERE session_id = p_session_id AND has_accepted = true),
      0
    )
  )
  ON CONFLICT (session_id, user_id) DO UPDATE
    SET has_accepted = true,
        joined_at = COALESCE(public.session_participants.joined_at, now()),
        current_position = COALESCE(
          (SELECT MAX(current_position) FROM public.session_participants
            WHERE session_id = p_session_id AND has_accepted = true),
          0
        );

  -- Step 4: build prefs jsonb (only include fields actually set; null-friendly)
  v_prefs_merge := jsonb_strip_nulls(jsonb_build_object(
    'categories',                  COALESCE(to_jsonb(p_categories), '[]'::jsonb),
    'intents',                     COALESCE(to_jsonb(p_intents), '[]'::jsonb),
    'travel_mode',                 COALESCE(p_travel_mode, 'walking'),
    'travel_constraint_type',      'time',
    'travel_constraint_value',     COALESCE(p_travel_constraint_value, 30),
    'date_option',                 p_date_option,
    'datetime_pref',               p_datetime_pref,
    'selected_dates',              to_jsonb(p_selected_dates),
    'use_gps_location',            p_use_gps_location,
    'custom_location',             p_custom_location,
    'custom_lat',                  p_lat,    -- NULL allowed (no-GPS path)
    'custom_lng',                  p_lng,    -- NULL allowed
    'intent_toggle',               p_intent_toggle,
    'category_toggle',             p_category_toggle
  ));

  -- Step 5: atomically merge into collaboration_sessions.participant_prefs
  -- The trigger recompute_deck_version_after_prefs_change fires ONCE on this UPDATE.
  UPDATE public.collaboration_sessions
    SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb)
      || jsonb_build_object(v_user_id::text, v_prefs_merge),
        updated_at = now()
    WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'user_id', v_user_id,
    'has_gps', (p_lat IS NOT NULL AND p_lng IS NOT NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_session_with_prefs TO authenticated;

COMMENT ON FUNCTION public.accept_session_with_prefs IS
  'ORCH-0909 LCD: atomic accept + prefs + GPS in ONE write. Replaces the prior 4-step accept flow in collaborationInviteService.ts:60-260 (which produced the 19s lag window observed in production session daadd454). The single UPDATE on collaboration_sessions.participant_prefs fires recompute_deck_version_after_prefs_change exactly once with the full picture.';
```

### 4.4 `recompute_deck_version_after_prefs_change` trigger function

**Behavior preserved** from ORCH-0902 (AFTER UPDATE OF participant_prefs, updated_at; `pg_trigger_depth() > 1` recursion guard; SHA-256 hash diff → bump deck_version + insert session_deck_versions row). **The only change** is the function now calls the rewritten `pg_aggregate_collab_prefs` (intersection-based). Schema unchanged. No new code in this function.

---

## 5. Edge function layer

### 5.1 `supabase/functions/discover-cards/index.ts` — `handleDeterministicV2` rewrite

**File:** `supabase/functions/discover-cards/index.ts` (existing function fully rewritten in place).

#### 5.1.1 New request schema

```ts
interface PositionalDeckRequest {
  session_id: string;
  current_position: number;  // The participant's current_position before this swipe (anti-replay)
}
```

`expected_deck_version` parameter **RETIRED**.

#### 5.1.2 New response schema

```ts
interface PositionalDeckSuccessResponse {
  success: true;
  card: PlaceCard;              // The card at position current_position + 1
  position: number;              // The position (= current_position + 1)
  generated_at_version: number;  // Which V was current when this card was generated
  dead_end: false;
  acceptedCount: number;
  pending_gps_user_ids: string[];
}

interface PositionalDeckDeadEndResponse {
  success: false;
  card: null;
  position: number;              // The position attempted (= current_position + 1)
  dead_end: true;
  reason:
    | 'intersection_empty'                  // "too far apart"
    | 'no_matching_candidates'              // SQL returned 0 with valid intersection
    | 'no_unswiped_candidates'              // SQL returned candidates but all already at positions 1..N
    | 'quorum_not_met';                     // CR-8: <2 accepted participants
  acceptedCount: number;
  pending_gps_user_ids: string[];
}

interface PositionalDeckErrorResponse {
  success: false;
  card: null;
  error_class: 'auth_required' | 'forbidden_not_accepted_participant'
             | 'session_not_found' | 'position_mismatch' | 'pipeline_error';
  http_status: 401 | 403 | 404 | 409 | 500;
}
```

#### 5.1.3 Handler logic (step-by-step)

```
1. AUTH: extract userId from Bearer JWT (existing logic).
   If no userId → return PositionalDeckErrorResponse error_class='auth_required' http_status=401.

2. LOAD session + verify caller is accepted participant:
   - SELECT id, deck_version, deck_params_hash FROM collaboration_sessions WHERE id = session_id;
     If null → error_class='session_not_found' http_status=404.
   - SELECT count(*) FROM session_participants
       WHERE session_id = $1 AND user_id = $2 AND has_accepted = true;
     If 0 → error_class='forbidden_not_accepted_participant' http_status=403.

3. LOAD caller's current_position from server (anti-replay):
   - SELECT current_position FROM session_participants
       WHERE session_id = $1 AND user_id = $2;
   - If server's current_position ≠ request.current_position:
     - LOG divergence (could indicate client cache desync or replayed request).
     - Use SERVER'S current_position as authoritative (server wins).
     (No HTTP error — graceful divergence; client reconciles on read.)

4. TARGET position = server's current_position + 1.

5. CHECK if position already exists:
   - SELECT card_id, generated_at_version FROM session_deck_cards
       WHERE session_id = $1 AND position = $TARGET;
   - If EXISTS:
     - Hydrate card from place_pool: SELECT * FROM place_pool WHERE id = $card_id;
     - UPDATE session_participants SET current_position = $TARGET
         WHERE session_id = $1 AND user_id = $2 AND current_position < $TARGET;
     - Return PositionalDeckSuccessResponse.

6. ELSE (caller is at frontier; generate next card):
   - Call pg_aggregate_collab_prefs(session_id).
   - If acceptedCount < 2: return dead_end reason='quorum_not_met'.
   - If intersection_empty: return dead_end reason='intersection_empty'
       (also bump current_position to TARGET so participant moves past the dead-end on next swipe; DO NOT insert).
   - Resolve chip → signal mappings (existing CATEGORY_TO_SIGNAL logic).
   - Compute cohort gating (existing pct + isInCohort logic).
   - Fan-out to query_servable_places_by_signal_intersection for each (chip, signal).
   - Score + round-robin interleave (existing logic).
   - Filter out card_ids that already appear in session_deck_cards for this session (so we never repeat a place):
       SELECT card_id FROM session_deck_cards WHERE session_id = $1;
   - Pick the TOP-1 unseen card from the interleaved list.
   - If TOP-1 is null: return dead_end reason='no_unswiped_candidates' (do NOT insert).
   - Atomic insert:
       INSERT INTO session_deck_cards (session_id, position, card_id, generated_at_version)
         VALUES ($1, $TARGET, $TOP_CARD_ID, $current_deck_version)
         ON CONFLICT (session_id, position) DO NOTHING;
   - SELECT card_id, generated_at_version FROM session_deck_cards WHERE session_id = $1 AND position = $TARGET;
     (Read after insert — gets the row whether OUR insert or a concurrent insert won)
   - Hydrate card from place_pool by card_id.
   - UPDATE session_participants SET current_position = $TARGET
       WHERE session_id = $1 AND user_id = $2 AND current_position < $TARGET;
   - Return PositionalDeckSuccessResponse.
```

#### 5.1.4 Routing

The `serve()` function at the end of `discover-cards/index.ts` checks request body shape:

- If `body.session_id` AND `body.current_position` is a number → route to new `handleDeterministicV2` (positional).
- If `body.session_id` AND `body.expected_deck_version` is the ONLY collab field → log deprecation warning + 410 GONE: "Old client version not supported. Please update the app." (Forced cutover; aligns with CR-9 / LCD-7 single-shot.)
- If no `body.session_id` → solo path (unchanged).

Old `handleDeterministicV2` (version-pinned) code is DELETED from the file. No dual-path support.

#### 5.1.5 Edge function deploy

Per `feedback_orchestrator_deploys_edge_functions.md`, the orchestrator deploys `discover-cards` via local Supabase CLI after the operator runs `supabase db push --linked`. Existing `verify_jwt=true` preserved.

---

## 6. Service / Hook / Component layer (client)

### 6.1 Retirement list (must be removed in implementation)

| Symbol | File | Reason |
|--------|------|--------|
| `pinnedDeckVersion` state | `RecommendationsContext.tsx:551` | Old per-client version-pinned model; replaced by server `current_position` |
| `pinnedDeckVersionSessionRef` | `RecommendationsContext.tsx:563` | Same — session-scope hack no longer needed |
| 3-case transition effect | `RecommendationsContext.tsx:583-635` | Old V_n → V_{n+1} transition; replaced by server-driven positional advance |
| `collabDeckParams` memo | `RecommendationsContext.tsx:642-651` | Old request shape; replaced by `{ session_id, current_position }` |
| `accumulatedCardsRef` (collab path) | various | Server is now source of truth for which card at which position |
| `sessionServedIdsRef` (collab path) | various | Same — server-side `session_deck_cards` is the truth |
| `isExhausted` advancement gate | `RecommendationsContext.tsx:619` | "Finish V_n before advancing" model retired |
| `isRefreshingAfterPrefChange` (collab path) | `RecommendationsContext.tsx:1014` | No more full deck refresh on pref change |
| Async GPS-write effect (collab path) | `RecommendationsContext.tsx:1465-1478` | Replaced by atomic accept; effect retires for collab path |
| `expected_deck_version` request param | `discover-cards/index.ts` serve() | Retired entirely |

Solo-mode paths are UNCHANGED — every retirement above must be gated on `isCollaborationMode === true` so solo flow continues working.

### 6.2 New client state + swipe handler

In `RecommendationsContext.tsx` (or a new `useCollabDeckPosition.ts` hook — implementor decides):

```ts
// New state (collab path only):
const [currentPosition, setCurrentPosition] = useState<number>(0);
const [nextCard, setNextCard] = useState<Recommendation | null>(null);
const [deckDeadEnd, setDeckDeadEnd] = useState<{
  reason: 'intersection_empty' | 'no_matching_candidates' | 'no_unswiped_candidates' | 'quorum_not_met';
} | null>(null);

// On entering collab session OR realtime onSessionUpdated:
// Sync currentPosition from session_participants.current_position via useBoardSession.
// useBoardSession already loads session_participants; extend it to surface per-user current_position.

// On swipe:
const handleSwipeRight = async (cardId: string) => {
  // existing match-quorum / right-swipe logic stays — writes to board_user_swipe_states
  // ...
  // Then fetch next card:
  const res = await supabaseAdmin.functions.invoke('discover-cards', {
    body: { session_id: resolvedSessionId, current_position: currentPosition },
  });
  // Handle response per §5.1.2 shape.
  if (res.dead_end) {
    setDeckDeadEnd({ reason: res.reason });
    setNextCard(null);
    setCurrentPosition(res.position);  // server's authoritative position
  } else {
    setNextCard(res.card);
    setCurrentPosition(res.position);
    setDeckDeadEnd(null);
  }
};

const handleSwipeLeft = async (cardId: string) => {
  // Per CR-6 (LCD-5): write to board_user_swipe_states with state='swiped_left' (existing)
  // Then same fetch-next-card flow as handleSwipeRight
};
```

### 6.3 React Query key strategy

**Recommended:** Do NOT cache the next-card response in React Query. Each swipe is a one-shot RPC call returning one card. Caching across swipes makes no sense (each card is at a different position; the cache would never hit). Use `mutate` semantics — fire-and-await on swipe, no cache key.

If implementor wants prefetching (small lookahead of N=2-3 cards), implementor specs the cache key + prefetch trigger in the implementation report, but it is NOT required by this spec.

### 6.4 Atomic accept flow (replaces `collaborationInviteService.ts:60-260`)

**File:** `app-mobile/src/services/collaborationInviteService.ts` — rewrite `acceptCollaborationInvite` per:

```ts
export async function acceptCollaborationInvite(
  params: { userId: string; inviteId: string }
): Promise<{ success: boolean; sessionId: string | null; error?: string }> {
  const { userId, inviteId } = params;

  // Step 1: resolve invite to get session_id + name (existing logic)
  const invite = await resolveInviteById(inviteId);
  if (!invite) return { success: false, sessionId: null, error: 'invite_not_found' };
  const sessionId = invite.sessionId;

  // Step 2: snapshot GPS from useUserLocation (caller passes it OR we query directly)
  // The client UI calls this from a context where useUserLocation cache is available.
  // The caller MUST snapshot lat/lng before calling this function.
  // Signature change: add lat/lng/prefs params.

  // (See revised signature below.)
}

// Revised signature — caller (UI) snapshots GPS + reads solo prefs before calling:
export async function acceptCollaborationInviteWithPrefs(params: {
  userId: string;
  inviteId: string;
  sessionId: string;
  lat: number | null;        // null = no-GPS path
  lng: number | null;
  categories: string[];
  intents: string[];
  travel_mode: string;
  travel_constraint_value: number;
  date_option?: string | null;
  datetime_pref?: string | null;
  selected_dates?: string[] | null;
  use_gps_location?: boolean;
  custom_location?: string | null;
  intent_toggle?: boolean;
  category_toggle?: boolean;
}): Promise<{ success: boolean; has_gps: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('accept_session_with_prefs', {
    p_session_id: params.sessionId,
    p_invite_id: params.inviteId,
    p_lat: params.lat,
    p_lng: params.lng,
    p_categories: params.categories,
    p_intents: params.intents,
    p_travel_mode: params.travel_mode,
    p_travel_constraint_value: params.travel_constraint_value,
    p_date_option: params.date_option ?? null,
    p_datetime_pref: params.datetime_pref ?? null,
    p_selected_dates: params.selected_dates ?? null,
    p_use_gps_location: params.use_gps_location ?? true,
    p_custom_location: params.custom_location ?? null,
    p_intent_toggle: params.intent_toggle ?? true,
    p_category_toggle: params.category_toggle ?? true,
  });

  if (error) {
    return { success: false, has_gps: false, error: error.message };
  }

  return {
    success: data?.success === true,
    has_gps: data?.has_gps === true,
  };
}
```

The caller (in `useSessionManagement.ts:619-637` `acceptInvite` callback OR wherever the UI taps "Accept") must:

1. Read `useUserLocation` cache.
2. Read user's solo `preferences` (categories, intents, travel_mode, etc.) from React Query.
3. Pass all of it to `acceptCollaborationInviteWithPrefs`.

The async write effect at `RecommendationsContext.tsx:1465-1478` for the COLLAB session-accept path RETIRES. (It may stay alive for ongoing GPS drift outside the accept flow — implementor decides; default = retire entirely for collab path.)

### 6.5 "Locating you" banner UX

**Component:** new `<NoGpsBanner />` component (path TBD by implementor; suggest `app-mobile/src/components/collab/NoGpsBanner.tsx`).

**Behavior:**
- Reads `boardSessionResult.session.participant_prefs[my_user_id]`.
- If `custom_lat IS NULL OR custom_lng IS NULL` for me → render banner at the top of the deck UI (non-blocking, dismiss-on-resolution).
- Copy: **"We're having trouble getting your location. Once we have it, your travel limits will be added to the deck."**
- Auto-dismiss when `custom_lat` becomes non-null (after `useUserLocation` resolves and an upsert fires).
- Optional session-level peer banner (forensics flags as optional, implementor decides):
  - If `pending_gps_user_ids.length > 0` AND I'm not in that list → render small banner: "Waiting on [Name]'s location — the deck will adjust once we have them."

**Persistence:** No persistence needed. Re-renders from session data on every load.

### 6.6 `useBoardSession` realtime path

`useBoardSession.ts:280-400` — the `onSessionUpdated` realtime handler stays. CHANGE:

- It currently propagates `deck_version` changes into the client deck state machine. After this rewrite, `deck_version` is server-internal only (clients don't read it for state machinery).
- The handler should still update `session.deck_version` in the local state object (for `discover-cards` request payload sanity / debugging visibility) but NOT trigger any client deck-state changes.
- The new signal `session.participant_prefs.<user_id>.custom_lat` changing to non-null triggers the NoGpsBanner auto-dismiss — no special handler needed; React re-render handles it.

### 6.7 Solo path UNCHANGED

Per §1.1, the solo deck (`useDeckCards` for `isSoloMode=true`) is fully untouched. All retirements in §6.1 must be gated on `isCollaborationMode === true` so solo flow continues.

---

## 7. Migration path for in-flight sessions

### 7.1 Single-shot reset script

In the same migration file as §3.5, AFTER the schema changes:

```sql
-- ORCH-0909 LCD: single-shot cutover. Reset all in-flight collab sessions
-- so the new positional model takes over immediately. CR-9 pattern preserved
-- from ORCH-0902. No drain period. No dual-path code.
DO $$
DECLARE
  v_count int;
BEGIN
  -- All accepted participants reset to current_position = 0
  UPDATE public.session_participants
    SET current_position = 0
    WHERE has_accepted = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'ORCH-0909 single-shot reset: % session_participants reset to current_position=0', v_count;

  -- session_deck_cards is a NEW empty table; nothing to clear.
  -- collaboration_sessions.deck_version stays as-is; new aggregator will bump it normally as prefs change.
  -- session_deck_versions stays as audit history (LCD-8 retain).
END $$;
```

### 7.2 Operator deploy sequence

1. Operator runs `supabase db push --linked` → migration applies (PostGIS install + schema + function rewrites + reset script).
2. Orchestrator deploys `discover-cards` via local Supabase CLI: `supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv`.
3. Orchestrator verifies version bump via `mcp__supabase__list_edge_functions`.
4. Implementor publishes EAS Update with the new client code: `cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0909: positional shared deck"`.
5. In-flight sessions on old client code: the client sends `expected_deck_version` → edge function returns 410 GONE with "Please update the app" message. Once the OTA installs, users continue cleanly.

---

## 8. Success Criteria

Numbered, observable, testable, unambiguous. Each maps to test cases in §10.

| # | Criterion | Observable how |
|---|-----------|----------------|
| **SC-01** | **Positional alignment.** With 2+ participants in a session, the card displayed at `current_position = N` is byte-identical (same `card_id`, same fields) across all participants who reach position N. | Test: 2 iOS sims, accept same session, both swipe to position N, compare card_id. |
| **SC-02** | **Joiner alignment.** A 3rd participant who joins after 2 others have swiped to position F enters at `current_position = F`. Their first card (at position F+1) is the SAME card the existing participants see when they reach position F+1. | Test: 2 sims at position 5; 3rd sim accepts; capture all 3 next-card card_ids on next swipe of each. |
| **SC-03** | **Intersection-empty smart empty state.** When all GPS-bearing participants' reachable circles do not overlap geographically (e.g., NYC + LA), the response is `dead_end: true, reason: 'intersection_empty'` and the client renders "you are too far apart, increase your travel time" copy. | Test: 2 sims with stub-locked locations in NYC + LA, accept session, attempt swipe. |
| **SC-04** | **Live dead-end recovery.** When `discover-cards` returns `dead_end: true, reason: 'no_matching_candidates'` and conditions change (3rd joiner expands categories OR existing edits prefs to widen radius), the SAME position fills with a real card on the next swipe attempt. | Test: induce dead-end via narrow categories, add joiner with broader categories, re-attempt swipe. |
| **SC-05** | **Match quorum.** ≥2 distinct participants right-swiping at the same `(session_id, position)` pair register a match (existing match logic; positional layer just ensures they CAN both reach the same card). | Test: 2 sims, both swipe right on the same position; verify match notification triggers. |
| **SC-06** | **Concurrent frontier race.** Two participants at frontier swiping simultaneously each receive a response. After both responses settle, the card at position `frontier + 1` is the same across both clients (one inserted; the other read the winner's row via `ON CONFLICT DO NOTHING`). | Test: Promise.all() simultaneous swipe calls; compare returned card_id. |
| **SC-07** | **Atomic accept atomicity.** `accept_session_with_prefs` RPC completes in ONE round-trip: the invite is marked accepted, `session_participants` is upserted with `has_accepted=true`, and `participant_prefs[user_id]` is populated with full prefs (including lat/lng if provided). The `recompute_deck_version_after_prefs_change` trigger fires exactly once on this UPDATE. | Test: tap accept, observe ≤1 trigger fire (count `session_deck_versions` rows minted within 1s of accept). |
| **SC-08** | **No-GPS admit with banner.** When `accept_session_with_prefs` is called with `p_lat=NULL, p_lng=NULL`, the participant is admitted (`has_accepted=true`), `pending_gps_user_ids` includes their id, and the client renders the "We're having trouble getting your location" banner. | Test: simulate no-GPS by passing nulls; visual check banner; verify aggregated jsonb has `pending_gps_user_ids` length 1. |
| **SC-09** | **No-GPS auto-resolution.** When a no-GPS participant's `useUserLocation` later resolves and `upsert_participant_prefs` writes their lat/lng, the next deck_version mint includes their circle in the intersection. Banner auto-dismisses on re-render. | Test: post-accept, manually upsert lat/lng via UI permission re-grant; observe banner dismiss + next swipe respects their circle. |
| **SC-10** | **PostGIS scale unlock.** Adding a 51st GPS-bearing accepted participant to a session does NOT trigger an EXCEPTION. `pg_aggregate_collab_prefs` returns successfully; intersection is computed via PostGIS path. | Test: SQL probe — insert 51 dummy participants with GPS into a test session, call `pg_aggregate_collab_prefs`, verify no error. |
| **SC-11** | **Single-shot migration.** On deploy day, all existing in-flight sessions reset to `current_position = 0`. First swipe in any in-flight session begins at position 1 with a freshly-generated card from the new positional model. | Test: pre-migration probe (capture in-flight participants); apply migration; post-migration probe (all `current_position=0`); swipe in one session; verify position 1 row exists in `session_deck_cards`. |
| **SC-12** | **Old client cutover.** A client sending the old `expected_deck_version` payload receives HTTP 410 GONE with a clear "Please update the app" body. | Test: curl with old payload shape; verify 410 + message. |
| **SC-13** | **Realtime propagation.** When participant A's `current_position` changes, participant B's `useBoardSession.session.participants[A].current_position` updates within 2 seconds (existing realtime channel; no new infra). | Test: 2 sims; sim A swipes; sim B observes A's position update via React DevTools or in-app debug panel. |

---

## 9. Invariants

### 9.1 Preserved

| ID | Description | How preserved |
|----|-------------|---------------|
| Existing CR-1 (deck deterministic) | Deck is a pure function of session state | Positional storage makes determinism stronger (per-row immutable identity) |
| Existing CR-3 (within-session order preserved) | Each participant sees cards in order | Strengthened — order is now session-wide, not per-client |
| Existing CR-6 (visible-but-not-binding left-swipes) | Left-swipes don't remove cards from others' decks | Card row stays in `session_deck_cards`; left-swipe is metadata on `board_user_swipe_states` |
| Existing CR-7 (server-side aggregation) | No client-side aggregation | Preserved; aggregator is server-side |
| Existing CR-8 (≥2 accepted quorum) | Deck doesn't mint until 2 participants accept | Preserved in §4.1 |
| Existing CR-9 (single-shot cutover) | No dual-path code | Preserved — old `handleDeterministicV2` deleted; 410 GONE for old clients |
| I-PROPOSED-J (Zustand no server snapshots) | No Zustand persist of server data | Preserved; new state is React useState, ephemeral |
| `feedback_solo_collab_parity.md` (solo/collab parity) | Bugs in collab path must be checked in solo | Solo path explicitly out-of-scope; no regression possible by design |

### 9.2 Deprecated

| ID | Description | Why deprecated |
|----|-------------|----------------|
| ORCH-0902 CR-2 (UNION geographic) | Cards from union of circles | Replaced by CR-2' (INTERSECTION) per LCD-2 |
| ORCH-0902 CR-4 (resume reads frozen V_n) | Client resumes V_n via frozen snapshot | Concept dissolved — positional model eliminates "version resume" |
| ORCH-0902 CR-5 (late-joiners mint V_new, existing finish V_n) | Per-client version pinning | Replaced by LCD-6 (joiners enter at frontier; positional shared deck) |

### 9.3 New invariants

| ID | Description |
|----|-------------|
| `I-PROPOSED-COLLAB-POSITIONAL-SHARED-DECK` | Card at `(session_id, position=N)` is identical across all participants in the same session. Inserted exactly once (atomic INSERT ON CONFLICT). Immutable once inserted. |
| `I-PROPOSED-COLLAB-INTERSECTION-GEOGRAPHIC` | A place is eligible for a session deck IFF it lies inside EVERY accepted GPS-bearing participant's reachable circle. UNION semantic forbidden. |
| `I-PROPOSED-COLLAB-MATCH-REACHABLE` | For every right-swipeable card in a session, every other accepted participant will see that card if they reach the position where it lives. No card is server-served to one participant and not another. |
| `I-PROPOSED-COLLAB-LIVE-DEAD-END-RECOVERY` | Dead-end positions are NOT persisted as sentinel rows. They re-attempt generation on next swipe. Session can recover from temporary dead-ends when conditions improve. |
| `I-PROPOSED-COLLAB-ATOMIC-ACCEPT-WITH-PREFS` | The accept action is ONE atomic RPC writing invite-accepted + participant-row-upsert + participant_prefs (including GPS). No async post-accept GPS write for the COLLAB accept path. |
| `I-PROPOSED-COLLAB-NO-GPS-PARTICIPANT-ADMITTED-WITH-BANNER` | A participant with `custom_lat IS NULL` is admitted to the session and counted in acceptedCount but excluded from intersection. Client renders "We're having trouble getting your location" banner that auto-dismisses on resolution. |

---

## 10. Test plan (Step 0.5 regression gate)

### 10.1 Implementor happy-path tests (mandatory, fails-on-revert verified)

**Path:** `supabase/functions/discover-cards/__tests__/orch_0909_positional_shared_deck.test.ts` (Deno tests for edge function logic) AND `app-mobile/scripts/ci/orch-0909-regression-check.mjs` (strict-grep client gates).

| Test | Scenario | Verifies SC |
|------|----------|-------------|
| T-IMP-01 | Position alignment — single insertion at position 1 generates a card; second read at position 1 returns identical card_id | SC-01 |
| T-IMP-02 | Joiner alignment — `accept_session_with_prefs` writes `current_position = MAX(current_position)` from existing participants | SC-02 |
| T-IMP-03 | Intersection-empty handling — `pg_aggregate_collab_prefs` with 2 distant circles returns `intersection_empty=true` | SC-03 |
| T-IMP-04 | Live dead-end — dead-end position has NO row in `session_deck_cards` after dead-end response | SC-04 |
| T-IMP-05 | Atomic accept — exactly 1 trigger fire on `accept_session_with_prefs` (verify via `pg_trigger_depth` log + `session_deck_versions` row count) | SC-07 |
| T-IMP-06 | No-GPS admit — call `accept_session_with_prefs` with `p_lat=NULL`; verify participant row inserted + `pending_gps_user_ids` includes them | SC-08 |
| T-IMP-07 | Single-shot reset — pre-migration `current_position` snapshot; post-migration all participants at 0 | SC-11 |
| T-IMP-08 | Strict-grep gate: `pinnedDeckVersion` no longer referenced in `RecommendationsContext.tsx` (retirement enforcement) | retirement |
| T-IMP-09 | Strict-grep gate: `expected_deck_version` no longer referenced in `discover-cards/index.ts` | retirement |

Each test must have a `fails-on-revert verified at <commit-hash>` line in the implementation report — i.e., the test must FAIL when the corresponding fix is reverted and PASS when restored.

### 10.2 Tester adversarial tests (mandatory, attacks different angles)

**Path:** `app-mobile/scripts/ci/orch-0909-adversarial-check.mjs` (strict-grep) + `supabase/functions/discover-cards/__tests__/orch_0909_adversarial.test.ts` (Deno).

| Test | Adversarial angle | Verifies |
|------|--------------------|---------|
| T-ADV-01 | **Concurrent frontier race** — Promise.all() of 2 simultaneous swipes from 2 different users at the same frontier position. Verify both responses contain the SAME card_id (one inserted, the other read winner's row). | SC-06 |
| T-ADV-02 | **Replay attack** — client sends `current_position = 5` when server says they're at 3. Server uses its own value as authoritative; logs divergence; does NOT silently advance. | §5.1.3 step 3 |
| T-ADV-03 | **Late-joiner GPS race** — 3rd participant accepts with `p_lat=NULL`, then 100ms later upserts GPS. Verify the next deck_version mint includes their circle; banner auto-dismisses. | SC-09 |
| T-ADV-04 | **51st participant** — programmatically insert 51 accepted-with-GPS participants in a test session; call `pg_aggregate_collab_prefs`. Verify NO exception thrown (PostGIS path A). | SC-10 |
| T-ADV-05 | **Old client cutover** — POST to `discover-cards` with `{ session_id, expected_deck_version: 5 }` (no `current_position`). Verify HTTP 410 + clear message. | SC-12 |
| T-ADV-06 | **Forbidden access** — user NOT in `session_participants` calls `accept_session_with_prefs`. Verify 403. | RLS |
| T-ADV-07 | **Place removed mid-session** — card at position 5 references a `place_pool.id` that is later set `is_active=false`. Verify the card row stays in `session_deck_cards` (ON DELETE RESTRICT); hydrate still returns the card data (place still exists, just inactive). | ON DELETE RESTRICT |
| T-ADV-08 | **Live dead-end revival** — induce dead-end (narrow filter), add 3rd participant with broader categories, re-attempt swipe. Verify a real card is now inserted at the dead-end position. | SC-04 |

Each test must have a `fails-on-revert verified` line.

### 10.3 Cross-platform parity (per `feedback_tester_canonical_and_platform_parity.md`)

The TEST phase MUST exercise on iOS Simulator AND Android Emulator. Web is N/A (consumer app has no web build). The tester writes a Maestro flow that runs on both sims/emus and captures screenshots at SC-01 + SC-02 + SC-03 + SC-08 + SC-11.

---

## 11. Implementation order

Strict sequence — each step MUST complete before the next begins:

1. **PostGIS pre-flight** — implementor probes `mcp__supabase__list_extensions` on the Supabase project to confirm `postgis` is available. If NOT available, STOP and ask operator to enable it in Supabase project settings.
2. **DB migration file** — write `supabase/migrations/20260628000000_orch_0909_positional_shared_deck.sql` with §3.3, §3.1, §3.2, §4.1, §4.2, §4.3, §4.4, §7.1 in that order.
3. **Edge function rewrite** — rewrite `supabase/functions/discover-cards/index.ts` per §5.
4. **Client retirement** — remove all symbols in §6.1 (collab path only; solo path untouched).
5. **Client re-implementation** — add new state + swipe handler per §6.2, new accept flow per §6.4, new banner per §6.5.
6. **Tests** — write 9 implementor + 8 tester tests per §10.
7. **CI gates** — add strict-grep entries to `.github/workflows/strict-grep-mingla-business.yml` for retirement enforcement (T-IMP-08, T-IMP-09).
8. **Implementation report** — write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` with old→new receipts per file, T-IMP-XX test runs with `fails-on-revert verified at <commit>` lines.

After implementor returns:
9. **Operator runs `supabase db push --linked`** (operator-owned per `feedback_orchestrator_deploys_edge_functions.md`).
10. **Orchestrator deploys `discover-cards`** via local Supabase CLI; verifies version bump.
11. **TEST phase** — Claude `mingla-tester` runs Maestro flows on iOS + Android per §10.3; writes QA report.
12. **CLOSE** — operator merges Seth → main via PR (one PR per CLOSE per `feedback_one_pr_per_close.md`); orchestrator runs CLOSE protocol Steps 1 → 1.5 → 2 → 3 → 4 → 5a-5h (decommission extension fires — see §13).

---

## 12. Regression prevention

For the class of bugs this rewrite eliminates:

| Class | Structural safeguard |
|-------|----------------------|
| **Per-client deck divergence** | `session_deck_cards` PRIMARY KEY `(session_id, position)` enforces single card per position. Atomic INSERT ON CONFLICT prevents race conflicts. |
| **Match-unreachable cards** | `I-PROPOSED-COLLAB-MATCH-REACHABLE` invariant + the same primary key — a card at position N is the SAME row for everyone. |
| **Stale-cache deck swaps** | No per-client cache of "the deck" — server is the source of truth. Each swipe is a fresh server round-trip. |
| **Geographic mismatch (cards far from real users)** | INTERSECTION semantic + PostGIS `ST_DWithin` enforces every card is reachable by every GPS-bearing participant. |
| **GPS lag at accept time** | Atomic `accept_session_with_prefs` RPC writes invite + participant + prefs (incl. GPS) in ONE UPDATE. Trigger fires exactly once. |
| **50-participant ceiling** | PostGIS path A scales without the artificial cap. No `RAISE EXCEPTION` block. |
| **Retired old client compatibility** | HTTP 410 GONE response for old-shape requests forces OTA update; no silent drift. |

CI gates (strict-grep):
- T-IMP-08: forbid `pinnedDeckVersion` references in app-mobile (other than archival comments).
- T-IMP-09: forbid `expected_deck_version` references in `discover-cards/index.ts`.
- (New, optional) forbid `query_servable_places_by_signal_union` references anywhere (rename enforcement).

---

## 13. Decommission flags for CLOSE Extension Step 5a-5h

This SPEC supersedes ORCH-0902. At CLOSE, the orchestrator MUST run the Deprecation Extension:

### 13.1 New memory file (Step 5a)

Path: `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_collab_per_client_version_pinning_decommissioned.md`

Content (DRAFT until ORCH-0909 close):

> ```
> ---
> name: collab-per-client-version-pinning-decommissioned
> description: ORCH-0909 retired the per-client version-pinned cached collab deck model. Positional shared deck is the canonical authority.
> metadata:
>   type: feedback
> ---
>
> Status: DRAFT — flips to ACTIVE on ORCH-0909 close
>
> **What's deprecated.** The "per-client version-pinned cached deck" model from ORCH-0902:
> - `pinnedDeckVersion` client state
> - `accumulatedCardsRef` / `sessionServedIdsRef` local accumulation
> - Three-case transition effect (Case a', a, b) at `RecommendationsContext.tsx:583-635`
> - `isExhausted` advancement gate
> - `expected_deck_version` request param
> - `query_servable_places_by_signal_union` SQL function (renamed to `_intersection`)
> - ORCH-0902 CR-2 UNION semantic + CR-4 frozen-V_n resume + CR-5 late-joiners-mint-V_new model
>
> **What's the replacement.** ORCH-0909 positional shared deck:
> - Server-side `session_deck_cards` table is the immutable source of truth for "card at position N"
> - `session_participants.current_position` tracks how far each participant has swiped
> - Server-side `pg_aggregate_collab_prefs` uses INTERSECTION (every GPS-bearing participant must reach the card)
> - Atomic `accept_session_with_prefs` RPC writes accept + GPS + prefs in ONE transaction
> - Client retires all per-client deck state machinery; each swipe is one server round-trip returning one card
>
> **What to do when encountering references in different contexts:**
> - Active code in `app-mobile/src/contexts/RecommendationsContext.tsx` referencing `pinnedDeckVersion` / `accumulatedCardsRef` for the COLLAB path → flag P0 (retirement enforcement gate)
> - Historical migrations (ORCH-0902 SQL) → preserve as audit trail
> - Old report references (v1 INVESTIGATION_ORCH-0909) → already marked SUPERSEDED; cite supersession
> - Comments referencing CR-2 union / CR-5 late-joiner → update to cite CR-2' intersection + LCD-6 frontier-entry
>
> **Why this memory exists.** ORCH-0902 shipped a deterministic deck contract that the operator initially accepted, then audited and rejected when production session daadd454 showed a 3-person join producing visibly divergent decks. The operator's actual product intent was a single positional shared deck where every participant at position N sees the same card. ORCH-0909 implemented that contract via backend rewrite. Future investigators / specers must not re-derive ORCH-0902's per-client model as live.
> ```

### 13.2 `MEMORY.md` index update (Step 5b)

Under the "Product Positioning (Non-Negotiable)" section:

> ```
> - `Collab deck = positional shared deck` (file removed per META-ORCH-0929) — ORCH-0909 retired per-client version-pinning; positional `session_deck_cards` is canonical; INTERSECTION geographic semantic; atomic accept-with-prefs RPC. (status: ACTIVE post-ORCH-0909 close)
> ```

### 13.3 Update existing memory `feedback_collab_deck_determinism_contract.md` (Step 5c)

Mark CR-2 + CR-4 + CR-5 as DEPRECATED per LCD-2 / LCD-3 / LCD-6 / LCD-7. Add cross-reference to the new decommission memory.

### 13.4 Skill definition reviews (Step 5d)

For each `.claude/skills/*/SKILL.md`, grep for `pinnedDeckVersion`, `expected_deck_version`, `accumulatedCardsRef`, `CR-2 union`, `CR-5 late-joiners`. Update any active instruction; preserve historical examples with a "post-ORCH-0909 superseded" note.

### 13.5 INVARIANT_REGISTRY.md additions (Step 5e)

Add the 6 new invariants from §9.3 to `Mingla_Artifacts/INVARIANT_REGISTRY.md` with ORCH-0909 citation.

### 13.6 DECISION_LOG.md entries (Step 5f)

> ```
> DEC-2026-05-21-ORCH-0909 — Collab deck rewritten from per-client version-pinned to positional shared deck.
> Rationale: operator-stated product intent ("everyone sees the same card") was structurally incompatible
> with ORCH-0902's per-client model. The positional model guarantees match-reachability invariant.
> ```
>
> ```
> DEC-2026-05-21-INTERSECTION-NOT-UNION — Collab geographic semantic flipped from UNION (ORCH-0902 CR-2)
> to INTERSECTION. Cards must be reachable by every GPS-bearing participant. "You are too far apart"
> smart empty state replaces serving distant cards.
> ```

### 13.7 PRODUCT_SNAPSHOT.md update (Step 5g)

Update the "Collab session deck" entry to describe the positional model + intersection semantic. Mark prior "per-client version-pinned deck" entries as superseded.

### 13.8 Backup snapshot retention (Step 5h)

ORCH-0909 does NOT drop any production data — `session_deck_versions` is RETAINED per LCD-8. No backup snapshot needed.

---

## 14. Discoveries for orchestrator

These were carried forward from v1 investigation + identified during SPEC. They are NOT in ORCH-0909 scope but should be registered as follow-ups:

1. **DISC-0909-FOCUS-REFETCH-NOT-GATED** (P2 — INHERITED FROM v1): React Query default `refetchOnWindowFocus` is enabled. Under the new positional model this matters less (server is source of truth) but the next-card invocation could fire on focus when the user returns to the app. Recommend explicit `refetchOnWindowFocus: false` on collab deck queries OR migrate to imperative `.invoke()` only (which is the recommended path per §6.3). Implementor should pick.

2. **DISC-0909-PARTICIPANT-PREFS-DEFAULTS** (P3 — INHERITED FROM v1): The auto-populated `intents=['romantic']`, `datetime_pref` for new joiners observed in production session daadd454 — this comes from reading the user's solo `preferences` table at accept time. May surprise users who think their join is "passive observation." Worth a product-intent confirmation in a follow-up ORCH.

3. **DISC-0909-LATE-JOINER-DEFAULT-PREFS-CHIRALITY** (P2 — INHERITED FROM v1): If solo onboarding produces "default category packs" for fresh joiners (`['nature', 'drinks_and_music', 'icebreakers']` per the code at `collaborationInviteService.ts:203`), those defaults can dramatically reshape the deck union (now intersection). At INTERSECTION semantic, a joiner with these defaults intersected with existing's tight categories might collapse to zero overlap. Worth a separate audit on whether late-joiner default prefs should be different in collab context.

4. **DISC-0909-CARD-LOOKAHEAD-NOT-SPECCED** (P3 — NEW): The current spec returns ONE card per swipe round-trip. At high swipe rates the network latency might be visible. A future ORCH could add server-side lookahead (return 2-3 cards on each call so the client always has the next one cached). Not in 0909 scope.

5. **DISC-0909-ORCH-0902-FOLLOW-UPS-NOT-LANDED** (P1 — INHERITED FROM v1): The earlier CR-4 implementation gap (frozen-params storage unused by serving) is now MOOT — the entire CR-4 contract is dissolved by the positional model. No carry-forward action.

6. **DISC-0909-MATCH-LOCATION-RACE** (P2 — NEW): Right-swipe match logic still writes to `board_user_swipe_states` keyed by `(session_id, user_id, card_id)`. Under the positional model, two participants who right-swipe the same card_id at the SAME position satisfy the match. But the existing match-quorum logic may not be position-aware. Implementor should verify whether the match RPC requires position-matching or just card_id-matching. If just card_id, the spec is fine; if it requires position, schema may need adjustment.

7. **DISC-0909-IN-FLIGHT-DECK-SWIPE-LOSS** (P2 — NEW): The single-shot reset script in §7.1 sets all in-flight participants to `current_position=0`. Participants who had already swiped through many V_n cards on the old model effectively LOSE that progress (they start the new positional deck from position 1). This is a CR-9 cutover cost. Mitigation options: (a) accept the loss (operator-recommended in v1 investigation §3.7); (b) backfill `session_deck_cards` from `session_deck_versions` historical snapshots. Operator chose (a) implicitly via "Proceed".

---

## END OF SPEC — ORCH-0909

**Implementor: read this entire document before writing any code.** Every section is binding. Deviations require a SPEC AMENDMENT — ask the orchestrator before deviating.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
