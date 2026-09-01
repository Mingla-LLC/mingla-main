-- issue #2986 — one opt-in, truth-preserving public-search lifecycle.
--
-- This migration deliberately seeds ZERO rows. Existing public Host pages remain
-- public_noindex until an administrator or service job verifies the page and
-- explicitly promotes it. The public resolver is exact-path only; the only
-- enumerable reader is the separately constrained sitemap function.

BEGIN;

CREATE TABLE public.public_search_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL CHECK (entity_kind IN ('event','trip','experience','brand','venue')),
  entity_id uuid NOT NULL,
  canonical_path text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'public_noindex'
    CHECK (lifecycle_state IN ('draft','public_noindex','search_ready','stale','expired_archived','redirected','gone')),
  redirect_target_path text,
  validation_checks jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(validation_checks) = 'object'),
  source_updated_at timestamptz,
  verified_at timestamptz,
  review_due_at timestamptz,
  search_ready_at timestamptz,
  state_updated_at timestamptz NOT NULL DEFAULT now(),
  change_reason text NOT NULL,
  change_source text NOT NULL,
  updated_by uuid,
  is_test_record boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_search_documents_canonical_path_uniq UNIQUE (canonical_path),
  CONSTRAINT public_search_documents_redirect_shape CHECK (
    (lifecycle_state = 'redirected' AND redirect_target_path IS NOT NULL)
    OR (lifecycle_state <> 'redirected' AND redirect_target_path IS NULL)
  ),
  CONSTRAINT public_search_documents_reason_nonempty CHECK (length(btrim(change_reason)) BETWEEN 3 AND 500),
  CONSTRAINT public_search_documents_source_nonempty CHECK (length(btrim(change_source)) BETWEEN 2 AND 100)
);

CREATE UNIQUE INDEX public_search_documents_live_entity_uniq
  ON public.public_search_documents(entity_kind, entity_id)
  WHERE lifecycle_state <> 'redirected';

CREATE INDEX public_search_documents_sitemap_idx
  ON public.public_search_documents(canonical_path, source_updated_at DESC)
  WHERE lifecycle_state = 'search_ready' AND is_test_record = false;

ALTER TABLE public.public_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_search_documents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_search_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_search_documents TO service_role;

CREATE POLICY public_search_documents_service_all
  ON public.public_search_documents
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE public.public_search_document_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  actor_id uuid,
  actor_role text,
  change_reason text NOT NULL,
  change_source text NOT NULL,
  before_row jsonb,
  after_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_search_document_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_search_document_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_search_document_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.public_search_document_audit TO service_role;

