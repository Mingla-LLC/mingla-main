-- ORCH-0824 — Event taxonomy columns + city column + indexes + CHECK constraints + backfill.
--
-- Adds four new top-level columns to public.events:
--   - city           text       (populated from Google Places autocomplete at publish)
--   - party_types    text[]     (multi-select; corrections block §A of SPEC; was singular pre-correction)
--   - vibe_tags      text[]     (multi-select)
--   - music_genres   text[]     (multi-select)
--
-- Replaces the legacy free-form `category` field that was buried in
-- events.theme.business_event.category JSONB (per ORCH-0824 investigation
-- finding A-3). The legacy JSONB is left in place as audit trail; no DROP.
--
-- Canonical slug lists are duplicated here AND in three eventTaxonomy.ts
-- modules (supabase/_shared, mingla-business, app-mobile). Parity is
-- enforced by CI strict-grep gates added in steps 21-22.
--
-- Indexes are partial to publishable rows only (visibility=public AND
-- status IN scheduled,live AND deleted_at IS NULL) to keep index size
-- tight and match the discover-merged-events edge function query shape.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md
--      Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md
--      I-PROPOSED-EVENT-CITY-CANONICAL, I-PROPOSED-EVENT-TAXONOMY-CANONICAL,
--      I-PROPOSED-EVENT-CATEGORY-FROZEN, I-PROPOSED-EVENT-TAXONOMY-PARITY.

BEGIN;

-- (1) Column adds ----------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS party_types   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS vibe_tags     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS music_genres  text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.events.city IS
  'ORCH-0824: normalized city (locality) populated from Google Places autocomplete at publish. NULL allowed for legacy rows; new published rows enforced non-null by business_publish_event_draft RPC. I-PROPOSED-EVENT-CITY-CANONICAL.';

COMMENT ON COLUMN public.events.party_types IS
  'ORCH-0824: multi-select party-type slugs (e.g. {club-night,rooftop-party}). Canonical list in eventTaxonomy.ts. Required at publish (array_length >= 1). I-PROPOSED-EVENT-TAXONOMY-CANONICAL.';

COMMENT ON COLUMN public.events.vibe_tags IS
  'ORCH-0824: multi-select vibe slugs (e.g. {energetic,wild}). Canonical list in eventTaxonomy.ts. Optional at publish. I-PROPOSED-EVENT-TAXONOMY-CANONICAL.';

COMMENT ON COLUMN public.events.music_genres IS
  'ORCH-0824: multi-select Mingla music-genre slugs (e.g. {electronic-edm,hiphop-rap}). Canonical list in eventTaxonomy.ts. Optional at publish. Mingla↔TM mapping in supabase/functions/_shared/eventTaxonomy.ts. I-PROPOSED-EVENT-TAXONOMY-CANONICAL.';

-- (2) CHECK constraints — canonical-subset enforcement ---------------------
--
-- Drop-if-exists guards make this migration safely re-runnable.

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_party_types_canonical,
  DROP CONSTRAINT IF EXISTS events_vibe_tags_canonical,
  DROP CONSTRAINT IF EXISTS events_music_genres_canonical;

ALTER TABLE public.events
  ADD CONSTRAINT events_party_types_canonical CHECK (
    party_types <@ ARRAY[
      'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
      'beach-party','pool-party','boat-party','themed-party','corporate-event',
      'graduation-party','holiday-party','networking-event','rave','festival'
    ]::text[]
  ),
  ADD CONSTRAINT events_vibe_tags_canonical CHECK (
    vibe_tags <@ ARRAY[
      'energetic','chill','intimate','wild','classy','casual','upscale','underground',
      'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
    ]::text[]
  ),
  ADD CONSTRAINT events_music_genres_canonical CHECK (
    music_genres <@ ARRAY[
      'electronic-edm','hiphop-rap','pop','rock','latin','afrobeats','rnb-soul',
      'disco-funk','reggae-dancehall','indie','country','jazz','classical','mixed-variety'
    ]::text[]
  );

-- (3) Indexes --------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_events_city_published;
DROP INDEX IF EXISTS public.idx_events_party_types_gin;
DROP INDEX IF EXISTS public.idx_events_vibe_tags_gin;
DROP INDEX IF EXISTS public.idx_events_music_genres_gin;

CREATE INDEX idx_events_city_published
  ON public.events (city)
  WHERE deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled','live');

CREATE INDEX idx_events_party_types_gin
  ON public.events USING gin (party_types)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_events_vibe_tags_gin
  ON public.events USING gin (vibe_tags)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_events_music_genres_gin
  ON public.events USING gin (music_genres)
  WHERE deleted_at IS NULL;

-- (4) Backfill — party_types from legacy theme.business_event.category ----
--
-- Best-effort mapping. Honest empty arrays for ambiguous values rather
-- than fabricated party-types. Brands re-publish to set proper values.
-- City is NOT backfilled (no reliable derivation from free-text location_text).

UPDATE public.events
SET party_types = CASE theme->'business_event'->>'category'
  WHEN 'Nightlife' THEN ARRAY['club-night']
  WHEN 'Festival'  THEN ARRAY['festival']
  WHEN 'Private'   THEN ARRAY['house-party']
  -- Ambiguous (Concert / Brunch / Workshop / Pop-up / Other) → empty array.
  ELSE ARRAY[]::text[]
END
WHERE coalesce(array_length(party_types, 1), 0) = 0
  AND theme->'business_event'->>'category' IS NOT NULL;

-- (5) Self-verify probes — must return 0 rows ------------------------------
--
-- These DO blocks are diagnostic; they RAISE NOTICE counts after the
-- backfill so the operator can see post-state without a second query.

DO $$
DECLARE
  v_total bigint;
  v_with_party_types bigint;
  v_legacy_with_no_mapping bigint;
  v_canonical_violations bigint;
BEGIN
  SELECT count(*) INTO v_total FROM public.events;
  SELECT count(*) INTO v_with_party_types
    FROM public.events
    WHERE coalesce(array_length(party_types, 1), 0) > 0;
  SELECT count(*) INTO v_legacy_with_no_mapping
    FROM public.events
    WHERE coalesce(array_length(party_types, 1), 0) = 0
      AND theme->'business_event'->>'category' IS NOT NULL;

  -- Canonical violations should be 0 — the CHECK constraint already
  -- guarantees this. Belt-and-braces probe so a future loose insert
  -- (e.g. via service-role bypassing app validation) gets flagged here.
  SELECT count(*) INTO v_canonical_violations
    FROM public.events
    WHERE NOT (party_types <@ ARRAY[
        'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
        'beach-party','pool-party','boat-party','themed-party','corporate-event',
        'graduation-party','holiday-party','networking-event','rave','festival'
      ]::text[]);

  RAISE NOTICE 'ORCH-0824 backfill complete — total=% with_party_types=% legacy_with_no_mapping=% canonical_violations=%',
    v_total, v_with_party_types, v_legacy_with_no_mapping, v_canonical_violations;

  IF v_canonical_violations > 0 THEN
    RAISE EXCEPTION 'ORCH-0824 backfill produced canonical violations (% rows). This should be impossible — investigate.',
      v_canonical_violations;
  END IF;
END $$;

COMMIT;
