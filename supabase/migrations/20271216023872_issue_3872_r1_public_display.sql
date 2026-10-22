-- Issue #3872 R1 discounts: public display prices and sale read models.
BEGIN;

-- Abort instead of silently wrapping a reader that changed after the v4 audit.
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_public_event_tier_allin(uuid)'::regprocedure) <> 'd2d9ef051a12f970aab606e3e0c194d2'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_public_event_by_slug(text,text)'::regprocedure) <> 'bda8a8b6b41847ed9dd0d75a875af9bc'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure) <> '00c7efab5b85a2d9f68f2efe31c9cc42'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_public_experience_by_slug(text,text)'::regprocedure) <> 'c6a09cab07cde7418a97c037dfdcab2e'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_ticket_link_resolve(text)'::regprocedure) <> '34e960a112298eb58c9e92945b5357ab'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_experience_booking_quote(uuid,uuid,integer,integer)'::regprocedure) <> '9a4fafaf4866177478dad3f044c26a67'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pg_public_rsvp_by_slug(text,text)'::regprocedure) <> '3a581146c6847ed7b4165ab805877fe5'
     OR md5(pg_get_viewdef('public.business_public_events_view'::regclass)) <> 'db64ce4cee6c0a0e8b853e508c196279'
  THEN
    RAISE EXCEPTION 'issue_3872_public_reader_drift';
  END IF;
END;
$guard$;