CREATE POLICY public_search_document_audit_service_all
  ON public.public_search_document_audit
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Closed route grammar. It rejects query strings, fragments, percent-encoded
-- separators/traversal, backslashes, doubled slashes, dot segments, Unicode
-- lookalikes and non-canonical case before any source relation is consulted.
CREATE FUNCTION public.public_search_path_kind(p_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_path IS NULL OR octet_length(p_path) > 512 OR p_path <> lower(p_path)
      OR p_path ~ '[?#%\\]' OR p_path ~ '//' OR p_path ~ '(^|/)\.\.?(/|$)'
      OR p_path !~ '^[\x00-\x7F]+$' THEN NULL
    WHEN p_path ~ '^/e/[a-z0-9][a-z0-9_-]{0,127}/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'event'
    WHEN p_path ~ '^/t/[a-z0-9][a-z0-9_-]{0,127}/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'trip'
    WHEN p_path ~ '^/exp/[a-z0-9][a-z0-9_-]{0,127}/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'experience'
    WHEN p_path ~ '^/b/[a-z0-9][a-z0-9_-]{0,127}/v/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'venue'
    WHEN p_path ~ '^/b/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'brand'
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION public.public_search_path_kind(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_search_path_kind(text) TO service_role;

-- A search-ready row must still agree with live source truth. This is a
-- private helper called by promotion, resolution and sitemap selection. It
-- never replaces #2117's visibility authority: offering checks delegate to
-- pg_offering_visibility_gate(..., 'listing').
CREATE FUNCTION public.public_search_source_is_search_ready(p_kind text, p_entity_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_ready boolean := false;
BEGIN
  CASE p_kind
    WHEN 'event' THEN
      SELECT COALESCE(
        e.event_type IN ('event','rsvp')
        AND e.status IN ('scheduled','live')
        AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
        AND b.deleted_at IS NULL
        AND length(btrim(e.title)) >= 4
        AND length(btrim(COALESCE(e.description,''))) >= 40
        AND e.cover_media_url ~ '^https://'
        AND (e.is_online OR NULLIF(btrim(e.location_text),'') IS NOT NULL OR NULLIF(btrim(e.city),'') IS NOT NULL)
        AND EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.event_id = e.id AND d.is_master AND d.end_at > now())
        AND (e.event_type='rsvp' OR EXISTS (
          SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
            AND tt.deleted_at IS NULL AND NOT tt.is_hidden AND NOT tt.is_disabled
            AND tt.available_online AND (tt.sale_start_at IS NULL OR tt.sale_start_at<=now())
            AND (tt.sale_end_at IS NULL OR tt.sale_end_at>now()))),
        false)
      INTO v_ready FROM public.events e
      JOIN public.brands b ON b.id=e.brand_id
      JOIN public.creator_accounts ca ON ca.id=b.account_id AND ca.deleted_at IS NULL
      WHERE e.id=p_entity_id;
    WHEN 'trip' THEN
      SELECT COALESCE(
        e.event_type='trip' AND e.status IN ('scheduled','live')
        AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
        AND b.deleted_at IS NULL
        AND length(btrim(e.title)) >= 4
        AND length(btrim(COALESCE(e.description,''))) >= 40
        AND e.cover_media_url ~ '^https://'
        AND NULLIF(btrim(COALESCE(e.destination_text, e.theme #>> '{business_trip,destinationLocationText}')),'') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.event_id=e.id AND d.is_master AND d.end_at > now())
        AND EXISTS (
          SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
            AND tt.deleted_at IS NULL AND NOT tt.is_hidden AND NOT tt.is_disabled
            AND tt.available_online AND (tt.sale_start_at IS NULL OR tt.sale_start_at<=now())
            AND (tt.sale_end_at IS NULL OR tt.sale_end_at>now())),
        false)
      INTO v_ready FROM public.events e
      JOIN public.brands b ON b.id=e.brand_id
      JOIN public.creator_accounts ca ON ca.id=b.account_id AND ca.deleted_at IS NULL
      WHERE e.id=p_entity_id;
    WHEN 'experience' THEN
      SELECT COALESCE(
        e.event_type='experience' AND e.status IN ('scheduled','live')
        AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
        AND b.deleted_at IS NULL
        AND length(btrim(e.title)) >= 4
        AND length(btrim(COALESCE(e.description,''))) >= 40
        AND e.cover_media_url ~ '^https://'
        AND EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.event_id=e.id AND d.is_master AND d.end_at > now())
        AND (e.is_online OR EXISTS (SELECT 1 FROM public.experience_stops s WHERE s.event_id=e.id))
        AND EXISTS (
          SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
            AND tt.deleted_at IS NULL AND NOT tt.is_hidden AND NOT tt.is_disabled
            AND tt.available_online AND (tt.sale_start_at IS NULL OR tt.sale_start_at<=now())
            AND (tt.sale_end_at IS NULL OR tt.sale_end_at>now())),
        false)
      INTO v_ready FROM public.events e
      JOIN public.brands b ON b.id=e.brand_id
      JOIN public.creator_accounts ca ON ca.id=b.account_id AND ca.deleted_at IS NULL
      WHERE e.id=p_entity_id;
    WHEN 'brand' THEN
      SELECT COALESCE(
        b.deleted_at IS NULL
        AND length(btrim(b.name)) >= 2
        AND length(btrim(COALESCE(b.description,''))) >= 40
        AND COALESCE(b.cover_media_url,b.profile_photo_url) ~ '^https://'
        AND EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.brand_id=b.id AND e.status IN ('scheduled','live')
            AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'listing')
        ), false)
      INTO v_ready FROM public.brands b
      JOIN public.creator_accounts ca ON ca.id=b.account_id AND ca.deleted_at IS NULL
      WHERE b.id=p_entity_id;
    WHEN 'venue' THEN
      SELECT COALESCE(
        v.claim_status='verified' AND b.deleted_at IS NULL
        AND length(btrim(v.name)) >= 2
        AND NULLIF(btrim(v.city),'') IS NOT NULL
        AND NULLIF(btrim(v.country_code),'') IS NOT NULL
        AND v.cover_media_url ~ '^https://'
        AND length(btrim(COALESCE(pp.generative_summary,b.description,''))) >= 40,
        false)
      INTO v_ready
      FROM public.venue_listings v
      JOIN public.brands b ON b.id=v.brand_id
      JOIN public.creator_accounts ca ON ca.id=b.account_id AND ca.deleted_at IS NULL
      LEFT JOIN public.place_pool pp ON pp.id=v.place_pool_id
      WHERE v.id=p_entity_id;
    ELSE v_ready := false;
  END CASE;
  RETURN COALESCE(v_ready,false);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_search_source_is_search_ready(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_search_source_is_search_ready(text,uuid) TO service_role;

CREATE FUNCTION public.public_search_validation_complete(p_kind text, p_checks jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    jsonb_typeof(p_checks)='object'
    AND p_checks @> '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true}'::jsonb
    AND CASE
      WHEN p_kind='event' THEN p_checks @> '{"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}'::jsonb
      WHEN p_kind='trip' THEN p_checks @> '{"schedule_verified":true,"location_verified":true,"itinerary_verified":true,"destination_verified":true,"operator_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'::jsonb
      WHEN p_kind='experience' THEN p_checks @> '{"schedule_verified":true,"location_verified":true,"operator_verified":true,"duration_verified":true,"inclusions_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'::jsonb
      WHEN p_kind='brand' THEN p_checks @> '{"identity_verified":true,"inventory_verified":true,"ownership_source_verified":true,"action_or_inventory_verified":true}'::jsonb
      WHEN p_kind='venue' THEN p_checks @> '{"identity_verified":true,"location_verified":true,"contact_hours_verified_when_shown":true,"offering_context_verified":true,"address_privacy_verified":true}'::jsonb
      ELSE false
    END,
    false);
$function$;

REVOKE ALL ON FUNCTION public.public_search_validation_complete(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_search_validation_complete(text,jsonb) TO service_role;

CREATE FUNCTION public.tg_validate_public_search_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_path_kind text;
  v_source jsonb;
  v_source_updated_at timestamptz;
BEGIN
  v_path_kind := public.public_search_path_kind(NEW.canonical_path);
  IF v_path_kind IS NULL OR v_path_kind <> NEW.entity_kind THEN
    RAISE EXCEPTION 'public_search_invalid_canonical_path' USING ERRCODE='22023';
  END IF;
  IF NEW.redirect_target_path IS NOT NULL THEN
    IF public.public_search_path_kind(NEW.redirect_target_path) IS NULL
       OR NEW.redirect_target_path=NEW.canonical_path THEN
      RAISE EXCEPTION 'public_search_invalid_redirect_target' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.public_search_documents d
               WHERE d.canonical_path=NEW.redirect_target_path AND d.lifecycle_state='redirected')
       OR EXISTS (SELECT 1 FROM public.public_search_documents d
                  WHERE d.redirect_target_path=NEW.canonical_path
                    AND d.lifecycle_state='redirected'
                    AND d.id IS DISTINCT FROM NEW.id) THEN
      RAISE EXCEPTION 'public_search_redirect_chain_or_cycle' USING ERRCODE='22023';
    END IF;
    v_source := public.public_search_source_facts(
      NEW.redirect_target_path,
      public.public_search_path_kind(NEW.redirect_target_path));
    IF v_source->>'sourceState' IS DISTINCT FROM 'visible' THEN
      RAISE EXCEPTION 'public_search_redirect_target_not_visible' USING ERRCODE='22023';
    END IF;
  END IF;
  IF NEW.lifecycle_state='search_ready' THEN
    v_source := public.public_search_source_facts(NEW.canonical_path,NEW.entity_kind);
    BEGIN
      v_source_updated_at := (v_source->'facts'->>'sourceUpdatedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_source_updated_at := NULL;
    END;
    IF NEW.is_test_record
       OR NEW.verified_at IS NULL
       OR NEW.source_updated_at IS NULL
       OR NEW.review_due_at IS NULL OR NEW.review_due_at <= now()
       OR NOT public.public_search_validation_complete(NEW.entity_kind,NEW.validation_checks)
       OR NOT public.public_search_source_is_search_ready(NEW.entity_kind,NEW.entity_id)
       OR v_source->>'sourceState' IS DISTINCT FROM 'visible'
       OR v_source->'facts'->>'id' IS DISTINCT FROM NEW.entity_id::text
       OR v_source_updated_at IS NULL
       OR NEW.source_updated_at IS DISTINCT FROM v_source_updated_at THEN
      RAISE EXCEPTION 'public_search_readiness_incomplete' USING ERRCODE='22023';
    END IF;
    NEW.search_ready_at := COALESCE(NEW.search_ready_at,now());
  ELSE
    NEW.search_ready_at := NULL;
  END IF;
  NEW.updated_at := now();
  NEW.state_updated_at := CASE
    WHEN TG_OP='INSERT' OR NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN now()
    ELSE OLD.state_updated_at END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_validate_public_search_document() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validate_public_search_document
  BEFORE INSERT OR UPDATE ON public.public_search_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_public_search_document();

CREATE FUNCTION public.tg_audit_public_search_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_row public.public_search_documents%ROWTYPE;
BEGIN
  v_row := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  INSERT INTO public.public_search_document_audit(
    document_id,operation,actor_id,actor_role,change_reason,change_source,before_row,after_row)
  VALUES (
    v_row.id,TG_OP,COALESCE(v_row.updated_by,auth.uid()),auth.role(),v_row.change_reason,v_row.change_source,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_audit_public_search_document() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_public_search_document
  AFTER INSERT OR UPDATE OR DELETE ON public.public_search_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_public_search_document();

-- Safe public facts for the five route families. Exact addresses, contact
-- details, coordinates, authoring state and buyer records are never returned.
-- The only commerce facts are the current public ticket floor/free truth.
-- Offering access delegates to the #2117 direct-link gate.
CREATE FUNCTION public.public_search_source_facts(p_path text, p_kind text)
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
    WHERE b.slug=v_parts[2] LIMIT 1;
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

-- The sole public document resolver: one request, one lifecycle decision, one
-- safe fact payload, independent of User-Agent. No overlay row means
-- public_noindex only when the source itself is exact-link visible.
CREATE FUNCTION public.resolve_public_search_document(p_path text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text := public.public_search_path_kind(p_path);
  v_doc public.public_search_documents%ROWTYPE;
  v_has_doc boolean := false;
  v_source jsonb;
  v_facts jsonb;
  v_source_state text;
  v_effective text;
  v_integrity boolean := true;
BEGIN
  IF v_kind IS NULL THEN RETURN jsonb_build_object('valid',false); END IF;
  SELECT * INTO v_doc FROM public.public_search_documents d WHERE d.canonical_path=p_path;
  v_has_doc := FOUND;

  v_source := public.public_search_source_facts(p_path,v_kind);
  v_source_state := v_source->>'sourceState';
  v_facts := v_source->'facts';

  -- A lifecycle overlay is never permission to reveal a private/draft source.
  -- Missing sources may still carry factless gone/redirected history, but an
  -- existing ineligible source always fails closed before any overlay state.
  IF v_source_state='draft' THEN
    RETURN jsonb_build_object('valid',true,'kind',v_kind,'state','draft',
      'canonicalPath',p_path,'integrityOk',true,'facts',NULL);
  END IF;

  IF v_has_doc AND v_doc.lifecycle_state='redirected' THEN
    RETURN jsonb_build_object('valid',true,'kind',v_kind,'state','redirected','canonicalPath',p_path,
      'redirectTargetPath',v_doc.redirect_target_path,'integrityOk',true);
  END IF;
  IF v_has_doc AND v_doc.lifecycle_state='gone' THEN
    RETURN jsonb_build_object('valid',true,'kind',v_kind,'state','gone','canonicalPath',p_path,'integrityOk',true);
  END IF;

  IF v_has_doc AND v_facts IS NOT NULL AND v_facts <> 'null'::jsonb THEN
    v_integrity := v_doc.entity_kind=v_kind AND v_doc.entity_id=(v_facts->>'id')::uuid;
  ELSIF v_has_doc THEN
    v_integrity := v_doc.entity_kind=v_kind;
  END IF;

  IF NOT v_integrity THEN
    RETURN jsonb_build_object('valid',true,'kind',v_kind,'state','dependency_failure',
      'canonicalPath',p_path,'integrityOk',false);
  END IF;

  -- Archive is fact-bearing and therefore valid only for source-confirmed
  -- ended/cancelled offerings. Any other kind/state pairing fails closed.
  IF v_has_doc AND v_doc.lifecycle_state='expired_archived' AND (
       v_kind NOT IN ('event','trip','experience')
       OR v_facts->>'status' IS NULL
       OR v_facts->>'status' NOT IN ('ended','cancelled')) THEN
    RETURN jsonb_build_object('valid',true,'kind',v_kind,'state','draft',
      'canonicalPath',p_path,'integrityOk',true,'facts',NULL);
  END IF;

  IF v_has_doc AND v_doc.lifecycle_state='expired_archived' THEN
    v_effective := 'expired_archived';
  ELSIF v_source_state IS DISTINCT FROM 'visible' THEN
    v_effective := 'draft';
    v_facts := NULL;
  ELSIF NOT v_has_doc THEN
    v_effective := 'public_noindex';
  ELSIF v_doc.lifecycle_state='search_ready' AND (
    v_doc.review_due_at IS NULL OR v_doc.review_due_at <= now()
    OR v_doc.is_test_record
    OR NOT public.public_search_validation_complete(v_doc.entity_kind,v_doc.validation_checks)
    OR NOT public.public_search_source_is_search_ready(v_doc.entity_kind,v_doc.entity_id)
    OR v_doc.source_updated_at IS NULL
    OR v_doc.source_updated_at IS DISTINCT FROM (v_facts->>'sourceUpdatedAt')::timestamptz) THEN
    v_effective := 'stale';
  ELSE
    v_effective := v_doc.lifecycle_state;
  END IF;

  RETURN jsonb_build_object(
    'valid',true,'kind',v_kind,'state',v_effective,'canonicalPath',p_path,
    'integrityOk',v_integrity,'facts',v_facts,
    'sourceUpdatedAt',COALESCE(v_doc.source_updated_at,(v_facts->>'sourceUpdatedAt')::timestamptz),
    'reviewDueAt',v_doc.review_due_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_public_search_document(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_search_document(text) TO anon, authenticated, service_role;

-- Separate enumerable reader. It emits only currently verified, non-test,
-- source-truthful search_ready paths; redirects, noindex and stale documents
-- can never leak into discovery.
CREATE FUNCTION public.list_public_search_sitemap()
RETURNS TABLE(canonical_path text, last_modified timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT d.canonical_path, d.source_updated_at
  FROM public.public_search_documents d
  WHERE d.lifecycle_state='search_ready'
    AND d.is_test_record=false
    AND d.review_due_at > now()
    AND public.public_search_validation_complete(d.entity_kind,d.validation_checks)
    AND public.public_search_source_is_search_ready(d.entity_kind,d.entity_id)
    AND (public.public_search_source_facts(d.canonical_path,d.entity_kind)->'facts'->>'id')=d.entity_id::text
    AND d.source_updated_at >= (public.public_search_source_facts(d.canonical_path,d.entity_kind)->'facts'->>'sourceUpdatedAt')::timestamptz
    AND d.source_updated_at <= (public.public_search_source_facts(d.canonical_path,d.entity_kind)->'facts'->>'sourceUpdatedAt')::timestamptz
  ORDER BY d.canonical_path;
$function$;

REVOKE ALL ON FUNCTION public.list_public_search_sitemap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_search_sitemap() TO anon, authenticated, service_role;

CREATE FUNCTION public.upsert_public_search_document(
  p_entity_kind text,
  p_entity_id uuid,
  p_canonical_path text,
  p_lifecycle_state text,
  p_redirect_target_path text,
  p_validation_checks jsonb,
  p_source_updated_at timestamptz,
  p_verified_at timestamptz,
  p_review_due_at timestamptz,
  p_change_reason text,
  p_change_source text,
  p_is_test_record boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.public_search_documents%ROWTYPE;
  v_source jsonb;
  v_derived_source_updated_at timestamptz;
BEGIN
  -- Authorization is intentionally the first executable guard.
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF length(btrim(COALESCE(p_change_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF length(btrim(COALESCE(p_change_source,''))) < 2 THEN RAISE EXCEPTION 'source_required'; END IF;

  -- The caller timestamp is only a bounded review/concurrency hint. The
  -- authoritative source version is derived inside this definer and is the
  -- only value ever persisted, so an admin payload cannot pin future freshness.
  v_source := public.public_search_source_facts(p_canonical_path,p_entity_kind);
  BEGIN
    v_derived_source_updated_at := (v_source->'facts'->>'sourceUpdatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_derived_source_updated_at := NULL;
  END;
  IF p_lifecycle_state='search_ready' AND (
       p_source_updated_at IS NULL
       OR v_derived_source_updated_at IS NULL
       OR p_source_updated_at > clock_timestamp()+interval '5 minutes') THEN
    RAISE EXCEPTION 'public_search_readiness_incomplete' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.public_search_documents(
    entity_kind,entity_id,canonical_path,lifecycle_state,redirect_target_path,
    validation_checks,source_updated_at,verified_at,review_due_at,change_reason,
    change_source,updated_by,is_test_record)
  VALUES (
    p_entity_kind,p_entity_id,p_canonical_path,p_lifecycle_state,p_redirect_target_path,
    COALESCE(p_validation_checks,'{}'::jsonb),v_derived_source_updated_at,p_verified_at,p_review_due_at,
    p_change_reason,p_change_source,auth.uid(),COALESCE(p_is_test_record,false))
  ON CONFLICT (canonical_path) DO UPDATE SET
    entity_kind=EXCLUDED.entity_kind,entity_id=EXCLUDED.entity_id,
    lifecycle_state=EXCLUDED.lifecycle_state,redirect_target_path=EXCLUDED.redirect_target_path,
    validation_checks=EXCLUDED.validation_checks,source_updated_at=EXCLUDED.source_updated_at,
    verified_at=EXCLUDED.verified_at,review_due_at=EXCLUDED.review_due_at,
    change_reason=EXCLUDED.change_reason,change_source=EXCLUDED.change_source,
    updated_by=EXCLUDED.updated_by,is_test_record=EXCLUDED.is_test_record
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_public_search_document(text,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,text,text,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_public_search_document(text,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,text,text,boolean)
  TO authenticated, service_role;

COMMENT ON TABLE public.public_search_documents IS
  '#2986 opt-in public-search lifecycle overlay. Empty at migration time; no publication side effect promotes a page.';
COMMENT ON FUNCTION public.resolve_public_search_document(text) IS
  '#2986 exact-path, UA-independent public document resolver. Returns only address-safe visible facts and effective lifecycle.';
COMMENT ON FUNCTION public.list_public_search_sitemap() IS
  '#2986 separate enumerable reader; only verified, current search_ready paths.';

-- Migration-time security and zero-seed proof. These checks intentionally fail
-- the clean Postgres migration lane if a later edit widens table access or
-- forgets SECURITY DEFINER/search_path on a public reader.
DO $check$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.public_search_documents;
  IF v_count <> 0 THEN RAISE EXCEPTION '#2986 migration must seed zero search documents'; END IF;
  IF has_table_privilege('anon','public.public_search_documents','SELECT')
     OR has_table_privilege('authenticated','public.public_search_documents','SELECT') THEN
    RAISE EXCEPTION '#2986 overlay table is directly readable';
  END IF;
  IF NOT has_function_privilege('anon','public.resolve_public_search_document(text)','EXECUTE')
     OR NOT has_function_privilege('anon','public.list_public_search_sitemap()','EXECUTE') THEN
    RAISE EXCEPTION '#2986 public readers lost anon EXECUTE';
  END IF;
  IF has_function_privilege('anon','public.upsert_public_search_document(text,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,text,text,boolean)','EXECUTE') THEN
    RAISE EXCEPTION '#2986 anon can mutate search lifecycle';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('resolve_public_search_document','list_public_search_sitemap')
      AND (NOT p.prosecdef OR array_to_string(p.proconfig,',') NOT LIKE '%search_path=public, pg_temp%')) THEN
    RAISE EXCEPTION '#2986 public reader security posture drifted';
  END IF;
END;
$check$;

COMMIT;
