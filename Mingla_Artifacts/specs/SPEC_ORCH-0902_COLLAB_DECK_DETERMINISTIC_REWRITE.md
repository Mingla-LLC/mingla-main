# SPEC — ORCH-0902 [Collab Session Deck Deterministic Rewrite]

**Mode:** SPEC
**Date:** 2026-05-21
**Author:** Claude `mingla-forensics`
**Investigation source:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md`](../reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md)
**Locked contract source:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md`](../reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md) — CR-1..CR-8

---

## Scope and Non-Goals

**Scope.** This SPEC defines the deterministic shared-deck rewrite for Mingla collaboration sessions in the consumer app (`app-mobile/`) and the Supabase backend supporting it. The change converts the deck from per-client-aggregated + per-client-fetched to server-aggregated + version-pinned, with per-participant circle union for location, full V_n exhaustion before V_{n+1} transition for pref changes, and visible-but-not-binding dismissal.

**Non-goals (out of scope, do NOT implement):**
- Match quorum redesign (CR-8 preserved — ≥2 right-swipes still gates `board_saved_cards`)
- Session-start threshold redesign (CR-8 preserved — ≥2 accepted participants still gates V_1)
- Shared cursor across participants (each participant has their own cursor through the same deck)
- Solo mode aggregation (this SPEC is collab-only; solo continues to use existing client-side flow)
- Anchor mutability / host controls (left as open question Q-2, not specced in this pass)
- Match detection during deck version transitions (left as open question Q-4, preserved as-is)
- Mingla-business / mingla-admin / buyer-web (no surface affected per investigation §"Affected Surfaces")

**Assumptions:**
- PostGIS may or may not be available — implementor must verify; SPEC §2A provides both paths.
- React Query cache lifetimes (24h gcTime, staleTime Infinity) are appropriate to keep.
- Existing realtime channel `board_session:{sessionId}` is reusable; no new channel required.
- The `board_user_swipe_states` table accepts left-swipe rows via existing RPC (verified in investigation).

---

## Final Operator Decisions (2026-05-21 — supersedes inline references in this SPEC)

The implementor MUST read this section before implementing. Where this section conflicts with inline §2A / §2E / §2F text, this section wins. The original inline text is preserved for traceability of why each decision was made.

**Q-1 — Participant with no usable location:** ACCEPTED AS PROPOSED. Allow join; no contribution to union; client banner explains. `pg_aggregate_collab_prefs` filters circles to rows with non-null `custom_lat` AND `custom_lng` (or GPS coords written to those columns from the client). No changes to inline §2A.5.

**Q-6 — PostGIS availability:** ACCEPTED AS PROPOSED. Implementor verifies via `SELECT 1 FROM pg_extension WHERE extname='postgis'` on day one. If present, use Path A (§2A.6). If absent, use Path B with the 50-participant CHECK in `pg_aggregate_collab_prefs`. No changes to inline §2A.6.

**Q-7 — Migration path: OVERRIDDEN BY OPERATOR. Full single-shot cutover, no soft-cutover gating, old code deleted upon TEST PASS.** This supersedes the "soft-cutover via `deck_model` column" plan in §2A.1, §2A.4, §2A.9, §2A.10, §2A.23, and §2E. Concretely:
- **No `deck_model` column.** Do NOT add `deck_model` to `collaboration_sessions`. The only new columns are `deck_version` and `deck_params_hash`.
- **No `WHEN (NEW.deck_model = 'deterministic_v2')` trigger guards.** Triggers fire unconditionally for ALL collab sessions.
- **No edge-function `if (session.deck_model !== 'deterministic_v2')` branch.** The collab path in `discover-cards` is a SINGLE path — the new deterministic one. The legacy collab branch (which accepted client-supplied `location`/`categories` for collab) is DELETED in the same commit.
- **All in-flight sessions force-migrate.** When the migration ships, every active `collaboration_sessions` row gets `deck_version` and `deck_params_hash` populated by the same trigger that runs on the first matching UPDATE. Existing participants on old mobile builds (still sending legacy collab body) will receive HTTP 400 from `discover-cards` until they update — that is acceptable per operator directive; an EAS Update will push the new mobile code instantly to all clients.
- **Old client code deleted in the same PR.** `aggregateCollabPrefs`, the `?? userLocation` fallback at `RecommendationsContext.tsx:697`, the `collabDeckParams` memo, the `['session-deck', sessionId]` dead query key, the `session_decks` INSERT listener, and `onDeckRegenerated` — all DELETED, not stubbed.
- **Test PASS gates the deletion only in the sense that, if TEST FAILS, the whole PR is reverted (not just the deletion portion).** The deletion is not staged as a separate commit; it is part of the rewrite commit. If TEST PASSES, the PR merges and the old code is gone permanently. If TEST FAILS, the commit is reverted, returning the system to the pre-ORCH-0902 state in one move.

**Q-A — Per-version params history for CR-4 resume:** ACCEPTED AS PROPOSED. Add the `session_deck_versions` table per §2F Q-A. Trigger extended to also INSERT a row on every `deck_version` bump.

**Implementation order under the override:**
1. Schema migration (`deck_version`, `deck_params_hash`, `session_deck_versions`, `idx_board_user_swipe_states_session_left`).
2. New SQL functions (`pg_aggregate_collab_prefs`, `estimate_circle_radius_m`, `query_servable_places_by_signal_union`).
3. New triggers (`recompute_deck_version_on_prefs_change`, `touch_collab_session_on_participants_change`).
4. Edge function modification — replace the collab branch with the deterministic v2 path (single path, no `if (deck_model)` fork).
5. Client deletion + rewrite in the same commit — remove old code completely.
6. Tests written and passing on iOS Simulator + Android Emulator.
7. PR opened, pre-merge gate, merge.