-- DP-1 shared one-unit display calculation. It intentionally removes minimum-
-- subtotal automatics; a public page cannot promise a cart-dependent price.
CREATE OR REPLACE FUNCTION public.issue_3872_display_discount_unit(
  p_brand_id uuid,
  p_currency text,
  p_item_kind text,
  p_item_id uuid,
  p_listing_kind text,
  p_listing_id uuid,
  p_list_unit_cents integer,
  p_allowed boolean,
  p_timezone text,
  p_at timestamptz DEFAULT now()
) RETURNS TABLE(
  sale_base_cents integer,
  sale_ends_at timestamptz,
  sale_discount_id uuid,
  sale_name text,
  sale_remaining integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lines jsonb;
  v_candidates jsonb;
  v_automatics jsonb;
  v_quote jsonb;
BEGIN
  IF p_list_unit_cents IS NULL OR p_list_unit_cents <= 0 OR NOT COALESCE(p_allowed,false) THEN
    RETURN;
  END IF;

  v_lines := jsonb_build_array(jsonb_build_object(
    'lineRef',p_item_id::text,
    'itemKind',p_item_kind,
    'itemId',p_item_id,
    'listingKind',p_listing_kind,
    'listingId',p_listing_id,
    'listUnitMinor',p_list_unit_cents,
    'qty',1,
    'valueScale',1,
    'countScale',1,
    'allowed',true,
    'tz',COALESCE(NULLIF(p_timezone,''),'UTC')
  ));
  v_candidates := public.issue_3872_discount_candidates(
    p_brand_id,v_lines,NULL,'{}'::jsonb,p_at
  );
  SELECT COALESCE(jsonb_agg(a),'[]'::jsonb)
    INTO v_automatics
    FROM jsonb_array_elements(COALESCE(v_candidates->'automatics','[]'::jsonb)) a
   WHERE a->'minSubtotalMinor' IS NULL OR a->'minSubtotalMinor' = 'null'::jsonb;

  v_quote := public.issue_3872_discount_apply(jsonb_build_object(
    'currency',upper(COALESCE(p_currency,'')),
    'at',p_at,
    'queued',false,
    'lines',v_lines,
    'automatics',v_automatics,
    'code',NULL,
    'codeLookup','none'
  ));
  IF COALESCE((v_quote->>'netSubtotalMinor')::integer,p_list_unit_cents) >= p_list_unit_cents THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH applied AS (
    SELECT a.value, a.ordinality
      FROM jsonb_array_elements(COALESCE(v_quote->'applied','[]'::jsonb))
        WITH ORDINALITY a(value,ordinality)
  ), current_defs AS (
    SELECT d.*
      FROM public.brand_discounts d
      JOIN applied a ON (a.value->>'discountId')::uuid=d.id
  ), end_points AS (
    SELECT d.ends_at AS endpoint FROM current_defs d WHERE d.ends_at IS NOT NULL
    UNION ALL
    SELECT (((p_at AT TIME ZONE COALESCE(NULLIF(p_timezone,''),'UTC'))::date
             + (d.schedule->>'to')::time) AT TIME ZONE COALESCE(NULLIF(p_timezone,''),'UTC'))
      FROM current_defs d
     WHERE d.schedule IS NOT NULL AND d.schedule <> 'null'::jsonb
       AND NULLIF(d.schedule->>'to','') IS NOT NULL
  )
  SELECT
    (v_quote->>'netSubtotalMinor')::integer,
    (SELECT min(endpoint) FROM end_points),
    (SELECT (a.value->>'discountId')::uuid FROM applied a ORDER BY a.ordinality LIMIT 1),
    (SELECT a.value->>'name' FROM applied a ORDER BY a.ordinality LIMIT 1),
    (SELECT min((c->>'remainingUnits')::integer)
       FROM jsonb_array_elements(v_automatics) c
      WHERE c->'remainingUnits' IS NOT NULL
        AND c->'remainingUnits' <> 'null'::jsonb
        AND EXISTS (SELECT 1 FROM applied a WHERE a.value->>'discountId'=c->>'id'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_display_discount_unit(uuid,text,text,uuid,text,uuid,integer,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.issue_3872_display_sale_unit(
  p_ticket_type_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS TABLE(
  sale_base_cents integer,
  sale_ends_at timestamptz,
  sale_discount_id uuid,
  sale_name text,
  sale_remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT s.*
    FROM public.ticket_types tt
    JOIN public.events e ON e.id=tt.event_id
    JOIN public.brands b ON b.id=e.brand_id
    CROSS JOIN LATERAL public.issue_3872_display_discount_unit(
      b.id,
      COALESCE(b.pricing_currency,tt.currency,e.currency,'USD'),
      'ticket_type',tt.id,e.event_type,e.id,
      GREATEST(0,COALESCE(tt.price_cents,0)),
      e.discounts_allowed AND tt.discounts_allowed AND NOT COALESCE(tt.is_free,false),
      COALESCE(e.timezone,'UTC'),p_at
    ) s
   WHERE tt.id=p_ticket_type_id
     AND tt.deleted_at IS NULL
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_display_sale_unit(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

-- DP-2: new sale-aware reader plus the unchanged legacy shape.
CREATE OR REPLACE FUNCTION public.pg_public_event_tier_pricing(p_event_id uuid)
RETURNS TABLE(
  ticket_type_id uuid,
  base_cents integer,
  all_in_cents integer,
  currency text,
  sale_base_cents integer,
  sale_all_in_cents integer,
  sale_ends_at timestamptz,
  sale_name text,
  sale_remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    tt.id,
    GREATEST(0,COALESCE(tt.price_cents,0)),
    CASE WHEN COALESCE(tt.is_free,false) OR COALESCE(tt.price_cents,0)=0 THEN 0
      ELSE public.compute_all_in_cents(
        tt.price_cents,
        COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
        COALESCE(e.pass_service_fee,b.default_pass_service_fee),
        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
      ) END,
    COALESCE(b.pricing_currency,tt.currency,'usd'),
    sale.sale_base_cents,
    CASE WHEN sale.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(
      sale.sale_base_cents,
      COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
      COALESCE(e.pass_service_fee,b.default_pass_service_fee),
      (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
    ) END,
    sale.sale_ends_at,
    sale.sale_name,
    sale.sale_remaining
  FROM public.ticket_types tt
  JOIN public.events e ON e.id=tt.event_id
  JOIN public.brands b ON b.id=e.brand_id
  LEFT JOIN LATERAL public.issue_3872_display_sale_unit(tt.id,now()) sale ON true
  WHERE tt.event_id=p_event_id
    AND tt.deleted_at IS NULL
    AND COALESCE(tt.is_hidden,false)=false
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')
  ORDER BY GREATEST(0,COALESCE(tt.price_cents,0)),tt.id;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_event_tier_pricing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_event_tier_pricing(uuid) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pg_public_event_tier_allin(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid,base_cents integer,all_in_cents integer,currency text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- TRANSITIONAL (#3872): legacy reader for app binaries released before R1;
  -- remove when no supported binary reads it.
  SELECT p.ticket_type_id,p.base_cents,p.all_in_cents,p.currency
    FROM public.pg_public_event_tier_pricing(p_event_id) p;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_event_tier_allin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_event_tier_allin(uuid) TO anon,authenticated,service_role;

-- DP-3/DP-4: event-level list and sale "from" prices, excluding hidden and
-- disabled tiers from both values.
CREATE OR REPLACE FUNCTION public.issue_3872_event_display_prices(p_event_id uuid)
RETURNS TABLE(
  display_price_cents integer,
  display_sale_price_cents integer,
  display_sale_ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH priced AS (
    SELECT
      tt.id,
      public.compute_all_in_cents(
        tt.price_cents,
        COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
        COALESCE(e.pass_service_fee,b.default_pass_service_fee),
        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
      ) AS list_all_in,
      CASE WHEN sale.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(
        sale.sale_base_cents,
        COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
        COALESCE(e.pass_service_fee,b.default_pass_service_fee),
        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
      ) END AS sale_all_in,
      sale.sale_ends_at
    FROM public.ticket_types tt
    JOIN public.events e ON e.id=tt.event_id
    JOIN public.brands b ON b.id=e.brand_id
    LEFT JOIN LATERAL public.issue_3872_display_sale_unit(tt.id,now()) sale ON true
    WHERE tt.event_id=p_event_id
      AND tt.price_cents>0
      AND tt.deleted_at IS NULL
      AND tt.is_hidden IS NOT TRUE
      AND tt.is_disabled IS NOT TRUE
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
  ), bounds AS (
    SELECT min(list_all_in) list_min,
           min(COALESCE(sale_all_in,list_all_in)) effective_min,
           bool_or(sale_all_in IS NOT NULL) has_sale
      FROM priced
  )
  SELECT
    b.list_min,
    CASE WHEN b.has_sale AND b.effective_min<b.list_min THEN b.effective_min END,
    CASE WHEN b.has_sale AND b.effective_min<b.list_min THEN (
      SELECT p.sale_ends_at FROM priced p
       WHERE COALESCE(p.sale_all_in,p.list_all_in)=b.effective_min
       ORDER BY p.sale_ends_at ASC NULLS LAST,p.id
       LIMIT 1
    ) END
  FROM bounds b;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_event_display_prices(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.pg_public_event_display_prices(p_event_ids uuid[])
RETURNS TABLE(event_id uuid,display_price_cents integer,display_sale_price_cents integer,display_sale_ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF COALESCE(cardinality(p_event_ids),0)>100 THEN RAISE EXCEPTION 'too_many_ids'; END IF;
  RETURN QUERY
  SELECT e.id,d.display_price_cents,d.display_sale_price_cents,d.display_sale_ends_at
    FROM public.events e
    JOIN public.brands b ON b.id=e.brand_id
    CROSS JOIN LATERAL public.issue_3872_event_display_prices(e.id) d
   WHERE e.id=ANY(COALESCE(p_event_ids,'{}'::uuid[]))
     AND e.deleted_at IS NULL AND b.deleted_at IS NULL
     AND e.visibility='public'
     AND e.status=ANY(ARRAY['scheduled','live','ended','cancelled'])
     AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_event_display_prices(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_event_display_prices(uuid[]) TO anon,authenticated,service_role;

-- Keep this view's exact column order; only display_price_cents delegates to the
-- hidden-tier-safe owner above.
CREATE OR REPLACE VIEW public.business_public_events_view WITH (security_invoker = false) AS
SELECT e.id,e.brand_id,b.slug AS brand_slug,b.name AS brand_name,b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,b.display_attendee_count AS brand_display_attendee_count,
  b.address AS brand_address,b.cover_media_url AS brand_cover_media_url,b.theme_color AS brand_theme_color,
  b.theme_font AS brand_theme_font,b.theme_animation AS brand_theme_animation,e.title,e.description,e.slug,
  e.event_type,CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END AS location_text,
  e.online_url,e.is_online,e.is_recurring,e.is_multi_date,e.recurrence_rules,e.cover_media_url,e.cover_media_type,
  e.visibility,e.show_on_discover,e.status,e.published_at,e.timezone,e.created_at,e.updated_at,
  public.issue_2489_public_theme(e.theme) AS public_theme,e.theme_color_override,e.theme_font_override,
  e.theme_animation_override,e.currency,e.cover_media_provider,e.cover_media_source_url,e.cover_media_credit,
  e.cover_media_credit_url,e.cover_media_alt,ed.start_at AS master_start_at,ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,ed.id AS master_event_date_id,e.city,e.party_types,e.vibe_tags,e.music_genres,
  CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_geo END AS location_geo,
  COALESCE(e.pass_tax,b.default_pass_tax) AS pass_tax,
  COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee) AS pass_mingla_fee,
  COALESCE(e.pass_service_fee,b.default_pass_service_fee) AS pass_service_fee,
  b.pricing_region,b.pricing_currency,(e.pricing_locked_at IS NOT NULL) AS pricing_locked,
  (SELECT d.display_price_cents FROM public.issue_3872_event_display_prices(e.id) d) AS display_price_cents,
  e.rsvp_discoverable,e.rsvp_capacity,e.rsvp_allow_plus_ones,e.rsvp_plus_ones_max,e.rsvp_waitlist_enabled,
  e.rsvp_approval_mode,
  CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN NULL::integer ELSE (
    SELECT COALESCE(sum(1+r.plus_count),0)::integer FROM public.event_rsvps r
     WHERE r.event_id=e.id AND r.rsvp_status='going' AND r.approval_status='approved'
  ) END AS rsvp_going_count,
  e.city_geo,e.rsvp_contribution_enabled,e.rsvp_contribution_suggested_cents,e.rsvp_contribution_min_cents,
  e.cover_media_gallery
FROM public.events e
JOIN public.brands b ON b.id=e.brand_id
LEFT JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master=true
WHERE e.deleted_at IS NULL AND b.deleted_at IS NULL AND e.visibility='public'
  AND e.status=ANY(ARRAY['scheduled','live','ended','cancelled'])
  AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);

COMMENT ON VIEW public.business_public_events_view IS
  '#2489 — anon-readable public offering read model. location_text, location_geo and the '
  'theme''s business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true. city_geo is exempt by design. Do not '
  're-emit this view without the gate, and do not re-implement the predicate inline. '
  'issue #3827 — rsvp_going_count is NULL when the guest list is private (never 0). '
  'Never append columns here: CI re-applies 20270523002489 on a migrated database.';

-- Preserve the audited readers as private bases, then expose sale keys through
-- small wrappers. This keeps their security predicates and existing JSON shapes
-- byte-for-byte while making the added fields explicit and testable here.
DO $clone$
DECLARE v_def text;
BEGIN
  v_def:=pg_get_functiondef('public.pg_public_event_by_slug(text,text)'::regprocedure);
  EXECUTE replace(v_def,'FUNCTION public.pg_public_event_by_slug','FUNCTION public.issue_3872_base_public_event_by_slug');
  v_def:=pg_get_functiondef('public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure);
  EXECUTE replace(v_def,'FUNCTION public.pg_direct_event_checkout_bundle','FUNCTION public.issue_3872_base_direct_event_checkout_bundle');
  v_def:=pg_get_functiondef('public.pg_public_experience_by_slug(text,text)'::regprocedure);
  EXECUTE replace(v_def,'FUNCTION public.pg_public_experience_by_slug','FUNCTION public.issue_3872_base_public_experience_by_slug');
  v_def:=pg_get_functiondef('public.pg_ticket_link_resolve(text)'::regprocedure);
  EXECUTE replace(v_def,'FUNCTION public.pg_ticket_link_resolve','FUNCTION public.issue_3872_base_ticket_link_resolve');
  v_def:=pg_get_functiondef('public.pg_experience_booking_quote(uuid,uuid,integer,integer)'::regprocedure);
  EXECUTE replace(v_def,'FUNCTION public.pg_experience_booking_quote','FUNCTION public.issue_3872_base_experience_booking_quote');
  v_def:=pg_get_functiondef('public.pg_public_rsvp_by_slug(text,text)'::regprocedure);
  EXECUTE replace(v_def,'FUNCTION public.pg_public_rsvp_by_slug','FUNCTION public.issue_3872_base_public_rsvp_by_slug');
END;
$clone$;

REVOKE ALL ON FUNCTION public.issue_3872_base_public_event_by_slug(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_3872_base_direct_event_checkout_bundle(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_3872_base_public_experience_by_slug(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_3872_base_ticket_link_resolve(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_3872_base_experience_booking_quote(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_3872_base_public_rsvp_by_slug(text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_sale_json(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'saleBaseCents',s.sale_base_cents,
    'saleAllInCents',CASE WHEN s.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(
      s.sale_base_cents,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
      COALESCE(e.pass_service_fee,b.default_pass_service_fee),
      (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
    ) END,
    'saleEndsAt',s.sale_ends_at,
    'saleName',s.sale_name,
    'saleRemaining',s.sale_remaining
  )
  FROM public.ticket_types tt
  JOIN public.events e ON e.id=tt.event_id
  JOIN public.brands b ON b.id=e.brand_id
  LEFT JOIN LATERAL public.issue_3872_display_sale_unit(tt.id,now()) s ON true
  WHERE tt.id=p_ticket_type_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_ticket_sale_json(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.issue_3872_enrich_ticket_array(p_payload jsonb,p_key text,p_id_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE WHEN p_payload IS NULL THEN NULL ELSE jsonb_set(
    p_payload,ARRAY[p_key],COALESCE((
      SELECT jsonb_agg(x.value || COALESCE(public.issue_3872_ticket_sale_json((x.value->>p_id_key)::uuid),'{}'::jsonb) ORDER BY x.ordinality)
      FROM jsonb_array_elements(COALESCE(p_payload->p_key,'[]'::jsonb)) WITH ORDINALITY x(value,ordinality)
    ),'[]'::jsonb),true
  ) END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_enrich_ticket_array(jsonb,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text,p_event_slug text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT public.issue_3872_enrich_ticket_array(
    public.issue_3872_base_public_event_by_slug(p_brand_slug,p_event_slug)::jsonb,'tickets','id'
  )::json;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_event_by_slug(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_event_by_slug(text,text) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(p_event_id uuid DEFAULT NULL,p_brand_slug text DEFAULT NULL,p_event_slug text DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT public.issue_3872_enrich_ticket_array(
    public.issue_3872_base_direct_event_checkout_bundle(p_event_id,p_brand_slug,p_event_slug)::jsonb,'tickets','id'
  )::json;
$fn$;
REVOKE ALL ON FUNCTION public.pg_direct_event_checkout_bundle(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_direct_event_checkout_bundle(uuid,text,text) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text,p_experience_slug text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v jsonb;
BEGIN
  v:=public.issue_3872_base_public_experience_by_slug(p_brand_slug,p_experience_slug)::jsonb;
  IF v IS NULL THEN RETURN NULL; END IF;
  v:=public.issue_3872_enrich_ticket_array(v,'options','ticketTypeId');
  IF jsonb_typeof(v->'ticket')='object' AND NULLIF(v#>>'{ticket,ticketTypeId}','') IS NOT NULL THEN
    v:=jsonb_set(v,'{ticket}',(v->'ticket')||COALESCE(public.issue_3872_ticket_sale_json((v#>>'{ticket,ticketTypeId}')::uuid),'{}'::jsonb),true);
  END IF;
  RETURN v::json;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_experience_by_slug(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_experience_by_slug(text,text) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v jsonb;
BEGIN
  v:=public.issue_3872_base_ticket_link_resolve(p_token_hash);
  IF jsonb_typeof(v->'tier')='object' AND NULLIF(v#>>'{tier,id}','') IS NOT NULL AND v#>>'{tier,priceCents}' IS NOT NULL THEN
    v:=jsonb_set(v,'{tier}',(v->'tier')||COALESCE(public.issue_3872_ticket_sale_json((v#>>'{tier,id}')::uuid),'{}'::jsonb),true);
  END IF;
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pg_ticket_link_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_ticket_link_resolve(text) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pg_experience_booking_quote(p_event_id uuid,p_ticket_type_id uuid,p_party integer DEFAULT 1,p_blocks integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v jsonb; v_sale record; v_basis text; v_sale_unit integer; v_sale_all_in integer;
BEGIN
  v:=public.issue_3872_base_experience_booking_quote(p_event_id,p_ticket_type_id,p_party,p_blocks);
  SELECT s.*,COALESCE(tt.price_basis,'person') basis,
         COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee) mingla_fee,
         COALESCE(e.pass_service_fee,b.default_pass_service_fee) service_fee,b.id brand_id
    INTO v_sale
    FROM public.ticket_types tt JOIN public.events e ON e.id=tt.event_id JOIN public.brands b ON b.id=e.brand_id
    LEFT JOIN LATERAL public.issue_3872_display_sale_unit(tt.id,now()) s ON true
   WHERE tt.id=p_ticket_type_id AND e.id=p_event_id;
  v_basis:=COALESCE(v_sale.basis,'person');
  v_sale_unit:=CASE WHEN v_sale.sale_base_cents IS NULL THEN NULL WHEN v_basis='block' THEN v_sale.sale_base_cents*p_blocks ELSE v_sale.sale_base_cents END;
  v_sale_all_in:=CASE WHEN v_sale_unit IS NULL THEN NULL ELSE public.compute_all_in_cents(
    v_sale_unit,v_sale.mingla_fee,v_sale.service_fee,
    (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(v_sale.brand_id) r)
  ) END;
  RETURN v||jsonb_build_object('saleUnitPriceCents',v_sale_unit,'saleUnitAllInCents',v_sale_all_in,'saleEndsAt',v_sale.sale_ends_at);
END;
$fn$;
REVOKE ALL ON FUNCTION public.pg_experience_booking_quote(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pg_experience_booking_quote(uuid,uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text,p_event_slug text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v jsonb; v_display integer;
BEGIN
  v:=public.issue_3872_base_public_rsvp_by_slug(p_brand_slug,p_event_slug)::jsonb;
  IF v IS NULL OR NULLIF(v->>'id','') IS NULL THEN RETURN v::json; END IF;
  SELECT d.display_price_cents INTO v_display FROM public.issue_3872_event_display_prices((v->>'id')::uuid) d;
  IF jsonb_typeof(v->'publicEventRow')='object' THEN
    v:=jsonb_set(v,'{publicEventRow,display_price_cents}',to_jsonb(v_display),true);
  END IF;
  RETURN v::json;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_rsvp_by_slug(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_rsvp_by_slug(text,text) TO anon,authenticated,service_role;

-- DP-7 menu sale overlay. The existing public menu view remains unchanged.
CREATE OR REPLACE FUNCTION public.pg_public_menu_item_sales(p_venue_id uuid)
RETURNS TABLE(menu_item_id uuid,sale_price_cents integer,sale_ends_at timestamptz,sale_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT mi.id,s.sale_base_cents,s.sale_ends_at,s.sale_name
  FROM public.menus m
  JOIN public.menu_items mi ON mi.menu_id=m.id
  JOIN public.venue_listings v ON v.id=m.venue_id
  LEFT JOIN public.venue_availability_config a ON a.venue_id=v.id
  CROSS JOIN LATERAL public.issue_3872_display_discount_unit(
    v.brand_id,COALESCE(mi.currency,(SELECT pricing_currency FROM public.brands WHERE id=v.brand_id),'USD'),
    'menu_item',mi.id,'venue_order',v.id,mi.price_cents,
    mi.discounts_allowed AND mi.is_available,COALESCE(a.iana_timezone,'UTC'),now()
  ) s
  WHERE v.id=p_venue_id AND m.is_active=true AND mi.is_available=true AND mi.price_cents IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.pg_public_menu_item_sales(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_menu_item_sales(uuid) TO anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
