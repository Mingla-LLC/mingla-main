-- Issue #1612 — "record-visit returns 500 on every call in production".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MEASURED ROOT CAUSE (production gqnoajqerqhnvulmnyvv, PostgreSQL 17.6, 2026-08-04)
-- ─────────────────────────────────────────────────────────────────────────────
-- The ONLY unique index covering (user_id, experience_id) on public.user_visits was:
--
--   CREATE UNIQUE INDEX user_visits_unique_active
--     ON public.user_visits USING btree (user_id, experience_id)
--     WHERE (user_id IS NOT NULL);          -- ← PARTIAL
--
-- The record-visit edge function writes through supabase-js:
--   .upsert({...}, { onConflict: "user_id,experience_id" })
-- PostgREST renders that as a bare `ON CONFLICT (user_id, experience_id)` with NO
-- predicate. Postgres only accepts a PARTIAL index as an ON CONFLICT arbiter when the
-- statement repeats the index predicate — and PostgREST has no syntax to emit one, so a
-- partial index can NEVER arbitrate a supabase-js upsert. Postgres refused to plan it:
--
--   ERROR: 42P10: there is no unique or exclusion constraint matching the
--                 ON CONFLICT specification
--
-- Captured directly against production with a non-executing EXPLAIN of the exact
-- statement shape. Corroborating measurement: public.user_visits held 0 rows — the
-- feature had never successfully written a single row since the index was created.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR — replace the partial unique index with a real, named UNIQUE constraint
-- ─────────────────────────────────────────────────────────────────────────────
-- This is SEMANTICALLY IDENTICAL to what the partial index enforced. Under Postgres'
-- default NULLS DISTINCT rule, two rows with a NULL user_id are never equal to each
-- other, so a full unique index constrains exactly the same row set the partial index
-- did. The `WHERE user_id IS NOT NULL` predicate excluded rows that a full index would
-- never have constrained anyway — it was redundant, and it was the thing that broke
-- ON CONFLICT.
--
-- We deliberately do NOT use NULLS NOT DISTINCT (PG15+). That WOULD change behaviour:
-- user_visits.user_id is nullable because its FK is ON DELETE SET NULL, so a deleted
-- user's visits all collapse to user_id = NULL. NULLS NOT DISTINCT would then collapse
-- every deleted user's visit to one row per experience_id and destroy data.
--
-- Alternatives considered and rejected:
--   * Repeat the index predicate in the ON CONFLICT target — NOT reachable from
--     supabase-js `.upsert()`; it would require rewriting the write path as a raw-SQL
--     RPC for zero semantic gain over a real constraint.
--   * Explicit select-then-insert — strictly worse under concurrency: two racing
--     sessions can both miss the SELECT and both INSERT, which yields either duplicate
--     rows (no constraint) or a 23505 the caller must catch and retry (with one). It
--     would ALSO still need this constraint to be safe.
--
-- CONCURRENCY BEHAVIOUR of the chosen repair:
--   `INSERT ... ON CONFLICT DO UPDATE` against a real constraint uses Postgres
--   speculative insertion. On a double-tap, or two devices racing, exactly ONE row
--   results: the losing session detects the conflict, waits on the winner's row lock,
--   then takes the DO UPDATE branch. No duplicate row, no 23505 surfaced to the client,
--   no lost write; last writer wins on visited_at/card_data.
--   The AFTER INSERT trigger fires exactly once, because the conflicting session takes
--   the UPDATE path and an AFTER INSERT trigger does not fire for it. Engagement is
--   therefore counted once per (user, place) — a guarantee select-then-insert could not
--   make.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ALSO FIXED HERE — fan_visit_to_engagement mislabelled every visit
-- ─────────────────────────────────────────────────────────────────────────────
-- fan_visit_to_engagement() wrote event_kind = 'scheduled' for a VISIT, so every visit
-- would have landed in engagement_metrics indistinguishable from a calendar scheduling.
-- Its sibling fan_review_to_engagement() correctly writes 'reviewed', which shows the
-- intended design is one distinct kind per event type.
--
-- ORDER IS LOAD-BEARING: the CHECK constraint is widened to accept 'visited' BEFORE the
-- function is changed to write it. If the function shipped first, every visit would trip
-- engagement_metrics_event_kind_check — and because the trigger body ends in
-- `EXCEPTION WHEN OTHERS THEN RAISE WARNING`, that violation would be SWALLOWED. The
-- visit row would still be written and engagement would silently stop being recorded.
-- A wrong-order deploy turns a data-labelling bug into silent data loss.
--
-- NO BACKFILL IS REQUIRED, and none is performed. Measured: user_visits has 0 rows, so
-- this trigger has never fired. The 3 existing 'scheduled' rows in engagement_metrics
-- all carry a non-NULL `category`, which fan_visit_to_engagement never writes (it always
-- passes NULL) — they came from record_engagement, the calendar path. There is no
-- mislabelled visit data in production to repair.
--
-- record_engagement()'s own event_kind whitelist is deliberately NOT widened to accept
-- 'visited'. Visit engagement must stay trigger-driven off an actual user_visits row;
-- letting clients pass 'visited' to the RPC would allow forging visit engagement with no
-- corresponding visit.