**Updated rollback plan under the override:** Single move — `git revert <merge-sha>` reverts the entire PR atomically. The schema columns + new tables remain (no DROP needed because they're harmless when no code reads them); a second small migration can drop them later if desired. No `deck_model` flag flip required because no such flag exists.

---

## Cross-Surface Impact (Phase 2.5 — mandatory)

| Surface | Covered | What changes |
|---------|---------|--------------|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Full client rewrite per §2A "Client layer" (RecommendationsContext, useBoardSession, useDeckCards, deckService, deckStateRegistry, DismissedCardsSheet, SwipeableCards, collabSaveCard). Shared React Native code → parity automatic with Android; both must be tested. |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same code as iOS; parity automatic via React Native. Tester MUST exercise both simulators. |
| **Buyer/anonymous Web** | NO | Collab sessions are not exposed on buyer-anon routes. No code path touched. |
| **Business iOS** (`mingla-business/` on iOS) | NO | Business app has no collab session feature. No code path touched. |
| **Business Android** | NO | Same as Business iOS. |
| **Admin Web** (`mingla-admin/`) | NO | No collab-session admin dashboard exists today. If telemetry or moderation surfaces appear later, separate ORCH. |
| **Business Web preview** | NO | No collab feature in business web. No code path touched. |

**Parity statement:** iOS and Android run identical TypeScript/JS. Backend changes (schema, RPC, edge function) serve both equally. Therefore parity criteria are: SC-N-iOS and SC-N-Android must both be verified by the tester running the same Maestro flow against the iOS Simulator and the Android Emulator. There is NO surface where the code paths diverge; if a finding occurs on one and not the other, that itself is a P1 (likely a Metro / build / native-module issue, not a logic issue).

---

## 2A — Layered Change List

### Schema layer

#### 2A.1 — Add `deck_version` and `deck_params_hash` columns to `collaboration_sessions`

```sql
-- Migration filename: 20260522000000_orch_0902_collab_deck_version.sql

ALTER TABLE public.collaboration_sessions
  ADD COLUMN deck_version int NOT NULL DEFAULT 0,
  ADD COLUMN deck_params_hash text,
  ADD COLUMN deck_model text NOT NULL DEFAULT 'legacy_v1'
    CHECK (deck_model IN ('legacy_v1', 'deterministic_v2'));

COMMENT ON COLUMN public.collaboration_sessions.deck_version IS
  'ORCH-0902: monotonically increasing version of the deck. Bumped by trigger when deck_params_hash changes. Client uses (session_id, deck_version) as React Query key for cache partitioning. deck_version=0 means no deck yet (below ≥2 participant threshold).';

COMMENT ON COLUMN public.collaboration_sessions.deck_params_hash IS
  'ORCH-0902: SHA-256 hex of the canonical aggregated deck params (categories, intents, circles, dateWindows, selected_dates). Trigger recomputes on participant_prefs change or session_participants accepted change. If hash differs from prior, deck_version increments.';

COMMENT ON COLUMN public.collaboration_sessions.deck_model IS
  'ORCH-0902: soft-cutover flag. legacy_v1 = pre-rewrite (client aggregates, client fallback location). deterministic_v2 = post-rewrite (server aggregates, deck_version pinned). New sessions default to deterministic_v2 after operator flips the default. In-flight legacy sessions complete on legacy_v1.';

-- Backfill all existing in-flight sessions to legacy_v1 explicitly:
UPDATE public.collaboration_sessions
SET deck_model = 'legacy_v1'
WHERE deck_model IS NULL OR status IN ('pending', 'active', 'voting');
```

#### 2A.2 — RLS reads `deck_version` like any other column (no policy change)

Existing `cs_select` policy already permits creator/participant/invitee SELECT on `collaboration_sessions.*`. New columns inherit. No RLS policy SQL needed.

#### 2A.3 — `board_user_swipe_states` — no schema change required

The investigation confirmed the table accepts `swipe_state='swiped_left'` today via `rpc_record_swipe_and_check_match`. No new column needed for visible-but-not-binding dismissal (CR-6).

Add ONE supporting index (cheap, sup ports the new `useSessionDismissedCards` query):

```sql
CREATE INDEX IF NOT EXISTS idx_board_user_swipe_states_session_left
  ON public.board_user_swipe_states (session_id, swiped_at DESC)
  WHERE swipe_state = 'swiped_left';

COMMENT ON INDEX idx_board_user_swipe_states_session_left IS
  'ORCH-0902 CR-6: supports useSessionDismissedCards query — list all left swipes for a session ordered by swipe time, attributed by user_id.';
```

#### 2A.4 — Trigger: bump `deck_version` when `deck_params_hash` changes

```sql
CREATE OR REPLACE FUNCTION public.recompute_deck_version_on_prefs_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_hash text;
  v_aggregated jsonb;
BEGIN
  -- Only run for deterministic_v2 sessions; legacy_v1 sessions skip this entirely.
  IF NEW.deck_model = 'legacy_v1' THEN
    RETURN NEW;
  END IF;

  -- Recompute aggregation + hash from current participant_prefs + session_participants.
  v_aggregated := public.pg_aggregate_collab_prefs(NEW.id);
  v_new_hash := encode(digest(v_aggregated::text, 'sha256'), 'hex');

  -- If hash changed, bump version + update hash. NEW row gets new value.
  IF v_new_hash IS DISTINCT FROM NEW.deck_params_hash THEN
    NEW.deck_params_hash := v_new_hash;
    NEW.deck_version := COALESCE(NEW.deck_version, 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recompute_deck_version_before_update
  ON public.collaboration_sessions;
CREATE TRIGGER recompute_deck_version_before_update
  BEFORE UPDATE OF participant_prefs ON public.collaboration_sessions
  FOR EACH ROW
  WHEN (NEW.deck_model = 'deterministic_v2')
  EXECUTE FUNCTION public.recompute_deck_version_on_prefs_change();

-- Mirror: when session_participants changes (accept/leave), parent row also needs recompute.
-- Approach: trigger on session_participants UPDATE/INSERT/DELETE that no-ops touches
-- collaboration_sessions.updated_at (which triggers the BEFORE UPDATE above via cascade).
CREATE OR REPLACE FUNCTION public.touch_collab_session_on_participants_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  v_session_id := COALESCE(NEW.session_id, OLD.session_id);
  UPDATE public.collaboration_sessions
    SET updated_at = NOW()
    WHERE id = v_session_id
      AND deck_model = 'deterministic_v2';
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS touch_collab_on_participants_change_v2
  ON public.session_participants;
CREATE TRIGGER touch_collab_on_participants_change_v2
  AFTER INSERT OR UPDATE OF has_accepted OR DELETE ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_collab_session_on_participants_change();
```

**Note for implementor:** the `BEFORE UPDATE OF participant_prefs` trigger fires on any prefs change. The `touch_collab_session_on_participants_change` trigger fires on participant accept / leave / mute changes — it touches `updated_at` which the implementor must make ALSO fire the recompute trigger. Add `OR updated_at` to the trigger column list:

```sql
CREATE TRIGGER recompute_deck_version_before_update
  BEFORE UPDATE OF participant_prefs, updated_at ON public.collaboration_sessions
  ...
```

This ensures every materially relevant change re-evaluates the hash.

### RPC layer

#### 2A.5 — New RPC: `pg_aggregate_collab_prefs(p_session_id uuid) returns jsonb`

```sql
CREATE OR REPLACE FUNCTION public.pg_aggregate_collab_prefs(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefs jsonb;
  v_accepted_user_ids uuid[];
  v_categories text[];
  v_intents text[];
  v_date_windows text[];
  v_selected_dates text[];
  v_datetime_pref text;
  v_circles jsonb;
  v_result jsonb;
BEGIN
  -- Read raw JSONB
  SELECT participant_prefs INTO v_prefs
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_prefs IS NULL THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', 0
    );
  END IF;

  -- Only accepted participants contribute
  SELECT array_agg(user_id) INTO v_accepted_user_ids
    FROM public.session_participants
    WHERE session_id = p_session_id AND has_accepted = true;

  IF v_accepted_user_ids IS NULL OR array_length(v_accepted_user_ids, 1) < 2 THEN
    -- Below session-start threshold (CR-8): no deck yet.
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', COALESCE(array_length(v_accepted_user_ids, 1), 0)
    );
  END IF;

  -- Categories: UNION across all accepted participants whose category_toggle != false.
  -- Sorted for deterministic hash.
  SELECT array_agg(DISTINCT cat ORDER BY cat)
    INTO v_categories
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(COALESCE(prefs->'categories', '[]'::jsonb)) AS cat
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND COALESCE((prefs->>'category_toggle')::boolean, true) = true;

  -- Intents: same pattern with intent_toggle gate.
  SELECT array_agg(DISTINCT intent ORDER BY intent)
    INTO v_intents
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(COALESCE(prefs->'intents', '[]'::jsonb)) AS intent
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND COALESCE((prefs->>'intent_toggle')::boolean, true) = true;

  -- Date windows: UNION of date_option values, sorted.
  SELECT array_agg(DISTINCT (prefs->>'date_option') ORDER BY (prefs->>'date_option'))
    INTO v_date_windows
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'date_option' IS NOT NULL;

  -- Selected dates: UNION.
  SELECT array_agg(DISTINCT d ORDER BY d)
    INTO v_selected_dates
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(COALESCE(prefs->'selected_dates', '[]'::jsonb)) AS d
    WHERE uid::uuid = ANY(v_accepted_user_ids);

  -- Datetime pref: earliest.
  SELECT MIN(prefs->>'datetime_pref') INTO v_datetime_pref
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'datetime_pref' IS NOT NULL;

  -- Circles: per-participant {lat, lng, travel_mode, time_min, radius_m}.
  -- Location precedence: custom_lat/lng if present, else null (client-side GPS only
  -- works in legacy_v1 since server can't read device GPS; for deterministic_v2 we
  -- treat NULL location as "participant did not contribute a circle" — open question
  -- Q-1 in investigation §1E, default per §2F is to render banner client-side but
  -- still let the participant view the union built from others' locations).
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', uid,
      'lat', (prefs->>'custom_lat')::numeric,
      'lng', (prefs->>'custom_lng')::numeric,
      'travel_mode', COALESCE(prefs->>'travel_mode', 'walking'),
      'time_min', COALESCE((prefs->>'travel_constraint_value')::integer, 30),
      'radius_m', public.estimate_circle_radius_m(
        COALESCE(prefs->>'travel_mode', 'walking'),
        COALESCE((prefs->>'travel_constraint_value')::integer, 30)
      )
    )
    ORDER BY uid  -- deterministic ordering for hash stability
  ) INTO v_circles
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'custom_lat' IS NOT NULL
      AND prefs->>'custom_lng' IS NOT NULL;

  -- Build result
  v_result := jsonb_build_object(
    'categories', COALESCE(to_jsonb(v_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(v_intents), '[]'::jsonb),
    'dateWindows', COALESCE(to_jsonb(v_date_windows), '[]'::jsonb),
    'selectedDates', COALESCE(to_jsonb(v_selected_dates), '[]'::jsonb),
    'datetimePref', v_datetime_pref,
    'circles', COALESCE(v_circles, '[]'::jsonb),
    'acceptedCount', array_length(v_accepted_user_ids, 1)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.pg_aggregate_collab_prefs(uuid) IS
  'ORCH-0902 CR-1+CR-2: server-side deterministic aggregation. Returns canonical jsonb that the deck_version trigger hashes. Replaces client-side aggregateCollabPrefs. ORDER BY uid in circles array is critical for hash stability.';
```

Plus the small helper:

```sql
CREATE OR REPLACE FUNCTION public.estimate_circle_radius_m(
  p_travel_mode text,
  p_time_min integer
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_time_min * CASE p_travel_mode
    WHEN 'walking' THEN 80         -- ~80 m/min ≈ 4.8 km/h
    WHEN 'biking' THEN 250         -- ~250 m/min ≈ 15 km/h
    WHEN 'bicycling' THEN 250
    WHEN 'transit' THEN 350        -- ~350 m/min ≈ 21 km/h average door-to-door
    WHEN 'public_transit' THEN 350
    WHEN 'driving' THEN 600        -- ~600 m/min ≈ 36 km/h urban
    ELSE 80                         -- default to walking
  END)::numeric;
$$;

COMMENT ON FUNCTION public.estimate_circle_radius_m(text, integer) IS
  'ORCH-0902 CR-2: maps (travel_mode, time_min) to a meters radius for the participants reachable circle. Constants are conservative urban averages; refine post-launch via Distance Matrix calibration if needed.';
```

#### 2A.6 — New RPC: `query_servable_places_by_signal_union(...)` — multi-circle variant

The current `query_servable_places_by_signal` takes a single anchor. Add a sibling that takes an array of circles and filters places that lie inside ANY circle.

**Path A (preferred if PostGIS available):**

```sql
-- Implementor: first verify PostGIS via:
--   SELECT 1 FROM pg_extension WHERE extname = 'postgis';
-- If found, use this. If not, use Path B below.

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal_union(
  p_signal_id text,
  p_filter_min numeric,
  p_circles jsonb,           -- [{lat, lng, radius_m}, ...]
  p_exclude_place_ids uuid[] DEFAULT '{}',
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  place_id uuid,
  google_place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  rating numeric,
  review_count integer,
  price_level text,
  price_range_start_cents integer,
  price_range_end_cents integer,
  opening_hours jsonb,
  website text,
  photos jsonb,
  stored_photo_urls text[],
  types text[],
  primary_type text,
  signal_score numeric,
  signal_contributions jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH circles AS (
    SELECT
      (c->>'lat')::double precision AS clat,
      (c->>'lng')::double precision AS clng,
      (c->>'radius_m')::double precision AS crad
    FROM jsonb_array_elements(p_circles) AS c
  )
  SELECT pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng,
         pp.rating, pp.review_count, pp.price_level, pp.price_range_start_cents,
         pp.price_range_end_cents, pp.opening_hours, pp.website, pp.photos,
         pp.stored_photo_urls, pp.types, pp.primary_type,
         ps.score AS signal_score, ps.contributions AS signal_contributions
  FROM place_pool pp
  JOIN place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND EXISTS (
      SELECT 1 FROM circles
      WHERE ST_DWithin(
        ST_MakePoint(pp.lng, pp.lat)::geography,
        ST_MakePoint(circles.clng, circles.clat)::geography,
        circles.crad
      )
    )
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$$;
```

**Path B (fallback if PostGIS NOT available):**

```sql
-- Use raw Haversine in a CROSS JOIN. Performance degrades with N circles but
-- acceptable for N ≤ 50. Implementor must cap N (see Q-6 in investigation).

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal_union(
  p_signal_id text,
  p_filter_min numeric,
  p_circles jsonb,
  p_exclude_place_ids uuid[] DEFAULT '{}',
  p_limit integer DEFAULT 200
)
RETURNS TABLE(...same columns as Path A...)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH circles AS (
    SELECT
      (c->>'lat')::double precision AS clat,
      (c->>'lng')::double precision AS clng,
      (c->>'radius_m')::double precision AS crad
    FROM jsonb_array_elements(p_circles) AS c
  ),
  candidate_places AS (
    SELECT DISTINCT pp.id
    FROM place_pool pp
    CROSS JOIN circles c
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND (6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - c.clat) / 2.0), 2) +
        COS(RADIANS(c.clat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - c.clng) / 2.0), 2)
      ))) <= c.crad
  )
  SELECT pp.id, pp.google_place_id, ..., ps.score AS signal_score, ps.contributions
  FROM place_pool pp
  JOIN candidate_places cp ON cp.id = pp.id
  JOIN place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$$;
```

Both paths add `pp.id ASC` as the final tiebreaker for deterministic ORDER BY (current `query_servable_places_by_signal` uses `ps.score DESC, pp.review_count DESC NULLS LAST` — ties broken by row physical order, which is non-deterministic across replicas). Implementor MUST add this tiebreaker to the new function and SHOULD propose adding it to the existing function as part of the same migration.

#### 2A.7 — `upsert_participant_prefs` unchanged

Body remains as today. The trigger on `collaboration_sessions` (§2A.4) handles deck_version increment.

#### 2A.8 — Match quorum trigger unchanged (CR-8)

`check_mutual_like` continues to run only on `swiped_right`. Left swipes are persisted but ignored by the trigger. No changes to the trigger function.

### Edge function layer

#### 2A.9 — Modify `discover-cards` to accept `session_id` as primary input for collab mode

```typescript
// supabase/functions/discover-cards/index.ts

// New request body shape (ADDITIVE — legacy params still accepted for solo + legacy_v1):
interface DiscoverCardsRequest {
  // Legacy / solo path (UNCHANGED):
  location?: { lat: number; lng: number };
  categories?: string[];
  // ... existing fields ...

  // NEW deterministic_v2 collab path:
  session_id?: string;
  expected_deck_version?: number;   // Optional: client asserts which version it expects;
                                     // server returns 409 if mismatch (rare; safety net)
}

interface DiscoverCardsResponse {
  success: boolean;
  cards: Card[];
  total: number;
  source: string;
  metadata: { /* unchanged */ };
  sourceBreakdown: { /* unchanged */ };

  // NEW (deterministic_v2 only):
  deck_version?: number;
  deck_params_hash?: string;
}

// Routing logic at function entry (after auth):
if (body.session_id) {
  // deterministic_v2 path: server reads session state, no client-supplied location/categories.
  const session = await readSession(body.session_id, userId);  // RLS-checked
  if (session.deck_model !== 'deterministic_v2') {
    // Fall through to legacy path
  } else {
    return handleDeterministicV2(session, body.expected_deck_version);
  }
}
// Existing legacy code path runs unchanged.
```

**`handleDeterministicV2` body:**

```typescript
async function handleDeterministicV2(session, expectedVersion) {
  // 1. Read aggregation
  const { data: agg } = await supabaseAdmin.rpc('pg_aggregate_collab_prefs', {
    p_session_id: session.id,
  });

  // 2. Below ≥2 accepted threshold (CR-8 session-start gate)
  if (agg.acceptedCount < 2) {
    return respond({ success: true, cards: [], deck_version: 0, ...path('waiting-participants') });
  }

  // 3. Optimistic concurrency check (rare race)
  if (expectedVersion !== undefined && expectedVersion !== session.deck_version) {
    return respond({ success: false, error: 'deck_version_mismatch', deck_version: session.deck_version }, 409);
  }

  // 4. Resolve category → signal IDs (unchanged from legacy path)
  const { chipTargets, /* ... */ } = resolveCategories(agg.categories);

  // 5. For each chip target, call query_servable_places_by_signal_union with circles
  const perChipResults = await Promise.all(chipTargets.map(async (chip) => {
    return supabaseAdmin.rpc('query_servable_places_by_signal_union', {
      p_signal_id: chip.signalId,
      p_filter_min: chip.filterMin,
      p_circles: agg.circles,
      p_exclude_place_ids: [],
      p_limit: 200,
    });
  }));

  // 6. Round-robin interleave by chip in agg.categories order (unchanged from legacy)
  let interleaved = interleaveRoundRobin(perChipResults, agg.categories);

  // 7. Deterministic collab sort: by place_id ASC (string compare for stable ordering)
  interleaved = interleaved.sort((a, b) => a.place_id.localeCompare(b.place_id));

  // 8. Compute distanceKm / travelTimeMin against the user's OWN circle (closest circle)
  // — purely for display; does not affect ordering. (For consistency, use the *closest*
  // participant circle as the "from" point; this is a display-only choice.)
  const cards = interleaved.map(p => transformWithClosestCircle(p, agg.circles));

  // 9. Return with deck_version + deck_params_hash
  return respond({
    success: true,
    cards,
    total: cards.length,
    deck_version: session.deck_version,
    deck_params_hash: session.deck_params_hash,
    source: 'deterministic-v2-union',
    metadata: { hasMore: false, poolSize: cards.length, batchSeed: 0, perChipBreakdown: {...} },
    sourceBreakdown: { path: 'pipeline', ... }
  });
}
```

**Key edge-function rules for the implementor:**
- `location` parameter is IGNORED when `session_id` is present AND `deck_model='deterministic_v2'`. The function never trusts client-sent location for collab decks.
- `expected_deck_version` is optional; when present, returns HTTP 409 + current `deck_version` on mismatch. Client uses this to detect stale-cache fetches.
- The sort by `place_id.localeCompare` (or equivalent stable string compare) is REQUIRED for determinism — same as legacy collab path.
- The function reuses `query_servable_places_by_signal_union` per chip; round-robin interleave preserves the per-user-chip-selection order. The `agg.categories` array is server-side-sorted in `pg_aggregate_collab_prefs` (alphabetical), so interleave order is also deterministic. **No randomization, no client-driven ordering.**

#### 2A.10 — Solo path UNCHANGED

When `session_id` is absent OR `deck_model='legacy_v1'`, the existing code path runs. Solo decks and legacy in-flight collab sessions continue to work unmodified.

### Client layer

#### 2A.11 — Retire `aggregateCollabPrefs` and the `collabDeckParams` memo

**Delete entirely** (in the same commit that ships the SPEC):
- `app-mobile/src/utils/sessionPrefsUtils.ts` — replace exports with deprecation stubs that `throw new Error('aggregateCollabPrefs removed in ORCH-0902 — server-side aggregation. See pg_aggregate_collab_prefs.')`. Keep stub file for one release cycle for backward-compat in any forgotten import, then delete in a follow-up.
- The `collabDeckParams` `useMemo` in `RecommendationsContext.tsx:545-566` — replaced by:

```typescript
// NEW: collab deck params resolution. Reads session.deck_version from useBoardSession;
// no client-side aggregation.
const collabDeckParams = useMemo(() => {
  if (!isCollaborationMode || !session || !resolvedSessionId) return null;
  if (session.deck_version === 0) return null;  // below ≥2 threshold (CR-8)
  return {
    sessionId: resolvedSessionId,
    deckVersion: session.deck_version,
    deckParamsHash: session.deck_params_hash,
  };
}, [isCollaborationMode, session, resolvedSessionId]);
```

#### 2A.12 — `flagCollabDeck` hook slims down

```typescript
// app-mobile/src/contexts/RecommendationsContext.tsx:693-716 REPLACED:
const flagCollabDeck = useDeckCards({
  mode: 'collab',
  sessionId: resolvedSessionId ?? undefined,
  deckVersion: collabDeckParams?.deckVersion ?? 0,  // NEW: pinned version
  // location, categories, intents, travelMode, ... ALL REMOVED for collab.
  enabled: FEATURE_FLAG_PER_CONTEXT_DECK_STATE &&
           isCollaborationMode &&
           !!resolvedSessionId &&
           !!collabDeckParams &&
           collabDeckParams.deckVersion > 0,
});
```

The `?? userLocation` fallback at line 697 is DELETED. The location parameter is removed entirely from the collab path.

#### 2A.13 — `buildDeckQueryKey` collab branch

```typescript
// app-mobile/src/hooks/useDeckCards.ts: collab key shape changes.
export function buildDeckQueryKey(params: DeckQueryKeyParams): readonly unknown[] {
  if (params.mode === 'collab') {
    // NEW shape — deck_version is the cache discriminant; no lat/lng/categories needed.
    return [
      'deck-cards',
      'collab',
      params.sessionId,
      params.deckVersion,
    ] as const;
  }
  // Solo + legacy path UNCHANGED
  return [/* existing solo key shape */] as const;
}
```

#### 2A.14 — `deckService.fetchDeck` collab branch

When called with `{ mode: 'collab', sessionId, deckVersion }`, the function sends ONLY:

```typescript
trackedInvoke('discover-cards', {
  body: {
    session_id: sessionId,
    expected_deck_version: deckVersion,
  }
});
```

No `location`, no `categories`, no `travelMode`, no `dateWindows`. Server reads them from session state.

#### 2A.15 — V_n exhaustion buffer state machine in `RecommendationsContext`

**Add three new state items:**

```typescript
// Per-session pinned deck_version that the user is currently consuming.
// May lag behind session.deck_version after a pref change; rises to session.deck_version
// only on V_n exhaustion.
const [pinnedDeckVersion, setPinnedDeckVersion] = useState<number | null>(null);

// Latest known deck_version from the server (via useBoardSession.session.deck_version).
// Already available via `session.deck_version` — no new state, but referenced explicitly here.

// Derived: "has the user exhausted V_n?"
const hasExhaustedCurrentDeck = useMemo(
  () => isExhausted || (recommendations.length === 0 && hasCompletedFetchForCurrentMode),
  [isExhausted, recommendations.length, hasCompletedFetchForCurrentMode]
);
```

**Transition rule (effect):**

```typescript
useEffect(() => {
  if (!isCollaborationMode || !session) return;

  // First entry — pin to current version.
  if (pinnedDeckVersion === null && session.deck_version > 0) {
    setPinnedDeckVersion(session.deck_version);
    return;
  }

  // V_n exhausted AND server has a newer version available.
  if (
    pinnedDeckVersion !== null &&
    session.deck_version > pinnedDeckVersion &&
    hasExhaustedCurrentDeck
  ) {
    setPinnedDeckVersion(session.deck_version);
    // Clear accumulated state for the new version.
    accumulatedCardsRef.current = [];
    sessionServedIdsRef.current = new Set();
    setRecommendations([]);
    // React Query key changes automatically via collabDeckParams.deckVersion update.
  }
}, [isCollaborationMode, session?.deck_version, pinnedDeckVersion, hasExhaustedCurrentDeck]);
```

**Critical:** the hook param `deckVersion` passed to `useDeckCards` is `pinnedDeckVersion`, NOT `session.deck_version` directly. This is what guarantees the user stays on V_n until exhaustion.

#### 2A.16 — `deckStateRegistry` extension for CR-4 resume

The registry entry per (mode, sessionId) gains:

```typescript
interface DeckStateEntry {
  accumulatedCards: Recommendation[];
  servedIds: Set<string>;
  batchSeed: number;
  isExhausted: boolean;
  // NEW for ORCH-0902:
  pinnedDeckVersion: number | null;     // What V_n the user was on
  cursorPosition: number;                // How far into V_n's ordered list they were
}
```

On rejoin: restore `pinnedDeckVersion`. Hook uses it as the `deckVersion` param. Server returns the SAME V_n the user was on (because the deck function is `(session_id, deck_version) → deterministic deck`, and the server can rebuild any prior version on demand from the schema's history — see open question Q-7 in §2F about whether to actually persist deck snapshots or trust deterministic rebuild).

**Default proposal:** trust deterministic rebuild. The server, given `(session_id, deck_version)`, walks the participant_prefs history (we'd need a per-version snapshot column OR — simpler — accept that V_n cannot be rebuilt if prefs have changed since; in that case, force-transition the user to V_latest on rejoin and treat resume as best-effort).

This is the largest open implementation question. See §2F Q-A.

#### 2A.17 — Left-swipe write path (CR-6)

`app-mobile/src/components/SwipeableCards.tsx` — left swipe handler:

```typescript
// CURRENT (paraphrased):
const handleSwipeLeft = (card) => {
  // Only local: addDismissedCard(card)
  context.addDismissedCard(card);
};

// NEW for collab mode:
const handleSwipeLeft = async (card) => {
  if (isCollaborationMode && session) {
    // Write to server. Mirrors collabSaveCard pattern.
    await collabRecordLeftSwipe(card, session.id);
    // Local state still updates so the card disappears from THIS user's deck immediately.
    context.addDismissedCard(card);
  } else {
    // Solo: local-only as today.
    context.addDismissedCard(card);
  }
};
```

New helper `collabRecordLeftSwipe`:

```typescript
// app-mobile/src/components/helpers/collabRecordLeftSwipe.ts (NEW FILE)
export async function collabRecordLeftSwipe(card: Recommendation, sessionId: string): Promise<void> {
  const userId = supabase.auth.session()?.user?.id;
  if (!userId) return;

  const { error } = await supabase.rpc('rpc_record_swipe_and_check_match', {
    p_session_id: sessionId,
    p_experience_id: card.id,
    p_user_id: userId,
    p_card_data: null,                      // left swipes do not need card_data
    p_swipe_direction: 'left',
  });

  if (error) {
    console.warn('[collabRecordLeftSwipe] write failed', error);
    // Soft-fail: don't block UX. The card is still locally dismissed. Next session
    // load will re-sync from server state.
  }
}
```

#### 2A.18 — `useSessionDismissedCards` hook (CR-6 visible-but-not-binding)

```typescript
// app-mobile/src/hooks/useSessionDismissedCards.ts (NEW FILE)
export function useSessionDismissedCards(sessionId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['session-dismissed-cards', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from('board_user_swipe_states')
        .select(`
          experience_id, user_id, swiped_at, card_data,
          profiles:user_id (display_name, first_name, avatar_url)
        `)
        .eq('session_id', sessionId)
        .eq('swipe_state', 'swiped_left')
        .order('swiped_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!sessionId,
    staleTime: 30_000,  // 30s — refreshes via realtime; gentle refresh on focus
  });

  // Realtime subscription for INSERTs on session swipe states.
  useEffect(() => {
    if (!sessionId) return;
    // Piggyback on existing board_session:{sessionId} channel; just add a new callback type.
    const callbacks = {
      onSwipeRecorded: (row) => {
        if (row.swipe_state !== 'swiped_left') return;
        queryClient.invalidateQueries({ queryKey: ['session-dismissed-cards', sessionId] });
      },
    };
    realtimeService.subscribeToBoardSession(sessionId, callbacks);
    return () => realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
  }, [sessionId]);

  return query.data ?? [];
}
```

#### 2A.19 — `DismissedCardsSheet` attribution UI

```typescript
// app-mobile/src/components/DismissedCardsSheet.tsx
interface DismissedCardsSheetProps {
  dismissedCards: Recommendation[];     // legacy / solo path
  collabDismissedRows?: CollabDismissalRow[];  // NEW: collab path
  // ...
}

interface CollabDismissalRow {
  experience_id: string;
  card_data: any | null;
  swiped_at: string;
  user_id: string;
  display_name: string;
  is_me: boolean;
}

// Render: for each row, show the card + "passed by {display_name}" line.
// "passed by you" for is_me === true.
```

The decision of which list to render is at the parent (SwipeableCards.tsx) — collab mode passes `collabDismissedRows={useSessionDismissedCards(sessionId)}`; solo mode passes `dismissedCards={...local}`.

### Realtime layer

#### 2A.20 — `realtimeService.subscribeToBoardSession` — add swipe-state INSERT

Add a 14th postgres_changes subscription on the existing `board_session:{sessionId}` channel:

```typescript
{
  event: 'INSERT',
  schema: 'public',
  table: 'board_user_swipe_states',
  filter: `session_id=eq.${sessionId}`,
}
```

Fires `onSwipeRecorded(row)`. Consumers (`useSessionDismissedCards`) listen for `swipe_state='swiped_left'`; match-quorum consumers already exist via `onCardSaved` (no change).

#### 2A.21 — DELETE dead-code subscriptions

- `realtimeService.ts:615-627` — `INSERT session_decks` listener. Delete (table no longer exists).
- `useBoardSession.ts:353` — `queryClient.invalidateQueries({ queryKey: ['session-deck', sessionId] })`. Delete (no producer).
- `useBoardSession.ts:onDeckRegenerated` callback — was a no-op anyway. Delete.

#### 2A.22 — `onSessionUpdated` payload now carries `deck_version`

Already handled — `setSession((prev) => ({ ...prev, ...updatedSession }))` at `useBoardSession.ts:322` merges all columns. `deck_version` and `deck_params_hash` flow through automatically. The `useEffect` in §2A.15 reads `session.deck_version` and triggers transition only on exhaustion.

The `setAllParticipantPreferences` extraction at `useBoardSession.ts:326-332` becomes unused for collab params (server aggregates now), but is RETAINED because the WAITING_FOR_PARTICIPANTS state still uses `allParticipantPrefs.length` (CR-8 acceptedCount). No change required to the extraction logic.

### Migration / rollout

#### 2A.23 — Soft-cutover via `deck_model` column

All schema and code ships in one migration + commit (§2A.1–§2A.22). Existing sessions retain `deck_model='legacy_v1'` and continue running on the legacy client + edge function paths. New sessions default to `deck_model='deterministic_v2'`.

To control rollout, leave the DEFAULT on the column as `'legacy_v1'` initially. Operator flips the DEFAULT to `'deterministic_v2'` via a one-line follow-up migration:

```sql
ALTER TABLE public.collaboration_sessions
  ALTER COLUMN deck_model SET DEFAULT 'deterministic_v2';
```

Once flipped, all NEW sessions get the new behavior. Legacy in-flight sessions complete naturally on the old path.

After ~14 days (typical session lifetime), all legacy sessions should be `status='completed'` or `'archived'`. A second follow-up migration can drop legacy code paths in `discover-cards`, `RecommendationsContext`, etc.

#### 2A.24 — Edge function deployment

After the migration is applied, the orchestrator runs:

```bash
/Users/sethogieva/bin/supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv
```

`verify_jwt` setting must be preserved (it is `true` for discover-cards).

#### 2A.25 — Mobile build

EAS Update is required AFTER migration apply:

```bash
cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0902: deterministic collab deck"
```

No native module changes — OTA is sufficient.

---

## 2B — Per-CR Success Criteria

Each criterion has:
- **Happy-path** (HP-N): a scenario that proves the contract holds in the common case.
- **Adversarial** (ADV-N): a scenario that attacks a different angle than the happy path.

### CR-1 — Determinism contract

- **SC-1-HP-iOS / SC-1-HP-Android:** Two participants A and B in identical conditions (same city, both on GPS) fetch the collab deck simultaneously. Each compares `cards.map(c => c.id).join(',')` — must be byte-identical.
- **SC-1-ADV:** A's GPS is at (40.7128, -74.0060), B's GPS is at (40.7129, -74.0061) — slightly different (1m apart). Old behavior would key-divergent decks via `roundedLat`/`roundedLng` mismatch at the 3rd decimal place. New behavior: server reads `session.deck_version`, both fetch with `{session_id, deck_version=N}`, deck is byte-identical. Query keys also byte-identical.

### CR-2 — Union of per-participant reachable circles

- **SC-2-HP:** Two participants in same city. A on walking 20min (radius ~1.6km), B on driving 30min (radius ~18km). Deck pool contains: (i) places near A reachable by walking, (ii) places near B reachable by driving, (iii) places near both. A venue 5km from A but reachable by B-driving must appear in the deck (was excluded in legacy MOST PERMISSIVE single-anchor model from midpoint).
- **SC-2-ADV:** A in NYC + B in LA. Union has 2 disjoint circles. Deck contains venues from both metros. A venue in Chicago (midway, but in neither circle) does NOT appear.

### CR-3 — V_n exhaustion before V_{n+1}

- **SC-3-HP-iOS / SC-3-HP-Android:** A is mid-V_n at card index 7. A changes a pref. Server bumps `deck_version` from N to N+1. A continues swiping cards 7, 8, ... through to the last card of V_n. A's NEXT swipe after the last card shows V_{n+1} card #1. At no point does A see V_{n+1} cards interleaved with V_n cards.
- **SC-3-ADV:** A is on card 7. Multiple pref changes happen during V_n (other participants change prefs 3 times). Server's `deck_version` goes N → N+1 → N+2 → N+3 during A's session. When A finishes V_n's last card, A transitions to V_{N+3} (current latest), NOT to V_{N+1} or V_{N+2}. Intermediate versions never appear in A's UI.

### CR-4 — Resume rule

- **SC-4-HP:** A closes the app at V_n card 12. A reopens 1 hour later. No pref changes happened. A resumes at V_n card 12 (or the persisted cursor near it). Same deck content.
- **SC-4-ADV:** A closes at V_n card 12. Prefs change while A is offline (V_N+1 minted). A reopens. **Open question Q-A**: does A resume V_n (best-effort, server may not still have it) or jump to V_latest? Default per §2F: jump to V_latest with a "the group's preferences changed while you were away" banner.

### CR-5 — Late-join rule

- **SC-5-HP:** A and B are mid-V_n. C joins. Server: `INSERT session_participants` → trigger touches `collaboration_sessions.updated_at` → recompute_deck_version_on_prefs_change fires → params_hash changes (C's circle is now in the union) → `deck_version` → N+1. A and B keep swiping V_n. C fetches the collab deck → gets V_{N+1} card #1 (server returns current deck_version's deck for C since C has no pinned version yet). A and B transition to V_{N+1} on their next-V_n-exhaustion.
- **SC-5-ADV:** A is on V_n card 1 (basically just started). C joins immediately. A still finishes V_n (CR-3) — A does not skip ahead. C starts on V_{N+1} immediately. A and C may be looking at different decks for the entire duration of V_n.

### CR-6 — Visible-but-not-binding dismissal

- **SC-6-HP-iOS / SC-6-HP-Android:** A left-swipes card X. B opens their DismissedCardsSheet within 5 seconds — sees card X listed with "passed by A". B's deck still contains card X (does not appear in dismissed sheet on B's side until B left-swipes it themselves). Card X can still reach match quorum if 2+ participants (not including A) right-swipe it.
- **SC-6-ADV:** A left-swipes card X. B right-swipes card X 5 seconds later. C right-swipes card X 5 seconds after that. Match quorum reached (2 rights = B + C). Card X appears in `board_saved_cards`. A's left swipe is irrelevant to the quorum.

### CR-7 — Retired aggregation rules

- **SC-7-HP:** Code search `grep -rn "aggregateCollabPrefs" app-mobile/src/contexts/RecommendationsContext.tsx` returns ZERO matches (after refactor). Same for `?? userLocation` in the collab hook block.
- **SC-7-ADV:** Static analysis CI gate (strict-grep) blocks any future commit that re-introduces the patterns. See §2C invariants.

### CR-8 — Pre-existing thresholds preserved

- **SC-8-HP-1 (session-start):** A creates a session and accepts. No deck appears (UI shows WAITING_FOR_PARTICIPANTS). B accepts. Deck V_1 appears for both.
- **SC-8-HP-2 (match quorum):** A and B both right-swipe card Y. Card Y appears in `board_saved_cards` table immediately. Telemetry row appears in `match_telemetry_events`.
- **SC-8-ADV:** Single right-swipe by A on card Y — `board_saved_cards` does NOT receive a row. Toast shows "Liked — waiting for others." `match_telemetry_events` has a `collab_match_attempt` row but no `promoted_to_board_saved_cards` row.

---

## 2C — Invariants (additions to `Mingla_Artifacts/INVARIANT_REGISTRY.md`)

### I-PROPOSED-COLLAB-DETERMINISTIC
**Rule:** For `deck_model='deterministic_v2'` sessions, the deck function is a pure function of `(session_id, deck_version)`. Any code path that reads per-participant runtime state (device GPS, login order, swipe history, device time) and feeds it into deck generation is forbidden.
**Gate:** Strict-grep CI rule in `.github/workflows/strict-grep-app-mobile.yml` (new file or extend existing) — forbids the pattern `(?:collabDeckParams|collab.*deck.*params)\?\.location\s*\?\?\s*userLocation` and any new reference to `aggregateCollabPrefs` outside the deprecation stub.
**Sources:** CR-1, CR-7.

### I-PROPOSED-COLLAB-NO-CLIENT-AGGREGATION
**Rule:** Client-side aggregation of `participant_prefs` into deck params is removed. The collab deck fetch payload to `discover-cards` contains only `{ session_id, expected_deck_version }`.
**Gate:** Strict-grep on `deckService.ts` — forbids the simultaneous presence of `session_id` AND any of `location`/`categories`/`travelMode`/`dateWindows` in the same body literal for the collab branch.
**Sources:** CR-1, CR-7.

### I-PROPOSED-COLLAB-DECK-VERSION-MONOTONIC
**Rule:** `collaboration_sessions.deck_version` is monotonically non-decreasing for a given session. Triggers may only increment it (or leave it unchanged if hash unchanged); no path may decrement.
**Gate:** Runtime — the trigger function uses `COALESCE(NEW.deck_version, 0) + 1` and never assigns a smaller value. Implementor adds a CHECK constraint:
```sql
ALTER TABLE collaboration_sessions
  ADD CONSTRAINT deck_version_nonneg CHECK (deck_version >= 0);
```
**Sources:** CR-3, CR-5.

### I-PROPOSED-COLLAB-V_N-EXHAUSTION-RULE
**Rule:** Client does not advance `pinnedDeckVersion` from N to N+1 until the participant has swiped past V_n's last card (`hasExhaustedCurrentDeck === true`). The `useDeckCards` `deckVersion` param is bound to `pinnedDeckVersion`, never to `session.deck_version` directly.
**Gate:** Jest unit test in `app-mobile/src/contexts/__tests__/RecommendationsContext.collab.test.tsx` — simulates pref change mid-deck, asserts `pinnedDeckVersion` remains N until last-card swipe.
**Sources:** CR-3, CR-4.

### I-PROPOSED-COLLAB-DISMISSED-VISIBLE
**Rule:** `DismissedCardsSheet` in collab mode renders ALL rows from `board_user_swipe_states` with `swipe_state='swiped_left'` for the session, attributed by participant display name. The sheet's prop `collabDismissedRows` is sourced from `useSessionDismissedCards(sessionId)`, NOT from local AsyncStorage.
**Gate:** Jest component test asserts that when 2 participants left-swipe different cards, both rows appear in BOTH sheets.
**Sources:** CR-6.

### I-PROPOSED-COLLAB-MATCH-QUORUM-PRESERVED
**Rule:** The `check_mutual_like` trigger and `rpc_record_swipe_and_check_match` RPC behavior is unchanged. Left swipes write `swipe_state='swiped_left'` but do not feed the trigger; only `swiped_right` rows count toward quorum.
**Gate:** Existing match telemetry tests must continue to pass. Add one regression test: A left-swipes card X, B and C right-swipe card X → board_saved_cards INSERT occurs. A's left swipe is irrelevant.
**Sources:** CR-8.

---

## 2D — Test Cases

### Implementor-owned happy-path tests (required by Step 0.5 of CLOSE protocol)

Implementor MUST write these AND prove `fails-on-revert verified at <commit hash>` for each:

**T-IMPL-01: Determinism — two participants identical conditions, identical deck**
- Path: `supabase/functions/discover-cards/__tests__/orch_0902_determinism.test.ts` (Deno test) OR `app-mobile/src/services/__tests__/deckService.collab.determinism.test.ts`
- Scenario: Mock participant_prefs JSONB with two participants, identical custom_lat/lng, identical travel/categories. Call `pg_aggregate_collab_prefs` then `query_servable_places_by_signal_union` for each chip. Assert: returned `place_id` list is byte-identical across two consecutive calls.
- Fails-on-revert: revert §2A.6 `ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC` to drop the `pp.id ASC` tiebreaker. Test must FAIL.

**T-IMPL-02: V_n exhaustion buffer — pref change does not yank card**
- Path: `app-mobile/src/contexts/__tests__/RecommendationsContext.orch_0902.test.tsx`
- Scenario: Mount the context with a mock useBoardSession returning `session.deck_version=1`. Advance to card index 5. Simulate session update with `deck_version=2`. Assert: `pinnedDeckVersion === 1`, current card is still card 5 of V_1, NOT card 1 of V_2. Then simulate user swiping through cards 5..N (last card of V_1). Assert: `pinnedDeckVersion === 2`, current card is now card 1 of V_2.
- Fails-on-revert: revert §2A.15's `hasExhaustedCurrentDeck` gate; bind `deckVersion` directly to `session.deck_version`. Test must FAIL.

**T-IMPL-03: Union-of-circles inclusion**
- Path: `supabase/functions/__tests__/discover_cards.union.test.ts` OR SQL test.
- Scenario: Insert two test participants — A at (40.7, -74.0) walking 20min, B at (34.05, -118.25) driving 30min. Insert 3 test places: P1 inside A's circle only, P2 inside B's circle only, P3 outside both. Call edge function with `session_id`. Assert: response contains P1 and P2; does NOT contain P3.
- Fails-on-revert: revert §2A.6 `EXISTS (... ANY circle)` clause to single-anchor Haversine. Test must FAIL.

### Tester-owned adversarial tests (required by Step 0.5)

Tester MUST write these AND prove `fails-on-revert verified at <commit hash>` for each:

**T-TEST-01: Cross-city byte-identical deck**
- Path: `app-mobile/src/__tests__/orch_0902_cross_city.test.ts`
- Adversarial angle: attacks CR-1 + CR-2 simultaneously by maximizing geographic spread. A in NYC, B in LA. Two clients fetch `discover-cards` simultaneously with `session_id` only. Assert: `cards.map(c => c.id).join(',')` is byte-identical between the two responses AND deck contains venues from both NYC and LA areas (different from prior midpoint-in-PA bug).
- Fails-on-revert: revert §2A.9 to require client-sent `location`. Test must FAIL (clients send different locations now).

**T-TEST-02: Pref-change race at last-card swipe**
- Path: `app-mobile/src/contexts/__tests__/orch_0902_race.test.tsx`
- Adversarial angle: attacks CR-3 at the exact moment of cutover. Mount context at V_1 card N-1 (penultimate). Simultaneously fire (a) user swipes last card, (b) realtime delivers `session.deck_version=2`. Assert: user sees V_2 card #1 next, NOT V_2 card #2 (i.e., the transition fires AT or AFTER swipe completion, never BEFORE).
- Fails-on-revert: rewrite the transition effect to use a `useLayoutEffect` that fires before the swipe handler completes. Test must FAIL.

**T-TEST-03: Visible-but-not-binding dismissal composes with match quorum**
- Path: `app-mobile/src/components/__tests__/orch_0902_dismissal_quorum.test.tsx`
- Adversarial angle: attacks CR-6 + CR-8 composition. A left-swipes card X (writes `swipe_state='swiped_left'`). B right-swipes card X. C right-swipes card X. Assert: (i) card X appears in B's and C's `DismissedCardsSheet` with "passed by A" attribution; (ii) card X is in `board_saved_cards` for the session (match quorum reached via B+C); (iii) `match_telemetry_events` has `promoted_to_board_saved_cards` row.
- Fails-on-revert: revert §2A.17 to NOT call the RPC on left swipes. Test must FAIL (no `swiped_left` row → dismissed sheet empty).

**T-TEST-04 (smoke/parity, BOTH platforms): iOS + Android Maestro flow**
- Path: `tests/maestro/orch_0902_collab_deck.yaml`
- Two-device test: real iOS simulator + real Android emulator running same Maestro flow. Both join the same test session. Verify identical card order on both, identical attribution in dismissed sheet after one left-swipe.
- Tester runs via `~/.maestro/bin/maestro --device <iOS-UDID> test tests/maestro/orch_0902_collab_deck.yaml` AND `~/.maestro/bin/maestro --device <Android-AVD> test ...`. Both must PASS. If iOS passes and Android fails (or vice versa), surface as P1 platform-divergence.

---

## 2E — Rollback / Rollforward Plan

### Rollback (if deployment causes incidents)

The new system is gated by `collaboration_sessions.deck_model`. Rollback is non-destructive:

1. **Immediate kill-switch:** flip the DEFAULT back:
   ```sql
   ALTER TABLE public.collaboration_sessions
     ALTER COLUMN deck_model SET DEFAULT 'legacy_v1';
   ```
   New sessions revert to legacy behavior instantly. Existing `deterministic_v2` sessions continue running (the edge function still has both code paths).

2. **Mass rollback for in-flight sessions** (if needed):
   ```sql
   UPDATE public.collaboration_sessions
     SET deck_model = 'legacy_v1', deck_version = 0
     WHERE status IN ('pending', 'active', 'voting')
       AND deck_model = 'deterministic_v2';
   ```
   Triggers will no-op for legacy_v1 sessions. Clients on the new code that fetch a now-legacy session will fall through to the legacy code path (which still works). Slight UX hiccup but no data loss.

3. **Code-level rollback:** revert the entire commit. The schema columns remain (no DROP COLUMN needed); they sit unused. Triggers may continue to fire but are gated by `WHEN (NEW.deck_model = 'deterministic_v2')` so they no-op for all rolled-back sessions.

4. **Data preserved:** `board_user_swipe_states` rows with `swipe_state='swiped_left'` from the new system stay in the table. On rollback, the DismissedCardsSheet falls back to AsyncStorage-only (local); the server-side rows become orphaned but harmless.

### Rollforward

Once the system is verified stable for 14+ days and all legacy in-flight sessions have completed:

1. Drop legacy code paths in `discover-cards` (the entire pre-`if (body.session_id)` branch for collab is no longer needed — solo path stays).
2. Drop the stub at `app-mobile/src/utils/sessionPrefsUtils.ts`.
3. Drop the `WHEN (NEW.deck_model = 'deterministic_v2')` guards in triggers (all sessions are v2 by then).
4. Drop the `deck_model` column itself with a follow-up migration.

This rollforward is a separate ORCH and should NOT be bundled into ORCH-0902.

---

## 2F — Open Product Questions — Proposed Defaults

Listed in investigation §1E. Operator must accept or override before SPEC is finalized for IMPLEMENT dispatch.

**Q-1 — Participant with no usable location at all (GPS denied + no pin)**
*Proposed default:* Option (a) — they can join the session and contribute categories/intents/dates but their circle does NOT enter the union (since they have no location). Client renders a banner in the deck UI: "You haven't shared a location; the group's deck is based on the others." The aggregation function in §2A.5 already produces this behavior by filtering circles to rows with both `custom_lat` AND `custom_lng` non-null (or GPS-derived, see Q-G below).
*Rationale:* (b) "last-known location" is unreliable and may surface in unexpected sessions. (c) "block from joining" is hostile to permission-denied users. (a) preserves the social experience while honest about what's contributing to the deck.

**Q-2 — Anchor mutability (host kick / lock anchor)**
*Proposed default:* OUT OF SCOPE for this SPEC. The system is purely participant-driven. If the operator wants host controls later, file a separate ORCH; the schema already supports it (add a `participant_prefs[user_id].excluded_from_deck` flag and update §2A.5 to honor it).
*Rationale:* Not in CR-1..CR-8. Adding host controls expands the surface unnecessarily for V_1 of the deterministic rewrite.

**Q-3 — Multi-day `selected_dates` UNION under deck_version transitions**
*Proposed default:* No special handling. Date prefs feed into params_hash like any other field. Pref change → hash change → deck_version bump → V_n exhaustion → V_{n+1} reflects new date union. No new mechanism needed.
*Rationale:* Treating dates specially would violate CR-3's uniform "every pref change works the same way" model.

**Q-4 — Match quorum across deck_version transitions**
*Proposed default:* Preserve current behavior. Swipes are session-scoped, not version-scoped. `board_user_swipe_states` is keyed by (session_id, experience_id, user_id) — no version column. If A right-swipes card X in V_n and B right-swipes card X in V_{n+2}, the trigger sees 2 rights for (session, X) and promotes. Match quorum is invariant across deck versions for a given card.
*Rationale:* Matches the user's mental model: "we both liked this place" — version is invisible to them.

**Q-5 — Per-participant exclusion of already-swiped cards from displayed V_n**
*Proposed default:* Per-participant client-side filter. The deck V_n list is the shared determinism contract; each participant locally hides cards they've already swiped (left OR right). Implementation: `excludeCardIds` becomes a server-passed param to discover-cards based on the current user's `board_user_swipe_states` rows for this session. Server filters them out before returning the deck — but the *underlying ordered list* is the same.

   Wait — that violates CR-1. If A has swiped 5 cards and B has swiped 3 different cards, server-filtering produces different per-user decks. Revise:

*Revised default:* The server returns the FULL shared deck for `(session_id, deck_version)`. Client locally hides cards the current user has already swiped. The deck identity (ordered list) is the same; the displayed slice differs per user. This preserves CR-1 strictly.
*Rationale:* Determinism contract holds at the deck level. Per-user display filtering is presentation-layer only and does not affect deck identity.

**Q-6 — PostGIS availability / performance ceiling**
*Proposed default:* SPEC provides both paths (§2A.6 A and B). Implementor verifies with `SELECT 1 FROM pg_extension WHERE extname='postgis'`. If PostGIS is present, use Path A. If not, use Path B with a CHECK constraint `CHECK (array_length(circles, 1) <= 50)` in `pg_aggregate_collab_prefs` (raise an exception if more than 50 participants). Operator decides whether to enable PostGIS as a separate decision.
*Rationale:* Don't block this ORCH on a database extension decision. Both paths produce equivalent semantics.

**Q-7 — Migration path for in-flight sessions**
*Proposed default:* Option (b) soft-cutover via `deck_model` column. Already detailed in §2A.1 and §2A.23.
*Rationale:* Zero-disruption for existing users; new users get the new behavior; legacy code paths are cleaned up in a separate follow-up ORCH after 14+ days.

**Q-A (new, surfaced during SPEC writing) — Deterministic rebuild of past deck versions for CR-4 resume**
The CR-4 resume rule says a user re-entering mid-V_n resumes at their cursor in V_n. But if `participant_prefs` has changed since V_n was minted, the server cannot re-derive V_n from current state — the params have moved on.

*Three options:*
- (i) Persist deck snapshots per `(session_id, deck_version)` in a new `session_deck_snapshots` table. Server reads the exact V_n snapshot on rejoin.
- (ii) Persist params history per `(session_id, deck_version)` in a new `session_deck_versions` table (stores the params_hash + aggregated jsonb only — not cards). Server re-derives the deck from frozen params. Storage-efficient because deterministic.
- (iii) Best-effort resume: on rejoin, if `pinnedDeckVersion < session.deck_version`, force-transition to V_latest with a banner.

*Proposed default:* Option (ii) — persist params history per version. Storage cost is small (one row per version, maybe ~50-100 rows per session lifetime). Server re-derives deck on demand. Preserves CR-4 fully while keeping per-card storage out.

*Schema for option (ii):*
```sql
CREATE TABLE public.session_deck_versions (
  session_id uuid NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  deck_version int NOT NULL,
  params_hash text NOT NULL,
  aggregated_params jsonb NOT NULL,
  minted_at timestamptz DEFAULT now(),
  PRIMARY KEY (session_id, deck_version)
);

-- Trigger that wrote to it: extend recompute_deck_version_on_prefs_change to
-- also INSERT into session_deck_versions when bumping.
```

**Operator: please decide on Q-1, Q-6, Q-7, Q-A.** Q-2, Q-3, Q-4, Q-5 are answered by the defaults above and will be locked into SPEC unless overridden.

---

## Cross-references

- **Locked contract:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md`](../reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md) — CR-1..CR-8
- **Deep investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md`](../reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md)
- **Dispatch prompt:** [`Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md`](../prompts/INVESTIGATOR_SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md)
- **Durable memory:** `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_collab_deck_determinism_contract.md`

---

### Layman summary of the report

- **Schema gains three new columns on `collaboration_sessions`** — `deck_version` (counts up every time the deck should refresh), `deck_params_hash` (SHA-256 of the aggregated state — drives the version bump), and `deck_model` (a flag that keeps old in-flight sessions on the old code path while new sessions use the new path).
- **One new index on `board_user_swipe_states`** supports listing left swipes by session. No other table schema changes.
- **One new SQL function `pg_aggregate_collab_prefs`** runs the aggregation server-side. Returns the canonical params + an array of per-participant reachable circles. The client no longer aggregates anything.
- **One new SQL function `query_servable_places_by_signal_union`** queries places that fall inside ANY of the participant circles. Two implementations are provided — PostGIS (faster) and raw Haversine (works without PostGIS). Implementor verifies which is available and picks one.
- **Two new triggers** on `collaboration_sessions` and `session_participants` keep `deck_version` correctly bumped whenever something material changes.
- **`discover-cards` edge function gains a new mode** — when given `session_id` and the session is `deterministic_v2`, it reads everything server-side and returns `cards + deck_version`. Legacy mode and solo mode unchanged.
- **Client retires `aggregateCollabPrefs` and the `?? userLocation` fallback.** Collab decks now send only `{ session_id, expected_deck_version }` to the edge function. The query key becomes `['deck-cards', 'collab', sessionId, deckVersion]` — three things, none of which are per-client.
- **Client gains a V_n exhaustion state machine.** Holds `pinnedDeckVersion`. When `session.deck_version` rises but the user hasn't finished V_n, the client keeps showing V_n. On last-card swipe, the client jumps to V_latest. Pref changes never yank a card mid-view.
- **`deckStateRegistry` is extended** to remember which version each session was on, supporting resume.
- **Left swipes now write to the server** via the existing `rpc_record_swipe_and_check_match` RPC (which already accepts `'left'` direction). A new `useSessionDismissedCards` hook reads all session left swipes with realtime updates. The `DismissedCardsSheet` shows them attributed by participant name. The card stays in everyone else's deck — no veto.
- **Match quorum (≥2 right-swipes) is untouched.** The `check_mutual_like` trigger still only fires on right swipes. Left swipes are persisted but ignored by the trigger.
- **Two pieces of dead code are deleted** — the `session_decks` INSERT listener and the `['session-deck', sessionId]` invalidation. They've been dead since ORCH-0446.
- **Five new invariants are added** to the registry: deterministic contract, no-client-aggregation, deck_version monotonic, V_n exhaustion rule, and dismissed-visible. Strict-grep CI gates and Jest tests enforce them.
- **Six test cases are required** for the regression-test gate at CLOSE: three implementor-owned (determinism, V_n exhaustion buffer, union-of-circles inclusion) + three tester-owned (cross-city deck byte-identical, pref-change race at last-card swipe, dismissal+quorum composition). All must demonstrate `fails-on-revert` per the Step 0.5 protocol. Plus one Maestro parity flow run on iOS + Android.
- **Rollback is non-destructive** — flip the `deck_model` DEFAULT back to `'legacy_v1'` and existing sessions revert immediately. No DROP COLUMN required. The schema additions sit dormant.
- **Four open questions remain** for operator decision: Q-1 (no-location participant policy → proposed: allow join, banner, no contribution to union), Q-6 (PostGIS availability → implementor verifies), Q-7 (migration path → proposed: soft-cutover via deck_model column), Q-A (resume across deck versions → proposed: persist per-version params history in a new small table so server can re-derive any V_n on demand).
- **Cross-surface impact:** Consumer iOS + Consumer Android only. No business / admin / buyer-web surfaces touched. iOS+Android parity is automatic via shared React Native code; tester must still exercise both simulators independently to catch any platform divergence.
- **Implementation order:** schema migration → new SQL functions → triggers → edge function modification → client retirement of old aggregation → client V_n exhaustion state machine → left-swipe RPC integration → useSessionDismissedCards hook → DismissedCardsSheet attribution UI → realtime swipe-state subscription → dead-code cleanup → tests.
- **Estimated commit count:** 1 PR per CLOSE rule, but the diff is large. SPEC is structured so the implementor can land it incrementally if needed (schema + RPCs first, behind the `deck_model` flag, then client changes once new sessions exist to test against).
