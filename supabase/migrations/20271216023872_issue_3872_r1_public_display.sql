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
  (SELECT d.display_price_cents
     FROM public.pg_public_event_display_prices(ARRAY[e.id]) d
    WHERE d.event_id=e.id) AS display_price_cents,
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

-- Rebuild only the top-level JSON object, in its original key order, while
-- replacing the named ticket array/object values. Using jsonb for the whole
-- response would reorder legacy keys and violate the installed reader contracts.
CREATE OR REPLACE FUNCTION public.issue_3872_enrich_public_ticket_payload(
  p_payload json,
  p_array_key text,
  p_id_key text,
  p_object_key text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH body AS (
    SELECT json_object_agg(entry.key,
      CASE
        WHEN entry.key=p_array_key AND json_typeof(entry.value)='array' THEN COALESCE((
          SELECT jsonb_agg(
            item.value::jsonb || COALESCE(public.issue_3872_ticket_sale_json((item.value->>p_id_key)::uuid),'{}'::jsonb)
            ORDER BY item.ordinality
          )
          FROM json_array_elements(entry.value) WITH ORDINALITY item(value,ordinality)
        ),'[]'::jsonb)::json
        WHEN p_object_key IS NOT NULL AND entry.key=p_object_key
             AND json_typeof(entry.value)='object'
             AND NULLIF(entry.value->>p_id_key,'') IS NOT NULL THEN
          (entry.value::jsonb || COALESCE(
            public.issue_3872_ticket_sale_json((entry.value->>p_id_key)::uuid),'{}'::jsonb
          ))::json
        ELSE entry.value
      END
      ORDER BY entry.ordinality) AS payload
    FROM json_each(p_payload) WITH ORDINALITY entry(key,value,ordinality)
    WHERE entry.key<>'refundPolicy'
  )
  SELECT CASE WHEN p_payload::jsonb ? 'refundPolicy' THEN
    (left(body.payload::text,length(body.payload::text)-1)
      || ', "refundPolicy" : '
      || COALESCE((p_payload->'refundPolicy')::text,'null') || '}')::json
  ELSE body.payload END
  FROM body;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_enrich_public_ticket_payload(json,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.issue_3872_enrich_rsvp_payload(p_payload json)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT json_object_agg(entry.key,
    CASE WHEN entry.key='publicEventRow' AND json_typeof(entry.value)='object' THEN
      jsonb_set(
        entry.value::jsonb,
        '{display_price_cents}',
        COALESCE(to_jsonb((
          SELECT d.display_price_cents
          FROM public.issue_3872_event_display_prices((p_payload->>'id')::uuid) d
        )),'null'::jsonb),
        true
      )::json
    ELSE entry.value END
    ORDER BY entry.ordinality)
  FROM json_each(p_payload) WITH ORDINALITY entry(key,value,ordinality);
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_enrich_rsvp_payload(json) FROM PUBLIC,anon,authenticated;

-- Keep each audited SQL reader's complete installed body inside the additive
-- wrapper. Older contracts remove their own historical lines from pg_proc.prosrc
-- and execute the result; retaining the body makes those proofs stay meaningful.
DO $install$
DECLARE
  v_body text;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT regexp_replace(p.prosrc,E';\\s*$','') INTO v_body
    FROM pg_proc p WHERE p.oid='public.pg_public_event_by_slug(text,text)'::regprocedure;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text,p_event_slug text) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS %L',
    format(E'WITH issue_3872_original(payload) AS MATERIALIZED (\n%s\n)\n'
      'SELECT public.issue_3872_enrich_public_ticket_payload(payload,''tickets'',''id'',NULL) '
      'FROM issue_3872_original;',v_body)
  );

  SELECT regexp_replace(p.prosrc,E';\\s*$','') INTO v_body
    FROM pg_proc p WHERE p.oid='public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle('
    'p_event_id uuid DEFAULT NULL,p_brand_slug text DEFAULT NULL,p_event_slug text DEFAULT NULL) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS %L',
    format(E'WITH issue_3872_original(payload) AS MATERIALIZED (\n%s\n)\n'
      'SELECT public.issue_3872_enrich_public_ticket_payload(payload,''tickets'',''id'',NULL) '
      'FROM issue_3872_original;',v_body)
  );

  SELECT regexp_replace(p.prosrc,E';\\s*$','') INTO v_body
    FROM pg_proc p WHERE p.oid='public.pg_public_experience_by_slug(text,text)'::regprocedure;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text,p_experience_slug text) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS %L',
    format(E'WITH issue_3872_original(payload) AS MATERIALIZED (\n%s\n)\n'
      'SELECT public.issue_3872_enrich_public_ticket_payload(payload,''options'',''ticketTypeId'',''ticket'') '
      'FROM issue_3872_original;',v_body)
  );

  SELECT pg_get_functiondef('public.pg_public_rsvp_by_slug(text,text)'::regprocedure),
         regexp_replace((SELECT p.prosrc FROM pg_proc p
           WHERE p.oid='public.pg_public_rsvp_by_slug(text,text)'::regprocedure),E';\\s*$','')
    INTO v_def,v_body;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text,p_event_slug text) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS %L',
    format(E'WITH issue_3872_original(payload) AS MATERIALIZED (\n%s\n)\n'
      'SELECT public.issue_3872_enrich_rsvp_payload(payload) FROM issue_3872_original;',v_body)
  );

  SELECT pg_get_functiondef('public.pg_ticket_link_resolve(text)'::regprocedure),p.prosrc
    INTO v_def,v_body FROM pg_proc p
   WHERE p.oid='public.pg_ticket_link_resolve(text)'::regprocedure;
  v_old:=E'        ''saleStartAt'', tt.sale_start_at, ''saleEndAt'', tt.sale_end_at\n      ) END,';
  v_new:=E'        ''saleStartAt'', tt.sale_start_at, ''saleEndAt'', tt.sale_end_at\n'
    '      ) || COALESCE(public.issue_3872_ticket_sale_json(tt.id),''{}''::jsonb) END,';
  IF (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'issue_3872_ticket_link_transform_drift';
  END IF;
  v_body:=replace(v_body,v_old,v_new);
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text) '
    'RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER '
    'SET search_path=public,pg_temp AS %L',v_body
  );

  SELECT pg_get_functiondef('public.pg_experience_booking_quote(uuid,uuid,integer,integer)'::regprocedure),p.prosrc
    INTO v_def,v_body FROM pg_proc p
   WHERE p.oid='public.pg_experience_booking_quote(uuid,uuid,integer,integer)'::regprocedure;
  v_old:=E'    ''unitPriceCents'', v_unit\n  );';
  v_new:=E'    ''unitPriceCents'', v_unit\n  ) || COALESCE((\n'
    '    SELECT jsonb_build_object(\n'
    '      ''saleUnitPriceCents'', CASE WHEN s.sale_base_cents IS NULL THEN NULL '
      'WHEN v_basis=''block'' THEN s.sale_base_cents*p_blocks ELSE s.sale_base_cents END,\n'
    '      ''saleUnitAllInCents'', CASE WHEN s.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(\n'
    '        CASE WHEN v_basis=''block'' THEN s.sale_base_cents*p_blocks ELSE s.sale_base_cents END,\n'
    '        v_event.pass_mingla_fee,v_event.pass_service_fee,\n'
    '        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(v_event.brand_id) r)\n'
    '      ) END,\n'
    '      ''saleEndsAt'',s.sale_ends_at\n'
    '    ) FROM public.issue_3872_display_sale_unit(v_tt.id,now()) s\n'
    '  ),jsonb_build_object(''saleUnitPriceCents'',NULL,''saleUnitAllInCents'',NULL,''saleEndsAt'',NULL));';
  IF (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'issue_3872_experience_quote_transform_drift';
  END IF;
  v_body:=replace(v_body,v_old,v_new);
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_experience_booking_quote('
    'p_event_id uuid,p_ticket_type_id uuid,p_party integer DEFAULT 1,p_blocks integer DEFAULT 1) '
    'RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER '
    'SET search_path=public,pg_temp AS %L',v_body
  );
END;
$install$;

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