BEGIN;

-- ── 1. Read-only invariant probe ────────────────────────────────────────────────
-- Fail loudly rather than half-applying if the data cannot satisfy the new constraint.
DO $$
DECLARE
  v_dups BIGINT;
BEGIN
  SELECT count(*) INTO v_dups
  FROM (
    SELECT user_id, experience_id
    FROM public.user_visits
    WHERE user_id IS NOT NULL
    GROUP BY user_id, experience_id
    HAVING count(*) > 1
  ) d;

  IF v_dups > 0 THEN
    RAISE EXCEPTION
      'issue #1612 aborted: % duplicate (user_id, experience_id) group(s) in public.user_visits; deduplicate before adding the UNIQUE constraint',
      v_dups;
  END IF;
END $$;

-- ── 2. Add the real UNIQUE constraint FIRST ─────────────────────────────────────
-- Added before the partial index is dropped so uniqueness is never left unprotected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_visits'
      AND c.conname = 'user_visits_user_id_experience_id_key'
  ) THEN
    ALTER TABLE public.user_visits
      ADD CONSTRAINT user_visits_user_id_experience_id_key
      UNIQUE (user_id, experience_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT user_visits_user_id_experience_id_key ON public.user_visits IS
  'Issue #1612: ON CONFLICT arbiter for record-visit. MUST stay a full (non-partial) '
  'constraint — PostgREST cannot emit an index predicate, so a partial unique index '
  'here raises 42P10 and every record-visit call 500s. Do not add NULLS NOT DISTINCT: '
  'user_id is nullable via ON DELETE SET NULL and that would collapse deleted users '
  'visits.';

-- ── 3. Retire the partial index that could never arbitrate ──────────────────────
DROP INDEX IF EXISTS public.user_visits_unique_active;

-- ── 4. Widen the engagement CHECK to accept 'visited' (BEFORE step 5) ───────────
ALTER TABLE public.engagement_metrics
  DROP CONSTRAINT IF EXISTS engagement_metrics_event_kind_check;

ALTER TABLE public.engagement_metrics
  ADD CONSTRAINT engagement_metrics_event_kind_check
  CHECK (event_kind = ANY (ARRAY[
    'served'::text,
    'seen_deck'::text,
    'seen_expand'::text,
    'saved'::text,
    'scheduled'::text,
    'reviewed'::text,
    'visited'::text
  ]));

-- ── 5. Stop mislabelling visits as 'scheduled' ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fan_visit_to_engagement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_place_pool_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- user_visits.experience_id is TEXT holding google_place_id
    SELECT pp.id INTO v_place_pool_id
    FROM public.place_pool pp
    WHERE pp.google_place_id = NEW.experience_id
    LIMIT 1;

    -- If no matching place_pool row, skip silently (place was delisted)
    IF v_place_pool_id IS NOT NULL THEN
      INSERT INTO public.engagement_metrics
        (user_id, event_kind, place_pool_id, container_key, experience_type, category, stop_index, created_at)
      VALUES
        (NEW.user_id, 'visited', v_place_pool_id, NULL, NULL, NULL, NULL, NEW.created_at);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fan_visit_to_engagement failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION public.fan_visit_to_engagement() IS
  'ORCH-0640: replaces the doomed update_card_pool_visit_count. Fires on user_visits '
  'INSERT. Resolves google_place_id -> place_pool_id at fire time. '
  'Issue #1612: writes event_kind = ''visited'' (previously mislabelled ''scheduled'', '
  'which made every visit indistinguishable from a calendar scheduling). The value must '
  'stay inside engagement_metrics_event_kind_check — this body swallows exceptions, so a '
  'value outside the CHECK silently drops engagement rows instead of failing loudly.';

COMMIT;
