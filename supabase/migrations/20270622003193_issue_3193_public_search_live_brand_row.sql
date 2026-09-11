-- issue #3193 — the public resolver must read the LIVE brand row.
--
-- `public.public_search_source_facts` selected the brand with
-- `WHERE b.slug = v_parts[2] LIMIT 1`: no `deleted_at` filter and no `ORDER BY`.
-- Soft delete leaves the row, and `idx_brands_slug_active` only constrains LIVE
-- rows, so a host who deletes and recreates a brand leaves several rows sharing
-- one slug. Postgres then returned an arbitrary one. In production `lanternroom`
-- had three rows (two soft-deleted) and the resolver read a tombstone, whose
-- `deleted_at` is set, so the brand branch yielded `sourceState='draft'`,
-- `resolve_public_search_document` returned `state='draft'`, and
-- `handlePublicSearchDocument` served 404 for a live brand.
--
-- This migration changes WHICH ROW the brand predicate is evaluated against. It
-- does NOT change the predicate. Every path into `draft` enumerated in the #3193
-- investigation (D1 brand soft-deleted, D2 account soft-deleted, D3 unverified
-- physical brand with nothing published, D4 unknown slug or no creator account,
-- D5 path/kind mismatch, D6 archived ledger row) is preserved byte-for-byte, and
-- no brand that is hidden before this migration is reachable after it.
--
-- `plpgsql` has no partial replace, so the whole body is re-emitted. Everything
-- except the brand branch's row selection is byte-identical to
-- `20270614002986_issue_2986_public_search_documents.sql` lines 350-465, which is
-- deliberately left untouched (three CI gates pin that file).
--
-- Event/trip/experience and venue row selection are NOT changed here. They carry
-- the same unfiltered `WHERE b.slug=`; the event branch is protected only
-- accidentally by `ORDER BY ed.start_at NULLS LAST`, which does not hold for an
-- event with no master `event_dates` row. That is #3193's OQ-1, left open by the
-- orchestrator and deliberately not scoped in here.

BEGIN;

CREATE OR REPLACE FUNCTION public.public_search_source_facts(p_path text, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_parts text[] := string_to_array(trim(both '/' from p_path),'/');
  v_facts jsonb;
  v_source_state text := 'missing';
BEGIN
  IF public.public_search_path_kind(p_path) IS DISTINCT FROM p_kind THEN
    RETURN jsonb_build_object('sourceState','invalid','facts',NULL);
  END IF;

  IF p_kind IN ('event','trip','experience') THEN
    SELECT
      CASE
        WHEN e.id IS NULL THEN 'missing'
        WHEN b.deleted_at IS NOT NULL OR ca.deleted_at IS NOT NULL
          OR e.deleted_at IS NOT NULL OR e.status='draft'
          OR NOT public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct') THEN 'draft'
        WHEN (p_kind='event' AND e.event_type NOT IN ('event','rsvp'))
          OR (p_kind='trip' AND e.event_type<>'trip')
          OR (p_kind='experience' AND e.event_type<>'experience') THEN 'missing'
        ELSE 'visible' END,
      CASE WHEN e.id IS NOT NULL AND b.deleted_at IS NULL AND ca.deleted_at IS NULL AND e.deleted_at IS NULL
        AND e.status<>'draft' AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')
        AND ((p_kind='event' AND e.event_type IN ('event','rsvp')) OR e.event_type=p_kind)
      THEN jsonb_strip_nulls(jsonb_build_object(
        'kind',p_kind,'id',e.id,'brandId',b.id,'brandSlug',b.slug,'brandName',b.name,
        'slug',e.slug,'title',e.title,'description',e.description,'status',e.status,'eventType',e.event_type,
        'visibility',e.visibility,'startAt',ed.start_at,'endAt',ed.end_at,
        'timezone',COALESCE(ed.timezone,e.timezone),'isOnline',e.is_online,
        'location',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END,
        'city',e.city,'imageUrl',e.cover_media_url,'imageType',e.cover_media_type,
        'imageAlt',e.cover_media_alt,'destination',CASE WHEN p_kind='trip' THEN COALESCE(e.destination_text,e.theme #>> '{business_trip,destinationLocationText}') END,
        'departure',CASE WHEN p_kind='trip' THEN COALESCE(e.departure_text,e.theme #>> '{business_trip,departureLocationText}') END,
        'venue',CASE WHEN p_kind='experience' THEN COALESCE(
          NULLIF(e.theme #>> '{experience_meta,venue_text}',''),
          (SELECT CASE WHEN public.issue_2489_address_withheld(e.theme) THEN s.place_name ELSE COALESCE(NULLIF(s.address,''),s.place_name) END
             FROM public.experience_stops s WHERE s.event_id=e.id ORDER BY s.stop_order LIMIT 1)) END,
        'priceCents',pricing.price_cents,'currency',pricing.currency,'isFree',pricing.is_free,
        'actionAvailable',CASE
          WHEN e.status NOT IN ('scheduled','live') OR ed.end_at IS NULL OR ed.end_at <= now() THEN false
          WHEN e.event_type='rsvp' THEN true
          ELSE pricing.price_cents IS NOT NULL END,
        'sourceUpdatedAt',GREATEST(
          e.updated_at,b.updated_at,COALESCE(ed.updated_at,e.updated_at),
          COALESCE(pricing.updated_at,e.updated_at),COALESCE(stop_meta.updated_at,e.updated_at)))) END
    INTO v_source_state,v_facts
    FROM public.brands b
    JOIN public.creator_accounts ca ON ca.id=b.account_id
    LEFT JOIN public.events e ON e.brand_id=b.id AND e.slug=v_parts[3]
    LEFT JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master
    LEFT JOIN LATERAL (
      SELECT min(tt.price_cents) AS price_cents,
        (array_agg(btrim(tt.currency::text) ORDER BY tt.price_cents,tt.display_order))[1] AS currency,
        bool_and(tt.is_free OR tt.price_cents=0) AS is_free,
        max(tt.updated_at) AS updated_at
      FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND NOT tt.is_hidden AND NOT tt.is_disabled
        AND tt.available_online AND (tt.sale_start_at IS NULL OR tt.sale_start_at<=now())
        AND (tt.sale_end_at IS NULL OR tt.sale_end_at>now())
    ) pricing ON true
    LEFT JOIN LATERAL (
      SELECT max(s.updated_at) AS updated_at
      FROM public.experience_stops s
      WHERE p_kind='experience' AND s.event_id=e.id
    ) stop_meta ON true
    WHERE b.slug=v_parts[2]
    ORDER BY ed.start_at NULLS LAST LIMIT 1;
  ELSIF p_kind='brand' THEN
    SELECT CASE WHEN b.deleted_at IS NULL AND ca.deleted_at IS NULL AND (
      b.kind IS DISTINCT FROM 'physical' OR b.claim_status='verified' OR EXISTS (
        SELECT 1 FROM public.events e WHERE e.brand_id=b.id AND e.status IN ('scheduled','live','ended','cancelled')
          AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')))
      THEN 'visible' ELSE 'draft' END,
      CASE WHEN b.deleted_at IS NULL AND ca.deleted_at IS NULL AND (
        b.kind IS DISTINCT FROM 'physical' OR b.claim_status='verified' OR EXISTS (
          SELECT 1 FROM public.events e WHERE e.brand_id=b.id AND e.status IN ('scheduled','live','ended','cancelled')
            AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')))
      THEN jsonb_strip_nulls(jsonb_build_object(
        'kind','brand','id',b.id,'brandSlug',b.slug,'brandName',b.name,'title',b.name,
        'description',b.description,'imageUrl',COALESCE(b.cover_media_url,b.profile_photo_url),
        'imageType',COALESCE(b.cover_media_type,'image'),
        'sourceUpdatedAt',GREATEST(b.updated_at,COALESCE(inventory.updated_at,b.updated_at)),
        'eventCount',inventory.event_count)) END
    INTO v_source_state,v_facts FROM public.brands b
    JOIN public.creator_accounts ca ON ca.id=b.account_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS event_count,max(e.updated_at) AS updated_at
      FROM public.events e
      WHERE e.brand_id=b.id AND e.status IN ('scheduled','live')
        AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'listing')
    ) inventory ON true
    -- #3193 — `LIMIT 1` with no `deleted_at` filter and no `ORDER BY` returned an
    -- arbitrary row. Lantern Room had three rows under one slug (two soft-deleted)
    -- and the resolver read a tombstone, so a live brand's public page 404'd.
    -- `idx_brands_slug_active` (UNIQUE (lower(slug)) WHERE deleted_at IS NULL)
    -- guarantees at most one live row per slug; this ordering is how the resolver
    -- honours it. Do not drop the `(b.deleted_at IS NULL) DESC` key. The trailing
    -- `created_at DESC, id` keys make the all-tombstones case deterministic too;
    -- it still resolves `draft`, unchanged.
    WHERE b.slug=v_parts[2]
    ORDER BY (b.deleted_at IS NULL) DESC, b.created_at DESC, b.id
    LIMIT 1;
  ELSIF p_kind='venue' THEN
    SELECT CASE WHEN v.claim_status='verified' AND b.deleted_at IS NULL AND ca.deleted_at IS NULL THEN 'visible' ELSE 'draft' END,
      CASE WHEN v.claim_status='verified' AND b.deleted_at IS NULL AND ca.deleted_at IS NULL THEN jsonb_strip_nulls(jsonb_build_object(
        'kind','venue','id',v.id,'brandId',b.id,'brandSlug',b.slug,'brandName',b.name,
        'slug',v.slug,'title',v.name,'description',COALESCE(pp.generative_summary,b.description),
        'city',v.city,'countryCode',v.country_code,'imageUrl',v.cover_media_url,
        'imageType',v.cover_media_type,
        'sourceUpdatedAt',GREATEST(v.updated_at,b.updated_at,COALESCE(pp.updated_at,v.updated_at)))) END
    INTO v_source_state,v_facts
    FROM public.brands b JOIN public.venue_listings v ON v.brand_id=b.id
    JOIN public.creator_accounts ca ON ca.id=b.account_id
    LEFT JOIN public.place_pool pp ON pp.id=v.place_pool_id
    WHERE b.slug=v_parts[2] AND v.slug=v_parts[4] LIMIT 1;
  END IF;

  RETURN jsonb_build_object('sourceState',COALESCE(v_source_state,'missing'),'facts',v_facts);
END;
$function$;


REVOKE ALL ON FUNCTION public.public_search_source_facts(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_search_source_facts(text,text) TO service_role;

COMMENT ON FUNCTION public.public_search_source_facts(text,text) IS
  '#2986 safe public facts for the five route families. #3193 makes brand row selection total and live-preferring: a soft-deleted tombstone may decide a page''s public state only when no live row shares that slug.';

-- Migration-time proof. These checks intentionally fail the clean Postgres
-- migration lane if a later edit loses the live-row ordering or widens the
-- #2986 ACL posture this function was shipped with.
DO $check$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='public_search_source_facts'
    AND pg_get_function_identity_arguments(p.oid)='p_path text, p_kind text';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '#3193 public_search_source_facts(text,text) is missing after replace';
  END IF;
  IF position('ORDER BY (b.deleted_at IS NULL) DESC, b.created_at DESC, b.id' IN v_def)=0 THEN
    RAISE EXCEPTION '#3193 brand row selection lost its live-preferring total order';
  END IF;
  IF position('WHERE b.slug=v_parts[2] LIMIT 1;' IN v_def)<>0 THEN
    RAISE EXCEPTION '#3193 the unordered brand row selection is still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='public_search_source_facts'
      AND (NOT p.prosecdef OR array_to_string(p.proconfig,',') NOT LIKE '%search_path=public, pg_temp%'
           OR p.provolatile<>'s')) THEN
    RAISE EXCEPTION '#3193 public_search_source_facts security posture drifted';
  END IF;
  IF has_function_privilege('anon','public.public_search_source_facts(text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.public_search_source_facts(text,text)','EXECUTE') THEN
    RAISE EXCEPTION '#3193 public_search_source_facts became directly executable';
  END IF;
  IF NOT has_function_privilege('service_role','public.public_search_source_facts(text,text)','EXECUTE') THEN
    RAISE EXCEPTION '#3193 service_role lost EXECUTE on public_search_source_facts';
  END IF;
  IF NOT has_function_privilege('anon','public.resolve_public_search_document(text)','EXECUTE') THEN
    RAISE EXCEPTION '#3193 the anonymous public resolver lost anon EXECUTE';
  END IF;
END;
$check$;

COMMIT;
